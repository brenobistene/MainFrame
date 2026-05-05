/**
 * Modal pequeno pra atualizar a cotação BRL de uma conta em moeda estrangeira.
 * Aberto via botão de "editar cotação" no card de Saldo Geral.
 */
import { useState } from 'react'
import { Globe, X } from 'lucide-react'
import {
  updateFinAccount, fetchFinExchangeRate, reportApiError,
} from '../../../api'
import type { FinAccount } from '../../../types'
import {
  sectionLabel, fieldLabel, inputStyle, primaryButton, ghostButton, modalOverlay,
  modalShell, modalHairline, modalHeader, modalBody,
  formatMoney, parseBRL, sanitizeMoneyInput,
} from './styleHelpers'

export function ExchangeRateModal({ account, onClose, onSaved }: {
  account: FinAccount
  onClose: () => void
  onSaved: () => void
}) {
  const [cotacao, setCotacao] = useState<string>(
    account.cotacao_brl != null ? String(account.cotacao_brl).replace('.', ',') : ''
  )
  const [busy, setBusy] = useState(false)
  const [fetchingRate, setFetchingRate] = useState(false)

  async function handleFetchRate() {
    setFetchingRate(true)
    try {
      const r = await fetchFinExchangeRate(account.moeda, 'BRL')
      setCotacao(String(r.rate).replace('.', ','))
    } catch (err) {
      reportApiError('ExchangeRateModal.fetchRate', err)
      alert('Não consegui buscar online (rede bloqueada ou API offline). Cadastra manualmente.')
    } finally {
      setFetchingRate(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    let cotacaoNum: number | null = null
    if (cotacao.trim()) {
      const parsed = parseBRL(cotacao)
      if (parsed == null || parsed <= 0) {
        alert('Cotação inválida — use número positivo ou deixe em branco pra remover.')
        return
      }
      cotacaoNum = parsed
    }
    setBusy(true)
    try {
      await updateFinAccount(account.id, { cotacao_brl: cotacaoNum })
      onSaved()
    } catch (err) {
      reportApiError('ExchangeRateModal.submit', err)
      alert('Erro ao salvar — veja o console.')
      setBusy(false)
    }
  }

  const previewBRL = (() => {
    const parsed = parseBRL(cotacao)
    if (parsed == null || parsed <= 0) return null
    return account.saldo * parsed
  })()

  return (
    <div onClick={onClose} style={modalOverlay()}>
      <div onClick={e => e.stopPropagation()} style={{
        ...modalShell(),
        minWidth: 420, maxWidth: 480,
      }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div style={sectionLabel()}>
            Cotação · {account.nome}
          </div>
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
          padding: 12, marginBottom: 14,
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderLeft: '3px solid var(--color-accent-light)',
          borderRadius: 3, fontSize: 12,
        }}>
          Saldo atual: <strong style={{ fontFamily: 'var(--font-mono)' }}>
            {formatMoney(account.saldo, account.moeda)}
          </strong>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={fieldLabel()}>Quanto vale 1 {account.moeda} em BRL?</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                autoFocus
                type="text" inputMode="decimal"
                placeholder="ex: 5,20"
                value={cotacao}
                onChange={e => setCotacao(sanitizeMoneyInput(e.target.value))}
                style={{ ...inputStyle(), flex: 1, fontFamily: 'var(--font-mono)' }}
              />
              <button
                type="button"
                onClick={handleFetchRate}
                disabled={fetchingRate}
                title="Buscar cotação atual via AwesomeAPI"
                style={{ ...ghostButton(), padding: '6px 10px' }}
              >
                <Globe size={11} strokeWidth={1.8} style={{ marginRight: 4 }} />
                {fetchingRate ? '…' : 'buscar online'}
              </button>
            </div>
            <div style={{
              fontSize: 9, color: 'var(--color-text-muted)',
              marginTop: 4, fontStyle: 'italic',
            }}>
              em branco = essa conta não entra no saldo total da Visão Geral.
            </div>
          </div>

          {previewBRL !== null && (
            <div style={{
              padding: 10,
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)', borderRadius: 3,
              fontSize: 11, color: 'var(--color-text-secondary)',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>equivalente em BRL:</span>
              <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>
                {formatMoney(previewBRL, 'BRL')}
              </strong>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
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
