"""Pydantic models do módulo Requisições (lista de compras pessoal).

Convenções da casa: *Out/*Create/*Update, PATCH parcial via
model_fields_set no router. NÃO toca no Finance — é lembrete + estimativa.
Item com cadência reabre sozinho quando o ritmo vence (estilo ritual);
o histórico de compras alimenta a média de preço real.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Cadencia = Literal["avulso", "quinzenal", "mensal", "bimestral", "trimestral"]


class RequisicaoItemOut(BaseModel):
    id: int
    nome: str
    categoria: Optional[str] = None
    cadencia: Cadencia
    preco_estimado: Optional[float] = None
    last_bought: Optional[str] = None
    arquivado: bool = False
    ordem: int = 0
    criado_em: Optional[str] = None
    atualizado_em: Optional[str] = None
    # ─── Computados (não persistidos) ───────────────────────────────
    aberta: bool = False                  # precisa comprar agora
    atrasado_dias: Optional[int] = None   # dias além da cadência (None se em dia/novo/avulso)
    proximo_em_dias: Optional[int] = None  # dias até reabrir (quando em dia)
    preco_medio: Optional[float] = None   # média do que pagou; cai pra preco_estimado
    compras_count: int = 0


class RequisicaoItemCreate(BaseModel):
    nome: str = Field(..., min_length=1)
    categoria: Optional[str] = None
    cadencia: Cadencia = "mensal"
    preco_estimado: Optional[float] = Field(None, ge=0)


class RequisicaoItemUpdate(BaseModel):
    nome: Optional[str] = None
    categoria: Optional[str] = None
    cadencia: Optional[Cadencia] = None
    preco_estimado: Optional[float] = Field(None, ge=0)
    arquivado: Optional[bool] = None


class MarcarCompradoIn(BaseModel):
    bought_at: Optional[str] = None       # YYYY-MM-DD, default hoje
    valor_pago: Optional[float] = Field(None, ge=0)


class RequisicaoReorderItem(BaseModel):
    id: int
    ordem: int


class RequisicaoPurchaseOut(BaseModel):
    id: int
    item_id: int
    nome: str            # join do item (pode ter sido renomeado depois)
    categoria: Optional[str] = None
    cadencia: Cadencia
    bought_at: str
    valor_pago: Optional[float] = None
