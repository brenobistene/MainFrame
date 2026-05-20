/**
 * CompromissosAlert — alerta sticky pros próximos 3 dias de compromissos
 * (horas improdutivas). Mostrado no topo do /dashboard.
 *
 * Filosofia: visualização only, sem ação principal — usuário não pode
 * dispensar (não é nag, é radar). Click em uma row abre o modal de edit
 * pra permitir ajustes ou exclusão.
 *
 * Visível só quando há compromissos no range. Em vazio, esconde.
 *
 * Estética cyber CP2077 — accent âmbar (warning, não alarme) + tech-label.
 */
import { useMemo, useState } from 'react'
import { CalendarClock, Bell } from 'lucide-react'

import { useCompromissoOccurrences, useCompromissos } from '../lib/app-queries'
import type { Compromisso } from '../types'
import { CompromissoFormModal } from './CompromissoFormModal'

const ACCENT = 'var(--color-warning)'    // âmbar

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(iso: string, todayIso: string, tomorrowIso: string): string {
  if (iso === todayIso) return 'HOJE'
  if (iso === tomorrowIso) return 'AMANHÃ'
  const d = new Date(`${iso}T00:00:00`)
  const dayName = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'][d.getDay()]
  return `${dayName} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

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

export function CompromissosAlert() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayIso = localYmd(today)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const tomorrowIso = localYmd(tomorrow)
  const horizonEnd = new Date(today)
  horizonEnd.setDate(today.getDate() + 2)  // hoje + 2 dias = 3 dias inclusive
  const horizonIso = localYmd(horizonEnd)

  const { data: occurrences = [] } = useCompromissoOccurrences(todayIso, horizonIso)
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
      <section style={{ marginBottom: 24 }}>
        <div
          className="hq-glass-elevated hq-grain hq-chamfer-cross"
          style={{
            position: 'relative',
            padding: '12px 18px',
            borderLeft: `2px solid ${ACCENT}`,
            background: `
              linear-gradient(135deg, rgba(192, 138, 58, 0.06), transparent 50%),
              rgba(11, 13, 18, 0.55)
            `,
          }}
        >
          {/* Hairline ice no topo */}
          <div
            aria-hidden="true"
            className="hq-hairline-ice"
            style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
          />

          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
          }}>
            <Bell size={12} strokeWidth={2} color={ACCENT} />
            <span
              className="hq-tech-label"
              style={{ color: ACCENT, letterSpacing: '0.28em', fontSize: 10 }}
            >
              COMPROMISSOS
            </span>
            <span
              className="hq-tech-id"
              style={{ color: 'var(--color-text-muted)' }}
            >
              próximos 3 dias · {occurrences.length}
            </span>
          </div>

          {/* Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {occurrences.map((occ, i) => {
              const c = compromissoById.get(occ.id)
              const dur = diffMinutes(occ.start_time, occ.end_time)
              const isToday = occ.date === todayIso
              return (
                <button
                  key={`${occ.id}-${occ.date}-${i}`}
                  type="button"
                  onClick={() => { if (c) setEditing(c) }}
                  className="hq-row-hoverable hq-chamfer-bl"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto auto',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 12px',
                    background: isToday
                      ? 'rgba(192, 138, 58, 0.10)'
                      : 'rgba(8, 12, 18, 0.55)',
                    border: '1px solid var(--color-border)',
                    borderLeft: `2px solid ${isToday ? ACCENT : 'var(--color-border-strong)'}`,
                    cursor: c ? 'pointer' : 'default',
                    textAlign: 'left',
                    color: 'inherit',
                    fontFamily: 'inherit',
                    boxShadow: isToday ? `0 0 8px rgba(192, 138, 58, 0.18)` : 'none',
                  }}
                >
                  {/* Date badge */}
                  <span
                    className="hq-tech-id"
                    style={{
                      color: isToday ? ACCENT : 'var(--color-text-tertiary)',
                      letterSpacing: '0.18em',
                      minWidth: 60,
                      fontWeight: 700,
                    }}
                  >
                    {fmtDate(occ.date, todayIso, tomorrowIso)}
                  </span>
                  {/* Title */}
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
                  {/* Time */}
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      fontWeight: 700,
                      color: ACCENT,
                      letterSpacing: 0,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {occ.start_time}–{occ.end_time}
                  </span>
                  {/* Duration */}
                  <span
                    className="hq-tech-id"
                    style={{
                      color: 'var(--color-text-muted)',
                      letterSpacing: '0.08em',
                    }}
                  >
                    {fmtDuration(dur)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {editing && (
        <CompromissoFormModal
          existing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
