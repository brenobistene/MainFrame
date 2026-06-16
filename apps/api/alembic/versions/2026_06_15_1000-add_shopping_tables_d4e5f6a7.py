"""requisicoes — tabelas da lista de compras pessoal

Revision ID: d4e5f6a7
Revises: c3d4e5f6
Create Date: 2026-06-15

Espelha o schema criado em db.py init_db() (convenção pós-2026-05-12:
toda mudança de schema ganha migration formal além do executescript).
CREATE TABLE IF NOT EXISTS = idempotente em DBs que já bootaram com o
init_db novo.

Módulo Requisições (lista de compras): NÃO toca no Finance — é lembrete
+ estimativa. Item com cadência reabre sozinho; shopping_purchase guarda
o histórico (média de preço real + filtro por mês).
"""
from alembic import op


revision = "d4e5f6a7"
down_revision = "c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS shopping_item (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            nome           TEXT NOT NULL,
            categoria      TEXT,
            cadencia       TEXT NOT NULL DEFAULT 'mensal',
            preco_estimado REAL,
            last_bought    TEXT,
            arquivado      INTEGER NOT NULL DEFAULT 0,
            ordem          INTEGER NOT NULL DEFAULT 0,
            criado_em      TEXT DEFAULT (datetime('now')),
            atualizado_em  TEXT DEFAULT (datetime('now'))
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_shopping_item_ativo "
        "ON shopping_item(arquivado, cadencia)"
    )
    op.execute("""
        CREATE TABLE IF NOT EXISTS shopping_purchase (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id     INTEGER NOT NULL REFERENCES shopping_item(id) ON DELETE CASCADE,
            bought_at   TEXT NOT NULL,
            valor_pago  REAL,
            criado_em   TEXT DEFAULT (datetime('now'))
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_shopping_purchase_item "
        "ON shopping_purchase(item_id, bought_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_shopping_purchase_when "
        "ON shopping_purchase(bought_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shopping_purchase")
    op.execute("DROP TABLE IF EXISTS shopping_item")
