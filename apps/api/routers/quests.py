import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import get_conn
from models.quest import QuestCreate, QuestOut, QuestUpdate
from models.session import SessionOut
from services.active_session import find_active_session
from services.utils import parse_iso, utcnow_iso_z


class SessionEdit(BaseModel):
    """Body pra edição manual de uma sessão (PATCH).
    `started_at` e `ended_at` são ISO strings; `ended_at=None` pra sessão
    em andamento. Validação `end > start` acontece no router."""
    started_at: Optional[str] = None
    ended_at: Optional[str] = None

router = APIRouter()


# ─── Quests CRUD ─────────────────────────────────────────────────────────────

@router.get("/api/quests", response_model=list[QuestOut])
def list_quests(
    area: Optional[str] = None,
    status: Optional[str] = None,
    project_id: Optional[str] = None,
    deliverable_id: Optional[str] = None,
):
    """Lista quests (work items). Filtros por área, status, projeto e entregável.

    Quando NÃO há `project_id` no filtro, exclui quests de projetos arquivados
    (archived_at IS NOT NULL). Quando há project_id explícito, retorna as
    quests do projeto mesmo se ele estiver arquivado — o painel do projeto
    continua visualizando tudo quando o usuário abre a gaveta.
    """
    with get_conn() as conn:
        sql = """SELECT q.id, q.project_id, q.title, q.area_slug, q.status, q.priority, q.deadline,
                        q.estimated_minutes, q.next_action, q.description, q.deliverable_id,
                        q.completed_at, q.sort_order
                 FROM quests q"""
        # JOIN só é necessário quando vamos filtrar por archived_at do projeto.
        if not project_id:
            sql += " JOIN projects p ON p.id = q.project_id"
        sql += " WHERE 1=1"
        params: list = []
        if not project_id:
            sql += " AND p.archived_at IS NULL"
        if area:
            sql += " AND q.area_slug = ?"
            params.append(area)
        if status:
            sql += " AND q.status = ?"
            params.append(status)
        if project_id:
            sql += " AND q.project_id = ?"
            params.append(project_id)
        if deliverable_id:
            sql += " AND q.deliverable_id = ?"
            params.append(deliverable_id)

        if project_id or deliverable_id:
            sql += " ORDER BY q.sort_order ASC"
        else:
            sql += (
                " ORDER BY CASE q.priority"
                " WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,"
                " q.deadline ASC NULLS LAST"
            )
        rows = conn.execute(sql, params).fetchall()

        sessions = conn.execute(
            "SELECT quest_id, started_at, ended_at FROM quest_sessions WHERE ended_at IS NOT NULL"
        ).fetchall()
        worked_sec: dict[str, int] = {}
        for s in sessions:
            try:
                st = parse_iso(s["started_at"]).timestamp()
                en = parse_iso(s["ended_at"]).timestamp()
                if en > st:
                    worked_sec[s["quest_id"]] = worked_sec.get(s["quest_id"], 0) + int(en - st)
            except Exception:
                continue

    result = []
    for r in rows:
        d = dict(r)
        d["worked_minutes"] = worked_sec.get(d["id"], 0) // 60
        result.append(d)
    return result


@router.post("/api/quests", response_model=QuestOut, status_code=201)
def create_quest(body: QuestCreate):
    """project_id e deliverable_id obrigatórios. Valida que pertencem ao mesmo projeto."""
    quest_id = str(uuid.uuid4())[:8]
    now = utcnow_iso_z()
    with get_conn() as conn:
        project = conn.execute(
            "SELECT id FROM projects WHERE id = ?", (body.project_id,)
        ).fetchone()
        if not project:
            raise HTTPException(422, detail=f"Project '{body.project_id}' not found")
        deliv = conn.execute(
            "SELECT project_id FROM deliverables WHERE id = ?",
            (body.deliverable_id,),
        ).fetchone()
        if not deliv:
            raise HTTPException(422, detail=f"Deliverable '{body.deliverable_id}' not found")
        if deliv["project_id"] != body.project_id:
            raise HTTPException(422, detail="O entregável escolhido não pertence a esse projeto.")
        # Quest não recebe mais `deadline` — herda do entregável/projeto.
        # A coluna fica NULL no INSERT.
        conn.execute(
            """INSERT INTO quests
               (id, project_id, title, area_slug, status, priority,
                estimated_minutes, next_action, description, deliverable_id,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (quest_id, body.project_id, body.title, body.area_slug, body.status,
             body.priority, body.estimated_minutes,
             body.next_action, body.description, body.deliverable_id, now, now),
        )
        conn.commit()
        row = conn.execute(
            """SELECT id, project_id, title, area_slug, status, priority, deadline,
                      estimated_minutes, next_action, description, deliverable_id,
                      completed_at, sort_order
               FROM quests WHERE id = ?""",
            (quest_id,),
        ).fetchone()
    d = dict(row)
    d["worked_minutes"] = 0
    return d


@router.patch("/api/quests/{quest_id}", response_model=QuestOut)
def update_quest(quest_id: str, body: QuestUpdate):
    """Atualiza quest. Não expõe campos de projeto (esses vão em /api/projects)."""
    fields: dict = {}
    for field_name in body.model_fields_set:
        fields[field_name] = getattr(body, field_name)
    if not fields:
        raise HTTPException(400, detail="Nothing to update")
    fields["updated_at"] = utcnow_iso_z()
    with get_conn() as conn:
        if "deliverable_id" in fields and fields["deliverable_id"] is None:
            raise HTTPException(422, detail="Quest precisa estar amarrada a um entregável.")
        if "deliverable_id" in fields and fields["deliverable_id"]:
            current = conn.execute(
                "SELECT project_id FROM quests WHERE id = ?", (quest_id,)
            ).fetchone()
            if current:
                deliv = conn.execute(
                    "SELECT project_id FROM deliverables WHERE id = ?",
                    (fields["deliverable_id"],),
                ).fetchone()
                if not deliv or deliv["project_id"] != current["project_id"]:
                    raise HTTPException(
                        422, detail="O entregável escolhido não pertence a esse projeto.",
                    )

        TERMINAL = ("done", "cancelled")
        if "status" in fields:
            current = conn.execute("SELECT status FROM quests WHERE id = ?", (quest_id,)).fetchone()
            prev_status = current["status"] if current else None
            new_status = fields["status"]
            if new_status in TERMINAL and prev_status not in TERMINAL:
                # Fecha qualquer sessão aberta da quest — caso o user marque
                # done direto via checkbox/dropdown sem pausar antes. Senão
                # a sessão fica pendurada e o banner de "ativa" pisca, além
                # de bloquear novas sessões com 409 (conflito de ativa).
                conn.execute(
                    "UPDATE quest_sessions SET ended_at = ? WHERE quest_id = ? AND ended_at IS NULL",
                    (utcnow_iso_z(), quest_id),
                )
                fields["completed_at"] = utcnow_iso_z()
                # NOTA: NÃO sobrescrevemos `estimated_minutes` com o tempo
                # real ao virar done. Isso era destrutivo no caso de reabrir
                # a quest depois — o estimated original ficava perdido e o
                # planner do Dia passava a "consumir" o tempo já trabalhado
                # de novo (ex: quest com estimativa de 1h vinha pro plano
                # cobrando 7h depois de 7h de sessões).
                # `worked_minutes` (já populado em todas as responses via
                # soma de quest_sessions) é a fonte de verdade pro tempo
                # gasto. `estimated_minutes` fica imutável — só user-set.
            elif new_status not in TERMINAL and prev_status in TERMINAL:
                fields["completed_at"] = None

        # Pega deliverable_id "antes" pra detectar mudança de pai (que pode
        # destrancar/destrancar dois deliverables na mesma operação).
        prev_deliv_row = conn.execute(
            "SELECT deliverable_id FROM quests WHERE id = ?", (quest_id,)
        ).fetchone()
        prev_deliv_id = prev_deliv_row["deliverable_id"] if prev_deliv_row else None

        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE quests SET {set_clause} WHERE id = ?",
            [*fields.values(), quest_id],
        )

        # Auto-sync do `done` do entregável: se todas as quests do entregável
        # estão fechadas (done ou cancelled) e há pelo menos uma, marca como
        # done. Se alguma volta pra ativa, desmarca. Se a quest mudou de
        # entregável, refaz o check pros DOIS (origem e destino).
        affected_delivs: set[str] = set()
        new_deliv_id = fields.get("deliverable_id", prev_deliv_id)
        if prev_deliv_id:
            affected_delivs.add(prev_deliv_id)
        if new_deliv_id:
            affected_delivs.add(new_deliv_id)
        for did in affected_delivs:
            counts = conn.execute(
                """SELECT COUNT(*) AS total,
                          SUM(CASE WHEN status IN ('done','cancelled') THEN 1 ELSE 0 END) AS closed
                   FROM quests WHERE deliverable_id = ?""",
                (did,),
            ).fetchone()
            total = counts["total"] or 0
            closed = counts["closed"] or 0
            should_be_done = 1 if (total > 0 and closed == total) else 0
            conn.execute(
                "UPDATE deliverables SET done = ? WHERE id = ?",
                (should_be_done, did),
            )

        conn.commit()

        row = conn.execute(
            """SELECT id, project_id, title, area_slug, status, priority, deadline,
                      estimated_minutes, next_action, description, deliverable_id,
                      completed_at, sort_order
               FROM quests WHERE id = ?""",
            (quest_id,),
        ).fetchone()
    if not row:
        raise HTTPException(404)
    d = dict(row)
    with get_conn() as conn2:
        sessions = conn2.execute(
            "SELECT started_at, ended_at FROM quest_sessions WHERE quest_id = ? AND ended_at IS NOT NULL",
            (quest_id,),
        ).fetchall()
    total_sec = 0
    for s in sessions:
        try:
            st = parse_iso(s["started_at"]).timestamp()
            en = parse_iso(s["ended_at"]).timestamp()
            if en > st:
                total_sec += int(en - st)
        except Exception:
            continue
    d["worked_minutes"] = total_sec // 60
    return d


@router.delete("/api/quests/{quest_id}", status_code=204)
def delete_quest(quest_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM quests WHERE id = ?", (quest_id,))
        conn.commit()
    return None


@router.post("/api/quests/reorder")
def reorder_quests(body: dict):
    """Reorder por sort_order."""
    quest_ids = body.get("quest_ids", [])
    if not quest_ids:
        raise HTTPException(400, detail="quest_ids required")
    with get_conn() as conn:
        for index, quest_id in enumerate(quest_ids):
            conn.execute(
                "UPDATE quests SET sort_order = ? WHERE id = ?",
                (index, quest_id),
            )
        conn.commit()
    return {"status": "reordered"}


# ─── Quest Sessions ──────────────────────────────────────────────────────────

@router.get("/api/quests/{quest_id}/sessions", response_model=list[SessionOut])
def list_sessions(quest_id: str):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM quest_sessions WHERE quest_id = ? ORDER BY session_num ASC",
            (quest_id,),
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/api/quests/{quest_id}/sessions/start", response_model=SessionOut, status_code=201)
def start_session(quest_id: str):
    """Idempotente: se já existe sessão aberta desta quest, devolve ela em
    vez de criar duplicada. Evita rows órfãs em race de double-click."""
    now = utcnow_iso_z()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM quest_sessions WHERE quest_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
            (quest_id,),
        ).fetchone()
        if existing:
            return dict(existing)
        active = find_active_session(conn, exclude_type="quest", exclude_id=quest_id)
        if active:
            raise HTTPException(409, detail=active["title"])
        last = conn.execute(
            "SELECT MAX(session_num) as num FROM quest_sessions WHERE quest_id = ?",
            (quest_id,),
        ).fetchone()
        session_num = (last["num"] or 0) + 1
        conn.execute(
            "INSERT INTO quest_sessions(quest_id, session_num, started_at) VALUES(?,?,?)",
            (quest_id, session_num, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM quest_sessions WHERE quest_id = ? AND session_num = ?",
            (quest_id, session_num),
        ).fetchone()
    return dict(row)


@router.post("/api/quests/{quest_id}/sessions/pause", response_model=SessionOut)
def pause_session(quest_id: str):
    """Pausa a sessão aberta da quest. Idempotente: se não há ativa,
    retorna a última sessão (200) em vez de 404 — banner pode estar
    com state ligeiramente stale e tentar pausar duas vezes."""
    now = utcnow_iso_z()
    with get_conn() as conn:
        session = conn.execute(
            "SELECT * FROM quest_sessions WHERE quest_id = ? AND ended_at IS NULL ORDER BY session_num DESC LIMIT 1",
            (quest_id,),
        ).fetchone()
        if session:
            conn.execute(
                "UPDATE quest_sessions SET ended_at = ? WHERE id = ?",
                (now, session["id"]),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM quest_sessions WHERE id = ?", (session["id"],)
            ).fetchone()
            return dict(row)
        last = conn.execute(
            "SELECT * FROM quest_sessions WHERE quest_id = ? ORDER BY session_num DESC LIMIT 1",
            (quest_id,),
        ).fetchone()
        if last:
            return dict(last)
        raise HTTPException(404, detail="Quest has no sessions")


@router.post("/api/quests/{quest_id}/sessions/resume", response_model=SessionOut, status_code=201)
def resume_session(quest_id: str):
    """Idempotente: double-click no resume não cria 2 sub-sessões."""
    now = utcnow_iso_z()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM quest_sessions WHERE quest_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
            (quest_id,),
        ).fetchone()
        if existing:
            return dict(existing)
        active = find_active_session(conn, exclude_type="quest", exclude_id=quest_id)
        if active:
            raise HTTPException(409, detail=active["title"])
        last = conn.execute(
            "SELECT MAX(session_num) as num FROM quest_sessions WHERE quest_id = ?",
            (quest_id,),
        ).fetchone()
        session_num = (last["num"] or 0) + 1
        conn.execute(
            "INSERT INTO quest_sessions(quest_id, session_num, started_at) VALUES(?,?,?)",
            (quest_id, session_num, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM quest_sessions WHERE quest_id = ? AND session_num = ?",
            (quest_id, session_num),
        ).fetchone()
    return dict(row)


# ─── Edição manual de sessão (correção retroativa) ─────────────────────────

@router.patch("/api/quest-sessions/{session_id}")
def edit_quest_session(session_id: int, body: SessionEdit):
    """Edita started_at/ended_at de uma sessão. Devolve a sessão atualizada
    + flag `overlap_warning` (true se sobrepõe outra sessão da mesma quest).
    Validação: ended_at, se passado, deve ser > started_at."""
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(400, detail="Nada pra atualizar")

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM quest_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Sessão não encontrada")

        # Sessão ativa (ended_at=NULL): só edita started_at — pra mexer no
        # fim, frontend precisa pausar antes (regra de UX).
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

        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE quest_sessions SET {set_clause} WHERE id = ?",
            [*fields.values(), session_id],
        )
        conn.commit()

        row = conn.execute(
            "SELECT * FROM quest_sessions WHERE id = ?", (session_id,)
        ).fetchone()

        overlaps = []
        if row["ended_at"]:
            overlaps = conn.execute(
                """SELECT id FROM quest_sessions
                   WHERE quest_id = ? AND id != ?
                     AND ended_at IS NOT NULL
                     AND started_at < ?
                     AND ended_at > ?""",
                (existing["quest_id"], session_id, row["ended_at"], row["started_at"]),
            ).fetchall()

    return {**dict(row), "overlap_warning": len(overlaps) > 0}


@router.delete("/api/quest-sessions/{session_id}", status_code=204)
def delete_quest_session(session_id: int):
    with get_conn() as conn:
        res = conn.execute("DELETE FROM quest_sessions WHERE id = ?", (session_id,))
        if res.rowcount == 0:
            raise HTTPException(404, detail="Sessão não encontrada")
        conn.commit()
    return None
