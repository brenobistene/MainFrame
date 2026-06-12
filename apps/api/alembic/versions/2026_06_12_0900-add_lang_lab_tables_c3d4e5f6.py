"""lang lab — tabelas do módulo de aquisição de idiomas

Revision ID: c3d4e5f6
Revises: b2c3d4e5
Create Date: 2026-06-12

Espelha o schema criado em db.py init_db() (convenção pós-2026-05-12:
toda mudança de schema ganha migration formal além do executescript).
CREATE TABLE IF NOT EXISTS = idempotente em DBs que já bootaram com o
init_db novo. Inclui as colunas de agendamento estilo Anki que em DBs
antigos entraram via _try_add_column.

Doc: docs/lang-lab/PLAN.md (local).
"""
from alembic import op


revision = "c3d4e5f6"
down_revision = "b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS lang_language (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            code       TEXT NOT NULL UNIQUE,
            nome       TEXT NOT NULL,
            tts_voice  TEXT NOT NULL DEFAULT 'en-US-AriaNeural',
            ativo      INTEGER NOT NULL DEFAULT 1,
            criado_em  TEXT DEFAULT (datetime('now'))
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS lang_source (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            language_id     INTEGER NOT NULL REFERENCES lang_language(id) ON DELETE CASCADE,
            tipo            TEXT NOT NULL DEFAULT 'other',
            titulo          TEXT NOT NULL,
            origem          TEXT,
            texto           TEXT,
            audio_path      TEXT,
            notas_json      TEXT,
            library_item_id INTEGER REFERENCES library_item(id) ON DELETE SET NULL,
            criado_em       TEXT DEFAULT (datetime('now')),
            atualizado_em   TEXT DEFAULT (datetime('now'))
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS lang_card (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            language_id   INTEGER NOT NULL REFERENCES lang_language(id) ON DELETE CASCADE,
            source_id     INTEGER REFERENCES lang_source(id) ON DELETE SET NULL,
            frente        TEXT NOT NULL,
            verso         TEXT,
            notas         TEXT,
            direction     TEXT NOT NULL DEFAULT 'recognition',
            audio_mode    TEXT NOT NULL DEFAULT 'tts',
            audio_path    TEXT,
            tts_hash      TEXT,
            origem_ai     INTEGER NOT NULL DEFAULT 0,
            suspenso      INTEGER NOT NULL DEFAULT 0,
            state         TEXT NOT NULL DEFAULT 'learning',
            step          INTEGER,
            due           TEXT NOT NULL,
            stability     REAL,
            difficulty    REAL,
            reps          INTEGER NOT NULL DEFAULT 0,
            lapses        INTEGER NOT NULL DEFAULT 0,
            last_review   TEXT,
            criado_em     TEXT DEFAULT (datetime('now')),
            atualizado_em TEXT DEFAULT (datetime('now'))
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lang_card_queue "
        "ON lang_card(language_id, suspenso, due)"
    )
    op.execute("""
        CREATE TABLE IF NOT EXISTS lang_review (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id           INTEGER NOT NULL REFERENCES lang_card(id) ON DELETE CASCADE,
            rating            INTEGER NOT NULL,
            reviewed_at       TEXT NOT NULL,
            state_before      TEXT,
            state_after       TEXT,
            due_before        TEXT,
            stability_before  REAL,
            difficulty_before REAL,
            step_before       INTEGER
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lang_review_card "
        "ON lang_review(card_id, reviewed_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lang_review_when ON lang_review(reviewed_at)"
    )
    op.execute("""
        CREATE TABLE IF NOT EXISTS lang_session (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            language_id INTEGER REFERENCES lang_language(id) ON DELETE SET NULL,
            session_num INTEGER NOT NULL,
            started_at  TEXT NOT NULL,
            ended_at    TEXT,
            finalizada  INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lang_session_active "
        "ON lang_session(finalizada, ended_at)"
    )
    op.execute("""
        CREATE TABLE IF NOT EXISTS lang_piece (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            language_id   INTEGER NOT NULL REFERENCES lang_language(id) ON DELETE CASCADE,
            session_id    INTEGER REFERENCES lang_session(id) ON DELETE SET NULL,
            prompt        TEXT,
            texto         TEXT NOT NULL,
            feedback_json TEXT,
            criado_em     TEXT DEFAULT (datetime('now')),
            atualizado_em TEXT DEFAULT (datetime('now'))
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS lang_ask (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            language_id INTEGER NOT NULL REFERENCES lang_language(id) ON DELETE CASCADE,
            pergunta    TEXT NOT NULL,
            resposta    TEXT,
            card_id     INTEGER REFERENCES lang_card(id) ON DELETE SET NULL,
            criado_em   TEXT DEFAULT (datetime('now'))
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS lang_analysis (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            language_id INTEGER NOT NULL REFERENCES lang_language(id) ON DELETE CASCADE,
            date        TEXT NOT NULL,
            resumo_json TEXT,
            criado_em   TEXT DEFAULT (datetime('now')),
            UNIQUE(language_id, date)
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS lang_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            idioma_ativo            INTEGER REFERENCES lang_language(id),
            new_cards_per_day       INTEGER NOT NULL DEFAULT 15,
            max_reviews_per_day     INTEGER,
            daily_goal_min          INTEGER NOT NULL DEFAULT 15,
            desired_retention       REAL NOT NULL DEFAULT 0.9,
            mature_threshold_days   INTEGER NOT NULL DEFAULT 21,
            day_cutoff_hour         INTEGER NOT NULL DEFAULT 4,
            tts_enabled             INTEGER NOT NULL DEFAULT 1,
            audio_autoplay          INTEGER NOT NULL DEFAULT 1,
            auto_session_on_review  INTEGER NOT NULL DEFAULT 0,
            ai_provider             TEXT NOT NULL DEFAULT 'none',
            ai_model                TEXT NOT NULL DEFAULT 'gemini-flash-latest',
            ai_base_url             TEXT,
            ausencia_threshold_dias INTEGER NOT NULL DEFAULT 3,
            exec_card_visivel       INTEGER NOT NULL DEFAULT 1,
            dashboard_card_visivel  INTEGER NOT NULL DEFAULT 1,
            sidebar_badge_visivel   INTEGER NOT NULL DEFAULT 1,
            learning_steps_min      TEXT NOT NULL DEFAULT '1,10',
            relearning_steps_min    TEXT NOT NULL DEFAULT '10',
            maximum_interval_days   INTEGER NOT NULL DEFAULT 36500,
            enable_fuzzing          INTEGER NOT NULL DEFAULT 1,
            atualizado_em           TEXT DEFAULT (datetime('now'))
        )
    """)
    op.execute(
        "INSERT OR IGNORE INTO lang_language(code, nome, tts_voice) "
        "VALUES ('en', 'English', 'en-US-AriaNeural')"
    )
    op.execute("INSERT OR IGNORE INTO lang_settings(id) VALUES (1)")


def downgrade() -> None:
    # Ordem respeita FKs (filhas primeiro). Dev-mode local: DROP direto.
    for table in (
        "lang_analysis",
        "lang_ask",
        "lang_piece",
        "lang_review",
        "lang_card",
        "lang_source",
        "lang_session",
        "lang_settings",
        "lang_language",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table}")
