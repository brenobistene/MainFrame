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

/** Label de seção (header de modal/card). Único lugar com uppercase: ajuda
 *  hierarquizar contra o conteúdo. */
export function sectionLabel(): React.CSSProperties {
  return {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-tertiary)',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontWeight: 600,
    marginBottom: 'var(--space-3)',
  }
}

/** Label de campo de form. Sentence-case. */
export function fieldLabel(): React.CSSProperties {
  return {
    display: 'block',
    marginBottom: 'var(--space-1)',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-tertiary)',
    fontWeight: 500,
  }
}

/** Hint embaixo de campo (texto explicativo curto). */
export function hintText(): React.CSSProperties {
  return {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    marginTop: 'var(--space-1)',
    lineHeight: 1.5,
  }
}

// ─── Form controls ──────────────────────────────────────────────────────

export function inputStyle(): React.CSSProperties {
  return {
    background: 'var(--glass-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-sm)',
    fontFamily: 'inherit',
    backdropFilter: 'var(--glass-blur)',
    WebkitBackdropFilter: 'var(--glass-blur)',
  }
}

// ─── Buttons (legado — usar <Button> de Primitives pra novos componentes) ──

/** @deprecated Use <Button variant="primary"> de Primitives — vem com hover/animação. */
export function primaryButton(): React.CSSProperties {
  return {
    background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--color-bg-primary)',
    padding: 'var(--space-2) var(--space-4)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    boxShadow: '0 1px 0 rgba(255, 255, 255, 0.15) inset, var(--shadow-sm)',
  }
}

/** @deprecated Use <Button variant="ghost"> de Primitives — vem com hover/animação. */
export function ghostButton(): React.CSSProperties {
  return {
    background: 'var(--glass-bg)',
    backdropFilter: 'var(--glass-blur)',
    WebkitBackdropFilter: 'var(--glass-blur)',
    border: '1px solid var(--color-border)',
    cursor: 'pointer',
    color: 'var(--color-text-secondary)',
    padding: 'var(--space-2) var(--space-4)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
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

/** Linha sutil oxblood no topo do modal — mesma assinatura visual usada
 *  nos cards do Carteira/Visão Geral. */
export const modalHairline: React.CSSProperties = {
  height: 1,
  background: 'linear-gradient(90deg, transparent, var(--color-accent-primary), transparent)',
  opacity: 0.5,
}

/** Header section do modal com gradient sutil (mancha oxblood top-left).
 *  Aplicar em volta do título + ações de cabeçalho. Inclui borderBottom. */
export function modalHeader(): React.CSSProperties {
  return {
    padding: 'var(--space-5) var(--space-6) var(--space-4)',
    background: `
      radial-gradient(ellipse 100% 80% at 0% 0%, rgba(159, 18, 57, 0.06), transparent 60%),
      linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
    `,
    borderBottom: '1px solid var(--color-divider)',
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


// ─── Card styles compartilhados ─────────────────────────────────────────
//
// Originalmente locais ao VisaoGeralPage; subiram pra cá quando a página
// "Fixas" passou a reutilizá-los. Mantém visual consistente entre Visão
// Geral e páginas-irmãs.

export const cardBase: React.CSSProperties = {
  background: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  padding: '16px 18px',
}

export const cardLabel: React.CSSProperties = {
  fontSize: 10, color: 'var(--color-text-tertiary)',
  letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600,
  display: 'block', marginBottom: 2,
}

export const listRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  gap: 12, padding: '6px 0',
}

export const listRowTitle: React.CSSProperties = {
  fontSize: 12, color: 'var(--color-text-primary)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

export const listRowSub: React.CSSProperties = {
  fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2,
}
