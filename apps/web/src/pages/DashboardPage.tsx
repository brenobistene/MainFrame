import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Info } from 'lucide-react'
import type { Area, Deliverable, Project, Profile, Quest, Routine, Task } from '../types'
import { fetchAllRoutines, fetchDeliverables, fetchTasks, reportApiError } from '../api'
import { getAllBlockRangesForDay } from '../utils/blocks'
import type { UnproductiveBlock } from '../utils/blocks'
import { ProfileEditModal } from '../components/ProfileEditModal'
import { AnimatedNumber, SkeletonBlock } from '../components/ui/Motion'
import { RitualNextCard } from '../components/RitualNextCard'
import HealthDashboardCard from '../components/health/HealthDashboardCard'
import LibraryDashboardCard from '../components/library/LibraryDashboardCard'
import MindDashboardCard from '../components/mind/MindDashboardCard'
import BuildDashboardCard from '../components/build/BuildDashboardCard'

// ─── Tipos e constantes ────────────────────────────────────────────────────

// Janela do dashboard = intervalo explícito [start, end] (YYYY-MM-DD).
// Antes era "N dias a partir de hoje"; agora é qualquer intervalo.
const WINDOW_STORAGE_KEY = 'hq-dashboard-range'

type Pressure = 'overdue' | 'impossible' | 'tight' | 'ok' | 'done' | 'no-deadline'

type ProjectPressure = {
  project: Project
  deliverables: Deliverable[]
  effectiveDeadline: string | null
  // Dias corridos até a deadline. -N=atrasado, 0=hoje, 1=amanhã, N=em N dias.
  daysAway: number | null
  remainingMin: number
  estimatedMin: number
  workedMin: number
  /** Total trabalhado em TODAS as quests linkadas ao projeto (via project_id
   *  direto OU via qualquer entregável, incluindo entregáveis já concluídos
   *  e quests "soltas" sem deliverable_id). EXEC mostrado no card. */
  totalWorkedMin: number
  /** Total estimado em TODAS as quests linkadas. Usado pro % do card. */
  totalEstimatedMin: number
  status: Pressure
}

type UpcomingItem = {
  date: string
  type: 'projeto' | 'entregável'
  title: string
  context?: string
  color: string
  isOverdue: boolean
  done: boolean
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function localYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function parseYmd(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
function fmtYmdShort(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(-2)}`
}
function windowRangeLabel(range: { start: string; end: string }, todayIso: string): string {
  if (range.start === range.end) {
    if (range.start === todayIso) return 'Hoje'
    return `Dia ${fmtYmdShort(range.start)}`
  }
  if (range.start === todayIso) {
    const start = new Date(range.start + 'T00:00:00')
    const end = new Date(range.end + 'T00:00:00')
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
    return `Próximos ${days} dias`
  }
  return `${fmtYmdShort(range.start)} – ${fmtYmdShort(range.end)}`
}
function calendarDaysUntil(deadlineIso: string): number {
  const today = startOfToday()
  const deadline = parseYmd(deadlineIso)
  return Math.round((deadline.getTime() - today.getTime()) / 86400000)
}
function fmtHM(min: number): string {
  const abs = Math.max(0, Math.round(min))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}
function routineAppliesOnDay(r: Routine, date: Date): boolean {
  const jsDow = date.getDay()
  const pyDow = (jsDow + 6) % 7
  if (r.recurrence === 'daily') return true
  if (r.recurrence === 'weekdays') return jsDow >= 1 && jsDow <= 5
  if (r.recurrence === 'weekly') {
    if (r.days_of_week) {
      const days = r.days_of_week.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
      if (days.includes(pyDow)) return true
    } else if (r.day_of_week !== null && r.day_of_week !== undefined) {
      if (r.day_of_week === pyDow) return true
    }
  }
  if (r.recurrence === 'monthly' && r.day_of_month === date.getDate()) return true
  return false
}
function routineMinutesOnDay(r: Routine): number {
  if (r.estimated_minutes) return r.estimated_minutes
  if (r.start_time && r.end_time) {
    const [sh, sm] = r.start_time.split(':').map(Number)
    const [eh, em] = r.end_time.split(':').map(Number)
    const mins = (eh * 60 + em) - (sh * 60 + sm)
    return mins > 0 ? mins : 0
  }
  return 0
}

// ─── Dashboard ─────────────────────────────────────────────────────────────

/**
 * `/dashboard` — painel de pressão, enxuto. Uma resposta clara no topo
 * ("dá tempo ou não") + lista dos projetos que exigem atenção + próximas
 * deadlines. Sem barras de progresso, sem métricas redundantes.
 *
 * Janela default = 14d, persistida em `hq-dashboard-window`.
 */
export function DashboardView({ projects, quests, areas, profile, onProfileUpdate, onSelectProject }: {
  projects: Project[]
  quests: Quest[]
  areas: Area[]
  profile: Profile
  onProfileUpdate: (p: Profile) => void
  onSelectProject: (id: string | null) => void
}) {
  const navigate = useNavigate()
  // Intervalo explícito [start, end]. Default = hoje + 29 dias (janela de 30d).
  // Se o início salvo no localStorage é anterior a hoje, volta ao default —
  // ranges relativos ("próximos 30d") salvos como datas absolutas ficam stale
  // e escondem deadlines futuras. Ignora o que estava salvo nesse caso.
  const [windowRange, setWindowRange] = useState<{ start: string; end: string }>(() => {
    const todayY = localYmd(startOfToday())
    const endDefault = localYmd(addDays(startOfToday(), 29))
    try {
      const raw = localStorage.getItem(WINDOW_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed.start === 'string' && typeof parsed.end === 'string' && parsed.start <= parsed.end) {
          // Se o início está no passado, usa default (range stale)
          if (parsed.start < todayY) return { start: todayY, end: endDefault }
          return parsed
        }
      }
    } catch {}
    return { start: todayY, end: endDefault }
  })
  const [routines, setRoutines] = useState<Routine[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [delivsByProject, setDelivsByProject] = useState<Record<string, Deliverable[]>>({})
  const [editingProfile, setEditingProfile] = useState(false)
  const [showAllProjects, setShowAllProjects] = useState(false)
  // Flags pra evitar "pop-in" — dashboard só renderiza conteúdo final quando
  // todas as 3 fontes de dados carregaram pelo menos uma vez. Antes, cada
  // fetch que chegava re-disparava re-render com cálculos meio-prontos
  // (horas oscilando, contagens pulando), parecia bug visual.
  const [routinesLoaded, setRoutinesLoaded] = useState(false)
  const [tasksLoaded, setTasksLoaded] = useState(false)
  const [delivsLoaded, setDelivsLoaded] = useState(false)
  // Filtro da seção "Próximas deadlines": null = tudo; 'projeto' ou 'entregável' filtra.
  const [deadlineTypeFilter, setDeadlineTypeFilter] = useState<null | 'projeto' | 'entregável'>(null)
  // Estado de colapso por seção — vibe codex CP2077 onde categorias podem
  // ser fechadas pra reduzir density. Default: tudo aberto.
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const toggleSection = (key: string) =>
    setCollapsedSections(s => ({ ...s, [key]: !s[key] }))

  useEffect(() => {
    try { localStorage.setItem(WINDOW_STORAGE_KEY, JSON.stringify(windowRange)) } catch {}
  }, [windowRange])

  useEffect(() => {
    fetchAllRoutines()
      .then(list => { setRoutines(list); setRoutinesLoaded(true) })
      .catch(err => reportApiError('DashboardPage', err))
    fetchTasks()
      .then(list => { setTasks(list); setTasksLoaded(true) })
      .catch(err => reportApiError('DashboardPage', err))
  }, [])

  // Projetos arquivados ficam fora de todos os cálculos do dashboard — o
  // usuário arquivou pra tirar da vista. Filtro é centralizado aqui e
  // reaproveitado abaixo via `activeFromPortfolio`.
  const activeFromPortfolio = useMemo(
    () => projects.filter(p => !p.archived_at),
    [projects],
  )
  const projectIds = useMemo(
    () => activeFromPortfolio.map(p => p.id).sort(),
    [activeFromPortfolio],
  )
  useEffect(() => {
    if (projectIds.length === 0) {
      setDelivsByProject({})
      setDelivsLoaded(true)
      return
    }
    let cancelled = false
    Promise.all(projectIds.map(pid =>
      fetchDeliverables(pid)
        .then(ds => ({ pid, ds }))
        .catch(() => ({ pid, ds: [] as Deliverable[] }))
    )).then(results => {
      if (cancelled) return
      const map: Record<string, Deliverable[]> = {}
      for (const r of results) map[r.pid] = r.ds
      setDelivsByProject(map)
      setDelivsLoaded(true)
    })
    return () => { cancelled = true }
  }, [projectIds.join(',')])

  // Blocos improdutivos vêm do localStorage (editados no Calendário). Precisa
  // re-ler ao voltar pro Dashboard pra refletir mudanças — `useMemo([])` caía
  // num valor congelado depois do primeiro mount.
  const [unproductiveBlocks, setUnproductiveBlocks] = useState<UnproductiveBlock[]>(() => {
    try { return JSON.parse(localStorage.getItem('hq-unproductive-blocks') || '[]') } catch { return [] }
  })
  useEffect(() => {
    function reread() {
      try { setUnproductiveBlocks(JSON.parse(localStorage.getItem('hq-unproductive-blocks') || '[]')) } catch {}
    }
    window.addEventListener('focus', reread)
    window.addEventListener('storage', reread)
    return () => {
      window.removeEventListener('focus', reread)
      window.removeEventListener('storage', reread)
    }
  }, [])

  // ─── Cálculos por janela ──────────────────────────────────────────────────

  const today = useMemo(() => startOfToday(), [])
  const todayIso = localYmd(today)
  const windowStartDate = useMemo(() => parseYmd(windowRange.start), [windowRange.start])
  const windowEndDate = useMemo(() => parseYmd(windowRange.end), [windowRange.end])
  const windowStartIso = windowRange.start
  const windowEndIso = windowRange.end
  const windowDays = useMemo(() => {
    const diff = Math.round((windowEndDate.getTime() - windowStartDate.getTime()) / 86400000)
    return Math.max(1, diff + 1)
  }, [windowStartDate, windowEndDate])

  function dayCapacityMin(date: Date): number {
    const totalMin = 24 * 60
    let unproductiveMin = 0
    try {
      const ranges = getAllBlockRangesForDay(unproductiveBlocks, date)
      unproductiveMin = Math.round(ranges.reduce((s, r) => s + Math.max(0, r.end - r.start), 0) * 60)
    } catch {}
    let routineMin = 0
    for (const r of routines) {
      if (routineAppliesOnDay(r, date)) routineMin += routineMinutesOnDay(r)
    }
    return Math.max(0, totalMin - unproductiveMin - routineMin)
  }

  const dailyCapacities = useMemo(() => {
    const arr: number[] = []
    for (let i = 0; i < windowDays; i++) {
      arr.push(dayCapacityMin(addDays(windowStartDate, i)))
    }
    return arr
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDays, routines.length, unproductiveBlocks.length, windowStartDate.getTime()])

  const totalCapacityMin = useMemo(
    () => dailyCapacities.reduce((s, x) => s + x, 0),
    [dailyCapacities],
  )
  const avgDailyCapacityMin = useMemo(
    () => dailyCapacities.length ? Math.round(totalCapacityMin / dailyCapacities.length) : 0,
    [totalCapacityMin, dailyCapacities.length],
  )

  // ─── Projetos ─────────────────────────────────────────────────────────────

  const questsByDeliverable = useMemo(() => {
    const map: Record<string, Quest[]> = {}
    for (const q of quests) {
      if (q.deliverable_id) {
        if (!map[q.deliverable_id]) map[q.deliverable_id] = []
        map[q.deliverable_id].push(q)
      }
    }
    return map
  }, [quests])

  function delivWorkedMin(delivId: string): number {
    const qs = questsByDeliverable[delivId] ?? []
    return qs.reduce((s, q) => s + (q.worked_minutes ?? 0), 0)
  }
  // Estimado é soma das quests filhas — o campo `estimated_minutes` do
  // deliverable hoje é só metadado legado, não reflete o plano real.
  function delivEstimatedMin(delivId: string): number {
    const qs = questsByDeliverable[delivId] ?? []
    return qs.reduce((s, q) => s + (q.estimated_minutes ?? 0), 0)
  }
  function effectiveDeliverableDeadline(d: Deliverable, project?: Project): string | null {
    if (d.deadline) return d.deadline
    return project?.deadline ?? null
  }

  const projectPressures: ProjectPressure[] = useMemo(() => {
    const activeProjects = activeFromPortfolio.filter(p => p.status !== 'done' && p.status !== 'cancelled')
    return activeProjects.map(p => {
      const delivs = (delivsByProject[p.id] ?? []).filter(d => !d.done)
      let estimatedMin = 0
      let workedMin = 0
      let remainingMin = 0
      const delivDeadlines: string[] = []
      for (const d of delivs) {
        const est = delivEstimatedMin(d.id)
        const worked = delivWorkedMin(d.id)
        estimatedMin += est
        workedMin += worked
        remainingMin += Math.max(0, est - worked)
        const eff = effectiveDeliverableDeadline(d, p)
        if (eff) delivDeadlines.push(eff)
      }

      // Totais reais — soma TODAS as quests linkadas ao projeto, seja por
      // project_id direto (quests "soltas") ou via qualquer entregável,
      // incluindo entregáveis CONCLUÍDOS. O loop acima ignorava isso e
      // mostrava EXEC=0 falsamente em projetos com entregáveis done.
      const allProjectDelivIds = new Set((delivsByProject[p.id] ?? []).map(d => d.id))
      let totalWorkedMin = 0
      let totalEstimatedMin = 0
      for (const q of quests) {
        const linkedDirect = q.project_id === p.id
        const linkedViaDeliv = !!(q.deliverable_id && allProjectDelivIds.has(q.deliverable_id))
        if (linkedDirect || linkedViaDeliv) {
          totalWorkedMin += q.worked_minutes ?? 0
          totalEstimatedMin += q.estimated_minutes ?? 0
        }
      }
      // Prazo do projeto manda quando existe (é o que o user edita direto no
      // projeto); só cai pra entregáveis quando o projeto não tem prazo próprio.
      const effectiveDeadline = p.deadline
        ? p.deadline
        : (delivDeadlines.length ? delivDeadlines.sort()[0] : null)
      const daysAway = effectiveDeadline ? calendarDaysUntil(effectiveDeadline) : null
      // Dias úteis (incluindo hoje) pra calcular ritmo internamente. Mínimo 1
      // quando não atrasado pra evitar divisão por zero.
      const workingDays = daysAway !== null && daysAway >= 0 ? Math.max(1, daysAway + 1) : null
      let status: Pressure = 'no-deadline'
      if (remainingMin === 0 && estimatedMin > 0) {
        status = 'done'
      } else if (!effectiveDeadline) {
        status = 'no-deadline'
      } else if (daysAway !== null && daysAway < 0) {
        status = 'overdue'
      } else if (workingDays !== null) {
        const ritmo = estimatedMin > 0 ? remainingMin / workingDays : null
        // "Imminent" = deadline dentro da próxima semana. Era <=1 (hoje/amanhã),
        // mas 5 dias sem planejamento também é risco real.
        const imminent = daysAway !== null && daysAway <= 7
        // "Unplanned" = deadline num horizonte ainda maior mas sem estimativa
        // de tempo nenhuma — falta de plano é risco por si só.
        const unplanned = estimatedMin === 0 && daysAway !== null && daysAway <= 14
        if (ritmo !== null && ritmo > avgDailyCapacityMin) status = 'impossible'
        else if (ritmo !== null && ritmo > avgDailyCapacityMin * 0.5) status = 'tight'
        else if (imminent || unplanned) status = 'tight'
        else status = 'ok'
      }
      return { project: p, deliverables: delivs, effectiveDeadline, daysAway, remainingMin, estimatedMin, workedMin, totalWorkedMin, totalEstimatedMin, status }
    })
    .sort((a, b) => {
      const order = { overdue: 0, impossible: 1, tight: 2, ok: 3, 'no-deadline': 4, done: 5 }
      const ao = order[a.status], bo = order[b.status]
      if (ao !== bo) return ao - bo
      if (a.effectiveDeadline && b.effectiveDeadline) return a.effectiveDeadline.localeCompare(b.effectiveDeadline)
      if (a.effectiveDeadline) return -1
      if (b.effectiveDeadline) return 1
      return a.project.title.localeCompare(b.project.title)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quests, delivsByProject, avgDailyCapacityMin])

  // Carga da janela com PROJEÇÃO AMORTIZADA. Cada entregável pendente tem seu
  // ─── Veredito híbrido (status + ação de hoje + mais urgente) ─────────────

  // Quota de trabalho de hoje: pra cada deliverable aberto com prazo, divide
  // o restante pelos dias úteis até a deadline. Se atrasado, despeja o total
  // hoje (daysLeft=1). Resultado é "quanto preciso trabalhar hoje pra manter
  // todos os projetos em dia se eu distribuir o esforço uniformemente".
  const todayQuotaMin = useMemo(() => {
    let quota = 0
    for (const p of activeFromPortfolio.filter(p => p.status !== 'done' && p.status !== 'cancelled')) {
      for (const d of delivsByProject[p.id] ?? []) {
        if (d.done) continue
        const eff = effectiveDeliverableDeadline(d, p)
        if (!eff) continue
        const remaining = Math.max(0, delivEstimatedMin(d.id) - delivWorkedMin(d.id))
        if (remaining === 0) continue
        const daysLeft = Math.max(1, Math.round(
          (parseYmd(eff).getTime() - today.getTime()) / 86400000
        ) + 1)
        quota += remaining / daysLeft
      }
    }
    return Math.round(quota)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quests, delivsByProject, today, todayIso])

  // Item mais urgente entre projetos e entregáveis abertos — menor deadline
  // efetiva. Só conta deliverable deadline explícito (não herdado do projeto),
  // pra não duplicar o projeto.
  const mostUrgent = useMemo(() => {
    let best: { title: string; daysAway: number; type: 'projeto' | 'entregável' } | null = null
    for (const p of activeFromPortfolio.filter(p => p.status !== 'done' && p.status !== 'cancelled')) {
      if (p.deadline) {
        const days = calendarDaysUntil(p.deadline)
        if (!best || days < best.daysAway) {
          best = { title: p.title, daysAway: days, type: 'projeto' }
        }
      }
      for (const d of delivsByProject[p.id] ?? []) {
        if (d.done) continue
        if (!d.deadline) continue
        const days = calendarDaysUntil(d.deadline)
        if (!best || days < best.daysAway) {
          best = { title: d.title, daysAway: days, type: 'entregável' }
        }
      }
    }
    return best
  }, [quests, delivsByProject])

  // ─── Upcoming deadlines ───────────────────────────────────────────────────

  // Conta itens que têm deadline mas estão fora da janela atual — ajuda o
  // usuário a entender por que "próximas deadlines" está vazio.
  const deadlinesOutsideWindow = useMemo(() => {
    let count = 0
    for (const p of projects) {
      if (!p.deadline) continue
      const projectOverdue = p.status !== 'done' && p.status !== 'cancelled' && p.deadline < todayIso
      if (!projectOverdue && (p.deadline < windowStartIso || p.deadline > windowEndIso)) count++
    }
    for (const p of projects) {
      for (const d of delivsByProject[p.id] ?? []) {
        if (!d.deadline) continue
        const delivOverdue = !d.done && d.deadline < todayIso
        if (!delivOverdue && (d.deadline < windowStartIso || d.deadline > windowEndIso)) count++
      }
    }
    return count
  }, [quests, delivsByProject, todayIso, windowStartIso, windowEndIso])

  const upcomingItems: UpcomingItem[] = useMemo(() => {
    const items: UpcomingItem[] = []
    const areaColor = (slug: string) => areas.find(a => a.slug === slug)?.color ?? 'var(--color-text-tertiary)'
    for (const p of projects) {
      if (!p.deadline) continue
      const projectOverdue = p.status !== 'done' && p.status !== 'cancelled' && p.deadline < todayIso
      // Exibe se está na janela OU se está atrasado e ainda não foi concluído
      if (!projectOverdue && (p.deadline < windowStartIso || p.deadline > windowEndIso)) continue
      items.push({
        date: p.deadline,
        type: 'projeto',
        title: p.title,
        context: p.area_slug,
        color: areaColor(p.area_slug),
        isOverdue: projectOverdue,
        done: p.status === 'done',
      })
    }
    for (const p of projects) {
      for (const d of delivsByProject[p.id] ?? []) {
        if (!d.deadline) continue
        const delivOverdue = !d.done && d.deadline < todayIso
        // Exibe se está na janela OU se está atrasado e ainda não foi concluído
        if (!delivOverdue && (d.deadline < windowStartIso || d.deadline > windowEndIso)) continue
        items.push({
          date: d.deadline,
          type: 'entregável',
          title: d.title,
          context: p.title,
          color: areaColor(p.area_slug),
          isOverdue: delivOverdue,
          done: !!d.done,
        })
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quests, delivsByProject, areas, todayIso, windowStartIso, windowEndIso])

  // ─── PROJECT.MATRIX ─── grid dos projetos ATIVOS (não-arquivados, não
  // finalizados, não cancelados), agrupados por área (estilo skill tree
  // CP2077). Diferente do PRESSURE.MATRIX (só os em risco) — esse é o
  // portfolio em execução. Done/cancelled saem da visão pra não poluir
  // a matriz com cards "fantasma" de projetos já encerrados.
  const allProjectsByArea = useMemo(() => {
    const map: Record<string, { area: Area; projects: Project[] }> = {}
    for (const p of activeFromPortfolio) {
      if (p.status === 'done' || p.status === 'cancelled') continue
      const area = areas.find(a => a.slug === p.area_slug)
      if (!area) continue
      if (!map[p.area_slug]) map[p.area_slug] = { area, projects: [] }
      map[p.area_slug].projects.push(p)
    }
    // Sort por deadline (sem deadline vai pro fim)
    for (const k of Object.keys(map)) {
      map[k].projects.sort((a, b) => {
        const aDl = a.deadline ?? '9999'
        const bDl = b.deadline ?? '9999'
        return aDl.localeCompare(bDl)
      })
    }
    return Object.values(map).sort((a, b) => a.area.name.localeCompare(b.area.name))
  }, [activeFromPortfolio, areas])

  // Stats por projeto pra cell — reutiliza projectPressures (ativos) e
  // calcula default pra done/cancelled.
  const pressureByProjectId = useMemo(() => {
    const map: Record<string, ProjectPressure> = {}
    for (const pp of projectPressures) map[pp.project.id] = pp
    return map
  }, [projectPressures])

  // ─── Render ───────────────────────────────────────────────────────────────

  const overdueTasksCount = tasks.filter(t =>
    !t.done && t.scheduled_date && t.scheduled_date < todayIso
  ).length

  const riskProjects = projectPressures.filter(p =>
    p.status === 'overdue' || p.status === 'impossible' || p.status === 'tight'
  )
  const visibleProjects = showAllProjects ? projectPressures : riskProjects
  const totalProjectsInMatrix = allProjectsByArea.reduce((sum, c) => sum + c.projects.length, 0)

  // Veredito híbrido: status (por risco) + ação (hoje) + mais urgente.
  const overdueCount = projectPressures.filter(p => p.status === 'overdue').length
  const atRiskCount = projectPressures.filter(p => p.status === 'impossible' || p.status === 'tight').length
  // Cor do veredito: oxblood vivo (overdue) → oxblood (risco) → ice (tudo em dia).
  // Ice no estado calmo é proposital — vibe HIU "alien-tech ligada e estável",
  // mais cinematográfica que o verde genérico de success state.
  const vereditoColor = overdueCount > 0
    ? 'var(--color-accent-vivid)'
    : atRiskCount > 0
      ? 'var(--color-accent-primary)'
      : 'var(--color-ice)'
  const vereditoGlow = overdueCount === 0 && atRiskCount === 0
    ? '0 0 24px var(--color-ice-glow)'
    : 'none'
  const vereditoHeadline = overdueCount > 0
    ? `${overdueCount} projeto${overdueCount !== 1 ? 's' : ''} atrasado${overdueCount !== 1 ? 's' : ''}${atRiskCount > 0 ? ` · ${atRiskCount} em risco` : ''}`
    : atRiskCount > 0
      ? `${atRiskCount} projeto${atRiskCount !== 1 ? 's' : ''} em risco`
      : 'tudo em dia'

  function urgencyLabel(daysAway: number): string {
    if (daysAway < 0) return `atrasado ${Math.abs(daysAway)}d`
    if (daysAway === 0) return 'hoje'
    if (daysAway === 1) return 'amanhã'
    return `em ${daysAway}d`
  }

  const dashboardReady = routinesLoaded && tasksLoaded && delivsLoaded

  return (
    <div style={{ color: 'var(--color-text-primary)', position: 'relative' }}>
      {/* ─── HEADER BAND CP2077 (estilo "DATA BUFFER") ─────────────────
          Faixa solid no topo da página — não é card, é stamp.
          Esquerda: tab `// DASHBOARD` + identidade do user (avatar minúsculo
            + nome + role) como "tab content" estilo CP2077.
          Direita: window selector (presets + custom range).
          Hairline ice elétrica abaixo separa do body modular. */}
      <header
        style={{
          position: 'relative',
          padding: '12px 18px',
          background: 'linear-gradient(180deg, rgba(10, 14, 22, 0.92), rgba(8, 10, 14, 0.88))',
          borderBottom: '1px solid var(--color-ice-deep)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-5)',
          minHeight: 56,
          // Mobile: deixa o stack metadata cair pra próxima linha quando
          // não cabe ao lado da identidade.
          flexWrap: 'wrap',
        }}
      >
        {/* TAB MARKER — pequeno indicador ice estendendo abaixo do title,
            assinatura "tab pull" das HUDs CP2077. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0, bottom: -1,
            width: 64, height: 2,
            background: 'var(--color-ice)',
            boxShadow: '0 0 12px var(--color-ice-glow)',
          }}
        />

        {/* LEFT: tab title + user identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: 1, minWidth: 0 }}>
          <div
            className="hq-tech-label"
            style={{
              fontSize: 11,
              color: 'var(--color-ice-light)',
              letterSpacing: '0.28em',
              flexShrink: 0,
            }}
          >
            DASHBOARD
          </div>
          <div style={{ width: 1, height: 22, background: 'var(--color-border-strong)', flexShrink: 0 }} />
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.name || 'perfil'}
              onClick={() => setEditingProfile(true)}
              style={{
                width: 28, height: 28, borderRadius: 0,
                objectFit: 'cover', cursor: 'pointer', flexShrink: 0,
                border: '1px solid var(--color-ice-deep)',
              }}
            />
          ) : (
            <button
              onClick={() => setEditingProfile(true)}
              style={{
                width: 28, height: 28, borderRadius: 0,
                border: '1px dashed var(--color-border-strong)', background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-muted)', cursor: 'pointer',
                fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase',
                flexShrink: 0,
              }}
            >
              IMG
            </button>
          )}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div
              onClick={() => setEditingProfile(true)}
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 14, fontWeight: 600,
                letterSpacing: '0.04em',
                color: profile.name ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                cursor: 'pointer', lineHeight: 1.1,
                textTransform: 'uppercase',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {profile.name || 'SEU NOME'}
            </div>
            <div
              onClick={() => setEditingProfile(true)}
              className="hq-tech-id"
              style={{ cursor: 'pointer' }}
            >
              {profile.role || 'CARGO'}
            </div>
          </div>
        </div>

        {/* RIGHT: window selector (header limpo, sem tech-id decorativo) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexShrink: 0 }}>
          <WindowRangeSelector value={windowRange} onChange={setWindowRange} />
        </div>
      </header>

      {/* Surface única do estrategista no executor: card "Próximo Ritual".
          Decisão #15 de docs/metas-de-vida/PLAN.md — Ritual é a única coisa
          estratégica com urgência real, então merece exceção à regra
          "operações ficam limpas". Click → /build. */}
      <div style={{ padding: 'var(--space-3) var(--space-6) 0' }}>
        <RitualNextCard />
      </div>

      {/* Body como cena CP2077 — panel opaco escuro com grid HUD, halos
          ice/fog atmosféricos por trás dos elementos hero, e contraste
          alto. Não é mais "vidro translúcido", é "monitor de console
          tático". Camadas (z-bottom → z-top):
          1. Base sólida quase preta (panel HUD)
          2. Halo cinza-luminoso intenso atrás do veredito
          3. Fog azul-aço denso meio-superior
          4. Halo ice elétrico off-axis direita (alien-tech)
          5. Fog azul secundário canto inferior-esquerdo
          6. Whisper oxblood top-left (visceral)
          7. Vinheta inferior preta pesada
          8. Grid HUD sutil (mesh CRT)
          9. Grain denso bluish */}
      <div
        className="hq-dashboard-body"
        style={{
          padding: 'var(--space-5) var(--space-6) var(--space-10)',
          position: 'relative',
          // Atmosphere global do body (em index.html) já faz o trabalho pesado:
          // halo branco, fog azul, grain SVG, vinheta. Aqui mantemos só um
          // whisper sutil no topo pra ancorar o veredito. Glow é signal, não
          // textura (DESIGN.md §Atmosphere-Is-Layer-Zero).
          background:
            'radial-gradient(ellipse 60% 30% at 50% 0%, rgba(143, 191, 211, 0.06), transparent 70%)',
        }}
      >
        <div style={{ position: 'relative', zIndex: 1 }}>

      {/* ─── VEREDITO (data display frame estilo "score readout" CP2077) ─── */}
      <section style={{ marginTop: 40, marginBottom: 40, position: 'relative' }}>
        {/* Frame outer com corner brackets ice + tab title bar no topo.
            Estrutura: [TITLE BAR] [BIG SCORE] [STATS GRID] */}
        <div
          className="hq-brackets-full"
          style={{
            position: 'relative',
            border: '1px solid var(--color-ice-deep)',
            background: `
              radial-gradient(ellipse 60% 100% at 50% 0%, rgba(143, 191, 211, 0.06), transparent 70%),
              radial-gradient(ellipse 80% 60% at 50% 100%, rgba(40, 50, 57, 0.30), transparent 70%),
              rgba(8, 12, 18, 0.65)
            `,
            padding: 0,
            color: 'var(--color-ice)',  // for hq-brackets-full corner color
            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%)',
          }}
        >
          {/* TITLE BAR — faixa solid no topo do frame */}
          <div
            style={{
              padding: '8px 16px',
              borderBottom: '1px solid var(--color-ice-deep)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'rgba(40, 50, 57, 0.45)',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 8, height: 8,
                background: 'var(--color-ice)',
                boxShadow: '0 0 8px var(--color-ice-glow)',
              }}
            />
            <span
              className="hq-tech-label"
              style={{
                color: 'var(--color-ice-light)',
                letterSpacing: '0.28em',
                flex: 1,
              }}
            >
              STATUS.READOUT
            </span>
            <span
              className="hq-tech-id"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {windowRangeLabel(windowRange, todayIso).toUpperCase()}
            </span>
            <span
              title={`Status: conta projetos atrasados (overdue) e em risco (ritmo > ${Math.round(avgDailyCapacityMin / 60 * 10) / 10}h/dia ou deadline em ≤1d).\n\nHoje: soma das horas que você precisa trabalhar hoje se distribuir o tempo restante de cada entregável uniformemente até sua deadline.\n\nMais urgente: item (projeto ou entregável) com a deadline mais próxima.`}
              style={{ display: 'inline-flex', color: 'var(--color-text-muted)', cursor: 'help' }}
            >
              <Info size={11} strokeWidth={1.8} />
            </span>
          </div>

          {/* CONTENT */}
          <div style={{ padding: '24px 28px' }}>
            {!dashboardReady ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <SkeletonBlock height={42} width="60%" />
                <SkeletonBlock height={16} width="40%" />
                <SkeletonBlock height={14} width="50%" />
              </div>
            ) : (
              <>
                {/* HERO HEADLINE — score gigante */}
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 40, fontWeight: 700, lineHeight: 1,
                    color: vereditoColor,
                    textShadow: vereditoGlow,
                    letterSpacing: '0.02em',
                    textTransform: 'uppercase',
                  }}
                >
                  {vereditoHeadline}
                </div>

                {/* STATS GRID — pares LABEL : VALUE alinhados estilo scoreboard.
                    auto-fit + minmax(160px) colapsa pra 1 coluna em mobile
                    sem quebrar visual. */}
                <div
                  style={{
                    marginTop: 22,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: '14px 32px',
                    paddingTop: 16,
                    borderTop: '1px solid var(--color-divider)',
                  }}
                >
                  {/* HOJE */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="hq-tech-label" style={{ color: 'var(--color-text-muted)' }}>
                      HOJE
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 18, fontWeight: 700,
                      color: todayQuotaMin > 0 ? 'var(--color-ice-light)' : 'var(--color-text-tertiary)',
                      letterSpacing: '0.02em',
                      textShadow: todayQuotaMin > 0 ? '0 0 12px var(--color-ice-glow)' : 'none',
                    }}>
                      {todayQuotaMin > 0
                        ? <AnimatedNumber value={todayQuotaMin} format={fmtHM} duration={0.7} />
                        : '—'}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 10,
                      color: 'var(--color-text-tertiary)',
                      fontStyle: 'italic',
                      letterSpacing: 0,
                    }}>
                      {todayQuotaMin > 0 ? 'pra ficar em dia' : 'sem compromissos hoje'}
                    </span>
                  </div>

                  {/* MAIS URGENTE */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="hq-tech-label" style={{ color: 'var(--color-text-muted)' }}>
                      MAIS URGENTE
                    </span>
                    {mostUrgent ? (
                      <>
                        <span style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 14, fontWeight: 600,
                          color: mostUrgent.daysAway < 0 ? 'var(--color-accent-vivid)' : 'var(--color-text-primary)',
                          letterSpacing: '0.03em',
                          textTransform: 'uppercase',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {mostUrgent.title}
                        </span>
                        <span style={{
                          fontFamily: 'var(--font-body)',
                          fontSize: 10,
                          color: 'var(--color-text-tertiary)',
                          fontStyle: 'italic',
                          letterSpacing: 0,
                        }}>
                          {mostUrgent.type} · {urgencyLabel(mostUrgent.daysAway)}
                        </span>
                      </>
                    ) : (
                      <>
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 18, fontWeight: 700,
                          color: 'var(--color-text-tertiary)',
                        }}>—</span>
                        <span style={{
                          fontFamily: 'var(--font-body)',
                          fontSize: 10,
                          color: 'var(--color-text-tertiary)',
                          fontStyle: 'italic',
                          letterSpacing: 0,
                        }}>
                          nenhum item crítico
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {overdueTasksCount > 0 && (
        <section style={{ marginBottom: 40 }}>
          <button
            onClick={() => navigate('/tarefas')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10, padding: 0,
              color: 'var(--color-accent-primary)',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            <span style={{
              fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 700,
            }}>
              {overdueTasksCount} {overdueTasksCount === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'}
            </span>
            <span style={{
              fontSize: 9, color: 'var(--color-text-tertiary)',
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>
              abrir tarefas →
            </span>
          </button>
        </section>
      )}

      {/* ─── PROJECT.MATRIX ─── grid de TODOS os projetos não-arquivados,
          agrupados por área, estilo skill tree CP2077. Default colapsado.
          Vem ANTES de PRESSURE.MATRIX porque é a visão geral do portfólio. */}
      <section style={{ marginBottom: 32 }}>
        <SectionHeader
          label="PROJECT.MATRIX"
          count={totalProjectsInMatrix}
          collapsed={collapsedSections['matrix'] === undefined ? true : !!collapsedSections['matrix']}
          onToggle={() => toggleSection('matrix')}
        />
        {/* Collapse via grid-template-rows 0fr → 1fr (não causa layout
            thrash como max-height). Filho wrapper com overflow hidden. */}
        <div style={{
          display: 'grid',
          gridTemplateRows: (collapsedSections['matrix'] === undefined || collapsedSections['matrix']) ? '0fr' : '1fr',
          opacity: (collapsedSections['matrix'] === undefined || collapsedSections['matrix']) ? 0 : 1,
          transition: 'opacity var(--motion-base) var(--ease-emphasis), grid-template-rows var(--motion-base) var(--ease-emphasis), margin-top var(--motion-base) var(--ease-emphasis)',
          marginTop: (collapsedSections['matrix'] === undefined || collapsedSections['matrix']) ? 0 : 14,
        }}>
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          {totalProjectsInMatrix === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              Nenhum projeto cadastrado.
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '24px 28px',
            }}>
              {allProjectsByArea.map(({ area, projects }) => {
                const activeCount = projects.filter(p =>
                  p.status !== 'done' && p.status !== 'cancelled'
                ).length
                return (
                  <div
                    key={area.slug}
                    style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingBottom: 6,
                      borderBottom: `1px solid ${area.color}66`,
                    }}>
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.22em',
                        textTransform: 'uppercase',
                        color: area.color,
                      }}>
                        {area.name}
                      </span>
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.12em',
                        color: 'var(--color-text-muted)',
                      }}>
                        {activeCount.toString().padStart(2, '0')}/{projects.length.toString().padStart(2, '0')}
                      </span>
                    </div>
                    <div style={{ position: 'relative', paddingLeft: 10 }}>
                      <div
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          left: 0, top: 4, bottom: 4,
                          width: 1,
                          background: `linear-gradient(180deg, ${area.color}88 0%, ${area.color}22 60%, transparent)`,
                        }}
                      />
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                      }}>
                        {projects.map(p => (
                          <ProjectCell
                            key={p.id}
                            project={p}
                            areaColor={area.color}
                            pressure={pressureByProjectId[p.id]}
                            onOpen={() => {
                              onSelectProject(p.id)
                              navigate(`/areas/${p.area_slug}`)
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        </div>
      </section>

      {/* ─── Projetos em risco ─── */}
      <section style={{ marginBottom: 32 }}>
        <SectionHeader
          label="PRESSURE.MATRIX"
          count={visibleProjects.length}
          collapsed={!!collapsedSections['pressure']}
          onToggle={() => toggleSection('pressure')}
          accent={riskProjects.some(p => p.status === 'overdue') ? 'oxblood' : 'ice'}
        />
        <div style={{
          display: 'grid',
          gridTemplateRows: collapsedSections['pressure'] ? '0fr' : '1fr',
          opacity: collapsedSections['pressure'] ? 0 : 1,
          transition: 'opacity var(--motion-base) var(--ease-emphasis), grid-template-rows var(--motion-base) var(--ease-emphasis), margin-top var(--motion-base) var(--ease-emphasis)',
          marginTop: collapsedSections['pressure'] ? 0 : 14,
        }}>
        <div style={{ overflow: 'hidden', minHeight: 0 }}>

        {visibleProjects.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            {showAllProjects && projectPressures.length === 0
              ? 'Nenhum projeto ativo.'
              : 'Nenhum projeto em risco.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {visibleProjects.map(pp => {
              const area = areas.find(a => a.slug === pp.project.area_slug)
              return (
                <ProjectRiskRow
                  key={pp.project.id}
                  pp={pp}
                  areaColor={area?.color ?? 'var(--color-text-tertiary)'}
                  areaName={area?.name ?? pp.project.area_slug}
                  onOpen={() => {
                    onSelectProject(pp.project.id)
                    navigate(`/areas/${pp.project.area_slug}`)
                  }}
                />
              )
            })}
          </div>
        )}

        {!showAllProjects && projectPressures.length > riskProjects.length && (
          <button
            onClick={() => setShowAllProjects(true)}
            style={{
              marginTop: 14, background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', fontSize: 10,
              letterSpacing: '0.1em', textTransform: 'uppercase', padding: 0,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ice-light)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
          >
            ver todos os projetos ({projectPressures.length})
          </button>
        )}
        {showAllProjects && (
          <button
            onClick={() => setShowAllProjects(false)}
            style={{
              marginTop: 14, background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', fontSize: 10,
              letterSpacing: '0.1em', textTransform: 'uppercase', padding: 0,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ice-light)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
          >
            só em risco
          </button>
        )}
        </div>
        </div>
      </section>

      {/* ─── Próximas deadlines ─── */}
      <section style={{ marginBottom: 32 }}>
        <SectionHeader
          label="DEADLINE.QUEUE"
          count={upcomingItems.length}
          collapsed={!!collapsedSections['deadlines']}
          onToggle={() => toggleSection('deadlines')}
          accent={upcomingItems.some(i => i.isOverdue) ? 'oxblood' : 'ice'}
        />
        <div style={{
          display: 'grid',
          gridTemplateRows: collapsedSections['deadlines'] ? '0fr' : '1fr',
          opacity: collapsedSections['deadlines'] ? 0 : 1,
          transition: 'opacity var(--motion-base) var(--ease-emphasis), grid-template-rows var(--motion-base) var(--ease-emphasis), margin-top var(--motion-base) var(--ease-emphasis)',
          marginTop: collapsedSections['deadlines'] ? 0 : 14,
        }}>
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, marginBottom: 18, flexWrap: 'wrap',
        }}>
          {(() => {
            const projCount = upcomingItems.filter(i => i.type === 'projeto').length
            const delivCount = upcomingItems.filter(i => i.type === 'entregável').length
            const btn = (label: string, value: null | 'projeto' | 'entregável', count: number) => {
              const active = deadlineTypeFilter === value
              return (
                <button
                  key={label}
                  onClick={() => setDeadlineTypeFilter(value)}
                  style={{
                    background: active ? 'var(--color-ice-soft)' : 'none',
                    border: `1px solid ${active ? 'rgba(143, 191, 211, 0.32)' : 'var(--color-border)'}`,
                    cursor: 'pointer',
                    color: active ? 'var(--color-ice-light)' : 'var(--color-text-tertiary)',
                    padding: '4px 10px', fontSize: 10, fontWeight: 600,
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    borderRadius: 3, fontFamily: 'inherit',
                    transition: 'all 0.15s',
                    boxShadow: active ? '0 0 12px rgba(143, 191, 211, 0.18)' : 'none',
                  }}
                  onMouseEnter={e => {
                    if (!active) {
                      e.currentTarget.style.borderColor = 'var(--color-text-tertiary)'
                      e.currentTarget.style.color = 'var(--color-text-primary)'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!active) {
                      e.currentTarget.style.borderColor = 'var(--color-border)'
                      e.currentTarget.style.color = 'var(--color-text-tertiary)'
                    }
                  }}
                >
                  {label} {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}
                </button>
              )
            }
            return (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {btn('tudo', null, upcomingItems.length)}
                {btn('projetos', 'projeto', projCount)}
                {btn('entregáveis', 'entregável', delivCount)}
              </div>
            )
          })()}
        </div>

        {(() => {
          const filtered = deadlineTypeFilter
            ? upcomingItems.filter(i => i.type === deadlineTypeFilter)
            : upcomingItems
          if (filtered.length === 0) {
            return (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                {deadlineTypeFilter
                  ? `Nenhum ${deadlineTypeFilter === 'projeto' ? 'projeto' : 'entregável'} nessa janela.`
                  : 'Nenhuma deadline nessa janela.'}
                {deadlinesOutsideWindow > 0 && !deadlineTypeFilter && (
                  <span style={{ display: 'block', marginTop: 6, color: 'var(--color-text-tertiary)', fontStyle: 'normal' }}>
                    {deadlinesOutsideWindow} deadline{deadlinesOutsideWindow !== 1 ? 's' : ''} fora da janela. Ajuste o intervalo acima pra ver.
                  </span>
                )}
              </div>
            )
          }
          return (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filtered.map((item, idx) => {
              const daysAway = calendarDaysUntil(item.date)
              const dayLabel = daysAway === 0 ? 'HOJE'
                : daysAway === 1 ? 'AMANHÃ'
                : daysAway < 0 ? `+${Math.abs(daysAway)}D`
                : `${daysAway}D`
              const itemBorderColor = item.isOverdue
                ? 'rgba(159, 18, 57, 0.55)'
                : 'rgba(143, 191, 211, 0.30)'
              const itemAccentColor = item.isOverdue
                ? 'var(--color-accent-vivid)'
                : 'var(--color-ice)'
              const [, mm, dd] = item.date.split('-')
              return (
                <div
                  key={idx}
                  style={{
                    position: 'relative',
                    display: 'flex', alignItems: 'stretch', gap: 6,
                    marginBottom: 10,
                    opacity: item.done ? 0.45 : 1,
                    transition: 'transform var(--motion-fast) var(--ease-smooth)',
                  }}
                >
                  {/* THUMBNAIL: data como display tactical */}
                  <div style={{
                    width: 56, flexShrink: 0,
                    background: `linear-gradient(135deg, ${item.color}22, ${item.color}08 60%, transparent)`,
                    border: `1px solid ${itemBorderColor}`,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: 2,
                    clipPath: 'polygon(8px 0, 100% 0, 100% 100%, 0 100%, 0 8px)',
                  }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 14, fontWeight: 700,
                      color: itemAccentColor,
                      letterSpacing: '0.05em',
                      lineHeight: 1,
                    }}>
                      {dd}/{mm}
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 8, fontWeight: 700,
                      color: 'var(--color-text-muted)',
                      letterSpacing: '0.12em',
                      marginTop: 3,
                    }}>
                      {dayLabel}
                    </div>
                  </div>

                  {/* MAIN CARD */}
                  <div style={{
                    flex: 1, minWidth: 0,
                    background: item.isOverdue
                      ? 'rgba(159, 18, 57, 0.08)'
                      : 'rgba(8, 12, 18, 0.55)',
                    border: `1px solid ${itemBorderColor}`,
                    padding: '10px 16px',
                    display: 'flex', alignItems: 'center', gap: 16,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 14, fontWeight: 600,
                        color: 'var(--color-text-primary)',
                        letterSpacing: '0.03em',
                        textTransform: 'uppercase',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        textDecoration: item.done ? 'line-through' : 'none',
                        lineHeight: 1.2,
                      }}>
                        {item.title}
                      </div>
                      <div style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9, fontWeight: 600,
                        color: 'var(--color-text-muted)',
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        marginTop: 4,
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}>
                        <span style={{ color: item.color }}>{item.type}</span>
                        {item.context && (
                          <>
                            <span style={{ opacity: 0.4 }}>·</span>
                            <span>{item.context}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          )
        })()}
        </div>
        </div>
      </section>

      {/* ─── /BUILD · RITUAIS DEVIDOS ─── Só aparece se há ritual atrasado
          ou vencendo hoje. Nag conservador — Build é deliberado. */}
      <section style={{ marginBottom: 32 }}>
        <BuildDashboardCard />
      </section>

      {/* ─── MIND · CONFRONTAR ─── Hipóteses recorrentes que precisam de
          confronto. Esconde se não tem nada a fazer. */}
      <section style={{ marginBottom: 32 }}>
        <MindDashboardCard />
      </section>

      {/* ─── HUB.HEALTH ─── Card vitals do Hub Health (1 leitura por domínio
          + contagem de pendências). Clique leva pra /health/biomonitor. */}
      <section style={{ marginBottom: 32 }}>
        <HealthDashboardCard />
      </section>

      {/* ─── LIBRARY ─── Card vitals da biblioteca (em andamento, fila, done,
          revisitas). Esconde quando library tá vazia. */}
      <section style={{ marginBottom: 32 }}>
        <LibraryDashboardCard />
      </section>

        </div>
      </div>

    {editingProfile && (
      <ProfileEditModal
        profile={profile}
        onClose={() => setEditingProfile(false)}
        onSave={onProfileUpdate}
      />
    )}
    </div>
  )
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

/**
 * Section header collapsable estilo CP2077 codex (CHARACTERS/GLOSSARY/etc).
 * Border ice deep + bottom-right chamfer + chevron rotacionado conforme
 * estado. Click toggle expand/collapse com transição smooth.
 */
function SectionHeader({
  label,
  count,
  collapsed,
  onToggle,
  accent = 'ice',
}: {
  label: string
  count?: number
  collapsed: boolean
  onToggle: () => void
  accent?: 'ice' | 'oxblood'
}) {
  const borderColor = accent === 'oxblood'
    ? 'rgba(159, 18, 57, 0.55)'
    : 'rgba(143, 191, 211, 0.45)'
  const textColor = accent === 'oxblood'
    ? 'var(--color-accent-light)'
    : 'var(--color-ice-light)'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      style={{
        width: '100%',
        background: 'rgba(8, 12, 18, 0.55)',
        border: `1px solid ${borderColor}`,
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        cursor: 'pointer',
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)',
        borderRadius: 0,
        transition: 'background var(--motion-fast) var(--ease-smooth), border-color var(--motion-fast) var(--ease-smooth)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = accent === 'oxblood'
          ? 'rgba(159, 18, 57, 0.10)'
          : 'rgba(143, 191, 211, 0.06)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
      }}
    >
      {/* Tab marker à esquerda */}
      <div
        aria-hidden="true"
        style={{
          width: 3, height: 18,
          background: textColor,
          boxShadow: accent === 'oxblood'
            ? '0 0 8px rgba(159, 18, 57, 0.55)'
            : '0 0 8px var(--color-ice-glow)',
        }}
      />
      <span
        style={{
          flex: 1,
          textAlign: 'left',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: textColor,
        }}
      >
        {label}
        {typeof count === 'number' && count > 0 && (
          <span style={{
            marginLeft: 12,
            color: 'var(--color-text-muted)',
            fontWeight: 600,
          }}>
            [{count}]
          </span>
        )}
      </span>
      {/* Chevron rotacionado conforme estado */}
      <ChevronDown
        size={14}
        strokeWidth={2}
        color={textColor}
        style={{
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          transition: 'transform var(--motion-base) var(--ease-emphasis)',
          flexShrink: 0,
        }}
      />
    </button>
  )
}

/**
 * Cell horizontal do PROJECT.MATRIX — slot retangular com title completo
 * (truncado), status dot + mini progress bar. Estilo "data row" CP2077
 * codex. Click navega pra área com o projeto selecionado.
 */
function ProjectCell({
  project,
  areaColor,
  pressure,
  onOpen,
}: {
  project: Project
  areaColor: string
  pressure?: ProjectPressure
  onOpen: () => void
}) {
  const isDone = project.status === 'done'
  const isCancelled = project.status === 'cancelled'
  const dimmed = isDone || isCancelled

  const status: Pressure | 'cancelled' = isCancelled
    ? 'cancelled' as any
    : isDone
      ? 'done'
      : pressure?.status ?? 'no-deadline'

  const isOverdue = status === 'overdue' || status === 'impossible'
  const isTight = status === 'tight'

  const dotColor = isOverdue
    ? 'var(--color-accent-vivid)'
    : isTight
      ? 'var(--color-warning)'
      : isDone
        ? 'var(--color-success)'
        : isCancelled
          ? 'var(--color-text-muted)'
          : 'var(--color-ice)'

  const borderColor = isOverdue
    ? 'rgba(159, 18, 57, 0.50)'
    : isTight
      ? 'rgba(192, 138, 58, 0.40)'
      : dimmed
        ? 'rgba(255, 255, 255, 0.06)'
        : 'rgba(143, 191, 211, 0.22)'

  const pct = isDone
    ? 100
    : pressure && pressure.totalEstimatedMin > 0
      ? Math.min(100, Math.round((pressure.totalWorkedMin / pressure.totalEstimatedMin) * 100))
      : 0

  const tooltipParts = [project.title]
  if (project.deadline) tooltipParts.push(`prazo ${project.deadline}`)
  if (status !== 'no-deadline' && status !== 'done' && status !== ('cancelled' as any)) {
    tooltipParts.push(`status: ${status}`)
  }
  const tooltip = tooltipParts.join(' · ')

  return (
    <button
      type="button"
      onClick={onOpen}
      title={tooltip}
      aria-label={tooltip}
      style={{
        position: 'relative',
        width: '100%',
        background: dimmed
          ? `linear-gradient(135deg, ${areaColor}0a 0%, transparent 55%), rgba(8, 12, 18, 0.35)`
          : `linear-gradient(135deg, ${areaColor}14 0%, transparent 55%), rgba(8, 12, 18, 0.55)`,
        border: `1px solid ${borderColor}`,
        borderRadius: 0,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
        cursor: 'pointer',
        opacity: dimmed ? 0.55 : 1,
        padding: '7px 9px 5px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        alignItems: 'stretch',
        textAlign: 'left',
        transition: 'transform var(--motion-fast) var(--ease-smooth), border-color var(--motion-fast) var(--ease-smooth), background var(--motion-fast) var(--ease-smooth), box-shadow var(--motion-fast) var(--ease-smooth)',
        fontFamily: 'inherit',
        boxShadow: 'none',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateX(2px)'
        e.currentTarget.style.boxShadow = isOverdue
          ? '0 0 12px rgba(159, 18, 57, 0.25)'
          : '0 0 12px rgba(143, 191, 211, 0.18)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateX(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* Linha topo: status dot + title (truncate) + date à direita */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <span
          aria-hidden="true"
          style={{
            width: 6, height: 6,
            background: dotColor,
            boxShadow: dimmed ? 'none' : `0 0 4px ${dotColor}`,
            flexShrink: 0,
          }}
        />
        <span style={{
          flex: 1, minWidth: 0,
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: dimmed ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1.15,
          textDecoration: isCancelled ? 'line-through' : 'none',
        }}>
          {project.title}
        </span>
        {/* Date dd/mm à direita — mono, cor accent quando próximo/atrasado.
            Title trunca com ellipsis se for longo, mas date sempre visível. */}
        {project.deadline ? (
          <span style={{
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: dimmed
              ? 'var(--color-text-muted)'
              : isOverdue
                ? 'var(--color-accent-vivid)'
                : isTight
                  ? 'var(--color-warning)'
                  : 'var(--color-text-tertiary)',
          }}>
            {(() => {
              const [, mm, dd] = project.deadline.split('-')
              return `${dd}/${mm}`
            })()}
          </span>
        ) : (
          <span style={{
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--color-text-muted)',
            opacity: 0.5,
          }}>
            —
          </span>
        )}
      </div>

      {/* Mini progress bar — 5 segments */}
      <div style={{ display: 'flex', gap: 1 }}>
        {Array.from({ length: 5 }).map((_, i) => {
          const filled = (pct / 20) > i
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: 2,
                background: filled
                  ? (dimmed ? 'rgba(255, 255, 255, 0.18)' : dotColor)
                  : 'rgba(255, 255, 255, 0.05)',
              }}
            />
          )
        })}
      </div>
    </button>
  )
}

/**
 * Linha enxuta de um projeto em risco. Cor de status (vermelho/amarelo) só
 * nos números que comunicam a urgência; o resto é neutro.
 */
function ProjectRiskRow({ pp, areaColor, areaName, onOpen }: { pp: ProjectPressure; areaColor: string; areaName: string; onOpen: () => void }) {
  // Pct contra o TOTAL estimado (delivs done + pending + quests soltas) em vez
  // de só pendente — assim 100% = projeto inteiro entregue, não "todas as
  // pending feitas". Cap em 100 pra evitar overflow visual quando worked > est.
  const pct = pp.totalEstimatedMin > 0
    ? Math.min(100, Math.round((pp.totalWorkedMin / pp.totalEstimatedMin) * 100))
    : null

  // Cor de borda/fill do card depende do status — oxblood pra severos
  // (overdue/impossible), ice pra resto. Mapeia urgência semântica
  // diretamente na intensidade visual do card. Estilo CP2077 codex onde
  // item "selecionado/hot" recebe fill saturado.
  const isSevere = pp.status === 'overdue' || pp.status === 'impossible'
  const borderColor = isSevere
    ? 'rgba(159, 18, 57, 0.55)'
    : pp.status === 'tight'
      ? 'rgba(192, 138, 58, 0.45)'
      : 'rgba(143, 191, 211, 0.30)'
  const accentColor = isSevere
    ? 'var(--color-accent-primary)'
    : pp.status === 'tight'
      ? 'var(--color-warning)'
      : 'var(--color-ice)'

  // Thumbnail: data da deadline + relativo. Mais útil que iniciais
  // de área (que já aparece no caption). Sem deadline → traço.
  let thumbDateDay = '—'
  let thumbDateMonth = ''
  let thumbRelative = 'NO.DL'
  if (pp.effectiveDeadline) {
    const [, mm, dd] = pp.effectiveDeadline.split('-')
    thumbDateDay = dd
    thumbDateMonth = mm
    if (pp.daysAway === null) thumbRelative = '—'
    else if (pp.daysAway < 0) thumbRelative = `+${Math.abs(pp.daysAway)}D`
    else if (pp.daysAway === 0) thumbRelative = 'HOJE'
    else if (pp.daysAway === 1) thumbRelative = 'AMANHÃ'
    else thumbRelative = `${pp.daysAway}D`
  }

  // Stats extras pra preencher o card: trabalhado + estimado + count entregáveis.
  // Vira a 3ª linha do body em mono technical readout.
  const delivCount = pp.deliverables.length

  return (
    <div
      onClick={onOpen}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'stretch', gap: 6,
        marginBottom: 10,
        cursor: 'pointer',
        transition: 'transform var(--motion-fast) var(--ease-smooth)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateX(2px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateX(0)'
      }}
    >
      {/* THUMBNAIL — data deadline + relativo. Top-left chamfer angular. */}
      <div
        style={{
          width: 64, flexShrink: 0,
          background: `linear-gradient(135deg, ${areaColor}22, ${areaColor}08 60%, transparent)`,
          border: `1px solid ${borderColor}`,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 2,
          clipPath: 'polygon(8px 0, 100% 0, 100% 100%, 0 100%, 0 8px)',
        }}
      >
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 15, fontWeight: 700,
          color: accentColor,
          letterSpacing: '0.02em',
          lineHeight: 1,
        }}>
          {thumbDateDay}{thumbDateMonth ? `/${thumbDateMonth}` : ''}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 8, fontWeight: 700,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.12em',
          marginTop: 4,
        }}>
          {thumbRelative}
        </div>
      </div>

      {/* MAIN CARD — corpo principal: title + caption + stats row.
          Bottom-right chamfer assinatura CP2077. */}
      <div
        style={{
          flex: 1, minWidth: 0,
          background: isSevere
            ? 'rgba(159, 18, 57, 0.08)'
            : 'rgba(8, 12, 18, 0.55)',
          border: `1px solid ${borderColor}`,
          padding: '12px 18px',
          display: 'flex', alignItems: 'center', gap: 16,
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)',
          transition: 'background var(--motion-fast) var(--ease-smooth)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {/* L1: Title em Rajdhani uppercase */}
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 15, fontWeight: 600,
            color: 'var(--color-text-primary)',
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            lineHeight: 1.2,
          }}>
            {pp.project.title}
          </div>

          {/* L2: Area · Status (sem deadline — já tá na thumbnail) */}
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 600,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ color: areaColor }}>{areaName}</span>
            <span style={{ opacity: 0.4, color: 'var(--color-text-muted)' }}>·</span>
            <span style={{ color: accentColor, fontWeight: 700 }}>
              {pp.status === 'overdue' ? 'ATRASADO' : pp.status === 'impossible' ? 'IMPOSSÍVEL' : pp.status === 'tight' ? 'APERTADO' : pp.status === 'ok' ? 'EM DIA' : pp.status === 'done' ? 'CONCLUÍDO' : 'SEM PRAZO'}
            </span>
          </div>

          {/* L3: Stats technical readout (// EXEC · EST · QUEUE) */}
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 600,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span>
              <span style={{ color: 'var(--color-ice-deep)', marginRight: 4 }}>//</span>
              EXEC
              <span style={{ color: 'var(--color-text-secondary)', marginLeft: 6, fontWeight: 700 }}>
                {pp.totalWorkedMin > 0 ? fmtHM(pp.totalWorkedMin) : '0H'}
              </span>
            </span>
            <span style={{ opacity: 0.3 }}>·</span>
            <span>
              EST
              <span style={{ color: 'var(--color-text-secondary)', marginLeft: 6, fontWeight: 700 }}>
                {pp.totalEstimatedMin > 0 ? fmtHM(pp.totalEstimatedMin) : '—'}
              </span>
            </span>
            <span style={{ opacity: 0.3 }}>·</span>
            <span>
              QUEUE
              <span style={{ color: 'var(--color-text-secondary)', marginLeft: 6, fontWeight: 700 }}>
                {delivCount} {delivCount === 1 ? 'ENTREGÁVEL' : 'ENTREGÁVEIS'}
              </span>
            </span>
          </div>
        </div>

        {/* METRICS RIGHT: pendente + % com mini segmented progress bar */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
          gap: 6, flexShrink: 0,
          fontFamily: 'var(--font-mono)',
        }}>
          <div style={{
            display: 'flex', gap: 18, alignItems: 'baseline',
            fontSize: 11,
            color: 'var(--color-text-tertiary)',
          }}>
            {pp.remainingMin > 0 && (
              <span style={{ color: accentColor, fontWeight: 600, letterSpacing: '0.05em' }}>
                {fmtHM(pp.remainingMin)}
              </span>
            )}
            {pct !== null && (
              <span style={{
                minWidth: 40, textAlign: 'right',
                color: 'var(--color-text-secondary)',
                fontWeight: 700,
              }}>
                {pct}%
              </span>
            )}
          </div>

          {/* Segmented progress bar — 10 chunks ice/oxblood (estilo HUD progress) */}
          {pct !== null && (
            <div style={{
              display: 'flex', gap: 2,
              minWidth: 120,
            }}>
              {Array.from({ length: 10 }).map((_, i) => {
                const filled = (pct / 10) > i
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1, height: 4,
                      background: filled
                        ? accentColor
                        : 'rgba(255, 255, 255, 0.08)',
                      boxShadow: filled
                        ? `0 0 4px ${accentColor}`
                        : 'none',
                    }}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Seletor de janela do dashboard com popover estilo Google Calendar:
 * presets rápidos (hoje / amanhã / 7d / 30d) + campos de "de / até" pra
 * intervalo arbitrário, incluindo um único dia (start == end).
 */
function WindowRangeSelector({ value, onChange }: {
  value: { start: string; end: string }
  onChange: (v: { start: string; end: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [customStart, setCustomStart] = useState(value.start)
  const [customEnd, setCustomEnd] = useState(value.end)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setCustomStart(value.start); setCustomEnd(value.end) }, [value.start, value.end])
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function todayYmd() { return localYmd(startOfToday()) }
  function shift(days: number) { return localYmd(addDays(startOfToday(), days)) }

  const presets: { label: string; range: { start: string; end: string } }[] = [
    { label: 'hoje',     range: { start: todayYmd(), end: todayYmd() } },
    { label: 'amanhã',   range: { start: shift(1),   end: shift(1) } },
    { label: '7d',       range: { start: todayYmd(), end: shift(6) } },
    { label: '14d',      range: { start: todayYmd(), end: shift(13) } },
    { label: '30d',      range: { start: todayYmd(), end: shift(29) } },
  ]

  const currentLabel = windowRangeLabel(value, todayYmd())
  const matchingPreset = presets.find(p => p.range.start === value.start && p.range.end === value.end)

  function applyCustom() {
    if (!customStart || !customEnd) return
    if (customStart > customEnd) return
    onChange({ start: customStart, end: customEnd })
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none', border: '1px solid var(--color-border)', cursor: 'pointer',
          color: 'var(--color-text-secondary)',
          padding: '6px 12px', fontSize: 10, fontWeight: 600,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          borderRadius: 3, display: 'inline-flex', alignItems: 'center', gap: 8,
          fontFamily: 'inherit', transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'var(--color-text-tertiary)'
          e.currentTarget.style.color = 'var(--color-text-primary)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--color-border)'
          e.currentTarget.style.color = 'var(--color-text-secondary)'
        }}
      >
        {currentLabel}
        <ChevronDown size={10} strokeWidth={2} />
      </button>

      {open && (
        <div
          className="hq-glass hq-grain hq-animate-fade-up"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            padding: 'var(--space-3)', zIndex: 100,
            minWidth: 240,
            boxShadow: 'var(--shadow-lg)',
            display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {presets.map(p => {
              const active = matchingPreset?.label === p.label
              return (
                <button
                  key={p.label}
                  onClick={() => { onChange(p.range); setOpen(false) }}
                  style={{
                    background: active ? 'var(--color-ice-soft)' : 'transparent',
                    color: active ? 'var(--color-ice-light)' : 'var(--color-text-tertiary)',
                    border: `1px solid ${active ? 'rgba(143, 191, 211, 0.32)' : 'var(--color-border)'}`,
                    cursor: 'pointer',
                    fontSize: 10, padding: '4px 10px', borderRadius: 3,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    fontWeight: active ? 700 : 500, transition: 'all 0.15s',
                    boxShadow: active ? '0 0 12px rgba(143, 191, 211, 0.18)' : 'none',
                  }}
                >
                  {p.label}
                </button>
              )
            })}
          </div>

          <div style={{
            borderTop: '1px solid var(--color-divider)',
            paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{
              fontSize: 9, color: 'var(--color-text-muted)', letterSpacing: '0.15em',
              textTransform: 'uppercase', fontWeight: 700, marginBottom: 2,
            }}>
              Intervalo
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', width: 28 }}>de</span>
              <input
                type="date"
                autoComplete="off"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                style={{
                  flex: 1, background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)', fontSize: 11, padding: '4px 6px', borderRadius: 3,
                  outline: 'none', colorScheme: 'dark', fontFamily: 'var(--font-mono)',
                } as any}
              />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', width: 28 }}>até</span>
              <input
                type="date"
                autoComplete="off"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                style={{
                  flex: 1, background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)', fontSize: 11, padding: '4px 6px', borderRadius: 3,
                  outline: 'none', colorScheme: 'dark', fontFamily: 'var(--font-mono)',
                } as any}
              />
            </div>
            <button
              onClick={applyCustom}
              disabled={!customStart || !customEnd || customStart > customEnd}
              style={{
                background: customStart && customEnd && customStart <= customEnd
                  ? 'var(--color-ice-soft)' : 'var(--color-bg-tertiary)',
                color: customStart && customEnd && customStart <= customEnd
                  ? 'var(--color-ice-light)' : 'var(--color-text-muted)',
                border: `1px solid ${customStart && customEnd && customStart <= customEnd
                  ? 'rgba(143, 191, 211, 0.32)' : 'transparent'}`,
                cursor: customStart && customEnd && customStart <= customEnd ? 'pointer' : 'not-allowed',
                fontSize: 10, padding: '6px', borderRadius: 3,
                fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                marginTop: 2,
                boxShadow: customStart && customEnd && customStart <= customEnd
                  ? '0 0 12px rgba(143, 191, 211, 0.18)' : 'none',
              }}
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
