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
import { Plus } from 'lucide-react'
import { useHubFinance } from './HubFinanceContext'
import {
  formatBRL, listRowTitle, listRowSub,
} from './components/styleHelpers'
import { Card } from '../../components/ui/Primitives'
import { SkeletonStatCard, SkeletonRow } from '../../components/ui/Motion'
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

  if (loading) return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
      {[0, 1].map(col => (
        <div key={col} className="hq-glass" style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <SkeletonStatCard labelWidth={120} numberWidth={160} />
          {Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}
        </div>
      ))}
    </div>
  )

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

  const tagLabel = isReceita ? 'FIXED.IN' : 'FIXED.OUT'
  const labelEstimado = 'ESTIMADO'
  const labelDone = isReceita ? 'JÁ RECEBIDO' : 'JÁ PAGO'
  const labelPendente = isReceita ? 'A RECEBER' : 'FALTA'
  const completedColor = 'var(--color-success-light)'
  const itemUnit = isReceita ? 'receita' : 'conta'
  // Cor do "accent" semantic da seção: olive pra receita (positivo recorrente),
  // ice pra despesa (neutro-tactical, oxblood reservado pra atrasos).
  const sectionAccent = isReceita ? 'var(--color-success-light)' : 'var(--color-ice-light)'
  const sectionGlow = isReceita ? 'rgba(125, 154, 111, 0.5)' : 'var(--color-ice-glow)'

  return (
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
          {/* Tab marker semantic + // LABEL [NN] mono */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 3,
              height: 14,
              background: sectionAccent,
              boxShadow: `0 0 8px ${sectionGlow}`,
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
              {tagLabel} [{ativas.length.toString().padStart(2, '0')}]
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onManage} style={{
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
        /* Empty state clicável — todo o bloco é um botão que abre o manager.
           Antes era só texto explicativo, o que confundia novos usuários
           que não percebiam que o "GERENCIAR / NOVA →" no header servia
           pra criar a primeira. */
        <button
          type="button"
          onClick={onManage}
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
            {isReceita
              ? 'NENHUMA RECEITA FIXA · SALÁRIO / MESADA / CONTRATOS'
              : 'NENHUMA CONTA FIXA · LUZ / ÁGUA / INTERNET / ALUGUEL'}
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11, fontWeight: 700,
            color: 'var(--color-ice-light)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <Plus size={12} strokeWidth={2} />
            CRIAR {isReceita ? 'RECEITA FIXA' : 'CONTA FIXA'}
          </div>
        </button>
      ) : (
        <>
          {/* Stats grid: cada label cyber-mono `// LABEL` ice prefix */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16,
            marginBottom: 14,
          }}>
            <StatCell label={labelEstimado} value={totalEstimado} color="var(--color-text-primary)" />
            <StatCell label={labelDone} value={totalPago} color={completedColor} />
            <StatCell
              label={labelPendente}
              value={totalPendente}
              color={atrasadas > 0 ? 'var(--color-accent-light)' : 'var(--color-text-primary)'}
            />
          </div>

          {/* Progress 10-segment cyber */}
          <SegmentedProgress
            value={totalEstimado > 0 ? Math.min(100, (totalPago / totalEstimado) * 100) : 0}
            color={completedColor}
          />

          {/* Status pills com square dots */}
          <div style={{
            display: 'flex', gap: 'var(--space-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            color: 'var(--color-text-tertiary)',
            letterSpacing: '0.18em', textTransform: 'uppercase',
            marginTop: 'var(--space-3)',
            marginBottom: 'var(--space-3)',
          }}>
            {completedCount > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 6, height: 6,
                  background: completedColor,
                  boxShadow: '0 0 6px rgba(125, 154, 111, 0.55)',
                }} />
                {completedCount} {isReceita ? 'RCB' : 'PAGO'}
              </span>
            )}
            {atrasadas > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-accent-light)' }}>
                <span style={{
                  width: 6, height: 6,
                  background: 'var(--color-accent-primary)',
                  boxShadow: '0 0 6px rgba(159, 18, 57, 0.55)',
                }} />
                {atrasadas} ATRASO
              </span>
            )}
            {pendentes > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 6, height: 6,
                  background: 'var(--color-text-muted)',
                }} />
                {pendentes} PEND
              </span>
            )}
          </div>

          {sortedItems.length > 0 && (
            <div className="hq-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {visibleItems.map((item, i) => {
                const isDone = item.status === completedStatus
                const isAtrasada = item.status === 'atrasada'
                // Border-left semantic: oxblood pra atrasada (alerta), olive pra
                // completa, ice-deep pra pendente normal.
                const accentColor = isAtrasada
                  ? 'var(--color-accent-primary)'
                  : isDone
                    ? completedColor
                    : 'var(--color-ice-deep)'
                const dotGlow = isAtrasada
                  ? 'rgba(159, 18, 57, 0.55)'
                  : isDone
                    ? 'rgba(125, 154, 111, 0.55)'
                    : 'var(--color-ice-glow)'
                return (
                  <div
                    key={item.bill_id}
                    className="hq-animate-fade-up"
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
                      ['--stagger-i' as any]: i,
                      opacity: isDone ? 0.75 : 1,
                      transition: 'transform 0.18s var(--ease-emphasis), box-shadow 0.18s, border-color 0.18s, opacity 0.18s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = 'translateX(2px)'
                      e.currentTarget.style.opacity = '1'
                      e.currentTarget.style.boxShadow = isAtrasada
                        ? '0 0 14px rgba(159, 18, 57, 0.18)'
                        : isDone
                          ? '0 0 14px rgba(125, 154, 111, 0.16)'
                          : '0 0 14px rgba(143, 191, 211, 0.10)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = 'translateX(0)'
                      e.currentTarget.style.opacity = isDone ? '0.75' : '1'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  >
                    <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      {/* Square dot semantic com glow */}
                      <span
                        title={item.status}
                        style={{
                          width: 6, height: 6,
                          background: accentColor, flexShrink: 0,
                          boxShadow: `0 0 6px ${dotGlow}`,
                          opacity: 0.95,
                        }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={listRowTitle}>{item.descricao}</div>
                        <div style={listRowSub}>
                          {isDone && item.data_pagamento
                            ? `${isReceita ? 'RCB' : 'PG'} · ${item.data_pagamento.split('-').reverse().slice(0, 2).join('/')}`
                            : item.dia_vencimento
                              ? `${isReceita ? 'CAI' : 'VC'} DIA ${item.dia_vencimento}`
                              : 'SEM DIA FIXO'}
                        </div>
                      </div>
                    </div>
                    <span className="hq-money" style={{
                      fontSize: 'var(--text-sm)', fontWeight: 600,
                      fontFamily: 'var(--font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                      color: isAtrasada
                        ? 'var(--color-accent-light)'
                        : isDone
                          ? completedColor
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
                    background: 'rgba(8, 12, 18, 0.55)',
                    border: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700,
                    color: 'var(--color-text-muted)',
                    letterSpacing: '0.22em', textTransform: 'uppercase',
                    padding: '7px 12px',
                    marginTop: 6,
                    textAlign: 'center',
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.color = 'var(--color-ice-light)'
                    e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                    e.currentTarget.style.boxShadow = '0 0 8px rgba(143, 191, 211, 0.20)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.color = 'var(--color-text-muted)'
                    e.currentTarget.style.borderColor = 'var(--color-border)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  {expanded
                    ? '↑ VER MENOS'
                    : `↓ VER MAIS · ${hiddenCount.toString().padStart(2, '0')} ${(itemUnit + (hiddenCount === 1 ? '' : 's')).toUpperCase()}`}
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

// ─── Helpers locais (cyber HUD) ──────────────────────────────────────────

function StatCell({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9, fontWeight: 700,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        marginBottom: 6,
      }}>
        <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
        {label}
      </div>
      <div className="hq-money" style={{
        fontSize: 18, fontWeight: 700,
        color,
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-0.01em',
      }}>
        {formatBRL(value)}
      </div>
    </div>
  )
}

/** Progress bar 10-segment cyber CP2077 — bloquinhos preenchidos
 *  proporcional ao valor. Sem radius, gap entre blocos. */
function SegmentedProgress({ value, color }: { value: number; color: string }) {
  const segments = 10
  const filled = Math.round((value / 100) * segments)
  return (
    <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 6,
            background: i < filled ? color : 'rgba(143, 191, 211, 0.10)',
            border: i < filled
              ? '1px solid transparent'
              : '1px solid rgba(143, 191, 211, 0.18)',
            boxShadow: i < filled
              ? '0 0 6px rgba(125, 154, 111, 0.35)'
              : 'none',
            transition: 'background 0.3s, box-shadow 0.3s',
          }}
        />
      ))}
    </div>
  )
}
