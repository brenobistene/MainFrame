"""Cliente de IA compartilhado — transporte provider-agnostic.

Extraído de services/lang_ai.py (2026-06-16) pra ser reusado por outros
módulos além do Lang Lab (Black Mirror, etc). Dois shapes de chamada:
- 'gemini':        REST do Google AI Studio (free tier).
- 'openai-compat': /chat/completions — cobre OpenAI, Groq, OpenRouter e
                   até Ollama local via base_url.

Config (provider/model/base_url) vem das settings do módulo chamador; a CHAVE
vem só do ambiente (LANG_AI_API_KEY no apps/api/.env — NUNCA no DB).
"""
from __future__ import annotations

import os

import httpx

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_OPENAI_COMPAT_URL = "https://api.groq.com/openai/v1"


class AiNotConfigured(Exception):
    """ai_provider='none' ou chave ausente — UI esconde superfícies de IA."""


class AiError(Exception):
    """Falha de chamada (rede, rate limit, resposta inválida)."""


def resolve_config(settings: dict) -> dict:
    """Resolve provider/model/base_url das settings + chave do ambiente.

    `settings` precisa ter as colunas ai_provider / ai_model / ai_base_url
    (hoje vivem em lang_settings — fonte única da config de IA do app)."""
    provider = settings.get("ai_provider") or "none"
    if provider == "none":
        raise AiNotConfigured("ai_provider está 'none'")
    api_key = os.environ.get("LANG_AI_API_KEY", "").strip()
    if not api_key:
        raise AiNotConfigured("LANG_AI_API_KEY ausente no apps/api/.env")
    return {
        "provider": provider,
        "model": settings.get("ai_model") or "gemini-flash-latest",
        "base_url": settings.get("ai_base_url") or DEFAULT_OPENAI_COMPAT_URL,
        "api_key": api_key,
    }


async def chat(cfg: dict, system: str, user: str) -> str:
    """Uma rodada chat → texto. Erros viram AiError."""
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            if cfg["provider"] == "gemini":
                r = await client.post(
                    GEMINI_URL.format(model=cfg["model"]),
                    params={"key": cfg["api_key"]},
                    json={
                        "system_instruction": {"parts": [{"text": system}]},
                        "contents": [{"role": "user", "parts": [{"text": user}]}],
                    },
                )
                r.raise_for_status()
                data = r.json()
                return data["candidates"][0]["content"]["parts"][0]["text"]
            # openai-compat (Groq/OpenAI/OpenRouter/Ollama)
            r = await client.post(
                f"{cfg['base_url'].rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {cfg['api_key']}"},
                json={
                    "model": cfg["model"],
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                },
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]
    except httpx.HTTPStatusError as e:
        raise AiError(
            f"provedor respondeu {e.response.status_code}"
            + (" (rate limit — tente em instantes)" if e.response.status_code == 429 else "")
        ) from e
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as e:
        raise AiError(f"falha na chamada de IA: {e}") from e


def strip_json(raw: str) -> str:
    """Remove cercas markdown (```json … ```) e devolve só o objeto {…}.
    Modelos às vezes embrulham o JSON em fence apesar da instrução."""
    cleaned = (raw or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned[cleaned.find("{"):cleaned.rfind("}") + 1]
    return cleaned
