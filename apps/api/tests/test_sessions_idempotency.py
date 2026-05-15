"""Testes da idempotência de start/resume de sessões — bug crítico que
deixava sessões órfãs em double-click (rotinas/quests/tasks).

Garante a invariante: se já existe sessão aberta da entidade, start/resume
devolve ela em vez de criar nova. Aplica pros 3 tipos (quest, task, routine).
"""
import pytest


@pytest.fixture
def routine_with_id(isolated_db):
    """Cria uma rotina mensal pra testes de sessão."""
    import db as db_module
    with db_module.get_conn() as conn:
        conn.execute(
            "INSERT INTO routines(id, title, recurrence, priority) VALUES(?,?,?,?)",
            ("r1", "Rotina Teste", "daily", "medium"),
        )
        conn.commit()
    return "r1"


@pytest.fixture
def task_with_id(isolated_db):
    """Cria uma tarefa standalone."""
    import db as db_module
    with db_module.get_conn() as conn:
        conn.execute(
            "INSERT INTO tasks(id, title, priority, duration_minutes) VALUES(?,?,?,?)",
            ("t1", "Task Teste", "medium", 30),
        )
        conn.commit()
    return "t1"


@pytest.fixture
def quest_with_id(isolated_db):
    """Cria uma quest standalone (sem project)."""
    import db as db_module
    with db_module.get_conn() as conn:
        conn.execute(
            "INSERT INTO quests(id, title, area_slug, status, priority) VALUES(?,?,?,?,?)",
            ("q1", "Quest Teste", "work", "doing", "medium"),
        )
        conn.commit()
    return "q1"


# ─── Rotina ────────────────────────────────────────────────────────────────

def test_routine_start_duplicado_devolve_mesma_sessao(client, routine_with_id):
    """Double-click no play da rotina não cria 2 rows — segundo call devolve
    a sessão existente."""
    r1 = client.post(f"/api/routines/{routine_with_id}/sessions/start")
    assert r1.status_code == 201
    sid1 = r1.json()["id"]

    r2 = client.post(f"/api/routines/{routine_with_id}/sessions/start")
    assert r2.status_code == 201
    sid2 = r2.json()["id"]

    assert sid1 == sid2  # mesma sessão

    # E só existe UMA sessão aberta no DB
    import db as db_module
    with db_module.get_conn() as conn:
        count = conn.execute(
            "SELECT COUNT(*) c FROM routine_sessions WHERE routine_id = ? AND ended_at IS NULL",
            (routine_with_id,),
        ).fetchone()["c"]
        assert count == 1


def test_routine_stop_apos_double_start_fecha_a_unica(client, routine_with_id):
    """Stop fecha a sessão idempotente (não deixa nada aberto)."""
    import db as db_module
    client.post(f"/api/routines/{routine_with_id}/sessions/start")
    client.post(f"/api/routines/{routine_with_id}/sessions/start")  # idempotente

    stop = client.post(f"/api/routines/{routine_with_id}/sessions/stop")
    assert stop.status_code == 200

    with db_module.get_conn() as conn:
        count = conn.execute(
            "SELECT COUNT(*) c FROM routine_sessions WHERE routine_id = ? AND ended_at IS NULL",
            (routine_with_id,),
        ).fetchone()["c"]
        assert count == 0


def test_routine_toggle_fecha_sessao_aberta(client, routine_with_id):
    """Marcar rotina como done (toggle) deve fechar sessão aberta — invariante
    que sustenta o active_session filter."""
    import db as db_module
    client.post(f"/api/routines/{routine_with_id}/sessions/start")

    # Toggle (cria log + fecha sessão)
    res = client.post(f"/api/routines/{routine_with_id}/toggle")
    assert res.status_code == 200
    assert res.json()["done"] is True

    with db_module.get_conn() as conn:
        # sessão fechada
        count_open = conn.execute(
            "SELECT COUNT(*) c FROM routine_sessions WHERE routine_id = ? AND ended_at IS NULL",
            (routine_with_id,),
        ).fetchone()["c"]
        assert count_open == 0
        # log criado
        count_log = conn.execute(
            "SELECT COUNT(*) c FROM routine_logs WHERE routine_id = ?",
            (routine_with_id,),
        ).fetchone()["c"]
        assert count_log == 1


def test_routine_toggle_off_nao_reabre_sessao(client, routine_with_id):
    """Toggle off (deleta log) não deve abrir nova sessão — sessões só
    nascem de start/resume."""
    import db as db_module
    # Liga o toggle 2x: primeiro cria log + fecha sessão (se houvesse),
    # segundo deleta log.
    client.post(f"/api/routines/{routine_with_id}/toggle")
    client.post(f"/api/routines/{routine_with_id}/toggle")

    with db_module.get_conn() as conn:
        count_sessions = conn.execute(
            "SELECT COUNT(*) c FROM routine_sessions WHERE routine_id = ?",
            (routine_with_id,),
        ).fetchone()["c"]
        assert count_sessions == 0  # nunca criou sessão


# ─── Task ──────────────────────────────────────────────────────────────────

def test_task_start_duplicado_devolve_mesma_sessao(client, task_with_id):
    r1 = client.post(f"/api/tasks/{task_with_id}/sessions/start")
    assert r1.status_code == 201
    sid1 = r1.json()["id"]

    r2 = client.post(f"/api/tasks/{task_with_id}/sessions/start")
    assert r2.status_code == 201
    assert r2.json()["id"] == sid1


# ─── Quest ─────────────────────────────────────────────────────────────────

def test_quest_start_duplicado_devolve_mesma_sessao(client, quest_with_id):
    r1 = client.post(f"/api/quests/{quest_with_id}/sessions/start")
    assert r1.status_code == 201
    sid1 = r1.json()["id"]

    r2 = client.post(f"/api/quests/{quest_with_id}/sessions/start")
    assert r2.status_code == 201
    assert r2.json()["id"] == sid1


# ─── Active session ───────────────────────────────────────────────────────

def test_active_session_mostra_rotina_aberta(client, routine_with_id):
    """active_session deve enxergar sessão aberta de rotina (filtro
    `rl.id IS NULL` foi removido — invariante "log ⇒ sessão fechada" é
    garantido pelo toggle, não pelo filtro)."""
    client.post(f"/api/routines/{routine_with_id}/sessions/start")
    res = client.get("/api/sessions/active")
    assert res.status_code == 200
    data = res.json()
    assert data is not None
    assert data["type"] == "routine"
    assert data["id"] == routine_with_id
    assert data["is_active"] is True


def test_active_session_null_sem_sessoes(client):
    """Sem nenhuma sessão aberta, active = None."""
    res = client.get("/api/sessions/active")
    assert res.status_code == 200
    assert res.json() is None


def test_active_session_conflito_em_play_de_outra_entidade(client, routine_with_id, task_with_id):
    """Com rotina rodando, tentar play em task retorna 409 com título da rotina."""
    client.post(f"/api/routines/{routine_with_id}/sessions/start")
    res = client.post(f"/api/tasks/{task_with_id}/sessions/start")
    assert res.status_code == 409
    # detail é o título da sessão em conflito (frontend usa pra alert)
    assert "Rotina Teste" in res.text or "Rotina Teste" in res.json().get("detail", "")
