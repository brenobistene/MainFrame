import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Sunrise, Sun, Moon, X, ArrowRight, Calendar as CalendarIcon, Trash2, AlertTriangle, Search, Play } from 'lucide-react'
import type { ActiveSession, Area, BuildRitual, Deliverable, Project, Quest, Routine, Task } from '../types'
import { fetchDeliverables, updateTask, deleteTask, reportApiError } from '../api'
import { useTasks, useRoutines, useRoutinesForDate, useAppInvalidator } from '../lib/app-queries'
import {
  useDiaPendencias,
  useInvalidateDiaPendencias,
  useDiscardHealthItemSession,
  useDiscardMindSession,
  useHealthItemSession,
  useLinkHealthItemSessionToRecord,
  useLinkMindSessionToRecord,
  useMindSession,
  usePauseHealthItemSession,
  usePauseMindSession,
  useResumeHealthItemSession,
  useResumeMindSession,
  useStartHealthItemSession,
  useStartMindSession,
} from '../lib/dia-queries'
import type { DiaSessionCluster } from '../api'

type DiaSessionClusterLike = DiaSessionCluster
import { useRituals } from '../lib/build-queries'
import { tabSync } from '../lib/tabsync'
import { confirmDialog } from '../lib/dialog'
import MindRegisterModal from '../components/mind/MindRegisterModal'
import RegisterModal from '../components/health/RegisterModal'
import { isoToLocalYmd } from '../utils/datetime'
import { effectiveQuestDeadline } from '../utils/quests'
import type { DateRange } from '../utils/dateRange'
import { computeRange } from '../utils/dateRange'
import type { DayPeriods } from '../utils/dayPeriods'
import { loadDayPeriods, periodRangesMinFrom, minutesToHHMM } from '../utils/dayPeriods'
import type { BlockRange } from '../utils/blocks'
import { getAllBlockRangesForDay } from '../utils/blocks'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { DayPeriodsEditModal } from '../components/DayPeriodsEditModal'
import { PlannedItemRow } from '../components/PlannedItemRow'
import { modalHeader } from './finance/components/styleHelpers'
import { PageShell, TechId, DataReadoutFrame } from '../components/ui/CyberShell'
import { DiaPendenciasBlock } from '../components/DiaPendenciasBlock'

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtHM(min: number): string {
  const abs = Math.max(0, Math.round(Math.abs(min)))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

/** Normaliza string pra busca: lowercase + remove acentos. Assim "sessao"
 *  bate em "Sessão" sem o usuário precisar digitar o til. */
function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function itemDurationMin(item: any): number {
  if (item.isTask) return item.duration_minutes ?? 0
  if (item.isRitual) return item.duracao_alvo_min ?? 0
  // quests e rotinas usam estimated_minutes.
  return item.estimated_minutes ?? 0
}

/** Formata data YYYY-MM-DD como DD/MM (local), pra tooltips de deadline. */
function fmtShortDate(iso: string): string {
  try {
    const parts = iso.split('T')[0].split('-').map(Number)
    const m = parts[1]
    const d = parts[2]
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
  } catch {
    return iso
  }
}

/**
 * Monta o tooltip explicando o aviso de prazo apertado. Recebe a cadeia de
 * entregáveis futuros que vencem muito próximo uns dos outros e descreve por
 * que o usuário está vendo o ícone: pra alertar que não vai dar tempo de
 * fechar um entregável antes do próximo começar a pressionar.
 */
function buildTightChainTooltip(
  chain: Array<{ title: string; deadline: string; daysFromActive: number }>,
): string {
  if (chain.length === 0) return 'Prazo apertado entre entregáveis'
  const header = chain.length === 1
    ? 'Prazo apertado — o próximo entregável deste projeto vence logo em seguida:'
    : `Prazo apertado — ${chain.length} entregáveis deste projeto vencem muito próximos:`
  const lines = chain.map(c => {
    const days = c.daysFromActive
    const when = days <= 0 ? 'no mesmo dia' : `em ${days} dia${days === 1 ? '' : 's'}`
    return `• "${c.title}" — vence ${fmtShortDate(c.deadline)} (${when})`
  })
  return [header, ...lines, '', 'Planeje com antecedência — não vai dar pra fechar um antes do próximo chegar.'].join('\n')
}

/**
 * `/dia` — planejamento diário. Uma linha de veredito no topo ("planejado
 * X de Y disponíveis"), drawer de planejamento com drag-and-drop (filtros +
 * split disponíveis × períodos), e três blocos minimalistas pra manhã/tarde/
 * noite. Persiste plano em `hq-day-plan` (localStorage).
 */
export function DiaView({ projects, quests, areas, activeSession, onSessionUpdate, onSelectProject }: {
  projects: Project[]
  quests: Quest[]
  areas: Area[]
  activeSession: ActiveSession | null
  onSessionUpdate: () => void
  onSelectProject: (id: string | null) => void
}) {
  const navigate = useNavigate()
  const appInv = useAppInvalidator()
  // Routines via React Query — substituiu useState + fetchAllRoutines.
  const routinesQ = useRoutines()
  const routines: Routine[] = routinesQ.data ?? []
  // Rituais (Build) — agendáveis pelos períodos do dia. `ritual.ultima_execucao`
  // diz se já foi cumprido hoje (vem do backend, calculado por session).
  const ritualsQ = useRituals()
  const rituals: BuildRitual[] = ritualsQ.data ?? []
  // Pendências do dia (Mind + health_items diários). Cards arrastáveis no
  // pool de itens disponíveis. Doc: routers/dia.py.
  const todayIso = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const { data: diaPendencias = [] } = useDiaPendencias(todayIso)
  const invalidateDia = useInvalidateDiaPendencias()
  // Modal aberto a partir de pendência (Mind ou Health register). null =
  // fechado. Após fechar com save, invalida pendências → some da lista.
  type PendenciaPrefill = {
    started_at: string
    ended_at: string | null
    duracao_min: number
  } | undefined
  const [openPendenciaModal, setOpenPendenciaModal] = useState<
    | { type: 'mind'; prefill: PendenciaPrefill }
    | { type: 'health_register'; domain: any; cor: string; item_id: number; prefill: PendenciaPrefill }
    | null
  >(null)
  const linkMindToRecord = useLinkMindSessionToRecord()
  const linkHealthItemToRecord = useLinkHealthItemSessionToRecord()
  const [showPlanner, setShowPlanner] = useState(false)
  const [plannerRange, setPlannerRange] = useState<DateRange>(() => computeRange('7d'))
  const [plannerTypes, setPlannerTypes] = useState<Set<'quest' | 'task' | 'routine' | 'ritual' | 'mind' | 'health'>>(
    new Set(['quest', 'task', 'routine', 'ritual', 'mind', 'health'])
  )
  const [plannerIncludeUndated, setPlannerIncludeUndated] = useState(true)
  // Mostrar quests de TODOS os entregáveis (não só o ativo de cada projeto).
  // Default false — mantém o filtro padrão "só o entregável corrente".
  // Quando ativo, libera puxar trabalho de entregáveis futuros do mesmo
  // projeto (útil quando você quer adiantar uma quest de um entregável
  // que ainda não está em execução).
  const [plannerShowAllDeliverables, setPlannerShowAllDeliverables] = useState(false)
  // Filtro de prioridade: `null` = sem filtro; Set de prioridades = só essas.
  // Default: todas habilitadas.
  const [plannerPriorities, setPlannerPriorities] = useState<Set<string>>(
    new Set(['critical', 'high', 'medium', 'low'])
  )
  const [dayPeriods, setDayPeriods] = useState<DayPeriods>(() => loadDayPeriods())
  const [editingPeriods, setEditingPeriods] = useState(false)
  // Storage por dia: `hq-day-plan-YYYY-MM-DD`. Dia novo começa com slots
  // vazios — o que ficou pendente cai no banner de revisão ao invés de virar
  // lixo arrastado.
  const todayIsoForStorage = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const dayPlanKey = `hq-day-plan-${todayIsoForStorage}`
  const [dayPlan, setDayPlan] = useState<{ morning: string[]; afternoon: string[]; evening: string[] }>(() => {
    // Migra o antigo `hq-day-plan` pro slot de hoje na primeira carga.
    const todayScoped = localStorage.getItem(dayPlanKey)
    if (todayScoped) return JSON.parse(todayScoped)
    const legacy = localStorage.getItem('hq-day-plan')
    if (legacy) {
      try { localStorage.setItem(dayPlanKey, legacy) } catch {}
      localStorage.removeItem('hq-day-plan')
      return JSON.parse(legacy)
    }
    return { morning: [], afternoon: [], evening: [] }
  })
  // Metadata de migração: pra cada item migrado entre turnos no dia,
  // guardamos o turno de origem. Persistido em localStorage por data,
  // simétrico ao dayPlan. Usado pra exibir "↑ veio da manhã" no card.
  const migratedKey = `hq-day-plan-migrated-${todayIsoForStorage}`
  const [migratedFrom, setMigratedFrom] = useState<Record<string, 'morning' | 'afternoon' | 'evening'>>(() => {
    try {
      const saved = localStorage.getItem(migratedKey)
      return saved ? JSON.parse(saved) : {}
    } catch { return {} }
  })
  const [draggedItem, setDraggedItem] = useState<any>(null)
  // Tasks via React Query.
  const allTasksQ = useTasks()
  const allTasks: Task[] = allTasksQ.data ?? []
  const [delivsByProject, setDelivsByProject] = useState<Record<string, Deliverable[]>>({})

  const todayIsoForTasks = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const todayLabel = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  // Rotinas resolvidas pra hoje (com `done` já marcado pelo backend) — usado
  // pra construir o Set de doneRoutineIds.
  const routinesForTodayQ = useRoutinesForDate(todayIsoForTasks)
  const doneRoutineIds: Set<string> = new Set(
    (routinesForTodayQ.data ?? []).filter(r => r.done).map(r => r.id)
  )

  // Gate de "tudo carregou pelo menos uma vez". Sem isso, mount inicial roda
  // a migração de turno com dados vazios → itens DONE caem como pendentes →
  // são jogados pro próximo turno. Bug user-visible.
  // React Query expõe `isFetched` que vira true após o primeiro fetch
  // (sucesso ou erro), exatamente a semântica que precisamos.
  const routinesLoaded = routinesQ.isFetched
  const allTasksLoaded = allTasksQ.isFetched
  const doneRoutineIdsLoaded = routinesForTodayQ.isFetched

  // Re-invalida tasks e rotinas-do-dia quando sessão ativa muda — finalização
  // via banner marca como done no backend, mas o cache local não atualiza
  // sozinho até a próxima leitura. (Fetch inicial é feito pelos hooks.)
  useEffect(() => {
    appInv.tasks()
    appInv.routines()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.type, activeSession?.id, activeSession?.started_at, activeSession?.ended_at])

  useEffect(() => {
    const projectIds = Array.from(new Set(quests.filter(q => q.project_id).map(q => q.project_id!)))
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
  }, [quests.map(q => q.id + ':' + (q.deliverable_id ?? '') + ':' + (q.project_id ?? '')).join(',')])

  // Midnight rollover guard: se a aba ficar aberta atravessando 00:00, o
  // `dayPlanKey` muda (ontem→hoje) mas o estado em memória ainda é o de
  // ontem. Sem guard, o save effect escreveria as atividades de ontem no
  // slot de hoje. Solução: detectamos via useRef que a chave mudou,
  // recarregamos do novo slot (vazio se nunca planejou) e PULAMOS o save
  // nesse ciclo. Mesmo padrão pro `migratedFrom`.
  const prevDayPlanKey = useRef(dayPlanKey)
  useEffect(() => {
    if (prevDayPlanKey.current !== dayPlanKey) {
      prevDayPlanKey.current = dayPlanKey
      try {
        const saved = localStorage.getItem(dayPlanKey)
        setDayPlan(saved ? JSON.parse(saved) : { morning: [], afternoon: [], evening: [] })
      } catch {
        setDayPlan({ morning: [], afternoon: [], evening: [] })
      }
      return
    }
    localStorage.setItem(dayPlanKey, JSON.stringify(dayPlan))
  }, [dayPlan, dayPlanKey])

  const prevMigratedKey = useRef(migratedKey)
  useEffect(() => {
    if (prevMigratedKey.current !== migratedKey) {
      prevMigratedKey.current = migratedKey
      try {
        const saved = localStorage.getItem(migratedKey)
        setMigratedFrom(saved ? JSON.parse(saved) : {})
      } catch {
        setMigratedFrom({})
      }
      return
    }
    localStorage.setItem(migratedKey, JSON.stringify(migratedFrom))
  }, [migratedFrom, migratedKey])

  // Limpa plans de dias passados pra não acumular lixo no localStorage.
  // (Mantém os últimos 7 dias por segurança — não precisa ser agressivo.)
  useEffect(() => {
    try {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 7)
      const cutoffIso = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key || !key.startsWith('hq-day-plan-')) continue
        const keyDate = key.slice('hq-day-plan-'.length)
        if (keyDate < cutoffIso) localStorage.removeItem(key)
      }
    } catch {}
  }, [])

  function routineAppliesInRange(r: Routine, from: Date | null, to: Date | null): boolean {
    if (!from || !to) return true
    const cur = new Date(from); cur.setHours(0, 0, 0, 0)
    const end = new Date(to); end.setHours(0, 0, 0, 0)
    while (cur <= end) {
      const jsDow = cur.getDay()
      const pyDow = (jsDow + 6) % 7
      if (r.recurrence === 'daily') return true
      if (r.recurrence === 'weekdays' && jsDow >= 1 && jsDow <= 5) return true
      if (r.recurrence === 'weekly') {
        if (r.days_of_week) {
          const days = r.days_of_week.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
          if (days.includes(pyDow)) return true
        } else if (r.day_of_week !== null && r.day_of_week !== undefined) {
          if (r.day_of_week === pyDow) return true
        }
      }
      if (r.recurrence === 'monthly' && r.day_of_month === cur.getDate()) return true
      cur.setDate(cur.getDate() + 1)
    }
    return false
  }

  const getFilteredItems = () => {
    const fromIso = plannerRange.from ? isoToLocalYmd(plannerRange.from) : null
    const toIso = plannerRange.to ? isoToLocalYmd(plannerRange.to) : null
    const isUnbounded = !fromIso || !toIso
    const withinRange = (iso: string | null | undefined): boolean => {
      if (!iso) return plannerIncludeUndated
      if (isUnbounded) return true
      return iso >= fromIso! && iso <= toIso!
    }

    const priorityOK = (p: string | undefined | null) => plannerPriorities.has(p || 'critical')

    const items: any[] = []
    if (plannerTypes.has('quest')) {
      // Só quests filhas (subtasks) aparecem no planejador. Projetos são
      // containers — você planeja o trabalho granular (as quests dentro
      // deles), não o projeto em si. Herdam a deadline do projeto se a
      // subtask não tem uma própria.
      //
      // Pra evitar que o drawer fique poluído com 30+ quests do mesmo projeto,
      // filtramos: só aparecem quests do ENTREGÁVEL ATIVO de cada projeto
      // (= próximo entregável não-done, por deadline asc → sort_order asc).
      // Quests de entregáveis futuros ficam escondidas até o atual ser feito.
      //
      // Além disso, se o próximo entregável do mesmo projeto vence em menos
      // de TIGHT_DEADLINE_GAP_DAYS, anexamos `nextDelivTight` pra UI mostrar
      // um aviso — sinal de que não vai dar pra fechar um antes do outro.
      const TIGHT_DEADLINE_GAP_DAYS = 5

      const rankDeliv = (d: Deliverable): [number, number] => {
        // asc deadline (nulls last), depois sort_order asc.
        const deadlineKey = d.deadline ? new Date(d.deadline).getTime() : Number.MAX_SAFE_INTEGER
        return [deadlineKey, d.sort_order ?? 0]
      }
      const sortByRank = (a: Deliverable, b: Deliverable) => {
        const [ad, as] = rankDeliv(a)
        const [bd, bs] = rankDeliv(b)
        return ad !== bd ? ad - bd : as - bs
      }

      // Cache por projeto: entregável ativo + cadeia de "próximos apertados".
      // Cadeia = sequência de entregáveis em que cada um vence < TIGHT dias
      // após o anterior. Ex: ativo dia 10, próximos dia 12 e 14 → ambos entram
      // (12 - 10 = 2, 14 - 12 = 2). Se o terceiro fosse dia 20, só o segundo
      // entraria (20 - 14 = 6 ≥ 5). Permite o tooltip mostrar "múltiplos
      // entregáveis colados", não só o imediato.
      const projectActiveInfo = new Map<string, {
        activeId: string
        tightChain: Array<{ title: string; deadline: string; daysFromActive: number }>
      }>()
      const allProjectIdsInPool = new Set(
        quests
          .filter(q => q.project_id && q.status !== 'done' && q.status !== 'cancelled')
          .map(q => q.project_id as string),
      )
      for (const pid of allProjectIdsInPool) {
        const delivs = (delivsByProject[pid] || [])
          .filter(d => !d.done)
          .sort(sortByRank)

        let activeId: string | null = null
        const tightChain: Array<{ title: string; deadline: string; daysFromActive: number }> = []

        if (delivs.length > 0) {
          const active = delivs[0]
          activeId = active.id
          if (active.deadline) {
            const activeMs = new Date(active.deadline).getTime()
            let prevMs = activeMs
            for (let i = 1; i < delivs.length; i++) {
              const d = delivs[i]
              if (!d.deadline) break
              const curMs = new Date(d.deadline).getTime()
              const gapFromPrev = Math.round((curMs - prevMs) / 86_400_000)
              if (gapFromPrev >= TIGHT_DEADLINE_GAP_DAYS) break
              const daysFromActive = Math.round((curMs - activeMs) / 86_400_000)
              tightChain.push({ title: d.title, deadline: d.deadline, daysFromActive })
              prevMs = curMs
            }
          }
        } else {
          // Fallback: nenhum deliverable carregado pra esse projeto (fetch
          // pendente, erro silencioso, ou schema inconsistente). Em vez de
          // liberar TODAS as quests — que é o que derrotava o filtro —
          // escolhemos um `activeId` a partir das próprias quests: o
          // deliverable_id da quest ativa com menor deadline (fallback
          // `next_action` por ordem de aparição). Determinístico, e garante
          // que só quests de um deliverable por projeto apareçam.
          const questsOfProject = quests.filter(q =>
            q.project_id === pid
            && q.status !== 'done'
            && q.status !== 'cancelled'
            && q.deliverable_id,
          )
          if (questsOfProject.length > 0) {
            const sortedQuests = [...questsOfProject].sort((a, b) => {
              const ad = a.deadline ? new Date(a.deadline).getTime() : Number.MAX_SAFE_INTEGER
              const bd = b.deadline ? new Date(b.deadline).getTime() : Number.MAX_SAFE_INTEGER
              return ad - bd
            })
            activeId = sortedQuests[0].deliverable_id!
          }
        }

        if (activeId) {
          projectActiveInfo.set(pid, { activeId, tightChain })
        }
      }

      // DEBUG temporário — logar decisões do filtro pra diagnosticar por que
      // quests de múltiplos entregáveis estão passando. Remove depois.
      // eslint-disable-next-line no-console
      console.log('[planner-filter] projectActiveInfo:', Array.from(projectActiveInfo.entries()).map(([pid, info]) => ({
        pid,
        activeId: info.activeId,
        delivsLoaded: (delivsByProject[pid] || []).length,
        openDelivs: (delivsByProject[pid] || []).filter(d => !d.done).length,
      })))
      // eslint-disable-next-line no-console
      console.log('[planner-filter] quests pool por projeto:',
        Object.entries(
          quests
            .filter(q => q.project_id && q.status !== 'done' && q.status !== 'cancelled')
            .reduce((acc: Record<string, any[]>, q) => {
              const pid = q.project_id as string
              acc[pid] = acc[pid] || []
              acc[pid].push({ qid: q.id, deliv: q.deliverable_id, status: q.status, title: q.title?.slice(0, 30) })
              return acc
            }, {})
        )
      )

      // DEBUG: contadores pra ver onde o filtro "dispara vs esconde"
      let counters = { total: 0, byProjectNull: 0, byStatusDone: 0, byRange: 0, byPriority: 0, byNoInfo: 0, byMismatchDeliv: 0, passed: 0 }
      const passedSamples: any[] = []
      const filteredQuests = quests.filter(q => {
        counters.total++
        if (!q.project_id) { counters.byProjectNull++; return false }
        if (q.status === 'done' || q.status === 'cancelled') { counters.byStatusDone++; return false }
        // Quest não tem deadline própria por design — herda do entregável
        // (e, em fallback, do projeto). Se nenhum dos dois tiver deadline,
        // cai no checkbox "incluir sem data" via withinRange.
        const effectiveDl = effectiveQuestDeadline(q, delivsByProject, projects)
        if (!withinRange(effectiveDl)) { counters.byRange++; return false }
        if (!priorityOK(q.priority)) { counters.byPriority++; return false }
        const info = projectActiveInfo.get(q.project_id)
        if (!info) { counters.byNoInfo++; return false }
        // Bypass do filtro "só entregável ativo" quando o user liga
        // "mostrar todos os entregáveis" — útil pra puxar quests de
        // entregáveis futuros do mesmo projeto.
        if (!plannerShowAllDeliverables && q.deliverable_id !== info.activeId) {
          counters.byMismatchDeliv++; return false
        }
        counters.passed++
        if (passedSamples.length < 30) passedSamples.push({ project: q.project_id, deliv: q.deliverable_id, title: q.title?.slice(0, 40) })
        return true
      })
      // eslint-disable-next-line no-console
      console.log('[planner-filter] counters:', counters)
      // eslint-disable-next-line no-console
      console.log('[planner-filter] passed sample (até 30):', passedSamples)

      items.push(...filteredQuests
        .map(q => {
          const info = q.project_id ? projectActiveInfo.get(q.project_id) : null
          return info
            ? { ...q, tightChain: info.tightChain }
            : q
        }),
      )
    }
    if (plannerTypes.has('task')) {
      items.push(...allTasks.filter(t => !t.done && withinRange(t.scheduled_date) && priorityOK((t as any).priority)).map(t => ({ ...t, isTask: true })))
    }
    if (plannerTypes.has('routine')) {
      items.push(...routines.filter(r => routineAppliesInRange(r, plannerRange.from, plannerRange.to) && priorityOK((r as any).priority))
        .map(r => ({ ...r, isRoutine: true, done: doneRoutineIds.has(r.id) })))
    }
    if (plannerTypes.has('ritual')) {
      // Rituais ativos filtrados pela janela do planner.
      //  - Atrasados (dias_atraso > 0) sempre aparecem — são pendência viva
      //    que precisa de slot independente da janela escolhida.
      //  - Senão, só aparecem se a próxima execução prevista (proxima_data)
      //    cai dentro do range. Ritual semanal com proxima_data daqui 30 dias
      //    não deve aparecer no planner de hoje.
      //  - `done` quando ultima_execucao == hoje (ciclo cumprido).
      //  - Rituais não têm priority — bypass do priorityOK.
      items.push(...rituals
        .filter(r => {
          if (!r.ativo) return false
          if (r.dias_atraso > 0) return true
          return withinRange(r.proxima_data)
        })
        .map(r => ({
          ...r,
          id: `ritual:${r.cadencia}`,
          title: r.nome || `Ritual ${r.cadencia}`,
          isRitual: true,
          done: r.ultima_execucao ? r.ultima_execucao.slice(0, 10) === todayIso : false,
        })))
    }
    // Pendências (Mind / health_items diários). Não tem deadline nem
    // scheduled_date — sempre "hoje" no contexto do agregador. Filtra por
    // origem pra respeitar os chips do planner (mind vs health).
    if (plannerTypes.has('mind') || plannerTypes.has('health')) {
      for (const p of diaPendencias) {
        if (p.origem === 'mind' && !plannerTypes.has('mind')) continue
        if (p.origem === 'health_item' && !plannerTypes.has('health')) continue
        items.push({
          id: p.pendencia_id,
          title: p.titulo,
          estimated_minutes: p.duracao_min ?? 0,
          isPendencia: true,
          origem: p.origem,
          modal_type: p.modal_type,
          target: p.target,
          cor: p.cor,
          horario_sugerido: p.horario_sugerido,
          done: false,
        })
      }
    }

    return items.sort((a, b) => {
      // Pendências vão pro fim — depois de quests/tasks/routines, antes
      // de tudo desordenar.
      if (a.isPendencia && !b.isPendencia) return 1
      if (!a.isPendencia && b.isPendencia) return -1
      if (a.isRoutine && !b.isRoutine) return 1
      if (!a.isRoutine && b.isRoutine) return -1
      const ad = (a as any).deadline ?? (a as any).scheduled_date ?? ''
      const bd = (b as any).deadline ?? (b as any).scheduled_date ?? ''
      return String(ad).localeCompare(String(bd))
    })
  }

  // Tasks atrasadas: agendadas num dia passado e ainda não feitas. Rotinas
  // ficam fora (cada dia é instância nova). Quests ficam fora (não têm data).
  const overdueTasks = allTasks.filter(t =>
    !t.done && t.scheduled_date && t.scheduled_date < todayIsoForTasks
  ).sort((a, b) => (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? ''))

  function handleTaskToToday(t: Task) {
    updateTask(t.id, { scheduled_date: todayIsoForTasks })
      .then(() => { appInv.tasks(); tabSync.emit('tasks') })
      .catch(err => reportApiError('DiaPage', err))
  }
  function handleTaskReschedule(t: Task, newDate: string) {
    if (!newDate) return
    updateTask(t.id, { scheduled_date: newDate })
      .then(() => { appInv.tasks(); tabSync.emit('tasks') })
      .catch(err => reportApiError('DiaPage', err))
  }
  async function handleTaskDiscard(t: Task) {
    const ok = await confirmDialog({
      title: 'Descartar tarefa',
      message: `Descartar "${t.title}"?\nA tarefa será excluída.`,
      confirmLabel: 'DESCARTAR',
      danger: true,
    })
    if (!ok) return
    deleteTask(t.id)
      .then(() => { appInv.tasks(); tabSync.emit('tasks') })
      .catch(err => reportApiError('DiaPage', err))
  }

  const filteredItems = getFilteredItems()
  const plannedItemIds = [...dayPlan.morning, ...dayPlan.afternoon, ...dayPlan.evening]
  // Pool completo (ignora filtros do planner) pra contar tudo que está no dia.
  // Pendências (Mind + health_items diários) entram como cards com flag
  // `isPendencia` — arrastáveis igual quests/tasks/routines.
  const fullPool: any[] = [
    ...quests.filter(q => q.status !== 'done'),
    ...allTasks.filter(t => !t.done).map(t => ({ ...t, isTask: true })),
    ...routines.map(r => ({ ...r, isRoutine: true, done: doneRoutineIds.has(r.id) })),
    ...diaPendencias.map(p => ({
      id: p.pendencia_id,
      title: p.titulo,
      // Mapeia campos pra interface comum do pool — itemDurationMin lê
      // estimated_minutes, sort pra esse fim.
      estimated_minutes: p.duracao_min ?? 0,
      isPendencia: true,
      origem: p.origem,
      modal_type: p.modal_type,
      target: p.target,
      cor: p.cor,
      horario_sugerido: p.horario_sugerido,
      // done sempre false aqui — se foi feita, backend já tira da lista
      done: false,
    })),
  ]
  const plannedItems = fullPool.filter(item => plannedItemIds.includes(item.id))
  const questCount = plannedItems.filter(i => !i.isTask && !i.isRoutine).length
  const taskCount = plannedItems.filter(i => i.isTask).length
  const routineCount = plannedItems.filter(i => i.isRoutine).length

  // ─── Live counter: recalcula a cada minuto com base no relógio atual. ─────
  // Capacidade restante = do "agora" até o fim do último período (subtraindo
  // blocos improdutivos que caem depois do agora). Pendente = itens ainda não
  // feitos. Folga agora = restante − pendente.
  const [nowTick, setNowTick] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const nowDate = new Date(nowTick)
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes()

  // ─── Auto-migração de turno encerrado pra próximo turno aberto ───────────
  // Atividades pendentes (não-feitas, não-em-execução) num turno cujo `endMin`
  // já passou são movidas pra próximo turno aberto, em cadeia. A intenção é
  // manter o plano "executável" sem o user precisar arrastar manualmente.
  // Se NENHUM turno seguinte estiver aberto (ex: já é noite), a atividade
  // fica onde está — coerente com o reset natural do dayPlan no novo dia.
  useEffect(() => {
    // GATE: não migra até todas as fontes de "done" terem carregado pelo
    // menos uma vez. Sem isso, mount inicial roda com Sets/arrays vazios
    // (default state), itemIsDone retorna false pra tudo, e items DONE
    // são jogados pro próximo turno. Bug user-visible.
    if (!routinesLoaded || !doneRoutineIdsLoaded || !allTasksLoaded) return

    const periodRangesMin = periodRangesMinFrom(dayPeriods)
    const order: Array<'morning' | 'afternoon' | 'evening'> = ['morning', 'afternoon', 'evening']

    const itemIsActive = (id: string): boolean =>
      !!activeSession && activeSession.id === id && activeSession.is_active

    // Resolução do item via 3 stores. Após o gate acima, sabemos que todos
    // foram fetchados pelo menos uma vez — então findItem não retornar
    // significa "item não existe mais" (deletado, cancelado), e migrar
    // ele não faz sentido. Conservador: stays.
    const findItem = (id: string) => {
      const q = quests.find(x => x.id === id); if (q) return { kind: 'quest' as const, q }
      const t = allTasks.find(x => x.id === id); if (t) return { kind: 'task' as const, t }
      const r = routines.find(x => x.id === id); if (r) return { kind: 'routine' as const, r }
      return null
    }
    const itemIsDone = (id: string): boolean => {
      const it = findItem(id)
      if (!it) return false
      if (it.kind === 'quest') return it.q.status === 'done' || it.q.status === 'cancelled'
      if (it.kind === 'task') return !!it.t.done
      return doneRoutineIds.has(id)
    }

    setDayPlan(prev => {
      const next = { morning: [...prev.morning], afternoon: [...prev.afternoon], evening: [...prev.evening] }
      const newMigrated: Record<string, 'morning' | 'afternoon' | 'evening'> = { ...migratedFrom }
      let changed = false

      for (let i = 0; i < order.length - 1; i++) {
        const period = order[i]
        const [, endMin] = periodRangesMin[period]
        if (nowMin < endMin) continue  // turno ainda aberto

        // Acha próximo turno ainda aberto.
        let targetIdx = -1
        for (let j = i + 1; j < order.length; j++) {
          const [, nextEnd] = periodRangesMin[order[j]]
          if (nowMin < nextEnd) { targetIdx = j; break }
        }
        if (targetIdx < 0) continue  // todos seguintes já encerrados também

        const target = order[targetIdx]
        const stayingHere: string[] = []
        for (const id of next[period]) {
          // Conservador: só migra se o item é conhecido E está pendente.
          // Item desconhecido (dados ainda carregando) ou done/ativo fica.
          if (!findItem(id) || itemIsActive(id) || itemIsDone(id)) {
            stayingHere.push(id)
            continue
          }
          // Migra pro destino: preserva origem original (se já era migrada
          // de manhã pra tarde, e agora vai pra noite, mantém "manhã").
          if (!newMigrated[id]) newMigrated[id] = period
          if (!next[target].includes(id)) next[target].push(id)
          changed = true
        }
        next[period] = stayingHere
      }

      if (changed) {
        // Limpa metadata de itens que saíram do plano de algum jeito (deletados, etc).
        const allInPlan = new Set([...next.morning, ...next.afternoon, ...next.evening])
        for (const id of Object.keys(newMigrated)) {
          if (!allInPlan.has(id)) delete newMigrated[id]
        }
        setMigratedFrom(newMigrated)
        return next
      }
      return prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // NOTA: activeSession FORA dos deps de propósito. Quando o user finaliza
    // task/rotina, `setActiveSession(null)` (App.tsx) chega antes dos fetches
    // de tasks/routines completarem — re-rodar aqui imediatamente leria dados
    // stale (item ainda como pendente) e migraria o que acabou de virar done.
    // Confiamos em: (a) tick de nowMin a cada minuto, (b) mudanças nas arrays
    // de dados — qualquer um cobre o caso. itemIsActive usa o closure atual de
    // activeSession, que é refrescado em todo render mesmo sem estar nos deps.
  }, [nowMin, dayPeriods, quests, allTasks, routines, doneRoutineIds, routinesLoaded, doneRoutineIdsLoaded, allTasksLoaded])

  const productiveMinRemaining = (() => {
    let blockRanges: BlockRange[] = []
    try {
      const saved = localStorage.getItem('hq-unproductive-blocks')
      if (saved) blockRanges = getAllBlockRangesForDay(JSON.parse(saved), nowDate)
    } catch {}
    const periodRangesMin = periodRangesMinFrom(dayPeriods)
    let total = 0
    for (const period of ['morning', 'afternoon', 'evening'] as const) {
      const [startMin, endMin] = periodRangesMin[period]
      const effStart = Math.max(startMin, nowMin)
      if (effStart >= endMin) continue  // período já passou
      const windowMin = endMin - effStart
      const unproductiveInRemaining = blockRanges.reduce((sum, r) => {
        const blockStartMin = r.start * 60
        const blockEndMin = r.end * 60
        const overlapStart = Math.max(blockStartMin, effStart)
        const overlapEnd = Math.min(blockEndMin, endMin)
        return sum + Math.max(0, overlapEnd - overlapStart)
      }, 0)
      total += Math.max(0, windowMin - unproductiveInRemaining)
    }
    return total
  })()

  // Pendente = itens no plano que ainda não foram marcados como feitos.
  const pendingMin = plannedItems
    .filter(it => !(it.status === 'done' || it.done === true))
    .reduce((s, it) => s + itemDurationMin(it), 0)
  const liveSlackMin = productiveMinRemaining - pendingMin
  const liveDeficit = liveSlackMin < 0
  const liveColor = liveDeficit
    ? 'var(--color-accent-primary)'
    : productiveMinRemaining > 0 && pendingMin / Math.max(1, productiveMinRemaining) > 0.75
      ? 'var(--color-warning)'
      : 'var(--color-success)'

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <PageShell
      headerLabel="DIA"
      headerLeftContent={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 14, fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--color-text-primary)',
            lineHeight: 1.1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {todayLabel}
          </span>
          <TechId>SCHED.LIVE · {String(nowDate.getHours()).padStart(2, '0')}:{String(nowDate.getMinutes()).padStart(2, '0')}</TechId>
        </div>
      }
      headerRightControls={
        <>
          <button
            onClick={() => setEditingPeriods(true)}
            title={`Ajustar períodos do dia · Manhã ${minutesToHHMM(dayPeriods.morningStart)} · Tarde ${minutesToHHMM(dayPeriods.afternoonStart)} · Noite ${minutesToHHMM(dayPeriods.eveningStart)}`}
            style={{
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              padding: '6px 10px',
              letterSpacing: '0.18em', textTransform: 'uppercase',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
              e.currentTarget.style.color = 'var(--color-ice-light)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.color = 'var(--color-text-tertiary)'
            }}
          >
            // PERIODS
          </button>
          <button
            onClick={() => setShowPlanner(true)}
            style={{
              background: 'rgba(143, 191, 211, 0.10)',
              border: '1px solid rgba(143, 191, 211, 0.45)',
              cursor: 'pointer',
              color: 'var(--color-ice-light)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10, fontWeight: 700,
              padding: '7px 14px',
              letterSpacing: '0.18em', textTransform: 'uppercase',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
              boxShadow: '0 0 12px rgba(143, 191, 211, 0.18)',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(143, 191, 211, 0.18)'
              e.currentTarget.style.boxShadow = '0 0 18px rgba(143, 191, 211, 0.35)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
              e.currentTarget.style.boxShadow = '0 0 12px rgba(143, 191, 211, 0.18)'
            }}
          >
            PLANEJAR DIA
          </button>
        </>
      }
      footerCaption={
        <>
          <div>// SCHED.RECONCILED · LAST.SYNC: {new Date().toLocaleTimeString('pt-BR')}</div>
          <div style={{ opacity: 0.6, marginTop: 2 }}>
            DOCUMENT/D/{isoToLocalYmd(new Date()).replace(/-/g, '')} · TYPE: TACTICAL.DAILY
          </div>
        </>
      }
    >

      {/* PENDÊNCIAS HOJE — unifica rituals atrasados/de hoje (com player) +
          pendências do Hub Health (sem player, click abre RegisterModal).
          Substitui o antigo `RitualNextCard urgentOnly` que era só link.
          Some quando não há nada pendente. */}
      <DiaPendenciasBlock />

      {overdueTasks.length > 0 && (
        <OverdueTasksBanner
          tasks={overdueTasks}
          onToToday={handleTaskToToday}
          onReschedule={handleTaskReschedule}
          onDiscard={handleTaskDiscard}
        />
      )}

      {/* ─── Veredito em tempo real ─── DataReadoutFrame compacto.
          Hero (folga/déficit) à esquerda + stats inline à direita. Tudo
          numa só linha visual pra economizar espaço vertical. */}
      <section style={{ marginTop: 20, marginBottom: 24 }}>
        <DataReadoutFrame
          compact
          title="SCHEDULE.LIVE"
          meta={`${String(nowDate.getHours()).padStart(2, '0')}:${String(nowDate.getMinutes()).padStart(2, '0')}`}
        >
          {(() => {
            const livePctRaw = productiveMinRemaining > 0
              ? (pendingMin / productiveMinRemaining) * 100
              : (pendingMin > 0 ? 999 : 0)
            const overflow = productiveMinRemaining > 0 && pendingMin > productiveMinRemaining
            const accentColor = overflow ? 'var(--color-accent-primary)' : liveColor
            return (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 24,
                flexWrap: 'wrap',
              }}>
                {/* HERO HEADLINE — folga/déficit (compacto) */}
                <div style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700, lineHeight: 1,
                  color: liveColor,
                  textShadow: liveDeficit ? 'none' : '0 0 14px rgba(143, 191, 211, 0.40)',
                  letterSpacing: '0.02em',
                  textTransform: 'uppercase',
                  display: 'flex', alignItems: 'baseline', gap: 8,
                  flex: '0 0 auto',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 26 }}>
                    {fmtHM(Math.abs(liveSlackMin))}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700,
                    color: 'var(--color-text-muted)',
                    letterSpacing: '0.22em',
                  }}>
                    {liveDeficit ? 'DÉFICIT' : 'FOLGA'}
                  </span>
                </div>

                {/* Vertical divider */}
                <div style={{ width: 1, height: 28, background: 'var(--color-ice-deep)', flexShrink: 0 }} />

                {/* PENDENTE inline */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 8, fontWeight: 700,
                    letterSpacing: '0.22em', textTransform: 'uppercase',
                    color: 'var(--color-text-muted)',
                  }}>
                    PENDENTE
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 14, fontWeight: 700,
                    color: pendingMin > 0 ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                    lineHeight: 1.1,
                  }}>
                    {fmtHM(pendingMin)}
                  </span>
                </div>

                {/* LIVRE inline */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 8, fontWeight: 700,
                    letterSpacing: '0.22em', textTransform: 'uppercase',
                    color: 'var(--color-text-muted)',
                  }}>
                    LIVRE
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 14, fontWeight: 700,
                    color: 'var(--color-ice-light)',
                    lineHeight: 1.1,
                    textShadow: '0 0 8px rgba(143, 191, 211, 0.25)',
                  }}>
                    {fmtHM(productiveMinRemaining)}
                  </span>
                </div>

                {/* LOAD% + segmented progress (flex:1 pra esticar até o fim) */}
                <div style={{
                  flex: '1 1 160px', minWidth: 140,
                  display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 8, fontWeight: 700,
                    letterSpacing: '0.22em', textTransform: 'uppercase',
                    color: 'var(--color-text-muted)',
                  }}>
                    LOAD {Math.round(livePctRaw)}%
                  </span>
                  <div style={{ display: 'flex', gap: 2, width: '100%' }}>
                    {Array.from({ length: 10 }).map((_, i) => {
                      const filled = (Math.min(100, livePctRaw) / 10) > i
                      const overFlowSeg = overflow && i === 9
                      return (
                        <div
                          key={i}
                          style={{
                            flex: 1, height: 3,
                            background: overFlowSeg
                              ? 'var(--color-accent-primary)'
                              : filled
                                ? accentColor
                                : 'rgba(255, 255, 255, 0.08)',
                            boxShadow: filled ? `0 0 4px ${accentColor}` : 'none',
                          }}
                        />
                      )
                    })}
                  </div>
                </div>

                {/* Breakdown chips */}
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  display: 'flex', gap: 8,
                  flex: '0 0 auto',
                }}>
                  <span><span style={{ color: 'var(--color-ice)', marginRight: 3 }}>QST</span>[{questCount}]</span>
                  <span><span style={{ color: 'var(--color-warning)', marginRight: 3 }}>TSK</span>[{taskCount}]</span>
                  <span><span style={{ color: 'var(--color-success)', marginRight: 3 }}>RTN</span>[{routineCount}]</span>
                </div>
              </div>
            )
          })()}
        </DataReadoutFrame>
      </section>

      {/* ─── Períodos ─── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
        {(['morning', 'afternoon', 'evening'] as const).map(period => (
          <PeriodSection
            key={period}
            period={period}
            dayPeriods={dayPeriods}
            dayPlan={dayPlan}
            projects={projects}
            quests={quests}
            allTasks={allTasks}
            routines={routines}
            rituals={rituals}
            doneRoutineIds={doneRoutineIds}
            areas={areas}
            activeSession={activeSession}
            delivsByProject={delivsByProject}
            todayIsoForTasks={todayIsoForTasks}
            nowMin={nowMin}
            migratedFrom={migratedFrom}
            onSessionUpdate={() => {
              onSessionUpdate()
              // Invalida tudo que pode ter mudado quando uma sessão fecha:
              // task `done`, rotina `done` do dia, quest `status`, durações.
              appInv.tasks()
              appInv.routines()
              appInv.quests()
              tabSync.emit('session')
            }}
            onRemoveFromPlan={(itemId) => {
              setDayPlan(prev => ({
                ...prev,
                [period]: prev[period].filter(id => id !== itemId),
              }))
            }}
            onMoveToPeriod={(itemId, target) => {
              // Same logic do onDrop entre períodos — remove de qualquer
              // turno e adiciona ao target. Permite mover sem drag em touch.
              setDayPlan(prev => {
                if (prev[target].includes(itemId)) return prev
                return {
                  morning:   prev.morning.filter(id => id !== itemId),
                  afternoon: prev.afternoon.filter(id => id !== itemId),
                  evening:   prev.evening.filter(id => id !== itemId),
                  [target]: [...prev[target].filter(id => id !== itemId), itemId],
                } as any
              })
            }}
            onOpenPlanner={() => setShowPlanner(true)}
            diaPendencias={diaPendencias}
            onOpenQuest={(q) => {
              // Clique numa quest (subtask) → abre o PROJETO PAI em
              // /areas/{slug}. A AreaDetailView só mostra detalhe pra quests
              // top-level, então passar o id da subtask não abre nada.
              if (!q.project_id) return
              onSelectProject(q.project_id)
              navigate(`/areas/${q.area_slug}`)
            }}
            onExecutePendencia={(item, cluster) => {
              // Carrega prefill da sessão cronometrada — duração média + horários.
              const durMin = Math.max(1, Math.floor((cluster.elapsed_seconds || 0) / 60))
              const prefill = cluster.started_at
                ? {
                    started_at: cluster.started_at,
                    ended_at: cluster.ended_at,
                    duracao_min: durMin,
                  }
                : undefined
              if (item.modal_type === 'mind') {
                setOpenPendenciaModal({ type: 'mind', prefill })
              } else if (item.modal_type === 'health_register') {
                const t = item.target ?? {}
                setOpenPendenciaModal({
                  type: 'health_register',
                  domain: {
                    slug: t.domain_slug,
                    nome: t.domain_nome,
                    template: t.domain_template,
                    cor: t.domain_cor,
                  },
                  cor: t.domain_cor ?? '#7fb8a8',
                  item_id: t.item_id,
                  prefill,
                })
              }
            }}
          />
        ))}
      </div>

      {/* Portal: o `<Card>` ancestral aplica `hq-fade-up` que injeta
          `transform: translateY(0)` no estilo. Qualquer elemento com
          transform != none vira containing block pra `position: fixed` —
          isso fazia o overlay/drawer/modal serem ancorados ao Card, não
          ao viewport (drawer aparecia "muito pra baixo" e cortado, modal
          deslocado). Renderizar via createPortal pro document.body sai
          fora dessa cadeia de containing blocks. */}
      {editingPeriods && createPortal(
        <DayPeriodsEditModal
          value={dayPeriods}
          onClose={() => setEditingPeriods(false)}
          onSave={setDayPeriods}
        />,
        document.body,
      )}

      {showPlanner && createPortal(
        <PlannerDrawer
          filteredItems={filteredItems}
          dayPlan={dayPlan}
          setDayPlan={setDayPlan}
          plannerRange={plannerRange}
          setPlannerRange={setPlannerRange}
          plannerTypes={plannerTypes}
          setPlannerTypes={setPlannerTypes}
          plannerIncludeUndated={plannerIncludeUndated}
          setPlannerIncludeUndated={setPlannerIncludeUndated}
          plannerShowAllDeliverables={plannerShowAllDeliverables}
          setPlannerShowAllDeliverables={setPlannerShowAllDeliverables}
          plannerPriorities={plannerPriorities}
          setPlannerPriorities={setPlannerPriorities}
          draggedItem={draggedItem}
          setDraggedItem={setDraggedItem}
          areas={areas}
          projects={projects}
          quests={quests}
          routines={routines}
          allTasks={allTasks}
          delivsByProject={delivsByProject}
          dayPeriods={dayPeriods}
          doneRoutineIds={doneRoutineIds}
          nowMin={nowMin}
          diaPendencias={diaPendencias}
          onClose={() => setShowPlanner(false)}
        />,
        document.body,
      )}

      {/* Modais disparados por FINALIZAR de pendência cronometrada. Prefill
          vem da sessão (started_at + duracao_min). Após save, linka cluster
          ao record_id criado → backend tira da lista de pendências. */}
      {openPendenciaModal?.type === 'mind' && (
        <MindRegisterModal
          prefillFromSession={openPendenciaModal.prefill}
          onSessionLink={(recordId) => {
            linkMindToRecord.mutate(recordId)
          }}
          onClose={() => {
            setOpenPendenciaModal(null)
            invalidateDia()
          }}
        />
      )}
      {openPendenciaModal?.type === 'health_register' && (
        <RegisterModal
          domain={openPendenciaModal.domain}
          cor={openPendenciaModal.cor}
          preselectedItemId={openPendenciaModal.item_id}
          prefillFromSession={openPendenciaModal.prefill}
          onSessionLink={(recordId) => {
            linkHealthItemToRecord.mutate({
              itemId: openPendenciaModal.type === 'health_register'
                ? openPendenciaModal.item_id
                : 0,
              recordId,
            })
          }}
          onClose={() => {
            setOpenPendenciaModal(null)
            invalidateDia()
          }}
        />
      )}
    </PageShell>
  )
}

// ─── PeriodSection ─────────────────────────────────────────────────────────

function PeriodSection({
  period, dayPeriods, dayPlan, projects, quests, allTasks, routines, rituals, doneRoutineIds,
  areas, activeSession, delivsByProject, todayIsoForTasks, nowMin, migratedFrom,
  onSessionUpdate, onRemoveFromPlan, onMoveToPeriod, onOpenPlanner, onOpenQuest,
  onExecutePendencia, diaPendencias,
}: {
  period: 'morning' | 'afternoon' | 'evening'
  rituals: BuildRitual[]
  dayPeriods: DayPeriods
  dayPlan: { morning: string[]; afternoon: string[]; evening: string[] }
  projects: Project[]
  quests: Quest[]
  allTasks: Task[]
  routines: Routine[]
  doneRoutineIds: Set<string>
  areas: Area[]
  activeSession: ActiveSession | null
  delivsByProject: Record<string, Deliverable[]>
  todayIsoForTasks: string
  /** Minutos desde meia-noite local (re-renderizado a cada minuto pelo
   *  parent). Usado pra calcular janela dinâmica do período. */
  nowMin: number
  /** Mapa item-id → turno de origem pra itens migrados automaticamente. */
  migratedFrom: Record<string, 'morning' | 'afternoon' | 'evening'>
  onSessionUpdate: () => void
  onRemoveFromPlan: (itemId: string) => void
  /** Fallback touch pra drag-and-drop. */
  onMoveToPeriod: (itemId: string, target: 'morning' | 'afternoon' | 'evening') => void
  onOpenPlanner: () => void
  onOpenQuest: (q: Quest) => void
  /** Click "FINALIZAR" em planned item de pendência (Mind / health_item)
   *  abre o modal certo pré-preenchido com cluster da sessão. Resolvido no
   *  parent (DiaView) que tem state do modal + sabe linkar o record. */
  onExecutePendencia: (item: any, cluster: DiaSessionClusterLike) => void
  /** Pendências do dia — necessárias pra resolver IDs do dayPlan ("mind",
   *  "health_item:X") no allItems local. */
  diaPendencias: import('../types').DiaPendencia[]
}) {
  const periodLabelPt: Record<'morning' | 'afternoon' | 'evening', string> = {
    morning: 'manhã', afternoon: 'tarde', evening: 'noite',
  }
  const META = {
    morning: { Icon: Sunrise, label: 'Manhã' },
    afternoon: { Icon: Sun, label: 'Tarde' },
    evening: { Icon: Moon, label: 'Noite' },
  }[period]

  const periodRangesMin = periodRangesMinFrom(dayPeriods)
  const [startMin, endMin] = periodRangesMin[period]

  // Janela "ainda viva" do período: começa em max(startMin, nowMin). Período
  // que já acabou tem janela 0; período no meio descontinua o que já passou.
  const effectiveStartMin = Math.max(startMin, nowMin)
  const effectiveWindowMin = Math.max(0, endMin - effectiveStartMin)
  const isPeriodOver = nowMin >= endMin

  let ranges: BlockRange[] = []
  try {
    const saved = localStorage.getItem('hq-unproductive-blocks')
    if (saved) ranges = getAllBlockRangesForDay(JSON.parse(saved), new Date())
  } catch {}
  // Sobreposição dos blocos improdutivos com a janela RESTANTE (não com o
  // período inteiro) — assim improdutivos no passado não dobram contagem.
  const unproductiveMin = ranges.reduce((sum, r) => {
    const blockStartMin = r.start * 60
    const blockEndMin = r.end * 60
    const overlapStart = Math.max(blockStartMin, effectiveStartMin)
    const overlapEnd = Math.min(blockEndMin, endMin)
    return sum + Math.max(0, overlapEnd - overlapStart)
  }, 0)
  const availableMin = Math.max(0, effectiveWindowMin - unproductiveMin)

  const allItems = [
    ...quests,
    ...routines.map(r => ({ ...r, isRoutine: true, done: doneRoutineIds.has(r.id) })),
    ...allTasks.map(t => ({ ...t, isTask: true })),
    // Rituais alocados pelos períodos. ID composto pra não colidir com quests
    // (cadencia é single-instance, não tem UUID por instância).
    ...rituals.filter(r => r.ativo).map(r => ({
      ...r,
      id: `ritual:${r.cadencia}`,
      title: r.nome || `Ritual ${r.cadencia}`,
      isRitual: true,
      done: r.ultima_execucao ? r.ultima_execucao.slice(0, 10) === todayIso : false,
    })),
    // Pendências (Mind / health_items diários) — id = pendencia_id no
    // dayPlan. Sem isso aqui, item arrastado pro bloco some da view.
    ...diaPendencias.map(p => ({
      id: p.pendencia_id,
      title: p.titulo,
      estimated_minutes: p.duracao_min ?? 0,
      isPendencia: true,
      origem: p.origem,
      modal_type: p.modal_type,
      target: p.target,
      cor: p.cor,
      horario_sugerido: p.horario_sugerido,
      done: false,
    })),
  ]
  // Renderiza NA ORDEM do dayPlan (e não na ordem do pool) pra respeitar a
  // reordenação que o user faz via drag-and-drop.
  const periodItems = dayPlan[period]
    .map(id => allItems.find(it => it.id === id))
    .filter((it): it is any => !!it)
  // `usedMin` representa "trabalho que ainda preciso fazer nessa janela" —
  // items já feitos não consomem capacidade futura. Sem o filter abaixo,
  // 5 items done de 30min cada inflavam o deficit em -2h30m mesmo com a
  // manhã limpa de pendências.
  const usedMin = periodItems
    .filter(it => !(it.status === 'done' || it.done === true))
    .reduce((s, item) => s + itemDurationMin(item), 0)
  const remainingMin = availableMin - usedMin
  const isExceeded = remainingMin < 0
  // Atividades no período sem estimativa preenchida — o cálculo de "livre"
  // não considera elas, então avisamos discreto pra usuário não se enganar.
  const undefinedCount = periodItems.filter(it => itemDurationMin(it) === 0).length

  const metricColor = isPeriodOver
    ? 'var(--color-text-muted)'
    : isExceeded ? 'var(--color-accent-primary)' : 'var(--color-success)'

  return (
    <section>
      {/* Header CP2077: tab marker ice + // PERIOD label + range mono +
          metric semântica à direita. Hairline ice deep abaixo. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 14,
        paddingBottom: 8,
        borderBottom: '1px solid var(--color-ice-deep)',
        position: 'relative',
      }}>
        {/* Tab marker ice 3x18 */}
        <div
          aria-hidden="true"
          style={{
            width: 3, height: 18,
            background: isPeriodOver ? 'var(--color-text-muted)' : 'var(--color-ice)',
            boxShadow: isPeriodOver ? 'none' : '0 0 8px var(--color-ice-glow)',
            flexShrink: 0,
          }}
        />
        <META.Icon size={12} strokeWidth={1.8} style={{ color: isPeriodOver ? 'var(--color-text-muted)' : 'var(--color-ice-light)' }} />
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10, fontWeight: 700,
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: isPeriodOver ? 'var(--color-text-muted)' : 'var(--color-ice-light)',
        }}>
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
          {META.label}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10, fontWeight: 600,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.12em',
        }}>
          {minutesToHHMM(startMin)}–{minutesToHHMM(endMin)}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {undefinedCount > 0 && !isPeriodOver && (
            <span
              title={`${undefinedCount} atividade${undefinedCount === 1 ? '' : 's'} sem tempo definido — preencha pra cálculo correto`}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-warning)',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
              }}
            >
              ⚠ {undefinedCount} SEM TEMPO
            </span>
          )}
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10, fontWeight: 700,
            color: metricColor,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
          }}>
            {isPeriodOver
              ? 'ENCERRADO'
              : isExceeded
                ? `−${fmtHM(Math.abs(remainingMin))}`
                : `+${fmtHM(remainingMin)} LIVRE`}
          </div>
        </div>
      </div>

      {periodItems.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {periodItems.map(item => {
            // Pendência (Mind / health_item diário) — não tem cronômetro;
            // só botão FAZER que abre o modal correto.
            if ((item as any).isPendencia) {
              return (
                <PendenciaPlannedRow
                  key={item.id}
                  item={item}
                  onRemoveFromPlan={() => onRemoveFromPlan(item.id)}
                  onFinalize={onExecutePendencia}
                  onSessionUpdate={onSessionUpdate}
                />
              )
            }
            // Ritual (Build) — alocação simples por período. Player completo
            // continua no DiaPendenciasBlock no topo do /dia. Aqui é só sinal
            // de "planejado pra este período".
            if ((item as any).isRitual) {
              return (
                <RitualPlannedRow
                  key={item.id}
                  item={item}
                  onRemoveFromPlan={() => onRemoveFromPlan(item.id)}
                />
              )
            }
            let parentTitle: string | null = null
            let deliverableTitle: string | null = null
            if (!(item as any).isTask && !(item as any).isRoutine) {
              const q = item as Quest
              if (q.project_id) {
                const parent = projects.find(p => p.id === q.project_id)
                if (parent) parentTitle = parent.title
                const deliv = delivsByProject[q.project_id]?.find(d => d.id === q.deliverable_id)
                if (deliv) deliverableTitle = deliv.title
              }
            }
            return (
              <PlannedItemRow
                key={item.id}
                item={item}
                areas={areas}
                activeSession={activeSession}
                onSessionUpdate={onSessionUpdate}
                onRemoveFromPlan={() => onRemoveFromPlan(item.id)}
                currentPeriod={period}
                onMoveToPeriod={(target) => onMoveToPeriod(item.id, target)}
                target={todayIsoForTasks}
                parentTitle={parentTitle}
                deliverableTitle={deliverableTitle}
                onOpen={!(item as any).isTask && !(item as any).isRoutine
                  ? () => onOpenQuest(item as Quest)
                  : undefined}
                migratedFromLabel={migratedFrom[item.id] ? periodLabelPt[migratedFrom[item.id]] : undefined}
              />
            )
          })}
        </div>
      ) : (
        <button
          onClick={onOpenPlanner}
          style={{
            width: '100%', padding: '20px 18px',
            background: 'rgba(8, 12, 18, 0.30)',
            border: '1px dashed var(--color-ice-deep)',
            borderRadius: 0,
            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-muted)', fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            cursor: 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--color-ice)'
            e.currentTarget.style.color = 'var(--color-ice-light)'
            e.currentTarget.style.background = 'rgba(143, 191, 211, 0.06)'
            e.currentTarget.style.boxShadow = '0 0 12px rgba(143, 191, 211, 0.18)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--color-ice-deep)'
            e.currentTarget.style.color = 'var(--color-text-muted)'
            e.currentTarget.style.background = 'rgba(8, 12, 18, 0.30)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        >
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 6, letterSpacing: 0 }}>//</span>
          SLOT VAZIO · TAP TO PLAN
        </button>
      )}
    </section>
  )
}

// ─── PlannerDrawer ─────────────────────────────────────────────────────────

function PlannerDrawer({
  filteredItems, dayPlan, setDayPlan,
  plannerRange, setPlannerRange,
  plannerTypes, setPlannerTypes,
  plannerIncludeUndated, setPlannerIncludeUndated,
  plannerShowAllDeliverables, setPlannerShowAllDeliverables,
  plannerPriorities, setPlannerPriorities,
  draggedItem, setDraggedItem,
  areas, projects, quests, routines, allTasks, doneRoutineIds,
  delivsByProject,
  dayPeriods,
  nowMin,
  diaPendencias,
  onClose,
}: {
  filteredItems: any[]
  dayPlan: { morning: string[]; afternoon: string[]; evening: string[] }
  setDayPlan: (fn: (prev: any) => any) => void
  plannerRange: DateRange
  setPlannerRange: (r: DateRange) => void
  plannerTypes: Set<'quest' | 'task' | 'routine' | 'ritual' | 'mind' | 'health'>
  setPlannerTypes: (fn: (prev: Set<'quest' | 'task' | 'routine' | 'ritual' | 'mind' | 'health'>) => Set<'quest' | 'task' | 'routine' | 'ritual' | 'mind' | 'health'>) => void
  plannerIncludeUndated: boolean
  setPlannerIncludeUndated: (v: boolean) => void
  plannerShowAllDeliverables: boolean
  setPlannerShowAllDeliverables: (v: boolean) => void
  plannerPriorities: Set<string>
  setPlannerPriorities: (fn: (prev: Set<string>) => Set<string>) => void
  draggedItem: any
  setDraggedItem: (i: any) => void
  areas: Area[]
  projects: Project[]
  quests: Quest[]
  routines: Routine[]
  allTasks: Task[]
  doneRoutineIds: Set<string>
  delivsByProject: Record<string, Deliverable[]>
  dayPeriods: DayPeriods
  /** Minutos desde meia-noite local. Usado pra calcular janela viva
   *  do período (mesma matemática da PeriodSection no Dia). */
  nowMin: number
  /** Pendências do dia (Mind + health_items diários) — passadas pelo parent
   *  pra garantir lookup correto quando pendência tá em dayPlan. */
  diaPendencias: import('../types').DiaPendencia[]
  onClose: () => void
}) {
  const [searchQuery, setSearchQuery] = useState('')

  // Filtro textual: bate em título da quest/task/routine, no projeto pai
  // (quando é quest) e no entregável pai. Case + accent insensitive.
  const matchesSearch = (item: any): boolean => {
    const q = normalize(searchQuery.trim())
    if (!q) return true
    if (normalize(item.title ?? '').includes(q)) return true
    if (!item.isTask && !item.isRoutine) {
      const quest = item as Quest
      if (quest.project_id) {
        const parent = projects.find(p => p.id === quest.project_id)
        if (parent && normalize(parent.title).includes(q)) return true
        const delivs = delivsByProject[quest.project_id] ?? []
        const deliv = delivs.find(d => d.id === quest.deliverable_id)
        if (deliv && normalize(deliv.title).includes(q)) return true
      }
    }
    return false
  }

  const availableItems = filteredItems
    .filter(item =>
      !dayPlan.morning.includes(item.id) &&
      !dayPlan.afternoon.includes(item.id) &&
      !dayPlan.evening.includes(item.id)
    )
    .filter(matchesSearch)
  const draggedFromPeriod = draggedItem && (
    dayPlan.morning.includes(draggedItem.id) ||
    dayPlan.afternoon.includes(draggedItem.id) ||
    dayPlan.evening.includes(draggedItem.id)
  )

  const typeChips: { key: 'quest' | 'task' | 'routine' | 'ritual' | 'mind' | 'health'; label: string }[] = [
    { key: 'quest', label: 'Quests' },
    { key: 'task', label: 'Tarefas' },
    { key: 'routine', label: 'Rotinas' },
    { key: 'ritual', label: 'Rituais' },
    { key: 'mind', label: 'Mind' },
    { key: 'health', label: 'Exercícios' },
  ]

  return (
    <>
      {/* Overlay com blur sutil — backdrop-filter dá a sensação glass do
          fundo "borrado" enquanto o drawer está aberto. */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(8, 8, 10, 0.62)',
          backdropFilter: 'blur(6px) saturate(120%)',
          WebkitBackdropFilter: 'blur(6px) saturate(120%)',
          zIndex: 998,
          animation: 'dia-fade-in 0.22s ease-out',
        }}
      />

      {/* Shell do drawer: glass-elevated + cantos superiores arredondados +
          shadow forte + hairline oxblood no topo (carteira pattern). */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'var(--glass-bg-elevated)',
        backdropFilter: 'var(--glass-blur-strong)',
        WebkitBackdropFilter: 'var(--glass-blur-strong)',
        borderTop: '1px solid var(--color-border-strong)',
        zIndex: 999, height: '92vh', maxHeight: '92vh',
        display: 'flex', flexDirection: 'column',
        animation: 'dia-slide-up 0.32s var(--ease-emphasis)',
        boxShadow: 'var(--shadow-lg)',
        overflow: 'hidden',
      }}>
        {/* Hairline ice elétrica no topo — assinatura HUD CP2077. */}
        <div className="hq-hairline-ice" />

        {/* Header HERO: padding generoso (32px lateral, 28/24 vertical) +
            grain sobre o radial oxblood. Eyebrow oxblood-light pra virar
            assinatura, não label cinza esquecida. Headline com max-width
            pra controlar quebra de linha em vez de wrap selvagem.

            Bug histórico: padding usava var(--space-7) que não existe no
            design system (escala é 1,2,3,4,5,6,8,10) — virava 0 lateral. */}
        <div
          className="hq-grain"
          style={{
            ...modalHeader(),
            padding: '28px 32px 24px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 'var(--space-6)',
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--color-ice-light)',
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              fontWeight: 700,
              marginBottom: 'var(--space-3)',
              lineHeight: 1,
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>
              <div
                aria-hidden="true"
                style={{
                  width: 8, height: 8,
                  background: 'var(--color-ice)',
                  boxShadow: '0 0 8px var(--color-ice-glow)',
                }}
              />
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              PLANEJAR · {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
            </div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              color: 'var(--color-text-primary)',
              fontWeight: 600,
              letterSpacing: '0.02em',
              lineHeight: 1.2,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              DISTRIBUIR ITENS PELOS PERÍODOS DO DIA
            </div>
          </div>

          {/* Busca: glass cyber. Ring ice ao focus. */}
          <div
            style={{
              flex: '0 1 340px', minWidth: 200,
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid var(--color-border)',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
              padding: '7px 12px',
              transition: 'border-color var(--motion-fast) var(--ease-smooth), box-shadow var(--motion-fast) var(--ease-smooth)',
            }}
            onFocusCapture={e => {
              e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.55)'
              e.currentTarget.style.boxShadow = '0 0 12px rgba(143, 191, 211, 0.20)'
            }}
            onBlurCapture={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <Search size={13} strokeWidth={1.8} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <input
              type="text"
              name="planner-search"
              aria-label="Buscar por quest, projeto ou entregável"
              autoComplete="off"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setSearchQuery('') }}
              placeholder="buscar quest, projeto ou entregável…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)',
                fontFamily: 'inherit',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                title="Limpar busca"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-muted)', padding: 2,
                  display: 'inline-flex', alignItems: 'center',
                  transition: 'color var(--motion-fast) var(--ease-smooth)',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              >
                <X size={12} strokeWidth={1.8} />
              </button>
            )}
          </div>

          <button
            onClick={onClose}
            aria-label="Fechar drawer"
            style={{
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              width: 32, height: 32, borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all var(--motion-fast) var(--ease-smooth)',
              flexShrink: 0,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-ice-light)'
              e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
              e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-tertiary)'
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
            }}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        </div>

        {/* Filtros: padding lateral 32px (mesmo do header) + vertical 18px,
            gap horizontal+vertical de 24px pra acomodar wrap em viewport
            menor sem virar uma "linha apertada".

            Bug histórico: var(--space-7) não existia → eixo X virava 0. */}
        <div style={{
          padding: '18px 32px',
          borderBottom: '1px solid var(--color-divider)',
          display: 'flex', alignItems: 'center',
          columnGap: 'var(--space-6)',
          rowGap: 'var(--space-3)',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9, color: 'var(--color-text-muted)',
              letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700,
            }}>
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              JANELA
            </span>
            <DateRangeFilter value={plannerRange} onChange={setPlannerRange} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9, color: 'var(--color-text-muted)',
              letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700,
            }}>
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              TIPOS
            </span>
            {typeChips.map(t => {
              const active = plannerTypes.has(t.key)
              return (
                <button
                  key={t.key}
                  onClick={e => setPlannerTypes(prev => {
                    // Shift+click: seleciona SÓ este (solo). Click normal: toggle.
                    if (e.shiftKey) return new Set([t.key])
                    const next = new Set(prev)
                    if (next.has(t.key)) next.delete(t.key); else next.add(t.key)
                    return next
                  })}
                  title={`${t.label} · shift+clique pra isolar`}
                  style={{
                    background: active ? 'rgba(143, 191, 211, 0.10)' : 'rgba(8, 12, 18, 0.55)',
                    color: active ? 'var(--color-ice-light)' : 'var(--color-text-tertiary)',
                    border: `1px solid ${active ? 'rgba(143, 191, 211, 0.45)' : 'var(--color-border)'}`,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9, padding: '5px 10px',
                    letterSpacing: '0.18em', textTransform: 'uppercase',
                    fontWeight: 700,
                    borderRadius: 0,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                    transition: 'all 0.15s',
                    boxShadow: active ? '0 0 12px rgba(143, 191, 211, 0.18)' : 'none',
                  }}
                >
                  {t.label.toUpperCase()}
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9, color: 'var(--color-text-muted)',
              letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700,
              marginRight: 3,
            }}>
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              PRIORIDADE
            </span>
            {([
              { key: 'critical', label: 'crítica', color: 'var(--color-accent-primary)' },
              { key: 'high',     label: 'alta',    color: 'var(--color-warning)' },
              { key: 'medium',   label: 'média',   color: 'var(--color-accent-light)' },
              { key: 'low',      label: 'baixa',   color: 'var(--color-text-tertiary)' },
            ]).map(p => {
              const active = plannerPriorities.has(p.key)
              return (
                <button
                  key={p.key}
                  onClick={e => setPlannerPriorities(prev => {
                    if (e.shiftKey) return new Set([p.key])
                    const next = new Set(prev)
                    if (next.has(p.key)) next.delete(p.key); else next.add(p.key)
                    return next
                  })}
                  title={`${p.label} · shift+clique pra isolar`}
                  style={{
                    background: 'transparent',
                    color: active ? p.color : 'var(--color-text-muted)',
                    border: 'none', cursor: 'pointer',
                    fontSize: 10, padding: '3px 6px',
                    letterSpacing: '0.05em', textTransform: 'lowercase',
                    fontWeight: active ? 700 : 400,
                    transition: 'color 0.12s, opacity 0.12s',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    opacity: active ? 1 : 0.5,
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.opacity = '0.85' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.opacity = '0.5' }}
                >
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: p.color,
                    opacity: active ? 1 : 0.6,
                  }} />
                  {p.label}
                </button>
              )
            })}
          </div>

          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            color: plannerIncludeUndated
              ? 'var(--color-ice-light)'
              : 'var(--color-text-tertiary)',
            transition: 'color var(--motion-fast) var(--ease-smooth)',
          }}>
            <input
              type="checkbox"
              checked={plannerIncludeUndated}
              onChange={e => setPlannerIncludeUndated(e.target.checked)}
              style={{ cursor: 'pointer', accentColor: 'var(--color-ice)' }}
            />
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              letterSpacing: '0.18em', textTransform: 'uppercase',
            }}>
              INCLUIR SEM DATA
            </span>
          </label>

          {/* Toggle: mostrar quests de TODOS os entregáveis (não só o ativo). */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            color: plannerShowAllDeliverables
              ? 'var(--color-ice-light)'
              : 'var(--color-text-tertiary)',
            transition: 'color var(--motion-fast) var(--ease-smooth)',
          }}>
            <input
              type="checkbox"
              checked={plannerShowAllDeliverables}
              onChange={e => setPlannerShowAllDeliverables(e.target.checked)}
              style={{ cursor: 'pointer', accentColor: 'var(--color-ice)' }}
            />
            <span
              title="Quando desligado, só aparece o entregável corrente de cada projeto. Ligue pra puxar quests de entregáveis futuros."
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                letterSpacing: '0.18em', textTransform: 'uppercase',
              }}
            >
              TODOS ENTREGÁVEIS
            </span>
          </label>
        </div>

        {/* Body: disponíveis × períodos */}
        <div style={{
          flex: 1, display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          overflow: 'hidden',
        }}>

          {/* Disponíveis: drop aqui = remover do plano. Highlight verde sutil
              quando arrastando de algum período pra dar feedback. */}
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={() => {
              if (draggedItem) {
                setDayPlan(prev => ({
                  morning: prev.morning.filter((id: string) => id !== draggedItem.id),
                  afternoon: prev.afternoon.filter((id: string) => id !== draggedItem.id),
                  evening: prev.evening.filter((id: string) => id !== draggedItem.id),
                }))
              }
            }}
            style={{
              borderRight: '1px solid var(--color-ice-deep)',
              overflowY: 'auto',
              padding: 'var(--space-5) var(--space-6)',
              background: draggedFromPeriod ? 'rgba(143, 191, 211, 0.08)' : 'transparent',
              transition: 'background var(--motion-fast) var(--ease-smooth)',
            }}
          >
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10, fontWeight: 700,
              color: 'var(--color-ice-light)',
              letterSpacing: '0.25em', textTransform: 'uppercase',
              marginBottom: 'var(--space-4)',
              display: 'flex', alignItems: 'center', gap: 8,
              paddingBottom: 8,
              borderBottom: '1px solid var(--color-ice-deep)',
            }}>
              <div
                aria-hidden="true"
                style={{
                  width: 3, height: 14,
                  background: 'var(--color-ice)',
                  boxShadow: '0 0 8px var(--color-ice-glow)',
                }}
              />
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              DISPONÍVEIS
              <span style={{
                color: 'var(--color-text-muted)',
                fontWeight: 700, letterSpacing: '0.12em',
              }}>
                [{availableItems.length}]
              </span>
            </div>
            {availableItems.length > 0 ? (
              <AvailableList
                items={availableItems}
                areas={areas}
                projects={projects}
                delivsByProject={delivsByProject}
                onDragStart={(item) => setDraggedItem(item)}
                onDragEnd={() => setDraggedItem(null)}
              />
            ) : (
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10, color: 'var(--color-text-muted)',
                letterSpacing: '0.18em', textTransform: 'uppercase',
                fontWeight: 700,
                padding: '16px 0',
              }}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                {filteredItems.length === 0
                  ? 'NADA NESTE FILTRO'
                  : 'TUDO FOI PLANEJADO'}
              </div>
            )}
          </div>

          {/* Períodos: cada período é um sub-card glass com seu próprio
              hairline interno e medidor de capacidade. Gap entre cards
              maior pra dar respiro entre seções. */}
          <div style={{
            overflowY: 'auto',
            padding: 'var(--space-5) var(--space-6)',
            display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
          }}>
            {(['morning', 'afternoon', 'evening'] as const).map(period => {
              const META = {
                morning: { Icon: Sunrise, label: 'Manhã' },
                afternoon: { Icon: Sun, label: 'Tarde' },
                evening: { Icon: Moon, label: 'Noite' },
              }[period]

              const allItemsPool = [
                ...quests,
                ...routines.map(r => ({ ...r, isRoutine: true, done: doneRoutineIds.has(r.id) })),
                ...allTasks.map(t => ({ ...t, isTask: true })),
                // Pendências (Mind/health_items) — precisam estar aqui pra
                // serem resolvidas quando aparecem em dayPlan. Sem isso,
                // arrastar pendência pra um período faz ela desaparecer
                // (não acha o id no pool).
                ...diaPendencias.map(p => ({
                  id: p.pendencia_id,
                  title: p.titulo,
                  estimated_minutes: p.duracao_min ?? 0,
                  isPendencia: true,
                  origem: p.origem,
                  modal_type: p.modal_type,
                  target: p.target,
                  cor: p.cor,
                  horario_sugerido: p.horario_sugerido,
                  done: false,
                })),
              ]
              // Renderiza NA ORDEM do dayPlan pra refletir reordenação por drag.
              const periodItems = dayPlan[period]
                .map(id => allItemsPool.find(it => it.id === id))
                .filter((it): it is any => !!it)

              // Janela "ainda viva" do período: começa em max(startMin, nowMin)
              // (ignora tempo já passado dentro do período corrente). Mesma
              // matemática da PeriodSection fora do drawer pra os dois lugares
              // mostrarem o MESMO número.
              const periodRangesMin = periodRangesMinFrom(dayPeriods)
              const [startMin, endMin] = periodRangesMin[period]
              const effStart = Math.max(startMin, nowMin)
              const effectiveWindowMin = Math.max(0, endMin - effStart)
              let unproductiveMin = 0
              try {
                const saved = localStorage.getItem('hq-unproductive-blocks')
                if (saved) {
                  const ranges = getAllBlockRangesForDay(JSON.parse(saved), new Date())
                  unproductiveMin = ranges.reduce((sum, r) => {
                    const blockStartMin = r.start * 60
                    const blockEndMin = r.end * 60
                    const overlapStart = Math.max(blockStartMin, effStart)
                    const overlapEnd = Math.min(blockEndMin, endMin)
                    return sum + Math.max(0, overlapEnd - overlapStart)
                  }, 0)
                }
              } catch {}
              const availableMin = Math.max(0, effectiveWindowMin - unproductiveMin)
              // Items done não consomem capacidade futura.
              const usedMin = periodItems
                .filter(it => !(it.status === 'done' || it.done === true))
                .reduce((s, it) => s + itemDurationMin(it), 0)
              const remainingMin = availableMin - usedMin
              const isExceeded = remainingMin < 0
              const isPeriodOver = nowMin >= endMin
              const metricColor = isPeriodOver
                ? 'var(--color-text-muted)'
                : isExceeded ? 'var(--color-accent-primary)' : 'var(--color-success)'

              return (
                <div
                  key={period}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => {
                    // Move o item pra esse período: remove de qualquer outro e
                    // adiciona aqui. Se já estava aqui, é no-op.
                    if (!draggedItem) return
                    setDayPlan(prev => {
                      if (prev[period].includes(draggedItem.id)) return prev
                      return {
                        morning:   prev.morning.filter((id: string) => id !== draggedItem.id),
                        afternoon: prev.afternoon.filter((id: string) => id !== draggedItem.id),
                        evening:   prev.evening.filter((id: string) => id !== draggedItem.id),
                        [period]: [...prev[period].filter((id: string) => id !== draggedItem.id), draggedItem.id],
                      } as any
                    })
                  }}
                  style={{
                    background: 'rgba(8, 12, 18, 0.55)',
                    border: draggedItem && !dayPlan[period].includes(draggedItem.id)
                      ? '1px dashed var(--color-ice)'
                      : isExceeded
                        ? '1px solid rgba(159, 18, 57, 0.55)'
                        : '1px solid var(--color-ice-deep)',
                    borderRadius: 0,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)',
                    padding: 'var(--space-4) var(--space-5)',
                    transition: 'border-color var(--motion-fast) var(--ease-smooth), background var(--motion-fast) var(--ease-smooth), box-shadow var(--motion-fast) var(--ease-smooth)',
                    display: 'flex', flexDirection: 'column', flexShrink: 0,
                    boxShadow: isExceeded
                      ? '0 0 12px rgba(159, 18, 57, 0.20)'
                      : draggedItem && !dayPlan[period].includes(draggedItem.id)
                        ? '0 0 12px rgba(143, 191, 211, 0.25)'
                        : 'none',
                  }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    marginBottom: 'var(--space-4)',
                    paddingBottom: 8,
                    borderBottom: `1px solid ${isExceeded ? 'rgba(159, 18, 57, 0.35)' : 'var(--color-ice-deep)'}`,
                  }}>
                    <div
                      aria-hidden="true"
                      style={{
                        width: 3, height: 16,
                        background: isPeriodOver
                          ? 'var(--color-text-muted)'
                          : isExceeded
                            ? 'var(--color-accent-primary)'
                            : 'var(--color-ice)',
                        boxShadow: isPeriodOver
                          ? 'none'
                          : isExceeded
                            ? '0 0 8px rgba(159, 18, 57, 0.45)'
                            : '0 0 8px var(--color-ice-glow)',
                        flexShrink: 0,
                      }}
                    />
                    <META.Icon size={12} strokeWidth={1.8} style={{
                      color: isPeriodOver ? 'var(--color-text-muted)' : 'var(--color-ice-light)',
                    }} />
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10, fontWeight: 700,
                      color: isPeriodOver ? 'var(--color-text-muted)' : 'var(--color-ice-light)',
                      letterSpacing: '0.22em', textTransform: 'uppercase',
                    }}>
                      <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                      {META.label.toUpperCase()}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9, fontWeight: 600,
                      color: 'var(--color-text-muted)',
                      letterSpacing: '0.12em',
                    }}>
                      {minutesToHHMM(startMin)}–{minutesToHHMM(endMin)}
                    </span>
                    <div style={{ flex: 1 }} />
                    <div
                      title={isPeriodOver
                        ? `período encerrado · ${fmtHM(usedMin)} ainda pendente`
                        : `${fmtHM(usedMin)} usado de ${fmtHM(availableMin)} disponível`}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10, fontWeight: 700,
                        color: metricColor,
                        letterSpacing: '0.18em', textTransform: 'uppercase',
                      }}
                    >
                      {isPeriodOver
                        ? 'ENCERRADO'
                        : isExceeded
                          ? `−${fmtHM(Math.abs(remainingMin))}`
                          : `+${fmtHM(remainingMin)} LIVRE`}
                    </div>
                  </div>

                  {periodItems.length > 0 ? (
                    <div style={{
                      display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
                      maxHeight: 220, overflowY: 'auto',
                      paddingRight: 'var(--space-1)',
                    }}>
                      {periodItems.map(item => {
                        const itemDone = itemIsDone(item)
                        return (
                        <div
                          key={item.id}
                          draggable
                          onDragStart={() => setDraggedItem(item)}
                          onDragEnd={() => setDraggedItem(null)}
                          onDragOver={e => {
                            if (!draggedItem || draggedItem.id === item.id) return
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onDrop={e => {
                            // Drop em cima deste item: insere o arrastado ANTES dele,
                            // reordenando dentro do período (ou trazendo de outro).
                            if (!draggedItem || draggedItem.id === item.id) return
                            e.stopPropagation()
                            e.preventDefault()
                            setDayPlan(prev => {
                              const next = {
                                morning:   prev.morning.filter((id: string) => id !== draggedItem.id),
                                afternoon: prev.afternoon.filter((id: string) => id !== draggedItem.id),
                                evening:   prev.evening.filter((id: string) => id !== draggedItem.id),
                              }
                              const targetList = [...next[period]]
                              const idx = targetList.indexOf(item.id)
                              targetList.splice(idx >= 0 ? idx : targetList.length, 0, draggedItem.id)
                              return { ...next, [period]: targetList } as any
                            })
                          }}
                          style={{
                            background: 'rgba(8, 10, 14, 0.7)',
                            border: '1px solid rgba(143, 191, 211, 0.22)',
                            borderRadius: 0,
                            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
                            padding: '8px 12px',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            gap: 'var(--space-3)', cursor: 'grab',
                            fontFamily: 'var(--font-display)',
                            fontSize: 12, fontWeight: 600,
                            letterSpacing: '0.03em',
                            textTransform: 'uppercase',
                            color: 'var(--color-text-secondary)',
                            lineHeight: 1.3,
                            transition: 'background var(--motion-fast) var(--ease-smooth), border-color var(--motion-fast) var(--ease-smooth), box-shadow var(--motion-fast) var(--ease-smooth), opacity var(--motion-fast) var(--ease-smooth)',
                            opacity: itemDone ? 0.5 : 1,
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'rgba(143, 191, 211, 0.08)'
                            e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                            e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.15)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'rgba(8, 10, 14, 0.7)'
                            e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.22)'
                            e.currentTarget.style.boxShadow = 'none'
                          }}
                        >
                          <span style={{
                            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            textDecoration: itemDone ? 'line-through' : 'none',
                          }}>
                            {item.title}
                          </span>
                          <button
                            onClick={() => setDayPlan(prev => ({
                              ...prev,
                              [period]: prev[period].filter((id: string) => id !== item.id),
                            }))}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: 'var(--color-text-muted)', fontSize: 11,
                              padding: '0 4px', transition: 'color 0.15s',
                              fontFamily: 'var(--font-mono)',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                          >
                            ✕
                          </button>
                        </div>
                      )})}
                    </div>
                  ) : (
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9, fontWeight: 700,
                      color: 'var(--color-text-muted)',
                      letterSpacing: '0.22em', textTransform: 'uppercase',
                      textAlign: 'center', padding: '12px 0',
                      border: '1px dashed var(--color-ice-deep)',
                      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                    }}>
                      <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 6, letterSpacing: 0 }}>//</span>
                      DRAG HERE
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer: hairline ice (echo do topo) + actions cyber. */}
        <div className="hq-hairline-ice" style={{ opacity: 0.5 }} />
        <div
          style={{
            padding: '18px 32px',
            display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)',
            flexShrink: 0,
            background: `
              radial-gradient(ellipse 80% 100% at 100% 100%, rgba(143, 191, 211, 0.04), transparent 60%),
              linear-gradient(0deg, rgba(236, 232, 227, 0.015), transparent)
            `,
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)', cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              padding: '8px 18px', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
              transition: 'all var(--motion-fast) var(--ease-smooth)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-ice-light)'
              e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
              e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-tertiary)'
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
            }}
          >
            FECHAR
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(143, 191, 211, 0.14)',
              border: '1px solid var(--color-ice)',
              color: 'var(--color-ice-light)', cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              padding: '8px 22px', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
              boxShadow: '0 0 14px rgba(143, 191, 211, 0.30)',
              transition: 'all var(--motion-fast) var(--ease-smooth)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(143, 191, 211, 0.22)'
              e.currentTarget.style.boxShadow = '0 0 20px rgba(143, 191, 211, 0.50)'
              e.currentTarget.style.transform = 'translateY(-1px)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(143, 191, 211, 0.14)'
              e.currentTarget.style.boxShadow = '0 0 14px rgba(143, 191, 211, 0.30)'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            ✓ CONCLUIR
          </button>
        </div>
      </div>

      <style>{`
        @keyframes dia-slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes dia-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </>
  )
}

// ─── AvailableCard ─────────────────────────────────────────────────────────

// ─── OverdueTasksBanner ────────────────────────────────────────────────────

/**
 * Banner compacto no topo do Dia listando tarefas agendadas em dias passados
 * que não foram feitas. Rotinas e quests ficam de fora — rotinas não
 * acumulam dívida (cada dia é instância nova) e quests não têm data própria.
 */
function OverdueTasksBanner({ tasks, onToToday, onReschedule, onDiscard }: {
  tasks: Task[]
  onToToday: (t: Task) => void
  onReschedule: (t: Task, newDate: string) => void
  onDiscard: (t: Task) => void
}) {
  const [picking, setPicking] = useState<string | null>(null)
  const [pickValue, setPickValue] = useState<string>('')

  function daysAway(iso: string | null | undefined): string {
    if (!iso) return ''
    const [y, m, d] = iso.split('-').map(Number)
    const target = new Date(y, m - 1, d)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const diff = Math.round((today.getTime() - target.getTime()) / 86400000)
    if (diff === 1) return 'ontem'
    return `${diff}d atrás`
  }

  return (
    <section style={{ marginTop: 24 }}>
      {/* Alert header CP2077 — pulse-square oxblood + // ALERT label */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
        paddingBottom: 8,
        borderBottom: '1px solid rgba(159, 18, 57, 0.45)',
      }}>
        <div className="hq-pulse-square" aria-hidden="true" />
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10, fontWeight: 700,
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: 'var(--color-accent-light)',
        }}>
          <span style={{ color: 'var(--color-accent-primary)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
          ALERT · {tasks.length} {tasks.length === 1 ? 'TAREFA ATRASADA' : 'TAREFAS ATRASADAS'}
        </span>
      </div>

      <div style={{
        border: '1px solid rgba(159, 18, 57, 0.45)',
        borderLeft: '2px solid var(--color-accent-primary)',
        background: 'rgba(159, 18, 57, 0.06)',
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)',
      }}>
        {tasks.map((t, i) => {
          const isPicking = picking === t.id
          return (
            <div
              key={t.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px',
                borderTop: i > 0 ? '1px solid var(--color-divider)' : 'none',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 600,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {t.title}
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-accent-light)',
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  marginTop: 4,
                }}>
                  {daysAway(t.scheduled_date).toUpperCase()}
                  {t.duration_minutes ? ` · ~${t.duration_minutes}MIN` : ''}
                </div>
              </div>

              {isPicking ? (
                <>
                  <input
                    type="date"
                    autoComplete="off"
                    value={pickValue}
                    onChange={e => setPickValue(e.target.value)}
                    style={{
                      background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
                      color: 'var(--color-text-primary)', fontSize: 11, padding: '4px 6px', borderRadius: 3,
                      outline: 'none', colorScheme: 'dark', fontFamily: 'var(--font-mono)',
                    } as any}
                  />
                  <button
                    onClick={() => {
                      if (pickValue) {
                        onReschedule(t, pickValue)
                        setPicking(null)
                        setPickValue('')
                      }
                    }}
                    disabled={!pickValue}
                    style={{
                      background: pickValue ? 'var(--color-accent-primary)' : 'var(--color-bg-tertiary)',
                      color: pickValue ? 'var(--color-bg-primary)' : 'var(--color-text-muted)',
                      border: 'none', cursor: pickValue ? 'pointer' : 'not-allowed',
                      fontSize: 9, fontWeight: 700, padding: '4px 10px',
                      letterSpacing: '0.1em', textTransform: 'uppercase', borderRadius: 3,
                    }}
                  >
                    ok
                  </button>
                  <button
                    onClick={() => { setPicking(null); setPickValue('') }}
                    title="Cancelar"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--color-text-tertiary)', padding: 4,
                      display: 'inline-flex', alignItems: 'center',
                    }}
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => onToToday(t)}
                    title="Reagendar pra hoje"
                    style={{
                      background: 'rgba(8, 12, 18, 0.55)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-tertiary)', cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9, fontWeight: 700, padding: '5px 10px',
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                      borderRadius: 0,
                      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                      e.currentTarget.style.color = 'var(--color-ice-light)'
                      e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--color-border)'
                      e.currentTarget.style.color = 'var(--color-text-tertiary)'
                      e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
                    }}
                  >
                    <ArrowRight size={10} strokeWidth={2} />
                    PRA HOJE
                  </button>
                  <button
                    onClick={() => {
                      setPicking(t.id)
                      setPickValue(t.scheduled_date ?? '')
                    }}
                    title="Escolher nova data"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--color-text-tertiary)', padding: 4,
                      display: 'inline-flex', alignItems: 'center',
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
                  >
                    <CalendarIcon size={13} strokeWidth={1.8} />
                  </button>
                  <button
                    onClick={() => onDiscard(t)}
                    title="Descartar"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--color-text-muted)', padding: 4,
                      display: 'inline-flex', alignItems: 'center',
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-primary)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                  >
                    <Trash2 size={13} strokeWidth={1.8} />
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── AvailableCard ─────────────────────────────────────────────────────────

function itemIsDone(item: any): boolean {
  if (item?.isTask) return !!item.done
  if (item?.isRoutine) return !!item.done
  // Pendência só existe na lista enquanto não foi feita — backend filtra.
  // Se ficou na lista, status = pendente.
  if (item?.isPendencia) return false
  return item?.status === 'done'
}

/**
 * Planned item row pra pendências (Mind / health_item diários). Diferente
 * de quests/tasks/routines: não tem cronômetro, só botão FAZER que abre
 * o modal correto (MindRegisterModal ou RegisterModal de Health). Após
 * salvar, backend tira da lista de pendências e o item some.
 */
// ─── RitualPlannedRow ─────────────────────────────────────────────────────

/**
 * Card de ritual alocado no período. Versão enxuta: sem cronômetro próprio
 * (rituais usam o player do DiaPendenciasBlock no topo da página, que tem
 * a lógica completa de play/pause/stop persistido em localStorage).
 *
 * Mostra: título, cadência, duração alvo, e indicador done quando o ritual
 * já foi executado hoje (vem de `ultima_execucao === todayIso`).
 */
function RitualPlannedRow({
  item,
  onRemoveFromPlan,
}: {
  item: any
  onRemoveFromPlan: () => void
}) {
  const navigate = useNavigate()
  const accent = '#dc2531' // Neomilitarism red (mesma do RitualNextCard)
  const done = !!item.done
  const cadenciaLabel = item.cadencia
    ? item.cadencia.charAt(0).toUpperCase() + item.cadencia.slice(1)
    : 'Ritual'

  return (
    <div
      style={{
        // Tint diagonal sutil em vez de border-stripe (DESIGN.md ban).
        background: `linear-gradient(135deg, ${accent}0d 0%, transparent 45%), rgba(8, 12, 18, 0.55)`,
        border: '1px solid rgba(143, 191, 211, 0.22)',
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        opacity: done ? 0.5 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textDecoration: done ? 'line-through' : 'none',
          }}
        >
          {item.title}
        </div>
        <div
          style={{
            marginTop: 3,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ color: accent }}>Ritual · {cadenciaLabel}</span>
          {item.duracao_alvo_min > 0 && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{item.duracao_alvo_min} min</span>
            </>
          )}
          {done && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span style={{ color: 'var(--color-success)' }}>cumprido hoje</span>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigate('/build')}
        title="Abrir no /build"
        style={{
          background: 'rgba(8, 12, 18, 0.55)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-tertiary)',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          fontWeight: 700,
          padding: '5px 10px',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          borderRadius: 0,
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
          transition: 'color var(--motion-fast) var(--ease-smooth)',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ice-light)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
      >
        Abrir
      </button>
      <button
        type="button"
        onClick={onRemoveFromPlan}
        title="Tirar do plano"
        aria-label="Tirar do plano"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          padding: '4px 6px',
          display: 'inline-flex',
          alignItems: 'center',
          transition: 'color var(--motion-fast) var(--ease-smooth)',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
      >
        <X size={12} strokeWidth={1.8} />
      </button>
    </div>
  )
}

/**
 * Planned row de pendência (Mind / health_item diários) — espelha visual
 * de PlannedItemRow + integra sessões cronometradas (mind_session ou
 * health_item_session). Comportamento idêntico a quest/task/routine:
 *   - PLAY: cria session, banner global mostra
 *   - PAUSE/RESUME: gerencia cluster (record_id IS NULL)
 *   - FINALIZAR: pausa + sinaliza parent pra abrir modal pré-preenchido
 *   - Click no card: expande painel inline com info (cluster, rows)
 *
 * Após save do modal, parent dispara linkRecordToSession → cluster fecha.
 */
function PendenciaPlannedRow({
  item,
  onRemoveFromPlan,
  onFinalize,
  onSessionUpdate,
}: {
  item: any
  onRemoveFromPlan: () => void
  /** Sinaliza parent que user quer finalizar — parent abre modal correto
   *  com prefill do cluster ativo. Recebe item + cluster data. */
  onFinalize: (item: any, cluster: DiaSessionClusterLike) => void
  /** Avisa o App pra refetch o activeSession (mantém banner global em sync
   *  imediatamente — RQ invalidate sozinho não atinge o useState do App). */
  onSessionUpdate: () => void
}) {
  const isMind = item.origem === 'mind'
  const itemId = isMind ? null : parseInt(String(item.id).split(':')[1] ?? '0', 10)
  const cor = item.cor || (isMind ? '#9b88c4' : '#7fb8a8')
  const typeCode = isMind ? 'MND' : 'HLT'
  const durMin = item.estimated_minutes ?? 0
  const durLabel = durMin > 0
    ? (durMin >= 60
      ? `${Math.floor(durMin / 60)}H${durMin % 60 ? ` ${durMin % 60}M` : ''}`
      : `${durMin}M`)
    : '—'
  const borderColor = 'rgba(143, 191, 211, 0.22)'

  // ─── Sessões cronometradas — ambos hooks sempre chamados (regra de
  // hooks); o `enabled` no useHealthItemSession evita fetch quando isMind.
  // Mind sempre fetch — uma query a mais por card é tolerável.
  const mindSessionQ = useMindSession()
  const healthSessionQ = useHealthItemSession(isMind ? null : itemId)
  const cluster = (isMind ? mindSessionQ.data : healthSessionQ.data) ?? {
    has_active: false,
    is_running: false,
    started_at: null,
    ended_at: null,
    elapsed_seconds: 0,
    rows: [],
  }

  const startMind = useStartMindSession()
  const pauseMind = usePauseMindSession()
  const resumeMind = useResumeMindSession()
  const discardMind = useDiscardMindSession()
  const startHealth = useStartHealthItemSession()
  const pauseHealth = usePauseHealthItemSession()
  const resumeHealth = useResumeHealthItemSession()
  const discardHealth = useDiscardHealthItemSession()

  function doStart() {
    const opts = { onSuccess: () => onSessionUpdate() }
    if (isMind) startMind.mutate(undefined, opts)
    else if (itemId) startHealth.mutate(itemId, opts)
  }
  function doPause() {
    const opts = { onSuccess: () => onSessionUpdate() }
    if (isMind) pauseMind.mutate(undefined, opts)
    else if (itemId) pauseHealth.mutate(itemId, opts)
  }
  function doResume() {
    const opts = { onSuccess: () => onSessionUpdate() }
    if (isMind) resumeMind.mutate(undefined, opts)
    else if (itemId) resumeHealth.mutate(itemId, opts)
  }
  function doDiscard() {
    const opts = { onSuccess: () => onSessionUpdate() }
    if (isMind) discardMind.mutate(undefined, opts)
    else if (itemId) discardHealth.mutate(itemId, opts)
  }
  function doFinalize() {
    // Pausa se rodando, depois abre modal com cluster atual.
    const handleAfterPause = () => { onSessionUpdate(); onFinalize(item, cluster) }
    if (cluster.is_running) {
      if (isMind) pauseMind.mutate(undefined, { onSuccess: handleAfterPause })
      else if (itemId) pauseHealth.mutate(itemId, { onSuccess: handleAfterPause })
    } else {
      handleAfterPause()
    }
  }

  // Live timer — atualiza cada segundo quando rodando.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!cluster.is_running) return
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [cluster.is_running])
  // Computa elapsed: soma dos rows fechados + (now - last open started_at)
  let liveElapsedSec = cluster.elapsed_seconds
  if (cluster.is_running) {
    const lastOpen = cluster.rows.find(r => r.ended_at === null)
    if (lastOpen) {
      try {
        const start = new Date(lastOpen.started_at.replace('Z', '+00:00')).getTime()
        // Rows fechadas já estão somadas em elapsed_seconds; precisamos só
        // adicionar o tempo desde started_at da row ATUAL ABERTA. Mas o
        // backend já incluiu o tempo decorrido na response (usa now() quando
        // ended_at=null). Pra timer local, recalculamos: closed sum + (now - start)
        const closedSec = cluster.rows
          .filter(r => r.ended_at !== null)
          .reduce((acc, r) => {
            try {
              const s = new Date(r.started_at.replace('Z', '+00:00')).getTime()
              const e = new Date(r.ended_at!.replace('Z', '+00:00')).getTime()
              return acc + Math.max(0, Math.floor((e - s) / 1000))
            } catch { return acc }
          }, 0)
        liveElapsedSec = closedSec + Math.max(0, Math.floor((Date.now() - start) / 1000))
      } catch {}
    }
  }
  void tick  // re-render dependency

  function fmtElapsed(sec: number): string {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    const pad = (n: number) => String(n).padStart(2, '0')
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
  }

  // ─── Painel inline expansível (INFO) ─────────────────────────────────
  const [showInfo, setShowInfo] = useState(false)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        width: '100%',
        boxSizing: 'border-box',
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 6,
          position: 'relative',
          transition: 'transform var(--motion-fast) var(--ease-smooth)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'translateX(2px)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'translateX(0)'
        }}
      >
        {/* THUMBNAIL — mesmo visual de PlannedItemRow (gradient + chamfer) */}
        <div
          style={{
            width: 64,
            flexShrink: 0,
            background: `linear-gradient(135deg, ${cor}22, ${cor}08 60%, transparent)`,
            border: `1px solid ${borderColor}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            clipPath: 'polygon(8px 0, 100% 0, 100% 100%, 0 100%, 0 8px)',
            transition: 'border-color var(--motion-fast) var(--ease-smooth)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              fontWeight: 700,
              color: cor,
              letterSpacing: '0.12em',
              lineHeight: 1,
              textShadow: `0 0 6px ${cor}55`,
            }}
          >
            {typeCode}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.08em',
              lineHeight: 1,
            }}
          >
            {durLabel}
          </div>
          <div
            aria-hidden="true"
            style={{ width: 5, height: 5, background: cor, marginTop: 2 }}
          />
        </div>

        {/* MAIN CARD */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: 'rgba(8, 12, 18, 0.55)',
            border: `1px solid ${borderColor}`,
            borderRadius: 0,
            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            transition: 'border-color var(--motion-fast) var(--ease-smooth), background var(--motion-fast) var(--ease-smooth), box-shadow var(--motion-fast) var(--ease-smooth)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
            e.currentTarget.style.boxShadow = '0 0 12px rgba(143, 191, 211, 0.18)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = borderColor
            e.currentTarget.style.boxShadow = 'none'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              flexWrap: 'wrap',
              width: '100%',
              minWidth: 0,
            }}
          >
            <div style={{ flex: '1 1 180px', minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  color: 'var(--color-text-primary)',
                  fontWeight: 600,
                  fontSize: 13,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.title}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  marginTop: 4,
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ color: cor }}>
                  {isMind ? 'Mind' : 'Health'}
                </span>
                {item.horario_sugerido && (
                  <>
                    <span style={{ opacity: 0.4 }}>·</span>
                    <span>~{item.horario_sugerido}</span>
                  </>
                )}
              </div>
            </div>

            {/* Controles dinâmicos — espelha visual de RunnableControls */}
            <div
              style={{
                display: 'inline-flex',
                gap: 6,
                flexShrink: 0,
                alignSelf: 'flex-start',
                alignItems: 'center',
              }}
            >
              {/* Live timer quando rodando ou pausado */}
              {cluster.has_active && (
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    fontWeight: 700,
                    color: cluster.is_running ? cor : 'var(--color-text-muted)',
                    letterSpacing: '0.04em',
                    textShadow: cluster.is_running ? `0 0 8px ${cor}55` : 'none',
                    minWidth: 56,
                    textAlign: 'right',
                  }}
                  title={cluster.is_running ? 'em execução' : 'pausado'}
                >
                  {fmtElapsed(liveElapsedSec)}
                </span>
              )}
              {/* INFO toggle */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowInfo(v => !v)
                }}
                title={showInfo ? 'ocultar info' : 'ver info'}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text-muted)',
                  fontSize: 9,
                  padding: '2px 4px',
                  fontWeight: 700,
                  letterSpacing: '0.18em',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  transition: 'color 0.15s',
                  flexShrink: 0,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ice-light)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              >
                <span>{showInfo ? '▼' : '▶'}</span> INFO
              </button>
              {!cluster.has_active && (
                /* PLAY — idle */
                <button
                  type="button"
                  onClick={doStart}
                  title="iniciar sessão"
                  style={{
                    cursor: 'pointer', fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700, padding: '5px 10px',
                    letterSpacing: '0.18em', textTransform: 'uppercase',
                    borderRadius: 0,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    transition: 'all 0.15s',
                    background: 'rgba(143, 191, 211, 0.10)',
                    border: '1px solid rgba(143, 191, 211, 0.45)',
                    color: 'var(--color-ice-light)',
                    boxShadow: '0 0 10px rgba(143, 191, 211, 0.15)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(143, 191, 211, 0.20)'
                    e.currentTarget.style.boxShadow = '0 0 16px rgba(143, 191, 211, 0.40)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
                    e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.15)'
                  }}
                >
                  <Play size={9} strokeWidth={2} fill="currentColor" />
                  PLAY
                </button>
              )}
              {cluster.has_active && cluster.is_running && (
                /* PAUSE */
                <button
                  type="button"
                  onClick={doPause}
                  title="pausar"
                  style={{
                    cursor: 'pointer', fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700, padding: '5px 10px',
                    letterSpacing: '0.18em', textTransform: 'uppercase',
                    borderRadius: 0,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                    background: 'rgba(192, 138, 58, 0.10)',
                    border: '1px solid rgba(192, 138, 58, 0.55)',
                    color: 'var(--color-warning)',
                  }}
                >
                  ❚❚ PAUSE
                </button>
              )}
              {cluster.has_active && !cluster.is_running && (
                /* RESUME */
                <button
                  type="button"
                  onClick={doResume}
                  title="retomar"
                  style={{
                    cursor: 'pointer', fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700, padding: '5px 10px',
                    letterSpacing: '0.18em', textTransform: 'uppercase',
                    borderRadius: 0,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                    background: 'rgba(143, 191, 211, 0.10)',
                    border: '1px solid rgba(143, 191, 211, 0.45)',
                    color: 'var(--color-ice-light)',
                  }}
                >
                  <Play size={9} strokeWidth={2} fill="currentColor" />
                  RESUME
                </button>
              )}
              {cluster.has_active && (
                /* FINALIZAR */
                <button
                  type="button"
                  onClick={doFinalize}
                  title="finalizar — abre modal pra registrar"
                  style={{
                    cursor: 'pointer', fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700, padding: '5px 10px',
                    letterSpacing: '0.18em', textTransform: 'uppercase',
                    borderRadius: 0,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                    background: `${cor}22`,
                    border: `1px solid ${cor}`,
                    color: cor,
                    boxShadow: `0 0 10px ${cor}33`,
                  }}
                >
                  ▣ FINALIZAR
                </button>
              )}
              {cluster.has_active && (
                /* DISCARD — joga fora o cluster (não cria record) */
                <button
                  type="button"
                  onClick={async () => {
                    if (confirm('Descartar essa sessão? Não vai criar registro.')) {
                      doDiscard()
                    }
                  }}
                  title="descartar"
                  style={{
                    cursor: 'pointer', fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700, padding: '5px 8px',
                    background: 'transparent',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-muted)',
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                  }}
                >
                  ⌫
                </button>
              )}
              {/* X de remover — espelho do PlannedItemRow */}
              <button
                onClick={onRemoveFromPlan}
                title="remover do plano do dia"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text-muted)',
                  fontSize: 12,
                  padding: '0 6px',
                  opacity: 0.55,
                  transition: 'opacity 0.15s, color 0.15s',
                  lineHeight: 1,
                  flexShrink: 0,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.opacity = '1'
                  e.currentTarget.style.color = 'var(--color-accent-light)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.opacity = '0.55'
                  e.currentTarget.style.color = 'var(--color-text-muted)'
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* PAINEL INLINE — INFO expansível */}
          {showInfo && (
            <div
              style={{
                marginTop: 6,
                paddingTop: 6,
                borderTop: '1px dashed var(--color-divider)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.05em',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {cluster.has_active ? (
                <>
                  <div>
                    <span style={{ color: cor }}>STATUS:</span>{' '}
                    {cluster.is_running ? 'em execução' : 'pausado'}
                  </div>
                  {cluster.started_at && (
                    <div>
                      <span style={{ color: 'var(--color-text-tertiary)' }}>INÍCIO:</span>{' '}
                      {new Date(cluster.started_at).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  )}
                  <div>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>DURAÇÃO:</span>{' '}
                    {fmtElapsed(liveElapsedSec)} ({Math.floor(liveElapsedSec / 60)} min)
                  </div>
                  <div>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>SUB-SESSÕES:</span>{' '}
                    {cluster.rows.length} (play/pause cycles)
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span style={{ color: cor }}>STATUS:</span> ocioso — sem sessão iniciada
                  </div>
                  {item.estimated_minutes > 0 && (
                    <div>
                      <span style={{ color: 'var(--color-text-tertiary)' }}>DURAÇÃO PREVISTA:</span>{' '}
                      {item.estimated_minutes} min
                    </div>
                  )}
                  {item.horario_sugerido && (
                    <div>
                      <span style={{ color: 'var(--color-text-tertiary)' }}>HORÁRIO SUGERIDO:</span>{' '}
                      ~{item.horario_sugerido}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Lista de itens disponíveis no drawer de planejar dia, agrupada de forma
 * sutil pra dar contexto visual sem virar bagunça de hierarquia:
 *
 *   PROJETO X
 *     Entregável Y
 *       [card quest]
 *       [card quest]
 *
 *   PROJETO Z
 *     Entregável W
 *       [card quest]
 *
 *   TAREFAS
 *     [card task]
 *
 *   ROTINAS
 *     [card routine]
 *
 * Headers são minimalistas (uppercase pequena, tom muted). Indent é só
 * margin-left, sem bordas verticais, pra não competir com os cards.
 */
function AvailableList({ items, areas, projects, delivsByProject, onDragStart, onDragEnd }: {
  items: any[]
  areas: Area[]
  projects: Project[]
  delivsByProject: Record<string, Deliverable[]>
  onDragStart: (item: any) => void
  onDragEnd: () => void
}) {
  // Particiona em pendência / quests / tasks / routines preservando a
  // ordem original. Pendências (Mind/Health diários) ganham seção própria.
  const questItems: any[] = []
  const taskItems: any[] = []
  const routineItems: any[] = []
  const pendenciaItems: any[] = []
  for (const it of items) {
    if (it.isPendencia) pendenciaItems.push(it)
    else if (it.isTask) taskItems.push(it)
    else if (it.isRoutine) routineItems.push(it)
    else questItems.push(it)
  }

  // Agrupa quests por projeto e, dentro, por entregável. Mantém ordem de
  // primeira aparição (já filtrado pra "1 entregável ativo por projeto",
  // mas a fallback pode trazer mais — agrupar deixa fácil de ler de qualquer jeito).
  type DelivGroup = { delivId: string | null; delivTitle: string | null; items: any[] }
  type ProjectGroup = { projectId: string; projectTitle: string; areaColor: string; delivs: DelivGroup[] }
  const projectMap = new Map<string, ProjectGroup>()

  for (const q of questItems) {
    const pid = q.project_id ?? '__no_project__'
    if (!projectMap.has(pid)) {
      const proj = projects.find(p => p.id === q.project_id)
      const area = areas.find(a => a.slug === q.area_slug)
      projectMap.set(pid, {
        projectId: pid,
        projectTitle: proj?.title ?? '— sem projeto —',
        areaColor: area?.color ?? 'var(--color-text-tertiary)',
        delivs: [],
      })
    }
    const pg = projectMap.get(pid)!
    const did = q.deliverable_id ?? null
    let dg = pg.delivs.find(d => d.delivId === did)
    if (!dg) {
      const delivObj = q.project_id ? delivsByProject[q.project_id]?.find(d => d.id === did) : null
      dg = { delivId: did, delivTitle: delivObj?.title ?? null, items: [] }
      pg.delivs.push(dg)
    }
    dg.items.push(q)
  }

  const projectGroups = Array.from(projectMap.values())

  const sectionHeaderStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 9, color: 'var(--color-text-muted)',
    letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700,
    marginBottom: 6,
    display: 'flex', alignItems: 'center', gap: 4,
  }
  const projectHeaderStyle = (color: string): React.CSSProperties => ({
    fontFamily: 'var(--font-mono)',
    fontSize: 10, color: 'var(--color-ice-light)',
    letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700,
    marginBottom: 6,
    display: 'flex', alignItems: 'center', gap: 6,
    borderLeft: `2px solid ${color}`, paddingLeft: 8,
  })
  const delivHeaderStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 9, color: 'var(--color-text-muted)',
    letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600,
    marginBottom: 6, marginTop: 4,
    paddingLeft: 10,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {projectGroups.map(pg => (
        <div key={pg.projectId}>
          <div style={projectHeaderStyle(pg.areaColor)}>{pg.projectTitle}</div>
          {pg.delivs.map(dg => (
            <div key={dg.delivId ?? '__no_deliv__'} style={{ marginTop: 4 }}>
              {dg.delivTitle && <div style={delivHeaderStyle}>{dg.delivTitle}</div>}
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 6,
                paddingLeft: 10,
              }}>
                {dg.items.map(item => (
                  <AvailableCard
                    key={item.id}
                    item={item}
                    areas={areas}
                    projects={projects}
                    delivsByProject={delivsByProject}
                    onDragStart={() => onDragStart(item)}
                    onDragEnd={onDragEnd}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {taskItems.length > 0 && (
        <div>
          <div style={sectionHeaderStyle}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            TAREFAS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {taskItems.map(item => (
              <AvailableCard
                key={item.id}
                item={item}
                areas={areas}
                projects={projects}
                delivsByProject={delivsByProject}
                onDragStart={() => onDragStart(item)}
                onDragEnd={onDragEnd}
              />
            ))}
          </div>
        </div>
      )}

      {routineItems.length > 0 && (
        <div>
          <div style={sectionHeaderStyle}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            ROTINAS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {routineItems.map(item => (
              <AvailableCard
                key={item.id}
                item={item}
                areas={areas}
                projects={projects}
                delivsByProject={delivsByProject}
                onDragStart={() => onDragStart(item)}
                onDragEnd={onDragEnd}
              />
            ))}
          </div>
        </div>
      )}

      {pendenciaItems.length > 0 && (
        <div>
          <div style={sectionHeaderStyle}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            PENDÊNCIAS DO DIA
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pendenciaItems.map(item => (
              <AvailableCard
                key={item.id}
                item={item}
                areas={areas}
                projects={projects}
                delivsByProject={delivsByProject}
                onDragStart={() => onDragStart(item)}
                onDragEnd={onDragEnd}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AvailableCard({ item, areas, projects, delivsByProject, onDragStart, onDragEnd }: {
  item: any
  areas: Area[]
  projects: Project[]
  delivsByProject: Record<string, Deliverable[]>
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const isRoutine = !!item.isRoutine
  const isTask = !!item.isTask
  const isPendencia = !!item.isPendencia
  const done = itemIsDone(item)
  // Quest é o catch-all: só calcula area/parent/deliverable quando NÃO é
  // task/routine/pendência, pra não confundir tipos.
  const isQuest = !isTask && !isRoutine && !isPendencia
  const area = isQuest
    ? areas.find(a => a.slug === (item as Quest).area_slug)
    : null
  const color = isPendencia
    ? (item.cor || '#7fb8a8')
    : isTask
      ? 'var(--color-gold)'
      : isRoutine
        ? 'var(--color-routine-block)'
        : (area?.color ?? 'var(--color-text-tertiary)')

  const duration = itemDurationMin(item)
  const parent = isQuest && (item as Quest).project_id
    ? projects.find(p => p.id === (item as Quest).project_id)
    : null
  const deliverable = parent && (item as Quest).deliverable_id
    ? delivsByProject[parent.id]?.find(d => d.id === (item as Quest).deliverable_id)
    : null
  // Tipo primário no topo
  const typeLabel = isPendencia
    ? (item.origem === 'mind' ? 'Mind · pendência' : 'Health · pendência')
    : isTask
      ? 'Tarefa'
      : isRoutine
        ? 'Rotina'
        : (area?.name ?? (item as Quest).area_slug)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid rgba(143, 191, 211, 0.22)',
        borderLeft: `2px solid ${color}`,
        borderRadius: 0,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
        padding: '8px 12px',
        cursor: 'grab',
        transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s, opacity 0.15s, transform 0.15s',
        opacity: done ? 0.5 : 1,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'rgba(143, 191, 211, 0.08)'
        e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
        e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.15)'
        e.currentTarget.style.transform = 'translateX(2px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
        e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.22)'
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.transform = 'translateX(0)'
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
      }}>
        <div style={{
          flex: 1, minWidth: 0,
          fontFamily: 'var(--font-display)',
          fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 600,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textDecoration: done ? 'line-through' : 'none',
        }}>
          {item.title}
        </div>
        {Array.isArray(item.tightChain) && item.tightChain.length > 0 && (
          <span
            title={buildTightChainTooltip(item.tightChain)}
            style={{
              display: 'inline-flex', alignItems: 'center', flexShrink: 0,
              color: 'var(--color-warning)',
            }}
          >
            <AlertTriangle size={12} strokeWidth={2} />
          </span>
        )}
      </div>
      <div style={{
        marginTop: 4, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        fontFamily: 'var(--font-mono)',
        fontSize: 9, fontWeight: 700,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.15em', textTransform: 'uppercase',
      }}>
        <span style={{ color }}>
          {typeLabel}
        </span>
        {parent && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span style={{ color: 'var(--color-text-tertiary)' }}>
              {parent.title}
            </span>
          </>
        )}
        {deliverable && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span style={{ color: 'var(--color-ice-light)' }}>
              {deliverable.title}
            </span>
          </>
        )}
        {duration > 0 && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span style={{ opacity: 0.85 }}>~{fmtHM(duration)}</span>
          </>
        )}
        {isTask && (item as any).start_time && (item as any).end_time && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span style={{ opacity: 0.85 }}>{(item as any).start_time}–{(item as any).end_time}</span>
          </>
        )}
      </div>
    </div>
  )
}
