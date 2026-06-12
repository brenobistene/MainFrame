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
        # Sessões abertas (ended_at IS NULL) sempre devem aparecer aqui pro
        # banner — sem isso, user perde o botão de stop quando há sessão
        # rodando, e a row vira órfã. Para quest/task filtramos status done
        # porque a PATCH/toggle dessas entidades já fecha a sessão junto. Pra
        # routines, o toggle_routine também fecha sessão ao criar log, então
        # log = sessão fechada (invariant garantido no toggle endpoint).
        # Se aparecer sessão aberta de rotina mesmo com log, é cenário de
        # "dei play depois de já ter marcado feito" — banner DEVE mostrar
        # pra o user poder parar.
        row = conn.execute(
            """SELECT 'quest' AS type, qs.quest_id AS id, q.title, q.area_slug, qs.started_at, qs.ended_at, qs.id AS sid, NULL AS routine_date, q.estimated_minutes AS estimated_minutes
               FROM quest_sessions qs JOIN quests q ON qs.quest_id = q.id
               WHERE qs.ended_at IS NULL AND q.status NOT IN ('done','cancelled')
               UNION ALL
               SELECT 'task' AS type, ts.task_id AS id, t.title, NULL AS area_slug, ts.started_at, ts.ended_at, ts.id AS sid, NULL AS routine_date, t.duration_minutes AS estimated_minutes
               FROM task_sessions ts JOIN tasks t ON ts.task_id = t.id
               WHERE ts.ended_at IS NULL AND t.done = 0
               UNION ALL
               SELECT 'routine' AS type, rs.routine_id AS id, r.title, NULL AS area_slug, rs.started_at, rs.ended_at, rs.id AS sid, rs.date AS routine_date, r.estimated_minutes AS estimated_minutes
               FROM routine_sessions rs JOIN routines r ON rs.routine_id = r.id
               WHERE rs.ended_at IS NULL
               UNION ALL
               SELECT 'lang' AS type, 'lang' AS id, ('Lang Lab: ' || COALESCE(ll.nome, '')) AS title, NULL AS area_slug, lgs.started_at, lgs.ended_at, lgs.id AS sid, NULL AS routine_date, NULL AS estimated_minutes
               FROM lang_session lgs
               LEFT JOIN lang_language ll ON lgs.language_id = ll.id
               WHERE lgs.finalizada = 0
                 AND lgs.id = (SELECT MAX(id) FROM lang_session WHERE finalizada = 0)
               UNION ALL
               SELECT 'mind' AS type, 'mind' AS id, 'Meditar' AS title, NULL AS area_slug, ms.started_at, ms.ended_at, ms.id AS sid, NULL AS routine_date, NULL AS estimated_minutes
               FROM mind_session ms
               WHERE ms.record_id IS NULL
                 AND ms.id = (SELECT MAX(id) FROM mind_session WHERE record_id IS NULL)
               UNION ALL
               SELECT 'health_item' AS type, CAST(hs.item_id AS TEXT) AS id, hi.nome AS title, NULL AS area_slug, hs.started_at, hs.ended_at, hs.id AS sid, NULL AS routine_date, hi.duracao_media_min AS estimated_minutes
               FROM health_item_session hs JOIN health_item hi ON hs.item_id = hi.id
               WHERE hs.record_id IS NULL
                 AND hs.id = (SELECT MAX(id) FROM health_item_session WHERE record_id IS NULL)
               UNION ALL
               SELECT 'ritual' AS type, brc.cadencia AS id, ('Ritual · ' || brc.cadencia) AS title, NULL AS area_slug, brc.started_at, brc.ended_at, brc.id AS sid, NULL AS routine_date, br.duracao_alvo_min AS estimated_minutes
               FROM build_ritual_cluster brc
               JOIN build_ritual br ON brc.cadencia = br.cadencia
               WHERE brc.record_id IS NULL
                 AND brc.id = (SELECT MAX(id) FROM build_ritual_cluster WHERE record_id IS NULL)
               LIMIT 1"""
        ).fetchone()

        if not row and focused_type and focused_id:
            if focused_type == "quest":
                row = conn.execute(
                    """SELECT 'quest' AS type, qs.quest_id AS id, q.title, q.area_slug, qs.started_at, qs.ended_at, qs.id AS sid, NULL AS routine_date, q.estimated_minutes AS estimated_minutes
                       FROM quest_sessions qs JOIN quests q ON qs.quest_id = q.id
                       WHERE qs.quest_id = ? AND q.status != 'done'
                       ORDER BY qs.id DESC LIMIT 1""",
                    (focused_id,),
                ).fetchone()
            elif focused_type == "task":
                row = conn.execute(
                    """SELECT 'task' AS type, ts.task_id AS id, t.title, NULL AS area_slug, ts.started_at, ts.ended_at, ts.id AS sid, NULL AS routine_date, t.duration_minutes AS estimated_minutes
                       FROM task_sessions ts JOIN tasks t ON ts.task_id = t.id
                       WHERE ts.task_id = ? AND t.done = 0
                       ORDER BY ts.id DESC LIMIT 1""",
                    (focused_id,),
                ).fetchone()
            elif focused_type == "routine":
                # NOT EXISTS contra routine_logs: depois que o user FINALIZA,
                # o stop endpoint insere log (data = target/hoje) + fecha
                # qualquer sessão aberta da rotina. Sem essa cláusula o
                # fallback devolvia a session fechada e o banner ficava
                # fantasma com "paused" pra sempre.
                #
                # `>= rs.date`: cobre cross-midnight onde session.date pode
                # ser ontem mas log foi pra hoje (intenção do user). Se há
                # qualquer log da rotina em ou após a data da sessão, ela
                # está "completada" — não devolve no fallback.
                row = conn.execute(
                    """SELECT 'routine' AS type, rs.routine_id AS id, r.title, NULL AS area_slug, rs.started_at, rs.ended_at, rs.id AS sid, rs.date AS routine_date, r.estimated_minutes AS estimated_minutes
                       FROM routine_sessions rs JOIN routines r ON rs.routine_id = r.id
                       WHERE rs.routine_id = ?
                         AND NOT EXISTS (
                           SELECT 1 FROM routine_logs rl
                           WHERE rl.routine_id = rs.routine_id
                             AND rl.completed_date >= rs.date
                         )
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
        "estimated_minutes": row["estimated_minutes"],
    }
