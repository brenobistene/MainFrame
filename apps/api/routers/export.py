"""Export completo dos dados do usuário em JSON.

Endpoint único que dumpa o estado inteiro do DB pra um JSON downloadable.
Útil pra:
  - Backup manual antes de migrations grandes
  - Migração entre máquinas (PC pessoal ↔ notebook corporate)
  - Inspeção / debug do estado

Não inclui dados de calendar (são derivados do Google), sessions
históricas detalhadas (peso grande), nem tabelas operacionais (logs de
migration). Foca no que o usuário criou.
"""
from __future__ import annotations

import datetime
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from db import get_conn
from services.meta import API_VERSION

router = APIRouter()


def _rows(conn, sql: str) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute(sql).fetchall()]


@router.get("/api/export/all")
def export_all():
    """Dump completo do estado do usuário em JSON.

    Frontend pode pegar isso, gerar download via Blob+createObjectURL e o
    user salva onde quiser (Drive, disco, USB, etc).
    """
    with get_conn() as conn:
        payload = {
            "_meta": {
                "exported_at": datetime.datetime.now(datetime.UTC).isoformat(),
                "api_version": API_VERSION,
                "format_version": 1,
            },
            "profile": _rows(conn, "SELECT * FROM profile"),
            "areas": _rows(conn, "SELECT * FROM areas"),
            "projects": _rows(conn, "SELECT * FROM projects"),
            "deliverables": _rows(conn, "SELECT * FROM deliverables"),
            "quests": _rows(conn, "SELECT * FROM quests"),
            "quest_sessions": _rows(conn, "SELECT * FROM quest_sessions"),
            "tasks": _rows(conn, "SELECT * FROM tasks"),
            "task_sessions": _rows(conn, "SELECT * FROM task_sessions"),
            "subtasks": _rows(conn, "SELECT * FROM subtasks"),
            "routines": _rows(conn, "SELECT * FROM routines"),
            "routine_sessions": _rows(conn, "SELECT * FROM routine_sessions"),
            "routine_logs": _rows(conn, "SELECT * FROM routine_logs"),
            "micro_tasks": _rows(conn, "SELECT * FROM micro_tasks"),
            # Hub Finance
            "fin_account": _rows(conn, "SELECT * FROM fin_account"),
            "fin_category": _rows(conn, "SELECT * FROM fin_category"),
            "fin_transaction": _rows(conn, "SELECT * FROM fin_transaction"),
            "fin_categorization_rule": _rows(conn, "SELECT * FROM fin_categorization_rule"),
            "fin_invoice": _rows(conn, "SELECT * FROM fin_invoice"),
            "fin_client": _rows(conn, "SELECT * FROM fin_client"),
            "fin_parcela": _rows(conn, "SELECT * FROM fin_parcela"),
            "fin_debt": _rows(conn, "SELECT * FROM fin_debt"),
            "fin_debt_parcela": _rows(conn, "SELECT * FROM fin_debt_parcela"),
            "fin_recurring_bill": _rows(conn, "SELECT * FROM fin_recurring_bill"),
            # Hub Build
            "build_purpose": _rows(conn, "SELECT * FROM build_purpose"),
            "build_purpose_principle": _rows(conn, "SELECT * FROM build_purpose_principle"),
            "build_vision": _rows(conn, "SELECT * FROM build_vision"),
            "build_settings": _rows(conn, "SELECT * FROM build_settings"),
            "build_goal": _rows(conn, "SELECT * FROM build_goal"),
            "build_goal_area": _rows(conn, "SELECT * FROM build_goal_area"),
            "build_project_goal": _rows(conn, "SELECT * FROM build_project_goal"),
            "build_sprint": _rows(conn, "SELECT * FROM build_sprint"),
            "build_goal_dependency": _rows(conn, "SELECT * FROM build_goal_dependency"),
            "build_ritual": _rows(conn, "SELECT * FROM build_ritual"),
            "build_ritual_session": _rows(conn, "SELECT * FROM build_ritual_session"),
            "build_goal_guardrail": _rows(conn, "SELECT * FROM build_goal_guardrail"),
            # Hub Health
            "health_domain": _rows(conn, "SELECT * FROM health_domain"),
            "health_item": _rows(conn, "SELECT * FROM health_item"),
            "health_record": _rows(conn, "SELECT * FROM health_record"),
            "health_settings": _rows(conn, "SELECT * FROM health_settings"),
        }
    today = datetime.date.today().isoformat()
    return JSONResponse(
        content=payload,
        headers={
            "Content-Disposition": f'attachment; filename="mainframe-export-{today}.json"',
        },
    )
