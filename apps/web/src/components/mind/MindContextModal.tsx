/**
 * MindContextModal — modal de contexto pra meditar/pensar no /exec.
 *
 * Aberto ao clicar no card Mind: mostra o que o usuário tem pra
 * confrontar/pensar nessa sessão de meditação. Sem isso, o user dá PLAY no
 * timer "no ar" — sem saber qual hipótese atacar nem por onde começar.
 *
 * Estrutura:
 *  - CHALLENGES (hipóteses com recorrência ≥ min_aparicoes na janela) —
 *    em destaque âmbar, esses são os alvos prioritários da sessão
 *  - PENDENTES (hipóteses sem padrão claro ainda) — secundário, lista enxuta
 *  - Atalho pro /mind se user quer ver tudo
 *
 * Modal é read-only (não muta nada). Para registrar a sessão, o user fecha
 * o modal e usa o fluxo normal PLAY → PAUSE → FINALIZAR no card.
 *
 * Estética: vocabulário cyber CP2077 do dashboard — hq-glass-elevated,
 * hq-chamfer-cross, hq-tech-label `// MIND`, hq-brackets-full. Sem invenção.
 */
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ChevronRight, Eye, X } from 'lucide-react'

import { useMindChallenges, useMindHipoteses } from '../../lib/health-queries'

const MIND_COR = '#9b88c4'

export function MindContextModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { data: challenges = [], isLoading: loadingC } = useMindChallenges()
  const { data: pending = [], isLoading: loadingP } = useMindHipoteses('pending')

  const loading = loadingC || loadingP
  // Pendentes que não estão entre os challenges (evita duplicar visualmente)
  const challengeIds = new Set(challenges.map(c => c.hipotese.id))
  const otherPending = pending.filter(h => !challengeIds.has(h.id))

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        overflow: 'hidden',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="hq-brackets-full"
        style={{
          width: 'min(640px, calc(100vw - 32px))',
          background: `
            radial-gradient(ellipse 60% 100% at 50% 0%, rgba(155, 136, 196, 0.08), transparent 70%),
            radial-gradient(ellipse 80% 60% at 50% 100%, rgba(40, 50, 57, 0.25), transparent 70%),
            rgba(8, 12, 18, 0.95)
          `,
          border: `1px solid ${MIND_COR}55`,
          color: MIND_COR,
          padding: 0,
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          boxSizing: 'border-box',
          boxShadow: 'var(--shadow-modal), 0 0 0 1px rgba(0,0,0,0.4)',
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)',
        }}
      >
        {/* TITLE BAR */}
        <div style={{
          padding: '10px 18px',
          borderBottom: `1px solid ${MIND_COR}33`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'rgba(40, 50, 57, 0.45)',
        }}>
          <div
            aria-hidden="true"
            style={{
              width: 8, height: 8,
              background: MIND_COR,
              boxShadow: `0 0 8px ${MIND_COR}aa`,
              flexShrink: 0,
            }}
          />
          <Eye size={13} strokeWidth={1.8} color={MIND_COR} />
          <span
            className="hq-tech-label"
            style={{ color: MIND_COR, letterSpacing: '0.28em', fontSize: 11 }}
          >
            MIND · CONTEXTO
          </span>
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)', marginLeft: 'auto', marginRight: 8 }}
          >
            {challenges.length} CHALLENGE · {pending.length} PENDENTE
          </span>
          <button
            onClick={onClose}
            aria-label="fechar"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              padding: 4,
              display: 'inline-flex',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* BODY */}
        <div style={{ padding: '18px 22px 16px' }}>
          <div
            aria-hidden="true"
            className="hq-hairline-ice"
            style={{ marginBottom: 14 }}
          />

          <p style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            lineHeight: 1.55,
            marginTop: 0,
            marginBottom: 18,
            fontStyle: 'italic',
          }}>
            O que confrontar nessa sessão. Mind se faz, não se monitora — use o tempo
            pra atacar hipóteses recorrentes ou clarificar pendências sem padrão.
          </p>

          {/* CHALLENGES */}
          <section style={{ marginBottom: 18 }}>
            <SectionLabel
              icon={<AlertTriangle size={11} strokeWidth={2} />}
              label="HIPÓTESES A CONFRONTAR"
              count={challenges.length}
              accent="var(--color-warning)"
            />
            {loading ? (
              <Skeleton count={2} />
            ) : challenges.length === 0 ? (
              <EmptyHint text="Sem padrão recorrente nessa janela. Sessão livre pra explorar pendentes." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {challenges.map(c => (
                  <div
                    key={c.hipotese.id}
                    className="hq-chamfer-bl"
                    style={{
                      padding: '10px 12px',
                      borderLeft: '2px solid var(--color-warning)',
                      background: 'rgba(192, 138, 58, 0.06)',
                      border: '1px solid rgba(192, 138, 58, 0.25)',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 6,
                    }}>
                      <span
                        className="hq-tech-id"
                        style={{
                          color: 'var(--color-warning)',
                          letterSpacing: '0.18em',
                          fontSize: 9,
                        }}
                      >
                        {c.hipotese.aparicoes_recentes}x · RECORRENTE
                      </span>
                      {c.tags_relacionadas.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexWrap: 'wrap' }}>
                          {c.tags_relacionadas.slice(0, 3).map(t => (
                            <span
                              key={t.tag_slug}
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: 8,
                                fontWeight: 700,
                                letterSpacing: '0.1em',
                                textTransform: 'uppercase',
                                color: t.tag_cor || 'var(--color-text-muted)',
                                padding: '1px 5px',
                                border: `1px solid ${t.tag_cor || 'var(--color-border)'}55`,
                                background: `${t.tag_cor || '#7fb8a8'}10`,
                              }}
                            >
                              {t.tag_nome}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 13,
                      color: 'var(--color-text-primary)',
                      fontStyle: 'italic',
                      lineHeight: 1.5,
                    }}>
                      "{c.hipotese.texto}"
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* PENDENTES */}
          <section style={{ marginBottom: 18 }}>
            <SectionLabel
              icon={<Eye size={11} strokeWidth={2} />}
              label="PENDENTES SEM PADRÃO"
              count={otherPending.length}
              accent={MIND_COR}
            />
            {loading ? (
              <Skeleton count={3} />
            ) : otherPending.length === 0 ? (
              <EmptyHint
                text={
                  pending.length > 0
                    ? 'Todas as pendentes já apareceram como challenge acima.'
                    : 'Nenhuma hipótese pendente — log livre.'
                }
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {otherPending.slice(0, 6).map(h => (
                  <div
                    key={h.id}
                    style={{
                      padding: '6px 10px',
                      borderLeft: `1px solid ${MIND_COR}55`,
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                    }}
                  >
                    <span
                      className="hq-tech-id"
                      style={{
                        color: 'var(--color-text-muted)',
                        flexShrink: 0,
                        letterSpacing: '0.14em',
                      }}
                    >
                      {h.aparicoes_recentes}x
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      lineHeight: 1.45,
                      fontStyle: 'italic',
                      flex: 1,
                      minWidth: 0,
                    }}>
                      "{h.texto}"
                    </span>
                  </div>
                ))}
                {otherPending.length > 6 && (
                  <span
                    className="hq-tech-id"
                    style={{
                      color: 'var(--color-text-muted)',
                      fontStyle: 'italic',
                      marginLeft: 10,
                      marginTop: 4,
                    }}
                  >
                    + {otherPending.length - 6} outras
                  </span>
                )}
              </div>
            )}
          </section>

          {/* Footer link */}
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            paddingTop: 12,
            borderTop: `1px dashed ${MIND_COR}33`,
          }}>
            <button
              type="button"
              onClick={() => { onClose(); navigate('/mind') }}
              style={{
                background: `${MIND_COR}15`,
                border: `1px solid ${MIND_COR}55`,
                color: MIND_COR,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                padding: '6px 12px',
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: `0 0 10px ${MIND_COR}22`,
              }}
            >
              VER TUDO EM /MIND
              <ChevronRight size={11} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function SectionLabel({
  icon,
  label,
  count,
  accent,
}: {
  icon: React.ReactNode
  label: string
  count: number
  accent: string
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      paddingBottom: 8,
      marginBottom: 8,
      borderBottom: '1px solid var(--color-border-strong)',
    }}>
      <span style={{ color: accent, display: 'inline-flex' }}>{icon}</span>
      <span
        className="hq-tech-label"
        style={{ color: accent, letterSpacing: '0.22em', fontSize: 10 }}
      >
        {label}
      </span>
      <span
        className="hq-tech-id"
        style={{ color: 'var(--color-text-muted)', marginLeft: 'auto' }}
      >
        [{count}]
      </span>
    </div>
  )
}

function Skeleton({ count }: { count: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="hq-skeleton"
          style={{ height: 44, opacity: 0.7 - i * 0.12 }}
        />
      ))}
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{
      padding: '8px 4px',
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      color: 'var(--color-text-muted)',
      letterSpacing: '0.08em',
      fontStyle: 'italic',
    }}>
      {text}
    </div>
  )
}
