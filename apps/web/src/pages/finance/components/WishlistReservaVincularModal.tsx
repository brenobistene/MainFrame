/**
 * Modal de vincular transação a uma reserva (Fase 5).
 *
 * Reservas planejadas no cronograma viram "guardadas" só quando vinculadas
 * a uma transação real (ex: transferência interna pra caixinha do Nubank).
 * Esse modal lista candidatas via heurística (valor próximo + data da
 * reserva ± janela) e permite vincular com 1 click.
 *
 * Inclui transferências internas no match — diferente do modal de Comprar,
 * que filtra elas (compra não é transferência interna).
 */
import { useState } from 'react'
import { X, Search, Link2, Unlink } from 'lucide-react'

import {
  fieldLabel, ghostButton, inputStyle, modalBody, modalHairline,
  modalHeader, modalOverlay, modalShell, primaryButton, sectionLabel,
  formatBRL,
} from './styleHelpers'
import type { WishlistTransactionCandidate } from '../../../types'
import {
  useReservaMatchCandidates,
  useVincularReservaTransacao,
} from '../../../lib/wishlist-queries'
import { reportApiError } from '../../../api'

function fmtDataShort(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(-2)}`
}

const MES_LABELS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function WishlistReservaVincularModal({
  reservaId, itemNome, valorPlanejado, ano, mes, dia, jaVinculadaTxId,
  onClose,
}: {
  reservaId: string
  itemNome: string
  valorPlanejado: number
  ano: number
  mes: number
  dia: number | null
  jaVinculadaTxId: string | null
  onClose: () => void
}) {
  const [diasJanela, setDiasJanela] = useState(15)
  const candidatesQuery = useReservaMatchCandidates(reservaId, diasJanela)
  const vincularMut = useVincularReservaTransacao()

  const candidates = candidatesQuery.data ?? []
  const dataLabel = dia
    ? `${MES_LABELS[mes - 1]}/${String(ano).slice(-2)} dia ${dia}`
    : `${MES_LABELS[mes - 1]}/${String(ano).slice(-2)} (último dia)`

  async function handleVincular(txId: string) {
    try {
      await vincularMut.mutateAsync({
        reservaId,
        body: { transacao_id: txId },
      })
      onClose()
    } catch (err: any) {
      reportApiError('WishlistReservaVincularModal.link', err)
      alert('Erro ao vincular: ' + (err?.message ?? 'desconhecido'))
    }
  }

  async function handleDesvincular() {
    try {
      await vincularMut.mutateAsync({
        reservaId,
        body: { transacao_id: null },
      })
      onClose()
    } catch (err) {
      reportApiError('WishlistReservaVincularModal.unlink', err)
      alert('Erro ao desvincular.')
    }
  }

  return (
    <div onClick={onClose} style={modalOverlay()}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          ...modalShell(),
          minWidth: 540, maxWidth: 640, maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <Link2 size={13} strokeWidth={1.8} style={{ color: 'var(--color-text-tertiary)' }} />
          <div style={sectionLabel()}>Vincular reserva · {itemNome}</div>
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
                lineHeight: 1.6,
              }}
            >
              reserva: {formatBRL(valorPlanejado)} · {dataLabel}
              {jaVinculadaTxId && (
                <>
                  <br/>
                  <span style={{ color: 'var(--color-success)' }}>
                    ✓ atualmente vinculada à transação {jaVinculadaTxId}
                  </span>
                </>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Search size={11} strokeWidth={2} style={{ color: 'var(--color-text-muted)' }} />
              <span style={fieldLabel()}>Transações candidatas (transferências internas incluídas)</span>
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
                  style={{ ...inputStyle(), padding: '2px 6px', fontSize: 10, width: 76 }}
                  value={diasJanela}
                  onChange={e => setDiasJanela(parseInt(e.target.value, 10))}
                >
                  <option value={7}>±7d</option>
                  <option value={15}>±15d</option>
                  <option value={30}>±30d</option>
                  <option value={60}>±60d</option>
                </select>
              </label>
            </div>

            {candidatesQuery.isLoading ? (
              <EmptyMsg>buscando…</EmptyMsg>
            ) : candidates.length === 0 ? (
              <EmptyMsg>
                nenhuma transação compatível
                <div style={{ marginTop: 4, opacity: 0.7 }}>
                  aumente a janela ou crie a transferência primeiro
                </div>
              </EmptyMsg>
            ) : (
              <div
                style={{
                  display: 'flex', flexDirection: 'column', gap: 4,
                  maxHeight: 280, overflowY: 'auto',
                }}
              >
                {candidates.map(c => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    onClick={() => handleVincular(c.id)}
                    disabled={vincularMut.isPending}
                  />
                ))}
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
          {jaVinculadaTxId && (
            <button
              type="button"
              onClick={handleDesvincular}
              disabled={vincularMut.isPending}
              style={{
                ...ghostButton(),
                color: 'var(--color-accent-primary)',
                borderColor: 'var(--color-accent-primary)',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}
            >
              <Unlink size={11} strokeWidth={2} /> desvincular
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={primaryButton()}>fechar</button>
        </div>
      </div>
    </div>
  )
}

function EmptyMsg({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 14,
        border: '1px dashed var(--color-border)',
        color: 'var(--color-text-muted)',
        fontFamily: 'var(--font-mono)', fontSize: 10,
        letterSpacing: '0.14em', textTransform: 'uppercase',
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  )
}

function CandidateRow({
  candidate, onClick, disabled,
}: {
  candidate: WishlistTransactionCandidate
  onClick: () => void
  disabled?: boolean
}) {
  const absValor = Math.abs(candidate.valor)
  const diffColor = candidate.diff_pct < 2
    ? 'var(--color-success)'
    : candidate.diff_pct < 10
      ? 'var(--color-warning)'
      : 'var(--color-text-tertiary)'

  return (
    <button
      onClick={onClick}
      type="button"
      disabled={disabled}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto',
        gap: 10, alignItems: 'center',
        padding: '8px 10px',
        background: 'rgba(8, 12, 18, 0.45)',
        border: '1px solid var(--color-border)',
        cursor: disabled ? 'wait' : 'pointer',
        textAlign: 'left', color: 'inherit',
        fontFamily: 'inherit',
        transition: 'all 0.12s',
      }}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
          e.currentTarget.style.background = 'rgba(143, 191, 211, 0.06)'
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.background = 'rgba(8, 12, 18, 0.45)'
      }}
    >
      <Link2 size={10} strokeWidth={2} style={{ color: 'var(--color-ice-light)' }} />
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
          minWidth: 50, textAlign: 'right',
        }}
      >
        {candidate.diff_pct < 0.5 ? '✓' : `${candidate.diff_pct.toFixed(0)}%`}
      </span>
    </button>
  )
}
