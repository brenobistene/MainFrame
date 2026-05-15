"""add wishlist tables

Revision ID: a1b2c3d4
Revises: 0001_baseline
Create Date: 2026-05-12

Cria 4 tabelas + 1 singleton do submódulo Wishlist do Hub Finance:
 - fin_wishlist_categoria   (categorias próprias da wishlist)
 - fin_wishlist_item        (item desejado, com status e vínculo opcional a transação)
 - fin_wishlist_link        (links múltiplos por item)
 - fin_wishlist_reserva     (cronograma mensal opcional de reserva)
 - fin_wishlist_settings    (singleton id=1 com threshold de envelhecimento)

Schema espelhado em db.init_db() pra rodar idempotentemente em qualquer DB
(o projeto usa sqlite3 puro, não SQLAlchemy ORM — Alembic só formaliza
migrations pra DBs já em produção). Doc: docs/hub-finance/wishlist-PLAN.md.
"""
from alembic import op


revision = "a1b2c3d4"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS fin_wishlist_categoria (
            id              TEXT PRIMARY KEY,
            nome            TEXT NOT NULL UNIQUE,
            cor             TEXT,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            criada_em       TEXT DEFAULT (datetime('now')),
            atualizada_em   TEXT DEFAULT (datetime('now'))
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS fin_wishlist_item (
            id                   TEXT PRIMARY KEY,
            nome                 TEXT NOT NULL,
            descricao            TEXT,
            categoria_id         TEXT REFERENCES fin_wishlist_categoria(id) ON DELETE SET NULL,
            valor_estimado       REAL NOT NULL,
            prioridade           INTEGER NOT NULL DEFAULT 0,
            status               TEXT NOT NULL DEFAULT 'desejado',
            data_alvo            TEXT,
            valor_real           REAL,
            comprado_em          TEXT,
            transacao_id         TEXT REFERENCES fin_transaction(id) ON DELETE SET NULL,
            desistido_em         TEXT,
            motivo_desistencia   TEXT,
            criada_em            TEXT DEFAULT (datetime('now')),
            atualizada_em        TEXT DEFAULT (datetime('now'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_fin_wishlist_item_status "
        "ON fin_wishlist_item(status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_fin_wishlist_item_categoria "
        "ON fin_wishlist_item(categoria_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS fin_wishlist_link (
            id           TEXT PRIMARY KEY,
            item_id      TEXT NOT NULL REFERENCES fin_wishlist_item(id) ON DELETE CASCADE,
            url          TEXT NOT NULL,
            label        TEXT,
            preco        REAL,
            sort_order   INTEGER NOT NULL DEFAULT 0,
            criado_em    TEXT DEFAULT (datetime('now'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_fin_wishlist_link_item "
        "ON fin_wishlist_link(item_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS fin_wishlist_reserva (
            id                TEXT PRIMARY KEY,
            item_id           TEXT NOT NULL REFERENCES fin_wishlist_item(id) ON DELETE CASCADE,
            ano               INTEGER NOT NULL,
            mes               INTEGER NOT NULL,
            valor_planejado   REAL NOT NULL,
            notas             TEXT,
            criada_em         TEXT DEFAULT (datetime('now')),
            UNIQUE(item_id, ano, mes)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_fin_wishlist_reserva_item "
        "ON fin_wishlist_reserva(item_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_fin_wishlist_reserva_mes "
        "ON fin_wishlist_reserva(ano, mes)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS fin_wishlist_settings (
            id                              INTEGER PRIMARY KEY CHECK (id = 1),
            envelhecimento_threshold_meses  INTEGER NOT NULL DEFAULT 6,
            atualizado_em                   TEXT DEFAULT (datetime('now'))
        )
        """
    )
    op.execute(
        "INSERT OR IGNORE INTO fin_wishlist_settings(id, envelhecimento_threshold_meses) "
        "VALUES(1, 6)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS fin_wishlist_settings")
    op.execute("DROP TABLE IF EXISTS fin_wishlist_reserva")
    op.execute("DROP TABLE IF EXISTS fin_wishlist_link")
    op.execute("DROP TABLE IF EXISTS fin_wishlist_item")
    op.execute("DROP TABLE IF EXISTS fin_wishlist_categoria")
