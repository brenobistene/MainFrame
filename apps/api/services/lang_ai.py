"""IA tutora do Lang Lab — adapter provider-agnostic (PLAN §6).

Dois shapes de chamada:
- 'gemini':        REST do Google AI Studio (free tier).
- 'openai-compat': /chat/completions — cobre OpenAI, Groq, OpenRouter e
                   até Ollama local via ai_base_url.

Config vem de lang_settings (provider/model/base_url); a CHAVE vem só do
ambiente (LANG_AI_API_KEY no apps/api/.env — nunca no DB).

Papel da IA (pedido literal do usuário): tutora ATIVA dentro do app — ele
não sai do MAINFRAME pra pesquisar. Toda resposta explica O PORQUÊ
(estrutura/gramática), não só corrige. Cláusula de tom em TODOS os
prompts: observação factual, nunca professoral/cobrança (PLAN §6).
"""
from __future__ import annotations

import json
from typing import Optional

from services import ai_client
# Nomes mantidos pra compat com quem importa de services.lang_ai (routers/lang,
# routers/export). O transporte agora vive em services/ai_client.py.
from services.ai_client import AiError as LangAiError  # noqa: F401
from services.ai_client import AiNotConfigured as LangAiNotConfigured  # noqa: F401


# Persona compartilhada — tutor pra brasileiro com compreensão
# intermediária-avançada e produção fraca (o perfil do usuário).
_PERSONA = (
    "Você é tutor de inglês de um brasileiro adulto que ENTENDE inglês com "
    "facilidade mas produz mal (escrever/falar). Responda em português do "
    "Brasil, com os exemplos em inglês. SEMPRE explique O PORQUÊ — a regra "
    "ou padrão de estrutura por trás, em 1-3 frases, como quem aponta um "
    "mecanismo, não como quem dá bronca. Indique registro quando relevante "
    "(formal / informal / gíria). Tom: observação factual e direta, zero "
    "motivacional, zero cobrança, zero emojis. Seja conciso."
)


def get_config(settings: dict) -> dict:
    return ai_client.resolve_config(settings)


async def _call(cfg: dict, system: str, user: str) -> str:
    """Uma rodada chat → texto. Delega pro transporte compartilhado."""
    return await ai_client.chat(cfg, system, user)


async def ask(settings: dict, pergunta: str, contexto: Optional[str] = None) -> str:
    """Dúvida pontual ("como digo X?", "por que se usa Y?"). Resposta em
    markdown leve com variantes de registro e o porquê."""
    cfg = get_config(settings)
    user = pergunta
    if contexto:
        user = f"Contexto (frase em estudo): {contexto}\n\nDúvida: {pergunta}"
    system = _PERSONA + (
        " Estruture a resposta: a forma natural de dizer; variantes por "
        "registro quando existirem; e o porquê do padrão. Se a dúvida for "
        "de estrutura, mostre o esqueleto da construção (ex.: 'would rather "
        "+ verbo + than + verbo')."
    )
    return await _call(cfg, system, user)


async def piece_feedback(settings: dict, texto: str, prompt: Optional[str]) -> dict:
    """Correção de produção escrita — devolve JSON estruturado. O campo
    `por_que` de cada erro é obrigatório: corrigir sem explicar não ensina."""
    cfg = get_config(settings)
    system = _PERSONA + (
        " Responda APENAS com JSON válido, sem markdown, neste shape: "
        '{"versao_natural": str, "erros": [{"trecho": str, "correcao": str, '
        '"por_que": str, "tag": str}], "observacao_registro": str | null, '
        '"frases_pra_card": [str]}. '
        "`tag` é curta e reutilizável (ex.: 'preposition', 'verb-tense', "
        "'word-order'). `frases_pra_card` = 1-3 frases corrigidas que valem "
        "virar card de estudo. Se o texto estiver correto, erros=[] e diga "
        "isso na observacao_registro."
    )
    user = (f"Tema proposto: {prompt}\n\n" if prompt else "") + f"Texto do aluno:\n{texto}"
    raw = await _call(cfg, system, user)
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            cleaned = cleaned[cleaned.find("{"):cleaned.rfind("}") + 1]
        return json.loads(cleaned)
    except (ValueError, AttributeError):
        # Modelo fugiu do JSON — não perde o conteúdo, devolve cru.
        return {"versao_natural": None, "erros": [], "observacao_registro": raw,
                "frases_pra_card": []}


async def daily_analysis(settings: dict, contexto: dict) -> dict:
    """Análise do dia com comparação temporal (PLAN §3.8) — "julgar meu
    progresso" exige comparar com as semanas anteriores, não fotografar o
    dia. Recebe contexto pré-agregado pelo router (privacidade e tokens:
    só estatísticas e textos do dia, nunca o histórico bruto inteiro)."""
    cfg = get_config(settings)
    system = _PERSONA + (
        " Você vai analisar o dia de estudo do aluno comparando com as "
        "janelas de 7 e 30 dias. Responda APENAS com JSON válido, sem "
        "markdown: {\"resumo\": str (2-3 frases, observação factual), "
        "\"padroes\": [str] (padrões de erro/acerto recorrentes, com o "
        "porquê em uma linha), \"comparacao\": str (evolução vs 7d/30d, "
        "números quando houver), \"foco_sugerido\": str (UM foco concreto "
        "pra próxima sessão)}. Tom: observação, nunca cobrança — aponte "
        "fatos e mecanismos, não esforço."
    )
    user = json.dumps(contexto, ensure_ascii=False)
    raw = await _call(cfg, system, user)
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            cleaned = cleaned[cleaned.find("{"):cleaned.rfind("}") + 1]
        return json.loads(cleaned)
    except (ValueError, AttributeError):
        return {"resumo": raw, "padroes": [], "comparacao": "", "foco_sugerido": ""}


async def compose_assist(settings: dict, rascunho: str, intencao: Optional[str]) -> str:
    """Ajuda DURANTE a escrita (a dor literal: 'concatenar ideias').
    Sugere conectores/estrutura SEM escrever o texto pelo aluno."""
    cfg = get_config(settings)
    system = _PERSONA + (
        " O aluno está NO MEIO da escrita e travou. NÃO escreva o texto por "
        "ele. Sugira: 2-3 conectores ou estruturas que ligam as ideias dele, "
        "o esqueleto da próxima frase, e o porquê de cada sugestão em uma "
        "linha. Termine sem frase pronta — ele constrói."
    )
    user = (f"O que ele quer dizer: {intencao}\n\n" if intencao else "") + (
        f"Rascunho até agora:\n{rascunho}"
    )
    return await _call(cfg, system, user)
