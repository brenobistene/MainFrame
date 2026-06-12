"""Agendamento SRS do Lang Lab via py-fsrs (>=6).

Mapeamento row SQLite <-> fsrs.Card. Pontos não-óbvios (PLAN §3.3/§4):
- py-fsrs NÃO tem estado "new": Card nasce em Learning. "Novo" pra fila
  do app = `last_review IS NULL`.
- `step` é obrigatório pra reconstruir o Card no meio dos learning steps;
  sem ele, relearning/learning resetaria a cada reload.
- `due` é timestamp (learning steps são intraday — card com Again volta
  na MESMA sessão).
- Snapshot pré-review fica no lang_review (undo restaura).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fsrs import Card, Rating, Scheduler, State

_STATE_TO_TEXT = {
    State.Learning: "learning",
    State.Review: "review",
    State.Relearning: "relearning",
}
_TEXT_TO_STATE = {v: k for k, v in _STATE_TO_TEXT.items()}


def _parse_iso(iso: str) -> datetime:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _card_from_row(row) -> Card:
    """Reconstrói o fsrs.Card a partir da row do lang_card. Card nunca
    revisado (last_review IS NULL) usa os defaults da lib — é o caminho
    correto pra um 'novo' entrar nos learning steps."""
    if row["last_review"] is None:
        return Card(card_id=row["id"])
    return Card(
        card_id=row["id"],
        state=_TEXT_TO_STATE.get(row["state"], State.Learning),
        step=row["step"],
        stability=row["stability"],
        difficulty=row["difficulty"],
        due=_parse_iso(row["due"]),
        last_review=_parse_iso(row["last_review"]),
    )


def _parse_steps(csv: Optional[str], fallback: tuple[int, ...]) -> tuple:
    """'1,10' → (timedelta(minutes=1), timedelta(minutes=10)). Valores
    inválidos caem no fallback — settings ruins não podem travar o review."""
    from datetime import timedelta

    try:
        mins = [int(x) for x in (csv or "").split(",") if x.strip()]
        if not mins:
            raise ValueError
        return tuple(timedelta(minutes=m) for m in mins)
    except ValueError:
        return tuple(timedelta(minutes=m) for m in fallback)


def scheduler_from_settings(settings: dict) -> Scheduler:
    """Monta o Scheduler com TODOS os parâmetros vindos de lang_settings —
    learning steps, retenção, intervalo máximo, fuzzing (estilo Anki,
    nada hardcoded)."""
    return Scheduler(
        desired_retention=float(settings.get("desired_retention") or 0.9),
        learning_steps=_parse_steps(settings.get("learning_steps_min"), (1, 10)),
        relearning_steps=_parse_steps(settings.get("relearning_steps_min"), (10,)),
        maximum_interval=int(settings.get("maximum_interval_days") or 36500),
        enable_fuzzing=bool(settings.get("enable_fuzzing", 1)),
    )


def review(
    row,
    rating: int,
    settings: dict,
    now: Optional[datetime] = None,
) -> dict:
    """Aplica um rating (1-4) e retorna os campos novos do card, prontos
    pro UPDATE. Não toca no banco — o router é dono da transação."""
    scheduler = scheduler_from_settings(settings)
    card = _card_from_row(row)
    when = now or datetime.now(timezone.utc)
    card, _log = scheduler.review_card(card, Rating(rating), review_datetime=when)
    return {
        "state": _STATE_TO_TEXT.get(card.state, "learning"),
        "step": card.step,
        "stability": card.stability,
        "difficulty": card.difficulty,
        "due": _to_iso(card.due),
        "last_review": _to_iso(when),
    }
