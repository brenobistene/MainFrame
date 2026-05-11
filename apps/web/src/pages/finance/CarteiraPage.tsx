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
              duration={0.4}
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
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10, fontWeight: 700,
                    color: 'var(--color-text-secondary)',
                    padding: '4px 10px',
                    background: 'rgba(8, 12, 18, 0.55)',
                    border: '1px solid rgba(143, 191, 211, 0.22)',
                    letterSpacing: '0.05em',
                    borderRadius: 0,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span style={{ color: 'var(--color-ice-light)', fontWeight: 700, letterSpacing: '0.18em' }}>{moeda}</span>
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
              gap: 8,
              marginTop: 12,
              padding: '7px 12px',
              background: 'rgba(159, 18, 57, 0.10)',
              border: '1px solid var(--color-accent-primary)',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
              boxShadow: '0 0 10px rgba(159, 18, 57, 0.20)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10, fontWeight: 700,
              color: 'var(--color-accent-light)',
              letterSpacing: '0.18em', textTransform: 'uppercase',
            }}>
              <AlertCircle size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />
              <span>
                {naoConvertidas.length} conta{naoConvertidas.length === 1 ? '' : 's'} sem cotação —
                não soma{naoConvertidas.length === 1 ? '' : 'm'} no total. Defina pra incluir.
              </span>
            </div>
          )}
        </div>

        {/* Lista completa de carteiras */}
        <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-4)' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-3)',
            gap: 'var(--space-3)',
          }}>
            {/* Tab marker + // WALLETS [NN] mono */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 3,
                height: 14,
                background: 'var(--color-ice)',
                boxShadow: '0 0 8px var(--color-ice-glow)',
                flexShrink: 0,
              }} />
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                fontWeight: 700,
              }}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, letterSpacing: 0 }}>//</span>{' '}
                WALLETS [{accounts.length.toString().padStart(2, '0')}]
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
              gap: 6,
            }}>
              {accounts.map((a) => {
                const isForeign = a.moeda !== 'BRL'
                const brlEquiv = isForeign && a.cotacao_brl ? a.saldo * a.cotacao_brl : null
                const isNegative = a.saldo < 0
                // Border-left semântico: oxblood se devedor, ice-light se moeda
                // estrangeira, ice-deep neutro pra BRL positivo.
                const accentColor = isNegative
                  ? 'var(--color-accent-primary)'
                  : isForeign
                    ? 'var(--color-ice-light)'
                    : 'var(--color-ice-deep)'
                const dotGlow = isNegative
                  ? 'var(--color-accent-primary)'
                  : 'var(--color-ice-glow)'
                return (
                  <StaggerItem key={a.id} layout>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: '10px 14px',
                      background: 'rgba(8, 12, 18, 0.55)',
                      border: '1px solid rgba(143, 191, 211, 0.22)',
                      borderLeft: `2px solid ${accentColor}`,
                      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
                      transition: 'transform 0.18s var(--ease-emphasis), box-shadow 0.18s, border-color 0.18s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = 'translateX(2px)'
                      e.currentTarget.style.boxShadow = isNegative
                        ? '0 0 16px rgba(159, 18, 57, 0.18)'
                        : '0 0 16px rgba(143, 191, 211, 0.10)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = 'translateX(0)'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  >
                    {/* Square dot semântico com glow */}
                    <span style={{
                      width: 6, height: 6, flexShrink: 0,
                      background: accentColor,
                      boxShadow: `0 0 6px ${dotGlow}`,
                      opacity: 0.9,
                    }} />

                    {/* Currency badge mono — só pra moeda estrangeira */}
                    {isForeign && (
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9,
                        fontWeight: 700,
                        color: 'var(--color-ice-light)',
                        letterSpacing: '0.18em',
                        padding: '2px 6px',
                        background: 'rgba(143, 191, 211, 0.08)',
                        border: '1px solid rgba(143, 191, 211, 0.25)',
                        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
                        flexShrink: 0,
                      }}>
                        {a.moeda}
                      </span>
                    )}

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
                      gap: 2,
                    }}>
                      <span style={{
                        fontSize: 'var(--text-base)',
                        fontWeight: 600,
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                        color: isNegative
                          ? 'var(--color-accent-light)'
                          : 'var(--color-text-primary)',
                      }} className="hq-money">
                        {formatMoney(a.saldo, a.moeda)}
                      </span>
                      {brlEquiv !== null && (
                        <span className="hq-money" style={{
                          fontSize: 9,
                          fontFamily: 'var(--font-mono)',
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--color-text-muted)',
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
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

        {/* Footer ação cyber-mono */}
        <button
          onClick={() => setShowAccountsManager(true)}
          title="renomear / deletar / reordenar / conciliar"
          style={{
            width: '100%',
            background: 'rgba(143, 191, 211, 0.04)',
            border: 'none',
            borderTop: '1px solid var(--color-ice-deep)',
            padding: 'var(--space-3) var(--space-6)',
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            transition: 'background 0.18s, color 0.18s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
            e.currentTarget.style.color = 'var(--color-ice-light)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(143, 191, 211, 0.04)'
            e.currentTarget.style.color = 'var(--color-text-muted)'
          }}
        >
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, letterSpacing: 0 }}>//</span>
          GERENCIAR CARTEIRAS
          <span style={{ marginLeft: 'auto', opacity: 0.7 }}>→</span>
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
