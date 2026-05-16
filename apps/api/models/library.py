"""Pydantic models para o módulo Library.

Doc completa: docs/library/PLAN.md.

Cobre as 5 entidades:
- LibraryItem (obra registrada)
- LibraryTag (tag livre)
- LibraryItemTag (associação M:N — não exposta diretamente)
- LibrarySession (sessão cronometrada)
- LibraryLink (cross-link polimórfico)
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

# Tipos possíveis de item — vocabulário fechado pra evitar "está em qual gaveta".
LibraryItemTipo = Literal[
    "livro",
    "filme",
    "serie",
    "podcast",
    "artigo",
    "video",
    "curso",
    "palestra",
    "paper",
    "outro",
]

LibraryItemStatus = Literal["queue", "doing", "done", "abandoned"]

LibraryLinkTargetType = Literal[
    "mind_hipotese",
    "quest",
    "build_principle",
    "build_goal",
]


# ─── Tag ──────────────────────────────────────────────────────────────────


class LibraryTagOut(BaseModel):
    id: int
    slug: str
    nome: str
    cor: Optional[str] = None
    arquivado: bool
    ordem: int
    criado_em: str


class LibraryTagCreate(BaseModel):
    slug: str = Field(..., min_length=1, max_length=80)
    nome: str = Field(..., min_length=1, max_length=120)
    cor: Optional[str] = Field(None, max_length=20)
    ordem: Optional[int] = None


class LibraryTagUpdate(BaseModel):
    nome: Optional[str] = Field(None, min_length=1, max_length=120)
    cor: Optional[str] = Field(None, max_length=20)
    arquivado: Optional[bool] = None
    ordem: Optional[int] = None


# ─── Item ─────────────────────────────────────────────────────────────────


class LibraryItemTagRef(BaseModel):
    id: int
    slug: str
    nome: str
    cor: Optional[str] = None


class LibraryLinkOut(BaseModel):
    id: int
    target_type: LibraryLinkTargetType
    target_id: str
    nota: Optional[str] = None
    criado_em: str


class LibraryItemOut(BaseModel):
    id: int
    tipo: LibraryItemTipo
    titulo: str
    autor: Optional[str] = None
    ano: Optional[int] = None
    status: LibraryItemStatus
    data_inicio: Optional[str] = None
    data_fim: Optional[str] = None
    tese_central: Optional[str] = None
    o_que_ficou: Optional[str] = None
    abandoned_reason: Optional[str] = None
    origem: Optional[str] = None
    revisitar_em: Optional[str] = None
    notes_json: Optional[str] = None
    sort_order: int
    saga_id: Optional[int] = None
    saga_ordem: int = 0
    tags: list[LibraryItemTagRef]
    links: list[LibraryLinkOut]
    minutos_total: int = 0
    criado_em: str
    atualizado_em: str


class LibraryItemListOut(BaseModel):
    """Versão enxuta pra listagem — sem notes_json (pesado) nem links."""
    id: int
    tipo: LibraryItemTipo
    titulo: str
    autor: Optional[str] = None
    ano: Optional[int] = None
    status: LibraryItemStatus
    data_inicio: Optional[str] = None
    data_fim: Optional[str] = None
    revisitar_em: Optional[str] = None
    origem: Optional[str] = None
    sort_order: int
    saga_id: Optional[int] = None
    saga_ordem: int = 0
    tags: list[LibraryItemTagRef]
    minutos_total: int = 0
    criado_em: str
    atualizado_em: str


class LibraryItemCreate(BaseModel):
    tipo: LibraryItemTipo
    titulo: str = Field(..., min_length=1, max_length=500)
    autor: Optional[str] = Field(None, max_length=300)
    ano: Optional[int] = Field(None, ge=0, le=3000)
    origem: Optional[str] = Field(None, max_length=500)
    tag_ids: list[int] = Field(default_factory=list)
    saga_id: Optional[int] = None


class LibraryItemUpdate(BaseModel):
    tipo: Optional[LibraryItemTipo] = None
    titulo: Optional[str] = Field(None, min_length=1, max_length=500)
    autor: Optional[str] = Field(None, max_length=300)
    ano: Optional[int] = Field(None, ge=0, le=3000)
    status: Optional[LibraryItemStatus] = None
    tese_central: Optional[str] = Field(None, max_length=2000)
    o_que_ficou: Optional[str] = Field(None, max_length=2000)
    abandoned_reason: Optional[str] = Field(None, max_length=1000)
    origem: Optional[str] = Field(None, max_length=500)
    revisitar_em: Optional[str] = None  # YYYY-MM-DD ou string vazia/null pra limpar
    notes_json: Optional[str] = None
    sort_order: Optional[int] = None
    tag_ids: Optional[list[int]] = None
    # Saga: aceita null pra desvincular, int positivo pra vincular. `saga_ordem`
    # pode vir junto ou ser gerenciado via POST /sagas/{id}/reorder.
    saga_id: Optional[int] = None
    saga_ordem: Optional[int] = None


# ─── Sessions ─────────────────────────────────────────────────────────────


class LibrarySessionOut(BaseModel):
    id: int
    item_id: int
    session_num: int
    started_at: str
    ended_at: Optional[str] = None
    elapsed_seconds: int


# ─── Links (cross-module) ────────────────────────────────────────────────


class LibraryLinkCreate(BaseModel):
    target_type: LibraryLinkTargetType
    target_id: str = Field(..., min_length=1)
    nota: Optional[str] = Field(None, max_length=500)


# ─── Painéis agregados ───────────────────────────────────────────────────


class LibraryTemaOut(BaseModel):
    """Agregação por tag — usado em /library/temas."""
    tag_id: int
    tag_slug: str
    tag_nome: str
    tag_cor: Optional[str] = None
    count_total: int
    count_done: int
    count_doing: int


class LibraryPendingOut(BaseModel):
    """Pendência de revisita — item com revisitar_em ≤ janela."""
    id: int
    titulo: str
    tipo: LibraryItemTipo
    revisitar_em: str
    dias_ate: int  # negativo = atrasado


class LibraryBacklinkOut(BaseModel):
    """Backlink: do ponto de vista do `target` (hipótese Mind, quest,
    princípio Build, meta Build), retorna os Library items que apontam
    pra ele. Endpoint: GET /api/library/backlinks?target_type=&target_id=.
    """
    link_id: int
    item_id: int
    item_tipo: LibraryItemTipo
    item_titulo: str
    item_status: LibraryItemStatus
    item_autor: Optional[str] = None
    nota: Optional[str] = None
    criado_em: str


# ─── Saga ─────────────────────────────────────────────────────────────────


class LibrarySagaOut(BaseModel):
    """Saga: agrupamento visual de items (ex: "28 dias depois"). Sem
    mecânica — só `nome` + opcional descricao/cor. `items_count` é
    computado pelo backend pra evitar N+1 no listing."""
    id: int
    nome: str
    descricao: Optional[str] = None
    cor: Optional[str] = None
    ordem: int
    items_count: int = 0
    criado_em: str
    atualizado_em: str


class LibrarySagaCreate(BaseModel):
    nome: str = Field(..., min_length=1, max_length=200)
    descricao: Optional[str] = Field(None, max_length=1000)
    cor: Optional[str] = Field(None, max_length=20)
    ordem: Optional[int] = None


class LibrarySagaUpdate(BaseModel):
    nome: Optional[str] = Field(None, min_length=1, max_length=200)
    descricao: Optional[str] = Field(None, max_length=1000)
    cor: Optional[str] = Field(None, max_length=20)
    ordem: Optional[int] = None


class LibrarySagaReorder(BaseModel):
    """Body do POST /sagas/{id}/reorder — define a ordem nova dos items
    da saga em uma única operação atômica. Items omitidos da lista são
    re-numerados ao final em ordem natural por id."""
    item_ids: list[int] = Field(default_factory=list)
