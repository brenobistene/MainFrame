import { useState } from 'react'
import { Globe } from 'lucide-react'
import {
  createFinAccount, fetchFinExchangeRate, reportApiError,
} from '../../../api'
import type { FinAccountType } from '../../../types'
import {
  sectionLabel, fieldLabel, inputStyle, primaryButton, ghostButton,
  modalOverlay, modalShell, modalHairline, modalHeader, modalBody,
  parseBRL, sanitizeMoneyInput,
} from './styleHelpers'

export function AccountModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: () => void
}) {
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<FinAccountType>('corrente')
  const [moeda, setMoeda] = useState('BRL')
  const [cotacao, setCotacao] = useState('')
  const [busy, setBusy] = useState(false)
  const [fetchingRate, setFetchingRate] = useState(false)

  function handleTipoChange(novo: FinAccountType) {
    setTipo(novo)
    if (novo === 'wise' && moeda === 'BRL') setMoeda('USD')
    if (novo !== 'wise' && moeda !== 'BRL') { setMoeda('BRL'); setCotacao('') }
  }

  async function handleFetchRate() {
    if (moeda === 'BRL') return
    setFetchingRate(true)
    try {
      const r = await fetchFinExchangeRate(moeda, 'BRL')
      setCotacao(String(r.rate).replace('.', ','))
    } catch (err) {
      reportApiError('AccountModal.fetchRate', err)
      alert('Não consegui buscar online (rede bloqueada ou API offline). Cadastra manualmente.')
    } finally {
      setFetchingRate(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return
    let cotacaoNum: number | null = null
    if (moeda !== 'BRL' && cotacao.trim()) {
      const parsed = parseBRL(cotacao)
      if (parsed == null || parsed <= 0) {
        alert('Cotação inválida — deixe em branco se preferir definir depois.')
        return
      }
      cotacaoNum = parsed
    }
    setBusy(true)
    try {
      await createFinAccount({
        nome: nome.trim(), tipo, moeda, cotacao_brl: cotacaoNum,
      })
      onCreated()
    } catch (err) {
      reportApiError('createFinAccount', err)
      alert('Erro ao criar conta — veja o console.')
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={modalOverlay()}>
      <div onClick={e => e.stopPropagation()} style={{ ...modalShell(), minWidth: 380 }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <div style={sectionLabel()}>Nova carteira</div>
        </div>
        <div style={modalBody()}>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            autoFocus
            type="text" placeholder="nome (ex: Nubank, Wise, Carteira)"
            value={nome} onChange={e => setNome(e.target.value)}
            style={inputStyle()}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
            <select value={tipo} onChange={e => handleTipoChange(e.target.value as FinAccountType)} style={inputStyle()}>
              <option value="corrente">conta corrente</option>
              <option value="credito">cartão de crédito</option>
              <option value="wise">wise</option>
              <option value="wallet">carteira / dinheiro</option>
            </select>
            <select value={moeda} onChange={e => setMoeda(e.target.value)} style={inputStyle()}>
              <option value="BRL">BRL</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
          {moeda !== 'BRL' && (
            <div>
              <label style={fieldLabel()}>Cotação ({moeda} → BRL) — opcional</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text" inputMode="decimal"
                  placeholder="ex: 5,20 — em branco = não soma no saldo total"
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
                  {fetchingRate ? '…' : 'buscar'}
                </button>
              </div>
              <div style={{
                fontSize: 9, color: 'var(--color-text-muted)',
                marginTop: 4, fontStyle: 'italic', lineHeight: 1.5,
              }}>
                quanto vale 1 {moeda} em BRL. usado pra somar essa conta no saldo
                total da Visão Geral. atualize manualmente quando flutuar (ou
                clique "buscar" pra cotar online).
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onClick={onClose} style={ghostButton()}>cancelar</button>
            <button type="submit" disabled={busy} style={primaryButton()}>criar</button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}
