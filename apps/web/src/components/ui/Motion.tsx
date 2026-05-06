/**
 * Motion primitives — presets de spring + componentes reutilizáveis.
 *
 * Convenção: TODA animação do Hub Quest passa por aqui pra ter feel
 * consistente. CSS keyframes em index.html ficam só pra background
 * (grain, shimmer chrome, pulse-dot) — coisas que não dependem de
 * estado React e não precisam de spring.
 *
 * Springs nomeados como sensações, não como números:
 *  - `springSoft`: entrada de surfaces grandes (cards, páginas)
 *  - `springSnap`: feedback rápido (hover, press)
 *  - `springBounce`: hero numbers, atenção
 *  - `springPage`: transições de rota (mais lento, controlado)
 *
 * Acessibilidade: respeitamos `prefers-reduced-motion` via hook —
 * componentes detectam e desligam translates/scales, mantendo só fade.
 */
import { motion, useReducedMotion, useMotionValue, useSpring, useTransform, AnimatePresence } from 'framer-motion'
import type { Transition, Variants, MotionProps } from 'framer-motion'
import { useEffect, type ReactNode, type CSSProperties } from 'react'

// ─── Spring presets ─────────────────────────────────────────────────────

export const springSoft: Transition = {
  type: 'spring',
  damping: 26,
  stiffness: 220,
  mass: 0.6,
}

export const springSnap: Transition = {
  type: 'spring',
  damping: 22,
  stiffness: 380,
  mass: 0.5,
}

export const springBounce: Transition = {
  type: 'spring',
  damping: 14,
  stiffness: 200,
  mass: 0.7,
}

export const springPage: Transition = {
  type: 'spring',
  damping: 30,
  stiffness: 260,
  mass: 0.8,
}

// ─── Variants reutilizáveis ─────────────────────────────────────────────

/** Entrada padrão pra cards/seções: fade + leve translate Y. */
export const fadeUpVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, y: -8, transition: { ...springSnap, duration: 0.18 } },
}

/** Stagger pai: tem `visible` que orquestra os filhos. */
export const staggerParentVariants: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.05,
    },
  },
}

/** Stagger filho: combina com staggerParentVariants. */
export const staggerChildVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: springSoft },
}

/** Modal entrance: spring vindo de baixo. */
export const modalVariants: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1, transition: springSoft },
  exit: { opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.15 } },
}

export const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
}

// ─── Hooks ──────────────────────────────────────────────────────────────

/** Garante que animações respeitem prefers-reduced-motion via opacity-only. */
export function useMotionPrefs() {
  const reduced = useReducedMotion() ?? false
  return {
    reduced,
    /** Variants ajustadas se o user pediu reduced-motion. */
    safeFadeUp: reduced
      ? {
          hidden: { opacity: 0 },
          visible: { opacity: 1, transition: { duration: 0.2 } },
          exit: { opacity: 0, transition: { duration: 0.12 } },
        }
      : fadeUpVariants,
  }
}

// ─── <FadeUp> ───────────────────────────────────────────────────────────

/**
 * Wrapper que substitui `className="hq-animate-fade-up"`.
 * Mesma sensação visual mas com spring real (peso/inércia).
 */
export function FadeUp({
  children, delay = 0, className, style, as: Component = 'div',
  ...rest
}: {
  children: ReactNode
  delay?: number
  className?: string
  style?: CSSProperties
  as?: 'div' | 'section' | 'article'
} & Omit<MotionProps, 'children' | 'style'>) {
  const { safeFadeUp } = useMotionPrefs()
  const MotionTag = motion[Component] as typeof motion.div
  return (
    <MotionTag
      className={className}
      style={style}
      variants={safeFadeUp}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={delay ? { ...springSoft, delay } : undefined}
      {...rest}
    >
      {children}
    </MotionTag>
  )
}

// ─── <StaggerList> ──────────────────────────────────────────────────────

/**
 * Container que faz seus filhos `<StaggerItem>` entrarem em sequência.
 * Substitui o padrão CSS `hq-stagger` + `--stagger-i` que dependia de
 * setar `--stagger-i` manualmente em cada item.
 */
export function StaggerList({
  children, className, style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={staggerParentVariants}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({
  children, className, style, layout = false,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  /** Habilita `layout` pra reordenação suave (ex: filtro de lista). */
  layout?: boolean
}) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={staggerChildVariants}
      layout={layout}
    >
      {children}
    </motion.div>
  )
}

// ─── <AnimatedNumber> ───────────────────────────────────────────────────

/**
 * Conta de 0 (ou valor anterior) ao novo valor com spring suave. Pra
 * hero numbers (saldo, totais). Aceita formatter pra mostrar como BRL,
 * tempo, percentual etc. Respeita reduced-motion (mostra direto).
 */
export function AnimatedNumber({
  value, format = (n) => String(Math.round(n)), duration = 0.8,
  className, style,
}: {
  value: number
  format?: (n: number) => string
  duration?: number
  className?: string
  style?: CSSProperties
}) {
  const { reduced } = useMotionPrefs()
  const motionValue = useMotionValue(reduced ? value : 0)
  const spring = useSpring(motionValue, {
    damping: 30, stiffness: 90, mass: 0.8,
    duration: reduced ? 0 : duration,
  })
  const display = useTransform(spring, latest => format(latest))

  useEffect(() => {
    motionValue.set(value)
  }, [value, motionValue])

  return <motion.span className={className} style={style}>{display}</motion.span>
}

// ─── <PressScale> ───────────────────────────────────────────────────────

/**
 * Wrapper que adiciona feedback de press (scale 0.97) com spring.
 * Use em cards/buttons que devem "afundar" quando clicados.
 */
export function PressScale({
  children, className, style, onClick, disabled,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <motion.div
      className={className}
      style={style}
      onClick={disabled ? undefined : onClick}
      whileHover={disabled ? undefined : { y: -2, transition: springSnap }}
      whileTap={disabled ? undefined : { scale: 0.97, transition: springSnap }}
    >
      {children}
    </motion.div>
  )
}

// ─── Skeleton primitives ────────────────────────────────────────────────

/** Bloco shimmer simples — placeholder de UI enquanto carrega. Use no
 *  lugar de "Carregando…" texto, dá sensação premium não-bloqueante. */
export function SkeletonBlock({
  width = '100%', height = 14, radius, style,
}: {
  width?: number | string
  height?: number | string
  radius?: number | string
  style?: CSSProperties
}) {
  return (
    <div
      className="hq-skeleton"
      style={{
        width,
        height,
        borderRadius: radius ?? 'var(--radius-sm)',
        ...style,
      }}
    />
  )
}

/** Linha de lista skeleton: ícone esquerda + 2 linhas texto + valor direita.
 *  Pra placeholder de listas (transações, dívidas, contas). */
export function SkeletonRow({ withDot = true }: { withDot?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      padding: 'var(--space-2) var(--space-3)',
    }}>
      {withDot && (
        <SkeletonBlock width={8} height={8} radius={'50%'} style={{ flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <SkeletonBlock width="58%" height={11} />
        <SkeletonBlock width="36%" height={9} />
      </div>
      <SkeletonBlock width={80} height={14} style={{ flexShrink: 0 }} />
    </div>
  )
}

/** Hero number skeleton: label pequena + número grande. */
export function SkeletonStatCard({ labelWidth = 80, numberWidth = 180 }: {
  labelWidth?: number
  numberWidth?: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <SkeletonBlock width={labelWidth} height={10} />
      <SkeletonBlock width={numberWidth} height={32} />
    </div>
  )
}

/** Container shimmer pra grid de cards (visão geral). */
export function SkeletonCardGrid({ count = 3, height = 120 }: { count?: number; height?: number }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: 'var(--space-4)',
    }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} height={height} radius={'var(--radius-md)'} />
      ))}
    </div>
  )
}

// ─── <TiltCard> — tilt 3D no hover ──────────────────────────────────────

/**
 * Wrapper que aplica tilt 3D conforme o mouse — efeito "card vivo" sutil.
 * Use em cards hero (saldo principal, big stats), NÃO em listas (vira
 * disco voador). Max ~8 graus pra ficar elegante.
 *
 * Stack visual: o filho recebe transform 3D; quem precisa de overlay/blur
 * deve estar dentro pra herdar a perspective.
 */
export function TiltCard({
  children, className, style, maxTilt = 8,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  /** Máx graus de rotação. Default 8 (elegante). 12+ vira gimmick. */
  maxTilt?: number
}) {
  const { reduced } = useMotionPrefs()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  // Spring suave pra não tremer com micro-movimentos do mouse.
  const sx = useSpring(x, { damping: 22, stiffness: 200 })
  const sy = useSpring(y, { damping: 22, stiffness: 200 })
  const rotateX = useTransform(sy, [-0.5, 0.5], [maxTilt, -maxTilt])
  const rotateY = useTransform(sx, [-0.5, 0.5], [-maxTilt, maxTilt])

  if (reduced) {
    return <div className={className} style={style}>{children}</div>
  }

  return (
    <motion.div
      className={className}
      onMouseMove={e => {
        const rect = e.currentTarget.getBoundingClientRect()
        x.set((e.clientX - rect.left) / rect.width - 0.5)
        y.set((e.clientY - rect.top) / rect.height - 0.5)
      }}
      onMouseLeave={() => { x.set(0); y.set(0) }}
      style={{
        ...style,
        rotateX,
        rotateY,
        transformPerspective: 1200,
        transformStyle: 'preserve-3d',
      }}
    >
      {children}
    </motion.div>
  )
}

// ─── Re-export AnimatePresence ──────────────────────────────────────────

export { AnimatePresence, motion }
