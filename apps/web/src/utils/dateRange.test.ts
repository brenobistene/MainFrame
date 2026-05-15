/**
 * Testes pros presets de data — usados em todas as listas filtradas
 * por período (Dashboard, Áreas, Tarefas, Rotinas, Planner).
 */
import { describe, it, expect } from 'vitest'
import { computeRange, isInRange, rangeLabel } from './dateRange'

describe('computeRange', () => {
  it('today inclui só o dia corrente', () => {
    const r = computeRange('today')
    expect(r.from).not.toBeNull()
    expect(r.to).not.toBeNull()
    const fromMs = r.from!.getTime()
    const toMs = r.to!.getTime()
    // mesma data (local)
    expect(r.from!.toDateString()).toBe(r.to!.toDateString())
    // delta ~ 24h
    expect(toMs - fromMs).toBeGreaterThan(86_399_000)
    expect(toMs - fromMs).toBeLessThanOrEqual(86_399_999)
  })

  it('7d cobre 7 dias incluindo hoje', () => {
    const r = computeRange('7d')
    const days = Math.round((r.to!.getTime() - r.from!.getTime()) / 86_400_000)
    expect(days).toBe(7)
  })

  it('30d cobre 30 dias incluindo hoje', () => {
    const r = computeRange('30d')
    const days = Math.round((r.to!.getTime() - r.from!.getTime()) / 86_400_000)
    expect(days).toBe(30)
  })

  it('all retorna null em ambas as bordas (sem filtro)', () => {
    const r = computeRange('all')
    expect(r.from).toBeNull()
    expect(r.to).toBeNull()
  })

  it('custom usa as datas fornecidas', () => {
    const r = computeRange('custom', '2026-01-01', '2026-12-31')
    expect(r.from).not.toBeNull()
    expect(r.to).not.toBeNull()
    expect(r.customFrom).toBe('2026-01-01')
    expect(r.customTo).toBe('2026-12-31')
  })

  it('custom sem from/to retorna null naqueles campos', () => {
    const r = computeRange('custom')
    expect(r.from).toBeNull()
    expect(r.to).toBeNull()
  })
})

describe('isInRange', () => {
  it('passa tudo quando from/to são null (all preset)', () => {
    const range = computeRange('all')
    expect(isInRange('2020-01-01T00:00:00Z', range)).toBe(true)
    expect(isInRange('2050-01-01T00:00:00Z', range)).toBe(true)
  })

  it('rejeita null/undefined quando range tem bordas', () => {
    const range = computeRange('today')
    expect(isInRange(null, range)).toBe(false)
    expect(isInRange(undefined, range)).toBe(false)
  })

  it('rejeita ISOs inválidas', () => {
    const range = computeRange('today')
    expect(isInRange('not-a-date', range)).toBe(false)
  })

  it('aceita ISO dentro de custom range', () => {
    const range = computeRange('custom', '2026-01-01', '2026-12-31')
    expect(isInRange('2026-06-15T12:00:00Z', range)).toBe(true)
  })

  it('rejeita ISO fora do custom range', () => {
    const range = computeRange('custom', '2026-01-01', '2026-12-31')
    // Antes do range: 30 nov 2025 — bem antes do 1º jan 2026 local
    expect(isInRange('2025-11-30T12:00:00Z', range)).toBe(false)
    // Depois do range: 2 fev 2027 — bem depois do 31 dez 2026 local
    // (não uso 1º jan porque end-of-day local em UTC-3 vai até 03:00 UTC
    // do dia seguinte, edge case clássico de timezone)
    expect(isInRange('2027-02-02T12:00:00Z', range)).toBe(false)
  })
})

describe('rangeLabel', () => {
  it('usa label PT pros presets', () => {
    expect(rangeLabel(computeRange('today'))).toBe('hoje')
    expect(rangeLabel(computeRange('7d'))).toBe('últimos 7 dias')
    expect(rangeLabel(computeRange('30d'))).toBe('últimos 30 dias')
    expect(rangeLabel(computeRange('all'))).toBe('tudo')
  })

  it('formata custom como dd/mm – dd/mm', () => {
    const r = computeRange('custom', '2026-05-01', '2026-05-15')
    expect(rangeLabel(r)).toBe('01/05 – 15/05')
  })

  it('cai pra "customizado" quando custom sem datas', () => {
    expect(rangeLabel(computeRange('custom'))).toBe('customizado')
  })
})
