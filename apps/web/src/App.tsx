import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import {
  ChevronsLeft, ChevronsRight, Pause, Play, CheckCircle2, Menu,
} from 'lucide-react'
import { version as APP_VERSION } from '../package.json'
/* Phosphor duotone — substitui os Lucide simples do sidebar pra dar
   peso visual + suporte a duotone (corpo cinza + accent ice quando
   ativo). Vibe Hell Is Us / Cron Calendar / Things 3. */
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom'
import {
  fetchActiveSession,
  patchQuest, patchProject,
  fetchSessions, pauseSession, resumeSession,
  fetchTaskSessions, pauseTaskSession, resumeTaskSession, stopTaskSession,
  fetchRoutineSessions, pauseRoutineSession, resumeRoutineSession, stopRoutineSession,
  pauseMindSession, resumeMindSession, fetchMindSession,
  pauseHealthItemSession, resumeHealthItemSession, fetchHealthItemSession,
  pauseRitualCluster, resumeRitualCluster, fetchRitualCluster,
  reportApiError,
} from './api'
import {
  useProjects, useQuests, useTasks, useAreas, useProfile, useRoutines, useDebts, useAppInvalidator,
} from './lib/app-queries'
import { tabSync } from './lib/tabsync'
import { useBreakpoint } from './lib/useBreakpoint'
import { CommandPalette } from './components/CommandPalette'
import type { Project, Quest, Area, ActiveSession, Profile, Task } from './types'
import { parseIsoAsUtc, sumClosedSessionsSeconds, formatHMS } from './utils/datetime'
import { SessionHistoryModal } from './components/SessionHistoryModal'
// Rotas-padrão (Dia/Dashboard/Áreas) ficam eager — landing + maior tráfego.
// Resto vai lazy pra reduzir bundle inicial: cada rota baixa só quando
// usuário navega pra ela. Reduziu ~50% no chunk principal.
import { DashboardView } from './pages/DashboardPage'
import { ExecView } from './pages/ExecPage'
import { AreasView, AreaDetailRoute } from './pages/AreasPage'
import { DialogPortal } from './components/ui/CyberDialog'
import { BannerGridOverlay } from './components/BannerGridOverlay'
// Lazy routes — named exports precisam do shim `.then(m => ({ default: m.X }))`
// porque React.lazy() só aceita default export.
const CalendarView    = lazy(() => import('./pages/CalendarPage').then(m => ({ default: m.CalendarView })))
const RoutinesView    = lazy(() => import('./pages/RoutinesPage').then(m => ({ default: m.RoutinesView })))
const TasksView       = lazy(() => import('./pages/TasksPage').then(m => ({ default: m.TasksView })))
const MicroDumpView   = lazy(() => import('./pages/MicroDumpPage').then(m => ({ default: m.MicroDumpView })))
const ArquivadosView  = lazy(() => import('./pages/ArquivadosPage').then(m => ({ default: m.ArquivadosView })))
const HubFinanceLayout = lazy(() => import('./pages/finance/HubFinanceLayout').then(m => ({ default: m.HubFinanceLayout })))
const VisaoGeralPage  = lazy(() => import('./pages/finance/VisaoGeralPage').then(m => ({ default: m.VisaoGeralPage })))
const CarteiraPage    = lazy(() => import('./pages/finance/CarteiraPage').then(m => ({ default: m.CarteiraPage })))
const LancamentosPage = lazy(() => import('./pages/finance/LancamentosPage').then(m => ({ default: m.LancamentosPage })))
const FixasPage       = lazy(() => import('./pages/finance/FixasPage').then(m => ({ default: m.FixasPage })))
const DividasPage     = lazy(() => import('./pages/finance/DividasPage').then(m => ({ default: m.DividasPage })))
const WishlistPage    = lazy(() => import('./pages/finance/WishlistPage').then(m => ({ default: m.WishlistPage })))
const FreelasPage     = lazy(() => import('./pages/finance/FreelasPage').then(m => ({ default: m.FreelasPage })))
const CategoriasPage  = lazy(() => import('./pages/finance/CategoriasPage').then(m => ({ default: m.CategoriasPage })))
// Build/Health usam default exports → import sem `.then`.
const BuildLayout     = lazy(() => import('./pages/BuildLayout'))
const BuildPage       = lazy(() => import('./pages/BuildPage'))
const BuildHistoriaPage = lazy(() => import('./pages/BuildHistoriaPage'))
const HealthLayout    = lazy(() => import('./pages/health/HealthLayout'))
const BiomonitorPage  = lazy(() => import('./pages/health/BiomonitorPage'))
const DomainPage      = lazy(() => import('./pages/health/DomainPage'))
const MindPage           = lazy(() => import('./pages/mind/MindPage'))
const MindTagPage        = lazy(() => import('./pages/mind/MindTagPage'))
const MindHipotesesPage  = lazy(() => import('./pages/mind/MindHipotesesPage'))
const LibraryPage        = lazy(() => import('./pages/library/LibraryPage'))
const LibraryItemPage    = lazy(() => import('./pages/library/LibraryItemPage'))
const LibraryTemasPage   = lazy(() => import('./pages/library/LibraryTemasPage'))
import { useRituals } from './lib/build-queries'
import { useHealthPending } from './lib/health-queries'

/** Item de navegação cyber HUD. `label` aparece quando expandido; `abbr`
 *  (3 letras mono uppercase) aparece quando colapsado — vibe CP2077. */
type NavItem = { path: string; label: string; abbr: string }
type NavSection = { label: string; items: NavItem[] }

/**
 * Sidebar agrupado em 4 seções pra dar respiro visual + organizar
 * navegação por intenção. MAIN = orientação/visão; WORK = produção;
 * FINANCE = módulo dedicado; ARCHIVE = histórico.
 *
 * Eyebrow label só aparece quando sidebar está expandido — colapsado
 * mostra os ícones com pequeno gap entre seções.
 *
 * Ícones via @phosphor-icons/react no peso "duotone" — corpo translúcido
 * + traço sólido cria 2-tone. Quando ativo, o "duotone" interior fica em
 * ice glow → efeito alien-tech (vibe Hell Is Us).
 */
const NAV_SECTIONS: NavSection[] = [
  {
    label: 'MAIN',
    items: [
      { path: '/dashboard',   label: 'Dashboard',   abbr: 'DSH' },
      { path: '/exec',        label: 'EXEC',        abbr: 'EXE' },
      { path: '/calendario',  label: 'Calendário',  abbr: 'CAL' },
      { path: '/areas',       label: 'Áreas',       abbr: 'ARE' },
    ],
  },
  {
    label: 'STRATEGY',
    items: [
      { path: '/build',       label: '/Build',      abbr: 'BLD' },
      { path: '/mind',        label: 'Mind',        abbr: 'MND' },
      { path: '/library',     label: 'Library',     abbr: 'LIB' },
    ],
  },
  {
    label: 'WORK',
    items: [
      { path: '/tarefas',     label: 'Tarefas',     abbr: 'TSK' },
      { path: '/rotinas',     label: 'Rotinas',     abbr: 'ROT' },
      { path: '/micro-dump',  label: 'Dump',        abbr: 'DMP' },
      { path: '/arquivados',  label: 'Arquivados',  abbr: 'ARQ' },
    ],
  },
  {
    label: 'FINANCE',
    items: [
      { path: '/hub-finance', label: 'Finance', abbr: 'FIN' },
    ],
  },
  {
    label: 'HEALTH',
    items: [
      { path: '/health',      label: 'Health',  abbr: 'HLT' },
    ],
  },
]

/** Redirect de `/health/mind/tag/:slug` legado pra `/mind/tag/:slug` —
 *  preserva bookmarks de tags antigas após Mind virar peer top-level. */
function MindTagLegacyRedirect() {
  const { slug } = useParams<{ slug: string }>()
  return <Navigate to={`/mind/tag/${slug ?? ''}`} replace />
}

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  // Entidades globais via React Query — substituiu o pool de useState
  // que precisava de `sessionUpdateTrigger` pra forçar refetch. Cada hook
  // tem cache + invalidação granular via `appInv.X()`.
  const projectsQ = useProjects()
  const projects: Project[] = projectsQ.data ?? []
  const questsQ = useQuests()
  const quests: Quest[] = questsQ.data ?? []
  const tasksQ = useTasks()
  const tasks: Task[] = tasksQ.data ?? []
  const areasQ = useAreas()
  const areas: Area[] = areasQ.data ?? []
  const profileQ = useProfile()
  const profile: Profile = profileQ.data ?? { name: '', role: '', avatar_url: '' }
  // Routines + debts pro Command Palette (Ctrl+K). Não há cost dedicated:
  // os hooks compartilham cache com /rotinas e /finance/dividas.
  const routinesQ = useRoutines()
  const routines = routinesQ.data ?? []
  const debtsQ = useDebts()
  const debts = debtsQ.data ?? []
  const appInv = useAppInvalidator()
  // Command Palette state — abre via Ctrl/Cmd+K (listener global abaixo).
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Shim setters: child components passam `set*` como callback (onCreate,
  // onDelete, etc) e fazem `setX(prev => prev.map(...))` pra updates locais.
  // Aqui o argumento é descartado e disparamos invalidação + tabSync —
  // React Query refetch retorna a verdade do servidor, e outras abas vêem
  // o update via BroadcastChannel. Trade-off: perde optimistic UI
  // momentâneo, ganha consistência sem código de cache manual.
  type Updater<T> = T | ((prev: T) => T)
  const setProjects = (_v: Updater<Project[]>) => { void _v; appInv.projects(); tabSync.emit('quests') }
  const setQuests = (_v: Updater<Quest[]>) => { void _v; appInv.quests(); tabSync.emit('quests') }
  const setAreas = (_v: Updater<Area[]>) => { void _v; appInv.areas(); tabSync.emit('quests') }
  const setProfile = (_v: Updater<Profile>) => { void _v; appInv.profile(); tabSync.emit('profile') }
  const [archivedIdeas, setArchivedIdeas] = useState<Array<{ id: string; title: string; created_at: string }>>(() => {
    try {
      const saved = localStorage.getItem('hq-archived-ideas')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [selectedQuestId, setSelectedQuestId] = useState<string | null>(() => {
    try {
      const nav = JSON.parse(localStorage.getItem('hq-navigation') || '{}')
      return nav.questId || null
    } catch {
      return localStorage.getItem('hq-selectedQuestId')
    }
  })
  // Qual projeto está com o painel de detalhe aberto. Substitui o uso antigo
  // de selectedQuestId pra "selecionar um projeto" (quando projeto era quest).
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    try {
      const nav = JSON.parse(localStorage.getItem('hq-navigation') || '{}')
      return nav.projectId || null
    } catch {
      return null
    }
  })

  // Listener pra eventos de seleção de projeto vindos de fora (ex: clique
  // em "ABRIR" num projeto na FreelasPage navega pra /areas/X e dispara
  // este evento pra abrir o painel de detalhe direto). Sem isso, navegar
  // pra /areas/X só atualiza a URL mas selectedProjectId permanece stale.
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent).detail as { projectId?: string } | undefined
      if (detail?.projectId) setSelectedProjectId(detail.projectId)
    }
    window.addEventListener('hq-select-project', handler)
    return () => window.removeEventListener('hq-select-project', handler)
  }, [])
  const [sessionUpdateTrigger, setSessionUpdateTrigger] = useState(0)
  const [sidebarCollapsedRaw, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('hq-sidebar-collapsed')
    return saved ? JSON.parse(saved) : false
  })
  // Mobile/desktop branching. Em mobile o sidebar vira drawer (escondido por
  // padrão, abre via hambúrguer). `sidebarOpen` é só pra mobile — desktop
  // sempre mostra (pinned), só alterna `sidebarCollapsed` pra largura.
  const { isCompact } = useBreakpoint()
  // Em mobile o drawer SEMPRE mostra a versão expandida (com labels);
  // o estado `collapsed` só existe pra desktop. Override centralizado pra
  // evitar polluir toda condicional `sidebarCollapsed ? ... : ...`.
  const sidebarCollapsed = isCompact ? false : sidebarCollapsedRaw
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Fecha o drawer ao navegar pra outra rota (UX padrão de mobile).
  useEffect(() => { if (isCompact) setSidebarOpen(false) }, [location.pathname, isCompact])
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null)
  // Lifecycle do banner — controla a cutscene de materialize/dematerialize.
  // - `session`: sessão renderizada (lag em relação a activeSession durante exit)
  // - `stage`: 'entering' (cutscene de aparecer ~1.1s), 'idle' (estado normal),
  //   'exiting' (cutscene de desmonte ~1.1s antes de unmount).
  const [bannerLifecycle, setBannerLifecycle] = useState<{
    session: ActiveSession | null
    stage: 'idle' | 'entering' | 'exiting'
  }>({ session: null, stage: 'idle' })
  const [bannerTimer, setBannerTimer] = useState(0)
  const [bannerClosedSec, setBannerClosedSec] = useState(0)
  const [isHydrated, setIsHydrated] = useState(false)
  const [bannerHistoryOpen, setBannerHistoryOpen] = useState(false)
  const [bannerHistorySessions, setBannerHistorySessions] = useState<{ id?: number; started_at: string; ended_at: string | null }[]>([])

  // Which entity the user has "in focus" right now. Persisted so a reload
  // keeps the banner showing a paused session until the user finalizes it.
  const focusedEntityRef = useRef<{ type: string; id: string } | null>((() => {
    try {
      const saved = localStorage.getItem('hq-focused-entity')
      return saved ? JSON.parse(saved) : null
    } catch { return null }
  })())

  function saveFocusedEntity(f: { type: string; id: string } | null) {
    focusedEntityRef.current = f
    try {
      if (f) localStorage.setItem('hq-focused-entity', JSON.stringify(f))
      else localStorage.removeItem('hq-focused-entity')
    } catch {}
  }

  // Sequence number contra race condition. Múltiplos refreshes em paralelo
  // (mount + onSessionUpdate + polling 15s + visibility + route change) podiam
  // chegar fora de ordem — uma response stale sobrescrevia o estado correto.
  // Cada chamada incrementa o seq; só aplica a response se ainda for a mais
  // recente.
  const refreshSeqRef = useRef(0)
  function refreshActiveSession() {
    const seq = ++refreshSeqRef.current
    fetchActiveSession(focusedEntityRef.current).then(resp => {
      if (seq !== refreshSeqRef.current) return // response obsoleta
      setActiveSession(resp)
      if (resp) saveFocusedEntity({ type: resp.type, id: resp.id })
      else saveFocusedEntity(null)
    }).catch(err => reportApiError('App', err))
  }
  const bannerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bannerSyncRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const onSessionUpdate = () => {
    setSessionUpdateTrigger(prev => prev + 1)
  }

  // Refaz o fetch de sessões pra histórico do banner. Usado pelo click no
  // timer (abre modal) e pelo onChanged do modal (após edit/delete) pra
  // refletir mudanças sem fechar e reabrir.
  async function reloadBannerHistory() {
    const cur = activeSession
    if (!cur) {
      setBannerHistorySessions([])
      return
    }
    let list: any[] = []
    if (cur.type === 'quest') {
      list = await fetchSessions(cur.id)
    } else if (cur.type === 'task') {
      list = await fetchTaskSessions(cur.id)
    } else if (cur.type === 'routine') {
      list = await fetchRoutineSessions(cur.id)
    } else if (cur.type === 'mind') {
      const cluster = await fetchMindSession()
      list = cluster.rows ?? []
    } else if (cur.type === 'health_item') {
      const itemId = parseInt(cur.id, 10)
      const cluster = await fetchHealthItemSession(itemId)
      list = cluster.rows ?? []
    } else if (cur.type === 'ritual') {
      const cluster = await fetchRitualCluster(cur.id)
      list = cluster.rows ?? []
    }
    setBannerHistorySessions(
      list.map((s: any) => ({
        id: typeof s?.id === 'number' ? s.id : undefined,
        started_at: s?.started_at ?? '',
        ended_at: s?.ended_at ?? null,
      })),
    )
  }

  // Mark as hydrated and fetch active session on mount
  useEffect(() => {
    setIsHydrated(true)
    refreshActiveSession()
  }, [])

  // Command Palette — atalho global Ctrl+K (Windows/Linux) / Cmd+K (Mac).
  // Toggle (não só abrir) pra mesmo atalho fechar quando já está aberto.
  // preventDefault em qualquer caso pra não acionar atalho nativo do browser
  // (alguns navegadores usam Ctrl+K pra focar a barra de busca).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isPaletteKey = (e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')
      if (!isPaletteKey) return
      e.preventDefault()
      setPaletteOpen(o => !o)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Cross-tab sync: quando outra aba muta dados do app, invalida cache local.
  // Cobre o caso "criei tarefa numa aba, a outra mostra stale até F5".
  // 'session' também dispara refreshActiveSession pro banner sincronizar.
  useEffect(() => {
    const offQuests = tabSync.on('quests', () => {
      appInv.quests(); appInv.projects(); appInv.areas()
    })
    const offTasks = tabSync.on('tasks', () => { appInv.tasks() })
    const offRoutines = tabSync.on('routines', () => { appInv.routines() })
    const offProfile = tabSync.on('profile', () => { appInv.profile() })
    const offSession = tabSync.on('session', () => { refreshActiveSession() })
    const offAll = tabSync.on('all', () => { appInv.all() })
    return () => { offQuests(); offTasks(); offRoutines(); offProfile(); offSession(); offAll() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sincroniza bannerLifecycle com activeSession — triggers cutscene de
  // entering quando aparece, exiting quando some. Updates de mesma sessão
  // (pause/resume → is_active flip) só atualizam os campos sem re-animar.
  useEffect(() => {
    setBannerLifecycle(prev => {
      if (activeSession && !prev.session) {
        return { session: activeSession, stage: 'entering' }
      }
      if (!activeSession && prev.session && prev.stage !== 'exiting') {
        return { session: prev.session, stage: 'exiting' }
      }
      if (activeSession && prev.session) {
        return { session: activeSession, stage: prev.stage }
      }
      return prev
    })
  }, [activeSession])

  // Timers para fechar as cutscenes — quando entra em 'entering' ou
  // 'exiting', dispara timer de 1100ms que avança pro próximo estado.
  useEffect(() => {
    if (bannerLifecycle.stage === 'entering') {
      const t = setTimeout(() => {
        setBannerLifecycle(prev => prev.stage === 'entering' ? { ...prev, stage: 'idle' } : prev)
      }, 1300)
      return () => clearTimeout(t)
    }
    if (bannerLifecycle.stage === 'exiting') {
      const t = setTimeout(() => {
        setBannerLifecycle({ session: null, stage: 'idle' })
      }, 1300)
      return () => clearTimeout(t)
    }
  }, [bannerLifecycle.stage])

  // Fetch active session + refresh quests/projects/tasks/routines when an
  // update is triggered. Mudança de sessão (start/pause/stop) afeta `done`,
  // contadores e duração agregada — invalidamos tudo pra os hooks refetcharem.
  // Inclui routines: REABRIR uma rotina FEITO no /dia chama toggle que muta
  // routine_logs; sem invalidar useRoutinesForDate, o `doneRoutineIds` Set
  // continua mostrando a rotina como done e o botão play não aparece.
  useEffect(() => {
    refreshActiveSession()
    if (sessionUpdateTrigger > 0) {
      appInv.quests()
      appInv.projects()
      appInv.tasks()
      appInv.routines()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUpdateTrigger])

  // Mantém o banner sincronizado com a sessão ativa do backend.
  //
  // Polling custa ~1 request a cada 15s, mas a gente pausa totalmente quando
  // a aba está em segundo plano (visibilityState === 'hidden') — zero carga
  // enquanto o usuário não está olhando. Quando volta, faz um refresh imediato
  // e reinicia o intervalo, pra o banner refletir o estado real caso tenha
  // mudado fora (ex: outra aba clicou Play/Pause).
  useEffect(() => {
    const POLL_MS = 15_000
    const start = () => {
      if (bannerSyncRef.current) return
      bannerSyncRef.current = setInterval(refreshActiveSession, POLL_MS)
    }
    const stop = () => {
      if (bannerSyncRef.current) {
        clearInterval(bannerSyncRef.current)
        bannerSyncRef.current = null
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshActiveSession()
        start()
      } else {
        stop()
      }
    }
    // Arranca no estado atual da aba.
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // Defesa em profundidade: se o state global de quests indica que a entity
  // do banner está done, limpa o banner imediatamente (sem esperar o polling
  // de 15s). Cobre o caso onde algum lugar marca a quest done sem chamar
  // onSessionUpdate (ex: edit inline em outra tela).
  useEffect(() => {
    if (!activeSession || activeSession.type !== 'quest') return
    const q = quests.find(x => x.id === activeSession.id)
    if (q && q.status === 'done') {
      setActiveSession(null)
      saveFocusedEntity(null)
    }
  }, [quests, activeSession?.type, activeSession?.id])

  // Refresh defensivo da sessão ativa ao trocar de rota. Como tasks/routines
  // não estão no state global do App (cada page busca por conta), não dá pra
  // validar via state como nas quests acima — esse refresh garante que ao
  // navegar pra outra tela o banner reflita o estado atual do backend.
  useEffect(() => {
    if (document.visibilityState === 'visible') refreshActiveSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // Tracks which (type, id) pair the current bannerClosedSec value corresponds
  // to. Used to avoid mixing stale session data from a previous entity into
  // the banner during async refetches (was causing the timer to jump
  // backwards when switching tasks).
  const bannerClosedSecForRef = useRef<string | null>(null)

  // Accumulated closed-session time for the active entity — shown as the big
  // total in the banner alongside the current session timer. Refetches on
  // entity change and whenever a session update is triggered (pause/resume
  // closes/opens sessions, so this needs to re-sum).
  useEffect(() => {
    if (!activeSession) {
      bannerClosedSecForRef.current = null
      setBannerClosedSec(0)
      return
    }
    const { type, id } = activeSession
    const key = `${type}:${id}`
    // Reset imediato quando o entity muda — evita "tempo pulando pra trás"
    // ao trocar de task, enquanto a fetch ainda não voltou.
    if (bannerClosedSecForRef.current !== key) {
      bannerClosedSecForRef.current = key
      setBannerClosedSec(0)
    }
    // Pra rotinas, escopa a soma à DATA da sessão ativa — sem isso,
    // fetchRoutineSessions traz histórico inteiro e "+45m" no banner vira
    // o total da rotina ao longo do tempo, não do dia.
    const loader = type === 'quest'
      ? fetchSessions(id)
      : type === 'task'
        ? fetchTaskSessions(id)
        : type === 'routine'
          ? fetchRoutineSessions(id, activeSession.routine_date ?? undefined)
          : Promise.resolve([])  // mind/health_item/library: cluster próprio
    let cancelled = false
    loader
      .then(list => {
        if (cancelled) return
        const safe = (Array.isArray(list) ? list : []).map((s: any) => ({
          started_at: s?.started_at ?? '',
          ended_at: s?.ended_at ?? null,
        }))
        setBannerClosedSec(sumClosedSessionsSeconds(safe))
      })
      .catch(() => { if (!cancelled) setBannerClosedSec(0) })
    return () => { cancelled = true }
  }, [activeSession?.type, activeSession?.id, activeSession?.routine_date, sessionUpdateTrigger])

  // Timer for banner elapsed time. Deps específicas (NÃO o objeto inteiro)
  // pra evitar recriar setInterval em todo poll de 15s — fetchActiveSession
  // sempre retorna nova referência e o objeto inteiro como dep faria o
  // timer "saltar" 1 frame em cada refresh.
  useEffect(() => {
    if (!activeSession) return
    const startedAt = activeSession.started_at
    const endedAt = activeSession.ended_at
    const isActive = activeSession.is_active

    const updateTimer = () => {
      const start = parseIsoAsUtc(startedAt).getTime()
      let elapsed = 0

      if (isNaN(start)) {
        setBannerTimer(0)
        return
      }

      if (isActive) {
        elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000))
      } else if (endedAt) {
        const end = parseIsoAsUtc(endedAt).getTime()
        if (!isNaN(end)) elapsed = Math.max(0, Math.floor((end - start) / 1000))
      }

      setBannerTimer(elapsed)
    }

    updateTimer()
    // Só tica se a sessão está ativa; pausada mostra tempo congelado.
    if (isActive) {
      bannerTimerRef.current = setInterval(updateTimer, 100)
    }

    return () => {
      if (bannerTimerRef.current) {
        clearInterval(bannerTimerRef.current)
        bannerTimerRef.current = null
      }
    }
  }, [activeSession?.started_at, activeSession?.ended_at, activeSession?.is_active])

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('hq-sidebar-collapsed', JSON.stringify(sidebarCollapsedRaw))
  }, [sidebarCollapsedRaw])

  // URL is now the source of truth for surface (via React Router).
  // We still persist selected quest id so drilling back into an area restores it.
  useEffect(() => {
    const nav = { questId: selectedQuestId || null }
    localStorage.setItem('hq-navigation', JSON.stringify(nav))
  }, [selectedQuestId])

  // Persist archived ideas
  useEffect(() => {
    localStorage.setItem('hq-archived-ideas', JSON.stringify(archivedIdeas))
  }, [archivedIdeas])

  useEffect(() => {
    // Hooks (useProjects/useQuests/etc) fazem o fetch inicial automaticamente
    // — não precisa de fetchX().then(setX) aqui.

    // Inject CSS animations
    const style = document.createElement('style')
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `
    document.head.appendChild(style)
    return () => { document.head.removeChild(style) }
  }, [])

  // ESC: go back one level (area detail → areas list → /dia)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      const path = location.pathname
      const match = path.match(/^\/areas\/(.+)/)
      if (match) {
        setSelectedQuestId(null)
        navigate('/areas')
      } else if (path !== '/exec') {
        navigate('/exec')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [location.pathname, navigate])

  // Rituais atrasados → badge urgent na sidebar do /build. Surface única do
  // estrategista no executor: se a /build é uma ilha (sem outras surfaces),
  // o ritual atrasado é o que faz o usuário lembrar de visitar.
  const { data: rituais = [] } = useRituals()
  const ritualsAtrasados = rituais.filter(r => r.ativo && r.dias_atraso > 0).length

  // Pendências do Hub Health (lembretes + ausência) → dot âmbar na sidebar.
  // Refetch automático a cada minuto pra capturar mudanças temporais.
  const { data: healthPending = [] } = useHealthPending()
  const healthPendingCount = healthPending.length

  // Contadores ao vivo pros badges do sidebar — sinal de "produto vivo"
  // (Linear/Cron mostram # de unread/overdue ao lado dos itens). Apenas
  // overdue de Tarefas (urgência real) e ativas de Quests (volume geral).
  const sidebarBadges = (() => {
    const now = new Date()
    const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const overdueTasks = tasks.filter(t =>
      !t.done && t.scheduled_date && t.scheduled_date < todayYmd
    ).length
    const archived = archivedIdeas.length
    return {
      '/tarefas': { count: overdueTasks, urgent: true },
      '/arquivados': { count: archived, urgent: false },
      '/build': { count: ritualsAtrasados, urgent: true },
      '/health': { count: healthPendingCount, urgent: false, tone: 'amber' as const },
    } as Record<string, { count: number; urgent: boolean; tone?: 'amber' }>
  })()

  // Resolve a largura efetiva do sidebar — em mobile vira drawer de 280px,
  // em desktop fica 72 (collapsed) ou 220 (expanded).
  const sidebarWidth = isCompact ? 280 : (sidebarCollapsed ? 72 : 220)
  // Deslocamento horizontal do conteúdo fixo/pinned (banner, overlay da
  // cutscene, margem da área principal). Em mobile o sidebar é drawer overlay
  // e NÃO ocupa espaço → offset 0 (senão o banner fica empurrado pra direita e
  // parece cortado na esquerda). Em desktop acompanha a largura do sidebar.
  const contentOffset = isCompact ? 0 : (sidebarCollapsed ? 72 : 220)
  // Em mobile, o sidebar é escondido por padrão (translateX negativo);
  // só fica visível quando `sidebarOpen=true` via hambúrguer.
  const sidebarTransform = isCompact && !sidebarOpen
    ? `translateX(-${sidebarWidth}px)`
    : 'translateX(0)'

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Backdrop pro drawer mobile — clique fecha. Só renderiza quando
          sidebar tá aberto em mobile (não ocupa pintura no desktop). */}
      {isCompact && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(2px)',
            zIndex: 99,
            animation: 'hq-fade-in 0.2s ease',
          }}
        />
      )}
      <aside
        className="hq-grain"
        style={{
          position: 'fixed', left: 0, top: 0, bottom: 0,
          width: sidebarWidth,
          flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          padding: 'var(--space-4) 0 var(--space-3)',
          display: 'flex', flexDirection: 'column',
          background: 'rgba(8, 12, 18, 0.62)',
          // Blur reduzido de 28→10. O blur original (28px) é o maior custo
          // por frame quando width anima — backdrop-filter re-amostra toda
          // a área de blur a cada layout change. 10 ainda dá frosted look
          // mas é ~3× mais barato.
          backdropFilter: 'blur(10px) saturate(135%)',
          WebkitBackdropFilter: 'blur(10px) saturate(135%)',
          // `translate3d` força promoção pro compositor (mesmo quando
          // sidebarTransform é identity) — backdrop-filter + grain
          // pseudo-element rasterizam pra um bitmap GPU em vez de re-pintar
          // por frame.
          transform: `${sidebarTransform} translateZ(0)`,
          // Isola re-layout/re-paint dos children — width do aside muda
          // sem refletir o conteúdo interno toda frame.
          contain: 'layout paint',
          willChange: 'transform',
          transition: 'width 260ms cubic-bezier(0.32, 0.72, 0, 1), transform var(--motion-base) var(--ease-emphasis)',
          height: '100vh', overflowY: 'auto', overflowX: 'hidden',
          zIndex: 100, boxSizing: 'border-box',
        }}
      >
        {/* Header: monograma [HQ] cyber + caption tech + toggle angular */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: sidebarCollapsed ? '0 var(--space-3)' : '0 var(--space-3) 0 var(--space-3)',
          marginBottom: sidebarCollapsed ? 'var(--space-4)' : 'var(--space-4)',
          gap: 'var(--space-2)',
          minHeight: 40,
        }}>
          {/* MONOGRAMA HQ — só tipografia cyber, sem frame envolta.
              Display font Rajdhani uppercase com text-shadow ice glow. */}
          <div
            aria-label="MAINFRAME"
            style={{
              flexShrink: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: 'var(--color-ice-light)',
              textShadow: '0 0 12px var(--color-ice-glow)',
              lineHeight: 1,
              padding: sidebarCollapsed ? 0 : '0 4px',
            }}
          >
            MF
          </div>

          {!sidebarCollapsed && (
            <>
              {/* Caption tech: HUB.QUEST + sub-id */}
              <div style={{
                flex: 1, minWidth: 0,
                display: 'flex', flexDirection: 'column', gap: 1,
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  color: 'var(--color-ice-light)',
                  fontWeight: 700,
                  lineHeight: 1,
                }}>
                  MAINFRAME
                </span>
                <span
                  className="hq-tech-id"
                  style={{ fontSize: 8, color: 'var(--color-text-muted)', lineHeight: 1 }}
                >
                  TACTICAL.SYS
                </span>
              </div>
              {/* Toggle collapse — botão angular CP2077 com chevron duplo.
                  Escondido em mobile: drawer fecha via backdrop ou nav. */}
              {!isCompact && <button
                onClick={() => setSidebarCollapsed(true)}
                title="Recolher menu"
                aria-label="Recolher menu"
                style={{
                  width: 26, height: 26,
                  background: 'rgba(8, 12, 18, 0.6)',
                  border: '1px solid var(--color-border)',
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                  cursor: 'pointer',
                  color: 'var(--color-text-tertiary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background var(--motion-fast) var(--ease-smooth), border-color var(--motion-fast) var(--ease-smooth), color var(--motion-fast) var(--ease-smooth)',
                  borderRadius: 0,
                  flexShrink: 0,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--color-ice-soft)'
                  e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                  e.currentTarget.style.color = 'var(--color-ice-light)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(8, 12, 18, 0.6)'
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                  e.currentTarget.style.color = 'var(--color-text-tertiary)'
                }}
              >
                <ChevronsLeft size={14} strokeWidth={2} />
              </button>}
            </>
          )}

          {sidebarCollapsed && !isCompact && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              title="Expandir menu"
              aria-label="Expandir menu"
              style={{
                position: 'absolute',
                left: 'calc(100% - 13px)',
                top: 26,
                width: 26, height: 26,
                background: 'rgba(8, 12, 18, 0.92)',
                border: '1px solid var(--color-ice-deep)',
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                cursor: 'pointer',
                color: 'var(--color-ice-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'box-shadow var(--motion-fast) var(--ease-smooth)',
                borderRadius: 0,
                zIndex: 101,
                boxShadow: '0 0 8px rgba(143, 191, 211, 0.20)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.boxShadow = '0 0 14px rgba(143, 191, 211, 0.45)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.boxShadow = '0 0 8px rgba(143, 191, 211, 0.20)'
              }}
            >
              <ChevronsRight size={14} strokeWidth={2} />
            </button>
          )}
        </div>

        {/* User chip removido — perfil acessível pelo header do Dashboard,
            sidebar fica focada em navegação pura (vibe HUD CP2077). */}

        {/* Nav: seções (Main/Work/Finance/Archive) com eyebrow label
            quando expandido + items com pill oxblood ativa + dot indicator
            esquerda + hover dois-tempos. Substitui a antiga lista plana. */}
        <nav style={{
          display: 'flex',
          flexDirection: 'column',
          gap: sidebarCollapsed ? 'var(--space-3)' : 'var(--space-4)',
          padding: '0 var(--space-2)',
        }}>
          {NAV_SECTIONS.map(section => (
            <div key={section.label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {!sidebarCollapsed ? (
                /* Section label cyber: tab marker ice + // LABEL mono */
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '4px 12px 8px',
                  marginBottom: 2,
                }}>
                  <div
                    aria-hidden="true"
                    style={{
                      width: 3, height: 12,
                      background: 'var(--color-ice)',
                      boxShadow: '0 0 6px var(--color-ice-glow)',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700,
                    color: 'var(--color-ice-light)',
                    letterSpacing: '0.28em', textTransform: 'uppercase',
                  }}>
                    <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                    {section.label}
                  </span>
                </div>
              ) : (
                /* Quando colapsado: hairline ice horizontal mini divisor */
                <div
                  aria-hidden="true"
                  style={{
                    height: 1,
                    margin: '4px 14px 4px',
                    background: 'rgba(143, 191, 211, 0.18)',
                  }}
                />
              )}
              {section.items.map(n => (
                <NavLink
                  key={n.path}
                  to={n.path}
                  title={sidebarCollapsed ? n.label : undefined}
                  style={({ isActive }) => ({
                    position: 'relative',
                    background: isActive ? 'var(--color-ice-soft)' : 'transparent',
                    borderTop: isActive
                      ? '1px solid rgba(143, 191, 211, 0.18)'
                      : '1px solid transparent',
                    borderRight: isActive
                      ? '1px solid rgba(143, 191, 211, 0.18)'
                      : '1px solid transparent',
                    borderBottom: isActive
                      ? '1px solid rgba(143, 191, 211, 0.18)'
                      : '1px solid transparent',
                    borderLeft: isActive
                      ? '2px solid var(--color-ice)'
                      : '2px solid transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    padding: sidebarCollapsed ? '10px 0' : '8px 12px',
                    color: isActive
                      ? 'var(--color-ice-light)'
                      : 'var(--color-text-tertiary)',
                    /* Mono uppercase pra vibe HUD CP2077 (era body font default). */
                    fontFamily: 'var(--font-mono)',
                    fontSize: sidebarCollapsed ? 10 : 11,
                    fontWeight: 700,
                    letterSpacing: sidebarCollapsed ? '0.15em' : '0.18em',
                    textTransform: 'uppercase',
                    borderRadius: 0,
                    clipPath: isActive
                      ? 'polygon(0 0, 100% 0, 100% 100%, 10px 100%, 0 calc(100% - 10px))'
                      : undefined,
                    transition: 'background var(--motion-fast) var(--ease-smooth), color var(--motion-fast) var(--ease-smooth), border-color var(--motion-fast) var(--ease-smooth)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                    textDecoration: 'none',
                    boxShadow: isActive
                      ? 'inset 8px 0 24px -8px rgba(143, 191, 211, 0.20), 0 0 16px -4px rgba(143, 191, 211, 0.18)'
                      : 'none',
                  })}
                  onMouseEnter={e => {
                    if (!e.currentTarget.classList.contains('active')) {
                      e.currentTarget.style.background = 'rgba(143, 191, 211, 0.06)'
                      e.currentTarget.style.color = 'var(--color-ice-light)'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!e.currentTarget.classList.contains('active')) {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.color = 'var(--color-text-tertiary)'
                    }
                  }}
                >
                  {sidebarCollapsed ? (
                    /* Collapsed: abreviação 3-letras mono — vibe CP2077 HUD tag */
                    <span style={{ flex: 1, textAlign: 'center' }}>{n.abbr}</span>
                  ) : (
                    <span style={{ flex: 1 }}>{n.label.toUpperCase()}</span>
                  )}
                  {/* Badge cyber chamferado mono.
                      - tone='amber'  → âmbar (Hub Health pendente)
                      - urgent=true   → oxblood + glow (Tarefas overdue, Build ritual atrasado)
                      - default       → cinza neutro */}
                  {!sidebarCollapsed && sidebarBadges[n.path]?.count > 0 && (() => {
                    const b = sidebarBadges[n.path]
                    const isAmber = b.tone === 'amber'
                    return (
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9, fontWeight: 700,
                        padding: '2px 7px',
                        letterSpacing: '0.05em',
                        borderRadius: 0,
                        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
                        background: isAmber
                          ? 'rgba(255, 179, 0, 0.10)'
                          : b.urgent
                            ? 'rgba(159, 18, 57, 0.18)'
                            : 'rgba(8, 12, 18, 0.55)',
                        color: isAmber
                          ? '#ffb300'
                          : b.urgent
                            ? 'var(--color-accent-light)'
                            : 'var(--color-text-tertiary)',
                        border: isAmber
                          ? '1px solid rgba(255, 179, 0, 0.45)'
                          : b.urgent
                            ? '1px solid var(--color-accent-primary)'
                            : '1px solid var(--color-border)',
                        boxShadow: b.urgent && !isAmber
                          ? '0 0 8px rgba(159, 18, 57, 0.30)'
                          : 'none',
                      }}>
                        {b.count.toString().padStart(2, '0')}
                      </span>
                    )
                  })()}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Spacer pra empurrar versão pro fim */}
        <div style={{ flex: 1 }} />
        {/* Footer: HUD readout CP2077 — status conn + versão + system tag.
            No collapsed só o dot visível (modo compacto).
            Separator: hairline ice mesmo padrão dos section dividers acima
            (antes era border sólida e text-muted → ficava como "bloco
            escuro depois de Health" segundo o user). */}
        {!sidebarCollapsed && (
          <div
            aria-hidden="true"
            className="hq-hairline-ice"
            style={{ margin: '8px 14px 4px', opacity: 0.5 }}
          />
        )}
        <div style={{
          padding: sidebarCollapsed ? '0 0 0 0' : 'var(--space-2) var(--space-3) var(--space-3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarCollapsed ? 'center' : 'space-between',
          gap: 'var(--space-2)',
        }}>
          {sidebarCollapsed ? (
            <span
              aria-hidden="true"
              title={`Backend conectado · v${APP_VERSION}`}
              style={{
                width: 6, height: 6,
                background: 'var(--color-success)',
                boxShadow: '0 0 6px rgba(122, 154, 138, 0.7), 0 0 0 1px rgba(122, 154, 138, 0.3)',
                flexShrink: 0,
              }}
            />
          ) : (
            <>
              <span
                title="Backend conectado"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  color: 'var(--color-text-tertiary)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 5, height: 5,
                    background: 'var(--color-success)',
                    boxShadow: '0 0 4px rgba(122, 154, 138, 0.7)',
                    flexShrink: 0,
                  }}
                />
                CONN.OK
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.15em',
                  color: 'var(--color-text-tertiary)',
                }}
              >
                v{APP_VERSION}
              </span>
            </>
          )}
        </div>
      </aside>

      {isHydrated && bannerLifecycle.session && (() => {
        const activeSession = bannerLifecycle.session
        // Detecção de overflow — tempo total (sessão atual + fechadas) maior
        // que o estimated_minutes da entidade. Quando true, banner muda pra
        // paleta vermelho/prata (drift overflow + border tone) com crossfade.
        const totalElapsedSec = bannerTimer + bannerClosedSec
        const estSec = (activeSession.estimated_minutes ?? 0) * 60
        const bannerOverflow = activeSession.is_active && estSec > 0 && totalElapsedSec > estSec
        const lifecycleClass = bannerLifecycle.stage === 'entering'
          ? ' hq-banner-fill-in'
          : bannerLifecycle.stage === 'exiting'
            ? ' hq-banner-fill-out'
            : ''
        return (
        <>
        {bannerLifecycle.stage !== 'idle' && (
          <BannerGridOverlay
            stage={bannerLifecycle.stage}
            left={contentOffset}
          />
        )}
        <div
          className={`hq-grain hq-chrome-hairline hq-scanlines${activeSession.is_active ? '' : ' hq-scanlines--paused'}${lifecycleClass}`}
          style={{
            position: 'fixed', top: 0,
            left: contentOffset,
            right: 0,
            height: 64,
            // Atmosphere "Hell Is Us" — fog azulado por trás do glass.
            // Quando live, halo ice cyan top-right (alien-tech ligado).
            // Quando pausado, fog frio sem glow (estado dormente).
            background: activeSession.is_active
              ? `radial-gradient(ellipse 40% 100% at 100% 0%, rgba(143, 191, 211, 0.06), transparent 70%),
                 radial-gradient(ellipse 60% 100% at 50% 100%, rgba(40, 50, 57, 0.20), transparent 75%),
                 rgba(8, 10, 14, 0.7)`
              : `radial-gradient(ellipse 60% 100% at 50% 100%, rgba(40, 50, 57, 0.16), transparent 75%),
                 rgba(8, 10, 14, 0.7)`,
            backdropFilter: 'blur(24px) saturate(160%)',
            WebkitBackdropFilter: 'blur(24px) saturate(160%)',
            // Borda inferior: live normal = ice deep; live overflow = silver/red
            // alert; paused = neutra.
            borderBottom: activeSession.is_active
              ? '1px solid transparent'
              : '1px solid var(--color-border)',
            display: 'flex', alignItems: 'center',
            gap: 'var(--space-5)',
            padding: '0 var(--space-6)',
            transition: 'left var(--motion-base) var(--ease-emphasis), box-shadow 1.8s ease, border-bottom-color 0.8s ease, background 0.8s ease',
            zIndex: 99,
            boxShadow: activeSession.is_active
              ? bannerOverflow
                ? 'inset 0 -1px 0 rgba(220, 220, 230, 0.55), 0 0 32px rgba(159, 18, 57, 0.16)'
                : 'inset 0 -1px 0 rgba(143, 191, 211, 0.24), 0 0 32px rgba(143, 191, 211, 0.04)'
              : 'inset 0 -1px 0 var(--color-border)',
            overflow: 'hidden',
          }}
        >
          {/* Live-only animated overlays — sempre mounted, fade via opacity.
              Quando paused: ambas drifts + grain ficam opacity 0 (transition
              suave de 1.8s). Quando live: aplica `--fade` em uma das drifts
              pra crossfade entre normal e overflow palette. Manter sempre
              mounted evita corte abrupto na pausa. */}
          <div
            className={`hq-banner-live-drift${(!activeSession.is_active || bannerOverflow) ? ' hq-banner-live-drift--fade' : ''}`}
            aria-hidden="true"
          />
          <div
            className={`hq-banner-live-drift hq-banner-live-drift--overflow${(!activeSession.is_active || !bannerOverflow) ? ' hq-banner-live-drift--fade' : ''}`}
            aria-hidden="true"
          />
          <div
            className={`hq-banner-live-grain${!activeSession.is_active ? ' hq-banner-live-grain--fade' : ''}`}
            aria-hidden="true"
          />


          {/* Status pulsante — square angular CP2077 (substitui dot redondo).
              Live = oxblood pulsando; pausado = verde estático. */}
          <div
            className={activeSession.is_active ? 'hq-pulse-square' : 'hq-pulse-square hq-pulse-square--success'}
            aria-hidden="true"
            style={{ position: 'relative', zIndex: 1 }}
          />

          {/* Session info — compacto, estilo HUD CP2077 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, position: 'relative', zIndex: 1 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              fontSize: 9,
              fontFamily: 'var(--font-mono)',
              color: activeSession.is_active ? 'var(--color-accent-light)' : 'var(--color-success-light)',
              fontWeight: 700,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              transition: 'color 0.6s ease',
            }}>
              <span style={{ position: 'relative' }}>
                <span style={{
                  color: activeSession.is_active ? 'var(--color-accent-primary)' : 'var(--color-success)',
                  marginRight: 4,
                  opacity: 0.85,
                  transition: 'color 0.6s ease',
                }}>//</span>
                {activeSession.is_active ? 'LIVE' : 'PAUSED'}
              </span>
              {/* Tag angular tipo CP2077 — clip-path paralelogramo */}
              <span
                className="hq-tag-angular"
                style={{
                  fontSize: 9,
                  padding: '2px 10px',
                  background: 'rgba(143, 191, 211, 0.08)',
                  color: 'var(--color-ice-light)',
                  border: 'none',
                  letterSpacing: '0.18em',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {activeSession.type === 'quest' ? 'QST'
                  : activeSession.type === 'task' ? 'TSK'
                  : activeSession.type === 'routine' ? 'RTN'
                  : activeSession.type === 'mind' ? 'MND'
                  : activeSession.type === 'health_item' ? 'HLT'
                  : activeSession.type === 'library' ? 'LIB'
                  : activeSession.type === 'ritual' ? 'RTL'
                  : 'SES'}
              </span>
            </div>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)',
              minWidth: 0,
            }}>
              <span style={{
                fontSize: 'var(--text-base)',
                color: 'var(--color-text-primary)',
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flexShrink: 1,
              }}>
                {activeSession.title}
              </span>
              {(activeSession.parent_title || activeSession.deliverable_title) && (
                <span style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-muted)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  flexShrink: 0,
                }}>
                  {activeSession.parent_title && <span>· {activeSession.parent_title}</span>}
                  {activeSession.parent_title && activeSession.deliverable_title && (
                    <span>›</span>
                  )}
                  {activeSession.deliverable_title && (
                    <span style={{ color: 'var(--color-text-tertiary)' }}>{activeSession.deliverable_title}</span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Timer — clicável (vai pra histórico) */}
          <button
            type="button"
            className="hq-icon-btn-bare"
            onClick={async () => {
              if (!activeSession) return
              try {
                await reloadBannerHistory()
                setBannerHistoryOpen(true)
              } catch {
                setBannerHistorySessions([])
                setBannerHistoryOpen(true)
              }
            }}
            title="ver histórico de sessões"
            aria-label="ver histórico de sessões"
            style={{
              padding: 'var(--space-2) var(--space-3)',
              minWidth: 'auto', minHeight: 'auto',
              display: 'flex', flexDirection: 'column',
              alignItems: 'flex-end', gap: 0,
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              position: 'relative', zIndex: 1,
            }}
          >
            <span style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 700,
              color: activeSession.is_active
                ? 'var(--color-ice-light)'
                : 'var(--color-text-secondary)',
              textShadow: activeSession.is_active
                ? '0 0 16px var(--color-ice-glow)'
                : 'none',
              lineHeight: 1,
              letterSpacing: '-0.02em',
              transition: 'color 0.6s ease, text-shadow 0.6s ease',
            }}>
              {formatHMS(bannerTimer)}
            </span>
            {bannerClosedSec > 0 && (() => {
              const mins = Math.round(bannerClosedSec / 60)
              const h = Math.floor(mins / 60)
              const m = mins % 60
              const label = h > 0 && m > 0 ? `${h}h ${m}m` : h > 0 ? `${h}h` : `${m}m`
              return (
                <span style={{
                  fontSize: 9,
                  color: 'var(--color-text-muted)',
                  marginTop: 2,
                  letterSpacing: '0.05em',
                }}>
                  +{label}
                </span>
              )
            })()}
          </button>

          {/* Controls — minimais, icon-only */}
          <div style={{ display: 'flex', gap: 'var(--space-1)', position: 'relative', zIndex: 1 }}>
            <button
              type="button"
              className="hq-icon-btn"
              onClick={() => {
                if (!activeSession) return
                const { type, id, is_active, routine_date } = activeSession
                // Pra rotinas: passa a data da sessão ativa pro backend não
                // confundir cross-midnight. Endpoints já são tolerantes a
                // ausência mas explicitar é mais seguro.
                const target = type === 'routine' ? routine_date ?? undefined : undefined
                // Mind: domain-level (sem id específico). Health item: id é o
                // item_id (vem como string do active-session UNION).
                const healthItemId = type === 'health_item' ? parseInt(id, 10) : 0
                // Ritual cluster id é a cadencia (string).
                let call: Promise<unknown>
                if (is_active) {
                  call = type === 'quest' ? pauseSession(id)
                    : type === 'task' ? pauseTaskSession(id)
                    : type === 'routine' ? pauseRoutineSession(id, target)
                    : type === 'mind' ? pauseMindSession()
                    : type === 'health_item' ? pauseHealthItemSession(healthItemId)
                    : type === 'ritual' ? pauseRitualCluster(id)
                    : Promise.resolve()
                } else {
                  call = type === 'quest' ? resumeSession(id)
                    : type === 'task' ? resumeTaskSession(id)
                    : type === 'routine' ? resumeRoutineSession(id, target)
                    : type === 'mind' ? resumeMindSession()
                    : type === 'health_item' ? resumeHealthItemSession(healthItemId)
                    : type === 'ritual' ? resumeRitualCluster(id)
                    : Promise.resolve()
                }
                call.then(() => onSessionUpdate()).catch(err => reportApiError('App', err))
              }}
              title={activeSession.is_active ? `Pausar ${activeSession.type}` : `Retomar ${activeSession.type}`}
              aria-label={activeSession.is_active ? `Pausar ${activeSession.type}` : `Retomar ${activeSession.type}`}
              style={{ padding: '8px 14px', minHeight: 36, gap: 6 }}
            >
              {activeSession.is_active
                ? <Pause size={13} strokeWidth={2} />
                : <Play size={13} strokeWidth={2} />}
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: '0.05em' }}>
                {activeSession.is_active ? 'pausar' : 'retomar'}
              </span>
            </button>

            <button
              type="button"
              className="hq-icon-btn hq-icon-btn--accent"
              onClick={() => {
                if (!activeSession) return
                const { type, id, is_active, routine_date } = activeSession

                const finalizeQuest = () => {
                  patchQuest(id, { status: 'done' }).catch(err => reportApiError('App', err))
                  setQuests(qs => qs.map(q => q.id === id ? { ...q, status: 'done' } : q))
                  setActiveSession(null)
                  saveFocusedEntity(null)
                  onSessionUpdate()
                  tabSync.emit('session')
                }

                const clearBanner = () => {
                  setActiveSession(null)
                  saveFocusedEntity(null)
                  onSessionUpdate()
                  tabSync.emit('session')
                }

                if (type === 'quest') {
                  if (is_active) {
                    pauseSession(id).then(finalizeQuest).catch(err => reportApiError('App', err))
                  } else {
                    finalizeQuest()
                  }
                } else if (type === 'task') {
                  stopTaskSession(id).then(clearBanner).catch(err => reportApiError('App', err))
                } else if (type === 'routine') {
                  // Passa target=routine_date pra fechar a sessão correta
                  // (cross-midnight) e gravar o log no dia certo.
                  stopRoutineSession(id, routine_date ?? undefined).then(clearBanner).catch(err => reportApiError('App', err))
                } else if (type === 'mind' || type === 'health_item' || type === 'ritual') {
                  // Mind/Health/Ritual: finalizar mora no /exec (auto-register
                  // ou modal pré-preenchido). Passa o pendência_id como query
                  // param — /exec lê e dispara o FINALIZAR no card certo
                  // automaticamente. Se já estiver em /exec, useEffect detecta
                  // o param e roda mesmo assim.
                  const pendenciaId = type === 'mind'
                    ? 'mind'
                    : type === 'health_item'
                      ? `health_item:${id}`
                      : `ritual:${id}`
                  navigate(`/exec?finalize=${encodeURIComponent(pendenciaId)}`)
                }
              }}
              title={`Finalizar ${activeSession.type}`}
              aria-label={`Finalizar ${activeSession.type}`}
              style={{ padding: '8px 14px', minHeight: 36, gap: 6 }}
            >
              <CheckCircle2 size={13} strokeWidth={2} />
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: '0.05em' }}>
                finalizar
              </span>
            </button>
          </div>
        </div>
        </>
        )
      })()}

      {bannerHistoryOpen && (
        <SessionHistoryModal
          sessions={bannerHistorySessions}
          kind={
            activeSession?.type === 'quest' ? 'quest'
            : activeSession?.type === 'task' ? 'task'
            : activeSession?.type === 'routine' ? 'routine'
            : activeSession?.type === 'mind' ? 'mind'
            : activeSession?.type === 'health_item' ? 'health'
            : activeSession?.type === 'ritual' ? 'ritual'
            : undefined
          }
          onChanged={() => {
            // Refresh banner + lista do histórico. onSessionUpdate() bumps
            // trigger pra reload do activeSession; reloadBannerHistory()
            // atualiza as rows mostradas no modal sem precisar fechar.
            onSessionUpdate()
            reloadBannerHistory().catch(err => reportApiError('App', err))
            tabSync.emit('session')
          }}
          onClose={() => setBannerHistoryOpen(false)}
        />
      )}

      <main style={{
        flex: 1,
        // Mobile: padding mínimo. Desktop: padding generoso (mantém vibe
        // editorial). Calendário sempre menor pra timeline caber.
        padding: isCompact
          ? '12px'
          : (location.pathname.startsWith('/calendario') ? '24px 32px' : '48px 60px'),
        maxWidth: '100%',
        // Mobile: sidebar é drawer overlay, conteúdo ocupa 100%. Desktop:
        // empurra pro lado do sidebar pinned.
        marginLeft: contentOffset,
        marginTop: (isHydrated && activeSession) ? 64 : 0,
        // Duração + curva idênticas ao width do aside pra ambos saírem
        // sincronizados (sem isso, sidebar termina antes e o conteúdo
        // "salta" pra ocupar o espaço). Curva Apple-style ease-out longo:
        // arranca rápido, desacelera devagar = sensação smooth.
        transition: 'margin-top var(--motion-base) var(--ease-emphasis), margin-left 260ms cubic-bezier(0.32, 0.72, 0, 1)',
        minHeight: '100vh',
        background: 'transparent',
      }}>
        {/* Hambúrguer mobile — fica fixed no canto top-left pra ser sempre
            alcançável. Em desktop, escondido (sidebar é sempre visível). */}
        {isCompact && (
          <button
            type="button"
            onClick={() => setSidebarOpen(o => !o)}
            aria-label={sidebarOpen ? 'Fechar menu' : 'Abrir menu'}
            style={{
              position: 'fixed',
              top: (isHydrated && activeSession) ? 76 : 12,
              left: 12,
              zIndex: 98,
              background: 'rgba(8, 12, 18, 0.92)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid var(--color-border-strong)',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
              color: 'var(--color-ice-light)',
              width: 44, height: 44,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              transition: 'background var(--motion-fast) var(--ease-smooth)',
            }}
          >
            <Menu size={20} strokeWidth={2} />
          </button>
        )}
        {/* Sem fade global entre rotas — quem dá a sensação "premium"
            agora é o stagger dos cards/listas montando dentro da rota
            nova (Framer Motion StaggerList). Linear/Vercel/Raycast fazem
            assim: rota troca instant, conteúdo da rota nova entra com
            spring próprio. Antes tínhamos fade global de ~280ms que
            empilhava com refetch do HubFinanceProvider — gerava
            sensação de lentidão entre subpáginas do Hub Finance. */}
        <div>
        {/* Suspense fallback minimal — só um placeholder discreto enquanto
            o chunk lazy é baixado. Em rede rápida (cache quente), invisível.
            Mantém vibe cyber HUD com `// LOADING` em mono. */}
        <Suspense fallback={
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10, fontWeight: 700,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
            padding: '48px 8px',
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            LOADING
          </div>
        }>
        <Routes>
          <Route path="/" element={<Navigate to="/exec" replace />} />
          <Route path="/dashboard" element={<DashboardView projects={projects} quests={quests} areas={areas} profile={profile} onProfileUpdate={setProfile} onSelectProject={setSelectedProjectId} />} />
          <Route path="/exec" element={<ExecView projects={projects} quests={quests} areas={areas} activeSession={activeSession} onSessionUpdate={onSessionUpdate} onSelectProject={setSelectedProjectId} />} />
          <Route path="/calendario" element={<CalendarView projects={projects} quests={quests} areas={areas} sessionUpdateTrigger={sessionUpdateTrigger} onSessionUpdate={onSessionUpdate} />} />
          <Route path="/rotinas" element={<RoutinesView />} />
          <Route path="/tarefas" element={<TasksView activeSession={activeSession} onSessionUpdate={onSessionUpdate} sessionUpdateTrigger={sessionUpdateTrigger} />} />
          <Route path="/build" element={<BuildLayout />}>
            <Route index element={<BuildPage />} />
            <Route path="historia" element={<BuildHistoriaPage />} />
          </Route>
          {/* Library — módulo de input curado (livros, filmes, podcasts…).
              Doc: docs/library/PLAN.md. Filosofia: destilação > consumo. */}
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/library/temas" element={<LibraryTemasPage />} />
          <Route path="/library/item/:id" element={<LibraryItemPage />} />
          {/* Mind — promovido a peer top-level (saiu de /health/mind).
              Filosofia: Mind é instrumentação cognitiva (observação→hipótese
              →validação), não monitoramento de estado corporal. Junto com
              Library e /Build forma a camada de "pensar". Doc: ARCHITECTURE
              §3 (entidades). */}
          <Route path="/mind" element={<MindPage />} />
          <Route path="/mind/hipoteses" element={<MindHipotesesPage />} />
          <Route path="/mind/tag/:slug" element={<MindTagPage />} />
          {/* Hub Health — layout com tab bar (biomonitor + 1 tab por domínio).
              `/health` redireciona pra `/health/biomonitor`. Mind foi
              promovido pra top-level; rotas antigas redirecionam (preserva
              bookmarks). */}
          <Route path="/health" element={<HealthLayout />}>
            <Route index element={<Navigate to="biomonitor" replace />} />
            <Route path="biomonitor" element={<BiomonitorPage />} />
            {/* Redirects das rotas legadas — Mind agora vive em /mind. */}
            <Route path="mind" element={<Navigate to="/mind" replace />} />
            <Route path="mind/hipoteses" element={<Navigate to="/mind/hipoteses" replace />} />
            <Route path="mind/tag/:slug" element={<MindTagLegacyRedirect />} />
            <Route path=":slug" element={<DomainPage />} />
          </Route>
          {/* Hub Finance — layout com sub-rotas (visão geral, lançamentos, etc).
              `/hub-finance` redireciona pra `/hub-finance/visao-geral`. */}
          <Route path="/hub-finance" element={<HubFinanceLayout />}>
            <Route index element={<Navigate to="visao-geral" replace />} />
            <Route path="visao-geral" element={<VisaoGeralPage />} />
            <Route path="carteira" element={<CarteiraPage />} />
            <Route path="fixas" element={<FixasPage />} />
            <Route path="dividas" element={<DividasPage />} />
            <Route path="wishlist" element={<WishlistPage />} />
            <Route path="lancamentos" element={<LancamentosPage />} />
            <Route path="freelas" element={<FreelasPage />} />
            <Route path="categorias" element={<CategoriasPage />} />
          </Route>
          <Route path="/micro-dump" element={<MicroDumpView areas={areas} projects={projects} onArchive={(idea) => setArchivedIdeas([...archivedIdeas, idea])} />} />
          <Route path="/arquivados" element={<ArquivadosView archivedIdeas={archivedIdeas} onDelete={(id) => setArchivedIdeas(prev => prev.filter(i => i.id !== id))} />} />
          <Route path="/areas" element={
            <AreasView
              areas={areas}
              projects={projects}
              quests={quests}
              onAreaCreate={(a) => setAreas(prev => [...prev, a])}
              onAreaUpdate={(slug, patch) => setAreas(prev => prev.map(x => x.slug === slug ? { ...x, ...patch } : x))}
              onAreaDelete={(slug) => setAreas(prev => prev.filter(x => x.slug !== slug))}
            />
          } />
          <Route path="/areas/:slug" element={
            <AreaDetailRoute
              areas={areas}
              projects={projects}
              quests={quests}
              selectedProjectId={selectedProjectId}
              onSelectProject={setSelectedProjectId}
              onProjectUpdate={(id, patch) => {
                // setProjects é no-op aqui (legado de quando era useState) —
                // só invalida cache. O patchProject roda async. Sem invalidar
                // DE NOVO depois do .then(), o refetch disparado pela primeira
                // invalidação chegava ANTES do PATCH commitar no backend →
                // cache se acomodava no estado pré-mudança e a UI ficava
                // mostrando projeto não-finalizado até F5.
                patchProject(id, patch)
                  .then(() => {
                    appInv.projects()
                    // Arquivar/desarquivar muda quais quests o backend
                    // devolve em /api/quests (filtra por archived_at do
                    // projeto pai). Refetch pra state continuar consistente.
                    if ('archived_at' in patch) {
                      appInv.quests()
                    }
                  })
                  .catch(err => reportApiError('App', err))
              }}
              onQuestUpdate={(id, patch) => {
                setQuests(qs => qs.map(q => q.id === id ? { ...q, ...patch } : q))
                patchQuest(id, patch)
                  .then(() => {
                    // Backend fecha sessão aberta ao mover status pra terminal —
                    // refresca o estado da sessão ativa pro banner sumir.
                    if ('status' in patch) onSessionUpdate()
                  })
                  .catch(err => reportApiError('App', err))
              }}
              onSessionUpdate={onSessionUpdate}
              onProjectCreate={(p) => setProjects(ps => [p, ...ps])}
              onProjectDelete={(id) => setProjects(ps => ps.filter(p => p.id !== id))}
              onQuestCreate={(q) => setQuests(qs => [q, ...qs])}
              onQuestDelete={(id) => setQuests(qs => qs.filter(q => q.id !== id))}
            />
          } />
          <Route path="*" element={<Navigate to="/exec" replace />} />
        </Routes>
        </Suspense>
        </div>
      </main>
      <DialogPortal />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        areas={areas}
        projects={projects}
        quests={quests}
        tasks={tasks}
        routines={routines}
        debts={debts}
        onSelectProject={setSelectedProjectId}
      />
    </div>
  )
}

