import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Archive, CheckCircle2, Trash2, ArchiveRestore } from 'lucide-react'
import type { Area, Project, Quest, Deliverable } from '../types'
import { createArea, createProject, deleteProject, fetchDeliverables, fetchDeliverablesSummary, reportApiError } from '../api'
import type { DateRange } from '../utils/dateRange'
import { computeRange, isInRange } from '../utils/dateRange'
import { ColorPickerPopover } from '../components/ColorPickerPopover'
import { AreaRow } from '../components/AreaRow'
import { confirmDialog, alertDialog } from '../lib/dialog'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { QuestDetailPanel } from '../components/QuestDetailPanel'
import { PRIORITIES } from '../components/PrioritySelect'
import { PageShell, TechId } from '../components/ui/CyberShell'

/**
 * `/areas` — lista editável de áreas. Um clique numa linha navega pra
 * `/areas/:slug` (handled by `AreaDetailRoute`).
 */
export function AreasView({ areas, projects, quests, onAreaCreate, onAreaUpdate, onAreaDelete }: {
  areas: Area[]
  projects: Project[]
  quests: Quest[]
  onAreaCreate: (a: Area) => void
  onAreaUpdate: (slug: string, patch: Partial<Area>) => void
  onAreaDelete: (slug: string) => void
}) {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6b7280')
  // Abre por padrão sempre que o form NEW.AREA aparece — usuário vê a paleta
  // imediatamente sem clique extra. Reaberto via setShowNewPicker(true) no
  // botão "+ NOVA ÁREA" também (caso de fechado e reaberto).
  const [showNewPicker, setShowNewPicker] = useState(true)
  const newSwatchRef = useRef<HTMLButtonElement>(null)
  const [delivSummary, setDelivSummary] = useState<Record<string, { total: number; done: number }>>({})

  // Resumo bulk de entregáveis (todos os projetos). Permite mostrar contagem
  // total/concluído por área no row sem N+1 fetch.
  useEffect(() => {
    fetchDeliverablesSummary()
      .then(setDelivSummary)
      .catch(err => reportApiError('AreasView.deliverablesSummary', err))
  }, [])

  // Contagem de projetos por área.
  const projectsByArea: Record<string, number> = {}
  for (const p of projects) projectsByArea[p.area_slug] = (projectsByArea[p.area_slug] ?? 0) + 1

  // Soma entregáveis por área agrupando via projects[].area_slug.
  const delivByArea: Record<string, { total: number; done: number }> = {}
  for (const p of projects) {
    const summary = delivSummary[p.id]
    if (!summary) continue
    if (!delivByArea[p.area_slug]) delivByArea[p.area_slug] = { total: 0, done: 0 }
    delivByArea[p.area_slug].total += summary.total
    delivByArea[p.area_slug].done += summary.done
  }

  // Contagem de quests por área (via project.area_slug do quest).
  const projectAreaById: Record<string, string> = {}
  for (const p of projects) projectAreaById[p.id] = p.area_slug
  const questsByArea: Record<string, number> = {}
  for (const q of quests) {
    if (!q.project_id) continue
    const slug = projectAreaById[q.project_id]
    if (!slug) continue
    questsByArea[slug] = (questsByArea[slug] ?? 0) + 1
  }

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
      await alertDialog({ title: 'Erro', message: 'Erro ao criar área', variant: 'danger' })
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
            onClick={() => { setCreating(true); setShowNewPicker(true) }}
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
          marginTop: 24,
          padding: '14px 16px',
          background: 'rgba(8, 12, 18, 0.55)',
          border: '1px solid var(--color-ice-deep)',
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
          display: 'flex', gap: 12, alignItems: 'center',
          marginBottom: 18,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            color: 'var(--color-ice-light)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
            flexShrink: 0,
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            NEW.AREA
          </span>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              ref={newSwatchRef}
              onClick={() => setShowNewPicker(o => !o)}
              title="Cor da área"
              style={{
                width: 24, height: 24, background: newColor,
                border: '1px solid var(--color-ice-deep)',
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                cursor: 'pointer', padding: 0, flexShrink: 0,
                boxShadow: `0 0 18px ${newColor}cc, 0 0 8px ${newColor}aa, 0 0 3px ${newColor}`,
                transition: 'box-shadow 0.15s, transform 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'scale(1.08)'
                e.currentTarget.style.boxShadow = `0 0 26px ${newColor}, 0 0 12px ${newColor}, 0 0 4px ${newColor}`
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.boxShadow = `0 0 18px ${newColor}cc, 0 0 8px ${newColor}aa, 0 0 3px ${newColor}`
              }}
            />
            {showNewPicker && (
              <ColorPickerPopover
                value={newColor}
                anchorEl={newSwatchRef.current}
                onChange={setNewColor}
                // Picker permanente: clique fora não fecha. Usuário pode esconder
                // clicando no swatch (toggle do showNewPicker), mas a "abinha" fica
                // visível por padrão enquanto o form NEW.AREA está aberto.
                onClose={() => {}}
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
              border: 'none', borderBottom: '1px solid var(--color-ice-deep)',
              color: 'var(--color-ice-light)',
              fontFamily: 'var(--font-display)',
              fontSize: 14, padding: '6px 2px',
              outline: 'none', fontWeight: 600,
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-ice)')}
            onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--color-ice-deep)')}
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            style={{
              background: newName.trim() ? 'rgba(143, 191, 211, 0.14)' : 'rgba(8, 12, 18, 0.55)',
              border: `1px solid ${newName.trim() ? 'var(--color-ice)' : 'var(--color-border)'}`,
              color: newName.trim() ? 'var(--color-ice-light)' : 'var(--color-text-muted)',
              cursor: newName.trim() ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--font-mono)',
              fontSize: 10, fontWeight: 700,
              padding: '7px 14px',
              letterSpacing: '0.22em', textTransform: 'uppercase',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
              boxShadow: newName.trim() ? '0 0 12px rgba(143, 191, 211, 0.25)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            ✓ CRIAR
          </button>
          <button
            onClick={() => { setCreating(false); setNewName('') }}
            title="Cancelar"
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
              e.currentTarget.style.color = 'var(--color-accent-light)'
              e.currentTarget.style.borderColor = 'rgba(159, 18, 57, 0.45)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-tertiary)'
              e.currentTarget.style.borderColor = 'var(--color-border)'
            }}
          >
            ✕
          </button>
        </section>
      )}

      <section style={{ marginTop: creating ? 0 : 24 }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10, fontWeight: 700,
          color: 'var(--color-ice-light)',
          letterSpacing: '0.25em', textTransform: 'uppercase',
          marginBottom: 14,
          paddingBottom: 8,
          borderBottom: '1px solid var(--color-ice-deep)',
          display: 'flex', alignItems: 'center', gap: 8,
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
          DOMAINS.LIST
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 700 }}>
            [{areas.length.toString().padStart(2, '0')}]
          </span>
        </div>
        {areas.length === 0 ? (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10, fontWeight: 700,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.18em', textTransform: 'uppercase',
            padding: '20px 0',
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            NENHUMA ÁREA REGISTRADA · CLIQUE EM "+ NOVA ÁREA"
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {areas.map(a => (
              <AreaRow
                key={a.slug}
                area={a}
                questCount={questsByArea[a.slug] ?? 0}
                deliverableCount={delivByArea[a.slug]?.total ?? 0}
                deliverableDoneCount={delivByArea[a.slug]?.done ?? 0}
                projectCount={projectsByArea[a.slug] ?? 0}
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
          background: 'rgba(8, 12, 18, 0.55)',
          border: '1px solid var(--color-border)',
          cursor: 'pointer',
          color: 'var(--color-text-tertiary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 9, fontWeight: 700,
          marginBottom: 18,
          letterSpacing: '0.22em', textTransform: 'uppercase',
          padding: '6px 12px',
          borderRadius: 0,
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
          transition: 'all 0.15s',
          textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = 'var(--color-ice-light)'
          e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
          e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
          e.currentTarget.style.boxShadow = '0 0 12px rgba(143, 191, 211, 0.18)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = 'var(--color-text-tertiary)'
          e.currentTarget.style.borderColor = 'var(--color-border)'
          e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        ← VOLTAR
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

  const handleDeleteProject = async (projectId: string) => {
    const ok = await confirmDialog({
      title: 'Excluir projeto',
      message: 'Tem certeza que deseja excluir este projeto?\nTodos os entregáveis e quests dentro dele também serão excluídos.',
      confirmLabel: 'EXCLUIR',
      danger: true,
    })
    if (!ok) return
    deleteProject(projectId)
      .then(() => {
        if (selectedProjectId === projectId) onSelectProject(null)
        onProjectDelete(projectId)
      })
      .catch(err => reportApiError('AreasPage.deleteProject', err))
  }

  const handleCompleteProject = async (projectId: string) => {
    const ok = await confirmDialog({
      title: 'Finalizar projeto',
      message: 'Marcar este projeto como finalizado?',
      confirmLabel: 'FINALIZAR',
      variant: 'success',
    })
    if (!ok) return
    onProjectUpdate(projectId, { status: 'done', completed_at: new Date().toISOString() })
  }

  const handleArchiveProject = async (projectId: string) => {
    const ok = await confirmDialog({
      title: 'Arquivar projeto',
      message: 'Arquivar este projeto?\nEle sai da lista principal mas continua acessível na seção "arquivados".',
      confirmLabel: 'ARQUIVAR',
    })
    if (!ok) return
    onProjectUpdate(projectId, { archived_at: new Date().toISOString() })
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
        <div>// AREA.{area.slug.toUpperCase()} · {total} PROJECTS · {closed} CLOSED</div>
      }
    >

      {!creatingProject ? (
        <div style={{ marginTop: 24 }}>
          <button
            onClick={() => setCreatingProject(true)}
            style={{
              background: 'rgba(143, 191, 211, 0.10)',
              border: '1px solid rgba(143, 191, 211, 0.45)',
              cursor: 'pointer',
              color: 'var(--color-ice-light)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10, fontWeight: 700,
              padding: '8px 16px',
              letterSpacing: '0.22em', textTransform: 'uppercase',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
              boxShadow: '0 0 12px rgba(143, 191, 211, 0.18)',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(143, 191, 211, 0.20)'
              e.currentTarget.style.boxShadow = '0 0 18px rgba(143, 191, 211, 0.40)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
              e.currentTarget.style.boxShadow = '0 0 12px rgba(143, 191, 211, 0.18)'
            }}
          >
            + CRIAR PROJETO
          </button>
        </div>
      ) : (
      <div style={{
        marginTop: 24,
        padding: '14px 16px',
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid var(--color-ice-deep)',
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
        display: 'flex', gap: 12, alignItems: 'center',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9, fontWeight: 700,
          color: 'var(--color-ice-light)',
          letterSpacing: '0.22em', textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
          NEW.PROJECT
        </span>
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
            border: 'none', borderBottom: '1px solid var(--color-ice-deep)',
            color: 'var(--color-ice-light)',
            fontFamily: 'var(--font-display)',
            padding: '6px 2px', fontSize: 14,
            outline: 'none', fontWeight: 600,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-ice)')}
          onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--color-ice-deep)')}
        />
        <button
          onClick={handleCreateProject}
          disabled={!newProjectTitle.trim()}
          style={{
            background: newProjectTitle.trim() ? 'rgba(143, 191, 211, 0.14)' : 'rgba(8, 12, 18, 0.55)',
            border: `1px solid ${newProjectTitle.trim() ? 'var(--color-ice)' : 'var(--color-border)'}`,
            color: newProjectTitle.trim() ? 'var(--color-ice-light)' : 'var(--color-text-muted)',
            cursor: newProjectTitle.trim() ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-mono)',
            padding: '7px 14px', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.22em', textTransform: 'uppercase',
            borderRadius: 0,
            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
            boxShadow: newProjectTitle.trim() ? '0 0 12px rgba(143, 191, 211, 0.25)' : 'none',
            transition: 'all 0.15s',
          }}
        >
          ✓ CRIAR
        </button>
        <button
          onClick={() => { setCreatingProject(false); setNewProjectTitle('') }}
          title="Cancelar"
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
            e.currentTarget.style.color = 'var(--color-accent-light)'
            e.currentTarget.style.borderColor = 'rgba(159, 18, 57, 0.45)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--color-text-tertiary)'
            e.currentTarget.style.borderColor = 'var(--color-border)'
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
        <div style={{ marginTop: 28, paddingTop: 14, borderTop: '1px solid var(--color-divider)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setShowDone(o => !o)} style={{
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid rgba(94, 122, 82, 0.45)',
              cursor: 'pointer',
              color: 'var(--color-success-light)',
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              padding: '5px 10px',
              letterSpacing: '0.22em', textTransform: 'uppercase',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}>
              <span style={{ fontSize: 9 }}>{showDone ? '▼' : '▶'}</span>
              <span style={{ color: 'var(--color-success)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              {doneInRange.length.toString().padStart(2, '0')} CONCLUÍDO{doneInRange.length !== 1 ? 'S' : ''}
            </button>
            <DateRangeFilter value={doneRange} onChange={setDoneRange} />
          </div>
          {showDone && doneInRange.length === 0 && (
            <div style={{
              marginTop: 12,
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.18em', textTransform: 'uppercase',
            }}>
              <span style={{ color: 'var(--color-success)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              NENHUM CONCLUÍDO NO PERÍODO ({doneAll.length} NO TOTAL)
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
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setShowCancelled(o => !o)} style={{
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid rgba(159, 18, 57, 0.45)',
              cursor: 'pointer',
              color: 'var(--color-accent-light)',
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              padding: '5px 10px',
              letterSpacing: '0.22em', textTransform: 'uppercase',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}>
              <span style={{ fontSize: 9 }}>{showCancelled ? '▼' : '▶'}</span>
              <span style={{ color: 'var(--color-accent-primary)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              {cancelledInRange.length.toString().padStart(2, '0')} CANCELADO{cancelledInRange.length !== 1 ? 'S' : ''}
            </button>
            <DateRangeFilter value={cancelledRange} onChange={setCancelledRange} />
          </div>
          {showCancelled && cancelledInRange.length === 0 && (
            <div style={{
              marginTop: 12,
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.18em', textTransform: 'uppercase',
            }}>
              <span style={{ color: 'var(--color-accent-primary)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              NENHUM CANCELADO NO PERÍODO ({cancelledAll.length} NO TOTAL)
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
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setShowArchived(o => !o)} style={{
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              padding: '5px 10px',
              letterSpacing: '0.22em', textTransform: 'uppercase',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}>
              <span style={{ fontSize: 9 }}>{showArchived ? '▼' : '▶'}</span>
              <span style={{ color: 'var(--color-text-muted)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              {archivedInRange.length.toString().padStart(2, '0')} ARQUIVADO{archivedInRange.length !== 1 ? 'S' : ''}
            </button>
            <DateRangeFilter value={archivedRange} onChange={setArchivedRange} />
          </div>
          {showArchived && archivedInRange.length === 0 && (
            <div style={{
              marginTop: 12,
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.18em', textTransform: 'uppercase',
            }}>
              <span style={{ color: 'var(--color-text-muted)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              NENHUM ARQUIVADO NO PERÍODO ({archivedAll.length} NO TOTAL)
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
      style={{
        padding: '12px 14px',
        background: isSelected
          ? 'rgba(143, 191, 211, 0.08)'
          : 'rgba(8, 12, 18, 0.55)',
        border: `1px solid ${isSelected
          ? 'rgba(143, 191, 211, 0.45)'
          : 'rgba(143, 191, 211, 0.22)'}`,
        borderLeft: `2px solid ${areaColor}`,
        cursor: 'pointer',
        borderRadius: 0,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
        marginBottom: 6,
        boxShadow: isSelected ? `0 0 14px ${areaColor}33` : 'none',
        transition: 'background var(--motion-fast) var(--ease-smooth), border-color var(--motion-fast) var(--ease-smooth), box-shadow var(--motion-fast) var(--ease-smooth), transform var(--motion-fast) var(--ease-smooth)',
      }}
      onMouseEnter={e => {
        if (isSelected) return
        e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
        e.currentTarget.style.boxShadow = `0 0 12px ${areaColor}33`
        e.currentTarget.style.transform = 'translateX(2px)'
      }}
      onMouseLeave={e => {
        if (isSelected) return
        e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.22)'
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.transform = 'translateX(0)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            color: 'var(--color-text-primary)',
            fontSize: 14, fontWeight: 600,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {project.title}
          </div>

          <div style={{
            marginTop: 6,
            display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            letterSpacing: '0.18em', textTransform: 'uppercase',
          }}>
            <span style={{ color: priority.color }}>
              {priority.label}
            </span>

            {daysAway !== null && (
              <span style={{ color: overdue ? 'var(--color-accent-vivid)' : 'var(--color-text-tertiary)' }}>
                <span style={{ color: 'var(--color-text-muted)', marginRight: 4 }}>DL</span>
                {urgencyText(daysAway).toUpperCase()}
              </span>
            )}

            {totalEstMin > 0 && (
              <span style={{ color: 'var(--color-text-tertiary)' }}>
                <span style={{ color: 'var(--color-text-muted)', marginRight: 4 }}>EST</span>
                {fmtMinLabel(totalEstMin)}
              </span>
            )}

            {delivs.length > 0 && (
              <span style={{ color: 'var(--color-text-tertiary)' }}>
                <span style={{ color: 'var(--color-text-muted)', marginRight: 4 }}>DELV</span>
                {doneCount}/{delivs.length}
              </span>
            )}
          </div>

          {(nextDeliv || nextQuest) && (
            <div style={{
              marginTop: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 600,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.15em', textTransform: 'uppercase',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>NEXT </span>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {nextDeliv?.title ?? ''}
                {nextQuest && nextQuest.title !== nextDeliv?.title && (
                  <>
                    {nextDeliv && <span style={{ color: 'var(--color-text-muted)' }}> · </span>}
                    <span style={{ color: 'var(--color-ice-light)' }}>{nextQuest.title}</span>
                  </>
                )}
              </span>
            </div>
          )}

          {/* Mini progress bar 10-segment */}
          {total > 0 && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, display: 'flex', gap: 1 }}>
                {Array.from({ length: 10 }).map((_, i) => {
                  const filled = (pct / 10) > i
                  return (
                    <div
                      key={i}
                      style={{
                        flex: 1, height: 4,
                        background: filled
                          ? (pct >= 100 ? 'var(--color-success)' : areaColor)
                          : 'rgba(255, 255, 255, 0.06)',
                        boxShadow: filled
                          ? `0 0 4px ${pct >= 100 ? 'var(--color-success)' : areaColor}`
                          : 'none',
                      }}
                    />
                  )
                })}
              </div>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: pct >= 100 ? 'var(--color-success-light)' : 'var(--color-text-secondary)',
                letterSpacing: '0.12em',
                minWidth: 32, textAlign: 'right',
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
                background: 'rgba(94, 122, 82, 0.14)',
                border: '1px solid var(--color-success)',
                cursor: 'pointer',
                color: 'var(--color-success-light)',
                fontFamily: 'var(--font-mono)',
                padding: '5px 10px', marginLeft: 4,
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700,
                borderRadius: 0,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                boxShadow: '0 0 10px rgba(94, 122, 82, 0.25)',
                transition: 'background 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(94, 122, 82, 0.22)'
                e.currentTarget.style.boxShadow = '0 0 16px rgba(94, 122, 82, 0.50)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(94, 122, 82, 0.14)'
                e.currentTarget.style.boxShadow = '0 0 10px rgba(94, 122, 82, 0.25)'
              }}
            >
              <CheckCircle2 size={11} strokeWidth={2.2} />
              FINALIZAR
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
