/**
 * Contas / Receitas Fixas — página dedicada pra recorrências mensais.
 *
 * Saiu da Visão Geral porque cadastrar e marcar como pago/recebido é
 * função de gestão. A versão consolidada (ranking de status, total a pagar
 * vs já pago) continua disponível no card "Compromissos do Mês" da Visão
 * Geral, que junta essas fixas + parcelas de dívida do mês.
 *
 * Os dois cards (despesa + receita) ficam side-by-side, mesmo padrão visual
 * da Visão Geral original. Botão "gerenciar" abre o RecurringBillsModal.
 *
 * Doc: docs/hub-finance/PLAN.md
 */
import { useState } from 'react'
import { useHubFinance } from './HubFinanceContext'
import {
  formatBRL,
  cardLabel, listRow, listRowTitle, listRowSub,
} from './components/styleHelpers'
import { Card } from '../../components/ui/Primitives'
import { RecurringBillsModal } from './components/RecurringBillsModal'

const twoColumns: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
  gap: 16,
}

export function FixasPage() {
  const {
    accounts, categories, recurringBills, recurringBillsStatus, loading,
    refreshAll,
  } = useHubFinance()
  const [showManager, setShowManager] = useState(false)

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>Carregando…</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={twoColumns}>
        <CardRecorrenciasFixas
          tipo="despesa"
          bills={recurringBills}
          status={recurringBillsStatus}
          onManage={() => setShowManager(true)}
        />
        <CardRecorrenciasFixas
          tipo="receita"
          bills={recurringBills}
          status={recurringBillsStatus}
          onManage={() => setShowManager(true)}
        />
      </div>

      {showManager && (
        <RecurringBillsModal
          bills={recurringBills}
          status={recurringBillsStatus}
          accounts={accounts}
          categories={categories}
          onClose={() => setShowManager(false)}
          onChanged={refreshAll}
        />
      )}
    </div>
  )
}

// ─── Card de fixas (mesma forma usada antes na Visão Geral) ────────────

function CardRecorrenciasFixas({ tipo, bills, status, onManage }: {
  tipo: 'despesa' | 'receita'
  bills: ReturnType<typeof useHubFinance>['recurringBills']
  status: ReturnType<typeof useHubFinance>['recurringBillsStatus']
  onManage: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isReceita = tipo === 'receita'
  const ativas = bills.filter(b => b.ativa && b.tipo === tipo)
  const items = (status?.items ?? []).filter(i => i.tipo === tipo)
  const totalEstimado = isReceita
    ? (status?.receita_total_estimado ?? ativas.reduce((s, b) => s + b.valor_estimado, 0))
    : (status?.despesa_total_estimado ?? ativas.reduce((s, b) => s + b.valor_estimado, 0))
  const totalPago = isReceita
    ? (status?.receita_total_recebido ?? 0)
    : (status?.despesa_total_pago ?? 0)
  const totalPendente = isReceita
    ? (status?.receita_total_pendente ?? totalEstimado)
    : (status?.despesa_total_pendente ?? totalEstimado)
  const completedStatus = isReceita ? 'recebida' : 'paga'
  const completedCount = items.filter(i => i.status === completedStatus).length
  const atrasadas = items.filter(i => i.status === 'atrasada').length
  const pendentes = items.filter(i => i.status === 'pendente').length

  // Ordena: atrasadas primeiro (urgência), depois pendentes (por dia),
  // depois completas (já resolvidas vão pro fim).
  const STATUS_ORDER: Record<string, number> = {
    atrasada: 0, pendente: 1, paga: 2, recebida: 2,
  }
  const sortedItems = [...items].sort((a, b) => {
    const ord = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    if (ord !== 0) return ord
    return (a.dia_vencimento ?? 99) - (b.dia_vencimento ?? 99)
  })
  const visibleItems = expanded ? sortedItems : sortedItems.slice(0, 3)
  const hiddenCount = sortedItems.length - visibleItems.length

  const titulo = isReceita ? 'Receitas fixas do mês' : 'Contas fixas do mês'
  const labelEstimado = 'Estimado'
  const labelDone = isReceita ? 'Já recebido' : 'Já pago'
  const labelPendente = isReceita ? 'A receber' : 'Falta'
  const completedColor = 'var(--color-success-light)'
  const itemUnit = isReceita ? 'receita' : 'conta'

  return (
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
          <span style={cardLabel}>{titulo}</span>
          {ativas.length > 0 && (
            <span style={{
              fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
            }}>
              {ativas.length} ativa{ativas.length === 1 ? '' : 's'}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onManage} style={{
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
          {isReceita
            ? 'nenhuma receita fixa cadastrada. clique em "gerenciar / nova" pra cadastrar salário, mesada ou contratos.'
            : 'nenhuma conta fixa cadastrada. clique em "gerenciar / nova" pra cadastrar luz, água, internet, aluguel ou streaming.'}
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16,
            marginBottom: 14,
          }}>
            <div>
              <div style={{
                fontSize: 9, color: 'var(--color-text-muted)',
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4,
              }}>
                {labelEstimado}
              </div>
              <div className="hq-money" style={{
                fontSize: 18, fontWeight: 700,
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {formatBRL(totalEstimado)}
              </div>
            </div>
            <div>
              <div style={{
                fontSize: 9, color: 'var(--color-text-muted)',
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4,
              }}>
                {labelDone}
              </div>
              <div className="hq-money" style={{
                fontSize: 18, fontWeight: 700,
                color: completedColor,
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {formatBRL(totalPago)}
              </div>
            </div>
            <div>
              <div style={{
                fontSize: 9, color: 'var(--color-text-muted)',
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4,
              }}>
                {labelPendente}
              </div>
              <div className="hq-money" style={{
                fontSize: 18, fontWeight: 700,
                color: atrasadas > 0 ? 'var(--color-error)' : 'var(--color-text-primary)',
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {formatBRL(totalPendente)}
              </div>
            </div>
          </div>

          <div style={{
            height: 4, background: 'var(--color-border)',
            borderRadius: 2, overflow: 'hidden', marginBottom: 14,
          }}>
            <div style={{
              height: '100%',
              width: `${totalEstimado > 0 ? Math.min(100, (totalPago / totalEstimado) * 100) : 0}%`,
              background: completedColor,
              transition: 'width 0.3s',
            }} />
          </div>

          <div style={{
            display: 'flex', gap: 'var(--space-3)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-tertiary)',
            marginBottom: 'var(--space-3)',
          }}>
            {completedCount > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: completedColor,
                  boxShadow: '0 0 6px rgba(122, 154, 138, 0.5)',
                }} />
                {completedCount} {isReceita
                  ? `recebida${completedCount === 1 ? '' : 's'}`
                  : `paga${completedCount === 1 ? '' : 's'}`}
              </span>
            )}
            {atrasadas > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-error)' }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--color-error)',
                  boxShadow: '0 0 6px rgba(220, 38, 38, 0.5)',
                }} />
                {atrasadas} atrasada{atrasadas === 1 ? '' : 's'}
              </span>
            )}
            {pendentes > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--color-text-muted)',
                }} />
                {pendentes} pendente{pendentes === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {sortedItems.length > 0 && (
            <div className="hq-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {visibleItems.map((item, i) => {
                const isDone = item.status === completedStatus
                const dotColor = isDone
                  ? completedColor
                  : item.status === 'atrasada'
                    ? 'var(--color-error)'
                    : 'var(--color-text-muted)'
                return (
                  <div
                    key={item.bill_id}
                    className="hq-row-hoverable hq-animate-fade-up"
                    style={{
                      ...listRow,
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-sm)',
                      ['--stagger-i' as any]: i,
                    }}
                  >
                    <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span
                        title={item.status}
                        style={{
                          width: 7, height: 7, borderRadius: '50%',
                          background: dotColor, flexShrink: 0,
                          boxShadow: item.status === 'atrasada'
                            ? '0 0 6px rgba(220, 38, 38, 0.5)'
                            : isDone
                              ? '0 0 6px rgba(122, 154, 138, 0.5)'
                              : 'none',
                        }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={listRowTitle}>{item.descricao}</div>
                        <div style={listRowSub}>
                          {isDone && item.data_pagamento
                            ? `${isReceita ? 'recebida' : 'paga'} em ${item.data_pagamento.split('-').reverse().slice(0, 2).join('/')}`
                            : item.dia_vencimento
                              ? `${isReceita ? 'cai dia' : 'vence dia'} ${item.dia_vencimento}`
                              : 'sem dia fixo'}
                        </div>
                      </div>
                    </div>
                    <span className="hq-money" style={{
                      fontSize: 'var(--text-sm)', fontWeight: 600,
                      fontFamily: 'var(--font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                      color: isDone
                        ? 'var(--color-text-primary)'
                        : 'var(--color-text-secondary)',
                    }}>
                      {formatBRL(item.valor_pago ?? item.valor_estimado)}
                    </span>
                  </div>
                )
              })}
              {(hiddenCount > 0 || expanded) && sortedItems.length > 3 && (
                <button
                  type="button"
                  onClick={() => setExpanded(v => !v)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 'var(--text-xs)',
                    fontFamily: 'var(--font-body)',
                    color: 'var(--color-text-tertiary)',
                    padding: 'var(--space-2)',
                    marginTop: 'var(--space-1)',
                    textAlign: 'center',
                    borderRadius: 'var(--radius-sm)',
                    transition: 'color var(--motion-fast) var(--ease-smooth), background var(--motion-fast) var(--ease-smooth)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.color = 'var(--color-text-primary)'
                    e.currentTarget.style.background = 'var(--glass-bg-hover)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.color = 'var(--color-text-tertiary)'
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {expanded
                    ? '↑ ver menos'
                    : `↓ ver mais ${hiddenCount} ${itemUnit}${hiddenCount === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
          )}
        </>
      )}
      </div>
    </Card>
  )
}
