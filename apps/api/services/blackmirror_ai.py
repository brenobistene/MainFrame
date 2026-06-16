"""IA do Black Mirror — a leitura diária que CONFRONTA, não aconselha.

Usa o transporte compartilhado services/ai_client.py com a config de IA das
lang_settings (mesma chave/provedor do Lang Lab — LANG_AI_API_KEY no .env).
Doc/decisões: docs/black-mirror, memória project-black-mirror.

Filosofia: o espelho reflete o usuário de volta cruzando a INTENÇÃO declarada
(/Build: propósito, visão, metas) com a EXECUÇÃO real (sessões, finance,
health, quests). NÃO prescreve ação — aponta a contradição e devolve UMA
pergunta. O plano if-then (`meu_passo`) é escrito pelo usuário, não pela IA.
"""
from __future__ import annotations

import json

from services import ai_client
# Re-export pros routers tratarem os mesmos erros sem importar ai_client direto.
from services.ai_client import AiError, AiNotConfigured  # noqa: F401

_PERSONA = (
    "Você é o BLACK MIRROR: o espelho de dados de um homem adulto. Sua função "
    "NÃO é aconselhar nem motivar — é REFLETIR e CONFRONTAR. Você recebe um "
    "retrato cruzando o que ele DECLAROU querer (propósito, visão, metas) com o "
    "que ele DE FATO fez (tempo, dinheiro, saúde, quests). Aponte a contradição "
    "entre intenção e comportamento com frieza lúcida — observação factual, "
    "nunca cobrança, nunca elogio, nunca conselho, zero motivacional, zero "
    "emojis. Português do Brasil, segunda pessoa ('você'). Se houver poucos "
    "dados, NÃO invente drama: diga que está quieto demais pra refletir. "
    "Termine sempre com UMA pergunta desconfortável — uma pergunta, não uma "
    "instrução. Você nunca diz o que ele deve fazer."
)

_SHAPE = (
    " Responda APENAS com JSON válido, sem markdown, neste shape exato: "
    '{"reflexo": str, "tensao": str | null, "padrao": str | null, '
    '"pergunta": str}. '
    "reflexo = 2-3 frases com o retrato honesto de agora. "
    "tensao = a contradição central entre o que ele diz querer e o que os dados "
    "mostram (null se os dados não revelam contradição). "
    "padrao = 1 padrão recorrente se formando, com o porquê em uma linha (null "
    "se não há sinal). "
    "pergunta = UMA pergunta desconfortável pra ele levar pro dia. "
    "Se o snapshot estiver vazio/quieto, reflexo diz isso e tensao/padrao = null."
)


async def daily_reflection(settings: dict, snapshot: dict) -> dict:
    """Gera a leitura do dia a partir do snapshot pré-agregado pelo router.

    Recebe só estatísticas e textos curtos do recorte (privacidade + tokens —
    nunca o histórico bruto). Devolve dict com reflexo/tensao/padrao/pergunta.
    Erros sobem como AiNotConfigured / AiError pro router traduzir em HTTP."""
    cfg = ai_client.resolve_config(settings)
    raw = await ai_client.chat(cfg, _PERSONA + _SHAPE, json.dumps(snapshot, ensure_ascii=False))
    try:
        data = json.loads(ai_client.strip_json(raw))
    except (ValueError, AttributeError):
        # Modelo fugiu do JSON — não perde o conteúdo, devolve cru no reflexo.
        return {"reflexo": raw, "tensao": None, "padrao": None, "pergunta": None}
    return {
        "reflexo": data.get("reflexo"),
        "tensao": data.get("tensao"),
        "padrao": data.get("padrao"),
        "pergunta": data.get("pergunta"),
    }
