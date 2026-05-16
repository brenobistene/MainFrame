"""Endpoints do módulo Hub Health — v0.

Cobre Domain, Item, Record e Settings. Métricas (cidadãs de primeira classe
pra Build consumir) entram em fase próxima.

Filosofia rigorosa de "observação > julgamento": nenhum endpoint cobra
registro, premia constância ou pune ausência. Ver docs/hub-health/PLAN.md.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from db import get_conn
from models.health import (
    DomainCreate,
    DomainOut,
    DomainUpdate,
    ItemCreate,
    ItemOut,
    ItemUpdate,
    MindChallengeOut,
    MindHipoteseOut,
    MindHipoteseUpdate,
    MindPadraoOut,
    MindTagCreate,
    MindTagOut,
    MindTagUpdate,
    RecordCreate,
    RecordOut,
    RecordUpdate,
    SettingsOut,
    SettingsUpdate,
)
from services.health_metrics import (
    calculate_metric,
    list_metrics_catalog,
)
from services.health_pending import compute_pending
from services.utils import utcnow_iso_z

router = APIRouter(prefix="/api/health", tags=["health"])


# ─── Templates suportados (validação de payload por template) ─────────────

VALID_TEMPLATES = {
    "janela_qualidade",
    "atividade_tipo",
    "refeicao_2modos",
    "consumo_vontade",
    "metrica_simples",
    "evento_escala",
    "observacao_estruturada",                          # Mind
}


def _is_int_like(v: Any) -> bool:
    """True se v é int OU float que vale int exato (4.0). JSON pode mandar
    `4.0` legitimamente — antes a validação rejeitava."""
    if isinstance(v, bool):
        return False                                  # bool é subclass de int em Python; rejeitar
    if isinstance(v, int):
        return True
    if isinstance(v, float) and v.is_integer():
        return True
    return False


def _coerce_int(v: Any) -> int:
    """Coerção segura de int (após `_is_int_like`)."""
    return int(v)


def _validate_scale_1_5(v: Any, name: str) -> None:
    """Escala inteira 1-5 (qualidade, intensidade, vontade, escala). Aceita
    int ou float-que-é-int. Null já é tratado pelo caller."""
    if not _is_int_like(v):
        raise HTTPException(422, detail=f"{name} deve ser int 1-5 ou null")
    n = _coerce_int(v)
    if n < 1 or n > 5:
        raise HTTPException(422, detail=f"{name} deve ser int 1-5 ou null")


def _validate_payload(template: str, payload: dict[str, Any], item_id: Optional[int]) -> None:
    """Valida que o payload bate com o template do domínio. Lança 422 em erro.

    Mantém validação simples — só campos obrigatórios e formato básico.
    Aceita float-que-é-int (4.0) onde antes só aceitava int (4).
    """
    if template == "janela_qualidade":
        if "hora_inicio" not in payload or "hora_fim" not in payload:
            raise HTTPException(422, detail="janela_qualidade exige hora_inicio e hora_fim")
        for k in ("hora_inicio", "hora_fim"):
            v = payload[k]
            if not isinstance(v, str) or len(v) != 5 or v[2] != ":":
                raise HTTPException(422, detail=f"{k} deve ser HH:MM, recebido: {v!r}")
        q = payload.get("qualidade")
        if q is not None:
            _validate_scale_1_5(q, "qualidade")
        tipo = payload.get("tipo", "noturno")
        if tipo not in ("noturno", "cochilo"):
            raise HTTPException(422, detail="tipo deve ser 'noturno' ou 'cochilo'")

    elif template == "atividade_tipo":
        if item_id is None:
            raise HTTPException(422, detail="atividade_tipo exige item_id")
        d = payload.get("duracao_min")
        if not _is_int_like(d) or _coerce_int(d) < 0:
            raise HTTPException(422, detail="duracao_min obrigatório (int ≥ 0)")
        i = payload.get("intensidade")
        if i is not None:
            _validate_scale_1_5(i, "intensidade")

    elif template == "refeicao_2modos":
        # Aceita 3 formatos:
        #   1. Agrupado (novo): { refeicoes: [{tipo, ...}, ...] }
        #      - tipo='planned': { item_id, comeu: 'sim'|'parcial'|'nao', horario? }
        #      - tipo='free':    { descricao, horario }   (horario obrigatório)
        #   2. Legado dieta:  { comeu: bool } com item_id no record
        #   3. Legado livre:  { descricao } com item_id=null no record
        refeicoes = payload.get("refeicoes")
        if refeicoes is not None:
            if not isinstance(refeicoes, list):
                raise HTTPException(422, detail="refeicoes deve ser lista")
            for i, ref in enumerate(refeicoes):
                if not isinstance(ref, dict):
                    raise HTTPException(422, detail=f"refeicoes[{i}] deve ser objeto")
                tipo = ref.get("tipo")
                if tipo not in ("planned", "free"):
                    raise HTTPException(
                        422,
                        detail=f"refeicoes[{i}].tipo deve ser 'planned' ou 'free'",
                    )
                horario = ref.get("horario")
                if horario is not None:
                    if not isinstance(horario, str) or len(horario) != 5 or horario[2] != ":":
                        raise HTTPException(
                            422,
                            detail=f"refeicoes[{i}].horario deve ser HH:MM",
                        )
                    try:
                        hh = int(horario[0:2])
                        mm = int(horario[3:5])
                        if hh < 0 or hh > 23 or mm < 0 or mm > 59:
                            raise ValueError
                    except ValueError:
                        raise HTTPException(
                            422,
                            detail=f"refeicoes[{i}].horario inválido",
                        )
                if tipo == "planned":
                    ref_item_id = ref.get("item_id")
                    if not isinstance(ref_item_id, int) or isinstance(ref_item_id, bool):
                        raise HTTPException(
                            422,
                            detail=f"refeicoes[{i}].item_id obrigatório (int) pra tipo='planned'",
                        )
                    comeu = ref.get("comeu")
                    if comeu not in ("sim", "parcial", "nao"):
                        raise HTTPException(
                            422,
                            detail=f"refeicoes[{i}].comeu deve ser 'sim'|'parcial'|'nao'",
                        )
                else:  # tipo == 'free'
                    desc = ref.get("descricao")
                    if not isinstance(desc, str) or not desc.strip():
                        raise HTTPException(
                            422,
                            detail=f"refeicoes[{i}].descricao obrigatória (não-vazia)",
                        )
                    if horario is None:
                        raise HTTPException(
                            422,
                            detail=f"refeicoes[{i}].horario obrigatório pra tipo='free'",
                        )
            # No formato agrupado, item_id do record deve ser null (info está no payload)
            if item_id is not None:
                raise HTTPException(
                    422,
                    detail="modo agrupado (refeicoes[]) requer item_id=null no record",
                )
        elif item_id is None:
            # Legado livre: { descricao }
            desc = payload.get("descricao")
            if not isinstance(desc, str) or not desc.strip():
                raise HTTPException(
                    422,
                    detail="modo livre (sem item_id) exige descricao não-vazia",
                )
        else:
            # Legado dieta: { comeu: bool }
            comeu = payload.get("comeu", True)
            if not isinstance(comeu, bool):
                raise HTTPException(422, detail="comeu deve ser bool")

    elif template == "consumo_vontade":
        if item_id is None:
            raise HTTPException(422, detail="consumo_vontade exige item_id")
        # Aceita dois formatos:
        #   - Legado: { "quantidade": N, "vontade"?: 1-5 }
        #   - Novo (item cigarro): { "eventos": [{"horario": "HH:MM"}, ...], "vontade"?: 1-5 }
        # Pelo menos um dos dois deve estar presente. "eventos" pode ser
        # lista vazia (semantica "vontade sem consumo" do dia).
        eventos = payload.get("eventos")
        if eventos is not None:
            if not isinstance(eventos, list):
                raise HTTPException(422, detail="eventos deve ser lista")
            for i, ev in enumerate(eventos):
                if not isinstance(ev, dict):
                    raise HTTPException(422, detail=f"eventos[{i}] deve ser objeto")
                h = ev.get("horario")
                if not isinstance(h, str) or len(h) != 5 or h[2] != ":":
                    raise HTTPException(422, detail=f"eventos[{i}].horario deve ser HH:MM")
                try:
                    hh = int(h[0:2])
                    mm = int(h[3:5])
                    if hh < 0 or hh > 23 or mm < 0 or mm > 59:
                        raise ValueError
                except ValueError:
                    raise HTTPException(422, detail=f"eventos[{i}].horario inválido")
                # Vontade opcional por evento (escala 1-5).
                v_ev = ev.get("vontade")
                if v_ev is not None:
                    _validate_scale_1_5(v_ev, f"eventos[{i}].vontade")
                # Nota livre opcional por evento (string, max 500 chars).
                nota_ev = ev.get("nota")
                if nota_ev is not None:
                    if not isinstance(nota_ev, str):
                        raise HTTPException(
                            422,
                            detail=f"eventos[{i}].nota deve ser string ou null",
                        )
                    if len(nota_ev) > 500:
                        raise HTTPException(
                            422,
                            detail=f"eventos[{i}].nota muito longa (máx 500 caracteres)",
                        )
        else:
            q = payload.get("quantidade")
            if not isinstance(q, (int, float)) or isinstance(q, bool) or q < 0:
                raise HTTPException(422, detail="quantidade obrigatória (≥ 0) ou use eventos[]")
        v = payload.get("vontade")
        if v is not None:
            _validate_scale_1_5(v, "vontade")

    elif template == "metrica_simples":
        if item_id is None:
            raise HTTPException(422, detail="metrica_simples exige item_id")
        v = payload.get("valor")
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            raise HTTPException(422, detail="valor obrigatório (numérico)")

    elif template == "evento_escala":
        e = payload.get("escala")
        if e is None:
            raise HTTPException(422, detail="escala obrigatória (int 1-5)")
        _validate_scale_1_5(e, "escala")

    elif template == "observacao_estruturada":
        # Payload: { duracao_min: int, observacao: str (obrigatório),
        #            intencao?: str, hipotese?: str, tipo: 'rotina'|'revelacao' }
        # Tags vão por endpoint separado (junction table).
        dur = payload.get("duracao_min")
        if dur is not None:
            if not _is_int_like(dur) or _coerce_int(dur) < 1 or _coerce_int(dur) > 600:
                raise HTTPException(422, detail="duracao_min deve ser int 1-600")
        obs = payload.get("observacao")
        if not isinstance(obs, str) or not obs.strip():
            raise HTTPException(422, detail="observacao obrigatória (não-vazia)")
        if len(obs) > 5000:
            raise HTTPException(422, detail="observacao muito longa (máx 5000)")
        for field in ("intencao", "hipotese"):
            v = payload.get(field)
            if v is not None:
                if not isinstance(v, str):
                    raise HTTPException(422, detail=f"{field} deve ser string")
                if len(v) > 2000:
                    raise HTTPException(422, detail=f"{field} muito longa (máx 2000)")
        tipo = payload.get("tipo", "rotina")
        if tipo not in ("rotina", "revelacao"):
            raise HTTPException(422, detail="tipo deve ser 'rotina' ou 'revelacao'")

    else:
        raise HTTPException(422, detail=f"Template desconhecido: {template!r}")


def _hydrate_domain(row) -> dict:
    return {
        **dict(row),
        "usa_itens": bool(row["usa_itens"]),
        "lembrete_ativo": bool(row["lembrete_ativo"]),
        "ativo": bool(row["ativo"]),
    }


def _hydrate_item(row) -> dict:
    d = dict(row)
    return {
        **d,
        "arquivado": bool(d.get("arquivado") or 0),
        # Novos campos de agenda — vêm None/0 em DBs migrados; defaults aqui
        # garantem que o pydantic não estoure se a coluna não foi setada.
        "diario": bool(d.get("diario") or 0),
        "duracao_media_min": d.get("duracao_media_min"),
        "horario_sugerido": d.get("horario_sugerido"),
    }


def _hydrate_record(row) -> dict:
    return {
        **dict(row),
        "payload": json.loads(row["payload"]) if row["payload"] else {},
    }


# ─── Domain ───────────────────────────────────────────────────────────────

DOMAIN_COLUMNS = (
    "slug, nome, cor, icone, template, usa_itens, lembrete_ativo, "
    "ausencia_threshold_dias, ordem, ativo, metric_primary_slug, "
    "criado_em, atualizado_em"
)


@router.get("/domains", response_model=list[DomainOut])
def list_domains(include_inactive: bool = False):
    sql = f"SELECT {DOMAIN_COLUMNS} FROM health_domain"
    if not include_inactive:
        sql += " WHERE ativo = 1"
    sql += " ORDER BY ordem ASC, slug ASC"
    with get_conn() as conn:
        rows = conn.execute(sql).fetchall()
    return [_hydrate_domain(r) for r in rows]


@router.get("/domains/{slug}", response_model=DomainOut)
def get_domain(slug: str):
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT {DOMAIN_COLUMNS} FROM health_domain WHERE slug = ?", (slug,)
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="Domínio não encontrado")
    return _hydrate_domain(row)


@router.post("/domains", response_model=DomainOut, status_code=201)
def create_domain(body: DomainCreate):
    if body.template not in VALID_TEMPLATES:
        raise HTTPException(
            422,
            detail=f"Template inválido. Aceitos: {sorted(VALID_TEMPLATES)}",
        )
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT 1 FROM health_domain WHERE slug = ?", (body.slug,)
        ).fetchone()
        if existing:
            raise HTTPException(409, detail=f"Domínio '{body.slug}' já existe")

        ordem = body.ordem
        if ordem is None:
            row = conn.execute(
                "SELECT COALESCE(MAX(ordem), 0) + 1 AS next_ordem FROM health_domain"
            ).fetchone()
            ordem = row["next_ordem"]

        now = utcnow_iso_z()
        conn.execute(
            "INSERT INTO health_domain"
            "(slug, nome, cor, icone, template, usa_itens, lembrete_ativo,"
            " ausencia_threshold_dias, ordem, metric_primary_slug, "
            " criado_em, atualizado_em) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                body.slug,
                body.nome,
                body.cor,
                body.icone,
                body.template,
                int(body.usa_itens),
                int(body.lembrete_ativo),
                body.ausencia_threshold_dias,
                ordem,
                body.metric_primary_slug,
                now,
                now,
            ),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {DOMAIN_COLUMNS} FROM health_domain WHERE slug = ?",
            (body.slug,),
        ).fetchone()
    return _hydrate_domain(row)


@router.patch("/domains/{slug}", response_model=DomainOut)
def update_domain(slug: str, body: DomainUpdate):
    fields: dict = {}
    for name in body.model_fields_set:
        val = getattr(body, name)
        fields[name] = int(val) if isinstance(val, bool) else val
    if not fields:
        raise HTTPException(400, detail="Nada a atualizar")
    fields["atualizado_em"] = utcnow_iso_z()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE health_domain SET {set_clause} WHERE slug = ?",
            [*fields.values(), slug],
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Domínio não encontrado")
        conn.commit()
        row = conn.execute(
            f"SELECT {DOMAIN_COLUMNS} FROM health_domain WHERE slug = ?", (slug,)
        ).fetchone()
    return _hydrate_domain(row)


@router.delete("/domains/{slug}", status_code=204)
def delete_domain(slug: str):
    """Hard delete. Bloqueia (409) se domínio tem itens ou registros.
    Pra desativar sem perder, use PATCH com `ativo: false`."""
    with get_conn() as conn:
        n_records = conn.execute(
            "SELECT COUNT(*) AS n FROM health_record WHERE domain_slug = ?", (slug,)
        ).fetchone()["n"]
        if n_records > 0:
            raise HTTPException(
                409,
                detail=f"Domínio tem {n_records} registros. Desative com PATCH "
                "ativo:false em vez de deletar.",
            )
        n_items = conn.execute(
            "SELECT COUNT(*) AS n FROM health_item WHERE domain_slug = ?", (slug,)
        ).fetchone()["n"]
        if n_items > 0:
            raise HTTPException(
                409,
                detail=f"Domínio tem {n_items} itens. Delete os itens antes "
                "ou use PATCH ativo:false pra desativar.",
            )
        cur = conn.execute("DELETE FROM health_domain WHERE slug = ?", (slug,))
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Domínio não encontrado")
        conn.commit()


# ─── Item ─────────────────────────────────────────────────────────────────

ITEM_COLUMNS = (
    "id, domain_slug, nome, unidade, horario_esperado, descricao, cor, "
    "arquivado, arquivado_em, ordem, "
    "diario, duracao_media_min, horario_sugerido, "
    "criado_em, atualizado_em"
)


@router.get("/domains/{slug}/items", response_model=list[ItemOut])
def list_items(slug: str, include_archived: bool = False):
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM health_domain WHERE slug = ?", (slug,)
        ).fetchone():
            raise HTTPException(404, detail="Domínio não encontrado")
        sql = f"SELECT {ITEM_COLUMNS} FROM health_item WHERE domain_slug = ?"
        if not include_archived:
            sql += " AND arquivado = 0"
        sql += " ORDER BY ordem ASC, id ASC"
        rows = conn.execute(sql, (slug,)).fetchall()
    return [_hydrate_item(r) for r in rows]


@router.post("/domains/{slug}/items", response_model=ItemOut, status_code=201)
def create_item(slug: str, body: ItemCreate):
    with get_conn() as conn:
        domain = conn.execute(
            "SELECT usa_itens FROM health_domain WHERE slug = ?", (slug,)
        ).fetchone()
        if not domain:
            raise HTTPException(404, detail="Domínio não encontrado")
        if not domain["usa_itens"]:
            raise HTTPException(
                422,
                detail=f"Domínio '{slug}' não usa itens (usa_itens=false)",
            )

        ordem = body.ordem
        if ordem is None:
            row = conn.execute(
                "SELECT COALESCE(MAX(ordem), 0) + 1 AS next_ordem "
                "FROM health_item WHERE domain_slug = ? AND arquivado = 0",
                (slug,),
            ).fetchone()
            ordem = row["next_ordem"]

        now = utcnow_iso_z()
        cur = conn.execute(
            "INSERT INTO health_item"
            "(domain_slug, nome, unidade, horario_esperado, descricao, cor,"
            " ordem, diario, duracao_media_min, horario_sugerido,"
            " criado_em, atualizado_em) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                slug,
                body.nome,
                body.unidade,
                body.horario_esperado,
                body.descricao,
                body.cor,
                ordem,
                1 if body.diario else 0,
                body.duracao_media_min,
                body.horario_sugerido,
                now,
                now,
            ),
        )
        new_id = cur.lastrowid
        conn.commit()
        row = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM health_item WHERE id = ?", (new_id,)
        ).fetchone()
    return _hydrate_item(row)


@router.patch("/items/{item_id}", response_model=ItemOut)
def update_item(item_id: int, body: ItemUpdate):
    fields: dict = {}
    for name in body.model_fields_set:
        fields[name] = getattr(body, name)
    if not fields:
        raise HTTPException(400, detail="Nada a atualizar")
    fields["atualizado_em"] = utcnow_iso_z()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE health_item SET {set_clause} WHERE id = ?",
            [*fields.values(), item_id],
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Item não encontrado")
        conn.commit()
        row = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM health_item WHERE id = ?", (item_id,)
        ).fetchone()
    return _hydrate_item(row)


@router.post("/items/{item_id}/archive", response_model=ItemOut)
def archive_item(item_id: int):
    """Soft-delete: marca arquivado=1. Preserva FK em registros históricos."""
    now = utcnow_iso_z()
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE health_item SET arquivado = 1, arquivado_em = ?, "
            "atualizado_em = ? WHERE id = ? AND arquivado = 0",
            (now, now, item_id),
        )
        if cur.rowcount == 0:
            existing = conn.execute(
                "SELECT 1 FROM health_item WHERE id = ?", (item_id,)
            ).fetchone()
            if not existing:
                raise HTTPException(404, detail="Item não encontrado")
            # já arquivado — idempotente
        conn.commit()
        row = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM health_item WHERE id = ?", (item_id,)
        ).fetchone()
    return _hydrate_item(row)


@router.post("/items/{item_id}/unarchive", response_model=ItemOut)
def unarchive_item(item_id: int):
    now = utcnow_iso_z()
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE health_item SET arquivado = 0, arquivado_em = NULL, "
            "atualizado_em = ? WHERE id = ? AND arquivado = 1",
            (now, item_id),
        )
        if cur.rowcount == 0:
            existing = conn.execute(
                "SELECT 1 FROM health_item WHERE id = ?", (item_id,)
            ).fetchone()
            if not existing:
                raise HTTPException(404, detail="Item não encontrado")
        conn.commit()
        row = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM health_item WHERE id = ?", (item_id,)
        ).fetchone()
    return _hydrate_item(row)


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int):
    """Hard delete. Bloqueia (409) se item tem registros vinculados.
    Pra esconder sem perder, use POST /items/{id}/archive."""
    with get_conn() as conn:
        n_records = conn.execute(
            "SELECT COUNT(*) AS n FROM health_record WHERE item_id = ?", (item_id,)
        ).fetchone()["n"]
        if n_records > 0:
            raise HTTPException(
                409,
                detail=f"Item tem {n_records} registros. Use archive em vez de delete.",
            )
        cur = conn.execute("DELETE FROM health_item WHERE id = ?", (item_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Item não encontrado")
        conn.commit()


# ─── Record ───────────────────────────────────────────────────────────────

RECORD_COLUMNS = (
    "id, domain_slug, item_id, data, horario, payload, notas, "
    "criado_em, atualizado_em"
)


@router.get("/domains/{slug}/records", response_model=list[RecordOut])
def list_records(
    slug: str,
    from_: Optional[str] = Query(None, alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    to: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    item_id: Optional[int] = None,
    limit: int = Query(500, ge=1, le=5000),
):
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM health_domain WHERE slug = ?", (slug,)
        ).fetchone():
            raise HTTPException(404, detail="Domínio não encontrado")
        sql = f"SELECT {RECORD_COLUMNS} FROM health_record WHERE domain_slug = ?"
        params: list = [slug]
        if from_:
            sql += " AND data >= ?"
            params.append(from_)
        if to:
            sql += " AND data <= ?"
            params.append(to)
        if item_id is not None:
            sql += " AND item_id = ?"
            params.append(item_id)
        sql += " ORDER BY data DESC, horario DESC NULLS LAST, id DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(sql, params).fetchall()
    return [_hydrate_record(r) for r in rows]


@router.post("/domains/{slug}/records", response_model=RecordOut, status_code=201)
def create_record(slug: str, body: RecordCreate):
    """Cria registro novo. Valida payload contra template do domínio."""
    with get_conn() as conn:
        domain = conn.execute(
            "SELECT template, usa_itens FROM health_domain WHERE slug = ?",
            (slug,),
        ).fetchone()
        if not domain:
            raise HTTPException(404, detail="Domínio não encontrado")

        # Item validation: se usa_itens e item_id passed, deve existir e ser do domínio
        if body.item_id is not None:
            item = conn.execute(
                "SELECT domain_slug FROM health_item WHERE id = ?", (body.item_id,)
            ).fetchone()
            if not item:
                raise HTTPException(404, detail="Item não encontrado")
            if item["domain_slug"] != slug:
                raise HTTPException(
                    422,
                    detail=f"Item não pertence ao domínio '{slug}'",
                )
        elif domain["usa_itens"] and domain["template"] != "refeicao_2modos":
            # refeicao_2modos permite item_id null (modo livre); demais não
            raise HTTPException(
                422,
                detail=f"Domínio '{slug}' exige item_id",
            )

        _validate_payload(domain["template"], body.payload, body.item_id)

        from datetime import date
        data = body.data or date.today().isoformat()
        now = utcnow_iso_z()

        cur = conn.execute(
            "INSERT INTO health_record"
            "(domain_slug, item_id, data, horario, payload, notas,"
            " criado_em, atualizado_em) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                slug,
                body.item_id,
                data,
                body.horario,
                json.dumps(body.payload),
                body.notas,
                now,
                now,
            ),
        )
        new_id = cur.lastrowid
        conn.commit()
        row = conn.execute(
            f"SELECT {RECORD_COLUMNS} FROM health_record WHERE id = ?", (new_id,)
        ).fetchone()
    return _hydrate_record(row)


@router.patch("/records/{record_id}", response_model=RecordOut)
def update_record(record_id: int, body: RecordUpdate):
    with get_conn() as conn:
        record = conn.execute(
            "SELECT domain_slug, item_id, payload FROM health_record WHERE id = ?",
            (record_id,),
        ).fetchone()
        if not record:
            raise HTTPException(404, detail="Registro não encontrado")

        fields: dict = {}
        for name in body.model_fields_set:
            val = getattr(body, name)
            if name == "payload":
                fields[name] = json.dumps(val) if val is not None else None
            else:
                fields[name] = val

        if not fields:
            raise HTTPException(400, detail="Nada a atualizar")

        # Se mudou item_id ou payload, re-valida contra template
        new_item_id = (
            fields["item_id"] if "item_id" in fields else record["item_id"]
        )
        new_payload_str = (
            fields["payload"] if "payload" in fields else record["payload"]
        )
        domain = conn.execute(
            "SELECT template FROM health_domain WHERE slug = ?",
            (record["domain_slug"],),
        ).fetchone()
        new_payload = json.loads(new_payload_str) if new_payload_str else {}
        _validate_payload(domain["template"], new_payload, new_item_id)

        # Validar que o novo item_id pertence ao domínio
        if "item_id" in fields and fields["item_id"] is not None:
            item = conn.execute(
                "SELECT domain_slug FROM health_item WHERE id = ?",
                (fields["item_id"],),
            ).fetchone()
            if not item:
                raise HTTPException(404, detail="Item não encontrado")
            if item["domain_slug"] != record["domain_slug"]:
                raise HTTPException(
                    422,
                    detail="Item não pertence ao domínio do registro",
                )

        fields["atualizado_em"] = utcnow_iso_z()
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE health_record SET {set_clause} WHERE id = ?",
            [*fields.values(), record_id],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {RECORD_COLUMNS} FROM health_record WHERE id = ?", (record_id,)
        ).fetchone()
    return _hydrate_record(row)


@router.delete("/records/{record_id}", status_code=204)
def delete_record(record_id: int):
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM health_record WHERE id = ?", (record_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Registro não encontrado")
        conn.commit()


# ─── Settings ─────────────────────────────────────────────────────────────

SETTINGS_COLUMNS = (
    "hora_lembrete_sono, dashboard_card_visivel, "
    "mind_challenge_ativo, mind_challenge_min_aparicoes, "
    "mind_challenge_janela_dias, mind_suspender_por_dias, "
    "mind_diario, mind_duracao_media_min, mind_horario_sugerido, "
    "atualizado_em"
)


def _hydrate_settings(row) -> dict:
    d = dict(row)
    return {
        **d,
        "dashboard_card_visivel": bool(d.get("dashboard_card_visivel") or 0),
        "mind_challenge_ativo": bool(d.get("mind_challenge_ativo") or 0),
        "mind_diario": bool(d.get("mind_diario") or 0),
        "mind_duracao_media_min": d.get("mind_duracao_media_min") or 20,
        "mind_horario_sugerido": d.get("mind_horario_sugerido"),
    }


@router.get("/settings", response_model=SettingsOut)
def get_settings():
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT {SETTINGS_COLUMNS} FROM health_settings WHERE id = 1"
        ).fetchone()
        if not row:
            conn.execute("INSERT INTO health_settings(id) VALUES (1)")
            conn.commit()
            row = conn.execute(
                f"SELECT {SETTINGS_COLUMNS} FROM health_settings WHERE id = 1"
            ).fetchone()
    return _hydrate_settings(row)


@router.patch("/settings", response_model=SettingsOut)
def update_settings(body: SettingsUpdate):
    fields: dict = {}
    for name in body.model_fields_set:
        val = getattr(body, name)
        fields[name] = int(val) if isinstance(val, bool) else val
    if not fields:
        raise HTTPException(400, detail="Nada a atualizar")
    fields["atualizado_em"] = utcnow_iso_z()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE health_settings SET {set_clause} WHERE id = 1",
            [*fields.values()],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {SETTINGS_COLUMNS} FROM health_settings WHERE id = 1"
        ).fetchone()
    return _hydrate_settings(row)


# ─── Métricas (lazy on-read; ver services/health_metrics.py) ──────────────

@router.get("/metrics")
def list_metrics():
    """Catálogo dinâmico das métricas disponíveis. Pra cada domínio ativo,
    gera métricas baseadas no template do domínio. Domínios customizados
    ganham métricas automaticamente."""
    with get_conn() as conn:
        return list_metrics_catalog(conn)


@router.get("/metrics/{slug}")
def get_metric(slug: str, item_id: Optional[int] = None):
    """Calcula valor atual da métrica. `item_id` obrigatório pra métricas
    parametrizadas (Vícios e Medidas)."""
    with get_conn() as conn:
        result = calculate_metric(conn, slug, item_id)
    if "erro" in result and result.get("erro") == "Métrica desconhecida":
        raise HTTPException(404, detail=f"Métrica '{slug}' não existe")
    return result


@router.post("/metrics/batch")
def get_metrics_batch(body: list[dict]):
    """Calcula múltiplas métricas numa request. Reduz round-trips quando
    Frontend (MetricsPanel, Dashboard card) precisa ler N valores. Cada
    item do body: `{slug: str, item_id?: int}`. Retorna lista paralela.
    """
    if not isinstance(body, list):
        raise HTTPException(422, detail="Body deve ser lista de {slug, item_id?}")
    out: list[dict] = []
    with get_conn() as conn:
        for q in body:
            if not isinstance(q, dict) or "slug" not in q:
                out.append({"erro": "Item inválido (precisa de 'slug')"})
                continue
            slug = q["slug"]
            item_id = q.get("item_id")
            out.append(calculate_metric(conn, slug, item_id))
    return out


# ─── Pendências (lembretes + ausência em âmbar) ───────────────────────────

@router.get("/pending")
def list_pending():
    """Lista de pendências do dia: lembretes proativos + ausências retroativas.

    Vícios e Medidas Corporais NÃO geram ausência (ausencia_threshold_dias=null
    no seed) — coerente com filosofia "observação > julgamento".
    """
    with get_conn() as conn:
        return compute_pending(conn)


@router.post("/admin/migrate-refeicao-2modos")
def migrate_refeicao_2modos(domain_slug: Optional[str] = None):
    """Consolida registros legacy de alimentação em formato agrupado.

    Pra cada domain com template `refeicao_2modos` (ou só `domain_slug` se passado):
      - Agrupa records do mesmo (domain, data) que estão no formato legacy
        ({comeu} ou {descricao})
      - Cria UM record novo com payload `{refeicoes: [...]}` agregando todos
      - Deleta os legados
      - `data` do agrupado = data original; `horario` = horário do primeiro evento;
        `item_id` = null; `notas` = concat das notas individuais (separadas por ` · `)

    Idempotente: records que já estão no novo formato (`refeicoes[]`) são
    ignorados. Mistura no mesmo dia (alguns novos, outros legados) é tratada
    consolidando os legados num novo grupo separado.

    Retorna sumário: { domains_processed, days_migrated, records_consolidated,
                       records_deleted }
    """
    summary = {
        "domains_processed": 0,
        "days_migrated": 0,
        "records_consolidated": 0,
        "records_deleted": 0,
    }
    with get_conn() as conn:
        # Lista domains alvo
        if domain_slug:
            domain_rows = conn.execute(
                "SELECT slug, template FROM health_domain WHERE slug = ? AND template = 'refeicao_2modos'",
                (domain_slug,),
            ).fetchall()
        else:
            domain_rows = conn.execute(
                "SELECT slug, template FROM health_domain WHERE template = 'refeicao_2modos'"
            ).fetchall()
        if not domain_rows:
            return summary
        for d in domain_rows:
            summary["domains_processed"] += 1
            # Datas únicas com registros nesse domain
            datas = conn.execute(
                "SELECT DISTINCT data FROM health_record WHERE domain_slug = ? ORDER BY data",
                (d["slug"],),
            ).fetchall()
            for data_row in datas:
                data = data_row["data"]
                # Records do dia
                records = conn.execute(
                    "SELECT id, item_id, horario, payload, notas, criado_em "
                    "FROM health_record WHERE domain_slug = ? AND data = ? "
                    "ORDER BY COALESCE(horario, '99:99'), id",
                    (d["slug"], data),
                ).fetchall()
                # Separa legados de novos formatos
                legacy_records = []
                for r in records:
                    try:
                        p = json.loads(r["payload"]) if isinstance(r["payload"], str) else (r["payload"] or {})
                    except (json.JSONDecodeError, TypeError):
                        p = {}
                    if isinstance(p.get("refeicoes"), list):
                        continue  # já novo formato, pula
                    legacy_records.append((r, p))
                if not legacy_records:
                    continue
                # Constrói refeicoes[] agregado
                refeicoes = []
                notas_collected = []
                first_horario = None
                last_at = None
                for r, p in legacy_records:
                    horario_evt = r["horario"]
                    if first_horario is None and horario_evt:
                        first_horario = horario_evt
                    if r["item_id"] is None:
                        # Legado livre
                        desc = p.get("descricao", "").strip()
                        if desc:
                            ref = {"tipo": "free", "descricao": desc}
                            if horario_evt:
                                ref["horario"] = horario_evt
                            else:
                                # Free precisa de horario; fallback pra 12:00
                                ref["horario"] = "12:00"
                            refeicoes.append(ref)
                    else:
                        # Legado dieta
                        comeu_bool = p.get("comeu", True)
                        ref = {
                            "tipo": "planned",
                            "item_id": r["item_id"],
                            "comeu": "sim" if comeu_bool else "nao",
                        }
                        if horario_evt:
                            ref["horario"] = horario_evt
                        refeicoes.append(ref)
                    if r["notas"]:
                        notas_collected.append(r["notas"])
                    if r["criado_em"] and (last_at is None or r["criado_em"] > last_at):
                        last_at = r["criado_em"]
                if not refeicoes:
                    continue
                # Cria novo record consolidado
                payload_new = {"refeicoes": refeicoes}
                notas_final = " · ".join(notas_collected) if notas_collected else None
                now = utcnow_iso_z()
                conn.execute(
                    "INSERT INTO health_record (domain_slug, item_id, data, horario, payload, notas, criado_em, atualizado_em) "
                    "VALUES (?, NULL, ?, ?, ?, ?, ?, ?)",
                    (
                        d["slug"],
                        data,
                        first_horario,
                        json.dumps(payload_new),
                        notas_final,
                        last_at or now,
                        now,
                    ),
                )
                # Deleta os legados
                ids_to_delete = [r["id"] for r, _ in legacy_records]
                placeholders = ",".join("?" for _ in ids_to_delete)
                conn.execute(
                    f"DELETE FROM health_record WHERE id IN ({placeholders})",
                    ids_to_delete,
                )
                summary["days_migrated"] += 1
                summary["records_consolidated"] += 1
                summary["records_deleted"] += len(ids_to_delete)
        conn.commit()
    return summary


# ─── Mind — Observação Estruturada ────────────────────────────────────────

MIND_TAG_COLUMNS = (
    "id, slug, nome, descricao, cor, arquivado, ordem, criado_em, atualizado_em"
)


def _hydrate_mind_tag(row) -> dict:
    return {**dict(row), "arquivado": bool(row["arquivado"])}


@router.get("/mind/tags", response_model=list[MindTagOut])
def list_mind_tags(include_archived: bool = False):
    """Lista tags do catálogo Mind. Por default só ativas; toggle inclui
    arquivadas pra UI de gerenciamento."""
    with get_conn() as conn:
        sql = f"SELECT {MIND_TAG_COLUMNS} FROM health_mind_tag"
        if not include_archived:
            sql += " WHERE arquivado = 0"
        sql += " ORDER BY ordem ASC, nome ASC"
        rows = conn.execute(sql).fetchall()
    return [_hydrate_mind_tag(r) for r in rows]


@router.post("/mind/tags", response_model=MindTagOut, status_code=201)
def create_mind_tag(body: MindTagCreate):
    """Cria uma tag customizada. Slug deve ser único + ascii-lowercase."""
    with get_conn() as conn:
        try:
            conn.execute(
                "INSERT INTO health_mind_tag(slug, nome, descricao, cor, ordem) "
                "VALUES (?, ?, ?, ?, ?)",
                (body.slug, body.nome, body.descricao, body.cor, body.ordem),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, detail=f"Tag '{body.slug}' já existe")
        conn.commit()
        row = conn.execute(
            f"SELECT {MIND_TAG_COLUMNS} FROM health_mind_tag WHERE slug = ?",
            (body.slug,),
        ).fetchone()
    return _hydrate_mind_tag(row)


@router.patch("/mind/tags/{tag_id}", response_model=MindTagOut)
def update_mind_tag(tag_id: int, body: MindTagUpdate):
    fields: dict = {}
    for name in body.model_fields_set:
        val = getattr(body, name)
        fields[name] = int(val) if isinstance(val, bool) else val
    if not fields:
        raise HTTPException(400, detail="Nada a atualizar")
    fields["atualizado_em"] = utcnow_iso_z()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE health_mind_tag SET {set_clause} WHERE id = ?",
            [*fields.values(), tag_id],
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Tag não encontrada")
        conn.commit()
        row = conn.execute(
            f"SELECT {MIND_TAG_COLUMNS} FROM health_mind_tag WHERE id = ?",
            (tag_id,),
        ).fetchone()
    return _hydrate_mind_tag(row)


@router.delete("/mind/tags/{tag_id}", status_code=204)
def delete_mind_tag(tag_id: int):
    """Deleta tag definitiva. Junction CASCADE remove referências. Prefira
    arquivar (PATCH) pra preservar histórico — só delete se foi erro de cadastro."""
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM health_mind_tag WHERE id = ?", (tag_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Tag não encontrada")
        conn.commit()


# ─── Mind Sessions (registros + tags + hipóteses atomicamente) ────────────

class MindSessionCreate(BaseModel):
    data: Optional[str] = None                  # YYYY-MM-DD; default today
    horario: Optional[str] = None
    notas: Optional[str] = None
    payload: dict[str, Any]                     # observacao*, intencao?, hipotese?, duracao_min?, tipo
    tag_ids: list[int] = []


class MindSessionUpdate(BaseModel):
    data: Optional[str] = None
    horario: Optional[str] = None
    notas: Optional[str] = None
    payload: Optional[dict[str, Any]] = None
    tag_ids: Optional[list[int]] = None


@router.post("/mind/sessions", response_model=dict, status_code=201)
def create_mind_session(body: MindSessionCreate):
    """Cria session de Mind atomicamente: record + tags (junction) + hipótese
    (entidade própria, status='pending'). Mais robusto que reusar o endpoint
    genérico de record + 2 chamadas extras do client."""
    payload = body.payload or {}
    _validate_payload("observacao_estruturada", payload, None)
    data_iso = body.data or date.today().isoformat()
    horario = body.horario
    notas = body.notas
    with get_conn() as conn:
        # Valida tag_ids
        if body.tag_ids:
            placeholders = ",".join("?" for _ in body.tag_ids)
            existing = conn.execute(
                f"SELECT id FROM health_mind_tag WHERE id IN ({placeholders})",
                body.tag_ids,
            ).fetchall()
            existing_ids = {r["id"] for r in existing}
            missing = [i for i in body.tag_ids if i not in existing_ids]
            if missing:
                raise HTTPException(422, detail=f"Tags inexistentes: {missing}")
        # Insere record
        cur = conn.execute(
            "INSERT INTO health_record"
            "(domain_slug, item_id, data, horario, payload, notas) "
            "VALUES ('mind', NULL, ?, ?, ?, ?)",
            (data_iso, horario, json.dumps(payload), notas),
        )
        record_id = cur.lastrowid
        # Tags
        for tag_id in body.tag_ids:
            conn.execute(
                "INSERT OR IGNORE INTO health_mind_record_tag(record_id, tag_id) "
                "VALUES (?, ?)",
                (record_id, tag_id),
            )
        # Hipótese
        hipotese_texto = payload.get("hipotese")
        if isinstance(hipotese_texto, str) and hipotese_texto.strip():
            conn.execute(
                "INSERT INTO health_mind_hipotese(record_id, texto, status) "
                "VALUES (?, ?, 'pending')",
                (record_id, hipotese_texto.strip()),
            )
        conn.commit()
        return _fetch_mind_session(conn, record_id)


@router.patch("/mind/sessions/{record_id}", response_model=dict)
def update_mind_session(record_id: int, body: MindSessionUpdate):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, payload FROM health_record WHERE id = ? AND domain_slug = 'mind'",
            (record_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="Session de Mind não encontrada")
        # Atualiza campos do record
        record_fields: dict = {}
        if body.data is not None:
            record_fields["data"] = body.data
        if body.horario is not None:
            record_fields["horario"] = body.horario
        if body.notas is not None:
            record_fields["notas"] = body.notas
        if body.payload is not None:
            _validate_payload("observacao_estruturada", body.payload, None)
            record_fields["payload"] = json.dumps(body.payload)
        if record_fields:
            record_fields["atualizado_em"] = utcnow_iso_z()
            set_clause = ", ".join(f"{k} = ?" for k in record_fields)
            conn.execute(
                f"UPDATE health_record SET {set_clause} WHERE id = ?",
                [*record_fields.values(), record_id],
            )
        # Atualiza tags se fornecido
        if body.tag_ids is not None:
            conn.execute(
                "DELETE FROM health_mind_record_tag WHERE record_id = ?",
                (record_id,),
            )
            for tag_id in body.tag_ids:
                conn.execute(
                    "INSERT OR IGNORE INTO health_mind_record_tag(record_id, tag_id) "
                    "VALUES (?, ?)",
                    (record_id, tag_id),
                )
        # Sincroniza hipótese se payload mudou
        if body.payload is not None:
            hipotese_texto = body.payload.get("hipotese")
            existing_hip = conn.execute(
                "SELECT id, texto FROM health_mind_hipotese WHERE record_id = ?",
                (record_id,),
            ).fetchone()
            if isinstance(hipotese_texto, str) and hipotese_texto.strip():
                if existing_hip:
                    if existing_hip["texto"] != hipotese_texto.strip():
                        conn.execute(
                            "UPDATE health_mind_hipotese SET texto = ?, atualizado_em = ? "
                            "WHERE id = ?",
                            (hipotese_texto.strip(), utcnow_iso_z(), existing_hip["id"]),
                        )
                else:
                    conn.execute(
                        "INSERT INTO health_mind_hipotese(record_id, texto, status) "
                        "VALUES (?, ?, 'pending')",
                        (record_id, hipotese_texto.strip()),
                    )
            else:
                # Hipótese removida: deleta entrada se existir
                if existing_hip:
                    conn.execute(
                        "DELETE FROM health_mind_hipotese WHERE id = ?",
                        (existing_hip["id"],),
                    )
        conn.commit()
        return _fetch_mind_session(conn, record_id)


@router.delete("/mind/sessions/{record_id}", status_code=204)
def delete_mind_session(record_id: int):
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM health_record WHERE id = ? AND domain_slug = 'mind'",
            (record_id,),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Session de Mind não encontrada")
        conn.commit()


@router.get("/mind/sessions", response_model=list[dict])
def list_mind_sessions(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    tag_slug: Optional[str] = None,
    limit: int = 100,
):
    """Lista sessions de Mind com tags + hipótese inline. Filtros por
    intervalo de data + tag opcionais."""
    with get_conn() as conn:
        sql = "SELECT id FROM health_record WHERE domain_slug = 'mind'"
        params: list[Any] = []
        if from_:
            sql += " AND data >= ?"
            params.append(from_)
        if to:
            sql += " AND data <= ?"
            params.append(to)
        if tag_slug:
            sql += (
                " AND id IN (SELECT rt.record_id FROM health_mind_record_tag rt "
                "JOIN health_mind_tag t ON t.id = rt.tag_id WHERE t.slug = ?)"
            )
            params.append(tag_slug)
        sql += " ORDER BY data DESC, COALESCE(horario, '99:99') DESC, id DESC LIMIT ?"
        params.append(limit)
        ids = [r["id"] for r in conn.execute(sql, params).fetchall()]
        return [_fetch_mind_session(conn, rid) for rid in ids]


def _fetch_mind_session(conn, record_id: int) -> dict:
    """Hidrata 1 mind session com record + tags slugs + hipotese."""
    rec = conn.execute(
        f"SELECT {RECORD_COLUMNS} FROM health_record WHERE id = ?",
        (record_id,),
    ).fetchone()
    if not rec:
        raise HTTPException(404, detail="Session não encontrada")
    tag_rows = conn.execute(
        "SELECT t.id, t.slug, t.nome, t.cor "
        "FROM health_mind_record_tag rt "
        "JOIN health_mind_tag t ON t.id = rt.tag_id "
        "WHERE rt.record_id = ? ORDER BY t.ordem ASC",
        (record_id,),
    ).fetchall()
    hip_row = conn.execute(
        "SELECT id, texto, status, suspended_until, criado_em, atualizado_em "
        "FROM health_mind_hipotese WHERE record_id = ?",
        (record_id,),
    ).fetchone()
    payload = json.loads(rec["payload"]) if rec["payload"] else {}
    return {
        "id": rec["id"],
        "data": rec["data"],
        "horario": rec["horario"],
        "payload": payload,
        "notas": rec["notas"],
        "criado_em": rec["criado_em"],
        "atualizado_em": rec["atualizado_em"],
        "tags": [dict(t) for t in tag_rows],
        "hipotese": dict(hip_row) if hip_row else None,
    }


# ─── Mind Hipóteses (status + adversarial challenge) ─────────────────────


def _hydrate_mind_hipotese(conn, row) -> dict:
    """Hipótese + tags da session origem + count de aparições recentes."""
    # Tags da session origem
    tag_rows = conn.execute(
        "SELECT t.slug FROM health_mind_record_tag rt "
        "JOIN health_mind_tag t ON t.id = rt.tag_id "
        "WHERE rt.record_id = ?",
        (row["record_id"],),
    ).fetchall()
    tag_slugs = [t["slug"] for t in tag_rows]
    # Aparições recentes: count de sessions com ≥1 tag em comum nos últimos 14d
    janela_iso = (date.today() - timedelta(days=14)).isoformat()
    if tag_slugs:
        placeholders = ",".join("?" for _ in tag_slugs)
        count_row = conn.execute(
            f"SELECT COUNT(DISTINCT rt.record_id) AS n "
            f"FROM health_mind_record_tag rt "
            f"JOIN health_mind_tag t ON t.id = rt.tag_id "
            f"JOIN health_record r ON r.id = rt.record_id "
            f"WHERE t.slug IN ({placeholders}) AND r.data >= ?",
            (*tag_slugs, janela_iso),
        ).fetchone()
        aparicoes = count_row["n"] if count_row else 0
    else:
        aparicoes = 0
    # Data da session origem
    rec = conn.execute(
        "SELECT data FROM health_record WHERE id = ?", (row["record_id"],)
    ).fetchone()
    return {
        "id": row["id"],
        "record_id": row["record_id"],
        "texto": row["texto"],
        "status": row["status"],
        "suspended_until": row["suspended_until"],
        "criado_em": row["criado_em"],
        "atualizado_em": row["atualizado_em"],
        "record_data": rec["data"] if rec else None,
        "tags": tag_slugs,
        "aparicoes_recentes": aparicoes,
    }


@router.get("/mind/hipoteses", response_model=list[MindHipoteseOut])
def list_mind_hipoteses(status: Optional[str] = None):
    """Lista hipóteses. Default: todas. Filtro `status=pending` pra UI de
    pendências. Auto-reativa hipóteses suspendidas cujo `suspended_until` passou."""
    with get_conn() as conn:
        # Auto-reativa suspensas expiradas
        conn.execute(
            "UPDATE health_mind_hipotese SET status = 'pending', "
            "suspended_until = NULL, atualizado_em = ? "
            "WHERE status = 'suspended' AND suspended_until IS NOT NULL "
            "  AND suspended_until <= ?",
            (utcnow_iso_z(), date.today().isoformat()),
        )
        conn.commit()
        sql = (
            "SELECT id, record_id, texto, status, suspended_until, "
            "       criado_em, atualizado_em FROM health_mind_hipotese"
        )
        params: list[Any] = []
        if status:
            sql += " WHERE status = ?"
            params.append(status)
        sql += " ORDER BY criado_em DESC"
        rows = conn.execute(sql, params).fetchall()
        return [_hydrate_mind_hipotese(conn, r) for r in rows]


@router.patch("/mind/hipoteses/{hip_id}", response_model=MindHipoteseOut)
def update_mind_hipotese(hip_id: int, body: MindHipoteseUpdate):
    """Atualiza status. 'suspended' calcula `suspended_until` automaticamente
    via setting `mind_suspender_por_dias` (default 14)."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM health_mind_hipotese WHERE id = ?", (hip_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="Hipótese não encontrada")
        suspended_until = None
        if body.status == "suspended":
            settings_row = conn.execute(
                "SELECT mind_suspender_por_dias FROM health_settings WHERE id = 1"
            ).fetchone()
            dias = settings_row["mind_suspender_por_dias"] if settings_row else 14
            suspended_until = (date.today() + timedelta(days=dias)).isoformat()
        conn.execute(
            "UPDATE health_mind_hipotese SET status = ?, suspended_until = ?, "
            "atualizado_em = ? WHERE id = ?",
            (body.status, suspended_until, utcnow_iso_z(), hip_id),
        )
        conn.commit()
        full = conn.execute(
            "SELECT id, record_id, texto, status, suspended_until, "
            "       criado_em, atualizado_em FROM health_mind_hipotese WHERE id = ?",
            (hip_id,),
        ).fetchone()
        return _hydrate_mind_hipotese(conn, full)


@router.get("/mind/challenges", response_model=list[MindChallengeOut])
def list_mind_challenges():
    """Lista hipóteses pendentes que disparam o adversarial challenge —
    aquelas com tags em comum que apareceram >= min_aparicoes na janela."""
    with get_conn() as conn:
        settings_row = conn.execute(
            "SELECT mind_challenge_ativo, mind_challenge_min_aparicoes, "
            "       mind_challenge_janela_dias FROM health_settings WHERE id = 1"
        ).fetchone()
        if not settings_row or not settings_row["mind_challenge_ativo"]:
            return []
        min_aparicoes = settings_row["mind_challenge_min_aparicoes"]
        janela_dias = settings_row["mind_challenge_janela_dias"]
        janela_iso = (date.today() - timedelta(days=janela_dias)).isoformat()
        # Hipóteses pending
        hip_rows = conn.execute(
            "SELECT id, record_id, texto, status, suspended_until, "
            "       criado_em, atualizado_em FROM health_mind_hipotese "
            "WHERE status = 'pending' ORDER BY criado_em DESC"
        ).fetchall()
        out: list[dict] = []
        for hip in hip_rows:
            # Tags da session origem
            tag_rows = conn.execute(
                "SELECT t.id, t.slug, t.nome, t.cor "
                "FROM health_mind_record_tag rt "
                "JOIN health_mind_tag t ON t.id = rt.tag_id "
                "WHERE rt.record_id = ?",
                (hip["record_id"],),
            ).fetchall()
            if not tag_rows:
                continue
            tag_ids = [t["id"] for t in tag_rows]
            placeholders = ",".join("?" for _ in tag_ids)
            # Padrões: contar aparições de cada tag na janela
            padroes_rows = conn.execute(
                f"SELECT t.slug, t.nome, t.cor, COUNT(*) AS n, "
                f"       MIN(r.data) AS primeira, MAX(r.data) AS ultima "
                f"FROM health_mind_record_tag rt "
                f"JOIN health_mind_tag t ON t.id = rt.tag_id "
                f"JOIN health_record r ON r.id = rt.record_id "
                f"WHERE t.id IN ({placeholders}) AND r.data >= ? "
                f"GROUP BY t.id HAVING COUNT(*) >= ? "
                f"ORDER BY n DESC",
                (*tag_ids, janela_iso, min_aparicoes),
            ).fetchall()
            if not padroes_rows:
                continue
            padroes = [
                {
                    "tag_slug": p["slug"],
                    "tag_nome": p["nome"],
                    "tag_cor": p["cor"],
                    "count": p["n"],
                    "primeira": p["primeira"],
                    "ultima": p["ultima"],
                }
                for p in padroes_rows
            ]
            out.append({
                "hipotese": _hydrate_mind_hipotese(conn, hip),
                "tags_relacionadas": padroes,
            })
        return out


@router.get("/mind/padroes", response_model=list[MindPadraoOut])
def list_mind_padroes(dias: int = 30):
    """Padrões recorrentes — agrupa tags na janela e retorna em ordem de freq."""
    janela_iso = (date.today() - timedelta(days=dias)).isoformat()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT t.slug, t.nome, t.cor, COUNT(*) AS n, "
            "       MIN(r.data) AS primeira, MAX(r.data) AS ultima "
            "FROM health_mind_record_tag rt "
            "JOIN health_mind_tag t ON t.id = rt.tag_id "
            "JOIN health_record r ON r.id = rt.record_id "
            "WHERE r.data >= ? "
            "GROUP BY t.id "
            "ORDER BY n DESC, t.nome ASC",
            (janela_iso,),
        ).fetchall()
        return [
            {
                "tag_slug": r["slug"],
                "tag_nome": r["nome"],
                "tag_cor": r["cor"],
                "count": r["n"],
                "primeira": r["primeira"],
                "ultima": r["ultima"],
            }
            for r in rows
        ]
