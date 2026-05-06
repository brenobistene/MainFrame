/**
 * Carteira — página dedicada pro gerenciamento das carteiras (banco /
 * dinheiro / USD / cartão de crédito / etc).
 *
 * Renomeada de "Contas" pra evitar ambiguidade com "contas a pagar" /
 * "contas fixas" (que são bills, não bank accounts). Internamente o código
 * ainda usa `FinAccount` / `account_id` / endpoint `/accounts` — só o
 * vocabulário visível pro usuário virou "carteira".
 *
 * Doc: docs/hub-finance/PLAN.md
 */
import { useMemo, useState } from 'react'
import { AlertCircle, Pencil, Plus, Wallet } from 'lucide-react'
import { useHubFinance } from './HubFinanceContext'
import {
  formatBRL, formatMoney, primaryButton, ICON_SIZE, ICON_STROKE,
} from './components/styleHelpers'
import { Card, IconButton, EmptyState } from '../../components/ui/Primitives'
import { AnimatedNumber, StaggerList, StaggerItem, SkeletonStatCard, SkeletonRow } from '../../components/ui/Motion'
import { ExchangeRateModal } from './components/ExchangeRateModal'
import { AccountManagerModal } from './components/AccountManagerModal'
import { AccountModal } from './components/AccountModal'
import type { FinAccount } from '../../types'

export function CarteiraPage() {
  const { accounts, summary, loading, refreshAll, refreshGlobal } = useHubFinance()
  const [editingRateAccount, setEditingRateAccount] = useState<FinAccount | null>(null)
  const [showAccountsManager, setShowAccountsManager] = useState(false)
  const [showNewAccount, setShowNewAccount] = useState(false)

  const cotacoes = summary?.cotacoes_usadas ?? {}
  const naoConvertidas = summary?.saldos_nao_convertidos ?? []
  const moedasConvertidas = useMemo(() => {
    return Object.entries(cotacoes).map(([moeda, rate]) => ({
      moeda,
      rate,
      brl: summary?.saldos_convertidos_por_moeda?.[moeda] ?? 0,
      nativo: summary?.saldos_por_moeda?.[moeda] ?? 0,
    }))
  }, [summary, cotacoes])

  if (loading) return (
    <div className="hq-glass" style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <SkeletonStatCard labelWidth={100} numberWidth={240} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
        {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Card padding="none" style={{
        animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
        overflow: 'hidden',
      }}>
        {/* Header com atmosphere ice/fog — vibe HUD CP2077 */}
        <div style={{
          padding: 'var(--space-6) var(--space-6) var(--space-5)',
          background: `
            radial-gradient(ellipse 100% 80% at 0% 0%, rgba(143, 191, 211, 0.06), transparent 60%),
            radial-gradient(ellipse 60% 80% at 100% 0%, rgba(50, 62, 73, 0.20), transparent 65%),
            linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
          `,
          borderBottom: '1px solid var(--color-ice-deep)',
          position: 'relative',
        }}>
          <div
            className="hq-hairline-ice"
            style={{
              position: 'absolute', top: 0, left: 0, right: 0,
            }}
          />
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            fontWeight: 700,
            marginBottom: 'var(--space-2)',
          }}>
            <Wallet size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, letterSpacing: 0 }}>//</span>
            BALANCE.TOTAL
          </div>
          <div className="hq-money" style={{
            fontSize: 'var(--text-4xl)',
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
            // Champagne quando positivo (prosperidade — Mercury/Stripe vibe).
            // Oxblood-light só quando negativo (alerta real).
            color: (summary?.saldo_total ?? 0) < 0
              ? 'var(--color-accent-light)'
              : 'var(--color-ice)',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            textShadow: (summary?.saldo_total ?? 0) >= 0
              ? '0 0 24px var(--color-ice-glow)'
              : 'none',
          }}>
            <AnimatedNumber
              value={summary?.saldo_total ?? 0}
              format={n => formatBRL(n)}
              duration={1.0}
            />
          </div>

          {moedasConvertidas.length > 0 && (
            <div style={{
              display: 'flex',
              gap: 'var(--space-2)',
              marginTop: 'var(--space-3)',
              flexWrap: 'wrap',
            }}>
              {moedasConvertidas.map(({ moeda, rate, nativo }) => (
                <span
                  key={moeda}
                  title={`${moeda} convertido a R$${rate.toFixed(4)}/${moeda}`}
                  style={{
                    fontSize: 'var(--text-xs)',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--color-text-secondary)',
                    padding: '4px var(--space-2)',
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-pill)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span style={{ color: 'var(--color-accent-light)', fontWeight: 600 }}>{moeda}</span>
                  <span className="hq-money">{formatMoney(nativo, moeda)}</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>· {rate.toFixed(2)}</span>
                </span>
              ))}
            </div>
          )}

          {naoConvertidas.length > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              marginTop: 'var(--space-3)',
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-danger-bg)',
              border: '1px solid var(--color-danger-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-error)',
            }}>
              <AlertCircle size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />
              <span>
                {naoConvertidas.length} conta{naoConvertidas.length === 1 ? '' : 's'} sem cotação —
                não soma{naoConvertidas.length === 1 ? '' : 'm'} no total. Defina pra incluir.
              </span>
            </div>
          )}
        </div>

        {/* Lista completa de contas (sem clip de 4) */}
        <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-4)' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-3)',
            gap: 'var(--space-3)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)',
            }}>
              <div style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-tertiary)',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontWeight: 600,
              }}>
                Minhas carteiras
              </div>
              <div style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
              }}>
                {accounts.length} carteira{accounts.length === 1 ? '' : 's'}
              </div>
            </div>
            <button
              onClick={() => setShowNewAccount(true)}
              style={primaryButton()}
              title="Cadastrar nova carteira (banco, dinheiro, USD, cartão de crédito, etc)"
            >
              <Plus size={11} strokeWidth={2} style={{ marginRight: 4 }} />
              nova carteira
            </button>
          </div>

          {accounts.length === 0 ? (
            <EmptyState text="Adicione sua primeira carteira" dense />
          ) : (
            <StaggerList style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-1)',
            }}>
              {accounts.map((a) => {
                const isForeign = a.moeda !== 'BRL'
                const brlEquiv = isForeign && a.cotacao_brl ? a.saldo * a.cotacao_brl : null
                return (
                  <StaggerItem key={a.id} layout>
                  <div
                    className="hq-row-hoverable"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <span style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                    }}>
                      <span style={{
                        fontSize: 'var(--text-sm)',
                        color: 'var(--color-text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {a.nome}
                      </span>
                      {isForeign && (
                        <IconButton
                          label={a.cotacao_brl
                            ? `editar cotação (R$${a.cotacao_brl.toFixed(2)}/${a.moeda})`
                            : 'definir cotação'}
                          onClick={() => setEditingRateAccount(a)}
                          variant={a.cotacao_brl ? 'default' : 'danger'}
                        >
                          {a.cotacao_brl
                            ? <Pencil size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />
                            : <AlertCircle size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}
                        </IconButton>
                      )}
                    </span>
                    <span style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                    }}>
                      <span style={{
                        fontSize: 'var(--text-base)',
                        fontWeight: 600,
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                        color: a.saldo < 0
                          ? 'var(--color-error)'
                          : 'var(--color-text-primary)',
                      }} className="hq-money">
                        {formatMoney(a.saldo, a.moeda)}
                      </span>
                      {brlEquiv !== null && (
                        <span className="hq-money" style={{
                          fontSize: 'var(--text-xs)',
                          fontFamily: 'var(--font-mono)',
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--color-text-muted)',
                        }}>
                          ≈ {formatBRL(brlEquiv)}
                        </span>
                      )}
                    </span>
                  </div>
                  </StaggerItem>
                )
              })}
            </StaggerList>
          )}
        </div>

        {/* Footer ação */}
        <button
          onClick={() => setShowAccountsManager(true)}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            borderTop: '1px solid var(--color-divider)',
            padding: 'var(--space-3) var(--space-6)',
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            letterSpacing: '0.05em',
            cursor: 'pointer',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--glass-bg-hover)'
            e.currentTarget.style.color = 'var(--color-accent-light)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--color-text-tertiary)'
          }}
        >
          gerenciar carteiras (renomear / deletar / reordenar / conciliar)
          <span style={{ marginLeft: 'auto' }}>→</span>
        </button>
      </Card>

      {editingRateAccount && (
        <ExchangeRateModal
          account={editingRateAccount}
          onClose={() => setEditingRateAccount(null)}
          onSaved={() => { setEditingRateAccount(null); refreshAll() }}
        />
      )}

      {showAccountsManager && (
        <AccountManagerModal
          accounts={accounts}
          onClose={() => setShowAccountsManager(false)}
          onChanged={refreshAll}
        />
      )}

      {showNewAccount && (
        <AccountModal
          onClose={() => setShowNewAccount(false)}
          onCreated={() => { setShowNewAccount(false); refreshGlobal() }}
        />
      )}
    </div>
  )
}
