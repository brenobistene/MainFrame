"""Computa pendências do Hub Health (lembretes proativos + ausência retroativa).

Lembretes: dispara quando passou do horário esperado e ainda não há registro.
Ausência: dispara quando passou do `ausencia_threshold_dias` sem registro.

Filosofia "observação > julgamento" (RASCUNHO §3.2):
- Vícios e Medidas Corporais NÃO mostram âmbar de ausência (ausencia_threshold_dias=null)
- **Vícios NÃO geram lembrete** — proteção dura no código (template `consumo_vontade`),
  mesmo se `lembrete_ativo=1` for setado por engano. Filosofia §3.5: vício é
  território íntimo, sistema não cobra observação.
- Tom factual em todas as mensagens — "sem registro há 3 dias", não "você falhou"
- Lembrete some quando registra OU quando o dia vira

Despacho por **template** (não por slug) — domínios customizados que usem o
mesmo template (ex: criar "Cochilo Diurno" como `janela_qualidade`) ganham
o mesmo tratamento. Antes era hardcoded `if slug == "sono"`.

Configurabilidade (regra "sem hardcoded"):
- `lembrete_ativo` (bool) por domínio
- `ausencia_threshold_dias` (int|null) por domínio
- `health_settings.hora_lembrete_sono` (HH:MM) — quando lembrete de sono dispara
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, time
from typing import Optional


# Templates que NUNCA geram lembrete (filosofia §3.5 do RASCUNHO).
# Mesmo se `lembrete_ativo=1`, ignorado pra esses templates.
TEMPLATES_SEM_LEMBRETE = {"consumo_vontade"}

# Templates que NUNCA geram âmbar de ausência (mesma filosofia).
# Mesmo se `ausencia_threshold_dias` setado, ignorado pra esses.
TEMPLATES_SEM_AUSENCIA = {"consumo_vontade", "metrica_simples"}


def _today() -> date:
    return date.today()


def _yesterday() -> date:
    return _today() - timedelta(days=1)


def _now_time() -> time:
    return datetime.now().time()


def _parse_hhmm(s: Optional[str]) -> Optional[time]:
    if not s or len(s) != 5 or s[2] != ':':
        return None
    try:
        return time(int(s[:2]), int(s[3:5]))
    except ValueError:
        return None


# Janela em que o lembrete de sono noturno faz sentido. Antes do início do
# período, é cedo demais; depois do fim, já tá tarde — o usuário vai dormir
# de novo e a noite "perdeu o ponteiro". Faixa configurável no futuro.
SONO_LEMBRETE_INICIO_DEFAULT = time(10, 0)        # 10:00
SONO_LEMBRETE_FIM = time(14, 0)                    # 14:00 (depois disso some)

# Pra Alimentação: depois de N horas após o `horario_esperado`, a refeição
# perdeu o ponteiro. Mantém o slot visível no histórico, mas tira da lista
# de pendentes ativas.
ALIMENTACAO_CUTOFF_HORAS = 4


def compute_pending(conn) -> list[dict]:
    """Retorna lista de pendências do dia. Ordem: lembretes primeiro
    (acionáveis agora), depois ausências (passivas)."""
    pending: list[dict] = []

    # Settings — hora_lembrete_sono (HH:MM, default '10:00')
    settings_row = conn.execute(
        "SELECT hora_lembrete_sono FROM health_settings WHERE id = 1"
    ).fetchone()
    hora_lembrete_sono = (
        _parse_hhmm(settings_row["hora_lembrete_sono"])
        if settings_row and settings_row["hora_lembrete_sono"]
        else SONO_LEMBRETE_INICIO_DEFAULT
    ) or SONO_LEMBRETE_INICIO_DEFAULT

    domains = conn.execute(
        "SELECT slug, nome, template, lembrete_ativo, ausencia_threshold_dias, ativo, "
        "criado_em "
        "FROM health_domain WHERE ativo = 1 ORDER BY ordem ASC"
    ).fetchall()

    today_iso = _today().isoformat()
    yesterday_iso = _yesterday().isoformat()
    now_t = _now_time()

    # ─── Lembretes (proativo) ────────────────────────────────────────────
    for d in domains:
        slug = d["slug"]
        template = d["template"]

        if not d["lembrete_ativo"]:
            continue
        if template in TEMPLATES_SEM_LEMBRETE:
            # Filosofia §3.5: sistema não cobra observação em vícios
            continue

        if template == "janela_qualidade":
            # Lembrete de sono noturno: dispara só na janela [hora_lembrete, 14h)
            # Fora dessa janela é cedo demais ou tarde demais.
            if now_t < hora_lembrete_sono or now_t >= SONO_LEMBRETE_FIM:
                continue
            row = conn.execute(
                "SELECT 1 FROM health_record "
                "WHERE domain_slug = ? "
                "  AND data = ? "
                "  AND COALESCE(json_extract(payload, '$.tipo'), 'noturno') != 'cochilo' "
                "LIMIT 1",
                (slug, yesterday_iso),
            ).fetchone()
            if not row:
                pending.append({
                    "tipo": "lembrete",
                    "domain_slug": slug,
                    "domain_nome": d["nome"],
                    "item_id": None,
                    "item_nome": None,
                    "descricao": "esperado registro do noturno",
                    "horario_esperado": hora_lembrete_sono.strftime("%H:%M"),
                    "dias": None,
                })

        elif template == "refeicao_2modos":
            # Lembrete por item: cada refeição com horario_esperado já passado
            # (mas dentro do cutoff) e SEM registro hoje pra aquele item.
            #
            # Suporta os dois formatos de payload no mesmo dia:
            #   1. Legado: 1 record por refeição, `r.item_id` aponta pro item
            #   2. Novo agrupado: 1 record/dia com `payload.refeicoes[]`
            #      contendo eventos `{tipo: 'planned', item_id: N, comeu}`
            #
            # Antes só checava (1); por isso lembrete não sumia no formato novo.
            today_records = conn.execute(
                "SELECT item_id, payload FROM health_record "
                "WHERE domain_slug = ? AND data = ?",
                (slug, today_iso),
            ).fetchall()
            already_registered: set[int] = set()
            for rec in today_records:
                if rec["item_id"] is not None:
                    already_registered.add(rec["item_id"])
                try:
                    pl = (
                        json.loads(rec["payload"])
                        if isinstance(rec["payload"], str)
                        else (rec["payload"] or {})
                    )
                except (json.JSONDecodeError, TypeError):
                    pl = {}
                refs = pl.get("refeicoes")
                if isinstance(refs, list):
                    for ref in refs:
                        if not isinstance(ref, dict):
                            continue
                        if ref.get("tipo") != "planned":
                            continue
                        rid = ref.get("item_id")
                        if isinstance(rid, int):
                            already_registered.add(rid)

            items = conn.execute(
                "SELECT id, nome, horario_esperado FROM health_item "
                "WHERE domain_slug = ? "
                "  AND arquivado = 0 "
                "  AND horario_esperado IS NOT NULL "
                "ORDER BY horario_esperado ASC",
                (slug,),
            ).fetchall()
            now_minutes = now_t.hour * 60 + now_t.minute
            for it in items:
                if it["id"] in already_registered:
                    continue
                he = _parse_hhmm(it["horario_esperado"])
                if he is None:
                    continue
                if now_t < he:
                    continue                          # ainda não passou
                cutoff_minutes = (
                    he.hour * 60 + he.minute + ALIMENTACAO_CUTOFF_HORAS * 60
                )
                if now_minutes > cutoff_minutes:
                    continue                          # tarde demais
                pending.append({
                    "tipo": "lembrete",
                    "domain_slug": slug,
                    "domain_nome": d["nome"],
                    "item_id": it["id"],
                    "item_nome": it["nome"],
                    "descricao": f"esperado às {it['horario_esperado']}, sem registro",
                    "horario_esperado": it["horario_esperado"],
                    "dias": None,
                })

        else:
            # Demais templates (atividade_tipo, metrica_simples, evento_escala):
            # se lembrete_ativo=1, lembra diariamente. Default é desligado, então
            # só dispara se usuário ativou explicitamente.
            row = conn.execute(
                "SELECT 1 FROM health_record "
                "WHERE domain_slug = ? AND data = ? LIMIT 1",
                (slug, today_iso),
            ).fetchone()
            if not row:
                pending.append({
                    "tipo": "lembrete",
                    "domain_slug": slug,
                    "domain_nome": d["nome"],
                    "item_id": None,
                    "item_nome": None,
                    "descricao": "sem registro hoje",
                    "horario_esperado": None,
                    "dias": None,
                })

    # ─── Ausência (retroativo) ───────────────────────────────────────────
    for d in domains:
        slug = d["slug"]
        template = d["template"]
        threshold = d["ausencia_threshold_dias"]

        if threshold is None:
            continue                                  # sem âmbar configurado
        if template in TEMPLATES_SEM_AUSENCIA:
            # Vícios e Medidas: filosofia "sem cobrança"
            continue

        # Pra janela_qualidade (Sono), "registro relevante" = noturno (não cochilo)
        if template == "janela_qualidade":
            row = conn.execute(
                "SELECT MAX(data) AS last_data FROM health_record "
                "WHERE domain_slug = ? "
                "  AND COALESCE(json_extract(payload, '$.tipo'), 'noturno') != 'cochilo'",
                (slug,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT MAX(data) AS last_data FROM health_record "
                "WHERE domain_slug = ?",
                (slug,),
            ).fetchone()

        last_iso = row["last_data"] if row else None
        # Pra Sono, comparamos com a "noite que terminou hoje" (= ontem)
        ref_date = _yesterday() if template == "janela_qualidade" else _today()

        if not last_iso:
            # Sem nenhum registro nunca. Aplica período de graça baseado em
            # `criado_em`: só começa a cobrar depois que passou o `threshold`
            # de dias desde a criação do domínio. Antes era "nunca cobra",
            # mas isso escondia domínios que o usuário criou pra começar (ex:
            # Exercício) e nunca apareciam como pendentes.
            criado_iso = (d["criado_em"] or "")[:10]
            try:
                criado = date.fromisoformat(criado_iso)
            except ValueError:
                continue                              # criado_em ausente/corrompido
            diff = (ref_date - criado).days
            if diff < threshold:
                continue                              # ainda no período de graça
            pending.append({
                "tipo": "ausencia",
                "domain_slug": slug,
                "domain_nome": d["nome"],
                "item_id": None,
                "item_nome": None,
                "descricao": (
                    f"sem nenhum registro · criado há {diff} dia"
                    f"{'s' if diff != 1 else ''}"
                ),
                "horario_esperado": None,
                "dias": diff,
            })
            continue

        last = date.fromisoformat(last_iso)
        diff = (ref_date - last).days
        if diff >= threshold:
            pending.append({
                "tipo": "ausencia",
                "domain_slug": slug,
                "domain_nome": d["nome"],
                "item_id": None,
                "item_nome": None,
                "descricao": f"sem registro há {diff} dia{'s' if diff != 1 else ''}",
                "horario_esperado": None,
                "dias": diff,
            })

    return pending
