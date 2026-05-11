/**
 * Extrator de timeseries pra sparklines e heatmaps do Hub Health.
 *
 * Cada template do domínio gera uma série temporal diferente:
 *  - janela_qualidade (Sono):    duração em horas, 1 ponto por noite
 *  - atividade_tipo (Exercício): minutos totais por dia
 *  - refeicao_2modos:            contagem de "comeu" por dia
 *  - consumo_vontade (Vícios):   soma de quantidade por dia, opcionalmente por item
 *  - metrica_simples (Medidas):  último valor do dia, por item
 *  - evento_escala:              média de escala por dia
 *
 * Output uniforme: Array<{ data, value }> ordenado cronologicamente.
 */
import type {
  HealthRecord,
  HealthTemplate,
} from '../../types'
import { formatDuration } from './tokens'

export interface TimeseriesPoint {
  data: string                        // YYYY-MM-DD (semântica)
  value: number
  criado_em?: string | null           // timestamp real de criação (pra pulsação live)
}

export interface TimeseriesOptions {
  itemId?: number                     // pra vícios/medidas: filtra por item
}

export function extractTimeseries(
  records: HealthRecord[],
  template: HealthTemplate,
  opts: TimeseriesOptions = {},
): TimeseriesPoint[] {
  // Filtra por item se aplicável
  const filtered = opts.itemId !== undefined
    ? records.filter((r) => r.item_id === opts.itemId)
    : records

  switch (template) {
    case 'janela_qualidade':
      return _sonoTimeseries(filtered)
    case 'atividade_tipo':
      return _aggregateByDay(filtered, (r) => {
        const d = (r.payload as any).duracao_min
        return typeof d === 'number' ? d : 0
      })
    case 'refeicao_2modos':
      return _aggregateByDay(filtered, (r) => {
        const p = r.payload as any
        return p.comeu === true ? 1 : 0
      })
    case 'consumo_vontade':
      return _aggregateByDay(filtered, (r) => {
        const q = (r.payload as any).quantidade
        return typeof q === 'number' ? q : 0
      })
    case 'metrica_simples':
      return _lastValuePerDay(filtered, (r) => {
        const v = (r.payload as any).valor
        return typeof v === 'number' ? v : null
      })
    case 'evento_escala':
      return _averageByDay(filtered, (r) => {
        const e = (r.payload as any).escala
        return typeof e === 'number' ? e : null
      })
    default:
      return []
  }
}

/**
 * Pega o maior criado_em (string ISO) de dois — usado pra propagar o
 * timestamp de criação mais recente quando agrega múltiplos registros do
 * mesmo dia.
 */
function _maxCriadoEm(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null
  if (!b) return a
  return a > b ? a : b
}

/**
 * Sono: duração em horas, ignorando cochilos. Uma noite por entrada.
 * Se tiver múltiplos registros noturnos no mesmo dia (raro), usa o primeiro.
 */
function _sonoTimeseries(records: HealthRecord[]): TimeseriesPoint[] {
  const byDate = new Map<string, { value: number; criado_em: string | null }>()
  for (const r of records) {
    const p = r.payload as any
    if (p.tipo === 'cochilo') continue
    if (typeof p.hora_inicio !== 'string' || typeof p.hora_fim !== 'string') continue
    const dur = formatDuration(p.hora_inicio, p.hora_fim)
    const match = /^(\d+)h(\d{0,2})$/.exec(dur)
    if (!match) continue
    const h = parseInt(match[1], 10)
    const m = match[2] ? parseInt(match[2], 10) : 0
    const valor = h + m / 60
    if (!byDate.has(r.data)) {
      byDate.set(r.data, { value: valor, criado_em: r.criado_em ?? null })
    }
  }
  return Array.from(byDate.entries())
    .map(([data, { value, criado_em }]) => ({ data, value, criado_em }))
    .sort((a, b) => a.data.localeCompare(b.data))
}

function _aggregateByDay(
  records: HealthRecord[],
  extract: (r: HealthRecord) => number,
): TimeseriesPoint[] {
  const buckets = new Map<string, { sum: number; criado_em: string | null }>()
  for (const r of records) {
    const v = extract(r)
    const b = buckets.get(r.data) ?? { sum: 0, criado_em: null }
    b.sum += v
    b.criado_em = _maxCriadoEm(b.criado_em, r.criado_em)
    buckets.set(r.data, b)
  }
  return Array.from(buckets.entries())
    .map(([data, { sum, criado_em }]) => ({ data, value: sum, criado_em }))
    .sort((a, b) => a.data.localeCompare(b.data))
}

function _lastValuePerDay(
  records: HealthRecord[],
  extract: (r: HealthRecord) => number | null,
): TimeseriesPoint[] {
  const sorted = [...records].sort(
    (a, b) => `${a.data} ${a.horario ?? ''} ${a.id}`.localeCompare(
      `${b.data} ${b.horario ?? ''} ${b.id}`,
    ),
  )
  const last = new Map<string, { value: number; criado_em: string | null }>()
  for (const r of sorted) {
    const v = extract(r)
    if (v !== null) {
      last.set(r.data, { value: v, criado_em: r.criado_em ?? null })
    }
  }
  return Array.from(last.entries())
    .map(([data, { value, criado_em }]) => ({ data, value, criado_em }))
    .sort((a, b) => a.data.localeCompare(b.data))
}

function _averageByDay(
  records: HealthRecord[],
  extract: (r: HealthRecord) => number | null,
): TimeseriesPoint[] {
  const buckets = new Map<string, { sum: number; count: number; criado_em: string | null }>()
  for (const r of records) {
    const v = extract(r)
    if (v === null) continue
    const b = buckets.get(r.data) ?? { sum: 0, count: 0, criado_em: null }
    b.sum += v
    b.count += 1
    b.criado_em = _maxCriadoEm(b.criado_em, r.criado_em)
    buckets.set(r.data, b)
  }
  return Array.from(buckets.entries())
    .map(([data, { sum, count, criado_em }]) => ({
      data,
      value: count > 0 ? sum / count : 0,
      criado_em,
    }))
    .sort((a, b) => a.data.localeCompare(b.data))
}

/**
 * Conta registros por dia — usado pelo Heatmap.
 * Retorna Map<YYYY-MM-DD, count>.
 */
export function countRecordsByDay(records: HealthRecord[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const r of records) {
    counts.set(r.data, (counts.get(r.data) ?? 0) + 1)
  }
  return counts
}

/**
 * Gera array de YYYY-MM-DD pros últimos N dias (incluindo hoje).
 */
export function lastNDays(n: number): string[] {
  const out: string[] = []
  const today = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}
