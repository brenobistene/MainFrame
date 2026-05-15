/**
 * Editor de cronograma de reserva mensal — usado dentro do WishlistItemModal.
 *
 * Lista de linhas {ano, mês, valor_planejado, notas?} com adicionar/remover.
 * Mostra status "✓ bate / falta / excede" comparando com `valor_estimado`,
 * mas não bloqueia salvar (usuário pode planejar > estimado por margem).
 *
 * Filosofia (wishlist-PLAN §6 F2 e §7): reserva opcional. Sem linhas =
 * status `desejado`; com 1+ linhas = `poupando` (backend faz a transição
 * automática no PUT /reservas).
 */
import { useMemo, useState } from 'react'
import { Plus, Trash2, Link2, CheckCircle2 } from 'lucide-react'

import {
  fieldLabel, ghostButton, inputStyle, parseBRL, sanitizeMoneyInput,
} from './styleHelpers'
import type { WishlistReservaInput } from '../../../types'
import { WishlistReservaVincularModal } from './WishlistReservaVincularModal'


/** Linha editável — usa `valor` como string pra preservar o que o usuário
 *  digitou (ex: "1.50" enquanto digita "1.500,00"). Converte pra número no
 *  onChange do pai via `commitChanges`. */
export type CronogramaRow = {
  _key: string                  // estável pra react keys (UUID local)
  /** ID da reserva no servidor (Fase 5). Vazio = linha nova, ainda não persistida. */
  _serverId?: string
  /** ID da transação vinculada (Fase 5). Null = pendente. */
  _transacaoId?: string | null
  /** Nome do item — passado pra modal de vínculo. */
  _itemNome?: string
  ano: number
  mes: number                   // 1-12
  /** Dia preferido do mês (1-31). String pra suportar campo vazio. */
  diaStr: string
  valorStr: string              // input do usuário (ex: "500,00")
  notas: string                 // pode ser ''
}

export function CronogramaReservasEditor({
  rows, onChange, valorEstimado,
}: {
  rows: CronogramaRow[]
  onChange: (rows: CronogramaRow[]) => void
  /** Valor estimado do item — usado pra mostrar "✓ bate / falta / excede". */
  valorEstimado: number | null
}) {
  const [vincularModal, setVincularModal] = useState<CronogramaRow | null>(null)

  const totalPlanejado = useMemo(() => {
    return rows.reduce((s, r) => s + (parseBRL(r.valorStr) ?? 0), 0)
  }, [rows])

  const diff = valorEstimado != null ? totalPlanejado - valorEstimado : null
  const statusLabel = (() => {
    if (valorEstimado == null) return null
    if (Math.abs(diff!) < 0.01) return { label: '✓ bate', color: 'var(--color-success)' }
    if (diff! > 0) return { label: `↑ excede em ${formatBRL(diff!)}`, color: 'var(--color-warning)' }
    return { label: `↓ falta ${formatBRL(-diff!)}`, color: 'var(--color-text-tertiary)' }
  })()

  function addRow() {
    const today = new Date()
    // Sugere próximo mês após a última linha (ou mês corrente se vazio).
    // Mantém o mesmo dia da última (ou dia 1 se primeira linha).
    let ano = today.getFullYear()
    let mes = today.getMonth() + 1
    let dia = today.getDate()
    if (rows.length > 0) {
      const ultima = rows[rows.length - 1]
      ano = ultima.ano
      mes = ultima.mes + 1
      if (mes > 12) { mes = 1; ano += 1 }
      const diaUlt = parseInt(ultima.diaStr, 10)
      if (!isNaN(diaUlt)) dia = diaUlt
    }
    onChange([
      ...rows,
      {
        _key: `tmp-${Date.now()}-${rows.length}`,
        ano, mes,
        diaStr: String(dia),
        valorStr: '',
        notas: '',
      },
    ])
  }

  function updateRow(key: string, patch: Partial<CronogramaRow>) {
    onChange(rows.map(r => r._key === key ? { ...r, ...patch } : r))
  }

  function removeRow(key: string) {
    onChange(rows.filter(r => r._key !== key))
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={fieldLabel()}>Plano de reserva (opcional)</span>
        <div style={{ flex: 1 }} />
        {statusLabel && rows.length > 0 && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10, fontWeight: 700,
              letterSpacing: '0.14em', textTransform: 'uppercase',
              color: statusLabel.color,
            }}
          >
            {statusLabel.label}
          </span>
        )}
        <button
          type="button"
          onClick={addRow}
          style={{ ...ghostButton(), fontSize: 9, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <Plus size={10} strokeWidth={2} /> adicionar mês
        </button>
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            padding: 10,
            border: '1px dashed var(--color-border)',
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          Sem plano de reserva · item fica como "desejado"
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r) => (
            <div
              key={r._key}
              style={{
                display: 'grid',
                // Data única (DD/MM/AAAA nativo BR) + valor + notas + 2 ações
                gridTemplateColumns: '140px 1fr 1fr auto auto',
                gap: 6,
                alignItems: 'center',
              }}
            >
              {/* Date picker nativo. Browser em PT-BR exibe DD/MM/AAAA;
                  internamente value é ISO YYYY-MM-DD. */}
              <input
                type="date"
                style={{ ...inputStyle(), padding: '6px 8px', fontSize: 11 }}
                value={rowToIsoDate(r)}
                onChange={e => {
                  const v = e.target.value     // "YYYY-MM-DD" ou ""
                  if (!v) return
                  const [y, m, d] = v.split('-').map(n => parseInt(n, 10))
                  if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                    updateRow(r._key, { ano: y, mes: m, diaStr: String(d) })
                  }
                }}
                title="Data da reserva"
              />
              <input
                style={{ ...inputStyle(), padding: '6px 8px', fontSize: 11 }}
                value={r.valorStr}
                onChange={e => updateRow(r._key, { valorStr: sanitizeMoneyInput(e.target.value) })}
                placeholder="valor R$"
                inputMode="decimal"
              />
              <input
                style={{ ...inputStyle(), padding: '6px 8px', fontSize: 11 }}
                value={r.notas}
                onChange={e => updateRow(r._key, { notas: e.target.value })}
                placeholder="notas (opcional)"
              />
              {/* Botão de vínculo — só aparece pra reservas já persistidas
                  no servidor (têm _serverId). Estado visual reflete se já
                  está vinculada ou pendente. */}
              {r._serverId ? (
                <button
                  type="button"
                  onClick={() => setVincularModal(r)}
                  title={r._transacaoId ? 'reserva confirmada · clique pra ajustar' : 'vincular transação'}
                  style={{
                    background: 'none',
                    border: '1px solid',
                    borderColor: r._transacaoId
                      ? 'var(--color-success)'
                      : 'var(--color-warning)',
                    cursor: 'pointer',
                    color: r._transacaoId
                      ? 'var(--color-success)'
                      : 'var(--color-warning)',
                    padding: '3px 6px',
                    display: 'inline-flex', alignItems: 'center',
                  }}
                >
                  {r._transacaoId
                    ? <CheckCircle2 size={11} strokeWidth={2} />
                    : <Link2 size={11} strokeWidth={2} />}
                </button>
              ) : (
                <span style={{ width: 25 }} />
              )}
              <button
                type="button"
                onClick={() => removeRow(r._key)}
                title="remover mês"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-tertiary)', padding: 4,
                }}
              >
                <Trash2 size={12} strokeWidth={2} />
              </button>
            </div>
          ))}
          <div
            style={{
              marginTop: 4,
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: 'var(--font-mono)', fontSize: 10,
              letterSpacing: '0.14em', textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
            }}
          >
            <span style={{ flex: 1 }} />
            <span>total planejado:</span>
            <span style={{ color: 'var(--color-text-secondary)', fontWeight: 700 }}>
              {formatBRL(totalPlanejado)}
            </span>
          </div>
        </div>
      )}

      {vincularModal && vincularModal._serverId && (
        <WishlistReservaVincularModal
          reservaId={vincularModal._serverId}
          itemNome={vincularModal._itemNome ?? 'item'}
          valorPlanejado={parseBRL(vincularModal.valorStr) ?? 0}
          ano={vincularModal.ano}
          mes={vincularModal.mes}
          dia={(() => {
            const d = parseInt(vincularModal.diaStr, 10)
            return isNaN(d) ? null : d
          })()}
          jaVinculadaTxId={vincularModal._transacaoId ?? null}
          onClose={() => setVincularModal(null)}
        />
      )}
    </div>
  )
}

// ─── Helpers locais ───────────────────────────────────────────────────────

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
}

/** Converte rows do editor pra payload do PUT /reservas. Linhas com valor
 *  inválido (parseBRL retorna null) são ignoradas. */
export function rowsToPayload(rows: CronogramaRow[]): WishlistReservaInput[] {
  const payload: WishlistReservaInput[] = []
  for (const r of rows) {
    const v = parseBRL(r.valorStr)
    if (v === null || v <= 0) continue
    let dia: number | null = null
    const diaParsed = parseInt(r.diaStr, 10)
    if (!isNaN(diaParsed) && diaParsed >= 1 && diaParsed <= 31) dia = diaParsed
    payload.push({
      ano: r.ano,
      mes: r.mes,
      dia,
      valor_planejado: v,
      notas: r.notas.trim() || null,
    })
  }
  return payload
}

/** Converte reservas do servidor pra rows do editor. Se a reserva veio
 *  sem `dia` (legado: significava "último dia do mês"), preenche com o
 *  último dia real do mês — assim o picker DD/MM/AAAA tem sempre uma
 *  data válida pra mostrar. */
export function reservasToRows(
  reservas: Array<{
    id?: string;
    ano: number; mes: number; dia?: number | null;
    valor_planejado: number; notas: string | null;
    transacao_id?: string | null;
  }>,
  itemNome?: string,
): CronogramaRow[] {
  return reservas.map((r, idx) => {
    const dia = r.dia != null ? r.dia : lastDayOfMonth(r.ano, r.mes)
    return {
      _key: r.id ?? `srv-${r.ano}-${r.mes}-${idx}`,
      _serverId: r.id,
      _transacaoId: r.transacao_id ?? null,
      _itemNome: itemNome,
      ano: r.ano,
      mes: r.mes,
      diaStr: String(dia),
      valorStr: String(r.valor_planejado).replace('.', ','),
      notas: r.notas ?? '',
    }
  })
}

// ─── Helpers de data ───────────────────────────────────────────────────────

function lastDayOfMonth(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate()    // mes 1-12; Date com mes=mes, dia=0 = último do anterior
}

/** Converte uma row em string ISO YYYY-MM-DD pra preencher o input nativo.
 *  Se diaStr inválido, usa último dia do mês como fallback seguro. */
function rowToIsoDate(r: CronogramaRow): string {
  let d = parseInt(r.diaStr, 10)
  if (isNaN(d) || d < 1) d = lastDayOfMonth(r.ano, r.mes)
  if (d > 31) d = 31
  const yy = String(r.ano).padStart(4, '0')
  const mm = String(r.mes).padStart(2, '0')
  const dd = String(d).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}
