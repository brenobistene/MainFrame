import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, FileText, Trash2 } from 'lucide-react'
import type { ProjectPage, ProjectPageMeta } from '../types'
import {
  fetchPage,
  fetchPageDescendants,
  updatePage,
  deletePage,
  reportApiError,
} from '../api'
import { InlineText } from './ui/InlineText'
import { isBlockDocEmpty } from './block-utils'
import { alertDialog } from '../lib/dialog'

const BlockEditor = lazy(() =>
  import('./BlockEditor').then(m => ({ default: m.BlockEditor }))
)

/**
 * View da página corrente — header com breadcrumb + título editável +
 * menu de delete, e abaixo o BlockEditor renderizando o `content_json` da
 * própria page. Doc: docs/nested-pages/PLAN.md
 *
 * Renderizado pelo `QuestDetailPanel` quando `currentPageId != null`. A
 * página raiz (notes do projeto) usa o BlockEditor direto sem esse wrapper.
 */
export function PageView({
  pageId,
  projectTitle,
  pagesMeta,
  justCreated,
  onJustCreatedClear,
  onNavigate,
  onPageChanged,
  onPageDeleted,
  onCreatePage,
  cleanupPageIds,
  onCleanupDone,
  fetchPreview,
}: {
  pageId: string
  projectTitle: string
  /** Lista flat de todas as pages do projeto — usada pra breadcrumb e pro
   *  context do BlockEditor. */
  pagesMeta: ProjectPageMeta[]
  /** Se igual ao pageId atual, abre o título já em modo edit (Notion-style:
   *  criar page → cursor já piscando no título). */
  justCreated: string | null
  /** Limpa o flag de "recém criada" depois que o auto-edit do título começar. */
  onJustCreatedClear: () => void
  /** Navegar pra outra page (string) ou pra raiz (null). */
  onNavigate: (pageId: string | null) => void
  /** Callback quando o título da page atual é editado — sinaliza pro
   *  painel pra invalidar a lista batch. */
  onPageChanged: () => void
  /** Callback quando a page atual é deletada — passa ids deletados pra
   *  o painel limpar blocos `page` órfãos no JSON do pai. */
  onPageDeleted: (deletedIds: string[]) => void
  /** Cria uma nova page filha da page atual e devolve o id. Reusado pelo
   *  BlockEditor (slash menu `/page`). */
  onCreatePage: (parentPageId: string) => Promise<string>
  /** Ids de pages deletadas — BlockEditor remove blocos órfãos no JSON. */
  cleanupPageIds?: Set<string>
  /** Após cleanup processar — consumidor remove ids do Set. */
  onCleanupDone?: (cleaned: string[]) => void
  /** Lazy fetch do preview rico on-hover do card. Cache compartilhado
   *  vem do painel pra dedup entre raiz e PageViews aninhados. */
  fetchPreview?: (pageId: string) => Promise<string | null>
}) {
  const [page, setPage] = useState<ProjectPage | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [loading, setLoading] = useState(false)
  // Estado do autosave do content_json — feedback visual no header da page:
  //  - 'idle': sem mudanças pendentes / sem save recente (sem indicador)
  //  - 'pending': usuário editou, debounce ainda contando (dot âmbar)
  //  - 'saving': PATCH em flight (dot ice piscando)
  //  - 'saved': salvou recentemente, mostra "salvo" por 2s e volta pra idle
  const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle')
  // Ref pro timeout do autosave de content. Permite cancelar manualmente
  // antes de operações destrutivas (delete) — evita PATCH numa page que
  // já foi removida no backend.
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref pro timeout que reseta 'saved' → 'idle' depois de 2s.
  const savedFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Carrega a page sempre que muda o pageId. Reseta `page` pra null no
  // início pra evitar flash do conteúdo da page anterior enquanto o novo
  // fetch corre. `draft` é resetado pra null pra forçar o useEffect de
  // autosave a ignorar até o user editar de novo. AbortController cancela
  // requests em flight quando o usuário troca de page rapidamente.
  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setPage(null)
    setDraft(null)
    fetchPage(pageId, ac.signal)
      .then(p => {
        if (ac.signal.aborted) return
        setPage(p)
      })
      .catch(err => {
        if (err?.name === 'AbortError') return
        reportApiError('PageView.fetchPage', err)
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [pageId])

  // Autosave do content_json com debounce 800ms (mesmo padrão do
  // notesDraft do QuestDetailPanel pro `notes` do projeto). O timeout id
  // fica no ref pra permitir cancelamento manual antes de DELETE.
  // Atualiza saveStatus pra dar feedback visual: pending → saving → saved.
  useEffect(() => {
    if (draft === null || !page) return
    const current = page.content_json ?? null
    const incoming = isBlockDocEmpty(draft) ? null : draft
    if (incoming === current) return
    setSaveStatus('pending')
    const t = setTimeout(() => {
      autosaveTimeoutRef.current = null
      setSaveStatus('saving')
      updatePage(page.id, { content_json: incoming })
        .then(updated => {
          setPage(updated)
          setSaveStatus('saved')
          // Volta pra 'idle' depois de 2s (suficiente pro usuário ver "salvo").
          if (savedFlashTimeoutRef.current) clearTimeout(savedFlashTimeoutRef.current)
          savedFlashTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
        })
        .catch(err => {
          setSaveStatus('idle')
          reportApiError('PageView.updateContent', err)
          alertDialog({
            title: 'Falha ao salvar',
            message: 'Não foi possível salvar o conteúdo desta página. Verifique se o backend está rodando.',
            variant: 'danger',
          })
        })
    }, 800)
    autosaveTimeoutRef.current = t
    return () => {
      clearTimeout(t)
      if (autosaveTimeoutRef.current === t) autosaveTimeoutRef.current = null
    }
  }, [draft, page])

  // Cleanup do timeout do flash 'saved' ao desmontar pra não vazar timer.
  useEffect(() => {
    return () => {
      if (savedFlashTimeoutRef.current) clearTimeout(savedFlashTimeoutRef.current)
    }
  }, [])

  // Cancela o autosave pendente antes de uma ação destrutiva (delete).
  // Chamado pelo PageDeleteModal logo antes do DELETE pra evitar race
  // em que o setTimeout dispara PATCH numa page já apagada → 404 +
  // toast de erro confuso pro usuário.
  function cancelPendingAutosave() {
    if (autosaveTimeoutRef.current !== null) {
      clearTimeout(autosaveTimeoutRef.current)
      autosaveTimeoutRef.current = null
    }
  }

  function handleTitleSave(newTitle: string) {
    if (!page) return
    const trimmed = newTitle.trim() || 'Sem título'
    if (trimmed === page.title) return
    updatePage(page.id, { title: trimmed })
      .then(updated => {
        setPage(updated)
        onPageChanged()
      })
      .catch(err => {
        reportApiError('PageView.updateTitle', err)
        alertDialog({
          title: 'Falha ao renomear',
          message: 'Não foi possível renomear esta página.',
          variant: 'danger',
        })
      })
  }

  // Monta breadcrumb subindo de parent_page_id até a raiz. Deps específicas
  // (parent_page_id) em vez do `page` inteiro pra não recomputar a cada PATCH
  // response que muda só timestamps/conteúdo.
  const parentId = page?.parent_page_id ?? null
  const trail = useMemo<ProjectPageMeta[]>(() => {
    if (!parentId) return []
    const byId: Record<string, ProjectPageMeta> = {}
    for (const p of pagesMeta) byId[p.id] = p
    const ancestors: ProjectPageMeta[] = []
    let cursor: string | null = parentId
    let safety = 0
    while (cursor && safety < 200) {
      const meta: ProjectPageMeta | undefined = byId[cursor]
      if (!meta) break
      ancestors.push(meta)
      cursor = meta.parent_page_id
      safety += 1
    }
    return ancestors.reverse()  // raiz → pai-direto
  }, [parentId, pagesMeta])

  if (loading && !page) {
    return (
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
        color: 'var(--color-text-muted)', letterSpacing: '0.22em',
        textTransform: 'uppercase', padding: '24px 0',
      }}>
        <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
        CARREGANDO.PAGE
      </div>
    )
  }

  if (!page) {
    return (
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 11,
        color: 'var(--color-accent-light)', padding: '24px 0',
      }}>
        Página não encontrada. <button
          onClick={() => onNavigate(null)}
          style={{
            background: 'none', border: 'none', color: 'var(--color-ice)',
            cursor: 'pointer', textDecoration: 'underline',
            fontFamily: 'inherit', fontSize: 'inherit',
          }}
        >
          ← voltar
        </button>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 40, paddingTop: 28, borderTop: '1px solid var(--color-divider)' }}>
      {/* Breadcrumb */}
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap',
        gap: 4, marginBottom: 16,
        fontFamily: 'var(--font-mono)', fontSize: 11,
        color: 'var(--color-text-muted)', letterSpacing: '0.05em',
      }}>
        <BreadcrumbLink
          label={projectTitle}
          onClick={() => onNavigate(null)}
        />
        {trail.map(meta => (
          <span key={meta.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <ChevronRight size={12} style={{ opacity: 0.5, flexShrink: 0 }} />
            <BreadcrumbLink label={meta.title} onClick={() => onNavigate(meta.id)} />
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <ChevronRight size={12} style={{ opacity: 0.5, flexShrink: 0 }} />
          <span
            style={{
              color: 'var(--color-text-secondary)',
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'inline-block',
            }}
            title={page.title}
          >
            {page.title}
          </span>
        </span>
      </div>

      {/* Header da página: ícone + título editável + indicador de save + delete */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 18,
      }}>
        <FileText size={22} style={{
          color: 'var(--color-ice)', opacity: 0.85, flexShrink: 0,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <InlineText
            value={page.title}
            onSave={v => {
              handleTitleSave(v)
              // Após o primeiro commit, libera o flag de "recém criada"
              // pra que re-renders não reabram edit involuntariamente.
              if (justCreated === page.id) onJustCreatedClear()
            }}
            allowEmpty
            autoEdit={justCreated === page.id}
            placeholder="Sem título"
            style={{
              fontSize: 22,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-primary)',
              letterSpacing: '0.02em',
              display: 'inline-block',
              width: '100%',
            }}
          />
        </div>
        <SaveStatusBadge status={saveStatus} />
        <button
          onClick={() => setConfirmDelete(true)}
          title="Excluir página"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-muted)', padding: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 4, transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = 'var(--color-accent-light)'
            e.currentTarget.style.background = 'rgba(232, 93, 58, 0.08)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--color-text-muted)'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Editor do conteúdo da página */}
      <Suspense fallback={
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
          color: 'var(--color-text-muted)', letterSpacing: '0.18em',
          textTransform: 'uppercase', padding: '20px 0',
        }}>
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
          LOADING.EDITOR
        </div>
      }>
        <BlockEditor
          // Force unmount/remount on pageId change — initialContent é
          // memoizado dentro do BlockEditor e não atualiza com troca de doc.
          key={page.id}
          value={draft ?? page.content_json ?? ''}
          onChange={setDraft}
          placeholder="Digite / pra escolher o tipo de bloco…"
          minHeight={200}
          pages={{
            pages: pagesMeta,
            onPageNavigate: pid => onNavigate(pid),
            onCreatePage: () => onCreatePage(page.id),
            cleanupPageIds,
            onCleanupDone,
            fetchPreview,
          }}
        />
      </Suspense>

      {confirmDelete && (
        <PageDeleteModal
          page={page}
          onCancel={() => setConfirmDelete(false)}
          onBeforeDelete={cancelPendingAutosave}
          onConfirmed={deletedIds => {
            // Page deletada → backend cuidou do cascade. Subimos pro parent
            // (ou raiz se for top-level) e avisamos o painel pra reload +
            // limpar blocos `page` órfãos no JSON do ancestral correto.
            const goTo = page.parent_page_id ?? null
            setConfirmDelete(false)
            onPageDeleted(deletedIds)
            onNavigate(goTo)
          }}
        />
      )}
    </div>
  )
}

// ─── Breadcrumb segment ─────────────────────────────────────────────────

function BreadcrumbLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--color-text-tertiary)',
        fontFamily: 'inherit', fontSize: 'inherit',
        letterSpacing: 'inherit', padding: 0,
        textDecoration: 'none', transition: 'color 0.15s',
        // Trunca títulos longos pra não quebrar layout em árvores profundas.
        // 180px ~ 24-28 chars em mono. Tooltip mostra título completo.
        maxWidth: 180,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        display: 'inline-block',
        verticalAlign: 'middle',
      }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ice-light)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
    >
      {label}
    </button>
  )
}

// ─── Save status indicator ──────────────────────────────────────────────

/**
 * Dot pequeno + label opcional ao lado do título da page, mostrando o
 * estado do autosave do content. Quatro estados:
 *  - idle: nada (sem indicador)
 *  - pending: usuário editou, debounce contando — dot âmbar discreto
 *  - saving: PATCH em flight — dot ice piscando
 *  - saved: salvou agora, mostra "salvo" por 2s — dot verde + label
 *
 * Tooltip via `title` HTML pra usuário hovering entender o estado.
 */
function SaveStatusBadge({ status }: { status: 'idle' | 'pending' | 'saving' | 'saved' }) {
  if (status === 'idle') return null

  const config = {
    pending: {
      color: 'var(--color-warning)',
      label: 'editando',
      pulse: false,
      title: 'Mudanças não salvas — autosave em ~1s',
    },
    saving: {
      color: 'var(--color-ice)',
      label: 'salvando…',
      pulse: true,
      title: 'Salvando alterações',
    },
    saved: {
      color: 'var(--color-success)',
      label: 'salvo',
      pulse: false,
      title: 'Alterações salvas',
    },
  }[status]

  return (
    <span
      title={config.title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: config.color,
          opacity: config.pulse ? undefined : 0.85,
          animation: config.pulse ? 'hq-pulse-dot 1s ease-in-out infinite' : undefined,
        }}
      />
      {config.label}
    </span>
  )
}

// ─── Delete confirmation modal ──────────────────────────────────────────

function PageDeleteModal({ page, onCancel, onBeforeDelete, onConfirmed }: {
  page: ProjectPage
  onCancel: () => void
  /** Disparado logo antes do DELETE. Use pra cancelar autosaves pendentes
   *  no PageView e evitar PATCH numa page que está prestes a sumir. */
  onBeforeDelete?: () => void
  /** Recebe os ids das pages deletadas (a própria + descendentes em cascade). */
  onConfirmed: (deletedIds: string[]) => void
}) {
  const [descendants, setDescendants] = useState<{ id: string; title: string; depth: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    fetchPageDescendants(page.id, ac.signal)
      .then(res => { if (!ac.signal.aborted) setDescendants(res.descendants) })
      .catch(err => {
        if (err?.name === 'AbortError') return
        reportApiError('PageDeleteModal.fetchDescendants', err)
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [page.id])

  // ESC fecha o modal e NÃO vaza pro painel (que tem handler navegacional
  // de ESC em capture phase). Sem isso, ESC com modal aberto navegava pra
  // parent E deixava o modal pendurado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (!deleting) onCancel()
    }
    window.addEventListener('keydown', onKey, true)  // capture
    return () => window.removeEventListener('keydown', onKey, true)
  }, [deleting, onCancel])

  async function handleConfirm() {
    setDeleting(true)
    onBeforeDelete?.()
    try {
      const res = await deletePage(page.id)
      onConfirmed(res.deleted_ids ?? [page.id])
    } catch (err) {
      reportApiError('PageDeleteModal.delete', err)
      setDeleting(false)
      alertDialog({
        title: 'Falha ao excluir',
        message: 'Não foi possível excluir esta página. Tente novamente.',
        variant: 'danger',
      })
    }
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          maxWidth: 480, width: '100%',
          maxHeight: '80vh', overflow: 'auto',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid var(--color-divider)',
          fontFamily: 'var(--font-mono)',
          fontSize: 13, fontWeight: 700,
          color: 'var(--color-text-primary)',
          letterSpacing: '0.05em',
        }}>
          Excluir "{page.title}"?
        </div>

        <div style={{ padding: '18px 24px' }}>
          {loading ? (
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--color-text-muted)', letterSpacing: '0.2em',
              textTransform: 'uppercase',
            }}>
              <span style={{ color: 'var(--color-ice)', marginRight: 4, letterSpacing: 0 }}>//</span>
              VERIFICANDO.FILHAS
            </div>
          ) : descendants.length === 0 ? (
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 12,
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6, margin: 0,
            }}>
              Esta ação não pode ser desfeita.
            </p>
          ) : (
            <>
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 12,
                color: 'var(--color-text-secondary)',
                lineHeight: 1.6, margin: '0 0 12px',
              }}>
                Esta página tem {descendants.length} {descendants.length === 1 ? 'sub-página' : 'sub-páginas'} que {descendants.length === 1 ? 'também será excluída' : 'também serão excluídas'}:
              </p>
              <ul style={{
                listStyle: 'none', padding: 0, margin: '0 0 16px',
                maxHeight: 200, overflow: 'auto',
                border: '1px solid var(--color-divider)',
                borderRadius: 4,
                background: 'rgba(8, 12, 18, 0.4)',
              }}>
                {descendants.map(d => (
                  <li
                    key={d.id}
                    style={{
                      padding: '6px 12px',
                      fontFamily: 'var(--font-mono)', fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      borderBottom: '1px solid rgba(143, 191, 211, 0.06)',
                      display: 'flex', alignItems: 'center', gap: 8,
                      paddingLeft: 12 + (d.depth - 1) * 16,
                    }}
                  >
                    <FileText size={12} style={{ opacity: 0.6, flexShrink: 0 }} />
                    <span style={{
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{d.title}</span>
                  </li>
                ))}
              </ul>
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 11,
                color: 'var(--color-text-muted)',
                margin: 0,
              }}>
                Esta ação não pode ser desfeita.
              </p>
            </>
          )}
        </div>

        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--color-divider)',
          display: 'flex', justifyContent: 'flex-end', gap: 12,
        }}>
          <button
            onClick={onCancel}
            disabled={deleting}
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-secondary)',
              cursor: deleting ? 'not-allowed' : 'pointer',
              padding: '7px 16px',
              fontFamily: 'var(--font-mono)',
              fontSize: 10, fontWeight: 700,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              borderRadius: 0,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting || loading}
            style={{
              background: 'rgba(232, 93, 58, 0.16)',
              border: '1px solid var(--color-accent-vivid)',
              color: 'var(--color-accent-light)',
              cursor: (deleting || loading) ? 'not-allowed' : 'pointer',
              padding: '7px 16px',
              fontFamily: 'var(--font-mono)',
              fontSize: 10, fontWeight: 700,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              borderRadius: 0,
              opacity: (deleting || loading) ? 0.6 : 1,
            }}
          >
            {deleting ? 'Excluindo…' : descendants.length > 0 ? 'Excluir tudo' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  )
}
