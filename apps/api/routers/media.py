"""Serving de mídia local (áudios do Lang Lab).

Router custom em vez de StaticFiles mount: mantém o padrão /api/*, deixa
espaço pra cache headers e validação. FileResponse do Starlette atual já
suporta Range requests (seek de áudio funciona).

Arquivos vivem em apps/api/media/lang/{cache,uploads,sources} — fora do
git. Path traversal bloqueado por allowlist de categoria + filename sem
separadores.
"""
from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from services.lang_tts import CATEGORIES, media_path

router = APIRouter(tags=["media"])


@router.get("/api/media/lang/{categoria}/{filename}")
def serve_lang_media(categoria: str, filename: str):
    if categoria not in CATEGORIES:
        raise HTTPException(404, detail="categoria desconhecida")
    if (
        not filename
        or "/" in filename
        or "\\" in filename
        or ".." in filename
        or filename.startswith(".")
    ):
        raise HTTPException(404, detail="arquivo inválido")
    path = media_path(categoria, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, detail="arquivo não encontrado")
    media_type = "audio/mpeg" if filename.lower().endswith(".mp3") else "application/octet-stream"
    # SÓ o cache/ TTS é content-addressed (nome = hash → mesmo nome, mesmo
    # conteúdo) e pode cachear forte. uploads/sources têm NOME FIXO
    # (source_<id>.mp3) — immutable de 1 ano fazia re-upload nunca aparecer
    # no browser (QA 2026-06-12).
    cache = (
        "public, max-age=31536000, immutable"
        if categoria == "cache"
        else "no-cache"
    )
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": cache})
