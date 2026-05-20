import uuid
from datetime import date, datetime, time, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from db import get_conn
from models.routine import RoutineCreate, RoutineOut, RoutineSessionOut, RoutineUpdate
from services.active_session import find_active_session
from services.calendar_state import calendar_state
from services.utils import parse_iso, utcnow_iso_z


class SessionEdit(BaseModel):
    started_at: Optional[str] = None
    ended_at: Optional[str] = None


router = APIRouter()

SP_TZ = ZoneInfo("America/Sao_Paulo")


def _today_sp_iso() -> str:
    return datetime.now(SP_TZ).date().isoformat()


def _routine_passes_on(r, day: date) -> bool:
    """Se a rotina `r` (row do DB) se aplica ao dia `day`."""
    rec = r["recurrence"]
    weekday = day.weekday()
    if rec == "daily":
        return True
    if rec == "weekdays":
        return weekday < 5
    if rec == "weekly":
        if r["days_of_week"]:
            days = [int(d) for d in r["days_of_week"].split(",") if d.strip()]
            return weekday in days
        return r["day_of_week"] == weekday
    if rec == "monthly":
        return r["day_of_month"] == day.day
    return False


# ─── Routines CRUD ───────────────────────────────────────────────────────────

@router.get("/api/routines", response_model=list[RoutineOut])
def list_routines(target: Optional[str] = None):
    """Lista rotinas relevantes pro dia alvo (default: hoje em SP).

    Inclui:
    - rotinas que aplicam naquele dia da semana/mês (via _routine_passes_on)
    - OU rotinas que TEM log pra essa data (ex: usuário arrastou pro plano
      do dia uma rotina que normalmente não cai hoje e finalizou). Sem essa
      cláusula, o frontend construía doneRoutineIds só com as do schedule
      e a rotina logada off-schedule nunca aparecia como done → card sem
      strike + active_session ficava fantasma.
    """
    day = date.fromisoformat(target) if target else datetime.now(SP_TZ).date()
    date_str = day.isoformat()

    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM routines ORDER BY start_time ASC NULLS LAST"
        ).fetchall()
        logs = {
            r["routine_id"]
            for r in conn.execute(
                "SELECT routine_id FROM routine_logs WHERE completed_date = ?",
                (date_str,),
            ).fetchall()
        }

    result = []
    for r in rows:
        has_log = r["id"] in logs
        if not has_log and not _routine_passes_on(r, day):
            continue
        d = dict(r)
        d["done"] = has_log
        result.append(d)
    return result


@router.get("/api/routines/all", response_model=list[RoutineOut])
def list_all_routines():
    """Lista todas as rotinas, sem filtro de data."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM routines ORDER BY start_time ASC NULLS LAST"
        ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["done"] = False
        result.append(d)
    return result


@router.get("/api/routines/completion-stats")
def routine_completion_stats(
    from_: str = Query(..., alias="from", description="Start date YYYY-MM-DD (local)"),
    to_: str = Query(..., alias="to", description="End date YYYY-MM-DD (local, inclusive)"),
):
    """Agrega esperado x completado de ocorrências de rotina num range de datas.

    Pra cada dia em [from_, to_]:
      - Conta rotinas cuja regra de recorrência casa com aquele dia
        (e cujo created_at é <= aquela data — rotinas novas não penalizam
        dias passados).
      - Conta entradas em routine_logs correspondentes.
    """
    try:
        start = date.fromisoformat(from_)
        end = date.fromisoformat(to_)
    except ValueError:
        raise HTTPException(400, detail="Invalid date format; expected YYYY-MM-DD")
    if end < start:
        raise HTTPException(400, detail="'to' must be >= 'from'")

    with get_conn() as conn:
        routines = conn.execute(
            "SELECT id, recurrence, day_of_week, days_of_week, day_of_month, created_at FROM routines"
        ).fetchall()
        logs = conn.execute(
            "SELECT routine_id, completed_date FROM routine_logs "
            "WHERE completed_date >= ? AND completed_date <= ?",
            (from_, to_),
        ).fetchall()

    log_set = {(row["routine_id"], row["completed_date"]) for row in logs}

    expected = 0
    completed = 0
    per_routine_expected: dict = {}
    per_routine_completed: dict = {}
    days_count = 0

    current = start
    while current <= end:
        days_count += 1
        date_str = current.isoformat()

        for r in routines:
            # Pula rotinas criadas depois desta data.
            if r["created_at"]:
                try:
                    created = date.fromisoformat(r["created_at"][:10])
                    if created > current:
                        continue
                except ValueError:
                    pass

            if not _routine_passes_on(r, current):
                continue

            expected += 1
            per_routine_expected[r["id"]] = per_routine_expected.get(r["id"], 0) + 1
            if (r["id"], date_str) in log_set:
                completed += 1
                per_routine_completed[r["id"]] = per_routine_completed.get(r["id"], 0) + 1

        current += timedelta(days=1)

    rate = (completed / expected) if expected > 0 else 0.0
    return {
        "from": from_,
        "to": to_,
        "days": days_count,
        "expected": expected,
        "completed": completed,
        "rate": round(rate, 4),
    }


@router.post("/api/routines/{routine_id}/toggle", response_model=RoutineOut)
def toggle_routine(routine_id: str, target: Optional[str] = None):
    """Marca/desmarca a rotina como feita no dia alvo.

    Quando marca como done, fecha junto qualquer sessão aberta dessa rotina.
    Sem isso, rotina com play ativo + toggle done virava sessão fantasma:
    `active_session` oculta sessões abertas que têm log do mesmo dia (defesa
    anti-loop do banner), então a row ficava órfã pra sempre — sem banner
    pra parar e bloqueando outros plays via find_active_session.
    """
    day = date.fromisoformat(target) if target else datetime.now(SP_TZ).date()
    date_str = day.isoformat()

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM routines WHERE id = ?", (routine_id,)).fetchone()
        if not row:
            raise HTTPException(404)
        existing = conn.execute(
            "SELECT id FROM routine_logs WHERE routine_id = ? AND completed_date = ?",
            (routine_id, date_str),
        ).fetchone()
        if existing:
            conn.execute(
                "DELETE FROM routine_logs WHERE routine_id = ? AND completed_date = ?",
                (routine_id, date_str),
            )
            done = False
        else:
            conn.execute(
                "INSERT INTO routine_logs(routine_id, completed_date) VALUES(?,?)",
                (routine_id, date_str),
            )
            # Fecha qualquer sessão aberta dessa rotina pra não virar órfã.
            conn.execute(
                "UPDATE routine_sessions SET ended_at = ? WHERE routine_id = ? AND ended_at IS NULL",
                (utcnow_iso_z(), routine_id),
            )
            done = True
        conn.commit()

    d = dict(row)
    d["done"] = done
    return d


def _next_occurrence(body_recurrence: str, days_of_week: Optional[str], day_of_month: Optional[int]) -> date:
    """Próxima data onde uma rotina com essa regra deve aparecer."""
    today = date.today()
    if body_recurrence == "daily":
        return today
    if body_recurrence == "weekdays":
        d = today
        while d.weekday() > 4:
            d += timedelta(days=1)
        return d
    if body_recurrence == "weekly" and days_of_week:
        target_days = [int(d) for d in days_of_week.split(",") if d.strip()]
        d = today
        while d.weekday() not in target_days:
            d += timedelta(days=1)
        return d
    if body_recurrence == "monthly" and day_of_month:
        dom = min(day_of_month, 28)
        candidate = date(today.year, today.month, dom)
        if candidate < today:
            if today.month == 12:
                candidate = date(today.year + 1, 1, dom)
            else:
                candidate = date(today.year, today.month + 1, dom)
        return candidate
    return today


@router.post("/api/routines", response_model=RoutineOut)
def create_routine(body: RoutineCreate):
    routine_id = str(uuid.uuid4())[:8]

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO routines
            (id, title, recurrence, days_of_week, day_of_month, start_time, end_time, estimated_minutes, priority, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                routine_id,
                body.title,
                body.recurrence,
                body.days_of_week,
                body.day_of_month,
                body.start_time,
                body.end_time,
                body.estimated_minutes,
                body.priority,
                body.description,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM routines WHERE id = ?", (routine_id,)).fetchone()

    d = dict(row)
    d["done"] = False

    # Sync opcional com Google Calendar se tem horário.
    cal_svc = calendar_state.svc
    if cal_svc and body.start_time and body.end_time:
        try:
            next_date = _next_occurrence(body.recurrence, body.days_of_week, body.day_of_month)
            start_t = datetime.strptime(body.start_time, "%H:%M").time()
            end_t = datetime.strptime(body.end_time, "%H:%M").time()
            start_dt = datetime.combine(next_date, start_t, tzinfo=SP_TZ)
            end_dt = datetime.combine(next_date, end_t, tzinfo=SP_TZ)
            ev = cal_svc.create_event(summary=body.title, start_at=start_dt, end_at=end_dt)
            with get_conn() as conn:
                conn.execute(
                    "UPDATE routines SET calendar_event_id = ? WHERE id = ?",
                    (ev.event_id, routine_id),
                )
                conn.commit()
            d["calendar_event_id"] = ev.event_id
        except Exception as e:
            print(f"Failed to create calendar event for routine: {e}")

    return d


@router.patch("/api/routines/{routine_id}", response_model=RoutineOut)
def update_routine(routine_id: str, body: RoutineUpdate):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM routines WHERE id = ?", (routine_id,)).fetchone()
        if not row:
            raise HTTPException(404)

        # Só atualiza campos explicitamente enviados (permite clear via null).
        updates: dict = {}
        for field_name in body.model_fields_set:
            updates[field_name] = getattr(body, field_name)

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = [*updates.values(), routine_id]
            conn.execute(f"UPDATE routines SET {set_clause} WHERE id = ?", values)
            conn.commit()

        row = conn.execute("SELECT * FROM routines WHERE id = ?", (routine_id,)).fetchone()

    d = dict(row)
    d["done"] = False

    # Sync com Google Calendar.
    cal_svc = calendar_state.svc
    if cal_svc and row:
        new_start_time = body.start_time if "start_time" in body.model_fields_set else row["start_time"]
        new_end_time = body.end_time if "end_time" in body.model_fields_set else row["end_time"]
        new_title = body.title if "title" in body.model_fields_set else row["title"]
        event_id = row["calendar_event_id"]

        if new_start_time and new_end_time:
            try:
                start_t = datetime.strptime(new_start_time, "%H:%M").time()
                end_t = datetime.strptime(new_end_time, "%H:%M").time()
                today = date.today()
                start_dt = datetime.combine(today, start_t, tzinfo=SP_TZ)
                end_dt = datetime.combine(today, end_t, tzinfo=SP_TZ)

                if event_id:
                    cal_svc.update_event(
                        event_id,
                        summary=new_title,
                        start={"dateTime": start_dt.isoformat(), "timeZone": "America/Sao_Paulo"},
                        end={"dateTime": end_dt.isoformat(), "timeZone": "America/Sao_Paulo"},
                    )
                else:
                    ev = cal_svc.create_event(summary=new_title, start_at=start_dt, end_at=end_dt)
                    with get_conn() as conn:
                        conn.execute(
                            "UPDATE routines SET calendar_event_id = ? WHERE id = ?",
                            (ev.event_id, routine_id),
                        )
                        conn.commit()
                    d["calendar_event_id"] = ev.event_id
            except Exception as e:
                print(f"Failed to update calendar event for routine: {e}")
        elif event_id and (not new_start_time or not new_end_time):
            # Se os horários foram removidos, deleta o evento.
            try:
                cal_svc.delete_event(event_id)
                with get_conn() as conn:
                    conn.execute(
                        "UPDATE routines SET calendar_event_id = NULL WHERE id = ?",
                        (routine_id,),
                    )
                    conn.commit()
                d["calendar_event_id"] = None
            except Exception as e:
                print(f"Failed to delete calendar event for routine: {e}")

    return d


@router.delete("/api/routines/{routine_id}")
def delete_routine(routine_id: str):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM routines WHERE id = ?", (routine_id,)).fetchone()
        if not row:
            raise HTTPException(404)

        cal_svc = calendar_state.svc
        if cal_svc and row["calendar_event_id"]:
            try:
                cal_svc.delete_event(row["calendar_event_id"])
            except Exception as e:
                print(f"Failed to delete calendar event for routine: {e}")

        conn.execute("DELETE FROM routine_logs WHERE routine_id = ?", (routine_id,))
        conn.execute("DELETE FROM routines WHERE id = ?", (routine_id,))
        conn.commit()

    return {"status": "ok"}


# ─── Routine Sessions ────────────────────────────────────────────────────────

@router.get("/api/routines/{routine_id}/sessions", response_model=list[RoutineSessionOut])
def list_routine_sessions(routine_id: str, target: Optional[str] = None):
    sql = "SELECT * FROM routine_sessions WHERE routine_id = ?"
    params: list = [routine_id]
    if target:
        sql += " AND date = ?"
        params.append(target)
    sql += " ORDER BY date ASC, session_num ASC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


@router.post("/api/routines/{routine_id}/sessions/start", response_model=RoutineSessionOut, status_code=201)
def routine_start_session(routine_id: str, target: Optional[str] = None):
    """Inicia uma sessão de rotina.

    Idempotente: se já existe sessão aberta DESTA rotina (ended_at IS NULL),
    devolve ela em vez de criar duplicada. Sem esse guard, double-click do
    botão Play criava 2+ rows órfãs (bug histórico — racetime entre 2 INSERTs
    concorrentes ambos passando pelo find_active_session check).
    """
    now = utcnow_iso_z()
    date_str = target or _today_sp_iso()
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM routines WHERE id = ?", (routine_id,)).fetchone():
            raise HTTPException(404, detail="Routine not found")

        existing = conn.execute(
            "SELECT * FROM routine_sessions WHERE routine_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
            (routine_id,),
        ).fetchone()
        if existing:
            return dict(existing)

        active = find_active_session(conn, exclude_type="routine", exclude_id=routine_id)
        if active:
            raise HTTPException(409, detail=active["title"])

        last = conn.execute(
            "SELECT MAX(session_num) AS num FROM routine_sessions WHERE routine_id = ? AND date = ?",
            (routine_id, date_str),
        ).fetchone()
        session_num = (last["num"] or 0) + 1
        conn.execute(
            "INSERT INTO routine_sessions(routine_id, date, session_num, started_at) VALUES (?, ?, ?, ?)",
            (routine_id, date_str, session_num, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM routine_sessions WHERE routine_id = ? AND date = ? AND session_num = ?",
            (routine_id, date_str, session_num),
        ).fetchone()
    return dict(row)


@router.post("/api/routines/{routine_id}/sessions/pause", response_model=RoutineSessionOut)
def routine_pause_session(routine_id: str, target: Optional[str] = None):
    """Fecha a sessão aberta da rotina, independente da data.

    O `target` (legado) é ignorado — operamos sempre na sessão aberta mais
    recente da rotina. Resolve o bug cross-midnight: usuário inicia 23:55,
    pausa, volta no dia seguinte. Antes o backend procurava sessão de hoje
    e errava 404, deixando a sessão de ontem órfã.

    Idempotente: se não há sessão aberta, retorna a última sessão da
    rotina (status 200) em vez de 404. Banner pode chamar com state
    levemente stale sem explodir.
    """
    now = utcnow_iso_z()
    with get_conn() as conn:
        session = conn.execute(
            "SELECT * FROM routine_sessions WHERE routine_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
            (routine_id,),
        ).fetchone()
        if session:
            conn.execute("UPDATE routine_sessions SET ended_at = ? WHERE id = ?", (now, session["id"]))
            conn.commit()
            row = conn.execute("SELECT * FROM routine_sessions WHERE id = ?", (session["id"],)).fetchone()
            return dict(row)
        # Idempotente: sem sessão ativa, devolve a última sessão da rotina.
        last = conn.execute(
            "SELECT * FROM routine_sessions WHERE routine_id = ? ORDER BY id DESC LIMIT 1",
            (routine_id,),
        ).fetchone()
        if last:
            return dict(last)
        raise HTTPException(404, detail="Routine has no sessions")


@router.post("/api/routines/{routine_id}/sessions/resume", response_model=RoutineSessionOut, status_code=201)
def routine_resume_session(routine_id: str, target: Optional[str] = None):
    """Cria nova sessão pra retomar uma rotina pausada.

    Se `target` for fornecido, usa essa data (preserva o caso DiaPage que
    explicita o dia que está sendo planejado). Caso contrário, usa a data
    da sessão pausada mais recente — assim o usuário que pausou ontem e
    retomou hoje continua na sessão de ontem ao invés de fragmentar em
    duas datas. Fallback final: hoje.
    """
    now = utcnow_iso_z()
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM routines WHERE id = ?", (routine_id,)).fetchone():
            raise HTTPException(404, detail="Routine not found")
        # Idempotente: double-click no resume não cria 2 sub-sessões.
        existing = conn.execute(
            "SELECT * FROM routine_sessions WHERE routine_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
            (routine_id,),
        ).fetchone()
        if existing:
            return dict(existing)
        active = find_active_session(conn, exclude_type="routine", exclude_id=routine_id)
        if active:
            raise HTTPException(409, detail=active["title"])

        if target:
            date_str = target
        else:
            last_paused = conn.execute(
                "SELECT date FROM routine_sessions WHERE routine_id = ? ORDER BY id DESC LIMIT 1",
                (routine_id,),
            ).fetchone()
            date_str = last_paused["date"] if last_paused else _today_sp_iso()

        last = conn.execute(
            "SELECT MAX(session_num) AS num FROM routine_sessions WHERE routine_id = ? AND date = ?",
            (routine_id, date_str),
        ).fetchone()
        session_num = (last["num"] or 0) + 1
        conn.execute(
            "INSERT INTO routine_sessions(routine_id, date, session_num, started_at) VALUES (?, ?, ?, ?)",
            (routine_id, date_str, session_num, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM routine_sessions WHERE routine_id = ? AND date = ? AND session_num = ?",
            (routine_id, date_str, session_num),
        ).fetchone()
    return dict(row)


@router.post("/api/routines/{routine_id}/sessions/stop")
def routine_stop_session(routine_id: str, target: Optional[str] = None):
    """Finaliza a rotina: fecha QUALQUER sessão pendente + insere log.

    Regras:
    - `target` define a data do log (default: hoje em SP). Reflete a INTENÇÃO
      do user — "estou marcando essa rotina como feita hoje", independente
      de quando a sessão começou.
    - Fecha TODAS as sessões ainda abertas (`ended_at IS NULL`) da rotina,
      qualquer data. Sem isso, sessões zumbi (open de dias atrás) impediam
      o banner-fantasma fix do active_session de funcionar.
    - Sessões pausadas (`ended_at` setado) ficam intactas — não muta passado.
    """
    now = utcnow_iso_z()
    date_str = target if target else _today_sp_iso()
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM routines WHERE id = ?", (routine_id,)).fetchone():
            raise HTTPException(404, detail="Routine not found")

        conn.execute(
            "UPDATE routine_sessions SET ended_at = ? "
            "WHERE routine_id = ? AND ended_at IS NULL",
            (now, routine_id),
        )
        conn.execute(
            "INSERT OR IGNORE INTO routine_logs(routine_id, completed_date) VALUES (?, ?)",
            (routine_id, date_str),
        )
        conn.commit()
    return {"status": "ok", "routine_id": routine_id, "date": date_str, "done": True}


# ─── Edição manual de sessão (correção retroativa) ─────────────────────────

@router.patch("/api/routine-sessions/{session_id}")
def edit_routine_session(session_id: int, body: SessionEdit):
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(400, detail="Nada pra atualizar")

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM routine_sessions WHERE id = ?", (session_id,)
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
            f"UPDATE routine_sessions SET {set_clause} WHERE id = ?",
            [*fields.values(), session_id],
        )
        conn.commit()

        row = conn.execute(
            "SELECT * FROM routine_sessions WHERE id = ?", (session_id,)
        ).fetchone()

        overlaps = []
        if row["ended_at"]:
            overlaps = conn.execute(
                """SELECT id FROM routine_sessions
                   WHERE routine_id = ? AND id != ?
                     AND ended_at IS NOT NULL
                     AND started_at < ?
                     AND ended_at > ?""",
                (existing["routine_id"], session_id, row["ended_at"], row["started_at"]),
            ).fetchall()

    return {**dict(row), "overlap_warning": len(overlaps) > 0}


@router.delete("/api/routine-sessions/{session_id}", status_code=204)
def delete_routine_session(session_id: int):
    with get_conn() as conn:
        res = conn.execute("DELETE FROM routine_sessions WHERE id = ?", (session_id,))
        if res.rowcount == 0:
            raise HTTPException(404, detail="Sessão não encontrada")
        conn.commit()
    return None
