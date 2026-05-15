"""wishlist reserva soft mode (dia + transacao_id)

Revision ID: b2c3d4e5
Revises: a1b2c3d4
Create Date: 2026-05-12

Fase 5: reservas deixam de ser "passivamente cumpridas" e ganham vínculo
opcional com transação real pra ficar honesto. Adiciona 2 colunas:
 - `dia` INTEGER: dia preferido pra guardar (default último dia do mês)
 - `transacao_id` TEXT: vínculo opcional, NULL = ainda não materializou

Semântica nova:
 - `reservado_acumulado` (computed) = soma SÓ das reservas com vínculo
 - `reservado_pendente` (computed novo) = passadas sem vínculo
 - Compromissos do mês continuam usando `valor_planejado` (= meta do mês)

Doc: docs/hub-finance/wishlist-PLAN.md.
"""
from alembic import op


revision = "b2c3d4e5"
down_revision = "a1b2c3d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE fin_wishlist_reserva ADD COLUMN dia INTEGER")
    op.execute("ALTER TABLE fin_wishlist_reserva ADD COLUMN transacao_id TEXT")


def downgrade() -> None:
    # SQLite não tem DROP COLUMN trivial — recria tabela sem as colunas.
    # Aceitável aqui porque é dev-mode local; em prod faríamos copy + drop.
    op.execute(
        """
        CREATE TABLE fin_wishlist_reserva_tmp (
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
        "INSERT INTO fin_wishlist_reserva_tmp "
        "SELECT id, item_id, ano, mes, valor_planejado, notas, criada_em "
        "FROM fin_wishlist_reserva"
    )
    op.execute("DROP TABLE fin_wishlist_reserva")
    op.execute(
        "ALTER TABLE fin_wishlist_reserva_tmp RENAME TO fin_wishlist_reserva"
    )
