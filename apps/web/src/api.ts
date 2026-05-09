import type {
  DayData, Project, Quest, Area, Routine, MicroTask, Profile, Task, Deliverable,
  FinAccount, FinCategory, FinTransaction, FinSummary, FinImportSummary,
  FinMonthlySummary, FinCategorizationRule, FinDebt, FinDebtParcela, FinDebtStatus,
  FinParcela, FinPaymentTemplate, FinClient, FinHourlyRateStats, FinFreelaProject,
  FinInvoice, FinInvoiceStatus, FinExchangeRate,
  FinRecurringBill, FinRecurringBillStatusMonth,
  FinMonthCommitments,
  FinAccountType, FinAccountOrigin, FinCategoryType,
  BuildPurpose, BuildPrinciple, BuildVision, BuildSettings,
  BuildGoal, BuildGoalCreate, BuildGoalUpdate, BuildGoalAreaLink, BuildGoalStatus,
  BuildProjectAlignment, BuildProjectClassification,
  BuildSprint, BuildSprintCreate, BuildSprintUpdate, BuildGoalDependency,
  BuildRitual, BuildRitualCadencia, BuildRitualUpdate, BuildRitualSession,
  BuildRitualSessionCreate, BuildRitualScheduleItem,
} from './types'

// URL base do backend. Default aponta pro backend local padrão; pode ser
// sobrescrito em build via `VITE_API_URL` (ex: `.env` com `VITE_API_URL=http://192.168.x.y:8001`).
export const BASE: string = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8001'

/** Logger centralizado pra erros de API. Não silencia nada — `console.warn`
 *  com contexto. Deixe `.catch(err => reportApiError('nomeDaAcao', err))`
 *  em vez de `.catch(() => {})` pra manter visibilidade em DevTools. */
export function reportApiError(context: string, err: unknown): void {
  // eslint-disable-next-line no-console
  console.warn(`[api] ${context} falhou:`, err)
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export const fetchToday = () => get<DayData>('/api/day/today')

// ─── Quests (work items — subtarefas) ──────────────────────────────────────
// Quest não é mais projeto. Toda quest tem project_id + deliverable_id.

export const fetchQuests = (area?: string) =>
  get<Quest[]>(area ? `/api/quests?area=${area}` : '/api/quests')

/** Quests (subtarefas) de um projeto específico. */
export const fetchQuestsByProject = (projectId: string) =>
  get<Quest[]>(`/api/quests?project_id=${encodeURIComponent(projectId)}`)

/** @deprecated use fetchQuestsByProject — nome antigo quando projeto era quest. */
export const fetchSubtasks = fetchQuestsByProject

// ─── Projects (containers estratégicos) ────────────────────────────────────

export const fetchProjects = (area?: string) =>
  get<Project[]>(area ? `/api/projects?area=${encodeURIComponent(area)}` : '/api/projects')

export const fetchProject = (id: string) => get<Project>(`/api/projects/${id}`)

/**
 * Resumo de entregáveis por projeto — `{projectId: {total, done}}`.
 * Evita N+1 do frontend quando a lista de projetos precisa mostrar barra
 * de progresso. Backend faz um único SELECT agrupado.
 */
export const fetchDeliverablesSummary = (area?: string) =>
  get<Record<string, { total: number; done: number }>>(
    area ? `/api/projects/deliverables-summary?area=${encodeURIComponent(area)}` : '/api/projects/deliverables-summary',
  )

export async function createProject(body: {
  title: string
  area_slug: string
  priority?: string
  status?: string
  deadline?: string | null
  notes?: string | null
}): Promise<Project> {
  const res = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    let detail: string | undefined
    try { detail = JSON.parse(text).detail } catch {}
    const err: any = new Error(detail || `API error ${res.status}`)
    err.status = res.status
    err.detail = detail
    throw err
  }
  return res.json()
}

export async function patchProject(id: string, patch: Partial<Project>): Promise<Project> {
  const res = await fetch(`${BASE}/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/projects/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

export const fetchAreas = () => get<Area[]>('/api/areas')

export async function createArea(body: { name: string; description?: string; color?: string; slug?: string }): Promise<Area> {
  const res = await fetch(`${BASE}/api/areas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function updateArea(slug: string, patch: Partial<{ name: string; description: string; color: string; sort_order: number }>): Promise<Area> {
  const res = await fetch(`${BASE}/api/areas/${slug}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function deleteArea(slug: string): Promise<void> {
  const res = await fetch(`${BASE}/api/areas/${slug}`, { method: 'DELETE' })
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}))
    const err: any = new Error('409')
    err.detail = data.detail ?? 'Área tem quests vinculadas'
    throw err
  }
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

export const fetchProfile = () => get<Profile>('/api/profile')

export async function updateProfile(patch: Partial<Profile>): Promise<Profile> {
  const res = await fetch(`${BASE}/api/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function fetchTasks(opts?: { done?: boolean; date?: string }): Promise<Task[]> {
  const params = new URLSearchParams()
  if (opts?.done !== undefined) params.set('done', String(opts.done))
  if (opts?.date) params.set('date', opts.date)
  const qs = params.toString()
  return get<Task[]>(`/api/tasks${qs ? '?' + qs : ''}`)
}

export async function createTask(body: {
  title: string
  priority: string
  scheduled_date?: string | null
  start_time?: string | null
  end_time?: string | null
  duration_minutes?: number | null
}): Promise<Task> {
  const res = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function updateTask(id: string, patch: Partial<{
  title: string
  scheduled_date: string | null
  start_time: string | null
  end_time: string | null
  duration_minutes: number | null
  done: boolean
  description: string | null
}>): Promise<Task> {
  const res = await fetch(`${BASE}/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function toggleTask(id: string): Promise<Task> {
  const res = await fetch(`${BASE}/api/tasks/${id}/toggle`, { method: 'POST' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/tasks/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

// Task sessions (play/pause/resume/stop + history)

export interface TaskSession {
  id: number
  task_id: string
  session_num: number
  started_at: string
  ended_at: string | null
}

export const fetchTaskSessions = (taskId: string) =>
  get<TaskSession[]>(`/api/tasks/${taskId}/sessions`)

async function sessionPostConflict(url: string): Promise<any> {
  const res = await fetch(url, { method: 'POST' })
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}))
    const err: any = new Error('409')
    err.conflictTitle = data.detail
    throw err
  }
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export const startTaskSession = (id: string) =>
  sessionPostConflict(`${BASE}/api/tasks/${id}/sessions/start`) as Promise<TaskSession>
export const pauseTaskSession = (id: string) =>
  sessionPostConflict(`${BASE}/api/tasks/${id}/sessions/pause`) as Promise<TaskSession>
export const resumeTaskSession = (id: string) =>
  sessionPostConflict(`${BASE}/api/tasks/${id}/sessions/resume`) as Promise<TaskSession>
export const stopTaskSession = (id: string) =>
  sessionPostConflict(`${BASE}/api/tasks/${id}/sessions/stop`) as Promise<Task>

// Routine sessions (play/pause/resume/stop + history by date)

export interface RoutineSession {
  id: number
  routine_id: string
  date: string
  session_num: number
  started_at: string
  ended_at: string | null
}

export const fetchRoutineSessions = (routineId: string, target?: string) => {
  const qs = target ? `?target=${target}` : ''
  return get<RoutineSession[]>(`/api/routines/${routineId}/sessions${qs}`)
}

export const startRoutineSession = (id: string, target?: string) =>
  sessionPostConflict(`${BASE}/api/routines/${id}/sessions/start${target ? '?target=' + target : ''}`) as Promise<RoutineSession>
export const pauseRoutineSession = (id: string, target?: string) =>
  sessionPostConflict(`${BASE}/api/routines/${id}/sessions/pause${target ? '?target=' + target : ''}`) as Promise<RoutineSession>
export const resumeRoutineSession = (id: string, target?: string) =>
  sessionPostConflict(`${BASE}/api/routines/${id}/sessions/resume${target ? '?target=' + target : ''}`) as Promise<RoutineSession>
export const stopRoutineSession = (id: string, target?: string) =>
  sessionPostConflict(`${BASE}/api/routines/${id}/sessions/stop${target ? '?target=' + target : ''}`) as Promise<{ status: string; routine_id: string; date: string; done: boolean }>

export const fetchRoutines = () => get<Routine[]>('/api/routines')

export async function toggleRoutine(id: string): Promise<Routine> {
  const res = await fetch(`${BASE}/api/routines/${id}/toggle`, { method: 'POST' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function fetchAllRoutines(): Promise<Routine[]> {
  return get<Routine[]>('/api/routines/all')
}

/** Rotinas que aplicam num dia específico (YYYY-MM-DD), com `done` preenchido
 *  pelo backend consultando routine_logs daquele dia. */
export async function fetchRoutinesForDate(targetIso: string): Promise<Routine[]> {
  return get<Routine[]>(`/api/routines?target=${encodeURIComponent(targetIso)}`)
}

export interface RoutineCompletionStats {
  from: string
  to: string
  days: number
  expected: number
  completed: number
  rate: number
}

export async function fetchRoutineCompletionStats(from: string, to: string): Promise<RoutineCompletionStats> {
  return get<RoutineCompletionStats>(`/api/routines/completion-stats?from=${from}&to=${to}`)
}

export async function createRoutine(body: Omit<Routine, 'id' | 'done'>): Promise<Routine> {
  const res = await fetch(`${BASE}/api/routines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function updateRoutine(id: string, body: Partial<Routine>): Promise<Routine> {
  const res = await fetch(`${BASE}/api/routines/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function deleteRoutine(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/routines/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}


export async function createQuest(body: {
  title: string
  area_slug: string
  project_id: string
  deliverable_id: string
  priority?: string
  estimated_minutes?: number
  description?: string | null
  next_action?: string | null
}): Promise<Quest> {
  const res = await fetch(`${BASE}/api/quests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    let detail: string | undefined
    try { detail = JSON.parse(text).detail } catch {}
    const err: any = new Error(detail || `API error ${res.status}`)
    err.status = res.status
    err.detail = detail
    throw err
  }
  return res.json()
}

export async function patchQuest(id: string, body: Partial<Quest>): Promise<Quest> {
  const res = await fetch(`${BASE}/api/quests/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function deleteQuest(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/quests/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

export interface QuestSession {
  id: number
  quest_id: string
  session_num: number
  started_at: string
  ended_at: string | null
}

export const fetchSessions = (questId: string) => get<QuestSession[]>(`/api/quests/${questId}/sessions`)

// ─── Edição manual de sessão ───────────────────────────────────────────────
// 6 endpoints: PATCH + DELETE pra cada um dos 3 tipos. Body do PATCH aceita
// `started_at` e/ou `ended_at` (ISO). Resposta inclui `overlap_warning: bool`
// quando a edição cria sobreposição com outra sessão da mesma entity —
// frontend usa pra exibir aviso amarelo, não bloqueia.

export type EditedSessionResp = QuestSession & { overlap_warning?: boolean }

async function patchSession(path: string, body: { started_at?: string; ended_at?: string | null }): Promise<EditedSessionResp> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    let detail: string | undefined
    try { detail = JSON.parse(text).detail } catch {}
    const err: any = new Error(detail || `API error ${res.status}`)
    err.status = res.status
    err.detail = detail
    throw err
  }
  return res.json()
}

async function deleteSession(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) throw new Error(`API error ${res.status}`)
}

export const editQuestSession = (sessionId: number, body: { started_at?: string; ended_at?: string | null }) =>
  patchSession(`/api/quest-sessions/${sessionId}`, body)
export const deleteQuestSession = (sessionId: number) =>
  deleteSession(`/api/quest-sessions/${sessionId}`)

export const editTaskSession = (sessionId: number, body: { started_at?: string; ended_at?: string | null }) =>
  patchSession(`/api/task-sessions/${sessionId}`, body)
export const deleteTaskSession = (sessionId: number) =>
  deleteSession(`/api/task-sessions/${sessionId}`)

export const editRoutineSession = (sessionId: number, body: { started_at?: string; ended_at?: string | null }) =>
  patchSession(`/api/routine-sessions/${sessionId}`, body)
export const deleteRoutineSessionById = (sessionId: number) =>
  deleteSession(`/api/routine-sessions/${sessionId}`)

export interface ActiveSession {
  type: 'quest' | 'task' | 'routine'
  id: string
  title: string
  area_slug: string | null
  started_at: string
  ended_at: string | null
  is_active: boolean
  parent_title?: string | null
  deliverable_title?: string | null
  routine_date?: string | null
  /** Tempo estimado da entidade em minutos. Banner usa pra detectar overflow
   *  (tempo gasto > estimado → muda paleta da animação pra vermelho/prata). */
  estimated_minutes?: number | null
  /** @deprecated */
  quest_id?: string | null
}

export const fetchActiveSession = async (focused?: { type: string; id: string } | null): Promise<ActiveSession | null> => {
  const params = new URLSearchParams()
  if (focused) {
    params.set('focused_type', focused.type)
    params.set('focused_id', focused.id)
  }
  const qs = params.toString()
  const res = await fetch(`${BASE}/api/sessions/active${qs ? '?' + qs : ''}`)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function startSession(questId: string): Promise<QuestSession> {
  const res = await fetch(`${BASE}/api/quests/${questId}/sessions/start`, { method: 'POST' })
  if (res.status === 409) {
    const data = await res.json()
    const err: any = new Error('409')
    err.conflictTitle = data.detail
    throw err
  }
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function pauseSession(questId: string): Promise<QuestSession> {
  const res = await fetch(`${BASE}/api/quests/${questId}/sessions/pause`, { method: 'POST' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function resumeSession(questId: string): Promise<QuestSession> {
  const res = await fetch(`${BASE}/api/quests/${questId}/sessions/resume`, { method: 'POST' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

// ─── Deliverables ──────────────────────────────────────────────────────────
// Deliverables agora são filhos de Project (não mais de Quest).

export const fetchDeliverables = (projectId: string) =>
  get<Deliverable[]>(`/api/projects/${projectId}/deliverables`)

export async function createDeliverable(
  projectId: string,
  title: string,
  opts?: { estimatedMinutes?: number; deadline?: string | null },
): Promise<Deliverable> {
  const payload: any = { title }
  if (opts?.estimatedMinutes !== undefined) payload.estimated_minutes = opts.estimatedMinutes
  if (opts?.deadline !== undefined) payload.deadline = opts.deadline

  const res = await fetch(`${BASE}/api/projects/${projectId}/deliverables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const error = await res.text()
    console.error('API error response:', error)
    throw new Error(`API error ${res.status}: ${error}`)
  }
  return res.json()
}

export async function updateDeliverable(delivId: string, data: any): Promise<Deliverable> {
  const res = await fetch(`${BASE}/api/deliverables/${delivId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function deleteDeliverable(delivId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/deliverables/${delivId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const text = await res.text()
    let detail: string | undefined
    try { detail = JSON.parse(text).detail } catch {}
    const err: any = new Error(detail || `API error ${res.status}`)
    err.status = res.status
    err.detail = detail
    throw err
  }
}

export async function reorderDeliverables(projectId: string, delivIds: string[]): Promise<any> {
  const res = await fetch(`${BASE}/api/projects/${projectId}/deliverables/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deliv_ids: delivIds }),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

// Micro Tasks
export const fetchMicroTasks = () => get<MicroTask[]>('/api/micro-tasks')

export async function createMicroTask(title: string): Promise<MicroTask> {
  const res = await fetch(`${BASE}/api/micro-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function deleteMicroTask(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/micro-tasks/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

// Google Calendar integration
export async function createCalendarEvent(questId: string, title: string, startTime: string, endTime?: string): Promise<any> {
  const res = await fetch(`${BASE}/api/calendar/create-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quest_id: questId, title, start_time: startTime, end_time: endTime }),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function updateCalendarEvent(eventId: string, data: any): Promise<any> {
  const res = await fetch(`${BASE}/api/calendar/update-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: eventId, ...data }),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function deleteCalendarEvent(eventId: string): Promise<any> {
  const res = await fetch(`${BASE}/api/calendar/delete-event?event_id=${eventId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

// ─── Hub Finance (v0) ─────────────────────────────────────────────────────

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

// Accounts
export const fetchFinAccounts = () => get<FinAccount[]>('/api/finance/accounts')

export async function createFinAccount(body: {
  nome: string
  tipo: FinAccountType
  moeda?: string
  origem_dados?: FinAccountOrigin
  cotacao_brl?: number | null
}): Promise<FinAccount> {
  return jsonOrThrow<FinAccount>(await fetch(`${BASE}/api/finance/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function updateFinAccount(id: string, patch: Partial<FinAccount>): Promise<FinAccount> {
  return jsonOrThrow<FinAccount>(await fetch(`${BASE}/api/finance/accounts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
}

export async function deleteFinAccount(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/accounts/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

export async function reorderFinAccounts(ids: string[]): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/accounts/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

export interface FinAccountUsage {
  account_id: string
  transactions: number
  invoices: number
}

export const fetchFinAccountUsage = (id: string) =>
  get<FinAccountUsage>(`/api/finance/accounts/${id}/usage`)

/** Busca cotação online via AwesomeAPI (BR, gratuita, sem key).
 *  Pode falhar (rede bloqueada na corporativa) — UI deve cair pra entrada manual. */
export const fetchFinExchangeRate = (from: string, to: string = 'BRL') =>
  get<FinExchangeRate>(`/api/finance/exchange-rate?from=${from}&to=${to}`)

// ─── Recurring Bills (contas fixas) ─────────────────────────────────────

export const fetchFinRecurringBills = () =>
  get<FinRecurringBill[]>('/api/finance/recurring-bills')

export async function createFinRecurringBill(body: {
  descricao: string
  valor_estimado: number
  dia_vencimento?: number | null
  categoria_id?: string | null
  conta_pagamento_id?: string | null
  ativa?: boolean
  tipo?: 'despesa' | 'receita'
  notas?: string | null
}): Promise<FinRecurringBill> {
  return jsonOrThrow<FinRecurringBill>(await fetch(`${BASE}/api/finance/recurring-bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function updateFinRecurringBill(
  id: string, patch: Partial<FinRecurringBill>,
): Promise<FinRecurringBill> {
  return jsonOrThrow<FinRecurringBill>(await fetch(
    `${BASE}/api/finance/recurring-bills/${id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  ))
}

export async function deleteFinRecurringBill(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/recurring-bills/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

export async function reorderFinRecurringBills(ids: string[]): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/recurring-bills/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

/** Status mensal das contas fixas (paga/pendente/atrasada inferido). */
export const fetchFinRecurringBillsStatus = (year: number, month: number) =>
  get<FinRecurringBillStatusMonth>(`/api/finance/recurring-bills/status?year=${year}&month=${month}`)

/** Compromissos do mês — agrega bills + parcelas de dívida ordenadas por dia. */
export const fetchFinMonthCommitments = (year: number, month: number) =>
  get<FinMonthCommitments>(`/api/finance/month-commitments?year=${year}&month=${month}`)

/** Monta a URL de export CSV pra abrir/baixar via window.location ou <a download>. */
export function buildFinExportTransactionsUrl(filters: {
  data_de?: string
  data_ate?: string
  conta_id?: string
  categoria_id?: string
} = {}): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v) params.set(k, v)
  }
  const qs = params.toString()
  return `${BASE}/api/finance/transactions/export${qs ? '?' + qs : ''}`
}

// Categories
export const fetchFinCategories = (tipo?: FinCategoryType) =>
  get<FinCategory[]>(tipo ? `/api/finance/categories?tipo=${tipo}` : '/api/finance/categories')

export async function createFinCategory(body: {
  nome: string
  tipo: FinCategoryType
  cor?: string | null
  categoria_pai_id?: string | null
  limite_mensal?: number | null
}): Promise<FinCategory> {
  return jsonOrThrow<FinCategory>(await fetch(`${BASE}/api/finance/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function updateFinCategory(id: string, patch: Partial<FinCategory>): Promise<FinCategory> {
  return jsonOrThrow<FinCategory>(await fetch(`${BASE}/api/finance/categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
}

export async function deleteFinCategory(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/categories/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

// Transactions
export interface FinTxFilters {
  conta_id?: string
  categoria_id?: string
  data_de?: string
  data_ate?: string
  limit?: number
}

export function fetchFinTransactions(filters: FinTxFilters = {}): Promise<FinTransaction[]> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return get<FinTransaction[]>(`/api/finance/transactions${qs ? '?' + qs : ''}`)
}

export async function createFinTransaction(body: {
  data: string
  valor: number
  descricao: string
  conta_id: string
  categoria_id?: string | null
  origem?: 'manual' | 'pynubank'
  notas?: string | null
}): Promise<FinTransaction> {
  return jsonOrThrow<FinTransaction>(await fetch(`${BASE}/api/finance/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function updateFinTransaction(id: string, patch: Partial<FinTransaction>): Promise<FinTransaction> {
  return jsonOrThrow<FinTransaction>(await fetch(`${BASE}/api/finance/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
}

export async function deleteFinTransaction(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/transactions/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

// Summary
export const fetchFinSummary = () => get<FinSummary>('/api/finance/summary')

/** Resumo de um mês civil — receita, despesa, sobra, contagem.
 *  `month` é 1-indexed (1 = janeiro, 12 = dezembro). */
export const fetchFinMonthlySummary = (year: number, month: number) =>
  get<FinMonthlySummary>(`/api/finance/monthly-summary?year=${year}&month=${month}`)

/** Média histórica de R$/hora — agregado cross-projeto da área freelas.
 *  Usado pra comparar projetos individuais contra a média geral. */
export const fetchFinHourlyRateStats = () =>
  get<FinHourlyRateStats>('/api/finance/hourly-rate-stats')

/** Lista projetos da área freelas com dados financeiros pré-computados
 *  (cliente, horas, R$/hora real e estimado, próxima parcela). Evita
 *  N+1 fetches. */
export const fetchFinFreelaProjects = () =>
  get<FinFreelaProject[]>('/api/finance/freela-projects')

// Categorization rules — substring (case-insensitive) da descrição mapeia
// pra uma categoria. Aplicadas no import CSV automaticamente.
export const fetchFinCategorizationRules = () =>
  get<FinCategorizationRule[]>('/api/finance/categorization-rules')

export async function createFinCategorizationRule(body: {
  pattern: string
  categoria_id: string
  link_cartao_id?: string | null
}): Promise<FinCategorizationRule> {
  return jsonOrThrow<FinCategorizationRule>(await fetch(`${BASE}/api/finance/categorization-rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function updateFinCategorizationRule(
  id: string,
  patch: Partial<FinCategorizationRule>,
): Promise<FinCategorizationRule> {
  return jsonOrThrow<FinCategorizationRule>(await fetch(`${BASE}/api/finance/categorization-rules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
}

export async function deleteFinCategorizationRule(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/categorization-rules/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

export interface FinRuleBackfillPreview {
  matches_total: number
  matches_uncategorized: number
  sample: string[]
}

export const previewBackfillRule = (id: string) =>
  get<FinRuleBackfillPreview>(`/api/finance/categorization-rules/${id}/preview-backfill`)

export async function applyBackfillRule(
  id: string, opts: { overwrite?: boolean } = {},
): Promise<{ updated: number; linked_invoices: number }> {
  const qs = opts.overwrite ? '?overwrite=true' : ''
  return jsonOrThrow<{ updated: number; linked_invoices: number }>(await fetch(
    `${BASE}/api/finance/categorization-rules/${id}/backfill${qs}`,
    { method: 'POST' },
  ))
}

// Debts — dívidas externas (faculdade, financiamento, parcelamentos não-rotativos).
// Saldo decrescente computado pelo backend a partir das transações vinculadas
// (via fin_transaction.divida_id).
export const fetchFinDebts = (status?: FinDebtStatus) =>
  get<FinDebt[]>(status ? `/api/finance/debts?status=${status}` : '/api/finance/debts')

export async function createFinDebt(body: {
  descricao: string
  valor_total_original: number
  parcela_mensal?: number | null
  data_inicio?: string | null
  categoria_id?: string | null
}): Promise<FinDebt> {
  return jsonOrThrow<FinDebt>(await fetch(`${BASE}/api/finance/debts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function updateFinDebt(id: string, patch: Partial<FinDebt>): Promise<FinDebt> {
  return jsonOrThrow<FinDebt>(await fetch(`${BASE}/api/finance/debts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
}

export async function deleteFinDebt(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/debts/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

// Debt parcelas — cronograma flexível por dívida (auto-balanço)
export const fetchFinDebtParcelas = (debtId: string) =>
  get<FinDebtParcela[]>(`/api/finance/debts/${debtId}/parcelas`)

export async function createFinDebtParcela(debtId: string, body: {
  data_prevista?: string | null
  valor_planejado?: number | null
  notas?: string | null
}): Promise<FinDebtParcela> {
  return jsonOrThrow<FinDebtParcela>(await fetch(
    `${BASE}/api/finance/debts/${debtId}/parcelas`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  ))
}

export async function generateFinDebtParcelas(debtId: string, body: {
  n_parcelas: number
  data_inicio: string
  modo: 'uniforme' | 'open'
}): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/debts/${debtId}/parcelas/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

/** Gera N parcelas FIXAS pelo saldo restante (total − soma fixas atuais).
 *  Datas começam em `data_inicio` (ou last+1 mês se não dado). */
export async function completeFinDebtParcelas(debtId: string, body: {
  n_parcelas: number
  data_inicio?: string
}): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/debts/${debtId}/parcelas/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`API error ${res.status}: ${err}`)
  }
}

export async function updateFinDebtParcela(parcelaId: string, patch: {
  data_prevista?: string | null
  valor_planejado?: number | null
  transacao_pagamento_id?: string | null
  notas?: string | null
}): Promise<FinDebtParcela> {
  return jsonOrThrow<FinDebtParcela>(await fetch(
    `${BASE}/api/finance/debts/parcelas/${parcelaId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  ))
}

export async function deleteFinDebtParcela(parcelaId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/debts/parcelas/${parcelaId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

// Parcelas — recebimentos esperados de projetos freela.
export const fetchFinParcelas = (projectId: string) =>
  get<FinParcela[]>(`/api/finance/projects/${projectId}/parcelas`)

/** Lista parcelas de TODOS os projetos. Útil pro select "vincular a parcela"
 *  no CategorizeModal. Retorna shape com `projeto_titulo` pra display. */
export const fetchAllFinParcelas = (status?: FinParcela['status']) =>
  get<FinParcela[]>(status ? `/api/finance/parcelas?status=${status}` : '/api/finance/parcelas')

// Clients — pessoas/empresas que pagam projetos freela. Habilita auto-vínculo
// de receita por CPF/CNPJ na descrição da transação.
export const fetchFinClients = () => get<FinClient[]>('/api/finance/clients')

export async function createFinClient(body: {
  nome: string
  cpf_cnpj?: string | null
  notas?: string | null
}): Promise<FinClient> {
  return jsonOrThrow<FinClient>(await fetch(`${BASE}/api/finance/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function updateFinClient(id: string, patch: Partial<FinClient>): Promise<FinClient> {
  return jsonOrThrow<FinClient>(await fetch(`${BASE}/api/finance/clients/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
}

export async function deleteFinClient(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/clients/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

// Invoices — faturas de cartão de crédito. Compras em conta tipo='credito'
// são auto-vinculadas à fatura aberta. Pagar a fatura cria 2 transações de
// Transferência Interna e marca a fatura como paga (ver doc PLAN.md).
export const fetchFinInvoices = (opts?: {
  cartao_id?: string
  status?: FinInvoiceStatus
}) => {
  const params = new URLSearchParams()
  if (opts?.cartao_id) params.set('cartao_id', opts.cartao_id)
  if (opts?.status) params.set('status', opts.status)
  const qs = params.toString()
  return get<FinInvoice[]>(`/api/finance/invoices${qs ? '?' + qs : ''}`)
}

export async function createFinInvoice(body: {
  cartao_id: string
  mes_referencia: string
  data_fechamento?: string | null
  data_vencimento?: string | null
}): Promise<FinInvoice> {
  return jsonOrThrow<FinInvoice>(await fetch(`${BASE}/api/finance/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function updateFinInvoice(id: string, patch: Partial<FinInvoice>): Promise<FinInvoice> {
  return jsonOrThrow<FinInvoice>(await fetch(`${BASE}/api/finance/invoices/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
}

export async function deleteFinInvoice(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/invoices/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

/** Fecha a fatura — não aceita mais novas compras. Próxima compra cria
 *  nova fatura aberta automaticamente. */
export async function closeFinInvoice(id: string): Promise<FinInvoice> {
  return jsonOrThrow<FinInvoice>(await fetch(`${BASE}/api/finance/invoices/${id}/close`, {
    method: 'POST',
  }))
}

/** Paga a fatura: cria 2 transações de Transferência Interna (saída da
 *  conta corrente, entrada no cartão) e marca a fatura como 'paga'. */
export async function payFinInvoice(id: string, body: {
  conta_pagamento_id: string
  data_pagamento: string
}): Promise<FinInvoice> {
  return jsonOrThrow<FinInvoice>(await fetch(`${BASE}/api/finance/invoices/${id}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function createFinParcela(projectId: string, body: {
  valor: number
  data_prevista?: string | null
  observacao?: string | null
}): Promise<FinParcela> {
  return jsonOrThrow<FinParcela>(await fetch(`${BASE}/api/finance/projects/${projectId}/parcelas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

/** Aplica template de parcelas: apaga as pendentes existentes e cria N novas
 *  baseadas no `valor_acordado` do projeto. Preserva parcelas já recebidas. */
export async function applyFinParcelaTemplate(projectId: string, body: {
  template: FinPaymentTemplate
  data_inicio?: string | null
}): Promise<FinParcela[]> {
  return jsonOrThrow<FinParcela[]>(await fetch(`${BASE}/api/finance/projects/${projectId}/parcelas/apply-template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function updateFinParcela(id: string, patch: Partial<FinParcela>): Promise<FinParcela> {
  return jsonOrThrow<FinParcela>(await fetch(`${BASE}/api/finance/parcelas/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
}

export async function deleteFinParcela(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/parcelas/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

// Import CSV (Nubank Conta Corrente).
// Substituiu o plano de pynubank — Nubank descontinuou em set/2024 a API que
// pynubank usava (issue andreroggeri/pynubank#462). Doc: docs/hub-finance/PLAN.md
export async function importNubankCsv(file: File, contaId: string): Promise<FinImportSummary> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('conta_id', contaId)
  const res = await fetch(`${BASE}/api/finance/import/nubank-csv`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    let detail = `API error ${res.status}`
    try { detail = (await res.json())?.detail ?? detail } catch {}
    throw new Error(detail)
  }
  return res.json()
}

// ─── /Build (Sistema de Metas) ─────────────────────────────────────────────
// Endpoints documentados em docs/metas-de-vida/PLAN.md §7.

async function jsonFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (!res.ok) {
    let detail = `API error ${res.status}`
    try { detail = (await res.json())?.detail ?? detail } catch {}
    throw new Error(detail)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// Propósito
export const fetchBuildPurpose = () => get<BuildPurpose>('/api/build/purpose')
export const updateBuildPurpose = (texto: string) =>
  jsonFetch<BuildPurpose>('/api/build/purpose', {
    method: 'PUT',
    body: JSON.stringify({ texto }),
  })

// Princípios negativos
export const fetchBuildPrinciples = (includeArchived = false) =>
  get<BuildPrinciple[]>(`/api/build/principles${includeArchived ? '?include_archived=true' : ''}`)

export const createBuildPrinciple = (texto: string, ordem?: number) =>
  jsonFetch<BuildPrinciple>('/api/build/principles', {
    method: 'POST',
    body: JSON.stringify({ texto, ordem }),
  })

export const updateBuildPrinciple = (
  id: number,
  patch: Partial<Pick<BuildPrinciple, 'texto' | 'ordem' | 'arquivado'>>,
) =>
  jsonFetch<BuildPrinciple>(`/api/build/principles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteBuildPrinciple = (id: number) =>
  jsonFetch<void>(`/api/build/principles/${id}`, { method: 'DELETE' })

// Visão (versionada — uma ativa)
export const fetchBuildVision = () => get<BuildVision | null>('/api/build/vision')
export const fetchBuildVisionHistory = () => get<BuildVision[]>('/api/build/vision/history')

export const versionBuildVision = (
  texto: string,
  dataAlvo: string | null,
  motivoArquivamento?: string,
) =>
  jsonFetch<BuildVision>('/api/build/vision/version', {
    method: 'POST',
    body: JSON.stringify({
      texto,
      data_alvo: dataAlvo,
      motivo_arquivamento: motivoArquivamento ?? null,
    }),
  })

export const updateBuildVision = (patch: { texto?: string; data_alvo?: string | null }) =>
  jsonFetch<BuildVision>('/api/build/vision', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

// Settings
export const fetchBuildSettings = () => get<BuildSettings>('/api/build/settings')
export const updateBuildSettings = (patch: Partial<BuildSettings>) =>
  jsonFetch<BuildSettings>('/api/build/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

// Metas
export const fetchBuildGoals = (status?: BuildGoalStatus) =>
  get<BuildGoal[]>(`/api/build/goals${status ? `?status=${status}` : ''}`)

export const fetchBuildGoal = (id: string) => get<BuildGoal>(`/api/build/goals/${id}`)

export const createBuildGoal = (body: BuildGoalCreate) =>
  jsonFetch<BuildGoal>('/api/build/goals', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateBuildGoal = (id: string, patch: BuildGoalUpdate) =>
  jsonFetch<BuildGoal>(`/api/build/goals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteBuildGoal = (id: string) =>
  jsonFetch<void>(`/api/build/goals/${id}`, { method: 'DELETE' })

export const replaceBuildGoalAreas = (id: string, areas: BuildGoalAreaLink[]) =>
  jsonFetch<BuildGoal>(`/api/build/goals/${id}/areas`, {
    method: 'PUT',
    body: JSON.stringify({ areas }),
  })

// Alinhamento Projeto ↔ Meta + classificação + drift
export const fetchProjectsAlignment = (params?: {
  driftOnly?: boolean
  goalId?: string
  includeArchived?: boolean
}) => {
  const q = new URLSearchParams()
  if (params?.driftOnly) q.set('drift_only', 'true')
  if (params?.goalId) q.set('goal_id', params.goalId)
  if (params?.includeArchived) q.set('include_archived', 'true')
  const qs = q.toString()
  return get<BuildProjectAlignment[]>(
    `/api/build/projects/alignment${qs ? `?${qs}` : ''}`,
  )
}

export const linkProjectToGoal = (projectId: string, goalId: string) =>
  jsonFetch<BuildProjectAlignment>(
    `/api/build/projects/${projectId}/goals`,
    { method: 'POST', body: JSON.stringify({ goal_id: goalId }) },
  )

export const unlinkProjectFromGoal = (projectId: string, goalId: string) =>
  jsonFetch<BuildProjectAlignment>(
    `/api/build/projects/${projectId}/goals/${goalId}`,
    { method: 'DELETE' },
  )

export const classifyProject = (
  projectId: string,
  classification: BuildProjectClassification | null,
) =>
  jsonFetch<BuildProjectAlignment>(
    `/api/build/projects/${projectId}/classification`,
    { method: 'PATCH', body: JSON.stringify({ classification }) },
  )

// Sprints
export const fetchBuildSprints = (goalId?: string) =>
  get<BuildSprint[]>(`/api/build/sprints${goalId ? `?goal_id=${goalId}` : ''}`)

export const createBuildSprint = (body: BuildSprintCreate) =>
  jsonFetch<BuildSprint>('/api/build/sprints', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateBuildSprint = (id: string, patch: BuildSprintUpdate) =>
  jsonFetch<BuildSprint>(`/api/build/sprints/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteBuildSprint = (id: string) =>
  jsonFetch<void>(`/api/build/sprints/${id}`, { method: 'DELETE' })

// Dependências entre Metas
export const fetchGoalDependencies = (goalId: string) =>
  get<BuildGoalDependency[]>(`/api/build/goals/${goalId}/dependencies`)

export const addGoalDependency = (goalId: string, requiresGoalId: string) =>
  jsonFetch<BuildGoalDependency>(`/api/build/goals/${goalId}/dependencies`, {
    method: 'POST',
    body: JSON.stringify({ requires_goal_id: requiresGoalId }),
  })

export const removeGoalDependency = (goalId: string, requiresGoalId: string) =>
  jsonFetch<void>(
    `/api/build/goals/${goalId}/dependencies/${requiresGoalId}`,
    { method: 'DELETE' },
  )

// Progresso (v1 — manual; v2 vem de Health)
export const updateGoalProgress = (id: string, value: number) =>
  jsonFetch<BuildGoal>(`/api/build/goals/${id}/progress`, {
    method: 'PATCH',
    body: JSON.stringify({ criterion_current_value: value }),
  })

// Rituais (v1.5)
export const fetchBuildRituals = () => get<BuildRitual[]>('/api/build/rituals')

export const fetchBuildRitual = (cadencia: BuildRitualCadencia) =>
  get<BuildRitual>(`/api/build/rituals/${cadencia}`)

export const updateBuildRitual = (
  cadencia: BuildRitualCadencia,
  patch: BuildRitualUpdate,
) =>
  jsonFetch<BuildRitual>(`/api/build/rituals/${cadencia}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const fetchBuildRitualSessions = (cadencia: BuildRitualCadencia) =>
  get<BuildRitualSession[]>(`/api/build/rituals/${cadencia}/sessions`)

export const createBuildRitualSession = (
  cadencia: BuildRitualCadencia,
  body: BuildRitualSessionCreate,
) =>
  jsonFetch<BuildRitualSession>(`/api/build/rituals/${cadencia}/sessions`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const fetchBuildRitualSchedule = (from: string, to: string) =>
  get<BuildRitualScheduleItem[]>(
    `/api/build/rituals/schedule?from=${from}&to=${to}`,
  )
