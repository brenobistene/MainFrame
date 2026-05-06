import { useEffect, useState } from 'react'
import { CheckCircle2, CheckCircle, Pencil, Trash2, XCircle, GripVertical } from 'lucide-react'
import type { Area, Project, Quest, FinParcela, FinPaymentTemplate, FinClient, FinHourlyRateStats } from '../types'
import {
  fetchQuestsByProject, fetchDeliverables,
  createQuest, deleteQuest,
  createDeliverable, updateDeliverable, deleteDeliverable, reorderDeliverables,
  fetchSessions,
  fetchFinParcelas, createFinParcela, applyFinParcelaTemplate,
  updateFinParcela, deleteFinParcela,
  fetchFinClients, fetchFinHourlyRateStats,
  reportApiError,
} from '../api'
import { parseIsoAsUtc, sumClosedSessionsSeconds, formatHMS, parseTimeToMinutes, minutesToHmm, isValidDateInput } from '../utils/datetime'
import { formatDateBR } from '../utils/quests'
import { InlineText } from './ui/InlineText'
import { Label } from './ui/Label'
import { PrioritySelect } from './PrioritySelect'
import { StatusDropdown } from './StatusDropdown'
import { BlockEditor, isBlockDocEmpty } from './BlockEditor'
import { Card } from './ui/Primitives'
import {
  modalOverlay as sharedModalOverlay,
  modalShell, modalHairline, modalHeader, modalBody,
} from '../pages/finance/components/styleHelpers'

type Deliverable = {
  id: string
  title: string
  done: boolean
  estimated_minutes?: number | null
  deadline?: string | null
  executed_minutes?: number
  minutes_worked?: number
  sort_order?: number
}

/**
 * Painel de detalhe do PROJETO. Mostra título editável, área/status/deadline,
 * lista de deliverables com CRUD inline + drag-reorder, e dentro de cada
 * deliverable a lista de quests (subtarefas) com Play, descrição notion-like,
 * edição inline, drag-reorder e criação scoped.
 *
 * Project e Quest agora são entidades SEPARADAS — este painel edita apenas
 * Project no header e passa callbacks dedicados pra cada nível.
 */
export function QuestDetailPanel({
  project,
  onClose,
  onProjectUpdate,
  onQuestUpdate,
  quests: quests,
  area,
  onQuestCreate,
  onQuestDelete,
  onSessionUpdate,
}: {
  project: Project
  onClose: () => void
  onProjectUpdate: (id: string, patch: Partial<Project>) => void
  onQuestUpdate: (id: string, patch: Partial<Quest>) => void
  quests: Quest[]
  area?: Area
  onQuestCreate: (q: Quest) => void
  onQuestDelete: (id: string) => void
  onSessionUpdate?: () => void
}) {
  // area + onSessionUpdate recebidos pra API completa da página-cliente mas
  // não usados diretamente aqui (herdados de quando o painel suportava
  // subtarefas inline).
  void area; void onSessionUpdate;
  // Subtasks carregadas do backend (escopadas ao projeto). Usamos estado
  // local pra UI ser responsiva — updates otimistas refletem aqui antes do
  // refetch.
  const [subtasks, setSubtasks] = useState<Quest[]>([])
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])
  const [newDeliverableTitle, setNewDeliverableTitle] = useState('')
  const [newDeliverableDeadline, setNewDeliverableDeadline] = useState<string>('')
  const [creatingDeliverable, setCreatingDeliverable] = useState(false)
  // Quais entregáveis estão com a lista de quests expandida. Começa sempre
  // expandido pra dar visibilidade; usuário colapsa se quiser.
  const [collapsedDelivIds, setCollapsedDelivIds] = useState<Set<string>>(new Set())
  // Quais quests (dentro dos cards) estão com detalhes abertos.
  const [expandedQuestIds, setExpandedQuestIds] = useState<Set<string>>(new Set())
  // Título da nova quest por deliverable (input scoped ao card).
  const [newQuestByDeliv, setNewQuestByDeliv] = useState<Record<string, string>>({})
  // Tempo estimado da nova quest por deliverable (em minutos ou h:mm).
  const [newQuestEstByDeliv, setNewQuestEstByDeliv] = useState<Record<string, string>>({})
  // Sessões por quest — necessário pra mostrar "tempo gasto" no card compacto.
  const [sessionsByQuest, setSessionsByQuest] = useState<Record<string, { started_at: string; ended_at: string | null }[]>>({})
  // Draft local para descrição de cada quest — salva com debounce.
  const [descriptionDraft, setDescriptionDraft] = useState<Record<string, string>>({})
  // Draft local pras "informações detalhadas" (notes) do projeto — mesma
  // lógica de debounce, mas escopado num único campo só.
  const [notesDraft, setNotesDraft] = useState<string | null>(null)
  // Drag-and-drop state para reordenação de entregáveis
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [hasManualOrder, setHasManualOrder] = useState(false)
  // Drag-and-drop state para reordenação de quests (session-only)
  const [draggedQuestId, setDraggedQuestId] = useState<string | null>(null)
  const [dragOverQuestId, setDragOverQuestId] = useState<string | null>(null)
  const [questOrder, setQuestOrder] = useState<Record<string, string[]>>({})

  // Quantos projetos ativos tem nessa área (exceto este). Usado pro breadcrumb.
  const areaQuestCount = quests ? quests.filter(q => q.area_slug === project.area_slug && q.status !== 'done').length : 0

  useEffect(() => {
    fetchQuestsByProject(project.id).then(setSubtasks).catch(err => reportApiError('QuestDetailPanel', err))
    fetchDeliverables(project.id).then(setDeliverables).catch(err => reportApiError('QuestDetailPanel', err))
  }, [project.id])

  // Carrega sessões de todas as subtasks pra poder mostrar `tempo gasto` nos
  // cards compactos dentro dos deliverables. N requests em paralelo — aceitável
  // pra projetos com até ~30 quests.
  useEffect(() => {
    if (subtasks.length === 0) { setSessionsByQuest({}); return }
    let cancelled = false
    Promise.all(subtasks.map(st =>
      fetchSessions(st.id)
        .then(s => ({ id: st.id, sessions: (s as any[]).map(x => ({ started_at: x?.started_at ?? '', ended_at: x?.ended_at ?? null })) }))
        .catch(() => ({ id: st.id, sessions: [] as { started_at: string; ended_at: string | null }[] }))
    )).then(results => {
      if (cancelled) return
      const map: Record<string, { started_at: string; ended_at: string | null }[]> = {}
      for (const r of results) map[r.id] = r.sessions
      setSessionsByQuest(map)
    })
    return () => { cancelled = true }
  }, [subtasks.map(s => s.id).join(',')])

  // Auto-save descrição com debounce quando o draft mudar. Trata doc-vazio
  // do BlockEditor como `null` pra não poluir o banco com JSON vazio.
  useEffect(() => {
    const timeoutIds: Record<string, ReturnType<typeof setTimeout>> = {}
    const keys = Object.keys(descriptionDraft)

    keys.forEach(questId => {
      const draft = descriptionDraft[questId]
      const current = subtasks.find(st => st.id === questId)?.description ?? null

      if (draft !== (current ?? '')) {
        timeoutIds[questId] = setTimeout(() => {
          const newVal = isBlockDocEmpty(draft) ? null : draft
          if (newVal !== current) {
            handleUpdate(questId, { description: newVal })
          }
        }, 800)
      }
    })

    return () => Object.values(timeoutIds).forEach(t => clearTimeout(t))
  }, [descriptionDraft, subtasks])

  // Auto-save dos notes do projeto com a mesma lógica. Dispara só quando
  // `notesDraft` é não-nulo (ou seja, o usuário editou nesta sessão).
  useEffect(() => {
    if (notesDraft === null) return
    const current = project.notes ?? null
    if (notesDraft === (current ?? '')) return
    const t = setTimeout(() => {
      const newVal = isBlockDocEmpty(notesDraft) ? null : notesDraft
      if (newVal !== current) onProjectUpdate(project.id, { notes: newVal })
    }, 800)
    return () => clearTimeout(t)
  }, [notesDraft, project.notes, project.id, onProjectUpdate])

  // Update otimista de subtask + dispara o callback global do App.
  // Quando o patch muda `status` ou `deliverable_id`, espelhamos a regra
  // do backend (entregável vira done quando todas as quests filhas estão
  // fechadas) AQUI mesmo, otimisticamente — assim a checkbox e a barra
  // atualizam na hora.
  //
  // ATENÇÃO: NÃO fazer refetch aqui. `onQuestUpdate` dispara `patchQuest`
  // assíncrono no App.tsx. Um fetchDeliverables imediato corre em paralelo
  // com o PATCH e frequentemente ganha — vê o estado antigo e sobrescreve o
  // `done` otimista. Resultado: tickar/destickar a última quest faz o
  // entregável "piscar" pro estado errado. A reconciliação acontece no
  // próximo mount do painel.
  const handleUpdate = (id: string, patch: Partial<Quest>) => {
    const prev = subtasks.find(st => st.id === id)
    const newSubtasks = subtasks.map(st => st.id === id ? { ...st, ...patch } : st)
    setSubtasks(newSubtasks)
    onQuestUpdate(id, patch)
    if ('status' in patch || 'deliverable_id' in patch) {
      const affected = new Set<string>()
      if (prev?.deliverable_id) affected.add(prev.deliverable_id)
      const newDelivId = (patch.deliverable_id ?? prev?.deliverable_id) as string | null | undefined
      if (newDelivId) affected.add(newDelivId)
      setDeliverables(ds => ds.map(d => {
        if (!affected.has(d.id)) return d
        const sibs = newSubtasks.filter(q => q.deliverable_id === d.id)
        const allClosed = sibs.length > 0 && sibs.every(q => q.status === 'done' || q.status === 'cancelled')
        return { ...d, done: allClosed }
      }))
    }
  }

  function addQuestToDeliverable(delivId: string) {
    const title = (newQuestByDeliv[delivId] || '').trim()
    if (!title) return
    const estimatedMinutes = parseTimeToMinutes(newQuestEstByDeliv[delivId] || '')
    createQuest({
      title,
      area_slug: project.area_slug,
      project_id: project.id,
      deliverable_id: delivId,
      estimated_minutes: estimatedMinutes,
    })
      .then(q => {
        fetchQuestsByProject(project.id).then(setSubtasks).catch(err => reportApiError('QuestDetailPanel', err))
        setNewQuestByDeliv(prev => ({ ...prev, [delivId]: '' }))
        setNewQuestEstByDeliv(prev => ({ ...prev, [delivId]: '' }))
        if (onQuestCreate) onQuestCreate(q)
      })
      .catch((err: any) => {
        console.error('Erro ao criar quest:', err)
        alert(err?.message ?? 'Erro ao criar quest')
      })
  }

  function removeSubtask(id: string) {
    if (!window.confirm('Deletar esta quest?')) return
    deleteQuest(id)
      .then(() => {
        setSubtasks(s => s.filter(st => st.id !== id))
        if (onQuestDelete) onQuestDelete(id)
      })
      .catch(err => reportApiError('QuestDetailPanel', err))
  }

  function toggleQuestDone(q: Quest) {
    const nextStatus = q.status === 'done' ? 'pending' : 'done'
    handleUpdate(q.id, { status: nextStatus })
  }

  function addDeliverable() {
    if (!newDeliverableTitle.trim()) return
    createDeliverable(project.id, newDeliverableTitle, {
      deadline: newDeliverableDeadline || null,
    })
      .then(newDeliv => {
        setDeliverables([...deliverables, newDeliv])
        setNewDeliverableTitle('')
        setNewDeliverableDeadline('')
        setCreatingDeliverable(false)
      })
      .catch(err => {
        console.error('Erro ao criar entregável:', err)
      })
  }

  function toggleDeliverableDone(id: string) {
    const deliv = deliverables.find(d => d.id === id)
    if (!deliv) return
    updateDeliverable(id, { done: !deliv.done })
      .then(updated => {
        setDeliverables(prev => prev.map(d => d.id === id ? updated : d))
      })
      .catch(err => reportApiError('QuestDetailPanel', err))
  }

  function patchDeliverable(id: string, patch: Partial<Deliverable>) {
    // Optimistic update pra UI responder na hora; rollback em erro.
    const prev = deliverables
    setDeliverables(prev.map(d => d.id === id ? { ...d, ...patch } : d))
    updateDeliverable(id, patch)
      .then(updated => setDeliverables(curr => curr.map(d => d.id === id ? updated : d)))
      .catch(() => setDeliverables(prev))
  }

  function handleDeleteDeliverable(id: string) {
    if (!window.confirm('Deletar este entregável?')) return
    deleteDeliverable(id)
      .then(() => setDeliverables(prev => prev.filter(d => d.id !== id)))
      .catch((err: any) => {
        // 409 quando ainda tem quests amarradas
        alert(err?.detail ?? err?.message ?? 'Erro ao deletar entregável')
      })
  }

  function toggleDelivCollapsed(id: string) {
    setCollapsedDelivIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleQuestExpanded(id: string) {
    setExpandedQuestIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Formata minutos como "2h 30m" ou "45m".
  const fmtMin = (m: number): string => {
    const h = Math.floor(m / 60)
    const r = m % 60
    if (h > 0 && r > 0) return `${h}h ${r}m`
    if (h > 0) return `${h}h`
    return `${r}m`
  }

  const questsForDelivId = (delivId: string) =>
    subtasks.filter(st => st.deliverable_id === delivId)

  const getQuestsForDelivInOrder = (delivId: string) => {
    const quests = questsForDelivId(delivId)
    if (!questOrder[delivId]) return quests
    const order = questOrder[delivId]
    return order.map(id => quests.find(q => q.id === id)).filter(Boolean) as Quest[]
  }

  const questDurationSec = (questId: string) =>
    sumClosedSessionsSeconds(sessionsByQuest[questId] ?? [])

  const completedDeliverables = deliverables.filter(d => d.done).length

  // Calcula tempo estimado de um entregável somando as quests filhas
  const getDeliverableEstimated = (delivId: string) =>
    questsForDelivId(delivId).reduce((sum, q) => sum + (q.estimated_minutes ?? 0), 0)

  // Totais do projeto: previsto = soma de tempos estimados dos entregáveis (calculado a partir das quests);
  // executado = soma de `worked_minutes` das subquests (tempo real de sessão).
  const totalEstimatedMin = deliverables.reduce((s, d) => s + getDeliverableEstimated(d.id), 0)
  const totalExecutedMin = subtasks.reduce((s, q) => s + (q.worked_minutes ?? 0), 0)
  // Progresso da barra = entregáveis concluídos, ponderados pelo tempo previsto
  // de cada um. Se nenhum tem estimativa, cai pra contagem simples (N/total).
  // Assim, tickar um entregável move a barra imediatamente.
  const doneEstimatedMin = deliverables.filter(d => d.done).reduce((s, d) => s + getDeliverableEstimated(d.id), 0)
  const totalProgressPct = (() => {
    if (totalEstimatedMin > 0) return Math.min(100, Math.round((doneEstimatedMin / totalEstimatedMin) * 100))
    if (deliverables.length > 0) return Math.round((completedDeliverables / deliverables.length) * 100)
    return 0
  })()

  const sortedDeliverables = hasManualOrder
    ? deliverables
    : [...deliverables].sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0
      if (!a.deadline) return 1
      if (!b.deadline) return -1
      return a.deadline.localeCompare(b.deadline)
    })

  function handleDragStart(id: string) {
    setDraggedId(id)
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault()
    if (id !== draggedId) setDragOverId(id)
  }

  function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) { setDraggedId(null); setDragOverId(null); return }
    const list = [...sortedDeliverables]
    const fromIdx = list.findIndex(d => d.id === draggedId)
    const toIdx = list.findIndex(d => d.id === targetId)
    const [moved] = list.splice(fromIdx, 1)
    list.splice(toIdx, 0, moved)
    setDeliverables(list)
    setHasManualOrder(true)
    setDraggedId(null)
    setDragOverId(null)
    reorderDeliverables(project.id, list.map(d => d.id)).catch(err => reportApiError('QuestDetailPanel.reorderDeliverables', err))
  }

  function handleDragEnd() {
    setDraggedId(null)
    setDragOverId(null)
  }

  function handleQuestDragStart(questId: string) {
    setDraggedQuestId(questId)
  }

  function handleQuestDragOver(e: React.DragEvent, questId: string) {
    e.preventDefault()
    setDragOverQuestId(questId)
  }

  function handleQuestDrop(targetQuestId: string, delivId: string) {
    if (!draggedQuestId || draggedQuestId === targetQuestId) {
      setDraggedQuestId(null)
      setDragOverQuestId(null)
      return
    }
    const questsInDeliv = questsForDelivId(delivId)
    const fromIdx = questsInDeliv.findIndex(q => q.id === draggedQuestId)
    const toIdx = questsInDeliv.findIndex(q => q.id === targetQuestId)
    if (fromIdx === -1 || toIdx === -1) {
      setDraggedQuestId(null)
      setDragOverQuestId(null)
      return
    }
    const reordered = [...questsInDeliv]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    setQuestOrder(prev => ({ ...prev, [delivId]: reordered.map(q => q.id) }))
    setDraggedQuestId(null)
    setDragOverQuestId(null)
  }

  function handleQuestDragEnd() {
    setDraggedQuestId(null)
    setDragOverQuestId(null)
  }

  // Controle de edição inline: só uma célula editando por vez. Formato:
  // `{delivId}:deadline` ou `{delivId}:estimated`. Click abre, blur/Enter fecha.
  const [editingField, setEditingField] = useState<string | null>(null)

  return (
    <Card padding="none" style={{
      animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
    }}>
      {/* Hairline ice elétrica — assinatura HUD CP2077 */}
      <div className="hq-hairline-ice" />
      {/* Header com atmosphere ice/fog — fechar + título do projeto */}
      <div style={{
        padding: 'var(--space-5) var(--space-6) var(--space-4)',
        background: `
          radial-gradient(ellipse 100% 80% at 0% 0%, rgba(143, 191, 211, 0.05), transparent 60%),
          radial-gradient(ellipse 60% 80% at 100% 0%, rgba(50, 62, 73, 0.20), transparent 65%),
          linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
        `,
        borderBottom: '1px solid var(--color-divider)',
      }}>
      <button onClick={onClose} style={{
        background: 'none', border: '1px solid transparent', cursor: 'pointer',
        color: 'var(--color-text-tertiary)', fontSize: 10, marginBottom: 20,
        textTransform: 'uppercase', letterSpacing: '0.1em',
        transition: 'all 0.2s', padding: '6px 8px', borderRadius: 4,
      }}
        onMouseEnter={e => {
          e.currentTarget.style.color = 'var(--color-accent-light)'
          e.currentTarget.style.borderColor = 'var(--color-border)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = 'var(--color-text-tertiary)'
          e.currentTarget.style.borderColor = 'transparent'
        }}
      >
        ✕ fechar
      </button>

      <div style={{ marginBottom: 0 }}>
        <InlineText
          value={project.title}
          onSave={v => onProjectUpdate(project.id, { title: v })}
          style={{ color: 'var(--color-text-primary)', fontSize: 22, fontWeight: 700, display: 'block', letterSpacing: '-0.01em' }}
        />
        {(totalEstimatedMin > 0 || totalExecutedMin > 0 || deliverables.length > 0) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
            marginTop: 10,
            fontSize: 11, fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-tertiary)',
          }}>
            {totalEstimatedMin > 0 && (
              <span>
                <span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginRight: 6 }}>previsto</span>
                {fmtMin(totalEstimatedMin)}
              </span>
            )}
            {totalExecutedMin > 0 && (
              <span>
                <span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginRight: 6 }}>executado</span>
                <span style={{
                  color: totalEstimatedMin > 0 && totalExecutedMin > totalEstimatedMin
                    ? 'var(--color-accent-primary)'
                    : 'var(--color-text-secondary)',
                }}>
                  {fmtMin(totalExecutedMin)}
                </span>
                {totalEstimatedMin > 0 && ` · ${totalProgressPct}%`}
              </span>
            )}
            {deliverables.length > 0 && (
              <span>
                <span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginRight: 6 }}>entregáveis</span>
                {completedDeliverables}/{deliverables.length}
              </span>
            )}
            {subtasks.length > 0 && (
              <span>
                <span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginRight: 6 }}>quests</span>
                {subtasks.filter(q => q.status === 'done').length}/{subtasks.length}
              </span>
            )}
          </div>
        )}

        {deliverables.length > 0 && (
          <div style={{ marginTop: 12, maxWidth: 520 }}>
            <div style={{
              height: 4, borderRadius: 2,
              background: 'var(--color-bg-tertiary)',
              overflow: 'hidden', position: 'relative',
            }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, totalProgressPct)}%`,
                background: totalProgressPct >= 100
                  ? 'var(--color-success)'
                  : 'var(--color-accent-light)',
                transition: 'width 0.3s ease-out',
              }} />
              {totalEstimatedMin > 0 && totalExecutedMin > totalEstimatedMin && (
                <div
                  title="Tempo executado passou do previsto"
                  style={{
                    position: 'absolute', top: 0, right: 0, bottom: 0,
                    width: 2, background: 'var(--color-accent-primary)',
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
      </div>
      <div style={{ padding: 'var(--space-5) var(--space-6)' }}>

      {/* Hub Finance — bloco financeiro do projeto. Mostrado pra área
          'freelas' ou quando valor_acordado já foi definido (não atrapalha
          quem não usa). Veja docs/hub-finance/PLAN.md. */}
      {(project.area_slug === 'freelas' || project.valor_acordado != null) && (
        <FinanceBlock
          project={project}
          totalExecutedMin={totalExecutedMin}
          onUpdateValor={(v) => onProjectUpdate(project.id, { valor_acordado: v })}
          onUpdateCliente={(id) => onProjectUpdate(project.id, { cliente_id: id })}
        />
      )}

      {/* Meta row: área · deadline · prioridade · finalizar/cancelar/reabrir. */}
      <div style={{
        display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap',
        marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid var(--color-divider)',
      }}>
          <span style={{
            fontSize: 10, color: 'var(--color-text-tertiary)',
            letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 700,
          }}>
            {project.area_slug}
          </span>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 9, color: 'var(--color-text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>
              deadline
            </span>
            <input
              type="date"
              autoComplete="off"
              value={project.deadline || ''}
              onChange={e => {
                if (isValidDateInput(e.target.value)) {
                  onProjectUpdate(project.id, { deadline: e.target.value || null })
                }
              }}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: '1px solid transparent',
                color: 'var(--color-text-primary)', fontSize: 12, padding: '4px 2px',
                outline: 'none', colorScheme: 'dark', fontFamily: 'var(--font-mono)',
                transition: 'border-color 0.15s',
              } as any}
              onMouseEnter={e => (e.currentTarget.style.borderBottomColor = 'var(--color-border)')}
              onMouseLeave={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderBottomColor = 'transparent' }}
              onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-accent-light)')}
              onBlur={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
            />
          </label>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 9, color: 'var(--color-text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>
              prioridade
            </span>
            <PrioritySelect
              value={project.priority || 'medium'}
              onChange={v => onProjectUpdate(project.id, { priority: v })}
            />
          </label>

          <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {project.status !== 'done' && project.status !== 'cancelled' ? (
              <>
                <button
                  onClick={() => {
                    if (window.confirm('Marcar este projeto como finalizado?')) {
                      // Seta completed_at localmente pro filtro "hoje" pegar
                      // imediatamente, antes do refetch do backend.
                      onProjectUpdate(project.id, { status: 'done', completed_at: new Date().toISOString() })
                    }
                  }}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--color-accent-primary)',
                    cursor: 'pointer',
                    color: 'var(--color-accent-primary)',
                    padding: '6px 12px', fontSize: 10, fontWeight: 700,
                    borderRadius: 3, letterSpacing: '0.1em', textTransform: 'uppercase',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'var(--color-accent-primary)'
                    e.currentTarget.style.color = 'var(--color-bg-primary)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--color-accent-primary)'
                  }}
                >
                  <CheckCircle2 size={11} strokeWidth={2.2} />
                  Finalizar
                </button>
                <button
                  onClick={() => {
                    if (window.confirm('Cancelar este projeto? Ele sai dos painéis de acompanhamento, mas fica no histórico.')) {
                      onProjectUpdate(project.id, { status: 'cancelled', completed_at: new Date().toISOString() })
                    }
                  }}
                  title="Cancelar projeto"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-text-muted)',
                    padding: '4px 6px', fontSize: 9, fontWeight: 500,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                >
                  cancelar
                </button>
              </>
            ) : project.status === 'done' ? (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 3,
                border: '1px solid var(--color-success)',
                background: 'rgba(90, 122, 106, 0.08)',
              }}>
                <CheckCircle2 size={11} strokeWidth={2.2} color="var(--color-success)" />
                <span style={{ fontSize: 10, color: 'var(--color-success)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                  Finalizado
                  {project.completed_at && (
                    <span style={{ color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', marginLeft: 6, fontWeight: 400 }}>
                      · {parseIsoAsUtc(project.completed_at).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => {
                    if (window.confirm('Reabrir este projeto? Ele volta para "em andamento".')) {
                      onProjectUpdate(project.id, { status: 'doing', completed_at: null })
                    }
                  }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-text-tertiary)', fontSize: 10,
                    padding: '0 4px', textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
                >
                  Reabrir
                </button>
              </div>
            ) : (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 3,
                border: '1px solid var(--color-text-tertiary)',
                background: 'var(--color-bg-tertiary)',
              }}>
                <XCircle size={11} strokeWidth={2.2} color="var(--color-text-tertiary)" />
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                  Cancelado
                  {project.completed_at && (
                    <span style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em', marginLeft: 6, fontWeight: 400 }}>
                      · {parseIsoAsUtc(project.completed_at).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => {
                    if (window.confirm('Reabrir este projeto? Ele volta para "em andamento".')) {
                      onProjectUpdate(project.id, { status: 'doing', completed_at: null })
                    }
                  }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-text-tertiary)', fontSize: 10,
                    padding: '0 4px', textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
                >
                  Reabrir
                </button>
              </div>
            )}
          </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{
          marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <Label>entregáveis{deliverables.length > 0 && ` (${deliverables.length})`}</Label>
          {!creatingDeliverable && (
            <button
              onClick={() => setCreatingDeliverable(true)}
              style={{
                background: 'none', border: '1px solid var(--color-border)', cursor: 'pointer',
                color: 'var(--color-text-tertiary)', fontSize: 10,
                padding: '5px 12px', borderRadius: 3,
                letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'var(--color-accent-light)'
                e.currentTarget.style.borderColor = 'var(--color-accent-light)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--color-text-tertiary)'
                e.currentTarget.style.borderColor = 'var(--color-border)'
              }}
            >
              + criar entregável
            </button>
          )}
        </div>

        {/* Novo entregável: título + deadline + criar */}
        {creatingDeliverable && (
        <div style={{
          display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
          marginBottom: 18, paddingBottom: 10, borderBottom: '1px solid var(--color-divider)',
        }}>
          <input
            type="text"
            autoComplete="off"
            value={newDeliverableTitle}
            onChange={e => setNewDeliverableTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addDeliverable() }}
            placeholder="Novo entregável…"
            style={{
              flex: '1 1 180px', minWidth: 160,
              background: 'transparent', border: 'none',
              borderBottom: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)', padding: '6px 2px', fontSize: 13,
              outline: 'none', transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-accent-primary)')}
            onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--color-border)')}
          />
          <input
            type="date"
            autoComplete="off"
            value={newDeliverableDeadline}
            onChange={e => {
              if (isValidDateInput(e.target.value)) setNewDeliverableDeadline(e.target.value)
            }}
            title="Deadline"
            style={{
              background: 'transparent', border: 'none',
              borderBottom: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)', padding: '6px 2px', fontSize: 12,
              outline: 'none', colorScheme: 'dark',
              fontFamily: 'var(--font-mono)',
              transition: 'border-color 0.15s',
            } as any}
            onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-accent-light)')}
            onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--color-border)')}
          />
          <button
            onClick={addDeliverable}
            disabled={!newDeliverableTitle.trim()}
            style={{
              background: newDeliverableTitle.trim() ? 'var(--color-accent-primary)' : 'var(--color-bg-tertiary)',
              color: newDeliverableTitle.trim() ? 'var(--color-bg-primary)' : 'var(--color-text-muted)',
              border: 'none',
              cursor: newDeliverableTitle.trim() ? 'pointer' : 'not-allowed',
              padding: '8px 14px', fontSize: 11, fontWeight: 700,
              borderRadius: 4, letterSpacing: '0.08em', textTransform: 'uppercase',
              transition: 'all 0.15s',
            }}
          >
            + novo
          </button>
          <button
            onClick={() => {
              setCreatingDeliverable(false)
              setNewDeliverableTitle('')
              setNewDeliverableDeadline('')
            }}
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

        {deliverables.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '8px 0' }}>
            Nenhum entregável ainda. Crie um acima — toda quest deste projeto precisa estar amarrada a um entregável.
          </div>
        )}

        {/* Cards dos entregáveis */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(() => {
            // Comparação por string YYYY-MM-DD evita o bug de timezone que
            // acontecia com `new Date(d.deadline) < new Date()` (o primeiro
            // parseia como UTC-midnight e vira ontem à noite em BRT).
            const _t = new Date()
            const todayYmd = `${_t.getFullYear()}-${String(_t.getMonth() + 1).padStart(2, '0')}-${String(_t.getDate()).padStart(2, '0')}`
            return sortedDeliverables.map(d => {
            const delivQuests = getQuestsForDelivInOrder(d.id)
            const activeQuests = delivQuests.filter(q => q.status !== 'done')
            const doneQuests = delivQuests.filter(q => q.status === 'done')
            const collapsed = collapsedDelivIds.has(d.id)
            const executed = d.executed_minutes ?? 0
            // Tempo estimado = soma dos tempos das quests filhas (calculado dinamicamente)
            const estimated = delivQuests.reduce((sum, q) => sum + (q.estimated_minutes ?? 0), 0)
            // Quando o entregável está feito (todas quests fechadas), barra crava 100%
            // mesmo que o tempo executado tenha ficado abaixo do estimado — senão fica
            // travada em 97% e parece bug.
            const pct = d.done
              ? 100
              : estimated > 0
                ? Math.min(100, Math.round((executed / estimated) * 100))
                : 0
            const over = estimated > 0 && executed > estimated
            const barColor = over
              ? 'var(--color-accent-primary)'
              : 'var(--color-success)'
            const deadlineOverdue = !!d.deadline && !d.done && d.deadline < todayYmd

            return (
              <div
                key={d.id}
                onDragOver={(e) => handleDragOver(e, d.id)}
                onDrop={() => handleDrop(d.id)}
                style={{
                  background: 'var(--color-bg-secondary)',
                  border: `1px solid ${d.done ? 'var(--color-success)' : 'var(--color-border)'}`,
                  borderLeft: `3px solid ${d.done ? 'var(--color-success)' : 'var(--color-accent-light)'}`,
                  borderRadius: 4,
                  padding: '12px 14px',
                  opacity: draggedId === d.id ? 0.45 : (d.done ? 0.75 : 1),
                  borderTop: dragOverId === d.id ? '2px solid var(--color-accent-primary)' : '1px solid transparent',
                  transition: 'opacity 0.15s, border-color 0.15s, border-top 0.15s',
                }}
              >
                {/* Header do card */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {!d.done && (
                    <div
                      draggable={true}
                      onDragStart={() => handleDragStart(d.id)}
                      onDragEnd={handleDragEnd}
                      style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
                    >
                      <GripVertical size={14} style={{ color: 'var(--color-text-muted)', cursor: 'grab', opacity: 0.5 }} />
                    </div>
                  )}
                  <button
                    onClick={() => toggleDeliverableDone(d.id)}
                    title={d.done ? 'Desmarcar como feito' : 'Marcar como feito'}
                    style={{
                      width: 18, height: 18, borderRadius: 3, flexShrink: 0,
                      border: `2px solid ${d.done ? 'var(--color-success)' : 'var(--color-text-tertiary)'}`,
                      background: d.done ? 'var(--color-success)' : 'transparent',
                      cursor: 'pointer', padding: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}
                  >
                    {d.done && <CheckCircle2 size={12} color="var(--color-bg-primary)" strokeWidth={3} />}
                  </button>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <InlineText
                      value={d.title}
                      onSave={(v) => patchDeliverable(d.id, { title: v })}
                      style={{
                        color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 600,
                        textDecoration: d.done ? 'line-through' : 'none',
                      }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 5, flexWrap: 'wrap', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                      {/* Deadline — display por padrão, input ao clicar. */}
                      {editingField === `${d.id}:deadline` ? (
                        <input
                          type="date"
                          autoComplete="off"
                          autoFocus
                          defaultValue={d.deadline ?? ''}
                          onChange={e => {
                            if (isValidDateInput(e.target.value)) {
                              patchDeliverable(d.id, { deadline: e.target.value || null })
                            }
                          }}
                          onBlur={() => setEditingField(null)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur()
                          }}
                          style={{
                            background: 'var(--color-bg-primary)',
                            border: '1px solid var(--color-accent-light)',
                            color: 'var(--color-text-primary)',
                            fontSize: 10, padding: '2px 5px', borderRadius: 2, outline: 'none',
                            fontFamily: 'var(--font-mono)',
                            colorScheme: 'dark',
                          } as any}
                        />
                      ) : (
                        <button
                          onClick={() => setEditingField(`${d.id}:deadline`)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: d.deadline
                              ? (deadlineOverdue ? 'var(--color-accent-light)' : 'var(--color-text-secondary)')
                              : 'var(--color-text-muted)',
                            fontSize: 10, padding: '2px 0', fontFamily: 'var(--font-mono)',
                            fontStyle: d.deadline ? 'normal' : 'italic',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
                          onMouseLeave={e => {
                            e.currentTarget.style.color = d.deadline
                              ? (deadlineOverdue ? 'var(--color-accent-light)' : 'var(--color-text-secondary)')
                              : 'var(--color-text-muted)'
                          }}
                        >
                          {d.deadline ? formatDateBR(d.deadline) : '+ prazo'}
                          {deadlineOverdue && <span style={{ marginLeft: 4 }}>· atrasado</span>}
                        </button>
                      )}

                      {/* Previsto — calculado dinamicamente a partir das quests filhas (read-only) */}
                      {estimated > 0 && (
                        <span style={{
                          color: 'var(--color-text-secondary)', fontSize: 10,
                          fontFamily: 'var(--font-mono)',
                        }}>
                          ~{fmtMin(estimated)} previsto
                        </span>
                      )}

                      {/* Executado (read-only) */}
                      {executed > 0 && (
                        <span style={{
                          color: over ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                        }}>
                          {fmtMin(executed)} feitos
                          {over && ` (+${fmtMin(executed - estimated)})`}
                        </span>
                      )}

                      <span style={{ color: 'var(--color-text-tertiary)' }}>
                        {doneQuests.length}/{delivQuests.length} quests
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => toggleDelivCollapsed(d.id)}
                    title={collapsed ? 'Mostrar quests' : 'Ocultar quests'}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--color-text-tertiary)', fontSize: 11, padding: '2px 6px',
                    }}
                  >
                    {collapsed ? '▶' : '▼'}
                  </button>
                </div>

                {/* Progress bar executado/previsto */}
                {(estimated > 0 || d.done) && (
                  <div style={{ marginTop: 8, height: 3, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${pct}%`, background: barColor,
                      transition: 'width 0.3s',
                    }} />
                  </div>
                )}

                {/* Lista de quests (colapsável) + input nova quest */}
                {!collapsed && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[...activeQuests, ...doneQuests].map(q => {
                      const sec = questDurationSec(q.id)
                      const expanded = expandedQuestIds.has(q.id)
                      return (
                        <div
                          key={q.id}
                          onDragOver={(e) => handleQuestDragOver(e, q.id)}
                          onDrop={() => handleQuestDrop(q.id, d.id)}
                          style={{
                            background: 'var(--color-bg-tertiary)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 3,
                            padding: '8px 10px',
                            opacity: draggedQuestId === q.id ? 0.45 : (q.status === 'done' ? 0.65 : 1),
                            borderTop: dragOverQuestId === q.id ? '2px solid var(--color-accent-primary)' : '1px solid transparent',
                            transition: 'opacity 0.15s, border-top 0.15s',
                          }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {q.status !== 'done' && (
                              <div
                                draggable={true}
                                onDragStart={() => handleQuestDragStart(q.id)}
                                onDragEnd={handleQuestDragEnd}
                                style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
                              >
                                <GripVertical size={12} style={{ color: 'var(--color-text-muted)', cursor: 'grab', opacity: 0.5 }} />
                              </div>
                            )}
                            <button
                              onClick={() => toggleQuestDone(q)}
                              title={q.status === 'done' ? 'Reabrir quest' : 'Marcar como feita'}
                              style={{
                                width: 14, height: 14, flexShrink: 0, padding: 0,
                                background: q.status === 'done' ? 'var(--color-success)' : 'transparent',
                                border: `1.5px solid ${q.status === 'done' ? 'var(--color-success)' : 'var(--color-text-tertiary)'}`,
                                borderRadius: '50%', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}
                            >
                              {q.status === 'done' && <CheckCircle2 size={9} color="var(--color-bg-primary)" strokeWidth={2.5} />}
                            </button>
                            <InlineText
                              value={q.title}
                              onSave={v => handleUpdate(q.id, { title: v })}
                              style={{
                                flex: 1, minWidth: 0, fontSize: 12,
                                color: q.status === 'done' ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                                textDecoration: q.status === 'done' ? 'line-through' : 'none',
                              }}
                            />
                            {q.estimated_minutes != null && q.estimated_minutes > 0 && (
                              <span
                                title="Tempo estimado"
                                style={{
                                  fontSize: 10, color: 'var(--color-text-tertiary)',
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                ~{fmtMin(q.estimated_minutes)}
                              </span>
                            )}
                            {sec > 0 && (
                              <span
                                title="Tempo real gasto (sessões)"
                                style={{
                                  fontSize: 10,
                                  color: q.status === 'done' ? 'var(--color-success)' : 'var(--color-text-secondary)',
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                {formatHMS(sec)}
                              </span>
                            )}
                            <button
                              onClick={() => toggleQuestExpanded(q.id)}
                              title={expanded ? 'Ocultar detalhes' : 'Mostrar detalhes'}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--color-text-tertiary)', fontSize: 10, padding: '2px 4px',
                              }}
                            >
                              {expanded ? '▼' : '▶'}
                            </button>
                          </div>

                          {expanded && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <div>
                                <span style={{ fontSize: 9, color: 'var(--color-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Descrição:</span>
                                <BlockEditor
                                  value={descriptionDraft[q.id] ?? q.description ?? ''}
                                  onChange={v => setDescriptionDraft(prev => ({ ...prev, [q.id]: v }))}
                                  placeholder="Digite / pra ver os blocos…"
                                  minHeight={80}
                                />
                              </div>
                              <div>
                                <span style={{ fontSize: 9, color: 'var(--color-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 6 }}>Próximo passo:</span>
                                <InlineText
                                  value={q.next_action ?? ''}
                                  onSave={v => handleUpdate(q.id, { next_action: v || null })}
                                  style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}
                                />
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 9, color: 'var(--color-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Estimativa:</span>
                                <input
                                  type="text"
                                  autoComplete="off"
                                  defaultValue={q.estimated_minutes ? minutesToHmm(q.estimated_minutes) : ''}
                                  placeholder="h:mm"
                                  onBlur={e => {
                                    const parsed = parseTimeToMinutes(e.target.value)
                                    const next = parsed ?? null
                                    if (next !== (q.estimated_minutes ?? null)) {
                                      handleUpdate(q.id, { estimated_minutes: next })
                                    }
                                    e.currentTarget.style.borderBottomColor = 'var(--color-border)'
                                  }}
                                  onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
                                  style={{
                                    width: 70, background: 'transparent',
                                    border: 'none',
                                    borderBottom: '1px solid var(--color-border)',
                                    color: 'var(--color-text-primary)',
                                    fontSize: 11, padding: '4px 2px', outline: 'none',
                                    fontFamily: 'var(--font-mono)',
                                    transition: 'border-color 0.15s',
                                  }}
                                  onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-accent-light)')}
                                />
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontSize: 9, color: 'var(--color-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Status:</span>
                                <StatusDropdown status={q.status} onChange={s => handleUpdate(q.id, { status: s })} />
                                <button
                                  onClick={() => removeSubtask(q.id)}
                                  style={{
                                    marginLeft: 'auto',
                                    background: 'none', border: '1px solid var(--color-border)',
                                    color: 'var(--color-text-tertiary)', cursor: 'pointer',
                                    fontSize: 10, padding: '4px 8px', borderRadius: 3,
                                    letterSpacing: '0.08em', textTransform: 'uppercase',
                                    transition: 'all 0.15s',
                                  }}
                                  onMouseEnter={e => {
                                    e.currentTarget.style.color = 'var(--color-accent-light)'
                                    e.currentTarget.style.borderColor = 'var(--color-accent-light)'
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.color = 'var(--color-text-tertiary)'
                                    e.currentTarget.style.borderColor = 'var(--color-border)'
                                  }}
                                >
                                  deletar
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Input de nova quest scoped ao deliverable: título + tempo estimado */}
                    <div style={{
                      display: 'flex', gap: 10, marginTop: 6, paddingTop: 8,
                      borderTop: '1px dashed var(--color-divider)',
                      alignItems: 'center',
                    }}>
                      <span style={{
                        fontSize: 14, color: 'var(--color-text-muted)',
                        lineHeight: 1, paddingBottom: 2,
                      }}>+</span>
                      <input
                        type="text"
                        autoComplete="off"
                        value={newQuestByDeliv[d.id] ?? ''}
                        onChange={e => setNewQuestByDeliv(prev => ({ ...prev, [d.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') addQuestToDeliverable(d.id) }}
                        placeholder="Nova quest neste entregável…"
                        style={{
                          flex: 1, background: 'transparent',
                          border: 'none',
                          borderBottom: '1px solid transparent',
                          color: 'var(--color-text-primary)',
                          padding: '4px 2px', fontSize: 12,
                          outline: 'none', transition: 'border-color 0.15s',
                        }}
                        onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-accent-light)')}
                        onBlur={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
                      />
                      <input
                        type="text"
                        autoComplete="off"
                        value={newQuestEstByDeliv[d.id] ?? ''}
                        onChange={e => setNewQuestEstByDeliv(prev => ({ ...prev, [d.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') addQuestToDeliverable(d.id) }}
                        placeholder="h:mm"
                        title="Tempo estimado (h:mm, ex: 1:30)"
                        style={{
                          width: 60, background: 'transparent',
                          border: 'none',
                          borderBottom: '1px solid transparent',
                          color: 'var(--color-text-primary)',
                          padding: '4px 2px', fontSize: 11,
                          outline: 'none',
                          fontFamily: 'var(--font-mono)',
                          transition: 'border-color 0.15s',
                        }}
                        onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-accent-light)')}
                        onBlur={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
                      />
                      <button
                        onClick={() => addQuestToDeliverable(d.id)}
                        disabled={!(newQuestByDeliv[d.id] ?? '').trim()}
                        style={{
                          background: (newQuestByDeliv[d.id] ?? '').trim() ? 'var(--color-accent-light)' : 'var(--color-bg-tertiary)',
                          color: (newQuestByDeliv[d.id] ?? '').trim() ? 'var(--color-bg-primary)' : 'var(--color-text-muted)',
                          border: 'none',
                          cursor: (newQuestByDeliv[d.id] ?? '').trim() ? 'pointer' : 'not-allowed',
                          padding: '6px 12px', fontSize: 11, fontWeight: 700,
                          borderRadius: 3,
                        }}
                      >
                        +
                      </button>
                    </div>

                    {/* Delete deliverable (só se estiver sem quests) */}
                    {delivQuests.length === 0 && (
                      <button
                        onClick={() => handleDeleteDeliverable(d.id)}
                        style={{
                          alignSelf: 'flex-start', marginTop: 6,
                          background: 'none', border: 'none',
                          color: 'var(--color-text-muted)', cursor: 'pointer',
                          fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                          padding: '4px 0',
                          transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                      >
                        deletar entregável
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })
          })()}
        </div>
      </div>

      <div style={{ marginTop: 40, paddingTop: 28, borderTop: '1px solid var(--color-divider)' }}>
        <Label>informações detalhadas</Label>
        <div style={{ marginTop: 10 }}>
          <BlockEditor
            value={notesDraft ?? project.notes ?? ''}
            onChange={setNotesDraft}
            placeholder="Digite / pra escolher o tipo de bloco…"
            minHeight={200}
          />
        </div>
      </div>

      {areaQuestCount > 0 && (
        <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--color-divider)', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {areaQuestCount} quest{areaQuestCount !== 1 ? 's' : ''} ativa{areaQuestCount !== 1 ? 's' : ''} neste projeto
        </div>
      )}
      </div>
    </Card>
  )
}

// ─── Hub Finance — bloco financeiro do projeto ───────────────────────────
// Painel que mostra valor acordado, tempo trabalhado, e R$/hora estimado.
// Cálculo: R$/hora = valor_acordado / (totalExecutedMin / 60).
// Doc: docs/hub-finance/PLAN.md (v1 — integração com Hub Quest).

function FinanceBlock({ project, totalExecutedMin, onUpdateValor, onUpdateCliente }: {
  project: Project
  totalExecutedMin: number
  onUpdateValor: (valor: number | null) => void
  onUpdateCliente: (clienteId: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(
    project.valor_acordado != null ? String(project.valor_acordado) : ''
  )
  const [parcelas, setParcelas] = useState<FinParcela[]>([])
  const [clients, setClients] = useState<FinClient[]>([])
  const [hourlyStats, setHourlyStats] = useState<FinHourlyRateStats | null>(null)
  const [editingParcela, setEditingParcela] = useState<FinParcela | null | 'new'>(null)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [parcelaActionsBusy, setParcelaActionsBusy] = useState(false)

  // Carrega parcelas + clientes + média histórica no mount.
  useEffect(() => {
    if (!project.id) return
    let cancelled = false
    fetchFinParcelas(project.id)
      .then(list => { if (!cancelled) setParcelas(list) })
      .catch(err => reportApiError('FinanceBlock.fetchParcelas', err))
    fetchFinClients()
      .then(list => { if (!cancelled) setClients(list) })
      .catch(err => reportApiError('FinanceBlock.fetchClients', err))
    fetchFinHourlyRateStats()
      .then(s => { if (!cancelled) setHourlyStats(s) })
      .catch(err => reportApiError('FinanceBlock.fetchHourlyStats', err))
    return () => { cancelled = true }
  }, [project.id])

  const selectedClient = clients.find(c => c.id === project.cliente_id) ?? null

  function refreshParcelas() {
    fetchFinParcelas(project.id)
      .then(setParcelas)
      .catch(err => reportApiError('FinanceBlock.refreshParcelas', err))
  }

  const valor = project.valor_acordado
  const horas = totalExecutedMin / 60
  const hourlyRateEstimado = (valor != null && horas > 0) ? valor / horas : null

  // Total recebido = soma das parcelas com status 'recebido'.
  const totalRecebido = parcelas
    .filter(p => p.status === 'recebido')
    .reduce((s, p) => s + p.valor, 0)
  const aReceber = (valor ?? 0) - totalRecebido
  const hourlyRateReal = (totalRecebido > 0 && horas > 0) ? totalRecebido / horas : null

  const formatBRL = (v: number) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
  }).format(v)

  const fmtHoras = (h: number): string => {
    const totalMin = Math.round(h * 60)
    const hh = Math.floor(totalMin / 60)
    const mm = totalMin % 60
    if (hh === 0) return `${mm}m`
    if (mm === 0) return `${hh}h`
    return `${hh}h ${mm}m`
  }

  function saveDraft() {
    const trimmed = draft.trim().replace(',', '.')
    if (!trimmed) {
      if (project.valor_acordado != null) onUpdateValor(null)
      setEditing(false)
      return
    }
    const n = parseFloat(trimmed)
    if (!isNaN(n) && n >= 0) {
      if (n !== project.valor_acordado) onUpdateValor(n)
    }
    setEditing(false)
  }

  async function handleApplyTemplate(template: FinPaymentTemplate, dataInicio: string | null) {
    setParcelaActionsBusy(true)
    try {
      const list = await applyFinParcelaTemplate(project.id, { template, data_inicio: dataInicio })
      setParcelas(list)
      setShowTemplateModal(false)
    } catch (err: any) {
      reportApiError('applyTemplate', err)
      alert(err?.message ?? 'Erro ao aplicar template — veja o console.')
    } finally {
      setParcelaActionsBusy(false)
    }
  }

  return (
    <div style={{
      marginBottom: 24, padding: '14px 16px',
      background: 'var(--color-bg-secondary)',
      border: '1px solid var(--color-border)',
      borderLeft: '3px solid var(--color-accent-light)',
      borderRadius: 4,
    }}>
      <div style={{
        fontSize: 9, color: 'var(--color-text-tertiary)',
        letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 700,
        marginBottom: 12,
      }}>
        financeiro
      </div>

      {/* Linha 1: valor acordado / tempo / R$/hora estimado / R$/hora real */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16,
      }}>
        <div>
          <div style={fieldLabelMini()}>valor acordado</div>
          {editing ? (
            <input
              autoFocus
              type="text"
              inputMode="decimal"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={saveDraft}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                if (e.key === 'Escape') {
                  setDraft(project.valor_acordado != null ? String(project.valor_acordado) : '')
                  setEditing(false)
                }
              }}
              placeholder="ex: 2000"
              style={{
                width: '100%', maxWidth: 140,
                background: 'var(--color-bg-primary)',
                border: '1px solid var(--color-accent-light)',
                borderRadius: 3, padding: '6px 8px',
                color: 'var(--color-text-primary)',
                fontSize: 14, fontWeight: 600,
                fontFamily: 'var(--font-mono)',
              }}
            />
          ) : (
            <div
              onClick={() => { setDraft(valor != null ? String(valor) : ''); setEditing(true) }}
              title="clicar pra editar"
              style={{
                fontSize: 14, fontWeight: 600,
                color: valor != null ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer', padding: '4px 0',
              }}
            >
              {valor != null ? formatBRL(valor) : '— clique pra definir'}
            </div>
          )}
        </div>

        <div>
          <div style={fieldLabelMini()}>tempo trabalhado</div>
          <div style={{
            fontSize: 14, fontWeight: 600,
            color: horas > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
            padding: '4px 0',
          }}>
            {horas > 0 ? fmtHoras(horas) : '—'}
          </div>
        </div>

        <div>
          <div style={fieldLabelMini()}>R$/hora estimado</div>
          <div title="Se entregar agora, com o tempo já trabalhado"
            style={{
              fontSize: 14, fontWeight: 600,
              color: hourlyRateEstimado != null ? 'var(--color-accent-light)' : 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
              padding: '4px 0',
            }}>
            {hourlyRateEstimado != null ? `${formatBRL(hourlyRateEstimado)}/h` : '—'}
          </div>
        </div>

        <div>
          <div style={fieldLabelMini()}>R$/hora real</div>
          <div title="Baseado em parcelas já recebidas"
            style={{
              fontSize: 14, fontWeight: 600,
              color: hourlyRateReal != null ? 'var(--color-success)' : 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
              padding: '4px 0',
            }}>
            {hourlyRateReal != null ? `${formatBRL(hourlyRateReal)}/h` : '—'}
          </div>
        </div>
      </div>

      {/* Comparação contra média histórica freela — só mostra se há base */}
      {hourlyStats && (hourlyRateReal != null || hourlyRateEstimado != null) && (() => {
        // Compara o R$/hora "preferido" (real se existir, senão estimado) contra
        // a média correspondente do histórico.
        const projetoRate = hourlyRateReal ?? hourlyRateEstimado!
        const mediaRate = hourlyRateReal != null
          ? hourlyStats.media_real_brl_h
          : hourlyStats.media_estimada_brl_h
        if (mediaRate == null) return null
        const diff = projetoRate - mediaRate
        const acimaMedia = diff >= 0
        const tipo = hourlyRateReal != null ? 'real' : 'estimado'
        return (
          <div style={{
            marginTop: 10, padding: '8px 12px',
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            borderRadius: 3,
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            fontSize: 11, color: 'var(--color-text-secondary)',
          }}>
            <span>
              esse projeto ({tipo}): <strong style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-text-primary)',
              }}>{formatBRL(projetoRate)}/h</strong>
            </span>
            <span style={{ color: 'var(--color-text-muted)' }}>vs</span>
            <span>
              sua média {tipo}: <strong style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-text-primary)',
              }}>{formatBRL(mediaRate)}/h</strong>
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700,
              padding: '3px 8px', borderRadius: 3,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              color: acimaMedia ? 'var(--color-success)' : 'var(--color-accent-primary)',
              border: `1px solid ${acimaMedia ? 'var(--color-success)' : 'var(--color-accent-primary)'}`,
            }}>
              {acimaMedia ? '↑' : '↓'} {formatBRL(Math.abs(diff))}/h {acimaMedia ? 'acima' : 'abaixo'}
            </span>
          </div>
        )
      })()}

      {/* Cliente — habilita auto-vínculo de receita por CPF/CNPJ */}
      <div style={{
        marginTop: 12, paddingTop: 12,
        borderTop: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={fieldLabelMini()}>cliente</div>
        <select
          value={project.cliente_id ?? ''}
          onChange={e => onUpdateCliente(e.target.value || null)}
          style={{
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            borderRadius: 3, padding: '6px 10px',
            color: 'var(--color-text-primary)',
            fontSize: 12, fontFamily: 'inherit',
            minWidth: 200,
          }}
        >
          <option value="">— sem cliente —</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>
              {c.nome}{c.cpf_cnpj ? ` (${c.cpf_cnpj})` : ''}
            </option>
          ))}
        </select>
        {selectedClient?.cpf_cnpj && (
          <span style={{
            fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic',
          }}>
            auto-vínculo ativo via CPF/CNPJ
          </span>
        )}
        {selectedClient && !selectedClient.cpf_cnpj && (
          <span style={{
            fontSize: 10, color: 'var(--color-warning)', fontStyle: 'italic',
          }}>
            cliente sem CPF/CNPJ — auto-vínculo desativado
          </span>
        )}
      </div>

      {/* Sub-resumo: recebido / a receber */}
      {valor != null && parcelas.length > 0 && (
        <div style={{
          marginTop: 12, paddingTop: 12,
          borderTop: '1px solid var(--color-border)',
          display: 'flex', gap: 18, fontSize: 11, color: 'var(--color-text-secondary)',
          flexWrap: 'wrap',
        }}>
          <span>
            <strong style={{ color: 'var(--color-success)', fontFamily: 'var(--font-mono)' }}>
              {formatBRL(totalRecebido)}
            </strong>
            <span style={{ color: 'var(--color-text-muted)' }}> recebido</span>
          </span>
          <span>
            <strong style={{ color: 'var(--color-accent-light)', fontFamily: 'var(--font-mono)' }}>
              {formatBRL(Math.max(0, aReceber))}
            </strong>
            <span style={{ color: 'var(--color-text-muted)' }}> a receber</span>
          </span>
        </div>
      )}

      {/* Seção de parcelas */}
      {valor != null && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={fieldLabelMini()}>parcelas esperadas</div>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setShowTemplateModal(true)}
              disabled={parcelaActionsBusy}
              style={ghostButtonMini()}
            >
              {project.forma_pagamento_template ? 'reaplicar template' : 'aplicar template'}
            </button>
            <button
              onClick={() => setEditingParcela('new')}
              disabled={parcelaActionsBusy}
              style={ghostButtonMini()}
            >
              + nova parcela
            </button>
          </div>

          {parcelas.length === 0 ? (
            <div style={{
              fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic',
              padding: '12px 14px',
              border: '1px dashed var(--color-border)', borderRadius: 3,
            }}>
              nenhuma parcela cadastrada. use "aplicar template" pra gerar
              automaticamente (50/50, parcelado, etc) ou "+ nova parcela" pra
              criar uma manual.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {parcelas.map(p => (
                <ParcelaRow
                  key={p.id}
                  parcela={p}
                  onEdit={() => setEditingParcela(p)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {editingParcela && (
        <ParcelaModal
          parcela={editingParcela === 'new' ? null : editingParcela}
          projectId={project.id}
          onClose={() => setEditingParcela(null)}
          onSaved={() => { setEditingParcela(null); refreshParcelas() }}
          onDeleted={() => { setEditingParcela(null); refreshParcelas() }}
        />
      )}

      {showTemplateModal && (
        <TemplateModal
          currentTemplate={(project.forma_pagamento_template ?? null) as FinPaymentTemplate | null}
          onClose={() => setShowTemplateModal(false)}
          onApply={handleApplyTemplate}
        />
      )}
    </div>
  )
}

// ─── Parcela row + modais ─────────────────────────────────────────────────

const PARCELA_STATUS_META: Record<FinParcela['status'], { label: string; color: string }> = {
  pendente:   { label: 'PENDENTE',  color: 'var(--color-text-tertiary)' },
  recebido:   { label: 'RECEBIDO',  color: 'var(--color-success)' },
  atrasado:   { label: 'ATRASADO',  color: 'var(--color-accent-primary)' },
  cancelada:  { label: 'CANCELADA', color: 'var(--color-text-muted)' },
}

function ParcelaRow({ parcela, onEdit }: { parcela: FinParcela; onEdit: () => void }) {
  const meta = PARCELA_STATUS_META[parcela.status]
  const formatBRL = (v: number) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
  }).format(v)
  const formatDate = (iso: string | null): string => {
    if (!iso) return 'sem data'
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y.slice(2)}`
  }
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '36px 1fr 100px 90px auto', gap: 10,
      alignItems: 'center', padding: '8px 10px',
      background: 'var(--color-bg-primary)',
      border: '1px solid var(--color-border)',
      borderLeft: `3px solid ${meta.color}`,
      borderRadius: 3,
    }}>
      <span style={{
        fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)',
        fontFamily: 'var(--font-mono)',
      }}>
        #{parcela.numero}
      </span>
      <span style={{
        fontSize: 13, fontWeight: 600,
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-mono)',
      }}>
        {formatBRL(parcela.valor)}
      </span>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
        {formatDate(parcela.data_prevista)}
      </span>
      <span style={{
        fontSize: 9, fontWeight: 700, color: meta.color,
        letterSpacing: '0.12em',
      }}>
        {meta.label}
      </span>
      <button
        onClick={onEdit}
        title="editar parcela"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--color-text-tertiary)', padding: 4,
          display: 'inline-flex', alignItems: 'center',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-accent-light)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-tertiary)' }}
      >
        <Pencil size={11} strokeWidth={1.8} />
      </button>
    </div>
  )
}

function ParcelaModal({ parcela, projectId, onClose, onSaved, onDeleted }: {
  parcela: FinParcela | null
  projectId: string
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const isNew = parcela === null
  const [valor, setValor] = useState<string>(parcela ? String(parcela.valor) : '')
  const [dataPrevista, setDataPrevista] = useState<string>(parcela?.data_prevista ?? '')
  const [status, setStatus] = useState<FinParcela['status']>(parcela?.status ?? 'pendente')
  const [observacao, setObservacao] = useState<string>(parcela?.observacao ?? '')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = parseFloat(valor.replace(',', '.'))
    if (isNaN(v) || v <= 0) { alert('Valor inválido (> 0).'); return }
    setBusy(true)
    try {
      if (isNew) {
        await createFinParcela(projectId, {
          valor: v,
          data_prevista: dataPrevista || null,
          observacao: observacao || null,
        })
      } else {
        // Status: só envia se mudou (evita sobrescrever auto-status do backend
        // por engano).
        const patch: Partial<FinParcela> = {
          valor: v,
          data_prevista: dataPrevista || null,
          observacao: observacao || null,
        }
        if (status !== parcela!.status) patch.status = status
        await updateFinParcela(parcela!.id, patch)
      }
      onSaved()
    } catch (err: any) {
      reportApiError('ParcelaModal.submit', err)
      alert(err?.message ?? 'Erro ao salvar — veja o console.')
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!parcela) return
    if (!window.confirm(
      `Deletar parcela #${parcela.numero}? Transação vinculada (se existir) ` +
      `continua existindo, mas perde o vínculo.`
    )) return
    setBusy(true)
    try {
      await deleteFinParcela(parcela.id)
      onDeleted()
    } catch (err) {
      reportApiError('ParcelaModal.delete', err)
      alert('Erro ao deletar — veja o console.')
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ ...sharedModalOverlay(), zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...modalShell(),
        minWidth: 380, maxWidth: 460,
      }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <div style={{ ...modalLabel(), marginBottom: 0 }}>
            {isNew ? 'Nova parcela' : `Editar parcela #${parcela!.numero}`}
          </div>
        </div>
        <div style={modalBody()}>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={modalFieldLabel()}>Valor</label>
              <input
                autoFocus
                type="text" inputMode="decimal" placeholder="ex: 1000,00"
                value={valor} onChange={e => setValor(e.target.value)}
                style={{ ...modalInput(), fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div>
              <label style={modalFieldLabel()}>Data prevista (opcional)</label>
              <input
                type="date"
                value={dataPrevista} onChange={e => setDataPrevista(e.target.value)}
                style={modalInput()}
              />
            </div>
          </div>
          {!isNew && (
            <div>
              <label style={modalFieldLabel()}>Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as FinParcela['status'])}
                style={modalInput()}
              >
                <option value="pendente">pendente</option>
                <option value="recebido">recebido</option>
                <option value="atrasado">atrasado</option>
                <option value="cancelada">cancelada</option>
              </select>
              <div style={{
                fontSize: 9, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic',
              }}>
                normalmente o status é automático: vincular transação na lista
                vira "recebido". Mude manualmente só pra "cancelada" ou "atrasado".
              </div>
            </div>
          )}
          <div>
            <label style={modalFieldLabel()}>Observação (opcional)</label>
            <input
              type="text" placeholder="ex: condicional à entrega da v1"
              value={observacao} onChange={e => setObservacao(e.target.value)}
              style={modalInput()}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 8 }}>
            {!isNew ? (
              <button type="button" onClick={handleDelete} disabled={busy} style={{
                ...modalGhost(),
                color: 'var(--color-accent-primary)',
                borderColor: 'var(--color-accent-primary)',
              }}>
                <Trash2 size={11} strokeWidth={1.8} style={{ marginRight: 4 }} />
                deletar
              </button>
            ) : <div />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onClose} style={modalGhost()}>cancelar</button>
              <button type="submit" disabled={busy} style={modalPrimary()}>
                {busy ? 'salvando…' : (isNew ? 'criar' : 'salvar')}
              </button>
            </div>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}

function TemplateModal({ currentTemplate, onClose, onApply }: {
  currentTemplate: FinPaymentTemplate | null
  onClose: () => void
  onApply: (template: FinPaymentTemplate, dataInicio: string | null) => void
}) {
  const [template, setTemplate] = useState<FinPaymentTemplate>(currentTemplate ?? '50_50')
  const [dataInicio, setDataInicio] = useState<string>('')
  const [confirming, setConfirming] = useState(false)

  const TEMPLATES: { value: FinPaymentTemplate; label: string; desc: string }[] = [
    { value: 'a_vista',       label: '100% no fim',        desc: '1 parcela no valor total' },
    { value: '50_50',         label: '50/50 sinal+entrega', desc: '2 parcelas iguais' },
    { value: 'parcelado_3x',  label: 'Parcelado 3x',       desc: '3 parcelas mensais iguais' },
    { value: 'parcelado_4x',  label: 'Parcelado 4x',       desc: '4 parcelas mensais iguais' },
    { value: 'custom',        label: 'Custom',              desc: '1 parcela vazia, edite à mão' },
  ]

  function tryApply() {
    onApply(template, dataInicio || null)
  }

  return (
    <div onClick={onClose} style={{ ...sharedModalOverlay(), zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...modalShell(), minWidth: 420, maxWidth: 520,
      }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <div style={{ ...modalLabel(), marginBottom: 0 }}>Aplicar template de parcelas</div>
        </div>
        <div style={modalBody()}>
        <div style={{
          fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 14, lineHeight: 1.5,
        }}>
          Apaga todas as parcelas <em>pendentes</em> existentes e cria novas a
          partir do valor acordado do projeto. Parcelas <strong>já recebidas</strong> são
          preservadas.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {TEMPLATES.map(t => (
            <label key={t.value} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '8px 10px', cursor: 'pointer',
              border: `1px solid ${template === t.value ? 'var(--color-accent-light)' : 'var(--color-border)'}`,
              background: template === t.value ? 'rgba(157, 108, 255, 0.05)' : 'var(--color-bg-secondary)',
              borderRadius: 3,
            }}>
              <input
                type="radio"
                name="template"
                value={t.value}
                checked={template === t.value}
                onChange={() => setTemplate(t.value)}
                style={{ marginTop: 2, accentColor: 'var(--color-accent-light)' }}
              />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  {t.label}
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                  {t.desc}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={modalFieldLabel()}>Data da 1ª parcela (opcional)</label>
          <input
            type="date"
            value={dataInicio} onChange={e => setDataInicio(e.target.value)}
            style={modalInput()}
          />
          <div style={{
            fontSize: 9, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic',
          }}>
            se preencher, parcelas seguintes ficam mensais a partir dessa data.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={modalGhost()}>cancelar</button>
          {!confirming ? (
            <button onClick={() => setConfirming(true)} style={modalPrimary()}>aplicar</button>
          ) : (
            <button onClick={tryApply} style={{
              ...modalPrimary(),
              background: 'var(--color-accent-primary)',
            }}>
              <CheckCircle size={11} strokeWidth={2} style={{ marginRight: 4 }} />
              confirmar (apaga pendentes)
            </button>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}

// ─── Style helpers (modais + bloco financeiro) ───────────────────────────

function fieldLabelMini(): React.CSSProperties {
  return {
    fontSize: 9, color: 'var(--color-text-muted)',
    letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4,
    fontWeight: 600,
  }
}

function ghostButtonMini(): React.CSSProperties {
  return {
    background: 'none',
    border: '1px solid var(--color-border)', cursor: 'pointer',
    color: 'var(--color-text-tertiary)',
    padding: '5px 10px', borderRadius: 3,
    fontSize: 9, fontWeight: 600,
    letterSpacing: '0.08em', textTransform: 'uppercase',
  }
}

function modalLabel(): React.CSSProperties {
  return {
    fontSize: 10, color: 'var(--color-text-tertiary)',
    letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600,
    marginBottom: 16,
  }
}

function modalFieldLabel(): React.CSSProperties {
  return {
    display: 'block', marginBottom: 4,
    fontSize: 9, color: 'var(--color-text-tertiary)',
    letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600,
  }
}

function modalInput(): React.CSSProperties {
  return {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--color-bg-secondary)',
    border: '1px solid var(--color-border)',
    borderRadius: 3, padding: '8px 10px',
    color: 'var(--color-text-primary)',
    fontSize: 12, fontFamily: 'inherit',
  }
}

function modalPrimary(): React.CSSProperties {
  return {
    background: 'var(--color-accent-primary)',
    border: 'none', cursor: 'pointer',
    color: 'var(--color-bg-primary)',
    padding: '8px 14px', borderRadius: 3,
    fontSize: 11, fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase',
    display: 'inline-flex', alignItems: 'center',
  }
}

function modalGhost(): React.CSSProperties {
  return {
    background: 'none',
    border: '1px solid var(--color-border)', cursor: 'pointer',
    color: 'var(--color-text-tertiary)',
    padding: '8px 14px', borderRadius: 3,
    fontSize: 11, fontWeight: 600,
    letterSpacing: '0.1em', textTransform: 'uppercase',
    display: 'inline-flex', alignItems: 'center',
  }
}
