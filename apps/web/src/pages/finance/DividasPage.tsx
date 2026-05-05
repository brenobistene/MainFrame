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
import { Landmark } from 'lucide-react'
import { useHubFinance } from './HubFinanceContext'
import {
  formatBRL,
  cardLabel, listRow, listRowTitle, listRowSub,
} from './components/styleHelpers'
import { Card } from '../../components/ui/Primitives'
import { DebtsManagerModal } from './components/DebtsManagerModal'

export function DividasPage() {
  const {
    debts, categories, accounts, loading, refreshAll,
  } = useHubFinance()
  const [showManager, setShowManager] = useState(false)

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>Carregando…</p>

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
        {/* Hairline accent — linha sutil oxblood no topo */}
        <div style={{
          height: 1,
          background: 'linear-gradient(90deg, transparent, var(--color-accent-primary), transparent)',
          opacity: 0.5,
        }} />
        {/* Header com gradient sutil */}
        <div style={{
          padding: 'var(--space-5) var(--space-6) var(--space-4)',
          background: `
            radial-gradient(ellipse 100% 80% at 0% 0%, rgba(159, 18, 57, 0.06), transparent 60%),
            linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
          `,
          borderBottom: '1px solid var(--color-divider)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)',
          }}>
            <Landmark size={12} strokeWidth={1.8} style={{ color: 'var(--color-text-tertiary)' }} />
            <span style={cardLabel}>Dívidas</span>
            {ativas.length > 0 && (
              <span style={{
                fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)',
                fontFamily: 'var(--font-mono)',
              }}>
                {ativas.length} ativa{ativas.length === 1 ? '' : 's'}
              </span>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={() => setShowManager(true)} style={{
              background: 'transparent', border: '1px solid var(--color-border)', cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              fontSize: 'var(--text-xs)',
              padding: '5px var(--space-3)', borderRadius: 'var(--radius-sm)',
              fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
              transition: 'color var(--motion-fast) var(--ease-smooth), border-color var(--motion-fast) var(--ease-smooth)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-accent-light)'
              e.currentTarget.style.borderColor = 'var(--color-accent-light)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-tertiary)'
              e.currentTarget.style.borderColor = 'var(--color-border)'
            }}>
              gerenciar / nova →
            </button>
          </div>
        </div>
        <div style={{ padding: 'var(--space-5) var(--space-6)' }}>

        {ativas.length === 0 ? (
          <div style={{
            padding: '20px 16px',
            border: '1px dashed var(--color-border)', borderRadius: 4,
            textAlign: 'center', color: 'var(--color-text-muted)',
            fontSize: 11, fontStyle: 'italic',
          }}>
            nenhuma dívida ativa. cadastre faculdade, financiamento ou parcelamento
            via "gerenciar".
          </div>
        ) : (
          <>
            {/* Hero: total devedor + barra de progresso global */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
              marginBottom: 14,
            }}>
              <div>
                <div style={{
                  fontSize: 9, color: 'var(--color-text-muted)',
                  letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4,
                }}>
                  Total devedor
                </div>
                <div className="hq-money" style={{
                  fontSize: 22, fontWeight: 700,
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {formatBRL(totalDevedor)}
                </div>
                <div style={{
                  fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2,
                }}>
                  de <span className="hq-money">{formatBRL(totalOriginal)}</span> ({progressoGlobal.toFixed(0)}% pago)
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                <div style={{
                  height: 6, background: 'var(--color-border)',
                  borderRadius: 2, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%', width: `${progressoGlobal}%`,
                    background: progressoGlobal >= 75
                      ? 'var(--color-success)'
                      : progressoGlobal >= 30
                        ? 'var(--color-accent-light)'
                        : 'var(--color-accent-primary)',
                    transition: 'width 0.3s',
                  }} />
                </div>
              </div>
            </div>

            {/* Lista completa (sem clip — esta é a página dedicada) */}
            <div style={{
              fontSize: 9, color: 'var(--color-text-muted)',
              letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8,
            }}>
              Próximas a quitar
            </div>
            <div className="hq-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {sortedAtivas.map((d, i) => (
                <div
                  key={d.id}
                  className="hq-row-hoverable hq-animate-fade-up"
                  style={{
                    ...listRow,
                    padding: 'var(--space-2) var(--space-3)',
                    borderRadius: 'var(--radius-sm)',
                    ['--stagger-i' as any]: i,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={listRowTitle}>{d.descricao}</div>
                    <div style={listRowSub}>
                      {d.parcelas_restantes != null
                        ? `${d.parcelas_restantes} parcela${d.parcelas_restantes === 1 ? '' : 's'} restante${d.parcelas_restantes === 1 ? '' : 's'} · ${d.progresso_pct.toFixed(0)}% pago`
                        : `${d.progresso_pct.toFixed(0)}% pago`}
                    </div>
                  </div>
                  <span className="hq-money" style={{
                    fontSize: 'var(--text-sm)', fontWeight: 600,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--color-text-primary)',
                  }}>
                    {formatBRL(d.saldo_devedor)}
                  </span>
                </div>
              ))}
            </div>
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
