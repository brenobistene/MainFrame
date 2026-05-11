/**
 * Dívidas — página dedicada pra cadastro e acompanhamento de dívidas
 * (financiamento, faculdade, parcelamento, empréstimo de família, etc).
 *
 * Saiu da Visão Geral porque dívida é função de gestão: cadastra, atualiza
 * cronograma de parcelas, marca paga, etc. A versão consolidada (parcelas
 * que caem no mês selecionado) continua disponível no card "Compromissos
 * do Mês" da Visão Geral.
 *
 * Click em "gerenciar" abre o DebtsManagerModal — que cobre criação,
 * edição, cronograma de parcelas. Nesta página mostramos todas as ativas
 * (sem clip de 3 como o card antigo da Visão Geral fazia).
 *
 * Doc: docs/hub-finance/PLAN.md
 */
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useHubFinance } from './HubFinanceContext'
import {
  formatBRL,
  listRowTitle, listRowSub,
} from './components/styleHelpers'
import { Card } from '../../components/ui/Primitives'
import { StaggerList, StaggerItem, SkeletonStatCard, SkeletonRow } from '../../components/ui/Motion'
import { DebtsManagerModal } from './components/DebtsManagerModal'

export function DividasPage() {
  const {
    debts, categories, accounts, loading, refreshAll,
  } = useHubFinance()
  const [showManager, setShowManager] = useState(false)

  if (loading) return (
    <div className="hq-glass" style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <SkeletonStatCard labelWidth={100} numberWidth={200} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
        {Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    </div>
  )

  const ativas = debts.filter(d => d.status === 'active')
  const totalDevedor = ativas.reduce((s, d) => s + d.saldo_devedor, 0)
  const totalOriginal = ativas.reduce((s, d) => s + d.valor_total_original, 0)
  const totalPago = ativas.reduce((s, d) => s + d.valor_pago, 0)
  const progressoGlobal = totalOriginal > 0 ? Math.min(100, (totalPago / totalOriginal) * 100) : 0

  // Ordena por menor parcelas restantes (= próximas a quitar) — incentivo positivo
  const sortedAtivas = [...ativas]
    .sort((a, b) => (a.parcelas_restantes ?? 999) - (b.parcelas_restantes ?? 999))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Card padding="none" style={{
        animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
      }}>
        {/* Hairline ice elétrica — assinatura HUD CP2077 */}
        <div className="hq-hairline-ice" />
        {/* Header com atmosphere ice/fog */}
        <div style={{
          padding: 'var(--space-5) var(--space-6) var(--space-4)',
          background: `
            radial-gradient(ellipse 100% 80% at 0% 0%, rgba(143, 191, 211, 0.05), transparent 60%),
            radial-gradient(ellipse 60% 80% at 100% 0%, rgba(50, 62, 73, 0.20), transparent 65%),
            linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
          `,
          borderBottom: '1px solid var(--color-ice-deep)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          }}>
            {/* Tab marker oxblood (debt = warn) + // DEBT.STACK [NN] mono */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 3,
                height: 14,
                background: 'var(--color-accent-primary)',
                boxShadow: '0 0 8px rgba(159, 18, 57, 0.55)',
                flexShrink: 0,
              }} />
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                fontWeight: 700,
              }}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                DEBT.STACK [{ativas.length.toString().padStart(2, '0')}]
              </span>
            </div>
            <div style={{ flex: 1 }} />
            <button onClick={() => setShowManager(true)} style={{
              background: 'rgba(8, 12, 18, 0.55)', border: '1px solid var(--color-border)', cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              padding: '5px 12px',
              letterSpacing: '0.22em', textTransform: 'uppercase',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-ice-light)'
              e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
              e.currentTarget.style.boxShadow = '0 0 8px rgba(143, 191, 211, 0.20)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-tertiary)'
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.boxShadow = 'none'
            }}>
              GERENCIAR / NOVA →
            </button>
          </div>
        </div>
        <div style={{ padding: 'var(--space-5) var(--space-6)' }}>

        {ativas.length === 0 ? (
          /* Empty state clicável — abre o manager direto pra criar a primeira dívida. */
          <button
            type="button"
            onClick={() => setShowManager(true)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              gap: 8,
              width: '100%',
              padding: '18px 16px',
              border: '1px dashed rgba(143, 191, 211, 0.30)',
              background: 'transparent',
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
              cursor: 'pointer',
              textAlign: 'left',
              color: 'inherit',
              transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.55)'
              e.currentTarget.style.background = 'rgba(143, 191, 211, 0.04)'
              e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.10)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.30)'
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10, fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.18em', textTransform: 'uppercase',
              lineHeight: 1.7,
            }}>
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              NENHUMA DÍVIDA ATIVA · FACULDADE / FINANCIAMENTO / EMPRÉSTIMO
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11, fontWeight: 700,
              color: 'var(--color-ice-light)',
              letterSpacing: '0.22em', textTransform: 'uppercase',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <Plus size={12} strokeWidth={2} />
              CRIAR DÍVIDA
            </div>
          </button>
        ) : (
          <>
            {/* Hero: total devedor + 10-segment progress global */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
              alignItems: 'center',
              marginBottom: 18,
            }}>
              <div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  marginBottom: 6,
                }}>
                  <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                  DEBT.TOTAL
                </div>
                <div className="hq-money" style={{
                  fontSize: 22, fontWeight: 700,
                  color: 'var(--color-accent-light)',
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '-0.02em',
                  textShadow: '0 0 18px rgba(159, 18, 57, 0.35)',
                }}>
                  {formatBRL(totalDevedor)}
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.18em', textTransform: 'uppercase',
                  marginTop: 6,
                }}>
                  DE <span className="hq-money" style={{ color: 'var(--color-text-secondary)' }}>{formatBRL(totalOriginal)}</span> · {progressoGlobal.toFixed(0)}% PAGO
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <DebtSegmentedProgress value={progressoGlobal} />
              </div>
            </div>

            {/* Lista completa: tab marker + // PRÓXIMAS.QUITAR [NN] */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{
                width: 3,
                height: 12,
                background: 'var(--color-ice)',
                boxShadow: '0 0 6px var(--color-ice-glow)',
                flexShrink: 0,
              }} />
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.22em', textTransform: 'uppercase',
              }}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                PRÓXIMAS.QUITAR [{sortedAtivas.length.toString().padStart(2, '0')}]
              </span>
            </div>
            <StaggerList style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sortedAtivas.map((d) => {
                const pct = d.progresso_pct ?? 0
                // Border-left semantic: ice-deep se quase quitado (>=75%),
                // accent-light se andou (>=30%), oxblood se longe.
                const accentColor = pct >= 75
                  ? 'var(--color-success-light)'
                  : pct >= 30
                    ? 'var(--color-accent-light)'
                    : 'var(--color-accent-primary)'
                const accentGlow = pct >= 75
                  ? 'rgba(125, 154, 111, 0.50)'
                  : pct >= 30
                    ? 'rgba(159, 18, 57, 0.40)'
                    : 'rgba(159, 18, 57, 0.55)'
                return (
                <StaggerItem key={d.id} layout>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 14px',
                    background: 'rgba(8, 12, 18, 0.55)',
                    border: '1px solid rgba(143, 191, 211, 0.22)',
                    borderLeft: `2px solid ${accentColor}`,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
                    transition: 'transform 0.18s var(--ease-emphasis), box-shadow 0.18s, border-color 0.18s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateX(2px)'
                    e.currentTarget.style.boxShadow = `0 0 16px ${accentGlow}`
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'translateX(0)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1 }}>
                    <span style={{
                      width: 6, height: 6,
                      background: accentColor, flexShrink: 0,
                      boxShadow: `0 0 6px ${accentGlow}`,
                      opacity: 0.95,
                    }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={listRowTitle}>{d.descricao}</div>
                      <div style={{
                        ...listRowSub,
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}>
                        {d.parcelas_restantes != null && (
                          <span>{d.parcelas_restantes.toString().padStart(2, '0')} PARC</span>
                        )}
                        <span style={{ opacity: 0.4 }}>·</span>
                        <span>{pct.toFixed(0)}% PG</span>
                        {/* Mini-progress 6-segment compacto inline */}
                        <DebtMiniProgress value={pct} accentColor={accentColor} />
                      </div>
                    </div>
                  </div>
                  <span className="hq-money" style={{
                    fontSize: 'var(--text-sm)', fontWeight: 600,
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--color-accent-light)',
                    flexShrink: 0,
                  }}>
                    {formatBRL(d.saldo_devedor)}
                  </span>
                </div>
                </StaggerItem>
                )
              })}
            </StaggerList>
          </>
        )}
        </div>
      </Card>

      {showManager && (
        <DebtsManagerModal
          categories={categories}
          accounts={accounts}
          onClose={() => setShowManager(false)}
          onChanged={refreshAll}
        />
      )}
    </div>
  )
}

// ─── Helpers locais (cyber HUD) ──────────────────────────────────────────

/** Hero progress 10-segment cyber CP2077 — cor gradiente conforme progresso:
 *  oxblood se longe (<30%), oxblood-light se andou (30-75%), olive-light se
 *  quase quitado (>=75%). */
function DebtSegmentedProgress({ value }: { value: number }) {
  const segments = 10
  const filled = Math.round((value / 100) * segments)
  const fillColor = value >= 75
    ? 'var(--color-success-light)'
    : value >= 30
      ? 'var(--color-accent-light)'
      : 'var(--color-accent-primary)'
  const fillGlow = value >= 75
    ? 'rgba(125, 154, 111, 0.40)'
    : 'rgba(159, 18, 57, 0.40)'
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 8,
            background: i < filled ? fillColor : 'rgba(143, 191, 211, 0.10)',
            border: i < filled
              ? '1px solid transparent'
              : '1px solid rgba(143, 191, 211, 0.18)',
            boxShadow: i < filled ? `0 0 6px ${fillGlow}` : 'none',
            transition: 'background 0.3s, box-shadow 0.3s',
          }}
        />
      ))}
    </div>
  )
}

/** Mini-progress 6-segment compacto — pra inline em row de dívida. */
function DebtMiniProgress({ value, accentColor }: { value: number; accentColor: string }) {
  const segments = 6
  const filled = Math.round((value / 100) * segments)
  return (
    <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 8,
            height: 4,
            background: i < filled ? accentColor : 'rgba(143, 191, 211, 0.12)',
            opacity: i < filled ? 0.85 : 1,
            transition: 'background 0.3s',
          }}
        />
      ))}
    </div>
  )
}
