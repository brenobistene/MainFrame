/**
 * `/tempo` — relatórios de tempo investido.
 *
 * Duas visualizações:
 *  1. Donut + lista "por área" — onde você passou seu tempo no período
 *  2. Barras semanais — últimas 8 semanas, tendência total/quest/task/routine
 *
 * Os dados vêm dos endpoints /api/time-reports/{by-area, weekly} que
 * agregam quest/task/routine_sessions.
 *
 * MVP: SVG simples pro donut e barras. Sem chart lib pra manter o
 * bundle leve. Hover mostra tooltip com detalhes.
 */
import { useEffect, useState } from 'react'
import { PageShell } from '../components/ui/CyberShell'
import { get } from '../api'

type ReportItem = {
  kind: 'area' | 'task' | 'routine'
  slug: string
  label: string
  color: string | null
  minutes: number
}

type ByAreaResponse = {
  from: string
  to: string
  total_minutes: number
  items: ReportItem[]
}

type WeeklyBucket = {
  week_start: string
  week_end: string
  quest: number
  task: number
  routine: number
  total_minutes: number
}

function fmtMin(m: number): string {
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest > 0 ? `${h}h ${rest}m` : `${h}h`
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const RANGE_PRESETS = [
  { label: '7 DIAS', days: 7 },
  { label: '30 DIAS', days: 30 },
  { label: '90 DIAS', days: 90 },
] as const

export function TimeReportsPage() {
  const [byArea, setByArea] = useState<ByAreaResponse | null>(null)
  const [weekly, setWeekly] = useState<WeeklyBucket[] | null>(null)
  const [rangeDays, setRangeDays] = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const today = new Date()
    const from = new Date(today)
    from.setDate(today.getDate() - rangeDays + 1)
    Promise.all([
      get<ByAreaResponse>(`/api/time-reports/by-area?from=${isoLocal(from)}&to=${isoLocal(today)}`),
      get<{ weeks: WeeklyBucket[] }>('/api/time-reports/weekly?weeks=8'),
    ]).then(([a, w]) => {
      setByArea(a)
      setWeekly(w.weeks)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [rangeDays])

  return (
    <PageShell headerLabel="// TIME.REPORTS · ONDE FOI SEU TEMPO">
      {/* Range selector */}
      <div style={{
        display: 'flex',
        gap: 6,
        marginBottom: 18,
        padding: '0 4px',
      }}>
        {RANGE_PRESETS.map(r => (
          <button
            key={r.days}
            type="button"
            onClick={() => setRangeDays(r.days)}
            style={{
              background: rangeDays === r.days
                ? 'rgba(143, 191, 211, 0.14)'
                : 'rgba(8, 12, 18, 0.55)',
              border: rangeDays === r.days
                ? '1px solid var(--color-ice)'
                : '1px solid var(--color-border)',
              cursor: 'pointer',
              color: rangeDays === r.days
                ? 'var(--color-ice-light)'
                : 'var(--color-text-tertiary)',
              fontFamily: 'var(--font-mono)',
              padding: '6px 14px',
              fontSize: 10, fontWeight: 700,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
              boxShadow: rangeDays === r.days ? '0 0 10px rgba(143, 191, 211, 0.20)' : 'none',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
        {/* Coluna 1: Donut + Lista por área */}
        <section style={cardStyle}>
          <SectionHeader label="POR ÁREA" />
          {loading ? (
            <Empty label="CARREGANDO…" />
          ) : !byArea || byArea.items.length === 0 ? (
            <Empty label="NENHUMA SESSÃO NO PERÍODO" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <DonutChart items={byArea.items} total={byArea.total_minutes} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {byArea.items.map(item => {
                  const pct = byArea.total_minutes > 0
                    ? (item.minutes / byArea.total_minutes) * 100
                    : 0
                  return (
                    <div
                      key={item.slug}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '12px 1fr auto auto',
                        gap: 10, alignItems: 'center',
                        padding: '6px 8px',
                        background: 'rgba(8, 12, 18, 0.45)',
                        borderLeft: `2px solid ${item.color || 'var(--color-ice-deep)'}`,
                      }}
                    >
                      <div style={{
                        width: 10, height: 10,
                        background: item.color || 'var(--color-text-muted)',
                        flexShrink: 0,
                      }} />
                      <div style={{ fontSize: 12, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.label}
                      </div>
                      <div style={{ ...metaStyle, color: 'var(--color-text-secondary)' }}>{fmtMin(item.minutes)}</div>
                      <div style={{ ...metaStyle, color: 'var(--color-text-muted)' }}>{pct.toFixed(0)}%</div>
                    </div>
                  )
                })}
              </div>
              <div style={{
                ...metaStyle,
                paddingTop: 8,
                borderTop: '1px solid var(--color-ice-deep)',
                color: 'var(--color-ice-light)',
              }}>
                TOTAL · {fmtMin(byArea.total_minutes)}
              </div>
            </div>
          )}
        </section>

        {/* Coluna 2: Semanal */}
        <section style={cardStyle}>
          <SectionHeader label="ÚLTIMAS 8 SEMANAS" />
          {loading ? (
            <Empty label="CARREGANDO…" />
          ) : !weekly || weekly.length === 0 ? (
            <Empty label="SEM DADOS" />
          ) : (
            <WeeklyBars data={weekly} />
          )}
        </section>
      </div>
    </PageShell>
  )
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <span style={{
        width: 3, height: 14,
        background: 'var(--color-ice)',
        boxShadow: '0 0 8px var(--color-ice-glow)',
      }} />
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10, fontWeight: 700,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.22em', textTransform: 'uppercase',
      }}>
        <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
        {label}
      </span>
    </div>
  )
}

function Empty({ label }: { label: string }) {
  return (
    <div style={{
      padding: '24px 12px',
      textAlign: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: 9, fontWeight: 700,
      color: 'var(--color-text-muted)',
      letterSpacing: '0.22em', textTransform: 'uppercase',
      border: '1px dashed rgba(143, 191, 211, 0.22)',
    }}>
      <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
      {label}
    </div>
  )
}

function DonutChart({ items, total }: { items: ReportItem[]; total: number }) {
  if (total === 0) return null
  const size = 220
  const r = size / 2 - 16
  const cx = size / 2
  const cy = size / 2
  const stroke = 28

  let acc = 0
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '4px 0' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(143, 191, 211, 0.10)" strokeWidth={stroke} />
        {items.map(item => {
          const pct = item.minutes / total
          const start = acc
          const end = acc + pct
          acc = end
          const c = 2 * Math.PI * r
          const dasharray = `${pct * c} ${c}`
          const dashoffset = -start * c
          return (
            <circle
              key={item.slug}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={item.color || 'var(--color-ice-deep)'}
              strokeWidth={stroke}
              strokeDasharray={dasharray}
              strokeDashoffset={dashoffset}
              transform={`rotate(-90 ${cx} ${cy})`}
            >
              <title>{`${item.label}: ${fmtMin(item.minutes)}`}</title>
            </circle>
          )
        })}
        {/* Center label */}
        <text
          x={cx} y={cy - 4}
          textAnchor="middle"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 18, fontWeight: 700,
            fill: 'var(--color-text-primary)',
          }}
        >
          {fmtMin(total)}
        </text>
        <text
          x={cx} y={cy + 14}
          textAnchor="middle"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            fill: 'var(--color-text-muted)',
            letterSpacing: 1,
          }}
        >
          TOTAL
        </text>
      </svg>
    </div>
  )
}

function WeeklyBars({ data }: { data: WeeklyBucket[] }) {
  const max = Math.max(1, ...data.map(d => d.total_minutes))
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  function shortLabel(iso: string) {
    const [, m, d] = iso.split('-')
    return `${d}/${months[parseInt(m, 10) - 1]}`
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map((w, i) => {
        const pct = (w.total_minutes / max) * 100
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 70px', gap: 10, alignItems: 'center' }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.1em',
            }}>
              {shortLabel(w.week_start)}
            </div>
            <div
              title={`Quest: ${fmtMin(w.quest)} · Task: ${fmtMin(w.task)} · Routine: ${fmtMin(w.routine)}`}
              style={{
                display: 'flex',
                height: 18,
                background: 'rgba(143, 191, 211, 0.08)',
                width: `${pct}%`,
                minWidth: w.total_minutes > 0 ? 2 : 0,
              }}
            >
              {w.quest > 0 && (
                <div style={{
                  flex: w.quest,
                  background: 'var(--color-ice-light)',
                  opacity: 0.85,
                }} />
              )}
              {w.task > 0 && (
                <div style={{
                  flex: w.task,
                  background: 'var(--color-accent-light)',
                  opacity: 0.85,
                }} />
              )}
              {w.routine > 0 && (
                <div style={{
                  flex: w.routine,
                  background: 'var(--color-success-light)',
                  opacity: 0.85,
                }} />
              )}
            </div>
            <div style={{ ...metaStyle, color: 'var(--color-text-secondary)' }}>
              {fmtMin(w.total_minutes)}
            </div>
          </div>
        )
      })}
      <div style={{
        marginTop: 8, paddingTop: 8,
        borderTop: '1px solid var(--color-ice-deep)',
        display: 'flex', gap: 14, flexWrap: 'wrap',
      }}>
        <Legend color="var(--color-ice-light)" label="QUEST" />
        <Legend color="var(--color-accent-light)" label="TASK" />
        <Legend color="var(--color-success-light)" label="ROUTINE" />
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: 'var(--font-mono)',
      fontSize: 9, fontWeight: 700,
      color: 'var(--color-text-muted)',
      letterSpacing: '0.18em', textTransform: 'uppercase',
    }}>
      <span style={{ width: 10, height: 10, background: color }} />
      {label}
    </span>
  )
}

const cardStyle: React.CSSProperties = {
  padding: 16,
  background: 'rgba(8, 12, 18, 0.55)',
  border: '1px solid rgba(143, 191, 211, 0.22)',
  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
}

const metaStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10, fontWeight: 700,
  letterSpacing: '0.12em',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
}
