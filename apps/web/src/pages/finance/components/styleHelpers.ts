/**
 * Helpers de estilo + formatação compartilhados entre os componentes do
 * Hub Finance.
 *
 * Tokens vêm de `index.html` (--space-*, --text-*, --radius-*, --motion-*,
 * --glass-*, --glow-*). Componentes novos devem usar `<Button>`, `<Card>`,
 * `<IconButton>` de Primitives.tsx — eles vêm com hover/animação prontos.
 *
 * As funções abaixo (primaryButton/ghostButton/etc) ainda existem pra
 * compat com componentes não-migrados, mas não têm hover (inline style não
 * suporta :hover). Migra pros componentes do Primitives.
 */

// ─── Constants ──────────────────────────────────────────────────────────

/** Tamanhos canônicos pra ícones Lucide. */
export const ICON_SIZE = { xs: 11, sm: 12, md: 14, lg: 16, xl: 20 } as const

/** StrokeWidth padrão pra ícones em UI. */
export const ICON_STROKE = 1.8
export const ICON_STROKE_HEAVY = 2

// ─── Text styles ────────────────────────────────────────────────────────

/** Label de seção (header de modal/card) — cyber-mono uppercase ice-light. */
export function sectionLabel(): React.CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--color-ice-light)',
    letterSpacing: '0.25em',
    textTransform: 'uppercase',
    marginBottom: 'var(--space-3)',
  }
}

/** Label de campo de form — mono uppercase muted com prefixo `//` opcional. */
export function fieldLabel(): React.CSSProperties {
  return {
    display: 'block',
    marginBottom: 'var(--space-1)',
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    fontWeight: 700,
    color: 'var(--color-text-muted)',
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
  }
}

/** Hint embaixo de campo — mono dim. */
export function hintText(): React.CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    fontWeight: 700,
    color: 'var(--color-text-muted)',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    marginTop: 'var(--space-1)',
    lineHeight: 1.6,
  }
}

// ─── Form controls ──────────────────────────────────────────────────────

export function inputStyle(): React.CSSProperties {
  return {
    background: 'rgba(8, 12, 18, 0.55)',
    border: '1px solid var(--color-border)',
    borderRadius: 0,
    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
    padding: '7px 12px',
    color: 'var(--color-ice-light)',
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    letterSpacing: '0.02em',
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  }
}

// ─── Buttons (legado — usar <Button> de Primitives pra novos componentes) ──

/** @deprecated Use <Button variant="primary"> de Primitives — vem com hover/animação. */
export function primaryButton(): React.CSSProperties {
  return {
    background: 'rgba(143, 191, 211, 0.14)',
    border: '1px solid var(--color-ice)',
    cursor: 'pointer',
    color: 'var(--color-ice-light)',
    fontFamily: 'var(--font-mono)',
    padding: '7px 16px',
    borderRadius: 0,
    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    boxShadow: '0 0 12px rgba(143, 191, 211, 0.25)',
    transition: 'all 0.15s',
  }
}

/** @deprecated Use <Button variant="ghost"> de Primitives — vem com hover/animação. */
export function ghostButton(): React.CSSProperties {
  return {
    background: 'rgba(8, 12, 18, 0.55)',
    border: '1px solid var(--color-border)',
    cursor: 'pointer',
    color: 'var(--color-text-tertiary)',
    fontFamily: 'var(--font-mono)',
    padding: '7px 14px',
    borderRadius: 0,
    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    transition: 'all 0.15s',
  }
}

// ─── Layout primitives ──────────────────────────────────────────────────

export function modalOverlay(): React.CSSProperties {
  return {
    position: 'fixed',
    inset: 0,
    background: 'var(--color-overlay)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    animation: 'hq-overlay-in var(--motion-base) var(--ease-smooth) both',
  }
}

/** Container interno padrão dos modais — alinha com a estética Carteira:
 *  border-radius generoso, sombra forte, animation de entrada. Use junto
 *  com modalHairline + modalHeader pra dar o tratamento completo. */
export function modalShell(): React.CSSProperties {
  return {
    background: 'var(--color-bg-primary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
    animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
    boxShadow: 'var(--shadow-lg)',
  }
}

/** Linha ice elétrica no topo do modal — assinatura HUD CP2077 em vez
 *  do antigo hairline oxblood. Coordena com o resto do app pós-cyberpunk. */
export const modalHairline: React.CSSProperties = {
  height: 1,
  background: 'linear-gradient(90deg, transparent, var(--color-ice-deep), var(--color-ice-light), var(--color-ice-deep), transparent)',
  backgroundSize: '200% 100%',
  animation: 'hq-shimmer 10s ease-in-out infinite',
  opacity: 0.7,
}

/** Header section do modal com atmosphere ice/fog. Coordena com a
 *  identidade cyberpunk aplicada em volta do app. */
export function modalHeader(): React.CSSProperties {
  return {
    padding: 'var(--space-5) var(--space-6) var(--space-4)',
    background: `
      radial-gradient(ellipse 100% 80% at 0% 0%, rgba(143, 191, 211, 0.05), transparent 60%),
      radial-gradient(ellipse 60% 80% at 100% 0%, rgba(50, 62, 73, 0.20), transparent 65%),
      linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
    `,
    borderBottom: '1px solid var(--color-ice-deep)',
  }
}

/** Body section padrão — padding consistente com cards Carteira. */
export function modalBody(): React.CSSProperties {
  return {
    padding: 'var(--space-5) var(--space-6)',
  }
}

// ─── Formatters ─────────────────────────────────────────────────────────

export function formatBRL(value: number): string {
  return formatMoney(value, 'BRL')
}

export function formatMoney(value: number, moeda: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency', currency: moeda, minimumFractionDigits: 2,
    }).format(value)
  } catch {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
    }).format(value)
  }
}

export function formatDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/**
 * Filtro de digitação pra inputs monetários: aceita só dígitos, ponto e
 * vírgula. Aplicar no onChange (`setX(sanitizeMoneyInput(e.target.value))`)
 * pra impedir letras / caracteres especiais de entrarem no input desde a
 * digitação. NÃO formata — só rejeita lixo. O parseBRL no submit cuida do
 * formato BR.
 */
export function sanitizeMoneyInput(s: string): string {
  return s.replace(/[^\d.,]/g, '')
}

/**
 * Parser BR-aware de valor monetário. Substitui o antigo
 * `parseFloat(s.replace(',', '.'))` que tratava qualquer "." como decimal.
 *
 * Regras (na ordem):
 *  - Tem `,` E `.`: pontos são milhares, última vírgula é decimal.
 *      "1.234,56"  → 1234.56
 *      "1.234.567,89" → 1234567.89
 *  - Só vírgula: vírgula é decimal.
 *      "1,45" → 1.45
 *      "1234,5" → 1234.5
 *  - Só ponto:
 *      • exatamente 2 dígitos depois → decimal (compat com input US copiado).
 *          "1.45" → 1.45
 *      • 3+ dígitos depois OU múltiplos pontos → milhares.
 *          "1.452"  → 1452
 *          "1.234.567" → 1234567
 *      • outros casos (1 dígito, 4+ sem outro ponto) → decimal puro
 *        (parseFloat normal). "1.4" → 1.4, "1.4567" → 1.4567
 *  - Sem separador: parseFloat direto.
 *
 * Retorna `null` se vazio ou inválido (NaN). Caller decide se rejeita 0.
 */
export function parseBRL(input: string | null | undefined): number | null {
  if (input == null) return null
  const s = String(input).trim().replace(/\s+/g, '')
  if (!s) return null
  // Tira sinal de moeda comum se o user colou
  const cleaned = s.replace(/^R\$/i, '').trim()
  if (!cleaned) return null

  const hasComma = cleaned.includes(',')
  const dotMatches = cleaned.match(/\./g)
  const dotCount = dotMatches ? dotMatches.length : 0

  let normalized: string
  if (hasComma && dotCount > 0) {
    // BR completo: pontos = milhares, última vírgula = decimal
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (hasComma) {
    // Só vírgula = decimal
    normalized = cleaned.replace(',', '.')
  } else if (dotCount === 0) {
    normalized = cleaned
  } else if (dotCount === 1) {
    // 1 ponto: 2 dígitos depois → decimal US; 3+ dígitos → milhares.
    const afterDot = cleaned.split('.')[1] ?? ''
    if (afterDot.length === 2) {
      normalized = cleaned // "1.45" = 1.45
    } else if (afterDot.length === 3) {
      normalized = cleaned.replace('.', '') // "1.452" = 1452
    } else {
      normalized = cleaned // "1.4" = 1.4, "1.4567" = 1.4567
    }
  } else {
    // 2+ pontos: milhares (ex: "1.234.567")
    normalized = cleaned.replace(/\./g, '')
  }

  const n = parseFloat(normalized)
  return isNaN(n) ? null : n
}


// ─── Card styles compartilhados — cyber CP2077 ──────────────────────────
//
// Card padrão do Hub Finance: chamfer-bl + ice border translúcido + bg dark
// glass. Border-left customizável pelos consumers (cor da entidade — ex:
// success pra entrada, oxblood pra dívida, ice pra neutro).

export const cardLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9, fontWeight: 700,
  color: 'var(--color-text-muted)',
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  display: 'block', marginBottom: 4,
}

export const listRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  gap: 12, padding: '8px 0',
}

export const listRowTitle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 12, fontWeight: 600,
  color: 'var(--color-text-primary)',
  letterSpacing: '0.02em',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

export const listRowSub: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9, fontWeight: 700,
  color: 'var(--color-text-muted)',
  letterSpacing: '0.18em', textTransform: 'uppercase',
  marginTop: 3,
}
