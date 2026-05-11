/**
 * Modal pra vincular um lançamento existente a uma conta fixa OU parcela
 * de dívida. Fluxo simétrico ao "marcar como paga": ao invés de partir do
 * compromisso e procurar tx, parte da tx e procura compromisso.
 *
 * Usado em LancamentosPage — botão Link2 ao lado de edit/delete em
 * transações ainda não vinculadas.
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Link2, X } from 'lucide-react'
import {
  fetchFinDebtParcelas, updateFinTransaction, updateFinDebtParcela,
  reportApiError,
} from '../../../api'
import type {
  FinTransaction, FinDebt, FinDebtParcela, FinRecurringBill,
} from '../../../types'
import {
  sectionLabel, hintText, primaryButton, ghostButton,
  modalOverlay, formatBRL, formatDate, ICON_SIZE, ICON_STROKE,
  modalShell, modalHairline, modalHeader, modalBody,
} from './styleHelpers'
import { IconButton } from '../../../components/ui/Primitives'
import { alertDialog } from '../../../lib/dialog'
import { useHubFinance } from '../HubFinanceContext'

type Selection =
  | { kind: 'bill'; bill: FinRecurringBill }
  | { kind: 'parcela'; parcela: FinDebtParcela; debt: FinDebt }

export function LinkTransactionModal({ tx, onClose, onLinked }: {
  tx: FinTransaction
  onClose: () => void
  onLinked: () => void
}) {
  const { recurringBills, debts } = useHubFinance()
  const [parcelasByDebt, setParcelasByDebt] = useState<Record<string, FinDebtParcela[]>>({})
  const [loadingParcelas, setLoadingParcelas] = useState(true)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [busy, setBusy] = useState(false)

  const isExpense = tx.valor < 0
  const txValor = Math.abs(tx.valor)

  // Bills compatíveis com o sinal da tx. Ordenação prioriza:
  // 1) Match exato de valor (bate centavo a centavo)
  // 2) Mesma conta de pagamento que a tx (bill.conta_pagamento_id === tx.conta_id) —
  //    se você tem 2 bills de R$100 mas só uma é "luz pagas pelo Nubank", a do
  //    Nubank vem primeiro quando a tx é do Nubank
  // 3) Alfabético por descrição
  const matchingBills = useMemo(() => {
    return recurringBills
      .filter(b => b.ativa && (isExpense ? b.tipo === 'despesa' : b.tipo === 'receita'))
      .sort((a, b) => {
        const aExact = Math.abs(a.valor_estimado - txValor) < 0.005 ? 0 : 1
        const bExact = Math.abs(b.valor_estimado - txValor) < 0.005 ? 0 : 1
        if (aExact !== bExact) return aExact - bExact
        const aSameAcc = a.conta_pagamento_id === tx.conta_id ? 0 : 1
        const bSameAcc = b.conta_pagamento_id === tx.conta_id ? 0 : 1
        if (aSameAcc !== bSameAcc) return aSameAcc - bSameAcc
        return a.descricao.localeCompare(b.descricao)
      })
  }, [recurringBills, isExpense, txValor, tx.conta_id])

  // Parcelas de dívida — só faz sentido pra tx de despesa.
  // Fetch todas parcelas pendentes/atrasadas de todas as dívidas ativas.
  useEffect(() => {
    if (!isExpense) {
      setLoadingParcelas(false)
      return
    }
    let cancelled = false
    const activeDebts = debts.filter(d => d.status === 'active')
    if (activeDebts.length === 0) {
      setLoadingParcelas(false)
      return
    }
    Promise.all(activeDebts.map(d =>
      fetchFinDebtParcelas(d.id)
        .then(parcelas => ({ debtId: d.id, parcelas }))
        .catch(() => ({ debtId: d.id, parcelas: [] as FinDebtParcela[] }))
    )).then(results => {
      if (cancelled) return
      const map: Record<string, FinDebtParcela[]> = {}
      for (const r of results) {
        // Filtra: pendente ou atrasada (não pagas/canceladas)
        map[r.debtId] = r.parcelas.filter(p =>
          p.status === 'pendente' || p.status === 'atrasada'
        )
      }
      setParcelasByDebt(map)
      setLoadingParcelas(false)
    })
    return () => { cancelled = true }
  }, [debts, isExpense])

  // Agrupado por dívida: cada dívida ativa que tem parcelas pendentes
  // vira um grupo. Parcelas dentro de cada grupo ordenadas por data.
  const debtGroups = useMemo(() => {
    const groups: {
      debt: FinDebt
      parcelas: FinDebtParcela[]
      hasExactMatch: boolean
      totalPendente: number
    }[] = []
    for (const debt of debts) {
      const parcelas = (parcelasByDebt[debt.id] ?? []).slice().sort((a, b) => {
        const aDate = a.data_prevista ?? 'z'
        const bDate = b.data_prevista ?? 'z'
        return aDate.localeCompare(bDate)
      })
      if (parcelas.length === 0) continue
      const hasExactMatch = parcelas.some(p =>
        Math.abs(p.valor_efetivo - txValor) < 0.005
      )
      const totalPendente = parcelas.reduce((s, p) => s + p.valor_efetivo, 0)
      groups.push({ debt, parcelas, hasExactMatch, totalPendente })
    }
    // Dividas com match exato primeiro, depois por nome
    return groups.sort((a, b) => {
      if (a.hasExactMatch !== b.hasExactMatch) return a.hasExactMatch ? -1 : 1
      return a.debt.descricao.localeCompare(b.debt.descricao)
    })
  }, [debts, parcelasByDebt, txValor])

  // Dívidas expandidas — abre automaticamente as que têm match exato
  const [expandedDebts, setExpandedDebts] = useState<Set<string>>(new Set())
  useEffect(() => {
    // Pré-expande dívidas com match exato no primeiro render dos grupos.
    // Só faz isso uma vez (quando expandedDebts ainda está vazio).
    setExpandedDebts(prev => {
      if (prev.size > 0) return prev
      const next = new Set<string>()
      for (const g of debtGroups) {
        if (g.hasExactMatch) next.add(g.debt.id)
      }
      return next
    })
  }, [debtGroups])

  function toggleDebt(debtId: string) {
    setExpandedDebts(prev => {
      const next = new Set(prev)
      if (next.has(debtId)) next.delete(debtId)
      else next.add(debtId)
      return next
    })
  }

  async function submit() {
    if (!selection) {
      alertDialog({ title: 'Selecione uma opção', message: 'Escolha uma conta fixa ou parcela pra vincular.', variant: 'warning' })
      return
    }
    setBusy(true)
    try {
      if (selection.kind === 'bill') {
        await updateFinTransaction(tx.id, { recurring_bill_id: selection.bill.id })
      } else {
        // Parcela: linka tx → dívida + parcela → tx
        await updateFinTransaction(tx.id, { divida_id: selection.debt.id })
        await updateFinDebtParcela(selection.parcela.id, {
          transacao_pagamento_id: tx.id,
        })
      }
      onLinked()
    } catch (err) {
      reportApiError('LinkTransactionModal.submit', err)
      alertDialog({ title: 'Erro', message: 'Erro ao vincular — veja o console.', variant: 'danger' })
      setBusy(false)
    }
  }

  const hasAnyOption = matchingBills.length > 0 || debtGroups.length > 0

  return (
    <div onClick={onClose} style={{ ...modalOverlay(), zIndex: 110 }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...modalShell(),
        width: 'min(640px, 92vw)',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={modalHairline} />
        <div style={{ ...modalHeader(), flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <Link2 size={ICON_SIZE.md} strokeWidth={ICON_STROKE} style={{ color: 'var(--color-text-tertiary)' }} />
            <div style={sectionLabel()}>Vincular lançamento</div>
            <div style={{ flex: 1 }} />
            <IconButton label="fechar" onClick={onClose} variant="bare">
              <X size={ICON_SIZE.md} strokeWidth={2} />
            </IconButton>
          </div>
        </div>
        <div style={{ ...modalBody(), overflowY: 'auto', flex: 1 }}>

        {/* Resumo da tx que está sendo linkada */}
        <div style={{
          padding: '10px 14px',
          background: 'rgba(8, 12, 18, 0.55)',
          border: '1px solid rgba(143, 191, 211, 0.22)',
          borderLeft: `2px solid ${isExpense ? 'var(--color-accent-primary)' : 'var(--color-success-light)'}`,
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
          marginBottom: 'var(--space-3)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
            marginBottom: 4,
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            LANÇAMENTO · {formatDate(tx.data)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{
              fontSize: 13, color: 'var(--color-text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              minWidth: 0, flex: 1,
            }}>
              {tx.descricao}
            </div>
            <div className="hq-money" style={{
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 14, fontWeight: 700,
              color: isExpense ? 'var(--color-accent-light)' : 'var(--color-success-light)',
            }}>
              {isExpense ? '−' : '+'}{formatBRL(txValor)}
            </div>
          </div>
        </div>

        <div style={hintText()}>
          {hasAnyOption
            ? 'Escolha o compromisso que esta tx paga. Linkar evita registrar duplicado e atualiza o status do mês.'
            : 'Nenhuma conta fixa ou parcela compatível encontrada.'}
        </div>

        {/* Seção: Contas fixas */}
        {matchingBills.length > 0 && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <SectionTag label={`CONTA.FIXA [${matchingBills.length.toString().padStart(2, '0')}]`} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              {matchingBills.map(bill => {
                const isSelected = selection?.kind === 'bill' && selection.bill.id === bill.id
                const isExactMatch = Math.abs(bill.valor_estimado - txValor) < 0.005
                return (
                  <OptionRow
                    key={bill.id}
                    selected={isSelected}
                    exactMatch={isExactMatch}
                    onClick={() => setSelection(isSelected ? null : { kind: 'bill', bill })}
                    title={bill.descricao}
                    subtitle={bill.dia_vencimento ? `vence dia ${bill.dia_vencimento}` : 'sem dia fixo'}
                    valor={bill.valor_estimado}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* Seção: Parcelas de dívida — só pra despesa. Hierárquico:
            dívida expansível → parcelas dentro. */}
        {isExpense && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <SectionTag
              label={loadingParcelas
                ? 'DIVIDA · CARREGANDO…'
                : `DIVIDA [${debtGroups.length.toString().padStart(2, '0')}]`}
            />
            {!loadingParcelas && debtGroups.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                {debtGroups.map(group => {
                  const isExpanded = expandedDebts.has(group.debt.id)
                  const hasSelectedInside = selection?.kind === 'parcela'
                    && selection.debt.id === group.debt.id
                  return (
                    <div key={group.debt.id}>
                      {/* Header da dívida — clicável pra expandir */}
                      <button
                        type="button"
                        onClick={() => toggleDebt(group.debt.id)}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '12px 1fr auto',
                          gap: 10, alignItems: 'center',
                          width: '100%',
                          padding: '8px 12px',
                          background: hasSelectedInside
                            ? 'rgba(143, 191, 211, 0.10)'
                            : 'rgba(8, 12, 18, 0.55)',
                          border: '1px solid rgba(143, 191, 211, 0.22)',
                          borderLeft: group.hasExactMatch
                            ? '2px solid var(--color-success-light)'
                            : '2px solid var(--color-ice-deep)',
                          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          color: 'inherit',
                          transition: 'background 0.15s, border-color 0.15s',
                        }}
                        onMouseEnter={e => {
                          if (!hasSelectedInside) {
                            e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                            e.currentTarget.style.background = 'rgba(143, 191, 211, 0.06)'
                          }
                        }}
                        onMouseLeave={e => {
                          if (!hasSelectedInside) {
                            e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.22)'
                            e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
                          }
                        }}
                      >
                        {isExpanded
                          ? <ChevronDown size={12} strokeWidth={2} style={{ color: 'var(--color-ice-light)' }} />
                          : <ChevronRight size={12} strokeWidth={2} style={{ color: 'var(--color-text-muted)' }} />}
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontSize: 12,
                            color: 'var(--color-text-primary)',
                            fontWeight: 600,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {group.debt.descricao}
                          </div>
                          <div style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 9, fontWeight: 700,
                            color: 'var(--color-text-muted)',
                            letterSpacing: '0.18em', textTransform: 'uppercase',
                            marginTop: 2,
                          }}>
                            {group.parcelas.length.toString().padStart(2, '0')} PARC PEND
                            {group.hasExactMatch && (
                              <span style={{ color: 'var(--color-success-light)', marginLeft: 6 }}>
                                · MATCH EXATO
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="hq-money" style={{
                          fontFamily: 'var(--font-mono)',
                          fontVariantNumeric: 'tabular-nums',
                          fontSize: 12, fontWeight: 700,
                          color: 'var(--color-text-tertiary)',
                        }}>
                          {formatBRL(group.totalPendente)}
                        </span>
                      </button>

                      {/* Parcelas dentro — só aparece se expandido */}
                      {isExpanded && (
                        <div style={{
                          display: 'flex', flexDirection: 'column', gap: 3,
                          marginTop: 3, marginLeft: 12, paddingLeft: 8,
                          borderLeft: '1px dashed rgba(143, 191, 211, 0.22)',
                        }}>
                          {group.parcelas.map(parcela => {
                            const isSelected = selection?.kind === 'parcela'
                              && selection.parcela.id === parcela.id
                            const isExactMatch = Math.abs(parcela.valor_efetivo - txValor) < 0.005
                            const isAtrasada = parcela.status === 'atrasada'
                            return (
                              <OptionRow
                                key={parcela.id}
                                selected={isSelected}
                                exactMatch={isExactMatch}
                                atrasada={isAtrasada}
                                onClick={() => setSelection(isSelected
                                  ? null
                                  : { kind: 'parcela', parcela, debt: group.debt })}
                                title={`parcela ${parcela.numero}`}
                                subtitle={parcela.data_prevista
                                  ? `vence ${parcela.data_prevista.split('-').reverse().slice(0, 2).join('/')}`
                                  : 'sem data prevista'}
                                valor={parcela.valor_efetivo}
                              />
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {!loadingParcelas && debtGroups.length === 0 && (
              <div style={{
                marginTop: 8,
                padding: '10px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.18em', textTransform: 'uppercase',
                border: '1px dashed rgba(143, 191, 211, 0.22)',
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
              }}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                NENHUMA DIVIDA COM PARCELA PENDENTE
              </div>
            )}
          </div>
        )}

        <div style={{
          display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end',
          marginTop: 'var(--space-4)',
        }}>
          <button type="button" onClick={onClose} style={ghostButton()}>cancelar</button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !selection}
            style={primaryButton()}
          >
            <Link2 size={ICON_SIZE.xs} strokeWidth={2} />
            {busy ? 'vinculando…' : 'vincular'}
          </button>
        </div>
        </div>
      </div>
    </div>
  )
}

function SectionTag({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        width: 3, height: 12,
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
        {label}
      </span>
    </div>
  )
}

function OptionRow({
  selected, exactMatch, atrasada, onClick, title, subtitle, valor,
}: {
  selected: boolean
  exactMatch: boolean
  atrasada?: boolean
  onClick: () => void
  title: string
  subtitle: string
  valor: number
}) {
  const accentColor = atrasada
    ? 'var(--color-accent-primary)'
    : exactMatch
      ? 'var(--color-success-light)'
      : 'var(--color-ice-deep)'
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '14px 1fr auto',
        gap: 10, alignItems: 'center',
        padding: '8px 12px',
        background: selected
          ? 'rgba(143, 191, 211, 0.14)'
          : 'rgba(8, 12, 18, 0.55)',
        border: selected
          ? '1px solid var(--color-ice)'
          : '1px solid rgba(143, 191, 211, 0.22)',
        borderLeft: `2px solid ${accentColor}`,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
        cursor: 'pointer',
        textAlign: 'left',
        color: 'inherit',
        transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
        boxShadow: selected ? '0 0 12px rgba(143, 191, 211, 0.20)' : 'none',
      }}
      onMouseEnter={e => {
        if (!selected) {
          e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
          e.currentTarget.style.background = 'rgba(143, 191, 211, 0.06)'
        }
      }}
      onMouseLeave={e => {
        if (!selected) {
          e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.22)'
          e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
        }
      }}
    >
      {/* Radio */}
      <span style={{
        width: 12, height: 12,
        border: selected ? '2px solid var(--color-ice)' : '1px solid var(--color-text-muted)',
        background: selected ? 'var(--color-ice-light)' : 'transparent',
        boxShadow: selected ? '0 0 8px var(--color-ice-glow)' : 'none',
        flexShrink: 0,
      }} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          color: 'var(--color-text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9, fontWeight: 700,
          color: atrasada ? 'var(--color-accent-light)' : 'var(--color-text-muted)',
          letterSpacing: '0.18em', textTransform: 'uppercase',
          marginTop: 2,
        }}>
          {atrasada && 'ATRASADA · '}{subtitle}
        </div>
      </div>
      <span className="hq-money" style={{
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        fontSize: 12, fontWeight: 700,
        color: exactMatch ? 'var(--color-success-light)' : 'var(--color-text-primary)',
        textShadow: exactMatch ? '0 0 8px rgba(125, 154, 111, 0.40)' : 'none',
      }}>
        {formatBRL(valor)}
      </span>
    </button>
  )
}
