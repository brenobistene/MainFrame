"""Lang Lab — cards SRS com áudio, fila FSRS, sessões cluster e settings.

Design: docs/lang-lab/PLAN.md. F1 = fundação (cards + TTS + fila + player
+ sessão no banner). Sources/mineração = F2; IA (pieces/ask/analysis) = F3.

Sessão é nível-módulo no padrão cluster do Mind (dia_sessions.py), com
flag `finalizada` própria: pause fecha a row (banner PAUSED), stop seta
finalizada=1 no cluster (sai do banner).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile

from db import get_conn
from models.lang import (
    AiStatusOut,
    AnalysisOut,
    AskIn,
    AskOut,
    AssistIn,
    AssistOut,
    CardCreate,
    MineIn,
    MineOut,
    SourceCreate,
    SourceOut,
    SourceUpdate,
    CardOut,
    CardUpdate,
    LangSessionClusterOut,
    LangSessionEdit,
    LangSessionRowOut,
    LangSettingsOut,
    LangSettingsUpdate,
    LanguageCreate,
    LanguageOut,
    LanguageUpdate,
    PieceCreate,
    PieceOut,
    PieceUpdate,
    QueueOut,
    ReviewIn,
    TodayOut,
    TtsIn,
    TtsOut,
    UndoOut,
    VoiceOut,
)
from services import lang_ai, lang_srs, lang_tts
from services.lang_ai import LangAiError, LangAiNotConfigured
from services.active_session import find_active_session
from services.utils import utcnow_iso_z

router = APIRouter(tags=["lang"])


# ─── Helpers ─────────────────────────────────────────────────────────────


def _get_settings(conn) -> dict:
    row = conn.execute("SELECT * FROM lang_settings WHERE id = 1").fetchone()
    if not row:
        conn.execute("INSERT OR IGNORE INTO lang_settings(id) VALUES (1)")
        conn.commit()
        row = conn.execute("SELECT * FROM lang_settings WHERE id = 1").fetchone()
    return dict(row)


def _active_language_id(conn, settings: dict) -> Optional[int]:
    """idioma_ativo das settings, com fallback pra primeira língua ativa
    (seed garante o English — settings.idioma_ativo NULL no primeiro boot)."""
    if settings.get("idioma_ativo"):
        return settings["idioma_ativo"]
    row = conn.execute(
        "SELECT id FROM lang_language WHERE ativo = 1 ORDER BY id LIMIT 1"
    ).fetchone()
    return row["id"] if row else None


def _cutoff_hour(settings: dict) -> int:
    """day_cutoff_hour respeitando 0 (meia-noite é valor válido — `or 4`
    engolia o zero e virava hardcode disfarçado; QA 2026-06-12)."""
    v = settings.get("day_cutoff_hour")
    return int(v) if v is not None else 4


def _day_start_utc_iso(settings: dict) -> str:
    """Início do 'dia' corrente em UTC ISO. O dia vira em day_cutoff_hour
    LOCAL (default 4h) — usuário estuda à noite, ANALYZE/contadores às
    00h15 pertencem ao dia anterior (PLAN §3.8)."""
    cutoff = _cutoff_hour(settings)
    now_local = datetime.now().astimezone()
    day = now_local.date()
    if now_local.hour < cutoff:
        day = day - timedelta(days=1)
    start_local = datetime(day.year, day.month, day.day, cutoff, tzinfo=now_local.tzinfo)
    return start_local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_frente(frente: str) -> str:
    return " ".join(frente.lower().split())


def _card_out(row) -> dict:
    d = dict(row)
    audio_path = d.pop("audio_path", None)
    d["audio_url"] = f"/api/media/lang/{audio_path}" if audio_path else None
    d.pop("tts_hash", None)
    d.pop("atualizado_em", None)
    d.pop("step", None)
    d.pop("stability", None)
    d.pop("difficulty", None)
    d["origem_ai"] = bool(d.get("origem_ai"))
    d["suspenso"] = bool(d.get("suspenso"))
    return d


def _fetch_card(conn, card_id: int):
    row = conn.execute("SELECT * FROM lang_card WHERE id = ?", (card_id,)).fetchone()
    if not row:
        raise HTTPException(404, detail="card não encontrado")
    return row


def _language_voice(conn, language_id: int) -> str:
    row = conn.execute(
        "SELECT tts_voice FROM lang_language WHERE id = ?", (language_id,)
    ).fetchone()
    if not row:
        raise HTTPException(400, detail="língua não encontrada")
    return row["tts_voice"]


async def _tts_best_effort(conn, card_id: int, frente: str, voice: str) -> None:
    """Gera TTS pro card sem derrubar a request se o serviço falhar — card
    sem áudio toca via speechSynthesis no frontend (PLAN §5)."""
    try:
        rel, _cached = await lang_tts.ensure_tts(frente, voice)
        conn.execute(
            "UPDATE lang_card SET audio_path = ?, tts_hash = ? WHERE id = ?",
            (rel, lang_tts.tts_hash(frente, voice), card_id),
        )
        conn.commit()
    except Exception:
        pass


# ─── Línguas ─────────────────────────────────────────────────────────────


@router.get("/api/lang/languages", response_model=list[LanguageOut])
def list_languages():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM lang_language ORDER BY ativo DESC, id"
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/api/lang/languages", response_model=LanguageOut, status_code=201)
def create_language(body: LanguageCreate):
    with get_conn() as conn:
        dup = conn.execute(
            "SELECT 1 FROM lang_language WHERE code = ?", (body.code,)
        ).fetchone()
        if dup:
            raise HTTPException(409, detail=f"língua '{body.code}' já existe")
        cur = conn.execute(
            "INSERT INTO lang_language(code, nome, tts_voice) VALUES (?, ?, ?)",
            (body.code, body.nome, body.tts_voice),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM lang_language WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return dict(row)


@router.patch("/api/lang/languages/{language_id}", response_model=LanguageOut)
def update_language(language_id: int, body: LanguageUpdate):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, detail="nada pra atualizar")
    sets = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE lang_language SET {sets} WHERE id = ?",
            (*fields.values(), language_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="língua não encontrada")
        conn.commit()
        row = conn.execute(
            "SELECT * FROM lang_language WHERE id = ?", (language_id,)
        ).fetchone()
    return dict(row)


@router.get("/api/lang/tts/voices", response_model=list[VoiceOut])
async def list_tts_voices(locale: Optional[str] = Query(None)):
    """Catálogo de vozes direto do edge-tts (nada hardcoded). Falha do
    serviço → lista vazia (UI mostra aviso, settings continuam editáveis)."""
    try:
        return await lang_tts.list_voices(locale)
    except Exception:
        return []


# ─── Cards ───────────────────────────────────────────────────────────────


@router.get("/api/lang/cards", response_model=list[CardOut])
def list_cards(
    language_id: Optional[int] = Query(None),
    q: Optional[str] = Query(None),
    suspenso: Optional[bool] = Query(None),
    source_id: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    sql = "SELECT * FROM lang_card WHERE 1=1"
    params: list = []
    if language_id is not None:
        sql += " AND language_id = ?"
        params.append(language_id)
    if q:
        sql += " AND (frente LIKE ? OR verso LIKE ? OR notas LIKE ?)"
        like = f"%{q}%"
        params.extend([like, like, like])
    if suspenso is not None:
        sql += " AND suspenso = ?"
        params.append(1 if suspenso else 0)
    if source_id is not None:
        sql += " AND source_id = ?"
        params.append(source_id)
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_card_out(r) for r in rows]


@router.post("/api/lang/cards", response_model=CardOut, status_code=201)
async def create_card(body: CardCreate):
    frente = body.frente.strip()
    if not frente:
        raise HTTPException(400, detail="frente é obrigatória")
    with get_conn() as conn:
        settings = _get_settings(conn)
        language_id = body.language_id or _active_language_id(conn, settings)
        if not language_id:
            raise HTTPException(400, detail="nenhuma língua cadastrada")
        # Dup check por frente normalizada — re-colar a mesma frase avisa
        # em vez de duplicar silenciosamente (PLAN §3.3). Um SELECT só
        # (o N+1 por card degradava com o acervo; QA 2026-06-12).
        norm = _normalize_frente(frente)
        existentes = conn.execute(
            "SELECT frente FROM lang_card WHERE language_id = ?",
            (language_id,),
        ).fetchall()
        if any(_normalize_frente(r["frente"]) == norm for r in existentes):
            raise HTTPException(409, detail="card com essa frase já existe")
        now = utcnow_iso_z()
        tts_on = bool(settings.get("tts_enabled", 1))
        cur = conn.execute(
            """INSERT INTO lang_card
                 (language_id, source_id, frente, verso, notas, direction,
                  audio_mode, origem_ai, due)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                language_id,
                body.source_id,
                frente,
                body.verso,
                body.notas,
                body.direction,
                "tts" if tts_on else "none",
                1 if body.origem_ai else 0,
                now,
            ),
        )
        conn.commit()
        card_id = cur.lastrowid
        if tts_on:
            voice = _language_voice(conn, language_id)
            await _tts_best_effort(conn, card_id, frente, voice)
        row = _fetch_card(conn, card_id)
    return _card_out(row)


@router.patch("/api/lang/cards/{card_id}", response_model=CardOut)
async def update_card(card_id: int, body: CardUpdate):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, detail="nada pra atualizar")
    if "suspenso" in fields:
        fields["suspenso"] = 1 if fields["suspenso"] else 0
    with get_conn() as conn:
        row = _fetch_card(conn, card_id)
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE lang_card SET {sets}, atualizado_em = datetime('now') WHERE id = ?",
            (*fields.values(), card_id),
        )
        conn.commit()
        # frente mudou num card TTS → hash velho não vale. INVALIDA o áudio
        # ANTES da regeneração best-effort: se o TTS estiver fora do ar, o
        # card toca via speechSynthesis com o texto novo — nunca o MP3
        # antigo com a frase errada (QA 2026-06-12).
        new_frente = fields.get("frente")
        if new_frente and row["audio_mode"] == "tts":
            conn.execute(
                "UPDATE lang_card SET audio_path = NULL, tts_hash = NULL WHERE id = ?",
                (card_id,),
            )
            conn.commit()
            voice = _language_voice(conn, row["language_id"])
            await _tts_best_effort(conn, card_id, new_frente.strip(), voice)
        out = _fetch_card(conn, card_id)
    return _card_out(out)


@router.delete("/api/lang/cards/{card_id}", status_code=204)
def delete_card(card_id: int):
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM lang_card WHERE id = ?", (card_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, detail="card não encontrado")
        conn.commit()


# ─── TTS explícito ───────────────────────────────────────────────────────


@router.post("/api/lang/tts", response_model=TtsOut)
async def generate_tts(body: TtsIn):
    """Geração explícita (botão regenerar / pré-ouvir). Diferente do
    best-effort da criação, aqui falha vira 502 visível."""
    with get_conn() as conn:
        if body.card_id is not None:
            row = _fetch_card(conn, body.card_id)
            texto = row["frente"]
            voice = _language_voice(conn, row["language_id"])
        elif body.texto:
            settings = _get_settings(conn)
            language_id = body.language_id or _active_language_id(conn, settings)
            if not language_id:
                raise HTTPException(400, detail="nenhuma língua cadastrada")
            texto = body.texto
            voice = _language_voice(conn, language_id)
        else:
            raise HTTPException(422, detail="card_id ou texto obrigatório")
        try:
            rel, cached = await lang_tts.ensure_tts(texto, voice)
        except Exception as e:
            raise HTTPException(502, detail=f"TTS indisponível: {e}")
        if body.card_id is not None:
            conn.execute(
                "UPDATE lang_card SET audio_path = ?, tts_hash = ?, audio_mode = 'tts' WHERE id = ?",
                (rel, lang_tts.tts_hash(texto, voice), body.card_id),
            )
            conn.commit()
    return TtsOut(audio_url=f"/api/media/lang/{rel}", cached=cached)


# ─── Fila + review + undo ────────────────────────────────────────────────


@router.get("/api/lang/review/queue", response_model=QueueOut)
def review_queue(language_id: Optional[int] = Query(None)):
    with get_conn() as conn:
        settings = _get_settings(conn)
        lang_id = language_id or _active_language_id(conn, settings)
        if not lang_id:
            raise HTTPException(400, detail="nenhuma língua cadastrada")
        now = utcnow_iso_z()
        day_start = _day_start_utc_iso(settings)

        reviews_done_today = conn.execute(
            """SELECT COUNT(*) AS n FROM lang_review r
               JOIN lang_card c ON c.id = r.card_id
               WHERE c.language_id = ? AND r.reviewed_at >= ?""",
            (lang_id, day_start),
        ).fetchone()["n"]

        # Novos introduzidos hoje = cards cujo PRIMEIRO review aconteceu na
        # janela do dia (exato, sem coluna extra).
        introduced_today = conn.execute(
            """SELECT COUNT(*) AS n FROM lang_review r
               JOIN lang_card c ON c.id = r.card_id
               WHERE c.language_id = ? AND r.reviewed_at >= ?
                 AND r.id = (SELECT MIN(id) FROM lang_review WHERE card_id = r.card_id)""",
            (lang_id, day_start),
        ).fetchone()["n"]
        new_quota_left = max(0, int(settings["new_cards_per_day"]) - introduced_today)

        due_rows = conn.execute(
            """SELECT * FROM lang_card
               WHERE language_id = ? AND suspenso = 0
                 AND last_review IS NOT NULL AND due <= ?
               ORDER BY CASE state
                          WHEN 'relearning' THEN 0
                          WHEN 'learning' THEN 1
                          ELSE 2
                        END, due ASC
               LIMIT 200""",
            (lang_id, now),
        ).fetchall()

        # Cap de reviews/dia — semântica Anki (QA 2026-06-12): o teto vale
        # SÓ pros cards 'review'; learning/relearning SEMPRE entram (cortar
        # um card no meio dos steps o abandona meio-aprendido até amanhã).
        # Cap estourado também fecha a torneira de NOVOS (cada novo gera
        # mais reviews).
        max_rev = settings.get("max_reviews_per_day")
        if max_rev:
            allowed = max(0, int(max_rev) - reviews_done_today)
            learning_rows = [r for r in due_rows if r["state"] != "review"]
            review_rows = [r for r in due_rows if r["state"] == "review"]
            due_rows = learning_rows + review_rows[:allowed]
            if allowed == 0:
                new_quota_left = 0

        new_rows = []
        if new_quota_left > 0:
            new_rows = conn.execute(
                """SELECT * FROM lang_card
                   WHERE language_id = ? AND suspenso = 0 AND last_review IS NULL
                   ORDER BY id ASC LIMIT ?""",
                (lang_id, new_quota_left),
            ).fetchall()

        # Learn-ahead (QA 2026-06-12): fila vazia mas há card em learning
        # step a minutos de vencer → informa quando, pro player mostrar
        # countdown e re-buscar em vez de "FILA LIMPA" enganoso ("card com
        # Again volta na MESMA sessão", lang_srs.py).
        next_due_seconds = None
        if not due_rows and not new_rows:
            nxt = conn.execute(
                """SELECT MIN(due) AS d FROM lang_card
                   WHERE language_id = ? AND suspenso = 0
                     AND state IN ('learning', 'relearning')""",
                (lang_id,),
            ).fetchone()["d"]
            if nxt:
                try:
                    delta = (
                        datetime.fromisoformat(nxt.replace("Z", "+00:00"))
                        - datetime.now(timezone.utc)
                    ).total_seconds()
                    next_due_seconds = max(0, int(delta))
                except ValueError:
                    pass

    return QueueOut(
        cards=[_card_out(r) for r in due_rows] + [_card_out(r) for r in new_rows],
        due_count=len(due_rows),
        new_count=len(new_rows),
        new_quota_left=new_quota_left,
        reviews_done_today=reviews_done_today,
        next_due_seconds=next_due_seconds,
    )


@router.post("/api/lang/cards/{card_id}/review", response_model=CardOut)
def review_card(card_id: int, body: ReviewIn):
    with get_conn() as conn:
        settings = _get_settings(conn)
        row = _fetch_card(conn, card_id)
        if row["suspenso"]:
            raise HTTPException(409, detail="card suspenso")
        result = lang_srs.review(row, body.rating, settings)
        conn.execute(
            """INSERT INTO lang_review
                 (card_id, rating, reviewed_at, state_before, state_after,
                  due_before, stability_before, difficulty_before, step_before)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                card_id,
                body.rating,
                result["last_review"],
                row["state"],
                result["state"],
                row["due"],
                row["stability"],
                row["difficulty"],
                row["step"],
            ),
        )
        conn.execute(
            """UPDATE lang_card
               SET state = ?, step = ?, stability = ?, difficulty = ?, due = ?,
                   last_review = ?, reps = reps + 1,
                   lapses = lapses + ?, atualizado_em = datetime('now')
               WHERE id = ?""",
            (
                result["state"],
                result["step"],
                result["stability"],
                result["difficulty"],
                result["due"],
                result["last_review"],
                1 if body.rating == 1 else 0,
                card_id,
            ),
        )
        conn.commit()
        out = _fetch_card(conn, card_id)
    return _card_out(out)


@router.post("/api/lang/review/undo", response_model=UndoOut)
def undo_last_review():
    """Desfaz o último review RECENTE (tecla Z no player). Janela de 12h
    corridas em vez de "hoje": na virada do day_cutoff, um review de
    minutos atrás não pode virar 'nenhum review pra desfazer' (QA
    2026-06-12). Restaura o card pelo snapshot e apaga a row do log."""
    with get_conn() as conn:
        recent = (
            (datetime.now(timezone.utc) - timedelta(hours=12))
            .isoformat().replace("+00:00", "Z")
        )
        rev = conn.execute(
            "SELECT * FROM lang_review WHERE reviewed_at >= ? ORDER BY id DESC LIMIT 1",
            (recent,),
        ).fetchone()
        if not rev:
            raise HTTPException(404, detail="nenhum review recente pra desfazer")
        prev_review = conn.execute(
            "SELECT MAX(reviewed_at) AS t FROM lang_review WHERE card_id = ? AND id < ?",
            (rev["card_id"], rev["id"]),
        ).fetchone()["t"]
        conn.execute(
            """UPDATE lang_card
               SET state = COALESCE(?, 'learning'), step = ?, stability = ?,
                   difficulty = ?, due = ?, last_review = ?,
                   reps = MAX(0, reps - 1), lapses = MAX(0, lapses - ?),
                   atualizado_em = datetime('now')
               WHERE id = ?""",
            (
                rev["state_before"],
                rev["step_before"],
                rev["stability_before"],
                rev["difficulty_before"],
                rev["due_before"],
                prev_review,
                1 if rev["rating"] == 1 else 0,
                rev["card_id"],
            ),
        )
        conn.execute("DELETE FROM lang_review WHERE id = ?", (rev["id"],))
        conn.commit()
        card = _fetch_card(conn, rev["card_id"])
    return UndoOut(card=_card_out(card), undone_review_id=rev["id"])


# ─── Sessão (cluster nível módulo, padrão Mind + flag finalizada) ────────


def _fetch_lang_cluster_rows(conn) -> list:
    return conn.execute(
        "SELECT id, session_num, started_at, ended_at FROM lang_session "
        "WHERE finalizada = 0 ORDER BY session_num ASC"
    ).fetchall()


def _seconds_between(start_iso: str, end_iso: Optional[str]) -> int:
    try:
        s = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        e = (
            datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
            if end_iso
            else datetime.now(timezone.utc)
        )
        return max(0, int((e - s).total_seconds()))
    except (ValueError, AttributeError):
        return 0


def _build_lang_cluster(rows: list) -> LangSessionClusterOut:
    if not rows:
        return LangSessionClusterOut(has_active=False, is_running=False)
    is_running = any(r["ended_at"] is None for r in rows)
    ended_at = None
    if not is_running:
        ended_at = max(r["ended_at"] for r in rows if r["ended_at"])
    return LangSessionClusterOut(
        has_active=True,
        is_running=is_running,
        started_at=rows[0]["started_at"],
        ended_at=ended_at,
        elapsed_seconds=sum(
            _seconds_between(r["started_at"], r["ended_at"]) for r in rows
        ),
        rows=[
            LangSessionRowOut(
                id=r["id"],
                session_num=r["session_num"],
                started_at=r["started_at"],
                ended_at=r["ended_at"],
            )
            for r in rows
        ],
    )


@router.get("/api/lang/session", response_model=LangSessionClusterOut)
def get_lang_session():
    with get_conn() as conn:
        return _build_lang_cluster(_fetch_lang_cluster_rows(conn))


@router.get("/api/lang/sessions", response_model=list[LangSessionRowOut])
def list_lang_sessions():
    """Rows do cluster ativo — banner soma tempo fechado e o modal de
    histórico edita/deleta."""
    with get_conn() as conn:
        rows = _fetch_lang_cluster_rows(conn)
    return [
        LangSessionRowOut(
            id=r["id"],
            session_num=r["session_num"],
            started_at=r["started_at"],
            ended_at=r["ended_at"],
        )
        for r in rows
    ]


def _start_or_resume_lang_session(conn) -> LangSessionClusterOut:
    rows = _fetch_lang_cluster_rows(conn)
    if rows and any(r["ended_at"] is None for r in rows):
        return _build_lang_cluster(rows)
    active = find_active_session(conn, exclude_type="lang")
    if active:
        raise HTTPException(409, detail=active["title"])
    settings = _get_settings(conn)
    language_id = _active_language_id(conn, settings)
    next_num = conn.execute(
        "SELECT COALESCE(MAX(session_num), 0) + 1 AS n FROM lang_session "
        "WHERE finalizada = 0"
    ).fetchone()["n"]
    conn.execute(
        "INSERT INTO lang_session(language_id, session_num, started_at) VALUES (?, ?, ?)",
        (language_id, next_num, utcnow_iso_z()),
    )
    conn.commit()
    return _build_lang_cluster(_fetch_lang_cluster_rows(conn))


@router.post("/api/lang/session/start", response_model=LangSessionClusterOut, status_code=201)
def start_lang_session():
    with get_conn() as conn:
        return _start_or_resume_lang_session(conn)


@router.post("/api/lang/session/resume", response_model=LangSessionClusterOut, status_code=201)
def resume_lang_session():
    with get_conn() as conn:
        return _start_or_resume_lang_session(conn)


@router.post("/api/lang/session/pause", response_model=LangSessionClusterOut)
def pause_lang_session():
    with get_conn() as conn:
        open_row = conn.execute(
            "SELECT id FROM lang_session "
            "WHERE finalizada = 0 AND ended_at IS NULL ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if open_row:
            conn.execute(
                "UPDATE lang_session SET ended_at = ? WHERE id = ?",
                (utcnow_iso_z(), open_row["id"]),
            )
            conn.commit()
        return _build_lang_cluster(_fetch_lang_cluster_rows(conn))


@router.post("/api/lang/session/stop", response_model=LangSessionClusterOut)
def stop_lang_session():
    """Encerra o cluster: fecha row aberta + finalizada=1 em todas. É o
    que tira do banner (pause sozinho mostra PAUSED — PLAN §3.5)."""
    with get_conn() as conn:
        now = utcnow_iso_z()
        conn.execute(
            "UPDATE lang_session SET ended_at = ? "
            "WHERE finalizada = 0 AND ended_at IS NULL",
            (now,),
        )
        conn.execute("UPDATE lang_session SET finalizada = 1 WHERE finalizada = 0")
        conn.commit()
        return _build_lang_cluster(_fetch_lang_cluster_rows(conn))


@router.patch("/api/lang/sessions/{row_id}", response_model=LangSessionRowOut)
def edit_lang_session_row(row_id: int, body: LangSessionEdit):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, detail="nada pra atualizar")
    sets = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE lang_session SET {sets} WHERE id = ?",
            (*fields.values(), row_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="sessão não encontrada")
        conn.commit()
        row = conn.execute(
            "SELECT id, session_num, started_at, ended_at FROM lang_session WHERE id = ?",
            (row_id,),
        ).fetchone()
    return LangSessionRowOut(
        id=row["id"],
        session_num=row["session_num"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
    )


@router.delete("/api/lang/sessions/{row_id}", status_code=204)
def delete_lang_session_row(row_id: int):
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM lang_session WHERE id = ?", (row_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, detail="sessão não encontrada")
        conn.commit()


# ─── Settings ────────────────────────────────────────────────────────────


_SETTINGS_BOOL_FIELDS = {
    "tts_enabled",
    "audio_autoplay",
    "auto_session_on_review",
    "exec_card_visivel",
    "dashboard_card_visivel",
    "sidebar_badge_visivel",
    "enable_fuzzing",
}


def _settings_out(d: dict) -> dict:
    out = dict(d)
    out.pop("id", None)
    for k in _SETTINGS_BOOL_FIELDS:
        out[k] = bool(out.get(k))
    return out


@router.get("/api/lang/settings", response_model=LangSettingsOut)
def get_lang_settings():
    with get_conn() as conn:
        return _settings_out(_get_settings(conn))


@router.patch("/api/lang/settings", response_model=LangSettingsOut)
def update_lang_settings(body: LangSettingsUpdate):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, detail="nada pra atualizar")
    for k in list(fields.keys()):
        if k in _SETTINGS_BOOL_FIELDS:
            fields[k] = 1 if fields[k] else 0
    sets = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        _get_settings(conn)  # garante a row
        conn.execute(
            f"UPDATE lang_settings SET {sets}, atualizado_em = datetime('now') WHERE id = 1",
            tuple(fields.values()),
        )
        conn.commit()
        return _settings_out(_get_settings(conn))


# ─── Today (página /lang + Exec/Dashboard cards) ─────────────────────────


@router.get("/api/lang/today", response_model=TodayOut)
def lang_today(language_id: Optional[int] = Query(None)):
    with get_conn() as conn:
        settings = _get_settings(conn)
        lang_id = language_id or _active_language_id(conn, settings)
        now = utcnow_iso_z()
        day_start = _day_start_utc_iso(settings)
        if not lang_id:
            return TodayOut(
                language_id=None, due=0, novos_disponiveis=0, reviews_hoje=0,
                tempo_hoje_min=0, dias_sem_estudo=None,
                daily_goal_min=int(settings["daily_goal_min"]),
            )
        due = conn.execute(
            "SELECT COUNT(*) AS n FROM lang_card "
            "WHERE language_id = ? AND suspenso = 0 "
            "AND last_review IS NOT NULL AND due <= ?",
            (lang_id, now),
        ).fetchone()["n"]
        introduced_today = conn.execute(
            """SELECT COUNT(*) AS n FROM lang_review r
               JOIN lang_card c ON c.id = r.card_id
               WHERE c.language_id = ? AND r.reviewed_at >= ?
                 AND r.id = (SELECT MIN(id) FROM lang_review WHERE card_id = r.card_id)""",
            (lang_id, day_start),
        ).fetchone()["n"]
        new_quota_left = max(0, int(settings["new_cards_per_day"]) - introduced_today)
        new_available = conn.execute(
            "SELECT COUNT(*) AS n FROM lang_card "
            "WHERE language_id = ? AND suspenso = 0 AND last_review IS NULL",
            (lang_id,),
        ).fetchone()["n"]
        reviews_hoje = conn.execute(
            """SELECT COUNT(*) AS n FROM lang_review r
               JOIN lang_card c ON c.id = r.card_id
               WHERE c.language_id = ? AND r.reviewed_at >= ?""",
            (lang_id, day_start),
        ).fetchone()["n"]
        tempo_rows = conn.execute(
            "SELECT started_at, ended_at FROM lang_session WHERE started_at >= ?",
            (day_start,),
        ).fetchall()
        tempo_seg = sum(
            _seconds_between(r["started_at"], r["ended_at"]) for r in tempo_rows
        )
        # Ausência factual (PLAN §8): dias desde a última sessão, só quando
        # passa do threshold. Nunca estudou = None (sem cobrar recém-chegado).
        last = conn.execute(
            "SELECT MAX(started_at) AS t FROM lang_session"
        ).fetchone()["t"]
        dias_sem = None
        if last:
            try:
                last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
                days = (datetime.now(timezone.utc) - last_dt).days
                if days >= int(settings["ausencia_threshold_dias"]):
                    dias_sem = days
            except ValueError:
                pass
    return TodayOut(
        language_id=lang_id,
        due=due,
        novos_disponiveis=min(new_quota_left, new_available),
        reviews_hoje=reviews_hoje,
        tempo_hoje_min=tempo_seg // 60,
        dias_sem_estudo=dias_sem,
        daily_goal_min=int(settings["daily_goal_min"]),
    )


# ─── Calendário — range de sessões executadas (padrão dia_sessions) ─────


@router.get("/api/lang-sessions")
def list_lang_sessions_range(
    from_: str = Query("", alias="from"),
    to: str = Query(""),
):
    """Rows de lang_session com started_at no range [from, to] — o
    Calendário renderiza como blocos executados. Inclui sessões
    FINALIZADAS (histórico) e as do cluster ativo."""
    with get_conn() as conn:
        if from_ and to:
            rows = conn.execute(
                """SELECT id, session_num, started_at, ended_at
                   FROM lang_session
                   WHERE substr(started_at, 1, 10) >= ?
                     AND substr(started_at, 1, 10) <= ?
                   ORDER BY started_at ASC""",
                (from_, to),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, session_num, started_at, ended_at "
                "FROM lang_session ORDER BY started_at DESC LIMIT 100"
            ).fetchall()
    return [dict(r) for r in rows]


# ─── Métricas do dashboard (MAIN) — on-the-fly, estilo Health ───────────


@router.get("/api/lang/metrics/summary")
def metrics_summary(language_id: Optional[int] = Query(None)):
    """Resumo pro dashboard: vitals 30d + heatmap + acervo. Retenção é
    honesta no paradigma FSRS: só Again (1) é lapso — Hard é acerto."""
    with get_conn() as conn:
        settings = _get_settings(conn)
        lang_id = language_id or _active_language_id(conn, settings)
        if not lang_id:
            return {
                "tempo_30d_min": 0, "sessoes_30d": 0, "reviews_30d": 0,
                "retencao_30d": None, "hard_rate_30d": None, "streak_dias": 0,
                "cards_total": 0, "cards_maduros": 0, "pieces_30d": 0,
                "heatmap": [],
            }
        cutoff_30d = (
            (datetime.now(timezone.utc) - timedelta(days=30))
            .isoformat().replace("+00:00", "Z")
        )
        sess_rows = conn.execute(
            "SELECT started_at, ended_at FROM lang_session WHERE started_at >= ?",
            (cutoff_30d,),
        ).fetchall()
        tempo_min = sum(
            _seconds_between(r["started_at"], r["ended_at"]) for r in sess_rows
        ) // 60
        rev = conn.execute(
            """SELECT COUNT(*) AS total,
                      SUM(CASE WHEN r.rating > 1 THEN 1 ELSE 0 END) AS acertos,
                      SUM(CASE WHEN r.rating = 2 THEN 1 ELSE 0 END) AS hards
               FROM lang_review r JOIN lang_card c ON c.id = r.card_id
               WHERE c.language_id = ? AND r.reviewed_at >= ?""",
            (lang_id, cutoff_30d),
        ).fetchone()
        reviews_30d = rev["total"] or 0
        retencao = (rev["acertos"] / reviews_30d) if reviews_30d else None
        hard_rate = (rev["hards"] / reviews_30d) if reviews_30d else None
        cards_total = conn.execute(
            "SELECT COUNT(*) AS n FROM lang_card WHERE language_id = ?",
            (lang_id,),
        ).fetchone()["n"]
        cards_maduros = conn.execute(
            "SELECT COUNT(*) AS n FROM lang_card "
            "WHERE language_id = ? AND state = 'review' AND stability > ?",
            (lang_id, int(settings["mature_threshold_days"])),
        ).fetchone()["n"]
        pieces_30d = conn.execute(
            "SELECT COUNT(*) AS n FROM lang_piece "
            "WHERE language_id = ? AND criado_em >= ?",
            (lang_id, cutoff_30d[:10]),
        ).fetchone()["n"]
        # Heatmap 30d — reviews + pieces por dia (UTC date; shape do Mind).
        heat_rev = dict(conn.execute(
            """SELECT substr(r.reviewed_at, 1, 10) AS d, COUNT(*) AS n
               FROM lang_review r JOIN lang_card c ON c.id = r.card_id
               WHERE c.language_id = ? AND r.reviewed_at >= ?
               GROUP BY d""",
            (lang_id, cutoff_30d),
        ).fetchall())
        heat_pieces = dict(conn.execute(
            """SELECT substr(criado_em, 1, 10) AS d, COUNT(*) AS n
               FROM lang_piece WHERE language_id = ? AND criado_em >= ?
               GROUP BY d""",
            (lang_id, cutoff_30d[:10]),
        ).fetchall())
        today = datetime.now(timezone.utc).date()
        heatmap = []
        for i in range(29, -1, -1):
            d = (today - timedelta(days=i)).isoformat()
            heatmap.append({
                "date": d,
                "reviews": heat_rev.get(d, 0),
                "pieces": heat_pieces.get(d, 0),
            })
        # Streak honesto (padrão calcStreak do Mind): dias consecutivos com
        # atividade (review OU sessão), com graça hoje/ontem.
        active_days = {
            r["d"] for r in conn.execute(
                """SELECT DISTINCT substr(r.reviewed_at, 1, 10) AS d
                   FROM lang_review r JOIN lang_card c ON c.id = r.card_id
                   WHERE c.language_id = ?""",
                (lang_id,),
            ).fetchall()
        } | {
            r["d"] for r in conn.execute(
                "SELECT DISTINCT substr(started_at, 1, 10) AS d FROM lang_session"
            ).fetchall()
        }
        streak = 0
        cursor = today
        if cursor.isoformat() not in active_days:
            cursor = cursor - timedelta(days=1)  # graça: hoje ainda não estudou
        while cursor.isoformat() in active_days:
            streak += 1
            cursor = cursor - timedelta(days=1)
    return {
        "tempo_30d_min": tempo_min,
        "sessoes_30d": len(sess_rows),
        "reviews_30d": reviews_30d,
        "retencao_30d": retencao,
        "hard_rate_30d": hard_rate,
        "streak_dias": streak,
        "cards_total": cards_total,
        "cards_maduros": cards_maduros,
        "pieces_30d": pieces_30d,
        "heatmap": heatmap,
    }


# ─── IA tutora — ask / pieces / assist (PLAN §6) ─────────────────────────
# Degradação graciosa: sem provider/chave → /ai/status diz 'não configurada'
# e a UI esconde as superfícies; chamadas diretas tomam 409. Falha do
# provedor (rate limit etc) → 502 SEM perder conteúdo (texto já salvo).


def _current_session_row_id(conn) -> Optional[int]:
    row = conn.execute(
        "SELECT id FROM lang_session WHERE finalizada = 0 ORDER BY id DESC LIMIT 1"
    ).fetchone()
    return row["id"] if row else None


@router.get("/api/lang/ai/status", response_model=AiStatusOut)
def ai_status():
    with get_conn() as conn:
        settings = _get_settings(conn)
    try:
        cfg = lang_ai.get_config(settings)
        return AiStatusOut(configured=True, provider=cfg["provider"])
    except LangAiNotConfigured as e:
        return AiStatusOut(
            configured=False,
            provider=settings.get("ai_provider") or "none",
            reason=str(e),
        )


@router.post("/api/lang/ask", response_model=AskOut, status_code=201)
async def ask_ai(body: AskIn):
    """Dúvida pontual com explicação do porquê. Salva só em sucesso —
    pergunta sem resposta não vira lixo no histórico."""
    with get_conn() as conn:
        settings = _get_settings(conn)
        language_id = _active_language_id(conn, settings)
        if not language_id:
            raise HTTPException(400, detail="nenhuma língua cadastrada")
    try:
        resposta = await lang_ai.ask(settings, body.pergunta, body.contexto)
    except LangAiNotConfigured as e:
        raise HTTPException(409, detail=f"IA não configurada: {e}")
    except LangAiError as e:
        raise HTTPException(502, detail=str(e))
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO lang_ask(language_id, pergunta, resposta) VALUES (?, ?, ?)",
            (language_id, body.pergunta, resposta),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, pergunta, resposta, card_id, criado_em FROM lang_ask WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
    return dict(row)


@router.get("/api/lang/asks", response_model=list[AskOut])
def list_asks(limit: int = Query(20, ge=1, le=100)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, pergunta, resposta, card_id, criado_em FROM lang_ask "
            "ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def _piece_out(row) -> dict:
    d = dict(row)
    raw = d.pop("feedback_json", None)
    d.pop("session_id", None)
    d.pop("atualizado_em", None)
    if raw:
        try:
            d["feedback"] = json.loads(raw)
        except ValueError:
            d["feedback"] = {"observacao_registro": raw}
    else:
        d["feedback"] = None
    return d


@router.post("/api/lang/pieces", response_model=PieceOut, status_code=201)
def create_piece(body: PieceCreate):
    """Salva a produção ANTES de qualquer IA — falha de feedback nunca
    perde texto (caso de teste 11)."""
    with get_conn() as conn:
        settings = _get_settings(conn)
        language_id = _active_language_id(conn, settings)
        if not language_id:
            raise HTTPException(400, detail="nenhuma língua cadastrada")
        cur = conn.execute(
            "INSERT INTO lang_piece(language_id, session_id, prompt, texto) "
            "VALUES (?, ?, ?, ?)",
            (language_id, _current_session_row_id(conn), body.prompt, body.texto),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM lang_piece WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return _piece_out(row)


@router.get("/api/lang/pieces", response_model=list[PieceOut])
def list_pieces(limit: int = Query(20, ge=1, le=100)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM lang_piece ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_piece_out(r) for r in rows]


@router.patch("/api/lang/pieces/{piece_id}", response_model=PieceOut)
def update_piece(piece_id: int, body: PieceUpdate):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, detail="nada pra atualizar")
    sets = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE lang_piece SET {sets}, atualizado_em = datetime('now') WHERE id = ?",
            (*fields.values(), piece_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="piece não encontrada")
        conn.commit()
        row = conn.execute(
            "SELECT * FROM lang_piece WHERE id = ?", (piece_id,)
        ).fetchone()
    return _piece_out(row)


@router.delete("/api/lang/pieces/{piece_id}", status_code=204)
def delete_piece(piece_id: int):
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM lang_piece WHERE id = ?", (piece_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, detail="piece não encontrada")
        conn.commit()


@router.post("/api/lang/pieces/{piece_id}/feedback", response_model=PieceOut)
async def piece_feedback(piece_id: int):
    """Correção com porquê (tags de erro reutilizáveis pra análise futura)."""
    with get_conn() as conn:
        settings = _get_settings(conn)
        row = conn.execute(
            "SELECT * FROM lang_piece WHERE id = ?", (piece_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="piece não encontrada")
    try:
        fb = await lang_ai.piece_feedback(settings, row["texto"], row["prompt"])
    except LangAiNotConfigured as e:
        raise HTTPException(409, detail=f"IA não configurada: {e}")
    except LangAiError as e:
        raise HTTPException(502, detail=str(e))
    with get_conn() as conn:
        conn.execute(
            "UPDATE lang_piece SET feedback_json = ?, atualizado_em = datetime('now') "
            "WHERE id = ?",
            (json.dumps(fb, ensure_ascii=False), piece_id),
        )
        conn.commit()
        out = conn.execute(
            "SELECT * FROM lang_piece WHERE id = ?", (piece_id,)
        ).fetchone()
    return _piece_out(out)


@router.post("/api/lang/compose/assist", response_model=AssistOut)
async def compose_assist(body: AssistIn):
    """Destrava DURANTE a escrita — sugere conectores/estrutura sem
    escrever pelo aluno. Não persiste (é andaime, não obra)."""
    with get_conn() as conn:
        settings = _get_settings(conn)
    try:
        sugestoes = await lang_ai.compose_assist(settings, body.rascunho, body.intencao)
    except LangAiNotConfigured as e:
        raise HTTPException(409, detail=f"IA não configurada: {e}")
    except LangAiError as e:
        raise HTTPException(502, detail=str(e))
    return AssistOut(sugestoes=sugestoes)


# ─── Análise diária — "julgar meu progresso" com comparação temporal ─────


def _current_day_label(settings: dict) -> str:
    """Data 'do dia' respeitando day_cutoff_hour local (PLAN §3.8)."""
    cutoff = _cutoff_hour(settings)
    now_local = datetime.now().astimezone()
    day = now_local.date()
    if now_local.hour < cutoff:
        day = day - timedelta(days=1)
    return day.isoformat()


def _window_stats(conn, lang_id: int, since_iso: str) -> dict:
    rev = conn.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN r.rating > 1 THEN 1 ELSE 0 END) AS acertos
           FROM lang_review r JOIN lang_card c ON c.id = r.card_id
           WHERE c.language_id = ? AND r.reviewed_at >= ?""",
        (lang_id, since_iso),
    ).fetchone()
    total = rev["total"] or 0
    # Tags de erro dos feedbacks de produção na janela.
    tags: dict[str, int] = {}
    for row in conn.execute(
        "SELECT feedback_json FROM lang_piece "
        "WHERE language_id = ? AND criado_em >= ? AND feedback_json IS NOT NULL",
        (lang_id, since_iso[:10]),
    ).fetchall():
        try:
            for e in json.loads(row["feedback_json"]).get("erros", []):
                t = e.get("tag")
                if t:
                    tags[t] = tags.get(t, 0) + 1
        except ValueError:
            continue
    return {
        "reviews": total,
        "retencao": round(rev["acertos"] / total, 2) if total else None,
        "tags_de_erro": dict(sorted(tags.items(), key=lambda x: -x[1])[:6]),
    }


def _analysis_out(row) -> dict:
    d = dict(row)
    raw = d.pop("resumo_json", None)
    d.pop("language_id", None)
    try:
        d["analise"] = json.loads(raw) if raw else None
    except ValueError:
        d["analise"] = {"resumo": raw}
    return d


@router.post("/api/lang/analysis/today", response_model=AnalysisOut)
async def analyze_today():
    """Roda a análise do dia (sob demanda, nunca automática). UPSERT por
    (língua, dia) — rodar de novo substitui, não duplica."""
    with get_conn() as conn:
        settings = _get_settings(conn)
        lang_id = _active_language_id(conn, settings)
        if not lang_id:
            raise HTTPException(400, detail="nenhuma língua cadastrada")
        day_start = _day_start_utc_iso(settings)
        day_label = _current_day_label(settings)
        cutoff_7d = (
            (datetime.now(timezone.utc) - timedelta(days=7))
            .isoformat().replace("+00:00", "Z")
        )
        cutoff_30d = (
            (datetime.now(timezone.utc) - timedelta(days=30))
            .isoformat().replace("+00:00", "Z")
        )
        pieces_hoje = [
            {"prompt": r["prompt"], "texto": r["texto"][:600]}
            for r in conn.execute(
                "SELECT prompt, texto FROM lang_piece "
                "WHERE language_id = ? AND criado_em >= ? ORDER BY id DESC LIMIT 5",
                (lang_id, day_start[:10]),
            ).fetchall()
        ]
        # Guard de tipo: análise antiga com JSON não-objeto (modelo fugiu
        # do shape) não pode quebrar TODAS as análises futuras com 500
        # permanente (QA 2026-06-12).
        anteriores = []
        for r in conn.execute(
            "SELECT * FROM lang_analysis WHERE language_id = ? "
            "ORDER BY date DESC LIMIT 3",
            (lang_id,),
        ).fetchall():
            a = _analysis_out(r)["analise"]
            if isinstance(a, dict):
                anteriores.append(str(a.get("resumo", "")))
        contexto = {
            "hoje": _window_stats(conn, lang_id, day_start),
            "ultimos_7d": _window_stats(conn, lang_id, cutoff_7d),
            "ultimos_30d": _window_stats(conn, lang_id, cutoff_30d),
            "producoes_de_hoje": pieces_hoje,
            "resumos_de_analises_anteriores": anteriores,
        }
    try:
        analise = await lang_ai.daily_analysis(settings, contexto)
    except LangAiNotConfigured as e:
        raise HTTPException(409, detail=f"IA não configurada: {e}")
    except LangAiError as e:
        raise HTTPException(502, detail=str(e))
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO lang_analysis(language_id, date, resumo_json)
               VALUES (?, ?, ?)
               ON CONFLICT(language_id, date)
               DO UPDATE SET resumo_json = excluded.resumo_json""",
            (lang_id, day_label, json.dumps(analise, ensure_ascii=False)),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM lang_analysis WHERE language_id = ? AND date = ?",
            (lang_id, day_label),
        ).fetchone()
    return _analysis_out(row)


@router.get("/api/lang/analyses", response_model=list[AnalysisOut])
def list_analyses(limit: int = Query(10, ge=1, le=60)):
    with get_conn() as conn:
        settings = _get_settings(conn)
        lang_id = _active_language_id(conn, settings)
        rows = conn.execute(
            "SELECT * FROM lang_analysis WHERE language_id = ? "
            "ORDER BY date DESC LIMIT ?",
            (lang_id, limit),
        ).fetchall() if lang_id else []
    return [_analysis_out(r) for r in rows]


# ─── Fontes — corpus de mineração (método Vergara, PLAN §3.2) ────────────


_AUDIO_EXTS = {".mp3", ".m4a", ".wav", ".ogg", ".webm"}


def _source_out(conn, row) -> dict:
    d = dict(row)
    audio_path = d.pop("audio_path", None)
    d["audio_url"] = f"/api/media/lang/{audio_path}" if audio_path else None
    d.pop("notas_json", None)
    d.pop("atualizado_em", None)
    d["cards_count"] = conn.execute(
        "SELECT COUNT(*) AS n FROM lang_card WHERE source_id = ?", (d["id"],)
    ).fetchone()["n"]
    return d


@router.get("/api/lang/sources", response_model=list[SourceOut])
def list_sources(language_id: Optional[int] = Query(None)):
    with get_conn() as conn:
        settings = _get_settings(conn)
        lang_id = language_id or _active_language_id(conn, settings)
        rows = conn.execute(
            "SELECT * FROM lang_source WHERE language_id = ? ORDER BY id DESC",
            (lang_id,),
        ).fetchall() if lang_id else []
        return [_source_out(conn, r) for r in rows]


@router.post("/api/lang/sources", response_model=SourceOut, status_code=201)
def create_source(body: SourceCreate):
    with get_conn() as conn:
        settings = _get_settings(conn)
        language_id = body.language_id or _active_language_id(conn, settings)
        if not language_id:
            raise HTTPException(400, detail="nenhuma língua cadastrada")
        cur = conn.execute(
            "INSERT INTO lang_source(language_id, tipo, titulo, origem, texto) "
            "VALUES (?, ?, ?, ?, ?)",
            (language_id, body.tipo, body.titulo.strip(), body.origem, body.texto),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM lang_source WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return _source_out(conn, row)


@router.patch("/api/lang/sources/{source_id}", response_model=SourceOut)
def update_source(source_id: int, body: SourceUpdate):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, detail="nada pra atualizar")
    sets = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE lang_source SET {sets}, atualizado_em = datetime('now') WHERE id = ?",
            (*fields.values(), source_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="fonte não encontrada")
        conn.commit()
        row = conn.execute(
            "SELECT * FROM lang_source WHERE id = ?", (source_id,)
        ).fetchone()
        return _source_out(conn, row)


@router.delete("/api/lang/sources/{source_id}", status_code=204)
def delete_source(source_id: int):
    """Cards minerados sobrevivem (source_id vira NULL — ON DELETE SET NULL)."""
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM lang_source WHERE id = ?", (source_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, detail="fonte não encontrada")
        conn.commit()


@router.post("/api/lang/sources/{source_id}/audio", response_model=SourceOut)
async def upload_source_audio(source_id: int, file: UploadFile = File(...)):
    """Áudio da fonte inteira (a lição do Vergara, o podcast). Vive em
    media/lang/sources/ — fora do git; backup manual (PLAN §13.3)."""
    import os

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _AUDIO_EXTS:
        raise HTTPException(422, detail=f"extensão não suportada ({ext})")
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM lang_source WHERE id = ?", (source_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="fonte não encontrada")
    lang_tts.ensure_dirs()
    filename = f"source_{source_id}{ext}"
    raw = await file.read()
    # Limite de tamanho + escrita atômica (tmp → replace): upload
    # interrompido não pode deixar arquivo corrompido servível (QA).
    if len(raw) > 100 * 1024 * 1024:
        raise HTTPException(413, detail="áudio acima de 100MB")
    dest = lang_tts.media_path("sources", filename)
    tmp = dest + ".part"
    with open(tmp, "wb") as f:
        f.write(raw)
    import os as _os
    _os.replace(tmp, dest)
    with get_conn() as conn:
        conn.execute(
            "UPDATE lang_source SET audio_path = ?, atualizado_em = datetime('now') "
            "WHERE id = ?",
            (f"sources/{filename}", source_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM lang_source WHERE id = ?", (source_id,)
        ).fetchone()
        return _source_out(conn, row)


async def _bg_tts_for_card(card_id: int, frente: str, voice: str) -> None:
    """TTS pós-resposta (BackgroundTasks) — mineração não trava a request
    e falha numa frase não derruba as outras (PLAN §5)."""
    try:
        rel, _ = await lang_tts.ensure_tts(frente, voice)
        with get_conn() as conn:
            conn.execute(
                "UPDATE lang_card SET audio_path = ?, tts_hash = ? WHERE id = ?",
                (rel, lang_tts.tts_hash(frente, voice), card_id),
            )
            conn.commit()
    except Exception:
        pass  # card fica sem arquivo; player cobre com speechSynthesis


@router.post("/api/lang/sources/{source_id}/mine", response_model=MineOut)
async def mine_source(source_id: int, body: MineIn, background: BackgroundTasks):
    """Mineração em lote: frases selecionadas → cards. Dup check por frase
    normalizada (re-minerar não duplica — caso de teste 1). Cards nascem
    JÁ na resposta; os MP3s chegam em background."""
    with get_conn() as conn:
        settings = _get_settings(conn)
        src = conn.execute(
            "SELECT * FROM lang_source WHERE id = ?", (source_id,)
        ).fetchone()
        if not src:
            raise HTTPException(404, detail="fonte não encontrada")
        language_id = src["language_id"]
        voice = _language_voice(conn, language_id)
        tts_on = bool(settings.get("tts_enabled", 1))
        existentes = {
            _normalize_frente(r["frente"])
            for r in conn.execute(
                "SELECT frente FROM lang_card WHERE language_id = ?",
                (language_id,),
            ).fetchall()
        }
        now = utcnow_iso_z()
        criados: list[tuple[int, str]] = []
        duplicados = 0
        for raw_line in body.lines:
            frente = raw_line.strip()
            if not frente:
                continue
            norm = _normalize_frente(frente)
            if norm in existentes:
                duplicados += 1
                continue
            existentes.add(norm)
            cur = conn.execute(
                """INSERT INTO lang_card
                     (language_id, source_id, frente, direction, audio_mode, due)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (language_id, source_id, frente, body.direction,
                 "tts" if tts_on else "none", now),
            )
            criados.append((cur.lastrowid, frente))
        conn.commit()
    if tts_on:
        for card_id, frente in criados:
            background.add_task(_bg_tts_for_card, card_id, frente, voice)
    return MineOut(
        criados=len(criados),
        duplicados=duplicados,
        card_ids=[c[0] for c in criados],
    )
