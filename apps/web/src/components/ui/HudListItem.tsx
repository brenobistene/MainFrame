/**
 * Componente reutilizável de lista HUD CP2077 — pareia THUMBNAIL angular
 * (top-left chamfer) + MAIN CARD (bottom-right chamfer). Vocabulário visual
 * compartilhado de PRESSURE.MATRIX e DEADLINE.QUEUE no Dashboard.
 *
 * Substituiu duas implementações inline (`ProjectRiskRow` e `DeadlineQueue
 * item`) que compartilhavam ~90% do código mas com diferenças sutis
 * (font size 14 vs 15, padding 10/16 vs 12/18, thumbnail width 56 vs 64).
 * Critique flagou isso como P3 — consistência por coincidência é frágil.
 *
 * Diferenças entre os call sites viraram props:
 *  - `thumbnailWidth`: 56 ou 64
 *  - `titleSize`: 14 ou 15
 *  - `mainPadding`: '10px 16px' ou '12px 18px'
 *  - `hoverTranslate`: ProjectRiskRow tem, DeadlineQueue não
 *
 * NÃO substitui `ProjectCell` (formato vertical compacto pra grid, sem
 * thumbnail). Extract de 3 estruturas visualmente diferentes seria forçar
 * abstração.
 */
import type { ReactNode } from 'react'

export interface HudListItemProps {
  /** Conteúdo do thumbnail à esquerda (geralmente data DD/MM + relative).
   *  Use `<HudDateThumbnail>` pro padrão comum. */
  thumbnail: ReactNode
  /** Cor base do thumbnail (vira tint linear-gradient 135deg). */
  tintColor: string
  /** Largura do thumbnail. Default 64. ProjectRiskRow usa 64, DeadlineQueue 56. */
  thumbnailWidth?: number
  /** Cor da borda (thumbnail + main card). Geralmente derivada do status. */
  borderColor: string
  /** Cor accent pro número do thumbnail (date). Geralmente igual borderColor
   *  mas mais saturada (ex: var(--color-accent-vivid) quando overdue). */
  accentColor: string
  /** Estado crítico — background do main card vira tint oxblood sutil. */
  severe?: boolean
  /** Título principal (vai como Rajdhani uppercase). */
  title: string
  /** Tamanho da fonte do título. Default 15 (ProjectRiskRow); use 14 pra DeadlineQueue. */
  titleSize?: 14 | 15
  /** Line-through no título (item concluído). */
  done?: boolean
  /** Linha de meta abaixo do título — area, type, status, etc. */
  caption?: ReactNode
  /** Terceira linha opcional — stats technical readout (// EXEC · EST · QUEUE). */
  stats?: ReactNode
  /** Painel direito opcional dentro do main card (metrics, progress bars, etc).
   *  Aparece ao lado direito do conteúdo texto, alinhado ao centro. */
  metricsRight?: ReactNode
  /** Padding do main card. Default '12px 18px'; use '10px 16px' pra DeadlineQueue. */
  mainPadding?: string
  /** Opacity reduzida (raro — geralmente done já basta). */
  dimmed?: number
  /** Click handler — torna o item button-like com translate hover. */
  onClick?: () => void
  /** Ativa translateX(2px) no hover. Default false. ProjectRiskRow ativa, DeadlineQueue não. */
  hoverTranslate?: boolean
  /** Aria-label / title pro acessibilidade. */
  title_attr?: string
}

export function HudListItem({
  thumbnail,
  tintColor,
  thumbnailWidth = 64,
  borderColor,
  accentColor: _accentColor,
  severe = false,
  title,
  titleSize = 15,
  done = false,
  caption,
  stats,
  metricsRight,
  mainPadding = '12px 18px',
  dimmed,
  onClick,
  hoverTranslate = false,
  title_attr,
}: HudListItemProps) {
  const opacity = dimmed ?? 1
  const isInteractive = !!onClick

  return (
    <div
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={isInteractive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      } : undefined}
      title={title_attr}
      aria-label={title_attr}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'stretch',
        gap: 6,
        marginBottom: 10,
        opacity,
        cursor: isInteractive ? 'pointer' : 'default',
        transition: hoverTranslate
          ? 'transform var(--motion-fast) var(--ease-smooth)'
          : undefined,
      }}
      onMouseEnter={hoverTranslate ? (e) => {
        e.currentTarget.style.transform = 'translateX(2px)'
      } : undefined}
      onMouseLeave={hoverTranslate ? (e) => {
        e.currentTarget.style.transform = 'translateX(0)'
      } : undefined}
    >
      {/* THUMBNAIL — chamfer top-left, gradient tint diagonal */}
      <div style={{
        width: thumbnailWidth,
        flexShrink: 0,
        background: `linear-gradient(135deg, ${tintColor}22, ${tintColor}08 60%, transparent)`,
        border: `1px solid ${borderColor}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        clipPath: 'polygon(8px 0, 100% 0, 100% 100%, 0 100%, 0 8px)',
      }}>
        {thumbnail}
      </div>

      {/* MAIN CARD — chamfer bottom-right, severe tint oxblood quando crítico */}
      <div style={{
        flex: 1,
        minWidth: 0,
        background: severe
          ? 'rgba(159, 18, 57, 0.08)'
          : 'rgba(8, 12, 18, 0.55)',
        border: `1px solid ${borderColor}`,
        padding: mainPadding,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)',
        transition: 'background var(--motion-fast) var(--ease-smooth)',
      }}>
        <div style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: stats ? 5 : 4,
        }}>
          {/* L1: Title em Rajdhani uppercase */}
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: titleSize,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textDecoration: done ? 'line-through' : 'none',
            lineHeight: 1.2,
          }}>
            {title}
          </div>

          {caption && (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              {caption}
            </div>
          )}

          {stats && (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              {stats}
            </div>
          )}
        </div>

        {metricsRight && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 6,
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
          }}>
            {metricsRight}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Date thumbnail helper ────────────────────────────────────────────────

export interface HudDateThumbnailProps {
  /** Dia (DD). */
  day: string
  /** Mês (MM) opcional. */
  month?: string
  /** Label relativa (HOJE / AMANHÃ / +3D). */
  relative: string
  /** Cor accent pro número da data. */
  accentColor: string
  /** Tamanho da fonte do número. Default 15 (ProjectRiskRow); use 14 pra DeadlineQueue. */
  dateSize?: 14 | 15
}

export function HudDateThumbnail({
  day,
  month,
  relative,
  accentColor,
  dateSize = 15,
}: HudDateThumbnailProps) {
  return (
    <>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: dateSize,
        fontWeight: 700,
        color: accentColor,
        letterSpacing: dateSize === 15 ? '0.02em' : '0.05em',
        lineHeight: 1,
      }}>
        {day}{month ? `/${month}` : ''}
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 8,
        fontWeight: 700,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.12em',
        marginTop: dateSize === 15 ? 4 : 3,
      }}>
        {relative}
      </div>
    </>
  )
}
