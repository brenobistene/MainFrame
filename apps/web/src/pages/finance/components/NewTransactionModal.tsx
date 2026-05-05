import { useMemo, useState } from 'react'
import { createFinTransaction, reportApiError } from '../../../api'
import type { FinAccount, FinCategory } from '../../../types'
import {
  sectionLabel, fieldLabel, inputStyle, primaryButton, ghostButton, modalOverlay,
  parseBRL, sanitizeMoneyInput,
  modalShell, modalHairline, modalHeader, modalBody,
} from './styleHelpers'

/**
 * Modal pra lançar transação manual. Substitui o NewTransactionForm inline
 * que existia na página antiga — modal é mais alinhado com UX do Organizze
 * (botão "+" abre form, fecha após salvar).
 *
 * Default da data = data inicial do mês selecionado (passada via prop) pra
 * facilitar lançamento retroativo durante a navegação por meses passados.
 */
export function NewTransactionModal({
  accounts, categories, defaultDate, onClose, onCreated,
}: {
  accounts: FinAccount[]
  categories: FinCategory[]
  defaultDate?: string
  onClose: () => void
  onCreated: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [data, setData] = useState(defaultDate ?? today)
  const [tipo, setTipo] = useState<'entrada' | 'saida'>('saida')
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [contaId, setContaId] = useState(accounts[0]?.id ?? '')
  const [categoriaId, setCategoriaId] = useState('')
  const [busy, setBusy] = useState(false)

  // Filtra categorias compatíveis com tipo selecionado.
  const filteredCats = useMemo(() => {
    if (tipo === 'entrada') return categories.filter(c => c.tipo === 'receita' || c.tipo === 'estorno' || c.tipo === 'transferencia')
    return categories.filter(c => c.tipo === 'despesa' || c.tipo === 'transferencia')
  }, [categories, tipo])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!descricao.trim() || !contaId) {
      alert('Preencha descrição e selecione uma conta.'); return
    }
    const valorNum = parseBRL(valor)
    if (valorNum == null || valorNum === 0) { alert('Valor inválido.'); return }
    setBusy(true)
    try {
      await createFinTransaction({
        data,
        valor: tipo === 'entrada' ? Math.abs(valorNum) : -Math.abs(valorNum),
        descricao: descricao.trim(),
        conta_id: contaId,
        categoria_id: categoriaId || null,
      })
      onCreated()
    } catch (err) {
      reportApiError('NewTransactionModal.submit', err)
      alert('Erro ao lançar — veja o console (F12).')
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={modalOverlay()}>
      <div onClick={e => e.stopPropagation()} style={{ ...modalShell(), minWidth: 460, maxWidth: 540 }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <div style={sectionLabel()}>Novo lançamento</div>
        </div>
        <div style={modalBody()}>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 110px 1fr', gap: 8 }}>
            <input
              type="date"
              value={data} onChange={e => setData(e.target.value)}
              style={inputStyle()}
            />
            <select
              value={tipo}
              onChange={e => { setTipo(e.target.value as any); setCategoriaId('') }}
              style={inputStyle()}
            >
              <option value="saida">saída</option>
              <option value="entrada">entrada</option>
            </select>
            <input
              autoFocus
              type="text" inputMode="decimal" placeholder="valor"
              value={valor} onChange={e => setValor(sanitizeMoneyInput(e.target.value))}
              style={{ ...inputStyle(), textAlign: 'right', fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <input
            type="text" placeholder="descrição (ex: barbeiro, mercado, salário)"
            value={descricao} onChange={e => setDescricao(e.target.value)}
            style={inputStyle()}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={fieldLabel()}>Conta</label>
              <select value={contaId} onChange={e => setContaId(e.target.value)} style={inputStyle()}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </select>
            </div>
            <div>
              <label style={fieldLabel()}>Categoria (opcional)</label>
              <select value={categoriaId} onChange={e => setCategoriaId(e.target.value)} style={inputStyle()}>
                <option value="">sem categoria</option>
                {filteredCats.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onClick={onClose} style={ghostButton()}>cancelar</button>
            <button type="submit" disabled={busy} style={primaryButton()}>
              {busy ? 'salvando…' : 'lançar'}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}
