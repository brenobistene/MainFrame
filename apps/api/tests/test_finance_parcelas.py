"""Testes de parcelas — apply_template (a_vista/50_50/3x/4x), arredondamento
de drift na última parcela, distribuição de datas mensais, e proteção de
parcelas recebidas ao re-aplicar template.

Casos críticos: 3x R$1000 = não pode dar R$333.33 + R$333.33 + R$333.33
(drift R$0.01 vira erro contábil). A função zera o drift na última.
"""
import pytest


def test_apply_template_a_vista_cria_1_parcela_full(client, project_factory):
    project_factory(id="p1", valor_acordado=1000.0)
    res = client.post(
        "/api/finance/projects/p1/parcelas/apply-template",
        json={"template": "a_vista", "data_inicio": None},
    )
    assert res.status_code == 200
    parcelas = res.json()
    assert len(parcelas) == 1
    assert parcelas[0]["valor"] == pytest.approx(1000.0)
    assert parcelas[0]["status"] == "pendente"
    assert parcelas[0]["data_prevista"] is None


def test_apply_template_50_50(client, project_factory):
    project_factory(id="p1", valor_acordado=500.0)
    res = client.post(
        "/api/finance/projects/p1/parcelas/apply-template",
        json={"template": "50_50", "data_inicio": None},
    )
    parcelas = res.json()
    assert len(parcelas) == 2
    assert all(p["valor"] == pytest.approx(250.0) for p in parcelas)
    # Soma deve fechar exato
    assert sum(p["valor"] for p in parcelas) == pytest.approx(500.0)


def test_apply_template_3x_corrige_drift_de_arredondamento(client, project_factory):
    """1000 / 3 = 333.333... — após round(2), 3x 333.33 = 999.99.
    A última parcela deve compensar o drift pra fechar exato em 1000.00."""
    project_factory(id="p1", valor_acordado=1000.0)
    res = client.post(
        "/api/finance/projects/p1/parcelas/apply-template",
        json={"template": "parcelado_3x", "data_inicio": None},
    )
    parcelas = res.json()
    assert len(parcelas) == 3
    # Primeiras 2 são round(1000/3, 2) = 333.33
    assert parcelas[0]["valor"] == pytest.approx(333.33)
    assert parcelas[1]["valor"] == pytest.approx(333.33)
    # Última é 1000 - 666.66 = 333.34 (drift compensado)
    assert parcelas[2]["valor"] == pytest.approx(333.34)
    # Soma fecha exato
    assert sum(p["valor"] for p in parcelas) == pytest.approx(1000.0)


def test_apply_template_4x_soma_fecha(client, project_factory):
    """4x R$333.33 com drift compensado."""
    project_factory(id="p1", valor_acordado=333.33)
    res = client.post(
        "/api/finance/projects/p1/parcelas/apply-template",
        json={"template": "parcelado_4x", "data_inicio": None},
    )
    parcelas = res.json()
    assert len(parcelas) == 4
    assert sum(p["valor"] for p in parcelas) == pytest.approx(333.33)


def test_apply_template_distribui_datas_mensalmente(client, project_factory):
    """Com data_inicio, as parcelas ficam no mesmo dia dos meses subsequentes."""
    project_factory(id="p1", valor_acordado=300.0)
    res = client.post(
        "/api/finance/projects/p1/parcelas/apply-template",
        json={"template": "parcelado_3x", "data_inicio": "2026-05-15"},
    )
    parcelas = res.json()
    assert parcelas[0]["data_prevista"] == "2026-05-15"
    assert parcelas[1]["data_prevista"] == "2026-06-15"
    assert parcelas[2]["data_prevista"] == "2026-07-15"


def test_apply_template_capa_dia_no_final_do_mes(client, project_factory):
    """Início dia 31 → fevereiro vira 28 (ou 29 em ano bissexto)."""
    project_factory(id="p1", valor_acordado=100.0)
    res = client.post(
        "/api/finance/projects/p1/parcelas/apply-template",
        json={"template": "parcelado_3x", "data_inicio": "2026-01-31"},
    )
    parcelas = res.json()
    assert parcelas[0]["data_prevista"] == "2026-01-31"
    assert parcelas[1]["data_prevista"] == "2026-02-28"  # 2026 não é bissexto
    assert parcelas[2]["data_prevista"] == "2026-03-31"


def test_apply_template_protege_parcelas_recebidas(client, project_factory):
    """Re-aplicar template não deve apagar parcelas com status != pendente."""
    import db as db_module
    project_factory(id="p1", valor_acordado=1000.0)

    # Cria parcela manualmente marcada como recebida
    with db_module.get_conn() as conn:
        conn.execute(
            "INSERT INTO fin_parcela(id, projeto_id, numero, valor, status) "
            "VALUES(?,?,?,?,?)",
            ("pre1", "p1", 99, 100.0, "recebido"),
        )
        conn.commit()

    # Aplica template — deve deletar só as pendentes, preservar a recebida
    res = client.post(
        "/api/finance/projects/p1/parcelas/apply-template",
        json={"template": "50_50", "data_inicio": None},
    )
    parcelas = res.json()
    # 3 no total: a recebida (preservada) + 2 do template novo
    assert len(parcelas) == 3
    recebidas = [p for p in parcelas if p["status"] == "recebido"]
    assert len(recebidas) == 1
    assert recebidas[0]["id"] == "pre1"


def test_apply_template_falha_sem_valor_acordado(client, project_factory):
    """Sem valor_acordado, retorna 422 (não cria parcelas)."""
    project_factory(id="p1", valor_acordado=None)
    res = client.post(
        "/api/finance/projects/p1/parcelas/apply-template",
        json={"template": "50_50", "data_inicio": None},
    )
    assert res.status_code == 422


def test_apply_template_falha_data_invalida(client, project_factory):
    """Data inválida retorna 400."""
    project_factory(id="p1", valor_acordado=500.0)
    res = client.post(
        "/api/finance/projects/p1/parcelas/apply-template",
        json={"template": "50_50", "data_inicio": "31/12/2026"},  # formato BR errado
    )
    assert res.status_code == 400


def test_apply_template_projeto_inexistente(client):
    res = client.post(
        "/api/finance/projects/nao-existe/parcelas/apply-template",
        json={"template": "a_vista", "data_inicio": None},
    )
    assert res.status_code == 404
