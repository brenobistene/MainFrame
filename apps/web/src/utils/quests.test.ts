/**
 * Testes do resolvedor de deadline efetiva — quest herda do entregável
 * (e em fallback, do projeto). Função crítica usada em ordenação e
 * marcação visual de quests atrasadas em várias páginas.
 */
import { describe, it, expect } from 'vitest'
import { effectiveQuestDeadline } from './quests'
import type { Quest, Project, Deliverable } from '../types'

function mkQuest(over: Partial<Quest> = {}): Quest {
  return {
    id: 'q1',
    project_id: 'p1',
    title: 'Quest',
    area_slug: 'work',
    status: 'doing',
    priority: 'medium',
    deadline: null,
    estimated_minutes: null,
    next_action: null,
    deliverable_id: 'd1',
    ...over,
  }
}

function mkProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    title: 'Project',
    area_slug: 'work',
    status: 'doing',
    priority: 'medium',
    deadline: null,
    notes: null,
    calendar_event_id: null,
    completed_at: null,
    archived_at: null,
    sort_order: 0,
    valor_acordado: null,
    forma_pagamento_template: null,
    cliente_id: null,
    ...over,
  }
}

function mkDeliv(over: Partial<Deliverable> = {}): Deliverable {
  return {
    id: 'd1',
    project_id: 'p1',
    title: 'Entregável',
    done: false,
    sort_order: 0,
    ...over,
  }
}

describe('effectiveQuestDeadline', () => {
  it('retorna null quando nem entregável nem projeto têm deadline', () => {
    const q = mkQuest()
    const deliv = mkDeliv({ deadline: null })
    const proj = mkProject({ deadline: null })
    expect(effectiveQuestDeadline(q, { p1: [deliv] }, [proj])).toBeNull()
  })

  it('prefere deadline do entregável sobre projeto', () => {
    const q = mkQuest()
    const deliv = mkDeliv({ deadline: '2026-05-15' })
    const proj = mkProject({ deadline: '2026-12-31' })
    expect(effectiveQuestDeadline(q, { p1: [deliv] }, [proj])).toBe('2026-05-15')
  })

  it('fallback pro projeto quando entregável não tem deadline', () => {
    const q = mkQuest()
    const deliv = mkDeliv({ deadline: null })
    const proj = mkProject({ deadline: '2026-12-31' })
    expect(effectiveQuestDeadline(q, { p1: [deliv] }, [proj])).toBe('2026-12-31')
  })

  it('fallback pro projeto quando delivsByProject não populado (race)', () => {
    const q = mkQuest()
    const proj = mkProject({ deadline: '2026-12-31' })
    expect(effectiveQuestDeadline(q, {}, [proj])).toBe('2026-12-31')
  })

  it('null quando quest é orfã (sem project_id)', () => {
    const q = mkQuest({ project_id: null })
    const proj = mkProject({ deadline: '2026-12-31' })
    expect(effectiveQuestDeadline(q, { p1: [] }, [proj])).toBeNull()
  })

  it('null quando deliverable_id aponta pra entregável inexistente + projeto sem deadline', () => {
    const q = mkQuest({ deliverable_id: 'd-fantasma' })
    const proj = mkProject({ deadline: null })
    expect(effectiveQuestDeadline(q, { p1: [mkDeliv()] }, [proj])).toBeNull()
  })
})
