"""Pydantic models do Lang Lab (aquisição de idiomas).

Design: docs/lang-lab/PLAN.md. Convenções da casa: *Out/*Create/*Update,
PATCH parcial via model_fields_set no router.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

LangDirection = Literal["recognition", "production"]
LangAudioMode = Literal["tts", "upload", "none"]
LangSourceTipo = Literal["lesson", "video", "music", "article", "conversation", "other"]


# ─── Língua ──────────────────────────────────────────────────────────────


class LanguageOut(BaseModel):
    id: int
    code: str
    nome: str
    tts_voice: str
    ativo: bool
    criado_em: str


class LanguageCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=8)
    nome: str = Field(..., min_length=1)
    tts_voice: str = Field(..., min_length=1)


class LanguageUpdate(BaseModel):
    nome: Optional[str] = None
    tts_voice: Optional[str] = None
    ativo: Optional[bool] = None


# ─── Card ────────────────────────────────────────────────────────────────


class CardOut(BaseModel):
    id: int
    language_id: int
    source_id: Optional[int] = None
    frente: str
    verso: Optional[str] = None
    notas: Optional[str] = None
    direction: str
    audio_mode: str
    # URL relativa pronta pro <audio> (ex: /api/media/lang/cache/x.mp3).
    audio_url: Optional[str] = None
    origem_ai: bool
    suspenso: bool
    state: str
    due: str
    reps: int
    lapses: int
    last_review: Optional[str] = None
    criado_em: str


class CardCreate(BaseModel):
    frente: str = Field(..., min_length=1)
    verso: Optional[str] = None
    notas: Optional[str] = None
    direction: LangDirection = "recognition"
    language_id: Optional[int] = None  # default: idioma ativo das settings
    source_id: Optional[int] = None
    origem_ai: bool = False


class CardUpdate(BaseModel):
    frente: Optional[str] = None
    verso: Optional[str] = None
    notas: Optional[str] = None
    direction: Optional[LangDirection] = None
    suspenso: Optional[bool] = None


# ─── Review ──────────────────────────────────────────────────────────────


class ReviewIn(BaseModel):
    # 1=Again 2=Hard 3=Good 4=Easy (FSRS/Anki).
    rating: int = Field(..., ge=1, le=4)


class QueueOut(BaseModel):
    """Fila do momento (due é timestamp — learning steps voltam intraday)."""
    cards: list[CardOut]
    due_count: int
    new_count: int            # novos incluídos nesta fila (dentro da cota)
    new_quota_left: int       # quanto da cota diária de novos ainda resta
    reviews_done_today: int


# ─── Sessão (cluster nível módulo) ───────────────────────────────────────


class LangSessionRowOut(BaseModel):
    id: int
    session_num: int
    started_at: str
    ended_at: Optional[str] = None


class LangSessionClusterOut(BaseModel):
    has_active: bool
    is_running: bool
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    elapsed_seconds: int = 0
    rows: list[LangSessionRowOut] = []


class LangSessionEdit(BaseModel):
    started_at: Optional[str] = None
    ended_at: Optional[str] = None


# ─── Settings ────────────────────────────────────────────────────────────


class LangSettingsOut(BaseModel):
    idioma_ativo: Optional[int] = None
    new_cards_per_day: int
    max_reviews_per_day: Optional[int] = None
    daily_goal_min: int
    desired_retention: float
    mature_threshold_days: int
    day_cutoff_hour: int
    tts_enabled: bool
    audio_autoplay: bool
    auto_session_on_review: bool
    ai_provider: str
    ai_model: str
    ai_base_url: Optional[str] = None
    ausencia_threshold_dias: int
    exec_card_visivel: bool
    dashboard_card_visivel: bool
    sidebar_badge_visivel: bool
    # Agendamento estilo Anki (CSV de minutos pros steps).
    learning_steps_min: str
    relearning_steps_min: str
    maximum_interval_days: int
    enable_fuzzing: bool
    atualizado_em: str


class LangSettingsUpdate(BaseModel):
    idioma_ativo: Optional[int] = None
    new_cards_per_day: Optional[int] = Field(None, ge=0, le=200)
    max_reviews_per_day: Optional[int] = Field(None, ge=1, le=2000)
    daily_goal_min: Optional[int] = Field(None, ge=1, le=600)
    desired_retention: Optional[float] = Field(None, ge=0.7, le=0.99)
    mature_threshold_days: Optional[int] = Field(None, ge=7, le=365)
    day_cutoff_hour: Optional[int] = Field(None, ge=0, le=12)
    tts_enabled: Optional[bool] = None
    audio_autoplay: Optional[bool] = None
    auto_session_on_review: Optional[bool] = None
    ai_provider: Optional[Literal["gemini", "openai-compat", "none"]] = None
    ai_model: Optional[str] = None
    ai_base_url: Optional[str] = None
    ausencia_threshold_dias: Optional[int] = Field(None, ge=1, le=90)
    exec_card_visivel: Optional[bool] = None
    dashboard_card_visivel: Optional[bool] = None
    sidebar_badge_visivel: Optional[bool] = None
    learning_steps_min: Optional[str] = Field(None, pattern=r"^\d+(,\d+)*$")
    relearning_steps_min: Optional[str] = Field(None, pattern=r"^\d+(,\d+)*$")
    maximum_interval_days: Optional[int] = Field(None, ge=7, le=36500)
    enable_fuzzing: Optional[bool] = None


# ─── Today (Exec/Dashboard card + header da página) ──────────────────────


class TodayOut(BaseModel):
    """Fatos do dia — contagens e tempo. SEM fração de meta (anti-quota,
    PLAN §2 decisão 12). daily_goal vem junto só pra página /lang exibir
    como linha de referência."""
    language_id: Optional[int] = None
    due: int
    novos_disponiveis: int
    reviews_hoje: int
    tempo_hoje_min: int
    dias_sem_estudo: Optional[int] = None  # None = estudou hoje/dentro do threshold
    daily_goal_min: int


class VoiceOut(BaseModel):
    """Voz do catálogo edge-tts (sem lista hardcoded — vem da API)."""
    short_name: str
    locale: str
    gender: str
    friendly_name: Optional[str] = None


class TtsIn(BaseModel):
    texto: Optional[str] = None
    card_id: Optional[int] = None
    language_id: Optional[int] = None


class TtsOut(BaseModel):
    audio_url: str
    cached: bool


class UndoOut(BaseModel):
    card: CardOut
    undone_review_id: int


# ─── IA tutora (ask / pieces / assist) ───────────────────────────────────


class AiStatusOut(BaseModel):
    """UI usa pra mostrar/esconder superfícies de IA sem probing de 409."""
    configured: bool
    provider: str
    reason: Optional[str] = None


class AskIn(BaseModel):
    pergunta: str = Field(..., min_length=2)
    contexto: Optional[str] = None  # ex.: frente do card em estudo


class AskOut(BaseModel):
    id: int
    pergunta: str
    resposta: Optional[str] = None
    card_id: Optional[int] = None
    criado_em: str


class PieceCreate(BaseModel):
    texto: str = Field(..., min_length=1)
    prompt: Optional[str] = None


class PieceUpdate(BaseModel):
    texto: Optional[str] = None
    prompt: Optional[str] = None


class PieceOut(BaseModel):
    id: int
    language_id: int
    prompt: Optional[str] = None
    texto: str
    # feedback_json parseado (shape do lang_ai.piece_feedback) ou None.
    feedback: Optional[Any] = None
    criado_em: str


class AssistIn(BaseModel):
    rascunho: str = Field(..., min_length=1)
    intencao: Optional[str] = None


class AssistOut(BaseModel):
    sugestoes: str


class AnyDict(BaseModel):
    data: Any
