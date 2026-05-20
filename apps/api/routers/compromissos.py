"""Compromissos — horas improdutivas planejadas (corte de cabelo, terapia,
consulta). Read-only no /exec, alerta sticky no dashboard, criados via
/calendario com suporte a recorrência opcional (semanal/mensal).

Sem play/pause: filosofia é visualização. Não consome capacity de período.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from db import get_conn

router = APIRouter(prefix="/api/compromissos", tags=["compromissos"])


# ─── Models ──────────────────────────────────────────────────────────────


class CompromissoOut(BaseModel):
    id: str
    title: str
    notes: Optional[str] = None
    start_date: str                          # YYYY-MM-DD
    start_time: str                          # HH:MM
    end_time: str                            # HH:MM
    recurrence: str = "none"                 # 'none'|'weekly'|'monthly'
    days_of_week: Optional[list[int]] = None # 0=Dom, 6=Sab
    day_of_month: Optional[int] = None       # 1-31
    end_date: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class CompromissoCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    notes: Optional[str] = Field(None, max_length=2000)
    start_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    start_time: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    end_time: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    recurrence: str = "none"
    days_of_week: Optional[list[int]] = None
    day_of_month: Optional[int] = Field(None, ge=1, le=31)
    end_date: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class CompromissoUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    notes: Optional[str] = Field(None, max_length=2000)
    start_date: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    start_time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    end_time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    recurrence: Optional[str] = None
    days_of_week: Optional[list[int]] = None
    day_of_month: Optional[int] = Field(None, ge=1, le=31)
    end_date: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class CompromissoOccurrence(BaseModel):
    """Uma ocorrência expandida de um compromisso num intervalo de datas.
    Pra recorrentes, retorna N ocorrências; pra únicos, 1."""
    id: str                                  # id do compromisso pai
    date: str                                # YYYY-MM-DD da ocorrência
    title: str
    start_time: str
    end_time: str
    notes: Optional[str] = None
    recurrence: str
    # True quando é a primeira ocorrência (start_date original)
    is_first: bool = False


# ─── Helpers ─────────────────────────────────────────────────────────────


def _row_to_dict(r) -> dict:
    """Converte row do SQLite pra dict serializável (CSV → list, etc)."""
    d = dict(r)
    dow_raw = d.pop("days_of_week", None)
    if dow_raw:
        try:
            d["days_of_week"] = [int(x) for x in str(dow_raw).split(",") if x.strip()]
        except (ValueError, TypeError):
            d["days_of_week"] = None
    else:
        d["days_of_week"] = None
    return d


def _parse_ymd(s: str) -> date:
    return date.fromisoformat(s)


def _ymd(d: date) -> str:
    return d.isoformat()


def _expand_occurrences(c: dict, range_from: date, range_to: date) -> list[dict]:
    """Expande um compromisso em ocorrências no intervalo [from, to].

    - recurrence='none': 1 ocorrência se start_date cair no intervalo.
    - recurrence='weekly': repete em cada day_of_week dentro do intervalo,
      respeitando start_date como início e end_date como fim.
    - recurrence='monthly': repete no day_of_month a cada mês entre
      start_date e end_date.
    """
    start = _parse_ymd(c["start_date"])
    end = _parse_ymd(c["end_date"]) if c.get("end_date") else None

    # Início efetivo = max(start_date do compromisso, range_from).
    cursor = max(start, range_from)
    # Fim efetivo = min(end_date ou range_to).
    series_end = min(end, range_to) if end else range_to
    if cursor > series_end:
        return []

    out: list[dict] = []

    if c["recurrence"] == "none":
        if range_from <= start <= range_to:
            out.append({
                "id": c["id"],
                "date": _ymd(start),
                "title": c["title"],
                "start_time": c["start_time"],
                "end_time": c["end_time"],
                "notes": c.get("notes"),
                "recurrence": "none",
                "is_first": True,
            })
        return out

    if c["recurrence"] == "weekly":
        days = c.get("days_of_week") or []
        if not days:
            return []
        # Itera dia-a-dia no range, inclui se weekday() ∈ days.
        # Python weekday: 0=Mon..6=Sun. Nós usamos 0=Dom..6=Sab.
        # Conversão: py_weekday = (our_weekday - 1) % 7 → 0=Dom vira 6 em py.
        # Simpler: our 0=Sun, 1=Mon...6=Sat. Python: 0=Mon...6=Sun.
        # Nossa convenção: 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sab.
        # Python: 0=Seg ... 6=Dom. Conversão: nosso = (py + 1) % 7.
        d = cursor
        days_set = set(days)
        while d <= series_end:
            our_dow = (d.weekday() + 1) % 7
            if our_dow in days_set and d >= start:
                out.append({
                    "id": c["id"],
                    "date": _ymd(d),
                    "title": c["title"],
                    "start_time": c["start_time"],
                    "end_time": c["end_time"],
                    "notes": c.get("notes"),
                    "recurrence": "weekly",
                    "is_first": d == start,
                })
            d += timedelta(days=1)
        return out

    if c["recurrence"] == "monthly":
        dom = c.get("day_of_month")
        if not dom:
            return []
        # Itera por mês entre start.month e series_end.month, gera data
        # com day=dom (clamp pro último dia do mês se dom > último).
        year, month = start.year, start.month
        while True:
            try:
                d = date(year, month, dom)
            except ValueError:
                # dom > último dia do mês — pula
                d = None
            if d is not None and range_from <= d <= series_end and d >= start:
                out.append({
                    "id": c["id"],
                    "date": _ymd(d),
                    "title": c["title"],
                    "start_time": c["start_time"],
                    "end_time": c["end_time"],
                    "notes": c.get("notes"),
                    "recurrence": "monthly",
                    "is_first": d == start,
                })
            # avança 1 mês
            month += 1
            if month > 12:
                month = 1
                year += 1
            if date(year, month, 1) > series_end:
                break
        return out

    return out


# ─── Endpoints ───────────────────────────────────────────────────────────


@router.get("", response_model=list[CompromissoOut])
def list_compromissos():
    """Lista todos os compromissos cadastrados (sem expandir recorrência)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM compromissos ORDER BY start_date DESC, start_time ASC"
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.get("/occurrences", response_model=list[CompromissoOccurrence])
def list_occurrences(
    from_: str = Query(..., alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    to_: str = Query(..., alias="to", pattern=r"^\d{4}-\d{2}-\d{2}$"),
):
    """Expande recorrências de compromissos em ocorrências individuais no
    intervalo [from, to]. Usado pelo /dashboard (próximos 3 dias) e pelo
    /calendario (mês/semana). Ordenado por (data, horário).
    """
    range_from = _parse_ymd(from_)
    range_to = _parse_ymd(to_)
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM compromissos").fetchall()
    out: list[dict] = []
    for r in rows:
        c = _row_to_dict(r)
        out.extend(_expand_occurrences(c, range_from, range_to))
    out.sort(key=lambda x: (x["date"], x["start_time"]))
    return out


@router.post("", response_model=CompromissoOut, status_code=201)
def create_compromisso(body: CompromissoCreate):
    if body.recurrence not in ("none", "weekly", "monthly"):
        raise HTTPException(422, detail="recurrence inválida")
    if body.recurrence == "weekly" and not body.days_of_week:
        raise HTTPException(422, detail="weekly requer days_of_week")
    if body.recurrence == "monthly" and not body.day_of_month:
        raise HTTPException(422, detail="monthly requer day_of_month")
    # Validação simples: end_time > start_time. Cross-midnight raro pra
    # compromissos do dia, não tratado.
    if body.end_time <= body.start_time:
        raise HTTPException(422, detail="end_time deve ser depois de start_time")
    cid = str(uuid.uuid4())[:8]
    dow_csv = ",".join(str(d) for d in body.days_of_week) if body.days_of_week else None
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO compromissos(id, title, notes, start_date, start_time,
                                        end_time, recurrence, days_of_week,
                                        day_of_month, end_date)
               VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (cid, body.title, body.notes, body.start_date, body.start_time,
             body.end_time, body.recurrence, dow_csv, body.day_of_month,
             body.end_date),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM compromissos WHERE id = ?", (cid,)).fetchone()
    return _row_to_dict(row)


@router.patch("/{compromisso_id}", response_model=CompromissoOut)
def update_compromisso(compromisso_id: str, body: CompromissoUpdate):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, detail="Nada pra atualizar")
    if "days_of_week" in fields:
        dow = fields.pop("days_of_week")
        fields["days_of_week"] = ",".join(str(d) for d in dow) if dow else None
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    fields_with_updated = {**fields, "updated_at": datetime.utcnow().isoformat()}
    set_clause = ", ".join(f"{k} = ?" for k in fields_with_updated)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE compromissos SET {set_clause} WHERE id = ?",
            [*fields_with_updated.values(), compromisso_id],
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Compromisso não encontrado")
        conn.commit()
        row = conn.execute("SELECT * FROM compromissos WHERE id = ?", (compromisso_id,)).fetchone()
    return _row_to_dict(row)


@router.delete("/{compromisso_id}", status_code=204)
def delete_compromisso(compromisso_id: str):
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM compromissos WHERE id = ?", (compromisso_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Compromisso não encontrado")
        conn.commit()
