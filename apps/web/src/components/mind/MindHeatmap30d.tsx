/**
 * Heatmap dos últimos 30 dias para o módulo Mind.
 *
 * Inspirado em [`Heatmap30d`](./Heatmap30d.tsx) (usado em Vícios/Alimentação),
 * mas customizado pro vocabulário do Mind:
 *  - Dia sem sessão → fundo neutro (sem dado).
 *  - Dia com **só rotina** → cor Mind (#9b88c4) com alpha proporcional à
 *    quantidade de sessões.
 *  - Dia com **revelação** → âmbar (#c08a3a). Revelação domina visualmente
 *    porque é evento sinalizado pelo usuário como excepcional.
 *  - Hoje → outline + glow leve da cor dominante.
 *
 * Filosofia: dá o controle visual de "estou marcando?" sem reduzir tudo a
 * streak/score. O usuário vê a textura real dos 30 dias.
 */
import type { MindSession } from '../../types'

const MIND_COR = '#9b88c4'
const REVELACAO_COR = '#c08a3a'

interface DayStat {
  data: string
  rotina: number
  revelacao: number
  total: number
}

interface Props {
  sessions: MindSession[]
  cellSize?: number
  gap?: number
}

export default function MindHeatmap30d({
  sessions,
  cellSize = 12,
  gap = 2,
}: Props) {
  const days = lastNDays(30)
  const stats = aggregateByDay(sessions, days)
  const max = Math.max(1, ...stats.map((s) => s.total))
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div
      style={{
        display: 'flex',
        gap: `${gap}px`,
        alignItems: 'center',
      }}
    >
      {stats.map((s) => {
        const isToday = s.data === today
        const hasRevelacao = s.revelacao > 0
        const cor = hasRevelacao ? REVELACAO_COR : MIND_COR
        const opacity = s.total === 0 ? 0 : 0.3 + 0.7 * (s.total / max)
        const dayLabel = s.data.slice(8, 10)
        const showLabel = dayLabel === '01'

        const tooltip = s.total === 0
          ? `${formatBR(s.data)}: sem sessão`
          : `${formatBR(s.data)}: ${s.total} sessão${s.total !== 1 ? 'ões' : ''}${
              hasRevelacao ? ` (${s.revelacao} revelação${s.revelacao !== 1 ? 'es' : ''})` : ''
            }`

        return (
          <div
            key={s.data}
            title={tooltip}
            style={{
              width: cellSize,
              height: cellSize,
              background: s.total === 0 ? 'var(--color-border)' : cor,
              opacity: s.total === 0 ? 1 : opacity,
              border: isToday ? `1px solid ${cor}` : '1px solid transparent',
              boxShadow: isToday ? `0 0 6px ${cor}` : undefined,
              boxSizing: 'border-box',
              position: 'relative',
              flexShrink: 0,
            }}
          >
            {showLabel && (
              <span
                style={{
                  position: 'absolute',
                  top: cellSize + 2,
                  left: 0,
                  fontSize: 8,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.22em',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {monthLabel(s.data)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function aggregateByDay(sessions: MindSession[], days: string[]): DayStat[] {
  const byDay = new Map<string, { rotina: number; revelacao: number }>()
  for (const s of sessions) {
    const b = byDay.get(s.data) ?? { rotina: 0, revelacao: 0 }
    if (s.payload.tipo === 'revelacao') b.revelacao++
    else b.rotina++
    byDay.set(s.data, b)
  }
  return days.map((d) => {
    const b = byDay.get(d) ?? { rotina: 0, revelacao: 0 }
    return { data: d, rotina: b.rotina, revelacao: b.revelacao, total: b.rotina + b.revelacao }
  })
}

function lastNDays(n: number): string[] {
  const out: string[] = []
  const today = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

function formatBR(iso: string): string {
  const parts = iso.split('-')
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : iso
}

function monthLabel(iso: string): string {
  const m = parseInt(iso.split('-')[1], 10)
  const months = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']
  return months[m - 1] ?? ''
}
