"""Router das nested pages (caderno virtual estilo Notion dentro de Projetos).

Doc autoritativa: docs/nested-pages/PLAN.md

Endpoints:
  GET    /api/projects/{project_id}/pages       — lista flat (sem content) pra hidratar blocos
  POST   /api/projects/{project_id}/pages       — cria page (default title "Sem título")
  GET    /api/pages/{page_id}                   — page completa (com content_json)
  PATCH  /api/pages/{page_id}                   — update parcial
  DELETE /api/pages/{page_id}                   — hard delete recursivo via CASCADE
  GET    /api/pages/{page_id}/descendants-count — preview pra modal de delete
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from db import get_conn
from models.project_page import (
    PAGE_COLUMNS,
    PAGE_META_COLUMNS,
    ProjectPageCreate,
    ProjectPageOut,
    ProjectPageMeta,
    ProjectPageUpdate,
)
from services.utils import utcnow_iso_z

router = APIRouter()


# ─── Listagem batch (sem content) ───────────────────────────────────────────

@router.get(
    "/api/projects/{project_id}/pages",
    response_model=list[ProjectPageMeta],
)
def list_project_pages(project_id: str):
    """Lista TODAS as pages do projeto, sem content_json. Usado pra hidratar
    título nos blocos `page` do BlockEditor (lookup batch — sem N+1) e pra
    montar breadcrumb."""
    with get_conn() as conn:
        # Garante que o projeto existe (404 explícito > lista vazia ambígua).
        proj = conn.execute(
            "SELECT id FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        if not proj:
            raise HTTPException(404, detail="Project not found")
        rows = conn.execute(
            f"SELECT {PAGE_META_COLUMNS} FROM project_pages "
            "WHERE project_id = ? "
            "ORDER BY COALESCE(parent_page_id, ''), sort_order ASC, created_at ASC",
            (project_id,),
        ).fetchall()
    return [dict(r) for r in rows]


# ─── Criação ────────────────────────────────────────────────────────────────

@router.post(
    "/api/projects/{project_id}/pages",
    response_model=ProjectPageOut,
    status_code=201,
)
def create_project_page(project_id: str, body: ProjectPageCreate):
    page_id = str(uuid.uuid4())[:8]
    now = utcnow_iso_z()
    title = (body.title or "").strip() or "Sem título"

    with get_conn() as conn:
        # Valida projeto.
        proj = conn.execute(
            "SELECT id FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        if not proj:
            raise HTTPException(404, detail="Project not found")

        # Valida parent — se informado, precisa existir E pertencer ao mesmo projeto.
        if body.parent_page_id:
            parent = conn.execute(
                "SELECT id, project_id FROM project_pages WHERE id = ?",
                (body.parent_page_id,),
            ).fetchone()
            if not parent:
                raise HTTPException(422, detail="parent_page_id not found")
            if parent["project_id"] != project_id:
                raise HTTPException(
                    422,
                    detail="parent_page_id belongs to a different project",
                )

        # sort_order = max + 1 entre irmãs (mesmo parent_page_id, mesmo projeto).
        max_sort = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) AS m FROM project_pages "
            "WHERE project_id = ? AND "
            "      ((? IS NULL AND parent_page_id IS NULL) OR parent_page_id = ?)",
            (project_id, body.parent_page_id, body.parent_page_id),
        ).fetchone()
        sort_order = (max_sort["m"] or 0) + 1

        conn.execute(
            """INSERT INTO project_pages
                 (id, project_id, parent_page_id, title, content_json,
                  sort_order, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (page_id, project_id, body.parent_page_id, title, None,
             sort_order, now, now),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {PAGE_COLUMNS} FROM project_pages WHERE id = ?",
            (page_id,),
        ).fetchone()
    return dict(row)


# ─── Leitura individual ─────────────────────────────────────────────────────

@router.get("/api/pages/{page_id}", response_model=ProjectPageOut)
def get_page(page_id: str):
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT {PAGE_COLUMNS} FROM project_pages WHERE id = ?",
            (page_id,),
        ).fetchone()
    if not row:
        raise HTTPException(404, detail="Page not found")
    return dict(row)


# ─── Update parcial ─────────────────────────────────────────────────────────

@router.patch("/api/pages/{page_id}", response_model=ProjectPageOut)
def update_page(page_id: str, body: ProjectPageUpdate):
    fields: dict = {}
    for name in body.model_fields_set:
        fields[name] = getattr(body, name)
    if not fields:
        raise HTTPException(400, detail="Nothing to update")

    # Normaliza title vazio → default.
    if "title" in fields:
        t = (fields["title"] or "").strip()
        fields["title"] = t or "Sem título"

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id, project_id, parent_page_id FROM project_pages WHERE id = ?",
            (page_id,),
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Page not found")

        # Se vai mover parent: valida ciclo (parent novo não pode ser
        # descendente da própria page) + mesmo projeto.
        if "parent_page_id" in fields:
            new_parent = fields["parent_page_id"]
            if new_parent is not None:
                if new_parent == page_id:
                    raise HTTPException(422, detail="page cannot be its own parent")
                parent_row = conn.execute(
                    "SELECT id, project_id FROM project_pages WHERE id = ?",
                    (new_parent,),
                ).fetchone()
                if not parent_row:
                    raise HTTPException(422, detail="parent_page_id not found")
                if parent_row["project_id"] != existing["project_id"]:
                    raise HTTPException(
                        422,
                        detail="parent_page_id belongs to a different project",
                    )
                # Walk up: se cruzar o próprio page_id na cadeia → ciclo.
                cursor = parent_row["id"]
                steps = 0
                while cursor is not None and steps < 200:
                    if cursor == page_id:
                        raise HTTPException(422, detail="cycle detected")
                    nxt = conn.execute(
                        "SELECT parent_page_id FROM project_pages WHERE id = ?",
                        (cursor,),
                    ).fetchone()
                    cursor = nxt["parent_page_id"] if nxt else None
                    steps += 1

        fields["updated_at"] = utcnow_iso_z()
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [page_id]
        conn.execute(f"UPDATE project_pages SET {set_clause} WHERE id = ?", values)
        conn.commit()
        row = conn.execute(
            f"SELECT {PAGE_COLUMNS} FROM project_pages WHERE id = ?",
            (page_id,),
        ).fetchone()
    return dict(row)


# ─── Delete recursivo (CASCADE faz o trabalho) ──────────────────────────────

@router.delete("/api/pages/{page_id}")
def delete_page(page_id: str):
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM project_pages WHERE id = ?", (page_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Page not found")
        # Coleta descendentes ANTES do delete pra devolver lista de ids
        # afetados (frontend usa pra limpar blocos `page` órfãos no JSON
        # do pai — ver docs/nested-pages/PLAN.md §7.3).
        descendants = _collect_descendants(conn, page_id)
        deleted_ids = [page_id] + [d["id"] for d in descendants]
        conn.execute("DELETE FROM project_pages WHERE id = ?", (page_id,))
        conn.commit()
    return {"deleted_count": len(deleted_ids), "deleted_ids": deleted_ids}


# ─── Preview de descendentes (pro modal de delete) ──────────────────────────

@router.get("/api/pages/{page_id}/descendants-count")
def descendants_count(page_id: str):
    """Lista todos os descendentes da page (recursivo). Usado pelo modal
    de confirmação de delete pra mostrar o que vai junto."""
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM project_pages WHERE id = ?", (page_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Page not found")
        descendants = _collect_descendants(conn, page_id)
    return {
        "count": len(descendants),
        "titles": [d["title"] for d in descendants],
        "descendants": descendants,
    }


# ─── Helpers ────────────────────────────────────────────────────────────────

def _collect_descendants(conn, page_id: str) -> list[dict]:
    """Lista descendentes da page (recursivo), retornando {id, title, depth}.

    Usa CTE recursiva do SQLite (`WITH RECURSIVE`) — uma única query, sem
    N+1 round-trip. Antes: BFS Python com 1 SELECT por nível, escalava O(N
    queries) onde N = profundidade da árvore. Agora: O(1) query.

    `depth` começa em 1 (filhas diretas) e cresce conforme desce. Order:
    BFS por sort_order ASC dentro de cada nível.

    Limit 5000 como sanity stop em caso de árvore patologicamente grande
    (improvável; protege backend de OOM).
    """
    rows = conn.execute(
        """
        WITH RECURSIVE descendants(id, title, depth, parent_path) AS (
            -- Anchor: filhas diretas da page raiz, depth = 1
            SELECT
                child.id,
                child.title,
                1 AS depth,
                printf('%010d/%s', child.sort_order, child.id) AS parent_path
            FROM project_pages child
            WHERE child.parent_page_id = ?

            UNION ALL

            -- Recursive: filhas das já visitadas, depth + 1
            SELECT
                grandchild.id,
                grandchild.title,
                d.depth + 1,
                d.parent_path || '/' || printf('%010d/%s', grandchild.sort_order, grandchild.id)
            FROM project_pages grandchild
            JOIN descendants d ON grandchild.parent_page_id = d.id
            WHERE d.depth < 100  -- sanity: árvore não passa de 100 níveis
        )
        SELECT id, title, depth FROM descendants
        ORDER BY parent_path
        LIMIT 5000
        """,
        (page_id,),
    ).fetchall()
    return [{"id": r["id"], "title": r["title"], "depth": r["depth"]} for r in rows]
