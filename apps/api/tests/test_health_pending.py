"""Testes do `compute_pending` — calcula pendências do Hub Health pra /dia.

Cobre o caminho crítico do dedupe de lembrete vs ausência: se um domínio
tem ambos `lembrete_ativo=1` e `ausencia_threshold_dias!=null` E está há
dias sem registro, ele deve aparecer APENAS como lembrete (não duplicado
com uma entrada de ausência).

Doc: services/health_pending.py
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest


@pytest.fixture(autouse=True)
def _clean_health_seed(isolated_db):
    """init_db() popula 6 domínios default (sono, exercicio, alimentacao,
    vicios, medidas, mind). Testes precisam de cenários isolados — limpa
    tudo antes de cada teste. CASCADE remove items/records junto."""
    import db as db_module
    with db_module.get_conn() as conn:
        conn.execute("DELETE FROM health_record")
        conn.execute("DELETE FROM health_item")
        conn.execute("DELETE FROM health_domain")
        conn.commit()
    yield


def _insert_domain(
    conn,
    *,
    slug: str,
    template: str,
    nome: str = "",
    lembrete_ativo: int = 0,
    ausencia_threshold_dias: int | None = None,
    criado_em: str | None = None,
):
    conn.execute(
        "INSERT INTO health_domain (slug, nome, template, lembrete_ativo, "
        "ausencia_threshold_dias, ativo, ordem, criado_em) "
        "VALUES (?, ?, ?, ?, ?, 1, 1, ?)",
        (
            slug, nome or slug.title(), template, lembrete_ativo,
            ausencia_threshold_dias,
            criado_em or (date.today() - timedelta(days=60)).isoformat(),
        ),
    )


def _pending(conn) -> list[dict]:
    """Helper pra chamar compute_pending direto sem subir FastAPI."""
    from services.health_pending import compute_pending
    return compute_pending(conn)


# ─── Casos isolados (sanity) ─────────────────────────────────────────────

def test_sem_dominios_retorna_vazio(isolated_db):
    """DB vazio (sem domínios) → sem pendências. Cobre o caso 'usuário
    novo que ainda não configurou Hub Health'."""
    import db as db_module
    with db_module.get_conn() as conn:
        assert _pending(conn) == []


def test_dominio_sem_lembrete_nem_ausencia_ignorado(isolated_db):
    """Domain ativo mas sem `lembrete_ativo` e sem `ausencia_threshold_dias`
    nunca gera pendência — usuário escolheu observação passiva."""
    import db as db_module
    with db_module.get_conn() as conn:
        _insert_domain(conn, slug="hidratacao", template="atividade_tipo")
        conn.commit()
        assert _pending(conn) == []


def test_apenas_lembrete_sem_ausencia(isolated_db):
    """Domain só com lembrete: deve aparecer 1 entrada tipo 'lembrete'."""
    import db as db_module
    with db_module.get_conn() as conn:
        _insert_domain(
            conn, slug="exercicio", template="atividade_tipo",
            lembrete_ativo=1, ausencia_threshold_dias=None,
        )
        conn.commit()
        out = _pending(conn)
        assert len(out) == 1
        assert out[0]["tipo"] == "lembrete"
        assert out[0]["domain_slug"] == "exercicio"


def test_apenas_ausencia_sem_lembrete(isolated_db):
    """Domain só com ausência configurada (sem lembrete diário) e há mais
    de N dias sem registro → 1 entrada tipo 'ausencia'. Caso da Visão
    passiva onde o usuário quer só ser avisado se sumir."""
    import db as db_module
    old_iso = (date.today() - timedelta(days=30)).isoformat()
    with db_module.get_conn() as conn:
        _insert_domain(
            conn, slug="exercicio", template="atividade_tipo",
            lembrete_ativo=0, ausencia_threshold_dias=3,
            criado_em=old_iso,
        )
        conn.commit()
        out = _pending(conn)
        assert len(out) == 1
        assert out[0]["tipo"] == "ausencia"
        assert out[0]["domain_slug"] == "exercicio"


# ─── O dedupe (bug original) ─────────────────────────────────────────────

def test_dedupe_lembrete_oculta_ausencia(isolated_db):
    """**Bug original**: domain com lembrete_ativo=1 E ausencia_threshold
    aparecia duplicado (1 lembrete + 1 ausência). Agora ausência é
    suprimida quando já existe lembrete pro mesmo domain — o lembrete
    capta o sinal mais útil ('tem ação pra fazer hoje')."""
    import db as db_module
    old_iso = (date.today() - timedelta(days=30)).isoformat()
    with db_module.get_conn() as conn:
        _insert_domain(
            conn, slug="exercicio", template="atividade_tipo",
            lembrete_ativo=1, ausencia_threshold_dias=3,
            criado_em=old_iso,
        )
        conn.commit()
        out = _pending(conn)
        # Antes: 2 entradas (1 lembrete + 1 ausência). Agora: só lembrete.
        assert len(out) == 1
        assert out[0]["tipo"] == "lembrete"
        assert out[0]["domain_slug"] == "exercicio"


def test_dedupe_alimentacao_lembrete_por_item_oculta_ausencia(isolated_db):
    """Alimentação (refeicao_2modos) pode gerar múltiplos lembretes — um
    por item com `horario_esperado` passado. Quando há QUALQUER lembrete
    pro domain, ausência é suprimida pra evitar 'café da manhã + almoço +
    sem registro há N dias' (3 cards do mesmo domínio).

    Setup: 2 itens (café 06:00 e almoço 12:00, ambos no passado), sem
    registro hoje, e ausência threshold ativa há semanas. Esperado:
    apenas os lembretes por item, ausência suprimida.
    """
    import db as db_module
    old_iso = (date.today() - timedelta(days=30)).isoformat()
    with db_module.get_conn() as conn:
        _insert_domain(
            conn, slug="alimentacao", template="refeicao_2modos",
            lembrete_ativo=1, ausencia_threshold_dias=2,
            criado_em=old_iso,
        )
        # Dois itens com horário no passado (qualquer hora antes de "agora")
        conn.execute(
            "INSERT INTO health_item (domain_slug, nome, horario_esperado, arquivado) "
            "VALUES (?, ?, ?, 0)",
            ("alimentacao", "Café da manhã", "06:00"),
        )
        conn.execute(
            "INSERT INTO health_item (domain_slug, nome, horario_esperado, arquivado) "
            "VALUES (?, ?, ?, 0)",
            ("alimentacao", "Almoço", "12:00"),
        )
        conn.commit()
        out = _pending(conn)
        # Pode ter 0, 1 ou 2 lembretes dependendo do horário do test runner
        # (cutoff de 4h após horario_esperado). O importante é: NENHUMA
        # entrada tipo 'ausencia' aparece, mesmo com threshold disparado.
        ausencias = [p for p in out if p["tipo"] == "ausencia"]
        if any(p["tipo"] == "lembrete" for p in out):
            assert ausencias == [], (
                "Ausência não deveria aparecer quando há lembrete ativo no domain"
            )


def test_dois_dominios_dedupe_independente(isolated_db):
    """Dedupe é por domain — não afeta domínios distintos. Setup: dois
    domínios, um com lembrete (vai esconder ausência), outro só com
    ausência (deve aparecer). Confirma que o set de "domains com lembrete"
    não vaza entre domínios."""
    import db as db_module
    old_iso = (date.today() - timedelta(days=30)).isoformat()
    with db_module.get_conn() as conn:
        _insert_domain(
            conn, slug="exercicio", template="atividade_tipo",
            lembrete_ativo=1, ausencia_threshold_dias=3,
            criado_em=old_iso,
        )
        _insert_domain(
            conn, slug="meditacao", template="atividade_tipo",
            lembrete_ativo=0, ausencia_threshold_dias=3,
            criado_em=old_iso,
        )
        conn.commit()
        out = _pending(conn)
        by_slug = {p["domain_slug"]: p["tipo"] for p in out}
        assert by_slug == {
            "exercicio": "lembrete",
            "meditacao": "ausencia",
        }


def test_vicio_consumo_vontade_nunca_lembra_nem_ausencia(isolated_db):
    """Vícios (template `consumo_vontade`) são protegidos pela constante
    TEMPLATES_SEM_LEMBRETE/SEM_AUSENCIA — filosofia §3.5 do RASCUNHO.
    Mesmo com flags setadas, nunca geram pendência."""
    import db as db_module
    old_iso = (date.today() - timedelta(days=30)).isoformat()
    with db_module.get_conn() as conn:
        _insert_domain(
            conn, slug="cigarro", template="consumo_vontade",
            lembrete_ativo=1, ausencia_threshold_dias=2,
            criado_em=old_iso,
        )
        conn.commit()
        assert _pending(conn) == []


def test_registro_recente_cancela_ausencia(isolated_db):
    """Se há registro recente (dentro do threshold), ausência não dispara.
    Confere também que dedupe não interfere: domain sem lembrete e com
    registro recente = sem pendências."""
    import db as db_module
    today_iso = date.today().isoformat()
    with db_module.get_conn() as conn:
        _insert_domain(
            conn, slug="exercicio", template="atividade_tipo",
            lembrete_ativo=0, ausencia_threshold_dias=3,
        )
        conn.execute(
            "INSERT INTO health_record (domain_slug, data, payload) "
            "VALUES (?, ?, '{}')",
            ("exercicio", today_iso),
        )
        conn.commit()
        assert _pending(conn) == []
