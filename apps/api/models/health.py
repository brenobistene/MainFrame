"""Pydantic models para o módulo Hub Health.

Cobre as 4 entidades do MVP:
- Domain (cadastrável; 5 defaults sugeridos)
- Item (sub-entidade dentro de domínios que precisam — Vícios, Exercício, Alimentação, Medidas)
- Record (evento concreto; payload JSON varia por template)
- Settings (linha única)

Filosofia "observação > julgamento" rigorosamente aplicada — sem campos
de "score", "achievement" ou similares. Ver docs/hub-health/RASCUNHO.md §3.

Templates suportados (decisão #15 do RASCUNHO, §4 do PLAN.md):
- janela_qualidade: hora_inicio + hora_fim + qualidade 1-5 + tipo + notas (Sono)
- atividade_tipo: item + duracao_min + intensidade 1-5 + notas (Exercício)
- refeicao_2modos: item+comeu OU descricao livre + horario + notas (Alimentação)
- consumo_vontade: item + quantidade + horario + vontade 1-5 + notas (Vícios)
- metrica_simples: item + valor + horario + notas (Medidas Corporais)
- evento_escala: escala 1-5 + horario + notas (Humor, Energia, Estresse)
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


# ─── Domain ───────────────────────────────────────────────────────────────

class DomainOut(BaseModel):
    slug: str
    nome: str
    cor: Optional[str] = None
    icone: Optional[str] = None
    template: str
    usa_itens: bool
    lembrete_ativo: bool
    ausencia_threshold_dias: Optional[int] = None
    ordem: int
    ativo: bool
    metric_primary_slug: Optional[str] = None
    criado_em: str
    atualizado_em: str


class DomainCreate(BaseModel):
    slug: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-z0-9_-]+$")
    nome: str = Field(..., min_length=1, max_length=100)
    template: str = Field(..., min_length=1, max_length=64)
    usa_itens: bool = False
    cor: Optional[str] = Field(None, max_length=20)
    icone: Optional[str] = Field(None, max_length=50)
    lembrete_ativo: bool = False
    ausencia_threshold_dias: Optional[int] = Field(None, ge=1, le=365)
    ordem: Optional[int] = None
    metric_primary_slug: Optional[str] = Field(None, max_length=120)


class DomainUpdate(BaseModel):
    nome: Optional[str] = Field(None, min_length=1, max_length=100)
    cor: Optional[str] = Field(None, max_length=20)
    icone: Optional[str] = Field(None, max_length=50)
    lembrete_ativo: Optional[bool] = None
    ausencia_threshold_dias: Optional[int] = Field(None, ge=1, le=365)
    ordem: Optional[int] = None
    ativo: Optional[bool] = None
    metric_primary_slug: Optional[str] = Field(None, max_length=120)


# ─── Item ─────────────────────────────────────────────────────────────────

class ItemOut(BaseModel):
    id: int
    domain_slug: str
    nome: str
    unidade: Optional[str] = None
    horario_esperado: Optional[str] = None
    descricao: Optional[str] = None
    cor: Optional[str] = None
    arquivado: bool
    arquivado_em: Optional[str] = None
    ordem: int
    criado_em: str
    atualizado_em: str


class ItemCreate(BaseModel):
    nome: str = Field(..., min_length=1, max_length=100)
    unidade: Optional[str] = Field(None, max_length=30)
    horario_esperado: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    descricao: Optional[str] = Field(None, max_length=500)
    cor: Optional[str] = Field(None, max_length=20)
    ordem: Optional[int] = None


class ItemUpdate(BaseModel):
    nome: Optional[str] = Field(None, min_length=1, max_length=100)
    unidade: Optional[str] = Field(None, max_length=30)
    horario_esperado: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    descricao: Optional[str] = Field(None, max_length=500)
    cor: Optional[str] = Field(None, max_length=20)
    ordem: Optional[int] = None


# ─── Record ───────────────────────────────────────────────────────────────

class RecordOut(BaseModel):
    id: int
    domain_slug: str
    item_id: Optional[int] = None
    data: str
    horario: Optional[str] = None
    payload: dict[str, Any]
    notas: Optional[str] = None
    criado_em: str
    atualizado_em: str


class RecordCreate(BaseModel):
    """Payload do registro varia por template do domínio.

    O backend valida a forma do payload contra o template do domínio.
    Campos comuns (data/horario/item_id/notas) ficam no nível do body;
    campos específicos do template vão dentro de `payload`.
    """
    item_id: Optional[int] = None
    data: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    horario: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    payload: dict[str, Any] = Field(default_factory=dict)
    notas: Optional[str] = Field(None, max_length=2000)


class RecordUpdate(BaseModel):
    item_id: Optional[int] = None
    data: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    horario: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    payload: Optional[dict[str, Any]] = None
    notas: Optional[str] = Field(None, max_length=2000)


# ─── Settings ─────────────────────────────────────────────────────────────

class SettingsOut(BaseModel):
    hora_lembrete_sono: str             # HH:MM, quando lembrete de sono dispara
    dashboard_card_visivel: bool
    atualizado_em: str


class SettingsUpdate(BaseModel):
    hora_lembrete_sono: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    dashboard_card_visivel: Optional[bool] = None
