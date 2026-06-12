"""TTS do Lang Lab via edge-tts (vozes neurais gratuitas da Microsoft).

Cache por hash(texto+voz): a mesma frase com a mesma voz nunca é gerada
duas vezes. Arquivos vivem em apps/api/media/lang/{cache,uploads,sources}
— FORA do git (.gitignore). TTS é regenerável por design; uploads não
(backup manual, ver PLAN §13.3).

edge-tts usa um endpoint não-oficial do Edge — pode quebrar (PLAN §13.1).
Toda chamada é best-effort: falha aqui NUNCA derruba a criação do card;
o frontend cobre card sem áudio com speechSynthesis.
"""
from __future__ import annotations

import hashlib
import os
from typing import Optional

import edge_tts

# apps/api/media/lang — resolvido relativo a este arquivo (services/..).
MEDIA_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "media", "lang")
)
CATEGORIES = ("cache", "uploads", "sources")


def media_path(categoria: str, filename: str) -> str:
    return os.path.join(MEDIA_ROOT, categoria, filename)


def ensure_dirs() -> None:
    for cat in CATEGORIES:
        os.makedirs(os.path.join(MEDIA_ROOT, cat), exist_ok=True)


def tts_hash(texto: str, voice: str) -> str:
    return hashlib.sha1(f"{voice}::{texto}".encode("utf-8")).hexdigest()


async def ensure_tts(texto: str, voice: str) -> tuple[str, bool]:
    """Gera (ou reusa do cache) o MP3 da frase. Retorna (audio_path
    relativo tipo 'cache/<hash>.mp3', cached: bool).

    Lança exceção em falha de rede/serviço — o CALLER decide se isso é
    fatal (endpoint /tts explícito) ou best-effort (criação de card).
    """
    ensure_dirs()
    h = tts_hash(texto, voice)
    rel = f"cache/{h}.mp3"
    abs_path = media_path("cache", f"{h}.mp3")
    if os.path.isfile(abs_path) and os.path.getsize(abs_path) > 0:
        return rel, True
    communicate = edge_tts.Communicate(texto, voice)
    tmp = abs_path + ".part"
    await communicate.save(tmp)
    os.replace(tmp, abs_path)
    return rel, False


async def list_voices(locale_prefix: Optional[str] = None) -> list[dict]:
    """Catálogo de vozes direto do serviço (nada hardcoded). Filtra por
    prefixo de locale ('en' pega en-US, en-GB, ...)."""
    voices = await edge_tts.list_voices()
    out = []
    for v in voices:
        locale = v.get("Locale", "")
        if locale_prefix and not locale.lower().startswith(locale_prefix.lower()):
            continue
        out.append(
            {
                "short_name": v.get("ShortName", ""),
                "locale": locale,
                "gender": v.get("Gender", ""),
                "friendly_name": v.get("FriendlyName"),
            }
        )
    out.sort(key=lambda x: (x["locale"], x["gender"], x["short_name"]))
    return out
