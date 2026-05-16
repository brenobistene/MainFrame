"""Pydantic models para Project Page (nested pages estilo Notion).

Doc: docs/nested-pages/PLAN.md
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class ProjectPageOut(BaseModel):
    id: str
    project_id: str
    parent_page_id: Optional[str] = None
    title: str
    content_json: Optional[str] = None
    sort_order: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ProjectPageMeta(BaseModel):
    """Versão "leve" — sem content_json. Usada na listagem batch que hidrata
    os blocos `page` do BlockEditor (lookup de título)."""
    id: str
    project_id: str
    parent_page_id: Optional[str] = None
    title: str
    sort_order: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ProjectPageCreate(BaseModel):
    parent_page_id: Optional[str] = None
    title: Optional[str] = None  # default "Sem título" no backend


class ProjectPageUpdate(BaseModel):
    title: Optional[str] = None
    content_json: Optional[str] = None
    sort_order: Optional[int] = None
    parent_page_id: Optional[str] = None


class ProjectPageDescendant(BaseModel):
    id: str
    title: str
    depth: int  # 1 = filha direta


PAGE_COLUMNS = """id, project_id, parent_page_id, title, content_json,
                  sort_order, created_at, updated_at"""

PAGE_META_COLUMNS = """id, project_id, parent_page_id, title,
                       sort_order, created_at, updated_at"""
