"""Fixtures globais pro pytest do backend.

Estratégia: cada teste recebe um DB SQLite isolado num arquivo tmp,
inicializado via `db.init_db()`. Como o projeto usa `get_conn()` que abre
nova conexão por chamada, NÃO podemos usar `:memory:` (cada conexão
seria um DB diferente). tmp file resolve.

Pra evitar que os 47 CREATE TABLE rodem por teste, usamos session-scope
pro template e copiamos pra cada test (snapshot strategy). Mas pra suite
pequena, init per-test é OK e mantém isolamento total.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Adiciona apps/api ao sys.path pra imports diretos (db, routers.*, etc).
API_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_ROOT))


@pytest.fixture
def isolated_db(tmp_path, monkeypatch):
    """Cria um DB SQLite isolado num arquivo tmp e patcha db.DB_PATH.

    Yields: Path do DB criado. Pra ler/escrever direto, use `db.get_conn()`
    DENTRO do bloco do teste — vai usar o tmp porque o monkeypatch alterou
    DB_PATH antes da fixture retornar.
    """
    import db as db_module  # noqa
    test_db_path = tmp_path / "test.db"
    monkeypatch.setattr(db_module, "DB_PATH", test_db_path)
    db_module.init_db()
    yield test_db_path
    # cleanup automático (tmp_path é limpo pelo pytest)


@pytest.fixture
def client(isolated_db):
    """FastAPI TestClient com DB isolado.

    Usa httpx via TestClient — não sobe uvicorn, faz request direto ao app.
    Cada teste tem seu próprio DB via dependência `isolated_db`.
    """
    from fastapi.testclient import TestClient
    # Import LATE pra pegar o DB_PATH já monkeypatched.
    import main  # noqa
    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def project_factory(isolated_db):
    """Cria um projeto com valor_acordado pra testes que precisam de parcelas.

    Retorna função `make(**overrides)` pra criar com sobrescritas.
    """
    import db as db_module

    def make(**overrides):
        defaults = dict(
            id="p1",
            title="Projeto Teste",
            area_slug="freelas",
            status="doing",
            priority="medium",
            valor_acordado=1000.0,
        )
        defaults.update(overrides)
        with db_module.get_conn() as conn:
            conn.execute(
                "INSERT INTO projects(id, title, area_slug, status, priority, valor_acordado) "
                "VALUES(?,?,?,?,?,?)",
                (defaults["id"], defaults["title"], defaults["area_slug"],
                 defaults["status"], defaults["priority"], defaults["valor_acordado"]),
            )
            conn.commit()
        return defaults

    return make


@pytest.fixture
def account_factory(isolated_db):
    """Cria uma conta financeira pra testes."""
    import db as db_module

    def make(**overrides):
        defaults = dict(
            id="a1",
            nome="Conta Teste",
            tipo="corrente",
            moeda="BRL",
            origem_dados="manual",
            sort_order=1,
            cotacao_brl=None,
        )
        defaults.update(overrides)
        with db_module.get_conn() as conn:
            conn.execute(
                "INSERT INTO fin_account(id, nome, tipo, moeda, origem_dados, sort_order, cotacao_brl) "
                "VALUES(?,?,?,?,?,?,?)",
                (defaults["id"], defaults["nome"], defaults["tipo"], defaults["moeda"],
                 defaults["origem_dados"], defaults["sort_order"], defaults["cotacao_brl"]),
            )
            conn.commit()
        return defaults

    return make
