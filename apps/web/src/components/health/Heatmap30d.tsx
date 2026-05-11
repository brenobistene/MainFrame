/**
 * Heatmap dos últimos 30 dias — uma fileira de 30 quadradinhos.
 *
 * Cada quadradinho representa um dia. Saturação proporcional à contagem
 * de registros daquele dia (0 → fundo escuro/cinza; 1+ → cor do domínio
 * com alpha proporcional).
 *
 * Captura padrão visual de "tem dado / não tem dado" sem custo cognitivo.
 * Hover mostra tooltip com data e contagem.
 */
import { countRecordsByDay, lastNDays } from './timeseries'
import type { HealthRecord } from '../../types'

interface Props {
  records: HealthRecord[]
  cor: string
  cellSize?: number
  gap?: number
}

export default function Heatmap30d({
  records,
  cor,
  cellSize = 12,
  gap = 2,
}: Props) {
  const counts = countRecordsByDay(records)
  const days = lastNDays(30)

  // Escala de saturação: max = a maior contagem do período (ou 1 mínimo).
  const max = Math.max(1, ...Array.from(counts.values()))
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div
      style={{
        display: 'flex',
        gap: `${gap}px`,
        alignItems: 'center',
      }}
    >
      {days.map((d) => {
        const n = counts.get(d) ?? 0
        const isToday = d === today
        const opacity = n === 0 ? 0 : 0.25 + 0.75 * (n / max)
        const dayLabel = d.slice(8, 10)
        const showLabel = dayLabel === '01'   // marca início de mês

        return (
          <div
            key={d}
            title={`${formatBR(d)}: ${n} registro${n !== 1 ? 's' : ''}`}
            style={{
              width: cellSize,
              height: cellSize,
              background: n === 0 ? 'var(--color-border)' : cor,
              opacity: n === 0 ? 1 : opacity,
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
                {monthLabel(d)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
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
