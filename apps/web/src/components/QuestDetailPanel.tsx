import { useEffect, useState, lazy, Suspense, useCallback, useRef } from 'react'
import { CheckCircle2, CheckCircle, Pencil, Trash2, XCircle, GripVertical } from 'lucide-react'
import type { Area, Project, Quest, FinParcela, FinPaymentTemplate, FinClient, FinHourlyRateStats, ProjectPageMeta } from '../types'
import {
  fetchQuestsByProject, fetchDeliverables,
  createQuest, deleteQuest,
  createDeliverable, updateDeliverable, deleteDeliverable, reorderDeliverables,
  fetchSessions,
  fetchFinParcelas, createFinParcela, applyFinParcelaTemplate,
  updateFinParcela, deleteFinParcela,
  fetchFinClients, fetchFinHourlyRateStats,
  fetchProjectPages, createPage, fetchPage,
  reportApiError,
} from '../api'
import { extractPlainTextPreview } from './block-utils'
import { PageView } from './PageView'
import { useAppInvalidator } from '../lib/app-queries'
import { useFinanceInvalidator } from '../lib/finance-queries'
import { tabSync } from '../lib/tabsync'
import { parseIsoAsUtc, sumClosedSessionsSeconds, formatHMS, parseTimeToMinutes, minutesToHmm, isValidDateInput } from '../utils/datetime'
import { formatDateBR } from '../utils/quests'
import { InlineText } from './ui/InlineText'
import { Label } from './ui/Label'
import { PrioritySelect } from './PrioritySelect'
import { StatusDropdown } from './StatusDropdown'
import { isBlockDocEmpty } from './block-utils'
// BlockEditor lazy — chunk pesado @blocknote (~1.1 MB) só baixa quando
// usuário expande notas de projeto ou descrição de subtarefa.
const BlockEditor = lazy(() =>
  import('./BlockEditor').then(m => ({ default: m.BlockEditor }))
)
// Placeholder cyber-styled enquanto o chunk baixa.
function EditorFallback() {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
      color: 'var(--color-text-muted)', letterSpacing: '0.18em',
      textTransform: 'uppercase', padding: '20px 0',
    }}>
      <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
      LOADING.EDITOR
    </div>
  )
}
import { Card } from './ui/Primitives'
import {
  modalOverlay as sharedModalOverlay,
  modalShell, modalHairline, modalHeader, modalBody,
} from '../pages/finance/components/styleHelpers'
import { confirmDialog, alertDialog } from '../lib/dialog'

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
  // Invalidator pra propagar mutações pro cache global. Sem isso, criar/editar
  // entregável aqui não refletia em outras páginas que consomem os mesmos
  // hooks (ExecPage, Build) até F5. FinanceBlock instancia seu próprio
  // finInv pra parcelas (Hub Finance).
  const appInv = useAppInvalidator()
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

  // ─── Nested Pages (caderno virtual estilo Notion) ──────────────────────
  // Lista flat das pages do projeto (sem content_json — só metadata).
  // Usada pra hidratar título dos blocos `page` no editor + montar
  // breadcrumb. Doc: docs/nested-pages/PLAN.md
  const [pagesMeta, setPagesMeta] = useState<ProjectPageMeta[]>([])
  // Page corrente — null = página raiz (notes do projeto). String = uma page.
  // Persistido em localStorage por projeto pra preservar o lugar quando o
  // usuário fecha/reabre o painel (caderno de matéria geralmente é retomado).
  const PAGE_STATE_KEY = `hq-page-state-${project.id}`
  const [currentPageId, setCurrentPageId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PAGE_STATE_KEY) || null
    } catch { return null }
  })
  // Trigger pra recarregar pagesMeta (depois de create/rename/delete).
  const [pagesReloadTrigger, setPagesReloadTrigger] = useState(0)
  // True enquanto o primeiro fetch da lista batch está em flight — sinaliza
  // pro PageBlock renderizar placeholder neutro em vez de "Página excluída"
  // (evita flash visual no primeiro render do projeto).
  const [pagesLoading, setPagesLoading] = useState(true)
  // Page recém-criada via slash `/page` — quando navegamos pra ela,
  // PageView abre o título em modo edit (Notion-style: criar + começar
  // a digitar o nome direto). Limpa após o primeiro commit do título.
  const [pageJustCreated, setPageJustCreated] = useState<string | null>(null)
  // Ids de pages deletadas pendentes de limpeza no JSON do pai. Quando
  // o BlockEditor do ancestral certo monta, lê esse Set, remove blocos
  // `page` órfãos via removeBlocks. PLAN §7.3.
  const [orphanCleanupIds, setOrphanCleanupIds] = useState<Set<string>>(() => new Set())

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

  // ─── Nested Pages: carregar lista batch do projeto ────────────────────
  // Reload a cada `pagesReloadTrigger++`. Lista vem sem content_json (light)
  // — usada só pra hidratar título dos blocos `page` + breadcrumb.
  // `pagesLoading` controla flash de "Página excluída" no PageBlock (true
  // só na primeira carga ou ao trocar de projeto; reloads depois não
  // disparam loading porque a lista anterior já está válida).
  useEffect(() => {
    let cancelled = false
    fetchProjectPages(project.id)
      .then(list => { if (!cancelled) setPagesMeta(list) })
      .catch(err => reportApiError('QuestDetailPanel.fetchPages', err))
      .finally(() => { if (!cancelled) setPagesLoading(false) })
    return () => { cancelled = true }
  }, [project.id, pagesReloadTrigger])

  // Ao trocar de projeto, reset do loading flag pra true até o novo fetch
  // completar (evita usar pagesById do projeto anterior pro novo).
  useEffect(() => {
    setPagesLoading(true)
  }, [project.id])

  // Ao trocar de projeto, lê do localStorage do novo projeto.
  // Sem reset hard — o useState inicial já cobre o primeiro render; este
  // efeito cobre re-mount com prop `project.id` diferente.
  useEffect(() => {
    try {
      setCurrentPageId(localStorage.getItem(`hq-page-state-${project.id}`) || null)
    } catch { setCurrentPageId(null) }
  }, [project.id])

  // Persiste qualquer mudança de currentPageId no localStorage do projeto
  // atual. Null = "voltou pra raiz" → remove a chave pra evitar lixo.
  useEffect(() => {
    try {
      if (currentPageId) localStorage.setItem(PAGE_STATE_KEY, currentPageId)
      else localStorage.removeItem(PAGE_STATE_KEY)
    } catch {}
  }, [currentPageId, PAGE_STATE_KEY])

  // Validar page persistida: se a page salva no localStorage não existe
  // mais (deletada externamente, ou trocou de projeto com pages diferentes),
  // volta pra raiz pra não ficar travado num pageId fantasma.
  useEffect(() => {
    if (currentPageId && pagesMeta.length > 0) {
      if (!pagesMeta.some(p => p.id === currentPageId)) {
        setCurrentPageId(null)
      }
    }
  }, [pagesMeta, currentPageId])

  // ESC navegacional: quando há page aberta, ESC sobe um nível em vez de
  // fechar o painel. Capture-phase + stopPropagation pra preceder o handler
  // global do App.tsx (que navega entre rotas). Quando já tá na raiz, não
  // intercepta — deixa o handler global fechar/navegar normal.
  useEffect(() => {
    if (currentPageId === null) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Ignora ESC quando algum input/textarea/contenteditable está focado —
      // ali o ESC tem semântica própria (cancelar edição inline).
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return
      }
      const parent = pagesMeta.find(p => p.id === currentPageId)?.parent_page_id ?? null
      setCurrentPageId(parent)
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)  // capture
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [currentPageId, pagesMeta])

  const reloadPages = useCallback(() => {
    setPagesReloadTrigger(t => t + 1)
  }, [])

  // Cache de previews on-hover: pageId → Promise<plain text | null>.
  // Dedup: hover repetido no mesmo card retorna a Promise já em flight (ou
  // já resolvida) — não bate no backend de novo. useRef pra sobreviver
  // re-renders. Reseta ao trocar de projeto pra evitar lookup vazado.
  const previewCacheRef = useRef<Map<string, Promise<string | null>>>(new Map())
  useEffect(() => {
    previewCacheRef.current = new Map()
  }, [project.id])

  const fetchPreviewForPage = useCallback((pageId: string): Promise<string | null> => {
    const cache = previewCacheRef.current
    const existing = cache.get(pageId)
    if (existing) return existing
    const promise = fetchPage(pageId)
      .then(p => extractPlainTextPreview(p.content_json))
      .catch(err => {
        // Em caso de falha, remove do cache pra permitir retry no próximo hover.
        cache.delete(pageId)
        reportApiError('QuestDetailPanel.fetchPreview', err)
        return null
      })
    cache.set(pageId, promise)
    return promise
  }, [])

  // Helper que cria nova page filha (do parent provido) e devolve o id.
  // Usado pelo slash `/page` no BlockEditor (raiz e dentro de PageView).
  // Marca como "recém-criada" pro PageView abrir o título em modo edit.
  const handleCreatePage = useCallback(async (parentPageId: string | null): Promise<string> => {
    try {
      const newPage = await createPage(project.id, { parent_page_id: parentPageId })
      setPageJustCreated(newPage.id)
      reloadPages()
      return newPage.id
    } catch (err) {
      reportApiError('QuestDetailPanel.createPage', err)
      alertDialog({
        title: 'Falha ao criar página',
        message: 'Não foi possível criar uma nova página. Verifique se o backend está rodando.',
        variant: 'danger',
      })
      throw err
    }
  }, [project.id, reloadPages])

  // Marca ids deletados pra limpeza nos blocos `page` do JSON do(s) ancestral(is).
  // Triggered pelo PageDeleteModal após DELETE com cascade no backend.
  const handlePageDeleted = useCallback((deletedIds: string[]) => {
    setOrphanCleanupIds(prev => {
      const next = new Set(prev)
      for (const id of deletedIds) next.add(id)
      return next
    })
    reloadPages()
  }, [reloadPages])

  // BlockEditor avisa quais ids foram efetivamente removidos do JSON dele —
  // tiramos do Set pra não tentar limpar de novo em re-renders.
  const handleCleanupDone = useCallback((cleaned: string[]) => {
    setOrphanCleanupIds(prev => {
      const next = new Set(prev)
      for (const id of cleaned) next.delete(id)
      return next
    })
  }, [])

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
        // Entregável sem quests = done manual → não mexe (espelha o backend,
        // que também deixa o done intocado quando não há quests).
        if (sibs.length === 0) return d
        const allClosed = sibs.every(q => q.status === 'done' || q.status === 'cancelled')
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
        // Nova quest entra pendente → o entregável não pode estar 100% fechado.
        // Destica na hora (otimista) e refaz os fetches — o backend já
        // sincronizou o `done` no create_quest, então a leitura volta correta.
        setDeliverables(prev => prev.map(d => d.id === delivId ? { ...d, done: false } : d))
        Promise.all([fetchQuestsByProject(project.id), fetchDeliverables(project.id)])
          .then(([qs, ds]) => { setSubtasks(qs); setDeliverables(ds) })
          .catch(err => reportApiError('QuestDetailPanel', err))
        setNewQuestByDeliv(prev => ({ ...prev, [delivId]: '' }))
        setNewQuestEstByDeliv(prev => ({ ...prev, [delivId]: '' }))
        if (onQuestCreate) onQuestCreate(q)
        appInv.quests(); appInv.deliverablesByProject(project.id); tabSync.emit('quests')
      })
      .catch((err: any) => {
        console.error('Erro ao criar quest:', err)
        alertDialog({
          title: 'Erro',
          message: err?.message ?? 'Erro ao criar quest',
          variant: 'danger',
        })
      })
  }

  async function removeSubtask(id: string) {
    const ok = await confirmDialog({
      title: 'Deletar quest',
      message: 'Deletar esta quest?\nA ação é irreversível.',
      confirmLabel: 'DELETAR',
      danger: true,
    })
    if (!ok) return
    const removed = subtasks.find(st => st.id === id)
    const delivId = removed?.deliverable_id ?? null
    deleteQuest(id)
      .then(() => {
        const remaining = subtasks.filter(st => st.id !== id)
        setSubtasks(remaining)
        // Deletar a última quest aberta pode fechar o entregável. Recalcula
        // otimista (só quando ainda restam quests — vazio = done manual) e
        // refaz o fetch pra reconciliar com o backend (sincronizado no delete).
        if (delivId) {
          const sibs = remaining.filter(q => q.deliverable_id === delivId)
          if (sibs.length > 0) {
            const allClosed = sibs.every(q => q.status === 'done' || q.status === 'cancelled')
            setDeliverables(ds => ds.map(d => d.id === delivId ? { ...d, done: allClosed } : d))
          }
          fetchDeliverables(project.id).then(setDeliverables).catch(err => reportApiError('QuestDetailPanel', err))
        }
        if (onQuestDelete) onQuestDelete(id)
        appInv.quests(); appInv.deliverablesByProject(project.id); tabSync.emit('quests')
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
        appInv.deliverablesByProject(project.id); tabSync.emit('quests')
      })
      .catch(err => {
        console.error('Erro ao criar entregável:', err)
      })
  }

  function toggleDeliverableDone(id: string) {
    const deliv = deliverables.find(d => d.id === id)
    if (!deliv) return
    const childQuests = subtasks.filter(q => q.deliverable_id === id)

    // Entregável COM quests: `done` é derivado das quests. Clicar conclui ou
    // reabre todas — assim o checkbox e as quests ficam sempre consistentes,
    // em vez de um `done` solto que o próximo update de quest sobrescreveria.
    if (childQuests.length > 0) {
      const markDone = !deliv.done
      const newStatus = markDone ? 'done' : 'pending'
      const toChange = childQuests.filter(q =>
        markDone
          ? q.status !== 'done' && q.status !== 'cancelled'
          : q.status === 'done',
      )
      if (toChange.length > 0) {
        const changedIds = new Set(toChange.map(q => q.id))
        setSubtasks(prev => prev.map(q => changedIds.has(q.id) ? { ...q, status: newStatus } : q))
        toChange.forEach(q => onQuestUpdate(q.id, { status: newStatus }))
      }
      setDeliverables(prev => prev.map(d => d.id === id ? { ...d, done: markDone } : d))
      appInv.quests(); appInv.deliverablesByProject(project.id); tabSync.emit('quests')
      return
    }

    // Entregável SEM quests: toggle manual persistido direto (otimista + rollback).
    const next = !deliv.done
    setDeliverables(prev => prev.map(d => d.id === id ? { ...d, done: next } : d))
    updateDeliverable(id, { done: next })
      .then(updated => {
        setDeliverables(prev => prev.map(d => d.id === id ? updated : d))
        appInv.deliverablesByProject(project.id); tabSync.emit('quests')
      })
      .catch(() => setDeliverables(prev => prev.map(d => d.id === id ? { ...d, done: deliv.done } : d)))
  }

  function patchDeliverable(id: string, patch: Partial<Deliverable>) {
    // Optimistic update pra UI responder na hora; rollback em erro.
    const prev = deliverables
    setDeliverables(prev.map(d => d.id === id ? { ...d, ...patch } : d))
    updateDeliverable(id, patch)
      .then(updated => {
        setDeliverables(curr => curr.map(d => d.id === id ? updated : d))
        appInv.deliverablesByProject(project.id); tabSync.emit('quests')
      })
      .catch(() => setDeliverables(prev))
  }

  async function handleDeleteDeliverable(id: string) {
    const ok = await confirmDialog({
      title: 'Deletar entregável',
      message: 'Deletar este entregável?\nA ação é irreversível.',
      confirmLabel: 'DELETAR',
      danger: true,
    })
    if (!ok) return
    deleteDeliverable(id)
      .then(() => {
        setDeliverables(prev => prev.filter(d => d.id !== id))
        appInv.deliverablesByProject(project.id); tabSync.emit('quests')
      })
      .catch((err: any) => {
        // 409 quando ainda tem quests amarradas
        alertDialog({
          title: 'Erro',
          message: err?.detail ?? err?.message ?? 'Erro ao deletar entregável',
          variant: 'danger',
        })
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
    reorderDeliverables(project.id, list.map(d => d.id))
      .then(() => { appInv.deliverablesByProject(project.id); tabSync.emit('quests') })
      .catch(err => reportApiError('QuestDetailPanel.reorderDeliverables', err))
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
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid var(--color-border)',
        cursor: 'pointer',
        color: 'var(--color-text-tertiary)',
        fontSize: 9, fontWeight: 700,
        marginBottom: 18,
        textTransform: 'uppercase', letterSpacing: '0.22em',
        transition: 'all 0.15s',
        padding: '6px 12px',
        borderRadius: 0,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
        fontFamily: 'var(--font-mono)',
        display: 'inline-flex', alignItems: 'center', gap: 6,
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
      </button>

      <div style={{ marginBottom: 0 }}>
        <InlineText
          value={project.title}
          onSave={v => onProjectUpdate(project.id, { title: v })}
          style={{ color: 'var(--color-text-primary)', fontSize: 22, fontWeight: 700, display: 'block', letterSpacing: '-0.01em' }}
        />
        {(totalEstimatedMin > 0 || totalExecutedMin > 0 || deliverables.length > 0) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            marginTop: 12,
            fontSize: 10, fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            color: 'var(--color-text-tertiary)',
            letterSpacing: '0.18em', textTransform: 'uppercase',
          }}>
            {totalEstimatedMin > 0 && (
              <span>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                <span style={{ color: 'var(--color-text-muted)', marginRight: 6 }}>EST</span>
                <span style={{ color: 'var(--color-ice-light)' }}>{fmtMin(totalEstimatedMin)}</span>
              </span>
            )}
            {totalExecutedMin > 0 && (
              <span>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                <span style={{ color: 'var(--color-text-muted)', marginRight: 6 }}>EXEC</span>
                <span style={{
                  color: totalEstimatedMin > 0 && totalExecutedMin > totalEstimatedMin
                    ? 'var(--color-accent-vivid)'
                    : 'var(--color-text-secondary)',
                }}>
                  {fmtMin(totalExecutedMin)}
                </span>
                {totalEstimatedMin > 0 && (
                  <span style={{ color: 'var(--color-text-muted)' }}> · {totalProgressPct}%</span>
                )}
              </span>
            )}
            {deliverables.length > 0 && (
              <span>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                <span style={{ color: 'var(--color-text-muted)', marginRight: 6 }}>DELV</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>{completedDeliverables}/{deliverables.length}</span>
              </span>
            )}
            {subtasks.length > 0 && (
              <span>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                <span style={{ color: 'var(--color-text-muted)', marginRight: 6 }}>QST</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>{subtasks.filter(q => q.status === 'done').length}/{subtasks.length}</span>
              </span>
            )}
          </div>
        )}

        {deliverables.length > 0 && (
          <div style={{ marginTop: 14, maxWidth: 520, display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* 10-segment cyber progress bar */}
            <div style={{ flex: 1, display: 'flex', gap: 1 }}>
              {Array.from({ length: 10 }).map((_, i) => {
                const filled = (totalProgressPct / 10) > i
                const overflow = totalEstimatedMin > 0 && totalExecutedMin > totalEstimatedMin
                const segColor = totalProgressPct >= 100
                  ? 'var(--color-success)'
                  : overflow
                    ? 'var(--color-accent-vivid)'
                    : 'var(--color-ice-light)'
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1, height: 4,
                      background: filled ? segColor : 'rgba(255, 255, 255, 0.06)',
                      boxShadow: filled ? `0 0 4px ${totalProgressPct >= 100 ? 'var(--color-success)' : overflow ? 'var(--color-accent-vivid)' : 'var(--color-ice)'}` : 'none',
                    }}
                  />
                )
              })}
            </div>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              color: totalProgressPct >= 100 ? 'var(--color-success-light)' : 'var(--color-text-secondary)',
              letterSpacing: '0.15em',
              minWidth: 40, textAlign: 'right',
            }}>
              {totalProgressPct}%
            </span>
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
        display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
        marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid var(--color-ice-deep)',
      }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            color: 'var(--color-ice-light)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            {project.area_slug}
          </span>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.22em', textTransform: 'uppercase',
            }}>DL</span>
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
                background: 'rgba(8, 12, 18, 0.55)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-ice-light)',
                fontSize: 11, padding: '5px 9px',
                outline: 'none', colorScheme: 'dark',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                letterSpacing: '0.05em',
                borderRadius: 0,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                transition: 'all 0.15s',
              } as any}
              onFocus={e => {
                e.currentTarget.style.borderColor = 'var(--color-ice)'
                e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = 'var(--color-border)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </label>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.22em', textTransform: 'uppercase',
            }}>PRIO</span>
            <PrioritySelect
              value={project.priority || 'medium'}
              onChange={v => onProjectUpdate(project.id, { priority: v })}
            />
          </label>

          {project.created_at && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.22em', textTransform: 'uppercase',
              }}>CRIADO</span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11, fontWeight: 700,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.05em',
              }}>{parseIsoAsUtc(project.created_at).toLocaleDateString('pt-BR')}</span>
            </span>
          )}

          <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {project.status !== 'done' && project.status !== 'cancelled' ? (
              <>
                <button
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: 'Finalizar projeto',
                      message: 'Marcar este projeto como finalizado?',
                      confirmLabel: 'FINALIZAR',
                      variant: 'success',
                    })
                    if (ok) {
                      onProjectUpdate(project.id, { status: 'done', completed_at: new Date().toISOString() })
                    }
                  }}
                  style={{
                    background: 'rgba(94, 122, 82, 0.14)',
                    border: '1px solid var(--color-success)',
                    cursor: 'pointer',
                    color: 'var(--color-success-light)',
                    fontFamily: 'var(--font-mono)',
                    padding: '6px 12px', fontSize: 9, fontWeight: 700,
                    letterSpacing: '0.22em', textTransform: 'uppercase',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    borderRadius: 0,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                    boxShadow: '0 0 10px rgba(94, 122, 82, 0.25)',
                    transition: 'all 0.15s',
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
                <button
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: 'Cancelar projeto',
                      message: 'Cancelar este projeto?\nEle sai dos painéis de acompanhamento, mas fica no histórico.',
                      confirmLabel: 'CANCELAR',
                      danger: true,
                    })
                    if (ok) {
                      onProjectUpdate(project.id, { status: 'cancelled', completed_at: new Date().toISOString() })
                    }
                  }}
                  title="Cancelar projeto"
                  style={{
                    background: 'rgba(8, 12, 18, 0.55)',
                    border: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    color: 'var(--color-text-tertiary)',
                    fontFamily: 'var(--font-mono)',
                    padding: '6px 10px', fontSize: 9, fontWeight: 700,
                    letterSpacing: '0.22em', textTransform: 'uppercase',
                    borderRadius: 0,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                    transition: 'all 0.15s',
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
                  CANCELAR
                </button>
              </>
            ) : project.status === 'done' ? (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 12px',
                border: '1px solid var(--color-success)',
                background: 'rgba(94, 122, 82, 0.14)',
                borderRadius: 0,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                boxShadow: '0 0 10px rgba(94, 122, 82, 0.20)',
              }}>
                <CheckCircle2 size={11} strokeWidth={2.2} color="var(--color-success-light)" />
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, color: 'var(--color-success-light)',
                  textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 700,
                }}>
                  FINALIZADO
                  {project.completed_at && (
                    <span style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em', marginLeft: 6, fontWeight: 700 }}>
                      · {parseIsoAsUtc(project.completed_at).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </span>
                <button
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: 'Reabrir projeto',
                      message: 'Reabrir este projeto?\nEle volta para "em andamento".',
                      confirmLabel: 'REABRIR',
                    })
                    if (ok) {
                      onProjectUpdate(project.id, { status: 'doing', completed_at: null })
                    }
                  }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-text-tertiary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700,
                    padding: '0 4px', textTransform: 'uppercase', letterSpacing: '0.22em',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ice-light)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
                >
                  REABRIR
                </button>
              </div>
            ) : (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 12px',
                border: '1px solid var(--color-accent-primary)',
                background: 'rgba(159, 18, 57, 0.10)',
                borderRadius: 0,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                boxShadow: '0 0 10px rgba(159, 18, 57, 0.18)',
              }}>
                <XCircle size={11} strokeWidth={2.2} color="var(--color-accent-light)" />
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, color: 'var(--color-accent-light)',
                  textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 700,
                }}>
                  CANCELADO
                  {project.completed_at && (
                    <span style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em', marginLeft: 6, fontWeight: 700 }}>
                      · {parseIsoAsUtc(project.completed_at).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </span>
                <button
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: 'Reabrir projeto',
                      message: 'Reabrir este projeto?\nEle volta para "em andamento".',
                      confirmLabel: 'REABRIR',
                    })
                    if (ok) {
                      onProjectUpdate(project.id, { status: 'doing', completed_at: null })
                    }
                  }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-text-tertiary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700,
                    padding: '0 4px', textTransform: 'uppercase', letterSpacing: '0.22em',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ice-light)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
                >
                  REABRIR
                </button>
              </div>
            )}
          </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{
          marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          paddingBottom: 8,
          borderBottom: '1px solid var(--color-ice-deep)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10, fontWeight: 700,
            color: 'var(--color-ice-light)',
            letterSpacing: '0.25em', textTransform: 'uppercase',
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
            DELIVERABLES
            {deliverables.length > 0 && (
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 700 }}>
                [{deliverables.length.toString().padStart(2, '0')}]
              </span>
            )}
          </div>
          {!creatingDeliverable && (
            <button
              onClick={() => setCreatingDeliverable(true)}
              style={{
                background: 'rgba(143, 191, 211, 0.10)',
                border: '1px solid rgba(143, 191, 211, 0.45)',
                cursor: 'pointer',
                color: 'var(--color-ice-light)',
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                padding: '6px 12px',
                letterSpacing: '0.22em', textTransform: 'uppercase',
                borderRadius: 0,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                boxShadow: '0 0 10px rgba(143, 191, 211, 0.18)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(143, 191, 211, 0.18)'
                e.currentTarget.style.boxShadow = '0 0 16px rgba(143, 191, 211, 0.32)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
                e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.18)'
              }}
            >
              + NOVO ENTREGÁVEL
            </button>
          )}
        </div>

        {/* Novo entregável: container chamferado com label // NEW.DELIV */}
        {creatingDeliverable && (
        <div style={{
          display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
          marginBottom: 18,
          padding: '12px 14px',
          background: 'rgba(8, 12, 18, 0.55)',
          border: '1px solid var(--color-ice-deep)',
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            color: 'var(--color-ice-light)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
            flexShrink: 0,
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            NEW.DELIV
          </span>
          <input
            type="text"
            autoComplete="off"
            autoFocus
            value={newDeliverableTitle}
            onChange={e => setNewDeliverableTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') addDeliverable()
              if (e.key === 'Escape') {
                setCreatingDeliverable(false)
                setNewDeliverableTitle('')
                setNewDeliverableDeadline('')
              }
            }}
            placeholder="título do entregável…"
            style={{
              flex: '1 1 180px', minWidth: 160,
              background: 'transparent', border: 'none',
              borderBottom: '1px solid var(--color-ice-deep)',
              color: 'var(--color-ice-light)',
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              padding: '5px 2px', fontSize: 13,
              letterSpacing: '0.02em',
              outline: 'none', transition: 'border-color 0.15s',
            }}
            onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-ice)')}
            onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--color-ice-deep)')}
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
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-ice-light)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              padding: '5px 9px', fontSize: 11,
              letterSpacing: '0.05em',
              outline: 'none', colorScheme: 'dark',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
              transition: 'all 0.15s',
            } as any}
            onFocus={e => {
              e.currentTarget.style.borderColor = 'var(--color-ice)'
              e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          />
          <button
            onClick={addDeliverable}
            disabled={!newDeliverableTitle.trim()}
            style={{
              background: newDeliverableTitle.trim() ? 'rgba(143, 191, 211, 0.14)' : 'rgba(8, 12, 18, 0.55)',
              border: `1px solid ${newDeliverableTitle.trim() ? 'var(--color-ice)' : 'var(--color-border)'}`,
              color: newDeliverableTitle.trim() ? 'var(--color-ice-light)' : 'var(--color-text-muted)',
              cursor: newDeliverableTitle.trim() ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--font-mono)',
              padding: '6px 14px', fontSize: 9, fontWeight: 700,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
              boxShadow: newDeliverableTitle.trim() ? '0 0 10px rgba(143, 191, 211, 0.25)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            ✓ CRIAR
          </button>
          <button
            onClick={() => {
              setCreatingDeliverable(false)
              setNewDeliverableTitle('')
              setNewDeliverableDeadline('')
            }}
            title="Cancelar"
            style={{
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              width: 28, height: 28, borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
              fontSize: 12,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
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
            const deadlineOverdue = !!d.deadline && !d.done && d.deadline < todayYmd

            const accentColor = d.done ? 'var(--color-success)' : 'var(--color-ice-light)'
            const accentRgb = d.done ? '94, 122, 82' : '143, 191, 211'
            return (
              <div
                key={d.id}
                onDragOver={(e) => handleDragOver(e, d.id)}
                onDrop={() => handleDrop(d.id)}
                style={{
                  position: 'relative',
                  background: 'rgba(8, 12, 18, 0.55)',
                  border: `1px solid ${dragOverId === d.id ? 'var(--color-accent-primary)' : 'rgba(143, 191, 211, 0.22)'}`,
                  borderLeft: `2px solid ${accentColor}`,
                  borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
                  padding: '12px 14px',
                  opacity: draggedId === d.id ? 0.45 : (d.done ? 0.75 : 1),
                  boxShadow: dragOverId === d.id ? `0 0 16px rgba(${accentRgb}, 0.30)` : 'none',
                  transition: 'opacity 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (d.done || draggedId === d.id) return
                  e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                  e.currentTarget.style.boxShadow = `0 0 12px rgba(${accentRgb}, 0.20)`
                  e.currentTarget.style.transform = 'translateX(2px)'
                }}
                onMouseLeave={(e) => {
                  if (draggedId === d.id) return
                  e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.22)'
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.transform = 'translateX(0)'
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
                      <GripVertical size={14} style={{ color: 'var(--color-ice-light)', cursor: 'grab', opacity: 0.55 }} />
                    </div>
                  )}
                  <button
                    onClick={() => toggleDeliverableDone(d.id)}
                    title={d.done ? 'Desmarcar como feito' : 'Marcar como feito'}
                    style={{
                      width: 18, height: 18, flexShrink: 0,
                      border: `1.5px solid ${d.done ? 'var(--color-success)' : 'var(--color-ice)'}`,
                      background: d.done ? 'rgba(94, 122, 82, 0.55)' : 'transparent',
                      cursor: 'pointer', padding: 0,
                      borderRadius: 0,
                      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                      boxShadow: d.done ? '0 0 8px rgba(94, 122, 82, 0.50)' : '0 0 6px rgba(143, 191, 211, 0.18)',
                    }}
                  >
                    {d.done && <CheckCircle2 size={11} color="var(--color-success-light)" strokeWidth={3} />}
                  </button>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <InlineText
                      value={d.title}
                      onSave={(v) => patchDeliverable(d.id, { title: v })}
                      style={{
                        color: 'var(--color-text-primary)',
                        fontFamily: 'var(--font-display)',
                        fontSize: 14, fontWeight: 600,
                        letterSpacing: '0.02em',
                        textTransform: 'uppercase',
                        textDecoration: d.done ? 'line-through' : 'none',
                      }}
                    />
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap',
                      fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                    }}>
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
                            background: 'rgba(8, 12, 18, 0.85)',
                            border: '1px solid var(--color-ice)',
                            color: 'var(--color-ice-light)',
                            fontSize: 10, padding: '3px 6px', outline: 'none',
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 700,
                            letterSpacing: '0.05em',
                            colorScheme: 'dark',
                            borderRadius: 0,
                            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
                            boxShadow: '0 0 8px rgba(143, 191, 211, 0.25)',
                          } as any}
                        />
                      ) : (
                        <button
                          onClick={() => setEditingField(`${d.id}:deadline`)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: d.deadline
                              ? (deadlineOverdue ? 'var(--color-accent-light)' : 'var(--color-text-tertiary)')
                              : 'var(--color-text-muted)',
                            fontSize: 9, fontFamily: 'var(--font-mono)',
                            fontWeight: 700,
                            letterSpacing: '0.18em', textTransform: 'uppercase',
                            padding: 0,
                          }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ice-light)')}
                          onMouseLeave={e => {
                            e.currentTarget.style.color = d.deadline
                              ? (deadlineOverdue ? 'var(--color-accent-light)' : 'var(--color-text-tertiary)')
                              : 'var(--color-text-muted)'
                          }}
                        >
                          <span style={{ color: 'var(--color-text-muted)', marginRight: 4 }}>DL</span>
                          {d.deadline ? formatDateBR(d.deadline) : '+ ADD'}
                          {deadlineOverdue && <span style={{ marginLeft: 4, color: 'var(--color-accent-vivid)' }}>· ATRASADO</span>}
                        </button>
                      )}

                      {/* Previsto — calculado dinamicamente a partir das quests filhas (read-only) */}
                      {estimated > 0 && (
                        <span style={{ color: 'var(--color-text-tertiary)' }}>
                          <span style={{ color: 'var(--color-text-muted)', marginRight: 4 }}>EST</span>
                          {fmtMin(estimated)}
                        </span>
                      )}

                      {/* Executado (read-only) */}
                      {executed > 0 && (
                        <span style={{
                          color: over ? 'var(--color-accent-vivid)' : 'var(--color-text-tertiary)',
                        }}>
                          <span style={{ color: 'var(--color-text-muted)', marginRight: 4 }}>EXEC</span>
                          {fmtMin(executed)}
                          {over && ` +${fmtMin(executed - estimated)}`}
                        </span>
                      )}

                      <span style={{ color: 'var(--color-text-tertiary)' }}>
                        <span style={{ color: 'var(--color-text-muted)', marginRight: 4 }}>QST</span>
                        {doneQuests.length}/{delivQuests.length}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => toggleDelivCollapsed(d.id)}
                    title={collapsed ? 'Mostrar quests' : 'Ocultar quests'}
                    style={{
                      background: 'rgba(143, 191, 211, 0.06)',
                      border: '1px solid rgba(143, 191, 211, 0.18)',
                      cursor: 'pointer',
                      color: 'var(--color-ice-light)',
                      fontSize: 10, padding: '4px 8px',
                      borderRadius: 0,
                      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(143, 191, 211, 0.14)'
                      e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(143, 191, 211, 0.06)'
                      e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.18)'
                    }}
                  >
                    {collapsed ? '▶' : '▼'}
                  </button>
                </div>

                {/* 10-segment progress bar */}
                {(estimated > 0 || d.done) && (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, display: 'flex', gap: 1 }}>
                      {Array.from({ length: 10 }).map((_, i) => {
                        const filled = (pct / 10) > i
                        const segColor = pct >= 100
                          ? 'var(--color-success)'
                          : over
                            ? 'var(--color-accent-vivid)'
                            : 'var(--color-ice-light)'
                        const segGlow = pct >= 100
                          ? 'var(--color-success)'
                          : over
                            ? 'var(--color-accent-vivid)'
                            : 'var(--color-ice)'
                        return (
                          <div
                            key={i}
                            style={{
                              flex: 1, height: 3,
                              background: filled ? segColor : 'rgba(255, 255, 255, 0.06)',
                              boxShadow: filled ? `0 0 4px ${segGlow}` : 'none',
                            }}
                          />
                        )
                      })}
                    </div>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9, fontWeight: 700,
                      color: pct >= 100 ? 'var(--color-success-light)' : 'var(--color-text-tertiary)',
                      letterSpacing: '0.12em',
                      minWidth: 32, textAlign: 'right',
                    }}>
                      {pct}%
                    </span>
                  </div>
                )}

                {/* Lista de quests (colapsável) + input nova quest */}
                {!collapsed && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[...activeQuests, ...doneQuests].map(q => {
                      const sec = questDurationSec(q.id)
                      const expanded = expandedQuestIds.has(q.id)
                      const qIsDone = q.status === 'done'
                      return (
                        <div
                          key={q.id}
                          onDragOver={(e) => handleQuestDragOver(e, q.id)}
                          onDrop={() => handleQuestDrop(q.id, d.id)}
                          style={{
                            background: 'rgba(8, 12, 18, 0.55)',
                            border: `1px solid ${dragOverQuestId === q.id ? 'var(--color-accent-primary)' : 'rgba(143, 191, 211, 0.18)'}`,
                            borderLeft: `2px solid ${qIsDone ? 'var(--color-success)' : 'rgba(143, 191, 211, 0.55)'}`,
                            borderRadius: 0,
                            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
                            padding: '8px 10px',
                            opacity: draggedQuestId === q.id ? 0.45 : (qIsDone ? 0.7 : 1),
                            boxShadow: dragOverQuestId === q.id ? '0 0 12px rgba(159, 18, 57, 0.30)' : 'none',
                            transition: 'opacity 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.15s',
                          }}
                          onMouseEnter={(e) => {
                            if (qIsDone || draggedQuestId === q.id) return
                            e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.40)'
                            e.currentTarget.style.boxShadow = '0 0 8px rgba(143, 191, 211, 0.15)'
                          }}
                          onMouseLeave={(e) => {
                            if (draggedQuestId === q.id) return
                            e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.18)'
                            e.currentTarget.style.boxShadow = 'none'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {!qIsDone && (
                              <div
                                draggable={true}
                                onDragStart={() => handleQuestDragStart(q.id)}
                                onDragEnd={handleQuestDragEnd}
                                style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
                              >
                                <GripVertical size={12} style={{ color: 'var(--color-ice-light)', cursor: 'grab', opacity: 0.45 }} />
                              </div>
                            )}
                            <button
                              onClick={() => toggleQuestDone(q)}
                              title={qIsDone ? 'Reabrir quest' : 'Marcar como feita'}
                              style={{
                                width: 14, height: 14, flexShrink: 0, padding: 0,
                                background: qIsDone ? 'rgba(94, 122, 82, 0.55)' : 'transparent',
                                border: `1.5px solid ${qIsDone ? 'var(--color-success)' : 'var(--color-ice)'}`,
                                borderRadius: 0,
                                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: qIsDone ? '0 0 6px rgba(94, 122, 82, 0.45)' : '0 0 4px rgba(143, 191, 211, 0.18)',
                                transition: 'all 0.15s',
                              }}
                            >
                              {qIsDone && <CheckCircle2 size={9} color="var(--color-success-light)" strokeWidth={2.5} />}
                            </button>
                            <InlineText
                              value={q.title}
                              onSave={v => handleUpdate(q.id, { title: v })}
                              style={{
                                flex: 1, minWidth: 0,
                                fontFamily: 'var(--font-display)',
                                fontSize: 12, fontWeight: 600,
                                letterSpacing: '0.02em',
                                color: qIsDone ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                                textDecoration: qIsDone ? 'line-through' : 'none',
                              }}
                            />
                            {q.estimated_minutes != null && q.estimated_minutes > 0 && (
                              <span
                                title="Tempo estimado"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 9, fontWeight: 700,
                                  color: 'var(--color-text-tertiary)',
                                  letterSpacing: '0.18em', textTransform: 'uppercase',
                                }}
                              >
                                <span style={{ color: 'var(--color-text-muted)', marginRight: 3 }}>EST</span>
                                {fmtMin(q.estimated_minutes)}
                              </span>
                            )}
                            {sec > 0 && (
                              <span
                                title="Tempo real gasto (sessões)"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 9, fontWeight: 700,
                                  color: qIsDone ? 'var(--color-success-light)' : 'var(--color-ice-light)',
                                  letterSpacing: '0.05em',
                                }}
                              >
                                {formatHMS(sec)}
                              </span>
                            )}
                            <button
                              onClick={() => toggleQuestExpanded(q.id)}
                              title={expanded ? 'Ocultar detalhes' : 'Mostrar detalhes'}
                              style={{
                                background: 'rgba(143, 191, 211, 0.06)',
                                border: '1px solid rgba(143, 191, 211, 0.15)',
                                cursor: 'pointer',
                                color: 'var(--color-ice-light)',
                                fontSize: 9, padding: '3px 6px',
                                borderRadius: 0,
                                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
                                transition: 'all 0.15s',
                              }}
                              onMouseEnter={e => {
                                e.currentTarget.style.background = 'rgba(143, 191, 211, 0.14)'
                                e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.40)'
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.background = 'rgba(143, 191, 211, 0.06)'
                                e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.15)'
                              }}
                            >
                              {expanded ? '▼' : '▶'}
                            </button>
                          </div>

                          {expanded && (
                            <div style={{
                              marginTop: 10, paddingTop: 10,
                              borderTop: '1px solid rgba(143, 191, 211, 0.18)',
                              display: 'flex', flexDirection: 'column', gap: 10,
                            }}>
                              <div>
                                <span style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 9, fontWeight: 700,
                                  color: 'var(--color-ice-light)',
                                  letterSpacing: '0.22em', textTransform: 'uppercase',
                                  marginBottom: 6, display: 'block',
                                }}>
                                  <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                                  DESCRIPTION
                                </span>
                                <Suspense fallback={<EditorFallback />}>
                                  <BlockEditor
                                    value={descriptionDraft[q.id] ?? q.description ?? ''}
                                    onChange={v => setDescriptionDraft(prev => ({ ...prev, [q.id]: v }))}
                                    placeholder="Digite / pra ver os blocos…"
                                    minHeight={80}
                                  />
                                </Suspense>
                              </div>
                              <div>
                                <span style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 9, fontWeight: 700,
                                  color: 'var(--color-ice-light)',
                                  letterSpacing: '0.22em', textTransform: 'uppercase',
                                  marginRight: 8,
                                }}>
                                  <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                                  NEXT
                                </span>
                                <InlineText
                                  value={q.next_action ?? ''}
                                  onSave={v => handleUpdate(q.id, { next_action: v || null })}
                                  style={{
                                    fontSize: 11,
                                    fontFamily: 'var(--font-mono)',
                                    color: 'var(--color-text-secondary)',
                                    letterSpacing: '0.05em',
                                  }}
                                />
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <span style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 9, fontWeight: 700,
                                  color: 'var(--color-text-muted)',
                                  letterSpacing: '0.22em', textTransform: 'uppercase',
                                }}>EST</span>
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
                                    e.currentTarget.style.borderColor = 'var(--color-border)'
                                    e.currentTarget.style.boxShadow = 'none'
                                  }}
                                  onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
                                  style={{
                                    width: 70,
                                    background: 'rgba(8, 12, 18, 0.55)',
                                    border: '1px solid var(--color-border)',
                                    color: 'var(--color-ice-light)',
                                    fontFamily: 'var(--font-mono)',
                                    fontWeight: 700,
                                    fontSize: 11, padding: '4px 8px',
                                    outline: 'none',
                                    letterSpacing: '0.05em',
                                    borderRadius: 0,
                                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
                                    transition: 'all 0.15s',
                                  }}
                                  onFocus={e => {
                                    e.currentTarget.style.borderColor = 'var(--color-ice)'
                                    e.currentTarget.style.boxShadow = '0 0 8px rgba(143, 191, 211, 0.25)'
                                  }}
                                />
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 9, fontWeight: 700,
                                  color: 'var(--color-text-muted)',
                                  letterSpacing: '0.22em', textTransform: 'uppercase',
                                }}>STATUS</span>
                                <StatusDropdown status={q.status} onChange={s => handleUpdate(q.id, { status: s })} />
                                <button
                                  onClick={() => removeSubtask(q.id)}
                                  style={{
                                    marginLeft: 'auto',
                                    background: 'rgba(8, 12, 18, 0.55)',
                                    border: '1px solid var(--color-border)',
                                    color: 'var(--color-text-tertiary)',
                                    cursor: 'pointer',
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: 9, fontWeight: 700,
                                    padding: '4px 10px',
                                    letterSpacing: '0.22em', textTransform: 'uppercase',
                                    borderRadius: 0,
                                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
                                    transition: 'all 0.15s',
                                  }}
                                  onMouseEnter={e => {
                                    e.currentTarget.style.color = 'var(--color-accent-light)'
                                    e.currentTarget.style.borderColor = 'rgba(159, 18, 57, 0.45)'
                                    e.currentTarget.style.boxShadow = '0 0 8px rgba(159, 18, 57, 0.18)'
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.color = 'var(--color-text-tertiary)'
                                    e.currentTarget.style.borderColor = 'var(--color-border)'
                                    e.currentTarget.style.boxShadow = 'none'
                                  }}
                                >
                                  DELETAR
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Input de nova quest scoped ao deliverable: título + tempo estimado */}
                    <div style={{
                      display: 'flex', gap: 10, marginTop: 8, paddingTop: 10,
                      borderTop: '1px dashed rgba(143, 191, 211, 0.22)',
                      alignItems: 'center',
                    }}>
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9, fontWeight: 700,
                        color: 'var(--color-text-muted)',
                        letterSpacing: '0.22em', textTransform: 'uppercase',
                        flexShrink: 0,
                      }}>
                        <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                        NEW.QST
                      </span>
                      <input
                        type="text"
                        autoComplete="off"
                        value={newQuestByDeliv[d.id] ?? ''}
                        onChange={e => setNewQuestByDeliv(prev => ({ ...prev, [d.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') addQuestToDeliverable(d.id) }}
                        placeholder="título…"
                        style={{
                          flex: 1, background: 'transparent',
                          border: 'none',
                          borderBottom: '1px solid var(--color-ice-deep)',
                          color: 'var(--color-ice-light)',
                          fontFamily: 'var(--font-display)',
                          fontWeight: 600,
                          padding: '5px 2px', fontSize: 12,
                          letterSpacing: '0.02em',
                          outline: 'none', transition: 'border-color 0.15s',
                        }}
                        onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-ice)')}
                        onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--color-ice-deep)')}
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
                          borderBottom: '1px solid var(--color-ice-deep)',
                          color: 'var(--color-ice-light)',
                          padding: '5px 2px', fontSize: 11, fontWeight: 700,
                          outline: 'none',
                          fontFamily: 'var(--font-mono)',
                          letterSpacing: '0.05em',
                          transition: 'border-color 0.15s',
                        }}
                        onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-ice)')}
                        onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--color-ice-deep)')}
                      />
                      <button
                        onClick={() => addQuestToDeliverable(d.id)}
                        disabled={!(newQuestByDeliv[d.id] ?? '').trim()}
                        style={{
                          background: (newQuestByDeliv[d.id] ?? '').trim() ? 'rgba(143, 191, 211, 0.14)' : 'rgba(8, 12, 18, 0.55)',
                          border: `1px solid ${(newQuestByDeliv[d.id] ?? '').trim() ? 'var(--color-ice)' : 'var(--color-border)'}`,
                          color: (newQuestByDeliv[d.id] ?? '').trim() ? 'var(--color-ice-light)' : 'var(--color-text-muted)',
                          cursor: (newQuestByDeliv[d.id] ?? '').trim() ? 'pointer' : 'not-allowed',
                          fontFamily: 'var(--font-mono)',
                          padding: '5px 12px', fontSize: 9, fontWeight: 700,
                          letterSpacing: '0.22em', textTransform: 'uppercase',
                          borderRadius: 0,
                          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                          boxShadow: (newQuestByDeliv[d.id] ?? '').trim() ? '0 0 8px rgba(143, 191, 211, 0.20)' : 'none',
                          transition: 'all 0.15s',
                        }}
                      >
                        + ADD
                      </button>
                    </div>

                    {/* Delete deliverable (só se estiver sem quests) */}
                    {delivQuests.length === 0 && (
                      <button
                        onClick={() => handleDeleteDeliverable(d.id)}
                        style={{
                          alignSelf: 'flex-start', marginTop: 8,
                          background: 'none', border: 'none',
                          color: 'var(--color-text-muted)', cursor: 'pointer',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9, fontWeight: 700,
                          letterSpacing: '0.22em', textTransform: 'uppercase',
                          padding: '4px 0',
                          transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                      >
                        ✕ DELETAR ENTREGÁVEL
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

      {currentPageId === null ? (
        <div style={{ marginTop: 40, paddingTop: 28, borderTop: '1px solid var(--color-divider)' }}>
          <Label>informações detalhadas</Label>
          <div style={{ marginTop: 10 }}>
            <Suspense fallback={<EditorFallback />}>
              <BlockEditor
                value={notesDraft ?? project.notes ?? ''}
                onChange={setNotesDraft}
                placeholder="Digite / pra escolher o tipo de bloco…"
                minHeight={200}
                pages={{
                  pages: pagesMeta,
                  onPageNavigate: setCurrentPageId,
                  onCreatePage: () => handleCreatePage(null),
                  cleanupPageIds: orphanCleanupIds,
                  onCleanupDone: handleCleanupDone,
                  isLoading: pagesLoading,
                  fetchPreview: fetchPreviewForPage,
                }}
              />
            </Suspense>
          </div>
        </div>
      ) : (
        <PageView
          pageId={currentPageId}
          projectTitle={project.title}
          pagesMeta={pagesMeta}
          justCreated={pageJustCreated}
          onJustCreatedClear={() => setPageJustCreated(null)}
          onNavigate={setCurrentPageId}
          onPageChanged={reloadPages}
          onPageDeleted={handlePageDeleted}
          onCreatePage={parentId => handleCreatePage(parentId)}
          cleanupPageIds={orphanCleanupIds}
          onCleanupDone={handleCleanupDone}
          fetchPreview={fetchPreviewForPage}
        />
      )}

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
// Doc: docs/hub-finance/PLAN.md (v1 — integração com MAINFRAME).

function FinanceBlock({ project, totalExecutedMin, onUpdateValor, onUpdateCliente }: {
  project: Project
  totalExecutedMin: number
  onUpdateValor: (valor: number | null) => void
  onUpdateCliente: (clienteId: string | null) => void
}) {
  // Invalidator pro Hub Finance — parcelas afetam rollup de freela project,
  // sumário mensal, hourlyStats. Sem invalidação aqui, criar/editar parcela
  // não atualizava /finance/freelas até F5.
  const finInv = useFinanceInvalidator()
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
  // Toggle de colapsar/expandir o bloco inteiro. Persiste por projeto via
  // localStorage — usuário que sempre quer fechado num projeto não precisa
  // re-clicar a cada navegação. Default: expandido.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(`hq-finance-collapsed-${project.id}`) === '1'
    } catch { return false }
  })
  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(`hq-finance-collapsed-${project.id}`, next ? '1' : '0') } catch {}
      return next
    })
  }

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
    // Propaga pro Hub Finance — qualquer mutação em parcela aqui (criar,
    // editar, deletar) afeta sumário de freelas, hourlyStats, sumário mensal.
    finInv.all(); tabSync.emit('finance')
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
      finInv.all(); tabSync.emit('finance')
    } catch (err: any) {
      reportApiError('applyTemplate', err)
      alertDialog({
        title: 'Erro',
        message: err?.message ?? 'Erro ao aplicar template — veja o console.',
        variant: 'danger',
      })
    } finally {
      setParcelaActionsBusy(false)
    }
  }

  // Resumo compacto pro estado colapsado — preview rápido sem precisar
  // expandir. Mostra valor acordado + recebido + a receber.
  const totalRecebidoForSummary = parcelas
    .filter(p => p.status === 'recebido')
    .reduce((s, p) => s + p.valor, 0)
  const aReceberForSummary = (project.valor_acordado ?? 0) - totalRecebidoForSummary
  const formatBRLLocal = (v: number) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
  }).format(v)

  return (
    <div style={{
      marginBottom: 24, padding: collapsed ? '12px 16px' : '14px 16px',
      background: 'rgba(8, 12, 18, 0.55)',
      border: '1px solid rgba(143, 191, 211, 0.22)',
      borderLeft: '2px solid var(--color-ice-light)',
      borderRadius: 0,
      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
      transition: 'padding var(--motion-fast) var(--ease-smooth)',
    }}>
      <div
        onClick={toggleCollapsed}
        title={collapsed ? 'Expandir Finance' : 'Colapsar Finance'}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10, fontWeight: 700,
          color: 'var(--color-ice-light)',
          letterSpacing: '0.25em', textTransform: 'uppercase',
          marginBottom: collapsed ? 0 : 14,
          display: 'flex', alignItems: 'center', gap: 8,
          paddingBottom: collapsed ? 0 : 8,
          borderBottom: collapsed ? 'none' : '1px solid var(--color-ice-deep)',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'margin-bottom var(--motion-fast) var(--ease-smooth), padding-bottom var(--motion-fast) var(--ease-smooth)',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 3, height: 14,
            background: 'var(--color-ice)',
            boxShadow: '0 0 8px var(--color-ice-glow)',
          }}
        />
        <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
        FINANCE
        {/* Resumo inline quando colapsado — preview do valor + status */}
        {collapsed && project.valor_acordado != null && (
          <span style={{
            color: 'var(--color-text-tertiary)',
            fontWeight: 700, marginLeft: 10,
            display: 'inline-flex', alignItems: 'center', gap: 8,
            letterSpacing: '0.18em',
          }}>
            <span style={{ color: 'var(--color-text-muted)' }}>·</span>
            <span style={{ color: 'var(--color-ice-light)' }}>{formatBRLLocal(project.valor_acordado)}</span>
            {parcelas.length > 0 && (
              <>
                <span style={{ color: 'var(--color-text-muted)' }}>·</span>
                <span style={{ color: 'var(--color-success-light)' }}>
                  {formatBRLLocal(totalRecebidoForSummary)} RCV
                </span>
                {aReceberForSummary > 0 && (
                  <>
                    <span style={{ color: 'var(--color-text-muted)' }}>·</span>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>
                      {formatBRLLocal(aReceberForSummary)} PEND
                    </span>
                  </>
                )}
              </>
            )}
          </span>
        )}
        {/* Chevron toggle no canto direito */}
        <span
          aria-hidden="true"
          style={{
            marginLeft: 'auto',
            color: 'var(--color-ice-light)',
            background: 'rgba(143, 191, 211, 0.06)',
            border: '1px solid rgba(143, 191, 211, 0.18)',
            padding: '3px 8px',
            fontSize: 10,
            borderRadius: 0,
            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
            transition: 'all 0.15s',
          }}
        >
          {collapsed ? '▶' : '▼'}
        </span>
      </div>

      {!collapsed && (
      <>
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
                background: 'rgba(8, 12, 18, 0.85)',
                border: '1px solid var(--color-ice)',
                borderRadius: 0,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                padding: '7px 10px',
                color: 'var(--color-ice-light)',
                fontSize: 14, fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em',
                outline: 'none',
                boxShadow: '0 0 10px rgba(143, 191, 211, 0.30)',
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
            marginTop: 12, padding: '8px 14px',
            background: 'rgba(8, 12, 18, 0.55)',
            border: '1px solid rgba(143, 191, 211, 0.18)',
            borderRadius: 0,
            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
            color: 'var(--color-text-tertiary)',
            letterSpacing: '0.18em', textTransform: 'uppercase',
          }}>
            <span>
              <span style={{ color: 'var(--color-text-muted)', marginRight: 5 }}>{tipo}</span>
              <span style={{ color: 'var(--color-ice-light)' }}>{formatBRL(projetoRate)}/h</span>
            </span>
            <span style={{ color: 'var(--color-text-muted)' }}>VS</span>
            <span>
              <span style={{ color: 'var(--color-text-muted)', marginRight: 5 }}>MED</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>{formatBRL(mediaRate)}/h</span>
            </span>
            <span style={{
              fontSize: 9, fontWeight: 700,
              padding: '3px 9px',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
              letterSpacing: '0.22em', textTransform: 'uppercase',
              color: acimaMedia ? 'var(--color-success-light)' : 'var(--color-accent-light)',
              border: `1px solid ${acimaMedia ? 'var(--color-success)' : 'var(--color-accent-primary)'}`,
              background: acimaMedia ? 'rgba(94, 122, 82, 0.14)' : 'rgba(159, 18, 57, 0.14)',
              boxShadow: acimaMedia ? '0 0 8px rgba(94, 122, 82, 0.25)' : '0 0 8px rgba(159, 18, 57, 0.25)',
            }}>
              {acimaMedia ? '↑' : '↓'} {formatBRL(Math.abs(diff))}/H {acimaMedia ? 'ACIMA' : 'ABAIXO'}
            </span>
          </div>
        )
      })()}

      {/* Cliente — habilita auto-vínculo de receita por CPF/CNPJ */}
      <div style={{
        marginTop: 14, paddingTop: 12,
        borderTop: '1px solid var(--color-ice-deep)',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={fieldLabelMini()}>
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
          CLIENTE
        </span>
        <select
          value={project.cliente_id ?? ''}
          onChange={e => onUpdateCliente(e.target.value || null)}
          style={{
            background: 'rgba(8, 12, 18, 0.55)',
            border: '1px solid var(--color-border)',
            borderRadius: 0,
            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
            padding: '6px 12px',
            color: 'var(--color-ice-light)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: '0.05em',
            minWidth: 200,
            outline: 'none',
            transition: 'all 0.15s',
          }}
          onFocus={e => {
            e.currentTarget.style.borderColor = 'var(--color-ice)'
            e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = 'var(--color-border)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        >
          <option value="">— SEM CLIENTE —</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>
              {c.nome}{c.cpf_cnpj ? ` (${c.cpf_cnpj})` : ''}
            </option>
          ))}
        </select>
        {selectedClient?.cpf_cnpj && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            color: 'var(--color-success-light)',
            letterSpacing: '0.18em', textTransform: 'uppercase',
          }}>
            <span style={{ color: 'var(--color-success)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            AUTO-LINK ATIVO
          </span>
        )}
        {selectedClient && !selectedClient.cpf_cnpj && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            color: 'var(--color-warning-light)',
            letterSpacing: '0.18em', textTransform: 'uppercase',
          }}>
            <span style={{ color: 'var(--color-warning)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            SEM CPF/CNPJ
          </span>
        )}
      </div>

      {/* Sub-resumo: recebido / a receber */}
      {valor != null && parcelas.length > 0 && (
        <div style={{
          marginTop: 14, paddingTop: 12,
          borderTop: '1px solid var(--color-ice-deep)',
          display: 'flex', gap: 16, flexWrap: 'wrap',
          fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
          letterSpacing: '0.18em', textTransform: 'uppercase',
        }}>
          <span>
            <span style={{ color: 'var(--color-text-muted)', marginRight: 5 }}>//RCV</span>
            <span style={{ color: 'var(--color-success-light)' }}>{formatBRL(totalRecebido)}</span>
          </span>
          <span>
            <span style={{ color: 'var(--color-text-muted)', marginRight: 5 }}>//PEND</span>
            <span style={{ color: 'var(--color-ice-light)' }}>{formatBRL(Math.max(0, aReceber))}</span>
          </span>
        </div>
      )}

      {/* Seção de parcelas */}
      {valor != null && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--color-ice-deep)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={fieldLabelMini()}>
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              PARCELAS ESPERADAS
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setShowTemplateModal(true)}
              disabled={parcelaActionsBusy}
              style={ghostButtonMini()}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'var(--color-ice-light)'
                e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--color-text-tertiary)'
                e.currentTarget.style.borderColor = 'var(--color-border)'
              }}
            >
              {project.forma_pagamento_template ? '↻ TEMPLATE' : '+ TEMPLATE'}
            </button>
            <button
              onClick={() => setEditingParcela('new')}
              disabled={parcelaActionsBusy}
              style={ghostButtonMini()}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'var(--color-ice-light)'
                e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--color-text-tertiary)'
                e.currentTarget.style.borderColor = 'var(--color-border)'
              }}
            >
              + NOVA PARCELA
            </button>
          </div>

          {parcelas.length === 0 ? (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10, fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.18em', textTransform: 'uppercase',
              padding: '14px 16px',
              border: '1px dashed rgba(143, 191, 211, 0.30)',
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
              lineHeight: 1.6,
            }}>
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              NENHUMA PARCELA REGISTRADA · USE TEMPLATE OU + NOVA
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
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
      </>
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
  pendente:   { label: 'PENDENTE',  color: 'var(--color-ice-light)' },
  recebido:   { label: 'RECEBIDO',  color: 'var(--color-success-light)' },
  atrasado:   { label: 'ATRASADO',  color: 'var(--color-accent-light)' },
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
      alignItems: 'center', padding: '8px 12px',
      background: 'rgba(8, 12, 18, 0.55)',
      border: '1px solid rgba(143, 191, 211, 0.18)',
      borderLeft: `2px solid ${meta.color}`,
      borderRadius: 0,
      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%)',
      transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
    }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.40)'
        e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.15)'
        e.currentTarget.style.transform = 'translateX(2px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.18)'
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.transform = 'translateX(0)'
      }}
    >
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10, fontWeight: 700,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.15em',
      }}>
        #{parcela.numero.toString().padStart(2, '0')}
      </span>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 13, fontWeight: 700,
        color: 'var(--color-ice-light)',
        letterSpacing: '0.05em',
      }}>
        {formatBRL(parcela.valor)}
      </span>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10, fontWeight: 700,
        color: 'var(--color-text-tertiary)',
        letterSpacing: '0.05em',
      }}>
        {formatDate(parcela.data_prevista)}
      </span>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9, fontWeight: 700,
        color: meta.color,
        letterSpacing: '0.22em',
      }}>
        <span style={{ color: meta.color, opacity: 0.85, marginRight: 3, letterSpacing: 0 }}>//</span>
        {meta.label}
      </span>
      <button
        onClick={onEdit}
        title="editar parcela"
        style={{
          background: 'rgba(143, 191, 211, 0.06)',
          border: '1px solid rgba(143, 191, 211, 0.18)',
          cursor: 'pointer',
          color: 'var(--color-ice-light)',
          padding: '4px 6px',
          borderRadius: 0,
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
          display: 'inline-flex', alignItems: 'center',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(143, 191, 211, 0.14)'
          e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'rgba(143, 191, 211, 0.06)'
          e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.18)'
        }}
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
    if (isNaN(v) || v <= 0) {
      await alertDialog({
        title: 'Valor inválido',
        message: 'Valor da parcela deve ser maior que zero.',
        variant: 'warning',
      })
      return
    }
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
      alertDialog({
        title: 'Erro',
        message: err?.message ?? 'Erro ao salvar — veja o console.',
        variant: 'danger',
      })
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!parcela) return
    const ok = await confirmDialog({
      title: `Deletar parcela #${parcela.numero.toString().padStart(2, '0')}`,
      message: 'Deletar esta parcela?\nTransação vinculada (se existir) continua existindo, mas perde o vínculo.',
      confirmLabel: 'DELETAR',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await deleteFinParcela(parcela.id)
      onDeleted()
    } catch (err) {
      reportApiError('ParcelaModal.delete', err)
      alertDialog({
        title: 'Erro',
        message: 'Erro ao deletar — veja o console.',
        variant: 'danger',
      })
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
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            {isNew ? 'NEW.PARCELA' : `EDIT.PARCELA #${parcela!.numero.toString().padStart(2, '0')}`}
          </div>
        </div>
        <div style={modalBody()}>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={modalFieldLabel()}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                VALOR
              </label>
              <input
                autoFocus
                type="text" inputMode="decimal" placeholder="ex: 1000,00"
                value={valor} onChange={e => setValor(e.target.value)}
                style={modalInput()}
                onFocus={e => {
                  e.currentTarget.style.borderColor = 'var(--color-ice)'
                  e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              />
            </div>
            <div>
              <label style={modalFieldLabel()}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                DATA PREVISTA
              </label>
              <input
                type="date"
                value={dataPrevista} onChange={e => setDataPrevista(e.target.value)}
                style={{ ...modalInput(), colorScheme: 'dark' } as any}
                onFocus={e => {
                  e.currentTarget.style.borderColor = 'var(--color-ice)'
                  e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              />
            </div>
          </div>
          {!isNew && (
            <div>
              <label style={modalFieldLabel()}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                STATUS
              </label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as FinParcela['status'])}
                style={modalInput()}
                onFocus={e => {
                  e.currentTarget.style.borderColor = 'var(--color-ice)'
                  e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <option value="pendente">PENDENTE</option>
                <option value="recebido">RECEBIDO</option>
                <option value="atrasado">ATRASADO</option>
                <option value="cancelada">CANCELADA</option>
              </select>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-text-muted)',
                marginTop: 6,
                letterSpacing: '0.15em', textTransform: 'uppercase',
                lineHeight: 1.6,
              }}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                NORMALMENTE AUTO · MANUAL SÓ PRA "CANCELADA" / "ATRASADO"
              </div>
            </div>
          )}
          <div>
            <label style={modalFieldLabel()}>
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              OBSERVAÇÃO
            </label>
            <input
              type="text" placeholder="ex: condicional à entrega da v1"
              value={observacao} onChange={e => setObservacao(e.target.value)}
              style={modalInput()}
              onFocus={e => {
                e.currentTarget.style.borderColor = 'var(--color-ice)'
                e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = 'var(--color-border)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 8 }}>
            {!isNew ? (
              <button type="button" onClick={handleDelete} disabled={busy} style={{
                ...modalGhost(),
                color: 'var(--color-accent-light)',
                borderColor: 'var(--color-accent-primary)',
                background: 'rgba(159, 18, 57, 0.10)',
                boxShadow: '0 0 10px rgba(159, 18, 57, 0.18)',
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(159, 18, 57, 0.18)'
                  e.currentTarget.style.boxShadow = '0 0 16px rgba(159, 18, 57, 0.30)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(159, 18, 57, 0.10)'
                  e.currentTarget.style.boxShadow = '0 0 10px rgba(159, 18, 57, 0.18)'
                }}
              >
                <Trash2 size={11} strokeWidth={1.8} style={{ marginRight: 6 }} />
                DELETAR
              </button>
            ) : <div />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onClose} style={modalGhost()}>CANCELAR</button>
              <button type="submit" disabled={busy} style={modalPrimary()}>
                {busy ? 'SALVANDO…' : (isNew ? 'CRIAR' : 'SALVAR')}
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
          <div style={{ ...modalLabel(), marginBottom: 0 }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            APPLY.TEMPLATE
          </div>
        </div>
        <div style={modalBody()}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10, fontWeight: 700,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.18em', textTransform: 'uppercase',
          marginBottom: 16,
          lineHeight: 1.7,
        }}>
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
          APAGA PARCELAS PENDENTES E CRIA NOVAS · RECEBIDAS PRESERVADAS
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {TEMPLATES.map(t => {
            const selected = template === t.value
            return (
              <label
                key={t.value}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '9px 12px', cursor: 'pointer',
                  background: selected ? 'rgba(143, 191, 211, 0.10)' : 'rgba(8, 12, 18, 0.55)',
                  border: `1px solid ${selected ? 'var(--color-ice)' : 'rgba(143, 191, 211, 0.18)'}`,
                  borderLeft: `2px solid ${selected ? 'var(--color-ice-light)' : 'rgba(143, 191, 211, 0.30)'}`,
                  borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%)',
                  boxShadow: selected ? '0 0 10px rgba(143, 191, 211, 0.20)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                <input
                  type="radio"
                  name="template"
                  value={t.value}
                  checked={selected}
                  onChange={() => setTemplate(t.value)}
                  style={{ marginTop: 2, accentColor: 'var(--color-ice)' }}
                />
                <div>
                  <div style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 12, fontWeight: 600,
                    color: selected ? 'var(--color-ice-light)' : 'var(--color-text-primary)',
                    letterSpacing: '0.02em',
                    textTransform: 'uppercase',
                  }}>
                    {t.label}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700,
                    color: 'var(--color-text-muted)',
                    letterSpacing: '0.18em', textTransform: 'uppercase',
                    marginTop: 3,
                  }}>
                    {t.desc}
                  </div>
                </div>
              </label>
            )
          })}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={modalFieldLabel()}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            DATA DA 1ª PARCELA (OPCIONAL)
          </label>
          <input
            type="date"
            value={dataInicio} onChange={e => setDataInicio(e.target.value)}
            style={{ ...modalInput(), colorScheme: 'dark' } as any}
            onFocus={e => {
              e.currentTarget.style.borderColor = 'var(--color-ice)'
              e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          />
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            color: 'var(--color-text-muted)',
            marginTop: 6,
            letterSpacing: '0.15em', textTransform: 'uppercase',
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            PARCELAS SEGUINTES SERÃO MENSAIS A PARTIR DESSA DATA
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={modalGhost()}>CANCELAR</button>
          {!confirming ? (
            <button onClick={() => setConfirming(true)} style={modalPrimary()}>APLICAR</button>
          ) : (
            <button onClick={tryApply} style={{
              ...modalPrimary(),
              background: 'rgba(159, 18, 57, 0.16)',
              border: '1px solid var(--color-accent-primary)',
              color: 'var(--color-accent-light)',
              boxShadow: '0 0 12px rgba(159, 18, 57, 0.30)',
            }}>
              <CheckCircle size={11} strokeWidth={2} style={{ marginRight: 4 }} />
              CONFIRMAR · APAGA PENDENTES
            </button>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}

// ─── Style helpers (modais + bloco financeiro) ───────────────────────────
// Todos cyber-mono uppercase com chamfer-bl + ice borders + glow no focus.

function fieldLabelMini(): React.CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 9, fontWeight: 700,
    color: 'var(--color-text-muted)',
    letterSpacing: '0.22em', textTransform: 'uppercase',
    marginBottom: 5,
  }
}

function ghostButtonMini(): React.CSSProperties {
  return {
    background: 'rgba(8, 12, 18, 0.55)',
    border: '1px solid var(--color-border)',
    cursor: 'pointer',
    color: 'var(--color-text-tertiary)',
    fontFamily: 'var(--font-mono)',
    padding: '5px 10px',
    borderRadius: 0,
    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
    fontSize: 9, fontWeight: 700,
    letterSpacing: '0.22em', textTransform: 'uppercase',
    transition: 'all 0.15s',
  }
}

function modalLabel(): React.CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 10, fontWeight: 700,
    color: 'var(--color-ice-light)',
    letterSpacing: '0.25em', textTransform: 'uppercase',
    marginBottom: 16,
  }
}

function modalFieldLabel(): React.CSSProperties {
  return {
    display: 'block', marginBottom: 5,
    fontFamily: 'var(--font-mono)',
    fontSize: 9, fontWeight: 700,
    color: 'var(--color-text-muted)',
    letterSpacing: '0.22em', textTransform: 'uppercase',
  }
}

function modalInput(): React.CSSProperties {
  return {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(8, 12, 18, 0.55)',
    border: '1px solid var(--color-border)',
    borderRadius: 0,
    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
    padding: '8px 12px',
    color: 'var(--color-ice-light)',
    fontSize: 12, fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    letterSpacing: '0.02em',
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  }
}

function modalPrimary(): React.CSSProperties {
  return {
    background: 'rgba(143, 191, 211, 0.14)',
    border: '1px solid var(--color-ice)',
    cursor: 'pointer',
    color: 'var(--color-ice-light)',
    fontFamily: 'var(--font-mono)',
    padding: '7px 16px',
    borderRadius: 0,
    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
    fontSize: 10, fontWeight: 700,
    letterSpacing: '0.22em', textTransform: 'uppercase',
    display: 'inline-flex', alignItems: 'center', gap: 6,
    boxShadow: '0 0 12px rgba(143, 191, 211, 0.25)',
    transition: 'all 0.15s',
  }
}

function modalGhost(): React.CSSProperties {
  return {
    background: 'rgba(8, 12, 18, 0.55)',
    border: '1px solid var(--color-border)',
    cursor: 'pointer',
    color: 'var(--color-text-tertiary)',
    fontFamily: 'var(--font-mono)',
    padding: '7px 14px',
    borderRadius: 0,
    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
    fontSize: 10, fontWeight: 700,
    letterSpacing: '0.22em', textTransform: 'uppercase',
    display: 'inline-flex', alignItems: 'center',
    transition: 'all 0.15s',
  }
}
