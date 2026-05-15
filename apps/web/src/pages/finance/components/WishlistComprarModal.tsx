/**
 * Modal de "marcar como comprado" — Fase 3 com busca automática.
 *
 * Pergunta valor real + data, e oferece DOIS caminhos:
 *  a) vincular agora — backend sugere transações candidatas baseado em
 *     valor + data (heurística em wishlist.py::_find_match_candidates)
 *  b) vincular depois — item fica como 'comprado · vínculo pendente';
 *     próximo import sugere automaticamente
 *
 * Decisão fundacional: item de wishlist NUNCA cria transação — só vincula.
 */
import { useState } from 'react'
import { X, Search } from 'lucide-react'

import {
  fieldLabel, ghostButton, inputStyle, modalBody, modalHairline,
  modalHeader, modalOverlay, modalShell, parseBRL, primaryButton,
  sanitizeMoneyInput, sectionLabel, formatBRL,
} from './styleHelpers'
import type { WishlistItem, WishlistTransactionCandidate } from '../../../types'
import {
  useComprarWishlistItem,
  useWishlistMatchCandidates,
} from '../../../lib/wishlist-queries'
import { reportApiError } from '../../../api'

type VincularModo = 'agora' | 'depois'

function todayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtDataShort(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(-2)}`
}

export function WishlistComprarModal({
  item, onClose,
}: {
  item: WishlistItem
  onClose: () => void
}) {
  const [valorReal, setValorReal] = useState(String(item.valor_estimado).replace('.', ','))
  const [data, setData] = useState(todayIso())
  const [vincularModo, setVincularModo] = useState<VincularModo>('depois')
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null)
  const [diasJanela, setDiasJanela] = useState(7)

  const mut = useComprarWishlistItem()

  const valorNumber = parseBRL(valorReal)

  // Busca candidatas reativa a (valor, data, janela). Só roda quando o
  // user escolheu 'vincular agora' E tem valor válido.
  const candidatesQuery = useWishlistMatchCandidates({
    valor: valorNumber,
    data,
    diasJanela,
    enabled: vincularModo === 'agora',
  })
  const candidates = candidatesQuery.data ?? []

  const canSubmit =
    valorNumber !== null && valorNumber > 0 && !!data &&
    (vincularModo === 'depois' || (vincularModo === 'agora' && !!selectedTxId))

  async function handleSubmit() {
    if (!canSubmit || valorNumber === null) return
    try {
      await mut.mutateAsync({
        id: item.id,
        body: {
          valor_real: valorNumber,
          data,
          transacao_id: vincularModo === 'agora' ? selectedTxId : null,
        },
      })
      onClose()
    } catch (err) {
      reportApiError('WishlistComprarModal.save', err)
      alert('Erro ao registrar compra.')
    }
  }

  return (
    <div onClick={onClose} style={modalOverlay()}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          ...modalShell(),
          minWidth: 540, maxWidth: 640,
          maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <div style={sectionLabel()}>Comprar · {item.nome}</div>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: 4,
              display: 'inline-flex', alignItems: 'center', borderRadius: 0,
            }}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        <div style={modalBody()}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 10,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.14em', textTransform: 'uppercase',
              }}
            >
              estimado: {formatBRL(item.valor_estimado)}
              {item.reservado_acumulado > 0 && (
                <> · reservado: {formatBRL(item.reservado_acumulado)}</>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Valor real pago">
                <input
                  autoFocus
                  style={inputStyle()}
                  value={valorReal}
                  onChange={e => setValorReal(sanitizeMoneyInput(e.target.value))}
                  placeholder="0,00"
                  inputMode="decimal"
                />
              </Field>
              <Field label="Data da compra">
                <input
                  style={inputStyle()}
                  type="date"
                  value={data}
                  onChange={e => setData(e.target.value)}
                />
              </Field>
            </div>

            <div>
              <div style={fieldLabel()}>Vincular a transação?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                <RadioRow
                  selected={vincularModo === 'agora'}
                  onClick={() => setVincularModo('agora')}
                  label="Vincular agora — buscar transação existente"
                  hint="Sistema busca transações compatíveis (valor próximo, data dentro da janela). Click pra selecionar."
                />
                <RadioRow
                  selected={vincularModo === 'depois'}
                  onClick={() => { setVincularModo('depois'); setSelectedTxId(null) }}
                  label="Vincular depois — quando importar o extrato"
                  hint="Item fica como 'comprado · vínculo pendente'. Próximo import sugere automaticamente."
                />
              </div>
            </div>

            {vincularModo === 'agora' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Search size={11} strokeWidth={2} style={{ color: 'var(--color-text-muted)' }} />
                  <span style={fieldLabel()}>Transações candidatas</span>
                  <div style={{ flex: 1 }} />
                  <label
                    style={{
                      fontFamily: 'var(--font-mono)', fontSize: 9,
                      letterSpacing: '0.14em', textTransform: 'uppercase',
                      color: 'var(--color-text-muted)',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    janela
                    <select
                      style={{
                        ...inputStyle(),
                        padding: '2px 6px',
                        fontSize: 10,
                        width: 76,
                      }}
                      value={diasJanela}
                      onChange={e => setDiasJanela(parseInt(e.target.value, 10))}
                    >
                      <option value={3}>±3d</option>
                      <option value={7}>±7d</option>
                      <option value={15}>±15d</option>
                      <option value={30}>±30d</option>
                    </select>
                  </label>
                </div>

                <CandidatesList
                  candidates={candidates}
                  loading={candidatesQuery.isLoading}
                  selectedTxId={selectedTxId}
                  onSelect={setSelectedTxId}
                  valorAlvo={valorNumber ?? 0}
                />
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--color-ice-deep)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={ghostButton()}>cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              ...primaryButton(),
              opacity: canSubmit ? 1 : 0.4,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            confirmar compra
          </button>
        </div>
      </div>
    </div>
  )
}

function CandidatesList({
  candidates, loading, selectedTxId, onSelect, valorAlvo,
}: {
  candidates: WishlistTransactionCandidate[]
  loading: boolean
  selectedTxId: string | null
  onSelect: (id: string) => void
  valorAlvo: number
}) {
  if (loading) {
    return (
      <div
        style={{
          padding: 12,
          border: '1px dashed var(--color-border)',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)', fontSize: 10,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          textAlign: 'center',
        }}
      >
        buscando…
      </div>
    )
  }
  if (candidates.length === 0) {
    return (
      <div
        style={{
          padding: 12,
          border: '1px dashed var(--color-border)',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)', fontSize: 10,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        nenhuma transação compatível encontrada
        <div style={{ marginTop: 4, opacity: 0.7 }}>
          tente aumentar a janela, ou use "vincular depois"
        </div>
      </div>
    )
  }
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        maxHeight: 220, overflowY: 'auto',
      }}
    >
      {candidates.map(c => (
        <CandidateRow
          key={c.id}
          candidate={c}
          selected={selectedTxId === c.id}
          onClick={() => onSelect(c.id)}
          valorAlvo={valorAlvo}
        />
      ))}
    </div>
  )
}

function CandidateRow({
  candidate, selected, onClick, valorAlvo,
}: {
  candidate: WishlistTransactionCandidate
  selected: boolean
  onClick: () => void
  valorAlvo: number
}) {
  const absValor = Math.abs(candidate.valor)
  const diff = absValor - valorAlvo
  const diffLabel = (() => {
    if (Math.abs(diff) < 0.01) return '✓ exato'
    if (diff > 0) return `+${formatBRL(diff)}`
    return `-${formatBRL(-diff)}`
  })()
  const diffColor = candidate.diff_pct < 2
    ? 'var(--color-success)'
    : candidate.diff_pct < 10
      ? 'var(--color-warning)'
      : 'var(--color-text-tertiary)'

  return (
    <button
      onClick={onClick}
      type="button"
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto',
        gap: 10, alignItems: 'center',
        padding: '8px 10px',
        background: selected ? 'rgba(143, 191, 211, 0.10)' : 'rgba(8, 12, 18, 0.45)',
        border: `1px solid ${selected ? 'rgba(143, 191, 211, 0.55)' : 'var(--color-border)'}`,
        cursor: 'pointer',
        textAlign: 'left',
        color: 'inherit',
        fontFamily: 'inherit',
        transition: 'all 0.12s',
      }}
    >
      <span
        style={{
          width: 10, height: 10, borderRadius: '50%',
          border: '1px solid var(--color-ice)',
          background: selected ? 'var(--color-ice)' : 'transparent',
          boxShadow: selected ? '0 0 6px var(--color-ice-glow)' : 'none',
          flexShrink: 0,
        }}
      />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600,
            color: 'var(--color-text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {candidate.descricao}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 9,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.14em', textTransform: 'uppercase',
          }}
        >
          {fmtDataShort(candidate.data)}
          {candidate.conta_nome && <> · {candidate.conta_nome}</>}
        </span>
      </div>
      <span
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700,
          color: 'var(--color-text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatBRL(absValor)}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
          color: diffColor,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          minWidth: 60, textAlign: 'right',
        }}
      >
        {diffLabel}
      </span>
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={fieldLabel()}>{label}</span>
      {children}
    </div>
  )
}

function RadioRow({
  selected, onClick, label, hint,
}: {
  selected: boolean
  onClick: () => void
  label: string
  hint?: string
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      style={{
        textAlign: 'left',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '8px 10px',
        background: selected ? 'rgba(143, 191, 211, 0.08)' : 'transparent',
        border: `1px solid ${selected ? 'rgba(143, 191, 211, 0.45)' : 'var(--color-border)'}`,
        cursor: 'pointer',
        color: 'inherit',
        fontFamily: 'inherit',
      }}
    >
      <span
        style={{
          width: 12, height: 12, borderRadius: '50%',
          border: '1px solid var(--color-ice)',
          background: selected ? 'var(--color-ice)' : 'transparent',
          boxShadow: selected ? '0 0 6px var(--color-ice-glow)' : 'none',
          flexShrink: 0,
          marginTop: 3,
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 12, fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}
        >
          {label}
        </span>
        {hint && (
          <span
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.04em',
              lineHeight: 1.4,
            }}
          >
            {hint}
          </span>
        )}
      </div>
    </button>
  )
}
