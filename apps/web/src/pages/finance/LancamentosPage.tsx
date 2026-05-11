/**
 * Lançamentos — lista mensal de transações estilo Organizze (mas dark tactical).
 *
 * Layout:
 * - Header: título + seletor de mês central + botão menu
 * - Barra de busca/filtros: input de busca + botão filtros (expande dropdowns)
 * - Lista: cards de transação com edit/delete inline
 * - Rodapé: totais do mês (receita/despesa/saldo) + botão "+" pra lançar
 *
 * Ações:
 * - Click categoria → CategorizeModal (categorização rápida + criar regra)
 * - Pencil → TransactionEditModal (edição completa)
 * - "+" → NewTransactionModal
 */
import { useMemo, useState } from 'react'
import {
  Download, Filter, Link2, MoreVertical, Pencil, Plus,
  Search, Sparkles, Trash2, X,
} from 'lucide-react'
import { useHubFinance } from './HubFinanceContext'
import {
  buildFinExportTransactionsUrl, deleteFinTransaction, reportApiError,
} from '../../api'
import type { FinTransaction } from '../../types'
import {
  formatBRL, formatDate, inputStyle,
} from './components/styleHelpers'
import { CategorizeModal } from './components/CategorizeModal'
import { TransactionEditModal } from './components/TransactionEditModal'
import { NewTransactionModal } from './components/NewTransactionModal'
import { LinkTransactionModal } from './components/LinkTransactionModal'
import { MonthPicker } from './components/MonthPicker'
import { confirmDialog, alertDialog } from '../../lib/dialog'
import { parseTxDescricao } from './components/parseTxDescricao'
import { Card } from '../../components/ui/Primitives'
import { StaggerList, StaggerItem } from '../../components/ui/Motion'

export function LancamentosPage() {
  const {
    transactions, accounts, categories, debts, invoices, monthlySummary,
    selectedMonth, setSelectedMonth, refreshAll,
  } = useHubFinance()

  // Modais
  const [categorizingTx, setCategorizingTx] = useState<FinTransaction | null>(null)
  const [editingTx, setEditingTx] = useState<FinTransaction | null>(null)
  const [linkingTx, setLinkingTx] = useState<FinTransaction | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)

  // Filtros (client-side, lista do mês já tá carregada via context)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filterCatId, setFilterCatId] = useState('')
  const [filterContaId, setFilterContaId] = useState('')
  const [filterTipo, setFilterTipo] = useState<'all' | 'entrada' | 'saida'>('all')

  const accountById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])
  const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])

  // Parseia 1x cada descrição pra usar tanto na busca quanto no render — evita
  // re-parse a cada render e garante que filtro bate no nome "limpo" também.
  const parsed = useMemo(
    () => new Map(transactions.map(tx => [tx.id, parseTxDescricao(tx.descricao)])),
    [transactions],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return transactions.filter(tx => {
      if (q) {
        const p = parsed.get(tx.id)
        const haystack = `${tx.descricao} ${p?.nome ?? ''} ${p?.doc ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (filterCatId && tx.categoria_id !== filterCatId) return false
      if (filterContaId && tx.conta_id !== filterContaId) return false
      if (filterTipo === 'entrada' && tx.valor < 0) return false
      if (filterTipo === 'saida' && tx.valor >= 0) return false
      return true
    })
  }, [transactions, search, filterCatId, filterContaId, filterTipo, parsed])

  const hasFilters = !!(search || filterCatId || filterContaId || filterTipo !== 'all')

  function clearFilters() {
    setSearch(''); setFilterCatId(''); setFilterContaId(''); setFilterTipo('all')
    setFiltersOpen(false)
  }

  async function handleDelete(tx: FinTransaction) {
    const ok = await confirmDialog({
      title: 'Deletar transação',
      message: `Deletar a transação "${tx.descricao}"?`,
      confirmLabel: 'DELETAR',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteFinTransaction(tx.id)
      refreshAll()
    } catch (err) {
      reportApiError('deleteFinTransaction', err)
      alertDialog({ title: 'Erro', message: 'Erro ao deletar — veja o console.', variant: 'danger' })
    }
  }

  // Default da data nova transação = primeiro dia do mês selecionado.
  // Facilita lançar retroativamente quando o user navega meses passados.
  const defaultDate = `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}-01`

  return (
    <Card padding="none" style={{
      animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
      display: 'flex', flexDirection: 'column',
      minHeight: 'calc(100vh - 200px)',
      // position+zIndex pra MonthPicker dropdown ficar acima do que tem
      // depois dele na página (mesmo problema do Compromissos).
      position: 'relative',
      zIndex: 20,
    }}>
      {/* Hairline ice elétrica — assinatura HUD CP2077 */}
      <div className="hq-hairline-ice" />
      {/* Header com atmosphere ice/fog */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center',
        padding: 'var(--space-4) var(--space-6)',
        background: `
          radial-gradient(ellipse 100% 80% at 0% 0%, rgba(143, 191, 211, 0.05), transparent 60%),
          radial-gradient(ellipse 60% 80% at 100% 0%, rgba(50, 62, 73, 0.20), transparent 65%),
          linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
        `,
        borderBottom: '1px solid var(--color-ice-deep)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, color: 'var(--color-text-muted)',
            letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700,
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            TRANSACTIONS
          </span>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 14, fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--color-text-primary)',
            lineHeight: 1.1,
          }}>
            LANÇAMENTOS
          </span>
        </div>

        {/* Seletor de mês — MonthPicker compartilhado (atalhos: Hoje, Mês
            anterior, Mesmo mês ano passado, grid 12 meses navegando ano). */}
        <MonthPicker
          selectedMonth={selectedMonth}
          onChange={setSelectedMonth}
        />

        {/* Menu (placeholder por enquanto) */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            style={iconBtnStyle}
            title="mais opções (em breve)"
            disabled
          >
            <MoreVertical size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Barra de busca + filtros */}
      <div style={{
        padding: '12px 18px',
        borderBottom: '1px solid var(--color-ice-deep)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(8, 12, 18, 0.55)',
          border: '1px solid var(--color-border)',
          borderRadius: 0,
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
          padding: '6px 12px',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}>
          <button
            onClick={() => setFiltersOpen(v => !v)}
            title={filtersOpen ? 'esconder filtros' : 'mostrar filtros'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: filtersOpen || hasFilters ? 'var(--color-accent-light)' : 'var(--color-text-muted)',
              padding: 0, display: 'inline-flex',
            }}
          >
            <Filter size={13} strokeWidth={2} />
          </button>
          <input
            type="text"
            placeholder="filtrar por descrição..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: 'var(--color-text-primary)', fontSize: 12,
              fontFamily: 'inherit',
            }}
          />
          {hasFilters && (
            <button
              onClick={clearFilters}
              title="limpar filtros"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--color-text-muted)', padding: 0, display: 'inline-flex',
              }}
            >
              <X size={13} strokeWidth={2} />
            </button>
          )}
          <Search size={13} strokeWidth={2} style={{ color: 'var(--color-text-muted)' }} />
        </div>

        {filtersOpen && (
          <div style={{
            display: 'grid', gridTemplateColumns: '120px 1fr 1fr',
            gap: 8, alignItems: 'center',
          }}>
            <select value={filterTipo} onChange={e => setFilterTipo(e.target.value as any)} style={inputStyle()}>
              <option value="all">tipo: todos</option>
              <option value="entrada">entradas</option>
              <option value="saida">saídas</option>
            </select>
            <select value={filterContaId} onChange={e => setFilterContaId(e.target.value)} style={inputStyle()}>
              <option value="">contas: todas</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
            <select value={filterCatId} onChange={e => setFilterCatId(e.target.value)} style={inputStyle()}>
              <option value="">categorias: todas</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
        )}

        {hasFilters && (
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
            mostrando {filtered.length} de {transactions.length} transações
          </div>
        )}
      </div>

      {/* Lista de transações */}
      <div style={{ flex: 1, padding: '12px 18px', overflowY: 'auto' }}>
        {transactions.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={26} strokeWidth={1.5} />}
            text="Nenhuma movimentação no período."
            sub="Use o + abaixo pra lançar uma transação."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search size={26} strokeWidth={1.5} />}
            text="Nenhuma transação bate com os filtros."
            sub="Ajuste a busca ou limpe os filtros."
          />
        ) : (
          <StaggerList style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Header de colunas tabular — cyber mono `// FIELD` pra cada label.
                Bordas transparentes pra reservar o mesmo espaço que cada linha
                tem (border 1px + borderLeft 2px), senão o header desalinha. */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: TX_GRID,
              gap: TX_GAP, alignItems: 'center',
              padding: '4px 14px 8px',
              fontSize: 9, color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.18em',
              border: '1px solid transparent',
              borderLeft: '2px solid transparent',
              borderBottom: '1px solid var(--color-ice-deep)',
              marginBottom: 4,
            }}>
              <span><span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 3, letterSpacing: 0 }}>//</span>DATA</span>
              <span><span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 3, letterSpacing: 0 }}>//</span>TIPO</span>
              <span><span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 3, letterSpacing: 0 }}>//</span>NOME</span>
              <span><span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 3, letterSpacing: 0 }}>//</span>DOC</span>
              <span><span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 3, letterSpacing: 0 }}>//</span>CAT</span>
              <span><span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 3, letterSpacing: 0 }}>//</span>WALLET</span>
              <span><span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 3, letterSpacing: 0 }}>//</span>VALOR</span>
            </div>

            {filtered.map((tx) => {
              const isEntry = tx.valor >= 0
              const cat = tx.categoria_id ? catById.get(tx.categoria_id) : null
              const acc = accountById.get(tx.conta_id)
              const p = parsed.get(tx.id) ?? { tipo: null, nome: tx.descricao, doc: null }
              const accentColor = isEntry ? 'var(--color-success)' : 'var(--color-accent-primary)'
              return (
                <StaggerItem key={tx.id} layout>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: TX_GRID,
                    gap: TX_GAP, alignItems: 'center',
                    padding: '10px 14px',
                    background: 'rgba(8, 12, 18, 0.55)',
                    border: '1px solid rgba(143, 191, 211, 0.22)',
                    borderLeft: `2px solid ${accentColor}`,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
                    transition: 'transform 0.18s var(--ease-emphasis), box-shadow 0.18s, border-color 0.18s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateX(2px)'
                    e.currentTarget.style.boxShadow = isEntry
                      ? '0 0 14px rgba(94, 122, 82, 0.16)'
                      : '0 0 14px rgba(159, 18, 57, 0.16)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'translateX(0)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  <span style={{
                    fontSize: 10, color: 'var(--color-text-tertiary)',
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: '0.05em',
                  }}>
                    {formatDate(tx.data)}
                  </span>
                  {/* Tipo como texto puro (sem badge) — alinha perfeito com
                      o header da coluna, que também é só texto. */}
                  {p.tipo ? (
                    <span style={{
                      fontSize: 9, fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-ice-light)',
                      letterSpacing: '0.18em',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {p.tipo}
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>—</span>
                  )}
                  <span
                    title={tx.descricao}
                    style={{
                      fontSize: 13, color: 'var(--color-text-primary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {(tx.parcela_id || tx.divida_id || tx.fatura_id || tx.recurring_bill_id) && (
                      <span
                        title={
                          tx.recurring_bill_id ? 'vinculada a conta fixa' :
                          tx.parcela_id ? 'vinculada a parcela de projeto' :
                          tx.divida_id ? 'vinculada a dívida' :
                          'parte de fatura de cartão'
                        }
                        style={{ display: 'inline-flex', flexShrink: 0 }}
                      >
                        <Link2
                          size={11}
                          strokeWidth={1.8}
                          style={{ color: 'var(--color-accent-light)' }}
                        />
                      </span>
                    )}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.nome || tx.descricao}
                    </span>
                  </span>
                  <span style={{
                    fontSize: 10, color: 'var(--color-text-muted)',
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.doc ?? '—'}
                  </span>
                  {cat ? (
                    <span
                      onClick={() => setCategorizingTx(tx)}
                      title="alterar categoria"
                      style={{
                        fontSize: 9, fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--color-text-secondary)',
                        textTransform: 'uppercase', letterSpacing: '0.18em',
                        cursor: 'pointer',
                        padding: '3px 8px',
                        background: 'rgba(143, 191, 211, 0.06)',
                        border: '1px solid rgba(143, 191, 211, 0.20)',
                        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
                        justifySelf: 'start',
                        maxWidth: '100%',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        transition: 'color 0.15s, border-color 0.15s, background 0.15s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = 'var(--color-ice-light)'
                        e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                        e.currentTarget.style.background = 'rgba(143, 191, 211, 0.12)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = 'var(--color-text-secondary)'
                        e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.20)'
                        e.currentTarget.style.background = 'rgba(143, 191, 211, 0.06)'
                      }}
                    >
                      {cat.nome}
                    </span>
                  ) : (
                    <button
                      onClick={() => setCategorizingTx(tx)}
                      title="categorizar"
                      style={{
                        background: 'rgba(159, 18, 57, 0.08)',
                        border: '1px solid rgba(159, 18, 57, 0.30)',
                        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
                        padding: '3px 8px',
                        cursor: 'pointer',
                        color: 'var(--color-accent-light)',
                        fontSize: 9, fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '0.18em', textTransform: 'uppercase',
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        justifySelf: 'start',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(159, 18, 57, 0.16)'
                        e.currentTarget.style.boxShadow = '0 0 8px rgba(159, 18, 57, 0.25)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(159, 18, 57, 0.08)'
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                    >
                      <Sparkles size={9} strokeWidth={2} />
                      categorizar
                    </button>
                  )}
                  <span style={{
                    fontSize: 10, color: 'var(--color-text-muted)',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.05em',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {acc?.nome ?? '—'}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="hq-money" style={{
                      fontSize: 13, fontWeight: 600,
                      fontFamily: 'var(--font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                      color: isEntry ? 'var(--color-success-light)' : 'var(--color-accent-light)',
                    }}>
                      {isEntry ? '+' : ''}{formatBRL(tx.valor)}
                    </span>
                    {/* marginLeft: auto empurra o grupo de ações pra direita
                        mantendo o valor colado à esquerda. */}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                      {/* Link só aparece quando a tx ainda não tá vinculada a
                          nada — depois de vinculada, o Link2 ao lado da
                          descrição já indica visualmente. */}
                      {!(tx.parcela_id || tx.divida_id || tx.fatura_id
                          || tx.pagamento_fatura_id || tx.recurring_bill_id) && (
                        <button
                          onClick={() => setLinkingTx(tx)}
                          title="vincular a conta fixa ou parcela de dívida"
                          style={iconBtnStyle}
                        >
                          <Link2 size={11} strokeWidth={1.8} />
                        </button>
                      )}
                      <button
                        onClick={() => setEditingTx(tx)}
                        title="editar"
                        style={iconBtnStyle}
                      >
                        <Pencil size={11} strokeWidth={1.8} />
                      </button>
                      <button
                        onClick={() => handleDelete(tx)}
                        title="deletar"
                        style={iconBtnStyle}
                      >
                        <Trash2 size={11} strokeWidth={1.8} />
                      </button>
                    </span>
                  </span>
                </div>
                </StaggerItem>
              )
            })}
          </StaggerList>
        )}
      </div>

      {/* Rodapé com totais + botões export e "+" */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto',
        gap: 'var(--space-4)', alignItems: 'center',
        padding: 'var(--space-4) var(--space-6)',
        borderTop: '1px solid var(--color-divider)',
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
      }}>
        <a
          href={buildFinExportTransactionsUrl({
            data_de: `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}-01`,
            data_ate: (() => {
              const lastDay = new Date(selectedMonth.year, selectedMonth.month, 0).getDate()
              return `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
            })(),
          })}
          title={`exportar transações de ${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')} em CSV`}
          style={{
            background: 'rgba(8, 12, 18, 0.55)',
            border: '1px solid var(--color-border)',
            cursor: 'pointer',
            color: 'var(--color-text-tertiary)',
            fontFamily: 'var(--font-mono)',
            padding: '6px 12px',
            fontSize: 9, fontWeight: 700,
            letterSpacing: '0.22em', textTransform: 'uppercase',
            borderRadius: 0,
            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            textDecoration: 'none',
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
          }}
        >
          <Download size={11} strokeWidth={2} />
          EXPORTAR CSV
        </a>
        <div />
        <div style={{ display: 'flex', gap: 24, fontSize: 11 }}>
          <FooterStat label="Receita" value={monthlySummary?.receita ?? 0} color="var(--color-success)" />
          <FooterStat label="Despesa" value={monthlySummary?.despesa ?? 0} color="var(--color-accent-primary)" />
          <FooterStat
            label="Saldo do mês"
            value={monthlySummary?.sobra ?? 0}
            color={(monthlySummary?.sobra ?? 0) >= 0 ? 'var(--color-text-primary)' : 'var(--color-accent-primary)'}
            bold
          />
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          title="novo lançamento"
          style={{
            background: 'rgba(143, 191, 211, 0.14)',
            border: '1px solid var(--color-ice)',
            cursor: 'pointer',
            color: 'var(--color-ice-light)',
            fontFamily: 'var(--font-mono)',
            padding: '7px 14px',
            fontSize: 10, fontWeight: 700,
            letterSpacing: '0.22em', textTransform: 'uppercase',
            borderRadius: 0,
            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            boxShadow: '0 0 12px rgba(143, 191, 211, 0.25)',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(143, 191, 211, 0.22)'
            e.currentTarget.style.boxShadow = '0 0 18px rgba(143, 191, 211, 0.40)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(143, 191, 211, 0.14)'
            e.currentTarget.style.boxShadow = '0 0 12px rgba(143, 191, 211, 0.25)'
          }}
        >
          <Plus size={11} strokeWidth={2.2} />
          NOVO
        </button>
      </div>

      {/* Modais */}
      {categorizingTx && (
        <CategorizeModal
          tx={categorizingTx}
          categories={categories}
          accounts={accounts}
          onClose={() => setCategorizingTx(null)}
          onSaved={() => { setCategorizingTx(null); refreshAll() }}
        />
      )}
      {editingTx && (
        <TransactionEditModal
          tx={editingTx}
          accounts={accounts}
          categories={categories}
          debts={debts}
          invoices={invoices}
          onClose={() => setEditingTx(null)}
          onSaved={() => { setEditingTx(null); refreshAll() }}
        />
      )}
      {showNewModal && (
        <NewTransactionModal
          accounts={accounts}
          categories={categories}
          defaultDate={defaultDate}
          onClose={() => setShowNewModal(false)}
          onCreated={() => { setShowNewModal(false); refreshAll() }}
        />
      )}
      {linkingTx && (
        <LinkTransactionModal
          tx={linkingTx}
          onClose={() => setLinkingTx(null)}
          onLinked={() => { setLinkingTx(null); refreshAll() }}
        />
      )}
    </Card>
  )
}

// ─── Sub-componentes locais ──────────────────────────────────────────────

function EmptyState({ icon, text, sub }: { icon: React.ReactNode; text: string; sub: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '60px 20px',
      color: 'var(--color-text-muted)',
    }}>
      <div style={{ marginBottom: 12, opacity: 0.5 }}>{icon}</div>
      <div style={{ fontSize: 12, marginBottom: 4 }}>{text}</div>
      <div style={{ fontSize: 10, opacity: 0.7 }}>{sub}</div>
    </div>
  )
}

function FooterStat({ label, value, color, bold }: {
  label: string; value: number; color: string; bold?: boolean
}) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9, fontWeight: 700,
        color: 'var(--color-text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.22em',
      }}>
        <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
        {label.toUpperCase()}
      </div>
      <div className="hq-money" style={{
        fontSize: 14, fontWeight: bold ? 700 : 700, color,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.02em',
        marginTop: 2,
      }}>
        {formatBRL(value)}
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────

// `shiftMonth` foi movido pro componente MonthPicker compartilhado.

const iconBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--color-text-tertiary)', padding: 4,
  display: 'inline-flex', alignItems: 'center',
  borderRadius: 3, transition: 'color 0.15s',
}

// Layout tabular dos lançamentos: data | tipo | nome | doc | categoria | conta | valor+ações.
// Compartilhado entre o header e cada linha pra alinhar perfeitamente.
// Larguras enxutas: data=DD/MM (5ch mono), tipo cabe "PIX RECEBIDO" (12ch),
// doc cabe CNPJ "00.000.000/0000-00" (18ch mono). Última coluna PRECISA ser
// fixa (não `auto`), senão valor+pencil+trash ocupa muito mais que o
// header "valor" e isso encolhe o 1fr da linha — desalinha tudo depois do nome.
const TX_GRID = '52px 88px minmax(0,1fr) 120px 100px 90px 170px'
const TX_GAP = 8
