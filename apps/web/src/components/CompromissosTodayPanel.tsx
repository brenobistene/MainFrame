/**
 * CompromissosTodayPanel — painel read-only no topo do /exec mostrando os
 * compromissos (horas improdutivas) do dia. Sem play/pause. Click em uma
 * row abre o modal de edit.
 *
 * Esconde se não há compromissos pro dia. Aparece logo abaixo do
 * DiaPendenciasBlock (lembretes Health) e ANTES dos períodos manhã/tarde/noite,
 * pra o usuário ver de cara o que tá agendado.
 *
 * Visual: borda esquerda âmbar (warning) + tech-label, similar ao
 * CompromissosAlert mas mais condensado.
 */
import { useMemo, useState } from 'react'
import { CalendarClock } from 'lucide-react'

import { useCompromissoOccurrences, useCompromissos } from '../lib/app-queries'
import type { Compromisso } from '../types'
import { CompromissoFormModal } from './CompromissoFormModal'

const ACCENT = 'var(--color-warning)'

function diffMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

function fmtDuration(min: number): string {
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

export function CompromissosTodayPanel({ dateIso }: { dateIso: string }) {
  const { data: occurrences = [] } = useCompromissoOccurrences(dateIso, dateIso)
  const { data: compromissos = [] } = useCompromissos()
  const compromissoById = useMemo(() => {
    const map = new Map<string, Compromisso>()
    for (const c of compromissos) map.set(c.id, c)
    return map
  }, [compromissos])

  const [editing, setEditing] = useState<Compromisso | null>(null)

  if (occurrences.length === 0) return null

  return (
    <>
      <div
        style={{
          marginBottom: 12,
          padding: '10px 14px',
          background: `
            linear-gradient(135deg, rgba(192, 138, 58, 0.08), transparent 50%),
            rgba(11, 13, 18, 0.55)
          `,
          border: '1px solid var(--color-border)',
          borderLeft: `2px solid ${ACCENT}`,
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CalendarClock size={11} strokeWidth={2} color={ACCENT} />
          <span
            className="hq-tech-label"
            style={{ color: ACCENT, letterSpacing: '0.28em', fontSize: 10 }}
          >
            COMPROMISSOS HOJE
          </span>
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {occurrences.length} · visualização
          </span>
        </div>

        {/* Rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {occurrences.map((occ, i) => {
            const c = compromissoById.get(occ.id)
            const dur = diffMinutes(occ.start_time, occ.end_time)
            return (
              <button
                key={`${occ.id}-${i}`}
                type="button"
                onClick={() => { if (c) setEditing(c) }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  alignItems: 'center',
                  gap: 12,
                  padding: '6px 10px',
                  background: 'rgba(8, 12, 18, 0.55)',
                  border: '1px solid var(--color-border)',
                  borderLeft: `2px solid ${ACCENT}55`,
                  cursor: c ? 'pointer' : 'default',
                  textAlign: 'left',
                  color: 'inherit',
                  fontFamily: 'inherit',
                  transition: 'border-color var(--motion-fast) var(--ease-smooth), background var(--motion-fast) var(--ease-smooth)',
                }}
                onMouseEnter={e => {
                  if (c) {
                    e.currentTarget.style.borderColor = ACCENT
                    e.currentTarget.style.background = 'rgba(192, 138, 58, 0.10)'
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                  e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    fontWeight: 700,
                    color: ACCENT,
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: 88,
                    letterSpacing: 0,
                  }}
                >
                  {occ.start_time}–{occ.end_time}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--color-text-primary)',
                    letterSpacing: '0.02em',
                    textTransform: 'uppercase',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {occ.title}
                </span>
                <span
                  className="hq-tech-id"
                  style={{
                    color: 'var(--color-text-muted)',
                    letterSpacing: '0.1em',
                  }}
                >
                  {fmtDuration(dur)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {editing && (
        <CompromissoFormModal
          existing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
