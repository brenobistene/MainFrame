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
        library_rows = conn.execute(
            "SELECT started_at, ended_at FROM library_session "
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
    library_min = sum(_minutes_between(r["started_at"], r["ended_at"]) for r in library_rows)

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
    if library_min > 0:
        items.append({"kind": "library", "slug": "library", "label": "Library", "color": "#7fb8a8", "minutes": library_min})

    items.sort(key=lambda x: -x["minutes"])
    total = sum(x["minutes"] for x in items)
    return {"from": from_, "to": to_, "total_minutes": total, "items": items}


@router.get("/api/time-reports/closed-items")
def closed_items(
    from_: str = Query(..., alias="from", description="YYYY-MM-DD inclusive"),
    to_: str = Query(..., alias="to", description="YYYY-MM-DD inclusive"),
):
    """Items fechados no período, agrupados pra retrospectiva no /dashboard.

    Resposta tem 4 buckets:
      - `projects`: { id, title, area, completed_at?, quests[], worked_min_total }.
        Inclui projetos com quests fechadas no range (mesmo se o projeto em si
        não fechou) OU projects.completed_at no range. `completed_at` do
        projeto pode ser null quando só as quests dele fecharam.
      - `ungrouped_quests`: quests sem `project_id` (avulsas).
      - `routines`: rotinas com pelo menos 1 routine_log.completed_date no range.
        Cada rotina traz `completions[]` (dia + tempo da sessão correspondente).
      - `tasks`: tasks done no range (sem área, sem agrupamento).

    Filosofia: o user pensa em Projeto → Quest, e Rotina como entidade com
    múltiplas execuções diárias. Expansão fica natural no UI.
    """
    with get_conn() as conn:
        quest_rows = conn.execute(
            """SELECT q.id, q.title, q.area_slug, q.completed_at, q.status,
                      q.project_id,
                      a.name AS area_name, a.color AS area_color,
                      p.title AS project_title,
                      (SELECT COALESCE(SUM(
                          CASE WHEN qs.ended_at IS NOT NULL
                               THEN (julianday(qs.ended_at) - julianday(qs.started_at)) * 24 * 60
                               ELSE 0 END
                       ), 0)
                       FROM quest_sessions qs
                       WHERE qs.quest_id = q.id) AS worked_min
               FROM quests q
               LEFT JOIN areas a ON a.slug = q.area_slug
               LEFT JOIN projects p ON p.id = q.project_id
               WHERE q.completed_at IS NOT NULL
                 AND DATE(q.completed_at) >= ?
                 AND DATE(q.completed_at) <= ?
               ORDER BY q.completed_at DESC""",
            (from_, to_),
        ).fetchall()
        project_rows = conn.execute(
            """SELECT p.id, p.title, p.area_slug, p.completed_at,
                      a.name AS area_name, a.color AS area_color
               FROM projects p
               LEFT JOIN areas a ON a.slug = p.area_slug
               WHERE p.completed_at IS NOT NULL
                 AND DATE(p.completed_at) >= ?
                 AND DATE(p.completed_at) <= ?
               ORDER BY p.completed_at DESC""",
            (from_, to_),
        ).fetchall()
        task_rows = conn.execute(
            """SELECT t.id, t.title, t.completed_at,
                      (SELECT COALESCE(SUM(
                          CASE WHEN ts.ended_at IS NOT NULL
                               THEN (julianday(ts.ended_at) - julianday(ts.started_at)) * 24 * 60
                               ELSE 0 END
                       ), 0)
                       FROM task_sessions ts
                       WHERE ts.task_id = t.id) AS worked_min
               FROM tasks t
               WHERE t.done = 1
                 AND t.completed_at IS NOT NULL
                 AND DATE(t.completed_at) >= ?
                 AND DATE(t.completed_at) <= ?
               ORDER BY t.completed_at DESC""",
            (from_, to_),
        ).fetchall()
        # Rotinas: pega routine_logs no range, joinando com routines pro título.
        # Pra cada (routine, date) tenta achar a duração total da rotina nessa
        # data via routine_sessions.date (vem como YYYY-MM-DD).
        routine_log_rows = conn.execute(
            """SELECT r.id AS routine_id, r.title AS routine_title,
                      rl.completed_date,
                      (SELECT COALESCE(SUM(
                          CASE WHEN rs.ended_at IS NOT NULL
                               THEN (julianday(rs.ended_at) - julianday(rs.started_at)) * 24 * 60
                               ELSE 0 END
                       ), 0)
                       FROM routine_sessions rs
                       WHERE rs.routine_id = r.id AND rs.date = rl.completed_date) AS worked_min
               FROM routine_logs rl
               JOIN routines r ON r.id = rl.routine_id
               WHERE rl.completed_date >= ?
                 AND rl.completed_date <= ?
               ORDER BY rl.completed_date DESC""",
            (from_, to_),
        ).fetchall()

    # ─ Monta dicionário de projects: chave = project_id ─
    projects_by_id: dict[str, dict] = {}
    for r in project_rows:
        projects_by_id[r["id"]] = {
            "id": r["id"],
            "title": r["title"],
            "area_slug": r["area_slug"],
            "area_name": r["area_name"],
            "area_color": r["area_color"],
            "completed_at": r["completed_at"],
            "quests": [],
            "worked_min_total": 0,
        }

    ungrouped_quests: list[dict] = []
    for r in quest_rows:
        q = {
            "id": r["id"],
            "title": r["title"],
            "area_slug": r["area_slug"],
            "area_name": r["area_name"],
            "area_color": r["area_color"],
            "completed_at": r["completed_at"],
            "status": r["status"],
            "worked_min": int(round(r["worked_min"] or 0)),
        }
        pid = r["project_id"]
        if pid:
            # Cria entrada de projeto mesmo se ele não fechou no range — só
            # as quests dele que fecharam. completed_at do project fica null
            # nesse caso.
            if pid not in projects_by_id:
                projects_by_id[pid] = {
                    "id": pid,
                    "title": r["project_title"] or "(sem título)",
                    "area_slug": r["area_slug"],
                    "area_name": r["area_name"],
                    "area_color": r["area_color"],
                    "completed_at": None,
                    "quests": [],
                    "worked_min_total": 0,
                }
            projects_by_id[pid]["quests"].append(q)
            projects_by_id[pid]["worked_min_total"] += q["worked_min"]
        else:
            ungrouped_quests.append(q)

    # Ordena projects: primeiro os com completed_at no range (mais recentes),
    # depois os que só têm quests fechadas (por max completed_at das quests).
    def project_sort_key(p: dict) -> str:
        if p["completed_at"]:
            return p["completed_at"]
        if p["quests"]:
            return max(q["completed_at"] or "" for q in p["quests"])
        return ""
    projects_sorted = sorted(projects_by_id.values(), key=project_sort_key, reverse=True)

    # Rotinas: agrupa logs por routine_id, listando completions
    routines_by_id: dict[str, dict] = {}
    for r in routine_log_rows:
        rid = r["routine_id"]
        if rid not in routines_by_id:
            routines_by_id[rid] = {
                "id": rid,
                "title": r["routine_title"],
                "completions": [],
                "total_min": 0,
            }
        wm = int(round(r["worked_min"] or 0))
        routines_by_id[rid]["completions"].append({
            "date": r["completed_date"],
            "worked_min": wm,
        })
        routines_by_id[rid]["total_min"] += wm
    routines_sorted = sorted(
        routines_by_id.values(),
        key=lambda x: -len(x["completions"]),
    )

    tasks_list: list[dict] = []
    for r in task_rows:
        tasks_list.append({
            "id": r["id"],
            "title": r["title"],
            "completed_at": r["completed_at"],
            "worked_min": int(round(r["worked_min"] or 0)),
        })

    totals = {
        "quests_done": len(quest_rows),
        "projects_done": len(project_rows),
        "routines_completions": sum(len(r["completions"]) for r in routines_sorted),
        "tasks_done": len(tasks_list),
    }
    return {
        "from": from_,
        "to": to_,
        "projects": projects_sorted,
        "ungrouped_quests": ungrouped_quests,
        "routines": routines_sorted,
        "tasks": tasks_list,
        "totals": totals,
    }


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
            "library": 0,
            "total_minutes": 0,
        })

    start_iso = buckets[0]["week_start"]
    end_iso = buckets[-1]["week_end"]

    with get_conn() as conn:
        for table, key in [
            ("quest_sessions", "quest"),
            ("task_sessions", "task"),
            ("routine_sessions", "routine"),
            ("library_session", "library"),
        ]:
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
