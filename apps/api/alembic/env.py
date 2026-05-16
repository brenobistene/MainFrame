"""Alembic environment — MAINFRAME.

Projeto usa sqlite3 puro (não SQLAlchemy ORM). Alembic ainda funciona,
mas:
 - Não há `target_metadata` (autogenerate vai gerar migrations vazias —
   sempre escreva migrations à mão usando `op.execute("CREATE TABLE…")`).
 - Migrations rodam via sqlalchemy.url do alembic.ini (string sqlite:///).

Para rodar (a partir de apps/api/):
    alembic upgrade head        # aplica migrations pendentes
    alembic revision -m "msg"   # cria nova migration vazia
    alembic stamp head          # marca DB como up-to-date sem rodar nada
    alembic current             # mostra revisão atual
    alembic history             # lista migrations
"""
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Sem ORM = sem metadata. Quem quiser autogen no futuro, importe Base aqui.
target_metadata = None


def run_migrations_offline() -> None:
    """Gera SQL sem conectar (útil pra revisar/aplicar manualmente)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # sqlite precisa de batch pra ALTER TABLE
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Aplica migrations contra o DB ao vivo."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # sqlite precisa de batch pra ALTER TABLE
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
