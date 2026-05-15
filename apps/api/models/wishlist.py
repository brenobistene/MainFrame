"""Pydantic models pro submódulo Wishlist do Hub Finance.

Schema completo em docs/hub-finance/wishlist-PLAN.md. Itens são desejos de
compra com cronograma opcional de reserva mensal. NÃO criam transação
automaticamente — vincula-se a transação real via `transacao_id`.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, field_validator


# ─── Status (constantes) ──────────────────────────────────────────────────

WISHLIST_STATUS = {"desejado", "poupando", "comprado", "desistido"}


# ─── Categoria ────────────────────────────────────────────────────────────

class WishlistCategoriaOut(BaseModel):
    id: str
    nome: str
    cor: Optional[str] = None
    sort_order: int = 0


class WishlistCategoriaCreate(BaseModel):
    nome: str
    cor: Optional[str] = None
    sort_order: Optional[int] = None


class WishlistCategoriaUpdate(BaseModel):
    nome: Optional[str] = None
    cor: Optional[str] = None
    sort_order: Optional[int] = None


# ─── Link ─────────────────────────────────────────────────────────────────

class WishlistLinkOut(BaseModel):
    id: str
    url: str
    label: Optional[str] = None
    preco: Optional[float] = None
    sort_order: int = 0


class WishlistLinkCreate(BaseModel):
    url: str
    label: Optional[str] = None
    preco: Optional[float] = None
    sort_order: Optional[int] = None


class WishlistLinkUpdate(BaseModel):
    url: Optional[str] = None
    label: Optional[str] = None
    preco: Optional[float] = None
    sort_order: Optional[int] = None


# ─── Reserva (linha do cronograma) ────────────────────────────────────────

class WishlistReservaOut(BaseModel):
    id: str
    ano: int
    mes: int                              # 1-12
    dia: Optional[int] = None             # 1-31, NULL = último dia do mês
    valor_planejado: float
    notas: Optional[str] = None
    # Fase 5: vínculo opcional pra transação real que materializa a reserva.
    transacao_id: Optional[str] = None


class WishlistReservaInput(BaseModel):
    """Linha do PUT /items/{id}/reservas — substitui cronograma inteiro."""
    ano: int
    mes: int
    dia: Optional[int] = None
    valor_planejado: float
    notas: Optional[str] = None

    @field_validator("mes")
    @classmethod
    def _check_mes(cls, v: int) -> int:
        if v < 1 or v > 12:
            raise ValueError("mes deve estar entre 1 e 12")
        return v

    @field_validator("dia")
    @classmethod
    def _check_dia(cls, v):
        if v is None:
            return v
        if v < 1 or v > 31:
            raise ValueError("dia deve estar entre 1 e 31")
        return v

    @field_validator("valor_planejado")
    @classmethod
    def _check_valor(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("valor_planejado deve ser > 0")
        return v


class WishlistReservaVincularBody(BaseModel):
    """Body do PATCH /reservas/{id}/transacao — set/clear vínculo."""
    transacao_id: Optional[str] = None    # null = limpar


class WishlistReservaMatchGroup(BaseModel):
    """Reserva pendente + candidatas (pro fluxo de pós-import)."""
    reserva: WishlistReservaOut
    item_id: str
    item_nome: str
    candidates: list["WishlistTransactionCandidate"]  # forward ref


# ─── Item ─────────────────────────────────────────────────────────────────

class WishlistItemOut(BaseModel):
    id: str
    nome: str
    descricao: Optional[str] = None
    categoria_id: Optional[str] = None
    valor_estimado: float
    prioridade: int = 0
    status: str = "desejado"
    data_alvo: Optional[str] = None

    # Compra (preenchidos quando status='comprado')
    valor_real: Optional[float] = None
    comprado_em: Optional[str] = None
    transacao_id: Optional[str] = None

    # Desistência (preenchidos quando status='desistido')
    desistido_em: Optional[str] = None
    motivo_desistencia: Optional[str] = None

    criada_em: Optional[str] = None
    atualizada_em: Optional[str] = None

    # ── Computados pelo backend ──
    links: list[WishlistLinkOut] = []
    reservas: list[WishlistReservaOut] = []
    # Fase 5 (semântica nova): só conta reservas CONFIRMADAS (com transacao_id).
    # "Soft mode" — não assume cumprimento, exige vínculo com transação real.
    reservado_acumulado: float = 0.0
    # Reservas passadas (mês <= atual) SEM vínculo — aguardando confirmação.
    # UI mostra como badge "aguardando" pra você lembrar de vincular.
    reservado_pendente: float = 0.0
    # max(0, valor_estimado - reservado_acumulado).
    reservado_restante: float = 0.0
    # 0..100 (clamp) — baseado em reservado_acumulado (CONFIRMADO).
    progresso_pct: float = 0.0
    # Próxima reserva futura (None se não houver).
    proxima_reserva: Optional[WishlistReservaOut] = None
    # Meses desde criada_em (pra UI mostrar badge "envelhecendo").
    meses_parado: int = 0


class WishlistItemCreate(BaseModel):
    nome: str
    descricao: Optional[str] = None
    categoria_id: Optional[str] = None
    valor_estimado: float
    data_alvo: Optional[str] = None

    @field_validator("valor_estimado")
    @classmethod
    def _check_valor(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("valor_estimado deve ser > 0")
        return v


class WishlistItemUpdate(BaseModel):
    nome: Optional[str] = None
    descricao: Optional[str] = None
    categoria_id: Optional[str] = None
    valor_estimado: Optional[float] = None
    prioridade: Optional[int] = None
    status: Optional[str] = None
    data_alvo: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _check_status(cls, v):
        if v is not None and v not in WISHLIST_STATUS:
            raise ValueError(f"status deve ser um de {sorted(WISHLIST_STATUS)}")
        return v


# ─── Ações de fluxo ───────────────────────────────────────────────────────

class WishlistComprarBody(BaseModel):
    """Body do POST /items/{id}/comprar."""
    valor_real: float
    data: Optional[str] = None             # YYYY-MM-DD; default = hoje no backend
    transacao_id: Optional[str] = None     # null = vincular depois

    @field_validator("valor_real")
    @classmethod
    def _check_valor(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("valor_real deve ser > 0")
        return v


class WishlistDesistirBody(BaseModel):
    motivo: Optional[str] = None


class WishlistReabrirBody(BaseModel):
    """Body do POST /items/{id}/reabrir — default vira 'desejado'."""
    novo_status: Optional[str] = None

    @field_validator("novo_status")
    @classmethod
    def _check_status(cls, v):
        if v is not None and v not in {"desejado", "poupando"}:
            raise ValueError("novo_status deve ser 'desejado' ou 'poupando'")
        return v


class WishlistReorderItem(BaseModel):
    id: str
    prioridade: int


class WishlistVincularBody(BaseModel):
    """Body do PATCH /items/{id}/transacao — set/clear vínculo com transação."""
    transacao_id: Optional[str] = None    # null = limpar


# ─── Settings ─────────────────────────────────────────────────────────────

class WishlistSettingsOut(BaseModel):
    envelhecimento_threshold_meses: int
    atualizado_em: Optional[str] = None


class WishlistSettingsUpdate(BaseModel):
    envelhecimento_threshold_meses: Optional[int] = None

    @field_validator("envelhecimento_threshold_meses")
    @classmethod
    def _check_threshold(cls, v):
        if v is not None and v < 1:
            raise ValueError("threshold deve ser >= 1 mês")
        return v


# ─── Summary (agregado pra UI) ────────────────────────────────────────────

class WishlistSummary(BaseModel):
    total_items_ativos: int            # desejado + poupando
    total_valor_estimado: float        # soma dos ativos
    # Fase 5: só conta reservas CONFIRMADAS (com transacao_id).
    total_reservado_acumulado: float
    # Reservas passadas SEM vínculo — pra UI mostrar "aguardando confirmação".
    total_reservado_pendente: float = 0.0
    itens_em_curso: int                # status=poupando
    proxima_compra_id: Optional[str] = None    # item mais próximo de completar
    proxima_compra_nome: Optional[str] = None
    proxima_compra_progresso_pct: Optional[float] = None
    media_mensal_reserva: float = 0.0


class WishlistMonthReservas(BaseModel):
    """Resposta de GET /reservas/mes — usada por monthly-summary."""
    ano: int
    mes: int
    total_reservado: float
    detalhamento: list[dict]  # [{item_id, item_nome, valor_planejado}]


# ─── Match de transação ↔ item (Fase 3) ───────────────────────────────────

class WishlistTransactionCandidate(BaseModel):
    """Candidata de transação real pra vincular a item de wishlist.
    Heurística: valor próximo, data dentro da janela, não-transferência,
    não-vinculada a outro item. Ver wishlist-PLAN §5.4 e §6 F5."""
    id: str
    data: str                            # YYYY-MM-DD
    valor: float                         # mantém sinal original (sempre < 0 aqui)
    descricao: str
    conta_id: Optional[str] = None
    conta_nome: Optional[str] = None
    diff_pct: float                      # |Δ| relativo em %, pra UI ordenar/destacar


class WishlistMatchGroup(BaseModel):
    """Item aguardando vínculo + lista de candidatas encontradas pra ele."""
    item: WishlistItemOut
    candidates: list[WishlistTransactionCandidate]
