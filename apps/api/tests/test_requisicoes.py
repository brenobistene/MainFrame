"""Testes do módulo Requisições (lista de compras pessoal).

Cobre o coração do design: cadência que reabre sozinha, média de preço
real, arquivamento do avulso, filtro por mês e desfazer compra.
"""
from __future__ import annotations

from datetime import date, timedelta


def _dias_atras(n: int) -> str:
    return (date.today() - timedelta(days=n)).isoformat()


def test_criar_listar_e_campos_computados(client):
    r = client.post("/api/requisicoes/itens", json={
        "nome": "Desodorante", "cadencia": "mensal",
        "categoria": "higiene", "preco_estimado": 22,
    })
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["nome"] == "Desodorante"
    assert item["aberta"] is True          # novo recorrente entra na lista
    assert item["compras_count"] == 0
    assert item["preco_medio"] == 22       # cai pra estimativa enquanto sem compra

    itens = client.get("/api/requisicoes/itens").json()
    assert any(i["id"] == item["id"] for i in itens)


def test_cadencia_reabre_e_marca_atraso(client):
    item = client.post("/api/requisicoes/itens", json={
        "nome": "Cotonete", "cadencia": "mensal",
    }).json()

    # Comprado há 40 dias (mensal = 30) → reabre e fica 10 dias atrasado.
    c = client.post(f"/api/requisicoes/itens/{item['id']}/comprar",
                    json={"bought_at": _dias_atras(40)}).json()
    assert c["aberta"] is True
    assert c["atrasado_dias"] == 10
    assert c["proximo_em_dias"] is None

    # Comprado hoje → em dia, sai da lista, volta em ~30 dias.
    c2 = client.post(f"/api/requisicoes/itens/{item['id']}/comprar",
                     json={"bought_at": date.today().isoformat()}).json()
    assert c2["aberta"] is False
    assert c2["atrasado_dias"] is None
    assert c2["proximo_em_dias"] == 30


def test_media_de_preco_real(client):
    item = client.post("/api/requisicoes/itens", json={
        "nome": "Creme", "cadencia": "mensal", "preco_estimado": 50,
    }).json()
    client.post(f"/api/requisicoes/itens/{item['id']}/comprar", json={"valor_pago": 30})
    c = client.post(f"/api/requisicoes/itens/{item['id']}/comprar", json={"valor_pago": 20}).json()
    assert c["preco_medio"] == 25          # média real (30+20)/2, ignora a estimativa
    assert c["compras_count"] == 2


def test_avulso_arquiva_apos_comprar(client):
    item = client.post("/api/requisicoes/itens", json={
        "nome": "Carregador USB-C", "cadencia": "avulso",
    }).json()
    assert item["aberta"] is True
    c = client.post(f"/api/requisicoes/itens/{item['id']}/comprar", json={"valor_pago": 45}).json()
    assert c["arquivado"] is True
    assert c["aberta"] is False
    # Sai da lista ativa (compra única).
    itens = client.get("/api/requisicoes/itens").json()
    assert all(i["id"] != item["id"] for i in itens)


def test_filtro_por_mes_e_gasto(client):
    item = client.post("/api/requisicoes/itens", json={"nome": "Sabonete", "cadencia": "mensal"}).json()
    client.post(f"/api/requisicoes/itens/{item['id']}/comprar",
                json={"bought_at": date.today().isoformat(), "valor_pago": 8})
    mes = date.today().isoformat()[:7]
    compras = client.get(f"/api/requisicoes/compras?mes={mes}").json()
    assert len(compras) == 1
    assert compras[0]["nome"] == "Sabonete"
    assert compras[0]["valor_pago"] == 8

    # Mês sem compras → vazio.
    assert client.get("/api/requisicoes/compras?mes=2020-01").json() == []


def test_desfazer_compra_reabre_avulso(client):
    item = client.post("/api/requisicoes/itens", json={"nome": "Pilha", "cadencia": "avulso"}).json()
    client.post(f"/api/requisicoes/itens/{item['id']}/comprar", json={"valor_pago": 12})
    mes = date.today().isoformat()[:7]
    compra = client.get(f"/api/requisicoes/compras?mes={mes}").json()[0]

    undone = client.delete(f"/api/requisicoes/compras/{compra['id']}").json()
    assert undone["arquivado"] is False    # avulso volta a aparecer
    assert undone["aberta"] is True
    assert undone["last_bought"] is None
    assert undone["compras_count"] == 0


def test_categorias_distintas(client):
    client.post("/api/requisicoes/itens", json={"nome": "Shampoo", "categoria": "higiene"})
    client.post("/api/requisicoes/itens", json={"nome": "Detergente", "categoria": "casa"})
    client.post("/api/requisicoes/itens", json={"nome": "Cera", "categoria": "casa"})
    cats = client.get("/api/requisicoes/categorias").json()
    assert cats == ["casa", "higiene"]     # distintas, ordenadas


def test_delete_item_remove_historico(client):
    item = client.post("/api/requisicoes/itens", json={"nome": "Fio dental", "cadencia": "mensal"}).json()
    client.post(f"/api/requisicoes/itens/{item['id']}/comprar", json={"valor_pago": 5})
    assert client.delete(f"/api/requisicoes/itens/{item['id']}").status_code == 204
    # Some da lista e do histórico do mês.
    assert all(i["id"] != item["id"] for i in client.get("/api/requisicoes/itens").json())
    mes = date.today().isoformat()[:7]
    assert client.get(f"/api/requisicoes/compras?mes={mes}").json() == []


def test_reorder_persiste_ordem(client):
    a = client.post("/api/requisicoes/itens", json={"nome": "Aaa", "cadencia": "mensal"}).json()
    b = client.post("/api/requisicoes/itens", json={"nome": "Bbb", "cadencia": "mensal"}).json()
    c = client.post("/api/requisicoes/itens", json={"nome": "Ccc", "cadencia": "mensal"}).json()
    # Ordem inicial segue a criação (ordem incremental).
    ids0 = [i["id"] for i in client.get("/api/requisicoes/itens").json()]
    assert ids0 == [a["id"], b["id"], c["id"]]
    # Arrasta C pro topo.
    r = client.post("/api/requisicoes/itens/reorder", json=[
        {"id": c["id"], "ordem": 0}, {"id": a["id"], "ordem": 1}, {"id": b["id"], "ordem": 2},
    ])
    assert r.status_code == 204
    ids1 = [i["id"] for i in client.get("/api/requisicoes/itens").json()]
    assert ids1 == [c["id"], a["id"], b["id"]]


def test_comprar_rejeita_data_futura_e_invalida(client):
    item = client.post("/api/requisicoes/itens", json={"nome": "Pasta de dente", "cadencia": "mensal"}).json()
    futuro = (date.today() + timedelta(days=5)).isoformat()
    assert client.post(f"/api/requisicoes/itens/{item['id']}/comprar", json={"bought_at": futuro}).status_code == 400
    assert client.post(f"/api/requisicoes/itens/{item['id']}/comprar", json={"bought_at": "2024-02-30"}).status_code == 400
    ok = client.post(f"/api/requisicoes/itens/{item['id']}/comprar", json={"bought_at": _dias_atras(3), "valor_pago": 7})
    assert ok.status_code == 200


def test_compras_mes_invalido_400(client):
    assert client.get("/api/requisicoes/compras?mes=2024-13-99").status_code == 400
    assert client.get("/api/requisicoes/compras?mes=abc").status_code == 400
