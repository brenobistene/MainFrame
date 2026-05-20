"""Endpoints de sessão cronometrada pra Mind e health_item — pendências
do /Dia que precisam rodar com banner global + finalize via modal.

Diferente dos health_records que são instantâneos, essas sessões têm
ciclo de vida (play/pause/resume) igual a quest/task/routine sessions.
Quando finaliza, o modal abre pré-preenchido e o save linka todas as
sessões do "cluster atual" (record_id IS NULL) ao health_record criado.

Doc da decisão: feature de pendências arrastáveis no /Dia.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from db import get_conn
from services.active_session import find_active_session
from services.utils import parse_iso, utcnow_iso_z

router = APIRouter(tags=["dia-sessions"])


# ─── Models ──────────────────────────────────────────────────────────────


class SessionRowOut(BaseModel):
    id: int
    session_num: int
    started_at: str
    ended_at: Optional[str] = None
    record_id: Optional[int] = None


class SessionEdit(BaseModel):
    """Body do PATCH manual de uma row de sessão. Mesmo shape do
    SessionEdit de quests/tasks/routines pra paridade da UI de edição."""
    started_at: Optional[str] = None
    ended_at: Optional[str] = None


class SessionClusterOut(BaseModel):
    """Estado agregado do cluster ativo (record_id IS NULL).

    `started_at` é o earliest entre todas as rows; `ended_at` é o latest
    fechado (None se ainda rodando); `elapsed_seconds` é a soma cumulativa.
    """
    has_active: bool
    is_running: bool
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    elapsed_seconds: int = 0
    rows: list[SessionRowOut] = []


# ─── Helpers ─────────────────────────────────────────────────────────────


def _minutes_between(start_iso: str, end_iso: Optional[str]) -> int:
    """Minutos inteiros entre 2 ISOs. end=None → minutos até agora."""
    try:
        s = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        if end_iso:
            e = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
        else:
            e = datetime.now(timezone.utc)
        return max(0, int((e - s).total_seconds()))
    except (ValueError, AttributeError):
        return 0


def _build_cluster(rows: list) -> SessionClusterOut:
    """Constrói SessionClusterOut a partir de rows (com record_id IS NULL).

    rows: lista de dicts/Rows com keys id, session_num, started_at, ended_at.
    Ordenado por session_num ASC.
    """
    if not rows:
        return SessionClusterOut(has_active=False, is_running=False)
    is_running = any(r["ended_at"] is None for r in rows)
    started_at = rows[0]["started_at"]
    ended_at = None
    if not is_running:
        ended_at = max(r["ended_at"] for r in rows if r["ended_at"])
    elapsed = sum(_minutes_between(r["started_at"], r["ended_at"]) for r in rows)
    return SessionClusterOut(
        has_active=True,
        is_running=is_running,
        started_at=started_at,
        ended_at=ended_at,
        elapsed_seconds=elapsed,
        rows=[
            SessionRowOut(
                id=r["id"],
                session_num=r["session_num"],
                started_at=r["started_at"],
                ended_at=r["ended_at"],
                record_id=r["record_id"] if "record_id" in r.keys() else None,
            )
            for r in rows
        ],
    )


def _fetch_mind_active_rows(conn) -> list:
    return conn.execute(
        "SELECT id, session_num, started_at, ended_at, record_id "
        "FROM mind_session WHERE record_id IS NULL "
        "ORDER BY session_num ASC"
    ).fetchall()


def _fetch_health_item_active_rows(conn, item_id: int) -> list:
    return conn.execute(
        "SELECT id, session_num, started_at, ended_at, record_id "
        "FROM health_item_session "
        "WHERE item_id = ? AND record_id IS NULL "
        "ORDER BY session_num ASC",
        (item_id,),
    ).fetchall()


def _fetch_ritual_active_rows(conn, cadencia: str) -> list:
    return conn.execute(
        "SELECT id, session_num, started_at, ended_at, record_id "
        "FROM build_ritual_cluster "
        "WHERE cadencia = ? AND record_id IS NULL "
        "ORDER BY session_num ASC",
        (cadencia,),
    ).fetchall()


# ─── Mind sessions ───────────────────────────────────────────────────────


@router.get("/api/mind/session", response_model=SessionClusterOut)
def get_mind_session():
    """Cluster ativo de Mind — usado pelo banner e pela página /Dia."""
    with get_conn() as conn:
        return _build_cluster(_fetch_mind_active_rows(conn))


@router.post("/api/mind/session/start", response_model=SessionClusterOut, status_code=201)
def start_mind_session():
    """Inicia nova sessão de Mind. 409 se já existe outra ativa (qualquer
    tipo) no sistema. Idempotente: se já há uma Mind rodando, retorna ela."""
    with get_conn() as conn:
        # Se já tem cluster ativo Mind, devolve sem criar nova row.
        rows = _fetch_mind_active_rows(conn)
        if rows and any(r["ended_at"] is None for r in rows):
            return _build_cluster(rows)
        # Confere conflito com outras sessões globais.
        active = find_active_session(conn, exclude_type="mind")
        if active:
            raise HTTPException(409, detail=active["title"])
        next_num = (
            conn.execute(
                "SELECT COALESCE(MAX(session_num), 0) + 1 AS n FROM mind_session "
                "WHERE record_id IS NULL"
            ).fetchone()["n"]
        )
        now = utcnow_iso_z()
        conn.execute(
            "INSERT INTO mind_session(session_num, started_at) VALUES(?, ?)",
            (next_num, now),
        )
        conn.commit()
        return _build_cluster(_fetch_mind_active_rows(conn))


@router.post("/api/mind/session/pause", response_model=SessionClusterOut)
def pause_mind_session():
    """Pausa sessão ativa (set ended_at na row aberta). Idempotente."""
    with get_conn() as conn:
        open_row = conn.execute(
            "SELECT id FROM mind_session "
            "WHERE record_id IS NULL AND ended_at IS NULL "
            "ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if open_row:
            conn.execute(
                "UPDATE mind_session SET ended_at = ? WHERE id = ?",
                (utcnow_iso_z(), open_row["id"]),
            )
            conn.commit()
        return _build_cluster(_fetch_mind_active_rows(conn))


@router.post("/api/mind/session/resume", response_model=SessionClusterOut, status_code=201)
def resume_mind_session():
    """Retoma — cria nova row no mesmo cluster (record_id IS NULL).
    409 se outra atividade global está rodando."""
    with get_conn() as conn:
        rows = _fetch_mind_active_rows(conn)
        if rows and any(r["ended_at"] is None for r in rows):
            return _build_cluster(rows)
        active = find_active_session(conn, exclude_type="mind")
        if active:
            raise HTTPException(409, detail=active["title"])
        next_num = (
            conn.execute(
                "SELECT COALESCE(MAX(session_num), 0) + 1 AS n FROM mind_session "
                "WHERE record_id IS NULL"
            ).fetchone()["n"]
        )
        now = utcnow_iso_z()
        conn.execute(
            "INSERT INTO mind_session(session_num, started_at) VALUES(?, ?)",
            (next_num, now),
        )
        conn.commit()
        return _build_cluster(_fetch_mind_active_rows(conn))


@router.post("/api/mind/session/discard", status_code=204)
def discard_mind_session():
    """Descarta cluster ativo (apaga rows sem record_id). Usado quando
    user cancela o modal de finalização e desiste."""
    with get_conn() as conn:
        conn.execute("DELETE FROM mind_session WHERE record_id IS NULL")
        conn.commit()


@router.post("/api/mind/session/link-record", status_code=204)
def link_mind_session_to_record(body: dict):
    """Linka todas as rows do cluster ativo ao record_id passado. Chamado
    pelo modal após criar o health_record — fecha o cluster. Body:
    `{record_id: int}`.
    """
    record_id = body.get("record_id")
    if not isinstance(record_id, int):
        raise HTTPException(422, detail="record_id obrigatório (int)")
    with get_conn() as conn:
        # Garante ended_at em rows ainda abertas (defensivo).
        now = utcnow_iso_z()
        conn.execute(
            "UPDATE mind_session SET ended_at = ? "
            "WHERE record_id IS NULL AND ended_at IS NULL",
            (now,),
        )
        conn.execute(
            "UPDATE mind_session SET record_id = ? WHERE record_id IS NULL",
            (record_id,),
        )
        conn.commit()


@router.post(
    "/api/mind/session/reopen",
    response_model=SessionClusterOut,
)
def reopen_mind_session(data: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")):
    """Desfaz a finalização do Mind do dia. Descola as rows do cluster
    (record_id → NULL) MAS mantém o health_record — quando user finaliza
    de novo, o FINALIZE upsert detecta record existente e linka o cluster
    de novo nele (em vez de criar um novo record). Semântica: "outra
    sessão da mesma entrada", não uma entrada nova.
    """
    with get_conn() as conn:
        rec = conn.execute(
            "SELECT id FROM health_record "
            "WHERE domain_slug = 'mind' AND data = ? "
            "ORDER BY id DESC LIMIT 1",
            (data,),
        ).fetchone()
        if not rec:
            # Idempotente: descola orphans (rows com record_id apontando
            # pra record já inexistente) pra forçar has_active=true.
            conn.execute(
                """UPDATE mind_session SET record_id = NULL
                   WHERE record_id IS NOT NULL
                   AND record_id NOT IN (SELECT id FROM health_record)"""
            )
            conn.commit()
            return _build_cluster(_fetch_mind_active_rows(conn))
        record_id = rec["id"]
        conn.execute(
            "UPDATE mind_session SET record_id = NULL WHERE record_id = ?",
            (record_id,),
        )
        conn.commit()
        return _build_cluster(_fetch_mind_active_rows(conn))


# ─── Health item sessions ────────────────────────────────────────────────


@router.get("/api/health/items/{item_id}/session", response_model=SessionClusterOut)
def get_health_item_session(item_id: int):
    with get_conn() as conn:
        return _build_cluster(_fetch_health_item_active_rows(conn, item_id))


@router.post(
    "/api/health/items/{item_id}/session/start",
    response_model=SessionClusterOut,
    status_code=201,
)
def start_health_item_session(item_id: int):
    with get_conn() as conn:
        # Confere se item existe
        if not conn.execute(
            "SELECT 1 FROM health_item WHERE id = ?", (item_id,)
        ).fetchone():
            raise HTTPException(404, detail="Item não encontrado")
        rows = _fetch_health_item_active_rows(conn, item_id)
        if rows and any(r["ended_at"] is None for r in rows):
            return _build_cluster(rows)
        active = find_active_session(
            conn, exclude_type="health_item", exclude_id=str(item_id)
        )
        if active:
            raise HTTPException(409, detail=active["title"])
        next_num = (
            conn.execute(
                "SELECT COALESCE(MAX(session_num), 0) + 1 AS n "
                "FROM health_item_session "
                "WHERE item_id = ? AND record_id IS NULL",
                (item_id,),
            ).fetchone()["n"]
        )
        now = utcnow_iso_z()
        conn.execute(
            "INSERT INTO health_item_session(item_id, session_num, started_at) "
            "VALUES(?, ?, ?)",
            (item_id, next_num, now),
        )
        conn.commit()
        return _build_cluster(_fetch_health_item_active_rows(conn, item_id))


@router.post(
    "/api/health/items/{item_id}/session/pause",
    response_model=SessionClusterOut,
)
def pause_health_item_session(item_id: int):
    with get_conn() as conn:
        open_row = conn.execute(
            "SELECT id FROM health_item_session "
            "WHERE item_id = ? AND record_id IS NULL AND ended_at IS NULL "
            "ORDER BY id DESC LIMIT 1",
            (item_id,),
        ).fetchone()
        if open_row:
            conn.execute(
                "UPDATE health_item_session SET ended_at = ? WHERE id = ?",
                (utcnow_iso_z(), open_row["id"]),
            )
            conn.commit()
        return _build_cluster(_fetch_health_item_active_rows(conn, item_id))


@router.post(
    "/api/health/items/{item_id}/session/resume",
    response_model=SessionClusterOut,
    status_code=201,
)
def resume_health_item_session(item_id: int):
    with get_conn() as conn:
        rows = _fetch_health_item_active_rows(conn, item_id)
        if rows and any(r["ended_at"] is None for r in rows):
            return _build_cluster(rows)
        active = find_active_session(
            conn, exclude_type="health_item", exclude_id=str(item_id)
        )
        if active:
            raise HTTPException(409, detail=active["title"])
        next_num = (
            conn.execute(
                "SELECT COALESCE(MAX(session_num), 0) + 1 AS n "
                "FROM health_item_session "
                "WHERE item_id = ? AND record_id IS NULL",
                (item_id,),
            ).fetchone()["n"]
        )
        now = utcnow_iso_z()
        conn.execute(
            "INSERT INTO health_item_session(item_id, session_num, started_at) "
            "VALUES(?, ?, ?)",
            (item_id, next_num, now),
        )
        conn.commit()
        return _build_cluster(_fetch_health_item_active_rows(conn, item_id))


@router.post(
    "/api/health/items/{item_id}/session/discard",
    status_code=204,
)
def discard_health_item_session(item_id: int):
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM health_item_session "
            "WHERE item_id = ? AND record_id IS NULL",
            (item_id,),
        )
        conn.commit()


@router.post(
    "/api/health/items/{item_id}/session/link-record",
    status_code=204,
)
def link_health_item_session_to_record(item_id: int, body: dict):
    record_id = body.get("record_id")
    if not isinstance(record_id, int):
        raise HTTPException(422, detail="record_id obrigatório (int)")
    with get_conn() as conn:
        now = utcnow_iso_z()
        conn.execute(
            "UPDATE health_item_session SET ended_at = ? "
            "WHERE item_id = ? AND record_id IS NULL AND ended_at IS NULL",
            (now, item_id),
        )
        conn.execute(
            "UPDATE health_item_session SET record_id = ? "
            "WHERE item_id = ? AND record_id IS NULL",
            (record_id, item_id),
        )
        conn.commit()


@router.post(
    "/api/health/items/{item_id}/session/reopen",
    response_model=SessionClusterOut,
)
def reopen_health_item_session(
    item_id: int,
    data: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
):
    """Desfaz a finalização do health item. Descola as rows do cluster
    (record_id → NULL) mas MANTÉM o health_record — quando user finaliza
    de novo, o FINALIZE upsert detecta record existente e linka o cluster
    nele em vez de criar um novo.
    """
    with get_conn() as conn:
        rec = conn.execute(
            "SELECT id FROM health_record "
            "WHERE item_id = ? AND data = ? "
            "ORDER BY id DESC LIMIT 1",
            (item_id, data),
        ).fetchone()
        if not rec:
            conn.execute(
                """UPDATE health_item_session SET record_id = NULL
                   WHERE item_id = ?
                   AND record_id IS NOT NULL
                   AND record_id NOT IN (SELECT id FROM health_record)""",
                (item_id,),
            )
            conn.commit()
            return _build_cluster(_fetch_health_item_active_rows(conn, item_id))
        record_id = rec["id"]
        conn.execute(
            "UPDATE health_item_session SET record_id = NULL "
            "WHERE item_id = ? AND record_id = ?",
            (item_id, record_id),
        )
        conn.commit()
        return _build_cluster(_fetch_health_item_active_rows(conn, item_id))


# ─── Ritual cluster sessions (Build) ─────────────────────────────────────
#
# Espelho de mind/health_item: cluster cronometrado por cadencia. Quando
# user clica PLAY no card do ritual em /Dia, abre uma row aqui. Pause
# fecha, resume cria nova. Finalize cria build_ritual_session e linka
# todas as rows (record_id = build_ritual_session.id TEXT).


@router.get(
    "/api/build/rituals/{cadencia}/cluster",
    response_model=SessionClusterOut,
)
def get_ritual_cluster(cadencia: str):
    with get_conn() as conn:
        return _build_cluster(_fetch_ritual_active_rows(conn, cadencia))


@router.post(
    "/api/build/rituals/{cadencia}/cluster/start",
    response_model=SessionClusterOut,
    status_code=201,
)
def start_ritual_cluster(cadencia: str):
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM build_ritual WHERE cadencia = ?", (cadencia,)
        ).fetchone():
            raise HTTPException(404, detail=f"Ritual '{cadencia}' não encontrado")
        rows = _fetch_ritual_active_rows(conn, cadencia)
        if rows and any(r["ended_at"] is None for r in rows):
            return _build_cluster(rows)
        active = find_active_session(conn, exclude_type="ritual", exclude_id=cadencia)
        if active:
            raise HTTPException(409, detail=active["title"])
        next_num = (
            conn.execute(
                "SELECT COALESCE(MAX(session_num), 0) + 1 AS n "
                "FROM build_ritual_cluster "
                "WHERE cadencia = ? AND record_id IS NULL",
                (cadencia,),
            ).fetchone()["n"]
        )
        now = utcnow_iso_z()
        conn.execute(
            "INSERT INTO build_ritual_cluster(cadencia, session_num, started_at) "
            "VALUES(?, ?, ?)",
            (cadencia, next_num, now),
        )
        conn.commit()
        return _build_cluster(_fetch_ritual_active_rows(conn, cadencia))


@router.post(
    "/api/build/rituals/{cadencia}/cluster/pause",
    response_model=SessionClusterOut,
)
def pause_ritual_cluster(cadencia: str):
    with get_conn() as conn:
        open_row = conn.execute(
            "SELECT id FROM build_ritual_cluster "
            "WHERE cadencia = ? AND record_id IS NULL AND ended_at IS NULL "
            "ORDER BY id DESC LIMIT 1",
            (cadencia,),
        ).fetchone()
        if open_row:
            conn.execute(
                "UPDATE build_ritual_cluster SET ended_at = ? WHERE id = ?",
                (utcnow_iso_z(), open_row["id"]),
            )
            conn.commit()
        return _build_cluster(_fetch_ritual_active_rows(conn, cadencia))


@router.post(
    "/api/build/rituals/{cadencia}/cluster/resume",
    response_model=SessionClusterOut,
    status_code=201,
)
def resume_ritual_cluster(cadencia: str):
    with get_conn() as conn:
        rows = _fetch_ritual_active_rows(conn, cadencia)
        if rows and any(r["ended_at"] is None for r in rows):
            return _build_cluster(rows)
        active = find_active_session(conn, exclude_type="ritual", exclude_id=cadencia)
        if active:
            raise HTTPException(409, detail=active["title"])
        next_num = (
            conn.execute(
                "SELECT COALESCE(MAX(session_num), 0) + 1 AS n "
                "FROM build_ritual_cluster "
                "WHERE cadencia = ? AND record_id IS NULL",
                (cadencia,),
            ).fetchone()["n"]
        )
        now = utcnow_iso_z()
        conn.execute(
            "INSERT INTO build_ritual_cluster(cadencia, session_num, started_at) "
            "VALUES(?, ?, ?)",
            (cadencia, next_num, now),
        )
        conn.commit()
        return _build_cluster(_fetch_ritual_active_rows(conn, cadencia))


@router.post(
    "/api/build/rituals/{cadencia}/cluster/discard",
    status_code=204,
)
def discard_ritual_cluster(cadencia: str):
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM build_ritual_cluster "
            "WHERE cadencia = ? AND record_id IS NULL",
            (cadencia,),
        )
        conn.commit()


@router.post(
    "/api/build/rituals/{cadencia}/cluster/link-record",
    status_code=204,
)
def link_ritual_cluster_to_record(cadencia: str, body: dict):
    """Linka rows ativas ao session_id criado em build_ritual_session.
    Body: `{record_id: str}` (id de build_ritual_session é TEXT)."""
    record_id = body.get("record_id")
    if not isinstance(record_id, str) or not record_id:
        raise HTTPException(422, detail="record_id obrigatório (string)")
    with get_conn() as conn:
        now = utcnow_iso_z()
        conn.execute(
            "UPDATE build_ritual_cluster SET ended_at = ? "
            "WHERE cadencia = ? AND record_id IS NULL AND ended_at IS NULL",
            (now, cadencia),
        )
        conn.execute(
            "UPDATE build_ritual_cluster SET record_id = ? "
            "WHERE cadencia = ? AND record_id IS NULL",
            (record_id, cadencia),
        )
        conn.commit()


@router.post(
    "/api/build/rituals/{cadencia}/cluster/reopen",
    response_model=SessionClusterOut,
)
def reopen_ritual_cluster(
    cadencia: str,
    data: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
):
    """Desfaz finalização de ritual: estado volta pra PLAY limpo (como
    quest reaberto). Apaga build_ritual_session de hoje + apaga rows do
    cluster (unlinked e linkadas à session deletada).

    Antes a gente preservava a session e só descolava o cluster, na ideia
    de "outra sessão da mesma entrada". Mas isso deixava o card preso em
    RESUME/FINALIZE (cluster ativo com rows pausadas) — não voltava pra
    PLAY como o usuário esperava. Proteção contra duplicatas continua
    garantida pelo upsert do create_ritual_session: se user FINALIZAR de
    novo hoje sem ter reaberto antes, o INSERT vira UPDATE.
    """
    with get_conn() as conn:
        # Apaga sessão de hoje (idempotente se não existir)
        conn.execute(
            "DELETE FROM build_ritual_session "
            "WHERE cadencia = ? AND data_executado = ?",
            (cadencia, data),
        )
        # Apaga cluster rows: unlinked (record_id IS NULL = cluster ativo
        # de hoje) + órfãs (record_id apontando pra session inexistente).
        # Resultado: cluster fica vazio → has_active=false → PLAY aparece.
        conn.execute(
            """DELETE FROM build_ritual_cluster
               WHERE cadencia = ?
               AND (record_id IS NULL
                    OR record_id NOT IN (SELECT id FROM build_ritual_session))""",
            (cadencia,),
        )
        conn.commit()
        return _build_cluster(_fetch_ritual_active_rows(conn, cadencia))


# ─── Edição manual de sessão (PATCH) ─────────────────────────────────────
#
# Mesmo padrão de quest_sessions/task_sessions/routine_sessions: edita
# started_at/ended_at de uma row específica. Row em andamento (ended_at=NULL)
# só permite editar started_at. Retorna `overlap_warning` se a nova janela
# sobrepõe outra row do mesmo cluster (mesmo record_id ou ambos NULL).


def _validate_session_edit(existing: dict, fields: dict) -> tuple[str, Optional[str]]:
    """Valida regras de edição e devolve (new_start, new_end). Lança 422."""
    if existing["ended_at"] is None and "ended_at" in fields and fields["ended_at"] is not None:
        raise HTTPException(
            422,
            detail="Sessão em andamento — pause antes de editar o horário de fim.",
        )
    new_start = fields.get("started_at", existing["started_at"])
    new_end = fields.get("ended_at", existing["ended_at"])
    if new_end is not None:
        try:
            if parse_iso(new_end) <= parse_iso(new_start):
                raise HTTPException(422, detail="Horário de fim deve ser depois do início.")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(422, detail="Datas inválidas.")
    return new_start, new_end


@router.patch("/api/mind-sessions/{session_id}")
def edit_mind_session(session_id: int, body: SessionEdit):
    """Edita started_at/ended_at de uma row de mind_session. Mesmo contrato
    de quest/task/routine session edits — `overlap_warning` flag avisa se a
    nova janela invade range de outra row do mesmo cluster."""
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(400, detail="Nada pra atualizar")

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM mind_session WHERE id = ?", (session_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Sessão não encontrada")

        _validate_session_edit(dict(existing), fields)

        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE mind_session SET {set_clause} WHERE id = ?",
            [*fields.values(), session_id],
        )
        conn.commit()

        row = conn.execute(
            "SELECT * FROM mind_session WHERE id = ?", (session_id,)
        ).fetchone()

        # Overlap dentro do mesmo cluster (mesmo record_id, ou ambos NULL
        # pra cluster ativo). Só checa se row tem ended_at — em andamento
        # não tem janela fechada pra comparar.
        overlaps = []
        if row["ended_at"]:
            if row["record_id"] is None:
                overlaps = conn.execute(
                    """SELECT id FROM mind_session
                       WHERE id != ? AND record_id IS NULL
                         AND ended_at IS NOT NULL
                         AND started_at < ? AND ended_at > ?""",
                    (session_id, row["ended_at"], row["started_at"]),
                ).fetchall()
            else:
                overlaps = conn.execute(
                    """SELECT id FROM mind_session
                       WHERE id != ? AND record_id = ?
                         AND ended_at IS NOT NULL
                         AND started_at < ? AND ended_at > ?""",
                    (session_id, row["record_id"], row["ended_at"], row["started_at"]),
                ).fetchall()

    return {**dict(row), "overlap_warning": len(overlaps) > 0}


@router.delete("/api/mind-sessions/{session_id}", status_code=204)
def delete_mind_session_row(session_id: int):
    """Deleta uma row específica de mind_session. Usado pra remover entrada
    incorreta em sessões já finalizadas. Cluster ativo deve usar /discard."""
    with get_conn() as conn:
        res = conn.execute("DELETE FROM mind_session WHERE id = ?", (session_id,))
        if res.rowcount == 0:
            raise HTTPException(404, detail="Sessão não encontrada")
        conn.commit()


@router.patch("/api/health-item-sessions/{session_id}")
def edit_health_item_session(session_id: int, body: SessionEdit):
    """Edita started_at/ended_at de uma row de health_item_session. Overlap
    check dentro do mesmo cluster (mesmo item_id + mesmo record_id)."""
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(400, detail="Nada pra atualizar")

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM health_item_session WHERE id = ?", (session_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Sessão não encontrada")

        _validate_session_edit(dict(existing), fields)

        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE health_item_session SET {set_clause} WHERE id = ?",
            [*fields.values(), session_id],
        )
        conn.commit()

        row = conn.execute(
            "SELECT * FROM health_item_session WHERE id = ?", (session_id,)
        ).fetchone()

        overlaps = []
        if row["ended_at"]:
            if row["record_id"] is None:
                overlaps = conn.execute(
                    """SELECT id FROM health_item_session
                       WHERE id != ? AND item_id = ? AND record_id IS NULL
                         AND ended_at IS NOT NULL
                         AND started_at < ? AND ended_at > ?""",
                    (session_id, row["item_id"], row["ended_at"], row["started_at"]),
                ).fetchall()
            else:
                overlaps = conn.execute(
                    """SELECT id FROM health_item_session
                       WHERE id != ? AND item_id = ? AND record_id = ?
                         AND ended_at IS NOT NULL
                         AND started_at < ? AND ended_at > ?""",
                    (
                        session_id,
                        row["item_id"],
                        row["record_id"],
                        row["ended_at"],
                        row["started_at"],
                    ),
                ).fetchall()

    return {**dict(row), "overlap_warning": len(overlaps) > 0}


@router.delete("/api/health-item-sessions/{session_id}", status_code=204)
def delete_health_item_session_row(session_id: int):
    """Deleta uma row específica de health_item_session. Cluster ativo deve
    usar /discard pra apagar todas de uma vez."""
    with get_conn() as conn:
        res = conn.execute("DELETE FROM health_item_session WHERE id = ?", (session_id,))
        if res.rowcount == 0:
            raise HTTPException(404, detail="Sessão não encontrada")
        conn.commit()


@router.patch("/api/ritual-cluster-sessions/{session_id}")
def edit_ritual_cluster_session(session_id: int, body: SessionEdit):
    """Edita started_at/ended_at de uma row do cluster de ritual."""
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(400, detail="Nada pra atualizar")

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM build_ritual_cluster WHERE id = ?", (session_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Sessão não encontrada")

        _validate_session_edit(dict(existing), fields)

        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE build_ritual_cluster SET {set_clause} WHERE id = ?",
            [*fields.values(), session_id],
        )
        conn.commit()

        row = conn.execute(
            "SELECT * FROM build_ritual_cluster WHERE id = ?", (session_id,)
        ).fetchone()

        overlaps = []
        if row["ended_at"]:
            if row["record_id"] is None:
                overlaps = conn.execute(
                    """SELECT id FROM build_ritual_cluster
                       WHERE id != ? AND cadencia = ? AND record_id IS NULL
                         AND ended_at IS NOT NULL
                         AND started_at < ? AND ended_at > ?""",
                    (session_id, row["cadencia"], row["ended_at"], row["started_at"]),
                ).fetchall()
            else:
                overlaps = conn.execute(
                    """SELECT id FROM build_ritual_cluster
                       WHERE id != ? AND cadencia = ? AND record_id = ?
                         AND ended_at IS NOT NULL
                         AND started_at < ? AND ended_at > ?""",
                    (
                        session_id,
                        row["cadencia"],
                        row["record_id"],
                        row["ended_at"],
                        row["started_at"],
                    ),
                ).fetchall()

    return {**dict(row), "overlap_warning": len(overlaps) > 0}


@router.delete("/api/ritual-cluster-sessions/{session_id}", status_code=204)
def delete_ritual_cluster_row(session_id: int):
    with get_conn() as conn:
        res = conn.execute("DELETE FROM build_ritual_cluster WHERE id = ?", (session_id,))
        if res.rowcount == 0:
            raise HTTPException(404, detail="Sessão não encontrada")
        conn.commit()


# ─── Range queries pro calendário ────────────────────────────────────────
#
# Usado pela CalendarPage pra renderizar sessões EXECUTADAS (não só
# pendências planejadas) no timeline horário, paridade com quest/task/
# routine sessions. Retorna todas as rows independentemente do record_id
# (cluster fechado ou ativo), filtrado por started_at no range.


class MindSessionRangeOut(BaseModel):
    id: int
    session_num: int
    started_at: str
    ended_at: Optional[str] = None
    record_id: Optional[int] = None


class HealthItemSessionRangeOut(BaseModel):
    id: int
    item_id: int
    item_nome: str
    item_cor: Optional[str] = None
    domain_slug: Optional[str] = None
    session_num: int
    started_at: str
    ended_at: Optional[str] = None
    record_id: Optional[int] = None


@router.get("/api/mind-sessions", response_model=list[MindSessionRangeOut])
def list_mind_sessions_range(
    from_: str = Query("", alias="from"),
    to: str = "",
):
    """Lista rows de mind_session com started_at em [from, to]. Aceita
    YYYY-MM-DD; backend compara prefix de string ISO (UTC). Sem range:
    retorna últimas 200 rows.
    """
    with get_conn() as conn:
        if from_ and to:
            rows = conn.execute(
                """SELECT id, session_num, started_at, ended_at, record_id
                   FROM mind_session
                   WHERE substr(started_at, 1, 10) >= ?
                     AND substr(started_at, 1, 10) <= ?
                   ORDER BY started_at ASC""",
                (from_, to),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT id, session_num, started_at, ended_at, record_id
                   FROM mind_session
                   ORDER BY started_at DESC LIMIT 200"""
            ).fetchall()
    return [dict(r) for r in rows]


class RitualClusterRangeOut(BaseModel):
    id: int
    cadencia: str
    session_num: int
    started_at: str
    ended_at: Optional[str] = None
    record_id: Optional[str] = None


@router.get("/api/ritual-cluster-sessions", response_model=list[RitualClusterRangeOut])
def list_ritual_cluster_range(
    from_: str = Query("", alias="from"),
    to: str = "",
):
    """Lista rows de build_ritual_cluster com started_at em [from, to].
    Usado pelo /calendario pra renderizar rituais executados como blocos.

    Filtra órfãs (record_id apontando pra session inexistente) — sem isso o
    calendário renderiza blocos vermelhos pra rituais que o usuário não
    reconhece como execuções reais. Mostra:
      - rows linkadas a session real (record_id IN sessions)
      - rows ativas/pausadas (record_id IS NULL) — execução em andamento
    """
    with get_conn() as conn:
        if from_ and to:
            rows = conn.execute(
                """SELECT id, cadencia, session_num, started_at, ended_at, record_id
                   FROM build_ritual_cluster
                   WHERE substr(started_at, 1, 10) >= ?
                     AND substr(started_at, 1, 10) <= ?
                     AND (record_id IS NULL
                          OR record_id IN (SELECT id FROM build_ritual_session))
                   ORDER BY started_at ASC""",
                (from_, to),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT id, cadencia, session_num, started_at, ended_at, record_id
                   FROM build_ritual_cluster
                   WHERE (record_id IS NULL
                          OR record_id IN (SELECT id FROM build_ritual_session))
                   ORDER BY started_at DESC LIMIT 200"""
            ).fetchall()
    return [dict(r) for r in rows]


@router.get("/api/health-item-sessions", response_model=list[HealthItemSessionRangeOut])
def list_health_item_sessions_range(
    from_: str = Query("", alias="from"),
    to: str = "",
):
    """Lista rows de health_item_session com started_at em [from, to].
    Inclui meta do item (nome/cor/domain_slug) pra renderização no
    timeline sem fetch extra."""
    with get_conn() as conn:
        if from_ and to:
            rows = conn.execute(
                """SELECT hs.id, hs.item_id, hi.nome AS item_nome,
                          hi.cor AS item_cor, hi.domain_slug,
                          hs.session_num, hs.started_at, hs.ended_at, hs.record_id
                   FROM health_item_session hs
                   JOIN health_item hi ON hs.item_id = hi.id
                   WHERE substr(hs.started_at, 1, 10) >= ?
                     AND substr(hs.started_at, 1, 10) <= ?
                   ORDER BY hs.started_at ASC""",
                (from_, to),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT hs.id, hs.item_id, hi.nome AS item_nome,
                          hi.cor AS item_cor, hi.domain_slug,
                          hs.session_num, hs.started_at, hs.ended_at, hs.record_id
                   FROM health_item_session hs
                   JOIN health_item hi ON hs.item_id = hi.id
                   ORDER BY hs.started_at DESC LIMIT 200"""
            ).fetchall()
    return [dict(r) for r in rows]
