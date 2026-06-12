"""Busca a sessão ativa global do usuário (uma só, atravessa quest/task/routine)."""
from __future__ import annotations

from typing import Optional


def find_active_session(
    conn,
    exclude_type: Optional[str] = None,
    exclude_id: Optional[str] = None,
) -> Optional[dict]:
    """Retorna a única sessão ativa (quest/task/routine), ou None.

    `exclude_type`/`exclude_id` permitem pular a sessão da entidade que
    está tentando iniciar/retomar, pra não conflitar consigo mesma.

    Shape de retorno: {type, id, title, started_at}.
    """
    # Quest
    if exclude_type != "quest":
        row = conn.execute(
            """SELECT qs.quest_id AS id, q.title, qs.started_at
               FROM quest_sessions qs JOIN quests q ON qs.quest_id = q.id
               WHERE qs.ended_at IS NULL LIMIT 1"""
        ).fetchone()
        if row:
            return {"type": "quest", "id": row["id"], "title": row["title"], "started_at": row["started_at"]}
    else:
        row = conn.execute(
            """SELECT qs.quest_id AS id, q.title, qs.started_at
               FROM quest_sessions qs JOIN quests q ON qs.quest_id = q.id
               WHERE qs.ended_at IS NULL AND qs.quest_id != ? LIMIT 1""",
            (exclude_id,),
        ).fetchone()
        if row:
            return {"type": "quest", "id": row["id"], "title": row["title"], "started_at": row["started_at"]}

    # Task
    if exclude_type != "task":
        row = conn.execute(
            """SELECT ts.task_id AS id, t.title, ts.started_at
               FROM task_sessions ts JOIN tasks t ON ts.task_id = t.id
               WHERE ts.ended_at IS NULL LIMIT 1"""
        ).fetchone()
        if row:
            return {"type": "task", "id": row["id"], "title": row["title"], "started_at": row["started_at"]}
    else:
        row = conn.execute(
            """SELECT ts.task_id AS id, t.title, ts.started_at
               FROM task_sessions ts JOIN tasks t ON ts.task_id = t.id
               WHERE ts.ended_at IS NULL AND ts.task_id != ? LIMIT 1""",
            (exclude_id,),
        ).fetchone()
        if row:
            return {"type": "task", "id": row["id"], "title": row["title"], "started_at": row["started_at"]}

    # Routine
    if exclude_type != "routine":
        row = conn.execute(
            """SELECT rs.routine_id AS id, r.title, rs.started_at
               FROM routine_sessions rs JOIN routines r ON rs.routine_id = r.id
               WHERE rs.ended_at IS NULL LIMIT 1"""
        ).fetchone()
        if row:
            return {"type": "routine", "id": row["id"], "title": row["title"], "started_at": row["started_at"]}
    else:
        row = conn.execute(
            """SELECT rs.routine_id AS id, r.title, rs.started_at
               FROM routine_sessions rs JOIN routines r ON rs.routine_id = r.id
               WHERE rs.ended_at IS NULL AND rs.routine_id != ? LIMIT 1""",
            (exclude_id,),
        ).fetchone()
        if row:
            return {"type": "routine", "id": row["id"], "title": row["title"], "started_at": row["started_at"]}

    # Library — sessões de leitura/estudo cronometradas
    if exclude_type != "library":
        row = conn.execute(
            """SELECT ls.item_id AS id, li.titulo AS title, ls.started_at
               FROM library_session ls JOIN library_item li ON ls.item_id = li.id
               WHERE ls.ended_at IS NULL LIMIT 1"""
        ).fetchone()
        if row:
            return {"type": "library", "id": row["id"], "title": row["title"], "started_at": row["started_at"]}
    else:
        row = conn.execute(
            """SELECT ls.item_id AS id, li.titulo AS title, ls.started_at
               FROM library_session ls JOIN library_item li ON ls.item_id = li.id
               WHERE ls.ended_at IS NULL AND ls.item_id != ? LIMIT 1""",
            (exclude_id,),
        ).fetchone()
        if row:
            return {"type": "library", "id": row["id"], "title": row["title"], "started_at": row["started_at"]}

    # Lang Lab — sessão de estudo nível-módulo (cluster com flag
    # `finalizada`; ended_at IS NULL = rodando agora). exclude_type='lang'
    # skip pra resume não conflitar consigo mesmo.
    if exclude_type != "lang":
        row = conn.execute(
            """SELECT ls.started_at, COALESCE(ll.nome, '') AS lang_nome
               FROM lang_session ls
               LEFT JOIN lang_language ll ON ls.language_id = ll.id
               WHERE ls.finalizada = 0 AND ls.ended_at IS NULL LIMIT 1"""
        ).fetchone()
        if row:
            return {
                "type": "lang",
                "id": "lang",
                "title": ("Lang Lab: " + row["lang_nome"]) if row["lang_nome"] else "Lang Lab",
                "started_at": row["started_at"],
            }

    # Mind — pendência diária com cronômetro. Sem `id` específico (Mind é
    # domain-level), title fixo. exclude_type='mind' skip pra evitar
    # auto-conflito ao reabrir.
    if exclude_type != "mind":
        row = conn.execute(
            "SELECT id, started_at FROM mind_session "
            "WHERE record_id IS NULL AND ended_at IS NULL LIMIT 1"
        ).fetchone()
        if row:
            return {
                "type": "mind",
                "id": "mind",
                "title": "Meditar",
                "started_at": row["started_at"],
            }

    # Health item — exercícios diários cronometrados.
    if exclude_type != "health_item":
        row = conn.execute(
            """SELECT hs.item_id AS id, hi.nome AS title, hs.started_at
               FROM health_item_session hs
               JOIN health_item hi ON hs.item_id = hi.id
               WHERE hs.record_id IS NULL AND hs.ended_at IS NULL LIMIT 1"""
        ).fetchone()
        if row:
            return {
                "type": "health_item",
                "id": row["id"],
                "title": row["title"],
                "started_at": row["started_at"],
            }
    else:
        row = conn.execute(
            """SELECT hs.item_id AS id, hi.nome AS title, hs.started_at
               FROM health_item_session hs
               JOIN health_item hi ON hs.item_id = hi.id
               WHERE hs.record_id IS NULL AND hs.ended_at IS NULL
                 AND hs.item_id != ? LIMIT 1""",
            (int(exclude_id) if exclude_id and exclude_id.isdigit() else -1,),
        ).fetchone()
        if row:
            return {
                "type": "health_item",
                "id": row["id"],
                "title": row["title"],
                "started_at": row["started_at"],
            }

    # Ritual cluster — rituais executados via /Dia.
    if exclude_type != "ritual":
        row = conn.execute(
            """SELECT cadencia AS id, ('Ritual · ' || cadencia) AS title, started_at
               FROM build_ritual_cluster
               WHERE record_id IS NULL AND ended_at IS NULL LIMIT 1"""
        ).fetchone()
        if row:
            return {
                "type": "ritual",
                "id": row["id"],
                "title": row["title"],
                "started_at": row["started_at"],
            }
    else:
        row = conn.execute(
            """SELECT cadencia AS id, ('Ritual · ' || cadencia) AS title, started_at
               FROM build_ritual_cluster
               WHERE record_id IS NULL AND ended_at IS NULL
                 AND cadencia != ? LIMIT 1""",
            (exclude_id or "",),
        ).fetchone()
        if row:
            return {
                "type": "ritual",
                "id": row["id"],
                "title": row["title"],
                "started_at": row["started_at"],
            }

    return None
