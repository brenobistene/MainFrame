"""Endpoints do módulo Library — v0.

Doc completa: docs/library/PLAN.md.

Cobre:
- CRUD de items (com transição de status validada — done exige tese_central +
  o_que_ficou; abandoned exige abandoned_reason).
- CRUD de tags livres.
- Sessões cronometradas (mesmo padrão de quest_sessions, com regra global
  "uma ativa por vez" reforçada via services.active_session).
- Cross-links polimórficos (Mind hipótese, Quest, Build princípio/meta).
- Painéis agregados: temas (por tag), pending (revisitas próximas).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from db import get_conn
from models.library import (
    LibraryBacklinkOut,
    LibraryItemCreate,
    LibraryItemListOut,
    LibraryItemOut,
    LibraryItemUpdate,
    LibraryLinkCreate,
    LibraryLinkOut,
    LibraryPendingOut,
    LibrarySagaCreate,
    LibrarySagaOut,
    LibrarySagaReorder,
    LibrarySagaUpdate,
    LibrarySessionOut,
    LibraryTagCreate,
    LibraryTagOut,
    LibraryTagUpdate,
    LibraryTemaOut,
)
from services.active_session import find_active_session
from services.utils import utcnow_iso_z

router = APIRouter(prefix="/api/library", tags=["library"])


# ─── Helpers ──────────────────────────────────────────────────────────────


def _row_to_item(row, tags: list[dict], links: list[dict], minutos_total: int) -> dict:
    """Monta o dict de LibraryItemOut a partir de uma row + listas associadas."""
    # `saga_id`/`saga_ordem` podem estar ausentes em DBs muito antigos antes
    # da migração — `.keys()` checa pra evitar KeyError em sqlite Row.
    keys = set(row.keys())
    return {
        "id": row["id"],
        "tipo": row["tipo"],
        "titulo": row["titulo"],
        "autor": row["autor"],
        "ano": row["ano"],
        "status": row["status"],
        "data_inicio": row["data_inicio"],
        "data_fim": row["data_fim"],
        "tese_central": row["tese_central"],
        "o_que_ficou": row["o_que_ficou"],
        "abandoned_reason": row["abandoned_reason"],
        "origem": row["origem"],
        "revisitar_em": row["revisitar_em"],
        "notes_json": row["notes_json"],
        "sort_order": row["sort_order"],
        "saga_id": row["saga_id"] if "saga_id" in keys else None,
        "saga_ordem": row["saga_ordem"] if "saga_ordem" in keys else 0,
        "tags": tags,
        "links": links,
        "minutos_total": minutos_total,
        "criado_em": row["criado_em"],
        "atualizado_em": row["atualizado_em"],
    }


def _next_saga_ordem(conn, saga_id: int) -> int:
    """Próxima posição livre dentro de uma saga (max+1, ou 1 se vazia)."""
    row = conn.execute(
        "SELECT COALESCE(MAX(saga_ordem), 0) + 1 AS next FROM library_item "
        "WHERE saga_id = ?",
        (saga_id,),
    ).fetchone()
    return row["next"]


def _fetch_tags_for(conn, item_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT t.id, t.slug, t.nome, t.cor
           FROM library_tag t
           JOIN library_item_tag it ON it.tag_id = t.id
           WHERE it.item_id = ? AND t.arquivado = 0
           ORDER BY t.ordem, t.nome""",
        (item_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _fetch_links_for(conn, item_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT id, target_type, target_id, nota, criado_em
           FROM library_link
           WHERE item_id = ?
           ORDER BY criado_em ASC""",
        (item_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _fetch_minutos_total(conn, item_id: int) -> int:
    """Soma minutos de sessões fechadas. Sessão em aberto não conta."""
    rows = conn.execute(
        """SELECT started_at, ended_at
           FROM library_session
           WHERE item_id = ? AND ended_at IS NOT NULL""",
        (item_id,),
    ).fetchall()
    total_seconds = 0
    for r in rows:
        try:
            s = datetime.fromisoformat(r["started_at"].replace("Z", "+00:00"))
            e = datetime.fromisoformat(r["ended_at"].replace("Z", "+00:00"))
            total_seconds += int((e - s).total_seconds())
        except (ValueError, AttributeError):
            continue
    return total_seconds // 60


def _validate_status_transition(
    current: str,
    new: str,
    *,
    tese_central: Optional[str],
    o_que_ficou: Optional[str],
    abandoned_reason: Optional[str],
) -> None:
    """Valida regras de transição. Levanta HTTPException(422) se inválido.

    Regras (PLAN §5):
      queue       → doing/abandoned
      doing       → done (exige tese_central+o_que_ficou) / abandoned
      done        → doing (revisita ativa)
      abandoned   → doing
    """
    if current == new:
        return
    allowed = {
        "queue": {"doing", "abandoned"},
        "doing": {"done", "abandoned", "queue"},  # queue só pra "voltei atrás antes de começar de verdade"
        "done": {"doing"},
        "abandoned": {"doing"},
    }
    if new not in allowed.get(current, set()):
        raise HTTPException(
            422,
            detail=f"Transição inválida: {current} → {new}",
        )
    if new == "done":
        if not (tese_central and tese_central.strip()):
            raise HTTPException(
                422, detail="Para fechar (done), preencha 'tese central'."
            )
        if not (o_que_ficou and o_que_ficou.strip()):
            raise HTTPException(
                422, detail="Para fechar (done), preencha 'o que ficou'."
            )
    if new == "abandoned":
        if not (abandoned_reason and abandoned_reason.strip()):
            raise HTTPException(
                422,
                detail="Para abandonar, preencha o motivo (abandoned_reason).",
            )


def _today_iso() -> str:
    return date.today().isoformat()


# ─── Tags ─────────────────────────────────────────────────────────────────


@router.get("/tags", response_model=list[LibraryTagOut])
def list_tags(include_archived: bool = False):
    sql = "SELECT id, slug, nome, cor, arquivado, ordem, criado_em FROM library_tag"
    if not include_archived:
        sql += " WHERE arquivado = 0"
    sql += " ORDER BY ordem, nome"
    with get_conn() as conn:
        rows = conn.execute(sql).fetchall()
    return [dict(r) for r in rows]


@router.post("/tags", response_model=LibraryTagOut, status_code=201)
def create_tag(body: LibraryTagCreate):
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM library_tag WHERE slug = ?", (body.slug,)
        ).fetchone()
        if existing:
            raise HTTPException(409, detail=f"Slug '{body.slug}' já existe")
        ordem = body.ordem
        if ordem is None:
            row = conn.execute(
                "SELECT COALESCE(MAX(ordem), 0) + 1 AS next FROM library_tag"
            ).fetchone()
            ordem = row["next"]
        conn.execute(
            "INSERT INTO library_tag(slug, nome, cor, ordem) VALUES(?,?,?,?)",
            (body.slug, body.nome, body.cor, ordem),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, slug, nome, cor, arquivado, ordem, criado_em "
            "FROM library_tag WHERE slug = ?",
            (body.slug,),
        ).fetchone()
    return dict(row)


@router.patch("/tags/{tag_id}", response_model=LibraryTagOut)
def update_tag(tag_id: int, body: LibraryTagUpdate):
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(400, detail="Nada pra atualizar")
    if "arquivado" in fields:
        fields["arquivado"] = 1 if fields["arquivado"] else 0
    sets = ", ".join(f"{k} = ?" for k in fields.keys())
    params = list(fields.values()) + [tag_id]
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM library_tag WHERE id = ?", (tag_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Tag não encontrada")
        conn.execute(f"UPDATE library_tag SET {sets} WHERE id = ?", params)
        conn.commit()
        row = conn.execute(
            "SELECT id, slug, nome, cor, arquivado, ordem, criado_em "
            "FROM library_tag WHERE id = ?",
            (tag_id,),
        ).fetchone()
    return dict(row)


@router.delete("/tags/{tag_id}", status_code=204)
def delete_tag(tag_id: int):
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM library_tag WHERE id = ?", (tag_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Tag não encontrada")
        in_use = conn.execute(
            "SELECT COUNT(*) AS n FROM library_item_tag WHERE tag_id = ?",
            (tag_id,),
        ).fetchone()
        if in_use["n"] > 0:
            raise HTTPException(
                409,
                detail=f"Tag em uso por {in_use['n']} item(s). Arquive em vez de deletar.",
            )
        conn.execute("DELETE FROM library_tag WHERE id = ?", (tag_id,))
        conn.commit()


# ─── Items ────────────────────────────────────────────────────────────────


@router.get("/items", response_model=list[LibraryItemListOut])
def list_items(
    status: Optional[str] = None,
    tipo: Optional[str] = None,
    tag_slug: Optional[str] = None,
    q: Optional[str] = Query(None, description="Busca textual em título/autor/tese_central"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    sql = (
        "SELECT i.id, i.tipo, i.titulo, i.autor, i.ano, i.status, i.data_inicio, "
        "i.data_fim, i.revisitar_em, i.origem, i.sort_order, "
        "i.saga_id, i.saga_ordem, "
        "i.criado_em, i.atualizado_em "
        "FROM library_item i"
    )
    params: list = []
    joins: list[str] = []
    wheres: list[str] = []
    if tag_slug:
        joins.append(
            "JOIN library_item_tag it ON it.item_id = i.id "
            "JOIN library_tag t ON t.id = it.tag_id"
        )
        wheres.append("t.slug = ?")
        params.append(tag_slug)
    if status:
        wheres.append("i.status = ?")
        params.append(status)
    if tipo:
        wheres.append("i.tipo = ?")
        params.append(tipo)
    if q:
        wheres.append(
            "(LOWER(i.titulo) LIKE ? OR LOWER(IFNULL(i.autor, '')) LIKE ? "
            "OR LOWER(IFNULL(i.tese_central, '')) LIKE ? "
            "OR LOWER(IFNULL(i.o_que_ficou, '')) LIKE ?)"
        )
        like = f"%{q.lower()}%"
        params.extend([like, like, like, like])
    if joins:
        sql += " " + " ".join(joins)
    if wheres:
        sql += " WHERE " + " AND ".join(wheres)
    sql += " ORDER BY i.sort_order, i.atualizado_em DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        out: list[dict] = []
        for r in rows:
            d = dict(r)
            d["tags"] = _fetch_tags_for(conn, d["id"])
            d["minutos_total"] = _fetch_minutos_total(conn, d["id"])
            out.append(d)
    return out


@router.get("/items/{item_id}", response_model=LibraryItemOut)
def get_item(item_id: int):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM library_item WHERE id = ?", (item_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="Item não encontrado")
        tags = _fetch_tags_for(conn, item_id)
        links = _fetch_links_for(conn, item_id)
        minutos = _fetch_minutos_total(conn, item_id)
    return _row_to_item(row, tags, links, minutos)


@router.post("/items", response_model=LibraryItemOut, status_code=201)
def create_item(body: LibraryItemCreate):
    now = utcnow_iso_z()
    with get_conn() as conn:
        next_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM library_item"
        ).fetchone()["next"]
        # Se vincula a uma saga, pega próxima saga_ordem livre. Senão 0.
        saga_ordem = (
            _next_saga_ordem(conn, body.saga_id) if body.saga_id else 0
        )
        cur = conn.execute(
            "INSERT INTO library_item(tipo, titulo, autor, ano, origem, sort_order, "
            "saga_id, saga_ordem, criado_em, atualizado_em) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                body.tipo,
                body.titulo,
                body.autor,
                body.ano,
                body.origem,
                next_order,
                body.saga_id,
                saga_ordem,
                now,
                now,
            ),
        )
        item_id = cur.lastrowid
        for tag_id in body.tag_ids:
            try:
                conn.execute(
                    "INSERT INTO library_item_tag(item_id, tag_id) VALUES(?,?)",
                    (item_id, tag_id),
                )
            except Exception:
                # Tag inexistente ou duplicação — ignora silenciosamente,
                # frontend valida.
                continue
        conn.commit()
        row = conn.execute(
            "SELECT * FROM library_item WHERE id = ?", (item_id,)
        ).fetchone()
        tags = _fetch_tags_for(conn, item_id)
    return _row_to_item(row, tags, [], 0)


@router.patch("/items/{item_id}", response_model=LibraryItemOut)
def update_item(item_id: int, body: LibraryItemUpdate):
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(400, detail="Nada pra atualizar")

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM library_item WHERE id = ?", (item_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Item não encontrado")

        # Transição de status — valida antes de persistir
        new_status = fields.get("status")
        if new_status is not None and new_status != existing["status"]:
            _validate_status_transition(
                current=existing["status"],
                new=new_status,
                tese_central=fields.get("tese_central", existing["tese_central"]),
                o_que_ficou=fields.get("o_que_ficou", existing["o_que_ficou"]),
                abandoned_reason=fields.get(
                    "abandoned_reason", existing["abandoned_reason"]
                ),
            )
            # Efeitos colaterais por transição (datas, limpezas)
            today = _today_iso()
            if new_status == "doing":
                if existing["status"] == "queue" and not existing["data_inicio"]:
                    fields.setdefault("data_inicio", today)
                # Revisita ativa: limpa data_fim e abandoned_reason se voltou
                if existing["status"] in ("done", "abandoned"):
                    fields.setdefault("data_fim", None)
                    fields.setdefault("abandoned_reason", None)
            elif new_status in ("done", "abandoned"):
                fields.setdefault("data_fim", today)
                if not existing["data_inicio"]:
                    fields.setdefault("data_inicio", today)

        # Tags — substitui set inteiro se enviado
        new_tag_ids = fields.pop("tag_ids", None)

        # revisitar_em: string vazia limpa o campo
        if "revisitar_em" in fields and fields["revisitar_em"] in ("", None):
            fields["revisitar_em"] = None

        # Saga: ao MUDAR de saga (ou vincular pela primeira vez), seta
        # saga_ordem como próximo livre na saga destino, A NÃO SER que o
        # cliente já tenha enviado saga_ordem explícito. Desvincular
        # (saga_id=None) zera saga_ordem pra deixar consistente.
        if "saga_id" in fields:
            new_saga_id = fields["saga_id"]
            current_saga_id = existing["saga_id"] if "saga_id" in existing.keys() else None
            if new_saga_id != current_saga_id:
                if new_saga_id is None:
                    fields.setdefault("saga_ordem", 0)
                else:
                    if "saga_ordem" not in fields:
                        fields["saga_ordem"] = _next_saga_ordem(conn, new_saga_id)

        fields["atualizado_em"] = utcnow_iso_z()
        sets = ", ".join(f"{k} = ?" for k in fields.keys())
        params = list(fields.values()) + [item_id]
        conn.execute(f"UPDATE library_item SET {sets} WHERE id = ?", params)

        if new_tag_ids is not None:
            conn.execute(
                "DELETE FROM library_item_tag WHERE item_id = ?", (item_id,)
            )
            for tag_id in new_tag_ids:
                try:
                    conn.execute(
                        "INSERT INTO library_item_tag(item_id, tag_id) VALUES(?,?)",
                        (item_id, tag_id),
                    )
                except Exception:
                    continue
        conn.commit()
        row = conn.execute(
            "SELECT * FROM library_item WHERE id = ?", (item_id,)
        ).fetchone()
        tags = _fetch_tags_for(conn, item_id)
        links = _fetch_links_for(conn, item_id)
        minutos = _fetch_minutos_total(conn, item_id)
    return _row_to_item(row, tags, links, minutos)


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int):
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM library_item WHERE id = ?", (item_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Item não encontrado")
        # FK cascade cuida de tags/sessions/links
        conn.execute("DELETE FROM library_item WHERE id = ?", (item_id,))
        conn.commit()


# ─── Sagas ────────────────────────────────────────────────────────────────


@router.get("/sagas", response_model=list[LibrarySagaOut])
def list_sagas():
    """Lista todas as sagas com `items_count` agregado. Ordem do campo
    `ordem` (configurável) ou alfabético do nome quando empate."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT s.id, s.nome, s.descricao, s.cor, s.ordem,
                      s.criado_em, s.atualizado_em,
                      COUNT(i.id) AS items_count
               FROM library_saga s
               LEFT JOIN library_item i ON i.saga_id = s.id
               GROUP BY s.id, s.nome, s.descricao, s.cor, s.ordem,
                        s.criado_em, s.atualizado_em
               ORDER BY s.ordem, s.nome"""
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/sagas", response_model=LibrarySagaOut, status_code=201)
def create_saga(body: LibrarySagaCreate):
    now = utcnow_iso_z()
    with get_conn() as conn:
        if body.ordem is None:
            ordem = conn.execute(
                "SELECT COALESCE(MAX(ordem), 0) + 1 AS next FROM library_saga"
            ).fetchone()["next"]
        else:
            ordem = body.ordem
        cur = conn.execute(
            "INSERT INTO library_saga(nome, descricao, cor, ordem, criado_em, atualizado_em) "
            "VALUES(?,?,?,?,?,?)",
            (body.nome, body.descricao, body.cor, ordem, now, now),
        )
        saga_id = cur.lastrowid
        conn.commit()
        row = conn.execute(
            """SELECT s.id, s.nome, s.descricao, s.cor, s.ordem,
                      s.criado_em, s.atualizado_em,
                      0 AS items_count
               FROM library_saga s WHERE s.id = ?""",
            (saga_id,),
        ).fetchone()
    return dict(row)


@router.patch("/sagas/{saga_id}", response_model=LibrarySagaOut)
def update_saga(saga_id: int, body: LibrarySagaUpdate):
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(400, detail="Nada pra atualizar")
    fields["atualizado_em"] = utcnow_iso_z()
    sets = ", ".join(f"{k} = ?" for k in fields.keys())
    params = list(fields.values()) + [saga_id]
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM library_saga WHERE id = ?", (saga_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Saga não encontrada")
        conn.execute(f"UPDATE library_saga SET {sets} WHERE id = ?", params)
        conn.commit()
        row = conn.execute(
            """SELECT s.id, s.nome, s.descricao, s.cor, s.ordem,
                      s.criado_em, s.atualizado_em,
                      COUNT(i.id) AS items_count
               FROM library_saga s
               LEFT JOIN library_item i ON i.saga_id = s.id
               WHERE s.id = ?
               GROUP BY s.id""",
            (saga_id,),
        ).fetchone()
    return dict(row)


@router.delete("/sagas/{saga_id}", status_code=204)
def delete_saga(saga_id: int):
    """Deleta saga. Items vinculados ficam órfãos (saga_id=NULL) sem perder
    status/notas/links. Em DBs com FK ativa, isso já acontece via ON DELETE
    SET NULL; em DBs migrados de schema antigo (sem FK na coluna), seta
    manualmente antes do DELETE pra garantir consistência."""
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM library_saga WHERE id = ?", (saga_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Saga não encontrada")
        # Desvincula items explicitamente (cobre DBs sem FK na coluna).
        conn.execute(
            "UPDATE library_item SET saga_id = NULL, saga_ordem = 0 "
            "WHERE saga_id = ?",
            (saga_id,),
        )
        conn.execute("DELETE FROM library_saga WHERE id = ?", (saga_id,))
        conn.commit()


@router.post("/sagas/{saga_id}/reorder", response_model=list[LibraryItemListOut])
def reorder_saga_items(saga_id: int, body: LibrarySagaReorder):
    """Reordena items dentro da saga em uma única operação atômica.
    item_ids na ordem desejada → saga_ordem = posição (1-indexed).
    Items omitidos vão pro final mantendo ordem natural pelo id.
    Retorna a lista atualizada da saga."""
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM library_saga WHERE id = ?", (saga_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Saga não encontrada")

        # Items da saga atualmente
        rows = conn.execute(
            "SELECT id FROM library_item WHERE saga_id = ? ORDER BY saga_ordem, id",
            (saga_id,),
        ).fetchall()
        current_ids = [r["id"] for r in rows]
        current_set = set(current_ids)

        # Filtra ids do body que realmente pertencem à saga (defensivo).
        body_ids = [i for i in body.item_ids if i in current_set]

        # Items órfãos (não mencionados no body) vão pro final em ordem natural.
        body_set = set(body_ids)
        tail_ids = [i for i in current_ids if i not in body_set]
        final_order = body_ids + tail_ids

        now = utcnow_iso_z()
        for pos, item_id in enumerate(final_order, start=1):
            conn.execute(
                "UPDATE library_item SET saga_ordem = ?, atualizado_em = ? "
                "WHERE id = ?",
                (pos, now, item_id),
            )
        conn.commit()

        # Retorna lista atualizada (mesmo shape do list_items)
        out_rows = conn.execute(
            "SELECT i.id, i.tipo, i.titulo, i.autor, i.ano, i.status, i.data_inicio, "
            "i.data_fim, i.revisitar_em, i.origem, i.sort_order, "
            "i.saga_id, i.saga_ordem, i.criado_em, i.atualizado_em "
            "FROM library_item i WHERE i.saga_id = ? "
            "ORDER BY i.saga_ordem, i.id",
            (saga_id,),
        ).fetchall()
        out: list[dict] = []
        for r in out_rows:
            d = dict(r)
            d["tags"] = _fetch_tags_for(conn, d["id"])
            d["minutos_total"] = _fetch_minutos_total(conn, d["id"])
            out.append(d)
    return out


# ─── Sessions (cronômetro) ────────────────────────────────────────────────


def _session_dict(row, *, item_id: int) -> dict:
    """Adiciona elapsed_seconds derivado à row de library_session."""
    started_at = row["started_at"]
    ended_at = row["ended_at"]
    elapsed = 0
    try:
        s = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        if ended_at:
            e = datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
        else:
            e = datetime.now(timezone.utc)
        elapsed = max(0, int((e - s).total_seconds()))
    except (ValueError, AttributeError):
        pass
    return {
        "id": row["id"],
        "item_id": item_id,
        "session_num": row["session_num"],
        "started_at": started_at,
        "ended_at": ended_at,
        "elapsed_seconds": elapsed,
    }


@router.get("/items/{item_id}/sessions", response_model=list[LibrarySessionOut])
def list_sessions(item_id: int):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM library_session WHERE item_id = ? ORDER BY session_num ASC",
            (item_id,),
        ).fetchall()
    return [_session_dict(r, item_id=item_id) for r in rows]


@router.post(
    "/items/{item_id}/sessions/start",
    response_model=LibrarySessionOut,
    status_code=201,
)
def start_session(item_id: int):
    """Idempotente: se já existe sessão aberta, retorna ela.
    409 se há outra ativa em quest/task/routine/library."""
    now = utcnow_iso_z()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM library_session "
            "WHERE item_id = ? AND ended_at IS NULL "
            "ORDER BY id DESC LIMIT 1",
            (item_id,),
        ).fetchone()
        if existing:
            return _session_dict(existing, item_id=item_id)
        active = find_active_session(conn, exclude_type="library", exclude_id=str(item_id))
        if active:
            raise HTTPException(409, detail=active["title"])
        # Confere se item existe
        item = conn.execute(
            "SELECT id FROM library_item WHERE id = ?", (item_id,)
        ).fetchone()
        if not item:
            raise HTTPException(404, detail="Item não encontrado")
        last = conn.execute(
            "SELECT MAX(session_num) AS num FROM library_session WHERE item_id = ?",
            (item_id,),
        ).fetchone()
        session_num = (last["num"] or 0) + 1
        conn.execute(
            "INSERT INTO library_session(item_id, session_num, started_at) VALUES(?,?,?)",
            (item_id, session_num, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM library_session WHERE item_id = ? AND session_num = ?",
            (item_id, session_num),
        ).fetchone()
    return _session_dict(row, item_id=item_id)


@router.post("/items/{item_id}/sessions/pause", response_model=LibrarySessionOut)
def pause_session(item_id: int):
    now = utcnow_iso_z()
    with get_conn() as conn:
        session = conn.execute(
            "SELECT * FROM library_session "
            "WHERE item_id = ? AND ended_at IS NULL "
            "ORDER BY session_num DESC LIMIT 1",
            (item_id,),
        ).fetchone()
        if session:
            conn.execute(
                "UPDATE library_session SET ended_at = ? WHERE id = ?",
                (now, session["id"]),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM library_session WHERE id = ?", (session["id"],)
            ).fetchone()
            return _session_dict(row, item_id=item_id)
        last = conn.execute(
            "SELECT * FROM library_session "
            "WHERE item_id = ? ORDER BY session_num DESC LIMIT 1",
            (item_id,),
        ).fetchone()
        if last:
            return _session_dict(last, item_id=item_id)
        raise HTTPException(404, detail="Item não tem sessões")


@router.post(
    "/items/{item_id}/sessions/resume",
    response_model=LibrarySessionOut,
    status_code=201,
)
def resume_session(item_id: int):
    now = utcnow_iso_z()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM library_session "
            "WHERE item_id = ? AND ended_at IS NULL "
            "ORDER BY id DESC LIMIT 1",
            (item_id,),
        ).fetchone()
        if existing:
            return _session_dict(existing, item_id=item_id)
        active = find_active_session(conn, exclude_type="library", exclude_id=str(item_id))
        if active:
            raise HTTPException(409, detail=active["title"])
        last = conn.execute(
            "SELECT MAX(session_num) AS num FROM library_session WHERE item_id = ?",
            (item_id,),
        ).fetchone()
        session_num = (last["num"] or 0) + 1
        conn.execute(
            "INSERT INTO library_session(item_id, session_num, started_at) VALUES(?,?,?)",
            (item_id, session_num, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM library_session WHERE item_id = ? AND session_num = ?",
            (item_id, session_num),
        ).fetchone()
    return _session_dict(row, item_id=item_id)


@router.post("/items/{item_id}/sessions/stop", response_model=LibrarySessionOut)
def stop_session(item_id: int):
    """Alias de pause — fecha a sessão ativa. Mantido por simetria com
    o vocabulário das rotinas (stop fecha o ciclo do dia)."""
    return pause_session(item_id)


# ─── Cross-links ──────────────────────────────────────────────────────────


@router.post(
    "/items/{item_id}/links",
    response_model=LibraryLinkOut,
    status_code=201,
)
def create_link(item_id: int, body: LibraryLinkCreate):
    with get_conn() as conn:
        item = conn.execute(
            "SELECT id FROM library_item WHERE id = ?", (item_id,)
        ).fetchone()
        if not item:
            raise HTTPException(404, detail="Item não encontrado")
        existing = conn.execute(
            "SELECT id FROM library_link "
            "WHERE item_id = ? AND target_type = ? AND target_id = ?",
            (item_id, body.target_type, body.target_id),
        ).fetchone()
        if existing:
            raise HTTPException(409, detail="Esse link já existe")
        cur = conn.execute(
            "INSERT INTO library_link(item_id, target_type, target_id, nota) "
            "VALUES(?,?,?,?)",
            (item_id, body.target_type, body.target_id, body.nota),
        )
        link_id = cur.lastrowid
        conn.commit()
        row = conn.execute(
            "SELECT id, target_type, target_id, nota, criado_em "
            "FROM library_link WHERE id = ?",
            (link_id,),
        ).fetchone()
    return dict(row)


@router.delete("/links/{link_id}", status_code=204)
def delete_link(link_id: int):
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM library_link WHERE id = ?", (link_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Link não encontrado")
        conn.execute("DELETE FROM library_link WHERE id = ?", (link_id,))
        conn.commit()


# ─── Painéis agregados ───────────────────────────────────────────────────


@router.get("/pending", response_model=list[LibraryPendingOut])
def pending_revisits(janela_dias: int = Query(7, ge=0, le=365)):
    """Itens com revisitar_em ≤ hoje+janela_dias. dias_ate negativo = atrasado."""
    today = date.today()
    cutoff = (today + timedelta(days=janela_dias)).isoformat()
    out: list[dict] = []
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, titulo, tipo, revisitar_em FROM library_item "
            "WHERE revisitar_em IS NOT NULL AND revisitar_em <= ? "
            "ORDER BY revisitar_em ASC",
            (cutoff,),
        ).fetchall()
        for r in rows:
            try:
                d = date.fromisoformat(r["revisitar_em"])
                dias = (d - today).days
            except ValueError:
                dias = 0
            out.append(
                {
                    "id": r["id"],
                    "titulo": r["titulo"],
                    "tipo": r["tipo"],
                    "revisitar_em": r["revisitar_em"],
                    "dias_ate": dias,
                }
            )
    return out


@router.get("/backlinks", response_model=list[LibraryBacklinkOut])
def backlinks(target_type: str, target_id: str):
    """Backlinks pro `target` (e.g., hipótese Mind, quest, princípio Build).

    Retorna os LibraryItems que apontam pra esse target — ordenado por mais
    recente primeiro. Usado pra mostrar "X items da Library linkam aqui" em
    páginas de hipótese/quest/princípio. Fecha a simetria dos cross-links.
    """
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT ll.id AS link_id, ll.nota, ll.criado_em,
                      i.id AS item_id, i.tipo AS item_tipo, i.titulo AS item_titulo,
                      i.status AS item_status, i.autor AS item_autor
               FROM library_link ll
               JOIN library_item i ON i.id = ll.item_id
               WHERE ll.target_type = ? AND ll.target_id = ?
               ORDER BY ll.criado_em DESC""",
            (target_type, target_id),
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/temas", response_model=list[LibraryTemaOut])
def temas():
    """Agregação por tag — quantos itens, quantos fechados, quantos em
    andamento. Inclui só tags não-arquivadas."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT t.id AS tag_id, t.slug AS tag_slug, t.nome AS tag_nome,
                      t.cor AS tag_cor,
                      COUNT(i.id) AS count_total,
                      SUM(CASE WHEN i.status = 'done' THEN 1 ELSE 0 END) AS count_done,
                      SUM(CASE WHEN i.status = 'doing' THEN 1 ELSE 0 END) AS count_doing
               FROM library_tag t
               LEFT JOIN library_item_tag it ON it.tag_id = t.id
               LEFT JOIN library_item i ON i.id = it.item_id
               WHERE t.arquivado = 0
               GROUP BY t.id, t.slug, t.nome, t.cor
               ORDER BY count_total DESC, t.ordem, t.nome"""
        ).fetchall()
    return [
        {
            "tag_id": r["tag_id"],
            "tag_slug": r["tag_slug"],
            "tag_nome": r["tag_nome"],
            "tag_cor": r["tag_cor"],
            "count_total": r["count_total"] or 0,
            "count_done": r["count_done"] or 0,
            "count_doing": r["count_doing"] or 0,
        }
        for r in rows
    ]
