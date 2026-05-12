"""Relatórios de tempo — agrega quest/task/routine sessions em métricas
úteis pra "pra onde foi meu tempo?".

Endpoints:
  GET /api/time-reports/by-area?from&to → soma minutos por área (quests)
  GET /api/time-reports/weekly?weeks=N  → distribuição semanal (N semanas)
"""
from __future__ import annotations

import datetime
from typing import Optional

from fastapi import APIRouter, Query

from db import get_conn

router = APIRouter()


def _minutes_between(start_iso: str, end_iso: Optional[str]) -> int:
    """Calcula minutos entre 2 timestamps ISO. None end_iso = sessão em curso,
    retorna minutos até agora."""
    try:
        start = datetime.datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        if end_iso:
            end = datetime.datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
        else:
            end = datetime.datetime.now(datetime.UTC)
        secs = (end - start).total_seconds()
        return max(0, int(secs / 60))
    except (ValueError, AttributeError):
        return 0


@router.get("/api/time-reports/by-area")
def time_by_area(
    from_: str = Query(..., alias="from", description="YYYY-MM-DD inclusive"),
    to_: str = Query(..., alias="to", description="YYYY-MM-DD inclusive"),
):
    """Soma de minutos por área no período (via quest_sessions).

    Tasks e routines não pertencem a área diretamente, vão pra bucket
    'tasks' e 'routines' respectivamente.
    """
    with get_conn() as conn:
        # Quests por área
        rows = conn.execute(
            """SELECT q.area_slug, qs.started_at, qs.ended_at
               FROM quest_sessions qs JOIN quests q ON q.id = qs.quest_id
               WHERE DATE(qs.started_at) >= ? AND DATE(qs.started_at) <= ?""",
            (from_, to_),
        ).fetchall()
        task_rows = conn.execute(
            "SELECT started_at, ended_at FROM task_sessions "
            "WHERE DATE(started_at) >= ? AND DATE(started_at) <= ?",
            (from_, to_),
        ).fetchall()
        routine_rows = conn.execute(
            "SELECT started_at, ended_at FROM routine_sessions "
            "WHERE DATE(started_at) >= ? AND DATE(started_at) <= ?",
            (from_, to_),
        ).fetchall()
        areas = conn.execute("SELECT slug, name, color FROM areas").fetchall()

    area_meta = {a["slug"]: {"name": a["name"], "color": a["color"]} for a in areas}
    by_bucket: dict = {}
    for r in rows:
        key = r["area_slug"] or "sem-area"
        by_bucket[key] = by_bucket.get(key, 0) + _minutes_between(r["started_at"], r["ended_at"])
    task_min = sum(_minutes_between(r["started_at"], r["ended_at"]) for r in task_rows)
    routine_min = sum(_minutes_between(r["started_at"], r["ended_at"]) for r in routine_rows)

    items = []
    for slug, minutes in by_bucket.items():
        meta = area_meta.get(slug, {"name": slug, "color": None})
        items.append({
            "kind": "area",
            "slug": slug,
            "label": meta["name"],
            "color": meta["color"],
            "minutes": minutes,
        })
    if task_min > 0:
        items.append({"kind": "task", "slug": "tasks", "label": "Tarefas", "color": None, "minutes": task_min})
    if routine_min > 0:
        items.append({"kind": "routine", "slug": "routines", "label": "Rotinas", "color": None, "minutes": routine_min})

    items.sort(key=lambda x: -x["minutes"])
    total = sum(x["minutes"] for x in items)
    return {"from": from_, "to": to_, "total_minutes": total, "items": items}


@router.get("/api/time-reports/weekly")
def time_weekly(weeks: int = Query(8, ge=1, le=52)):
    """Distribuição semanal — minutos totais por semana, últimas N semanas.

    Cada bucket: { week_start, week_end, total_minutes, quest, task, routine }.
    Útil pra heatmap/tendência ("essa semana eu trabalhei mais ou menos?").
    """
    today = datetime.date.today()
    # Semana começa segunda-feira
    days_since_monday = today.weekday()
    this_monday = today - datetime.timedelta(days=days_since_monday)

    buckets = []
    for offset in range(weeks - 1, -1, -1):
        week_start = this_monday - datetime.timedelta(weeks=offset)
        week_end = week_start + datetime.timedelta(days=6)
        buckets.append({
            "week_start": week_start.isoformat(),
            "week_end": week_end.isoformat(),
            "quest": 0,
            "task": 0,
            "routine": 0,
            "total_minutes": 0,
        })

    start_iso = buckets[0]["week_start"]
    end_iso = buckets[-1]["week_end"]

    with get_conn() as conn:
        for table, key in [("quest_sessions", "quest"), ("task_sessions", "task"), ("routine_sessions", "routine")]:
            rows = conn.execute(
                f"SELECT started_at, ended_at FROM {table} "
                "WHERE DATE(started_at) >= ? AND DATE(started_at) <= ?",
                (start_iso, end_iso),
            ).fetchall()
            for r in rows:
                started_date = r["started_at"][:10]
                for b in buckets:
                    if b["week_start"] <= started_date <= b["week_end"]:
                        m = _minutes_between(r["started_at"], r["ended_at"])
                        b[key] += m
                        b["total_minutes"] += m
                        break

    return {"weeks": buckets}
