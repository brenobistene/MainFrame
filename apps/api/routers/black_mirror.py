"""Black Mirror — espelho de dados (leitura diária por IA).

O espelho cruza a INTENÇÃO declarada (/Build: propósito, visão, metas) com a
EXECUÇÃO real (sessões de tempo, finance, health, quests) e confronta a
contradição. NÃO aconselha — devolve reflexo + tensão + padrão + UMA pergunta.
O plano if-then (`meu_passo`) é escrito pelo usuário, não pela IA.

Geração é lazy (frontend chama POST /generate no 1º acesso do dia). UPSERT por
dia preserva `meu_passo` quando regenera. Config de IA reusa lang_settings
(mesma chave LANG_AI_API_KEY do Lang Lab). Doc/decisões: docs/black-mirror.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from db import get_conn
from services import blackmirror_ai
from services.blackmirror_ai import AiError, AiNotConfigured

router = APIRouter(tags=["black-mirror"])


# ─── Helpers ─────────────────────────────────────────────────────────────


def _today_label() -> str:
    """Dia local YYYY-MM-DD. Sem cutoff — o espelho é do dia civil."""
    return datetime.now().astimezone().strftime("%Y-%m-%d")


def _lang_settings(conn) -> dict:
    """Config de IA vive em lang_settings (fonte única do app)."""
    row = conn.execute("SELECT * FROM lang_settings WHERE id = 1").fetchone()
    if not row:
        conn.execute("INSERT OR IGNORE INTO lang_settings(id) VALUES (1)")
        conn.commit()
        row = conn.execute("SELECT * FROM lang_settings WHERE id = 1").fetchone()
    return dict(row)


def _reflection_out(row, date_label: str) -> dict:
    """Shape de saída — sempre com `generated`; snapshot_json não vaza."""
    if not row:
        return {
            "id": None, "date": date_label, "generated": False,
            "reflexo": None, "tensao": None, "padrao": None, "pergunta": None,
            "meu_passo": None, "model": None, "criado_em": None, "atualizado_em": None,
        }
    d = dict(row)
    d.pop("snapshot_json", None)
    d["generated"] = True
    return d


def _utc_iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _minutes(conn, table: str, since_iso: str) -> int:
    """Minutos somados de sessões FECHADAS desde `since_iso` (UTC ISO Z).
    Normaliza 'T'/'Z' pro julianday do SQLite parsear. Defensivo: 0 se falhar."""
    try:
        row = conn.execute(
            f"SELECT COALESCE(SUM("
            f"(julianday(replace(replace(ended_at,'T',' '),'Z','')) "
            f"- julianday(replace(replace(started_at,'T',' '),'Z',''))) * 1440.0), 0) AS m "
            f"FROM {table} WHERE ended_at IS NOT NULL AND started_at >= ?",
            (since_iso,),
        ).fetchone()
        return int(round(row["m"] or 0))
    except Exception:
        return 0


def _build_snapshot(conn) -> dict:
    """Retrato compacto pra IA — só estatísticas e textos curtos do recorte,
    nunca o histórico bruto (privacidade + tokens). Cada seção é defensiva:
    se uma tabela/coluna falhar, a seção some sem derrubar a leitura."""
    now_local = datetime.now().astimezone()
    today = now_local.date()
    midnight = datetime(today.year, today.month, today.day, tzinfo=now_local.tzinfo)
    since_today = _utc_iso(midnight.astimezone(timezone.utc))
    now_utc = datetime.now(timezone.utc)
    since_7d = _utc_iso(now_utc - timedelta(days=7))
    d7 = (today - timedelta(days=7)).isoformat()
    mes = now_local.strftime("%Y-%m")

    snap: dict = {"data": today.isoformat()}

    # Intenção declarada — /Build
    try:
        intent: dict = {}
        p = conn.execute("SELECT texto FROM build_purpose WHERE id = 1").fetchone()
        if p and (p["texto"] or "").strip():
            intent["proposito"] = p["texto"].strip()[:600]
        v = conn.execute(
            "SELECT texto, data_alvo FROM build_vision WHERE ativa = 1 ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if v and (v["texto"] or "").strip():
            intent["visao"] = {"texto": v["texto"].strip()[:600], "data_alvo": v["data_alvo"]}
        metas = [
            {"titulo": r["titulo"], "horizon": r["horizon"], "data_alvo": r["data_alvo"]}
            for r in conn.execute(
                "SELECT titulo, horizon, data_alvo FROM build_goal "
                "WHERE status = 'ativa' ORDER BY data_alvo LIMIT 8"
            ).fetchall()
        ]
        if metas:
            intent["metas_ativas"] = metas
        if intent:
            snap["intencao"] = intent
    except Exception:
        pass

    # Execução real — tempo das sessões
    try:
        snap["tempo_min"] = {
            "hoje": {
                "quests": _minutes(conn, "quest_sessions", since_today),
                "tarefas": _minutes(conn, "task_sessions", since_today),
                "rotinas": _minutes(conn, "routine_sessions", since_today),
            },
            "ultimos_7d": {
                "quests": _minutes(conn, "quest_sessions", since_7d),
                "tarefas": _minutes(conn, "task_sessions", since_7d),
                "rotinas": _minutes(conn, "routine_sessions", since_7d),
            },
        }
    except Exception:
        pass

    # Finance — mês corrente
    try:
        agg = conn.execute(
            "SELECT COALESCE(SUM(CASE WHEN valor < 0 THEN -valor ELSE 0 END), 0) AS desp, "
            "COALESCE(SUM(CASE WHEN valor > 0 THEN valor ELSE 0 END), 0) AS rec "
            "FROM fin_transaction WHERE substr(data, 1, 7) = ?",
            (mes,),
        ).fetchone()
        fin: dict = {
            "mes": mes,
            "despesa_total": round(agg["desp"] or 0, 2),
            "receita_total": round(agg["rec"] or 0, 2),
        }
        top = [
            {"categoria": r["nome"] or "sem categoria", "total": round(r["t"] or 0, 2)}
            for r in conn.execute(
                "SELECT c.nome AS nome, SUM(-t.valor) AS t FROM fin_transaction t "
                "LEFT JOIN fin_category c ON c.id = t.categoria_id "
                "WHERE substr(t.data, 1, 7) = ? AND t.valor < 0 "
                "GROUP BY t.categoria_id ORDER BY t DESC LIMIT 3",
                (mes,),
            ).fetchall()
        ]
        if top:
            fin["top_despesas"] = top
        snap["finance"] = fin
    except Exception:
        pass

    # Health (registros 7d) + Mind (tags 7d)
    try:
        h: dict = {}
        regs = [
            {"dominio": r["domain_slug"], "registros": r["n"]}
            for r in conn.execute(
                "SELECT domain_slug, COUNT(*) AS n FROM health_record "
                "WHERE data >= ? GROUP BY domain_slug ORDER BY n DESC",
                (d7,),
            ).fetchall()
        ]
        if regs:
            h["registros_7d"] = regs
        tags = [
            r["nome"]
            for r in conn.execute(
                "SELECT t.nome AS nome, COUNT(*) AS n FROM health_mind_record_tag rt "
                "JOIN health_mind_tag t ON t.id = rt.tag_id "
                "JOIN health_record r ON r.id = rt.record_id "
                "WHERE r.data >= ? GROUP BY t.id ORDER BY n DESC LIMIT 6",
                (d7,),
            ).fetchall()
        ]
        if tags:
            h["mind_tags_7d"] = tags
        if h:
            snap["health"] = h
    except Exception:
        pass

    # Quests paradas — declaradas e intocadas há ≥3 dias
    try:
        paradas = []
        rows = conn.execute(
            "SELECT q.title AS title, q.priority AS priority, q.created_at AS created_at, "
            "(SELECT MAX(s.ended_at) FROM quest_sessions s WHERE s.quest_id = q.id) AS last_sess "
            "FROM quests q JOIN projects p ON p.id = q.project_id "
            "WHERE q.status = 'pending' AND p.archived_at IS NULL"
        ).fetchall()
        for r in rows:
            ref = r["last_sess"] or r["created_at"]
            if not ref:
                continue
            ref_norm = ref.replace("T", " ").replace("Z", "")[:10]
            try:
                ref_date = datetime.fromisoformat(ref_norm).date()
            except ValueError:
                continue
            dias = (today - ref_date).days
            if dias >= 3:
                paradas.append({"quest": r["title"], "dias_parada": dias, "priority": r["priority"]})
        paradas.sort(key=lambda x: x["dias_parada"], reverse=True)
        if paradas:
            snap["quests_paradas"] = paradas[:8]
    except Exception:
        pass

    return snap


# ─── Endpoints ───────────────────────────────────────────────────────────


@router.get("/api/black-mirror/today")
def get_today():
    """Leitura de hoje se já gerada; senão `generated: false` (frontend dispara
    o generate). GET é puro — nunca chama a IA."""
    label = _today_label()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM blackmirror_reflection WHERE date = ?", (label,)
        ).fetchone()
    return _reflection_out(row, label)


@router.get("/api/black-mirror/snapshot")
def get_snapshot():
    """Snapshot agregado SEM chamar IA — debug e detecção de 'dia quieto'."""
    with get_conn() as conn:
        return _build_snapshot(conn)


@router.post("/api/black-mirror/generate")
async def generate_today():
    """(Re)gera a leitura de hoje. UPSERT por dia preserva `meu_passo`."""
    label = _today_label()
    with get_conn() as conn:
        settings = _lang_settings(conn)
        snapshot = _build_snapshot(conn)
    try:
        reading = await blackmirror_ai.daily_reflection(settings, snapshot)
    except AiNotConfigured as e:
        raise HTTPException(409, detail=f"IA não configurada: {e}")
    except AiError as e:
        raise HTTPException(502, detail=str(e))
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO blackmirror_reflection
                   (date, reflexo, tensao, padrao, pergunta, snapshot_json, model)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(date) DO UPDATE SET
                   reflexo       = excluded.reflexo,
                   tensao        = excluded.tensao,
                   padrao        = excluded.padrao,
                   pergunta      = excluded.pergunta,
                   snapshot_json = excluded.snapshot_json,
                   model         = excluded.model,
                   atualizado_em = datetime('now')""",
            (
                label,
                reading.get("reflexo"),
                reading.get("tensao"),
                reading.get("padrao"),
                reading.get("pergunta"),
                json.dumps(snapshot, ensure_ascii=False),
                settings.get("ai_model"),
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM blackmirror_reflection WHERE date = ?", (label,)
        ).fetchone()
    return _reflection_out(row, label)


class PassoBody(BaseModel):
    meu_passo: Optional[str] = None


@router.patch("/api/black-mirror/today/meu-passo")
def save_meu_passo(body: PassoBody):
    """Salva o if-then do usuário (a IA não preenche — a ação é dele)."""
    label = _today_label()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM blackmirror_reflection WHERE date = ?", (label,)
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="ainda não há leitura de hoje")
        passo = (body.meu_passo or "").strip() or None
        conn.execute(
            "UPDATE blackmirror_reflection SET meu_passo = ?, atualizado_em = datetime('now') "
            "WHERE date = ?",
            (passo, label),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM blackmirror_reflection WHERE date = ?", (label,)
        ).fetchone()
    return _reflection_out(row, label)


@router.get("/api/black-mirror/history")
def history(limit: int = Query(30, ge=1, le=120)):
    """Reflexões passadas (mais recentes primeiro)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM blackmirror_reflection ORDER BY date DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_reflection_out(r, r["date"]) for r in rows]
