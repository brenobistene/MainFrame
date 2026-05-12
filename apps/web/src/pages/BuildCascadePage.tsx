/**
 * /build/cascade — visão hierárquica meta → projetos → quests.
 *
 * Fecha o loop estratégico: você vê de cima ("essa meta") até embaixo
 * ("essas quests"), e fica claro qual quest serve qual meta. Ajuda na
 * priorização durante revisões e check-ins.
 *
 * Layout:
 *   ▼ Meta 1 (status badge · progresso %)
 *     ▶ Projeto A (área · status)
 *         · Quest 1 (status)
 *         · Quest 2 (status)
 *     ▶ Projeto B
 *   ▼ Meta 2
 *     (sem projetos)
 *
 * Click no chevron expande/colapsa. Click no nome navega pra entidade.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown, ChevronRight, Target, Folder, CircleDot,
} from 'lucide-react'
import {
  fetchBuildGoals, fetchProjectsAlignment, fetchQuests, fetchAreas,
} from '../api'
import type {
  BuildGoal, BuildProjectAlignment, Quest, Area,
} from '../types'
import { PageShell } from '../components/ui/CyberShell'

export function BuildCascadePage() {
  const navigate = useNavigate()
  const [goals, setGoals] = useState<BuildGoal[]>([])
  const [projects, setProjects] = useState<BuildProjectAlignment[]>([])
  const [quests, setQuests] = useState<Quest[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedGoals, setExpandedGoals] = useState<Set<string>>(new Set())
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())

  useEffect(() => {
    Promise.all([
      fetchBuildGoals(),
      fetchProjectsAlignment({ includeArchived: false }),
      fetchQuests(),
      fetchAreas(),
    ]).then(([g, p, q, a]) => {
      setGoals(g.filter(x => x.status === 'ativa'))
      setProjects(p)
      setQuests(q.filter(x => x.status !== 'done' && x.status !== 'cancelled'))
      setAreas(a)
      // Auto-expande primeira meta
      if (g.length > 0) setExpandedGoals(new Set([g[0].id]))
    }).catch(() => {
      // silencioso — UI mostra estado vazio
    }).finally(() => setLoading(false))
  }, [])

  const questsByProject = useMemo(() => {
    const map = new Map<string, Quest[]>()
    for (const q of quests) {
      if (q.project_id) {
        const arr = map.get(q.project_id) ?? []
        arr.push(q)
        map.set(q.project_id, arr)
      }
    }
    return map
  }, [quests])

  const areaByKey = useMemo(
    () => new Map(areas.map(a => [a.slug, a])),
    [areas],
  )

  const projectsByGoal = useMemo(() => {
    const map = new Map<string, BuildProjectAlignment[]>()
    for (const p of projects) {
      for (const gid of p.goal_ids) {
        const arr = map.get(gid) ?? []
        arr.push(p)
        map.set(gid, arr)
      }
    }
    return map
  }, [projects])

  const orphanProjects = useMemo(
    () => projects.filter(p => p.goal_ids.length === 0),
    [projects],
  )

  function toggleGoal(id: string) {
    setExpandedGoals(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleProject(id: string) {
    setExpandedProjects(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <PageShell headerLabel="// GOAL.CASCADE · META → PROJETOS → QUESTS">
      <div style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {loading ? (
          <div style={emptyStyle}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4 }}>//</span>
            CARREGANDO…
          </div>
        ) : goals.length === 0 ? (
          <div style={emptyStyle}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4 }}>//</span>
            NENHUMA META ATIVA · CRIE NO /BUILD
          </div>
        ) : (
          <>
            {goals.map(g => {
              const isExpanded = expandedGoals.has(g.id)
              const projs = projectsByGoal.get(g.id) ?? []
              // Calcula % a partir de current/target. Se sem target (booleana),
              // mostra 0 ou 100 baseado em status concluida.
              const cur = g.criterion_current_value ?? 0
              const tgt = g.criterion_target_value ?? 0
              const pct = tgt > 0 ? Math.min(100, (cur / tgt) * 100) : 0
              return (
                <div key={g.id}>
                  <button
                    type="button"
                    onClick={() => toggleGoal(g.id)}
                    style={goalRowStyle}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(143, 191, 211, 0.06)'
                      e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
                      e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.22)'
                    }}
                  >
                    {isExpanded
                      ? <ChevronDown size={14} strokeWidth={2} style={{ color: 'var(--color-ice-light)' }} />
                      : <ChevronRight size={14} strokeWidth={2} style={{ color: 'var(--color-text-muted)' }} />}
                    <Target size={14} strokeWidth={2} style={{ color: 'var(--color-success-light)', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 14,
                        color: 'var(--color-text-primary)',
                        fontWeight: 600,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {g.titulo}
                      </div>
                      <div style={metaStyle}>
                        {projs.length.toString().padStart(2, '0')} {projs.length === 1 ? 'PROJ' : 'PROJS'}
                        {' · '}
                        {pct.toFixed(0)}%
                        {' · '}
                        ALVO {g.data_alvo.split('-').reverse().slice(0, 2).join('/')}
                      </div>
                    </div>
                    {/* Progress mini-bar */}
                    <div style={{
                      width: 60, height: 4,
                      background: 'rgba(143, 191, 211, 0.10)',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, pct)}%`,
                        background: pct >= 75
                          ? 'var(--color-success-light)'
                          : pct >= 30
                            ? 'var(--color-ice-light)'
                            : 'var(--color-accent-light)',
                      }} />
                    </div>
                  </button>

                  {isExpanded && (
                    <div style={{ marginLeft: 26, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4, borderLeft: '1px dashed rgba(143, 191, 211, 0.22)', paddingLeft: 10 }}>
                      {projs.length === 0 ? (
                        <div style={emptyChildStyle}>
                          NENHUM PROJETO VINCULADO · MAPEIE NO /BUILD
                        </div>
                      ) : projs.map(proj => {
                        const isPExp = expandedProjects.has(proj.id)
                        const qs = questsByProject.get(proj.id) ?? []
                        const area = areaByKey.get(proj.area_slug ?? '')
                        return (
                          <div key={proj.id}>
                            <button
                              type="button"
                              onClick={() => toggleProject(proj.id)}
                              style={projectRowStyle}
                              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(143, 191, 211, 0.06)' }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(8, 12, 18, 0.45)' }}
                            >
                              {isPExp
                                ? <ChevronDown size={12} strokeWidth={2} style={{ color: 'var(--color-ice-light)' }} />
                                : <ChevronRight size={12} strokeWidth={2} style={{ color: 'var(--color-text-muted)' }} />}
                              <Folder size={11} strokeWidth={2} style={{ color: area?.color || 'var(--color-text-tertiary)', flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: 12,
                                  color: 'var(--color-text-secondary)',
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                  {proj.title}
                                </div>
                                <div style={subMetaStyle}>
                                  {area?.name?.toUpperCase() ?? proj.area_slug?.toUpperCase() ?? '?'}
                                  {' · '}
                                  {qs.length.toString().padStart(2, '0')} QUESTS
                                  {' · '}
                                  {proj.status?.toUpperCase()}
                                </div>
                              </div>
                            </button>
                            {isPExp && (
                              <div style={{ marginLeft: 22, display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                                {qs.length === 0 ? (
                                  <div style={emptyChildStyle}>NENHUMA QUEST ATIVA</div>
                                ) : qs.map(q => (
                                  <button
                                    key={q.id}
                                    type="button"
                                    onClick={() => navigate(`/areas/${q.area_slug}`)}
                                    style={questRowStyle}
                                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-ice-light)' }}
                                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-secondary)' }}
                                  >
                                    <CircleDot size={9} strokeWidth={2} style={{ flexShrink: 0, opacity: 0.6 }} />
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
                                      {q.title}
                                    </span>
                                    <span style={{
                                      fontFamily: 'var(--font-mono)',
                                      fontSize: 8, fontWeight: 700,
                                      letterSpacing: '0.18em',
                                      color: 'var(--color-text-muted)',
                                    }}>
                                      {q.status.toUpperCase()}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            {orphanProjects.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-accent-light)',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  marginBottom: 6,
                }}>
                  <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                  ÓRFÃOS · {orphanProjects.length} PROJ SEM META
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {orphanProjects.map(p => {
                    const area = areaByKey.get(p.area_slug ?? '')
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => navigate(`/areas/${p.area_slug}`)}
                        style={{ ...projectRowStyle, paddingLeft: 12 }}
                      >
                        <Folder size={11} strokeWidth={2} style={{ color: area?.color || 'var(--color-text-tertiary)' }} />
                        <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'left' }}>
                          {p.title}
                        </span>
                        <span style={subMetaStyle}>{area?.name?.toUpperCase()}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PageShell>
  )
}

const emptyStyle: React.CSSProperties = {
  padding: '14px 16px',
  border: '1px dashed rgba(143, 191, 211, 0.30)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10, fontWeight: 700,
  color: 'var(--color-text-muted)',
  letterSpacing: '0.18em', textTransform: 'uppercase',
}

const emptyChildStyle: React.CSSProperties = {
  padding: '4px 0 4px 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 9, fontWeight: 700,
  color: 'var(--color-text-muted)',
  letterSpacing: '0.18em', textTransform: 'uppercase',
  opacity: 0.7,
}

const goalRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  width: '100%',
  padding: '10px 12px',
  background: 'rgba(8, 12, 18, 0.55)',
  border: '1px solid rgba(143, 191, 211, 0.22)',
  borderLeft: '2px solid var(--color-success-light)',
  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
  cursor: 'pointer',
  color: 'inherit',
  textAlign: 'left',
  transition: 'background 0.15s, border-color 0.15s',
}

const projectRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  width: '100%',
  padding: '6px 10px',
  background: 'rgba(8, 12, 18, 0.45)',
  border: 'none',
  borderLeft: '2px solid var(--color-ice-deep)',
  cursor: 'pointer',
  color: 'inherit',
  textAlign: 'left',
  transition: 'background 0.15s',
}

const questRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  width: '100%',
  padding: '3px 6px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--color-text-secondary)',
  fontSize: 11,
  fontFamily: 'var(--font-body)',
  transition: 'color 0.15s',
}

const metaStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9, fontWeight: 700,
  color: 'var(--color-text-muted)',
  letterSpacing: '0.18em', textTransform: 'uppercase',
  marginTop: 2,
}

const subMetaStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 8, fontWeight: 700,
  color: 'var(--color-text-muted)',
  letterSpacing: '0.18em', textTransform: 'uppercase',
  marginTop: 2,
}
