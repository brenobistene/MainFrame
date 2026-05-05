/**
 * Modal de reconciliação de saldo — usuário entra o saldo REAL do banco e o
 * sistema calcula a diferença vs saldo computado pelas transações.
 *
 * Se há diferença, oferece criar uma transação de ajuste (positiva ou negativa)
 * pra sincronizar. Útil pra contas manuais (carteira, dinheiro físico) onde
 * gastos pequenos não são lançados, ou pra detectar transações duplicadas/
 * faltantes em contas com import.
 */
import { useMemo, useState } from 'react'
import { CheckCircle, Plus, X } from 'lucide-react'
import { createFinTransaction, reportApiError } from '../../../api'
import type { FinAccount } from '../../../types'
import {
  sectionLabel, fieldLabel, inputStyle, primaryButton, ghostButton, modalOverlay,
  modalShell, modalHairline, modalHeader, modalBody,
  formatMoney, parseBRL, sanitizeMoneyInput,
} from './styleHelpers'

const TOL = 0.01  // tolerância pra arredondamento

export function ReconciliationModal({ account, onClose, onSaved }: {
  account: FinAccount
  onClose: () => void
  onSaved: () => void
}) {
  const [saldoReal, setSaldoReal] = useState('')
  const [busy, setBusy] = useState(false)
  const [today] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

  const saldoRealNum = useMemo(() => parseBRL(saldoReal), [saldoReal])

  const diferenca = saldoRealNum != null ? saldoRealNum - account.saldo : null
  const isMatch = diferenca != null && Math.abs(diferenca) <= TOL

  async function createAdjustment() {
    if (diferenca == null || isMatch) return
    setBusy(true)
    try {
      await createFinTransaction({
        data: today,
        valor: Math.round(diferenca * 100) / 100,
        descricao: 'Ajuste de reconciliação',
        conta_id: account.id,
        categoria_id: null,
        origem: 'manual',
        notas: `Reconciliação manual em ${today} — saldo calculado era ${formatMoney(account.saldo, account.moeda)}, real ${formatMoney(saldoRealNum!, account.moeda)}.`,
      })
      onSaved()
    } catch (err) {
      reportApiError('ReconciliationModal.adjustment', err)
      alert('Erro ao criar ajuste — veja o console.')
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div style={sectionLabel()}>Conciliar · {account.nome}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-tertiary)', padding: 4,
            display: 'inline-flex',
          }}>
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        </div>
        <div style={modalBody()}>

        <div style={{
          fontSize: 11, color: 'var(--color-text-muted)',
          marginBottom: 14, lineHeight: 1.5,
        }}>
          Compare o saldo que o app calculou com o saldo real do extrato. Se
          divergir, crie uma transação de ajuste com a diferença — útil pra
          carteira física (gastos não lançados) ou pra detectar import duplicado.
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
          marginBottom: 14,
        }}>
          <div style={{
            padding: 12,
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)', borderRadius: 3,
          }}>
            <div style={{
              fontSize: 9, color: 'var(--color-text-tertiary)',
              letterSpacing: '0.1em', textTransform: 'uppercase',
              fontWeight: 600, marginBottom: 4,
            }}>
              Saldo calculado
            </div>
            <div style={{
              fontSize: 16, fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-primary)',
            }}>
              {formatMoney(account.saldo, account.moeda)}
            </div>
          </div>
          <div style={{
            padding: 12,
            background: diferenca == null
              ? 'var(--color-bg-secondary)'
              : isMatch
                ? 'rgba(34, 197, 94, 0.08)'
                : 'rgba(239, 68, 68, 0.08)',
            border: `1px solid ${
              diferenca == null
                ? 'var(--color-border)'
                : isMatch
                  ? 'rgba(34, 197, 94, 0.3)'
                  : 'rgba(239, 68, 68, 0.3)'
            }`,
            borderRadius: 3,
          }}>
            <div style={{
              fontSize: 9, color: 'var(--color-text-tertiary)',
              letterSpacing: '0.1em', textTransform: 'uppercase',
              fontWeight: 600, marginBottom: 4,
            }}>
              Diferença
            </div>
            <div style={{
              fontSize: 16, fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color: diferenca == null
                ? 'var(--color-text-muted)'
                : isMatch
                  ? 'var(--color-success)'
                  : 'var(--color-accent-primary)',
            }}>
              {diferenca == null
                ? '—'
                : isMatch
                  ? formatMoney(0, account.moeda)
                  : `${diferenca > 0 ? '+' : ''}${formatMoney(diferenca, account.moeda)}`}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={fieldLabel()}>
            Saldo real do banco/carteira ({account.moeda})
          </label>
          <input
            autoFocus
            type="text" inputMode="decimal"
            placeholder="ex: 1234,56"
            value={saldoReal}
            onChange={e => setSaldoReal(sanitizeMoneyInput(e.target.value))}
            style={{ ...inputStyle(), fontFamily: 'var(--font-mono)' }}
          />
        </div>

        {isMatch && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', marginBottom: 8,
            background: 'rgba(34, 197, 94, 0.08)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            borderRadius: 3,
            fontSize: 12, color: 'var(--color-success)',
          }}>
            <CheckCircle size={13} strokeWidth={1.8} />
            <span>tudo certo — saldos batem.</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" onClick={onClose} style={ghostButton()}>
            fechar
          </button>
          {diferenca != null && !isMatch && (
            <button
              type="button"
              onClick={createAdjustment}
              disabled={busy}
              style={primaryButton()}
            >
              <Plus size={11} strokeWidth={2} style={{ marginRight: 4 }} />
              {busy
                ? 'criando…'
                : `criar ajuste de ${diferenca > 0 ? '+' : ''}${formatMoney(diferenca, account.moeda)}`}
            </button>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}
