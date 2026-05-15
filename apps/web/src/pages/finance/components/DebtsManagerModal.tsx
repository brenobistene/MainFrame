import { useEffect, useMemo, useState } from 'react'
import { CalendarRange, Landmark, X } from 'lucide-react'
import {
  fetchFinDebts, createFinDebt, updateFinDebt, deleteFinDebt,
  reportApiError,
} from '../../../api'
import type { FinAccount, FinDebt, FinCategory } from '../../../types'
import {
  sectionLabel, fieldLabel, inputStyle, primaryButton, ghostButton,
  modalOverlay, formatBRL, parseBRL, sanitizeMoneyInput,
  modalShell, modalHairline, modalHeader, modalBody,
} from './styleHelpers'
import { DebtParcelasModal } from './DebtParcelasModal'
import { confirmDialog, alertDialog } from '../../../lib/dialog'

/**
 * Modal de gerenciamento de dívidas — abre via botão "gerenciar dívidas"
 * no card resumido da Visão Geral. Lista + criar + editar + deletar +
 * progresso de cada dívida ativa. Substitui a aba "Dívidas" que era
 * pouco visitada.
 *
 * Carrega lista própria (não usa context) pra refletir mudanças após
 * editar/criar/deletar sem depender de refreshAll global pesado.
 */
export function DebtsManagerModal({ categories, accounts, onClose, onChanged }: {
  categories: FinCategory[]
  accounts: FinAccount[]
  onClose: () => void
  /** Notificado após mudança que afeta outros blocos (ex: deletar dívida). */
  onChanged: () => void
}) {
  const [debts, setDebts] = useState<FinDebt[]>([])
  const [loading, setLoading] = useState(true)
  const [editingDebt, setEditingDebt] = useState<FinDebt | 'new' | null>(null)
  const [managingParcelas, setManagingParcelas] = useState<FinDebt | null>(null)

  function refresh() {
    setLoading(true)
    fetchFinDebts()
      .then(setDebts)
      .catch(err => reportApiError('DebtsManagerModal.fetch', err))
      .finally(() => setLoading(false))
  }
  useEffect(() => { refresh() }, [])

  const totalDevedor = debts
    .filter(d => d.status === 'active')
    .reduce((s, d) => s + d.saldo_devedor, 0)
  const activeCount = debts.filter(d => d.status === 'active').length

  return (
    <>
      <div onClick={onClose} style={modalOverlay()}>
        <div onClick={e => e.stopPropagation()} style={{
          ...modalShell(),
          width: 'min(800px, calc(100vw - 16px))', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={modalHairline} />
          <div style={modalHeader()}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <Landmark size={14} strokeWidth={1.8} style={{ color: 'var(--color-text-tertiary)' }} />
            <div style={sectionLabel()}>Gerenciar dívidas</div>
            {activeCount > 0 && (
              <div style={{
                fontSize: 11, color: 'var(--color-text-muted)',
                fontFamily: 'var(--font-mono)',
              }}>
                faltam {formatBRL(totalDevedor)} no total
              </div>
            )}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setEditingDebt('new')}
              style={{ ...ghostButton(), fontSize: 9, padding: '6px 10px' }}
            >
              + nova dívida
            </button>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', padding: 4,
              display: 'inline-flex', marginLeft: 6,
            }}>
              <X size={14} strokeWidth={2} />
            </button>
          </div>
          </div>
          <div style={{ ...modalBody(), overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                carregando…
              </div>
            ) : debts.length === 0 ? (
              <div style={{
                padding: '20px 16px',
                border: '1px dashed var(--color-border)', borderRadius: 4,
                textAlign: 'center', color: 'var(--color-text-muted)',
                fontSize: 11, fontStyle: 'italic',
              }}>
                nenhuma dívida cadastrada. cadastre faculdade, financiamento, ou
                qualquer parcelamento pra acompanhar o saldo decrescendo.
              </div>
            ) : (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10,
              }}>
                {debts.map(d => (
                  <DebtCard
                    key={d.id}
                    debt={d}
                    categories={categories}
                    onEdit={() => setEditingDebt(d)}
                    onManageParcelas={() => setManagingParcelas(d)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {editingDebt && (
        <DebtFormModal
          debt={editingDebt === 'new' ? null : editingDebt}
          categories={categories}
          onClose={() => setEditingDebt(null)}
          onSaved={() => { setEditingDebt(null); refresh(); onChanged() }}
          onDeleted={() => { setEditingDebt(null); refresh(); onChanged() }}
        />
      )}

      {managingParcelas && (
        <DebtParcelasModal
          debt={managingParcelas}
          accounts={accounts}
          categories={categories}
          onClose={() => setManagingParcelas(null)}
          onChanged={() => { refresh(); onChanged() }}
        />
      )}
    </>
  )
}

// ─── Card individual de dívida ───────────────────────────────────────────

function DebtCard({ debt: d, categories, onEdit, onManageParcelas }: {
  debt: FinDebt
  categories: FinCategory[]
  onEdit: () => void
  onManageParcelas: () => void
}) {
  const cat = useMemo(
    () => d.categoria_id ? categories.find(c => c.id === d.categoria_id) : null,
    [d.categoria_id, categories],
  )
  const isPaidOff = d.status === 'paid_off'
  const accentColor = isPaidOff
    ? 'var(--color-success)'
    : d.progresso_pct >= 75
      ? 'var(--color-success)'
      : d.progresso_pct >= 30
        ? 'var(--color-accent-light)'
        : 'var(--color-accent-primary)'

  return (
    <div
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: 4, padding: '14px 16px',
        transition: 'border-color 0.15s',
        opacity: d.status === 'cancelled' ? 0.5 : 1,
      }}
    >
      <div
        onClick={onEdit}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}
        onMouseEnter={e => { (e.currentTarget.parentElement as HTMLElement).style.borderColor = 'var(--color-accent-light)' }}
        onMouseLeave={e => { (e.currentTarget.parentElement as HTMLElement).style.borderColor = 'var(--color-border)' }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {d.descricao}
          </div>
          {cat && (
            <div style={{
              fontSize: 9, color: 'var(--color-text-tertiary)',
              textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2,
            }}>
              {cat.nome}
            </div>
          )}
        </div>
        {isPaidOff && (
          <span style={{
            fontSize: 8, color: 'var(--color-success)',
            letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 700,
            whiteSpace: 'nowrap',
          }}>
            quitada
          </span>
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{
          fontSize: 18, fontWeight: 700,
          color: isPaidOff ? 'var(--color-success)' : 'var(--color-text-primary)',
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {formatBRL(d.saldo_devedor)}
        </div>
        <div style={{
          fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2,
        }}>
          de {formatBRL(d.valor_total_original)} ({d.progresso_pct.toFixed(0)}% pago)
        </div>
      </div>

      {/* Barra de progresso */}
      <div style={{
        marginTop: 10, height: 4,
        background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${d.progresso_pct}%`,
          background: accentColor, transition: 'width 0.3s',
        }} />
      </div>

      {!isPaidOff && d.parcelas_restantes != null && d.parcela_mensal && (
        <div style={{
          marginTop: 8, fontSize: 10, color: 'var(--color-text-tertiary)',
        }}>
          faltam <strong>{d.parcelas_restantes}</strong> parcela{d.parcelas_restantes === 1 ? '' : 's'} de {formatBRL(d.parcela_mensal)} (estimativa)
        </div>
      )}

      {/* Botão pra gerenciar cronograma de parcelas */}
      {!isPaidOff && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onManageParcelas() }}
          className="hq-btn hq-btn--ghost"
          style={{
            marginTop: 10,
            padding: '5px 10px',
            fontSize: 'var(--text-xs)',
            width: '100%',
            justifyContent: 'center',
          }}
        >
          <CalendarRange size={11} strokeWidth={1.8} />
          gerenciar parcelas
        </button>
      )}
    </div>
  )
}

// ─── Sub-modal de criar/editar dívida ───────────────────────────────────

function DebtFormModal({ debt, categories, onClose, onSaved, onDeleted }: {
  debt: FinDebt | null
  categories: FinCategory[]
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const isNew = debt === null
  const [descricao, setDescricao] = useState(debt?.descricao ?? '')
  const [valorTotal, setValorTotal] = useState<string>(debt ? String(debt.valor_total_original) : '')
  const [parcelaMensal, setParcelaMensal] = useState<string>(
    debt?.parcela_mensal != null ? String(debt.parcela_mensal) : ''
  )
  const [dataInicio, setDataInicio] = useState<string>(debt?.data_inicio ?? '')
  const [categoriaId, setCategoriaId] = useState<string>(debt?.categoria_id ?? '')
  const [busy, setBusy] = useState(false)

  const despesaCats = useMemo(
    () => categories.filter(c => c.tipo === 'despesa'),
    [categories],
  )

  function parseNum(s: string): number | null {
    return parseBRL(s)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const total = parseNum(valorTotal)
    if (!descricao.trim() || total == null || total <= 0) {
      alertDialog({ title: 'Campos obrigatórios', message: 'Preencha descrição e valor total (> 0).', variant: 'warning' }); return
    }
    const parcela = parcelaMensal.trim() ? parseNum(parcelaMensal) : null
    if (parcelaMensal.trim() && (parcela == null || parcela <= 0)) {
      alertDialog({ title: 'Parcela inválida', message: 'Parcela mensal inválida.', variant: 'warning' }); return
    }
    setBusy(true)
    try {
      const body = {
        descricao: descricao.trim(),
        valor_total_original: total,
        parcela_mensal: parcela,
        data_inicio: dataInicio || null,
        categoria_id: categoriaId || null,
      }
      if (isNew) await createFinDebt(body)
      else await updateFinDebt(debt!.id, body)
      onSaved()
    } catch (err) {
      reportApiError('DebtFormModal.submit', err)
      alertDialog({ title: 'Erro', message: 'Erro ao salvar — veja o console.', variant: 'danger' })
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!debt) return
    const ok = await confirmDialog({
      title: 'Deletar dívida',
      message: `Deletar dívida "${debt.descricao}"?\nTransações vinculadas continuam existindo, mas perdem o vínculo.`,
      confirmLabel: 'DELETAR',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await deleteFinDebt(debt.id)
      onDeleted()
    } catch (err) {
      reportApiError('DebtFormModal.delete', err)
      alertDialog({ title: 'Erro', message: 'Erro ao deletar — veja o console.', variant: 'danger' })
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ ...modalOverlay(), zIndex: 110 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--color-bg-primary)',
        border: '1px solid var(--color-border)',
        borderRadius: 4, padding: 24, minWidth: 460, maxWidth: 560,
      }}>
        <div style={sectionLabel()}>{isNew ? 'Nova dívida' : 'Editar dívida'}</div>

        {!isNew && debt && (
          <div style={{
            padding: 12, marginBottom: 16,
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 3,
            fontSize: 11, color: 'var(--color-text-secondary)',
          }}>
            Saldo devedor atual: <strong style={{ fontFamily: 'var(--font-mono)' }}>{formatBRL(debt.saldo_devedor)}</strong>
            {' · '}
            Pago: {formatBRL(debt.valor_pago)} ({debt.progresso_pct.toFixed(0)}%)
            {' · '}
            {debt.parcelas_pagas} parcela{debt.parcelas_pagas === 1 ? '' : 's'} vinculada{debt.parcelas_pagas === 1 ? '' : 's'}
          </div>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={fieldLabel()}>Descrição</label>
            <input
              autoFocus
              type="text" placeholder="ex: Faculdade UNINOVE, Financiamento moto"
              value={descricao} onChange={e => setDescricao(e.target.value)}
              style={inputStyle()}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={fieldLabel()}>Valor total original</label>
              <input
                type="text" inputMode="decimal" placeholder="ex: 24000,00"
                value={valorTotal} onChange={e => setValorTotal(sanitizeMoneyInput(e.target.value))}
                style={{ ...inputStyle(), fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div>
              <label style={fieldLabel()}>Parcela mensal (opcional)</label>
              <input
                type="text" inputMode="decimal" placeholder="ex: 800,00"
                value={parcelaMensal} onChange={e => setParcelaMensal(sanitizeMoneyInput(e.target.value))}
                style={{ ...inputStyle(), fontFamily: 'var(--font-mono)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={fieldLabel()}>Data de início (opcional)</label>
              <input
                type="date"
                value={dataInicio} onChange={e => setDataInicio(e.target.value)}
                style={inputStyle()}
              />
            </div>
            <div>
              <label style={fieldLabel()}>Categoria (opcional)</label>
              <select value={categoriaId} onChange={e => setCategoriaId(e.target.value)} style={inputStyle()}>
                <option value="">— sem categoria —</option>
                {despesaCats.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 8 }}>
            {!isNew ? (
              <button type="button" onClick={handleDelete} disabled={busy} style={{
                ...ghostButton(),
                color: 'var(--color-accent-primary)',
                borderColor: 'var(--color-accent-primary)',
              }}>
                deletar
              </button>
            ) : <div />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onClose} style={ghostButton()}>cancelar</button>
              <button type="submit" disabled={busy} style={primaryButton()}>
                {busy ? 'salvando…' : (isNew ? 'criar' : 'salvar')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
