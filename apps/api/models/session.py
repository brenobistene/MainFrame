"""Pydantic models para sessões — quest, task e active session global."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class SessionOut(BaseModel):
    """Sessão de uma quest (subtarefa)."""
    id: int
    quest_id: str
    session_num: int
    started_at: str
    ended_at: Optional[str]


class TaskSessionOut(BaseModel):
    id: int
    task_id: str
    session_num: int
    started_at: str
    ended_at: Optional[str]


class ActiveSessionOut(BaseModel):
    """Sessão ativa global — usada pelo banner flutuante do frontend."""
    type: str  # 'quest' | 'task' | 'routine'
    id: str
    title: str
    area_slug: Optional[str] = None
    started_at: str
    ended_at: Optional[str]
    is_active: bool
    # Breadcrumb pro banner quando a quest é subtarefa.
    parent_title: Optional[str] = None
    deliverable_title: Optional[str] = None
    # Back-compat: old UI might read quest_id
    quest_id: Optional[str] = None
    # Pra rotinas: data (YYYY-MM-DD) da sessão ativa. Usada pelo frontend
    # pra escopear bannerClosedSec ao dia certo (e não somar histórico todo)
    # e pra passar `target` correto em finalizações cross-midnight.
    routine_date: Optional[str] = None
