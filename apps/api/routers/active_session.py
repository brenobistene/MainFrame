from typing import Optional

from fastapi import APIRouter, Query

from db import get_conn
from models.session import ActiveSessionOut

router = APIRouter()


@router.get("/api/sessions/active", response_model=ActiveSessionOut | None)
def get_active_session(
    focused_type: Optional[str] = Query(None),
    focused_id: Optional[str] = Query(None),
):
    """Sessão ativa global pro banner flutuante.

    Primário: qualquer sessão rodando agora (quest/task/routine).
    Fallback: se o chamador passar `focused_*` (a entidade que o usuário
    iniciou por último), retorna a sessão mais recente dela mesmo pausada —
    pra o banner continuar visível até finalizar. Entidades já finalizadas
    (quest done, task done, routine logada no dia) não qualificam.
    """
    with get_conn() as conn:
        # Defesa contra loop de banner: sessões "órfãs" (entidade já marcada
        # done mas sessão segue aberta — ex: dado legado, falha no PATCH)
        # ficavam aparecendo aqui e o frontend entrava em ping-pong com o
        # efeito que zera activeSession quando vê q.status=='done'.
        # Filtramos por status da entidade na query global também.
        row = conn.execute(
            """SELECT 'quest' AS type, qs.quest_id AS id, q.title, q.area_slug, qs.started_at, qs.ended_at, qs.id AS sid, NULL AS routine_date
               FROM quest_sessions qs JOIN quests q ON qs.quest_id = q.id
               WHERE qs.ended_at IS NULL AND q.status NOT IN ('done','cancelled')
               UNION ALL
               SELECT 'task' AS type, ts.task_id AS id, t.title, NULL AS area_slug, ts.started_at, ts.ended_at, ts.id AS sid, NULL AS routine_date
               FROM task_sessions ts JOIN tasks t ON ts.task_id = t.id
               WHERE ts.ended_at IS NULL AND t.done = 0
               UNION ALL
               SELECT 'routine' AS type, rs.routine_id AS id, r.title, NULL AS area_slug, rs.started_at, rs.ended_at, rs.id AS sid, rs.date AS routine_date
               FROM routine_sessions rs
                 JOIN routines r ON rs.routine_id = r.id
                 LEFT JOIN routine_logs rl
                   ON rl.routine_id = rs.routine_id AND rl.completed_date = rs.date
               WHERE rs.ended_at IS NULL AND rl.id IS NULL
               LIMIT 1"""
        ).fetchone()

        if not row and focused_type and focused_id:
            if focused_type == "quest":
                row = conn.execute(
                    """SELECT 'quest' AS type, qs.quest_id AS id, q.title, q.area_slug, qs.started_at, qs.ended_at, qs.id AS sid, NULL AS routine_date
                       FROM quest_sessions qs JOIN quests q ON qs.quest_id = q.id
                       WHERE qs.quest_id = ? AND q.status != 'done'
                       ORDER BY qs.id DESC LIMIT 1""",
                    (focused_id,),
                ).fetchone()
            elif focused_type == "task":
                row = conn.execute(
                    """SELECT 'task' AS type, ts.task_id AS id, t.title, NULL AS area_slug, ts.started_at, ts.ended_at, ts.id AS sid, NULL AS routine_date
                       FROM task_sessions ts JOIN tasks t ON ts.task_id = t.id
                       WHERE ts.task_id = ? AND t.done = 0
                       ORDER BY ts.id DESC LIMIT 1""",
                    (focused_id,),
                ).fetchone()
            elif focused_type == "routine":
                row = conn.execute(
                    """SELECT 'routine' AS type, rs.routine_id AS id, r.title, NULL AS area_slug, rs.started_at, rs.ended_at, rs.id AS sid, rs.date AS routine_date
                       FROM routine_sessions rs
                         JOIN routines r ON rs.routine_id = r.id
                         LEFT JOIN routine_logs rl
                           ON rl.routine_id = rs.routine_id AND rl.completed_date = rs.date
                       WHERE rs.routine_id = ? AND rl.id IS NULL
                       ORDER BY rs.id DESC LIMIT 1""",
                    (focused_id,),
                ).fetchone()

    if not row:
        return None

    parent_title: Optional[str] = None
    deliverable_title: Optional[str] = None
    if row["type"] == "quest":
        with get_conn() as conn:
            ctx = conn.execute(
                """SELECT q.project_id, q.deliverable_id,
                          p.title AS parent_title,
                          d.title AS deliverable_title
                   FROM quests q
                   LEFT JOIN projects p ON p.id = q.project_id
                   LEFT JOIN deliverables d ON d.id = q.deliverable_id
                   WHERE q.id = ?""",
                (row["id"],),
            ).fetchone()
            if ctx:
                parent_title = ctx["parent_title"]
                deliverable_title = ctx["deliverable_title"]

    return {
        "type": row["type"],
        "id": row["id"],
        "title": row["title"],
        "area_slug": row["area_slug"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
        "is_active": row["ended_at"] is None,
        "parent_title": parent_title,
        "deliverable_title": deliverable_title,
        "quest_id": row["id"] if row["type"] == "quest" else None,
        "routine_date": row["routine_date"] if row["type"] == "routine" else None,
    }
