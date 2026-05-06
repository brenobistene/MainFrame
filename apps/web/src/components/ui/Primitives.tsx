/**
 * Componentes primitivos compartilhados do Hub Finance.
 *
 * Estética: Modern Minimal Glass — surfaces com backdrop-filter, hover lift
 * + glow, animações spring. Consome tokens de index.html.
 *
 * Sempre prefira esses componentes em vez de inline style — eles vêm com
 * hover/focus/animação prontos via CSS classes.
 */
import type { ReactNode, MouseEventHandler } from 'react'
import { motion } from 'framer-motion'
import { fadeUpVariants, springSnap, modalVariants, overlayVariants, useMotionPrefs } from './Motion'

// ─── Card ────────────────────────────────────────────────────────────────

/** Card glass — surface base pra blocos de info no dashboard.
 *  - hoverable: lift + brightness no hover (use pra cards interativos)
 *  - elevated: glass mais opaco + sombra (modal, dialogs)
 *
 *  Entrance via spring (Framer Motion) — substitui o antigo
 *  `animation: hq-fade-up` linear. Hover/press com spring pequeno
 *  só quando hoverable=true ou onClick presente. */
export function Card({
  children, hoverable = false, elevated = false, padding = 'md', style, onClick,
}: {
  children: ReactNode
  hoverable?: boolean
  elevated?: boolean
  padding?: 'sm' | 'md' | 'lg' | 'none'
  style?: React.CSSProperties
  onClick?: MouseEventHandler<HTMLDivElement>
}) {
  const { safeFadeUp, reduced } = useMotionPrefs()
  const padMap = {
    none: '0',
    sm: 'var(--space-3)',
    md: 'var(--space-5)',
    lg: 'var(--space-6)',
  }
  const cls = [
    elevated ? 'hq-glass-elevated' : 'hq-glass',
    hoverable && 'hq-card-hoverable',
  ].filter(Boolean).join(' ')

  const interactive = !!(onClick || hoverable)

  return (
    <motion.div
      className={cls}
      onClick={onClick}
      variants={safeFadeUp}
      initial="hidden"
      animate="visible"
      whileHover={interactive && !reduced ? { y: -2, transition: springSnap } : undefined}
      whileTap={onClick && !reduced ? { scale: 0.985, transition: springSnap } : undefined}
      style={{
        padding: padMap[padding],
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >
      {children}
    </motion.div>
  )
}

// Suprime warning de `fadeUpVariants` não usado — exportado pra outros lugares.
void fadeUpVariants

// ─── Button ──────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'ghost' | 'danger'

/** Botão padrão. Hover lift + press scale com spring real (Framer Motion). */
export function Button({
  children, onClick, variant = 'primary', disabled, type = 'button',
  fullWidth, leadingIcon, trailingIcon,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  disabled?: boolean
  type?: 'button' | 'submit'
  fullWidth?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}) {
  const { reduced } = useMotionPrefs()
  const cls = `hq-btn hq-btn--${variant}`
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cls}
      style={fullWidth ? { width: '100%' } : undefined}
      whileHover={disabled || reduced ? undefined : { y: -1, transition: springSnap }}
      whileTap={disabled || reduced ? undefined : { scale: 0.96, transition: springSnap }}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </motion.button>
  )
}

// ─── IconButton ──────────────────────────────────────────────────────────

type IconButtonVariant = 'default' | 'danger' | 'accent' | 'bare'

/** Botão icon-only padronizado. `aria-label` obrigatório. Spring no press. */
export function IconButton({
  children, label, onClick, variant = 'default', disabled, type = 'button',
}: {
  children: ReactNode
  label: string
  onClick?: () => void
  variant?: IconButtonVariant
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  const { reduced } = useMotionPrefs()
  const className = variant === 'bare'
    ? 'hq-icon-btn-bare'
    : variant === 'danger'
      ? 'hq-icon-btn hq-icon-btn--danger'
      : variant === 'accent'
        ? 'hq-icon-btn hq-icon-btn--accent'
        : 'hq-icon-btn'

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={className}
      whileHover={disabled || reduced ? undefined : { y: -1, transition: springSnap }}
      whileTap={disabled || reduced ? undefined : { scale: 0.92, transition: springSnap }}
    >
      {children}
    </motion.button>
  )
}

// ─── EmptyState ──────────────────────────────────────────────────────────

/** Estado vazio padrão — "nada aqui ainda". */
export function EmptyState({ text, sub, icon, dense = false }: {
  text: string
  sub?: string
  icon?: ReactNode
  dense?: boolean
}) {
  const { safeFadeUp } = useMotionPrefs()
  return (
    <motion.div
      variants={safeFadeUp}
      initial="hidden"
      animate="visible"
      style={{
      padding: dense ? 'var(--space-5) var(--space-4)' : 'var(--space-10) var(--space-5)',
      border: '1px dashed var(--color-border)',
      borderRadius: 'var(--radius-md)',
      textAlign: 'center',
      color: 'var(--color-text-muted)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 'var(--space-2)',
    }}>
      {icon && (
        <div style={{ color: 'var(--color-text-tertiary)', opacity: 0.6 }}>
          {icon}
        </div>
      )}
      <div style={{
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text-tertiary)',
        fontWeight: 500,
      }}>
        {text}
      </div>
      {sub && (
        <div
          className="hq-serif-italic"
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            maxWidth: 360,
            lineHeight: 1.55,
            marginTop: 'var(--space-1)',
          }}
        >
          {sub}
        </div>
      )}
    </motion.div>
  )
}

// ─── Modal frame ─────────────────────────────────────────────────────────

/** Frame padrão de modal: overlay com blur + content com spring entrance.
 *  Substitui as antigas keyframes `hq-animate-modal-in` por Framer Motion
 *  com physics real — modal "sobe" de baixo com peso, fecha com fade rápido.
 *  Inclui hairline oxblood no topo (mesma estética dos cards Carteira). */
export function ModalFrame({
  children, onClose, minWidth = 460, maxWidth = 560, padding = 'md',
}: {
  children: ReactNode
  onClose: () => void
  minWidth?: number
  maxWidth?: number
  padding?: 'md' | 'lg'
}) {
  const padValue = padding === 'lg' ? 'var(--space-6)' : 'var(--space-5)'
  return (
    <motion.div
      onClick={onClose}
      variants={overlayVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <motion.div
        onClick={e => e.stopPropagation()}
        className="hq-glass-elevated"
        variants={modalVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        style={{
          minWidth,
          maxWidth,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Hairline ice elétrica — assinatura HUD CP2077 */}
        <div className="hq-hairline-ice" style={{ flexShrink: 0 }} />
        <div style={{ padding: padValue, flex: 1, overflowY: 'auto' }}>
          {children}
        </div>
      </motion.div>
    </motion.div>
  )
}
