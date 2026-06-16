"""Sincronização automática do `done` do entregável a partir das quests.

Regra: entregável com >=1 quest fica `done` quando TODAS as quests estão
fechadas (done/cancelled); reabre se alguma estiver ativa. Entregável SEM
quests tem `done` manual (não é tocado pela sincronização).

Cobre todas as maneiras de mexer: criar quest, concluir/reabrir, deletar,
mover entre entregáveis, cancelar — pra garantir que a ticagem fica 100%
consistente sem precisar de refresh.
"""
from __future__ import annotations


def _make_deliverable(client, project_id, title="Entregável"):
    resp = client.post(
        f"/api/projects/{project_id}/deliverables", json={"title": title}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _make_quest(client, project_id, deliv_id, title="Quest"):
    resp = client.post(
        "/api/quests",
        json={
            "title": title,
            "area_slug": "freelas",
            "project_id": project_id,
            "deliverable_id": deliv_id,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _deliv_done(client, project_id, deliv_id) -> bool:
    resp = client.get(f"/api/projects/{project_id}/deliverables")
    assert resp.status_code == 200
    for d in resp.json():
        if d["id"] == deliv_id:
            return bool(d["done"])
    raise AssertionError(f"deliverable {deliv_id} não encontrado")


def _set_status(client, quest_id, status):
    resp = client.patch(f"/api/quests/{quest_id}", json={"status": status})
    assert resp.status_code == 200, resp.text


# ─── create ────────────────────────────────────────────────────────────────

def test_criar_quest_destica_entregavel_feito(client, project_factory):
    """O caso principal do usuário: entregável ticado + nova quest → destica."""
    p = project_factory()
    deliv = _make_deliverable(client, p["id"])
    q1 = _make_quest(client, p["id"], deliv, "q1")
    _set_status(client, q1, "done")
    assert _deliv_done(client, p["id"], deliv) is True  # única quest fechada

    _make_quest(client, p["id"], deliv, "q2")  # nova quest pendente
    assert _deliv_done(client, p["id"], deliv) is False  # destica sozinho


# ─── conclusão / reabertura ──────────────────────────────────────────────────

def test_concluir_todas_as_quests_tica_entregavel(client, project_factory):
    p = project_factory()
    deliv = _make_deliverable(client, p["id"])
    q1 = _make_quest(client, p["id"], deliv, "q1")
    q2 = _make_quest(client, p["id"], deliv, "q2")
    assert _deliv_done(client, p["id"], deliv) is False

    _set_status(client, q1, "done")
    assert _deliv_done(client, p["id"], deliv) is False  # q2 ainda aberta
    _set_status(client, q2, "done")
    assert _deliv_done(client, p["id"], deliv) is True


def test_reabrir_quest_destica_entregavel(client, project_factory):
    p = project_factory()
    deliv = _make_deliverable(client, p["id"])
    q1 = _make_quest(client, p["id"], deliv, "q1")
    _set_status(client, q1, "done")
    assert _deliv_done(client, p["id"], deliv) is True

    _set_status(client, q1, "pending")
    assert _deliv_done(client, p["id"], deliv) is False


def test_cancelada_conta_como_fechada(client, project_factory):
    p = project_factory()
    deliv = _make_deliverable(client, p["id"])
    q1 = _make_quest(client, p["id"], deliv, "q1")
    q2 = _make_quest(client, p["id"], deliv, "q2")
    _set_status(client, q1, "done")
    _set_status(client, q2, "cancelled")
    assert _deliv_done(client, p["id"], deliv) is True


# ─── delete ──────────────────────────────────────────────────────────────────

def test_deletar_ultima_quest_aberta_tica_entregavel(client, project_factory):
    p = project_factory()
    deliv = _make_deliverable(client, p["id"])
    q1 = _make_quest(client, p["id"], deliv, "q1")
    q2 = _make_quest(client, p["id"], deliv, "q2")
    _set_status(client, q1, "done")
    assert _deliv_done(client, p["id"], deliv) is False  # q2 aberta

    resp = client.delete(f"/api/quests/{q2}")
    assert resp.status_code == 204
    assert _deliv_done(client, p["id"], deliv) is True  # só resta q1 done


# ─── mover entre entregáveis ─────────────────────────────────────────────────

def test_mover_quest_recalcula_destino(client, project_factory):
    p = project_factory()
    d1 = _make_deliverable(client, p["id"], "d1")
    d2 = _make_deliverable(client, p["id"], "d2")
    qa = _make_quest(client, p["id"], d1, "qa")
    _set_status(client, qa, "done")
    qb = _make_quest(client, p["id"], d2, "qb")  # pendente
    assert _deliv_done(client, p["id"], d1) is True
    assert _deliv_done(client, p["id"], d2) is False

    # Move qa (done) pra d2 → d2 fica com done + pendente → reabre.
    resp = client.patch(f"/api/quests/{qa}", json={"deliverable_id": d2})
    assert resp.status_code == 200, resp.text
    assert _deliv_done(client, p["id"], d2) is False
    # d1 ficou vazio → done permanece como estava (vazio = manual, intocado).
    assert _deliv_done(client, p["id"], d1) is True


# ─── entregável sem quests = manual ──────────────────────────────────────────

def test_entregavel_sem_quests_mantem_done_manual(client, project_factory):
    p = project_factory()
    deliv = _make_deliverable(client, p["id"])
    # Marca manualmente como feito (sem quests).
    resp = client.patch(f"/api/deliverables/{deliv}", json={"done": True})
    assert resp.status_code == 200
    assert _deliv_done(client, p["id"], deliv) is True

    # Adicionar uma quest pendente passa a derivar → destica.
    _make_quest(client, p["id"], deliv, "q1")
    assert _deliv_done(client, p["id"], deliv) is False
