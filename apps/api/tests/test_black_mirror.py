"""Black Mirror — espelho de dados. Mocka a IA (sem rede) e cobre o fluxo:
GET today lazy, generate, PATCH meu_passo, regenerate preservando meu_passo,
history, e 409 quando a IA não está configurada."""
from __future__ import annotations

import pytest


def _fake_reading(**over):
    base = {
        "reflexo": "Você passou o dia em manutenção, não em construção.",
        "tensao": "Diz priorizar Freelas, mas 0 min em quests de Freela hoje.",
        "padrao": "Terceiro dia seguido sem tocar no que declarou importante.",
        "pergunta": "O que você está evitando ao se manter ocupado?",
    }
    base.update(over)
    return base


def test_today_starts_ungenerated(client):
    r = client.get("/api/black-mirror/today")
    assert r.status_code == 200
    body = r.json()
    assert body["generated"] is False
    assert body["reflexo"] is None


def test_snapshot_no_ai(client):
    r = client.get("/api/black-mirror/snapshot")
    assert r.status_code == 200
    assert "data" in r.json()  # sempre presente; demais seções dependem de dados


def test_generate_then_today(client, monkeypatch):
    async def fake(settings, snapshot):
        return _fake_reading()
    monkeypatch.setattr("services.blackmirror_ai.daily_reflection", fake)

    g = client.post("/api/black-mirror/generate")
    assert g.status_code == 200, g.text
    body = g.json()
    assert body["generated"] is True
    assert body["tensao"].startswith("Diz priorizar")
    assert "snapshot_json" not in body  # não vaza o input bruto

    t = client.get("/api/black-mirror/today")
    assert t.json()["generated"] is True
    assert t.json()["pergunta"] == "O que você está evitando ao se manter ocupado?"


def test_meu_passo_saved_and_preserved_on_regenerate(client, monkeypatch):
    async def fake(settings, snapshot):
        return _fake_reading()
    monkeypatch.setattr("services.blackmirror_ai.daily_reflection", fake)

    client.post("/api/black-mirror/generate")
    p = client.patch("/api/black-mirror/today/meu-passo", json={"meu_passo": "Se abrir o PC, então 25 min de Freela primeiro."})
    assert p.status_code == 200
    assert p.json()["meu_passo"].startswith("Se abrir o PC")

    # Regenerar (texto novo da IA) NÃO pode apagar o passo do usuário.
    async def fake2(settings, snapshot):
        return _fake_reading(reflexo="Leitura nova.")
    monkeypatch.setattr("services.blackmirror_ai.daily_reflection", fake2)
    g2 = client.post("/api/black-mirror/generate")
    assert g2.json()["reflexo"] == "Leitura nova."
    assert g2.json()["meu_passo"].startswith("Se abrir o PC")  # preservado


def test_patch_without_reading_404(client):
    r = client.patch("/api/black-mirror/today/meu-passo", json={"meu_passo": "x"})
    assert r.status_code == 404


def test_history(client, monkeypatch):
    async def fake(settings, snapshot):
        return _fake_reading()
    monkeypatch.setattr("services.blackmirror_ai.daily_reflection", fake)
    client.post("/api/black-mirror/generate")
    h = client.get("/api/black-mirror/history")
    assert h.status_code == 200
    assert len(h.json()) == 1
    assert h.json()[0]["generated"] is True


def test_generate_ai_not_configured_409(client, monkeypatch):
    from services import blackmirror_ai

    async def boom(settings, snapshot):
        raise blackmirror_ai.AiNotConfigured("sem chave")
    monkeypatch.setattr("services.blackmirror_ai.daily_reflection", boom)
    r = client.post("/api/black-mirror/generate")
    assert r.status_code == 409
