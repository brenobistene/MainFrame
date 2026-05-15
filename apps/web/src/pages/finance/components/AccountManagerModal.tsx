/**
 * Modal de gerenciamento de carteiras — listar/renomear/deletar/reordenar/conciliar.
 *
 * Aberto via botão "gerenciar carteiras" no footer da página /carteira.
 * Cada linha tem: setas up/down + nome + saldo + ações (editar / conciliar /
 * cotação / deletar). Reorder usa setas (mais simples que drag-and-drop em
 * modal scrollable).
 *
 * Sub-modais: AccountEditModal (rename/tipo), ExchangeRateModal (cotação),
 * ReconciliationModal (saldo real).
 *
 * Refator Sprint 1 (ui-ux-pro-max): tokens CSS + IconButton + EmptyState.
 */
import { useState } from 'react'
import {
  ArrowDown, ArrowUp, CheckSquare, Globe, Pencil, Trash2, Wallet, X,
} from 'lucide-react'
import {
  updateFinAccount, deleteFinAccount, reorderFinAccounts,
  fetchFinAccountUsage, reportApiError,
} from '../../../api'
import type { FinAccount } from '../../../types'
import {
  sectionLabel, fieldLabel, hintText, inputStyle, primaryButton, ghostButton,
  modalOverlay, formatMoney, ICON_SIZE, ICON_STROKE, ICON_STROKE_HEAVY,
  modalShell, modalHairline, modalHeader, modalBody,
} from './styleHelpers'
import { EmptyState, IconButton } from '../../../components/ui/Primitives'
import { ExchangeRateModal } from './ExchangeRateModal'
import { ReconciliationModal } from './ReconciliationModal'
import { confirmDialog, alertDialog } from '../../../lib/dialog'

export function AccountManagerModal({ accounts, onClose, onChanged }: {
  accounts: FinAccount[]
  onClose: () => void
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<FinAccount | null>(null)
  const [editingRate, setEditingRate] = useState<FinAccount | null>(null)
  const [conciliating, setConciliating] = useState<FinAccount | null>(null)
  const [busy, setBusy] = useState(false)

  // Ordem local pra mover up/down sem esperar refetch.
  const [order, setOrder] = useState(() => accounts.map(a => a.id))
  const sorted = order
    .map(id => accounts.find(a => a.id === id))
    .filter((a): a is FinAccount => a != null)

  // Re-sincroniza se accounts mudou (ex: depois de delete).
  if (accounts.length !== order.length || accounts.some(a => !order.includes(a.id))) {
    const newOrder = accounts.map(a => a.id)
    if (newOrder.join(',') !== order.join(',')) {
      setOrder(newOrder)
    }
  }

  async function move(idx: number, delta: -1 | 1) {
    const next = idx + delta
    if (next < 0 || next >= sorted.length) return
    const newOrder = [...order]
    const [moved] = newOrder.splice(idx, 1)
    newOrder.splice(next, 0, moved)
    setOrder(newOrder)
    try {
      await reorderFinAccounts(newOrder)
      onChanged()
    } catch (err) {
      reportApiError('AccountManagerModal.reorder', err)
      alertDialog({ title: 'Erro', message: 'Erro ao reordenar — veja o console.', variant: 'danger' })
    }
  }

  async function handleDelete(acc: FinAccount) {
    setBusy(true)
    try {
      const usage = await fetchFinAccountUsage(acc.id)
      const lines = [`Deletar carteira "${acc.nome}"?`]
      if (usage.transactions > 0) {
        lines.push(`\n⚠ ${usage.transactions} transação(ões) vinculada(s) serão DELETADAS junto.`)
      }
      if (usage.invoices > 0) {
        lines.push(`⚠ ${usage.invoices} fatura(s) desse cartão também serão deletadas.`)
      }
      if (usage.transactions === 0 && usage.invoices === 0) {
        lines.push('\nNenhuma transação/fatura vinculada.')
      }
      lines.push('\nEssa ação não pode ser desfeita.')
      const ok = await confirmDialog({
        title: 'Deletar carteira',
        message: lines.join('\n'),
        confirmLabel: 'DELETAR',
        danger: true,
      })
      if (!ok) {
        setBusy(false)
        return
      }
      await deleteFinAccount(acc.id)
      onChanged()
    } catch (err) {
      reportApiError('AccountManagerModal.delete', err)
      alertDialog({ title: 'Erro', message: 'Erro ao deletar — veja o console.', variant: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div onClick={onClose} style={modalOverlay()}>
        <div onClick={e => e.stopPropagation()} style={{
          ...modalShell(),
          width: 'min(760px, calc(100vw - 16px))', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={modalHairline} />
          <div style={modalHeader()}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}>
            <Wallet
              size={ICON_SIZE.md}
              strokeWidth={ICON_STROKE}
              style={{ color: 'var(--color-text-tertiary)' }}
            />
            <div style={sectionLabel()}>Gerenciar carteiras</div>
            <div style={{ flex: 1 }} />
            <IconButton label="fechar" onClick={onClose} variant="bare">
              <X size={ICON_SIZE.md} strokeWidth={ICON_STROKE_HEAVY} />
            </IconButton>
          </div>

          <div style={{
            ...hintText(),
            marginTop: 'var(--space-3)',
          }}>
            Renomear, deletar, reordenar ou conciliar saldo. <strong>Deletar carteira apaga
            todas as transações e faturas vinculadas</strong> — ação irreversível.
          </div>
          </div>
          <div style={{ ...modalBody(), overflowY: 'auto', flex: 1 }}>

          {sorted.length === 0 ? (
            <EmptyState text="Nenhuma carteira cadastrada" dense />
          ) : (
            <div style={{
              overflowY: 'auto',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}>
              {sorted.map((acc, idx) => {
                const isForeign = acc.moeda !== 'BRL'
                return (
                  <div key={acc.id} style={{
                    display: 'grid',
                    gridTemplateColumns: '32px 1fr 140px auto',
                    gap: 'var(--space-3)',
                    alignItems: 'center',
                    padding: 'var(--space-3)',
                    background: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <button
                        type="button"
                        onClick={() => move(idx, -1)}
                        disabled={busy || idx === 0}
                        title="mover pra cima"
                        aria-label={`mover ${acc.nome} pra cima`}
                        style={arrowBtn(idx === 0)}
                      >
                        <ArrowUp size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(idx, +1)}
                        disabled={busy || idx === sorted.length - 1}
                        title="mover pra baixo"
                        aria-label={`mover ${acc.nome} pra baixo`}
                        style={arrowBtn(idx === sorted.length - 1)}
                      >
                        <ArrowDown size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />
                      </button>
                    </div>
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      minWidth: 0,
                    }}>
                      <div style={{
                        fontSize: 'var(--text-base)',
                        fontWeight: 600,
                        color: 'var(--color-text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {acc.nome}
                      </div>
                      <div style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-tertiary)',
                      }}>
                        {acc.tipo} · {acc.moeda}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 'var(--text-sm)',
                      fontWeight: 600,
                      fontFamily: 'var(--font-mono)',
                      color: acc.saldo < 0
                        ? 'var(--color-accent-primary)'
                        : 'var(--color-text-primary)',
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {formatMoney(acc.saldo, acc.moeda)}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      <IconButton label="renomear" onClick={() => setEditing(acc)}>
                        <Pencil size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
                      </IconButton>
                      <IconButton label="conciliar saldo" onClick={() => setConciliating(acc)}>
                        <CheckSquare size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
                      </IconButton>
                      {isForeign && (
                        <IconButton
                          label={acc.cotacao_brl
                            ? `editar cotação (R$${acc.cotacao_brl.toFixed(2)}/${acc.moeda})`
                            : 'definir cotação'}
                          onClick={() => setEditingRate(acc)}
                          variant={acc.cotacao_brl ? 'default' : 'danger'}
                        >
                          <Globe size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
                        </IconButton>
                      )}
                      <IconButton
                        label="deletar carteira"
                        onClick={() => handleDelete(acc)}
                        disabled={busy}
                        variant="danger"
                      >
                        <Trash2 size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
                      </IconButton>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          </div>
        </div>
      </div>

      {editing && (
        <AccountEditModal
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged() }}
        />
      )}
      {editingRate && (
        <ExchangeRateModal
          account={editingRate}
          onClose={() => setEditingRate(null)}
          onSaved={() => { setEditingRate(null); onChanged() }}
        />
      )}
      {conciliating && (
        <ReconciliationModal
          account={conciliating}
          onClose={() => setConciliating(null)}
          onSaved={() => { setConciliating(null); onChanged() }}
        />
      )}
    </>
  )
}

// ─── Sub-modal: rename/edit account ──────────────────────────────────────

function AccountEditModal({ account, onClose, onSaved }: {
  account: FinAccount
  onClose: () => void
  onSaved: () => void
}) {
  const [nome, setNome] = useState(account.nome)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return
    setBusy(true)
    try {
      await updateFinAccount(account.id, { nome: nome.trim() })
      onSaved()
    } catch (err) {
      reportApiError('AccountEditModal.submit', err)
      alertDialog({ title: 'Erro', message: 'Erro ao salvar — veja o console.', variant: 'danger' })
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ ...modalOverlay(), zIndex: 110 }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...modalShell(),
        minWidth: 380, maxWidth: 460,
      }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <div style={sectionLabel()}>Renomear carteira</div>
        </div>
        <div style={modalBody()}>
        <form onSubmit={submit} style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}>
          <div>
            <label style={fieldLabel()}>Nome</label>
            <input
              autoFocus
              type="text"
              value={nome}
              onChange={e => setNome(e.target.value)}
              style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
            />
            <div style={hintText()}>
              tipo ({account.tipo}) e moeda ({account.moeda}) não podem ser
              alterados depois de criada — afetam saldo e categorização.
            </div>
          </div>
          <div style={{
            display: 'flex',
            gap: 'var(--space-2)',
            justifyContent: 'flex-end',
            marginTop: 'var(--space-2)',
          }}>
            <button type="button" onClick={onClose} style={ghostButton()}>cancelar</button>
            <button type="submit" disabled={busy} style={primaryButton()}>
              {busy ? 'salvando…' : 'salvar'}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}

function arrowBtn(disabled: boolean): React.CSSProperties {
  return {
    background: 'none',
    border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    color: disabled ? 'var(--color-text-muted)' : 'var(--color-text-tertiary)',
    padding: 2,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: disabled ? 0.3 : 1,
    transition: 'color var(--motion-fast) var(--motion-easing)',
  }
}
