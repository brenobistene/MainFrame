/**
 * Visão Geral — dashboard inicial do Hub Finance.
 *
 * Layout 2 colunas (estilo Organizze, mas dark tactical). Esquerda foca em
 * fluxo de caixa (saldo + contas a pagar). Direita complementa (faturas +
 * contas a receber). Compromissos do mês ocupa full-width no topo.
 *
 * Cards são compactos com link "ver tudo" pra sub-página correspondente.
 */
import { useMemo, useState } from 'react'
import { Wallet } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useHubFinance } from './HubFinanceContext'
import {
  formatBRL, ICON_SIZE, ICON_STROKE,
  listRowTitle, listRowSub,
} from './components/styleHelpers'
import { Card, EmptyState } from '../../components/ui/Primitives'
import { AnimatedNumber, StaggerList, StaggerItem, SkeletonStatCard, SkeletonCardGrid } from '../../components/ui/Motion'
import { InvoicesManagerModal } from './components/InvoicesManagerModal'
import { MonthPicker } from './components/MonthPicker'

export function VisaoGeralPage() {
  const {
    accounts, summary, transactions, monthlySummary,
    invoices,
    monthCommitments, selectedMonth, setSelectedMonth, loading,
    refreshAll,
  } = useHubFinance()
  const navigate = useNavigate()

  // Modal de gerenciamento de faturas (substituiu a aba "Cartões")
  const [showInvoicesManager, setShowInvoicesManager] = useState(false)

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SkeletonStatCard />
        <SkeletonStatCard labelWidth={60} numberWidth={120} />
      </div>
      <SkeletonCardGrid count={3} height={140} />
      <SkeletonCardGrid count={2} height={220} />
    </div>
  )
  if (accounts.length === 0) return <NoAccountsState />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* TopBar slim: saldo total + ver Contas + month picker.
          Substituiu o antigo cabeçalho com saudação — gestão de contas
          virou página própria, e os 3 stats (receita/despesa/sobra) saíram
          porque Compromissos já mostra a info importante. */}
      <TopBar
        summary={summary}
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
      />

      {/* Compromissos (planejado) lado a lado com Outras Transações (real
          do Nubank). Conceitualmente: o que devia acontecer | o que rolou
          de verdade. Em telas estreitas empilha automaticamente. */}
      <div style={twoColumns}>
        <CardCompromissosMes
          commitments={monthCommitments}
          monthlySummary={monthlySummary}
          onOpenRecurring={() => navigate('/hub-finance/fixas')}
          onOpenDebts={() => navigate('/hub-finance/dividas')}
          onOpenFreelas={() => navigate('/hub-finance/freelas')}
          onOpenInvoices={() => setShowInvoicesManager(true)}
          onOpenWishlist={() => navigate('/hub-finance/wishlist')}
        />
        <CardOutrasTransacoes
          transactions={transactions}
          commitments={monthCommitments}
          onSeeAll={() => navigate('/hub-finance/lancamentos')}
        />
      </div>

      {/* Faturas viraram parte do Compromissos do Mês (kind 'invoice') —
          card dedicado deletado. InvoicesManagerModal continua acessível
          via click numa fatura no Compromissos. */}

      {showInvoicesManager && (
        <InvoicesManagerModal
          invoices={invoices}
          accounts={accounts}
          onClose={() => setShowInvoicesManager(false)}
          onChanged={refreshAll}
        />
      )}

    </div>
  )
}

// ─── Layout helper ───────────────────────────────────────────────────────

const twoColumns: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
  gap: 16,
}

// ─── Cards individuais ───────────────────────────────────────────────────

function TopBar({ summary, selectedMonth, onMonthChange }: {
  summary: ReturnType<typeof useHubFinance>['summary']
  selectedMonth: ReturnType<typeof useHubFinance>['selectedMonth']
  onMonthChange: ReturnType<typeof useHubFinance>['setSelectedMonth']
}) {
  const saldo = summary?.saldo_total ?? 0
  const naoConvertidasCount = summary?.saldos_nao_convertidos?.length ?? 0
  const isNeg = saldo < 0

  return (
    <Card padding="none" style={{
      animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
      // Sem overflow:hidden — o MonthPicker abre dropdown via position:
      // absolute e seria cortado. Hairline vira elemento inline no topo.
      // position+zIndex elevados pra dropdown ficar acima do Compromissos
      // (que também tem stacking context próprio via animation).
      position: 'relative',
      zIndex: 20,
    }}>
      {/* Hairline ice elétrica — assinatura HUD CP2077 */}
      <div className="hq-hairline-ice" />
      <div style={{
        padding: 'var(--space-5) var(--space-6)',
        background: `
          radial-gradient(ellipse 100% 80% at 0% 0%, rgba(143, 191, 211, 0.05), transparent 60%),
          radial-gradient(ellipse 60% 80% at 100% 0%, rgba(50, 62, 73, 0.20), transparent 65%),
          linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
        `,
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 'var(--space-5)', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          {/* Saldo total — protagonista da barra. Click leva pra Carteira. */}
          <Link
            to="/hub-finance/carteira"
            title="ver e gerenciar carteiras"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)',
              textDecoration: 'none', color: 'inherit',
              transition: 'opacity var(--motion-fast) var(--ease-smooth)',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            <Wallet
              size={ICON_SIZE.sm}
              strokeWidth={ICON_STROKE}
              style={{ color: 'var(--color-text-tertiary)' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, color: 'var(--color-text-muted)',
                letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700,
              }}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                BALANCE.TOTAL
              </span>
              <span className="hq-money" style={{
                fontSize: 'var(--text-2xl)', fontWeight: 700,
                fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.02em',
                color: isNeg ? 'var(--color-accent-light)' : 'var(--color-ice)',
                lineHeight: 1.1,
                textShadow: isNeg ? 'none' : '0 0 16px var(--color-ice-glow)',
              }}>
                <AnimatedNumber value={saldo} format={n => formatBRL(n)} duration={0.4} />
              </span>
            </div>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              color: 'var(--color-text-tertiary)',
              alignSelf: 'flex-end', marginBottom: 4,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              padding: '4px 10px',
              border: '1px solid var(--color-border)',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
              transition: 'all 0.15s',
            }}>
              VER CARTEIRA →
            </span>
          </Link>

          {naoConvertidasCount > 0 && (
            <span
              title="contas em moeda estrangeira sem cotação definida — não somam no total"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-accent-light)',
                background: 'rgba(159, 18, 57, 0.10)',
                border: '1px solid var(--color-accent-primary)',
                padding: '4px 10px',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                borderRadius: 0,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                boxShadow: '0 0 8px rgba(159, 18, 57, 0.20)',
              }}
            >
              <span style={{ color: 'var(--color-accent-primary)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              {naoConvertidasCount} SEM COTAÇÃO
            </span>
          )}
        </div>

        <MonthPicker selectedMonth={selectedMonth} onChange={onMonthChange} />
      </div>
    </Card>
  )
}

// ─── Compromissos do mês — visão consolidada (bills + debt parcelas) ────

function CardCompromissosMes({ commitments, monthlySummary, onOpenRecurring, onOpenDebts, onOpenFreelas, onOpenInvoices, onOpenWishlist }: {
  commitments: ReturnType<typeof useHubFinance>['monthCommitments']
  monthlySummary: ReturnType<typeof useHubFinance>['monthlySummary']
  onOpenRecurring: () => void
  onOpenDebts: () => void
  onOpenFreelas: () => void
  onOpenInvoices: () => void
  onOpenWishlist: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const items = commitments?.items ?? []
  const total_a_pagar = commitments?.total_a_pagar ?? 0
  const total_a_receber = commitments?.total_a_receber ?? 0
  const sobra = commitments?.sobra_projetada ?? 0
  // Reservas da wishlist do mês — já estão somadas em `total_a_pagar` mas
  // exibimos linha separada pra deixar visível o peso aspiracional.
  const reservasWishlist = monthlySummary?.reservas_wishlist ?? 0
  // Real (Nubank) — totais brutos do mês, incluem avulsos. Usados pra
  // mostrar planejado-vs-real no hero e revelar quanto vazou do plano.
  const despesaReal = monthlySummary?.despesa ?? 0
  const receitaReal = monthlySummary?.receita ?? 0
  const saldoReal = receitaReal - despesaReal

  // Ordena: pendente/atrasada primeiro (urgência), pagas/recebidas no fim
  const STATUS_ORDER: Record<string, number> = {
    atrasada: 0,
    pendente: 1,
    paga: 2,
    recebida: 2,
  }
  const sortedItems = [...items].sort((a, b) => {
    const ord = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
    if (ord !== 0) return ord
    return (a.data_prevista ?? '9999').localeCompare(b.data_prevista ?? '9999')
  })
  const visibleItems = expanded ? sortedItems : sortedItems.slice(0, 6)
  const hidden = sortedItems.length - visibleItems.length

  return (
    <Card padding="none" style={{
      animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Hairline ice elétrica — assinatura HUD CP2077 */}
      <div className="hq-hairline-ice" style={{
        position: 'absolute', top: 0, left: 0, right: 0,
      }} />
      {/* Header com gradient sutil — mancha oxblood top-left */}
      <div style={{
        padding: 'var(--space-5) var(--space-6) var(--space-4)',
        background: `
          radial-gradient(ellipse 100% 80% at 0% 0%, rgba(143, 191, 211, 0.05), transparent 60%),
          radial-gradient(ellipse 60% 80% at 100% 0%, rgba(50, 62, 73, 0.20), transparent 65%),
          linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
        `,
        borderBottom: items.length > 0 ? '1px solid var(--color-divider)' : 'none',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div
            aria-hidden="true"
            style={{
              width: 3, height: 14,
              background: 'var(--color-ice)',
              boxShadow: '0 0 8px var(--color-ice-glow)',
              flexShrink: 0,
            }}
          />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10, fontWeight: 700,
            color: 'var(--color-ice-light)',
            letterSpacing: '0.25em', textTransform: 'uppercase',
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            COMPROMISSOS.MES
            {items.length > 0 && (
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 700, marginLeft: 8 }}>
                [{items.length.toString().padStart(2, '0')}]
              </span>
            )}
          </span>
        </div>
      </div>
      <div style={{ padding: 'var(--space-5) var(--space-6)' }}>

      {items.length === 0 ? (
        <div style={{
          padding: '14px 16px',
          border: '1px dashed rgba(143, 191, 211, 0.30)',
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10, fontWeight: 700,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.18em', textTransform: 'uppercase',
          lineHeight: 1.7,
        }}>
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
          NENHUM COMPROMISSO PRA ESSE MÊS · CADASTRE FIXAS / RECEITAS / DÍVIDAS
        </div>
      ) : (
        <>
          {/* Hero planejado vs real — 2 colunas. Planejado vem do endpoint
              compromissos (bills/dívida/freela do mês). Real vem do
              monthlySummary (todo Nubank do mês, inclui avulsos). Diff entre
              elas = quanto vazou do plano. */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)',
            marginBottom: 14, paddingBottom: 14,
            borderBottom: '1px solid var(--color-border)',
          }}>
            {/* Coluna planejado */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, color: 'var(--color-text-muted)',
                letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700,
                paddingBottom: 2, borderBottom: '1px solid var(--color-ice-deep)',
              }}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                PLANEJADO
              </div>
              <PlanRealRow
                label="A PAGAR"
                value={total_a_pagar}
                color={total_a_pagar > 0 ? 'var(--color-accent-light)' : 'var(--color-text-muted)'}
              />
              <PlanRealRow
                label="A RECEBER"
                value={total_a_receber}
                color={total_a_receber > 0 ? 'var(--color-success-light)' : 'var(--color-text-muted)'}
              />
              {reservasWishlist > 0 && (
                <PlanRealRow
                  label="RESERVAS WL"
                  value={reservasWishlist}
                  color="var(--color-warning)"
                />
              )}
              <PlanRealRow
                label={reservasWishlist > 0 ? 'SOBRA REAL' : 'SOBRA PROJETADA'}
                value={sobra}
                color={sobra >= 0 ? 'var(--color-text-primary)' : 'var(--color-accent-light)'}
              />
            </div>

            {/* Coluna real */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, color: 'var(--color-text-muted)',
                letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700,
                paddingBottom: 2, borderBottom: '1px solid var(--color-ice-deep)',
              }}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                REAL · NUBANK
              </div>
              <PlanRealRow
                label="PAGO"
                value={despesaReal}
                color={despesaReal > 0 ? 'var(--color-accent-light)' : 'var(--color-text-muted)'}
              />
              <PlanRealRow
                label="RECEBIDO"
                value={receitaReal}
                color={receitaReal > 0 ? 'var(--color-success-light)' : 'var(--color-text-muted)'}
              />
              <PlanRealRow
                label="SALDO REAL"
                value={saldoReal}
                color={saldoReal >= 0 ? 'var(--color-text-primary)' : 'var(--color-accent-light)'}
              />
            </div>
          </div>

          {/* Lista — top 6 + expand. StaggerList faz cada row entrar
              em cascata via Framer Motion (substitui o antigo --stagger-i
              CSS). Item leve com layout=true pra reorder smooth. */}
          <StaggerList style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {visibleItems.map((item, i) => (
              <CompromissoRow
                key={`${item.kind}:${item.id}`}
                item={item}
                index={i}
                onClick={() => {
                  if (item.kind === 'bill') onOpenRecurring()
                  else if (item.kind === 'freela_parcela') onOpenFreelas()
                  else if (item.kind === 'invoice') onOpenInvoices()
                  else if (item.kind === 'wishlist') onOpenWishlist()
                  else onOpenDebts()
                }}
              />
            ))}
            {(hidden > 0 || expanded) && sortedItems.length > 6 && (
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                style={{
                  background: 'rgba(8, 12, 18, 0.55)',
                  border: '1px solid var(--color-border)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-text-tertiary)',
                  padding: '5px 12px',
                  marginTop: 8,
                  textAlign: 'center',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = 'var(--color-ice-light)'
                  e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = 'var(--color-text-tertiary)'
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                }}
              >
                {expanded ? '↑ VER MENOS' : `↓ VER MAIS · ${hidden} ${hidden === 1 ? 'ITEM' : 'ITENS'}`}
              </button>
            )}
          </StaggerList>
        </>
      )}
      </div>
    </Card>
  )
}

// ─── Outras Transações do Mês — visão "real" (Nubank) ──────────────────
//
// Complementa Compromissos. Compromissos = planejado (bills, dívida, freela).
// Outras = transações Nubank do mês que NÃO bateram com nenhum compromisso
// (ex: mercado, lanche, posto, transferência avulsa).
//
// Filtro: tx sem parcela_id/divida_id/fatura_id (não vinculada a freela/dívida/
// fatura) E cujo id NÃO aparece nos `transacao_id` dos compromissos
// (que matcham bill por descrição). Stats no topo são totais REAIS do mês
// (vindos de monthlySummary), independentes do filtro.
function CardOutrasTransacoes({ transactions, commitments, onSeeAll }: {
  transactions: ReturnType<typeof useHubFinance>['transactions']
  commitments: ReturnType<typeof useHubFinance>['monthCommitments']
  onSeeAll: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  // Set de tx ids já contabilizados nos compromissos (bills matchados por
  // descrição, parcelas pagas, etc).
  const linkedTxIds = useMemo(() => {
    const ids = new Set<string>()
    for (const c of commitments?.items ?? []) {
      if (c.transacao_id) ids.add(c.transacao_id)
    }
    return ids
  }, [commitments])

  // "Outras" = não vinculada a parcela/dívida/fatura/pagamento-de-fatura
  // E não matchada por bill (recurring que casa por descrição)
  const outras = useMemo(() => {
    return transactions
      .filter(tx =>
        !tx.parcela_id && !tx.divida_id && !tx.fatura_id
        && !tx.pagamento_fatura_id
        && !linkedTxIds.has(tx.id)
      )
      // Maiores despesas primeiro pra puxar atenção pro que dói mais
      .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))
  }, [transactions, linkedTxIds])

  // Subtotais só dos avulsos — pra dar a sensação de "quanto vazou do plano".
  // Stats reais totais (incluindo planejado) ficam no Compromissos ao lado.
  const totalAvulsoDespesa = outras.reduce((s, tx) => s + (tx.valor < 0 ? Math.abs(tx.valor) : 0), 0)
  const totalAvulsoReceita = outras.reduce((s, tx) => s + (tx.valor > 0 ? tx.valor : 0), 0)

  const visibleItems = expanded ? outras : outras.slice(0, 5)
  const hidden = outras.length - visibleItems.length

  return (
    <Card padding="none" style={{
      animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Hairline ice elétrica — assinatura HUD CP2077 */}
      <div className="hq-hairline-ice" style={{
        position: 'absolute', top: 0, left: 0, right: 0,
      }} />
      {/* Header com gradient sutil */}
      <div style={{
        padding: 'var(--space-5) var(--space-6) var(--space-4)',
        background: `
          radial-gradient(ellipse 100% 80% at 0% 0%, rgba(143, 191, 211, 0.05), transparent 60%),
          radial-gradient(ellipse 60% 80% at 100% 0%, rgba(50, 62, 73, 0.20), transparent 65%),
          linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
        `,
        borderBottom: outras.length > 0 ? '1px solid var(--color-divider)' : 'none',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <div
            aria-hidden="true"
            style={{
              width: 3, height: 14,
              background: 'var(--color-ice)',
              boxShadow: '0 0 8px var(--color-ice-glow)',
              flexShrink: 0,
            }}
          />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10, fontWeight: 700,
            color: 'var(--color-ice-light)',
            letterSpacing: '0.25em', textTransform: 'uppercase',
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            OTHER.TX
            {outras.length > 0 && (
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 700, marginLeft: 8 }}>
                [{outras.length.toString().padStart(2, '0')}]
              </span>
            )}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={onSeeAll} style={{
            background: 'rgba(8, 12, 18, 0.55)',
            border: '1px solid var(--color-border)',
            cursor: 'pointer',
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
            VER LANÇAMENTOS →
          </button>
        </div>
      </div>
      <div style={{ padding: 'var(--space-5) var(--space-6)' }}>

      {/* Subtotal compacto dos avulsos — mono uppercase */}
      {outras.length > 0 && (
        <div style={{
          display: 'flex', gap: 16, marginBottom: 14,
          paddingBottom: 14,
          borderBottom: '1px solid var(--color-ice-deep)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10, fontWeight: 700,
          letterSpacing: '0.18em', textTransform: 'uppercase',
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span>
            <span style={{ color: 'var(--color-text-muted)', marginRight: 5 }}>//OUT</span>
            <span className="hq-money" style={{ color: 'var(--color-accent-light)' }}>
              {formatBRL(totalAvulsoDespesa)}
            </span>
          </span>
          {totalAvulsoReceita > 0 && (
            <span>
              <span style={{ color: 'var(--color-text-muted)', marginRight: 5 }}>//IN</span>
              <span className="hq-money" style={{ color: 'var(--color-success-light)' }}>
                {formatBRL(totalAvulsoReceita)}
              </span>
            </span>
          )}
        </div>
      )}

      {outras.length === 0 ? (
        <div style={{
          padding: '14px 16px',
          border: '1px dashed rgba(143, 191, 211, 0.30)',
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10, fontWeight: 700,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.18em', textTransform: 'uppercase',
          lineHeight: 1.7,
        }}>
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
          NENHUMA TRANSAÇÃO AVULSA · TUDO BATEU COM COMPROMISSOS
        </div>
      ) : (
        <StaggerList style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visibleItems.map((tx) => {
            const isReceita = tx.valor >= 0
            const borderLeftColor = isReceita ? 'var(--color-success)' : 'rgba(143, 191, 211, 0.30)'
            const hoverGlowColor = isReceita ? 'rgba(94, 122, 82, 0.18)' : 'rgba(143, 191, 211, 0.15)'
            return (
              <StaggerItem key={tx.id}>
              <div
                style={{
                  background: 'rgba(8, 12, 18, 0.55)',
                  border: '1px solid rgba(143, 191, 211, 0.18)',
                  borderLeft: `2px solid ${borderLeftColor}`,
                  padding: '8px 12px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: 12,
                  borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
                  transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.40)'
                  e.currentTarget.style.boxShadow = `0 0 10px ${hoverGlowColor}`
                  e.currentTarget.style.transform = 'translateX(2px)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.18)'
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.transform = 'translateX(0)'
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    ...listRowTitle,
                    color: isReceita ? 'var(--color-success-light)' : 'var(--color-text-primary)',
                  }}>
                    <span style={{ color: isReceita ? 'var(--color-success)' : 'var(--color-text-muted)', marginRight: 4 }}>
                      {isReceita ? '↓' : '↑'}
                    </span>
                    {tx.descricao}
                  </div>
                  <div style={listRowSub}>
                    {tx.data.split('-').reverse().slice(0, 2).join('/')}
                  </div>
                </div>
                <span className="hq-money" style={{
                  fontSize: 13, fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '0.02em',
                  color: isReceita ? 'var(--color-success-light)' : 'var(--color-text-secondary)',
                }}>
                  {formatBRL(Math.abs(tx.valor))}
                </span>
              </div>
              </StaggerItem>
            )
          })}
          {(hidden > 0 || expanded) && outras.length > 5 && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              style={{
                background: 'rgba(8, 12, 18, 0.55)',
                border: '1px solid var(--color-border)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-text-tertiary)',
                padding: '5px 12px',
                marginTop: 6,
                textAlign: 'center',
                letterSpacing: '0.22em', textTransform: 'uppercase',
                borderRadius: 0,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'var(--color-ice-light)'
                e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--color-text-tertiary)'
                e.currentTarget.style.borderColor = 'var(--color-border)'
              }}
            >
              {expanded ? '↑ VER MENOS' : `↓ VER MAIS · ${hidden} ${hidden === 1 ? 'ITEM' : 'ITENS'}`}
            </button>
          )}
        </StaggerList>
      )}
      </div>
    </Card>
  )
}

// Linha de stat dentro do mini-quadro planejado vs real do CardCompromissosMes.
// Layout horizontal: label tertiary + valor mono à direita. Pensado pra
// caber em coluna estreita (tela em twoColumns).
function PlanRealRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9, fontWeight: 700,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
      }}>
        {label}
      </span>
      <span className="hq-money" style={{
        fontSize: 14, fontWeight: 700,
        color,
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.02em',
      }}>
        {formatBRL(value)}
      </span>
    </div>
  )
}

function CompromissoRow({ item, onClick, index = 0 }: {
  item: NonNullable<ReturnType<typeof useHubFinance>['monthCommitments']>['items'][number]
  onClick: () => void
  index?: number
}) {
  const isReceita = item.tipo === 'receita'
  const isCompleted = item.status === 'paga' || item.status === 'recebida'
  const isAtrasada = item.status === 'atrasada'
  const dotColor = isCompleted
    ? 'var(--color-success-light)'
    : isAtrasada
      ? 'var(--color-accent-vivid)'
      : 'rgba(143, 191, 211, 0.55)'
  const dotGlow = isCompleted
    ? 'rgba(94, 122, 82, 0.55)'
    : isAtrasada
      ? 'rgba(159, 18, 57, 0.55)'
      : 'rgba(143, 191, 211, 0.30)'
  const valorColor = isCompleted
    ? 'var(--color-text-primary)'
    : isReceita
      ? 'var(--color-success-light)'
      : 'var(--color-text-secondary)'
  // Border-left semântica (estado da row no scope da month).
  // Wishlist tem cor própria (âmbar) — reserva é compromisso aspiracional
  // virtual, semanticamente diferente de bill/dívida/fatura.
  const isWishlist = item.kind === 'wishlist'
  const borderLeftColor = isAtrasada
    ? 'var(--color-accent-primary)'
    : isCompleted
      ? 'var(--color-success)'
      : isWishlist
        ? 'var(--color-warning)'
        : 'rgba(143, 191, 211, 0.30)'
  const hoverGlowColor = isAtrasada
    ? 'rgba(159, 18, 57, 0.20)'
    : isCompleted
      ? 'rgba(94, 122, 82, 0.20)'
      : isWishlist
        ? 'rgba(192, 138, 58, 0.20)'
        : 'rgba(143, 191, 211, 0.15)'

  // Sub-line cyber-mono uppercase: "PAGA · 06/05" / "VENCE 15/05" / "DIA 12"
  let subText: string
  if (isCompleted && item.data_pagamento) {
    const [, m, d] = item.data_pagamento.split('-')
    subText = `${isReceita ? 'RCB' : 'PG'} · ${d}/${m}`
  } else if (item.dia) {
    subText = `${isReceita ? 'CAI' : 'VC'} DIA ${item.dia}`
  } else if (item.data_prevista) {
    const [, m, d] = item.data_prevista.split('-')
    subText = `${isReceita ? 'CAI' : 'VC'} ${d}/${m}`
  } else {
    subText = 'SEM DATA FIXA'
  }

  void index
  return (
    <StaggerItem>
    <div
      onClick={onClick}
      style={{
        cursor: 'pointer',
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid rgba(143, 191, 211, 0.18)',
        borderLeft: `2px solid ${borderLeftColor}`,
        padding: '8px 12px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 12,
        borderRadius: 0,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
        transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
        e.currentTarget.style.boxShadow = `0 0 10px ${hoverGlowColor}`
        e.currentTarget.style.transform = 'translateX(2px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.18)'
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.transform = 'translateX(0)'
      }}
      title={
        item.kind === 'bill' ? 'abrir contas/receitas fixas' :
        item.kind === 'freela_parcela' ? 'abrir freelas' :
        item.kind === 'invoice' ? 'abrir gerenciar faturas' :
        item.kind === 'wishlist' ? 'abrir wishlist' :
        'abrir gerenciar dívidas'
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {/* Square dot com glow — substitui o circle */}
        <span style={{
          width: 8, height: 8,
          background: dotColor, flexShrink: 0,
          boxShadow: `0 0 6px ${dotGlow}`,
        }} />
        <div style={{ minWidth: 0 }}>
          <div style={{
            ...listRowTitle,
            color: isReceita ? 'var(--color-success-light)' : 'var(--color-text-primary)',
          }}>
            <span style={{ color: isReceita ? 'var(--color-success)' : 'var(--color-text-muted)', marginRight: 4 }}>
              {isReceita ? '↓' : '↑'}
            </span>
            {item.descricao}
            {item.sub_descricao && (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-text-muted)',
                marginLeft: 6,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
              }}>
                · {item.sub_descricao}
              </span>
            )}
          </div>
          <div style={listRowSub}>{subText}</div>
        </div>
      </div>
      <span className="hq-money" style={{
        fontSize: 13, fontWeight: 700,
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.02em',
        color: valorColor,
      }}>
        {isCompleted && item.valor_pago != null
          ? formatBRL(item.valor_pago)
          : formatBRL(item.valor)}
      </span>
    </div>
    </StaggerItem>
  )
}

function NoAccountsState() {
  return (
    <EmptyState
      text="Você ainda não tem carteiras cadastradas"
      sub="Vai em 'carteira' no menu e clica em '+ nova carteira' pra começar."
    />
  )
}

