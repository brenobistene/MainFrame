"""Pydantic models pro Hub Finance — v0 (vertical slice).

Cobre Conta, Categoria, Transação. Faturas, dívidas, parcelas e clientes vêm
em fases posteriores. Doc autoritativa: docs/hub-finance/PLAN.md.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, field_validator


# ─── Account ───────────────────────────────────────────────────────────────

ACCOUNT_TYPES = {"corrente", "credito", "wallet", "wise"}
ACCOUNT_ORIGINS = {"manual", "pynubank"}


class AccountOut(BaseModel):
    id: str
    nome: str
    tipo: str
    moeda: str = "BRL"
    origem_dados: str = "manual"
    sort_order: int = 0
    saldo: float = 0.0  # somatório das transações (calculado, não persistido)
    cotacao_brl: Optional[float] = None


class AccountCreate(BaseModel):
    nome: str
    tipo: str
    moeda: str = "BRL"
    origem_dados: str = "manual"
    cotacao_brl: Optional[float] = None

    @field_validator("tipo")
    @classmethod
    def _check_tipo(cls, v: str) -> str:
        if v not in ACCOUNT_TYPES:
            raise ValueError(f"tipo deve ser um de {sorted(ACCOUNT_TYPES)}")
        return v

    @field_validator("origem_dados")
    @classmethod
    def _check_origem(cls, v: str) -> str:
        if v not in ACCOUNT_ORIGINS:
            raise ValueError(f"origem_dados deve ser um de {sorted(ACCOUNT_ORIGINS)}")
        return v


class AccountUpdate(BaseModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    moeda: Optional[str] = None
    origem_dados: Optional[str] = None
    sort_order: Optional[int] = None
    cotacao_brl: Optional[float] = None


# ─── Category ──────────────────────────────────────────────────────────────

CATEGORY_TYPES = {"receita", "despesa", "estorno", "transferencia"}


class CategoryOut(BaseModel):
    id: str
    nome: str
    tipo: str
    cor: Optional[str] = None
    categoria_pai_id: Optional[str] = None
    sort_order: int = 0


class CategoryCreate(BaseModel):
    nome: str
    tipo: str
    cor: Optional[str] = None
    categoria_pai_id: Optional[str] = None

    @field_validator("tipo")
    @classmethod
    def _check_tipo(cls, v: str) -> str:
        if v not in CATEGORY_TYPES:
            raise ValueError(f"tipo deve ser um de {sorted(CATEGORY_TYPES)}")
        return v


class CategoryUpdate(BaseModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    cor: Optional[str] = None
    categoria_pai_id: Optional[str] = None
    sort_order: Optional[int] = None


# ─── Transaction ───────────────────────────────────────────────────────────

TRANSACTION_ORIGINS = {"manual", "nubank_csv"}


class TransactionOut(BaseModel):
    id: str
    data: str          # YYYY-MM-DD
    valor: float       # positivo = entrada, negativo = saída
    descricao: str
    conta_id: str
    categoria_id: Optional[str] = None
    origem: str = "manual"
    notas: Optional[str] = None
    nubank_id: Optional[str] = None
    divida_id: Optional[str] = None
    parcela_id: Optional[str] = None
    fatura_id: Optional[str] = None
    # Quando setado: esta tx é o pagamento da fatura X (não uma compra dela).
    # Setar via PATCH marca a fatura como `paga` automaticamente.
    pagamento_fatura_id: Optional[str] = None
    # Quando setado: esta tx paga a recurring_bill X. Usado pra reconciliar
    # uma tx já importada do banco com uma bill cadastrada (evita duplicar
    # o pagamento no mês). recurring_bills_status prioriza esse FK sobre o
    # match heurístico por descrição.
    recurring_bill_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class TransactionCreate(BaseModel):
    data: str
    valor: float
    descricao: str
    conta_id: str
    categoria_id: Optional[str] = None
    origem: str = "manual"
    notas: Optional[str] = None
    # Vínculo opcional na criação: usado pelo flow "marcar bill como paga →
    # criar novo lançamento" pra já registrar o link FK sem PATCH extra.
    recurring_bill_id: Optional[str] = None

    @field_validator("origem")
    @classmethod
    def _check_origem(cls, v: str) -> str:
        if v not in TRANSACTION_ORIGINS:
            raise ValueError(f"origem deve ser um de {sorted(TRANSACTION_ORIGINS)}")
        return v


class ImportSummary(BaseModel):
    """Resultado de import de CSV — quantas entraram, quantas eram duplicadas,
    quantas falharam parse. Erros agrupados pra debug rápido."""
    imported: int
    duplicates: int
    errors: int
    error_samples: list[str] = []
    auto_categorized: int = 0
    auto_linked_parcelas: int = 0


class CategorizationRuleOut(BaseModel):
    id: str
    pattern: str
    categoria_id: str
    times_matched: int = 0
    created_at: Optional[str] = None
    # Quando setado: ao aplicar a regra, tenta linkar a tx como pagamento de
    # fatura desse cartão (auto-link via match de valor exato).
    link_cartao_id: Optional[str] = None


class CategorizationRuleCreate(BaseModel):
    pattern: str
    categoria_id: str
    link_cartao_id: Optional[str] = None


class CategorizationRuleUpdate(BaseModel):
    pattern: Optional[str] = None
    categoria_id: Optional[str] = None
    link_cartao_id: Optional[str] = None


# ─── Debt ──────────────────────────────────────────────────────────────────

DEBT_STATUS = {"active", "paid_off", "cancelled"}


class DebtOut(BaseModel):
    id: str
    descricao: str
    valor_total_original: float
    parcela_mensal: Optional[float] = None
    data_inicio: Optional[str] = None
    categoria_id: Optional[str] = None
    status: str = "active"
    sort_order: int = 0
    # Computados pelo backend a cada GET/PATCH.
    valor_pago: float = 0.0
    saldo_devedor: float = 0.0
    parcelas_pagas: int = 0
    parcelas_restantes: Optional[int] = None  # None se sem parcela_mensal
    progresso_pct: float = 0.0  # 0..100


class DebtCreate(BaseModel):
    descricao: str
    valor_total_original: float
    parcela_mensal: Optional[float] = None
    data_inicio: Optional[str] = None
    categoria_id: Optional[str] = None


class DebtUpdate(BaseModel):
    descricao: Optional[str] = None
    valor_total_original: Optional[float] = None
    parcela_mensal: Optional[float] = None
    data_inicio: Optional[str] = None
    categoria_id: Optional[str] = None
    status: Optional[str] = None
    sort_order: Optional[int] = None

    @field_validator("status")
    @classmethod
    def _check_status(cls, v):
        if v is not None and v not in DEBT_STATUS:
            raise ValueError(f"status deve ser um de {sorted(DEBT_STATUS)}")
        return v


# ─── Parcela de Dívida (cronograma flexível) ──────────────────────────────

DEBT_PARCELA_STATUS = {"pendente", "paga", "atrasada"}


class DebtParcelaOut(BaseModel):
    id: str
    divida_id: str
    numero: int
    data_prevista: Optional[str] = None
    valor_planejado: Optional[float] = None  # null = auto
    transacao_pagamento_id: Optional[str] = None
    notas: Optional[str] = None
    # Computados pelo backend a cada GET:
    valor_efetivo: float = 0.0  # planejado se fixo, ou rateio se auto
    is_auto: bool = False       # True quando valor_planejado é null
    status: str = "pendente"    # 'pendente' | 'paga' | 'atrasada'
    valor_pago: Optional[float] = None  # quando paga, valor real da transação
    data_pagamento: Optional[str] = None  # quando paga, data da transação


class DebtParcelaCreate(BaseModel):
    data_prevista: Optional[str] = None
    valor_planejado: Optional[float] = None
    notas: Optional[str] = None


class DebtParcelaUpdate(BaseModel):
    data_prevista: Optional[str] = None
    valor_planejado: Optional[float] = None  # null aqui = quer setar como auto
    transacao_pagamento_id: Optional[str] = None
    notas: Optional[str] = None


class DebtParcelaGenerate(BaseModel):
    """Body pra POST /debts/{id}/parcelas/generate — gera N parcelas iniciais."""
    n_parcelas: int  # quantas criar
    data_inicio: str  # YYYY-MM-DD da primeira parcela
    modo: str = "uniforme"  # 'uniforme' (valor=total/n) | 'open' (valor=null)


class DebtParcelaComplete(BaseModel):
    """Body pra POST /debts/{id}/parcelas/complete — gera N parcelas fixas
    pelo saldo restante (total - soma das parcelas com valor_planejado fixo).
    `data_inicio` opcional: se não dado, usa última.data_prevista + 1 mês."""
    n_parcelas: int
    data_inicio: Optional[str] = None  # YYYY-MM-DD


# ─── Conta Fixa Recorrente (recurring bill) ────────────────────────────────

RECURRING_BILL_STATUS_INFERRED = {"paga", "pendente", "atrasada"}
RECURRING_BILL_TIPOS = {"despesa", "receita"}


class RecurringBillOut(BaseModel):
    id: str
    descricao: str
    valor_estimado: float
    dia_vencimento: Optional[int] = None  # 1-31
    categoria_id: Optional[str] = None
    conta_pagamento_id: Optional[str] = None
    ativa: bool = True
    recorrencia: str = "mensal"
    tipo: str = "despesa"  # 'despesa' | 'receita'
    notas: Optional[str] = None
    sort_order: int = 0


class RecurringBillCreate(BaseModel):
    descricao: str
    valor_estimado: float
    dia_vencimento: Optional[int] = None
    categoria_id: Optional[str] = None
    conta_pagamento_id: Optional[str] = None
    ativa: bool = True
    tipo: str = "despesa"
    notas: Optional[str] = None

    @field_validator("dia_vencimento")
    @classmethod
    def _check_dia(cls, v):
        if v is not None and not (1 <= v <= 31):
            raise ValueError("dia_vencimento deve estar entre 1 e 31")
        return v

    @field_validator("valor_estimado")
    @classmethod
    def _check_valor(cls, v):
        if v <= 0:
            raise ValueError("valor_estimado deve ser positivo")
        return v

    @field_validator("tipo")
    @classmethod
    def _check_tipo(cls, v):
        if v not in RECURRING_BILL_TIPOS:
            raise ValueError(f"tipo deve ser um de {sorted(RECURRING_BILL_TIPOS)}")
        return v


class RecurringBillUpdate(BaseModel):
    descricao: Optional[str] = None
    valor_estimado: Optional[float] = None
    dia_vencimento: Optional[int] = None
    categoria_id: Optional[str] = None
    conta_pagamento_id: Optional[str] = None
    ativa: Optional[bool] = None
    tipo: Optional[str] = None
    notas: Optional[str] = None
    sort_order: Optional[int] = None

    @field_validator("dia_vencimento")
    @classmethod
    def _check_dia(cls, v):
        if v is not None and not (1 <= v <= 31):
            raise ValueError("dia_vencimento deve estar entre 1 e 31")
        return v

    @field_validator("tipo")
    @classmethod
    def _check_tipo(cls, v):
        if v is not None and v not in RECURRING_BILL_TIPOS:
            raise ValueError(f"tipo deve ser um de {sorted(RECURRING_BILL_TIPOS)}")
        return v


class RecurringBillStatusItem(BaseModel):
    """Status de uma conta fixa num mês específico — inferido por categoria
    + match de descrição (sem persistir vínculo na transação)."""
    bill_id: str
    descricao: str
    valor_estimado: float
    dia_vencimento: Optional[int] = None
    categoria_id: Optional[str] = None
    tipo: str = "despesa"
    status: str  # 'paga' | 'pendente' | 'atrasada' (despesa) ou 'recebida' | 'pendente' | 'atrasada' (receita)
    valor_pago: Optional[float] = None  # quando paga/recebida, valor real
    transacao_id: Optional[str] = None
    data_pagamento: Optional[str] = None  # YYYY-MM-DD


class MonthCommitment(BaseModel):
    """Item unificado de compromisso do mês — junta recurring bills, debt
    parcelas, freela parcelas, faturas de cartão e reservas de wishlist
    em uma view única ordenada por dia. Status é inferido conforme a fonte
    (bill: tx-match; debt/freela: parcela.status; invoice: status do
    fin_invoice + check de vencimento vs hoje; wishlist: sempre 'pendente'
    — reserva é virtual e passiva)."""
    kind: str  # 'bill' | 'debt_parcela' | 'freela_parcela' | 'invoice' | 'wishlist'
    id: str  # bill_id, parcela_id ou invoice_id (pra UI dedup)
    descricao: str
    sub_descricao: Optional[str] = None  # ex: "parcela 3/12" ou "salário/recorrente"
    tipo: str  # 'despesa' | 'receita'
    dia: Optional[int] = None  # dia do mês (1-31), pra ordenação
    data_prevista: Optional[str] = None  # YYYY-MM-DD
    valor: float  # estimado/planejado
    valor_pago: Optional[float] = None  # quando paga, valor real
    status: str  # 'pendente' | 'paga' | 'recebida' | 'atrasada'
    transacao_id: Optional[str] = None
    data_pagamento: Optional[str] = None
    # Refs pra abrir modal/página correspondente conforme `kind`
    bill_id: Optional[str] = None
    debt_id: Optional[str] = None
    debt_descricao: Optional[str] = None
    parcela_numero: Optional[int] = None
    parcela_total: Optional[int] = None  # total de parcelas da dívida
    # Freela parcela: id do projeto pra navegar até /freelas
    freela_projeto_id: Optional[str] = None
    # Invoice (fatura de cartão): id da fatura + cartão pra abrir o modal
    invoice_id: Optional[str] = None
    cartao_id: Optional[str] = None
    cartao_nome: Optional[str] = None
    # Wishlist: id do item pra navegar até /wishlist e abrir o cronograma.
    wishlist_item_id: Optional[str] = None


class MonthCommitmentsResponse(BaseModel):
    year: int
    month: int
    items: list[MonthCommitment]
    total_a_pagar: float
    total_a_receber: float
    total_pago: float
    total_recebido: float
    sobra_projetada: float


class RecurringBillStatusMonth(BaseModel):
    year: int
    month: int
    items: list[RecurringBillStatusItem]
    # Totais agregados (todos tipos somados)
    total_estimado: float
    total_pago: float
    total_pendente: float
    # Totais separados por tipo (pra UI de previsão na Visão Geral)
    despesa_total_estimado: float = 0.0
    despesa_total_pago: float = 0.0
    despesa_total_pendente: float = 0.0
    receita_total_estimado: float = 0.0
    receita_total_recebido: float = 0.0
    receita_total_pendente: float = 0.0


# ─── Parcela esperada (recebimento de projeto) ─────────────────────────────

PARCELA_STATUS = {"pendente", "recebido", "atrasado", "cancelada"}
PAYMENT_TEMPLATES = {"a_vista", "50_50", "parcelado_3x", "parcelado_4x", "custom"}


class ParcelaOut(BaseModel):
    id: str
    projeto_id: str
    numero: int
    valor: float
    data_prevista: Optional[str] = None
    status: str = "pendente"
    observacao: Optional[str] = None
    # ID da transação que pagou essa parcela (FK reverso). Vem via JOIN
    # quando existe uma fin_transaction.parcela_id apontando aqui.
    transacao_recebimento_id: Optional[str] = None


class ParcelaCreate(BaseModel):
    valor: float
    data_prevista: Optional[str] = None
    observacao: Optional[str] = None


class ParcelaUpdate(BaseModel):
    valor: Optional[float] = None
    data_prevista: Optional[str] = None
    status: Optional[str] = None
    observacao: Optional[str] = None
    numero: Optional[int] = None

    @field_validator("status")
    @classmethod
    def _check_status(cls, v):
        if v is not None and v not in PARCELA_STATUS:
            raise ValueError(f"status deve ser um de {sorted(PARCELA_STATUS)}")
        return v


class ApplyTemplateBody(BaseModel):
    """Body do endpoint que gera N parcelas a partir de um template."""
    template: str
    # data_inicio opcional: usada pra preencher data_prevista da primeira
    # parcela em templates com cronograma (parcelado_Nx → +N meses).
    data_inicio: Optional[str] = None

    @field_validator("template")
    @classmethod
    def _check_template(cls, v):
        if v not in PAYMENT_TEMPLATES:
            raise ValueError(f"template deve ser um de {sorted(PAYMENT_TEMPLATES)}")
        return v


# ─── Cliente (PF/PJ que paga projetos freela) ──────────────────────────────

class ClientOut(BaseModel):
    id: str
    nome: str
    cpf_cnpj: Optional[str] = None
    notas: Optional[str] = None
    sort_order: int = 0


class ClientCreate(BaseModel):
    nome: str
    cpf_cnpj: Optional[str] = None
    notas: Optional[str] = None


class ClientUpdate(BaseModel):
    nome: Optional[str] = None
    cpf_cnpj: Optional[str] = None
    notas: Optional[str] = None
    sort_order: Optional[int] = None


# ─── Fatura de cartão de crédito ──────────────────────────────────────────

INVOICE_STATUS = {"aberta", "fechada", "paga", "atrasada"}


class InvoiceOut(BaseModel):
    id: str
    cartao_id: str
    mes_referencia: str          # YYYY-MM
    data_fechamento: Optional[str] = None
    data_vencimento: Optional[str] = None
    data_pagamento: Optional[str] = None
    status: str = "aberta"
    # Computados:
    total: float = 0.0           # soma absoluta das compras vinculadas
    transacoes_count: int = 0


class InvoiceCreate(BaseModel):
    cartao_id: str
    mes_referencia: str
    data_fechamento: Optional[str] = None
    data_vencimento: Optional[str] = None


class InvoiceUpdate(BaseModel):
    mes_referencia: Optional[str] = None
    data_fechamento: Optional[str] = None
    data_vencimento: Optional[str] = None
    status: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _check_status(cls, v):
        if v is not None and v not in INVOICE_STATUS:
            raise ValueError(f"status deve ser um de {sorted(INVOICE_STATUS)}")
        return v


class InvoicePayBody(BaseModel):
    """Body do endpoint que paga uma fatura: cria 2 transações de
    Transferência Interna (saída da conta corrente, entrada no cartão pra
    zerar o saldo) e marca a fatura como paga."""
    conta_pagamento_id: str   # CC de onde sai o dinheiro
    data_pagamento: str       # YYYY-MM-DD


class TransactionUpdate(BaseModel):
    data: Optional[str] = None
    valor: Optional[float] = None
    descricao: Optional[str] = None
    conta_id: Optional[str] = None
    categoria_id: Optional[str] = None
    notas: Optional[str] = None
    divida_id: Optional[str] = None
    parcela_id: Optional[str] = None
    fatura_id: Optional[str] = None
    pagamento_fatura_id: Optional[str] = None
    recurring_bill_id: Optional[str] = None
