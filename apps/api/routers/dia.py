"""Endpoints do /Dia — pendências de execução agendada.

`GET /api/dia/pendencias?data=YYYY-MM-DD` agrega o que precisa rolar nesse
dia e ainda não rolou:
  - Mind se `health_settings.mind_diario=True` e nenhuma sessão hoje
  - Cada `health_item` ativo com `diario=True` sem record hoje

V0: só recorrência `daily`. Weekdays/weekly/Nx-por-semana entram depois.

Cada pendência traz:
  - origem: identificador estável ("mind" | "health_item:<id>")
  - titulo: nome amigável pra exibir no card
  - duracao_min: hint pra capacity check do /Dia
  - horario_sugerido: opcional, alinha com block (manhã/tarde/noite)
  - cor: accent visual (vem do domain pra health, fixed roxo pra Mind)
  - modal_type: qual modal abrir no execute ('mind' | 'health_register')
  - target: refs específicos do modal (e.g., domain_slug + item_id)
"""
from __future__ import annotations

from datetime import date as _date
from typing import Any, Literal, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

from db import get_conn

router = APIRouter(prefix="/api/dia", tags=["dia"])


PendenciaOrigem = Literal["mind", "health_item"]
PendenciaModalType = Literal["mind", "health_register"]


class PendenciaOut(BaseModel):
    origem: PendenciaOrigem
    # ID estável usado pelo frontend pra colocar em dayPlan (localStorage).
    # Formato: "mind" pra Mind, "health_item:<id>" pra health items.
    pendencia_id: str
    titulo: str
    duracao_min: Optional[int] = None
    horario_sugerido: Optional[str] = None
    cor: Optional[str] = None
    modal_type: PendenciaModalType
    # Refs adicionais que o frontend usa pra abrir o modal correto
    target: dict[str, Any] = {}


@router.get("/pendencias", response_model=list[PendenciaOut])
def list_pendencias(
    data: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
):
    """Pendências do dia. Cada item já foi feito hoje desaparece da lista.

    Validação de data: formato YYYY-MM-DD. Não restringimos a "hoje" porque
    o frontend pode pedir pendências de qualquer dia (planejamento, review
    retroativo). A lógica "se foi feito" sempre olha records do mesmo dia.
    """
    out: list[dict] = []
    with get_conn() as conn:
        # ─── Mind ─────────────────────────────────────────────────────────
        settings = conn.execute(
            "SELECT mind_diario, mind_duracao_media_min, mind_horario_sugerido "
            "FROM health_settings WHERE id = 1"
        ).fetchone()
        if settings and settings["mind_diario"]:
            # Mind session do dia? Olha health_record com domain 'mind' (Mind
            # sessions são persistidas como health_record com template
            # observacao_estruturada, doc: ARCHITECTURE §3).
            already = conn.execute(
                "SELECT 1 FROM health_record WHERE domain_slug = 'mind' "
                "AND data = ? LIMIT 1",
                (data,),
            ).fetchone()
            if not already:
                out.append(
                    {
                        "origem": "mind",
                        "pendencia_id": "mind",
                        "titulo": "Meditar",
                        "duracao_min": settings["mind_duracao_media_min"]
                        or 20,
                        "horario_sugerido": settings["mind_horario_sugerido"],
                        "cor": "#9b88c4",
                        "modal_type": "mind",
                        "target": {},
                    }
                )

        # ─── Health items com diario=True ─────────────────────────────────
        # JOIN com health_domain pra pegar cor + slug pro modal_type. Filtra
        # items arquivados e items de domínio inativo. ON record: same item
        # já tem record na data?
        items = conn.execute(
            """SELECT i.id, i.nome, i.diario, i.duracao_media_min,
                      i.horario_sugerido, i.cor AS item_cor,
                      d.slug AS domain_slug, d.nome AS domain_nome,
                      d.cor AS domain_cor, d.template AS domain_template
               FROM health_item i
               JOIN health_domain d ON d.slug = i.domain_slug
               WHERE i.diario = 1
                 AND i.arquivado = 0
                 AND d.ativo = 1
               ORDER BY i.horario_sugerido, i.nome"""
        ).fetchall()
        for it in items:
            # Foi registrado hoje?
            done = conn.execute(
                "SELECT 1 FROM health_record "
                "WHERE item_id = ? AND data = ? LIMIT 1",
                (it["id"], data),
            ).fetchone()
            if done:
                continue
            cor = it["item_cor"] or it["domain_cor"]
            out.append(
                {
                    "origem": "health_item",
                    "pendencia_id": f"health_item:{it['id']}",
                    "titulo": it["nome"],
                    "duracao_min": it["duracao_media_min"],
                    "horario_sugerido": it["horario_sugerido"],
                    "cor": cor,
                    "modal_type": "health_register",
                    "target": {
                        "domain_slug": it["domain_slug"],
                        "domain_nome": it["domain_nome"],
                        "domain_template": it["domain_template"],
                        "domain_cor": cor,
                        "item_id": it["id"],
                        "item_nome": it["nome"],
                    },
                }
            )
    return out


# ─── Mind sessions check (helper sem efeito colateral, usado pela UI) ──────


@router.get("/pendencias/done-today")
def done_today_check(data: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")):
    """Helper: lista pendência_ids que JÁ foram feitas no dia. Útil pro
    frontend marcar planned items como concluídos sem precisar refetchar
    a lista completa.

    Retorno: `{ done: ["mind", "health_item:5", ...] }`.
    """
    done_ids: list[str] = []
    with get_conn() as conn:
        # Mind
        if conn.execute(
            "SELECT 1 FROM health_record WHERE domain_slug = 'mind' "
            "AND data = ? LIMIT 1",
            (data,),
        ).fetchone():
            done_ids.append("mind")
        # Health items diários
        rows = conn.execute(
            """SELECT DISTINCT i.id FROM health_item i
               JOIN health_record r ON r.item_id = i.id
               WHERE i.diario = 1 AND r.data = ?""",
            (data,),
        ).fetchall()
        for r in rows:
            done_ids.append(f"health_item:{r['id']}")
    return {"done": done_ids}
