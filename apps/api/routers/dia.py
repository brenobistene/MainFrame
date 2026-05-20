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
    # done = record do dia existe AND não há cluster ativo. Após REABRIR
    # (que descola cluster mas mantém record), done volta a false porque
    # cluster está ativo — user pode continuar/finalizar de novo.
    done: bool = False
    # ID do health_record do dia (se existe) — frontend usa pra upsert no
    # FINALIZE, evitando criar record novo quando já tem um (mesma entrada,
    # outra sessão).
    existing_record_id: Optional[int] = None


@router.get("/pendencias", response_model=list[PendenciaOut])
def list_pendencias(
    data: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
):
    """Pendências do dia, com flag `done` pra itens já registrados.

    Itens done continuam no retorno (paridade com quest/task/rotina, que
    permanecem visíveis riscados após conclusão). Frontend filtra do planner
    mas mantém renderizando no dayPlan.

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
        # ID do record do dia (se existe) — pro frontend upsert no FINALIZE.
        mind_rec_row = conn.execute(
            "SELECT id FROM health_record WHERE domain_slug = 'mind' "
            "AND data = ? ORDER BY id DESC LIMIT 1",
            (data,),
        ).fetchone()
        mind_rec_id = mind_rec_row["id"] if mind_rec_row else None
        # Cluster ativo (rows com record_id IS NULL): user pode estar
        # rodando/pausado OU acabou de reabrir o record (descolou cluster).
        has_active_cluster = conn.execute(
            "SELECT 1 FROM mind_session WHERE record_id IS NULL LIMIT 1"
        ).fetchone()
        # done = record existe E NÃO há cluster ativo. Pós-REABRIR o cluster
        # volta ativo → done=false (mesmo com record existindo).
        mind_done = bool(mind_rec_id) and not bool(has_active_cluster)
        # Inclui Mind se: diário ativado, record do dia, ou cluster ativo.
        if (
            (settings and settings["mind_diario"])
            or mind_rec_id
            or has_active_cluster
        ):
            out.append(
                {
                    "origem": "mind",
                    "pendencia_id": "mind",
                    "titulo": "Meditar",
                    "duracao_min": (settings["mind_duracao_media_min"] if settings else None)
                    or 20,
                    "horario_sugerido": settings["mind_horario_sugerido"] if settings else None,
                    "cor": "#9b88c4",
                    "modal_type": "mind",
                    "target": {},
                    "done": mind_done,
                    "existing_record_id": mind_rec_id,
                }
            )

        # ─── Health items ────────────────────────────────────────────────
        # JOIN com health_domain pra pegar cor + slug pro modal_type. Inclui:
        #  - Items com diario=1 (sempre — pendência diária)
        #  - Items com record hoje (mostra struck-through)
        #  - Items com cluster ativo (record_id IS NULL) — após REABRIR, o
        #    cluster volta a esse estado, então sem essa cláusula o item
        #    sumiria do dayPlan
        #  - Items com cluster linkado a record do dia (cobre janela entre
        #    link e refetch)
        items = conn.execute(
            """SELECT DISTINCT i.id, i.nome, i.diario, i.duracao_media_min,
                      i.horario_sugerido, i.cor AS item_cor,
                      d.slug AS domain_slug, d.nome AS domain_nome,
                      d.cor AS domain_cor, d.template AS domain_template
               FROM health_item i
               JOIN health_domain d ON d.slug = i.domain_slug
               LEFT JOIN health_record hr
                 ON hr.item_id = i.id AND hr.data = ?
               LEFT JOIN health_item_session his
                 ON his.item_id = i.id
                 AND (
                   his.record_id IS NULL
                   OR his.record_id IN (
                     SELECT id FROM health_record
                     WHERE item_id = i.id AND data = ?
                   )
                 )
               WHERE i.arquivado = 0
                 AND d.ativo = 1
                 AND (i.diario = 1 OR hr.id IS NOT NULL OR his.id IS NOT NULL)
               ORDER BY i.horario_sugerido, i.nome""",
            (data, data),
        ).fetchall()
        for it in items:
            # ID do record do dia (se existe) — frontend usa pra upsert.
            rec_row = conn.execute(
                "SELECT id FROM health_record "
                "WHERE item_id = ? AND data = ? ORDER BY id DESC LIMIT 1",
                (it["id"], data),
            ).fetchone()
            rec_id = rec_row["id"] if rec_row else None
            # Cluster ativo desse item? (rows com record_id IS NULL)
            has_active = conn.execute(
                "SELECT 1 FROM health_item_session "
                "WHERE item_id = ? AND record_id IS NULL LIMIT 1",
                (it["id"],),
            ).fetchone()
            # done = record existe E não há cluster ativo. Pós-REABRIR o
            # cluster volta ativo → done=false (com record ainda existindo).
            item_done = bool(rec_id) and not bool(has_active)
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
                    "done": item_done,
                    "existing_record_id": rec_id,
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


# NOTE: endpoint antigo /pendencias/{id}/reopen removido. Substituído por
# rotas específicas em dia_sessions.py que mantêm o record (descolam só o
# cluster) — semântica "outra sessão da mesma entrada". Frontend dispatcher
# (api.ts reopenDiaPendencia) roteia pra /mind/session/reopen ou
# /health/items/{id}/session/reopen.
