/**
 * Modal de gerenciamento de parcelas de uma dívida — cronograma flexível.
 *
 * Cada parcela pode ter `valor_planejado` fixo ou ficar como "auto" (null),
 * e nesse caso o backend rateia o saldo restante entre as auto. Permite
 * cenários flexíveis tipo "primeira parcela menor + resto auto-distribuído".
 *
 * Aberto via botão "gerenciar parcelas" no DebtsManagerModal.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, CheckCircle2, ChevronLeft, Plus, Trash2,
  Wallet, X, Wand2,
} from 'lucide-react'
import {
  fetchFinDebtParcelas, createFinDebtParcela, updateFinDebtParcela,
  deleteFinDebtParcela, generateFinDebtParcelas, completeFinDebtParcelas,
  createFinTransaction, updateFinTransaction, reportApiError,
} from '../../../api'
import type {
  FinAccount, FinCategory, FinDebt, FinDebtParcela,
} from '../../../types'
import {
  sectionLabel, fieldLabel, hintText, inputStyle, primaryButton, ghostButton,
  modalOverlay, formatBRL, parseBRL, sanitizeMoneyInput, ICON_SIZE, ICON_STROKE,
  modalShell, modalHairline, modalHeader, modalBody,
} from './styleHelpers'
import { EmptyState, IconButton } from '../../../components/ui/Primitives'
import { confirmDialog, alertDialog } from '../../../lib/dialog'
import { useHubFinance } from '../HubFinanceContext'
import { LinkedTransactionPicker, PaymentModeToggle } from './LinkedTransactionPicker'

export function DebtParcelasModal({
  debt, accounts, categories, onClose, onChanged,
}: {
  debt: FinDebt
  accounts: FinAccount[]
  categories: FinCategory[]
  onClose: () => void
  onChanged: () => void
}) {
  const [parcelas, setParcelas] = useState<FinDebtParcela[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const [markingPaid, setMarkingPaid] = useState<FinDebtParcela | null>(null)

  function refresh() {
    setLoading(true)
    fetchFinDebtParcelas(debt.id)
      .then(setParcelas)
      .catch(err => reportApiError('DebtParcelasModal.fetch', err))
      .finally(() => setLoading(false))
  }
  useEffect(() => { refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [debt.id])

  // Cálculos agregados.
  //
  // Tolerância de 1 centavo (R$ 0,01) nas comparações pra absorver ruído de
  // IEEE-754: somar floats BRL pode produzir N.X1000000000001 quando o
  // "verdadeiro" é N.X1. Sem tolerância, o usuário vê alertas do tipo
  // "fixou X — mais que X" (mesma string nos dois lados do operador).
  const CENT_EPS = 0.01
  const sumPlanejado = parcelas.reduce((s, p) => s + (p.valor_planejado ?? 0), 0)
  const autoCount = parcelas.filter(p => p.is_auto).length
  const autoValue = autoCount > 0 ? (debt.valor_total_original - sumPlanejado) / autoCount : 0
  const sumPago = parcelas.reduce((s, p) => s + (p.valor_pago ?? 0), 0)
  const sumEfetivo = parcelas.reduce((s, p) => s + p.valor_efetivo, 0)
  const sobreAlocado = sumPlanejado > debt.valor_total_original + CENT_EPS
  const subAlocado = sumEfetivo < debt.valor_total_original - CENT_EPS

  async function handleAddParcela() {
    setBusy(true)
    try {
      // Default da data: 1 mês após a última parcela com data, ou após
      // debt.data_inicio, ou hoje. Sempre seta uma data — sem data, parcela
      // não aparece em "Compromissos do mês".
      const parcelasComData = parcelas.filter(p => p.data_prevista)
      const ultimaComData = parcelasComData[parcelasComData.length - 1]
      const baseIso = ultimaComData?.data_prevista ?? debt.data_inicio
      let nextDate: string
      if (baseIso) {
        const [yy, mm, dd] = baseIso.split('-').map(Number)
        const d = new Date(yy, mm - 1 + 1, dd)  // +1 mês
        nextDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      } else {
        // Sem base: usa hoje
        const now = new Date()
        nextDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      }
      await createFinDebtParcela(debt.id, {
        data_prevista: nextDate,
        valor_planejado: null,  // auto
      })
      refresh()
      onChanged()
    } catch (err) {
      reportApiError('DebtParcelasModal.addParcela', err)
      alertDialog({ title: 'Erro', message: 'Erro ao adicionar parcela.', variant: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteParcela(p: FinDebtParcela) {
    if (p.status === 'paga') {
      alertDialog({ title: 'Parcela já paga', message: 'Parcela já paga não pode ser deletada — desvincule a transação primeiro.', variant: 'warning' })
      return
    }
    const ok = await confirmDialog({
      title: 'Deletar parcela',
      message: `Deletar parcela #${p.numero.toString().padStart(2, '0')}?`,
      confirmLabel: 'DELETAR',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await deleteFinDebtParcela(p.id)
      refresh()
      onChanged()
    } catch (err) {
      reportApiError('DebtParcelasModal.deleteParcela', err)
      alertDialog({ title: 'Erro', message: 'Erro ao deletar.', variant: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  async function handleUnlinkPaid(p: FinDebtParcela) {
    const ok = await confirmDialog({
      title: 'Desvincular pagamento',
      message: `Desvincular pagamento da parcela #${p.numero.toString().padStart(2, '0')}?\n\nA transação NÃO é apagada (segue em Lançamentos), só perde o vínculo com a dívida. A parcela volta a "pendente".`,
      confirmLabel: 'DESVINCULAR',
    })
    if (!ok) return
    setBusy(true)
    try {
      // Limpa AMBOS os lados do link: o lado da parcela (transacao_pagamento_id)
      // e o lado da tx (divida_id). O linking original (em MarkParcelaPaidModal)
      // seta os dois, então a desvinculação simétrica também limpa os dois.
      // Sem isso, a tx ficaria "órfã" apontando pra dívida sem nenhuma parcela
      // correspondente.
      const txId = p.transacao_pagamento_id
      await updateFinDebtParcela(p.id, { transacao_pagamento_id: null })
      if (txId) {
        await updateFinTransaction(txId, { divida_id: null })
      }
      refresh()
      onChanged()
    } catch (err) {
      reportApiError('DebtParcelasModal.unlinkPaid', err)
      alertDialog({ title: 'Erro', message: 'Erro ao desvincular.', variant: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div onClick={onClose} style={modalOverlay()}>
        <div onClick={e => e.stopPropagation()} style={{
          ...modalShell(),
          width: 'min(880px, calc(100vw - 16px))', maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={modalHairline} />
          <div style={modalHeader()}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center',
            gap: 'var(--space-3)',
          }}>
            <IconButton label="voltar" onClick={onClose} variant="bare">
              <ChevronLeft size={ICON_SIZE.md} strokeWidth={1.6} />
            </IconButton>
            <div>
              <div style={sectionLabel()}>Cronograma de parcelas</div>
              <div style={{
                fontSize: 'var(--text-base)',
                color: 'var(--color-text-primary)',
                fontWeight: 600,
                marginTop: 2,
              }}>
                {debt.descricao}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <IconButton label="fechar" onClick={onClose} variant="bare">
              <X size={ICON_SIZE.md} strokeWidth={2} />
            </IconButton>
          </div>
          </div>
          <div style={{ ...modalBody(), overflowY: 'auto', flex: 1 }}>

          {/* Stats agregados */}
          <div
            className="hq-glass"
            style={{
              padding: 'var(--space-3) var(--space-4)',
              marginBottom: 'var(--space-4)',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 'var(--space-3)',
            }}
          >
            <ParcelaStat label="Total dívida" value={debt.valor_total_original} />
            <ParcelaStat label="Já pago" value={sumPago} color="var(--color-success-light)" />
            <ParcelaStat
              label="Saldo restante"
              value={Math.max(0, debt.valor_total_original - sumPago)}
              color="var(--color-text-primary)"
            />
            <ParcelaStat
              label={autoCount > 0 ? `Auto × ${autoCount}` : 'Sem auto'}
              value={autoCount > 0 ? autoValue : 0}
              color={autoValue < -CENT_EPS ? 'var(--color-error)' : 'var(--color-accent-light)'}
              hint={autoCount > 0 ? `cada parcela auto recebe este valor` : undefined}
            />
          </div>

          {/* Alertas */}
          {sobreAlocado && (
            <Alerta
              cor="danger"
              texto={`Você fixou R$ ${(sumPlanejado).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} — mais que o total da dívida (R$ ${debt.valor_total_original.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}). Reduza alguma parcela ou aumente o total.`}
            />
          )}
          {!sobreAlocado && subAlocado && parcelas.length > 0 && autoCount === 0 && (
            <Alerta
              cor="warning"
              texto={`Soma das parcelas planejadas (R$ ${sumEfetivo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) é menor que o total. Adicione mais parcelas ou marque alguma como "auto" pra cobrir o restante.`}
            />
          )}

          {/* Lista de parcelas */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {loading ? (
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', fontStyle: 'italic', padding: 'var(--space-4)' }}>
                carregando…
              </div>
            ) : parcelas.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-6) 0' }}>
                <EmptyState
                  text="Sem cronograma de parcelas"
                  sub="Crie um cronograma agora ou pague livremente — qualquer transação vinculada à dívida abate o saldo automaticamente."
                />
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button type="button" onClick={() => setShowGenerate(true)} style={primaryButton()}>
                    <Wand2 size={ICON_SIZE.xs} strokeWidth={2} />
                    gerar parcelas
                  </button>
                  <button type="button" onClick={handleAddParcela} disabled={busy} style={ghostButton()}>
                    <Plus size={ICON_SIZE.xs} strokeWidth={2} />
                    adicionar 1 parcela
                  </button>
                </div>
              </div>
            ) : (
              <ParcelasTable
                parcelas={parcelas}
                autoValue={autoValue}
                onEdit={async (id, patch) => {
                  try {
                    await updateFinDebtParcela(id, patch)
                    refresh()
                    onChanged()
                  } catch (err) {
                    reportApiError('DebtParcelasModal.edit', err)
                    alertDialog({ title: 'Erro', message: 'Erro ao atualizar.', variant: 'danger' })
                  }
                }}
                onDelete={handleDeleteParcela}
                onMarkPaid={p => setMarkingPaid(p)}
                onUnlinkPaid={handleUnlinkPaid}
              />
            )}
          </div>

          {/* Footer ações */}
          {parcelas.length > 0 && (
            <div style={{
              display: 'flex',
              gap: 'var(--space-2)',
              justifyContent: 'flex-end',
              alignItems: 'center',
              marginTop: 'var(--space-3)',
              paddingTop: 'var(--space-3)',
              borderTop: '1px solid var(--color-border)',
            }}>
              <button type="button" onClick={handleAddParcela} disabled={busy} style={ghostButton()}>
                <Plus size={ICON_SIZE.xs} strokeWidth={2} />
                + parcela
              </button>
              <button type="button" onClick={() => setShowComplete(true)} disabled={busy} style={primaryButton()}>
                <Wand2 size={ICON_SIZE.xs} strokeWidth={2} />
                auto-completar
              </button>
            </div>
          )}
        </div>
        </div>
      </div>

      {showGenerate && (
        <GenerateParcelasModal
          debt={debt}
          onClose={() => setShowGenerate(false)}
          onGenerated={() => { setShowGenerate(false); refresh(); onChanged() }}
        />
      )}

      {showComplete && (
        <CompleteParcelasModal
          debt={debt}
          parcelas={parcelas}
          autoCount={autoCount}
          onClose={() => setShowComplete(false)}
          onCompleted={() => { setShowComplete(false); refresh(); onChanged() }}
        />
      )}

      {markingPaid && (
        <MarkParcelaPaidModal
          debt={debt}
          parcela={markingPaid}
          accounts={accounts}
          categories={categories}
          onClose={() => setMarkingPaid(null)}
          onPaid={() => { setMarkingPaid(null); refresh(); onChanged() }}
        />
      )}
    </>
  )
}

// ─── Tabela de parcelas ─────────────────────────────────────────────────

function ParcelasTable({ parcelas, autoValue, onEdit, onDelete, onMarkPaid, onUnlinkPaid }: {
  parcelas: FinDebtParcela[]
  autoValue: number
  onEdit: (id: string, patch: { valor_planejado?: number | null; data_prevista?: string | null }) => void
  onDelete: (p: FinDebtParcela) => void
  onMarkPaid: (p: FinDebtParcela) => void
  onUnlinkPaid: (p: FinDebtParcela) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      {/* Header da tabela */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '40px 130px 1fr 90px auto',
        gap: 'var(--space-3)',
        alignItems: 'center',
        padding: '0 var(--space-3)',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        fontWeight: 600,
      }}>
        <span>#</span>
        <span>Vencimento</span>
        <span>Valor planejado</span>
        <span style={{ textAlign: 'right' }}>Status</span>
        <span />
      </div>
      {parcelas.map(p => (
        <ParcelaRow
          key={p.id}
          parcela={p}
          autoValue={autoValue}
          onEdit={onEdit}
          onDelete={() => onDelete(p)}
          onMarkPaid={() => onMarkPaid(p)}
          onUnlinkPaid={() => onUnlinkPaid(p)}
        />
      ))}
    </div>
  )
}

function ParcelaRow({ parcela, autoValue, onEdit, onDelete, onMarkPaid, onUnlinkPaid }: {
  parcela: FinDebtParcela
  autoValue: number
  onEdit: (id: string, patch: { valor_planejado?: number | null; data_prevista?: string | null }) => void
  onDelete: () => void
  onMarkPaid: () => void
  onUnlinkPaid: () => void
}) {
  const isPaga = parcela.status === 'paga'
  const isAtrasada = parcela.status === 'atrasada'
  const [valorDraft, setValorDraft] = useState<string>(
    parcela.valor_planejado != null
      ? String(parcela.valor_planejado).replace('.', ',')
      : ''
  )
  const [dataDraft, setDataDraft] = useState(parcela.data_prevista ?? '')

  // Sincroniza quando refetch traz novos valores
  useEffect(() => {
    setValorDraft(
      parcela.valor_planejado != null
        ? String(parcela.valor_planejado).replace('.', ',')
        : ''
    )
    setDataDraft(parcela.data_prevista ?? '')
  }, [parcela.valor_planejado, parcela.data_prevista])

  function commitValor() {
    const trimmed = valorDraft.trim()
    if (!trimmed) {
      // vazio = auto
      if (parcela.valor_planejado !== null) {
        onEdit(parcela.id, { valor_planejado: null })
      }
      return
    }
    const parsed = parseBRL(trimmed)
    if (parsed == null || parsed < 0) {
      alertDialog({ title: 'Valor inválido', message: 'Use número positivo ou deixe vazio pra auto.', variant: 'warning' })
      setValorDraft(parcela.valor_planejado != null
        ? String(parcela.valor_planejado).replace('.', ',') : '')
      return
    }
    if (parsed !== parcela.valor_planejado) {
      onEdit(parcela.id, { valor_planejado: parsed })
    }
  }

  function commitData() {
    const novo = dataDraft.trim() || null
    if (novo !== parcela.data_prevista) {
      onEdit(parcela.id, { data_prevista: novo })
    }
  }

  function setAuto() {
    if (parcela.valor_planejado !== null) {
      setValorDraft('')
      onEdit(parcela.id, { valor_planejado: null })
    }
  }

  const statusColor = isPaga
    ? 'var(--color-success-light)'
    : isAtrasada
      ? 'var(--color-error)'
      : 'var(--color-text-muted)'

  return (
    <div
      className="hq-glass"
      style={{
        display: 'grid',
        gridTemplateColumns: '40px 130px 1fr 90px auto',
        gap: 'var(--space-3)',
        alignItems: 'center',
        padding: 'var(--space-2) var(--space-3)',
        opacity: isPaga ? 0.7 : 1,
      }}
    >
      {/* Numero */}
      <span style={{
        fontSize: 'var(--text-sm)',
        fontFamily: 'var(--font-mono)',
        color: 'var(--color-text-tertiary)',
        textAlign: 'center',
      }}>
        {parcela.numero}
      </span>

      {/* Data */}
      <input
        type="date"
        value={dataDraft}
        onChange={e => setDataDraft(e.target.value)}
        onBlur={commitData}
        disabled={isPaga}
        style={{
          ...inputStyle(),
          padding: '4px 6px',
          fontSize: 'var(--text-xs)',
        }}
      />

      {/* Valor (com toggle auto) */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', minWidth: 0 }}>
        <input
          type="text"
          inputMode="decimal"
          placeholder={parcela.is_auto ? `auto · ${formatBRL(autoValue)}` : '0,00'}
          value={valorDraft}
          onChange={e => setValorDraft(sanitizeMoneyInput(e.target.value))}
          onBlur={commitValor}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          disabled={isPaga}
          style={{
            ...inputStyle(),
            flex: 1,
            minWidth: 0,
            padding: '4px 8px',
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
            color: parcela.is_auto && !valorDraft.trim()
              ? 'var(--color-accent-light)'
              : 'var(--color-text-primary)',
            fontStyle: parcela.is_auto && !valorDraft.trim() ? 'italic' : 'normal',
          }}
        />
        {!parcela.is_auto && !isPaga && (
          <button
            type="button"
            onClick={setAuto}
            title="deixar automático (rateia restante)"
            className="hq-btn hq-btn--ghost"
            style={{ padding: '2px 8px', fontSize: 9 }}
          >
            auto
          </button>
        )}
      </div>

      {/* Status */}
      <div style={{
        textAlign: 'right',
        fontSize: 'var(--text-xs)',
        display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end',
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: statusColor,
          boxShadow: isPaga
            ? '0 0 6px rgba(122, 154, 138, 0.5)'
            : isAtrasada
              ? '0 0 6px rgba(220, 38, 38, 0.5)'
              : 'none',
        }} />
        <span style={{ color: statusColor }}>{parcela.status}</span>
      </div>

      {/* Ações */}
      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
        {!isPaga && (
          <IconButton
            label={`marcar parcela ${parcela.numero} como paga`}
            onClick={onMarkPaid}
            variant="accent"
          >
            <Wallet size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
          </IconButton>
        )}
        {isPaga && (
          <IconButton
            label="desvincular pagamento"
            onClick={onUnlinkPaid}
          >
            <CheckCircle2 size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
          </IconButton>
        )}
        <IconButton
          label={`deletar parcela ${parcela.numero}`}
          onClick={onDelete}
          variant="danger"
        >
          <Trash2 size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
    </div>
  )
}

function ParcelaStat({ label, value, color, hint }: {
  label: string
  value: number
  color?: string
  hint?: string
}) {
  return (
    <div title={hint}>
      <div style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-tertiary)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        fontWeight: 600,
        marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 'var(--text-md)',
        fontWeight: 700,
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        color: color ?? 'var(--color-text-primary)',
      }}>
        {formatBRL(value)}
      </div>
    </div>
  )
}

function DiagRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      fontSize: 'var(--text-sm)',
      color: muted ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
      fontStyle: muted ? 'italic' : 'normal',
    }}>
      <span>{label}</span>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
    </div>
  )
}

function Alerta({ cor, texto }: { cor: 'danger' | 'warning'; texto: string }) {
  const bg = cor === 'danger' ? 'var(--color-danger-bg)' : 'var(--color-warning-bg)'
  const border = cor === 'danger' ? 'var(--color-danger-border)' : 'var(--color-warning-border)'
  const fg = cor === 'danger' ? 'var(--color-error)' : 'var(--color-warning)'
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 'var(--space-2)',
      padding: 'var(--space-2) var(--space-3)',
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 'var(--radius-sm)',
      marginBottom: 'var(--space-3)',
      fontSize: 'var(--text-xs)',
      color: fg,
      lineHeight: 1.5,
    }}>
      <AlertCircle size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{texto}</span>
    </div>
  )
}

// ─── Sub-modal: gerar N parcelas iniciais ───────────────────────────────

function GenerateParcelasModal({ debt, onClose, onGenerated }: {
  debt: FinDebt
  onClose: () => void
  onGenerated: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [n, setN] = useState('12')
  const [dataInicio, setDataInicio] = useState(debt.data_inicio || today)
  const [modo, setModo] = useState<'uniforme' | 'open'>('uniforme')
  const [busy, setBusy] = useState(false)

  const nParsed = parseInt(n, 10)
  const valorPorParcela = !isNaN(nParsed) && nParsed > 0
    ? debt.valor_total_original / nParsed
    : 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isNaN(nParsed) || nParsed < 1 || nParsed > 360) {
      alertDialog({ title: 'Quantidade inválida', message: 'Número de parcelas entre 1 e 360.', variant: 'warning' })
      return
    }
    if (!dataInicio) {
      alertDialog({ title: 'Data obrigatória', message: 'Defina data de início.', variant: 'warning' })
      return
    }
    setBusy(true)
    try {
      await generateFinDebtParcelas(debt.id, {
        n_parcelas: nParsed,
        data_inicio: dataInicio,
        modo,
      })
      onGenerated()
    } catch (err) {
      reportApiError('GenerateParcelasModal.submit', err)
      alertDialog({ title: 'Erro', message: 'Erro ao gerar parcelas.', variant: 'danger' })
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ ...modalOverlay(), zIndex: 110 }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...modalShell(),
        minWidth: 420, maxWidth: 500,
      }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Wand2 size={ICON_SIZE.md} strokeWidth={ICON_STROKE} style={{ color: 'var(--color-text-tertiary)' }} />
          <div style={sectionLabel()}>Gerar parcelas</div>
          <div style={{ flex: 1 }} />
          <IconButton label="fechar" onClick={onClose} variant="bare">
            <X size={ICON_SIZE.md} strokeWidth={2} />
          </IconButton>
        </div>
        </div>
        <div style={modalBody()}>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div>
            <label style={fieldLabel()}>Modo</label>
            <div style={{
              display: 'flex',
              background: 'var(--glass-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-pill)',
              padding: 3,
            }}>
              {(['uniforme', 'open'] as const).map(m => {
                const active = modo === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModo(m)}
                    style={{
                      flex: 1,
                      background: active ? 'var(--chrome-grad)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: active ? '#1a1a1c' : 'var(--color-text-tertiary)',
                      fontSize: 'var(--text-xs)',
                      fontWeight: active ? 700 : 500,
                      padding: '6px 14px',
                      borderRadius: 'var(--radius-pill)',
                      fontFamily: 'var(--font-body)',
                      transition: 'background var(--motion-fast) var(--ease-smooth), color var(--motion-fast) var(--ease-smooth)',
                    }}
                  >
                    {m === 'uniforme' ? 'uniforme' : 'auto (em branco)'}
                  </button>
                )
              })}
            </div>
            <div style={hintText()}>
              {modo === 'uniforme'
                ? 'Cada parcela vem com valor = total ÷ N (você pode editar depois).'
                : 'Cada parcela vem com valor "auto" — depois você fixa as que quiser e o sistema rateia o resto.'}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label style={fieldLabel()}>Quantas parcelas</label>
              <input
                autoFocus
                type="text"
                inputMode="numeric"
                value={n}
                onChange={e => setN(e.target.value)}
                style={{
                  ...inputStyle(), width: '100%', boxSizing: 'border-box',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>
            <div>
              <label style={fieldLabel()}>Data 1ª parcela</label>
              <input
                type="date"
                value={dataInicio}
                onChange={e => setDataInicio(e.target.value)}
                style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {modo === 'uniforme' && nParsed > 0 && (
            <div style={{
              padding: 'var(--space-3)',
              background: 'var(--glass-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>cada parcela:</span>
              <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>
                {formatBRL(valorPorParcela)}
              </strong>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
            <button type="button" onClick={onClose} style={ghostButton()}>cancelar</button>
            <button type="submit" disabled={busy} style={primaryButton()}>
              {busy ? 'gerando…' : 'gerar'}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-modal: marcar parcela como paga ────────────────────────────────

function MarkParcelaPaidModal({ debt, parcela, accounts, categories, onClose, onPaid }: {
  debt: FinDebt
  parcela: FinDebtParcela
  accounts: FinAccount[]
  categories: FinCategory[]
  onClose: () => void
  onPaid: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const { transactions } = useHubFinance()

  // Candidatos pra vincular: tx do mês selecionado (já carregadas no context),
  // despesa (valor < 0), e sem vínculo a OUTRA parcela/dívida/fatura. Tx
  // que tem `recurring_bill_id` é OK — uma tx pode legitimamente pagar
  // uma bill recorrente E quitar uma parcela de dívida ao mesmo tempo
  // (raro mas possível). Já vinculada a OUTRA dívida sim deve sair.
  const candidates = useMemo(() => {
    return transactions.filter(tx => {
      if (tx.valor >= 0) return false
      if (tx.parcela_id || tx.fatura_id || tx.pagamento_fatura_id) return false
      // Permite re-linkar tx já vinculada a ESTA dívida (idempotente)
      if (tx.divida_id && tx.divida_id !== debt.id) return false
      return true
    }).sort((a, b) => {
      const expected = parcela.valor_efetivo
      const aExact = Math.abs(Math.abs(a.valor) - expected) < 0.005 ? 0 : 1
      const bExact = Math.abs(Math.abs(b.valor) - expected) < 0.005 ? 0 : 1
      if (aExact !== bExact) return aExact - bExact
      return a.data.localeCompare(b.data)
    })
  }, [transactions, parcela.valor_efetivo, debt.id])

  const [mode, setMode] = useState<'link' | 'create'>(
    candidates.length > 0 ? 'link' : 'create'
  )
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null)

  const [data, setData] = useState(parcela.data_prevista || today)
  const [valor, setValor] = useState(String(parcela.valor_efetivo).replace('.', ','))
  const [descricao, setDescricao] = useState(`${debt.descricao} · parcela ${parcela.numero}`)
  const [contaId, setContaId] = useState(accounts[0]?.id ?? '')
  const [categoriaId, setCategoriaId] = useState(debt.categoria_id ?? '')
  const [busy, setBusy] = useState(false)

  const filteredCats = categories.filter(c => c.tipo === 'despesa')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      if (mode === 'link') {
        if (!selectedTxId) {
          alertDialog({ title: 'Nenhum lançamento selecionado', message: 'Escolha um lançamento da lista pra vincular, ou troque pra "criar novo".', variant: 'warning' })
          setBusy(false)
          return
        }
        // Linka a tx existente: seta tx.divida_id pra rastrear no LancamentosPage
        // E vincula a parcela à tx (idempotente, pode re-linkar).
        // Propaga categoria da dívida se a tx ainda não tem categoria — mantém
        // consistência pra relatórios e filtros de Lançamentos.
        const selectedTx = candidates.find(t => t.id === selectedTxId)
        const patch: Parameters<typeof updateFinTransaction>[1] = {
          divida_id: debt.id,
        }
        if (debt.categoria_id && selectedTx && !selectedTx.categoria_id) {
          patch.categoria_id = debt.categoria_id
        }
        await updateFinTransaction(selectedTxId, patch)
        await updateFinDebtParcela(parcela.id, { transacao_pagamento_id: selectedTxId })
        onPaid()
        return
      }
      // mode === 'create' — fluxo antigo
      if (!descricao.trim() || !contaId) {
        alertDialog({ title: 'Campos obrigatórios', message: 'Descrição e conta são obrigatórias.', variant: 'warning' })
        setBusy(false)
        return
      }
      const valorNum = parseBRL(valor)
      if (valorNum == null || valorNum < 0) {
        alertDialog({ title: 'Valor inválido', message: 'Valor inválido.', variant: 'warning' })
        setBusy(false)
        return
      }
      // Aceita valor 0 SOMENTE se a parcela foi planejada como zero (carência,
      // mês "pulado" do cronograma). Caso contrário, valor 0 é provável erro
      // de digitação.
      if (valorNum === 0 && (parcela.valor_planejado ?? 0) !== 0) {
        alertDialog({ title: 'Valor inválido', message: 'Essa parcela não é zerada.', variant: 'warning' })
        setBusy(false)
        return
      }
      // 1. Cria a transação como despesa (negativa) vinculada à dívida
      const tx = await createFinTransaction({
        data,
        valor: -Math.abs(valorNum),
        descricao: descricao.trim(),
        conta_id: contaId,
        categoria_id: categoriaId || null,
      })
      // 2. Linka tx → dívida e parcela → tx
      await updateFinTransaction(tx.id, { divida_id: debt.id })
      await updateFinDebtParcela(parcela.id, { transacao_pagamento_id: tx.id })
      onPaid()
    } catch (err) {
      reportApiError('MarkParcelaPaidModal.submit', err)
      alertDialog({ title: 'Erro', message: 'Erro ao registrar pagamento.', variant: 'danger' })
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ ...modalOverlay(), zIndex: 120 }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...modalShell(),
        minWidth: 460, maxWidth: 540,
      }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Wallet size={ICON_SIZE.md} strokeWidth={ICON_STROKE} style={{ color: 'var(--color-text-tertiary)' }} />
          <div style={sectionLabel()}>Pagar parcela {parcela.numero}</div>
          <div style={{ flex: 1 }} />
          <IconButton label="fechar" onClick={onClose} variant="bare">
            <X size={ICON_SIZE.md} strokeWidth={2} />
          </IconButton>
        </div>
        </div>
        <div style={modalBody()}>

        <div style={hintText()}>
          {mode === 'link'
            ? <>Escolha um lançamento já importado pra vincular à parcela. A dívida abate sem criar duplicata.</>
            : <>Cria transação de despesa nova vinculada à dívida e marca a parcela como paga. Use quando o pagamento ainda não está nos lançamentos.</>
          }
        </div>

        <form onSubmit={submit} style={{
          display: 'flex', flexDirection: 'column',
          gap: 'var(--space-3)', marginTop: 'var(--space-4)',
        }}>
          <PaymentModeToggle
            mode={mode}
            onChange={setMode}
            candidateCount={candidates.length}
          />

          {mode === 'link' ? (
            <LinkedTransactionPicker
              candidates={candidates}
              selectedTxId={selectedTxId}
              onSelect={setSelectedTxId}
              accounts={accounts}
              categories={categories}
              expectedValor={parcela.valor_efetivo}
            />
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 'var(--space-3)' }}>
                <div>
                  <label style={fieldLabel()}>Data</label>
                  <input
                    type="date"
                    value={data}
                    onChange={e => setData(e.target.value)}
                    style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={fieldLabel()}>Valor pago (R$)</label>
                  <input
                    autoFocus
                    type="text"
                    inputMode="decimal"
                    value={valor}
                    onChange={e => setValor(sanitizeMoneyInput(e.target.value))}
                    style={{
                      ...inputStyle(), width: '100%', boxSizing: 'border-box',
                      fontFamily: 'var(--font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  />
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
                    planejado: {formatBRL(parcela.valor_efetivo)}
                  </div>
                </div>
              </div>

              <div>
                <label style={fieldLabel()}>Descrição</label>
                <input
                  type="text"
                  value={descricao}
                  onChange={e => setDescricao(e.target.value)}
                  style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <div>
                  <label style={fieldLabel()}>Conta de pagamento</label>
                  <select
                    value={contaId}
                    onChange={e => setContaId(e.target.value)}
                    style={{ ...inputStyle(), width: '100%' }}
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>{a.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={fieldLabel()}>Categoria</label>
                  <select
                    value={categoriaId}
                    onChange={e => setCategoriaId(e.target.value)}
                    style={{ ...inputStyle(), width: '100%' }}
                  >
                    <option value="">— sem —</option>
                    {filteredCats.map(c => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
            <button type="button" onClick={onClose} style={ghostButton()}>cancelar</button>
            <button
              type="submit"
              disabled={busy || (mode === 'link' && !selectedTxId)}
              style={primaryButton()}
            >
              <CheckCircle2 size={ICON_SIZE.xs} strokeWidth={2} />
              {busy
                ? 'registrando…'
                : mode === 'link' ? 'vincular pagamento' : 'registrar pagamento'}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-modal: auto-completar parcelas pelo saldo restante ─────────────

function CompleteParcelasModal({ debt, parcelas, autoCount, onClose, onCompleted }: {
  debt: FinDebt
  parcelas: FinDebtParcela[]
  autoCount: number
  onClose: () => void
  onCompleted: () => void
}) {
  // Math transparente — mostra cada componente pro user verificar
  const parcelasFixas = parcelas.filter(p => p.valor_planejado != null)
  const sumFixed = parcelasFixas.reduce((s, p) => s + (p.valor_planejado ?? 0), 0)
  const sumPaidTotal = parcelas.reduce((s, p) => s + (p.valor_pago ?? 0), 0)
  const sumEfetivoTotal = parcelas.reduce((s, p) => s + p.valor_efetivo, 0)
  const restante = debt.valor_total_original - sumFixed

  // Data inferida: última parcela + 1 mês, ou hoje se sem parcelas com data
  const inferredStart = useMemo(() => {
    const ultima = [...parcelas]
      .filter(p => p.data_prevista)
      .sort((a, b) => b.numero - a.numero)[0]
    if (ultima?.data_prevista) {
      const [yy, mm, dd] = ultima.data_prevista.split('-').map(Number)
      const next = new Date(yy, mm, dd)  // mm é 1-indexed mas Date usa 0-indexed → +1 mês automático
      return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
    }
    return new Date().toISOString().slice(0, 10)
  }, [parcelas])

  const [n, setN] = useState('')
  const [dataInicio, setDataInicio] = useState(inferredStart)
  const [busy, setBusy] = useState(false)

  const nParsed = parseInt(n, 10)
  const valid = !isNaN(nParsed) && nParsed > 0 && nParsed <= 360
  const valorEach = valid && restante > 0 ? restante / nParsed : 0
  const semRestante = restante < 1.0  // alinha com backend
  const sobrealocado = restante < -0.01

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (semRestante) {
      alertDialog({ title: 'Sem saldo', message: 'Não há saldo restante pra distribuir — parcelas fixas já cobrem o total.', variant: 'warning' })
      return
    }
    if (!valid) {
      alertDialog({ title: 'Quantas parcelas?', message: 'Informe número de parcelas (entre 1 e 360).', variant: 'warning' })
      return
    }
    setBusy(true)
    try {
      await completeFinDebtParcelas(debt.id, {
        n_parcelas: nParsed,
        data_inicio: dataInicio || undefined,
      })
      onCompleted()
    } catch (err) {
      reportApiError('CompleteParcelasModal.submit', err)
      alertDialog({ title: 'Erro', message: (err as Error).message || 'Erro ao completar.', variant: 'danger' })
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ ...modalOverlay(), zIndex: 110 }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...modalShell(),
        minWidth: 460, maxWidth: 540,
      }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Wand2 size={ICON_SIZE.md} strokeWidth={ICON_STROKE} style={{ color: 'var(--color-text-tertiary)' }} />
          <div style={sectionLabel()}>Auto-completar parcelas</div>
          <div style={{ flex: 1 }} />
          <IconButton label="fechar" onClick={onClose} variant="bare">
            <X size={ICON_SIZE.md} strokeWidth={2} />
          </IconButton>
        </div>
        </div>
        <div style={modalBody()}>

        {/* Diagnóstico transparente — math step-by-step */}
        <div
          className="hq-glass"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-3)',
            display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
          }}
        >
          <div style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-tertiary)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontWeight: 600,
            marginBottom: 'var(--space-1)',
          }}>
            Saldo a distribuir
          </div>

          <DiagRow label="Total da dívida" value={formatBRL(debt.valor_total_original)} />
          <DiagRow
            label={`Soma das ${parcelasFixas.length} parcela${parcelasFixas.length === 1 ? '' : 's'} com valor fixo`}
            value={`− ${formatBRL(sumFixed)}`}
            muted={sumFixed === 0}
          />
          {autoCount > 0 && (
            <DiagRow
              label={`${autoCount} parcela${autoCount === 1 ? '' : 's'} auto (vão recalcular)`}
              value="—"
              muted
            />
          )}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            paddingTop: 'var(--space-2)',
            borderTop: '1px solid var(--color-border)',
          }}>
            <span style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              fontWeight: 600,
            }}>
              Restante
            </span>
            <span style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              color: sobrealocado
                ? 'var(--color-error)'
                : semRestante
                  ? 'var(--color-text-muted)'
                  : 'var(--color-text-primary)',
            }}>
              {formatBRL(restante)}
            </span>
          </div>
        </div>

        {sobrealocado && (
          <Alerta
            cor="danger"
            texto={`Parcelas fixas (${formatBRL(sumFixed)}) excedem o total (${formatBRL(debt.valor_total_original)}). Reduza alguma fixa antes de auto-completar.`}
          />
        )}

        {!sobrealocado && semRestante && (
          <Alerta
            cor="warning"
            texto={`Restante (${formatBRL(restante)}) menor que R$1,00. Parcelas fixas já cobrem o total. Se a soma das fixas que você vê (${formatBRL(sumFixed)}) não bate com o que esperava, edite as parcelas individualmente — pode ter sobrado de geração anterior.`}
          />
        )}

        {!semRestante && autoCount > 0 && (
          <Alerta
            cor="warning"
            texto={`Você tem ${autoCount} parcela${autoCount === 1 ? ' auto' : 's auto'} no cronograma absorvendo o restante atual (${formatBRL(sumEfetivoTotal - sumFixed)} ÷ ${autoCount} = ${formatBRL((sumEfetivoTotal - sumFixed) / Math.max(1, autoCount))} cada). Após adicionar essas N novas FIXAS, ${autoCount === 1 ? 'a auto vai recalcular' : 'as autos vão recalcular'} pra cobrir o que sobrar.`}
          />
        )}

        {sumPaidTotal > 0 && (
          <Alerta
            cor="warning"
            texto={`Você já pagou ${formatBRL(sumPaidTotal)} dessa dívida. Saldo a distribuir aqui é baseado no TOTAL ORIGINAL da dívida, não no saldo restante a pagar — porque parcelas planejadas representam o cronograma todo. Se quer só "completar pagamentos", edite as parcelas existentes em vez disso.`}
          />
        )}

        <form onSubmit={submit} style={{
          display: 'flex', flexDirection: 'column',
          gap: 'var(--space-4)',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label style={fieldLabel()}>Em quantas parcelas</label>
              <input
                autoFocus
                type="text"
                inputMode="numeric"
                placeholder="ex: 5"
                value={n}
                onChange={e => setN(e.target.value)}
                disabled={semRestante}
                style={{
                  ...inputStyle(), width: '100%', boxSizing: 'border-box',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>
            <div>
              <label style={fieldLabel()}>Data 1ª parcela nova</label>
              <input
                type="date"
                value={dataInicio}
                onChange={e => setDataInicio(e.target.value)}
                disabled={semRestante}
                style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
              />
              <div style={hintText()}>
                default: 1 mês após a última parcela existente
              </div>
            </div>
          </div>

          {valid && !semRestante && (
            <div style={{
              padding: 'var(--space-3)',
              background: 'var(--glass-bg)',
              border: '1px solid var(--color-border-chrome)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                cada uma das {nParsed} parcelas:
              </span>
              <strong style={{
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 'var(--text-md)',
                color: 'var(--color-text-primary)',
              }}>
                {formatBRL(valorEach)}
              </strong>
            </div>
          )}

          <div style={{
            display: 'flex', gap: 'var(--space-2)',
            justifyContent: 'flex-end', marginTop: 'var(--space-2)',
          }}>
            <button type="button" onClick={onClose} style={ghostButton()}>cancelar</button>
            <button
              type="submit"
              disabled={busy || semRestante || !valid}
              style={primaryButton()}
            >
              {busy ? 'gerando…' : 'gerar parcelas'}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}
