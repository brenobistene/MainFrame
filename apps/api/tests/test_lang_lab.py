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


def test_fontes_mineracao_dup_e_delete_preserva_cards(lang_client):
    src = lang_client.post("/api/lang/sources", json={
        "titulo": "Vergara · unidade 1", "tipo": "lesson",
        "texto": "Take it easy.\nLong story short.",
    }).json()
    assert src["cards_count"] == 0

    r = lang_client.post(f"/api/lang/sources/{src['id']}/mine", json={
        "lines": ["Take it easy.", "Long story short.", "Take it easy."],
    })
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["criados"] == 2
    assert out["duplicados"] == 1  # linha repetida não duplica

    # Re-minerar a mesma fonte → tudo duplicado, zero criados
    r2 = lang_client.post(f"/api/lang/sources/{src['id']}/mine", json={
        "lines": ["Take it easy.", "Long story short."],
    }).json()
    assert r2["criados"] == 0 and r2["duplicados"] == 2

    # Deletar a fonte NÃO mata os cards (ON DELETE SET NULL)
    assert lang_client.delete(f"/api/lang/sources/{src['id']}").status_code == 204
    cards = lang_client.get("/api/lang/cards").json()
    assert len([c for c in cards if c["frente"] in ("Take it easy.", "Long story short.")]) == 2


def test_metrics_summary_e_range_calendario(lang_client):
    card = lang_client.post("/api/lang/cards", json={"frente": "metrics probe"}).json()
    lang_client.post(f"/api/lang/cards/{card['id']}/review", json={"rating": 3})
    m = lang_client.get("/api/lang/metrics/summary").json()
    assert m["reviews_30d"] == 1
    assert m["retencao_30d"] == 1.0  # Good = acerto
    assert m["cards_total"] == 1
    assert len(m["heatmap"]) == 30

    # Range do calendário inclui sessões FINALIZADAS (histórico)
    lang_client.post("/api/lang/session/start")
    lang_client.post("/api/lang/session/stop")
    from datetime import date, timedelta
    hoje = date.today().isoformat()
    ontem = (date.today() - timedelta(days=1)).isoformat()
    amanha = (date.today() + timedelta(days=1)).isoformat()
    rows = lang_client.get(f"/api/lang-sessions?from={ontem}&to={amanha}").json()
    assert len(rows) == 1
    assert rows[0]["started_at"].startswith(hoje[:4])


def test_ia_desligada_409_e_piece_sobrevive(lang_client):
    # ask / assist / analysis: 409 gracioso sem chave
    assert lang_client.post("/api/lang/ask", json={"pergunta": "why tho?"}).status_code == 409
    assert lang_client.post("/api/lang/compose/assist", json={"rascunho": "I tried"}).status_code == 409
    assert lang_client.post("/api/lang/analysis/today").status_code == 409
    # piece salva independente da IA, e feedback falho não a perde
    p = lang_client.post("/api/lang/pieces", json={"texto": "I goed home."}).json()
    assert lang_client.post(f"/api/lang/pieces/{p['id']}/feedback").status_code == 409
    assert lang_client.get("/api/lang/pieces").json()[0]["texto"] == "I goed home."


def test_settings_anki_like_validacao(lang_client):
    # Steps configuráveis (CSV de minutos) — nada hardcoded
    r = lang_client.patch("/api/lang/settings", json={
        "learning_steps_min": "5,25", "maximum_interval_days": 365,
    })
    assert r.status_code == 200
    s = r.json()
    assert s["learning_steps_min"] == "5,25"
    assert s["maximum_interval_days"] == 365
    # CSV inválido rejeitado na validação
    assert lang_client.patch(
        "/api/lang/settings", json={"learning_steps_min": "abc"}
    ).status_code == 422


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
