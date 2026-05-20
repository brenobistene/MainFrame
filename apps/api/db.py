from __future__ import annotations
import sqlite3
from pathlib import Path


def _try_add_column(conn: sqlite3.Connection, sql: str) -> None:
    """Executa um `ALTER TABLE ... ADD COLUMN ...`, ignorando APENAS o erro de
    coluna já existente. Qualquer outro erro (lock, disk full, permissão)
    continua propagando pra não deixar o schema em estado inconsistente."""
    try:
        conn.execute(sql)
        conn.commit()
    except sqlite3.OperationalError as e:
        if "duplicate column" in str(e).lower():
            return  # idempotente: coluna já existe, tudo certo
        raise

DB_PATH = Path(__file__).parent / "mainframe.db"

AREAS = [
    ("freelas",    "Freelas",    "Entregas com impacto financeiro e prazos reais.", 1, "#e85d3a"),
    ("faculdade",  "Faculdade",  "Matérias, atividades e projetos de ensino.", 2, "#4a9eff"),
    ("growth",     "Growth",     "Cursos, certificações e aprendizado contínuo.", 3, "#9d6cff"),
    ("work",       "Trabalho",   "Trabalho principal — empresa, cargo, projetos fixos.", 4, "#7fb069"),
]

# Seed inicial de categorias do Hub Finance. Aplicado só em DB sem nenhuma
# categoria — usuário pode editar/deletar/criar à vontade. Decisão registrada
# em docs/hub-finance/PLAN.md seção 8.
FIN_CATEGORIES = [
    # (nome, tipo, cor, sort_order)
    ("Salário",                "receita",        "#7fb069", 1),
    ("Freelas",                "receita",        "#e85d3a", 2),
    ("Estornos",               "estorno",        "#9d6cff", 3),
    ("Transferência Interna",  "transferencia",  "#4a9eff", 4),
    ("Alimentação",            "despesa",        "#f5a962", 5),
    ("Transporte",             "despesa",        "#4a9eff", 6),
    ("Moradia",                "despesa",        "#e85d3a", 7),
    ("Lazer",                  "despesa",        "#9d6cff", 8),
    ("Saúde",                  "despesa",        "#7fb069", 9),
    ("Cuidado Pessoal",        "despesa",        "#f5a962", 10),
    ("Faculdade",              "despesa",        "#4a9eff", 11),
    ("Dívidas",                "despesa",        "#e85d3a", 12),
]

# Seed inicial de categorias da Wishlist (submódulo do Hub Finance). Aplicado
# só em DB sem nenhuma categoria de wishlist — usuário pode editar/deletar/criar
# à vontade. Categorias separadas de fin_category (tema de desejo vs tema de
# despesa real). Schema/decisão em docs/hub-finance/wishlist-PLAN.md.
FIN_WISHLIST_CATEGORIES = [
    # (nome, cor, sort_order)
    ("Tech",            "#4a9eff", 1),
    ("Decoração",       "#f5a962", 2),
    ("Saúde Estética",  "#e85d3a", 3),
    ("Hobby",           "#9d6cff", 4),
    ("Viagem",          "#7fb069", 5),
    ("Outros",          "#8a93a6", 6),
]


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys=ON")
    except sqlite3.Error:
        # Alguns builds/environments do sqlite não suportam essa PRAGMA;
        # seguir sem FK enforcement é preferível a falhar ao abrir conexão.
        pass
    return conn


def init_db() -> None:
    with get_conn() as conn:
        # Detectar se estamos num DB pré-split (antes de projects virar entidade
        # própria). Usamos a presença da coluna `quest_id` em `deliverables`
        # como sinal — ela só existia no schema antigo. Se `project_id` já
        # existe, já migrou.
        needs_project_split = False
        existing_deliv = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='deliverables'"
        ).fetchone()
        if existing_deliv:
            cols = {c["name"] for c in conn.execute("PRAGMA table_info(deliverables)").fetchall()}
            if "quest_id" in cols and "project_id" not in cols:
                needs_project_split = True

        conn.executescript("""
        CREATE TABLE IF NOT EXISTS areas (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            slug     TEXT UNIQUE NOT NULL,
            name     TEXT NOT NULL,
            description TEXT,
            sort_order INTEGER DEFAULT 0,
            color    TEXT DEFAULT '#6b7280'
        );

        CREATE TABLE IF NOT EXISTS projects (
            id                TEXT PRIMARY KEY,
            title             TEXT NOT NULL,
            area_slug         TEXT NOT NULL REFERENCES areas(slug),
            status            TEXT NOT NULL DEFAULT 'pending',
            priority          TEXT NOT NULL DEFAULT 'critical',
            deadline          TEXT,
            notes             TEXT,
            calendar_event_id TEXT,
            completed_at      TEXT,
            archived_at       TEXT,
            sort_order        INTEGER DEFAULT 0,
            created_at        TEXT DEFAULT (datetime('now')),
            updated_at        TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS quests (
            id               TEXT PRIMARY KEY,
            project_id       TEXT REFERENCES projects(id) ON DELETE CASCADE,
            parent_id        TEXT,
            title            TEXT NOT NULL,
            area_slug        TEXT NOT NULL REFERENCES areas(slug),
            status           TEXT NOT NULL DEFAULT 'pending',
            priority         TEXT NOT NULL DEFAULT 'medium',
            deadline         TEXT,
            estimated_minutes INTEGER,
            next_action      TEXT,
            notes            TEXT,
            sort_order       INTEGER DEFAULT 0,
            deliverable_id   TEXT REFERENCES deliverables(id) ON DELETE SET NULL,
            completed_at     TEXT,
            created_at       TEXT DEFAULT (datetime('now')),
            updated_at       TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS subtasks (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            quest_id   TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
            title      TEXT NOT NULL,
            done       INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS routines (
            id               TEXT PRIMARY KEY,
            title            TEXT NOT NULL,
            recurrence       TEXT NOT NULL DEFAULT 'daily',
            day_of_week      INTEGER,
            days_of_week     TEXT,
            day_of_month     INTEGER,
            start_time       TEXT,
            end_time         TEXT,
            estimated_minutes INTEGER,
            calendar_event_id TEXT,
            created_at       TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS routine_logs (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            routine_id   TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
            completed_date TEXT NOT NULL,
            UNIQUE(routine_id, completed_date)
        );

        CREATE TABLE IF NOT EXISTS quest_sessions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            quest_id     TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
            session_num  INTEGER NOT NULL,
            started_at   TEXT NOT NULL,
            ended_at     TEXT,
            UNIQUE(quest_id, session_num)
        );

        CREATE TABLE IF NOT EXISTS deliverables (
            id                  TEXT PRIMARY KEY,
            project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            title               TEXT NOT NULL,
            done                INTEGER NOT NULL DEFAULT 0,
            sort_order          INTEGER DEFAULT 0,
            estimated_minutes   INTEGER,
            minutes_worked      INTEGER DEFAULT 0,
            deadline            TEXT
        );

        CREATE TABLE IF NOT EXISTS micro_tasks (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            created_at  TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS user_profile (
            id         INTEGER PRIMARY KEY CHECK (id = 1),
            name       TEXT NOT NULL DEFAULT '',
            role       TEXT NOT NULL DEFAULT '',
            avatar_url TEXT NOT NULL DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id               TEXT PRIMARY KEY,
            title            TEXT NOT NULL,
            scheduled_date   TEXT,           -- YYYY-MM-DD, nullable
            start_time       TEXT,           -- HH:MM, nullable
            end_time         TEXT,           -- HH:MM, nullable
            duration_minutes INTEGER,        -- nullable
            done             INTEGER NOT NULL DEFAULT 0,
            completed_at     TEXT,
            sort_order       INTEGER DEFAULT 0,
            created_at       TEXT DEFAULT (datetime('now')),
            updated_at       TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS task_sessions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            session_num  INTEGER NOT NULL,
            started_at   TEXT NOT NULL,
            ended_at     TEXT,
            UNIQUE(task_id, session_num)
        );

        CREATE TABLE IF NOT EXISTS routine_sessions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            routine_id   TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
            date         TEXT NOT NULL,       -- YYYY-MM-DD (local-day scope)
            session_num  INTEGER NOT NULL,
            started_at   TEXT NOT NULL,
            ended_at     TEXT,
            UNIQUE(routine_id, date, session_num)
        );

        -- ─── Compromissos ─────────────────────────────────────────────────
        -- Horas improdutivas planejadas (corte de cabelo, terapia, médico).
        -- Filosofia: visualização only — não tem play/pause, não consome
        -- estimated_minutes de quest. Aparece como alerta no /dashboard
        -- (próximos 3 dias) e card read-only no /exec do dia que cair.
        -- Suporta evento único (recurrence='none') OU recorrente (semanal,
        -- mensal). Fim opcional via end_date (NULL = pra sempre).
        CREATE TABLE IF NOT EXISTS compromissos (
            id              TEXT PRIMARY KEY,
            title           TEXT NOT NULL,
            notes           TEXT,
            start_date      TEXT NOT NULL,                 -- YYYY-MM-DD (primeira ocorrência)
            start_time      TEXT NOT NULL,                 -- HH:MM
            end_time        TEXT NOT NULL,                 -- HH:MM
            recurrence      TEXT NOT NULL DEFAULT 'none',  -- 'none'|'weekly'|'monthly'
            days_of_week    TEXT,                          -- CSV de 0-6 (0=Dom) p/ weekly
            day_of_month    INTEGER,                       -- 1-31 p/ monthly
            end_date        TEXT,                          -- YYYY-MM-DD; NULL = sem fim
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_compromissos_start_date
            ON compromissos(start_date);

        -- ─── Hub Finance (v0) ──────────────────────────────────────────────
        -- Módulo financeiro pessoal. Schema mínimo da primeira fatia vertical:
        -- contas, categorias e transações manuais. Cartão de crédito (faturas),
        -- dívidas, parcelas e integração pynubank vêm em fases posteriores.
        -- Doc autoritativa: docs/hub-finance/PLAN.md
        CREATE TABLE IF NOT EXISTS fin_account (
            id            TEXT PRIMARY KEY,
            nome          TEXT NOT NULL,
            tipo          TEXT NOT NULL,        -- 'corrente' | 'credito' | 'wallet' | 'wise'
            moeda         TEXT NOT NULL DEFAULT 'BRL',
            origem_dados  TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'pynubank'
            sort_order    INTEGER DEFAULT 0,
            created_at    TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS fin_category (
            id              TEXT PRIMARY KEY,
            nome            TEXT NOT NULL,
            tipo            TEXT NOT NULL,      -- 'receita' | 'despesa' | 'estorno' | 'transferencia'
            cor             TEXT,
            categoria_pai_id TEXT REFERENCES fin_category(id) ON DELETE SET NULL,
            sort_order      INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS fin_transaction (
            id            TEXT PRIMARY KEY,
            data          TEXT NOT NULL,        -- YYYY-MM-DD
            valor         REAL NOT NULL,        -- positivo entrada, negativo saída (BRL)
            descricao     TEXT NOT NULL,
            conta_id      TEXT NOT NULL REFERENCES fin_account(id) ON DELETE CASCADE,
            categoria_id  TEXT REFERENCES fin_category(id) ON DELETE SET NULL,
            origem        TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'nubank_csv'
            notas         TEXT,
            -- Identificador único da transação no extrato Nubank (campo
            -- "Identificador" do CSV). Permite deduplicar import re-rodado.
            -- Nullable porque transações manuais não têm.
            nubank_id     TEXT,
            created_at    TEXT DEFAULT (datetime('now')),
            updated_at    TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_fin_tx_data ON fin_transaction(data);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_conta ON fin_transaction(conta_id);
        CREATE INDEX IF NOT EXISTS idx_fin_tx_cat ON fin_transaction(categoria_id);
        -- nubank_id (coluna + índice unique) é criado abaixo via migration
        -- idempotente, depois do ALTER TABLE garantir que a coluna existe.

        -- Regras de auto-categorização: substring case-insensitive da descrição
        -- mapeia pra uma categoria. Aplicadas no import CSV e no botão de
        -- "sugerir categoria". Aprendíveis quando usuário categoriza algo
        -- manualmente e marca "criar regra".
        CREATE TABLE IF NOT EXISTS fin_categorization_rule (
            id              TEXT PRIMARY KEY,
            pattern         TEXT NOT NULL,        -- substring buscada (lower())
            categoria_id    TEXT NOT NULL REFERENCES fin_category(id) ON DELETE CASCADE,
            times_matched   INTEGER DEFAULT 0,    -- contador de uso, debug/UI
            created_at      TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fin_rule_pattern ON fin_categorization_rule(pattern);

        -- Fatura de cartão de crédito. Cada cartão (fin_account tipo='credito')
        -- tem N faturas. Compras no cartão são vinculadas via
        -- fin_transaction.fatura_id — saem do saldo do cartão na hora mas só
        -- contam como despesa do mês quando a fatura é paga (regra de
        -- competência: ver docs/hub-finance/PLAN.md decisão #1).
        CREATE TABLE IF NOT EXISTS fin_invoice (
            id              TEXT PRIMARY KEY,
            cartao_id       TEXT NOT NULL REFERENCES fin_account(id) ON DELETE CASCADE,
            mes_referencia  TEXT NOT NULL,           -- YYYY-MM (mês quando paga)
            data_fechamento TEXT,                    -- YYYY-MM-DD opcional
            data_vencimento TEXT,                    -- YYYY-MM-DD opcional
            data_pagamento  TEXT,                    -- YYYY-MM-DD quando paga
            status          TEXT NOT NULL DEFAULT 'aberta',  -- aberta | fechada | paga | atrasada
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fin_invoice_cartao ON fin_invoice(cartao_id, status);
        CREATE INDEX IF NOT EXISTS idx_fin_invoice_pagto ON fin_invoice(data_pagamento);

        -- Cliente (PF/PJ) que paga projetos freela. Vinculado opcionalmente
        -- a projects.cliente_id. Usado pra auto-vincular receita: se o
        -- CPF/CNPJ aparece na descrição da transação E o valor bate com
        -- uma parcela pendente do cliente, vínculo automático.
        CREATE TABLE IF NOT EXISTS fin_client (
            id              TEXT PRIMARY KEY,
            nome            TEXT NOT NULL,
            cpf_cnpj        TEXT,
            notas           TEXT,
            sort_order      INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fin_client_cpf ON fin_client(cpf_cnpj);

        -- Parcelas esperadas de recebimento de um projeto freela. Geradas
        -- a partir de templates (50/50, 100% no fim, parcelado Nx) ou criadas
        -- manualmente. status muda automaticamente pra 'recebido' quando
        -- transação de entrada é vinculada via fin_transaction.parcela_id.
        CREATE TABLE IF NOT EXISTS fin_parcela (
            id              TEXT PRIMARY KEY,
            projeto_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            numero          INTEGER NOT NULL,
            valor           REAL NOT NULL,
            data_prevista   TEXT,                   -- YYYY-MM-DD opcional
            status          TEXT NOT NULL DEFAULT 'pendente',  -- pendente | recebido | atrasado | cancelada
            observacao      TEXT,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fin_parcela_projeto ON fin_parcela(projeto_id);
        CREATE INDEX IF NOT EXISTS idx_fin_parcela_status ON fin_parcela(status);

        -- Dívidas externas (faculdade, financiamento, qualquer parcelamento
        -- não-rotativo). saldo_devedor é COMPUTADO: total_original - sum(abs(
        -- valor de transações vinculadas)). status muda pra 'paid_off' quando
        -- saldo zera. parcela_mensal é informativo (calcula previsão de fim).
        CREATE TABLE IF NOT EXISTS fin_debt (
            id                      TEXT PRIMARY KEY,
            descricao               TEXT NOT NULL,
            valor_total_original    REAL NOT NULL,
            parcela_mensal          REAL,           -- nullable (parcela variável)
            data_inicio             TEXT,           -- YYYY-MM-DD, opcional
            categoria_id            TEXT REFERENCES fin_category(id) ON DELETE SET NULL,
            status                  TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'paid_off' | 'cancelled'
            sort_order              INTEGER DEFAULT 0,
            created_at              TEXT DEFAULT (datetime('now')),
            updated_at              TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fin_debt_status ON fin_debt(status);
        -- divida_id em fin_transaction é adicionado via migration ALTER abaixo
        -- (depois do CREATE TABLE garantir que fin_transaction existe).

        -- Contas fixas recorrentes (luz, água, internet, aluguel, streaming,
        -- E TAMBÉM receitas fixas como salário, mesada, etc). Diferente de
        -- fin_debt: dívida tem fim (paga até zerar); conta fixa é perpétua.
        -- Status do mês é INFERIDO buscando transação com mesma categoria +
        -- descrição parecida (sem persistir vínculo).
        --
        -- `tipo`: 'despesa' = saída (luz, água); 'receita' = entrada (salário).
        -- Inferência ajusta sinal do valor procurado conforme tipo.
        -- Parcelas de dívida (cronograma de pagamento). Cada parcela tem
        -- valor_planejado opcional: NULL = "auto" (rateia o saldo restante
        -- entre todas auto). Permite cenários flexíveis tipo "primeira
        -- parcela R$50, segunda R$30, resto auto-distribuído entre N".
        --
        -- Status é COMPUTADO no GET (paga se tem transacao linked, atrasada
        -- se data_prevista no passado e não paga, senão pendente).
        --
        -- `transacao_pagamento_id` é nullable. Quando setado, parcela vira
        -- "paga". Pode haver múltiplas dívidas mesmo cronograma (parcelas
        -- vivem por dívida — não compartilhadas).
        CREATE TABLE IF NOT EXISTS fin_debt_parcela (
            id                      TEXT PRIMARY KEY,
            divida_id               TEXT NOT NULL REFERENCES fin_debt(id) ON DELETE CASCADE,
            numero                  INTEGER NOT NULL,
            data_prevista           TEXT,             -- YYYY-MM-DD opcional
            valor_planejado         REAL,             -- NULL = auto
            transacao_pagamento_id  TEXT,             -- FK manual (ALTER abaixo se necessário)
            notas                   TEXT,
            created_at              TEXT DEFAULT (datetime('now')),
            updated_at              TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fin_debt_parcela_divida ON fin_debt_parcela(divida_id);

        CREATE TABLE IF NOT EXISTS fin_recurring_bill (
            id                      TEXT PRIMARY KEY,
            descricao               TEXT NOT NULL,
            valor_estimado          REAL NOT NULL,    -- valor médio mensal em BRL
            dia_vencimento          INTEGER,          -- 1-31, opcional
            categoria_id            TEXT REFERENCES fin_category(id) ON DELETE SET NULL,
            conta_pagamento_id      TEXT REFERENCES fin_account(id) ON DELETE SET NULL,
            ativa                   INTEGER NOT NULL DEFAULT 1,  -- 0 = pausada
            recorrencia             TEXT NOT NULL DEFAULT 'mensal',  -- só 'mensal' v1
            tipo                    TEXT NOT NULL DEFAULT 'despesa',  -- 'despesa' | 'receita'
            notas                   TEXT,
            sort_order              INTEGER DEFAULT 0,
            created_at              TEXT DEFAULT (datetime('now')),
            updated_at              TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fin_recurring_ativa ON fin_recurring_bill(ativa);

        -- ─── Wishlist (submódulo do Hub Finance) ──────────────────────────
        -- Lista de desejos com cronograma opcional de reserva mensal. Item
        -- de wishlist NÃO cria transação automaticamente — vincula-se a uma
        -- transação real existente via `transacao_id` (vínculo manual ou via
        -- sugestão na importação de extrato). Schema completo em
        -- docs/hub-finance/wishlist-PLAN.md.

        -- Categorias próprias da wishlist (separadas de fin_category pra
        -- isolar "tema de desejo" de "tema de despesa real").
        CREATE TABLE IF NOT EXISTS fin_wishlist_categoria (
            id              TEXT PRIMARY KEY,
            nome            TEXT NOT NULL UNIQUE,
            cor             TEXT,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            criada_em       TEXT DEFAULT (datetime('now')),
            atualizada_em   TEXT DEFAULT (datetime('now'))
        );

        -- Item da wishlist. Status: desejado | poupando | comprado | desistido.
        -- `valor_real`, `comprado_em`, `transacao_id` só preenchidos quando
        -- status='comprado'. `transacao_id` nullable mesmo após compra —
        -- permite "comprei mas vinculo depois quando importar extrato".
        -- `motivo_desistencia`, `desistido_em` só quando status='desistido'.
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
        );
        CREATE INDEX IF NOT EXISTS idx_fin_wishlist_item_status
            ON fin_wishlist_item(status);
        CREATE INDEX IF NOT EXISTS idx_fin_wishlist_item_categoria
            ON fin_wishlist_item(categoria_id);

        -- Links múltiplos por item (lojas, referências, posts). `preco`
        -- opcional permite comparar lojas; `label` opcional pra rotular.
        CREATE TABLE IF NOT EXISTS fin_wishlist_link (
            id           TEXT PRIMARY KEY,
            item_id      TEXT NOT NULL REFERENCES fin_wishlist_item(id) ON DELETE CASCADE,
            url          TEXT NOT NULL,
            label        TEXT,
            preco        REAL,
            sort_order   INTEGER NOT NULL DEFAULT 0,
            criado_em    TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_fin_wishlist_link_item
            ON fin_wishlist_link(item_id);

        -- Cronograma de reserva mensal (opcional — item pode não ter linha).
        -- `valor_planejado` em BRL. `(item_id, ano, mes)` único pra evitar
        -- duplicata.
        --
        -- Fase 5 ("soft mode"): reserva NÃO é mais passivamente cumprida.
        --  - `dia` (opcional): dia preferido do mês pra você guardar.
        --    Default = último dia do mês quando NULL.
        --  - `transacao_id` (opcional): quando setado, indica que a
        --    transferência real pra caixinha aconteceu e a reserva
        --    está MATERIALIZADA. `reservado_acumulado` no item conta só
        --    reservas com vínculo. Reservas passadas sem vínculo viram
        --    `reservado_pendente` (badge "aguardando confirmação").
        --
        -- transacao_id sem FK action declarada porque ALTER ADD COLUMN
        -- não suporta REFERENCES no SQLite — limpeza manual no DELETE
        -- de transação.
        CREATE TABLE IF NOT EXISTS fin_wishlist_reserva (
            id                TEXT PRIMARY KEY,
            item_id           TEXT NOT NULL REFERENCES fin_wishlist_item(id) ON DELETE CASCADE,
            ano               INTEGER NOT NULL,
            mes               INTEGER NOT NULL,
            dia               INTEGER,
            valor_planejado   REAL NOT NULL,
            transacao_id      TEXT REFERENCES fin_transaction(id) ON DELETE SET NULL,
            notas             TEXT,
            criada_em         TEXT DEFAULT (datetime('now')),
            UNIQUE(item_id, ano, mes)
        );
        CREATE INDEX IF NOT EXISTS idx_fin_wishlist_reserva_item
            ON fin_wishlist_reserva(item_id);
        CREATE INDEX IF NOT EXISTS idx_fin_wishlist_reserva_mes
            ON fin_wishlist_reserva(ano, mes);

        -- Settings singleton (igual fin_settings).
        CREATE TABLE IF NOT EXISTS fin_wishlist_settings (
            id                              INTEGER PRIMARY KEY CHECK (id = 1),
            envelhecimento_threshold_meses  INTEGER NOT NULL DEFAULT 6,
            atualizado_em                   TEXT DEFAULT (datetime('now'))
        );

        -- ─── /Build (Sistema de Metas) ────────────────────────────────────
        -- Camada estratégica: Propósito → Visão → Meta → (Sprint) → Projeto
        -- → Entregável → Quest. Tabelas com prefixo `build_`. Schema completo
        -- em docs/metas-de-vida/PLAN.md.
        --
        -- v0 deste arquivo: tabelas estratégicas-texto (Propósito, Princípios,
        -- Visão, Settings). Sem Meta/Sprint/Guardrail/Ritual ainda — entram
        -- nos próximos passos de v0 → v1.5.

        -- Propósito: linha única id=1. Atemporal, único por usuário.
        -- Texto livre de 1-3 sentenças articulando o "arquétipo da build".
        CREATE TABLE IF NOT EXISTS build_purpose (
            id           INTEGER PRIMARY KEY CHECK (id = 1),
            texto        TEXT NOT NULL DEFAULT '',
            criado_em    TEXT DEFAULT (datetime('now')),
            revisado_em  TEXT DEFAULT (datetime('now'))
        );

        -- Princípios negativos (anti-metas) vivem dentro do Propósito.
        -- Não são entidade separada conceitualmente — são lista de strings
        -- atreladas ao único Propósito do sistema.
        CREATE TABLE IF NOT EXISTS build_purpose_principle (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            proposito_id  INTEGER NOT NULL DEFAULT 1 REFERENCES build_purpose(id) ON DELETE CASCADE,
            texto         TEXT NOT NULL,
            ordem         INTEGER DEFAULT 0,
            arquivado     INTEGER NOT NULL DEFAULT 0,
            criado_em     TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_build_purpose_principle_ordem
            ON build_purpose_principle(proposito_id, arquivado, ordem);

        -- Visão: 3 anos, versionada. Apenas UMA `ativa=1` por vez (regra
        -- enforced no backend, não no schema). Quando muda, a antiga vira
        -- ativa=0 + arquivada_em + motivo. Histórico preservado.
        CREATE TABLE IF NOT EXISTS build_vision (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            texto                 TEXT NOT NULL,
            data_alvo             TEXT,                              -- YYYY-MM-DD
            ativa                 INTEGER NOT NULL DEFAULT 1,
            criada_em             TEXT DEFAULT (datetime('now')),
            arquivada_em          TEXT,
            motivo_arquivamento   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_build_vision_ativa
            ON build_vision(ativa) WHERE ativa = 1;

        -- Settings do módulo /Build (linha única id=1). Tudo configurável,
        -- nada hardcoded — limites, thresholds, visibilidade.
        CREATE TABLE IF NOT EXISTS build_settings (
            id                                  INTEGER PRIMARY KEY CHECK (id = 1),
            max_metas_ativas                    INTEGER NOT NULL DEFAULT 5,
            default_dependency_threshold_pct    INTEGER NOT NULL DEFAULT 80,
            metric_data_age_threshold_days      INTEGER NOT NULL DEFAULT 60,
            dashboard_card_visivel              INTEGER NOT NULL DEFAULT 1,
            atualizado_em                       TEXT DEFAULT (datetime('now'))
        );

        -- Meta — outcome com prazo. Os "breakpoints" da build.
        -- Schema completo em docs/metas-de-vida/PLAN.md §3.3.
        --
        -- v0 deste código: Meta com critério booleano OU numérico (digitado
        -- manual). criterion_metric_slug/item_id ficam null no v0; entram
        -- na v2 (pontes com Hub Health).
        --
        -- Limite duro de Metas ativas vem de build_settings.max_metas_ativas
        -- (validado no router, não no schema — facilita override pelo usuário).
        CREATE TABLE IF NOT EXISTS build_goal (
            id                          TEXT PRIMARY KEY,
            titulo                      TEXT NOT NULL,
            descricao                   TEXT,
            horizon                     TEXT NOT NULL,
            data_inicio                 TEXT,
            data_alvo                   TEXT NOT NULL,
            status                      TEXT NOT NULL DEFAULT 'ativa',
            criterion_type              TEXT NOT NULL,
            criterion_target_value      REAL,
            criterion_metric_slug       TEXT,
            criterion_metric_item_id    INTEGER,
            is_foundational             INTEGER NOT NULL DEFAULT 0,
            requires_threshold_pct      INTEGER NOT NULL DEFAULT 80,
            criada_em                   TEXT DEFAULT (datetime('now')),
            atualizada_em               TEXT DEFAULT (datetime('now')),
            concluida_em                TEXT,
            abandonada_em               TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_build_goal_status ON build_goal(status);

        -- Junção Meta ↔ Área (N:N com flag is_primary).
        -- Regra (validada no router): cada goal_id deve ter exatamente 1
        -- linha com is_primary=1.
        CREATE TABLE IF NOT EXISTS build_goal_area (
            goal_id     TEXT NOT NULL REFERENCES build_goal(id) ON DELETE CASCADE,
            area_slug   TEXT NOT NULL REFERENCES areas(slug),
            is_primary  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (goal_id, area_slug)
        );
        CREATE INDEX IF NOT EXISTS idx_build_goal_area_goal ON build_goal_area(goal_id);

        -- Junção Projeto ↔ Meta (N:N). Projeto = hipótese de caminho pra Meta.
        -- Mesmo Projeto pode servir várias Metas (alavanca múltipla);
        -- mesma Meta pode ter vários Projetos (hipóteses concorrentes).
        --
        -- Regra de drift: Projeto sem nenhuma linha aqui AND projects.classification
        -- IS NULL → estado "drift" (alerta na /Build).
        CREATE TABLE IF NOT EXISTS build_project_goal (
            project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            goal_id     TEXT NOT NULL REFERENCES build_goal(id) ON DELETE CASCADE,
            created_at  TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (project_id, goal_id)
        );
        CREATE INDEX IF NOT EXISTS idx_build_project_goal_goal ON build_project_goal(goal_id);

        -- Sprint = sub-unidade de 12 semanas dentro de Meta longa (anual).
        -- Meta trimestral NÃO usa Sprint — ela própria já é o sprint.
        -- Validação no router: rejeita Sprint pra Meta com horizon='trimestral'.
        CREATE TABLE IF NOT EXISTS build_sprint (
            id              TEXT PRIMARY KEY,
            goal_id         TEXT NOT NULL REFERENCES build_goal(id) ON DELETE CASCADE,
            numero          INTEGER NOT NULL,
            data_inicio     TEXT NOT NULL,
            data_fim        TEXT NOT NULL,
            foco            TEXT,
            status          TEXT NOT NULL DEFAULT 'planejado',
            criado_em       TEXT DEFAULT (datetime('now')),
            atualizado_em   TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_build_sprint_goal ON build_sprint(goal_id);

        -- Dependência sequencial entre Metas. goal_id depende de requires_goal_id.
        -- Validação no router: rejeita ciclos (DFS).
        -- "Satisfeita" no MVP v1: requires goal tem status='concluida'.
        CREATE TABLE IF NOT EXISTS build_goal_dependency (
            goal_id            TEXT NOT NULL REFERENCES build_goal(id) ON DELETE CASCADE,
            requires_goal_id   TEXT NOT NULL REFERENCES build_goal(id) ON DELETE CASCADE,
            created_at         TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (goal_id, requires_goal_id),
            CHECK (goal_id != requires_goal_id)
        );
        CREATE INDEX IF NOT EXISTS idx_build_goal_dep_required ON build_goal_dependency(requires_goal_id);

        -- Ritual: entidade de primeira classe (não é Quest, Task nem Routine).
        -- Reflexão estratégica — 4 cadências canônicas, seedadas no boot.
        -- schedule_config é JSON com formato dependente da cadência:
        --   semanal:    {"dia_semana": 0..6}                       (0=domingo)
        --   mensal:     {"modo": "primeiro_fim_de_semana"} OU
        --               {"modo": "data_fixa", "dia": 1..31}
        --   trimestral: {"modo": "marcos_padrao"} OU
        --               {"modo": "datas_custom", "datas": ["MM-DD", ...]}
        --   anual:      {"modo": "data_fixa", "data": "MM-DD"}
        CREATE TABLE IF NOT EXISTS build_ritual (
            cadencia                TEXT PRIMARY KEY,
            ativo                   INTEGER NOT NULL DEFAULT 1,
            schedule_config         TEXT NOT NULL,
            direcionamento_pensar   TEXT NOT NULL DEFAULT '',
            direcionamento_evitar   TEXT NOT NULL DEFAULT '',
            duracao_alvo_min        INTEGER NOT NULL DEFAULT 10,
            criado_em               TEXT DEFAULT (datetime('now')),
            atualizado_em           TEXT DEFAULT (datetime('now'))
        );

        -- Histórico de execuções do ritual.
        -- foco_proxima_periodo: só semanal preenche (decisão da semana seguinte).
        CREATE TABLE IF NOT EXISTS build_ritual_session (
            id                       TEXT PRIMARY KEY,
            cadencia                 TEXT NOT NULL REFERENCES build_ritual(cadencia) ON DELETE CASCADE,
            data_executado           TEXT NOT NULL,
            duracao_min              INTEGER,
            notas                    TEXT,
            foco_proxima_periodo     TEXT,
            criado_em                TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_build_ritual_session
            ON build_ritual_session(cadencia, data_executado DESC);

        -- v2 — Guardrail de Meta. Aponta pra Métrica de Hub Health + condição.
        -- "Espírito" da Meta: Meta pode bater o número principal mas violar
        -- o guardrail (ex.: 5k/mês AND sono médio ≥ 7h — bate 5k mas dorme 5h).
        -- Estado calculado on-the-fly: OK / VIOLADO / ESPERANDO_DADOS /
        -- METRICA_NAO_ENCONTRADA. Sem cache materializado no MVP.
        --
        -- metric_slug é validado contra GET /api/health/metrics em runtime
        -- (princípio "sem hardcoded" — sem const espelhada no /Build).
        CREATE TABLE IF NOT EXISTS build_goal_guardrail (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            goal_id         TEXT NOT NULL REFERENCES build_goal(id) ON DELETE CASCADE,
            metric_slug     TEXT NOT NULL,
            item_id         INTEGER,
            operador        TEXT NOT NULL,
            valor_alvo      REAL NOT NULL,
            descricao       TEXT,
            ordem           INTEGER NOT NULL DEFAULT 0,
            criado_em       TEXT DEFAULT (datetime('now')),
            atualizado_em   TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_build_goal_guardrail_goal
            ON build_goal_guardrail(goal_id, ordem);

        -- ─── Hub Health ───────────────────────────────────────────────────
        -- Módulo de saúde como prática contínua observada. Tabelas com
        -- prefixo `health_`. Schema em docs/hub-health/PLAN.md §3.
        --
        -- Estrutura: Domínio → (Item) → Registro → Métrica.
        -- Métrica é cidadã de primeira classe (calculada lazy on-read,
        -- conversa com /Build via slugs estáveis).

        -- Domínios cadastráveis. 5 defaults sugeridos no primeiro boot
        -- (Sono, Exercício, Alimentação, Vícios, Medidas Corporais).
        -- usuário pode adicionar/remover. `template` define os campos do
        -- Registro daquele domínio.
        CREATE TABLE IF NOT EXISTS health_domain (
            slug                       TEXT PRIMARY KEY,
            nome                       TEXT NOT NULL,
            cor                        TEXT,
            icone                      TEXT,
            template                   TEXT NOT NULL,
            usa_itens                  INTEGER NOT NULL DEFAULT 0,
            lembrete_ativo             INTEGER NOT NULL DEFAULT 0,
            ausencia_threshold_dias    INTEGER,
            ordem                      INTEGER DEFAULT 0,
            ativo                      INTEGER NOT NULL DEFAULT 1,
            criado_em                  TEXT DEFAULT (datetime('now')),
            atualizado_em              TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_health_domain_ativo ON health_domain(ativo, ordem);

        -- Itens dentro de domínios (Vícios, Exercício, Alimentação, Medidas).
        -- Sono não usa itens. Soft-delete via flag `arquivado` preserva
        -- registros históricos.
        CREATE TABLE IF NOT EXISTS health_item (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            domain_slug         TEXT NOT NULL REFERENCES health_domain(slug) ON DELETE CASCADE,
            nome                TEXT NOT NULL,
            unidade             TEXT,
            horario_esperado    TEXT,
            descricao           TEXT,
            cor                 TEXT,
            arquivado           INTEGER NOT NULL DEFAULT 0,
            arquivado_em        TEXT,
            ordem               INTEGER DEFAULT 0,
            criado_em           TEXT DEFAULT (datetime('now')),
            atualizado_em       TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_health_item_domain ON health_item(domain_slug, arquivado, ordem);

        -- Registros: eventos do template de cada domínio. Payload em JSON
        -- (string TEXT — SQLite suporta json_extract pra filtros se preciso).
        -- Decisão: JSON no MVP evita 20 colunas nullable; migrar pra colunas
        -- dedicadas só se performance virar problema.
        --
        -- Campos universais (data, horario, item_id, notas) ficam em colunas
        -- pra permitir índices e filtros eficientes.
        CREATE TABLE IF NOT EXISTS health_record (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            domain_slug     TEXT NOT NULL REFERENCES health_domain(slug) ON DELETE CASCADE,
            item_id         INTEGER REFERENCES health_item(id) ON DELETE SET NULL,
            data            TEXT NOT NULL,
            horario         TEXT,
            payload         TEXT NOT NULL DEFAULT '{}',
            notas           TEXT,
            criado_em       TEXT DEFAULT (datetime('now')),
            atualizado_em   TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_health_record_domain_data
            ON health_record(domain_slug, data DESC);
        CREATE INDEX IF NOT EXISTS idx_health_record_item_data
            ON health_record(item_id, data DESC);

        -- Settings do módulo (linha única id=1).
        -- `lembrete_horas_apos_acordar` ficou deprecado em 2026-05-09 — usar
        -- `hora_lembrete_sono` (HH:MM) que tem semântica clara. Coluna antiga
        -- mantida pra compat com bancos existentes (DROP COLUMN só em SQLite ≥3.35).
        CREATE TABLE IF NOT EXISTS health_settings (
            id                              INTEGER PRIMARY KEY CHECK (id = 1),
            lembrete_horas_apos_acordar     INTEGER NOT NULL DEFAULT 4,
            hora_lembrete_sono              TEXT NOT NULL DEFAULT '10:00',
            dashboard_card_visivel          INTEGER NOT NULL DEFAULT 1,
            mind_challenge_ativo            INTEGER NOT NULL DEFAULT 1,
            mind_challenge_min_aparicoes    INTEGER NOT NULL DEFAULT 5,
            mind_challenge_janela_dias      INTEGER NOT NULL DEFAULT 14,
            mind_suspender_por_dias         INTEGER NOT NULL DEFAULT 14,
            atualizado_em                   TEXT DEFAULT (datetime('now'))
        );

        -- ─── Mind — Observação Estruturada ────────────────────────────────
        -- Tags são catálogo personalizável (não array no payload) pra dar
        -- agrupamento confiável: queries SQL diretas via junction table.
        CREATE TABLE IF NOT EXISTS health_mind_tag (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            slug          TEXT NOT NULL UNIQUE,
            nome          TEXT NOT NULL,
            descricao     TEXT,
            cor           TEXT,
            arquivado     INTEGER NOT NULL DEFAULT 0,
            ordem         INTEGER NOT NULL DEFAULT 0,
            criado_em     TEXT DEFAULT (datetime('now')),
            atualizado_em TEXT DEFAULT (datetime('now'))
        );

        -- Junction N:N record↔tag. Record é health_record com domain_slug='mind'.
        CREATE TABLE IF NOT EXISTS health_mind_record_tag (
            record_id INTEGER NOT NULL REFERENCES health_record(id) ON DELETE CASCADE,
            tag_id    INTEGER NOT NULL REFERENCES health_mind_tag(id) ON DELETE CASCADE,
            PRIMARY KEY (record_id, tag_id)
        );
        CREATE INDEX IF NOT EXISTS idx_health_mind_record_tag_tag
            ON health_mind_record_tag(tag_id);

        -- Hipóteses como entidade própria — permite status (pending/validated/
        -- refuted/suspended) e o adversarial challenge sem reprocessar payload.
        -- Criada quando user preenche `hipotese` no payload da session.
        -- `suspended_until`: ISO date. Quando expirar, status volta a 'pending'.
        CREATE TABLE IF NOT EXISTS health_mind_hipotese (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            record_id       INTEGER NOT NULL REFERENCES health_record(id) ON DELETE CASCADE,
            texto           TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','validated','refuted','suspended')),
            suspended_until TEXT,
            criado_em       TEXT DEFAULT (datetime('now')),
            atualizado_em   TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_health_mind_hipotese_status
            ON health_mind_hipotese(status);
        CREATE INDEX IF NOT EXISTS idx_health_mind_hipotese_record
            ON health_mind_hipotese(record_id);

        -- Nested Pages (caderno virtual estilo Notion dentro de Projetos).
        -- Doc: docs/nested-pages/PLAN.md. Cada projeto tem `notes` (página raiz)
        -- e N páginas em árvore: parent_page_id NULL = filha direta da raiz,
        -- senão filha de outra page. Cascade em ambas as FKs.
        CREATE TABLE IF NOT EXISTS project_pages (
            id              TEXT PRIMARY KEY,
            project_id      TEXT NOT NULL
                            REFERENCES projects(id) ON DELETE CASCADE,
            parent_page_id  TEXT
                            REFERENCES project_pages(id) ON DELETE CASCADE,
            title           TEXT NOT NULL DEFAULT 'Sem título',
            content_json    TEXT,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_project_pages_project
            ON project_pages(project_id);
        CREATE INDEX IF NOT EXISTS idx_project_pages_parent
            ON project_pages(parent_page_id);

        -- ─── Library ──────────────────────────────────────────────────────
        -- Módulo de input curado (livros, filmes, podcasts, artigos, cursos…).
        -- Doc completa: docs/library/PLAN.md. Filosofia: destilação > consumo —
        -- item só é "fechado" (status='done') quando tem tese_central +
        -- o_que_ficou preenchidos. Sem rating estrela, sem progress bar.

        -- Saga: agrupamento puramente visual de items (ex: "28 dias depois"
        -- → "28 semanas depois" → "28 anos depois"). Sem mecânica — não força
        -- status, não bloqueia delete. Item pertence a 0 ou 1 saga; `saga_ordem`
        -- governa ordem dentro do grupo (drag-and-drop no frontend).
        CREATE TABLE IF NOT EXISTS library_saga (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            nome       TEXT NOT NULL,
            descricao  TEXT,
            cor        TEXT,
            ordem      INTEGER NOT NULL DEFAULT 0,
            criado_em  TEXT DEFAULT (datetime('now')),
            atualizado_em TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_library_saga_ordem ON library_saga(ordem);

        -- Item principal: uma obra/conteúdo registrado.
        CREATE TABLE IF NOT EXISTS library_item (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo                TEXT NOT NULL,                       -- livro/filme/serie/podcast/artigo/video/curso/palestra/paper/outro
            titulo              TEXT NOT NULL,
            autor               TEXT,
            ano                 INTEGER,
            status              TEXT NOT NULL DEFAULT 'queue',       -- queue/doing/done/abandoned
            data_inicio         TEXT,                                -- YYYY-MM-DD (seta ao virar doing)
            data_fim            TEXT,                                -- YYYY-MM-DD (seta ao virar done/abandoned)
            tese_central        TEXT,                                -- obrigatório p/ done (validado no backend)
            o_que_ficou         TEXT,                                -- obrigatório p/ done
            abandoned_reason    TEXT,                                -- obrigatório p/ abandoned
            origem              TEXT,                                -- quem indicou / onde achou (livre)
            revisitar_em        TEXT,                                -- YYYY-MM-DD opcional
            notes_json          TEXT,                                -- BlockNote JSON (notas inline)
            sort_order          INTEGER NOT NULL DEFAULT 0,
            saga_id             INTEGER REFERENCES library_saga(id) ON DELETE SET NULL,
            saga_ordem          INTEGER NOT NULL DEFAULT 0,
            criado_em           TEXT DEFAULT (datetime('now')),
            atualizado_em       TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_library_item_status
            ON library_item(status, sort_order);
        CREATE INDEX IF NOT EXISTS idx_library_item_revisitar
            ON library_item(revisitar_em) WHERE revisitar_em IS NOT NULL;
        -- Index idx_library_item_saga é criado FORA do executescript pra
        -- garantir que as colunas saga_* já existem (em DBs migrados via
        -- ALTER TABLE — _try_add_column lá embaixo).

        -- Tags livres pra agrupamento por tema. Mesma estrutura das tags do
        -- Mind — vocabulário emerge do uso, não fixado em código.
        CREATE TABLE IF NOT EXISTS library_tag (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            slug        TEXT NOT NULL UNIQUE,
            nome        TEXT NOT NULL,
            cor         TEXT,
            arquivado   INTEGER NOT NULL DEFAULT 0,
            ordem       INTEGER NOT NULL DEFAULT 0,
            criado_em   TEXT DEFAULT (datetime('now'))
        );

        -- M:N item ↔ tag.
        CREATE TABLE IF NOT EXISTS library_item_tag (
            item_id  INTEGER NOT NULL REFERENCES library_item(id) ON DELETE CASCADE,
            tag_id   INTEGER NOT NULL REFERENCES library_tag(id)  ON DELETE CASCADE,
            PRIMARY KEY(item_id, tag_id)
        );
        CREATE INDEX IF NOT EXISTS idx_library_item_tag_tag
            ON library_item_tag(tag_id);

        -- Sessões cronometradas por item (mesmo padrão de quest/task/routine).
        -- Regra global "uma ativa por vez" reforçada via active_session.py.
        CREATE TABLE IF NOT EXISTS library_session (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id      INTEGER NOT NULL REFERENCES library_item(id) ON DELETE CASCADE,
            session_num  INTEGER NOT NULL,
            started_at   TEXT NOT NULL,                              -- ISO com Z (UTC)
            ended_at     TEXT,                                        -- null = rodando ou pausada
            UNIQUE(item_id, session_num)
        );
        CREATE INDEX IF NOT EXISTS idx_library_session_item
            ON library_session(item_id, session_num);

        -- Cross-links polimórficos pra outros módulos. target_type pode ser
        -- 'mind_hipotese' | 'quest' | 'build_principle' | 'build_goal'.
        -- Não usa FK por causa do polimorfismo — links órfãos viram problema
        -- pequeno se entidade target for deletada (limpeza futura, se virar
        -- atrito).
        CREATE TABLE IF NOT EXISTS library_link (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id      INTEGER NOT NULL REFERENCES library_item(id) ON DELETE CASCADE,
            target_type  TEXT NOT NULL,
            target_id    TEXT NOT NULL,                              -- TEXT porque quest.id é uuid
            nota         TEXT,
            criado_em    TEXT DEFAULT (datetime('now')),
            UNIQUE(item_id, target_type, target_id)
        );
        CREATE INDEX IF NOT EXISTS idx_library_link_target
            ON library_link(target_type, target_id);
        CREATE INDEX IF NOT EXISTS idx_library_link_item
            ON library_link(item_id);
        """)

        # /Build — coluna criterion_current_value: progresso digitado manualmente
        # em v1 (pré-Health). Em v2, quando Meta aponta pra metric_slug, esse
        # valor passa a ser puxado automaticamente do Hub Health.
        _try_add_column(conn, "ALTER TABLE build_goal ADD COLUMN criterion_current_value REAL")

        # /Build — coluna `notes` long-form pra Meta (BlockNote JSON). Diferente
        # de `descricao` (1-2 frases curtas, hint de propósito). `notes` é o
        # caderno da Meta: razões profundas, links, raciocínio, status detalhado.
        # Editado via BlockEditor no card de Meta (collapse fechado por default).
        _try_add_column(conn, "ALTER TABLE build_goal ADD COLUMN notes TEXT")

        # Hub Health — coluna `hora_lembrete_sono` (HH:MM) substituindo a antiga
        # `lembrete_horas_apos_acordar` (INT) que tinha semântica confusa.
        # Default '10:00'. Coluna antiga fica no schema por compat (SQLite não
        # suporta DROP COLUMN antes de 3.35), mas ignorada pelo backend.
        _try_add_column(conn, "ALTER TABLE health_settings ADD COLUMN hora_lembrete_sono TEXT NOT NULL DEFAULT '10:00'")

        # Hub Health — coluna `metric_primary_slug` em health_domain pra
        # configurar qual métrica aparece como vital no Dashboard. Null =
        # sistema escolhe um default razoável (ver health_metrics).
        _try_add_column(conn, "ALTER TABLE health_domain ADD COLUMN metric_primary_slug TEXT")

        # /Build Ritual — `nome` customizável (default null, frontend cai pra
        # label da cadência). Permite renomear "SEMANAL" → "Revisão de Sexta"
        # sem mexer na cadência (PK).
        _try_add_column(conn, "ALTER TABLE build_ritual ADD COLUMN nome TEXT")

        # /Build Ritual Session — flag `skipped` + `skip_reason` pra registrar
        # rodada pulada intencionalmente (viagem, doente, etc) sem virar falso
        # positivo no `dias_atraso`. Sessão skipped ainda move o schedule, mas
        # quebra streak.
        _try_add_column(conn, "ALTER TABLE build_ritual_session ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0")
        _try_add_column(conn, "ALTER TABLE build_ritual_session ADD COLUMN skip_reason TEXT")

        # Cleanup defensivo: rows de build_ritual_cluster com record_id apontando
        # pra session que não existe mais (legado de delete_ritual_session que
        # antes não cascateava). Sem isso essas rows ficam zumbi e bagunçam o
        # estado do REABRIR. Idempotente — só age se tiver órfãs.
        try:
            conn.execute(
                """DELETE FROM build_ritual_cluster
                   WHERE record_id IS NOT NULL
                   AND record_id NOT IN (SELECT id FROM build_ritual_session)"""
            )
        except sqlite3.Error:
            pass  # tabela ainda não existe em DBs muito antigos — segue

        # Hub Health Mind — settings do adversarial challenge.
        _try_add_column(conn, "ALTER TABLE health_settings ADD COLUMN mind_challenge_ativo INTEGER NOT NULL DEFAULT 1")
        _try_add_column(conn, "ALTER TABLE health_settings ADD COLUMN mind_challenge_min_aparicoes INTEGER NOT NULL DEFAULT 5")
        _try_add_column(conn, "ALTER TABLE health_settings ADD COLUMN mind_challenge_janela_dias INTEGER NOT NULL DEFAULT 14")
        _try_add_column(conn, "ALTER TABLE health_settings ADD COLUMN mind_suspender_por_dias INTEGER NOT NULL DEFAULT 14")

        # Garante que existe 1 linha de profile. Nome default é piada — o usuário
        # edita pelo ProfileEditModal no primeiro uso. INSERT OR IGNORE =
        # idempotente, então instâncias existentes não são sobrescritas.
        conn.execute(
            "INSERT OR IGNORE INTO user_profile(id, name, role, avatar_url) VALUES (1, ?, ?, ?)",
            ("John No Arms", "", ""),
        )

        # /Build: Propósito (linha única vazia) e Settings (defaults). Ambos
        # idempotentes — INSERT OR IGNORE não sobrescreve. Usuário edita
        # texto do Propósito pela UI da página /build assim que articular.
        conn.execute(
            "INSERT OR IGNORE INTO build_purpose(id, texto) VALUES (1, '')"
        )
        conn.execute(
            "INSERT OR IGNORE INTO build_settings(id) VALUES (1)"
        )

        # /Build: Rituais — 4 cadências canônicas. Seedadas com defaults
        # sensatos. Idempotente: INSERT OR IGNORE preserva configurações
        # editadas pelo usuário.
        # Templates de direcionamento vêm da seção §3.8 do PLAN.md.
        import json as _json
        ritual_seeds = [
            (
                "semanal",
                _json.dumps({"dia_semana": 0}),  # 0 = domingo (default)
                "Quais Metas tiveram progresso essa semana? "
                "Próxima semana: 1-2 Metas como foco explícito. "
                "Apareceu Projeto reativo? Tem como evitar na próxima? "
                "Entregáveis: o que foi entregue, o que atrasou?",
                "Não revisar Visão nem Propósito. "
                "Não criar nem matar Metas. "
                "Não pivotar Projeto. "
                "Sem reflexão filosófica — semanal é tática.",
                7,
            ),
            (
                "mensal",
                _json.dumps({"modo": "primeiro_fim_de_semana"}),
                "Cada Projeto ativo: avançou ou estagnou? "
                "Projeto parado há 3+ semanas? Falta tempo ou hipótese errada? "
                "% do mês foi reativo vs proativo? Passou de 30%? "
                "Alguma Meta sem progresso nenhum esse mês?",
                "Ainda não criar/matar Metas (trimestral). "
                "Não revisitar Visão. "
                "Não desenhar plano semanal.",
                20,
            ),
            (
                "trimestral",
                _json.dumps({"modo": "marcos_padrao"}),
                "Metas: quais ainda fazem sentido? Quais viraram passado? "
                "Poda agressiva: Meta sem progresso há 6 meses → mata ou repensa. "
                "Nova Meta entrando? (respeitando limite ativas) "
                "Pivot de Projeto: hipótese morreu — tenta outra ou desiste? "
                "Áreas: alguma vazia há 3 meses? "
                "Meta de fundação ainda é fundação? "
                "Visão: ajuste leve está chamando? (não rewrite — isso é anual)",
                "Propósito (intocado, anual). "
                "Mudança radical de Visão (anual). "
                "Detalhes semanais — sai com diretrizes, não com to-do list.",
                90,
            ),
            (
                "anual",
                _json.dumps({"modo": "data_fixa", "data": "01-01"}),
                "Visão de 3 anos ainda é sua, ou virou eco? "
                "Se mudou: versiona a antiga (histórico importa), escreve nova. "
                "Propósito: continua honesto? Aconteceu algo no ano que revelou que tá fora? "
                "Princípios negativos: algum foi violado consistentemente? "
                "Áreas: estrutura ainda reflete a vida? Mudança estrutural? "
                "Metas concluídas: o que aprendi sobre mim que não sabia?",
                "Tarefas, semanas, planejamento operacional. "
                "Comparação com outras pessoas.",
                240,
            ),
        ]
        for cadencia, schedule, pensar, evitar, duracao in ritual_seeds:
            conn.execute(
                "INSERT OR IGNORE INTO build_ritual"
                "(cadencia, schedule_config, direcionamento_pensar, "
                " direcionamento_evitar, duracao_alvo_min) "
                "VALUES (?, ?, ?, ?, ?)",
                (cadencia, schedule, pensar, evitar, duracao),
            )

        # Hub Health: 5 domínios default + Settings + itens iniciais.
        # Idempotente — INSERT OR IGNORE preserva edições do usuário.
        # Domínios cadastráveis (slug, template, ausência threshold, etc).
        health_domain_seeds = [
            # (slug, nome, cor, icone, template, usa_itens, lembrete_ativo, ausencia_dias, ordem)
            ("sono",          "Sono",              None,     "moon",     "janela_qualidade", 0, 1, 2,    1),
            ("exercicio",     "Exercício",         None,     "dumbbell", "atividade_tipo",   1, 1, 7,    2),
            ("alimentacao",   "Alimentação",       None,     "utensils", "refeicao_2modos",  1, 1, 1,    3),
            ("vicios",        "Vícios",            None,     "alert-triangle", "consumo_vontade", 1, 0, None, 4),
            ("medidas",       "Medidas Corporais", None,     "scale",    "metrica_simples",  1, 0, None, 5),
            # Mind: observação estruturada. Roxo dessaturado pra preencher matiz
            # livre na palette. lembrete=1 + ausencia=2 (alinha com sono — mesma
            # frequência diária). usa_itens=0 (observação não é por categoria).
            ("mind",          "Mind",              "#9b88c4", "eye",     "observacao_estruturada", 0, 1, 2, 6),
        ]
        for slug, nome, cor, icone, template, usa_itens, lembrete, ausencia, ordem in health_domain_seeds:
            conn.execute(
                "INSERT OR IGNORE INTO health_domain"
                "(slug, nome, cor, icone, template, usa_itens, lembrete_ativo,"
                " ausencia_threshold_dias, ordem) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (slug, nome, cor, icone, template, usa_itens, lembrete, ausencia, ordem),
            )

        # Itens default. Vícios não tem seed (decisão filosófica §3.5 RASCUNHO).
        # Seed de todos os itens de um domínio só se o domínio ainda não tem
        # nenhum item — evita ressuscitar itens deletados pelo usuário.
        health_item_seeds = {
            "exercicio": [
                # (nome, unidade, horario_esperado, descricao, ordem)
                ("Cardio",      None, None, None, 1),
                ("Musculação",  None, None, None, 2),
                ("Alongamento", None, None, None, 3),
            ],
            "alimentacao": [
                ("Café da manhã", None, "07:00", None, 1),
                ("Almoço",         None, "12:00", None, 2),
                ("Lanche",         None, "16:00", None, 3),
                ("Jantar",         None, "19:00", None, 4),
            ],
            "medidas": [
                ("Peso", "kg", None, None, 1),
            ],
        }
        for domain_slug, items in health_item_seeds.items():
            existing = conn.execute(
                "SELECT 1 FROM health_item WHERE domain_slug = ? LIMIT 1",
                (domain_slug,),
            ).fetchone()
            if existing:
                continue  # domínio já tem itens, não recria
            for nome, unidade, horario, descricao, ordem in items:
                conn.execute(
                    "INSERT INTO health_item"
                    "(domain_slug, nome, unidade, horario_esperado, descricao, ordem) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (domain_slug, nome, unidade, horario, descricao, ordem),
                )

        conn.execute(
            "INSERT OR IGNORE INTO health_settings(id) VALUES (1)"
        )

        # Mind — tags default (vocabulário operacional pra observação).
        # Usuário pode arquivar/criar próprios. INSERT OR IGNORE preserva edições.
        # Tags propositalmente neutras filosoficamente — operam como
        # categorias de padrão observável, não rótulos terapêuticos.
        mind_tag_seeds = [
            # (slug, nome, descricao, cor, ordem)
            ("rigidez",    "Rigidez",   "dificuldade de iniciar ou mudar",       None, 1),
            ("hesitacao",  "Hesitação", "negociar/postergar a ação",             None, 2),
            ("fadiga",     "Fadiga",    "esgotamento físico ou mental",          None, 3),
            ("foco",       "Foco",      "clareza/concentração",                  None, 4),
            ("presenca",   "Presença",  "atenção plena no momento",              None, 5),
            ("evitacao",   "Evitação",  "fuga consciente ou não de algo",        None, 6),
            ("impeto",     "Ímpeto",    "energia/vontade ativa",                 None, 7),
            ("ruido",      "Ruído",     "pensamento desorganizado",              None, 8),
            ("silencio",   "Silêncio",  "vazio observado, neutro",               None, 9),
            ("centro",     "Centro",    "alinhamento interno",                   None, 10),
            ("distorcao",  "Distorção", "viés/projeção identificada",            None, 11),
            ("clareza",    "Clareza",   "insight ou compreensão direta",         None, 12),
        ]
        for slug, nome, descricao, cor_tag, ordem in mind_tag_seeds:
            conn.execute(
                "INSERT OR IGNORE INTO health_mind_tag"
                "(slug, nome, descricao, cor, ordem) VALUES (?, ?, ?, ?, ?)",
                (slug, nome, descricao, cor_tag, ordem),
            )

        # Seed de áreas — só em instalação nova. Usamos `INSERT OR IGNORE`
        # antes, o que recriava áreas deletadas a cada boot. Agora: se a
        # tabela já tem qualquer linha, respeitamos o que o usuário fez
        # (renomear, deletar, recolorir). Áreas do seed são só um ponto
        # de partida pra quem acabou de instalar.
        existing_areas = conn.execute("SELECT COUNT(*) AS n FROM areas").fetchone()["n"]
        if existing_areas == 0:
            for slug, name, desc, order, color in AREAS:
                conn.execute(
                    "INSERT INTO areas(slug,name,description,sort_order,color) VALUES(?,?,?,?,?)",
                    (slug, name, desc, order, color),
                )

        # Seed de categorias do Hub Finance — só na primeira instalação. Mesmo
        # padrão das áreas: se usuário já editou (qualquer linha existe), não
        # mexemos. Categorias são identificadas por id (uuid), não por nome,
        # então rename não conflita.
        import uuid as _uuid
        existing_cats = conn.execute("SELECT COUNT(*) AS n FROM fin_category").fetchone()["n"]
        if existing_cats == 0:
            for nome, tipo, cor, sort_order in FIN_CATEGORIES:
                conn.execute(
                    "INSERT INTO fin_category(id, nome, tipo, cor, sort_order) VALUES(?,?,?,?,?)",
                    (str(_uuid.uuid4())[:8], nome, tipo, cor, sort_order),
                )
        else:
            # Migrações one-shot pra DBs já populados — adiciona categorias que
            # foram introduzidas depois do seed inicial. Identifica por
            # (nome, tipo); se usuário deletou intencionalmente, vai voltar (custo
            # aceitável pra adições raras vindas de feedback de uso).
            for nome, tipo in [
                ("Freelas", "receita"),
                ("Transferência Interna", "transferencia"),
            ]:
                exists = conn.execute(
                    "SELECT 1 FROM fin_category WHERE nome = ? AND tipo = ?",
                    (nome, tipo),
                ).fetchone()
                if not exists:
                    seed_match = next(
                        (s for s in FIN_CATEGORIES if s[0] == nome and s[1] == tipo),
                        None,
                    )
                    if seed_match:
                        max_sort = conn.execute(
                            "SELECT COALESCE(MAX(sort_order), 0) AS m FROM fin_category"
                        ).fetchone()["m"]
                        conn.execute(
                            "INSERT INTO fin_category(id, nome, tipo, cor, sort_order) "
                            "VALUES(?,?,?,?,?)",
                            (str(_uuid.uuid4())[:8], nome, tipo, seed_match[2], max_sort + 1),
                        )

        # Seed de categorias da Wishlist — só na primeira instalação.
        existing_wishlist_cats = conn.execute(
            "SELECT COUNT(*) AS n FROM fin_wishlist_categoria"
        ).fetchone()["n"]
        if existing_wishlist_cats == 0:
            for nome, cor, sort_order in FIN_WISHLIST_CATEGORIES:
                conn.execute(
                    "INSERT INTO fin_wishlist_categoria(id, nome, cor, sort_order) "
                    "VALUES(?,?,?,?)",
                    (str(_uuid.uuid4())[:8], nome, cor, sort_order),
                )

        # Singleton de settings da Wishlist (id=1).
        conn.execute(
            "INSERT OR IGNORE INTO fin_wishlist_settings(id, envelhecimento_threshold_meses) "
            "VALUES(1, 6)"
        )

        conn.commit()

        # Migrations idempotentes (ALTER TABLE ADD COLUMN é no-op se coluna existe).
        _try_add_column(conn, "ALTER TABLE quests ADD COLUMN calendar_event_id TEXT")
        _try_add_column(conn, "ALTER TABLE routines ADD COLUMN days_of_week TEXT")
        _try_add_column(conn, "ALTER TABLE routines ADD COLUMN day_of_month INTEGER")
        # Hub Finance — coluna pra deduplicar import CSV do Nubank.
        _try_add_column(conn, "ALTER TABLE fin_transaction ADD COLUMN nubank_id TEXT")
        # Índice unique (ignora NULL) — idempotente: CREATE INDEX IF NOT EXISTS.
        try:
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_tx_nubank_id "
                "ON fin_transaction(conta_id, nubank_id) WHERE nubank_id IS NOT NULL"
            )
            conn.commit()
        except sqlite3.OperationalError:
            pass

        # Hub Finance — vínculo opcional de transação a uma dívida (faculdade,
        # financiamento). FK SET NULL pra preservar transação se dívida sumir.
        _try_add_column(conn, "ALTER TABLE fin_transaction ADD COLUMN divida_id TEXT")
        try:
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_fin_tx_divida ON fin_transaction(divida_id)"
            )
            conn.commit()
        except sqlite3.OperationalError:
            pass

        # Hub Finance — vínculo de transação a fatura de cartão de crédito.
        # Compras de crédito são vinculadas à fatura aberta do cartão; só
        # entram no resumo mensal quando a fatura é paga.
        _try_add_column(conn, "ALTER TABLE fin_transaction ADD COLUMN fatura_id TEXT")
        try:
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_fin_tx_fatura ON fin_transaction(fatura_id)"
            )
            conn.commit()
        except sqlite3.OperationalError:
            pass

        # Hub Finance — feature "Jornada/Metas" foi removida (decisão do usuário
        # em 2026-05-03: vai ter um lugar especial pra isso, não no Finance).
        # Drop idempotente: limpa tabela e dados de DBs onde foi criada.
        try:
            conn.execute("DROP TABLE IF EXISTS fin_journey_goal")
            conn.commit()
        except sqlite3.OperationalError:
            pass

        # Hub Finance — valor acordado de um projeto (freelance). Usado pra
        # calcular R$/hora estimado contra o tempo total trabalhado nas quests
        # do projeto. Nullable: projetos não-monetizados (ex: estudo) não
        # precisam preencher.
        _try_add_column(conn, "ALTER TABLE projects ADD COLUMN valor_acordado REAL")
        # Cliente do projeto (FK pra fin_client). FK declarativa não funciona
        # via ALTER, mas tratamos no DELETE de cliente (SET NULL manual).
        _try_add_column(conn, "ALTER TABLE projects ADD COLUMN cliente_id TEXT")
        # Template informativo de pagamento — usado pra gerar parcelas iniciais
        # ('a_vista' | '50_50' | 'parcelado_3x' | 'parcelado_4x' | 'custom').
        # Após gerar parcelas, usuário pode editar individualmente — o template
        # serve só pra UX de criação inicial.
        _try_add_column(conn, "ALTER TABLE projects ADD COLUMN forma_pagamento_template TEXT")
        # Vínculo opcional de transação a uma Parcela Esperada — quando setado
        # e valor > 0, marca a parcela como 'recebido' automaticamente.
        _try_add_column(conn, "ALTER TABLE fin_transaction ADD COLUMN parcela_id TEXT")
        try:
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_fin_tx_parcela ON fin_transaction(parcela_id)"
            )
            conn.commit()
        except sqlite3.OperationalError:
            pass

        # Vínculo "esta transação É O PAGAMENTO de tal fatura" — distinto de
        # `fatura_id` (que indica "esta transação É UMA COMPRA dentro da
        # fatura"). Usado pra reconciliar txs importadas do Nubank do tipo
        # "Pagamento de fatura" com a fatura correspondente: ao setar, marca
        # a fatura como `paga` + `data_pagamento = tx.data`. Editável via
        # TransactionEditModal pra dar flexibilidade ao usuário.
        _try_add_column(conn, "ALTER TABLE fin_transaction ADD COLUMN pagamento_fatura_id TEXT")
        try:
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_fin_tx_pagto_fatura ON fin_transaction(pagamento_fatura_id)"
            )
            conn.commit()
        except sqlite3.OperationalError:
            pass

        # Vínculo "esta transação paga a conta recorrente X". Usado pra
        # conciliação: ao linkar uma tx já importada do extrato com a bill
        # cadastrada em fin_recurring_bill (luz, aluguel, etc), evita duplicar
        # a saída no mês. Sem isso, marcar "como paga" sempre criava uma
        # transação nova mesmo quando a real já existia importada do banco.
        _try_add_column(conn, "ALTER TABLE fin_transaction ADD COLUMN recurring_bill_id TEXT")
        try:
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_fin_tx_recurring_bill ON fin_transaction(recurring_bill_id)"
            )
            conn.commit()
        except sqlite3.OperationalError:
            pass

        # Auto-link de pagamento de fatura via regra de categorização.
        # Quando regra com `link_cartao_id` bate numa tx, o sistema procura
        # fatura aberta/fechada do cartão com total ≈ valor da tx; se exatamente
        # 1 match, marca como pagamento. Pra Pix/transferências recorrentes
        # tipo "Pagamento de fatura" do Nubank — depois do 1º link manual +
        # criação da regra, próximas viram automático.
        _try_add_column(conn, "ALTER TABLE fin_categorization_rule ADD COLUMN link_cartao_id TEXT")

        # Cotação manual da conta pra BRL — só usada quando moeda != BRL.
        # Ex: Wise USD com cotacao_brl=5.20 → saldo em USD * 5.20 = saldo BRL.
        # Null = não converte (não soma no total geral). Update manual via
        # AccountModal; opcionalmente sync via /api/finance/exchange-rate.
        _try_add_column(conn, "ALTER TABLE fin_account ADD COLUMN cotacao_brl REAL")

        # Tipo de recorrência: 'despesa' (default, retrocompat) | 'receita'
        # (salário, mesada, etc). Permite cadastrar entradas fixas no mesmo
        # módulo de "Contas fixas".
        _try_add_column(conn, "ALTER TABLE fin_recurring_bill ADD COLUMN tipo TEXT NOT NULL DEFAULT 'despesa'")

        # Wishlist Fase 5: dia preferido pra reserva mensal (opcional) +
        # vínculo opcional pra transação real que MATERIALIZA a reserva
        # (ex: transferência pra caixinha do Nubank). Mudança semântica:
        # `reservado_acumulado` passa a contar SÓ as reservas com vínculo —
        # "soft mode" pedido pelo usuário, sem assumir cumprimento. Doc:
        # docs/hub-finance/wishlist-PLAN.md §7 (decisão #7 revista).
        _try_add_column(conn, "ALTER TABLE fin_wishlist_reserva ADD COLUMN dia INTEGER")
        _try_add_column(conn, "ALTER TABLE fin_wishlist_reserva ADD COLUMN transacao_id TEXT")

        # `completed_at`: adiciona + backfill inicial (só roda uma vez, quando a
        # coluna não existia ainda — o backfill é inócuo em reboots).
        try:
            conn.execute("ALTER TABLE quests ADD COLUMN completed_at TEXT")
            conn.commit()
            conn.execute(
                "UPDATE quests SET completed_at = updated_at WHERE status = 'done' AND completed_at IS NULL"
            )
            conn.commit()
        except sqlite3.OperationalError as e:
            if "duplicate column" not in str(e).lower():
                raise

        _try_add_column(conn, "ALTER TABLE deliverables ADD COLUMN deadline TEXT")

        # Campo de descrição rápida em quests (separado de notes)
        _try_add_column(conn, "ALTER TABLE quests ADD COLUMN description TEXT")

        # Mesma descrição (notion-style blocks) em tasks e routines —
        # editável pelo dropdown "info" do PlannedItemRow na página Dia.
        _try_add_column(conn, "ALTER TABLE tasks ADD COLUMN description TEXT")
        _try_add_column(conn, "ALTER TABLE routines ADD COLUMN description TEXT")

        # Prioridade também em tasks e routines (quests já tinha). Obrigatória
        # na criação nova, mas as linhas antigas ficam com 'critical' como
        # carimbo neutro — user vai limpar dados reais assim que começar a usar.
        _try_add_column(conn, "ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'critical'")
        _try_add_column(conn, "ALTER TABLE routines ADD COLUMN priority TEXT DEFAULT 'critical'")
        conn.execute("UPDATE tasks SET priority = 'critical' WHERE priority IS NULL OR priority = ''")
        conn.execute("UPDATE routines SET priority = 'critical' WHERE priority IS NULL OR priority = ''")
        conn.commit()

        # Projeto "arquivado" (gaveta) — independente de status. Null = ativo,
        # ISO timestamp = arquivado naquele momento. Oculta da lista principal
        # sem apagar dado.
        _try_add_column(conn, "ALTER TABLE projects ADD COLUMN archived_at TEXT")
        conn.commit()

        # /Build: classificação do Projeto quando não está vinculado a Meta.
        # NULL = drift (alerta). Valores válidos: 'manutencao', 'reativo',
        # 'exploratorio'. Ver docs/metas-de-vida/PLAN.md §3.5.
        _try_add_column(conn, "ALTER TABLE projects ADD COLUMN classification TEXT")
        _try_add_column(conn, "ALTER TABLE projects ADD COLUMN classified_at TEXT")
        conn.commit()

        # One-shot cleanup: purge orphan subtasks (quest has parent but no
        # deliverable). New model makes deliverable_id required for any quest
        # inside a project — the user confirmed these were test data.
        # Idempotent: no-op on subsequent boots since the API now rejects
        # creating orphans.
        conn.execute(
            "DELETE FROM quests WHERE parent_id IS NOT NULL AND deliverable_id IS NULL"
        )
        conn.commit()

        # ─── Project/Quest split migration (one-shot) ──────────────────────
        # Pré-split: projetos eram quests com parent_id NULL; deliverables
        # tinham quest_id apontando pra esses. Agora `projects` é tabela
        # própria e `quests` só contém trabalho granular (subtarefas).
        #
        # Steps:
        #   1. ALTER quests ADD COLUMN project_id (idempotente)
        #   2. Copia quests parent-null → projects
        #   3. Seta quests.project_id = parent_id nas subtarefas
        #   4. DELETE nos quests parent-null (agora vivem em projects)
        #   5. Recria deliverables com FK project_id → projects
        #   6. Limpa parent_id órfão (refs dangling nos subtasks restantes)
        #
        # FKs ficam OFF durante a migration pra evitar cascade delete quando
        # removemos os quests-projeto. Detecção: presença de `quest_id` em
        # deliverables antes de rodar o CREATE TABLE IF NOT EXISTS deste init.
        _try_add_column(conn, "ALTER TABLE quests ADD COLUMN project_id TEXT")

        # Library — sagas: agrupamento puramente visual (28 dias depois →
        # 28 semanas depois → 28 anos depois). SQLite NÃO aceita REFERENCES
        # em ALTER TABLE ADD COLUMN — apenas em CREATE TABLE. Pra DBs já
        # criados antes desta migration, a coluna existe mas SEM FK. Order
        # ON DELETE SET NULL é aplicada no router (delete_saga seta NULL
        # explicitamente) pra cobrir o caso de DBs migrados.
        _try_add_column(conn, "ALTER TABLE library_item ADD COLUMN saga_id INTEGER")
        _try_add_column(conn, "ALTER TABLE library_item ADD COLUMN saga_ordem INTEGER NOT NULL DEFAULT 0")

        # Agenda diária — health_item ganha config de recorrência/duração
        # pra aparecer como pendência arrastável no /Dia. Default `diario=0`
        # (não gera pendência) pra não inundar /Dia com pendências antigas;
        # usuário ativa item a item nas settings do domain.
        _try_add_column(conn, "ALTER TABLE health_item ADD COLUMN diario INTEGER NOT NULL DEFAULT 0")
        _try_add_column(conn, "ALTER TABLE health_item ADD COLUMN duracao_media_min INTEGER")
        _try_add_column(conn, "ALTER TABLE health_item ADD COLUMN horario_sugerido TEXT")

        # Mind ganha config equivalente em health_settings (Mind não usa
        # health_item, vive em tabelas próprias).
        _try_add_column(conn, "ALTER TABLE health_settings ADD COLUMN mind_diario INTEGER NOT NULL DEFAULT 0")
        _try_add_column(conn, "ALTER TABLE health_settings ADD COLUMN mind_duracao_media_min INTEGER NOT NULL DEFAULT 20")
        _try_add_column(conn, "ALTER TABLE health_settings ADD COLUMN mind_horario_sugerido TEXT")
        # Agora que as colunas existem (tanto em DBs novos via CREATE TABLE
        # quanto em DBs migrados via ALTER TABLE), cria o índice composto.
        try:
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_library_item_saga "
                "ON library_item(saga_id, saga_ordem)"
            )
            conn.commit()
        except sqlite3.OperationalError:
            pass

        # ─── Sessões cronometradas pra pendências do /Dia ────────────────
        # Mind (meditação) e health_item (cardio/musculação/alongamento)
        # ganham tabelas de sessão paralelas a quest_sessions/library_session.
        # Padrão: cada play cria row; pause fecha (ended_at = now); resume
        # cria nova row (session_num++); finalize = pause + modal pré-
        # preenchido cria o health_record E linka todas as rows do cluster
        # ao record_id (record_id NULL = cluster ativo / não finalizado).
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS mind_session (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_num INTEGER NOT NULL,
            started_at  TEXT NOT NULL,
            ended_at    TEXT,
            record_id   INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mind_session_active
            ON mind_session(record_id, ended_at);

        CREATE TABLE IF NOT EXISTS health_item_session (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id     INTEGER NOT NULL REFERENCES health_item(id) ON DELETE CASCADE,
            session_num INTEGER NOT NULL,
            started_at  TEXT NOT NULL,
            ended_at    TEXT,
            record_id   INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_health_item_session_active
            ON health_item_session(item_id, record_id, ended_at);

        -- Cluster de runtime pra rituais (Build). Mesmo padrão de mind/
        -- health_item: rows com record_id NULL = cluster ativo; após
        -- finalizar, todas as rows do cluster ganham o id da build_ritual_session
        -- criada (record_id = build_ritual_session.id, TEXT). Cadencia
        -- separa clusters por tipo de ritual (diario/semanal/mensal/anual).
        CREATE TABLE IF NOT EXISTS build_ritual_cluster (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            cadencia    TEXT NOT NULL,
            session_num INTEGER NOT NULL,
            started_at  TEXT NOT NULL,
            ended_at    TEXT,
            record_id   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_build_ritual_cluster_active
            ON build_ritual_cluster(cadencia, record_id, ended_at);
        """)

        if needs_project_split:
            conn.execute("PRAGMA foreign_keys=OFF")
            try:
                # Copia project-quests (parent_id NULL) pra projects mantendo id.
                conn.execute("""
                    INSERT OR IGNORE INTO projects
                      (id, title, area_slug, status, priority, deadline, notes,
                       calendar_event_id, completed_at, sort_order,
                       created_at, updated_at)
                    SELECT id, title, area_slug, status, priority, deadline, notes,
                           calendar_event_id, completed_at, sort_order,
                           created_at, updated_at
                    FROM quests
                    WHERE parent_id IS NULL
                """)

                # Subtask quests: project_id = parent_id
                conn.execute("""
                    UPDATE quests SET project_id = parent_id
                    WHERE parent_id IS NOT NULL
                      AND (project_id IS NULL OR project_id = '')
                """)

                # Apaga os quests-projeto (vivem em projects agora)
                conn.execute("DELETE FROM quests WHERE parent_id IS NULL")

                # Limpa parent_id (dangling: apontava pros quests-projeto agora deletados)
                conn.execute("UPDATE quests SET parent_id = NULL")

                # Recria deliverables trocando FK quest_id → project_id
                conn.execute("""
                    CREATE TABLE deliverables_new (
                        id                  TEXT PRIMARY KEY,
                        project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                        title               TEXT NOT NULL,
                        done                INTEGER NOT NULL DEFAULT 0,
                        sort_order          INTEGER DEFAULT 0,
                        estimated_minutes   INTEGER,
                        minutes_worked      INTEGER DEFAULT 0,
                        deadline            TEXT
                    )
                """)
                conn.execute("""
                    INSERT INTO deliverables_new
                      (id, project_id, title, done, sort_order, estimated_minutes, minutes_worked, deadline)
                    SELECT id, quest_id, title, done, sort_order, estimated_minutes, minutes_worked, deadline
                    FROM deliverables
                """)
                conn.execute("DROP TABLE deliverables")
                conn.execute("ALTER TABLE deliverables_new RENAME TO deliverables")

                conn.commit()
            finally:
                conn.execute("PRAGMA foreign_keys=ON")
