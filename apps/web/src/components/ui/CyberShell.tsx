/**
 * Cyberpunk shell — componentes shared pra estabelecer linguagem
 * CP2077 + Hell Is Us em todas as páginas do Hub Quest.
 *
 * Referências master: Dashboard (DashboardPage), Sidebar, Banner.
 * Estética: header band com tab marker ice + // labels mono uppercase
 * em Rajdhani/JetBrains Mono, panels com chamfer-bl, atmosphere via
 * radial gradients halo + grain, footer caption técnico mono.
 */
import type { CSSProperties, ReactNode } from 'react'
import { ChevronDown, Info } from 'lucide-react'

// ─── PageHeaderBand ──────────────────────────────────────────────────────
/**
 * Faixa solid no topo da página (estilo "DATA BUFFER" CP2077).
 * Esquerda: tab marker ice + // PAGE.LABEL + slot livre (avatar, etc.).
 * Direita: stack metadata técnico mono (timestamps, mode codes) + slot
 * livre pra controles (filtros, range pickers).
 */
export function PageHeaderBand({
  label,
  leftContent,
  rightMetadata,
  rightControls,
}: {
  label: string
  leftContent?: ReactNode
  rightMetadata?: ReactNode
  rightControls?: ReactNode
}) {
  return (
    <header
      style={{
        position: 'relative',
        padding: '12px 18px',
        background: 'linear-gradient(180deg, rgba(10, 14, 22, 0.92), rgba(8, 10, 14, 0.88))',
        borderBottom: '1px solid var(--color-ice-deep)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-5)',
        minHeight: 56,
      }}
    >
      {/* Tab marker ice (assinatura "tab pull") */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0, bottom: -1,
          width: 64, height: 2,
          background: 'var(--color-ice)',
          boxShadow: '0 0 12px var(--color-ice-glow)',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: 1, minWidth: 0 }}>
        <div
          className="hq-tech-label"
          style={{
            fontSize: 11,
            color: 'var(--color-ice-light)',
            letterSpacing: '0.28em',
            flexShrink: 0,
          }}
        >
          {label}
        </div>
        {leftContent && (
          <>
            <div style={{ width: 1, height: 22, background: 'var(--color-border-strong)', flexShrink: 0 }} />
            {leftContent}
          </>
        )}
      </div>

      {(rightMetadata || rightControls) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexShrink: 0 }}>
          {rightMetadata && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
              {rightMetadata}
            </div>
          )}
          {rightControls}
        </div>
      )}
    </header>
  )
}

// ─── TechLabel ───────────────────────────────────────────────────────────
/** Label mono uppercase com prefixo `// ` (assinatura HUD CP2077). */
export function TechLabel({
  children,
  color = 'var(--color-text-tertiary)',
  size = 10,
  letterSpacing = '0.22em',
  style,
}: {
  children: ReactNode
  color?: string
  size?: number
  letterSpacing?: string
  style?: CSSProperties
}) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: size,
        fontWeight: 700,
        letterSpacing,
        textTransform: 'uppercase',
        color,
        ...style,
      }}
    >
      <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>
        //
      </span>
      {children}
    </span>
  )
}

// ─── TechId ──────────────────────────────────────────────────────────────
/** Sub-label mono uppercase sem prefixo `//`. Usado em metadata ID#... */
export function TechId({
  children,
  color = 'var(--color-text-muted)',
  size = 9,
  style,
}: {
  children: ReactNode
  color?: string
  size?: number
  style?: CSSProperties
}) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: size,
        fontWeight: 600,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        color,
        ...style,
      }}
    >
      {children}
    </span>
  )
}

// ─── SectionHeader ───────────────────────────────────────────────────────
/**
 * Section header collapsable estilo CP2077 codex (CHARACTERS/GLOSSARY/etc).
 * Border ice/oxblood semântico + bottom-right chamfer + chevron rotacionado.
 */
export function SectionHeader({
  label,
  count,
  collapsed,
  onToggle,
  accent = 'ice',
  rightSlot,
}: {
  label: string
  count?: number
  collapsed?: boolean
  onToggle?: () => void
  accent?: 'ice' | 'oxblood'
  rightSlot?: ReactNode
}) {
  const borderColor = accent === 'oxblood'
    ? 'rgba(159, 18, 57, 0.55)'
    : 'rgba(143, 191, 211, 0.45)'
  const textColor = accent === 'oxblood'
    ? 'var(--color-accent-light)'
    : 'var(--color-ice-light)'
  const interactive = !!onToggle
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      disabled={!interactive}
      style={{
        width: '100%',
        background: 'rgba(8, 12, 18, 0.55)',
        border: `1px solid ${borderColor}`,
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        cursor: interactive ? 'pointer' : 'default',
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)',
        borderRadius: 0,
        transition: 'background var(--motion-fast) var(--ease-smooth), border-color var(--motion-fast) var(--ease-smooth)',
      }}
      onMouseEnter={interactive ? e => {
        e.currentTarget.style.background = accent === 'oxblood'
          ? 'rgba(159, 18, 57, 0.10)'
          : 'rgba(143, 191, 211, 0.06)'
      } : undefined}
      onMouseLeave={interactive ? e => {
        e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
      } : undefined}
    >
      <div
        aria-hidden="true"
        style={{
          width: 3, height: 18,
          background: textColor,
          boxShadow: accent === 'oxblood'
            ? '0 0 8px rgba(159, 18, 57, 0.55)'
            : '0 0 8px var(--color-ice-glow)',
        }}
      />
      <span
        style={{
          flex: 1,
          textAlign: 'left',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: textColor,
        }}
      >
        {label}
        {typeof count === 'number' && count > 0 && (
          <span style={{ marginLeft: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>
            [{count}]
          </span>
        )}
      </span>
      {rightSlot}
      {interactive && (
        <ChevronDown
          size={14}
          strokeWidth={2}
          color={textColor}
          style={{
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform var(--motion-base) var(--ease-emphasis)',
            flexShrink: 0,
          }}
        />
      )}
    </button>
  )
}

// ─── BodyAtmosphere ──────────────────────────────────────────────────────
/**
 * Wrapper de página que adiciona a atmosphere CP2077 + HIU (halos ice/fog
 * + grain + vinheta). Estilo cinematográfico igual ao Dashboard. Filhos
 * renderizam num layer acima dos overlays. Preferir esse wrapper em
 * páginas hero — listas simples podem usar só o body bg do app.
 */
export function BodyAtmosphere({
  children,
  variant = 'default',
  paddingX = 'var(--space-6)',
  paddingY = 'var(--space-5)',
}: {
  children: ReactNode
  variant?: 'default' | 'minimal'
  paddingX?: string
  paddingY?: string
}) {
  const bgGradients = variant === 'minimal'
    ? `
      radial-gradient(ellipse 60% 40% at 50% 0%, rgba(143, 191, 211, 0.06), transparent 70%),
      radial-gradient(ellipse 90% 50% at 50% 100%, rgba(40, 50, 57, 0.18), transparent 75%),
      transparent
    `
    : `
      radial-gradient(ellipse 50% 35% at 50% 12%, rgba(220, 224, 228, 0.10), transparent 75%),
      radial-gradient(ellipse 90% 55% at 50% 18%, rgba(50, 62, 73, 0.30), transparent 75%),
      radial-gradient(ellipse 40% 35% at 100% 45%, rgba(143, 191, 211, 0.08), transparent 70%),
      radial-gradient(ellipse 55% 45% at 0% 75%, rgba(40, 50, 57, 0.22), transparent 70%),
      radial-gradient(ellipse 50% 35% at 0% 8%, rgba(159, 18, 57, 0.05), transparent 60%),
      radial-gradient(ellipse 110% 70% at 50% 115%, rgba(0, 0, 0, 0.65), transparent 70%),
      #06080c
    `
  return (
    <div
      style={{
        padding: `${paddingY} ${paddingX} var(--space-10)`,
        position: 'relative',
        overflow: 'hidden',
        background: bgGradients,
      }}
    >
      {/* Grain extra-denso pra reforçar textura "filme". Só na variante default. */}
      {variant === 'default' && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            opacity: 0.13,
            mixBlendMode: 'overlay',
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='dn'><feTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0.6 0 0 0 0.45  0.7 0 0 0 0.55  0.85 0 0 0 0.7  0 0 0 0.8 0'/></filter><rect width='100%25' height='100%25' filter='url(%23dn)'/></svg>\")",
            zIndex: 0,
          }}
        />
      )}
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </div>
  )
}

// ─── PageShell ───────────────────────────────────────────────────────────
/**
 * Shell completo: hairline ice topo + header band + body atmosphere + footer.
 * Use em páginas hero (Dia, Quests, Tasks, Hub Finance pages, etc.) pra
 * garantir consistência visual com Dashboard sem reescrever o esqueleto.
 */
export function PageShell({
  headerLabel,
  headerLeftContent,
  headerRightMetadata,
  headerRightControls,
  children,
  footerCaption,
  atmosphere = 'default',
}: {
  headerLabel: string
  headerLeftContent?: ReactNode
  headerRightMetadata?: ReactNode
  headerRightControls?: ReactNode
  children: ReactNode
  footerCaption?: ReactNode
  atmosphere?: 'default' | 'minimal' | 'none'
}) {
  return (
    <div style={{ color: 'var(--color-text-primary)', position: 'relative' }}>
      {/* Hairline ice topo (vibe HIU) */}
      <div className="hq-hairline-ice" />

      <PageHeaderBand
        label={headerLabel}
        leftContent={headerLeftContent}
        rightMetadata={headerRightMetadata}
        rightControls={headerRightControls}
      />

      {atmosphere === 'none' ? (
        <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-10)' }}>
          {children}
          {footerCaption && <FooterCaption>{footerCaption}</FooterCaption>}
        </div>
      ) : (
        <BodyAtmosphere variant={atmosphere}>
          {children}
          {footerCaption && <FooterCaption>{footerCaption}</FooterCaption>}
        </BodyAtmosphere>
      )}
    </div>
  )
}

// ─── FooterCaption ───────────────────────────────────────────────────────
/** Disclaimer técnico mono no rodapé (estilo "CUSTOM GLITCHES ON UI" CP). */
export function FooterCaption({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: 32,
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--color-divider)',
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.12em',
        lineHeight: 1.6,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  )
}

// ─── InfoTooltip ─────────────────────────────────────────────────────────
/** Ícone Info em mono dim com tooltip nativo. Usado ao lado de tech labels. */
export function InfoTooltip({ title }: { title: string }) {
  return (
    <span
      title={title}
      style={{ display: 'inline-flex', color: 'var(--color-text-muted)', cursor: 'help' }}
    >
      <Info size={11} strokeWidth={1.8} />
    </span>
  )
}

// ─── DataReadoutFrame ────────────────────────────────────────────────────
/**
 * Frame de "score readout" CP2077 com brackets ice nos cantos + title bar
 * dotada e bottom-right chamfer. Usar em hero numbers do dashboard / hub
 * finance / quests resumos.
 */
export function DataReadoutFrame({
  title,
  meta,
  infoTooltip,
  children,
}: {
  title: string
  meta?: ReactNode
  infoTooltip?: string
  children: ReactNode
}) {
  return (
    <div
      className="hq-brackets-full"
      style={{
        position: 'relative',
        border: '1px solid var(--color-ice-deep)',
        background: `
          radial-gradient(ellipse 60% 100% at 50% 0%, rgba(143, 191, 211, 0.06), transparent 70%),
          radial-gradient(ellipse 80% 60% at 50% 100%, rgba(40, 50, 57, 0.30), transparent 70%),
          rgba(8, 12, 18, 0.65)
        `,
        padding: 0,
        color: 'var(--color-ice)',
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%)',
      }}
    >
      {/* Title bar */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--color-ice-deep)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'rgba(40, 50, 57, 0.45)',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 8, height: 8,
            background: 'var(--color-ice)',
            boxShadow: '0 0 8px var(--color-ice-glow)',
          }}
        />
        <span
          className="hq-tech-label"
          style={{
            color: 'var(--color-ice-light)',
            letterSpacing: '0.28em',
            flex: 1,
          }}
        >
          {title}
        </span>
        {meta && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
            }}
          >
            {meta}
          </span>
        )}
        {infoTooltip && <InfoTooltip title={infoTooltip} />}
      </div>
      {/* Content */}
      <div style={{ padding: '24px 28px' }}>{children}</div>
    </div>
  )
}
