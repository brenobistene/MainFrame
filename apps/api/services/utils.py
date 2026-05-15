"""Helpers de data/hora e de quest duration compartilhados entre routers."""
from __future__ import annotations

from datetime import datetime, timezone


def parse_iso(dt: str) -> datetime:
    """Parse ISO datetime tolerating 'Z' suffix and missing timezone.
    Legacy rows may be naive; treat them as UTC so arithmetic mixes cleanly."""
    if dt.endswith("Z"):
        dt = dt[:-1] + "+00:00"
    result = datetime.fromisoformat(dt)
    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    return result


def utcnow_iso_z() -> str:
    """UTC agora em ISO com sufixo Z — padrão de armazenamento do app.

    Usa `datetime.now(timezone.utc)` em vez do antigo `datetime.utcnow()`
    (deprecated em 3.12+). O resultado é tz-aware, então fazemos `.replace(
    tzinfo=None)` antes de serializar pra preservar o formato sem offset
    `+00:00` no output — o `Z` final indica UTC. Mantém compat com rows
    legados parsados por parse_iso.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"


def calculate_quest_duration(conn, quest_id: str) -> int:
    """Soma total em minutos de todas as sessões fechadas de uma quest."""
    sessions = conn.execute(
        "SELECT started_at, ended_at FROM quest_sessions WHERE quest_id = ? ORDER BY session_num",
        (quest_id,),
    ).fetchall()
    total_seconds = 0
    for session in sessions:
        if session["started_at"] and session["ended_at"]:
            start = parse_iso(session["started_at"])
            end = parse_iso(session["ended_at"])
            total_seconds += int((end - start).total_seconds())
    return total_seconds // 60
