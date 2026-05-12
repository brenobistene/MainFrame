import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from db import get_conn
from models.session import TaskSessionOut
from models.task import TASK_COLUMNS, TaskCreate, TaskOut, TaskUpdate, row_to_task
from services.active_session import find_active_session
from services.utils import parse_iso, utcnow_iso_z


class SessionEdit(BaseModel):
    started_at: Optional[str] = None
    ended_at: Optional[str] = None


router = APIRouter()


# ─── Tasks CRUD ──────────────────────────────────────────────────────────────

@router.get("/api/tasks", response_model=list[TaskOut])
def list_tasks(
    done: Optional[bool] = None,
    scheduled_date: Optional[str] = Query(None, alias="date"),
):
    sql = f"SELECT {TASK_COLUMNS} FROM tasks WHERE 1=1"
    params: list = []
    if done is not None:
        sql += " AND done = ?"
        params.append(1 if done else 0)
    if scheduled_date is not None:
        sql += " AND scheduled_date = ?"
        params.append(scheduled_date)
    sql += " ORDER BY done ASC, scheduled_date ASC NULLS LAST, start_time ASC NULLS LAST, sort_order ASC, created_at ASC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [row_to_task(r) for r in rows]


@router.post("/api/tasks", response_model=TaskOut, status_code=201)
def create_task(body: TaskCreate):
    title = body.title.strip()
    if not title:
        raise HTTPException(400, detail="title is required")
    task_id = str(uuid.uuid4())[:8]
    with get_conn() as conn:
        max_sort = conn.execute("SELECT COALESCE(MAX(sort_order), 0) AS m FROM tasks").fetchone()
        sort_order = (max_sort["m"] or 0) + 1
        conn.execute(
            """INSERT INTO tasks
               (id, title, scheduled_date, start_time, end_time, duration_minutes, sort_order, priority, description)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (task_id, title, body.scheduled_date, body.start_time, body.end_time,
             body.duration_minutes, sort_order, body.priority, body.description),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
    return row_to_task(row)


@router.patch("/api/tasks/{task_id}", response_model=TaskOut)
def update_task(task_id: str, body: TaskUpdate):
    fields: dict = {}
    for name in body.model_fields_set:
        fields[name] = getattr(body, name)
    if not fields:
        raise HTTPException(400, detail="Nothing to update")

    with get_conn() as conn:
        existing = conn.execute("SELECT done FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not existing:
            raise HTTPException(404, detail="Task not found")

        if "done" in fields:
            new_done = bool(fields["done"])
            fields["done"] = 1 if new_done else 0
            prev_done = bool(existing["done"])
            if new_done and not prev_done:
                fields["completed_at"] = utcnow_iso_z()
                # Fecha sessão aberta — evita banner piscando e 409 ao iniciar outra.
                conn.execute(
                    "UPDATE task_sessions SET ended_at = ? WHERE task_id = ? AND ended_at IS NULL",
                    (utcnow_iso_z(), task_id),
                )
            elif not new_done and prev_done:
                fields["completed_at"] = None

        fields["updated_at"] = utcnow_iso_z()
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE tasks SET {set_clause} WHERE id = ?",
            [*fields.values(), task_id],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
    return row_to_task(row)


@router.delete("/api/tasks/{task_id}", status_code=204)
def delete_task(task_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
    return None


@router.post("/api/tasks/{task_id}/toggle", response_model=TaskOut)
def toggle_task(task_id: str):
    with get_conn() as conn:
        row = conn.execute("SELECT done FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(404, detail="Task not found")
        new_done = 0 if row["done"] else 1
        now = utcnow_iso_z()
        completed_at = now if new_done else None
        if new_done:
            conn.execute(
                "UPDATE task_sessions SET ended_at = ? WHERE task_id = ? AND ended_at IS NULL",
                (now, task_id),
            )
        conn.execute(
            "UPDATE tasks SET done = ?, completed_at = ?, updated_at = ? WHERE id = ?",
            (new_done, completed_at, now, task_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
    return row_to_task(row)


# ─── Task Sessions ───────────────────────────────────────────────────────────

@router.get("/api/tasks/{task_id}/sessions", response_model=list[TaskSessionOut])
def list_task_sessions(task_id: str):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM task_sessions WHERE task_id = ? ORDER BY session_num ASC",
            (task_id,),
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/api/tasks/{task_id}/sessions/start", response_model=TaskSessionOut, status_code=201)
def task_start_session(task_id: str):
    """Idempotente: se já existe sessão aberta desta task, devolve ela em
    vez de criar duplicada. Evita rows órfãs em race de double-click."""
    now = utcnow_iso_z()
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM tasks WHERE id = ?", (task_id,)).fetchone():
            raise HTTPException(404, detail="Task not found")
        existing = conn.execute(
            "SELECT * FROM task_sessions WHERE task_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
            (task_id,),
        ).fetchone()
        if existing:
            return dict(existing)
        active = find_active_session(conn, exclude_type="task", exclude_id=task_id)
        if active:
            raise HTTPException(409, detail=active["title"])

        last = conn.execute(
            "SELECT MAX(session_num) AS num FROM task_sessions WHERE task_id = ?",
            (task_id,),
        ).fetchone()
        session_num = (last["num"] or 0) + 1

        conn.execute(
            "INSERT INTO task_sessions(task_id, session_num, started_at) VALUES (?, ?, ?)",
            (task_id, session_num, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM task_sessions WHERE task_id = ? AND session_num = ?",
            (task_id, session_num),
        ).fetchone()
    return dict(row)


@router.post("/api/tasks/{task_id}/sessions/pause", response_model=TaskSessionOut)
def task_pause_session(task_id: str):
    """Pausa a sessão aberta da task. Idempotente: sem ativa, retorna a
    última sessão (200) em vez de 404. Mesma motivação dos endpoints de
    quest/routine — evita o banner explodir com state ligeiramente stale."""
    now = utcnow_iso_z()
    with get_conn() as conn:
        session = conn.execute(
            "SELECT * FROM task_sessions WHERE task_id = ? AND ended_at IS NULL ORDER BY session_num DESC LIMIT 1",
            (task_id,),
        ).fetchone()
        if session:
            conn.execute("UPDATE task_sessions SET ended_at = ? WHERE id = ?", (now, session["id"]))
            conn.commit()
            row = conn.execute("SELECT * FROM task_sessions WHERE id = ?", (session["id"],)).fetchone()
            return dict(row)
        last = conn.execute(
            "SELECT * FROM task_sessions WHERE task_id = ? ORDER BY session_num DESC LIMIT 1",
            (task_id,),
        ).fetchone()
        if last:
            return dict(last)
        raise HTTPException(404, detail="Task has no sessions")


@router.post("/api/tasks/{task_id}/sessions/resume", response_model=TaskSessionOut, status_code=201)
def task_resume_session(task_id: str):
    """Idempotente: double-click no resume não cria 2 sub-sessões."""
    now = utcnow_iso_z()
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM tasks WHERE id = ?", (task_id,)).fetchone():
            raise HTTPException(404, detail="Task not found")
        existing = conn.execute(
            "SELECT * FROM task_sessions WHERE task_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
            (task_id,),
        ).fetchone()
        if existing:
            return dict(existing)
        active = find_active_session(conn, exclude_type="task", exclude_id=task_id)
        if active:
            raise HTTPException(409, detail=active["title"])

        last = conn.execute(
            "SELECT MAX(session_num) AS num FROM task_sessions WHERE task_id = ?",
            (task_id,),
        ).fetchone()
        session_num = (last["num"] or 0) + 1
        conn.execute(
            "INSERT INTO task_sessions(task_id, session_num, started_at) VALUES (?, ?, ?)",
            (task_id, session_num, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM task_sessions WHERE task_id = ? AND session_num = ?",
            (task_id, session_num),
        ).fetchone()
    return dict(row)


@router.post("/api/tasks/{task_id}/sessions/stop", response_model=TaskOut)
def task_stop_session(task_id: str):
    """Fecha qualquer sessão ativa desta task e marca a task como done."""
    now = utcnow_iso_z()
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM tasks WHERE id = ?", (task_id,)).fetchone():
            raise HTTPException(404, detail="Task not found")
        session = conn.execute(
            "SELECT id FROM task_sessions WHERE task_id = ? AND ended_at IS NULL ORDER BY session_num DESC LIMIT 1",
            (task_id,),
        ).fetchone()
        if session:
            conn.execute("UPDATE task_sessions SET ended_at = ? WHERE id = ?", (now, session["id"]))
        conn.execute(
            "UPDATE tasks SET done = 1, completed_at = ?, updated_at = ? WHERE id = ?",
            (now, now, task_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
    return row_to_task(row)


# ─── Edição manual de sessão (correção retroativa) ─────────────────────────

@router.patch("/api/task-sessions/{session_id}")
def edit_task_session(session_id: int, body: SessionEdit):
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(400, detail="Nada pra atualizar")

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM task_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Sessão não encontrada")

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
            f"UPDATE task_sessions SET {set_clause} WHERE id = ?",
            [*fields.values(), session_id],
        )
        conn.commit()

        row = conn.execute(
            "SELECT * FROM task_sessions WHERE id = ?", (session_id,)
        ).fetchone()

        overlaps = []
        if row["ended_at"]:
            overlaps = conn.execute(
                """SELECT id FROM task_sessions
                   WHERE task_id = ? AND id != ?
                     AND ended_at IS NOT NULL
                     AND started_at < ?
                     AND ended_at > ?""",
                (existing["task_id"], session_id, row["ended_at"], row["started_at"]),
            ).fetchall()

    return {**dict(row), "overlap_warning": len(overlaps) > 0}


@router.delete("/api/task-sessions/{session_id}", status_code=204)
def delete_task_session(session_id: int):
    with get_conn() as conn:
        res = conn.execute("DELETE FROM task_sessions WHERE id = ?", (session_id,))
        if res.rowcount == 0:
            raise HTTPException(404, detail="Sessão não encontrada")
        conn.commit()
    return None
