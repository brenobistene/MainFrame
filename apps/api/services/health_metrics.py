"""Cálculo on-the-fly das Métricas do Hub Health.

Métricas são cidadãs de primeira classe (decisão #4 do PLAN.md) — entidades
nomeáveis, com unidade definida, calculadas a partir dos Registros.

Arquitetura **template-driven** (refatorada em 2026-05-09 — antes era hardcoded
por slug `'sono'`, `'exercicio'`, etc):

  - Stats são definidas por **template** do domínio (`STATS_BY_TEMPLATE`)
  - Cada stat tem chave (`duracao_media_7d`), handler que aceita
    `(conn, domain_slug, item_id)` e faz `WHERE domain_slug = ?`
  - Catálogo é **gerado dinamicamente**: pra cada domínio ativo, cada
    stat do template dele vira uma métrica `{domain_slug}_{stat_key}`
  - Domínios customizados (ex: usuário cria "Hidratação" com template
    `metrica_simples`) ganham métricas automaticamente

Decisão de arquitetura: cálculo lazy on-read (sem cache materializado no MVP).
Cache materializado entra em v2 se latência virar problema.

SQL usa `json_extract` pra ler o payload sem desserializar em Python.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Callable, Optional


# ─── Definição de stats por template ──────────────────────────────────────

@dataclass(frozen=True)
class StatDef:
    """Define uma estatística (métrica) que aplica a um template específico.

    O `slug_final` da métrica é `{domain_slug}_{key}` quando exposto pra
    /Build e UI.
    """
    key: str                              # ex: "duracao_media_7d"
    nome: str                             # ex: "duração média 7d"
    tipo_retorno: str                     # "float" | "int" | "string" | "date" | "enum" | "dict"
    unidade: Optional[str]                # ex: "h", "%", None pra enum/dict
    precisa_item: bool
    handler: Callable[..., dict]          # (conn, domain_slug, item_id?) -> dict


# Helpers — definidos abaixo
def _today() -> date:
    return date.today()


def _days_ago_iso(n: int) -> str:
    return (_today() - timedelta(days=n)).isoformat()


def _empty(slug: str, tipo_retorno: str, unidade: Optional[str]) -> dict:
    return {
        "slug": slug,
        "valor": None,
        "unidade": unidade,
        "tipo_retorno": tipo_retorno,
        "dados_disponiveis": False,
        "ultima_atualizacao": None,
    }


def _ok(slug: str, tipo_retorno: str, unidade: Optional[str], valor: Any, ultima: Optional[str]) -> dict:
    return {
        "slug": slug,
        "valor": valor,
        "unidade": unidade,
        "tipo_retorno": tipo_retorno,
        "dados_disponiveis": True,
        "ultima_atualizacao": ultima,
    }


def _calc_duration_h(hi: str, hf: str) -> float:
    """Duração em horas entre HH:MM, considerando cruzar meia-noite."""
    h1 = int(hi[:2]) + int(hi[3:5]) / 60
    h2 = int(hf[:2]) + int(hf[3:5]) / 60
    if h2 < h1:
        h2 += 24
    return h2 - h1


def _trend(curr: float, prev: float, threshold_pct: float = 10.0) -> str:
    """Compara curr vs prev: 'subindo' | 'caindo' | 'estavel'."""
    if prev == 0 and curr == 0:
        return "estavel"
    if prev == 0:
        return "subindo" if curr > 0 else "caindo"
    diff_pct = (curr - prev) / abs(prev) * 100
    if abs(diff_pct) < threshold_pct:
        return "estavel"
    return "subindo" if diff_pct > 0 else "caindo"


# ─── Handlers — Sono (template janela_qualidade) ─────────────────────────

def _sono_duracao_media(conn, domain_slug: str, _: Optional[int], dias: int, slug: str) -> dict:
    rows = conn.execute(
        "SELECT json_extract(payload, '$.hora_inicio') AS hi, "
        "       json_extract(payload, '$.hora_fim') AS hf, "
        "       atualizado_em "
        "FROM health_record "
        "WHERE domain_slug = ? "
        "  AND data >= ? "
        "  AND COALESCE(json_extract(payload, '$.tipo'), 'noturno') != 'cochilo' "
        "ORDER BY atualizado_em DESC",
        (domain_slug, _days_ago_iso(dias - 1)),
    ).fetchall()
    durations = [_calc_duration_h(r["hi"], r["hf"]) for r in rows if r["hi"] and r["hf"]]
    if not durations:
        return _empty(slug, "float", "h")
    return _ok(slug, "float", "h", round(sum(durations) / len(durations), 2), rows[0]["atualizado_em"])


def _sono_qualidade_media_30d(conn, domain_slug: str, _: Optional[int], slug: str) -> dict:
    row = conn.execute(
        "SELECT AVG(CAST(json_extract(payload, '$.qualidade') AS REAL)) AS avg_q, "
        "       MAX(atualizado_em) AS last_at, "
        "       COUNT(json_extract(payload, '$.qualidade')) AS n "
        "FROM health_record "
        "WHERE domain_slug = ? "
        "  AND data >= ? "
        "  AND json_extract(payload, '$.qualidade') IS NOT NULL "
        "  AND COALESCE(json_extract(payload, '$.tipo'), 'noturno') != 'cochilo'",
        (domain_slug, _days_ago_iso(29)),
    ).fetchone()
    if not row or not row["n"] or row["avg_q"] is None:
        return _empty(slug, "float", "1-5")
    return _ok(slug, "float", "1-5", round(row["avg_q"], 2), row["last_at"])


def _sono_hora_tipica_dormir_30d(conn, domain_slug: str, _: Optional[int], slug: str) -> dict:
    rows = conn.execute(
        "SELECT json_extract(payload, '$.hora_inicio') AS hi, atualizado_em "
        "FROM health_record "
        "WHERE domain_slug = ? "
        "  AND data >= ? "
        "  AND COALESCE(json_extract(payload, '$.tipo'), 'noturno') != 'cochilo' "
        "ORDER BY atualizado_em DESC",
        (domain_slug, _days_ago_iso(29)),
    ).fetchall()
    if not rows:
        return _empty(slug, "string", "HH:MM")
    minutes_list: list[int] = []
    for r in rows:
        hi = r["hi"]
        if not hi:
            continue
        h, m = int(hi[:2]), int(hi[3:5])
        total = h * 60 + m
        if h < 12:
            total += 24 * 60               # normaliza pra mediana noturna
        minutes_list.append(total)
    if not minutes_list:
        return _empty(slug, "string", "HH:MM")
    minutes_list.sort()
    n = len(minutes_list)
    median = minutes_list[n // 2] if n % 2 == 1 else (minutes_list[n // 2 - 1] + minutes_list[n // 2]) // 2
    median %= 24 * 60
    return _ok(slug, "string", "HH:MM", f"{median // 60:02d}:{median % 60:02d}", rows[0]["atualizado_em"])


# ─── Handlers — Exercício (template atividade_tipo) ──────────────────────

def _exercicio_frequencia_semanal(conn, domain_slug: str, _: Optional[int], slug: str) -> dict:
    row = conn.execute(
        "SELECT COUNT(*) AS n, MAX(atualizado_em) AS last_at "
        "FROM health_record WHERE domain_slug = ? AND data >= ?",
        (domain_slug, _days_ago_iso(27)),
    ).fetchone()
    if not row or not row["n"]:
        return _empty(slug, "float", "sessões/sem")
    return _ok(slug, "float", "sessões/sem", round(row["n"] / 4, 2), row["last_at"])


def _exercicio_duracao_total_semanal(conn, domain_slug: str, _: Optional[int], slug: str) -> dict:
    row = conn.execute(
        "SELECT SUM(CAST(json_extract(payload, '$.duracao_min') AS INTEGER)) AS total, "
        "       MAX(atualizado_em) AS last_at, COUNT(*) AS n "
        "FROM health_record WHERE domain_slug = ? AND data >= ?",
        (domain_slug, _days_ago_iso(6)),
    ).fetchone()
    if not row or not row["n"]:
        return _empty(slug, "int", "min")
    return _ok(slug, "int", "min", int(row["total"] or 0), row["last_at"])


def _exercicio_distribuicao_tipo(conn, domain_slug: str, _: Optional[int], slug: str) -> dict:
    rows = conn.execute(
        "SELECT i.nome AS item_nome, COUNT(*) AS n, MAX(r.atualizado_em) AS last_at "
        "FROM health_record r LEFT JOIN health_item i ON r.item_id = i.id "
        "WHERE r.domain_slug = ? AND r.data >= ? "
        "GROUP BY r.item_id, i.nome",
        (domain_slug, _days_ago_iso(29)),
    ).fetchall()
    if not rows:
        return _empty(slug, "dict", "%")
    total = sum(r["n"] for r in rows)
    distribuicao = {(r["item_nome"] or "—"): round(r["n"] / total * 100, 1) for r in rows}
    last_at = max((r["last_at"] for r in rows if r["last_at"]), default=None)
    return _ok(slug, "dict", "%", distribuicao, last_at)


def _exercicio_ultima_sessao(conn, domain_slug: str, _: Optional[int], slug: str) -> dict:
    row = conn.execute(
        "SELECT MAX(data) AS d, MAX(atualizado_em) AS last_at "
        "FROM health_record WHERE domain_slug = ?",
        (domain_slug,),
    ).fetchone()
    if not row or not row["d"]:
        return _empty(slug, "date", None)
    return _ok(slug, "date", None, row["d"], row["last_at"])


# ─── Handlers — Alimentação (template refeicao_2modos) ───────────────────

def _alimentacao_iter_eventos(conn, domain_slug: str, since: str):
    """Itera eventos de alimentação numa janela, normalizando os dois formatos:
       - Legado: 1 record/refeição → 1 evento
       - Novo: 1 record/dia com refeicoes[] → N eventos

    Yields dicts com forma uniforme:
      {tipo: 'planned'|'free', comeu: 'sim'|'parcial'|'nao'|None,
       item_id: int|None, horario: str|None, last_at: str}
    """
    rows = conn.execute(
        "SELECT id, item_id, horario, payload, atualizado_em "
        "FROM health_record WHERE domain_slug = ? AND data >= ?",
        (domain_slug, since),
    ).fetchall()
    for r in rows:
        try:
            payload = json.loads(r["payload"]) if isinstance(r["payload"], str) else (r["payload"] or {})
        except (json.JSONDecodeError, TypeError):
            continue
        refeicoes = payload.get("refeicoes")
        if isinstance(refeicoes, list):
            for ref in refeicoes:
                if not isinstance(ref, dict):
                    continue
                tipo = ref.get("tipo")
                if tipo == "planned":
                    yield {
                        "tipo": "planned",
                        "comeu": ref.get("comeu"),
                        "item_id": ref.get("item_id") if isinstance(ref.get("item_id"), int) else None,
                        "horario": ref.get("horario") if isinstance(ref.get("horario"), str) else None,
                        "last_at": r["atualizado_em"],
                    }
                elif tipo == "free":
                    yield {
                        "tipo": "free",
                        "comeu": None,
                        "item_id": None,
                        "horario": ref.get("horario") if isinstance(ref.get("horario"), str) else None,
                        "last_at": r["atualizado_em"],
                    }
        else:
            # Legacy
            if r["item_id"] is None:
                yield {
                    "tipo": "free",
                    "comeu": None,
                    "item_id": None,
                    "horario": r["horario"],
                    "last_at": r["atualizado_em"],
                }
            else:
                comeu_legacy = payload.get("comeu", False)
                yield {
                    "tipo": "planned",
                    "comeu": "sim" if comeu_legacy else "nao",
                    "item_id": r["item_id"],
                    "horario": r["horario"],
                    "last_at": r["atualizado_em"],
                }


def _alimentacao_aderencia_dieta_semanal(conn, domain_slug: str, _: Optional[int], slug: str) -> dict:
    """Aderência = peso(planned eatings) / (num_items_ativos * 7).
    Peso: sim=1.0, parcial=0.5, nao=0.0. Cobre legado e novo formato.
    """
    n_items = conn.execute(
        "SELECT COUNT(*) AS n FROM health_item WHERE domain_slug = ? AND arquivado = 0",
        (domain_slug,),
    ).fetchone()["n"]
    if n_items == 0:
        return _empty(slug, "float", "%")
    weight_total = 0.0
    last_at = None
    for ev in _alimentacao_iter_eventos(conn, domain_slug, _days_ago_iso(6)):
        if ev["tipo"] != "planned":
            continue
        if ev["comeu"] == "sim":
            weight_total += 1.0
        elif ev["comeu"] == "parcial":
            weight_total += 0.5
        if ev["last_at"] and (last_at is None or ev["last_at"] > last_at):
            last_at = ev["last_at"]
    pct = round((weight_total / (n_items * 7)) * 100, 1)
    if last_at is None:
        return _empty(slug, "float", "%")
    return _ok(slug, "float", "%", pct, last_at)


def _alimentacao_pulos_semanais(conn, domain_slug: str, _: Optional[int], slug: str) -> dict:
    count = 0
    last_at = None
    for ev in _alimentacao_iter_eventos(conn, domain_slug, _days_ago_iso(6)):
        if ev["tipo"] == "planned" and ev["comeu"] == "nao":
            count += 1
            if ev["last_at"] and (last_at is None or ev["last_at"] > last_at):
                last_at = ev["last_at"]
    if last_at is None and count == 0:
        # Sem registros no período — sinaliza dados indisponíveis em vez de "0"
        any_row = conn.execute(
            "SELECT atualizado_em FROM health_record WHERE domain_slug = ? LIMIT 1",
            (domain_slug,),
        ).fetchone()
        if not any_row:
            return _empty(slug, "int", None)
    return _ok(slug, "int", None, count, last_at)


def _alimentacao_fora_dieta_semanal(conn, domain_slug: str, _: Optional[int], slug: str) -> dict:
    count = 0
    last_at = None
    for ev in _alimentacao_iter_eventos(conn, domain_slug, _days_ago_iso(6)):
        if ev["tipo"] == "free":
            count += 1
            if ev["last_at"] and (last_at is None or ev["last_at"] > last_at):
                last_at = ev["last_at"]
    if last_at is None and count == 0:
        any_row = conn.execute(
            "SELECT atualizado_em FROM health_record WHERE domain_slug = ? LIMIT 1",
            (domain_slug,),
        ).fetchone()
        if not any_row:
            return _empty(slug, "int", None)
    return _ok(slug, "int", None, count, last_at)


def _alimentacao_pontualidade_media(conn, domain_slug: str, _: Optional[int], slug: str) -> dict:
    # Mapeia item_id → horario_esperado (uma vez)
    item_rows = conn.execute(
        "SELECT id, horario_esperado FROM health_item "
        "WHERE domain_slug = ? AND horario_esperado IS NOT NULL",
        (domain_slug,),
    ).fetchall()
    expected_by_item = {r["id"]: r["horario_esperado"] for r in item_rows}
    if not expected_by_item:
        return _empty(slug, "int", "min")
    diffs: list[int] = []
    last_at = None
    for ev in _alimentacao_iter_eventos(conn, domain_slug, _days_ago_iso(6)):
        if ev["tipo"] != "planned":
            continue
        if ev["comeu"] not in ("sim", "parcial"):
            continue
        if ev["horario"] is None or ev["item_id"] is None:
            continue
        expected = expected_by_item.get(ev["item_id"])
        if expected is None:
            continue
        try:
            t1 = int(ev["horario"][:2]) * 60 + int(ev["horario"][3:5])
            t2 = int(expected[:2]) * 60 + int(expected[3:5])
            diffs.append(abs(t1 - t2))
            if ev["last_at"] and (last_at is None or ev["last_at"] > last_at):
                last_at = ev["last_at"]
        except (ValueError, TypeError):
            continue
    if not diffs:
        return _empty(slug, "int", "min")
    return _ok(slug, "int", "min", int(sum(diffs) / len(diffs)), last_at)


# ─── Handlers — Vícios (template consumo_vontade, parametrizado por item) ─

def _vicio_consumo_total_30d(conn, domain_slug: str, item_id: Optional[int], slug: str) -> dict:
    if item_id is None:
        return _empty(slug, "float", "(unidade do item)")
    # `COALESCE` cobre os dois formatos do payload de consumo_vontade:
    #   - legado: { quantidade: N }                                — usa N
    #   - cigarro: { eventos: [{horario}, ...] }                   — usa len(eventos)
    # `json_array_length` retorna 0 quando o path não existe, então o
    # COALESCE só cai nele quando quantidade é NULL.
    row = conn.execute(
        "SELECT SUM(CAST(COALESCE(json_extract(payload, '$.quantidade'), "
        "                          json_array_length(payload, '$.eventos')) AS REAL)) AS total, "
        "       MAX(atualizado_em) AS last_at, COUNT(*) AS n "
        "FROM health_record WHERE domain_slug = ? AND item_id = ? AND data >= ?",
        (domain_slug, item_id, _days_ago_iso(29)),
    ).fetchone()
    if not row or not row["n"]:
        return _empty(slug, "float", "(unidade do item)")
    return _ok(slug, "float", "(unidade do item)", round(row["total"] or 0, 2), row["last_at"])


def _vicio_consumo_medio_diario_30d(conn, domain_slug: str, item_id: Optional[int], slug: str) -> dict:
    total = _vicio_consumo_total_30d(conn, domain_slug, item_id, slug)
    if not total["dados_disponiveis"]:
        return _empty(slug, "float", "(unidade do item)/dia")
    return _ok(slug, "float", "(unidade do item)/dia", round((total["valor"] or 0) / 30, 2), total["ultima_atualizacao"])


def _vicio_dias_desde_ultimo_consumo(conn, domain_slug: str, item_id: Optional[int], slug: str) -> dict:
    if item_id is None:
        return _empty(slug, "int", "dias")
    # Aceita os dois formatos do payload — consumo > 0 OU eventos não-vazios.
    row = conn.execute(
        "SELECT MAX(data) AS d, MAX(atualizado_em) AS last_at "
        "FROM health_record WHERE domain_slug = ? AND item_id = ? "
        "  AND (CAST(json_extract(payload, '$.quantidade') AS REAL) > 0 "
        "       OR json_array_length(payload, '$.eventos') > 0)",
        (domain_slug, item_id),
    ).fetchone()
    if not row or not row["d"]:
        return _empty(slug, "int", "dias")
    diff = (_today() - date.fromisoformat(row["d"])).days
    return _ok(slug, "int", "dias", max(diff, 0), row["last_at"])


def _vicio_tempo_desde_ultimo_consumo(conn, domain_slug: str, item_id: Optional[int], slug: str) -> dict:
    """Tempo desde último evento de consumo, formatado adaptativamente:
       < 1h  → 'Xm'
       < 24h → 'Xh' ou 'XhYY'
       ≥ 24h → 'Nd'

    Suporta os dois formatos de payload do consumo_vontade:
      - Legado: { quantidade: N, ... } — usa data + horario do registro
      - Novo (cigarro): { eventos: [{horario}], ... } — usa max(eventos.horario)

    Retorna 'string' pra que o display do Dashboard/Domain renderize direto.
    """
    if item_id is None:
        return _empty(slug, "string", None)
    # Puxamos o último registro com consumo > 0 OR eventos não-vazios. Ordem
    # por (data, horario) DESC pega o mais recente — mas pra eventos, o horario
    # do registro reflete o último evento (mantido em sync no save).
    row = conn.execute(
        "SELECT data, horario, payload, atualizado_em FROM health_record "
        "WHERE domain_slug = ? AND item_id = ? "
        "  AND (CAST(json_extract(payload, '$.quantidade') AS REAL) > 0 "
        "       OR json_array_length(payload, '$.eventos') > 0) "
        "ORDER BY data DESC, COALESCE(horario, '00:00') DESC LIMIT 1",
        (domain_slug, item_id),
    ).fetchone()
    if not row or not row["data"]:
        return _empty(slug, "string", None)
    # Determina o horário mais recente do registro:
    # 1. Se eventos[] não-vazio: pega max(eventos.horario)
    # 2. Senão: usa row.horario (legado) ou meio-dia como fallback
    try:
        payload = json.loads(row["payload"]) if isinstance(row["payload"], str) else (row["payload"] or {})
    except (json.JSONDecodeError, TypeError):
        payload = {}
    horario_evento: Optional[str] = None
    eventos = payload.get("eventos")
    if isinstance(eventos, list) and eventos:
        horarios = [
            e.get("horario") for e in eventos
            if isinstance(e, dict) and isinstance(e.get("horario"), str)
        ]
        if horarios:
            horario_evento = max(horarios)
    horario_final = horario_evento or row["horario"] or "12:00"
    try:
        ts = datetime.fromisoformat(f"{row['data']}T{horario_final}:00")
    except ValueError:
        return _empty(slug, "string", None)
    now = datetime.now()
    delta = now - ts
    total_seconds = delta.total_seconds()
    if total_seconds < 0:
        return _ok(slug, "string", None, "0m", row["atualizado_em"])
    total_min = int(total_seconds // 60)
    horas = total_min // 60
    minutos = total_min % 60
    if horas < 1:
        valor = f"{minutos}m"
    elif horas < 24:
        valor = f"{horas}h" if minutos == 0 else f"{horas}h{minutos:02d}"
    else:
        dias = horas // 24
        valor = f"{dias}d"
    return _ok(slug, "string", None, valor, row["atualizado_em"])


def _vicio_vontade_media_30d(conn, domain_slug: str, item_id: Optional[int], slug: str) -> dict:
    if item_id is None:
        return _empty(slug, "float", "1-5")
    row = conn.execute(
        "SELECT AVG(CAST(json_extract(payload, '$.vontade') AS REAL)) AS avg_v, "
        "       MAX(atualizado_em) AS last_at, COUNT(json_extract(payload, '$.vontade')) AS n "
        "FROM health_record "
        "WHERE domain_slug = ? AND item_id = ? AND data >= ? "
        "  AND json_extract(payload, '$.vontade') IS NOT NULL",
        (domain_slug, item_id, _days_ago_iso(29)),
    ).fetchone()
    if not row or not row["n"] or row["avg_v"] is None:
        return _empty(slug, "float", "1-5")
    return _ok(slug, "float", "1-5", round(row["avg_v"], 2), row["last_at"])


def _vicio_tendencia_7d(conn, domain_slug: str, item_id: Optional[int], slug: str) -> dict:
    if item_id is None:
        return _empty(slug, "enum", "subindo/caindo/estavel")

    def sum_window(from_iso: str, to_iso: str) -> float:
        # COALESCE cobre legado (quantidade) + novo (eventos[]).
        r = conn.execute(
            "SELECT SUM(CAST(COALESCE(json_extract(payload, '$.quantidade'), "
            "                          json_array_length(payload, '$.eventos')) AS REAL)) AS s "
            "FROM health_record WHERE domain_slug = ? AND item_id = ? "
            "  AND data >= ? AND data <= ?",
            (domain_slug, item_id, from_iso, to_iso),
        ).fetchone()
        return r["s"] or 0.0

    today = _today()
    window_curr = sum_window((today - timedelta(days=6)).isoformat(), today.isoformat())
    window_prev = sum_window((today - timedelta(days=13)).isoformat(), (today - timedelta(days=7)).isoformat())
    last_at_row = conn.execute(
        "SELECT MAX(atualizado_em) AS last_at FROM health_record WHERE domain_slug = ? AND item_id = ?",
        (domain_slug, item_id),
    ).fetchone()
    if window_curr == 0 and window_prev == 0:
        return _empty(slug, "enum", "subindo/caindo/estavel")
    return _ok(slug, "enum", "subindo/caindo/estavel", _trend(window_curr, window_prev), last_at_row["last_at"] if last_at_row else None)


# ─── Handlers — Medidas (template metrica_simples, parametrizado por item) ─

def _medida_ultimo_valor(conn, domain_slug: str, item_id: Optional[int], slug: str) -> dict:
    if item_id is None:
        return _empty(slug, "float", "(unidade do item)")
    row = conn.execute(
        "SELECT CAST(json_extract(payload, '$.valor') AS REAL) AS v, data, atualizado_em "
        "FROM health_record WHERE domain_slug = ? AND item_id = ? "
        "ORDER BY data DESC, atualizado_em DESC LIMIT 1",
        (domain_slug, item_id),
    ).fetchone()
    if not row or row["v"] is None:
        return _empty(slug, "float", "(unidade do item)")
    return _ok(slug, "float", "(unidade do item)", round(row["v"], 2), row["atualizado_em"])


def _medida_tendencia_window(conn, domain_slug: str, item_id: Optional[int], slug: str, dias: int) -> dict:
    if item_id is None:
        return _empty(slug, "enum", "subindo/caindo/estavel")

    def avg_window(from_iso: str, to_iso: str) -> Optional[float]:
        r = conn.execute(
            "SELECT AVG(CAST(json_extract(payload, '$.valor') AS REAL)) AS a "
            "FROM health_record WHERE domain_slug = ? AND item_id = ? "
            "  AND data >= ? AND data <= ?",
            (domain_slug, item_id, from_iso, to_iso),
        ).fetchone()
        return r["a"]

    today = _today()
    avg_curr = avg_window((today - timedelta(days=dias - 1)).isoformat(), today.isoformat())
    avg_prev = avg_window((today - timedelta(days=dias * 2 - 1)).isoformat(), (today - timedelta(days=dias)).isoformat())
    last_at_row = conn.execute(
        "SELECT MAX(atualizado_em) AS last_at FROM health_record WHERE domain_slug = ? AND item_id = ?",
        (domain_slug, item_id),
    ).fetchone()
    if avg_curr is None or avg_prev is None:
        return _empty(slug, "enum", "subindo/caindo/estavel")
    return _ok(slug, "enum", "subindo/caindo/estavel", _trend(avg_curr, avg_prev), last_at_row["last_at"] if last_at_row else None)


# ─── Handlers — Evento com escala (humor, energia, estresse) ─────────────

def _escala_media_window(conn, domain_slug: str, _: Optional[int], slug: str, dias: int) -> dict:
    row = conn.execute(
        "SELECT AVG(CAST(json_extract(payload, '$.escala') AS REAL)) AS avg_e, "
        "       MAX(atualizado_em) AS last_at, COUNT(*) AS n "
        "FROM health_record WHERE domain_slug = ? AND data >= ?",
        (domain_slug, _days_ago_iso(dias - 1)),
    ).fetchone()
    if not row or not row["n"] or row["avg_e"] is None:
        return _empty(slug, "float", "1-5")
    return _ok(slug, "float", "1-5", round(row["avg_e"], 2), row["last_at"])


# ─── Mapa de stats por template ──────────────────────────────────────────

# Pra evitar lambda capture issues com `dias`, defino wrappers explicitos.
def _h_sono_7d(conn, ds, ii, sl): return _sono_duracao_media(conn, ds, ii, 7, sl)
def _h_sono_30d(conn, ds, ii, sl): return _sono_duracao_media(conn, ds, ii, 30, sl)
def _h_medida_30d(conn, ds, ii, sl): return _medida_tendencia_window(conn, ds, ii, sl, 30)
def _h_medida_90d(conn, ds, ii, sl): return _medida_tendencia_window(conn, ds, ii, sl, 90)
def _h_escala_7d(conn, ds, ii, sl): return _escala_media_window(conn, ds, ii, sl, 7)
def _h_escala_30d(conn, ds, ii, sl): return _escala_media_window(conn, ds, ii, sl, 30)


STATS_BY_TEMPLATE: dict[str, list[StatDef]] = {
    "janela_qualidade": [
        StatDef("duracao_media_7d", "duração média 7d", "float", "h", False, _h_sono_7d),
        StatDef("duracao_media_30d", "duração média 30d", "float", "h", False, _h_sono_30d),
        StatDef("qualidade_media_30d", "qualidade média 30d", "float", "1-5", False, _sono_qualidade_media_30d),
        StatDef("hora_tipica_dormir_30d", "hora típica de dormir (mediana 30d)", "string", "HH:MM", False, _sono_hora_tipica_dormir_30d),
    ],
    "atividade_tipo": [
        StatDef("frequencia_semanal", "frequência semanal (média 4 sem)", "float", "sessões/sem", False, _exercicio_frequencia_semanal),
        StatDef("duracao_total_semanal", "duração total semanal", "int", "min", False, _exercicio_duracao_total_semanal),
        StatDef("distribuicao_tipo", "distribuição por tipo (30d)", "dict", "%", False, _exercicio_distribuicao_tipo),
        StatDef("ultima_sessao", "última sessão", "date", None, False, _exercicio_ultima_sessao),
    ],
    "refeicao_2modos": [
        StatDef("aderencia_dieta_semanal", "aderência à dieta (7d)", "float", "%", False, _alimentacao_aderencia_dieta_semanal),
        StatDef("pulos_semanais", "pulos da dieta (7d)", "int", None, False, _alimentacao_pulos_semanais),
        StatDef("fora_dieta_semanal", "registros fora da dieta (7d)", "int", None, False, _alimentacao_fora_dieta_semanal),
        StatDef("pontualidade_media", "desvio médio horário esperado (7d)", "int", "min", False, _alimentacao_pontualidade_media),
    ],
    "consumo_vontade": [
        StatDef("consumo_total_30d", "consumo total 30d", "float", "(unidade do item)", True, _vicio_consumo_total_30d),
        StatDef("consumo_medio_diario_30d", "consumo médio diário 30d", "float", "(unidade do item)/dia", True, _vicio_consumo_medio_diario_30d),
        StatDef("dias_desde_ultimo_consumo", "dias desde último consumo", "int", "dias", True, _vicio_dias_desde_ultimo_consumo),
        StatDef("tempo_desde_ultimo_consumo", "tempo desde último consumo", "string", None, True, _vicio_tempo_desde_ultimo_consumo),
        StatDef("vontade_media_30d", "vontade média 30d", "float", "1-5", True, _vicio_vontade_media_30d),
        StatDef("tendencia_7d", "tendência 7d (vs 7d anterior)", "enum", "subindo/caindo/estavel", True, _vicio_tendencia_7d),
    ],
    "metrica_simples": [
        StatDef("ultimo_valor", "último valor", "float", "(unidade do item)", True, _medida_ultimo_valor),
        StatDef("tendencia_30d", "tendência 30d (vs 30d anterior)", "enum", "subindo/caindo/estavel", True, _h_medida_30d),
        StatDef("tendencia_90d", "tendência 90d (vs 90d anterior)", "enum", "subindo/caindo/estavel", True, _h_medida_90d),
    ],
    "evento_escala": [
        StatDef("media_7d", "média 7d", "float", "1-5", False, _h_escala_7d),
        StatDef("media_30d", "média 30d", "float", "1-5", False, _h_escala_30d),
    ],
}


# ─── API pública ──────────────────────────────────────────────────────────

def get_metric_meta(slug: str) -> Optional[dict]:
    """Retorna metadata de uma métrica pelo slug, ou None se não existe.

    Compat com /Build (que valida `metric_slug` de guardrail sem ter `conn`
    explícita). Abre própria conexão. Custo OK pra uso esporádico.
    """
    from db import get_conn                            # import local pra evitar ciclo
    with get_conn() as conn:
        catalog = list_metrics_catalog(conn)
    for m in catalog:
        if m["slug"] == slug:
            return m
    return None


def list_metrics_catalog(conn) -> list[dict]:
    """Catálogo dinâmico — gera métricas pra todos os domínios ativos com
    base no template de cada um. Domínios customizados ganham métricas
    automaticamente."""
    domains = conn.execute(
        "SELECT slug, nome, template FROM health_domain "
        "WHERE ativo = 1 ORDER BY ordem ASC"
    ).fetchall()
    catalog: list[dict] = []
    for d in domains:
        stats = STATS_BY_TEMPLATE.get(d["template"], [])
        for stat in stats:
            catalog.append({
                "slug": f"{d['slug']}_{stat.key}",
                "nome": f"{d['nome']} — {stat.nome}",
                "domain_slug": d["slug"],
                "tipo_retorno": stat.tipo_retorno,
                "unidade": stat.unidade,
                "precisa_item": stat.precisa_item,
            })
    return catalog


def _parse_metric_slug(conn, slug: str) -> Optional[tuple[str, str, StatDef]]:
    """Dado um slug `{domain_slug}_{stat_key}`, identifica o domínio e a stat.
    Retorna (domain_slug, stat_key, StatDef) ou None se desconhecido."""
    domains = conn.execute(
        "SELECT slug, template FROM health_domain WHERE ativo = 1"
    ).fetchall()
    # Tenta cada domínio como prefix. Domínio mais longo ganha (cobre caso de
    # 'sono' vs 'sono_extra' onde ambos seriam prefix válido).
    candidatos = sorted(
        [(d["slug"], d["template"]) for d in domains],
        key=lambda x: -len(x[0]),
    )
    for d_slug, template in candidatos:
        prefix = f"{d_slug}_"
        if slug.startswith(prefix):
            stat_key = slug[len(prefix):]
            for stat in STATS_BY_TEMPLATE.get(template, []):
                if stat.key == stat_key:
                    return (d_slug, stat_key, stat)
    return None


def calculate_metric(conn, slug: str, item_id: Optional[int] = None) -> dict:
    """Calcula uma métrica pelo slug. Retorna dict com valor + metadata.

    Se a métrica não existe, retorna estrutura com `dados_disponiveis: false`
    e campo `erro`. Caller (router) decide se converte em 404 HTTP.
    """
    parsed = _parse_metric_slug(conn, slug)
    if parsed is None:
        return {
            "slug": slug,
            "valor": None,
            "unidade": None,
            "tipo_retorno": None,
            "dados_disponiveis": False,
            "ultima_atualizacao": None,
            "erro": "Métrica desconhecida",
        }
    domain_slug, _stat_key, stat = parsed
    if stat.precisa_item and item_id is None:
        result = _empty(slug, stat.tipo_retorno, stat.unidade)
        result["erro"] = "Métrica precisa de item_id"
        return result
    return stat.handler(conn, domain_slug, item_id, slug)
