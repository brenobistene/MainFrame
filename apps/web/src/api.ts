import type {
  DayData, Project, Quest, Area, Routine, MicroTask, Profile, Task, Deliverable,
  Compromisso, CompromissoCreate, CompromissoUpdate, CompromissoOccurrence,
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
  BuildRitualSessionCreate, BuildRitualSessionUpdate, BuildRitualScheduleItem,
  MindTag, MindTagCreate, MindTagUpdate,
  MindSession, MindSessionCreate, MindSessionUpdate,
  MindHipotese, MindChallenge, MindPadrao,
  BuildGuardrail, BuildGuardrailCreate, BuildGuardrailUpdate, BuildGuardrailEvaluation,
  HealthDomain, HealthDomainCreate, HealthDomainUpdate,
  HealthItem, HealthItemCreate, HealthItemUpdate,
  HealthRecord, HealthRecordCreate, HealthRecordUpdate,
  HealthSettings, HealthSettingsUpdate,
  HealthMetricMeta, HealthMetricValue,
  HealthPendingItem,
  WishlistCategoria, WishlistCategoriaCreate, WishlistCategoriaUpdate,
  WishlistItem, WishlistItemCreate, WishlistItemUpdate,
  WishlistLink, WishlistLinkCreate, WishlistLinkUpdate,
  WishlistReserva, WishlistReservaInput,
  WishlistStatus,
  WishlistComprarBody, WishlistDesistirBody, WishlistReabrirBody,
  WishlistVincularBody, WishlistReorderItem,
  WishlistSettings, WishlistSettingsUpdate,
  WishlistSummary, WishlistMonthReservas,
  WishlistTransactionCandidate, WishlistMatchGroup,
  WishlistReservaVincularBody, WishlistReservaMatchGroup,
  ProjectPageMeta, ProjectPage, ProjectPageDescendantsResponse,
  LangLanguage, LangCard, LangQueue, LangSettings, LangSettingsUpdate,
  LangToday, LangVoice, LangAiStatus, LangAsk, LangPiece, LangMetricsSummary,
  LangAnalysis, LangSource,
  BlackMirrorReflection,
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

export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, signal ? { signal } : undefined)
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
  // Limpa localStorage relacionado pra evitar lixo órfão. Hoje só temos
  // estado de Nested Pages por projeto; futuras chaves `hq-*-{projectId}`
  // entram aqui também. Try/catch porque storage pode estar bloqueado.
  try {
    localStorage.removeItem(`hq-page-state-${id}`)
    // Build/CollapsibleSection persiste por (goalId, section) — não precisa
    // limpar aqui (goal é entidade separada do projeto).
  } catch {}
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

export const editMindSession = (sessionId: number, body: { started_at?: string; ended_at?: string | null }) =>
  patchSession(`/api/mind-sessions/${sessionId}`, body)
export const deleteMindSessionRow = (sessionId: number) =>
  deleteSession(`/api/mind-sessions/${sessionId}`)

export const editHealthItemSession = (sessionId: number, body: { started_at?: string; ended_at?: string | null }) =>
  patchSession(`/api/health-item-sessions/${sessionId}`, body)
export const deleteHealthItemSessionRow = (sessionId: number) =>
  deleteSession(`/api/health-item-sessions/${sessionId}`)

// Range queries pro calendário — retornam rows de mind/health sessions
// (com started_at/ended_at) pra renderizar como blocos executados na
// timeline. Inclui rows fechadas E ativas (record_id NULL ou NOT NULL).
export interface MindSessionRangeRow {
  id: number
  session_num: number
  started_at: string
  ended_at: string | null
  record_id: number | null
}

export interface HealthItemSessionRangeRow {
  id: number
  item_id: number
  item_nome: string
  item_cor: string | null
  domain_slug: string | null
  session_num: number
  started_at: string
  ended_at: string | null
  record_id: number | null
}

export const fetchMindSessionsRange = (from: string, to: string) =>
  get<MindSessionRangeRow[]>(`/api/mind-sessions?from=${from}&to=${to}`)

export const fetchHealthItemSessionsRange = (from: string, to: string) =>
  get<HealthItemSessionRangeRow[]>(`/api/health-item-sessions?from=${from}&to=${to}`)

// Ritual cluster — cronometrado pra rituais executados pelo /Dia.
// Mesmo shape do DiaSessionCluster mas com record_id TEXT (id de
// build_ritual_session é uuid string, não int).
export interface RitualClusterRangeRow {
  id: number
  cadencia: string
  session_num: number
  started_at: string
  ended_at: string | null
  record_id: string | null
}

export const fetchRitualCluster = (cadencia: string) =>
  get<DiaSessionCluster>(`/api/build/rituals/${cadencia}/cluster`)

export const startRitualCluster = (cadencia: string) =>
  jsonFetch<DiaSessionCluster>(`/api/build/rituals/${cadencia}/cluster/start`, {
    method: 'POST',
  })

export const pauseRitualCluster = (cadencia: string) =>
  jsonFetch<DiaSessionCluster>(`/api/build/rituals/${cadencia}/cluster/pause`, {
    method: 'POST',
  })

export const resumeRitualCluster = (cadencia: string) =>
  jsonFetch<DiaSessionCluster>(`/api/build/rituals/${cadencia}/cluster/resume`, {
    method: 'POST',
  })

export const discardRitualCluster = (cadencia: string) =>
  jsonFetch<void>(`/api/build/rituals/${cadencia}/cluster/discard`, {
    method: 'POST',
  })

export const linkRitualClusterToRecord = (cadencia: string, recordId: string) =>
  jsonFetch<void>(`/api/build/rituals/${cadencia}/cluster/link-record`, {
    method: 'POST',
    body: JSON.stringify({ record_id: recordId }),
  })

export const reopenRitualCluster = (cadencia: string, data: string) =>
  jsonFetch<DiaSessionCluster>(
    `/api/build/rituals/${cadencia}/cluster/reopen?data=${encodeURIComponent(data)}`,
    { method: 'POST' },
  )

export const editRitualClusterSession = (
  sessionId: number,
  body: { started_at?: string; ended_at?: string | null },
) => patchSession(`/api/ritual-cluster-sessions/${sessionId}`, body)

export const deleteRitualClusterRow = (sessionId: number) =>
  deleteSession(`/api/ritual-cluster-sessions/${sessionId}`)

export const fetchRitualClusterRange = (from: string, to: string) =>
  get<RitualClusterRangeRow[]>(`/api/ritual-cluster-sessions?from=${from}&to=${to}`)

export interface ActiveSession {
  type: 'quest' | 'task' | 'routine' | 'library' | 'lang' | 'mind' | 'health_item' | 'ritual'
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
// ─── Compromissos (horas improdutivas) ────────────────────────────────────

export const fetchCompromissos = () => get<Compromisso[]>('/api/compromissos')

export const fetchCompromissoOccurrences = (from: string, to: string) =>
  get<CompromissoOccurrence[]>(`/api/compromissos/occurrences?from=${from}&to=${to}`)

export async function createCompromisso(body: CompromissoCreate): Promise<Compromisso> {
  const res = await fetch(`${BASE}/api/compromissos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function updateCompromisso(id: string, patch: CompromissoUpdate): Promise<Compromisso> {
  const res = await fetch(`${BASE}/api/compromissos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function deleteCompromisso(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/compromissos/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

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
  /** Vínculo opcional na criação: usado pelo flow "marcar bill como paga →
   *  criar novo lançamento" pra já registrar o FK sem PATCH extra. */
  recurring_bill_id?: string | null
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
    const err: any = new Error(detail)
    err.status = res.status
    // 409 em /api/.../session/* significa "outra atividade global rodando";
    // backend coloca o título do conflito em detail. Paridade com
    // sessionPostConflict (usado por task/routine).
    if (res.status === 409) err.conflictTitle = detail
    throw err
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

export const updateBuildRitualSession = (
  cadencia: BuildRitualCadencia,
  sessionId: string,
  patch: BuildRitualSessionUpdate,
) =>
  jsonFetch<BuildRitualSession>(
    `/api/build/rituals/${cadencia}/sessions/${sessionId}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )

export const deleteBuildRitualSession = (
  cadencia: BuildRitualCadencia,
  sessionId: string,
) =>
  jsonFetch<void>(
    `/api/build/rituals/${cadencia}/sessions/${sessionId}`,
    { method: 'DELETE' },
  )

export const fetchBuildRitualSchedule = (from: string, to: string) =>
  get<BuildRitualScheduleItem[]>(
    `/api/build/rituals/schedule?from=${from}&to=${to}`,
  )

// Guardrails (v2 — pontes Hub Health)
export const fetchGoalGuardrails = (goalId: string) =>
  get<BuildGuardrail[]>(`/api/build/goals/${goalId}/guardrails`)

export const evaluateGoalGuardrails = (goalId: string) =>
  get<BuildGuardrailEvaluation[]>(
    `/api/build/goals/${goalId}/guardrails/evaluate`,
  )

export const createGoalGuardrail = (
  goalId: string,
  body: BuildGuardrailCreate,
) =>
  jsonFetch<BuildGuardrail>(`/api/build/goals/${goalId}/guardrails`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateGoalGuardrail = (
  goalId: string,
  guardrailId: number,
  patch: BuildGuardrailUpdate,
) =>
  jsonFetch<BuildGuardrail>(
    `/api/build/goals/${goalId}/guardrails/${guardrailId}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )

export const deleteGoalGuardrail = (goalId: string, guardrailId: number) =>
  jsonFetch<void>(
    `/api/build/goals/${goalId}/guardrails/${guardrailId}`,
    { method: 'DELETE' },
  )

// ─── Hub Health ────────────────────────────────────────────────────────────
// Endpoints documentados em docs/hub-health/PLAN.md.
// Estrutura: Domínio → (Item) → Registro → Métrica.

// Domínios
export const fetchHealthDomains = (includeInactive = false) =>
  get<HealthDomain[]>(
    `/api/health/domains${includeInactive ? '?include_inactive=true' : ''}`,
  )

export const fetchHealthDomain = (slug: string) =>
  get<HealthDomain>(`/api/health/domains/${slug}`)

export const createHealthDomain = (body: HealthDomainCreate) =>
  jsonFetch<HealthDomain>('/api/health/domains', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateHealthDomain = (slug: string, patch: HealthDomainUpdate) =>
  jsonFetch<HealthDomain>(`/api/health/domains/${slug}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteHealthDomain = (slug: string) =>
  jsonFetch<void>(`/api/health/domains/${slug}`, { method: 'DELETE' })

// Itens
export const fetchHealthItems = (domainSlug: string, includeArchived = false) =>
  get<HealthItem[]>(
    `/api/health/domains/${domainSlug}/items${
      includeArchived ? '?include_archived=true' : ''
    }`,
  )

export const createHealthItem = (domainSlug: string, body: HealthItemCreate) =>
  jsonFetch<HealthItem>(`/api/health/domains/${domainSlug}/items`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateHealthItem = (id: number, patch: HealthItemUpdate) =>
  jsonFetch<HealthItem>(`/api/health/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const archiveHealthItem = (id: number) =>
  jsonFetch<HealthItem>(`/api/health/items/${id}/archive`, { method: 'POST' })

export const unarchiveHealthItem = (id: number) =>
  jsonFetch<HealthItem>(`/api/health/items/${id}/unarchive`, { method: 'POST' })

export const deleteHealthItem = (id: number) =>
  jsonFetch<void>(`/api/health/items/${id}`, { method: 'DELETE' })

// Registros
export interface HealthRecordsQuery {
  from?: string         // YYYY-MM-DD
  to?: string
  itemId?: number
  limit?: number
}

export const fetchHealthRecords = (
  domainSlug: string,
  query: HealthRecordsQuery = {},
) => {
  const params = new URLSearchParams()
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  if (query.itemId !== undefined) params.set('item_id', String(query.itemId))
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  const qs = params.toString()
  return get<HealthRecord[]>(
    `/api/health/domains/${domainSlug}/records${qs ? `?${qs}` : ''}`,
  )
}

export const createHealthRecord = (
  domainSlug: string,
  body: HealthRecordCreate,
) =>
  jsonFetch<HealthRecord>(`/api/health/domains/${domainSlug}/records`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateHealthRecord = (id: number, patch: HealthRecordUpdate) =>
  jsonFetch<HealthRecord>(`/api/health/records/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteHealthRecord = (id: number) =>
  jsonFetch<void>(`/api/health/records/${id}`, { method: 'DELETE' })

// Settings
export const fetchHealthSettings = () =>
  get<HealthSettings>('/api/health/settings')

export const updateHealthSettings = (patch: HealthSettingsUpdate) =>
  jsonFetch<HealthSettings>('/api/health/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

// Métricas
export const fetchHealthMetricsCatalog = () =>
  get<HealthMetricMeta[]>('/api/health/metrics')

export const fetchHealthMetricValue = (slug: string, itemId?: number) => {
  const qs = itemId !== undefined ? `?item_id=${itemId}` : ''
  return get<HealthMetricValue>(`/api/health/metrics/${slug}${qs}`)
}

// Pendências (lembretes + ausência)
export const fetchHealthPending = () =>
  get<HealthPendingItem[]>('/api/health/pending')

// ─── Mind — Observação Estruturada ────────────────────────────────────────
export const fetchMindTags = (includeArchived = false) =>
  get<MindTag[]>(
    `/api/health/mind/tags${includeArchived ? '?include_archived=true' : ''}`,
  )

export const createMindTag = (body: MindTagCreate) =>
  jsonFetch<MindTag>('/api/health/mind/tags', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateMindTag = (id: number, patch: MindTagUpdate) =>
  jsonFetch<MindTag>(`/api/health/mind/tags/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteMindTag = (id: number) =>
  jsonFetch<void>(`/api/health/mind/tags/${id}`, { method: 'DELETE' })

export const fetchMindSessions = (params?: {
  from?: string
  to?: string
  tag_slug?: string
  limit?: number
}) => {
  const qs: string[] = []
  if (params?.from) qs.push(`from=${params.from}`)
  if (params?.to) qs.push(`to=${params.to}`)
  if (params?.tag_slug) qs.push(`tag_slug=${params.tag_slug}`)
  if (params?.limit) qs.push(`limit=${params.limit}`)
  const q = qs.length ? `?${qs.join('&')}` : ''
  return get<MindSession[]>(`/api/health/mind/sessions${q}`)
}

export const createMindSession = (body: MindSessionCreate) =>
  jsonFetch<MindSession>('/api/health/mind/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateMindSession = (id: number, patch: MindSessionUpdate) =>
  jsonFetch<MindSession>(`/api/health/mind/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteMindSession = (id: number) =>
  jsonFetch<void>(`/api/health/mind/sessions/${id}`, { method: 'DELETE' })

export const fetchMindHipoteses = (status?: 'pending' | 'validated' | 'refuted' | 'suspended') =>
  get<MindHipotese[]>(
    `/api/health/mind/hipoteses${status ? `?status=${status}` : ''}`,
  )

export const updateMindHipotese = (id: number, status: MindHipotese['status']) =>
  jsonFetch<MindHipotese>(`/api/health/mind/hipoteses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })

export const fetchMindChallenges = () =>
  get<MindChallenge[]>('/api/health/mind/challenges')

export const fetchMindPadroes = (dias = 30) =>
  get<MindPadrao[]>(`/api/health/mind/padroes?dias=${dias}`)

// Admin — migração one-shot de registros legacy de alimentação pra formato agrupado
export interface HealthMigrateRefeicaoSummary {
  domains_processed: number
  days_migrated: number
  records_consolidated: number
  records_deleted: number
}
export const migrateRefeicao2modos = () =>
  jsonFetch<HealthMigrateRefeicaoSummary>(
    '/api/health/admin/migrate-refeicao-2modos',
    { method: 'POST' },
  )

// ─── Wishlist (submódulo do Hub Finance) ───────────────────────────────────
// Doc completo em docs/hub-finance/wishlist-PLAN.md.

// Categorias
export const fetchWishlistCategorias = () =>
  get<WishlistCategoria[]>('/api/finance/wishlist/categorias')

export async function createWishlistCategoria(body: WishlistCategoriaCreate): Promise<WishlistCategoria> {
  return jsonOrThrow<WishlistCategoria>(await fetch(`${BASE}/api/finance/wishlist/categorias`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function updateWishlistCategoria(
  id: string,
  patch: WishlistCategoriaUpdate,
): Promise<WishlistCategoria> {
  return jsonOrThrow<WishlistCategoria>(await fetch(`${BASE}/api/finance/wishlist/categorias/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
}

export async function deleteWishlistCategoria(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/wishlist/categorias/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

// Items
export const fetchWishlistItems = (params?: {
  status?: WishlistStatus
  categoriaId?: string
  includeDone?: boolean
}) => {
  const q = new URLSearchParams()
  if (params?.status) q.set('status', params.status)
  if (params?.categoriaId) q.set('categoria_id', params.categoriaId)
  if (params?.includeDone) q.set('include_done', 'true')
  const qs = q.toString()
  return get<WishlistItem[]>(`/api/finance/wishlist/items${qs ? `?${qs}` : ''}`)
}

export const fetchWishlistItem = (id: string) =>
  get<WishlistItem>(`/api/finance/wishlist/items/${id}`)

export async function createWishlistItem(body: WishlistItemCreate): Promise<WishlistItem> {
  return jsonOrThrow<WishlistItem>(await fetch(`${BASE}/api/finance/wishlist/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function updateWishlistItem(id: string, patch: WishlistItemUpdate): Promise<WishlistItem> {
  return jsonOrThrow<WishlistItem>(await fetch(`${BASE}/api/finance/wishlist/items/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
}

export async function deleteWishlistItem(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/wishlist/items/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

export async function reorderWishlistItems(payload: WishlistReorderItem[]): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/wishlist/items/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

// Ações de fluxo
export async function comprarWishlistItem(id: string, body: WishlistComprarBody): Promise<WishlistItem> {
  return jsonOrThrow<WishlistItem>(await fetch(`${BASE}/api/finance/wishlist/items/${id}/comprar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function desistirWishlistItem(id: string, body: WishlistDesistirBody = {}): Promise<WishlistItem> {
  return jsonOrThrow<WishlistItem>(await fetch(`${BASE}/api/finance/wishlist/items/${id}/desistir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function reabrirWishlistItem(id: string, body: WishlistReabrirBody = {}): Promise<WishlistItem> {
  return jsonOrThrow<WishlistItem>(await fetch(`${BASE}/api/finance/wishlist/items/${id}/reabrir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function vincularWishlistTransacao(id: string, body: WishlistVincularBody): Promise<WishlistItem> {
  return jsonOrThrow<WishlistItem>(await fetch(`${BASE}/api/finance/wishlist/items/${id}/transacao`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export const fetchWishlistAguardandoVinculo = () =>
  get<WishlistItem[]>('/api/finance/wishlist/items/aguardando-vinculo')

// Links
export async function createWishlistLink(itemId: string, body: WishlistLinkCreate): Promise<WishlistLink> {
  return jsonOrThrow<WishlistLink>(await fetch(`${BASE}/api/finance/wishlist/items/${itemId}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function updateWishlistLink(linkId: string, patch: WishlistLinkUpdate): Promise<WishlistLink> {
  return jsonOrThrow<WishlistLink>(await fetch(`${BASE}/api/finance/wishlist/links/${linkId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
}

export async function deleteWishlistLink(linkId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/finance/wishlist/links/${linkId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

// Reservas (cronograma)
export const fetchWishlistReservas = (itemId: string) =>
  get<WishlistReserva[]>(`/api/finance/wishlist/items/${itemId}/reservas`)

export async function replaceWishlistReservas(
  itemId: string,
  cronograma: WishlistReservaInput[],
): Promise<WishlistItem> {
  return jsonOrThrow<WishlistItem>(await fetch(`${BASE}/api/finance/wishlist/items/${itemId}/reservas`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cronograma),
  }))
}

export async function deleteWishlistReserva(itemId: string, ano: number, mes: number): Promise<void> {
  const res = await fetch(
    `${BASE}/api/finance/wishlist/items/${itemId}/reservas/${ano}/${mes}`,
    { method: 'DELETE' },
  )
  if (!res.ok) throw new Error(`API error ${res.status}`)
}

// Agregados
export const fetchWishlistSummary = () =>
  get<WishlistSummary>('/api/finance/wishlist/summary')

export const fetchWishlistReservasMes = (year: number, month: number) =>
  get<WishlistMonthReservas>(`/api/finance/wishlist/reservas/mes?year=${year}&month=${month}`)

// Settings
export const fetchWishlistSettings = () =>
  get<WishlistSettings>('/api/finance/wishlist/settings')

export async function updateWishlistSettings(patch: WishlistSettingsUpdate): Promise<WishlistSettings> {
  return jsonOrThrow<WishlistSettings>(await fetch(`${BASE}/api/finance/wishlist/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
}

// Match transação ↔ item (Fase 3)
export const fetchWishlistMatchCandidates = (params: {
  valor: number
  data: string
  diasJanela?: number
  limit?: number
}) => {
  const q = new URLSearchParams()
  q.set('valor', String(params.valor))
  q.set('data', params.data)
  if (params.diasJanela !== undefined) q.set('dias_janela', String(params.diasJanela))
  if (params.limit !== undefined) q.set('limit', String(params.limit))
  return get<WishlistTransactionCandidate[]>(
    `/api/finance/wishlist/match-candidates?${q.toString()}`,
  )
}

export const fetchWishlistMatchSuggestions = (params?: {
  diasJanela?: number
  limitPerItem?: number
}) => {
  const q = new URLSearchParams()
  if (params?.diasJanela !== undefined) q.set('dias_janela', String(params.diasJanela))
  if (params?.limitPerItem !== undefined) q.set('limit_per_item', String(params.limitPerItem))
  const qs = q.toString()
  return get<WishlistMatchGroup[]>(
    `/api/finance/wishlist/match-suggestions${qs ? `?${qs}` : ''}`,
  )
}

// Fase 5 — vínculo reserva ↔ transação
export const fetchReservaMatchCandidates = (params: {
  reservaId: string
  diasJanela?: number
  limit?: number
}) => {
  const q = new URLSearchParams()
  if (params.diasJanela !== undefined) q.set('dias_janela', String(params.diasJanela))
  if (params.limit !== undefined) q.set('limit', String(params.limit))
  const qs = q.toString()
  return get<WishlistTransactionCandidate[]>(
    `/api/finance/wishlist/reservas/${params.reservaId}/match-candidates${qs ? `?${qs}` : ''}`,
  )
}

export async function vincularReservaTransacao(
  reservaId: string,
  body: WishlistReservaVincularBody,
): Promise<unknown> {
  return jsonOrThrow(await fetch(
    `${BASE}/api/finance/wishlist/reservas/${reservaId}/transacao`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  ))
}

export const fetchWishlistMatchSuggestionsReservas = (params?: {
  diasJanela?: number
  limitPerReserva?: number
}) => {
  const q = new URLSearchParams()
  if (params?.diasJanela !== undefined) q.set('dias_janela', String(params.diasJanela))
  if (params?.limitPerReserva !== undefined) q.set('limit_per_reserva', String(params.limitPerReserva))
  const qs = q.toString()
  return get<WishlistReservaMatchGroup[]>(
    `/api/finance/wishlist/match-suggestions-reservas${qs ? `?${qs}` : ''}`,
  )
}

// ─── Nested Pages (caderno virtual estilo Notion dentro de Projetos) ─────
// Doc: docs/nested-pages/PLAN.md
//
// API:
//   fetchProjectPages    → lista flat (sem content) pra hidratar blocos `page`
//   fetchPage            → page completa com content_json
//   createPage           → cria page (default title "Sem título")
//   updatePage           → patch parcial (title, content_json, sort, parent)
//   deletePage           → hard delete recursivo (CASCADE no SQLite)
//   fetchPageDescendants → preview pro modal de delete

export const fetchProjectPages = (projectId: string) =>
  get<ProjectPageMeta[]>(`/api/projects/${projectId}/pages`)

export async function fetchPage(pageId: string, signal?: AbortSignal): Promise<ProjectPage> {
  const res = await fetch(`${BASE}/api/pages/${pageId}`, { signal })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function createPage(
  projectId: string,
  body: { parent_page_id?: string | null; title?: string } = {},
): Promise<ProjectPage> {
  return jsonOrThrow<ProjectPage>(await fetch(
    `${BASE}/api/projects/${projectId}/pages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  ))
}

export async function updatePage(
  pageId: string,
  patch: {
    title?: string
    content_json?: string | null
    sort_order?: number
    parent_page_id?: string | null
  },
): Promise<ProjectPage> {
  return jsonOrThrow<ProjectPage>(await fetch(`${BASE}/api/pages/${pageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
}

export async function deletePage(
  pageId: string,
): Promise<{ deleted_count: number; deleted_ids: string[] }> {
  return jsonOrThrow<{ deleted_count: number; deleted_ids: string[] }>(await fetch(
    `${BASE}/api/pages/${pageId}`,
    { method: 'DELETE' },
  ))
}

export async function fetchPageDescendants(
  pageId: string,
  signal?: AbortSignal,
): Promise<ProjectPageDescendantsResponse> {
  const res = await fetch(`${BASE}/api/pages/${pageId}/descendants-count`, { signal })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

// ─── Library ───────────────────────────────────────────────────────────────
// Endpoints documentados em docs/library/PLAN.md §4.

import type {
  LibraryItem,
  LibraryItemCreate,
  LibraryItemListEntry,
  LibraryItemUpdate,
  LibraryLink,
  LibraryLinkCreate,
  LibraryPending,
  LibrarySession,
  LibraryTag,
  LibraryTagCreate,
  LibraryTagUpdate,
  LibraryTema,
} from './types'

// Tags
export const fetchLibraryTags = (includeArchived = false) =>
  get<LibraryTag[]>(
    `/api/library/tags${includeArchived ? '?include_archived=true' : ''}`,
  )

export const createLibraryTag = (body: LibraryTagCreate) =>
  jsonFetch<LibraryTag>('/api/library/tags', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateLibraryTag = (id: number, patch: LibraryTagUpdate) =>
  jsonFetch<LibraryTag>(`/api/library/tags/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteLibraryTag = (id: number) =>
  jsonFetch<void>(`/api/library/tags/${id}`, { method: 'DELETE' })

// Items
export interface LibraryItemsQuery {
  status?: string
  tipo?: string
  tag_slug?: string
  q?: string
  limit?: number
  offset?: number
}

export const fetchLibraryItems = (params?: LibraryItemsQuery) => {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.tipo) qs.set('tipo', params.tipo)
  if (params?.tag_slug) qs.set('tag_slug', params.tag_slug)
  if (params?.q) qs.set('q', params.q)
  if (params?.limit !== undefined) qs.set('limit', String(params.limit))
  if (params?.offset !== undefined) qs.set('offset', String(params.offset))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return get<LibraryItemListEntry[]>(`/api/library/items${suffix}`)
}

export const fetchLibraryItem = (id: number) =>
  get<LibraryItem>(`/api/library/items/${id}`)

export const createLibraryItem = (body: LibraryItemCreate) =>
  jsonFetch<LibraryItem>('/api/library/items', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateLibraryItem = (id: number, patch: LibraryItemUpdate) =>
  jsonFetch<LibraryItem>(`/api/library/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteLibraryItem = (id: number) =>
  jsonFetch<void>(`/api/library/items/${id}`, { method: 'DELETE' })

// Sessions
export const fetchLibrarySessions = (itemId: number) =>
  get<LibrarySession[]>(`/api/library/items/${itemId}/sessions`)

export const startLibrarySession = (itemId: number) =>
  jsonFetch<LibrarySession>(`/api/library/items/${itemId}/sessions/start`, {
    method: 'POST',
  })

export const pauseLibrarySession = (itemId: number) =>
  jsonFetch<LibrarySession>(`/api/library/items/${itemId}/sessions/pause`, {
    method: 'POST',
  })

export const resumeLibrarySession = (itemId: number) =>
  jsonFetch<LibrarySession>(`/api/library/items/${itemId}/sessions/resume`, {
    method: 'POST',
  })

export const stopLibrarySession = (itemId: number) =>
  jsonFetch<LibrarySession>(`/api/library/items/${itemId}/sessions/stop`, {
    method: 'POST',
  })

// Cross-links
export const createLibraryLink = (itemId: number, body: LibraryLinkCreate) =>
  jsonFetch<LibraryLink>(`/api/library/items/${itemId}/links`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const deleteLibraryLink = (linkId: number) =>
  jsonFetch<void>(`/api/library/links/${linkId}`, { method: 'DELETE' })

// Painéis agregados
export const fetchLibraryPending = (janelaDias = 7) =>
  get<LibraryPending[]>(`/api/library/pending?janela_dias=${janelaDias}`)

export const fetchLibraryTemas = () =>
  get<LibraryTema[]>('/api/library/temas')

export const fetchLibraryBacklinks = (target_type: string, target_id: string) =>
  get<import('./types').LibraryBacklink[]>(
    `/api/library/backlinks?target_type=${encodeURIComponent(target_type)}&target_id=${encodeURIComponent(target_id)}`,
  )

// Sagas — agrupamento visual de items (sem mecânica de status/sessões)
export const fetchLibrarySagas = () =>
  get<import('./types').LibrarySaga[]>('/api/library/sagas')

export const createLibrarySaga = (
  body: import('./types').LibrarySagaCreate,
) =>
  jsonFetch<import('./types').LibrarySaga>('/api/library/sagas', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateLibrarySaga = (
  id: number,
  patch: import('./types').LibrarySagaUpdate,
) =>
  jsonFetch<import('./types').LibrarySaga>(`/api/library/sagas/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteLibrarySaga = (id: number) =>
  jsonFetch<void>(`/api/library/sagas/${id}`, { method: 'DELETE' })

export const reorderSagaItems = (sagaId: number, itemIds: number[]) =>
  jsonFetch<LibraryItemListEntry[]>(
    `/api/library/sagas/${sagaId}/reorder`,
    {
      method: 'POST',
      body: JSON.stringify({ item_ids: itemIds }),
    },
  )

// /Dia — pendências agregadas
export const fetchDiaPendencias = (data: string) =>
  get<import('./types').DiaPendencia[]>(
    `/api/dia/pendencias?data=${encodeURIComponent(data)}`,
  )

export const fetchDiaDoneToday = (data: string) =>
  get<{ done: string[] }>(
    `/api/dia/pendencias/done-today?data=${encodeURIComponent(data)}`,
  )

// Reabre pendência: dispatcher pra mind/health_item conforme pendencia_id.
// "mind" → reopenMindSession. "health_item:N" → reopenHealthItemSession(N).
// Definição efetiva mais abaixo (depois de reopenMindSession/HealthItemSession
// ficarem declaradas) — o dispatcher só dispara no momento da chamada, então
// hoisting de const não bloqueia.
export const reopenDiaPendencia = (pendenciaId: string, data: string) => {
  if (pendenciaId === 'mind') return reopenMindSession(data)
  if (pendenciaId.startsWith('health_item:')) {
    const itemId = parseInt(pendenciaId.slice('health_item:'.length), 10)
    return reopenHealthItemSession(itemId, data)
  }
  throw new Error(`reopenDiaPendencia: pendencia_id inválido "${pendenciaId}"`)
}

// ─── Sessões cronometradas Mind + health_item ───────────────────────────
// Comportamento idêntico a quest_sessions: play/pause/resume cria/fecha
// rows. record_id IS NULL define o "cluster ativo" (não finalizado).
// Finalize = pause + abrir modal pré-preenchido → save linka rows ao
// health_record criado.

export interface DiaSessionRow {
  id: number
  session_num: number
  started_at: string
  ended_at: string | null
  record_id: number | null
}

export interface DiaSessionCluster {
  has_active: boolean
  is_running: boolean
  started_at: string | null
  ended_at: string | null
  elapsed_seconds: number
  rows: DiaSessionRow[]
}

// Mind session
export const fetchMindSession = () =>
  get<DiaSessionCluster>('/api/mind/session')

export const startMindSession = () =>
  jsonFetch<DiaSessionCluster>('/api/mind/session/start', { method: 'POST' })

export const pauseMindSession = () =>
  jsonFetch<DiaSessionCluster>('/api/mind/session/pause', { method: 'POST' })

export const resumeMindSession = () =>
  jsonFetch<DiaSessionCluster>('/api/mind/session/resume', { method: 'POST' })

export const discardMindSession = () =>
  jsonFetch<void>('/api/mind/session/discard', { method: 'POST' })

export const linkMindSessionToRecord = (recordId: number) =>
  jsonFetch<void>('/api/mind/session/link-record', {
    method: 'POST',
    body: JSON.stringify({ record_id: recordId }),
  })

export const reopenMindSession = (data: string) =>
  jsonFetch<DiaSessionCluster>(
    `/api/mind/session/reopen?data=${encodeURIComponent(data)}`,
    { method: 'POST' },
  )

// Health item session
export const fetchHealthItemSession = (itemId: number) =>
  get<DiaSessionCluster>(`/api/health/items/${itemId}/session`)

export const startHealthItemSession = (itemId: number) =>
  jsonFetch<DiaSessionCluster>(`/api/health/items/${itemId}/session/start`, {
    method: 'POST',
  })

export const pauseHealthItemSession = (itemId: number) =>
  jsonFetch<DiaSessionCluster>(`/api/health/items/${itemId}/session/pause`, {
    method: 'POST',
  })

export const resumeHealthItemSession = (itemId: number) =>
  jsonFetch<DiaSessionCluster>(`/api/health/items/${itemId}/session/resume`, {
    method: 'POST',
  })

export const discardHealthItemSession = (itemId: number) =>
  jsonFetch<void>(`/api/health/items/${itemId}/session/discard`, {
    method: 'POST',
  })

export const linkHealthItemSessionToRecord = (itemId: number, recordId: number) =>
  jsonFetch<void>(`/api/health/items/${itemId}/session/link-record`, {
    method: 'POST',
    body: JSON.stringify({ record_id: recordId }),
  })

export const reopenHealthItemSession = (itemId: number, data: string) =>
  jsonFetch<DiaSessionCluster>(
    `/api/health/items/${itemId}/session/reopen?data=${encodeURIComponent(data)}`,
    { method: 'POST' },
  )

// ─── Lang Lab (/api/lang/*) — docs/lang-lab/PLAN.md ─────────────────────

export const fetchLangLanguages = () =>
  get<LangLanguage[]>('/api/lang/languages')

export const updateLangLanguage = (id: number, patch: { nome?: string; tts_voice?: string; ativo?: boolean }) =>
  jsonFetch<LangLanguage>(`/api/lang/languages/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const fetchLangSettings = () =>
  get<LangSettings>('/api/lang/settings')

export const updateLangSettings = (patch: LangSettingsUpdate) =>
  jsonFetch<LangSettings>('/api/lang/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const fetchLangToday = () =>
  get<LangToday>('/api/lang/today')

export const fetchLangCards = (params?: { q?: string; suspenso?: boolean; limit?: number }) => {
  const qs: string[] = []
  if (params?.q) qs.push(`q=${encodeURIComponent(params.q)}`)
  if (params?.suspenso !== undefined) qs.push(`suspenso=${params.suspenso}`)
  if (params?.limit) qs.push(`limit=${params.limit}`)
  return get<LangCard[]>(`/api/lang/cards${qs.length ? `?${qs.join('&')}` : ''}`)
}

export const createLangCard = (body: {
  frente: string
  verso?: string | null
  notas?: string | null
  direction?: 'recognition' | 'production'
}) =>
  jsonFetch<LangCard>('/api/lang/cards', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateLangCard = (
  id: number,
  patch: { frente?: string; verso?: string | null; notas?: string | null; suspenso?: boolean },
) =>
  jsonFetch<LangCard>(`/api/lang/cards/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteLangCard = (id: number) =>
  jsonFetch<void>(`/api/lang/cards/${id}`, { method: 'DELETE' })

export const fetchLangQueue = () =>
  get<LangQueue>('/api/lang/review/queue')

export const reviewLangCard = (cardId: number, rating: 1 | 2 | 3 | 4) =>
  jsonFetch<LangCard>(`/api/lang/cards/${cardId}/review`, {
    method: 'POST',
    body: JSON.stringify({ rating }),
  })

export const undoLangReview = () =>
  jsonFetch<{ card: LangCard; undone_review_id: number }>('/api/lang/review/undo', {
    method: 'POST',
  })

export const fetchLangVoices = (locale?: string) =>
  get<LangVoice[]>(`/api/lang/tts/voices${locale ? `?locale=${encodeURIComponent(locale)}` : ''}`)

// Sessão de estudo — cluster nível módulo (padrão Mind, flag finalizada).
export const fetchLangSession = () =>
  get<DiaSessionCluster>('/api/lang/session')

export const startLangSession = () =>
  jsonFetch<DiaSessionCluster>('/api/lang/session/start', { method: 'POST' })

export const pauseLangSession = () =>
  jsonFetch<DiaSessionCluster>('/api/lang/session/pause', { method: 'POST' })

export const resumeLangSession = () =>
  jsonFetch<DiaSessionCluster>('/api/lang/session/resume', { method: 'POST' })

export const stopLangSession = () =>
  jsonFetch<DiaSessionCluster>('/api/lang/session/stop', { method: 'POST' })

export const editLangSession = (sessionId: number, body: { started_at?: string; ended_at?: string | null }) =>
  patchSession(`/api/lang/sessions/${sessionId}`, body)

export const deleteLangSessionRow = (sessionId: number) =>
  deleteSession(`/api/lang/sessions/${sessionId}`)

// IA tutora — ask (dúvida com porquê) / pieces (produção escrita +
// feedback estruturado) / assist (destravar DURANTE a escrita).
export const fetchLangAiStatus = () =>
  get<LangAiStatus>('/api/lang/ai/status')

export const askLangAi = (pergunta: string, contexto?: string) =>
  jsonFetch<LangAsk>('/api/lang/ask', {
    method: 'POST',
    body: JSON.stringify({ pergunta, contexto: contexto ?? null }),
  })

export const fetchLangAsks = (limit = 20) =>
  get<LangAsk[]>(`/api/lang/asks?limit=${limit}`)

export const createLangPiece = (texto: string, prompt?: string) =>
  jsonFetch<LangPiece>('/api/lang/pieces', {
    method: 'POST',
    body: JSON.stringify({ texto, prompt: prompt ?? null }),
  })

export const fetchLangPieces = (limit = 20) =>
  get<LangPiece[]>(`/api/lang/pieces?limit=${limit}`)

export const updateLangPiece = (id: number, patch: { texto?: string; prompt?: string }) =>
  jsonFetch<LangPiece>(`/api/lang/pieces/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteLangPiece = (id: number) =>
  jsonFetch<void>(`/api/lang/pieces/${id}`, { method: 'DELETE' })

export const requestLangPieceFeedback = (id: number) =>
  jsonFetch<LangPiece>(`/api/lang/pieces/${id}/feedback`, { method: 'POST' })

export const langComposeAssist = (rascunho: string, intencao?: string) =>
  jsonFetch<{ sugestoes: string }>('/api/lang/compose/assist', {
    method: 'POST',
    body: JSON.stringify({ rascunho, intencao: intencao ?? null }),
  })

export const fetchLangMetricsSummary = () =>
  get<LangMetricsSummary>('/api/lang/metrics/summary')

// Análise diária comparativa — sob demanda, UPSERT por (língua, dia).
export const analyzeLangToday = () =>
  jsonFetch<LangAnalysis>('/api/lang/analysis/today', { method: 'POST' })

export const fetchLangAnalyses = (limit = 10) =>
  get<LangAnalysis[]>(`/api/lang/analyses?limit=${limit}`)

// Fontes — corpus de mineração (método Vergara).
export const fetchLangSources = () =>
  get<LangSource[]>('/api/lang/sources')

export const createLangSource = (body: {
  titulo: string
  tipo?: LangSource['tipo']
  origem?: string | null
  texto?: string | null
}) =>
  jsonFetch<LangSource>('/api/lang/sources', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateLangSource = (id: number, patch: {
  titulo?: string
  tipo?: LangSource['tipo']
  origem?: string | null
  texto?: string | null
}) =>
  jsonFetch<LangSource>(`/api/lang/sources/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteLangSource = (id: number) =>
  jsonFetch<void>(`/api/lang/sources/${id}`, { method: 'DELETE' })

export const uploadLangSourceAudio = async (id: number, file: File): Promise<LangSource> => {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/api/lang/sources/${id}/audio`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export const mineLangSource = (id: number, lines: string[], direction: 'recognition' | 'production' = 'recognition') =>
  jsonFetch<{ criados: number; duplicados: number; card_ids: number[] }>(
    `/api/lang/sources/${id}/mine`,
    { method: 'POST', body: JSON.stringify({ lines, direction }) },
  )

// Range pro Calendário — sessões executadas viram blocos na timeline
// (mesmo padrão de fetchMindSessionsRange).
export interface LangSessionRangeRow {
  id: number
  session_num: number
  started_at: string
  ended_at: string | null
}

export const fetchLangSessionsRange = (from: string, to: string) =>
  get<LangSessionRangeRow[]>(`/api/lang-sessions?from=${from}&to=${to}`)

// ─── Requisições (lista de compras pessoal) ────────────────────────────────
import type {
  RequisicaoComprarBody,
  RequisicaoItem,
  RequisicaoItemCreate,
  RequisicaoItemUpdate,
  RequisicaoPurchase,
  RequisicaoReorderItem,
} from './types'

export const fetchRequisicaoItens = (categoria?: string) =>
  get<RequisicaoItem[]>(
    categoria
      ? `/api/requisicoes/itens?categoria=${encodeURIComponent(categoria)}`
      : '/api/requisicoes/itens',
  )

export const fetchRequisicaoCompras = (mes?: string) =>
  get<RequisicaoPurchase[]>(mes ? `/api/requisicoes/compras?mes=${mes}` : '/api/requisicoes/compras')

export const fetchRequisicaoCategorias = () => get<string[]>('/api/requisicoes/categorias')

export const createRequisicaoItem = (body: RequisicaoItemCreate) =>
  jsonFetch<RequisicaoItem>('/api/requisicoes/itens', { method: 'POST', body: JSON.stringify(body) })

export const updateRequisicaoItem = (id: number, patch: RequisicaoItemUpdate) =>
  jsonFetch<RequisicaoItem>(`/api/requisicoes/itens/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })

export const deleteRequisicaoItem = (id: number) =>
  jsonFetch<void>(`/api/requisicoes/itens/${id}`, { method: 'DELETE' })

export const comprarRequisicao = (id: number, body: RequisicaoComprarBody) =>
  jsonFetch<RequisicaoItem>(`/api/requisicoes/itens/${id}/comprar`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const desfazerCompraRequisicao = (purchaseId: number) =>
  jsonFetch<RequisicaoItem>(`/api/requisicoes/compras/${purchaseId}`, { method: 'DELETE' })

export const reorderRequisicaoItens = (payload: RequisicaoReorderItem[]) =>
  jsonFetch<void>('/api/requisicoes/itens/reorder', { method: 'POST', body: JSON.stringify(payload) })

// ─── Black Mirror — espelho de dados ───────────────────────────────────────

/** Leitura de hoje (generated:false se ainda não gerada — GET nunca chama IA). */
export const fetchBlackMirrorToday = () =>
  get<BlackMirrorReflection>('/api/black-mirror/today')

/** (Re)gera a leitura de hoje via IA. UPSERT preserva o `meu_passo`. */
export const generateBlackMirror = () =>
  jsonFetch<BlackMirrorReflection>('/api/black-mirror/generate', { method: 'POST' })

/** Salva o if-then do usuário (a IA não preenche). */
export const saveBlackMirrorPasso = (meu_passo: string | null) =>
  jsonFetch<BlackMirrorReflection>('/api/black-mirror/today/meu-passo', {
    method: 'PATCH',
    body: JSON.stringify({ meu_passo }),
  })

/** Reflexões passadas (mais recentes primeiro). */
export const fetchBlackMirrorHistory = (limit = 30) =>
  get<BlackMirrorReflection[]>(`/api/black-mirror/history?limit=${limit}`)
