"""Pydantic models para o módulo /Build (Sistema de Metas).

Cobre as 4 entidades estratégico-texto do v0:
- Propósito (linha única)
- Princípios negativos (lista dentro do Propósito)
- Visão (versionada — uma ativa)
- Settings (linha única)

Demais entidades (Meta, Sprint, Guardrail, Ritual) entram em v0.5+.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


# ─── Propósito ────────────────────────────────────────────────────────────

class PurposeOut(BaseModel):
    texto: str
    criado_em: str
    revisado_em: str


class PurposeUpdate(BaseModel):
    texto: str = Field(..., max_length=2000)


# ─── Princípios negativos (anti-metas) ────────────────────────────────────

class PrincipleOut(BaseModel):
    id: int
    texto: str
    ordem: int
    arquivado: bool
    criado_em: str


class PrincipleCreate(BaseModel):
    texto: str = Field(..., min_length=1, max_length=500)
    ordem: Optional[int] = None


class PrincipleUpdate(BaseModel):
    texto: Optional[str] = Field(None, min_length=1, max_length=500)
    ordem: Optional[int] = None
    arquivado: Optional[bool] = None


# ─── Visão (3 anos, versionada) ───────────────────────────────────────────

class VisionOut(BaseModel):
    id: int
    texto: str
    data_alvo: Optional[str] = None
    ativa: bool
    criada_em: str
    arquivada_em: Optional[str] = None
    motivo_arquivamento: Optional[str] = None


class VisionVersion(BaseModel):
    """Cria nova Visão e arquiva a anterior. Operação atômica."""
    texto: str = Field(..., min_length=1, max_length=2000)
    data_alvo: Optional[str] = None  # YYYY-MM-DD
    motivo_arquivamento: Optional[str] = Field(None, max_length=1000)


class VisionUpdate(BaseModel):
    """Edita texto/data_alvo da Visão ativa SEM versionar — pra ajustes
    pequenos. Mudança grande deve usar /version (que arquiva e cria nova)."""
    texto: Optional[str] = Field(None, min_length=1, max_length=2000)
    data_alvo: Optional[str] = None


# ─── Settings (linha única) ───────────────────────────────────────────────

class SettingsOut(BaseModel):
    max_metas_ativas: int
    default_dependency_threshold_pct: int
    metric_data_age_threshold_days: int
    dashboard_card_visivel: bool
    atualizado_em: str


class SettingsUpdate(BaseModel):
    max_metas_ativas: Optional[int] = Field(None, ge=1, le=20)
    default_dependency_threshold_pct: Optional[int] = Field(None, ge=0, le=100)
    metric_data_age_threshold_days: Optional[int] = Field(None, ge=1, le=365)
    dashboard_card_visivel: Optional[bool] = None


# ─── Meta ─────────────────────────────────────────────────────────────────

# Áreas vinculadas vêm como sub-objetos pra economizar round-trips.
# is_primary obriga exatamente 1 por meta (validado no router).
class GoalAreaLink(BaseModel):
    area_slug: str
    is_primary: bool = False


class GoalProgressResolved(BaseModel):
    """Progresso resolvido da Meta numérica. Inclui qual fonte (manual ou
    Hub Health) e timestamp. None pra Meta booleana."""
    valor: Optional[float] = None
    fonte: str                                        # 'manual' | 'health' | 'sem_dados' | 'metrica_sumiu'
    ultima_atualizacao: Optional[str] = None
    detalhe: Optional[str] = None


class GoalOut(BaseModel):
    id: str
    titulo: str
    descricao: Optional[str] = None
    horizon: str                                     # 'anual' | 'trimestral'
    data_inicio: Optional[str] = None
    data_alvo: str
    status: str                                      # 'ativa' | 'concluida' | 'abandonada' | 'pausada'
    criterion_type: str                              # 'boolean' | 'numeric'
    criterion_target_value: Optional[float] = None
    criterion_current_value: Optional[float] = None  # v1: digitado manual; v2.1: ainda usado se metric_slug NULL
    criterion_metric_slug: Optional[str] = None
    criterion_metric_item_id: Optional[int] = None
    is_foundational: bool
    requires_threshold_pct: int
    criada_em: str
    atualizada_em: str
    concluida_em: Optional[str] = None
    abandonada_em: Optional[str] = None
    areas: list[GoalAreaLink]                         # vem populado no GET
    # v2.1: progresso resolvido (vem auto de Health se metric_slug setado)
    progress_resolved: Optional[GoalProgressResolved] = None


class GoalCreate(BaseModel):
    titulo: str = Field(..., min_length=1, max_length=200)
    descricao: Optional[str] = Field(None, max_length=2000)
    horizon: str = Field(..., pattern="^(anual|trimestral)$")
    data_inicio: Optional[str] = None                 # YYYY-MM-DD
    data_alvo: str                                    # YYYY-MM-DD obrigatório
    criterion_type: str = Field(..., pattern="^(boolean|numeric)$")
    criterion_target_value: Optional[float] = None
    # v2.1: opcional. Se setado pra Meta numérica, progresso vem de Health
    # (criterion_current_value digitado manual fica ignorado).
    criterion_metric_slug: Optional[str] = Field(None, max_length=200)
    criterion_metric_item_id: Optional[int] = None
    is_foundational: bool = False
    requires_threshold_pct: Optional[int] = Field(None, ge=0, le=100)
    areas: list[GoalAreaLink] = Field(..., min_length=1)


class GoalUpdate(BaseModel):
    titulo: Optional[str] = Field(None, min_length=1, max_length=200)
    descricao: Optional[str] = Field(None, max_length=2000)
    horizon: Optional[str] = Field(None, pattern="^(anual|trimestral)$")
    data_inicio: Optional[str] = None
    data_alvo: Optional[str] = None
    status: Optional[str] = Field(
        None, pattern="^(ativa|concluida|abandonada|pausada)$"
    )
    criterion_type: Optional[str] = Field(None, pattern="^(boolean|numeric)$")
    criterion_target_value: Optional[float] = None
    # v2.1: passar string vazia "" pra desvincular Meta de Health (volta pra manual).
    criterion_metric_slug: Optional[str] = Field(None, max_length=200)
    criterion_metric_item_id: Optional[int] = None
    is_foundational: Optional[bool] = None
    requires_threshold_pct: Optional[int] = Field(None, ge=0, le=100)


class GoalAreasUpdate(BaseModel):
    """Substitui a lista inteira de áreas da Meta. Operação atômica."""
    areas: list[GoalAreaLink] = Field(..., min_length=1)


# ─── Projeto ↔ Meta (alinhamento + drift) ─────────────────────────────────

# Estados possíveis derivados (alinhamento status):
# - 'aligned'     → tem >=1 goal vinculado
# - 'classified'  → 0 goals mas tem classification (manutenção/reativo/exploratório)
# - 'drift'       → 0 goals AND classification null (alerta!)


class ProjectAlignmentOut(BaseModel):
    """Snapshot do status de alinhamento de um Projeto pra UI da /Build.

    Inclui campos básicos do projeto (não tudo — só o necessário pra
    listagem/cards). Campo `goals` é populado com IDs das Metas vinculadas.
    """
    id: str
    title: str
    area_slug: str
    status: str                                          # status do projeto (não da Meta)
    archived_at: Optional[str] = None
    classification: Optional[str] = None                  # 'manutencao'|'reativo'|'exploratorio'|None
    classified_at: Optional[str] = None
    goal_ids: list[str]
    alignment_status: str                                 # 'aligned'|'classified'|'drift'


class LinkProjectGoalBody(BaseModel):
    goal_id: str = Field(..., min_length=1)


class ClassifyProjectBody(BaseModel):
    classification: Optional[str] = Field(
        None, pattern="^(manutencao|reativo|exploratorio)$"
    )


# ─── Sprint (sub-unidade de Meta longa) ───────────────────────────────────

class SprintOut(BaseModel):
    id: str
    goal_id: str
    numero: int
    data_inicio: str
    data_fim: str
    foco: Optional[str] = None
    status: str
    criado_em: str
    atualizado_em: str


class SprintCreate(BaseModel):
    goal_id: str = Field(..., min_length=1)
    numero: Optional[int] = None                       # auto se nulo (max+1)
    data_inicio: str                                    # YYYY-MM-DD
    data_fim: str                                       # YYYY-MM-DD
    foco: Optional[str] = Field(None, max_length=300)
    status: Optional[str] = Field(
        None, pattern="^(planejado|ativo|concluido|abandonado)$"
    )


class SprintUpdate(BaseModel):
    numero: Optional[int] = None
    data_inicio: Optional[str] = None
    data_fim: Optional[str] = None
    foco: Optional[str] = Field(None, max_length=300)
    status: Optional[str] = Field(
        None, pattern="^(planejado|ativo|concluido|abandonado)$"
    )


# ─── Dependência entre Metas ──────────────────────────────────────────────

class GoalDependencyOut(BaseModel):
    """Vínculo de dependência. Inclui infos da Meta required pra UI."""
    requires_goal_id: str
    requires_titulo: str
    requires_status: str
    is_satisfied: bool                                 # required tem status='concluida'?


class GoalDependencyCreate(BaseModel):
    requires_goal_id: str = Field(..., min_length=1)


# ─── Critério numérico — atualizar progresso manual ───────────────────────

class GoalProgressUpdate(BaseModel):
    """v1 (pré-Health): atualizar valor atual digitado manualmente.
    Em v2 isso vem automático do Hub Health via metric_slug."""
    criterion_current_value: float


# ─── Ritual ───────────────────────────────────────────────────────────────

class RitualOut(BaseModel):
    cadencia: str                                    # 'semanal'|'mensal'|'trimestral'|'anual'
    ativo: bool
    schedule_config: dict                             # JSON parseado
    direcionamento_pensar: str
    direcionamento_evitar: str
    duracao_alvo_min: int
    criado_em: str
    atualizado_em: str
    # Campos derivados (calculados no router):
    proxima_data: Optional[str] = None                # YYYY-MM-DD
    ultima_execucao: Optional[str] = None             # YYYY-MM-DD da última session
    dias_atraso: int = 0                              # >0 se proxima_data < today


class RitualUpdate(BaseModel):
    ativo: Optional[bool] = None
    schedule_config: Optional[dict] = None
    direcionamento_pensar: Optional[str] = Field(None, max_length=2000)
    direcionamento_evitar: Optional[str] = Field(None, max_length=2000)
    duracao_alvo_min: Optional[int] = Field(None, ge=1, le=600)


class RitualSessionOut(BaseModel):
    id: str
    cadencia: str
    data_executado: str
    duracao_min: Optional[int] = None
    notas: Optional[str] = None
    foco_proxima_periodo: Optional[str] = None
    criado_em: str


class RitualSessionCreate(BaseModel):
    """Registra execução de ritual. data_executado default = today."""
    data_executado: Optional[str] = None              # YYYY-MM-DD; default today
    duracao_min: Optional[int] = Field(None, ge=1)
    notas: Optional[str] = Field(None, max_length=10000)
    foco_proxima_periodo: Optional[str] = Field(None, max_length=2000)


class RitualScheduleItem(BaseModel):
    """Datas agendadas de uma cadência num intervalo de tempo. Usado pra
    renderizar marcadores no Calendar."""
    cadencia: str
    datas: list[str]                                   # ["YYYY-MM-DD", ...]


# ─── Guardrail (v2 — pontes Hub Health) ───────────────────────────────────

OPERADORES_VALIDOS = {">=", "<=", ">", "<", "==", "!="}


class GuardrailOut(BaseModel):
    id: int
    goal_id: str
    metric_slug: str
    item_id: Optional[int] = None
    operador: str
    valor_alvo: float
    descricao: Optional[str] = None
    ordem: int
    criado_em: str
    atualizado_em: str


class GuardrailCreate(BaseModel):
    metric_slug: str = Field(..., min_length=1, max_length=200)
    item_id: Optional[int] = None
    operador: str = Field(..., pattern=r"^(>=|<=|>|<|==|!=)$")
    valor_alvo: float
    descricao: Optional[str] = Field(None, max_length=500)
    ordem: Optional[int] = None


class GuardrailUpdate(BaseModel):
    metric_slug: Optional[str] = Field(None, min_length=1, max_length=200)
    item_id: Optional[int] = None
    operador: Optional[str] = Field(None, pattern=r"^(>=|<=|>|<|==|!=)$")
    valor_alvo: Optional[float] = None
    descricao: Optional[str] = Field(None, max_length=500)
    ordem: Optional[int] = None


class GuardrailEvaluation(BaseModel):
    """Snapshot do estado de um guardrail. Calculado on-the-fly chamando
    a Métrica de Hub Health correspondente."""
    id: int
    metric_slug: str
    item_id: Optional[int] = None
    operador: str
    valor_alvo: float
    descricao: Optional[str] = None
    estado: str                                         # OK | VIOLADO | ESPERANDO_DADOS | METRICA_NAO_ENCONTRADA
    valor_atual: Optional[float] = None
    unidade: Optional[str] = None
    ultima_atualizacao: Optional[str] = None
    detalhe: Optional[str] = None                       # mensagem human-readable opcional
