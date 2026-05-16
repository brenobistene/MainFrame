"""Testes do router de Nested Pages (caderno virtual estilo Notion).

Cobre os caminhos críticos:
  - Cascade delete: deletar pai apaga filhas em cascade, retorna deleted_ids
  - Validação de ciclo: PATCH parent_page_id que cruza descendente → 422
  - Cross-project: parent_page_id de outro projeto → 422
  - CTE recursiva: descendants-count em árvore profunda retorna ordenado
  - Title vazio: backend normaliza pra "Sem título"

Doc: docs/nested-pages/PLAN.md
"""
from __future__ import annotations


def test_create_page_default_title(client, project_factory):
    """POST sem title → backend normaliza pra 'Sem título'."""
    project_factory(id="p1")
    res = client.post("/api/projects/p1/pages", json={})
    assert res.status_code == 201
    page = res.json()
    assert page["title"] == "Sem título"
    assert page["parent_page_id"] is None
    assert page["sort_order"] == 1


def test_cascade_delete_returns_all_ids(client, project_factory):
    """DELETE de page com filhas/netas → CASCADE pelo SQLite + retorna lista
    completa de deleted_ids pro frontend limpar blocos órfãos no JSON do pai."""
    project_factory(id="p1")
    a = client.post("/api/projects/p1/pages", json={"title": "A"}).json()
    a1 = client.post(
        "/api/projects/p1/pages",
        json={"parent_page_id": a["id"], "title": "A.1"},
    ).json()
    a11 = client.post(
        "/api/projects/p1/pages",
        json={"parent_page_id": a1["id"], "title": "A.1.1"},
    ).json()
    a2 = client.post(
        "/api/projects/p1/pages",
        json={"parent_page_id": a["id"], "title": "A.2"},
    ).json()

    res = client.delete(f"/api/pages/{a['id']}")
    assert res.status_code == 200
    body = res.json()
    assert body["deleted_count"] == 4
    # Própria + 3 descendentes (A.1, A.1.1, A.2). Ordem não importa pro
    # frontend, só precisa estar todos presentes.
    assert set(body["deleted_ids"]) == {a["id"], a1["id"], a11["id"], a2["id"]}

    # Lista do projeto fica vazia.
    listed = client.get("/api/projects/p1/pages").json()
    assert listed == []


def test_cycle_detected_on_patch(client, project_factory):
    """PATCH parent_page_id que tornaria a page descendente do próprio
    pai → 422 cycle detected. Caminho: A → A.1 → A.1.1; tenta mover A pra
    ser filha de A.1.1 (cruza A na walk-up)."""
    project_factory(id="p1")
    a = client.post("/api/projects/p1/pages", json={"title": "A"}).json()
    a1 = client.post(
        "/api/projects/p1/pages",
        json={"parent_page_id": a["id"], "title": "A.1"},
    ).json()
    a11 = client.post(
        "/api/projects/p1/pages",
        json={"parent_page_id": a1["id"], "title": "A.1.1"},
    ).json()

    res = client.patch(
        f"/api/pages/{a['id']}",
        json={"parent_page_id": a11["id"]},
    )
    assert res.status_code == 422
    assert "cycle" in res.json()["detail"].lower()


def test_parent_cross_project_rejected(client, project_factory):
    """parent_page_id de outro projeto → 422. Pages são scoped ao projeto."""
    project_factory(id="p1")
    project_factory(id="p2")
    page_p2 = client.post("/api/projects/p2/pages", json={"title": "P2"}).json()

    res = client.post(
        "/api/projects/p1/pages",
        json={"parent_page_id": page_p2["id"], "title": "filha errada"},
    )
    assert res.status_code == 422
    assert "different project" in res.json()["detail"].lower()


def test_descendants_count_recursive(client, project_factory):
    """`/descendants-count` usa CTE recursiva — retorna toda a sub-árvore
    com depth correto, ordenada por sort_order. Caminho: A com 2 filhas
    (A.1, A.2) e A.1 com 1 neta (A.1.1) → 3 descendentes."""
    project_factory(id="p1")
    a = client.post("/api/projects/p1/pages", json={"title": "A"}).json()
    a1 = client.post(
        "/api/projects/p1/pages",
        json={"parent_page_id": a["id"], "title": "A.1"},
    ).json()
    client.post(
        "/api/projects/p1/pages",
        json={"parent_page_id": a1["id"], "title": "A.1.1"},
    )
    client.post(
        "/api/projects/p1/pages",
        json={"parent_page_id": a["id"], "title": "A.2"},
    )

    res = client.get(f"/api/pages/{a['id']}/descendants-count")
    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 3
    titles = body["titles"]
    assert "A.1" in titles
    assert "A.1.1" in titles
    assert "A.2" in titles

    # Depth: A.1 e A.2 são filhas diretas (depth 1), A.1.1 é neta (depth 2)
    descendants = {d["title"]: d for d in body["descendants"]}
    assert descendants["A.1"]["depth"] == 1
    assert descendants["A.2"]["depth"] == 1
    assert descendants["A.1.1"]["depth"] == 2


def test_title_empty_normalizes_to_default(client, project_factory):
    """PATCH com title='' ou só whitespace → backend salva 'Sem título'.
    UX: usuário aperta Enter sem digitar nada e o título não vira string vazia."""
    project_factory(id="p1")
    page = client.post("/api/projects/p1/pages", json={"title": "Original"}).json()

    res = client.patch(f"/api/pages/{page['id']}", json={"title": "   "})
    assert res.status_code == 200
    assert res.json()["title"] == "Sem título"


def test_delete_project_cascades_pages(client, project_factory):
    """Deletar projeto → todas as pages caem junto (FK ON DELETE CASCADE)."""
    project_factory(id="p1")
    page = client.post("/api/projects/p1/pages", json={"title": "X"}).json()

    # Deleta projeto direto via DB (não há endpoint DELETE /api/projects no
    # escopo deste test — vamos via raw SQL)
    import db as db_module
    with db_module.get_conn() as conn:
        conn.execute("DELETE FROM projects WHERE id = ?", ("p1",))
        conn.commit()

    res = client.get(f"/api/pages/{page['id']}")
    assert res.status_code == 404
