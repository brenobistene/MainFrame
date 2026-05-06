import { useEffect, useState } from 'react'
import type { Area, Project, Quest } from '../types'
import { fetchDeliverables, deleteQuest, reportApiError } from '../api'
import type { DateRange } from '../utils/dateRange'
import { computeRange, isInRange } from '../utils/dateRange'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { QuestRow } from '../components/QuestRow'
import { NewQuestRow } from '../components/NewQuestRow'
import { PageShell } from '../components/ui/CyberShell'

type DeliverableLite = { id: string; title: string; done: boolean; estimated_minutes?: number; minutes_worked?: number; deadline?: string }

/**
 * Header de um projeto na listagem agrupada. Barra lateral com a cor da área,
 * título clicável do projeto (sem navegação por enquanto — só visual), e
 * contador `X/Y feitas` das subtarefas (ativas + concluídas).
 */
function ProjectGroupHeader({ project, area, doneCount, totalCount }: {
  project: Project
  area: Area | undefined
  doneCount: number
  totalCount: number
}) {
  const color = area?.color ?? 'var(--color-text-tertiary)'
  const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  return (
    <div
      className="hq-glass hq-grain hq-card-hoverable"
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        marginTop: 'var(--space-5)', marginBottom: 'var(--space-1)',
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 9, color, letterSpacing: '0.15em', textTransform: 'uppercase',
          fontWeight: 700, marginBottom: 3,
        }}>
          {area?.name ?? project.area_slug}
        </div>
        <div style={{
          color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {project.title}
        </div>
      </div>
      <div style={{
        fontSize: 10, color: 'var(--color-text-tertiary)',
        fontFamily: 'var(--font-mono)', fontWeight: 600,
        textAlign: 'right', flexShrink: 0,
      }}>
        <div>{doneCount}/{totalCount} feitas</div>
        <div style={{
          marginTop: 4, width: 80, height: 3,
          background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${percent}%`, background: color,
            transition: 'width 0.3s',
          }} />
        </div>
      </div>
    </div>
  )
}

/**
 * `/quests` — lista subtarefas (quests com `parent_id`) agrupadas pelo
 * projeto pai. Cada grupo tem header colorido com a cor da área e
 * contador `X/Y feitas`. Filtro por área nos tabs do topo, seção retrátil
 * "concluídas" com `DateRangeFilter`.
 */
export function QuestsView({ projects, quests: initial, areas, onSessionUpdate, onQuestUpdate, sessionUpdateTrigger = 0 }: { projects: Project[]; quests: Quest[]; areas: Area[]; onSessionUpdate?: () => void; onQuestUpdate?: (id: string, patch: Partial<Quest>) => void; sessionUpdateTrigger?: number }) {
  const [filter, setFilter] = useState<string>('all')
  const [showDone, setShowDone] = useState(false)
  const [doneRange, setDoneRange] = useState<DateRange>(() => computeRange('7d'))
  const [deliverablesByProject, setDeliverablesByProject] = useState<Record<string, DeliverableLite[]>>({})

  useEffect(() => {
    const projectIds = new Set(initial.filter(q => q.project_id != null).map(q => q.project_id!))

    Promise.all(
      Array.from(projectIds).map(projectId =>
        fetchDeliverables(projectId)
          .then(delivs => ({ projectId, delivs: delivs as DeliverableLite[] }))
          .catch(() => ({ projectId, delivs: [] as DeliverableLite[] }))
      )
    ).then(results => {
      const map: Record<string, DeliverableLite[]> = {}
      results.forEach(({ projectId, delivs }) => {
        map[projectId] = delivs
      })
      setDeliverablesByProject(map)
    })
  }, [initial])

  function update(id: string, patch: Partial<Quest>) {
    onQuestUpdate?.(id, patch)
  }

  function handleDelete(id: string) {
    if (window.confirm('Tem certeza que deseja excluir esta quest?')) {
      deleteQuest(id).catch(err => reportApiError('QuestsPage', err))
    }
  }

  function add(_q: Quest) { /* Already handled by parent component */ }

  const subtasksAll = initial.filter(q => q.project_id != null)
  const filtered = filter === 'all' ? subtasksAll : subtasksAll.filter(q => q.area_slug === filter)
  const activeSubs = filtered.filter(q => q.status !== 'done')
  const doneAllSubs = filtered.filter(q => q.status === 'done')
  const doneSubs = doneAllSubs.filter(q => isInRange(q.completed_at, doneRange))

  // Sort projects by area (keeping areas list order) then by title, so groups
  // come out in a predictable order when filter=all.
  const areaOrder = new Map(areas.map((a, i) => [a.slug, i]))
  const sortProjects = (a: Project, b: Project) => {
    const ai = areaOrder.get(a.area_slug) ?? 999
    const bi = areaOrder.get(b.area_slug) ?? 999
    if (ai !== bi) return ai - bi
    return a.title.localeCompare(b.title)
  }

  // Group subtasks by their project id. Keep projects in sorted order.
  function groupByProject(subs: Quest[]): { project: Project; subtasks: Quest[] }[] {
    const byId: Record<string, Quest[]> = {}
    for (const s of subs) {
      const pid = s.project_id!
      if (!byId[pid]) byId[pid] = []
      byId[pid].push(s)
    }
    const groups: { project: Project; subtasks: Quest[] }[] = []
    for (const pid of Object.keys(byId)) {
      const project = projects.find(p => p.id === pid)
      if (project) groups.push({ project, subtasks: byId[pid] })
    }
    groups.sort((g1, g2) => sortProjects(g1.project, g2.project))
    return groups
  }

  const activeGroups = groupByProject(activeSubs)
  const doneGroups = groupByProject(doneSubs)

  // Counts per project across ALL subtasks (not filtered by date range) so the
  // header reflects the true "3/7" regardless of which slice is visible.
  const totalByProject: Record<string, number> = {}
  const doneByProject: Record<string, number> = {}
  for (const s of subtasksAll) {
    const pid = s.project_id!
    totalByProject[pid] = (totalByProject[pid] ?? 0) + 1
    if (s.status === 'done') doneByProject[pid] = (doneByProject[pid] ?? 0) + 1
  }

  const getDeliverables = (questId: string) => {
    const projectId = initial.find(q => q.id === questId)?.project_id
    return projectId ? deliverablesByProject[projectId] || [] : []
  }

  useEffect(() => {
    if (doneSubs.length > 0 && !showDone) {
      setShowDone(true)
    }
  }, [doneSubs.length, showDone])

  const areaBySlug = (slug: string) => areas.find(a => a.slug === slug)

  return (
    <PageShell
      headerLabel="QUESTS"
      headerRightControls={
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[{ slug: 'all', name: 'TODAS', color: 'var(--color-ice)' as string }, ...areas.map(a => ({ slug: a.slug, name: a.name.toUpperCase(), color: a.color }))].map(a => {
            const isActive = filter === a.slug
            return (
              <button
                key={a.slug}
                onClick={() => setFilter(a.slug)}
                style={{
                  background: isActive ? 'rgba(143, 191, 211, 0.10)' : 'rgba(8, 12, 18, 0.55)',
                  border: `1px solid ${isActive ? 'rgba(143, 191, 211, 0.45)' : 'var(--color-border)'}`,
                  cursor: 'pointer',
                  padding: '5px 10px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.18em',
                  color: isActive ? 'var(--color-ice-light)' : 'var(--color-text-tertiary)',
                  borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                  transition: 'all 0.15s',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                {a.slug !== 'all' && (
                  <span style={{
                    width: 6, height: 6, background: a.color, flexShrink: 0,
                  }} />
                )}
                {a.name}
              </button>
            )
          })}
        </div>
      }
      footerCaption={
        <>
          <div>// QUEST.PIPELINE · {activeGroups.length} ACTIVE</div>
          <div style={{ opacity: 0.6, marginTop: 2 }}>TYPE: TACTICAL.QUESTS</div>
        </>
      }
    >

      <NewQuestRow areaSlug={filter} areas={areas} projects={projects} onCreated={add} />

      {activeGroups.length === 0 && (
        <div style={{ marginTop: 24, fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          {filter === 'all'
            ? 'Nenhuma quest em andamento. Crie uma acima.'
            : 'Nenhuma quest em andamento nesta área.'}
        </div>
      )}

      {activeGroups.map(({ project, subtasks }) => (
        <div key={project.id}>
          <ProjectGroupHeader
            project={project}
            area={areaBySlug(project.area_slug)}
            doneCount={doneByProject[project.id] ?? 0}
            totalCount={totalByProject[project.id] ?? 0}
          />
          {subtasks.map(q => (
            <QuestRow
              key={q.id}
              q={q}
              onUpdate={update}
              areas={areas}
              onSessionUpdate={onSessionUpdate}
              onDelete={handleDelete}
              deliverables={getDeliverables(q.id) as any}
              projects={projects}
              sessionUpdateTrigger={sessionUpdateTrigger}
            />
          ))}
        </div>
      ))}

      {doneAllSubs.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => setShowDone(o => !o)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', fontSize: 11, letterSpacing: '0.15em',
              textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 9 }}>{showDone ? '▼' : '▶'}</span>
              {doneSubs.length} concluída{doneSubs.length !== 1 ? 's' : ''}
            </button>
            <DateRangeFilter value={doneRange} onChange={setDoneRange} />
          </div>
          {showDone && doneGroups.length > 0 && (
            <div style={{ marginTop: 4, opacity: 0.55 }}>
              {doneGroups.map(({ project, subtasks }) => (
                <div key={project.id}>
                  <ProjectGroupHeader
                    project={project}
                    area={areaBySlug(project.area_slug)}
                    doneCount={doneByProject[project.id] ?? 0}
                    totalCount={totalByProject[project.id] ?? 0}
                  />
                  {subtasks.map(q => (
                    <QuestRow
                      key={q.id}
                      q={q}
                      onUpdate={update}
                      areas={areas}
                      onSessionUpdate={onSessionUpdate}
                      onDelete={handleDelete}
                      deliverables={getDeliverables(q.id) as any}
                      projects={projects}
                      sessionUpdateTrigger={sessionUpdateTrigger}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
          {showDone && doneSubs.length === 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              Nenhuma concluída no período ({doneAllSubs.length} no total).
            </div>
          )}
        </div>
      )}
    </PageShell>
  )
}
