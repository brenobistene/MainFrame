import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Archive, CheckCircle2, Trash2, ArchiveRestore } from 'lucide-react'
import type { Area, Project, Quest, Deliverable } from '../types'
import { createArea, createProject, deleteProject, fetchDeliverables, fetchDeliverablesSummary, reportApiError } from '../api'
import type { DateRange } from '../utils/dateRange'
import { computeRange, isInRange } from '../utils/dateRange'
import { ColorPickerPopover } from '../components/ColorPickerPopover'
import { AreaRow } from '../components/AreaRow'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { QuestDetailPanel } from '../components/QuestDetailPanel'
import { PRIORITIES } from '../components/PrioritySelect'
import { PageShell, TechId } from '../components/ui/CyberShell'

/**
 * `/areas` — lista editável de áreas. Um clique numa linha navega pra
 * `/areas/:slug` (handled by `AreaDetailRoute`).
 */
export function AreasView({ areas, projects, onAreaCreate, onAreaUpdate, onAreaDelete }: {
  areas: Area[]
  projects: Project[]
  onAreaCreate: (a: Area) => void
  onAreaUpdate: (slug: string, patch: Partial<Area>) => void
  onAreaDelete: (slug: string) => void
}) {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6b7280')
  const [showNewPicker, setShowNewPicker] = useState(false)

  const countBySlug: Record<string, number> = {}
  for (const p of projects) countBySlug[p.area_slug] = (countBySlug[p.area_slug] ?? 0) + 1

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    try {
      const created = await createArea({ name, color: newColor })
      onAreaCreate(created)
      setNewName('')
      setNewColor('#6b7280')
      setCreating(false)
    } catch {
      alert('Erro ao criar área')
    }
  }

  return (
    <PageShell
      headerLabel="ÁREAS"
      headerLeftContent={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 14, fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--color-text-primary)',
            lineHeight: 1.1,
          }}>
            {areas.length} {areas.length === 1 ? 'ÁREA' : 'ÁREAS'} · {projects.length} {projects.length === 1 ? 'PROJETO' : 'PROJETOS'}
          </span>
          <TechId>DOMAINS.MATRIX</TechId>
        </div>
      }
      headerRightControls={
        !creating && (
          <button
            onClick={() => setCreating(true)}
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
            + NOVA ÁREA
          </button>
        )
      }
      footerCaption={
        <>
          <div>// DOMAINS.MAPPED · {areas.length} REGISTERED</div>
          <div style={{ opacity: 0.6, marginTop: 2 }}>TYPE: TACTICAL.AREAS</div>
        </>
      }
    >

      {creating && (
        <section style={{
          marginTop: 32,
          display: 'flex', gap: 14, alignItems: 'center',
          paddingBottom: 18, borderBottom: '1px solid var(--color-divider)',
        }}>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowNewPicker(o => !o)}
              title="Cor da área"
              style={{
                width: 22, height: 22, background: newColor,
                border: '1px solid var(--color-border)', borderRadius: 4,
                cursor: 'pointer', padding: 0, flexShrink: 0,
              }}
            />
            {showNewPicker && (
              <ColorPickerPopover
                value={newColor}
                onChange={setNewColor}
                onClose={() => setShowNewPicker(false)}
              />
            )}
          </div>
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreate()
              if (e.key === 'Escape') { setCreating(false); setNewName('') }
            }}
            placeholder="nome da nova área…"
            style={{
              flex: 1, background: 'transparent',
              border: 'none', borderBottom: '2px solid var(--color-border)',
              color: 'var(--color-text-primary)', fontSize: 14, padding: '6px 2px',
              outline: 'none', fontWeight: 500,
              transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-accent-primary)')}
            onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--color-border)')}
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            style={{
              background: newName.trim() ? 'var(--color-accent-primary)' : 'var(--color-bg-tertiary)',
              color: newName.trim() ? 'var(--color-bg-primary)' : 'var(--color-text-muted)',
              border: 'none', cursor: newName.trim() ? 'pointer' : 'not-allowed',
              fontSize: 10, padding: '8px 14px', borderRadius: 3, fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}
          >
            Criar
          </button>
          <button
            onClick={() => { setCreating(false); setNewName('') }}
            title="Cancelar"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', fontSize: 14, padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </section>
      )}

      <section style={{ marginTop: 40 }}>
        <div style={{
          fontSize: 10, color: 'var(--color-text-tertiary)',
          letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600,
          marginBottom: 14,
        }}>
          Todas as áreas
        </div>
        {areas.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            Nenhuma área ainda. Crie uma clicando em "+ nova área" acima.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {areas.map(a => (
              <AreaRow
                key={a.slug}
                area={a}
                questCount={countBySlug[a.slug] ?? 0}
                onOpen={() => navigate(`/areas/${a.slug}`)}
                onUpdate={onAreaUpdate}
                onDelete={onAreaDelete}
              />
            ))}
          </div>
        )}
      </section>

    </PageShell>
  )
}

/**
 * Wrapper da rota `/areas/:slug`. Lê slug, valida selectedProjectId contra
 * a área aberta, renderiza botão "voltar" + AreaDetailView.
 */
export function AreaDetailRoute({
  areas, projects, quests,
  selectedProjectId, onSelectProject,
  onProjectUpdate, onProjectCreate, onProjectDelete,
  onQuestUpdate, onQuestCreate, onQuestDelete,
  onSessionUpdate,
}: {
  areas: Area[]
  projects: Project[]
  quests: Quest[]
  selectedProjectId: string | null
  onSelectProject: (id: string | null) => void
  onProjectUpdate: (id: string, patch: Partial<Project>) => void
  onProjectCreate: (p: Project) => void
  onProjectDelete: (id: string) => void
  onQuestUpdate: (id: string, patch: Partial<Quest>) => void
  onQuestCreate: (q: Quest) => void
  onQuestDelete: (id: string) => void
  onSessionUpdate: () => void
}) {
  const { slug } = useParams<{ slug: string }>()

  if (!slug) return <Navigate to="/areas" replace />

  // Só usa o `selectedProjectId` persistido se ele pertencer a essa área.
  const validProjectId = selectedProjectId && projects.find(p => p.id === selectedProjectId && p.area_slug === slug)
    ? selectedProjectId
    : null

  return (
    <>
      <Link
        to="/areas"
        onClick={() => onSelectProject(null)}
        style={{
          background: 'none', border: '1px solid transparent', cursor: 'pointer',
          color: 'var(--color-text-tertiary)', fontSize: 11, marginBottom: 24,
          textTransform: 'uppercase', letterSpacing: '0.1em',
          padding: '6px 8px', borderRadius: 4, transition: 'all 0.2s',
          textDecoration: 'none', display: 'inline-block',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = 'var(--color-text-primary)'
          e.currentTarget.style.borderColor = 'var(--color-border)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = 'var(--color-text-tertiary)'
          e.currentTarget.style.borderColor = 'transparent'
        }}
      >
        ← voltar
      </Link>
      <AreaDetailView
        key={slug}
        areaSlug={slug}
        areas={areas}
        projects={projects}
        quests={quests}
        selectedProjectId={validProjectId}
        onSelectProject={onSelectProject}
        onProjectUpdate={onProjectUpdate}
        onProjectCreate={onProjectCreate}
        onProjectDelete={onProjectDelete}
        onQuestUpdate={onQuestUpdate}
        onQuestCreate={onQuestCreate}
        onQuestDelete={onQuestDelete}
        onSessionUpdate={onSessionUpdate}
      />
    </>
  )
}

/**
 * Painel da área individual. Mostra projetos da área com barra de progresso,
 * permite criar projeto inline, abre `QuestDetailPanel` em overlay quando
 * um projeto é selecionado.
 */
function AreaDetailView({
  areaSlug, areas, projects, quests,
  selectedProjectId, onSelectProject,
  onProjectUpdate, onProjectCreate, onProjectDelete,
  onQuestUpdate, onQuestCreate, onQuestDelete,
  onSessionUpdate,
}: {
  areaSlug: string
  areas: Area[]
  projects: Project[]
  quests: Quest[]
  selectedProjectId: string | null
  onSelectProject: (id: string | null) => void
  onProjectUpdate: (id: string, patch: Partial<Project>) => void
  onProjectCreate: (p: Project) => void
  onProjectDelete: (id: string) => void
  onQuestUpdate: (id: string, patch: Partial<Quest>) => void
  onQuestCreate: (q: Quest) => void
  onQuestDelete: (id: string) => void
  onSessionUpdate: () => void
}) {
  const area = areas.find(a => a.slug === areaSlug)
  const [showDone, setShowDone] = useState(false)
  const [doneRange, setDoneRange] = useState<DateRange>(() => computeRange('7d'))
  const [showCancelled, setShowCancelled] = useState(false)
  const [cancelledRange, setCancelledRange] = useState<DateRange>(() => computeRange('7d'))
  const [showArchived, setShowArchived] = useState(false)
  const [archivedRange, setArchivedRange] = useState<DateRange>(() => computeRange('7d'))
  const [newProjectTitle, setNewProjectTitle] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [delivsByProject, setDelivsByProject] = useState<Record<string, Deliverable[]>>({})
  // Resumo de entregáveis por projeto pra barra de progresso dos cards.
  // Bulk via `/api/projects/deliverables-summary` — evita N+1 do frontend.
  const [delivSummary, setDelivSummary] = useState<Record<string, { total: number; done: number }>>({})

  const areaProjects = projects.filter(p => p.area_slug === areaSlug)
  const projectIdsKey = areaProjects.map(p => p.id).sort().join(',')

  useEffect(() => {
    const ids = projectIdsKey ? projectIdsKey.split(',') : []
    if (ids.length === 0) { setDelivsByProject({}); return }
    let cancelled = false
    Promise.all(ids.map(pid =>
      fetchDeliverables(pid).then(ds => ({ pid, ds })).catch(() => ({ pid, ds: [] as Deliverable[] }))
    )).then(results => {
      if (cancelled) return
      const map: Record<string, Deliverable[]> = {}
      for (const r of results) map[r.pid] = r.ds
      setDelivsByProject(map)
    })
    return () => { cancelled = true }
  }, [projectIdsKey])

  // Resumo bulk de entregáveis (total/done) por projeto da área. Refetcha
  // também quando o painel de detalhe de um projeto fecha (via handler no
  // onClose abaixo), pra refletir entregáveis marcados/desmarcados lá dentro.
  const refreshDelivSummary = () => {
    fetchDeliverablesSummary(areaSlug)
      .then(setDelivSummary)
      .catch(err => reportApiError('AreasPage.deliverablesSummary', err))
  }
  useEffect(() => {
    refreshDelivSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaSlug, projectIdsKey])

  if (!area) return <div style={{ color: 'var(--color-text-tertiary)' }}>Área não encontrada</div>
  const doing = areaProjects.filter(p => p.status === 'doing').length
  const pending = areaProjects.filter(p => p.status === 'pending').length
  const done = areaProjects.filter(p => p.status === 'done').length
  const cancelled = areaProjects.filter(p => p.status === 'cancelled').length
  const closed = done + cancelled
  const total = areaProjects.length

  // Arquivados ficam na gaveta própria — saem de active/done/cancelled
  // independente do status. Usuário reabre pela seção "arquivados" embaixo.
  const nonArchived = areaProjects.filter(p => !p.archived_at)
  const active = nonArchived.filter(p => p.status !== 'done' && p.status !== 'cancelled')
  const doneAll = nonArchived.filter(p => p.status === 'done')
  const doneInRange = doneAll.filter(p => isInRange(p.completed_at, doneRange))
  const cancelledAll = nonArchived.filter(p => p.status === 'cancelled')
  const cancelledInRange = cancelledAll.filter(p => isInRange(p.completed_at, cancelledRange))
  const archivedAll = areaProjects.filter(p => !!p.archived_at)
  const archivedInRange = archivedAll.filter(p => isInRange(p.archived_at, archivedRange))
  const selectedProject = selectedProjectId ? areaProjects.find(p => p.id === selectedProjectId) : null

  const handleCreateProject = () => {
    if (!newProjectTitle.trim()) return
    createProject({
      title: newProjectTitle,
      area_slug: areaSlug,
      priority: 'critical',
    })
      .then(p => {
        setNewProjectTitle('')
        setCreatingProject(false)
        onProjectCreate(p)
      })
      .catch(err => reportApiError('AreasPage.createProject', err))
  }

  const handleDeleteProject = (projectId: string) => {
    if (window.confirm('Tem certeza que deseja excluir este projeto? Todos os entregáveis e quests dentro dele também serão excluídos.')) {
      deleteProject(projectId)
        .then(() => {
          if (selectedProjectId === projectId) onSelectProject(null)
          onProjectDelete(projectId)
        })
        .catch(err => reportApiError('AreasPage.deleteProject', err))
    }
  }

  const handleCompleteProject = (projectId: string) => {
    if (window.confirm('Marcar este projeto como finalizado?')) {
      onProjectUpdate(projectId, { status: 'done', completed_at: new Date().toISOString() })
    }
  }

  const handleArchiveProject = (projectId: string) => {
    if (window.confirm('Arquivar este projeto? Ele sai da lista principal mas continua acessível na seção "arquivados".')) {
      onProjectUpdate(projectId, { archived_at: new Date().toISOString() })
    }
  }

  const handleUnarchiveProject = (projectId: string) => {
    onProjectUpdate(projectId, { archived_at: null })
  }

  // Painel de detalhe ocupa a tela inteira da área quando um projeto está
  // selecionado (mesma convenção anterior).
  if (selectedProject) {
    return (
      <QuestDetailPanel
        project={selectedProject}
        onClose={() => {
          // Antes de voltar pra lista, refetcha o resumo de entregáveis —
          // garante que a barra de progresso do card reflita qualquer
          // tick/untick feito dentro do painel sem precisar F5.
          refreshDelivSummary()
          onSelectProject(null)
        }}
        onProjectUpdate={onProjectUpdate}
        onQuestUpdate={onQuestUpdate}
        area={area}
        quests={quests}
        onQuestCreate={onQuestCreate}
        onQuestDelete={onQuestDelete}
        onSessionUpdate={onSessionUpdate}
      />
    )
  }

  return (
    <PageShell
      headerLabel={`AREA · ${area.name.toUpperCase()}`}
      headerLeftContent={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 14, fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--color-text-primary)',
            lineHeight: 1.1,
          }}>
            {total} {total === 1 ? 'PROJETO' : 'PROJETOS'}
            {doing > 0 && ` · ${doing} FAZENDO`}
            {pending > 0 && ` · ${pending} PENDENTE${pending !== 1 ? 'S' : ''}`}
          </span>
          <TechId>
            {total > 0 ? `PROGRESS ${Math.round((closed / total) * 100)}%` : 'EMPTY DOMAIN'}
          </TechId>
        </div>
      }
      headerRightControls={
        total > 0 ? (
          <div style={{ width: 120, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 1 }}>
              {Array.from({ length: 10 }).map((_, i) => {
                const filled = (closed / total) * 10 > i
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1, height: 4,
                      background: filled ? area.color : 'rgba(255, 255, 255, 0.08)',
                      boxShadow: filled ? `0 0 4px ${area.color}` : 'none',
                    }}
                  />
                )
              })}
            </div>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.15em',
              color: 'var(--color-text-muted)',
              textAlign: 'right',
            }}>
              {Math.round((closed / total) * 100)}% · {closed}/{total}
            </span>
          </div>
        ) : undefined
      }
      footerCaption={
        <>
          <div>// AREA.{area.slug.toUpperCase()} · {total} PROJECTS · {closed} CLOSED</div>
          {area.description && (
            <div style={{ opacity: 0.6, marginTop: 2, textTransform: 'none', letterSpacing: '0.05em' }}>
              {area.description}
            </div>
          )}
        </>
      }
    >

      {!creatingProject ? (
        <div style={{ marginTop: 24 }}>
          <button
            onClick={() => setCreatingProject(true)}
            style={{
              background: 'var(--color-accent-primary)', border: 'none', cursor: 'pointer',
              color: 'var(--color-bg-primary)', fontSize: 11, fontWeight: 700,
              padding: '8px 16px', borderRadius: 3,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-accent-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-accent-primary)')}
          >
            + criar projeto
          </button>
        </div>
      ) : (
      <div style={{ marginTop: 24, display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          type="text"
          autoComplete="off"
          autoFocus
          value={newProjectTitle}
          onChange={e => setNewProjectTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleCreateProject()
            if (e.key === 'Escape') { setCreatingProject(false); setNewProjectTitle('') }
          }}
          placeholder="título do projeto…"
          style={{
            flex: 1, background: 'transparent',
            border: 'none', borderBottom: '2px solid var(--color-border)',
            color: 'var(--color-text-primary)', padding: '6px 2px', fontSize: 14,
            outline: 'none', fontFamily: "'Satoshi', sans-serif", fontWeight: 500,
            transition: 'border-color 0.15s',
          }}
          onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-accent-primary)')}
          onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--color-border)')}
        />
        <button
          onClick={handleCreateProject}
          disabled={!newProjectTitle.trim()}
          style={{
            background: newProjectTitle.trim() ? 'var(--color-accent-primary)' : 'var(--color-bg-tertiary)',
            color: newProjectTitle.trim() ? 'var(--color-bg-primary)' : 'var(--color-text-muted)',
            border: 'none', cursor: newProjectTitle.trim() ? 'pointer' : 'not-allowed',
            padding: '8px 14px', fontSize: 10, fontWeight: 700, borderRadius: 3,
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}
        >
          Criar
        </button>
        <button
          onClick={() => { setCreatingProject(false); setNewProjectTitle('') }}
          title="Cancelar"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-tertiary)', fontSize: 14, padding: '4px 8px',
          }}
        >
          ✕
        </button>
      </div>
      )}

      {active.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {active.map(p => (
            <AreaProjectRow
              key={p.id}
              project={p}
              delivs={delivsByProject[p.id] ?? []}
              progress={delivSummary[p.id]}
              subtasks={quests.filter(q => q.project_id === p.id)}
              areaColor={area.color}
              isSelected={selectedProjectId === p.id}
              onOpen={() => onSelectProject(p.id)}
              onDelete={() => handleDeleteProject(p.id)}
              onComplete={() => handleCompleteProject(p.id)}
              onArchive={() => handleArchiveProject(p.id)}
            />
          ))}
        </div>
      )}

      {doneAll.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => setShowDone(o => !o)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', fontSize: 11, letterSpacing: '0.15em',
              textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 9 }}>{showDone ? '▼' : '▶'}</span>
              {doneInRange.length} concluído{doneInRange.length !== 1 ? 's' : ''}
            </button>
            <DateRangeFilter value={doneRange} onChange={setDoneRange} />
          </div>
          {showDone && doneInRange.length === 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              Nenhum concluído no período ({doneAll.length} no total).
            </div>
          )}
          {showDone && doneInRange.length > 0 && (
            <div style={{ marginTop: 12, opacity: 0.5 }}>
              {doneInRange.map(p => (
                <AreaProjectRow
                  key={p.id}
                  project={p}
                  delivs={delivsByProject[p.id] ?? []}
                  progress={delivSummary[p.id]}
                  subtasks={quests.filter(q => q.project_id === p.id)}
                  areaColor={area.color}
                  isSelected={selectedProjectId === p.id}
                  onOpen={() => onSelectProject(p.id)}
                  onDelete={() => handleDeleteProject(p.id)}
                  onArchive={() => handleArchiveProject(p.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {cancelledAll.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => setShowCancelled(o => !o)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', fontSize: 11, letterSpacing: '0.15em',
              textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 9 }}>{showCancelled ? '▼' : '▶'}</span>
              {cancelledInRange.length} cancelado{cancelledInRange.length !== 1 ? 's' : ''}
            </button>
            <DateRangeFilter value={cancelledRange} onChange={setCancelledRange} />
          </div>
          {showCancelled && cancelledInRange.length === 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              Nenhum cancelado no período ({cancelledAll.length} no total).
            </div>
          )}
          {showCancelled && cancelledInRange.length > 0 && (
            <div style={{ marginTop: 12, opacity: 0.4 }}>
              {cancelledInRange.map(p => (
                <AreaProjectRow
                  key={p.id}
                  project={p}
                  delivs={delivsByProject[p.id] ?? []}
                  progress={delivSummary[p.id]}
                  subtasks={quests.filter(q => q.project_id === p.id)}
                  areaColor={area.color}
                  isSelected={selectedProjectId === p.id}
                  onOpen={() => onSelectProject(p.id)}
                  onDelete={() => handleDeleteProject(p.id)}
                  onArchive={() => handleArchiveProject(p.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {archivedAll.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => setShowArchived(o => !o)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', fontSize: 11, letterSpacing: '0.15em',
              textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 9 }}>{showArchived ? '▼' : '▶'}</span>
              {archivedInRange.length} arquivado{archivedInRange.length !== 1 ? 's' : ''}
            </button>
            <DateRangeFilter value={archivedRange} onChange={setArchivedRange} />
          </div>
          {showArchived && archivedInRange.length === 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              Nenhum arquivado no período ({archivedAll.length} no total).
            </div>
          )}
          {showArchived && archivedInRange.length > 0 && (
            <div style={{ marginTop: 12, opacity: 0.45 }}>
              {archivedInRange.map(p => (
                <AreaProjectRow
                  key={p.id}
                  project={p}
                  delivs={delivsByProject[p.id] ?? []}
                  progress={delivSummary[p.id]}
                  subtasks={quests.filter(q => q.project_id === p.id)}
                  areaColor={area.color}
                  isSelected={selectedProjectId === p.id}
                  onOpen={() => onSelectProject(p.id)}
                  onDelete={() => handleDeleteProject(p.id)}
                  onUnarchive={() => handleUnarchiveProject(p.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </PageShell>
  )
}

function fmtMinLabel(m: number): string {
  if (m <= 0) return ''
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h > 0 && r > 0) return `${h}h ${r}m`
  if (h > 0) return `${h}h`
  return `${r}m`
}

function calendarDaysUntil(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  const deadline = new Date(y, m - 1, d); deadline.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((deadline.getTime() - today.getTime()) / 86400000)
}

function urgencyText(daysAway: number): string {
  if (daysAway < 0) return `atrasado ${Math.abs(daysAway)}d`
  if (daysAway === 0) return 'hoje'
  if (daysAway === 1) return 'amanhã'
  return `em ${daysAway}d`
}

/**
 * Row compacto de um projeto na visão de área — mostra prioridade, deadline,
 * tempo previsto (soma dos child quests), contagem de entregáveis e próximo
 * item a executar.
 */
function AreaProjectRow({
  project, delivs, progress, subtasks, areaColor, isSelected,
  onOpen, onDelete, onComplete, onArchive, onUnarchive,
}: {
  project: Project
  delivs: Deliverable[]
  /** Resumo bulk do backend — usado na barra de progresso. Tem prioridade
   *  sobre `delivs.length` (que pode estar vazio se o fetch ainda não voltou). */
  progress?: { total: number; done: number }
  subtasks: Quest[]
  areaColor: string
  isSelected: boolean
  onOpen: () => void
  onDelete: () => void
  onComplete?: () => void
  onArchive?: () => void
  onUnarchive?: () => void
}) {
  const totalEstMin = subtasks.reduce((s, q) => s + (q.estimated_minutes ?? 0), 0)
  const openDelivs = delivs.filter(d => !d.done)
  const doneCount = delivs.length - openDelivs.length
  const nextDeliv = openDelivs[0] ?? null
  const nextQuest = nextDeliv
    ? subtasks.find(q => q.deliverable_id === nextDeliv.id && q.status !== 'done')
    : subtasks.find(q => q.status !== 'done')

  const priority = PRIORITIES.find(p => p.key === project.priority) ?? PRIORITIES[2]
  const daysAway = project.deadline ? calendarDaysUntil(project.deadline) : null
  const overdue = daysAway !== null && daysAway < 0 && project.status !== 'done'

  // Fonte do progresso: preferir summary bulk (vem no mount); fallback pro
  // que já está nos delivs locais (pode atrasar até o fetch retornar).
  const total = progress?.total ?? delivs.length
  const done = progress?.done ?? doneCount
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  const isClosed = project.status === 'done' || project.status === 'cancelled'
  const isArchived = !!project.archived_at

  return (
    <div
      onClick={onOpen}
      className={isSelected ? 'hq-glass hq-grain' : 'hq-row-hoverable'}
      style={{
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--color-border)',
        cursor: 'pointer',
        borderRadius: isSelected ? 'var(--radius-sm)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%', marginTop: 6,
          background: areaColor, flexShrink: 0,
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: 'var(--color-text-primary)', fontSize: 14, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {project.title}
          </div>

          <div style={{
            marginTop: 6,
            display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center',
            fontSize: 10, fontFamily: 'var(--font-mono)',
          }}>
            <span style={{
              color: priority.color,
              textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700,
            }}>
              {priority.label}
            </span>

            {daysAway !== null && (
              <span style={{ color: overdue ? 'var(--color-accent-vivid)' : 'var(--color-text-tertiary)' }}>
                <span style={{ opacity: 0.6, marginRight: 4 }}>deadline</span>
                {urgencyText(daysAway)}
              </span>
            )}

            {totalEstMin > 0 && (
              <span style={{ color: 'var(--color-text-tertiary)' }}>
                <span style={{ opacity: 0.6, marginRight: 4 }}>previsto</span>
                {fmtMinLabel(totalEstMin)}
              </span>
            )}

            {delivs.length > 0 && (
              <span style={{ color: 'var(--color-text-tertiary)' }}>
                <span style={{ opacity: 0.6, marginRight: 4 }}>entregas</span>
                {doneCount}/{delivs.length}
              </span>
            )}
          </div>

          {(nextDeliv || nextQuest) && (
            <div style={{
              marginTop: 6,
              fontSize: 11, color: 'var(--color-text-tertiary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              <span style={{
                fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
                color: 'var(--color-text-muted)', marginRight: 6,
              }}>próximo</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {nextDeliv?.title ?? ''}
                {nextQuest && nextQuest.title !== nextDeliv?.title && (
                  <>
                    {nextDeliv && <span style={{ color: 'var(--color-text-muted)' }}> › </span>}
                    <span style={{ color: 'var(--color-accent-light)' }}>{nextQuest.title}</span>
                  </>
                )}
              </span>
            </div>
          )}

          {/* Barra de progresso — alimentada por entregáveis done/total */}
          {total > 0 && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                flex: 1, height: 3, borderRadius: 2,
                background: 'var(--color-bg-tertiary)', overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', width: `${Math.min(100, pct)}%`,
                  background: pct >= 100 ? 'var(--color-success)' : 'var(--color-accent-light)',
                  transition: 'width 0.3s ease-out',
                }} />
              </div>
              <span style={{
                fontSize: 9, fontFamily: 'var(--font-mono)',
                color: 'var(--color-text-muted)', minWidth: 28, textAlign: 'right',
              }}>
                {pct}%
              </span>
            </div>
          )}
        </div>

        {/* Ações: delete (mais sutil) · archive · finalizar (destaque). */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0,
        }}>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            title="Excluir projeto"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-muted)', padding: 6, opacity: 0.35,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              transition: 'color 0.15s, opacity 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-accent-vivid)'
              e.currentTarget.style.opacity = '1'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-muted)'
              e.currentTarget.style.opacity = '0.35'
            }}
          >
            <Trash2 size={13} strokeWidth={1.8} />
          </button>

          {isArchived ? (
            onUnarchive && (
              <button
                onClick={(e) => { e.stopPropagation(); onUnarchive() }}
                title="Desarquivar projeto"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-tertiary)', padding: 6, opacity: 0.55,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'color 0.15s, opacity 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = 'var(--color-accent-light)'
                  e.currentTarget.style.opacity = '1'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = 'var(--color-text-tertiary)'
                  e.currentTarget.style.opacity = '0.55'
                }}
              >
                <ArchiveRestore size={14} strokeWidth={1.8} />
              </button>
            )
          ) : (
            onArchive && (
              <button
                onClick={(e) => { e.stopPropagation(); onArchive() }}
                title="Arquivar projeto"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-tertiary)', padding: 6, opacity: 0.55,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'color 0.15s, opacity 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = 'var(--color-accent-light)'
                  e.currentTarget.style.opacity = '1'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = 'var(--color-text-tertiary)'
                  e.currentTarget.style.opacity = '0.55'
                }}
              >
                <Archive size={14} strokeWidth={1.8} />
              </button>
            )
          )}

          {onComplete && !isClosed && !isArchived && (
            <button
              onClick={(e) => { e.stopPropagation(); onComplete() }}
              title="Finalizar projeto"
              style={{
                background: 'none', border: '1px solid var(--color-success)',
                cursor: 'pointer', color: 'var(--color-success)',
                padding: '5px 8px', borderRadius: 3, marginLeft: 4,
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700,
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--color-success)'
                e.currentTarget.style.color = 'var(--color-bg-primary)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--color-success)'
              }}
            >
              <CheckCircle2 size={11} strokeWidth={2.2} />
              Finalizar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
