"""Testes do saldo de conta — `_account_with_balance` é chamada em todo
GET de conta. Saldo = soma de valor das fin_transaction.

Caso crítico: saldo é centavos. Bug clássico nesse tipo de cálculo é
arredondamento, NULL handling (conta sem transações), e sinais (entrada
positiva / saída negativa).
"""
import pytest


def _insert_tx(conn, *, conta_id, valor, data=None, descricao="x"):
    """Helper pra inserir transação direto. fin_transaction.valor é o
    valor SIGNED (positivo = entrada, negativo = saída)."""
    import uuid
    tx_id = str(uuid.uuid4())[:8]
    conn.execute(
        "INSERT INTO fin_transaction(id, conta_id, valor, data, descricao) "
        "VALUES(?,?,?,?,?)",
        (tx_id, conta_id, valor, data or "2026-05-12", descricao),
    )
    return tx_id


def test_conta_nova_tem_saldo_zero(client, account_factory):
    """Conta sem transação → saldo 0.0 (não null/None)."""
    account_factory(id="a1")
    res = client.get("/api/finance/accounts")
    assert res.status_code == 200
    accounts = res.json()
    assert len(accounts) == 1
    assert accounts[0]["saldo"] == 0.0


def test_saldo_soma_entradas_e_saidas(client, account_factory):
    """Entradas (valor > 0) somam, saídas (valor < 0) subtraem."""
    import db as db_module
    account_factory(id="a1")
    with db_module.get_conn() as conn:
        _insert_tx(conn, conta_id="a1", valor=1000.0)   # entrada
        _insert_tx(conn, conta_id="a1", valor=-300.0)   # saída
        _insert_tx(conn, conta_id="a1", valor=-50.0)    # saída
        _insert_tx(conn, conta_id="a1", valor=200.0)    # entrada
        conn.commit()

    res = client.get("/api/finance/accounts")
    assert res.json()[0]["saldo"] == pytest.approx(850.0)


def test_saldo_so_da_propria_conta(client, account_factory):
    """Transação de outra conta não interfere."""
    import db as db_module
    account_factory(id="a1")
    account_factory(id="a2", nome="Outra", sort_order=2)
    with db_module.get_conn() as conn:
        _insert_tx(conn, conta_id="a1", valor=100.0)
        _insert_tx(conn, conta_id="a2", valor=999.0)
        conn.commit()

    res = client.get("/api/finance/accounts")
    accounts = {a["id"]: a["saldo"] for a in res.json()}
    assert accounts["a1"] == pytest.approx(100.0)
    assert accounts["a2"] == pytest.approx(999.0)


def test_saldo_com_centavos(client, account_factory):
    """Soma de valores com casas decimais não arredonda erroneamente."""
    import db as db_module
    account_factory(id="a1")
    with db_module.get_conn() as conn:
        # 3x 33.33 = 99.99 (não 100.00)
        _insert_tx(conn, conta_id="a1", valor=33.33)
        _insert_tx(conn, conta_id="a1", valor=33.33)
        _insert_tx(conn, conta_id="a1", valor=33.33)
        conn.commit()

    res = client.get("/api/finance/accounts")
    assert res.json()[0]["saldo"] == pytest.approx(99.99, abs=0.01)


def test_create_account_inicia_com_saldo_zero(client):
    """POST de nova conta retorna `saldo: 0.0` sem precisar de transação."""
    res = client.post("/api/finance/accounts", json={
        "nome": "Nubank",
        "tipo": "corrente",
        "moeda": "BRL",
        "origem_dados": "manual",
    })
    assert res.status_code == 201
    assert res.json()["saldo"] == 0.0


def test_delete_account_remove_listagem(client, account_factory):
    """Deletar conta tira ela do GET subsequente."""
    account_factory(id="a1")
    assert len(client.get("/api/finance/accounts").json()) == 1
    res = client.delete("/api/finance/accounts/a1")
    assert res.status_code == 204
    assert len(client.get("/api/finance/accounts").json()) == 0
