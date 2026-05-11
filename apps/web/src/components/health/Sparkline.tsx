/**
 * Sparkline SVG inline (sem libs externas — Recharts pode entrar depois
 * se a complexidade exigir).
 *
 * Renderiza uma linha simples com pontos discretos. Pra dado escasso (1-2
 * pontos), mostra só os pontos sem linha. Pra dado denso, área leve abaixo
 * da linha pra dar peso visual.
 *
 * Pulsação no último ponto se ele for "ao vivo" (data === hoje).
 */
import type { TimeseriesPoint } from './timeseries'

interface Props {
  points: TimeseriesPoint[]
  cor: string
  width?: number
  height?: number
  /** Se passado, eixo Y começa em 0; senão, calcula min/max dinamicamente. */
  fixedZero?: boolean
}

export default function Sparkline({
  points,
  cor,
  width = 280,
  height = 50,
  fixedZero = false,
}: Props) {
  if (points.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          color: 'var(--color-text-muted)',
          fontStyle: 'italic',
          letterSpacing: '0.18em',
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
        }}
      >
        // SEM DADOS
      </div>
    )
  }

  // Padding interno pro SVG
  const pad = 4
  const innerW = width - pad * 2
  const innerH = height - pad * 2

  const values = points.map((p) => p.value)
  const minV = fixedZero ? 0 : Math.min(...values)
  const maxV = Math.max(...values)
  const rangeV = maxV - minV || 1   // evita div por zero

  const xStep = points.length > 1 ? innerW / (points.length - 1) : 0
  const xy = points.map((p, i) => {
    const x = pad + xStep * i
    const y = pad + innerH - ((p.value - minV) / rangeV) * innerH
    return { x, y, point: p }
  })

  const pathD = xy.map((s, i) => `${i === 0 ? 'M' : 'L'}${s.x.toFixed(1)},${s.y.toFixed(1)}`).join(' ')
  const areaD =
    xy.length > 1
      ? `${pathD} L${xy[xy.length - 1].x.toFixed(1)},${pad + innerH} L${xy[0].x.toFixed(1)},${pad + innerH} Z`
      : ''

  // "Ao vivo" = ponto cujo último registro foi criado hoje. Pra Sono noturno,
  // a `data` semântica é da noite passada, mas `criado_em` reflete quando
  // o registro foi adicionado de fato. Sem isso, Sono nunca pulsava.
  const today = new Date().toISOString().slice(0, 10)
  const lastPoint = xy[xy.length - 1]
  const lastIsLive = lastPoint
    ? (lastPoint.point.criado_em ?? lastPoint.point.data).slice(0, 10) === today
    : false

  // Filter SVG único por instância (evita colisão de ID quando há
  // múltiplos sparklines na mesma página).
  const filterId = `hh-glow-${cor.replace('#', '')}`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Área abaixo da linha — só se tiver mais de 1 ponto */}
      {areaD && (
        <path
          d={areaD}
          fill={cor}
          opacity={0.08}
        />
      )}
      {/* Linha */}
      {xy.length > 1 && (
        <path
          d={pathD}
          fill="none"
          stroke={cor}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {/* Pontos discretos (todos, com énfase no último — glow se for "ao vivo") */}
      {xy.map((s, i) => {
        const isLast = i === xy.length - 1
        const useGlow = isLast && lastIsLive
        return (
          <circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={isLast ? 2.5 : 1.5}
            fill={cor}
            opacity={isLast ? 1 : 0.7}
            filter={useGlow ? `url(#${filterId})` : undefined}
            className={useGlow ? 'hh-live-pulse' : undefined}
            style={{ transformOrigin: `${s.x}px ${s.y}px` }}
          >
            <title>
              {s.point.data}: {s.point.value.toFixed(2)}
            </title>
          </circle>
        )
      })}
    </svg>
  )
}
