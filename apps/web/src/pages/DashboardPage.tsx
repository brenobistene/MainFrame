import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Info } from 'lucide-react'
import type { Area, Deliverable, Project, Profile, Quest, Routine, Task } from '../types'
import { fetchAllRoutines, fetchDeliverables, fetchTasks, reportApiError } from '../api'
import { getAllBlockRangesForDay } from '../utils/blocks'
import type { UnproductiveBlock } from '../utils/blocks'
import { ProfileEditModal } from '../components/ProfileEditModal'
import { Card } from '../components/ui/Primitives'

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
  // Filtro da seção "Próximas deadlines": null = tudo; 'projeto' ou 'entregável' filtra.
  const [deadlineTypeFilter, setDeadlineTypeFilter] = useState<null | 'projeto' | 'entregável'>(null)

  useEffect(() => {
    try { localStorage.setItem(WINDOW_STORAGE_KEY, JSON.stringify(windowRange)) } catch {}
  }, [windowRange])

  useEffect(() => {
    fetchAllRoutines().then(setRoutines).catch(err => reportApiError('DashboardPage', err))
    fetchTasks().then(setTasks).catch(err => reportApiError('DashboardPage', err))
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
    if (projectIds.length === 0) { setDelivsByProject({}); return }
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
      return { project: p, deliverables: delivs, effectiveDeadline, daysAway, remainingMin, estimatedMin, workedMin, status }
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

  // ─── Render ───────────────────────────────────────────────────────────────

  const overdueTasksCount = tasks.filter(t =>
    !t.done && t.scheduled_date && t.scheduled_date < todayIso
  ).length

  const riskProjects = projectPressures.filter(p =>
    p.status === 'overdue' || p.status === 'impossible' || p.status === 'tight'
  )
  const visibleProjects = showAllProjects ? projectPressures : riskProjects

  // Veredito híbrido: status (por risco) + ação (hoje) + mais urgente.
  const overdueCount = projectPressures.filter(p => p.status === 'overdue').length
  const atRiskCount = projectPressures.filter(p => p.status === 'impossible' || p.status === 'tight').length
  const vereditoColor = overdueCount > 0
    ? 'var(--color-accent-vivid)'
    : atRiskCount > 0
      ? 'var(--color-accent-primary)'
      : 'var(--color-success)'
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

  return (
    <div style={{ color: 'var(--color-text-primary)' }}>
    <Card padding="none" style={{
      animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
    }}>
      {/* Hairline accent — linha sutil oxblood no topo */}
      <div style={{
        height: 1,
        background: 'linear-gradient(90deg, transparent, var(--color-accent-primary), transparent)',
        opacity: 0.5,
      }} />
      {/* Header com gradient sutil */}
      <div style={{
        padding: 'var(--space-5) var(--space-6) var(--space-4)',
        background: `
          radial-gradient(ellipse 100% 80% at 0% 0%, rgba(159, 18, 57, 0.06), transparent 60%),
          linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
        `,
        borderBottom: '1px solid var(--color-divider)',
      }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt={profile.name || 'perfil'}
            onClick={() => setEditingProfile(true)}
            style={{
              width: 40, height: 40, borderRadius: '50%',
              objectFit: 'cover', cursor: 'pointer', flexShrink: 0,
              border: '1px solid var(--color-border)',
            }}
          />
        ) : (
          <button
            onClick={() => setEditingProfile(true)}
            style={{
              width: 40, height: 40, borderRadius: '50%',
              border: '1px dashed var(--color-border)', background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-muted)', cursor: 'pointer',
              fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
            }}
          >
            foto
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            onClick={() => setEditingProfile(true)}
            style={{
              fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em',
              color: profile.name ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              cursor: 'pointer', lineHeight: 1.2,
            }}
          >
            {profile.name || 'seu nome'}
          </div>
          <div
            onClick={() => setEditingProfile(true)}
            style={{
              fontSize: 10, color: 'var(--color-text-tertiary)',
              textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'pointer',
              marginTop: 2,
            }}
          >
            {profile.role || 'seu cargo'}
          </div>
        </div>
        <WindowRangeSelector value={windowRange} onChange={setWindowRange} />
      </header>
      </div>
      <div style={{ padding: 'var(--space-5) var(--space-6)' }}>

      {/* ─── Veredito (sem card, só tipografia) ─── */}
      <section style={{ marginTop: 56, marginBottom: 56 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
          fontSize: 10, color: 'var(--color-text-tertiary)',
          letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600,
        }}>
          {windowRangeLabel(windowRange, todayIso)}
          <span
            title={`Status: conta projetos atrasados (overdue) e em risco (ritmo > ${Math.round(avgDailyCapacityMin / 60 * 10) / 10}h/dia ou deadline em ≤1d).\n\nHoje: soma das horas que você precisa trabalhar hoje se distribuir o tempo restante de cada entregável uniformemente até sua deadline.\n\nMais urgente: item (projeto ou entregável) com a deadline mais próxima.`}
            style={{ display: 'inline-flex', color: 'var(--color-text-muted)', cursor: 'help' }}
          >
            <Info size={11} strokeWidth={1.8} />
          </span>
        </div>

        <div style={{
          fontSize: 32, fontWeight: 700, lineHeight: 1.1,
          color: vereditoColor,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '-0.02em',
        }}>
          {vereditoHeadline}
        </div>

        <div style={{
          marginTop: 14, display: 'flex', flexDirection: 'column', gap: 4,
          fontSize: 13, color: 'var(--color-text-secondary)',
          fontFamily: 'var(--font-mono)',
        }}>
          {todayQuotaMin > 0 ? (
            <div>
              <span style={{
                fontSize: 9, color: 'var(--color-text-muted)',
                letterSpacing: '0.15em', textTransform: 'uppercase', marginRight: 8,
              }}>Hoje</span>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                {fmtHM(todayQuotaMin)}
              </span>
              <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 6 }}>
                pra ficar em dia
              </span>
            </div>
          ) : (
            <div>
              <span style={{
                fontSize: 9, color: 'var(--color-text-muted)',
                letterSpacing: '0.15em', textTransform: 'uppercase', marginRight: 8,
              }}>Hoje</span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>
                sem compromissos
              </span>
            </div>
          )}

          {mostUrgent && (overdueCount > 0 || atRiskCount > 0) && (
            <div>
              <span style={{
                fontSize: 9, color: 'var(--color-text-muted)',
                letterSpacing: '0.15em', textTransform: 'uppercase', marginRight: 8,
              }}>Mais urgente</span>
              <span style={{
                color: mostUrgent.daysAway < 0 ? 'var(--color-accent-vivid)' : 'var(--color-text-primary)',
                fontWeight: 500,
              }}>
                {mostUrgent.title}
              </span>
              <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 6 }}>
                ({urgencyLabel(mostUrgent.daysAway)})
              </span>
            </div>
          )}
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

      {/* ─── Projetos em risco ─── */}
      <section style={{ marginBottom: 56 }}>
        <div style={{
          fontSize: 10, color: 'var(--color-text-tertiary)',
          letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600,
          marginBottom: 18,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          Projetos em risco
          <span
            title="Apenas projetos com status atrasado, impossível ou apertado. Use 'ver todos' pra ver todos os ativos."
            style={{ display: 'inline-flex', color: 'var(--color-text-muted)', cursor: 'help' }}
          >
            <Info size={11} strokeWidth={1.8} />
          </span>
        </div>

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
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
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
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
          >
            só em risco
          </button>
        )}
      </section>

      {/* ─── Próximas deadlines ─── */}
      <section style={{ marginBottom: 48 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, marginBottom: 18, flexWrap: 'wrap',
        }}>
          <div style={{
            fontSize: 10, color: 'var(--color-text-tertiary)',
            letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600,
          }}>
            Próximas deadlines
          </div>
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
                    background: active ? 'var(--color-accent-primary)' : 'none',
                    border: `1px solid ${active ? 'var(--color-accent-primary)' : 'var(--color-border)'}`,
                    cursor: 'pointer',
                    color: active ? 'var(--color-bg-primary)' : 'var(--color-text-tertiary)',
                    padding: '4px 10px', fontSize: 10, fontWeight: 600,
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    borderRadius: 3, fontFamily: 'inherit',
                    transition: 'all 0.15s',
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
                    {deadlinesOutsideWindow} deadline{deadlinesOutsideWindow !== 1 ? 's' : ''} fora da janela — ajuste o intervalo acima pra ver.
                  </span>
                )}
              </div>
            )
          }
          return (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filtered.map((item, idx) => {
              const daysAway = calendarDaysUntil(item.date)
              const dayLabel = daysAway === 0 ? 'hoje'
                : daysAway === 1 ? 'amanhã'
                : daysAway < 0 ? `atrasado ${Math.abs(daysAway)}d`
                : `em ${daysAway}d`
              return (
                <div key={idx} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '10px 0',
                  borderBottom: idx < filtered.length - 1 ? '1px solid var(--color-divider)' : 'none',
                  opacity: item.done ? 0.45 : 1,
                }}>
                  <div style={{
                    width: 56, flexShrink: 0, textAlign: 'left',
                    fontFamily: 'var(--font-mono)',
                    color: item.isOverdue ? 'var(--color-accent-vivid)' : 'var(--color-text-tertiary)',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>
                      {(() => { const [, m, d] = item.date.split('-'); return `${d}/${m}` })()}
                    </div>
                    <div style={{ fontSize: 9, marginTop: 1, opacity: 0.8 }}>{dayLabel}</div>
                  </div>
                  <div style={{ width: 2, height: 22, background: item.color, flexShrink: 0, borderRadius: 1 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 500,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      textDecoration: item.done ? 'line-through' : 'none',
                    }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', marginTop: 2, letterSpacing: '0.05em' }}>
                      <span style={{ textTransform: 'uppercase', color: item.color }}>{item.type}</span>
                      {item.context && <span style={{ marginLeft: 8 }}>· {item.context}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          )
        })()}
      </section>

      {editingProfile && (
        <ProfileEditModal
          profile={profile}
          onClose={() => setEditingProfile(false)}
          onSave={onProfileUpdate}
        />
      )}
      </div>
    </Card>
    </div>
  )
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

/**
 * Linha enxuta de um projeto em risco. Cor de status (vermelho/amarelo) só
 * nos números que comunicam a urgência; o resto é neutro.
 */
function ProjectRiskRow({ pp, areaColor, areaName, onOpen }: { pp: ProjectPressure; areaColor: string; areaName: string; onOpen: () => void }) {
  const severe = pp.status === 'overdue' || pp.status === 'impossible'
  const metricColor = severe
    ? 'var(--color-accent-primary)'
    : pp.status === 'tight'
      ? 'var(--color-warning)'
      : 'var(--color-text-tertiary)'

  const deadlineText = pp.daysAway === null
    ? 'sem prazo'
    : pp.daysAway < 0
      ? `${Math.abs(pp.daysAway)}d atrasado`
      : pp.daysAway === 0
        ? 'hoje'
        : pp.daysAway === 1
          ? 'amanhã'
          : `em ${pp.daysAway}d`

  const pct = pp.estimatedMin > 0
    ? Math.round((pp.workedMin / pp.estimatedMin) * 100)
    : null

  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 10px', margin: '0 -10px',
        borderBottom: '1px solid var(--color-divider)',
        cursor: 'pointer', borderRadius: 3,
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-tertiary)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ width: 2, height: 32, background: areaColor, flexShrink: 0, borderRadius: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          lineHeight: 1.2,
        }}>
          {pp.project.title}
        </div>
        <div style={{
          fontSize: 9, color: areaColor, marginTop: 3,
          letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600,
        }}>
          {areaName}
        </div>
      </div>
      <div style={{
        display: 'flex', gap: 16, alignItems: 'baseline', flexShrink: 0,
        fontSize: 11, fontFamily: 'var(--font-mono)',
        color: 'var(--color-text-tertiary)',
      }}>
        <span style={{ color: metricColor, fontWeight: 600 }}>{deadlineText}</span>
        {pp.remainingMin > 0 && (
          <span style={{ color: metricColor }}>
            {fmtHM(pp.remainingMin)} pendente
          </span>
        )}
        {pct !== null && (
          <span style={{ minWidth: 36, textAlign: 'right' }}>{pct}%</span>
        )}
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
                    background: active ? 'var(--color-accent-primary)' : 'transparent',
                    color: active ? 'var(--color-bg-primary)' : 'var(--color-text-tertiary)',
                    border: `1px solid ${active ? 'var(--color-accent-primary)' : 'var(--color-border)'}`,
                    cursor: 'pointer',
                    fontSize: 10, padding: '4px 10px', borderRadius: 3,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    fontWeight: active ? 700 : 500, transition: 'all 0.15s',
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
                  ? 'var(--color-accent-primary)' : 'var(--color-bg-tertiary)',
                color: customStart && customEnd && customStart <= customEnd
                  ? 'var(--color-bg-primary)' : 'var(--color-text-muted)',
                border: 'none',
                cursor: customStart && customEnd && customStart <= customEnd ? 'pointer' : 'not-allowed',
                fontSize: 10, padding: '6px', borderRadius: 3,
                fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                marginTop: 2,
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
