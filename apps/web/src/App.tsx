import { useEffect, useRef, useState } from 'react'
import {
  Sun, CalendarDays, Crosshair, Folders, Archive, Repeat, Lightbulb, LayoutDashboard,
  ListChecks, Wallet, PanelLeftClose, PanelLeftOpen, Pause, Play, CheckCircle2,
} from 'lucide-react'
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom'
import {
  fetchQuests, fetchProjects, fetchAreas, fetchProfile, fetchActiveSession,
  patchQuest, patchProject,
  fetchSessions, pauseSession, resumeSession,
  fetchTaskSessions, pauseTaskSession, resumeTaskSession, stopTaskSession,
  fetchRoutineSessions, pauseRoutineSession, resumeRoutineSession, stopRoutineSession,
  reportApiError,
} from './api'
import type { Project, Quest, Area, ActiveSession, Profile } from './types'
import { parseIsoAsUtc, sumClosedSessionsSeconds, formatHMS } from './utils/datetime'
import { SessionHistoryModal } from './components/SessionHistoryModal'
import { DashboardView } from './pages/DashboardPage'
import { DiaView } from './pages/DiaPage'
import { CalendarView } from './pages/CalendarPage'
import { QuestsView } from './pages/QuestsPage'
import { AreasView, AreaDetailRoute } from './pages/AreasPage'
import { RoutinesView } from './pages/RoutinesPage'
import { TasksView } from './pages/TasksPage'
import { MicroDumpView } from './pages/MicroDumpPage'
import { ArquivadosView } from './pages/ArquivadosPage'
import { HubFinanceLayout } from './pages/finance/HubFinanceLayout'
import { VisaoGeralPage } from './pages/finance/VisaoGeralPage'
import { CarteiraPage } from './pages/finance/CarteiraPage'
import { LancamentosPage } from './pages/finance/LancamentosPage'
import { FixasPage } from './pages/finance/FixasPage'
import { DividasPage } from './pages/finance/DividasPage'
import { FreelasPage } from './pages/finance/FreelasPage'
import { CategoriasPage } from './pages/finance/CategoriasPage'

const NAV: { path: string; label: string; Icon: React.FC<{ size?: number; strokeWidth?: number }> }[] = [
  { path: '/dashboard',   label: 'Dashboard',       Icon: LayoutDashboard },
  { path: '/dia',         label: 'Dia',             Icon: Sun             },
  { path: '/calendario',  label: 'Calendário',      Icon: CalendarDays    },
  { path: '/quests',      label: 'Quests',          Icon: Crosshair       },
  { path: '/areas',       label: 'Áreas',           Icon: Folders         },
  { path: '/rotinas',     label: 'Rotinas',         Icon: Repeat          },
  { path: '/tarefas',     label: 'Tarefas',         Icon: ListChecks      },
  { path: '/hub-finance', label: 'Finance',         Icon: Wallet          },
  { path: '/micro-dump',  label: 'Dump',            Icon: Lightbulb       },
  { path: '/arquivados',  label: 'Arquivados',      Icon: Archive         },
]

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [projects, setProjects] = useState<Project[]>([])
  const [quests, setQuests] = useState<Quest[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [profile, setProfile] = useState<Profile>({ name: '', role: '', avatar_url: '' })
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
  const [sessionUpdateTrigger, setSessionUpdateTrigger] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('hq-sidebar-collapsed')
    return saved ? JSON.parse(saved) : false
  })
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null)
  const [bannerTimer, setBannerTimer] = useState(0)
  const [bannerClosedSec, setBannerClosedSec] = useState(0)
  const [isHydrated, setIsHydrated] = useState(false)
  const [bannerHistoryOpen, setBannerHistoryOpen] = useState(false)
  const [bannerHistorySessions, setBannerHistorySessions] = useState<{ started_at: string; ended_at: string | null }[]>([])

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

  // Mark as hydrated and fetch active session on mount
  useEffect(() => {
    setIsHydrated(true)
    refreshActiveSession()
  }, [])

  // Fetch active session + refresh quests/projects when update is triggered
  useEffect(() => {
    refreshActiveSession()
    fetchQuests().then(setQuests).catch(err => reportApiError('App', err))
    fetchProjects().then(setProjects).catch(err => reportApiError('App', err))
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
        : fetchRoutineSessions(id, activeSession.routine_date ?? undefined)
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
    localStorage.setItem('hq-sidebar-collapsed', JSON.stringify(sidebarCollapsed))
  }, [sidebarCollapsed])

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
    fetchQuests().then(setQuests).catch(err => reportApiError('App', err))
    fetchProjects().then(setProjects).catch(err => reportApiError('App', err))
    fetchAreas().then(setAreas).catch(err => reportApiError('App', err))
    fetchProfile().then(setProfile).catch(err => reportApiError('App', err))

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

  // Refetch quests+projects when entering /quests (URL-driven)
  useEffect(() => {
    if (location.pathname.startsWith('/quests')) {
      fetchQuests().then(setQuests).catch(err => reportApiError('App', err))
      fetchProjects().then(setProjects).catch(err => reportApiError('App', err))
    }
  }, [location.pathname])

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
      } else if (path !== '/dia') {
        navigate('/dia')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [location.pathname, navigate])

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        className="hq-grain"
        style={{
          position: 'fixed', left: 0, top: 0, bottom: 0,
          width: sidebarCollapsed ? 72 : 220,
          flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          padding: 'var(--space-4) 0 var(--space-3)',
          display: 'flex', flexDirection: 'column',
          background: 'rgba(8, 8, 10, 0.55)',
          backdropFilter: 'blur(24px) saturate(140%)',
          WebkitBackdropFilter: 'blur(24px) saturate(140%)',
          transition: 'width var(--motion-base) var(--ease-emphasis)',
          height: '100vh', overflowY: 'auto', overflowX: 'hidden',
          zIndex: 100, boxSizing: 'border-box',
        }}
      >
        {/* Header: logo + toggle inline */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: sidebarCollapsed ? '0 var(--space-3)' : '0 var(--space-3) 0 var(--space-4)',
          marginBottom: 'var(--space-6)',
          gap: 'var(--space-2)',
          minHeight: 36,
        }}>
          {sidebarCollapsed ? (
            // Collapsed: só o toggle centralizado, logo some (a aside fica icon-only)
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="hq-icon-btn-bare"
              title="Expandir menu"
              aria-label="Expandir menu"
              style={{ margin: '0 auto' }}
            >
              <PanelLeftOpen size={16} strokeWidth={1.8} />
            </button>
          ) : (
            <>
              <img
                src="/hub-quest-mark.svg"
                alt=""
                style={{ width: 28, height: 28, opacity: 0.9, flexShrink: 0 }}
              />
              <span style={{
                fontSize: 'var(--text-xs)',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: 'var(--color-text-secondary)',
                fontWeight: 700,
                flex: 1,
              }}>
                HUB QUEST
              </span>
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="hq-icon-btn-bare"
                title="Recolher menu"
                aria-label="Recolher menu"
              >
                <PanelLeftClose size={14} strokeWidth={1.8} />
              </button>
            </>
          )}
        </div>

        {/* Nav items — com stagger entrance */}
        <nav className="hq-stagger" style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: '0 var(--space-2)',
        }}>
          {NAV.map((n, i) => (
            <NavLink
              key={n.path}
              to={n.path}
              title={sidebarCollapsed ? n.label : undefined}
              className="hq-animate-fade-up"
              style={({ isActive }) => ({
                position: 'relative',
                background: isActive ? 'var(--glass-bg-elevated)' : 'transparent',
                border: '1px solid transparent',
                cursor: 'pointer',
                textAlign: 'left',
                padding: sidebarCollapsed ? '10px' : '9px 12px',
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                fontSize: 'var(--text-sm)',
                fontWeight: isActive ? 600 : 500,
                borderRadius: 'var(--radius-sm)',
                transition: 'background var(--motion-fast) var(--ease-smooth), color var(--motion-fast) var(--ease-smooth), border-color var(--motion-fast) var(--ease-smooth)',
                display: 'flex',
                alignItems: 'center',
                gap: sidebarCollapsed ? 0 : 'var(--space-3)',
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                textDecoration: 'none',
                ['--stagger-i' as any]: i,
              })}
              onMouseEnter={e => {
                if (!e.currentTarget.classList.contains('active')) {
                  e.currentTarget.style.background = 'var(--glass-bg-hover)'
                  e.currentTarget.style.color = 'var(--color-text-primary)'
                }
              }}
              onMouseLeave={e => {
                if (!e.currentTarget.classList.contains('active')) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--color-text-tertiary)'
                }
              }}
            >
              {({ isActive }) => (
                <>
                  {/* Indicator: chrome shimmer sutil quando ativo (não mais barra vermelha) */}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        left: -1, top: '22%', bottom: '22%',
                        width: 2,
                        background: 'var(--chrome-grad)',
                        borderRadius: 'var(--radius-pill)',
                        boxShadow: '0 0 8px rgba(201, 204, 210, 0.4)',
                      }}
                    />
                  )}
                  <n.Icon
                    size={17}
                    strokeWidth={isActive ? 1.6 : 1.25}
                  />
                  {!sidebarCollapsed && (
                    <span style={{ flex: 1 }}>{n.label}</span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Spacer pra empurrar versão pro fim — bottom mark sutil */}
        <div style={{ flex: 1 }} />
        {!sidebarCollapsed && (
          <div style={{
            padding: '0 var(--space-4)',
            fontSize: 9,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.1em',
            opacity: 0.6,
          }}>
            v0.2.0
          </div>
        )}
      </aside>

      {isHydrated && activeSession && (
        <div
          className="hq-animate-fade-down hq-grain hq-chrome-hairline"
          style={{
            position: 'fixed', top: 0,
            left: sidebarCollapsed ? 72 : 220,
            right: 0,
            height: 64,
            background: 'rgba(8, 8, 10, 0.65)',
            backdropFilter: 'blur(20px) saturate(140%)',
            WebkitBackdropFilter: 'blur(20px) saturate(140%)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex', alignItems: 'center',
            gap: 'var(--space-5)',
            padding: '0 var(--space-6)',
            transition: 'left var(--motion-base) var(--ease-emphasis)',
            zIndex: 99,
          }}
        >
          {/* Status dot pulsante */}
          <div
            className={activeSession.is_active ? 'hq-pulse-dot' : 'hq-pulse-dot hq-pulse-dot--success'}
            aria-hidden="true"
          />

          {/* Session info — compacto */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              fontSize: 'var(--text-xs)',
              color: activeSession.is_active ? 'var(--color-accent-light)' : 'var(--color-success-light)',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}>
              <span>{activeSession.is_active ? 'ao vivo' : 'pausado'}</span>
              <span style={{
                fontSize: 9, padding: '1px 6px',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--glass-bg)',
                color: 'var(--color-text-tertiary)',
                border: '1px solid var(--color-border)',
                letterSpacing: '0.08em',
              }}>
                {activeSession.type}
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
                const loader = activeSession.type === 'quest'
                  ? fetchSessions(activeSession.id)
                  : activeSession.type === 'task'
                    ? fetchTaskSessions(activeSession.id)
                    : fetchRoutineSessions(activeSession.id)
                const list = await loader
                setBannerHistorySessions(
                  (list as any[]).map(s => ({
                    started_at: s?.started_at ?? '',
                    ended_at: s?.ended_at ?? null,
                  }))
                )
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
            }}
          >
            <span style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 700,
              color: activeSession.is_active
                ? 'var(--color-text-primary)'
                : 'var(--color-text-secondary)',
              lineHeight: 1,
              letterSpacing: '-0.02em',
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
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
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
                const call = is_active
                  ? (type === 'quest' ? pauseSession(id) : type === 'task' ? pauseTaskSession(id) : pauseRoutineSession(id, target))
                  : (type === 'quest' ? resumeSession(id) : type === 'task' ? resumeTaskSession(id) : resumeRoutineSession(id, target))
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
                }

                const clearBanner = () => {
                  setActiveSession(null)
                  saveFocusedEntity(null)
                  onSessionUpdate()
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
      )}

      {bannerHistoryOpen && (
        <SessionHistoryModal
          sessions={bannerHistorySessions}
          onClose={() => setBannerHistoryOpen(false)}
        />
      )}

      <main style={{
        flex: 1,
        padding: location.pathname.startsWith('/calendario') ? '24px 32px' : '48px 60px',
        maxWidth: '100%',
        marginLeft: sidebarCollapsed ? 72 : 220,
        marginTop: (isHydrated && activeSession) ? 64 : 0,
        transition: 'margin-top var(--motion-base) var(--ease-emphasis), margin-left var(--motion-base) var(--ease-emphasis)',
        minHeight: '100vh',
        background: 'transparent',
      }}>
        {/* Wrapper com key={pathname} re-anima conteúdo a cada navegação.
            Usa fade-in (só opacity, SEM transform) pra não quebrar
            `position: fixed` de modais filhos — transform num ancestral
            redefine o containing block. Cards individuais continuam com
            fade-up porque estão isolados na árvore. */}
        <div key={location.pathname} className="hq-animate-fade-in">
        <Routes>
          <Route path="/" element={<Navigate to="/dia" replace />} />
          <Route path="/dashboard" element={<DashboardView projects={projects} quests={quests} areas={areas} profile={profile} onProfileUpdate={setProfile} onSelectProject={setSelectedProjectId} />} />
          <Route path="/dia" element={<DiaView projects={projects} quests={quests} areas={areas} activeSession={activeSession} onSessionUpdate={onSessionUpdate} onSelectProject={setSelectedProjectId} />} />
          <Route path="/calendario" element={<CalendarView projects={projects} quests={quests} areas={areas} sessionUpdateTrigger={sessionUpdateTrigger} onSessionUpdate={onSessionUpdate} />} />
          <Route path="/quests" element={<QuestsView projects={projects} quests={quests} areas={areas} onSessionUpdate={onSessionUpdate} sessionUpdateTrigger={sessionUpdateTrigger} onQuestUpdate={(id, patch) => {
            setQuests(qs => qs.map(q => q.id === id ? { ...q, ...patch } : q))
            patchQuest(id, patch)
              .then(() => {
                // Backend fecha sessão aberta ao mover status pra terminal —
                // refresca o estado da sessão ativa pro banner sumir.
                if ('status' in patch) onSessionUpdate()
              })
              .catch(err => reportApiError('App', err))
          }} />} />
          <Route path="/rotinas" element={<RoutinesView />} />
          <Route path="/tarefas" element={<TasksView activeSession={activeSession} onSessionUpdate={onSessionUpdate} sessionUpdateTrigger={sessionUpdateTrigger} />} />
          {/* Hub Finance — layout com sub-rotas (visão geral, lançamentos, etc).
              `/hub-finance` redireciona pra `/hub-finance/visao-geral`. */}
          <Route path="/hub-finance" element={<HubFinanceLayout />}>
            <Route index element={<Navigate to="visao-geral" replace />} />
            <Route path="visao-geral" element={<VisaoGeralPage />} />
            <Route path="carteira" element={<CarteiraPage />} />
            <Route path="fixas" element={<FixasPage />} />
            <Route path="dividas" element={<DividasPage />} />
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
                setProjects(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p))
                patchProject(id, patch)
                  .then(() => {
                    // Arquivar/desarquivar um projeto muda quais quests o
                    // backend devolve em /api/quests (filtra por archived_at
                    // do projeto pai). Refetch pra o state global sair de
                    // sincronia ou continuar sincronizado sem F5.
                    if ('archived_at' in patch) {
                      fetchQuests().then(setQuests).catch(err => reportApiError('App', err))
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
          <Route path="*" element={<Navigate to="/dia" replace />} />
        </Routes>
        </div>
      </main>
    </div>
  )
}

