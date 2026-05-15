import { useRef, useState } from 'react'
import { Link2, PiggyBank } from 'lucide-react'
import { importNubankCsv, reportApiError } from '../../../api'
import type {
  FinAccount, FinImportSummary, WishlistMatchGroup,
  WishlistReservaMatchGroup,
} from '../../../types'
import {
  sectionLabel, fieldLabel, inputStyle, primaryButton, ghostButton,
  modalOverlay, modalShell, modalHairline, modalHeader, modalBody,
  formatBRL,
} from './styleHelpers'
import {
  useVincularReservaTransacao,
  useVincularWishlistTransacao,
  useWishlistMatchSuggestions,
  useWishlistMatchSuggestionsReservas,
} from '../../../lib/wishlist-queries'

export function ImportCsvModal({ accounts, onClose, onImported }: {
  accounts: FinAccount[]
  onClose: () => void
  onImported: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [contaId, setContaId] = useState(accounts[0]?.id ?? '')
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<FinImportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const file = fileRef.current?.files?.[0]
    if (!file) { setError('Selecione um arquivo CSV.'); return }
    if (!contaId) { setError('Selecione a conta de destino.'); return }
    setBusy(true)
    try {
      const summary = await importNubankCsv(file, contaId)
      setResult(summary)
    } catch (err: any) {
      reportApiError('importNubankCsv', err)
      setError(err?.message ?? 'Erro ao importar — veja o console (F12).')
    } finally {
      setBusy(false)
    }
  }

  function handleClose() {
    if (result && result.imported > 0) onImported()
    else onClose()
  }

  return (
    <div onClick={handleClose} style={modalOverlay()}>
      <div onClick={e => e.stopPropagation()} style={{ ...modalShell(), minWidth: 460, maxWidth: 560 }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <div style={sectionLabel()}>Importar CSV do Nubank</div>
        </div>
        <div style={modalBody()}>

        <div style={{
          fontSize: 11, color: 'var(--color-text-muted)',
          marginBottom: 16, lineHeight: 1.5,
        }}>
          Exporte o extrato da sua conta corrente Nubank (formato CSV) pelo app
          ou site. Suporta o cabeçalho padrão: <em>Data, Valor, Identificador,
          Descrição</em>. Re-importar o mesmo arquivo é seguro — duplicatas
          são detectadas e ignoradas.
        </div>

        {!result && (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={fieldLabel()}>Conta de destino</label>
              <select value={contaId} onChange={e => setContaId(e.target.value)} style={inputStyle()}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.nome} ({a.tipo})</option>)}
              </select>
            </div>
            <div>
              <label style={fieldLabel()}>Arquivo CSV</label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={() => setFileName(fileRef.current?.files?.[0]?.name ?? null)}
                style={{ ...inputStyle(), padding: '6px 8px' }}
              />
              {fileName && (
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  {fileName}
                </div>
              )}
            </div>
            {error && (
              <div style={{
                fontSize: 11, color: 'var(--color-accent-primary)',
                padding: 10, background: 'rgba(232, 93, 58, 0.08)',
                border: '1px solid var(--color-accent-primary)', borderRadius: 3,
              }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" onClick={handleClose} style={ghostButton()}>cancelar</button>
              <button type="submit" disabled={busy} style={primaryButton()}>
                {busy ? 'importando…' : 'importar'}
              </button>
            </div>
          </form>
        )}

        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              padding: 14, borderRadius: 3,
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
            }}>
              <SummaryRow label="Importadas" value={result.imported} color="var(--color-success)" />
              {result.auto_categorized > 0 && (
                <SummaryRow label="Auto-categorizadas" value={result.auto_categorized} color="var(--color-accent-light)" />
              )}
              {result.auto_linked_parcelas > 0 && (
                <SummaryRow label="Auto-vinculadas a parcelas" value={result.auto_linked_parcelas} color="var(--color-accent-light)" />
              )}
              <SummaryRow label="Duplicadas (ignoradas)" value={result.duplicates} color="var(--color-text-secondary)" />
              <SummaryRow label="Erros" value={result.errors} color={result.errors > 0 ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)'} last />
            </div>
            {result.error_samples.length > 0 && (
              <div style={{
                fontSize: 10, color: 'var(--color-text-muted)',
                padding: 10, background: 'rgba(232, 93, 58, 0.05)',
                border: '1px solid var(--color-border)', borderRadius: 3,
                fontFamily: 'var(--font-mono)',
              }}>
                <div style={{ marginBottom: 6, color: 'var(--color-accent-primary)' }}>
                  Linhas com erro (primeiras 5):
                </div>
                {result.error_samples.map((s, i) => <div key={i}>· {s}</div>)}
              </div>
            )}

            {/* Sugestões da Wishlist — Fase 3 (items comprados) +
                Fase 5 (reservas pendentes de confirmação). */}
            <WishlistMatchBlock />
            <WishlistReservasMatchBlock />

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={handleClose} style={primaryButton()}>fechar</button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ label, value, color, last }: {
  label: string; value: number; color: string; last?: boolean
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      marginBottom: last ? 0 : 8,
    }}>
      <span style={{
        fontSize: 11, color: 'var(--color-text-tertiary)',
        textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 14, fontWeight: 700, color,
        fontFamily: 'var(--font-mono)',
      }}>
        {value}
      </span>
    </div>
  )
}

// ─── Bloco de sugestões da Wishlist (Fase 3) ──────────────────────────────

function WishlistMatchBlock() {
  const { data: groups = [], isLoading } = useWishlistMatchSuggestions(15)

  if (isLoading) return null
  if (groups.length === 0) return null

  // Filtra grupos com ao menos uma candidata (sem sentido mostrar item sem matches)
  const withCandidates = groups.filter(g => g.candidates.length > 0)
  if (withCandidates.length === 0) return null

  return (
    <div
      style={{
        padding: 12,
        background: 'rgba(192, 138, 58, 0.06)',
        border: '1px solid rgba(192, 138, 58, 0.35)',
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Link2 size={11} strokeWidth={2} style={{ color: 'var(--color-warning)' }} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10, fontWeight: 700,
            color: 'var(--color-warning)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
          }}
        >
          Sugestão da Wishlist · {withCandidates.length} {withCandidates.length === 1 ? 'item aguardando vínculo' : 'items aguardando vínculo'}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {withCandidates.map(g => (
          <WishlistMatchGroup key={g.item.id} group={g} />
        ))}
      </div>
    </div>
  )
}

function WishlistMatchGroup({ group }: { group: WishlistMatchGroup }) {
  const vincularMut = useVincularWishlistTransacao()
  const [vinculado, setVinculado] = useState(false)

  async function handleVincular(transacaoId: string) {
    try {
      await vincularMut.mutateAsync({
        id: group.item.id,
        body: { transacao_id: transacaoId },
      })
      setVinculado(true)
    } catch (err) {
      reportApiError('WishlistMatchBlock.vincular', err)
      alert('Erro ao vincular transação.')
    }
  }

  if (vinculado) {
    return (
      <div
        style={{
          padding: '6px 10px',
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--color-success)',
          letterSpacing: '0.14em', textTransform: 'uppercase',
        }}
      >
        ✓ {group.item.nome} vinculado
      </div>
    )
  }

  return (
    <div
      style={{
        padding: 8,
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 12, fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}
        >
          {group.item.nome}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 9,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.14em', textTransform: 'uppercase',
          }}
        >
          {group.item.valor_real != null
            ? formatBRL(group.item.valor_real)
            : formatBRL(group.item.valor_estimado)}
          {group.item.comprado_em && (
            <> · comprado {fmtBRDate(group.item.comprado_em)}</>
          )}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {group.candidates.slice(0, 3).map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => handleVincular(c.id)}
            disabled={vincularMut.isPending}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto auto',
              gap: 10, alignItems: 'center',
              padding: '6px 10px',
              background: 'rgba(8, 12, 18, 0.45)',
              border: '1px solid rgba(143, 191, 211, 0.18)',
              cursor: vincularMut.isPending ? 'wait' : 'pointer',
              textAlign: 'left', color: 'inherit',
              fontFamily: 'inherit',
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
              e.currentTarget.style.background = 'rgba(143, 191, 211, 0.08)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.18)'
              e.currentTarget.style.background = 'rgba(8, 12, 18, 0.45)'
            }}
          >
            <Link2 size={10} strokeWidth={2} style={{ color: 'var(--color-ice-light)' }} />
            <span
              style={{
                fontFamily: 'var(--font-display)', fontSize: 11,
                color: 'var(--color-text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {c.descricao}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 9,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.12em', textTransform: 'uppercase',
              }}
            >
              {fmtBRDate(c.data)}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                color: 'var(--color-text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatBRL(Math.abs(c.valor))}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function fmtBRDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(-2)}`
}

// ─── Reservas pendentes (Fase 5) ──────────────────────────────────────────

const MES_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function WishlistReservasMatchBlock() {
  const { data: groups = [], isLoading } = useWishlistMatchSuggestionsReservas(15)
  if (isLoading) return null
  const withCandidates = groups.filter(g => g.candidates.length > 0)
  if (withCandidates.length === 0) return null

  return (
    <div
      style={{
        padding: 12,
        background: 'rgba(94, 122, 82, 0.06)',
        border: '1px solid rgba(94, 122, 82, 0.35)',
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PiggyBank size={11} strokeWidth={2} style={{ color: 'var(--color-success)' }} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10, fontWeight: 700,
            color: 'var(--color-success)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
          }}
        >
          Reservas pendentes de confirmação · {withCandidates.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {withCandidates.map(g => (
          <ReservaMatchGroupRow key={g.reserva.id} group={g} />
        ))}
      </div>
    </div>
  )
}

function ReservaMatchGroupRow({ group }: { group: WishlistReservaMatchGroup }) {
  const vincularMut = useVincularReservaTransacao()
  const [vinculado, setVinculado] = useState(false)

  async function handleVincular(txId: string) {
    try {
      await vincularMut.mutateAsync({
        reservaId: group.reserva.id,
        body: { transacao_id: txId },
      })
      setVinculado(true)
    } catch (err) {
      reportApiError('ReservaMatchGroupRow.vincular', err)
      alert('Erro ao vincular reserva.')
    }
  }

  if (vinculado) {
    return (
      <div
        style={{
          padding: '6px 10px',
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--color-success)',
          letterSpacing: '0.14em', textTransform: 'uppercase',
        }}
      >
        ✓ {group.item_nome} · {MES_ABBR[group.reserva.mes - 1]}/{String(group.reserva.ano).slice(-2)} confirmada
      </div>
    )
  }

  const diaLabel = group.reserva.dia ? ` dia ${group.reserva.dia}` : ''

  return (
    <div
      style={{
        padding: 8,
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 12, fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}
        >
          {group.item_nome}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 9,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.14em', textTransform: 'uppercase',
          }}
        >
          {formatBRL(group.reserva.valor_planejado)} · {MES_ABBR[group.reserva.mes - 1]}/{String(group.reserva.ano).slice(-2)}{diaLabel}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {group.candidates.slice(0, 3).map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => handleVincular(c.id)}
            disabled={vincularMut.isPending}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto auto',
              gap: 10, alignItems: 'center',
              padding: '6px 10px',
              background: 'rgba(8, 12, 18, 0.45)',
              border: '1px solid rgba(94, 122, 82, 0.18)',
              cursor: vincularMut.isPending ? 'wait' : 'pointer',
              textAlign: 'left', color: 'inherit',
              fontFamily: 'inherit',
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(94, 122, 82, 0.55)'
              e.currentTarget.style.background = 'rgba(94, 122, 82, 0.08)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(94, 122, 82, 0.18)'
              e.currentTarget.style.background = 'rgba(8, 12, 18, 0.45)'
            }}
          >
            <Link2 size={10} strokeWidth={2} style={{ color: 'var(--color-success)' }} />
            <span
              style={{
                fontFamily: 'var(--font-display)', fontSize: 11,
                color: 'var(--color-text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {c.descricao}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 9,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.12em', textTransform: 'uppercase',
              }}
            >
              {fmtBRDate(c.data)}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                color: 'var(--color-text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatBRL(Math.abs(c.valor))}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
