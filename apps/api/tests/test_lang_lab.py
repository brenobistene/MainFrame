"""Smoke tests do Lang Lab (F1) — seed, cards, fila FSRS, undo e sessão.

TTS é mockado (edge-tts depende de rede; criação de card é best-effort
por design, mas teste tem que ser determinístico).
"""
from __future__ import annotations

import pytest


@pytest.fixture
def lang_client(client, monkeypatch):
    from services import lang_tts

    async def fake_ensure_tts(texto: str, voice: str):
        return ("cache/fake.mp3", False)

    monkeypatch.setattr(lang_tts, "ensure_tts", fake_ensure_tts)
    return client


def test_seed_language_e_settings(lang_client):
    langs = lang_client.get("/api/lang/languages").json()
    assert any(l["code"] == "en" for l in langs)
    en = next(l for l in langs if l["code"] == "en")
    assert en["tts_voice"] == "en-US-AriaNeural"

    settings = lang_client.get("/api/lang/settings").json()
    assert settings["new_cards_per_day"] == 15  # preset escolhido pelo usuário
    assert settings["ai_provider"] == "none"    # IA desligada por default
    assert settings["day_cutoff_hour"] == 4


def test_card_dup_fila_review_e_undo(lang_client):
    # Quick-add
    r = lang_client.post("/api/lang/cards", json={"frente": "I should've known better"})
    assert r.status_code == 201, r.text
    card = r.json()
    assert card["audio_url"] == "/api/media/lang/cache/fake.mp3"
    assert card["state"] == "learning"
    assert card["last_review"] is None

    # Duplicata (normalizada) → 409, não cria silenciosamente
    r = lang_client.post("/api/lang/cards", json={"frente": "i  should've known  BETTER"})
    assert r.status_code == 409

    # Fila: card novo entra dentro da cota
    q = lang_client.get("/api/lang/review/queue").json()
    assert q["new_count"] == 1
    assert q["due_count"] == 0
    assert q["cards"][0]["id"] == card["id"]

    # Review Good → agendado pro futuro (learning step intraday), sai da fila
    r = lang_client.post(f"/api/lang/cards/{card['id']}/review", json={"rating": 3})
    assert r.status_code == 200, r.text
    reviewed = r.json()
    assert reviewed["last_review"] is not None
    assert reviewed["reps"] == 1
    q2 = lang_client.get("/api/lang/review/queue").json()
    assert all(c["id"] != card["id"] for c in q2["cards"])
    assert q2["reviews_done_today"] == 1

    # Undo (tecla Z) → snapshot restaurado, card volta a ser "novo"
    r = lang_client.post("/api/lang/review/undo")
    assert r.status_code == 200, r.text
    undone = r.json()["card"]
    assert undone["last_review"] is None
    assert undone["reps"] == 0
    q3 = lang_client.get("/api/lang/review/queue").json()
    assert q3["new_count"] == 1


def test_patch_frente_regenera_tts_e_suspenso_sai_da_fila(lang_client):
    card = lang_client.post("/api/lang/cards", json={"frente": "to be fair"}).json()
    r = lang_client.patch(f"/api/lang/cards/{card['id']}", json={"frente": "to be honest"})
    assert r.status_code == 200
    assert r.json()["frente"] == "to be honest"

    r = lang_client.patch(f"/api/lang/cards/{card['id']}", json={"suspenso": True})
    assert r.status_code == 200
    q = lang_client.get("/api/lang/review/queue").json()
    assert all(c["id"] != card["id"] for c in q["cards"])


def test_sessao_cluster_pausada_vs_encerrada_no_banner(lang_client):
    # Start → banner mostra lang LIVE
    r = lang_client.post("/api/lang/session/start")
    assert r.status_code == 201, r.text
    active = lang_client.get("/api/sessions/active").json()
    assert active["type"] == "lang"
    assert active["is_active"] is True
    assert active["title"].startswith("Lang Lab")

    # Pause → banner CONTINUA mostrando (PAUSED), não some — flag finalizada
    lang_client.post("/api/lang/session/pause")
    active = lang_client.get("/api/sessions/active").json()
    assert active is not None and active["type"] == "lang"
    assert active["is_active"] is False

    # Resume → nova row no cluster, LIVE de novo
    lang_client.post("/api/lang/session/resume")
    active = lang_client.get("/api/sessions/active").json()
    assert active["is_active"] is True
    cluster = lang_client.get("/api/lang/session").json()
    assert len(cluster["rows"]) == 2

    # Conflito global: iniciar outra coisa enquanto lang roda → 409
    # (find_active_session enxerga o lang rodando)
    r = lang_client.post("/api/mind/session/start")
    assert r.status_code == 409

    # Stop → finalizada=1 no cluster inteiro → sai do banner
    lang_client.post("/api/lang/session/stop")
    active = lang_client.get("/api/sessions/active").json()
    assert active is None
    cluster = lang_client.get("/api/lang/session").json()
    assert cluster["has_active"] is False


def test_today_fatos_sem_quota(lang_client):
    lang_client.post("/api/lang/cards", json={"frente": "hello there"})
    today = lang_client.get("/api/lang/today").json()
    assert today["novos_disponiveis"] == 1
    assert today["due"] == 0
    assert today["reviews_hoje"] == 0
    # daily_goal vem como referência, não como fração calculada
    assert today["daily_goal_min"] == 15
    # recém-instalado nunca estudou → ausência None (sem cobrança)
    assert today["dias_sem_estudo"] is None
