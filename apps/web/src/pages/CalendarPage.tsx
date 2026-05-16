import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Target } from 'lucide-react'
import type { Area, Deliverable, Project, Quest, Routine, Task } from '../types'
import { fetchSessions, fetchTasks, fetchTaskSessions, fetchRoutineSessions, fetchDeliverables, deleteRoutine, reportApiError } from '../api'
import { useRoutines, useAppInvalidator } from '../lib/app-queries'
import { tabSync } from '../lib/tabsync'
import { parseIsoAsUtc } from '../utils/datetime'
import { effectiveQuestDeadline, getAreaColor } from '../utils/quests'
import { SessionHistoryModal } from '../components/SessionHistoryModal'
import type { UnproductiveBlock } from '../utils/blocks'
import { getAllBlockRangesForDay } from '../utils/blocks'
import { Card } from '../components/ui/Primitives'
import { alertDialog } from '../lib/dialog'
import { RitualNextCard } from '../components/RitualNextCard'
import { useRitualSchedule, useRituals } from '../lib/build-queries'
import { useDiaPendencias } from '../lib/dia-queries'
import { loadDayPeriods, periodRangesMinFrom } from '../utils/dayPeriods'
import type { BuildRitual, BuildRitualCadencia } from '../types'

const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const DAY_NAMES   = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']

function pyDayToJs(py: number) { return (py + 1) % 7 }

/**
 * Layout de eventos sobrepostos estilo Google Calendar.
 *
 * Algoritmo:
 *  1. Agrupa eventos em clusters (sequências que se sobrepõem direta ou
 *     indiretamente — se A encosta B e B encosta C, todos ficam no mesmo
 *     cluster).
 *  2. Dentro do cluster, atribui cada evento à primeira coluna disponível
 *     (greedy por ordem de início).
 *  3. O `cols` final do cluster = maior índice de coluna + 1. Todos os
 *     eventos do cluster recebem esse mesmo total — garante largura
 *     uniforme dentro da "faixa" sobreposta.
 *
 * Retorno: Map id → { col, cols } pra cada evento. Caller usa pra calcular
 * `left` e `width` em CSS (ex: width = (100% - 8px) / cols).
 */
export function computeEventLayout(
  events: Array<{ id: string; startMin: number; endMin: number }>,
): Map<string, { col: number; cols: number }> {
  // Ordena por início; ties quebram pelo evento mais longo primeiro, pra
  // não mandar o curto pra coluna 0 e o longo pra direita.
  const sorted = [...events].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - a.endMin,
  )
  const result = new Map<string, { col: number; cols: number }>()
  let cluster: Array<{ id: string; endMin: number; col: number }> = []
  let clusterMaxEnd = -Infinity

  const flush = () => {
    const cols = cluster.reduce((m, c) => Math.max(m, c.col + 1), 0)
    for (const c of cluster) result.set(c.id, { col: c.col, cols })
    cluster = []
    clusterMaxEnd = -Infinity
  }

  for (const ev of sorted) {
    if (cluster.length > 0 && ev.startMin >= clusterMaxEnd) flush()
    const taken = new Set(cluster.filter(c => c.endMin > ev.startMin).map(c => c.col))
    let col = 0
    while (taken.has(col)) col++
    cluster.push({ id: ev.id, endMin: ev.endMin, col })
    clusterMaxEnd = Math.max(clusterMaxEnd, ev.endMin)
  }
  flush()
  return result
}

/** CSS left/width pra um slot com N colunas. Gap de 2px entre colunas. */
function laneStyle(col: number, cols: number): { left: string; width: string } {
  const gap = cols > 1 ? 2 : 0
  return {
    left: `calc(4px + ${col} * ((100% - 8px) / ${cols}))`,
    width: `calc((100% - 8px) / ${cols} - ${gap}px)`,
  }
}

/**
 * Devolve o intervalo (em minutos do dia 0..1440) em que uma sessão
 * `[start, end]` se sobrepõe ao dia `dateIso`. Null se não tem sobreposição.
 *
 * Usado pra renderizar sessões que atravessam meia-noite: a sessão vira até
 * 2 segmentos visuais (um até 24:00 do dia A, outro a partir de 00:00 do
 * dia B) — cada chamada por dia retorna o segmento daquele dia.
 *
 * `crossesIn` = sessão começou ANTES de hoje (segmento começa em 00:00).
 * `crossesOut` = sessão termina DEPOIS de hoje (segmento termina em 24:00).
 * UI usa esses flags pra mostrar borda chanfrada ou seta de continuação.
 */
function intersectDay(start: Date, end: Date, dateIso: string): {
  startMin: number; endMin: number; crossesIn: boolean; crossesOut: boolean
} | null {
  const dayStart = new Date(`${dateIso}T00:00:00`)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  if (end <= dayStart || start >= dayEnd) return null
  const segStart = start < dayStart ? dayStart : start
  const segEnd = end > dayEnd ? dayEnd : end
  return {
    startMin: (segStart.getTime() - dayStart.getTime()) / 60000,
    endMin: (segEnd.getTime() - dayStart.getTime()) / 60000,
    crossesIn: start < dayStart,
    crossesOut: end > dayEnd,
  }
}

function routineMatchesDay(r: Routine, jsDay: number): boolean {
  if (r.recurrence === 'daily') return true
  if (r.recurrence === 'weekdays') return jsDay >= 1 && jsDay <= 5
  if (r.recurrence === 'weekly') return pyDayToJs(r.day_of_week ?? -1) === jsDay
  return false
}

/**
 * Resolve onde no timeline cada item (ritual/health-item/mind) deve
 * aparecer, processando TODOS de uma vez pra evitar empilhamento no início
 * do período.
 *
 * Lógica em duas fases:
 *  1. Items com `horario_sugerido` preenchido ganham slot FIXO na hora
 *     informada (não entram no cascade).
 *  2. Items SEM hora caem no cascade do período onde foram alocados via
 *     dayPlan (localStorage `hq-day-plan-${dateIso}`). Dentro do período,
 *     items se encadeiam: o 1° começa no início do período, o 2° começa
 *     onde o 1° acaba, etc. Cap no fim do período pra não vazar.
 *
 * Items que não têm hora E não foram alocados ficam fora do map (não
 * renderizam como block — continuam visíveis só como marker no header).
 */
interface CalendarDayItem {
  id: string
  duracaoMin: number
  horarioSugerido?: string | null | undefined
}

function buildDayItemSlots(
  items: CalendarDayItem[],
  dateIso: string,
): Map<string, { startMin: number; endMin: number }> {
  const result = new Map<string, { startMin: number; endMin: number }>()
  const durOf = (item: CalendarDayItem) => Math.max(15, item.duracaoMin || 30)

  // Fase 1: horarios fixos.
  for (const item of items) {
    if (item.horarioSugerido && /^\d{2}:\d{2}$/.test(item.horarioSugerido)) {
      const [h, m] = item.horarioSugerido.split(':').map(Number)
      const start = h * 60 + m
      result.set(item.id, { startMin: start, endMin: start + durOf(item) })
    }
  }

  // Fase 2: cascade no período alocado via dayPlan.
  try {
    const raw = localStorage.getItem(`hq-day-plan-${dateIso}`)
    if (!raw) return result
    const plan = JSON.parse(raw) as {
      morning?: string[]
      afternoon?: string[]
      evening?: string[]
    }
    const periods = loadDayPeriods()
    const ranges = periodRangesMinFrom(periods)
    const periodKeys: Array<'morning' | 'afternoon' | 'evening'> = ['morning', 'afternoon', 'evening']

    for (const periodName of periodKeys) {
      const ids = plan[periodName] ?? []
      const periodStart = ranges[periodName][0]
      const periodEnd = ranges[periodName][1]
      let cursor = periodStart
      for (const id of ids) {
        // Item já posicionado por horario_sugerido tem prioridade — pula.
        if (result.has(id)) continue
        const item = items.find(i => i.id === id)
        if (!item) continue
        const dur = durOf(item)
        const end = Math.min(cursor + dur, periodEnd)
        result.set(id, { startMin: cursor, endMin: end })
        cursor = end
      }
    }
  } catch { /* ignore */ }

  return result
}

/**
 * `/calendario` — visão dia/semana/mês/ano. O modo "dia" e "semana" renderizam
 * um timeline 24h com sessões de quests (via `fetchSessions`), rotinas com
 * horário fixo, e blocos improdutivos (`hq-unproductive-blocks`, cross-midnight
 * via `getAllBlockRangesForDay`). Clicar num slot abre o modal de edição de
 * bloco improdutivo.
 */
export function CalendarView({ projects, quests, areas, sessionUpdateTrigger, onSessionUpdate }: { projects: Project[]; quests: Quest[]; areas: Area[]; sessionUpdateTrigger: number; onSessionUpdate?: () => void }) {
  // Routines via React Query — substituiu useState + fetchAllRoutines manual.
  // Agora compartilha cache com /rotinas, /dia, /build via prefixo de
  // appKeys.routines(), e escuta tabSync.on('routines') via listener
  // central no App.tsx.
  const appInv = useAppInvalidator()
  const routinesQ = useRoutines()
  const routines: Routine[] = routinesQ.data ?? []
  const [viewMode, setViewMode] = useState<'dia' | 'semana' | 'mês' | 'ano'>('dia')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [allSessions, setAllSessions] = useState<Map<string, any[]>>(new Map())
  const [tasks, setTasks] = useState<Task[]>([])
  const [allTaskSessions, setAllTaskSessions] = useState<Map<string, any[]>>(new Map())
  const [allRoutineSessions, setAllRoutineSessions] = useState<Map<string, any[]>>(new Map())
  // Deliverables por projeto — usado pra resolver `effectiveQuestDeadline`
  // (quest herda deadline do entregável → projeto). Buscado em paralelo no
  // mount + sempre que a lista de project_ids das quests muda.
  const [delivsByProject, setDelivsByProject] = useState<Record<string, Deliverable[]>>({})
  // Modal de histórico/edição de sessão. Setado quando user clica num bloco
  // do timeline. Carrega as sessões já populadas em allSessions/...,
  // filtrando pela entity escolhida.
  const [sessionModal, setSessionModal] = useState<{ kind: 'quest' | 'task' | 'routine'; entityId: string } | null>(null)
  // Tick por minuto pra linha de "agora" seguir o relógio — antes estava
  // congelado no instante do mount, o que dava sensação de atraso conforme
  // o tempo passa.
  const [currentTime, setCurrentTime] = useState(new Date())

  // Schedule de rituais no intervalo visível — carregado quando viewMode é
  // 'mês' ou 'semana'. Renderiza marcadores nas células dos dias.
  const scheduleRange = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const isoOf = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    if (viewMode === 'mês') {
      const y = currentDate.getFullYear()
      const m = currentDate.getMonth()
      const lastDay = new Date(y, m + 1, 0).getDate()
      return {
        from: `${y}-${pad(m + 1)}-01`,
        to: `${y}-${pad(m + 1)}-${pad(lastDay)}`,
      }
    }
    if (viewMode === 'semana') {
      const weekStart = new Date(
        currentDate.getTime() - ((currentDate.getDay() - 1 + 7) % 7) * 86400000,
      )
      const weekEnd = new Date(weekStart.getTime() + 6 * 86400000)
      return { from: isoOf(weekStart), to: isoOf(weekEnd) }
    }
    return { from: null, to: null }
  }, [viewMode, currentDate])
  const { data: ritualSchedule = [] } = useRitualSchedule(scheduleRange.from, scheduleRange.to)
  const ritualsByDate = useMemo(() => {
    const map = new Map<string, BuildRitualCadencia[]>()
    for (const item of ritualSchedule) {
      for (const dt of item.datas) {
        const arr = map.get(dt) ?? []
        arr.push(item.cadencia)
        map.set(dt, arr)
      }
    }
    return map
  }, [ritualSchedule])

  // Rituais com metadados (cadência, nome, duração) pra resolver em blocks
  // no timeline. ritualSchedule só dá as datas; rituals dá o detalhe.
  const { data: rituals = [] } = useRituals()
  const ritualByCadencia = useMemo(() => {
    const map = new Map<BuildRitualCadencia, BuildRitual>()
    for (const r of rituals) map.set(r.cadencia, r)
    return map
  }, [rituals])

  // Pendências do dia visualizado (health items + mind). Hook recebe a data
  // do calendário (não só hoje), permitindo blocks futuros se houver
  // `horario_sugerido` ou dayPlan setado.
  const dateIsoTmp = (() => {
    const d = currentDate
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const { data: dayPendencias = [] } = useDiaPendencias(dateIsoTmp)

  // Slot map: resolve onde cada item (ritual/health/mind) cai no timeline,
  // processando todos juntos pra evitar empilhamento (vários blocks na
  // mesma hora). Items com horario_sugerido têm hora fixa; items só
  // alocados via dayPlan cascateiam dentro do período. Recalcula quando
  // a data muda OU listas mudam.
  const dayItemSlots = useMemo(() => {
    const items: CalendarDayItem[] = []
    const ritualCadenciasNoDia = ritualsByDate.get(dateIsoTmp) ?? []
    for (const cadencia of ritualCadenciasNoDia) {
      const ritual = ritualByCadencia.get(cadencia)
      if (!ritual) continue
      items.push({
        id: `ritual:${cadencia}`,
        duracaoMin: ritual.duracao_alvo_min,
        horarioSugerido: null,
      })
    }
    for (const p of dayPendencias) {
      items.push({
        id: p.pendencia_id,
        duracaoMin: p.duracao_min ?? 0,
        horarioSugerido: p.horario_sugerido,
      })
    }
    return buildDayItemSlots(items, dateIsoTmp)
  }, [dateIsoTmp, ritualsByDate, ritualByCadencia, dayPendencias])

  useEffect(() => {
    const update = () => setCurrentTime(new Date())
    update()
    const id = setInterval(update, 60_000)
    return () => clearInterval(id)
  }, [])
  const [timelineZoom, setTimelineZoom] = useState(1)
  const timelineRef = useRef<HTMLDivElement>(null)
  const [unproductiveBlocks, setUnproductiveBlocks] = useState<UnproductiveBlock[]>(() => {
    const saved = localStorage.getItem('hq-unproductive-blocks')
    if (saved) return JSON.parse(saved)
    return []
  })
  const [editingBlock, setEditingBlock] = useState<UnproductiveBlock | null>(null)
  const [showBlockModal, setShowBlockModal] = useState(false)
  const [isCreatingBlock, setIsCreatingBlock] = useState(false)
  // Data específica que o user clicou (YYYY-MM-DD) — define o escopo do "apenas
  // este evento" / "este e seguintes". Vazio quando criando bloco novo.
  const [editingBlockDate, setEditingBlockDate] = useState<string | null>(null)
  const [blockScope, setBlockScope] = useState<'this' | 'following' | 'all'>('all')
  // Popup de "Aplicar a" — só aparece depois que o user clica Salvar/Excluir
  // em um bloco recorrente. Action define o branch (commit ou remover).
  const [showScopePopup, setShowScopePopup] = useState(false)
  const [scopeAction, setScopeAction] = useState<'save' | 'delete'>('save')

  useEffect(() => {
    localStorage.setItem('hq-unproductive-blocks', JSON.stringify(unproductiveBlocks))
  }, [unproductiveBlocks])

  // Fetch dos deliverables por projeto. Pool de project_ids vem das quests.
  // Reusa fetchDeliverables (um GET por projeto) — paralelizado e tolerante
  // a falha individual. O delivsByProject alimenta o effectiveQuestDeadline.
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

  useEffect(() => {
    Promise.all(quests.map(q => fetchSessions(q.id).then(sessions => ({ questId: q.id, sessions })).catch(() => ({ questId: q.id, sessions: [] }))))
      .then(results => {
        const map = new Map()
        results.forEach(({ questId, sessions }) => {
          map.set(questId, sessions)
        })
        setAllSessions(map)
      })
  }, [quests, sessionUpdateTrigger])

  // Tasks: fetch list + sessões pra renderizar no timeline.
  useEffect(() => {
    fetchTasks().then(setTasks).catch(err => reportApiError('CalendarPage', err))
  }, [sessionUpdateTrigger])

  useEffect(() => {
    Promise.all(tasks.map(t => fetchTaskSessions(t.id)
      .then(sessions => ({ taskId: t.id, sessions }))
      .catch(() => ({ taskId: t.id, sessions: [] as any[] }))))
      .then(results => {
        const map = new Map<string, any[]>()
        results.forEach(({ taskId, sessions }) => { map.set(taskId, sessions) })
        setAllTaskSessions(map)
      })
  }, [tasks, sessionUpdateTrigger])

  // Routines: sessões por routine (depende da data visível pois a API pede target).
  useEffect(() => {
    const iso = `${currentDate.getFullYear()}-${String(currentDate.getMonth()+1).padStart(2,'0')}-${String(currentDate.getDate()).padStart(2,'0')}`
    Promise.all(routines.map(r => fetchRoutineSessions(r.id, iso)
      .then(sessions => ({ routineId: r.id, sessions }))
      .catch(() => ({ routineId: r.id, sessions: [] as any[] }))))
      .then(results => {
        const map = new Map<string, any[]>()
        results.forEach(({ routineId, sessions }) => { map.set(routineId, sessions) })
        setAllRoutineSessions(map)
      })
  }, [routines, currentDate, sessionUpdateTrigger])

  const todayIso = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  })()

  const dateIso = (() => {
    return `${currentDate.getFullYear()}-${String(currentDate.getMonth()+1).padStart(2,'0')}-${String(currentDate.getDate()).padStart(2,'0')}`
  })()

  const dateLabel = currentDate.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

  function questsForDay(iso: string) {
    // Quest herda deadline do entregável → projeto. q.deadline (legado) é
    // ignorado; tudo flui pelo helper centralizado.
    return quests.filter(q =>
      q.status !== 'done' &&
      effectiveQuestDeadline(q, delivsByProject, projects) === iso,
    )
  }

  function routinesForDay(iso: string) {
    const jsDay = new Date(iso + 'T12:00:00').getDay()
    return routines.filter(r => routineMatchesDay(r, jsDay))
  }

  // Layout de colunas pra eventos sobrepostos do dia (view diária).
  // Coleta todos os blocos timeline do `dateIso` — sessões de quest/task/
  // rotina + rotinas agendadas — e atribui `col` + `cols` pra cada um via
  // `computeEventLayout`. Ids devem bater com os usados no render abaixo.
  // Sessões cross-midnight aparecem como segmento clipado nos dias afetados.
  const dayEventLayout = useMemo(() => {
    const evs: Array<{ id: string; startMin: number; endMin: number }> = []

    const collectSessions = <T extends { id: string }>(
      items: T[],
      sessionsMap: Map<string, any[]>,
      idPrefix: string,
    ) => {
      items.forEach(item => {
        const sessions = sessionsMap.get(item.id) || []
        sessions.forEach((s: any, idx: number) => {
          if (!s?.started_at) return
          const start = parseIsoAsUtc(s.started_at)
          const end = s.ended_at ? parseIsoAsUtc(s.ended_at) : new Date()
          const seg = intersectDay(start, end, dateIso)
          if (!seg) return
          // Mantém piso de 15min só pra sessão "real" (sem clip) — segmentos
          // clipados devem mostrar a duração visível exata, sem inflar.
          const em = (seg.crossesIn || seg.crossesOut)
            ? seg.endMin
            : Math.max(seg.startMin + 15, seg.endMin)
          evs.push({ id: `${idPrefix}:${item.id}:${idx}`, startMin: seg.startMin, endMin: em })
        })
      })
    }

    collectSessions(quests, allSessions, 'q')
    collectSessions(tasks, allTaskSessions, 't')
    collectSessions(routines, allRoutineSessions, 'rs')

    routinesForDay(dateIso).forEach(routine => {
      if (!routine.start_time || !routine.end_time) return
      const [sh, sm] = routine.start_time.split(':').map(Number)
      const [eh, em] = routine.end_time.split(':').map(Number)
      const sMin = sh * 60 + sm
      const eMin = eh * 60 + em
      if (eMin <= sMin) return
      evs.push({ id: `r:${routine.id}`, startMin: sMin, endMin: eMin })
    })

    // Rituais — slot vem do dayItemSlots map (cascade dentro do período).
    // Items sem hora fixa nem allocation ficam fora do map → só marker.
    const ritualCadenciasNoDia = ritualsByDate.get(dateIso) ?? []
    for (const cadencia of ritualCadenciasNoDia) {
      const itemId = `ritual:${cadencia}`
      const slot = dayItemSlots.get(itemId)
      if (slot) evs.push({ id: itemId, startMin: slot.startMin, endMin: slot.endMin })
    }

    // Health items + Mind — slot vem do mesmo map. horario_sugerido tem
    // prioridade; cascade entra como fallback.
    for (const p of dayPendencias) {
      const slot = dayItemSlots.get(p.pendencia_id)
      if (slot) evs.push({ id: `pen:${p.pendencia_id}`, startMin: slot.startMin, endMin: slot.endMin })
    }

    return computeEventLayout(evs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quests, tasks, routines, allSessions, allTaskSessions, allRoutineSessions, dateIso, ritualsByDate, dayPendencias, dayItemSlots])

  return (
    <div style={{ color: 'var(--color-text-primary)' }}>
      {/* Surface excepcional do estrategista no executor — só aparece quando
          há ritual atrasado OU agendado pra hoje. Decisão #15 do PLAN /Build. */}
      <div style={{ marginBottom: 12 }}>
        <RitualNextCard urgentOnly />
      </div>
    <Card padding="none" style={{
      animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
    }}>
      {/* Hairline ice elétrica — assinatura HUD CP2077 */}
      <div className="hq-hairline-ice" />
      {/* Header com atmosphere ice/fog */}
      <div style={{
        padding: 'var(--space-5) var(--space-6) var(--space-4)',
        background: `
          radial-gradient(ellipse 100% 80% at 0% 0%, rgba(143, 191, 211, 0.05), transparent 60%),
          radial-gradient(ellipse 60% 80% at 100% 0%, rgba(50, 62, 73, 0.20), transparent 65%),
          linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
        `,
        borderBottom: '1px solid var(--color-ice-deep)',
      }}>
      <header style={{
        display: 'flex', alignItems: 'flex-end', gap: 14,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, color: 'var(--color-text-muted)',
            letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700,
            marginBottom: 4,
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            CALENDAR
          </div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 14, fontWeight: 600,
            letterSpacing: '0.04em',
            color: 'var(--color-text-primary)',
            lineHeight: 1.1,
            textTransform: 'uppercase',
          }}>
            {viewMode === 'dia' ? 'VISÃO DO DIA' : viewMode === 'semana' ? 'VISÃO DA SEMANA' : viewMode === 'mês' ? 'VISÃO DO MÊS' : 'VISÃO DO ANO'}
          </div>
        </div>
        {/* Mode tabs — pills cyber chamfered (igual filtros Hub Finance) */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['dia', 'semana', 'mês', 'ano'] as const).map((mode) => {
            const active = viewMode === mode
            return (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  background: active ? 'rgba(143, 191, 211, 0.10)' : 'rgba(8, 12, 18, 0.55)',
                  border: `1px solid ${active ? 'rgba(143, 191, 211, 0.45)' : 'var(--color-border)'}`,
                  cursor: 'pointer',
                  color: active ? 'var(--color-ice-light)' : 'var(--color-text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  padding: '6px 12px',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                  transition: 'all 0.15s',
                  boxShadow: active ? '0 0 12px rgba(143, 191, 211, 0.18)' : 'none',
                }}
              >
                {mode}
              </button>
            )
          })}
        </div>
      </header>
      </div>
      <div style={{ padding: 'var(--space-5) var(--space-6)' }}>

      {viewMode === 'dia' && (
        <div>
          {/* Day nav — chevron icons cyber + // DATE label + HOJE button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
            <button
              type="button"
              className="hq-icon-btn"
              onClick={() => setCurrentDate(new Date(currentDate.getTime() - 86400000))}
              title="Dia anterior"
              aria-label="Dia anterior"
              style={{ minWidth: 32, minHeight: 32 }}
            >
              <ChevronLeft size={14} strokeWidth={1.8} />
            </button>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
              padding: '6px 16px',
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid var(--color-ice-deep)',
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-ice)',
                letterSpacing: '0.22em', textTransform: 'uppercase',
                marginRight: 4,
              }}>//</span>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                color: 'var(--color-ice-light)',
                fontWeight: 600,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
                minWidth: 220,
                textAlign: 'center',
              }}>
                {dateLabel}
              </div>
              <button
                type="button"
                onClick={() => setCurrentDate(new Date())}
                style={{
                  background: 'rgba(143, 191, 211, 0.14)',
                  border: '1px solid var(--color-ice)',
                  cursor: 'pointer',
                  color: 'var(--color-ice-light)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  padding: '4px 10px',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                  boxShadow: '0 0 10px rgba(143, 191, 211, 0.22)',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(143, 191, 211, 0.22)'
                  e.currentTarget.style.boxShadow = '0 0 14px rgba(143, 191, 211, 0.45)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(143, 191, 211, 0.14)'
                  e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.22)'
                }}
              >
                HOJE
              </button>
            </div>
            <button
              type="button"
              className="hq-icon-btn"
              onClick={() => setCurrentDate(new Date(currentDate.getTime() + 86400000))}
              title="Próximo dia"
              aria-label="Próximo dia"
              style={{ minWidth: 32, minHeight: 32 }}
            >
              <ChevronRight size={14} strokeWidth={1.8} />
            </button>
          </div>

          {/* Legend — chips cyber chamfered */}
          <div style={{
            display: 'flex',
            gap: 6,
            marginBottom: 'var(--space-4)',
            flexWrap: 'wrap',
          }}>
            {[
              { label: 'QST', name: 'QUESTS', color: 'var(--color-ice)' },
              { label: 'TSK', name: 'TAREFAS', color: 'var(--color-warning)' },
              { label: 'RTN', name: 'ROTINAS', color: 'var(--color-success)' },
              { label: 'RTL', name: 'RITUAIS', color: '#dc2531' },
              { label: 'EXC', name: 'EXERCÍCIOS', color: 'var(--color-ice-light)' },
              { label: 'MND', name: 'MIND', color: '#9b88c4' },
              { label: 'IMP', name: 'IMPRODUTIVO', color: 'var(--color-text-muted)' },
            ].map(item => (
              <div
                key={item.label}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-text-tertiary)',
                  letterSpacing: '0.18em', textTransform: 'uppercase',
                  padding: '4px 10px',
                  background: 'rgba(8, 12, 18, 0.55)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                }}
              >
                <div style={{
                  width: 6, height: 6,
                  background: item.color,
                  flexShrink: 0,
                  boxShadow: `0 0 4px ${item.color}`,
                }} />
                <span style={{ color: item.color }}>{item.label}</span>
                <span style={{ opacity: 0.7 }}>{item.name}</span>
              </div>
            ))}
          </div>

          <div style={{ overflow: 'auto', height: '80vh' }}>
            {(() => {
              const dayProjects = projects.filter(p => p.deadline === dateIso && !p.archived_at)
              if (!dayProjects.length) return null
              return (
                <div
                  style={{
                    position: 'sticky', top: 0, zIndex: 10,
                    padding: '8px 12px',
                    marginBottom: 8,
                    background: 'rgba(8, 12, 18, 0.85)',
                    backdropFilter: 'blur(16px) saturate(140%)',
                    WebkitBackdropFilter: 'blur(16px) saturate(140%)',
                    border: '1px solid var(--color-ice-deep)',
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
                    display: 'flex', gap: 8,
                    flexWrap: 'wrap', alignItems: 'center',
                  }}
                >
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700,
                    color: 'var(--color-ice-light)',
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    marginRight: 6,
                  }}>
                    <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                    DEADLINES HOJE
                  </span>
                  {dayProjects.map(q => (
                    <span
                      key={q.id}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        fontFamily: 'var(--font-display)',
                        fontSize: 11, fontWeight: 600,
                        color: 'var(--color-text-primary)',
                        letterSpacing: '0.03em',
                        textTransform: 'uppercase',
                        background: 'rgba(143, 191, 211, 0.08)',
                        border: '1px solid rgba(143, 191, 211, 0.30)',
                        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                        padding: '4px 10px',
                      }}
                    >
                      <Target size={11} strokeWidth={1.8} style={{ color: 'var(--color-ice-light)' }} />
                      {q.title}
                    </span>
                  ))}
                </div>
              )
            })()}

            <div
              ref={timelineRef}
              onWheel={(e) => {
                if (e.shiftKey || (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  setTimelineZoom(prev => {
                    const newZoom = e.deltaY > 0 ? prev - 0.2 : prev + 0.2
                    return Math.max(0.5, Math.min(3, newZoom))
                  })
                }
              }}
              style={{ display: 'flex', gap: 0 }}
            >
              <div style={{ width: 56, flexShrink: 0, paddingTop: 20 }}>
                {Array.from({ length: 24 }).map((_, hour) => (
                  <div
                    key={hour}
                    style={{
                      position: 'relative',
                      height: 60 * timelineZoom,
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'flex-end',
                      paddingRight: 10,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9, fontWeight: 700,
                      color: 'var(--color-ice-light)',
                      letterSpacing: '0.08em',
                      borderBottom: '1px solid var(--color-ice-deep)',
                    }}
                  >
                    {String(hour).padStart(2, '0')}:00
                    {/* Marca de :30 — só aparece com zoom suficiente. */}
                    {timelineZoom >= 1 && (
                      <span style={{
                        position: 'absolute',
                        top: '50%', right: 10,
                        transform: 'translateY(-50%)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 8, fontWeight: 600,
                        color: 'var(--color-text-muted)',
                        letterSpacing: '0.05em',
                        opacity: 0.65,
                      }}>
                        :30
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ flex: 1, position: 'relative', borderLeft: '1px solid var(--color-ice-deep)', paddingTop: 20 }}>
                {Array.from({ length: 24 }).map((_, hour) => (
                  <div
                    key={hour}
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      const clickY = e.clientY - rect.top
                      const hourOffset = clickY / (60 * timelineZoom)
                      const clickedHour = hour + hourOffset

                      const newBlock: UnproductiveBlock = {
                        id: Date.now().toString(),
                        title: 'Novo Evento',
                        start: Math.round(clickedHour * 2) / 2,
                        end: Math.round((clickedHour * 2 + 1)) / 2,
                        recurrence: 'none',
                        endsOn: 'never',
                        effectiveFrom: dateIso,
                        effectiveUntil: dateIso,
                      }
                      setEditingBlock(newBlock)
                      setEditingBlockDate(null)
                      setBlockScope('all')
                      setIsCreatingBlock(true)
                      setShowBlockModal(true)
                    }}
                    style={{
                      height: 60 * timelineZoom,
                      borderBottom: '1px solid rgba(143, 191, 211, 0.12)',
                      position: 'relative',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(143, 191, 211, 0.05)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    {/* Marca visual de :30 no timeline — linha tracejada ice. */}
                    {timelineZoom >= 1 && (
                      <div
                        aria-hidden
                        style={{
                          position: 'absolute',
                          top: '50%', left: 0, right: 0,
                          borderTop: '1px dashed rgba(143, 191, 211, 0.12)',
                          opacity: 0.6,
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                  </div>
                ))}

                {dateIso === todayIso && (
                  <div
                    style={{
                      position: 'absolute',
                      top: `${20 + (currentTime.getHours() + currentTime.getMinutes() / 60) * 60 * timelineZoom}px`,
                      left: 0, right: 0,
                      height: 1,
                      background: 'linear-gradient(90deg, var(--color-ice), var(--color-ice-light) 50%, transparent)',
                      boxShadow: '0 0 14px rgba(143, 191, 211, 0.55), 0 0 4px rgba(143, 191, 211, 0.85)',
                      zIndex: 100,
                      pointerEvents: 'none',
                    }}
                  >
                    {/* Square ice pulsante no início da linha (HUD vibe) */}
                    <div
                      style={{
                        position: 'absolute',
                        left: -6, top: -4,
                        width: 9, height: 9,
                        background: 'var(--color-ice)',
                        boxShadow: '0 0 10px var(--color-ice-glow), inset 0 0 0 1px rgba(255, 255, 255, 0.20)',
                      }}
                    />
                    {/* Label HH:MM em mono */}
                    <div
                      style={{
                        position: 'absolute',
                        left: 12, top: -7,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9, fontWeight: 700,
                        color: 'var(--color-ice-light)',
                        letterSpacing: '0.12em',
                        textShadow: '0 0 6px rgba(143, 191, 211, 0.55)',
                        background: 'rgba(8, 12, 18, 0.85)',
                        padding: '2px 6px',
                        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                      }}
                    >
                      {String(currentTime.getHours()).padStart(2, '0')}:{String(currentTime.getMinutes()).padStart(2, '0')}
                    </div>
                  </div>
                )}

                {getAllBlockRangesForDay(unproductiveBlocks, currentDate).map((r, idx) => {
                  const topPercent = 20 + r.start * 60 * timelineZoom
                  const heightPercent = (r.end - r.start) * 60 * timelineZoom
                  // Blocos improdutivos: bg dark + diagonal stripes ice deep
                  // sutis (vibe "área desativada HUD")
                  return (
                    <div
                      key={`unproductive-${r.block.id}-${idx}`}
                      onClick={() => {
                        setEditingBlock(r.block)
                        setEditingBlockDate(dateIso)
                        setBlockScope('this')
                        setShowBlockModal(true)
                      }}
                      style={{
                        position: 'absolute',
                        left: '0',
                        right: '0',
                        top: `${topPercent}px`,
                        height: `${Math.max(20, heightPercent)}px`,
                        background: `repeating-linear-gradient(135deg, rgba(40, 50, 57, 0.55) 0, rgba(40, 50, 57, 0.55) 6px, rgba(28, 38, 48, 0.7) 6px, rgba(28, 38, 48, 0.7) 12px)`,
                        borderLeft: '2px solid var(--color-text-muted)',
                        zIndex: 1,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderLeft = '2px solid var(--color-ice)'
                        e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(143, 191, 211, 0.30)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderLeft = '2px solid var(--color-text-muted)'
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                      title={`${r.block.title} - Clique para editar`}
                    >
                      {heightPercent > 20 && (
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 8, fontWeight: 700,
                          color: 'var(--color-text-muted)',
                          letterSpacing: '0.18em', textTransform: 'uppercase',
                          padding: '3px 6px',
                        }}>
                          <span style={{ color: 'var(--color-text-tertiary)', marginRight: 4 }}>//</span>
                          {r.block.title}
                        </div>
                      )}
                    </div>
                  )
                })}

                {quests.map((quest) => {
                  const sessions = allSessions.get(quest.id) || []
                  // Pra cada sessão, computa o segmento que se sobrepõe ao
                  // dia atual. Sessão que atravessa meia-noite aparece nos
                  // dois dias clipada — `crossesIn/crossesOut` indica isso.
                  const todaySegments = sessions.flatMap((s, idx) => {
                    if (!s?.started_at) return []
                    const start = parseIsoAsUtc(s.started_at)
                    const end = s.ended_at ? parseIsoAsUtc(s.ended_at) : new Date()
                    const seg = intersectDay(start, end, dateIso)
                    return seg ? [{ session: s, idx, start, end, seg }] : []
                  })
                  const parentQuest = quest.project_id ? projects.find(p => p.id === quest.project_id) : null

                  return todaySegments.map(({ idx, start, end, seg }) => {
                    const startHour = seg.startMin / 60
                    const durationMin = seg.endMin - seg.startMin
                    const topPercent = 20 + startHour * 60 * timelineZoom
                    const heightPercent = durationMin * timelineZoom
                    const displayTitle = parentQuest ? `${parentQuest.title} > ${quest.title}` : quest.title

                    const lay = dayEventLayout.get(`q:${quest.id}:${idx}`) ?? { col: 0, cols: 1 }
                    const lane = laneStyle(lay.col, lay.cols)
                    const isShort = durationMin < 25
                    const fmtTime = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })
                    // Label sempre mostra horário REAL da sessão (não o do
                    // segmento clipado), com setas indicando continuação.
                    const timeLabel = `${seg.crossesIn ? '↪ ' : ''}${fmtTime(start)} → ${fmtTime(end)}${seg.crossesOut ? ' ↩' : ''}`
                    return (
                      <Fragment key={`q-${quest.id}-${idx}`}>
                        {isShort && (
                          <>
                            <div
                              title={`${displayTitle} · ${timeLabel}`}
                              style={{
                                position: 'absolute',
                                left: lane.left, width: lane.width,
                                top: `${topPercent - 24}px`,
                                fontSize: 8, fontWeight: 400, lineHeight: 1,
                                color: 'var(--color-text-muted)',
                                fontFamily: 'var(--font-mono)',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                paddingLeft: 2, paddingRight: 2,
                                zIndex: 3,
                              }}
                            >
                              {timeLabel}
                            </div>
                            <div
                              title={`${displayTitle} · ${timeLabel}`}
                              style={{
                                position: 'absolute',
                                left: lane.left, width: lane.width,
                                top: `${topPercent - 13}px`,
                                fontSize: 9, fontWeight: 600, lineHeight: 1.1,
                                color: 'var(--color-text-primary)',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                paddingLeft: 2, paddingRight: 2,
                                zIndex: 3,
                              }}
                            >
                              {displayTitle}
                            </div>
                          </>
                        )}
                        <div
                          title={`${displayTitle} · ${timeLabel} — clique pra ver / editar histórico`}
                          onClick={() => setSessionModal({ kind: 'quest', entityId: quest.id })}
                          style={{
                            position: 'absolute',
                            left: lane.left,
                            width: lane.width,
                            top: `${topPercent}px`,
                            height: `${heightPercent}px`,
                            background: `linear-gradient(135deg, ${getAreaColor(quest.area_slug, areas)}cc, ${getAreaColor(quest.area_slug, areas)}88)`,
                            borderRadius: 0,
                            padding: isShort ? '0' : '4px 6px',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            cursor: 'pointer',
                            opacity: 0.95,
                            transition: 'opacity 0.15s, box-shadow 0.15s, filter 0.15s',
                            boxShadow: `inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 0 8px ${getAreaColor(quest.area_slug, areas)}55`,
                            borderLeft: `2px solid ${getAreaColor(quest.area_slug, areas)}`,
                            // Chamfer top-right ou bottom-left dependendo se cruza meia-noite
                            clipPath: seg.crossesIn || seg.crossesOut
                              ? undefined
                              : 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.opacity = '1'
                            e.currentTarget.style.filter = 'brightness(1.15)'
                            e.currentTarget.style.boxShadow = `inset 0 0 0 1px rgba(255, 255, 255, 0.30), 0 0 14px ${getAreaColor(quest.area_slug, areas)}aa`
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.opacity = '0.95'
                            e.currentTarget.style.filter = 'brightness(1)'
                            e.currentTarget.style.boxShadow = `inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 0 8px ${getAreaColor(quest.area_slug, areas)}55`
                          }}
                        >
                          {!isShort && (
                            <>
                              <div style={{
                                fontFamily: 'var(--font-display)',
                                fontSize: 10, fontWeight: 600,
                                color: '#fff',
                                letterSpacing: '0.03em',
                                textTransform: 'uppercase',
                                lineHeight: 1.2,
                                wordBreak: 'break-word',
                                textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
                              }}>
                                {displayTitle.substring(0, 35)}
                              </div>
                              <div style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: 8, fontWeight: 700,
                                color: 'rgba(255, 255, 255, 0.92)',
                                letterSpacing: '0.08em',
                                marginTop: 2,
                                textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
                              }}>
                                {timeLabel}
                              </div>
                            </>
                          )}
                        </div>
                      </Fragment>
                    )
                  })
                })}

                {/* Sessões de TAREFAS (play/pause/stop → blocos no timeline) */}
                {tasks.map((task) => {
                  const sessions = allTaskSessions.get(task.id) || []
                  const todaySegments = sessions.flatMap((s, idx) => {
                    if (!s?.started_at) return []
                    const start = parseIsoAsUtc(s.started_at)
                    const end = s.ended_at ? parseIsoAsUtc(s.ended_at) : new Date()
                    const seg = intersectDay(start, end, dateIso)
                    return seg ? [{ session: s, idx, start, end, seg }] : []
                  })
                  return todaySegments.map(({ session, idx, start, end, seg }) => {
                    const startHour = seg.startMin / 60
                    const durationMin = seg.endMin - seg.startMin
                    const topPercent = 20 + startHour * 60 * timelineZoom
                    const heightPercent = durationMin * timelineZoom
                    const running = !session.ended_at
                    const lay = dayEventLayout.get(`t:${task.id}:${idx}`) ?? { col: 0, cols: 1 }
                    const lane = laneStyle(lay.col, lay.cols)
                    const isShort = durationMin < 25
                    const fmtTime = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })
                    const timeLabel = `${seg.crossesIn ? '↪ ' : ''}${fmtTime(start)} → ${fmtTime(end)}${seg.crossesOut ? ' ↩' : ''}`
                    return (
                      <Fragment key={`task-sess-${task.id}-${idx}`}>
                        {isShort && (
                          <>
                            <div
                              title={`${task.title} · ${timeLabel}`}
                              style={{
                                position: 'absolute',
                                left: lane.left, width: lane.width,
                                top: `${topPercent - 24}px`,
                                fontSize: 8, fontWeight: 400, lineHeight: 1,
                                color: 'var(--color-text-muted)',
                                fontFamily: 'var(--font-mono)',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                paddingLeft: 2, paddingRight: 2,
                                zIndex: 3,
                              }}
                            >
                              {timeLabel}
                            </div>
                            <div
                              title={`${task.title} · ${timeLabel}`}
                              style={{
                                position: 'absolute',
                                left: lane.left, width: lane.width,
                                top: `${topPercent - 13}px`,
                                fontSize: 9, fontWeight: 600, lineHeight: 1.1,
                                color: 'var(--color-text-primary)',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                paddingLeft: 2, paddingRight: 2,
                                zIndex: 3,
                              }}
                            >
                              {task.title}
                            </div>
                          </>
                        )}
                        <div
                          title={`${task.title} · ${running ? 'rodando' : 'finalizada'} · ${timeLabel} — clique pra ver / editar histórico`}
                          onClick={() => setSessionModal({ kind: 'task', entityId: task.id })}
                          style={{
                            position: 'absolute', left: lane.left, width: lane.width,
                            top: `${topPercent}px`, height: `${heightPercent}px`,
                            background: `linear-gradient(135deg, var(--color-warning) 0%, rgba(192, 138, 58, 0.65) 100%)`,
                            border: running ? '1px dashed var(--color-ice-light)' : '1px solid rgba(255, 255, 255, 0.18)',
                            borderLeft: '2px solid var(--color-warning)',
                            borderRadius: 0,
                            clipPath: seg.crossesIn || seg.crossesOut
                              ? undefined
                              : 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))',
                            padding: isShort ? '0' : '4px 6px',
                            overflow: 'hidden',
                            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                            opacity: 0.95,
                            cursor: 'pointer',
                            boxShadow: running
                              ? 'inset 0 0 0 1px rgba(143, 191, 211, 0.35), 0 0 14px rgba(143, 191, 211, 0.30)'
                              : 'inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 0 8px rgba(192, 138, 58, 0.55)',
                            transition: 'opacity 0.15s, filter 0.15s, box-shadow 0.15s',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.opacity = '1'
                            e.currentTarget.style.filter = 'brightness(1.15)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.opacity = '0.95'
                            e.currentTarget.style.filter = 'brightness(1)'
                          }}
                        >
                          {!isShort && (
                            <>
                              <div style={{
                                fontFamily: 'var(--font-display)',
                                fontSize: 10, fontWeight: 600,
                                color: '#fff',
                                letterSpacing: '0.03em',
                                textTransform: 'uppercase',
                                lineHeight: 1.2,
                                textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
                              }}>
                                <span style={{ color: 'var(--color-bg-primary)', marginRight: 4, opacity: 0.7 }}>TSK</span>
                                {task.title.substring(0, 35)}
                              </div>
                              <div style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: 8, fontWeight: 700,
                                color: 'rgba(255, 255, 255, 0.92)',
                                letterSpacing: '0.08em',
                                marginTop: 2,
                                textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
                              }}>
                                {timeLabel}
                              </div>
                            </>
                          )}
                        </div>
                      </Fragment>
                    )
                  })
                })}

                {/* Sessões de ROTINAS (play/pause/stop real, separado do horário fixo agendado) */}
                {routines.map((routine) => {
                  const sessions = allRoutineSessions.get(routine.id) || []
                  const todaySegments = sessions.flatMap((s, idx) => {
                    if (!s?.started_at) return []
                    const start = parseIsoAsUtc(s.started_at)
                    const end = s.ended_at ? parseIsoAsUtc(s.ended_at) : new Date()
                    const seg = intersectDay(start, end, dateIso)
                    return seg ? [{ session: s, idx, start, end, seg }] : []
                  })
                  return todaySegments.map(({ session, idx, start, end, seg }) => {
                    const startHour = seg.startMin / 60
                    const durationMin = seg.endMin - seg.startMin
                    const topPercent = 20 + startHour * 60 * timelineZoom
                    const heightPercent = durationMin * timelineZoom
                    const running = !session.ended_at
                    const lay = dayEventLayout.get(`rs:${routine.id}:${idx}`) ?? { col: 0, cols: 1 }
                    const lane = laneStyle(lay.col, lay.cols)
                    const isShort = durationMin < 25
                    const fmtTime = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })
                    const timeLabel = `${seg.crossesIn ? '↪ ' : ''}${fmtTime(start)} → ${fmtTime(end)}${seg.crossesOut ? ' ↩' : ''}`
                    return (
                      <Fragment key={`routine-sess-${routine.id}-${idx}`}>
                        {isShort && (
                          <>
                            <div
                              title={`${routine.title} · ${timeLabel}`}
                              style={{
                                position: 'absolute',
                                left: lane.left, width: lane.width,
                                top: `${topPercent - 24}px`,
                                fontSize: 8, fontWeight: 400, lineHeight: 1,
                                color: 'var(--color-text-muted)',
                                fontFamily: 'var(--font-mono)',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                paddingLeft: 2, paddingRight: 2,
                                zIndex: 3,
                              }}
                            >
                              {timeLabel}
                            </div>
                            <div
                              title={`${routine.title} · ${timeLabel}`}
                              style={{
                                position: 'absolute',
                                left: lane.left, width: lane.width,
                                top: `${topPercent - 13}px`,
                                fontSize: 9, fontWeight: 600, lineHeight: 1.1,
                                color: 'var(--color-text-primary)',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                paddingLeft: 2, paddingRight: 2,
                                zIndex: 3,
                              }}
                            >
                              {routine.title}
                            </div>
                          </>
                        )}
                        <div
                          title={`${routine.title} · ${running ? 'rodando' : 'finalizada'} · ${timeLabel} — clique pra ver / editar histórico`}
                          onClick={() => setSessionModal({ kind: 'routine', entityId: routine.id })}
                          style={{
                            position: 'absolute', left: lane.left, width: lane.width,
                            top: `${topPercent}px`, height: `${heightPercent}px`,
                            background: `linear-gradient(135deg, var(--color-success) 0%, rgba(94, 122, 82, 0.55) 100%)`,
                            border: running ? '1px dashed var(--color-ice-light)' : '1px solid rgba(255, 255, 255, 0.18)',
                            borderLeft: '2px solid var(--color-success)',
                            borderRadius: 0,
                            clipPath: seg.crossesIn || seg.crossesOut
                              ? undefined
                              : 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))',
                            padding: isShort ? '0' : '4px 6px',
                            overflow: 'hidden',
                            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                            opacity: 0.95,
                            cursor: 'pointer',
                            boxShadow: running
                              ? 'inset 0 0 0 1px rgba(143, 191, 211, 0.35), 0 0 14px rgba(143, 191, 211, 0.30)'
                              : 'inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 0 8px rgba(94, 122, 82, 0.55)',
                            transition: 'opacity 0.15s, filter 0.15s',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.opacity = '1'
                            e.currentTarget.style.filter = 'brightness(1.15)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.opacity = '0.95'
                            e.currentTarget.style.filter = 'brightness(1)'
                          }}
                        >
                          {!isShort && (
                            <>
                              <div style={{
                                fontFamily: 'var(--font-display)',
                                fontSize: 10, fontWeight: 600,
                                color: '#fff',
                                letterSpacing: '0.03em',
                                textTransform: 'uppercase',
                                lineHeight: 1.2,
                                textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
                              }}>
                                <span style={{ opacity: 0.7, marginRight: 4 }}>RTN</span>
                                {routine.title.substring(0, 35)}
                              </div>
                              <div style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: 8, fontWeight: 700,
                                color: 'rgba(255, 255, 255, 0.92)',
                                letterSpacing: '0.08em',
                                marginTop: 2,
                                textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
                              }}>
                                {timeLabel}
                              </div>
                            </>
                          )}
                        </div>
                      </Fragment>
                    )
                  })
                })}

                {routinesForDay(dateIso).map((routine) => {
                  if (!routine.start_time || !routine.end_time) return null

                  const [startHours, startMinutes] = routine.start_time.split(':').map(Number)
                  const [endHours, endMinutes] = routine.end_time.split(':').map(Number)

                  const startTotal = startHours + startMinutes / 60
                  const endTotal = endHours + endMinutes / 60
                  const duration = endTotal - startTotal

                  const topPercent = 20 + startTotal * 60 * timelineZoom
                  // Altura 100% proporcional à duração real (1 min = 1px no
                  // zoom padrão). Rótulo move pra cima do bloco quando < 25min.
                  const heightPercent = duration * 60 * timelineZoom
                  const durationMin = duration * 60
                  const isShort = durationMin < 25
                  const timeLabel = `${routine.start_time} – ${routine.end_time}`

                  const lay = dayEventLayout.get(`r:${routine.id}`) ?? { col: 0, cols: 1 }
                  const lane = laneStyle(lay.col, lay.cols)
                  return (
                    <Fragment key={routine.id}>
                      {isShort && (
                        <>
                          <div
                            title={`${routine.title} · ${timeLabel}`}
                            style={{
                              position: 'absolute',
                              left: lane.left, width: lane.width,
                              top: `${topPercent - 24}px`,
                              fontSize: 8, fontWeight: 400, lineHeight: 1,
                              color: 'var(--color-text-muted)',
                              fontFamily: 'var(--font-mono)',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              paddingLeft: 2, paddingRight: 2,
                              zIndex: 3,
                            }}
                          >
                            {timeLabel}
                          </div>
                          <div
                            title={`${routine.title} · ${timeLabel}`}
                            style={{
                              position: 'absolute',
                              left: lane.left, width: lane.width,
                              top: `${topPercent - 13}px`,
                              fontSize: 9, fontWeight: 600, lineHeight: 1.1,
                              color: routine.done ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                              textDecoration: routine.done ? 'line-through' : 'none',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              paddingLeft: 2, paddingRight: 2,
                              zIndex: 3,
                            }}
                          >
                            {routine.title}
                          </div>
                        </>
                      )}
                      <div
                        title={`${routine.title} · ${timeLabel} — clique pra ver / editar histórico`}
                        onClick={() => setSessionModal({ kind: 'routine', entityId: routine.id })}
                        style={{
                          position: 'absolute',
                          left: lane.left,
                          width: lane.width,
                          top: `${topPercent}px`,
                          height: `${heightPercent}px`,
                          background: routine.done
                            ? 'rgba(40, 50, 57, 0.45)'
                            : 'rgba(8, 12, 18, 0.55)',
                          border: `1px dashed ${routine.done ? 'var(--color-text-muted)' : 'var(--color-success)'}`,
                          borderLeft: `2px solid ${routine.done ? 'var(--color-text-muted)' : 'var(--color-success)'}`,
                          borderRadius: 0,
                          clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))',
                          padding: isShort ? '0' : '4px 6px',
                          overflow: 'hidden',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          opacity: routine.done ? 0.55 : 0.95,
                          transition: 'opacity 0.15s, box-shadow 0.15s, background 0.15s',
                          boxShadow: routine.done ? 'none' : '0 0 8px rgba(94, 122, 82, 0.30)',
                        }}
                        onMouseEnter={e => {
                          if (routine.done) {
                            e.currentTarget.style.opacity = '0.7'
                          } else {
                            e.currentTarget.style.background = 'rgba(94, 122, 82, 0.10)'
                            e.currentTarget.style.boxShadow = '0 0 14px rgba(94, 122, 82, 0.50)'
                          }
                        }}
                        onMouseLeave={e => {
                          if (routine.done) {
                            e.currentTarget.style.opacity = '0.55'
                          } else {
                            e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
                            e.currentTarget.style.boxShadow = '0 0 8px rgba(94, 122, 82, 0.30)'
                          }
                        }}
                      >
                        {!isShort && (
                          <>
                            <div style={{
                              fontFamily: 'var(--font-display)',
                              fontSize: 10, fontWeight: 600,
                              color: routine.done ? 'var(--color-text-tertiary)' : 'var(--color-success-light)',
                              letterSpacing: '0.03em',
                              textTransform: 'uppercase',
                              lineHeight: 1.2,
                              textDecoration: routine.done ? 'line-through' : 'none',
                            }}>
                              <span style={{ color: routine.done ? 'var(--color-text-muted)' : 'var(--color-success)', marginRight: 4, opacity: 0.85 }}>RTN</span>
                              {routine.title.substring(0, 25)}
                            </div>
                            <div style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 8, fontWeight: 700,
                              color: routine.done ? 'var(--color-text-muted)' : 'var(--color-text-tertiary)',
                              letterSpacing: '0.08em',
                              marginTop: 2,
                            }}>
                              {timeLabel}
                            </div>
                          </>
                        )}
                        {!isShort && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (confirm(`Excluir rotina "${routine.title}"?`)) {
                                deleteRoutine(routine.id)
                                  .then(() => { appInv.routines(); tabSync.emit('routines') })
                                  .catch(() => alertDialog({ title: 'Erro', message: 'Erro ao excluir rotina', variant: 'danger' }))
                              }
                            }}
                            style={{
                              position: 'absolute',
                              top: '2px',
                              right: '2px',
                              background: 'none',
                              border: 'none',
                              color: 'var(--color-error)',
                              cursor: 'pointer',
                              fontSize: '10px',
                              padding: '2px 4px',
                              opacity: 0.6,
                              transition: 'opacity 0.15s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                            onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
                            title="Excluir rotina"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </Fragment>
                  )
                })}

                {/* Rituais alocados — slot vem do dayItemSlots map (cascade
                    no período; items sem hora nem allocation ficam fora). */}
                {(ritualsByDate.get(dateIso) ?? []).map((cadencia) => {
                  const ritual = ritualByCadencia.get(cadencia)
                  if (!ritual) return null
                  const itemId = `ritual:${cadencia}`
                  const slot = dayItemSlots.get(itemId)
                  if (!slot) return null
                  const topPercent = 20 + (slot.startMin / 60) * 60 * timelineZoom
                  const heightPercent = ((slot.endMin - slot.startMin) / 60) * 60 * timelineZoom
                  const lay = dayEventLayout.get(itemId) ?? { col: 0, cols: 1 }
                  const lane = laneStyle(lay.col, lay.cols)
                  const ritualName = ritual.nome || `Ritual ${cadencia}`
                  const accent = '#dc2531' // Neomilitarism red
                  return (
                    <div
                      key={itemId}
                      title={`${ritualName} · ritual ${cadencia} · ${ritual.duracao_alvo_min}min`}
                      style={{
                        position: 'absolute',
                        left: lane.left,
                        width: lane.width,
                        top: `${topPercent}px`,
                        height: `${heightPercent}px`,
                        background: `linear-gradient(135deg, ${accent}1a 0%, transparent 60%), rgba(8, 12, 18, 0.55)`,
                        border: `1px solid ${accent}`,
                        clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))',
                        padding: '4px 6px',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        opacity: 0.95,
                        boxShadow: `0 0 8px ${accent}40`,
                      }}
                    >
                      <div style={{
                        fontSize: 9, fontWeight: 600, lineHeight: 1.1,
                        color: 'var(--color-text-primary)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {ritualName}
                      </div>
                      <div style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 8, fontWeight: 700,
                        color: accent,
                        letterSpacing: '0.08em',
                      }}>
                        RTL · {cadencia.toUpperCase()}
                      </div>
                    </div>
                  )
                })}

                {/* Pendências (Health items + Mind) — slot vem do
                    dayItemSlots map. Mind = roxo, health = cor do domain. */}
                {dayPendencias.map((p) => {
                  const slot = dayItemSlots.get(p.pendencia_id)
                  if (!slot) return null
                  const topPercent = 20 + (slot.startMin / 60) * 60 * timelineZoom
                  const heightPercent = ((slot.endMin - slot.startMin) / 60) * 60 * timelineZoom
                  const lay = dayEventLayout.get(`pen:${p.pendencia_id}`) ?? { col: 0, cols: 1 }
                  const lane = laneStyle(lay.col, lay.cols)
                  const accent = p.cor || (p.origem === 'mind' ? '#9b88c4' : 'var(--color-ice)')
                  const code = p.origem === 'mind' ? 'MND' : 'EXC'
                  return (
                    <div
                      key={`pen:${p.pendencia_id}`}
                      title={`${p.titulo} · ${p.origem === 'mind' ? 'mind' : 'exercício'} · ${p.duracao_min || '?'}min`}
                      style={{
                        position: 'absolute',
                        left: lane.left,
                        width: lane.width,
                        top: `${topPercent}px`,
                        height: `${heightPercent}px`,
                        background: `linear-gradient(135deg, ${accent}1a 0%, transparent 60%), rgba(8, 12, 18, 0.55)`,
                        border: `1px solid ${accent}`,
                        clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))',
                        padding: '4px 6px',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        opacity: 0.9,
                      }}
                    >
                      <div style={{
                        fontSize: 9, fontWeight: 600, lineHeight: 1.1,
                        color: 'var(--color-text-primary)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {p.titulo}
                      </div>
                      <div style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 8, fontWeight: 700,
                        color: accent,
                        letterSpacing: '0.08em',
                      }}>
                        {code}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'semana' && (() => {
        const weekStart = new Date(currentDate.getTime() - ((currentDate.getDay() - 1 + 7) % 7) * 86400000)
        const weekEnd = new Date(weekStart.getTime() + 6 * 86400000)
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
        const weekStartStripped = new Date(weekStart); weekStartStripped.setHours(0, 0, 0, 0)
        const isCurrentWeek = todayStart.getTime() >= weekStartStripped.getTime()
          && todayStart.getTime() <= weekStartStripped.getTime() + 6 * 86400000
        const fmtDay = (d: Date) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })
        return (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <button
              type="button"
              className="hq-icon-btn"
              onClick={() => setCurrentDate(new Date(currentDate.getTime() - 604800000))}
              title="Semana anterior"
              aria-label="Semana anterior"
              style={{ minWidth: 32, minHeight: 32 }}
            >
              <ChevronLeft size={14} strokeWidth={1.8} />
            </button>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '6px 16px',
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid var(--color-ice-deep)',
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-ice)',
                letterSpacing: '0.22em', textTransform: 'uppercase',
                marginRight: 4,
              }}>//</span>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                color: 'var(--color-ice-light)',
                fontWeight: 600,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
              }}>
                {fmtDay(weekStart)} – {fmtDay(weekEnd)}
              </div>
              <button
                onClick={() => setCurrentDate(new Date())}
                disabled={isCurrentWeek}
                style={{
                  background: isCurrentWeek
                    ? 'rgba(8, 12, 18, 0.55)'
                    : 'rgba(143, 191, 211, 0.14)',
                  border: `1px solid ${isCurrentWeek ? 'var(--color-border)' : 'var(--color-ice)'}`,
                  cursor: isCurrentWeek ? 'default' : 'pointer',
                  color: isCurrentWeek ? 'var(--color-text-muted)' : 'var(--color-ice-light)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  padding: '4px 10px',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                  boxShadow: isCurrentWeek ? 'none' : '0 0 10px rgba(143, 191, 211, 0.22)',
                  opacity: isCurrentWeek ? 0.5 : 1,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  if (isCurrentWeek) return
                  e.currentTarget.style.background = 'rgba(143, 191, 211, 0.22)'
                  e.currentTarget.style.boxShadow = '0 0 14px rgba(143, 191, 211, 0.45)'
                }}
                onMouseLeave={e => {
                  if (isCurrentWeek) return
                  e.currentTarget.style.background = 'rgba(143, 191, 211, 0.14)'
                  e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.22)'
                }}
              >ESTA SEMANA</button>
            </div>
            <button
              type="button"
              className="hq-icon-btn"
              onClick={() => setCurrentDate(new Date(currentDate.getTime() + 604800000))}
              title="Próxima semana"
              aria-label="Próxima semana"
              style={{ minWidth: 32, minHeight: 32 }}
            >
              <ChevronRight size={14} strokeWidth={1.8} />
            </button>
          </div>

          {/* Legend cyber chamfered (igual day view) */}
          <div style={{
            display: 'flex', gap: 6, marginBottom: 16,
            flexWrap: 'wrap',
          }}>
            {[
              { label: 'RTN', name: 'ROTINAS', color: 'var(--color-success)' },
              { label: 'QST', name: 'QUESTS', color: 'var(--color-ice)' },
              { label: 'RTL', name: 'RITUAIS', color: '#dc2531' },
              { label: 'EXC', name: 'EXERCÍCIOS', color: 'var(--color-ice-light)' },
              { label: 'MND', name: 'MIND', color: '#9b88c4' },
              { label: 'IMP', name: 'IMPRODUTIVO', color: 'var(--color-text-muted)' },
            ].map(item => (
              <div
                key={item.label}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-text-tertiary)',
                  letterSpacing: '0.18em', textTransform: 'uppercase',
                  padding: '4px 10px',
                  background: 'rgba(8, 12, 18, 0.55)',
                  border: '1px solid var(--color-border)',
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                }}
              >
                <div style={{
                  width: 6, height: 6,
                  background: item.color, flexShrink: 0,
                  boxShadow: `0 0 4px ${item.color}`,
                }} />
                <span style={{ color: item.color }}>{item.label}</span>
                <span style={{ opacity: 0.7 }}>{item.name}</span>
              </div>
            ))}
          </div>

          <div style={{ overflow: 'auto', height: '85vh' }}>
            <div
              onWheel={(e) => {
                if (e.shiftKey || (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  setTimelineZoom(prev => {
                    const newZoom = e.deltaY > 0 ? prev - 0.2 : prev + 0.2
                    return Math.max(0.5, Math.min(3, newZoom))
                  })
                }
              }}
              style={{ display: 'flex', gap: 0, overflow: 'auto' }}
          >
            <div style={{ width: 56, flexShrink: 0, paddingTop: 40 }}>
              {Array.from({ length: 24 }).map((_, hour) => (
                <div
                  key={hour}
                  style={{
                    height: 40 * timelineZoom,
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'flex-end',
                    paddingRight: 10,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700,
                    color: 'var(--color-ice-light)',
                    letterSpacing: '0.08em',
                    borderBottom: '1px solid rgba(143, 191, 211, 0.10)',
                  }}
                >
                  {String(hour).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {Array.from({ length: 7 }).map((_, dayIdx) => {
              const dayDate = new Date(currentDate)
              dayDate.setDate(dayDate.getDate() - (currentDate.getDay() - 1 + 7) % 7 + dayIdx)
              const dayIso = `${dayDate.getFullYear()}-${String(dayDate.getMonth()+1).padStart(2,'0')}-${String(dayDate.getDate()).padStart(2,'0')}`
              const dayName = dayDate.toLocaleDateString('pt-BR', { weekday: 'short' })
              const dayNum = dayDate.getDate()
              const dayRoutines = routinesForDay(dayIso)
              const isToday = dayIso === todayIso
              const dayRituals = ritualsByDate.get(dayIso) ?? []

              return (
                <div
                  key={dayIso}
                  style={{
                    flex: 1,
                    minWidth: 120,
                    borderLeft: dayIdx === 0
                      ? '1px solid var(--color-ice-deep)'
                      : '1px solid rgba(143, 191, 211, 0.12)',
                    borderRight: dayIdx === 6 ? '1px solid var(--color-ice-deep)' : undefined,
                    position: 'relative',
                    background: isToday ? 'rgba(143, 191, 211, 0.04)' : 'transparent',
                  }}
                >
                  <button
                    onClick={() => { setCurrentDate(dayDate); setViewMode('dia') }}
                    title={`ver ${dayName} ${dayNum} na visão dia`}
                    style={{
                      position: 'sticky',
                      top: 0,
                      width: '100%',
                      background: isToday
                        ? 'rgba(143, 191, 211, 0.14)'
                        : 'rgba(8, 12, 18, 0.85)',
                      padding: '8px 4px',
                      border: 'none',
                      borderBottom: `1px solid ${isToday ? 'var(--color-ice)' : 'var(--color-ice-deep)'}`,
                      textAlign: 'center',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      color: isToday
                        ? 'var(--color-ice-light)'
                        : 'var(--color-text-secondary)',
                      fontWeight: 700,
                      letterSpacing: '0.18em',
                      textTransform: 'uppercase',
                      zIndex: 10,
                      cursor: 'pointer',
                      boxShadow: isToday ? '0 0 12px rgba(143, 191, 211, 0.25)' : 'none',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                  >
                    <div style={{
                      letterSpacing: '0.22em',
                      lineHeight: 1,
                      color: isToday ? 'var(--color-ice)' : 'var(--color-text-tertiary)',
                    }}>
                      {dayName}
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 13,
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                      marginTop: 2,
                      color: isToday ? 'var(--color-ice-light)' : 'var(--color-text-primary)',
                      textShadow: isToday ? '0 0 6px rgba(143, 191, 211, 0.45)' : 'none',
                    }}>
                      {dayNum}
                    </div>
                    {/* Marcadores de ritual — bolinhas vermelhas no header
                        do dia. Hover via title nativo. */}
                    {dayRituals.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          gap: 2,
                          justifyContent: 'center',
                          marginTop: 4,
                        }}
                        title={`Ritual${dayRituals.length === 1 ? '' : 'is'}: ${dayRituals.join(', ')}`}
                      >
                        {dayRituals.map((c) => (
                          <span
                            key={c}
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: '50%',
                              background: '#dc2531',
                              boxShadow: '0 0 4px rgba(220, 37, 49, 0.6)',
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </button>

                  {(() => {
                    const dayProjects = projects.filter(p => p.deadline === dayIso && !p.archived_at)
                    if (!dayProjects.length) return null
                    return (
                      <div style={{
                        position: 'sticky', top: 40, zIndex: 10,
                        background: 'rgba(8, 12, 18, 0.85)',
                        backdropFilter: 'blur(8px) saturate(140%)',
                        WebkitBackdropFilter: 'blur(8px) saturate(140%)',
                        padding: '2px 3px',
                        borderBottom: '1px solid var(--color-ice-deep)',
                        display: 'flex', flexDirection: 'column', gap: 2,
                      }}>
                        {dayProjects.map(q => (
                          <div key={q.id} style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 9, fontWeight: 700,
                            color: 'var(--color-ice-light)',
                            letterSpacing: '0.12em', textTransform: 'uppercase',
                            background: 'rgba(143, 191, 211, 0.08)',
                            border: '1px solid rgba(143, 191, 211, 0.30)',
                            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                            padding: '2px 6px',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            <span style={{ color: 'var(--color-ice)', marginRight: 4 }}>//</span>
                            {q.title}
                          </div>
                        ))}
                      </div>
                    )
                  })()}

                  {Array.from({ length: 24 }).map((_, hour) => (
                    <div
                      key={hour}
                      onClick={(e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        const clickY = e.clientY - rect.top
                        const hourOffset = clickY / (40 * timelineZoom)
                        const clickedHour = hour + hourOffset

                        const newBlock: UnproductiveBlock = {
                          id: Date.now().toString(),
                          title: 'Novo Evento',
                          start: Math.round(clickedHour * 2) / 2,
                          end: Math.round((clickedHour * 2 + 1)) / 2,
                          recurrence: 'none',
                          endsOn: 'never',
                          effectiveFrom: dayIso,
                          effectiveUntil: dayIso,
                        }
                        setEditingBlock(newBlock)
                        setEditingBlockDate(null)
                        setBlockScope('all')
                        setIsCreatingBlock(true)
                        setShowBlockModal(true)
                      }}
                      style={{
                        height: 40 * timelineZoom,
                        borderBottom: '1px solid rgba(143, 191, 211, 0.10)',
                        position: 'relative',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(143, 191, 211, 0.05)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent'
                      }}
                    />
                  ))}

                  {getAllBlockRangesForDay(unproductiveBlocks, dayDate).map((r, idx) => {
                    const topPercent = 40 + r.start * 40 * timelineZoom
                    const heightPercent = (r.end - r.start) * 40 * timelineZoom

                    return (
                      <div
                        key={`unproductive-${dayIso}-${r.block.id}-${idx}`}
                        onClick={() => {
                          setEditingBlock(r.block)
                          setEditingBlockDate(dayIso)
                          setBlockScope('this')
                          setShowBlockModal(true)
                        }}
                        style={{
                          position: 'absolute',
                          left: '0',
                          right: '0',
                          top: `${topPercent}px`,
                          height: `${Math.max(20, heightPercent)}px`,
                          background: `repeating-linear-gradient(135deg, rgba(40, 50, 57, 0.55) 0, rgba(40, 50, 57, 0.55) 5px, rgba(28, 38, 48, 0.7) 5px, rgba(28, 38, 48, 0.7) 10px)`,
                          borderLeft: '2px solid var(--color-text-muted)',
                          zIndex: 1,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderLeft = '2px solid var(--color-ice)'
                          e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(143, 191, 211, 0.30)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderLeft = '2px solid var(--color-text-muted)'
                          e.currentTarget.style.boxShadow = 'none'
                        }}
                        title={`${r.block.title} - Clique para editar`}
                      >
                        {heightPercent > 20 && (
                          <div style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 7, fontWeight: 700,
                            color: 'var(--color-text-muted)',
                            letterSpacing: '0.15em', textTransform: 'uppercase',
                            padding: '2px 4px',
                          }}>
                            <span style={{ color: 'var(--color-text-tertiary)', marginRight: 3 }}>//</span>
                            {r.block.title}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {dayIso === todayIso && (
                    <div
                      style={{
                        position: 'absolute',
                        top: `${40 + (currentTime.getHours() + currentTime.getMinutes() / 60) * 40 * timelineZoom}px`,
                        left: 0, right: 0,
                        height: 1,
                        background: 'linear-gradient(90deg, var(--color-ice), var(--color-ice-light) 50%, transparent)',
                        boxShadow: '0 0 10px rgba(143, 191, 211, 0.55), 0 0 3px rgba(143, 191, 211, 0.85)',
                        zIndex: 100,
                        pointerEvents: 'none',
                      }}
                    >
                      <div style={{
                        position: 'absolute',
                        left: -4, top: -3,
                        width: 7, height: 7,
                        background: 'var(--color-ice)',
                        boxShadow: '0 0 8px var(--color-ice-glow)',
                      }} />
                    </div>
                  )}

                  {quests.map((quest) => {
                    const sessions = allSessions.get(quest.id) || []
                    const daySegments = sessions.flatMap((s, idx) => {
                      if (!s?.started_at) return []
                      const start = parseIsoAsUtc(s.started_at)
                      const end = s.ended_at ? parseIsoAsUtc(s.ended_at) : new Date()
                      const seg = intersectDay(start, end, dayIso)
                      return seg ? [{ idx, seg }] : []
                    })
                    const parentQuest = quest.project_id ? projects.find(p => p.id === quest.project_id) : null
                    const displayTitle = parentQuest ? `${parentQuest.title} > ${quest.title}` : quest.title

                    return daySegments.map(({ idx, seg }) => {
                      const startHour = seg.startMin / 60
                      const durationMin = seg.endMin - seg.startMin
                      const topPercent = startHour * 40 * timelineZoom
                      const heightPercent = Math.max(10, durationMin / 60 * 40 * timelineZoom)

                      return (
                        <div
                          key={`${quest.id}-${idx}`}
                          style={{
                            position: 'absolute',
                            left: '2px',
                            right: '2px',
                            top: `${40 + topPercent}px`,
                            height: `${heightPercent}px`,
                            background: `linear-gradient(135deg, ${getAreaColor(quest.area_slug, areas)}cc, ${getAreaColor(quest.area_slug, areas)}88)`,
                            borderLeft: `2px solid ${getAreaColor(quest.area_slug, areas)}`,
                            clipPath: seg.crossesIn || seg.crossesOut
                              ? undefined
                              : 'polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 4px 100%, 0 calc(100% - 4px))',
                            padding: '2px',
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            opacity: 0.95,
                            transition: 'opacity 0.15s, filter 0.15s, box-shadow 0.15s',
                            boxShadow: `inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 0 6px ${getAreaColor(quest.area_slug, areas)}55`,
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.opacity = '1'
                            e.currentTarget.style.filter = 'brightness(1.15)'
                            e.currentTarget.style.boxShadow = `inset 0 0 0 1px rgba(255, 255, 255, 0.30), 0 0 12px ${getAreaColor(quest.area_slug, areas)}aa`
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.opacity = '0.95'
                            e.currentTarget.style.filter = 'brightness(1)'
                            e.currentTarget.style.boxShadow = `inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 0 6px ${getAreaColor(quest.area_slug, areas)}55`
                          }}
                          title={displayTitle}
                        >
                          <div style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 8, fontWeight: 600,
                            color: '#fff',
                            letterSpacing: '0.02em',
                            textTransform: 'uppercase',
                            textAlign: 'center',
                            lineHeight: 1.1,
                            padding: '1px',
                            textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {displayTitle.substring(0, 20)}
                          </div>
                        </div>
                      )
                    })
                  })}

                  {dayRoutines.map((routine) => {
                    if (!routine.start_time || !routine.end_time) return null

                    const [startHours, startMinutes] = routine.start_time.split(':').map(Number)
                    const [endHours, endMinutes] = routine.end_time.split(':').map(Number)

                    const startTotal = startHours + startMinutes / 60
                    const endTotal = endHours + endMinutes / 60
                    const duration = endTotal - startTotal

                    const topPercent = startTotal * 40 * timelineZoom
                    const heightPercent = Math.max(10, duration * 40 * timelineZoom)

                    return (
                      <div
                        key={routine.id}
                        style={{
                          position: 'absolute',
                          left: '2px',
                          right: '2px',
                          top: `${40 + topPercent}px`,
                          height: `${heightPercent}px`,
                          background: routine.done
                            ? 'rgba(40, 50, 57, 0.45)'
                            : 'rgba(8, 12, 18, 0.55)',
                          border: `1px dashed ${routine.done ? 'var(--color-text-muted)' : 'var(--color-success)'}`,
                          borderLeft: `2px solid ${routine.done ? 'var(--color-text-muted)' : 'var(--color-success)'}`,
                          clipPath: 'polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 4px 100%, 0 calc(100% - 4px))',
                          padding: '2px',
                          overflow: 'hidden',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          opacity: routine.done ? 0.55 : 0.95,
                          transition: 'opacity 0.15s, background 0.15s, box-shadow 0.15s',
                          boxShadow: routine.done ? 'none' : '0 0 6px rgba(94, 122, 82, 0.30)',
                        }}
                        onMouseEnter={e => {
                          if (routine.done) {
                            e.currentTarget.style.opacity = '0.7'
                          } else {
                            e.currentTarget.style.background = 'rgba(94, 122, 82, 0.10)'
                            e.currentTarget.style.boxShadow = '0 0 12px rgba(94, 122, 82, 0.50)'
                          }
                        }}
                        onMouseLeave={e => {
                          if (routine.done) {
                            e.currentTarget.style.opacity = '0.55'
                          } else {
                            e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
                            e.currentTarget.style.boxShadow = '0 0 6px rgba(94, 122, 82, 0.30)'
                          }
                        }}
                        title={routine.title}
                      >
                        <div style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 8, fontWeight: 600,
                          color: routine.done ? 'var(--color-text-tertiary)' : 'var(--color-success-light)',
                          letterSpacing: '0.02em',
                          textTransform: 'uppercase',
                          textAlign: 'center',
                          textDecoration: routine.done ? 'line-through' : 'none',
                          lineHeight: 1.1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '100%',
                        }}>
                          <span style={{
                            color: routine.done ? 'var(--color-text-muted)' : 'var(--color-success)',
                            marginRight: 3, opacity: 0.85,
                          }}>RTN</span>
                          {routine.title.substring(0, 20)}
                        </div>
                        {heightPercent > 18 && (
                          <div style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 7, fontWeight: 700,
                            color: routine.done ? 'var(--color-text-muted)' : 'var(--color-text-tertiary)',
                            letterSpacing: '0.08em',
                            marginTop: 1,
                          }}>
                            {routine.start_time}–{routine.end_time}
                          </div>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm(`Excluir rotina "${routine.title}"?`)) {
                              deleteRoutine(routine.id)
                                .then(() => { appInv.routines(); tabSync.emit('routines') })
                                .catch(() => alertDialog({ title: 'Erro', message: 'Erro ao excluir rotina', variant: 'danger' }))
                            }
                          }}
                          style={{
                            position: 'absolute',
                            top: '1px',
                            right: '1px',
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-error)',
                            cursor: 'pointer',
                            fontSize: '7px',
                            padding: '1px 2px',
                            opacity: 0.6,
                            transition: 'opacity 0.15s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                          onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
                          title="Excluir rotina"
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
          </div>
        </div>
        )
      })()}

      {viewMode === 'mês' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <button
              type="button"
              className="hq-icon-btn"
              onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))}
              title="Mês anterior"
              aria-label="Mês anterior"
              style={{ minWidth: 32, minHeight: 32 }}
            >
              <ChevronLeft size={14} strokeWidth={1.8} />
            </button>
            <div style={{
              padding: '6px 16px',
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid var(--color-ice-deep)',
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-ice)',
                letterSpacing: '0.22em', textTransform: 'uppercase',
              }}>//</span>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                color: 'var(--color-ice-light)',
                fontWeight: 600,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
              }}>
                {MONTH_NAMES[currentDate.getMonth()]} {currentDate.getFullYear()}
              </div>
            </div>
            <button
              type="button"
              className="hq-icon-btn"
              onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))}
              title="Próximo mês"
              aria-label="Próximo mês"
              style={{ minWidth: 32, minHeight: 32 }}
            >
              <ChevronRight size={14} strokeWidth={1.8} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8 }}>
            {DAY_NAMES.map(d => (
              <div key={d} style={{
                textAlign: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-ice-light)',
                letterSpacing: '0.22em', textTransform: 'uppercase',
                padding: 8,
                background: 'rgba(8, 12, 18, 0.55)',
                border: '1px solid var(--color-ice-deep)',
              }}>
                {d}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {(() => {
              const year = currentDate.getFullYear()
              const month = currentDate.getMonth()
              // Semana começa na segunda: dom=6, seg=0, ter=1, ...
              const firstDay = (new Date(year, month, 1).getDay() + 6) % 7
              const daysInMonth = new Date(year, month + 1, 0).getDate()
              const cells = []

              for (let i = 0; i < firstDay; i++) {
                cells.push(
                  <div key={`empty-${i}`} style={{ background: 'rgba(8, 12, 18, 0.30)', minHeight: 80, border: '1px solid var(--color-divider)' }} />
                )
              }

              for (let day = 1; day <= daysInMonth; day++) {
                const dayIso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                const dayQuests = questsForDay(dayIso)
                const dayRoutines = routinesForDay(dayIso)
                const isToday = dayIso === todayIso
                const dayRituals = ritualsByDate.get(dayIso) ?? []

                cells.push(
                  <div key={day} style={{
                    padding: 8,
                    background: isToday ? 'rgba(143, 191, 211, 0.08)' : 'rgba(8, 12, 18, 0.55)',
                    border: isToday ? '1px solid var(--color-ice)' : '1px solid var(--color-border)',
                    boxShadow: isToday ? '0 0 12px rgba(143, 191, 211, 0.18)' : 'none',
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
                    minHeight: 80, display: 'flex', flexDirection: 'column',
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 6,
                    }}>
                      <div style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11, fontWeight: 700,
                        color: isToday ? 'var(--color-ice-light)' : 'var(--color-text-primary)',
                        letterSpacing: '0.04em',
                        textShadow: isToday ? '0 0 6px rgba(143, 191, 211, 0.45)' : 'none',
                      }}>
                        {day}
                      </div>
                      {/* Marcadores de ritual — bolinha vermelha por cadência
                          agendada nesse dia. Hover mostra quais (title nativo). */}
                      {dayRituals.length > 0 && (
                        <div
                          style={{ display: 'flex', gap: 2 }}
                          title={`Ritual${dayRituals.length === 1 ? '' : 'is'}: ${dayRituals.join(', ')}`}
                        >
                          {dayRituals.map((c) => (
                            <span
                              key={c}
                              style={{
                                width: 5,
                                height: 5,
                                borderRadius: '50%',
                                background: '#dc2531',
                                boxShadow: '0 0 4px rgba(220, 37, 49, 0.6)',
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{
                      flex: 1,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 8, fontWeight: 600,
                      color: 'var(--color-text-tertiary)',
                      letterSpacing: '0.05em',
                      overflow: 'hidden',
                    }}>
                      {dayQuests.length > 0 && (
                        <div style={{ marginBottom: 4 }}>
                          {dayQuests.slice(0, 2).map(q => (
                            <div key={q.id} style={{
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              marginBottom: 2,
                              color: 'var(--color-ice-light)',
                            }}>
                              <span style={{ color: 'var(--color-ice)', marginRight: 3 }}>QST</span>
                              {q.title}
                            </div>
                          ))}
                          {dayQuests.length > 2 && (
                            <div style={{ color: 'var(--color-text-muted)' }}>
                              +{dayQuests.length - 2}
                            </div>
                          )}
                        </div>
                      )}
                      {dayRoutines.length > 0 && (
                        <div>
                          {dayRoutines.slice(0, 2).map(r => (
                            <div key={r.id} style={{
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              marginBottom: 2,
                              color: 'var(--color-success-light)',
                            }}>
                              <span style={{ color: 'var(--color-success)', marginRight: 3 }}>RTN</span>
                              {r.title}
                            </div>
                          ))}
                          {dayRoutines.length > 2 && (
                            <div style={{ color: 'var(--color-text-muted)' }}>
                              +{dayRoutines.length - 2}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              }

              return cells
            })()}
          </div>
        </div>
      )}

      {viewMode === 'ano' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <button
              type="button"
              className="hq-icon-btn"
              onClick={() => setCurrentDate(new Date(currentDate.getFullYear() - 1, 0, 1))}
              title="Ano anterior"
              aria-label="Ano anterior"
              style={{ minWidth: 32, minHeight: 32 }}
            >
              <ChevronLeft size={14} strokeWidth={1.8} />
            </button>
            <div style={{
              padding: '6px 16px',
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid var(--color-ice-deep)',
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-ice)',
                letterSpacing: '0.22em', textTransform: 'uppercase',
              }}>//</span>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                color: 'var(--color-ice-light)',
                fontWeight: 600,
                letterSpacing: '0.03em',
              }}>
                {currentDate.getFullYear()}
              </div>
            </div>
            <button
              type="button"
              className="hq-icon-btn"
              onClick={() => setCurrentDate(new Date(currentDate.getFullYear() + 1, 0, 1))}
              title="Próximo ano"
              aria-label="Próximo ano"
              style={{ minWidth: 32, minHeight: 32 }}
            >
              <ChevronRight size={14} strokeWidth={1.8} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {MONTH_NAMES.map((monthName, monthIdx) => {
              const year = currentDate.getFullYear()
              // Semana começa na segunda: dom=6, seg=0, ter=1, ...
              const firstDay = (new Date(year, monthIdx, 1).getDay() + 6) % 7
              const daysInMonth = new Date(year, monthIdx + 1, 0).getDate()
              // Visão "ano": quest é do mês se sua deadline efetiva (entregável
              // ou projeto) cai dentro dele.
              const monthQuests = quests.filter(q => {
                const dl = effectiveQuestDeadline(q, delivsByProject, projects)
                if (!dl) return false
                const parts = dl.split('-')
                return parseInt(parts[0]) === year && parseInt(parts[1]) === monthIdx + 1
              })
              const totalDeadlines = monthQuests.length

              const isCurrentMonth = currentDate.getMonth() === monthIdx
              return (
                <div key={monthIdx} style={{
                  padding: 12,
                  background: isCurrentMonth ? 'rgba(143, 191, 211, 0.08)' : 'rgba(8, 12, 18, 0.55)',
                  border: isCurrentMonth ? '1px solid var(--color-ice)' : '1px solid var(--color-ice-deep)',
                  boxShadow: isCurrentMonth ? '0 0 12px rgba(143, 191, 211, 0.18)' : 'none',
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
                }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10, fontWeight: 700,
                    color: isCurrentMonth ? 'var(--color-ice-light)' : 'var(--color-text-secondary)',
                    letterSpacing: '0.22em', textTransform: 'uppercase',
                    marginBottom: 10,
                    paddingBottom: 6,
                    borderBottom: `1px solid ${isCurrentMonth ? 'var(--color-ice-deep)' : 'var(--color-divider)'}`,
                  }}>
                    <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                    {monthName}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 8 }}>
                    {DAY_NAMES.map(d => (
                      <div key={d} style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 8, fontWeight: 700,
                        color: 'var(--color-ice-deep)',
                        letterSpacing: '0.1em', textTransform: 'uppercase',
                        textAlign: 'center', lineHeight: 1,
                      }}>
                        {d[0]}
                      </div>
                    ))}

                    {Array.from({ length: firstDay }).map((_, i) => (
                      <div key={`empty-${i}`} style={{ fontSize: 8 }} />
                    ))}

                    {Array.from({ length: daysInMonth }).map((_, dayIdx) => {
                      const day = dayIdx + 1
                      const dayIso = `${year}-${String(monthIdx+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                      const hasDeadline = monthQuests.some(q =>
                        effectiveQuestDeadline(q, delivsByProject, projects) === dayIso
                      )

                      return (
                        <div
                          key={day}
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 9,
                            textAlign: 'center', lineHeight: 1,
                            color: hasDeadline ? 'var(--color-ice-light)' : 'var(--color-text-tertiary)',
                            fontWeight: hasDeadline ? 700 : 500,
                            textShadow: hasDeadline ? '0 0 6px rgba(143, 191, 211, 0.45)' : 'none',
                            padding: 2,
                          }}
                        >
                          {day}
                        </div>
                      )
                    })}
                  </div>

                  {totalDeadlines > 0 && (
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9, fontWeight: 700,
                      color: 'var(--color-ice-light)',
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                      borderTop: '1px solid var(--color-ice-deep)',
                      paddingTop: 6,
                    }}>
                      <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                      {totalDeadlines} DEADLINE{totalDeadlines !== 1 ? 'S' : ''}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {showBlockModal && editingBlock && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'var(--color-overlay)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'rgba(8, 12, 18, 0.92)',
            border: '1px solid var(--color-ice-deep)',
            borderRadius: 0,
            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)',
            padding: 0,
            width: '90%',
            maxWidth: 500,
            maxHeight: '90vh',
            overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.85), 0 0 32px rgba(143, 191, 211, 0.18)',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Hairline ice elétrica no topo */}
            <div className="hq-hairline-ice" />
            {/* Header com atmosphere */}
            <div style={{
              padding: '16px 22px',
              background: `
                radial-gradient(ellipse 100% 80% at 0% 0%, rgba(143, 191, 211, 0.06), transparent 60%),
                linear-gradient(180deg, rgba(40, 50, 57, 0.20), transparent)
              `,
              borderBottom: '1px solid var(--color-ice-deep)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: 8, height: 8,
                    background: 'var(--color-ice)',
                    boxShadow: '0 0 8px var(--color-ice-glow)',
                  }}
                />
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11, fontWeight: 700,
                  color: 'var(--color-ice-light)',
                  letterSpacing: '0.28em', textTransform: 'uppercase',
                }}>
                  <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                  {isCreatingBlock ? 'NEW.UNPRODUCTIVE.BLOCK' : 'EDIT.UNPRODUCTIVE.BLOCK'}
                </span>
              </div>
              <button
                onClick={() => {
                  setShowBlockModal(false)
                  setEditingBlock(null)
                  setEditingBlockDate(null)
                  setIsCreatingBlock(false)
                }}
                style={{
                  background: 'rgba(8, 12, 18, 0.55)',
                  border: '1px solid var(--color-border)',
                  cursor: 'pointer',
                  color: 'var(--color-text-tertiary)',
                  width: 28, height: 28, borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                  fontSize: 12,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
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
                ✕
              </button>
            </div>
            <div style={{
              padding: '20px 22px',
              overflow: 'auto',
            }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  display: 'block', marginBottom: 6,
                }}>
                  <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                  TÍTULO
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={editingBlock.title}
                  onChange={(e) => setEditingBlock({ ...editingBlock, title: e.target.value })}
                  style={{
                    width: '100%',
                    background: 'var(--color-bg-tertiary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    padding: '10px 12px',
                    color: 'var(--color-text-primary)',
                    fontSize: 14,
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  display: 'block', marginBottom: 6,
                }}>
                    Início
                  </label>
                  <input
                    type="time"
                    value={`${Math.floor(editingBlock.start).toString().padStart(2, '0')}:${Math.round((editingBlock.start % 1) * 60).toString().padStart(2, '0')}`}
                    onChange={(e) => {
                      const [hours, minutes] = e.target.value.split(':').map(Number)
                      setEditingBlock({ ...editingBlock, start: hours + minutes / 60 })
                    }}
                    style={{
                      width: '100%',
                      background: 'var(--color-bg-tertiary)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 4,
                      padding: '10px 12px',
                      color: 'var(--color-text-primary)',
                      fontSize: 14,
                      fontFamily: 'inherit',
                      boxSizing: 'border-box',
                      colorScheme: 'dark',
                    }}
                  />
                </div>
                <div>
                  <label style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  display: 'block', marginBottom: 6,
                }}>
                    Fim
                  </label>
                  <input
                    type="time"
                    value={`${Math.floor(editingBlock.end).toString().padStart(2, '0')}:${Math.round((editingBlock.end % 1) * 60).toString().padStart(2, '0')}`}
                    onChange={(e) => {
                      const [hours, minutes] = e.target.value.split(':').map(Number)
                      setEditingBlock({ ...editingBlock, end: hours + minutes / 60 })
                    }}
                    title={editingBlock.end <= editingBlock.start ? 'Atravessa a meia-noite — vai até o dia seguinte' : undefined}
                    style={{
                      width: '100%',
                      background: 'var(--color-bg-tertiary)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 4,
                      padding: '10px 12px',
                      color: 'var(--color-text-primary)',
                      fontSize: 14,
                      fontFamily: 'inherit',
                      boxSizing: 'border-box',
                      colorScheme: 'dark',
                    }}
                  />
                </div>
              </div>

              {editingBlock.end <= editingBlock.start && (
                <div style={{
                  fontSize: 10, color: 'var(--color-accent-light)', fontStyle: 'italic',
                  marginTop: -8,
                }}>
                  ↳ atravessa a meia-noite (segue até o dia seguinte)
                </div>
              )}

              <div>
                <label style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  display: 'block', marginBottom: 6,
                }}>
                  Recorrência
                </label>
                <select
                  value={editingBlock.recurrence}
                  onChange={(e) => {
                    const recurrence = e.target.value as any
                    const prev = editingBlock.recurrence
                    const updates: Partial<UnproductiveBlock> = { recurrence }

                    if (recurrence === 'none') {
                      // Evento único: janela = um dia só (âncora = data clicada
                      // ou hoje como fallback).
                      const now = new Date()
                      const anchor = editingBlockDate
                        ?? editingBlock.effectiveFrom
                        ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
                      updates.effectiveFrom = anchor
                      updates.effectiveUntil = anchor
                      updates.daysOfWeek = undefined
                      updates.endsOn = 'never'
                      updates.endDate = undefined
                      updates.endCount = undefined
                    } else if (prev === 'none') {
                      // Sai de evento único pra recorrente: limpa a janela.
                      updates.effectiveFrom = undefined
                      updates.effectiveUntil = undefined
                    }

                    if (recurrence === 'custom') {
                      updates.daysOfWeek = editingBlock.daysOfWeek || [1, 2, 3, 4, 5]
                    } else if (recurrence !== 'weekly' && recurrence !== 'custom') {
                      updates.daysOfWeek = undefined
                    }

                    setEditingBlock({ ...editingBlock, ...updates })
                  }}
                  style={{
                    width: '100%',
                    background: 'var(--color-bg-tertiary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 4,
                    padding: '10px 12px',
                    color: 'var(--color-text-primary)',
                    fontSize: 14,
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="none">Não se repete</option>
                  <option value="daily">Todo dia</option>
                  <option value="weekdays">Segunda-Sexta</option>
                  <option value="weekly">Semanal</option>
                  <option value="custom">Personalizado</option>
                </select>
              </div>

              {(editingBlock.recurrence === 'weekly' || editingBlock.recurrence === 'custom') && (
                <div>
                  <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-text-tertiary)', fontWeight: 600, display: 'block', marginBottom: 8 }}>
                    Dias da Semana
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                    {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'].map((day, idx) => (
                      <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={(editingBlock.daysOfWeek || []).includes(idx)}
                          onChange={(e) => {
                            const days = editingBlock.daysOfWeek || []
                            if (e.target.checked) {
                              setEditingBlock({ ...editingBlock, daysOfWeek: [...days, idx].sort((a, b) => a - b) })
                            } else {
                              setEditingBlock({ ...editingBlock, daysOfWeek: days.filter(d => d !== idx) })
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>{day}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {editingBlock.recurrence !== 'none' && (
              <div>
                <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-text-tertiary)', fontWeight: 600, display: 'block', marginBottom: 8 }}>
                  Termina em
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="endsOn"
                      value="never"
                      checked={editingBlock.endsOn === 'never'}
                      onChange={() => setEditingBlock({ ...editingBlock, endsOn: 'never' })}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>Nunca</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="endsOn"
                      value="date"
                      checked={editingBlock.endsOn === 'date'}
                      onChange={() => setEditingBlock({ ...editingBlock, endsOn: 'date' })}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>Em uma data</span>
                  </label>
                  {editingBlock.endsOn === 'date' && (
                    <input
                      type="date"
                      autoComplete="off"
                      value={editingBlock.endDate || ''}
                      onChange={(e) => setEditingBlock({ ...editingBlock, endDate: e.target.value })}
                      style={{
                        marginLeft: 24,
                        background: 'var(--color-bg-tertiary)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 4,
                        padding: '8px 12px',
                        color: 'var(--color-text-primary)',
                        fontSize: 12,
                        fontFamily: 'inherit',
                        boxSizing: 'border-box',
                      }}
                    />
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="endsOn"
                      value="count"
                      checked={editingBlock.endsOn === 'count'}
                      onChange={() => setEditingBlock({ ...editingBlock, endsOn: 'count' })}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>Após ocorrências</span>
                  </label>
                  {editingBlock.endsOn === 'count' && (
                    <input
                      type="number"
                      autoComplete="off"
                      min="1"
                      value={editingBlock.endCount || 1}
                      onChange={(e) => setEditingBlock({ ...editingBlock, endCount: parseInt(e.target.value) })}
                      style={{
                        marginLeft: 24,
                        width: 80,
                        background: 'var(--color-bg-tertiary)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 4,
                        padding: '8px 12px',
                        color: 'var(--color-text-primary)',
                        fontSize: 12,
                        fontFamily: 'inherit',
                        boxSizing: 'border-box',
                      }}
                    />
                  )}
                </div>
              </div>
              )}

              <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                {!isCreatingBlock && (
                  <button
                    onClick={() => {
                      // Bloco recorrente + temos data clicada: pergunta escopo
                      // (apenas este / este e os seguintes / todos).
                      if (editingBlock.recurrence !== 'none' && editingBlockDate) {
                        setBlockScope('this')
                        setScopeAction('delete')
                        setShowScopePopup(true)
                        return
                      }
                      // Evento único: confirma e apaga direto.
                      if (confirm(`Deletar "${editingBlock.title}"?`)) {
                        setUnproductiveBlocks(unproductiveBlocks.filter(b => b.id !== editingBlock.id))
                        setShowBlockModal(false)
                        setEditingBlock(null)
                        setEditingBlockDate(null)
                        setIsCreatingBlock(false)
                      }
                    }}
                    style={{
                      flex: 1,
                      background: 'rgba(159, 18, 57, 0.14)',
                      color: 'var(--color-accent-light)',
                      border: '1px solid var(--color-accent-primary)',
                      borderRadius: 0,
                      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
                      padding: '10px 16px',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.22em', textTransform: 'uppercase',
                      boxShadow: '0 0 12px rgba(159, 18, 57, 0.22)',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(159, 18, 57, 0.22)'
                      e.currentTarget.style.boxShadow = '0 0 18px rgba(159, 18, 57, 0.45)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(159, 18, 57, 0.14)'
                      e.currentTarget.style.boxShadow = '0 0 12px rgba(159, 18, 57, 0.22)'
                    }}
                  >
                    ✕ DELETAR
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowBlockModal(false)
                    setEditingBlock(null)
                    setEditingBlockDate(null)
                    setIsCreatingBlock(false)
                  }}
                  style={{
                    flex: 1,
                    background: 'rgba(8, 12, 18, 0.55)',
                    color: 'var(--color-text-tertiary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 0,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
                    padding: '10px 16px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.22em', textTransform: 'uppercase',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                    e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
                    e.currentTarget.style.color = 'var(--color-ice-light)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-border)'
                    e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
                    e.currentTarget.style.color = 'var(--color-text-tertiary)'
                  }}
                >
                  CANCELAR
                </button>
                <button
                  onClick={() => {
                    if (isCreatingBlock || editingBlock.recurrence === 'none') {
                      // Bloco novo OU evento único — salva direto, sem escopo.
                      if (isCreatingBlock) {
                        setUnproductiveBlocks([...unproductiveBlocks, editingBlock!])
                      } else {
                        setUnproductiveBlocks(unproductiveBlocks.map(b => b.id === editingBlock.id ? editingBlock : b))
                      }
                      setShowBlockModal(false)
                      setEditingBlock(null)
                      setEditingBlockDate(null)
                      setIsCreatingBlock(false)
                    } else {
                      // Bloco recorrente existente — pergunta escopo via popup.
                      setBlockScope('this')
                      setScopeAction('save')
                      setShowScopePopup(true)
                    }
                  }}
                  style={{
                    flex: 1,
                    background: 'rgba(143, 191, 211, 0.14)',
                    color: 'var(--color-ice-light)',
                    border: '1px solid var(--color-ice)',
                    borderRadius: 0,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
                    padding: '10px 16px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.22em', textTransform: 'uppercase',
                    boxShadow: '0 0 14px rgba(143, 191, 211, 0.30)',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(143, 191, 211, 0.22)'
                    e.currentTarget.style.boxShadow = '0 0 20px rgba(143, 191, 211, 0.50)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(143, 191, 211, 0.14)'
                    e.currentTarget.style.boxShadow = '0 0 14px rgba(143, 191, 211, 0.30)'
                  }}
                >
                  ✓ {isCreatingBlock ? 'CRIAR' : 'CONCLUIR'}
                </button>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}

      {showScopePopup && editingBlock && editingBlockDate && (
        <div
          onClick={() => setShowScopePopup(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'scope-fade-in 0.15s ease-out',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            role="dialog"
            style={{
              width: 'min(420px, 92vw)',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6)',
              padding: '20px 24px',
              display: 'flex', flexDirection: 'column', gap: 14,
              color: 'var(--color-text-primary)',
              animation: 'scope-pop-in 0.15s ease-out',
            }}
          >
            <div>
              <div style={{
                fontSize: 10, color: 'var(--color-text-tertiary)',
                letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600,
                marginBottom: 4,
              }}>
                {scopeAction === 'delete' ? 'Excluir' : 'Aplicar a'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                Este bloco se repete. Escolha o escopo {scopeAction === 'delete' ? 'da exclusão' : 'da alteração'}.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(scopeAction === 'delete'
                ? [
                    { value: 'this' as const,      label: 'Apenas este evento',  desc: `só remove ${editingBlockDate.split('-').reverse().join('/')}` },
                    { value: 'following' as const, label: 'Este e os seguintes', desc: `remove a partir de ${editingBlockDate.split('-').reverse().join('/')}` },
                    { value: 'all' as const,       label: 'Todos os eventos',    desc: 'exclui a série inteira' },
                  ]
                : [
                    { value: 'this' as const,      label: 'Apenas este evento',  desc: `só altera ${editingBlockDate.split('-').reverse().join('/')}` },
                    { value: 'following' as const, label: 'Este e os seguintes', desc: `a partir de ${editingBlockDate.split('-').reverse().join('/')}` },
                    { value: 'all' as const,       label: 'Todos os eventos',    desc: 'a série inteira' },
                  ]
              ).map(opt => {
                const active = blockScope === opt.value
                return (
                  <label
                    key={opt.value}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px',
                      border: `1px solid ${active ? 'var(--color-accent-primary)' : 'var(--color-border)'}`,
                      borderRadius: 3, cursor: 'pointer',
                      background: active ? 'rgba(139, 46, 46, 0.08)' : 'transparent',
                      transition: 'all 0.15s',
                    }}
                  >
                    <input
                      type="radio"
                      name="block-scope-popup"
                      checked={active}
                      onChange={() => setBlockScope(opt.value)}
                      style={{ cursor: 'pointer', accentColor: 'var(--color-accent-primary)' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600,
                        color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                      }}>
                        {opt.label}
                      </div>
                      <div style={{
                        fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 2,
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {opt.desc}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>

            <div style={{
              display: 'flex', gap: 10, justifyContent: 'flex-end',
              marginTop: 4, paddingTop: 10, borderTop: '1px solid var(--color-divider)',
            }}>
              <button
                onClick={() => setShowScopePopup(false)}
                style={{
                  background: 'none', border: '1px solid var(--color-border)',
                  color: 'var(--color-text-tertiary)', cursor: 'pointer',
                  padding: '8px 16px', fontSize: 10, fontWeight: 600,
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  borderRadius: 3, transition: 'all 0.15s',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const scope = blockScope
                  const dateIso = editingBlockDate
                  const eb = editingBlock

                  if (scopeAction === 'delete') {
                    // Excluir conforme o escopo escolhido.
                    if (scope === 'this') {
                      // Marca esse dia como skipped no overrides do bloco.
                      const original = unproductiveBlocks.find(b => b.id === eb.id)
                      if (original) {
                        const overrides = (original.overrides || []).filter(o => o.date !== dateIso)
                        overrides.push({ date: dateIso, skipped: true })
                        setUnproductiveBlocks(unproductiveBlocks.map(b =>
                          b.id === eb.id ? { ...original, overrides } : b
                        ))
                      }
                    } else if (scope === 'following') {
                      // Encerra a série no dia anterior.
                      const d = new Date(dateIso + 'T00:00:00')
                      d.setDate(d.getDate() - 1)
                      const prevDayIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                      setUnproductiveBlocks(unproductiveBlocks.map(b =>
                        b.id === eb.id
                          ? {
                              ...b,
                              effectiveUntil: prevDayIso,
                              overrides: (b.overrides || []).filter(o => o.date < dateIso),
                            }
                          : b
                      ))
                    } else {
                      // Deleta a série inteira.
                      setUnproductiveBlocks(unproductiveBlocks.filter(b => b.id !== eb.id))
                    }
                  } else {
                    // Salvar (commit do edit).
                    if (scope === 'this') {
                      const original = unproductiveBlocks.find(b => b.id === eb.id)
                      if (original) {
                        const overrides = (original.overrides || []).filter(o => o.date !== dateIso)
                        overrides.push({ date: dateIso, start: eb.start, end: eb.end })
                        setUnproductiveBlocks(unproductiveBlocks.map(b =>
                          b.id === eb.id ? { ...original, overrides } : b
                        ))
                      }
                    } else if (scope === 'following') {
                      const d = new Date(dateIso + 'T00:00:00')
                      d.setDate(d.getDate() - 1)
                      const prevDayIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                      const newBlock: UnproductiveBlock = {
                        ...eb,
                        id: Date.now().toString(),
                        effectiveFrom: dateIso,
                        effectiveUntil: undefined,
                        overrides: (eb.overrides || []).filter(o => o.date >= dateIso),
                      }
                      setUnproductiveBlocks([
                        ...unproductiveBlocks.map(b =>
                          b.id === eb.id
                            ? {
                                ...b,
                                effectiveUntil: prevDayIso,
                                overrides: (b.overrides || []).filter(o => o.date < dateIso),
                              }
                            : b
                        ),
                        newBlock,
                      ])
                    } else {
                      setUnproductiveBlocks(unproductiveBlocks.map(b => b.id === eb.id ? eb : b))
                    }
                  }

                  setShowScopePopup(false)
                  setShowBlockModal(false)
                  setEditingBlock(null)
                  setEditingBlockDate(null)
                  setIsCreatingBlock(false)
                  setScopeAction('save')
                }}
                style={{
                  background: scopeAction === 'delete' ? 'var(--color-error)' : 'var(--color-accent-primary)',
                  border: 'none',
                  color: '#fff', cursor: 'pointer',
                  padding: '8px 16px', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  borderRadius: 3, transition: 'background 0.15s',
                }}
              >
                {scopeAction === 'delete' ? 'Excluir' : 'Aplicar'}
              </button>
            </div>
          </div>

          <style>{`
            @keyframes scope-fade-in {
              from { opacity: 0; } to { opacity: 1; }
            }
            @keyframes scope-pop-in {
              from { opacity: 0; transform: scale(0.96); }
              to { opacity: 1; transform: scale(1); }
            }
          `}</style>
        </div>
      )}

      {sessionModal && (() => {
        const sessMap = sessionModal.kind === 'quest'
          ? allSessions
          : sessionModal.kind === 'task'
            ? allTaskSessions
            : allRoutineSessions
        const raw = sessMap.get(sessionModal.entityId) ?? []
        const sess = raw.map((s: any) => ({
          id: s?.id,
          started_at: s?.started_at ?? '',
          ended_at: s?.ended_at ?? null,
        }))
        return (
          <SessionHistoryModal
            sessions={sess}
            kind={sessionModal.kind}
            onChanged={() => onSessionUpdate?.()}
            onClose={() => setSessionModal(null)}
          />
        )
      })()}
      </div>
    </Card>
    </div>
  )
}
