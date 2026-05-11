/**
 * Picker de lançamento existente — usado pelas modais "marcar como paga"
 * de fixas e dívidas. Lista candidatos do mês selecionado (pré-filtrados
 * pelo caller) e permite escolher um pra vincular ao bill/parcela.
 *
 * Evita o problema de double-entry: quando o user já importou o extrato
 * do banco, a tx real já existe — em vez de criar uma nova, ele linka
 * essa pra marcar o compromisso como pago.
 */
import type { FinAccount, FinCategory, FinTransaction } from '../../../types'
import { formatBRL, formatDate } from './styleHelpers'

interface Props {
  candidates: FinTransaction[]
  selectedTxId: string | null
  onSelect: (txId: string | null) => void
  accounts: FinAccount[]
  categories: FinCategory[]
  /** Valor esperado da bill/parcela — destaca matches exatos. */
  expectedValor?: number
}

export function LinkedTransactionPicker({
  candidates, selectedTxId, onSelect, accounts, categories, expectedValor,
}: Props) {
  const accById = new Map(accounts.map(a => [a.id, a]))
  const catById = new Map(categories.map(c => [c.id, c]))

  if (candidates.length === 0) {
    return (
      <div style={{
        padding: '14px 16px',
        border: '1px dashed rgba(143, 191, 211, 0.30)',
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10, fontWeight: 700,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.18em', textTransform: 'uppercase',
        lineHeight: 1.7,
      }}>
        <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
        NENHUM LANÇAMENTO DISPONÍVEL NO MÊS · USE "CRIAR NOVO"
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      maxHeight: 280, overflowY: 'auto',
      padding: 2,
    }}>
      {candidates.map(tx => {
        const isSelected = selectedTxId === tx.id
        const acc = accById.get(tx.conta_id)
        const cat = tx.categoria_id ? catById.get(tx.categoria_id) : null
        const txValor = Math.abs(tx.valor)
        const isExactMatch = expectedValor != null && Math.abs(txValor - expectedValor) < 0.005
        return (
          <button
            key={tx.id}
            type="button"
            onClick={() => onSelect(isSelected ? null : tx.id)}
            style={{
              display: 'grid',
              gridTemplateColumns: '14px auto 1fr auto',
              gap: 10, alignItems: 'center',
              padding: '8px 12px',
              background: isSelected
                ? 'rgba(143, 191, 211, 0.14)'
                : 'rgba(8, 12, 18, 0.55)',
              border: isSelected
                ? '1px solid var(--color-ice)'
                : '1px solid rgba(143, 191, 211, 0.22)',
              borderLeft: isExactMatch
                ? '2px solid var(--color-success-light)'
                : '2px solid var(--color-ice-deep)',
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
              cursor: 'pointer',
              textAlign: 'left',
              color: 'inherit',
              transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
              boxShadow: isSelected ? '0 0 12px rgba(143, 191, 211, 0.20)' : 'none',
            }}
            onMouseEnter={e => {
              if (!isSelected) {
                e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                e.currentTarget.style.background = 'rgba(143, 191, 211, 0.06)'
              }
            }}
            onMouseLeave={e => {
              if (!isSelected) {
                e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.22)'
                e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
              }
            }}
          >
            {/* Radio indicator */}
            <span style={{
              width: 12, height: 12,
              border: isSelected
                ? '2px solid var(--color-ice)'
                : '1px solid var(--color-text-muted)',
              background: isSelected ? 'var(--color-ice-light)' : 'transparent',
              boxShadow: isSelected ? '0 0 8px var(--color-ice-glow)' : 'none',
              flexShrink: 0,
            }} />

            {/* Data */}
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10, fontWeight: 700,
              color: 'var(--color-text-tertiary)',
              letterSpacing: '0.05em',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {formatDate(tx.data)}
            </span>

            {/* Descrição + conta/categoria */}
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 12,
                color: 'var(--color-text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {tx.descricao}
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.15em', textTransform: 'uppercase',
                marginTop: 2,
              }}>
                {acc?.nome ?? '—'}
                {cat && <> · {cat.nome}</>}
              </div>
            </div>

            {/* Valor */}
            <span className="hq-money" style={{
              fontSize: 12, fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              color: isExactMatch
                ? 'var(--color-success-light)'
                : 'var(--color-text-primary)',
              textShadow: isExactMatch ? '0 0 8px rgba(125, 154, 111, 0.40)' : 'none',
            }}>
              {formatBRL(txValor)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Toggle de modo no topo das modais "marcar como paga".
 *  Render dos dois botões em pill chamferada, ice quando ativo. */
export function PaymentModeToggle({
  mode, onChange, candidateCount,
}: {
  mode: 'link' | 'create'
  onChange: (mode: 'link' | 'create') => void
  candidateCount: number
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 6,
      marginBottom: 14,
    }}>
      <button
        type="button"
        onClick={() => onChange('link')}
        style={{
          ...modeButtonStyle(mode === 'link'),
        }}
      >
        <span style={{ color: 'var(--color-ice)', opacity: 0.85, letterSpacing: 0, marginRight: 6 }}>//</span>
        VINCULAR LANÇAMENTO {candidateCount > 0 && `[${candidateCount.toString().padStart(2, '0')}]`}
      </button>
      <button
        type="button"
        onClick={() => onChange('create')}
        style={{
          ...modeButtonStyle(mode === 'create'),
        }}
      >
        <span style={{ color: 'var(--color-ice)', opacity: 0.85, letterSpacing: 0, marginRight: 6 }}>//</span>
        CRIAR NOVO
      </button>
    </div>
  )
}

function modeButtonStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'rgba(143, 191, 211, 0.14)' : 'rgba(8, 12, 18, 0.55)',
    border: active ? '1px solid var(--color-ice)' : '1px solid var(--color-border)',
    cursor: 'pointer',
    color: active ? 'var(--color-ice-light)' : 'var(--color-text-tertiary)',
    fontFamily: 'var(--font-mono)',
    padding: '7px 12px',
    fontSize: 10, fontWeight: 700,
    letterSpacing: '0.18em', textTransform: 'uppercase',
    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
    boxShadow: active ? '0 0 10px rgba(143, 191, 211, 0.20)' : 'none',
    transition: 'all 0.15s',
  }
}
