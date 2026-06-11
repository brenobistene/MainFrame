/**
 * DashboardRetroPanel — widget de retrospectiva no /dashboard.
 *
 * "PROJECT.MATRIX mostra ESTADO presente, RETROSPECTIVE mostra MOVIMENTO":
 * o que se mexeu na janela escolhida (semana / mês / trimestre civil).
 *
 *   - POR ÁREA: barras horizontais com tempo investido por área.
 *     Fonte: /api/time-reports/by-area.
 *   - FECHADOS: quests agrupadas por projeto + rotinas com expand/collapse.
 *     Fonte: /api/time-reports/closed-items.
 *
 * Períodos são FIXOS (não rolling N-days):
 *   - SEMANA → segunda atual → domingo
 *   - MÊS → dia 1 → último dia do mês corrente
 *   - TRIMESTRE → primeiro dia do trimestre civil → último
 *
 * Estética: Panel CP2077 do dashboard — hq-brackets-full + title bar com
 * pulse-square + tech-label `//`, chamfer-bl outer, glass-elevated panels
 * internos, rows com hq-row-hoverable. Sem invenção própria — reusa o
 * vocabulário visual de BuildDashboardCard / RitualsPanel.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Activity, CheckCircle2, FolderOpen, RotateCw, CheckSquare } from 'lucide-react'

import { get } from '../api'

// ─── Tipos ────────────────────────────────────────────────────────────────

type ByAreaItem = {
  kind: 'area' | 'task' | 'routine' | 'library'
  slug: string
  label: string
  color: string | null
  minutes: number
}

type ByAreaResponse = {
  from: string
  to: string
  total_minutes: number
  items: ByAreaItem[]
}

type ClosedQuest = {
  id: string
  title: string
  area_slug: string | null
  area_name: string | null
  area_color: string | null
  completed_at: string
  status?: string
  worked_min: number
}

type ClosedProjectGroup = {
  id: string
  title: string
  area_slug: string | null
  area_name: string | null
  area_color: string | null
  completed_at: string | null
  quests: ClosedQuest[]
  worked_min_total: number
}

type ClosedRoutine = {
  id: string
  title: string
  completions: { date: string; worked_min: number }[]
  total_min: number
}

type ClosedTask = {
  id: string
  title: string
  completed_at: string
  worked_min: number
}

type ClosedItemsResponse = {
  from: string
  to: string
  projects: ClosedProjectGroup[]
  ungrouped_quests: ClosedQuest[]
  routines: ClosedRoutine[]
  tasks: ClosedTask[]
  totals: {
    quests_done: number
    projects_done: number
    routines_completions: number
    tasks_done: number
  }
}

type Period = 'dia' | 'semana' | 'mes' | 'trimestre'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'dia', label: 'DIA' },
  { value: 'semana', label: 'SEMANA' },
  { value: 'mes', label: 'MÊS' },
  { value: 'trimestre', label: 'TRIMESTRE' },
]

const ROUTINE_ACCENT = '#9b88c4'
const ICE = 'var(--color-ice)'
const ICE_LIGHT = 'var(--color-ice-light)'
const ICE_DEEP = 'var(--color-ice-deep)'

// ─── Helpers ──────────────────────────────────────────────────────────────

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Range FIXO baseado em calendário civil (não rolling N days):
 *   - dia       → hoje (from=to)
 *   - semana    → segunda atual → domingo da mesma semana
 *   - mes       → dia 1 do mês corrente → último dia
 *   - trimestre → primeiro dia do trimestre civil (Q1/Q2/Q3/Q4) → último dia
 */
function rangeFor(period: Period): { from: string; to: string } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (period === 'dia') {
    const iso = localYmd(today)
    return { from: iso, to: iso }
  }
  if (period === 'semana') {
    const dow = today.getDay()
    const daysSinceMonday = dow === 0 ? 6 : dow - 1
    const monday = new Date(today)
    monday.setDate(today.getDate() - daysSinceMonday)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { from: localYmd(monday), to: localYmd(sunday) }
  }
  if (period === 'mes') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1)
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    return { from: localYmd(first), to: localYmd(last) }
  }
  const quarter = Math.floor(today.getMonth() / 3)
  const first = new Date(today.getFullYear(), quarter * 3, 1)
  const last = new Date(today.getFullYear(), quarter * 3 + 3, 0)
  return { from: localYmd(first), to: localYmd(last) }
}

function fmtMin(m: number): string {
  const abs = Math.max(0, Math.round(m))
  if (abs < 60) return `${abs}m`
  const h = Math.floor(abs / 60)
  const rest = abs % 60
  return rest > 0 ? `${h}h${rest}m` : `${h}h`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = iso.length >= 10 ? iso.slice(0, 10) : iso
  const [y, m, d] = s.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}`
}

const MES_LABEL = [
  'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
]
function periodLabel(period: Period): string {
  const today = new Date()
  if (period === 'dia') return 'HOJE'
  if (period === 'semana') return 'ESTA SEMANA'
  if (period === 'mes') return `${MES_LABEL[today.getMonth()]} · ${today.getFullYear()}`
  const q = Math.floor(today.getMonth() / 3) + 1
  return `T${q} · ${today.getFullYear()}`
}

function periodIdTag(period: Period): string {
  const today = new Date()
  if (period === 'dia') {
    return `D-${String(today.getDate()).padStart(2, '0')}`
  }
  if (period === 'semana') {
    // ISO week number (segunda como início) — formato `WK-NN`
    const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
    const dayNum = d.getUTCDay() || 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum)
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
    return `WK-${String(weekNo).padStart(2, '0')}`
  }
  if (period === 'mes') return `M-${String(today.getMonth() + 1).padStart(2, '0')}`
  const q = Math.floor(today.getMonth() / 3) + 1
  return `Q-${q}`
}

// ─── Componente principal ────────────────────────────────────────────────

export function DashboardRetroPanel({
  collapsed,
  onToggle,
  onSelectProject,
}: {
  collapsed: boolean
  onToggle: () => void
  onSelectProject?: (id: string) => void
}) {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<Period>('semana')
  const [byArea, setByArea] = useState<ByAreaResponse | null>(null)
  const [closed, setClosed] = useState<ClosedItemsResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const range = useMemo(() => rangeFor(period), [period])

  useEffect(() => {
    if (collapsed) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      get<ByAreaResponse>(`/api/time-reports/by-area?from=${range.from}&to=${range.to}`),
      get<ClosedItemsResponse>(`/api/time-reports/closed-items?from=${range.from}&to=${range.to}`),
    ])
      .then(([a, c]) => {
        if (cancelled) return
        setByArea(a)
        setClosed(c)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [range.from, range.to, collapsed])

  const totalCount = useMemo(() => {
    if (!closed) return 0
    return (
      closed.projects.length +
      closed.ungrouped_quests.length +
      closed.routines.length +
      closed.tasks.length
    )
  }, [closed])
  const totalWorked = byArea?.total_minutes ?? 0

  return (
    <section style={{ marginBottom: 32 }}>
      {/* Panel CP2077 — hq-brackets-full (cantos com glow) + radial gradients
          + chamfer-bl. Mesma assinatura visual dos painéis de /Build. */}
      <div
        className="hq-brackets-full"
        style={{
          position: 'relative',
          border: `1px solid ${ICE_DEEP}`,
          background: `
            radial-gradient(ellipse 60% 100% at 50% 0%, rgba(143, 191, 211, 0.05), transparent 70%),
            radial-gradient(ellipse 80% 60% at 50% 100%, rgba(40, 50, 57, 0.25), transparent 70%),
            rgba(8, 12, 18, 0.65)
          `,
          color: ICE,
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)',
        }}
      >
        {/* TITLE BAR — faixa solid com pulse-square + tech-label + chevron */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          style={{
            width: '100%',
            padding: '8px 16px',
            borderBottom: collapsed ? 'none' : `1px solid ${ICE_DEEP}`,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(40, 50, 57, 0.45)',
            cursor: 'pointer',
            border: 'none',
            color: 'inherit',
            textAlign: 'left',
            transition: 'background var(--motion-fast) var(--ease-smooth)',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(40, 50, 57, 0.45)')}
        >
          <div
            aria-hidden="true"
            style={{
              width: 8, height: 8,
              background: ICE,
              boxShadow: '0 0 8px var(--color-ice-glow)',
              flexShrink: 0,
            }}
          />
          <span
            className="hq-tech-label"
            style={{
              color: ICE_LIGHT,
              letterSpacing: '0.28em',
              fontSize: 10,
            }}
          >
            RETROSPECTIVE
          </span>
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)', marginLeft: 'auto', marginRight: 8 }}
          >
            ID#{periodIdTag(period)} · {totalCount} ITEMS · {fmtMin(totalWorked)}
          </span>
          <ChevronDown
            size={12}
            strokeWidth={2}
            color={ICE_LIGHT}
            style={{
              transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              transition: 'transform var(--motion-base) var(--ease-emphasis)',
              flexShrink: 0,
            }}
          />
        </button>

        {/* CONTENT — collapse via grid-template-rows 0fr → 1fr */}
        <div
          style={{
            display: 'grid',
            gridTemplateRows: collapsed ? '0fr' : '1fr',
            opacity: collapsed ? 0 : 1,
            transition: 'opacity var(--motion-base) var(--ease-emphasis), grid-template-rows var(--motion-base) var(--ease-emphasis)',
          }}
        >
          <div style={{ overflow: 'hidden', minHeight: 0 }}>
            <div style={{ padding: '18px 22px 22px' }}>
              {/* Hairline ice no topo do conteúdo */}
              <div
                aria-hidden="true"
                className="hq-hairline-ice"
                style={{ marginBottom: 16 }}
              />

              {/* Tabs de período (pílulas angulares) + range label */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 10,
                marginBottom: 18,
              }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {PERIODS.map(p => (
                    <PeriodTab
                      key={p.value}
                      active={p.value === period}
                      onClick={() => setPeriod(p.value)}
                      label={p.label}
                    />
                  ))}
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 12,
                }}>
                  <span
                    className="hq-tech-label"
                    style={{ color: ICE_LIGHT, letterSpacing: '0.22em' }}
                  >
                    {periodLabel(period)}
                  </span>
                  <span
                    className="hq-tech-id"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {fmtDate(range.from)} → {fmtDate(range.to)}
                  </span>
                </div>
              </div>

              {/* Grid dos widgets */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                gap: 18,
              }}>
                <ByAreaWidget data={byArea} loading={loading} />
                <ClosedItemsWidget
                  data={closed}
                  loading={loading}
                  onOpenProject={(id, areaSlug) => {
                    if (onSelectProject) onSelectProject(id)
                    navigate(`/areas/${areaSlug}`)
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Period tab (pílula angular) ─────────────────────────────────────────

function PeriodTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 14px',
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: active ? ICE_LIGHT : 'var(--color-text-tertiary)',
        background: active ? 'rgba(143, 191, 211, 0.12)' : 'rgba(8, 12, 18, 0.55)',
        border: `1px solid ${active ? 'rgba(143, 191, 211, 0.55)' : 'var(--color-border)'}`,
        borderRadius: 0,
        clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all 0.15s',
        boxShadow: active ? '0 0 12px rgba(143, 191, 211, 0.22)' : 'none',
      }}
    >
      {label}
    </button>
  )
}

// ─── Widget: Por Área ────────────────────────────────────────────────────

function ByAreaWidget({ data, loading }: { data: ByAreaResponse | null; loading: boolean }) {
  const max = useMemo(
    () => (data?.items ?? []).reduce((m, x) => Math.max(m, x.minutes), 0),
    [data],
  )

  return (
    <WidgetFrame>
      <WidgetHeader icon={<Activity size={11} strokeWidth={2} />} label="POR ÁREA" />
      {loading ? (
        <SkeletonRows count={4} />
      ) : !data || data.items.length === 0 ? (
        <EmptyMsg text="Nenhum tempo investido nesse período." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.items.map(item => {
            const pct = max > 0 ? (item.minutes / max) * 100 : 0
            const color = item.color || '#7fb8a8'
            return (
              <div key={`${item.kind}:${item.slug}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                }}>
                  <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
                    <span aria-hidden="true" style={{
                      display: 'inline-block',
                      width: 6, height: 6,
                      background: color,
                      boxShadow: `0 0 6px ${color}88`,
                      transform: 'translateY(-1px)',
                    }} />
                    <span style={{ color: 'var(--color-text-primary)' }}>{item.label}</span>
                    {item.kind !== 'area' && (
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 8, letterSpacing: '0.08em' }}>
                        · {item.kind === 'task' ? 'TSK' : item.kind === 'routine' ? 'RTN' : 'LIB'}
                      </span>
                    )}
                  </span>
                  <span style={{
                    color,
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: 0,
                  }}>
                    {fmtMin(item.minutes)}
                  </span>
                </div>
                {/* Bar com chamfer + scan animation sutil */}
                <div style={{
                  position: 'relative',
                  height: 5,
                  background: 'rgba(8, 12, 18, 0.7)',
                  border: '1px solid var(--color-border)',
                  overflow: 'hidden',
                  clipPath: 'polygon(0 0, 100% 0, calc(100% - 3px) 100%, 0 100%)',
                }}>
                  <div style={{
                    position: 'absolute',
                    left: 0, top: 0, bottom: 0,
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${color}cc 0%, ${color}66 100%)`,
                    boxShadow: `0 0 8px ${color}55, inset 0 1px 0 ${color}aa`,
                    transition: 'width var(--motion-base) var(--ease-emphasis)',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </WidgetFrame>
  )
}

// ─── Widget: Fechados ────────────────────────────────────────────────────

function ClosedItemsWidget({
  data,
  loading,
  onOpenProject,
}: {
  data: ClosedItemsResponse | null
  loading: boolean
  onOpenProject: (projectId: string, areaSlug: string) => void
}) {
  const totals = data?.totals
  const isEmpty = !data || (
    data.projects.length === 0 &&
    data.ungrouped_quests.length === 0 &&
    data.routines.length === 0 &&
    data.tasks.length === 0
  )

  return (
    <WidgetFrame>
      <WidgetHeader
        icon={<CheckCircle2 size={11} strokeWidth={2} />}
        label="FECHADOS"
        right={
          totals ? (
            <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
              P{totals.projects_done} · Q{totals.quests_done} · R{totals.routines_completions} · T{totals.tasks_done}
            </span>
          ) : null
        }
      />
      {loading ? (
        <SkeletonRows count={4} />
      ) : isEmpty ? (
        <EmptyMsg text="Nada fechado nesse período." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto', paddingRight: 4 }}>
          {/* Projects — cada projeto já é um grupo expandível (quests dentro) */}
          {data!.projects.map(p => (
            <ProjectGroupRow key={`prj:${p.id}`} project={p} onOpen={onOpenProject} />
          ))}
          {/* Quests sem projeto pai — agrupadas sob "QUESTS AVULSAS" pra
              paridade visual com os grupos PRJ/RTN/TSK */}
          {data!.ungrouped_quests.length > 0 && (
            <UngroupedQuestsGroup quests={data!.ungrouped_quests} />
          )}
          {/* Rotinas — um único grupo "ROTINAS" expandível; dentro, cada
              rotina ainda tem expand pra ver as completions diárias */}
          {data!.routines.length > 0 && (
            <RoutinesGroup routines={data!.routines} />
          )}
          {/* Tasks — um único grupo "TASKS" expandível */}
          {data!.tasks.length > 0 && (
            <TasksGroup tasks={data!.tasks} />
          )}
        </div>
      )}
    </WidgetFrame>
  )
}

// ─── Group: Project ──────────────────────────────────────────────────────

function ProjectGroupRow({
  project,
  onOpen,
}: {
  project: ClosedProjectGroup
  onOpen: (projectId: string, areaSlug: string) => void
}) {
  const [open, setOpen] = useState(false)
  const accent = project.area_color || '#7fb8a8'
  const hasChildren = project.quests.length > 0
  const projectDone = !!project.completed_at

  return (
    <div
      className="hq-chamfer-bl"
      style={{
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid var(--color-border)',
        borderLeft: `2px solid ${accent}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          disabled={!hasChildren}
          style={{
            background: 'none',
            border: 'none',
            cursor: hasChildren ? 'pointer' : 'default',
            color: hasChildren ? 'var(--color-text-tertiary)' : 'transparent',
            padding: 0,
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          {open ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
        </button>
        <FolderOpen size={11} strokeWidth={2} color={accent} style={{ flexShrink: 0 }} />
        <span
          className="hq-tech-id"
          style={{ color: accent, letterSpacing: '0.18em', flexShrink: 0 }}
        >
          PRJ
        </span>
        <div
          onClick={() => project.area_slug && onOpen(project.id, project.area_slug)}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            cursor: project.area_slug ? 'pointer' : 'default',
          }}
        >
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            letterSpacing: '0.02em',
          }}>
            {project.title}
            {projectDone && (
              <span style={{
                marginLeft: 10,
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.18em',
                color: 'var(--color-success, #6acdb0)',
              }}>
                · DONE
              </span>
            )}
          </div>
          <div className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
            {project.area_name && (
              <span style={{ color: accent, marginRight: 8 }}>{project.area_name.toUpperCase()}</span>
            )}
            <span>{project.quests.length} QST</span>
            {projectDone && project.completed_at && (
              <span> · {fmtDate(project.completed_at)}</span>
            )}
          </div>
        </div>
        {project.worked_min_total > 0 && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
            color: accent,
            letterSpacing: 0,
            fontVariantNumeric: 'tabular-nums',
            flexShrink: 0,
          }}>
            {fmtMin(project.worked_min_total)}
          </span>
        )}
      </div>
      {open && hasChildren && (
        <div style={{
          padding: '0 12px 8px 38px',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}>
          {project.quests.map(q => (
            <ChildRow
              key={`q:${q.id}`}
              kind="QST"
              accent={q.area_color || accent}
              title={q.title}
              meta={fmtDate(q.completed_at)}
              workedMin={q.worked_min}
              strike={q.status === 'cancelled'}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Type-group wrappers (TASKS, ROTINAS, QUESTS AVULSAS) ────────────────

function TypeGroupWrapper({
  icon,
  badge,
  badgeAccent,
  title,
  count,
  countLabel,
  totalMin,
  children,
}: {
  icon: React.ReactNode
  badge: string
  badgeAccent: string
  title: string
  count: number
  countLabel: string
  totalMin: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="hq-chamfer-bl"
      style={{
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid var(--color-border)',
        borderLeft: `2px solid ${badgeAccent}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-tertiary)',
            padding: 0,
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          {open ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
        </button>
        {icon}
        <span className="hq-tech-id" style={{ color: badgeAccent, letterSpacing: '0.18em', flexShrink: 0 }}>
          {badge}
        </span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            letterSpacing: '0.02em',
          }}>
            {title}
          </div>
          <div className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
            {count} {countLabel}
          </div>
        </div>
        {totalMin > 0 && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
            color: badgeAccent,
            letterSpacing: 0,
            fontVariantNumeric: 'tabular-nums',
            flexShrink: 0,
          }}>
            {fmtMin(totalMin)}
          </span>
        )}
      </div>
      {open && (
        <div style={{
          padding: '0 10px 8px 36px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          {children}
        </div>
      )}
    </div>
  )
}

function UngroupedQuestsGroup({ quests }: { quests: ClosedQuest[] }) {
  const totalMin = quests.reduce((s, q) => s + q.worked_min, 0)
  return (
    <TypeGroupWrapper
      icon={<CheckCircle2 size={11} strokeWidth={2} color="#7fb8a8" style={{ flexShrink: 0 }} />}
      badge="QST"
      badgeAccent="#7fb8a8"
      title="Quests avulsas"
      count={quests.length}
      countLabel={`quest${quests.length === 1 ? '' : 's'} sem projeto`}
      totalMin={totalMin}
    >
      {quests.map(q => <QuestStandaloneRow key={`uq:${q.id}`} quest={q} nested />)}
    </TypeGroupWrapper>
  )
}

function RoutinesGroup({ routines }: { routines: ClosedRoutine[] }) {
  const totalMin = routines.reduce((s, r) => s + r.total_min, 0)
  const totalDays = routines.reduce((s, r) => s + r.completions.length, 0)
  return (
    <TypeGroupWrapper
      icon={<RotateCw size={11} strokeWidth={2} color={ROUTINE_ACCENT} style={{ flexShrink: 0 }} />}
      badge="RTN"
      badgeAccent={ROUTINE_ACCENT}
      title="Rotinas"
      count={routines.length}
      countLabel={`rotina${routines.length === 1 ? '' : 's'} · ${totalDays} dia${totalDays === 1 ? '' : 's'}`}
      totalMin={totalMin}
    >
      {routines.map(r => <RoutineGroupRow key={`rt:${r.id}`} routine={r} nested />)}
    </TypeGroupWrapper>
  )
}

function TasksGroup({ tasks }: { tasks: ClosedTask[] }) {
  const totalMin = tasks.reduce((s, t) => s + t.worked_min, 0)
  return (
    <TypeGroupWrapper
      icon={<CheckSquare size={11} strokeWidth={2} color="var(--color-text-tertiary)" style={{ flexShrink: 0 }} />}
      badge="TSK"
      badgeAccent="var(--color-text-tertiary)"
      title="Tarefas"
      count={tasks.length}
      countLabel={`tarefa${tasks.length === 1 ? '' : 's'}`}
      totalMin={totalMin}
    >
      {tasks.map(t => <TaskStandaloneRow key={`tsk:${t.id}`} task={t} nested />)}
    </TypeGroupWrapper>
  )
}

// ─── Group: Routine ──────────────────────────────────────────────────────

function RoutineGroupRow({ routine, nested }: { routine: ClosedRoutine; nested?: boolean }) {
  const [open, setOpen] = useState(false)
  const accent = ROUTINE_ACCENT
  const hasChildren = routine.completions.length > 0

  return (
    <div
      className={nested ? undefined : 'hq-chamfer-bl'}
      style={{
        background: nested ? 'transparent' : 'rgba(8, 12, 18, 0.55)',
        border: nested ? 'none' : '1px solid var(--color-border)',
        borderLeft: `${nested ? 1 : 2}px solid ${nested ? `${accent}55` : accent}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          disabled={!hasChildren}
          style={{
            background: 'none',
            border: 'none',
            cursor: hasChildren ? 'pointer' : 'default',
            color: hasChildren ? 'var(--color-text-tertiary)' : 'transparent',
            padding: 0,
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          {open ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
        </button>
        <RotateCw size={11} strokeWidth={2} color={accent} style={{ flexShrink: 0 }} />
        <span
          className="hq-tech-id"
          style={{ color: accent, letterSpacing: '0.18em', flexShrink: 0 }}
        >
          RTN
        </span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            letterSpacing: '0.02em',
          }}>
            {routine.title}
          </div>
          <div className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
            {routine.completions.length}d
          </div>
        </div>
        {routine.total_min > 0 && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
            color: accent,
            letterSpacing: 0,
            fontVariantNumeric: 'tabular-nums',
            flexShrink: 0,
          }}>
            {fmtMin(routine.total_min)}
          </span>
        )}
      </div>
      {open && hasChildren && (
        <div style={{
          padding: '0 12px 8px 38px',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}>
          {routine.completions.map((c, i) => (
            <ChildRow
              key={`c:${routine.id}:${i}`}
              kind=""
              accent={accent}
              title={fmtDate(c.date)}
              meta={null}
              workedMin={c.worked_min}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Standalone rows ─────────────────────────────────────────────────────

function QuestStandaloneRow({ quest, nested }: { quest: ClosedQuest; nested?: boolean }) {
  const accent = quest.area_color || '#7fb8a8'
  return (
    <div
      className={nested ? undefined : 'hq-chamfer-bl'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: nested ? '4px 8px' : '8px 10px',
        background: nested ? 'transparent' : 'rgba(8, 12, 18, 0.55)',
        border: nested ? 'none' : '1px solid var(--color-border)',
        borderLeft: `${nested ? 1 : 2}px solid ${nested ? `${accent}55` : accent}`,
      }}
    >
      {!nested && <span style={{ width: 14, flexShrink: 0 }} />}
      <span
        className="hq-tech-id"
        style={{ color: accent, letterSpacing: '0.18em', flexShrink: 0 }}
      >
        QST
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          letterSpacing: '0.02em',
          textDecoration: quest.status === 'cancelled' ? 'line-through' : 'none',
          opacity: quest.status === 'cancelled' ? 0.6 : 1,
        }}>
          {quest.title}
        </div>
        <div className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
          {quest.area_name && (
            <span style={{ color: accent, marginRight: 8 }}>{quest.area_name.toUpperCase()}</span>
          )}
          <span>{fmtDate(quest.completed_at)}</span>
        </div>
      </div>
      {quest.worked_min > 0 && (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 700,
          color: accent,
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}>
          {fmtMin(quest.worked_min)}
        </span>
      )}
    </div>
  )
}

function TaskStandaloneRow({ task, nested }: { task: ClosedTask; nested?: boolean }) {
  const accent = 'var(--color-text-tertiary)'
  return (
    <div
      className={nested ? undefined : 'hq-chamfer-bl'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: nested ? '4px 8px' : '8px 10px',
        background: nested ? 'transparent' : 'rgba(8, 12, 18, 0.55)',
        border: nested ? 'none' : '1px solid var(--color-border)',
        borderLeft: nested
          ? '1px solid var(--color-border-strong)'
          : '2px solid var(--color-border-strong)',
      }}
    >
      {!nested && <span style={{ width: 14, flexShrink: 0 }} />}
      <CheckSquare size={11} strokeWidth={2} color="var(--color-text-tertiary)" style={{ flexShrink: 0 }} />
      <span
        className="hq-tech-id"
        style={{ color: accent, letterSpacing: '0.18em', flexShrink: 0 }}
      >
        TSK
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          letterSpacing: '0.02em',
        }}>
          {task.title}
        </div>
        <div className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
          {fmtDate(task.completed_at)}
        </div>
      </div>
      {task.worked_min > 0 && (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 700,
          color: accent,
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}>
          {fmtMin(task.worked_min)}
        </span>
      )}
    </div>
  )
}

function ChildRow({
  kind,
  accent,
  title,
  meta,
  workedMin,
  strike,
}: {
  kind: string
  accent: string
  title: string
  meta: string | null
  workedMin: number
  strike?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        borderLeft: `1px solid ${accent}55`,
      }}
    >
      {kind && (
        <span
          className="hq-tech-id"
          style={{ color: accent, letterSpacing: '0.18em', flexShrink: 0 }}
        >
          {kind}
        </span>
      )}
      <span style={{
        flex: 1,
        minWidth: 0,
        fontFamily: kind ? 'var(--font-body)' : 'var(--font-mono)',
        fontSize: kind ? 12 : 11,
        fontWeight: kind ? 500 : 700,
        color: 'var(--color-text-secondary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        textDecoration: strike ? 'line-through' : 'none',
        opacity: strike ? 0.55 : 1,
        letterSpacing: kind ? 0 : '0.05em',
        fontVariantNumeric: kind ? 'normal' : 'tabular-nums',
      }}>
        {title}
      </span>
      {meta && (
        <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
          {meta}
        </span>
      )}
      {workedMin > 0 && (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 700,
          color: accent,
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}>
          {fmtMin(workedMin)}
        </span>
      )}
    </div>
  )
}

// ─── Helpers visuais compartilhados ──────────────────────────────────────

function WidgetFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="hq-glass-elevated hq-chamfer-cross"
      style={{
        padding: '14px 16px',
        minHeight: 220,
        position: 'relative',
      }}
    >
      <div
        aria-hidden="true"
        className="hq-hairline-ice"
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
      />
      {children}
    </div>
  )
}

function WidgetHeader({
  icon,
  label,
  right,
}: {
  icon: React.ReactNode
  label: string
  right?: React.ReactNode
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingBottom: 10,
      marginBottom: 12,
      borderBottom: `1px solid ${ICE_DEEP}`,
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: ICE_LIGHT }}>
        {icon}
        <span className="hq-tech-label" style={{ color: ICE_LIGHT, letterSpacing: '0.24em' }}>
          {label}
        </span>
      </span>
      {right}
    </div>
  )
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="hq-skeleton"
          style={{ height: 32, opacity: 0.7 - i * 0.12 }}
        />
      ))}
    </div>
  )
}

function EmptyMsg({ text }: { text: string }) {
  return (
    <div style={{
      padding: '20px 8px',
      textAlign: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      color: 'var(--color-text-muted)',
      letterSpacing: '0.12em',
      fontStyle: 'italic',
    }}>
      {text}
    </div>
  )
}
