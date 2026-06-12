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

    Resiliente a drift de schema: tabela que não existe mais (ex.:
    `profile`, legado) é PULADA e listada em `_meta.skipped_tables` em vez
    de derrubar o export inteiro com 500 — foi exatamente esse 500 que
    deixou este router órfão (sem registro no main.py) até 2026-06-12.
    """
    with get_conn() as conn:
        existing = {
            r["name"]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        skipped: list[str] = []

        def table(name: str) -> list[dict[str, Any]]:
            if name not in existing:
                skipped.append(name)
                return []
            return _rows(conn, f"SELECT * FROM {name}")

        payload = {
            "_meta": {
                "exported_at": datetime.datetime.now(datetime.UTC).isoformat(),
                "api_version": API_VERSION,
                "format_version": 1,
            },
            "profile": table("profile"),
            "areas": table("areas"),
            "projects": table("projects"),
            "deliverables": table("deliverables"),
            "quests": table("quests"),
            "quest_sessions": table("quest_sessions"),
            "tasks": table("tasks"),
            "task_sessions": table("task_sessions"),
            "subtasks": table("subtasks"),
            "routines": table("routines"),
            "routine_sessions": table("routine_sessions"),
            "routine_logs": table("routine_logs"),
            "micro_tasks": table("micro_tasks"),
            # Hub Finance
            "fin_account": table("fin_account"),
            "fin_category": table("fin_category"),
            "fin_transaction": table("fin_transaction"),
            "fin_categorization_rule": table("fin_categorization_rule"),
            "fin_invoice": table("fin_invoice"),
            "fin_client": table("fin_client"),
            "fin_parcela": table("fin_parcela"),
            "fin_debt": table("fin_debt"),
            "fin_debt_parcela": table("fin_debt_parcela"),
            "fin_recurring_bill": table("fin_recurring_bill"),
            # Hub Build
            "build_purpose": table("build_purpose"),
            "build_purpose_principle": table("build_purpose_principle"),
            "build_vision": table("build_vision"),
            "build_settings": table("build_settings"),
            "build_goal": table("build_goal"),
            "build_goal_area": table("build_goal_area"),
            "build_project_goal": table("build_project_goal"),
            "build_sprint": table("build_sprint"),
            "build_goal_dependency": table("build_goal_dependency"),
            "build_ritual": table("build_ritual"),
            "build_ritual_session": table("build_ritual_session"),
            "build_goal_guardrail": table("build_goal_guardrail"),
            # Hub Health
            "health_domain": table("health_domain"),
            "health_item": table("health_item"),
            "health_record": table("health_record"),
            "health_settings": table("health_settings"),
            # Lang Lab — fila FSRS é time-sensitive: este export é o caminho
            # de backup/migração entre máquinas (PLAN §13.3). Áudios TTS são
            # regeneráveis (frente+voz estão aqui); uploads de media/ não
            # entram (backup manual).
            "lang_language": table("lang_language"),
            "lang_source": table("lang_source"),
            "lang_card": table("lang_card"),
            "lang_review": table("lang_review"),
            "lang_session": table("lang_session"),
            "lang_piece": table("lang_piece"),
            "lang_ask": table("lang_ask"),
            "lang_analysis": table("lang_analysis"),
            "lang_settings": table("lang_settings"),
        }
        payload["_meta"]["skipped_tables"] = skipped
    today = datetime.date.today().isoformat()
    return JSONResponse(
        content=payload,
        headers={
            "Content-Disposition": f'attachment; filename="mainframe-export-{today}.json"',
        },
    )
