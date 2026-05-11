/**
 * Tokens visuais do Hub Health — wrapper FINO sobre o sistema de design
 * global do Hub Quest (definido em apps/web/index.html `:root`).
 *
 * Estilo: **Kitsch biomonitor adaptado**, mas integrado ao tronco comum
 * (CP2077/Hell Is Us): chrome+ice como brand, oxblood semântico-only,
 * Rajdhani/Chakra Petch/JetBrains Mono como tipografia, atmosphere global,
 * ornamentos `hq-*` (chamfer, brackets, tech-label, glass).
 *
 * Refatorado em 2026-05-09 (Fase 0 da revisão estética):
 *   - antes: paleta isolada (`#040608` preto frio, `#dde6ec` texto frio,
 *     IBM Plex Mono em tudo, cores por domínio super saturadas) — Hub Health
 *     parecia um app paralelo, fora do sistema do hub
 *   - agora: BIO mapeia pra `var(--color-*)` globais, fontes pra `var(--font-*)`,
 *     cores por domínio dessaturadas pra harmonizar com chrome+ice+oxblood
 *
 * Refs em docs/design-system/STYLES.md §3.4.
 */

/**
 * Tokens BIO mapeiam pra CSS vars do tronco. Componentes consumem como
 * `style={{ background: BIO.bg }}` e o navegador resolve o `var()` em runtime.
 *
 * Nota: pra dar matiz biomonitor sem fugir do tronco, alguns slots usam
 * `--color-bg-*` puro (escala neutra) e outros usam `--color-ice-*` (azulado).
 * `panelHover` puxa pro glass do sistema (translucent overlay).
 */
export const BIO = {
  /** Fundo geral. Herda atmosphere global do body. */
  bg: 'var(--color-bg-primary)',
  /** Overlay leve pra elementos sobrepostos. */
  bgRaised: 'var(--color-bg-secondary)',
  /** Fundo de painel (cards, modais). */
  panel: 'var(--color-bg-tertiary)',
  /** Hover sutil em painéis clicáveis. */
  panelHover: 'var(--glass-bg-hover)',
  /** Borda inativa, near-invisible warm. */
  border: 'var(--color-border)',
  /** Borda ativa/focus. */
  borderActive: 'var(--color-border-strong)',
  /** Texto primário — warm soft (`#ece8e3`), padrão do app. */
  textPrimary: 'var(--color-text-primary)',
  textSecondary: 'var(--color-text-secondary)',
  textMuted: 'var(--color-text-muted)',
  /** Ausência/pendência — `--color-warning` (`#c08a3a`, gold dim). */
  amber: 'var(--color-warning)',
  /** Borda de painel em estado de atenção. */
  amberDim: 'var(--color-warning-border)',
  /** Erro/destrutivo — `--color-error` (`#dc2626`). */
  danger: 'var(--color-error)',

  /**
   * Cores por domínio — DESSATURADAS (Fase 0 da revisão estética).
   *
   * Antes eram saturação máxima (`#00e5ff`, `#ff2e3d`, etc) — gritavam contra
   * a paleta chrome+ice+oxblood do resto do site. Agora seguem o filtro -56
   * de saturação que o sistema usa pra ice (`#8fbfd3`).
   *
   * Saturação biológica continua presente (cada domínio tem identidade própria),
   * mas em harmonia com o tronco.
   */
  domainColors: {
    sono: '#67d4e6',            // ciano dessaturado — descanso, frio, calma
    exercicio: '#c95464',       // vermelho-musgo — sangue, calor, em família com oxblood
    alimentacao: '#9bc77a',     // verde-folha dessaturado — orgânico, fresco
    vicios: '#c46d99',          // magenta dessaturado — química, alarme sem ser sangue
    medidas: '#b0c5d6',         // azul-frio neutro — clínico
  } as Record<string, string>,
}

/**
 * Stack mono do tronco — JetBrains Mono primário, IBM Plex Mono fallback,
 * mono nativo último. Antes o Hub Health usava IBM Plex Mono em tudo —
 * agora segue o mesmo stack do resto do app (Build, Finance, Dashboard).
 */
export const MONO = 'var(--font-mono)'

/**
 * Stack display do tronco — Rajdhani uppercase pra headers, Inter fallback.
 * Usado em headers de seção do Hub Health (`// BIOMONITOR`, nomes de domínio).
 */
export const DISPLAY = 'var(--font-display)'

/**
 * Stack body do tronco — Chakra Petch pra parágrafos e textos longos.
 * Usado em descrições, hint text, notas livres.
 */
export const BODY = 'var(--font-body)'

export function colorForDomain(slug: string, fallbackHex?: string | null): string {
  return BIO.domainColors[slug] ?? fallbackHex ?? '#8a939c'
}

/**
 * Formata a data de um registro pra display. Pra Sono noturno, prefixa
 * "noite de" — porque a data semanticamente representa a noite em que
 * dormiu, não o instante do registro. Ver decisão em PLAN.md §10.
 */
export function formatRecordDate(
  data: string,                       // YYYY-MM-DD
  domainSlug: string,
  payload: Record<string, unknown>,
): string {
  // Sono: se o registro é noturno, prefixa "noite de"
  if (domainSlug === 'sono' && payload.tipo !== 'cochilo') {
    return `noite de ${formatBRDate(data)}`
  }
  return formatBRDate(data)
}

export function formatBRDate(iso: string): string {
  // YYYY-MM-DD → DD/MM
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}`
}

/**
 * Verifica se um registro é "ao vivo" — criado hoje, independente da `data`
 * semântica. Importante pra Sono noturno: registro feito de manhã hoje
 * tem `data = ontem` ("noite de"), mas `criado_em = hoje`. Antes a função
 * usava só `data` e o Sono nunca pulsava.
 *
 * Aceita timestamp ISO (`criado_em`) ou data simples (YYYY-MM-DD) como
 * fallback. Considera "ao vivo" se o dia local bate com hoje.
 */
export function isLiveRecord(criadoEmOuData: string | null | undefined): boolean {
  if (!criadoEmOuData) return false
  const today = new Date().toISOString().slice(0, 10)
  // Aceita "YYYY-MM-DD HH:MM:SS", "YYYY-MM-DDTHH:MM:SSZ" ou só "YYYY-MM-DD"
  return criadoEmOuData.slice(0, 10) === today
}

/**
 * Timestamp formatado pra HUD style — "HH:MM" no fuso local. Atualiza
 * (re-renderiza) quando o componente re-renderiza. Pra refresh automático,
 * use o hook `useNowHHMM` (atualiza a cada minuto).
 */
export function nowHHMM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Calcula duração entre duas horas HH:MM, considerando cruzar meia-noite
 * (hora_fim < hora_inicio significa que dormiu hoje, acordou amanhã).
 * Retorna formatado como "8h" ou "7h30" (omite minutos se 0).
 *
 * Usado em Sono pra mostrar duração calculada automaticamente — nunca
 * pedimos pro usuário digitar duração manualmente.
 */
/**
 * Resumo de uma linha do payload do registro pra display em listas. Pra
 * Sono, mostra a duração CALCULADA proeminentemente — usuário não digita
 * duração manualmente, o sistema deriva da janela hora_inicio→hora_fim.
 */
export function summarizeRecordPayload(payload: Record<string, unknown>): string {
  if ('hora_inicio' in payload && 'hora_fim' in payload) {
    const hi = String(payload.hora_inicio)
    const hf = String(payload.hora_fim)
    const dur = formatDuration(hi, hf)
    const tipo = payload.tipo === 'cochilo' ? ' · cochilo' : ''
    const q = payload.qualidade ? ` · q${payload.qualidade}` : ''
    return `${dur} (${hi}→${hf})${q}${tipo}`
  }
  if ('duracao_min' in payload) {
    return `${payload.duracao_min}min${
      payload.intensidade ? ` · int ${payload.intensidade}` : ''
    }`
  }
  if ('quantidade' in payload) {
    return `qty ${payload.quantidade}${
      payload.vontade ? ` · v${payload.vontade}` : ''
    }`
  }
  if ('valor' in payload) {
    return `${payload.valor}`
  }
  if ('comeu' in payload) {
    return payload.comeu ? 'comeu' : 'pulei'
  }
  if ('descricao' in payload) {
    return String(payload.descricao).slice(0, 60)
  }
  if ('escala' in payload) {
    return `escala ${payload.escala}/5`
  }
  return ''
}

export function formatDuration(hi: string, hf: string): string {
  if (!hi || !hf || hi.length !== 5 || hf.length !== 5) return '—'
  const h1 = parseInt(hi.slice(0, 2), 10)
  const m1 = parseInt(hi.slice(3, 5), 10)
  const h2 = parseInt(hf.slice(0, 2), 10)
  const m2 = parseInt(hf.slice(3, 5), 10)
  if (Number.isNaN(h1 + m1 + h2 + m2)) return '—'
  let totalMin = (h2 * 60 + m2) - (h1 * 60 + m1)
  if (totalMin < 0) totalMin += 24 * 60   // cruzou meia-noite
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (mins === 0) return `${hours}h`
  return `${hours}h${mins.toString().padStart(2, '0')}`
}

