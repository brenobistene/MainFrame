/**
 * Testes pras helpers de datetime — funções puras, sem mock de relógio
 * exceto onde explícito. Foco em casos-borda que já causaram bugs reais
 * em produção (timestamps sem Z, inputs do usuário malformados, etc).
 */
import { describe, it, expect } from 'vitest'
import {
  parseIsoAsUtc,
  parseTimeToMinutes,
  minutesToHmm,
  formatHMS,
  sumClosedSessionsSeconds,
  isValidDateInput,
  isoToLocalYmd,
} from './datetime'

describe('parseIsoAsUtc', () => {
  it('parseia ISO com Z explícito', () => {
    const d = parseIsoAsUtc('2026-05-12T10:00:00Z')
    expect(d.getTime()).toBe(Date.UTC(2026, 4, 12, 10, 0, 0))
  })

  it('assume UTC quando falta Z (legado de DB)', () => {
    const withZ = parseIsoAsUtc('2026-05-12T10:00:00Z')
    const without = parseIsoAsUtc('2026-05-12T10:00:00')
    expect(without.getTime()).toBe(withZ.getTime())
  })

  it('preserva timezone explícito com offset', () => {
    // +00:00 deve ser equivalente a Z
    const offset = parseIsoAsUtc('2026-05-12T10:00:00+00:00')
    const z = parseIsoAsUtc('2026-05-12T10:00:00Z')
    expect(offset.getTime()).toBe(z.getTime())
  })
})

describe('parseTimeToMinutes', () => {
  it('aceita string de minutos puros', () => {
    expect(parseTimeToMinutes('90')).toBe(90)
    expect(parseTimeToMinutes('0')).toBe(0)
  })

  it('aceita formato h:mm', () => {
    expect(parseTimeToMinutes('1:30')).toBe(90)
    expect(parseTimeToMinutes('2:00')).toBe(120)
    expect(parseTimeToMinutes('0:45')).toBe(45)
  })

  it('retorna undefined pra input vazio/null/undefined', () => {
    expect(parseTimeToMinutes('')).toBeUndefined()
    expect(parseTimeToMinutes(null)).toBeUndefined()
    expect(parseTimeToMinutes(undefined)).toBeUndefined()
    expect(parseTimeToMinutes('   ')).toBeUndefined()
  })

  it('retorna undefined pra input mal-formado', () => {
    expect(parseTimeToMinutes('abc')).toBeUndefined()
    expect(parseTimeToMinutes('1:60')).toBeUndefined() // minutos > 59
    expect(parseTimeToMinutes('1:-5')).toBeUndefined()
    expect(parseTimeToMinutes('-1')).toBeUndefined()
    expect(parseTimeToMinutes('1:2:3')).toBeUndefined() // 3 partes
  })

  it('tolera espaços em torno', () => {
    expect(parseTimeToMinutes('  1:30  ')).toBe(90)
    expect(parseTimeToMinutes('  90  ')).toBe(90)
  })
})

describe('minutesToHmm', () => {
  it('formata casos simples', () => {
    expect(minutesToHmm(0)).toBe('0:00')
    expect(minutesToHmm(45)).toBe('0:45')
    expect(minutesToHmm(60)).toBe('1:00')
    expect(minutesToHmm(90)).toBe('1:30')
    expect(minutesToHmm(150)).toBe('2:30')
  })

  it('zera-padding minutos', () => {
    expect(minutesToHmm(61)).toBe('1:01')
    expect(minutesToHmm(605)).toBe('10:05')
  })

  it('round-trip com parseTimeToMinutes', () => {
    const samples = [0, 1, 30, 60, 90, 123, 480, 1440]
    for (const m of samples) {
      expect(parseTimeToMinutes(minutesToHmm(m))).toBe(m)
    }
  })
})

describe('formatHMS', () => {
  it('mm:ss quando < 1h', () => {
    expect(formatHMS(0)).toBe('00:00')
    expect(formatHMS(59)).toBe('00:59')
    expect(formatHMS(60)).toBe('01:00')
    expect(formatHMS(3599)).toBe('59:59')
  })

  it('hh:mm:ss quando >= 1h', () => {
    expect(formatHMS(3600)).toBe('01:00:00')
    expect(formatHMS(3661)).toBe('01:01:01')
    expect(formatHMS(36000)).toBe('10:00:00')
  })
})

describe('sumClosedSessionsSeconds', () => {
  it('soma sessões fechadas', () => {
    const sessions = [
      { started_at: '2026-05-12T10:00:00Z', ended_at: '2026-05-12T10:01:00Z' }, // 60s
      { started_at: '2026-05-12T11:00:00Z', ended_at: '2026-05-12T11:00:30Z' }, // 30s
    ]
    expect(sumClosedSessionsSeconds(sessions)).toBe(90)
  })

  it('ignora sessões abertas (ended_at null)', () => {
    const sessions = [
      { started_at: '2026-05-12T10:00:00Z', ended_at: '2026-05-12T10:01:00Z' },
      { started_at: '2026-05-12T11:00:00Z', ended_at: null }, // ativa
    ]
    expect(sumClosedSessionsSeconds(sessions)).toBe(60)
  })

  it('ignora sessões invertidas (end antes de start)', () => {
    const sessions = [
      { started_at: '2026-05-12T10:00:00Z', ended_at: '2026-05-12T09:59:00Z' },
    ]
    expect(sumClosedSessionsSeconds(sessions)).toBe(0)
  })

  it('zero quando lista vazia', () => {
    expect(sumClosedSessionsSeconds([])).toBe(0)
  })
})

describe('isValidDateInput', () => {
  it('aceita string vazia (sem deadline)', () => {
    expect(isValidDateInput('')).toBe(true)
  })

  it('aceita formato YYYY-MM-DD com ano plausível', () => {
    expect(isValidDateInput('2026-05-12')).toBe(true)
    expect(isValidDateInput('1900-01-01')).toBe(true)
    expect(isValidDateInput('2100-12-31')).toBe(true)
  })

  it('rejeita anos absurdos (bug clássico de digitação)', () => {
    // user digitando "3" no campo gera "0003-..." intermediário
    expect(isValidDateInput('0003-03-14')).toBe(false)
    expect(isValidDateInput('2101-01-01')).toBe(false)
    expect(isValidDateInput('1899-01-01')).toBe(false)
  })

  it('rejeita formato malformado', () => {
    expect(isValidDateInput('12/05/2026')).toBe(false)
    expect(isValidDateInput('2026-5-12')).toBe(false) // sem zero-padding
    expect(isValidDateInput('abc')).toBe(false)
  })
})

describe('isoToLocalYmd', () => {
  it('formata data local como YYYY-MM-DD', () => {
    const d = new Date(2026, 4, 12) // local
    expect(isoToLocalYmd(d)).toBe('2026-05-12')
  })

  it('zero-padding em mês/dia', () => {
    const d = new Date(2026, 0, 5) // 5 jan
    expect(isoToLocalYmd(d)).toBe('2026-01-05')
  })
})
