import uuid

from fastapi import APIRouter, HTTPException

from db import get_conn
from models.deliverable import DELIV_COLUMNS, DeliverableCreate, DeliverableOut
from services.utils import parse_iso

router = APIRouter()


def _executed_minutes_for_deliverable(conn, deliv_id: str) -> int:
    """Soma em minutos das sessões fechadas de TODAS as quests do deliverable.

    Antes filtrava `q.status = 'done'`, mas isso fazia o card do entregável
    mentir até o user finalizar a quest: 5h trabalhadas em uma quest aberta
    apareciam como 0 em "feitos". Agora conta tempo real, independente do
    status da quest. Sessão em andamento (ended_at NULL) ainda fica de fora
    — só é somada depois de pause/finalize.
    """
    rows = conn.execute(
        """
        SELECT s.started_at, s.ended_at
        FROM quest_sessions s
        JOIN quests q ON q.id = s.quest_id
        WHERE q.deliverable_id = ?
          AND s.ended_at IS NOT NULL
        """,
        (deliv_id,),
    ).fetchall()
    total_seconds = 0
    for r in rows:
        try:
            start = parse_iso(r["started_at"])
            end = parse_iso(r["ended_at"])
            total_seconds += max(0, int((end - start).total_seconds()))
        except Exception:
            continue
    return total_seconds // 60


@router.get("/api/projects/{project_id}/deliverables", response_model=list[DeliverableOut])
def list_deliverables(project_id: str):
    """Lista entregáveis do projeto, com executed_minutes já agregado.
    Uma query bulk pros entregáveis + outra agregando sessões — sem N+1."""
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT {DELIV_COLUMNS} FROM deliverables "
            "WHERE project_id = ? ORDER BY sort_order ASC",
            (project_id,),
        ).fetchall()
        session_rows = conn.execute(
            """
            SELECT q.deliverable_id AS deliv_id, s.started_at, s.ended_at
            FROM quest_sessions s
            JOIN quests q ON q.id = s.quest_id
            JOIN deliverables d ON d.id = q.deliverable_id
            WHERE d.project_id = ?
              AND s.ended_at IS NOT NULL
            """,
            (project_id,),
        ).fetchall()

    by_deliv: dict[str, int] = {}
    for s in session_rows:
        try:
            start = parse_iso(s["started_at"])
            end = parse_iso(s["ended_at"])
            secs = max(0, int((end - start).total_seconds()))
        except Exception:
            continue
        by_deliv[s["deliv_id"]] = by_deliv.get(s["deliv_id"], 0) + secs

    result = []
    for r in rows:
        d = dict(r)
        d["executed_minutes"] = by_deliv.get(d["id"], 0) // 60
        result.append(d)
    return result


@router.post("/api/projects/{project_id}/deliverables", response_model=DeliverableOut, status_code=201)
def create_deliverable(project_id: str, body: DeliverableCreate):
    deliv_id = str(uuid.uuid4())[:8]
    with get_conn() as conn:
        project = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(404, detail=f"Project '{project_id}' not found")

        max_sort = conn.execute(
            "SELECT MAX(sort_order) as num FROM deliverables WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        sort_order = (max_sort["num"] or 0) + 1

        conn.execute(
            "INSERT INTO deliverables(id, project_id, title, done, sort_order, estimated_minutes, deadline) VALUES(?,?,?,?,?,?,?)",
            (deliv_id, project_id, body.title, 0, sort_order, body.estimated_minutes, body.deadline),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {DELIV_COLUMNS} FROM deliverables WHERE id = ?",
            (deliv_id,),
        ).fetchone()
        d = dict(row)
        d["executed_minutes"] = 0
    return d


@router.patch("/api/deliverables/{deliv_id}", response_model=DeliverableOut)
def update_deliverable(deliv_id: str, body: dict):
    """Permite deadline=None explícito via sentinel. Filtra chaves desconhecidas."""
    allowed = {"title", "estimated_minutes", "deadline", "done", "sort_order"}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        raise HTTPException(400, detail="Nothing to update")
    if "done" in fields and isinstance(fields["done"], bool):
        fields["done"] = 1 if fields["done"] else 0
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE deliverables SET {set_clause} WHERE id = ?",
            [*fields.values(), deliv_id],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {DELIV_COLUMNS} FROM deliverables WHERE id = ?",
            (deliv_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404)
        d = dict(row)
        d["executed_minutes"] = _executed_minutes_for_deliverable(conn, deliv_id)
    return d


@router.delete("/api/deliverables/{deliv_id}", status_code=204)
def delete_deliverable(deliv_id: str):
    with get_conn() as conn:
        attached = conn.execute(
            "SELECT COUNT(*) AS n FROM quests WHERE deliverable_id = ?",
            (deliv_id,),
        ).fetchone()
        if attached and attached["n"] > 0:
            raise HTTPException(
                409,
                detail=f"Esse entregável tem {attached['n']} quest(s) amarrada(s). Mova ou delete as quests antes.",
            )
        conn.execute("DELETE FROM deliverables WHERE id = ?", (deliv_id,))
        conn.commit()
    return None


@router.post("/api/projects/{project_id}/deliverables/reorder")
def reorder_deliverables(project_id: str, body: dict):
    """Reorder por sort_order. `project_id` mantido na URL pra consistência
    (não é usado dentro — a lista de ids é a fonte da verdade)."""
    deliv_ids = body.get("deliv_ids", [])
    if not deliv_ids:
        raise HTTPException(400, detail="deliv_ids required")

    with get_conn() as conn:
        for index, deliv_id in enumerate(deliv_ids):
            conn.execute(
                "UPDATE deliverables SET sort_order = ? WHERE id = ?",
                (index, deliv_id),
            )
        conn.commit()
    return {"status": "reordered"}
