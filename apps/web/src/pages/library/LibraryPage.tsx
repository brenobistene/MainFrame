/**
 * /library — Lista principal do módulo Library.
 *
 * Filosofia: input curado, destilação > consumo. Sem rating, sem progresso %.
 * Status: queue → doing → done | abandoned.
 *
 * Layout:
 *  - Header com vitals (DOING, FILA, DONE 30D, REVISITAR 7D)
 *  - Filtros (status + tipo + busca)
 *  - Lista de cards clicáveis
 *
 * Doc: docs/library/PLAN.md.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Download,
  GripVertical,
  Layers,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import {
  useDeleteLibraryItem,
  useDeleteLibrarySaga,
  useLibraryItems,
  useLibraryPending,
  useLibrarySagas,
  useReorderSagaItems,
  useUpdateLibrarySaga,
} from '../../lib/library-queries'
import type {
  LibraryItemListEntry,
  LibraryItemStatus,
  LibraryItemTipo,
  LibrarySaga,
} from '../../types'
import { BODY, DISPLAY, MONO } from '../../components/health/tokens'
import { confirmDialog } from '../../lib/dialog'
import NewLibraryItemModal from './NewLibraryItemModal'

const LIBRARY_COR = '#7fb8a8'

// Vocabulário fechado dos tipos pra UI consistente.
const TIPO_LABEL: Record<LibraryItemTipo, string> = {
  livro: 'LIVRO',
  filme: 'FILME',
  serie: 'SÉRIE',
  podcast: 'PODCAST',
  artigo: 'ARTIGO',
  video: 'VÍDEO',
  curso: 'CURSO',
  palestra: 'PALESTRA',
  paper: 'PAPER',
  outro: 'OUTRO',
}

const STATUS_LABEL: Record<LibraryItemStatus, string> = {
  queue: 'FILA',
  doing: 'EM ANDAMENTO',
  done: 'FECHADO',
  abandoned: 'ABANDONADO',
}

const STATUS_COR: Record<LibraryItemStatus, string> = {
  queue: 'var(--color-text-muted)',
  doing: LIBRARY_COR,
  done: 'var(--color-ice-light)',
  abandoned: 'var(--color-text-secondary)',
}

type StatusFilter = LibraryItemStatus | 'todos'

export default function LibraryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tagSlugFromUrl = searchParams.get('tag_slug')

  const [createOpen, setCreateOpen] = useState(false)
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('todos')
  const [filterTipo, setFilterTipo] = useState<LibraryItemTipo | 'todos'>('todos')
  const [filterText, setFilterText] = useState('')

  // Filtro server-side de tag — vem via URL (link da Temas page).
  const { data: items = [] } = useLibraryItems(
    tagSlugFromUrl ? { tag_slug: tagSlugFromUrl } : undefined,
  )
  const { data: pending = [] } = useLibraryPending(7)
  const { data: sagas = [] } = useLibrarySagas()

  // Quando a tag mudar via URL, resetar status filter pra "todos" pra evitar
  // ficar com uma intersecção que esconde tudo silenciosamente.
  useEffect(() => {
    if (tagSlugFromUrl) setFilterStatus('todos')
  }, [tagSlugFromUrl])

  function clearTagFilter() {
    const next = new URLSearchParams(searchParams)
    next.delete('tag_slug')
    setSearchParams(next, { replace: true })
  }

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (filterStatus !== 'todos' && it.status !== filterStatus) return false
      if (filterTipo !== 'todos' && it.tipo !== filterTipo) return false
      if (filterText.trim()) {
        const q = filterText.toLowerCase()
        const match =
          it.titulo.toLowerCase().includes(q) ||
          (it.autor?.toLowerCase().includes(q) ?? false) ||
          it.tags.some((t) => t.nome.toLowerCase().includes(q))
        if (!match) return false
      }
      return true
    })
  }, [items, filterStatus, filterTipo, filterText])

  // Agrupa items filtrados por saga. Items órfãos (saga_id NULL) vão pra
  // lista flat embaixo; items dentro de saga aparecem só na seção SAGAS.
  // Filtros aplicam em ambas as áreas — saga com 0 matches some.
  const itemsBySaga = useMemo(() => {
    const map = new Map<number, LibraryItemListEntry[]>()
    for (const it of filtered) {
      if (it.saga_id != null) {
        const arr = map.get(it.saga_id) ?? []
        arr.push(it)
        map.set(it.saga_id, arr)
      }
    }
    // Ordena cada saga por saga_ordem
    for (const arr of map.values()) {
      arr.sort((a, b) => a.saga_ordem - b.saga_ordem)
    }
    return map
  }, [filtered])

  const orphanItems = useMemo(
    () => filtered.filter((it) => it.saga_id == null),
    [filtered],
  )

  // Quando filtro ativo, esconde sagas vazias (sem matches) pra reduzir
  // ruído. Sem filtro, mostra todas (inclusive vazias) pra usuário poder
  // gerenciar — uma saga recém-criada precisa aparecer mesmo sem items.
  const filterActive =
    filterStatus !== 'todos' ||
    filterTipo !== 'todos' ||
    filterText.trim() !== '' ||
    !!tagSlugFromUrl
  const sagasToShow = useMemo(() => {
    return sagas.filter((s) => {
      const count = itemsBySaga.get(s.id)?.length ?? 0
      if (filterActive) return count > 0
      return true
    })
  }, [sagas, itemsBySaga, filterActive])

  // Vitals do header
  const stats = useMemo(() => {
    const doing = items.filter((i) => i.status === 'doing').length
    const queue = items.filter((i) => i.status === 'queue').length
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 29)
    const cutoffIso = cutoff.toISOString().slice(0, 10)
    const done30 = items.filter(
      (i) => i.status === 'done' && (i.data_fim ?? '') >= cutoffIso,
    ).length
    return {
      doing,
      queue,
      done30,
      revisitar: pending.length,
    }
  }, [items, pending])

  return (
    <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-10)' }}>
      {/* HERO */}
      <header
        className="hq-glass-elevated hq-grain hq-chamfer-cross"
        style={{
          position: 'relative',
          padding: 'var(--space-4) var(--space-5)',
          marginBottom: 'var(--space-4)',
          borderLeft: `2px solid ${LIBRARY_COR}`,
        }}
      >
        <div
          aria-hidden="true"
          className="hq-hairline-ice"
          style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <BookOpen size={22} strokeWidth={1.6} color={LIBRARY_COR} />
          <h1
            style={{
              fontFamily: DISPLAY,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '0.18em',
              margin: 0,
              color: 'var(--color-text-primary)',
              textTransform: 'uppercase',
            }}
          >
            Library
          </h1>
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}
          >
            INPUT.CURADO
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              onClick={() => exportLibraryMarkdown(items)}
              className="hq-btn hq-btn--ghost"
              style={{ fontSize: 11, padding: '7px 12px' }}
              title="Exportar biblioteca em markdown"
            >
              <Download size={13} strokeWidth={2} /> EXPORT
            </button>
            <Link
              to="/library/temas"
              className="hq-btn hq-btn--ghost"
              style={{
                fontSize: 11,
                padding: '7px 12px',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
              title="Agregação por tag"
            >
              <Layers size={13} strokeWidth={2} /> TEMAS
            </Link>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="hq-btn hq-btn--primary"
              style={{ fontSize: 11, padding: '7px 14px' }}
            >
              <Plus size={13} strokeWidth={2.5} /> NOVO
            </button>
          </div>
        </div>

        {/* Indicador de filtro server-side por tag (vindo de /library/temas) */}
        {tagSlugFromUrl && (
          <div
            style={{
              marginTop: 'var(--space-2)',
              paddingTop: 'var(--space-2)',
              borderTop: '1px dashed var(--color-divider)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: MONO,
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            <span style={{ color: 'var(--color-text-muted)' }}>filtrando tag:</span>
            <span style={{ color: LIBRARY_COR, fontWeight: 700 }}>{tagSlugFromUrl}</span>
            <button
              type="button"
              onClick={clearTagFilter}
              className="hq-icon-btn-bare"
              title="Limpar filtro"
            >
              <X size={11} />
            </button>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 'var(--space-8)',
            alignItems: 'baseline',
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px dashed var(--color-divider)',
          }}
        >
          <BigStat label="EM ANDAMENTO" value={String(stats.doing)} accent={LIBRARY_COR} />
          <BigStat label="FILA" value={String(stats.queue)} accent="var(--color-text-secondary)" />
          <BigStat label="DONE 30D" value={String(stats.done30)} accent="var(--color-ice-light)" />
          <BigStat
            label="REVISITAR 7D"
            value={String(stats.revisitar)}
            accent={stats.revisitar > 0 ? 'var(--color-warning)' : 'var(--color-text-secondary)'}
          />
        </div>
      </header>

      {/* Pendências de revisita */}
      {pending.length > 0 && (
        <section style={{ marginBottom: 'var(--space-5)' }}>
          <SectionLabel>
            REVISITAR · {pending.length}{' '}
            <span style={{ color: 'var(--color-text-muted)' }}>
              · relê suas notas, não o material
            </span>
          </SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 'var(--space-3)' }}>
            {pending.map((p) => (
              <Link
                key={p.id}
                to={`/library/item/${p.id}`}
                className="hq-glass hq-row-hoverable hq-chamfer-bl"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '60px 1fr auto auto 16px',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: '8px 12px',
                  textDecoration: 'none',
                  color: 'inherit',
                  borderLeft: `2px solid ${p.dias_ate < 0 ? 'var(--color-warning)' : LIBRARY_COR}`,
                }}
              >
                <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
                  {TIPO_LABEL[p.tipo]}
                </span>
                <span
                  style={{
                    fontFamily: BODY,
                    fontSize: 13,
                    color: 'var(--color-text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.titulo}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    color: p.dias_ate < 0 ? 'var(--color-warning)' : 'var(--color-text-muted)',
                    letterSpacing: 0,
                  }}
                >
                  {p.dias_ate < 0
                    ? `atrasado ${Math.abs(p.dias_ate)}d`
                    : p.dias_ate === 0
                      ? 'hoje'
                      : `em ${p.dias_ate}d`}
                </span>
                <span
                  className="hq-tech-id"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {formatDateBR(p.revisitar_em)}
                </span>
                <ChevronRight size={11} color="var(--color-text-muted)" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Filtros */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--space-3)',
          marginTop: 'var(--space-5)',
          flexWrap: 'wrap',
        }}
      >
        <SectionLabel>ITENS</SectionLabel>
        <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
          {orphanItems.length} / {items.length}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(['todos', 'doing', 'queue', 'done', 'abandoned'] as const).map((s) => {
            const active = filterStatus === s
            return (
              <FilterChip
                key={s}
                active={active}
                onClick={() => setFilterStatus(s)}
                accent={LIBRARY_COR}
              >
                {s === 'todos' ? 'todos' : STATUS_LABEL[s].toLowerCase()}
              </FilterChip>
            )
          })}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}
      >
        <Search size={12} color="var(--color-text-muted)" />
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="buscar em título, autor, tags…"
          style={{
            flex: 1,
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            padding: '6px 10px',
            fontFamily: BODY,
            fontSize: 12,
            outline: 'none',
            letterSpacing: 0,
          }}
        />
        <select
          value={filterTipo}
          onChange={(e) => setFilterTipo(e.target.value as LibraryItemTipo | 'todos')}
          style={{
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
            padding: '6px 10px',
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            outline: 'none',
          }}
        >
          <option value="todos">todos os tipos</option>
          {(Object.keys(TIPO_LABEL) as LibraryItemTipo[]).map((t) => (
            <option key={t} value={t}>
              {TIPO_LABEL[t].toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      {/* Lista unificada — sagas e items órfãos compartilham o mesmo fluxo
          vertical. Sagas aparecem antes (ordenadas por saga.ordem), órfãos
          depois. Cada saga é um card expansível que contém seus items
          numerados — quando expanda, mostra inline; ao vincular item a uma
          saga, ele é "capturado" pra dentro dela e some daqui.
          Filtros aplicam aos dois fluxos. */}
      {sagasToShow.length === 0 && orphanItems.length === 0 ? (
        <div
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 12,
            padding: 'var(--space-6) 0',
            fontStyle: 'italic',
            fontFamily: BODY,
          }}
        >
          {items.length === 0 && sagas.length === 0
            ? 'Nenhum item ainda. Toca em NOVO pra começar.'
            : 'Nenhum item bate com o filtro.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sagasToShow.map((saga) => (
            <SagaCard
              key={`saga-${saga.id}`}
              saga={saga}
              items={itemsBySaga.get(saga.id) ?? []}
            />
          ))}
          {orphanItems.map((it) => (
            <ItemRow key={`item-${it.id}`} item={it} />
          ))}
        </div>
      )}

      {createOpen && <NewLibraryItemModal onClose={() => setCreateOpen(false)} />}
    </div>
  )
}

// ─── Subcomponentes ───────────────────────────────────────────────────────

function BigStat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 18,
          fontWeight: 500,
          color: accent,
          letterSpacing: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="hq-tech-label"
      style={{
        marginTop: 'var(--space-5)',
        marginBottom: 'var(--space-2)',
        fontSize: 10,
      }}
    >
      {children}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  accent,
  children,
}: {
  active: boolean
  onClick: () => void
  accent: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hq-chamfer-bl"
      style={{
        background: active ? accent : 'var(--color-bg-primary)',
        border: active ? `1px solid ${accent}` : '1px solid var(--color-border)',
        color: active ? '#000' : 'var(--color-text-secondary)',
        padding: '2px 10px',
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: active ? 700 : 500,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function ItemRow({ item }: { item: LibraryItemListEntry }) {
  const deleteItem = useDeleteLibraryItem()

  async function handleDelete(e: React.MouseEvent) {
    // stopPropagation + preventDefault evitam que o click do trash navegue
    // pra detail page via Link ancestral.
    e.stopPropagation()
    e.preventDefault()
    const ok = await confirmDialog({
      title: 'Deletar item da Library',
      message:
        `Deletar "${item.titulo}"? ` +
        'Apaga sessões, notas, conexões e tudo mais. Não dá pra desfazer.',
      confirmLabel: 'DELETAR',
      danger: true,
    })
    if (ok) deleteItem.mutate(item.id)
  }

  // Wrapper relativo permite trash absoluto top-right sem disputar com o
  // chamfer da card. paddingRight extra no Link reserva espaço pro botão
  // não colidir com tags/título.
  return (
    <div style={{ position: 'relative' }}>
      <Link
        to={`/library/item/${item.id}`}
        className="hq-glass hq-row-hoverable hq-chamfer-bl"
        style={{
          display: 'block',
          padding: 'var(--space-3) var(--space-4)',
          paddingRight: 'calc(var(--space-4) + 28px)',
          borderLeft: `2px solid ${STATUS_COR[item.status]}`,
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--space-2)',
            flexWrap: 'wrap',
          }}
        >
          <span
            className="hq-tech-id"
            style={{
              color: STATUS_COR[item.status],
              letterSpacing: '0.18em',
              border: `1px solid ${STATUS_COR[item.status]}`,
              padding: '1px 6px',
            }}
          >
            {TIPO_LABEL[item.tipo]}
          </span>
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {STATUS_LABEL[item.status].toLowerCase()}
          </span>
          {item.minutos_total > 0 && (
            <span
              className="hq-tech-id"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {formatMinutes(item.minutos_total)}
            </span>
          )}
          {item.revisitar_em && (
            <span
              className="hq-tech-id"
              style={{ color: 'var(--color-warning)' }}
            >
              revisitar {formatDateBR(item.revisitar_em)}
            </span>
          )}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {item.tags.map((t) => (
              <span
                key={t.id}
                className="hq-tech-id"
                style={{
                  color: t.cor ?? LIBRARY_COR,
                  border: `1px solid ${t.cor ?? LIBRARY_COR}`,
                  padding: '1px 6px',
                }}
              >
                {t.nome}
              </span>
            ))}
          </span>
        </div>
        <div
          style={{
            fontFamily: BODY,
            fontSize: 14,
            color: 'var(--color-text-primary)',
            marginTop: 4,
            fontWeight: 500,
          }}
        >
          {item.titulo}
        </div>
        {(item.autor || item.ano) && (
          <div
            style={{
              fontFamily: BODY,
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              fontStyle: 'italic',
              marginTop: 2,
            }}
          >
            {[item.autor, item.ano].filter(Boolean).join(' · ')}
          </div>
        )}
      </Link>

      <button
        type="button"
        onClick={handleDelete}
        disabled={deleteItem.isPending}
        className="hq-icon-btn-bare"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          minWidth: 22,
          minHeight: 22,
          padding: 3,
          color: 'var(--color-error)',
          background: 'transparent',
          zIndex: 1,
        }}
        title="Deletar item"
        aria-label={`Deletar ${item.titulo}`}
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function formatDateBR(iso: string): string {
  const parts = iso.split('-')
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : iso
}

/**
 * Card de saga inline na lista principal — visualmente equivalente a um
 * ItemRow, mas que CONTÉM outros items. Header colapsável (chevron toggle),
 * quando expandido mostra os items numerados 01/02/03 com drag-and-drop
 * HTML5 nativo pra reordenar.
 *
 * Filosofia: saga é "item-pasta" — vive no mesmo flow que items órfãos.
 * Vincular item a saga = item some da lista flat e entra aqui dentro.
 */
function SagaCard({
  saga,
  items,
}: {
  saga: LibrarySaga
  items: LibraryItemListEntry[]
}) {
  const reorder = useReorderSagaItems()
  const deleteSaga = useDeleteLibrarySaga()
  const updateSaga = useUpdateLibrarySaga()
  const [expanded, setExpanded] = useState(true)
  const [editingField, setEditingField] = useState<'nome' | 'descricao' | null>(null)
  const [draftNome, setDraftNome] = useState(saga.nome)
  const [draftDesc, setDraftDesc] = useState(saga.descricao ?? '')
  useEffect(() => setDraftNome(saga.nome), [saga.nome])
  useEffect(() => setDraftDesc(saga.descricao ?? ''), [saga.descricao])
  const [dragId, setDragId] = useState<number | null>(null)
  const [hoverId, setHoverId] = useState<number | null>(null)
  // Lista local — espelha items mas permite reordenação otimista durante
  // o drag. Sincroniza quando items prop muda (servidor confirma reorder).
  const [localItems, setLocalItems] = useState(items)
  useEffect(() => setLocalItems(items), [items])

  const cor = saga.cor ?? LIBRARY_COR
  const empty = items.length === 0

  function saveNome() {
    const v = draftNome.trim()
    if (!v) {
      setDraftNome(saga.nome)  // não permite vazio — reverte
      setEditingField(null)
      return
    }
    if (v !== saga.nome) {
      updateSaga.mutate({ id: saga.id, patch: { nome: v } })
    }
    setEditingField(null)
  }

  function saveDesc() {
    const v = draftDesc.trim()
    const newVal = v || null
    if (newVal !== saga.descricao) {
      updateSaga.mutate({ id: saga.id, patch: { descricao: newVal } })
    }
    setEditingField(null)
  }

  async function handleDeleteSaga(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    const ok = await confirmDialog({
      title: `Deletar saga "${saga.nome}"`,
      message:
        'Os items vinculados NÃO são apagados — apenas desvinculados ' +
        '(voltam pra lista flat). Tese, notas, status e tudo mais é preservado.',
      confirmLabel: 'DELETAR SAGA',
      danger: true,
    })
    if (ok) deleteSaga.mutate(saga.id)
  }

  function onDragStart(itemId: number) {
    setDragId(itemId)
  }

  function onDragOver(e: React.DragEvent, overId: number) {
    if (dragId === null || dragId === overId) return
    e.preventDefault()
    setHoverId(overId)
  }

  function onDrop(e: React.DragEvent, dropId: number) {
    e.preventDefault()
    if (dragId === null || dragId === dropId) {
      setDragId(null)
      setHoverId(null)
      return
    }
    const ids = localItems.map((i) => i.id)
    const fromIdx = ids.indexOf(dragId)
    const toIdx = ids.indexOf(dropId)
    if (fromIdx === -1 || toIdx === -1) {
      setDragId(null)
      setHoverId(null)
      return
    }
    const next = [...localItems]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    setLocalItems(next)
    setDragId(null)
    setHoverId(null)
    reorder.mutate({ sagaId: saga.id, itemIds: next.map((i) => i.id) })
  }

  return (
    <div
      className="hq-glass hq-row-hoverable hq-chamfer-bl"
      style={{
        position: 'relative',
        borderLeft: `2px solid ${cor}`,
      }}
    >
      {/* Header — visualmente alinhado com ItemRow.
          Layout: toggle de expand é botão dedicado (chevron + badges); título
          e descrição são clicáveis pra editar inline. Click no espaço vazio
          entre eles também toggle pra UX rápida. */}
      <div
        style={{
          padding: 'var(--space-3) var(--space-4)',
          paddingRight: 'calc(var(--space-4) + 28px)',
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            flexWrap: 'wrap',
            width: 'fit-content',
          }}
          title={expanded ? 'Colapsar' : 'Expandir'}
        >
          {expanded ? (
            <ChevronDown size={12} color={cor} />
          ) : (
            <ChevronRight size={12} color={cor} />
          )}
          <Layers size={12} strokeWidth={1.8} color={cor} />
          <span
            className="hq-tech-id"
            style={{
              color: cor,
              border: `1px solid ${cor}`,
              padding: '1px 6px',
              letterSpacing: '0.18em',
            }}
          >
            SAGA
          </span>
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {items.length} {items.length === 1 ? 'ITEM' : 'ITEMS'}
          </span>
        </button>

        {/* Nome editável inline */}
        {editingField === 'nome' ? (
          <input
            type="text"
            value={draftNome}
            onChange={(e) => setDraftNome(e.target.value)}
            onBlur={saveNome}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveNome()
              if (e.key === 'Escape') {
                setDraftNome(saga.nome)
                setEditingField(null)
              }
            }}
            autoFocus
            style={{
              background: 'var(--color-bg-primary)',
              border: `1px solid ${cor}`,
              color: 'var(--color-text-primary)',
              padding: '3px 8px',
              fontFamily: BODY,
              fontSize: 14,
              fontWeight: 500,
              marginTop: 4,
              outline: 'none',
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <div
            onClick={() => setEditingField('nome')}
            title="Click pra editar nome"
            style={{
              fontFamily: BODY,
              fontSize: 14,
              color: 'var(--color-text-primary)',
              marginTop: 4,
              fontWeight: 500,
              cursor: 'text',
            }}
          >
            {saga.nome}
          </div>
        )}

        {/* Descrição editável inline. Quando vazia, mostra placeholder
            clicável pra adicionar. */}
        {editingField === 'descricao' ? (
          <textarea
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            onBlur={saveDesc}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraftDesc(saga.descricao ?? '')
                setEditingField(null)
              }
              // Enter sem shift salva e fecha
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                saveDesc()
              }
            }}
            autoFocus
            rows={2}
            placeholder="descrição opcional"
            style={{
              background: 'var(--color-bg-primary)',
              border: `1px solid ${cor}`,
              color: 'var(--color-text-primary)',
              padding: '4px 8px',
              fontFamily: BODY,
              fontSize: 12,
              fontStyle: 'italic',
              marginTop: 4,
              outline: 'none',
              width: '100%',
              boxSizing: 'border-box',
              resize: 'vertical',
              lineHeight: 1.4,
            }}
          />
        ) : saga.descricao ? (
          <div
            onClick={() => setEditingField('descricao')}
            title="Click pra editar descrição"
            style={{
              fontFamily: BODY,
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              fontStyle: 'italic',
              marginTop: 2,
              cursor: 'text',
            }}
          >
            {saga.descricao}
          </div>
        ) : (
          <div
            onClick={() => setEditingField('descricao')}
            title="Adicionar descrição"
            className="hq-tech-id"
            style={{
              color: 'var(--color-text-muted)',
              marginTop: 4,
              cursor: 'text',
              opacity: 0.7,
              fontStyle: 'italic',
            }}
          >
            + adicionar descrição
          </div>
        )}
      </div>

      {/* Trash absoluto top-right (igual ItemRow) */}
      <button
        type="button"
        onClick={handleDeleteSaga}
        className="hq-icon-btn-bare"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          minWidth: 22,
          minHeight: 22,
          padding: 3,
          color: 'var(--color-error)',
          background: 'transparent',
          zIndex: 1,
        }}
        title="Deletar saga (items são preservados)"
        aria-label={`Deletar saga ${saga.nome}`}
      >
        <Trash2 size={12} />
      </button>

      {/* Items expandidos — só renderiza quando aberto */}
      {expanded && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 'var(--space-2) var(--space-4) var(--space-3)',
            borderTop: '1px dashed var(--color-divider)',
          }}
        >
          {empty ? (
            <div
              style={{
                fontFamily: BODY,
                fontSize: 12,
                fontStyle: 'italic',
                color: 'var(--color-text-muted)',
                padding: 'var(--space-2) 0',
              }}
            >
              Saga vazia. Vincule items via "+ NOVO" ou edite items existentes
              pra capturá-los.
            </div>
          ) : (
            localItems.map((it, idx) => (
              <SagaItemRow
                key={it.id}
                item={it}
                ordemDisplay={idx + 1}
                cor={cor}
                isDragging={dragId === it.id}
                isHoverTarget={hoverId === it.id && dragId !== it.id}
                onDragStart={() => onDragStart(it.id)}
                onDragOver={(e) => onDragOver(e, it.id)}
                onDrop={(e) => onDrop(e, it.id)}
                onDragEnd={() => {
                  setDragId(null)
                  setHoverId(null)
                }}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Row de item dentro de uma saga — numeração 01/02/03 em mono à esquerda,
 * drag handle (GripVertical), conteúdo do item, status badge à direita.
 * Click navega pro detail; drag handle inicia reorder.
 */
function SagaItemRow({
  item,
  ordemDisplay,
  cor,
  isDragging,
  isHoverTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  item: LibraryItemListEntry
  ordemDisplay: number
  cor: string
  isDragging: boolean
  isHoverTarget: boolean
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const ordemLabel = String(ordemDisplay).padStart(2, '0')
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{
        display: 'grid',
        gridTemplateColumns: '14px 28px 1fr auto',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: '8px 10px',
        background: isHoverTarget
          ? 'rgba(127, 184, 168, 0.12)'
          : 'var(--color-bg-primary)',
        border: isHoverTarget
          ? `1px dashed ${cor}`
          : '1px solid var(--color-border)',
        opacity: isDragging ? 0.5 : 1,
        cursor: 'grab',
        position: 'relative',
      }}
    >
      <span
        style={{
          color: 'var(--color-text-muted)',
          display: 'inline-flex',
        }}
        title="Arrastar pra reordenar"
      >
        <GripVertical size={12} />
      </span>
      <span
        className="hq-tech-id"
        style={{
          fontFamily: MONO,
          fontSize: 12,
          color: cor,
          letterSpacing: '0.15em',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {ordemLabel}
      </span>
      <Link
        to={`/library/item/${item.id}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          textDecoration: 'none',
          color: 'inherit',
          overflow: 'hidden',
        }}
        // Bloqueia drag quando o usuário começa a arrastar do título —
        // só o grip handle inicia drag de fato (UX cleaner).
        draggable={false}
        onDragStart={(e) => e.stopPropagation()}
      >
        <span
          style={{
            fontFamily: BODY,
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.titulo}
        </span>
        {item.autor && (
          <span
            style={{
              fontFamily: BODY,
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              fontStyle: 'italic',
            }}
          >
            {item.autor}
            {item.ano ? ` · ${item.ano}` : ''}
          </span>
        )}
      </Link>
      <span
        className="hq-tech-id"
        style={{
          color: STATUS_COR[item.status],
          border: `1px solid ${STATUS_COR[item.status]}`,
          padding: '1px 6px',
          letterSpacing: '0.12em',
          fontSize: 9,
        }}
      >
        {STATUS_LABEL[item.status].toLowerCase()}
      </span>
    </div>
  )
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/**
 * Exporta toda a biblioteca em markdown — agrupada por status, com destilação
 * completa (tese central + o que ficou) quando disponível. Útil pra backup,
 * revisão anual, exportação pra Obsidian/Notion.
 *
 * Buca detail de cada item via Promise.all (LibraryItemListEntry não inclui
 * tese/o_que_ficou pra manter listas leves). Em bibliotecas grandes (>200),
 * pode demorar — UX simples no v0: feedback via download direto, sem barra
 * de progresso.
 */
async function exportLibraryMarkdown(items: LibraryItemListEntry[]) {
  if (items.length === 0) {
    alert('Nada pra exportar — biblioteca vazia.')
    return
  }
  const { fetchLibraryItem } = await import('../../api')
  let full: Array<Awaited<ReturnType<typeof fetchLibraryItem>>>
  try {
    full = await Promise.all(items.map((it) => fetchLibraryItem(it.id)))
  } catch (err) {
    alert(`Falha ao exportar: ${(err as Error).message}`)
    return
  }

  const lines: string[] = ['# Library — destilação de input curado', '']
  const totalMin = full.reduce((acc, it) => acc + (it.minutos_total ?? 0), 0)
  lines.push(
    `_${full.length} items · ${formatMinutes(totalMin)} de leitura cronometrada · exportado em ${new Date().toISOString().slice(0, 10)}_`,
    '',
    '---',
    '',
  )

  // Agrupa por status na ordem natural do ciclo
  const byStatus: Record<LibraryItemStatus, typeof full> = {
    doing: [],
    done: [],
    queue: [],
    abandoned: [],
  }
  for (const it of full) {
    byStatus[it.status].push(it)
  }

  const STATUS_HEADER: Record<LibraryItemStatus, string> = {
    doing: 'Em andamento',
    done: 'Fechados',
    queue: 'Fila',
    abandoned: 'Abandonados',
  }

  for (const status of ['doing', 'done', 'queue', 'abandoned'] as LibraryItemStatus[]) {
    const sub = byStatus[status]
    if (sub.length === 0) continue
    lines.push(`## ${STATUS_HEADER[status]} · ${sub.length}`, '')
    for (const it of sub) {
      const tipo = it.tipo.toUpperCase()
      const autor = it.autor ? ` — ${it.autor}` : ''
      const ano = it.ano ? ` (${it.ano})` : ''
      lines.push(`### ${tipo} · ${it.titulo}${autor}${ano}`, '')
      const metaParts: string[] = []
      if (it.data_inicio) metaParts.push(`início ${formatDateBR(it.data_inicio)}`)
      if (it.data_fim) metaParts.push(`fim ${formatDateBR(it.data_fim)}`)
      if (it.minutos_total) metaParts.push(formatMinutes(it.minutos_total))
      if (it.origem) metaParts.push(`origem: ${it.origem}`)
      if (it.tags.length > 0) {
        metaParts.push(`tags: ${it.tags.map((t) => t.nome).join(' · ')}`)
      }
      if (it.revisitar_em) metaParts.push(`revisitar em ${formatDateBR(it.revisitar_em)}`)
      if (metaParts.length > 0) {
        lines.push(`*${metaParts.join(' · ')}*`, '')
      }
      if (it.tese_central) {
        lines.push(`**Tese central:** ${it.tese_central}`, '')
      }
      if (it.o_que_ficou) {
        lines.push(`**O que ficou:** ${it.o_que_ficou}`, '')
      }
      if (it.abandoned_reason) {
        lines.push(`**Motivo do abandono:** ${it.abandoned_reason}`, '')
      }
      if (it.links.length > 0) {
        lines.push(
          `*Conexões:* ${it.links
            .map((l) => `${l.target_type}#${l.target_id}${l.nota ? ` — ${l.nota}` : ''}`)
            .join(' · ')}`,
          '',
        )
      }
      lines.push('---', '')
    }
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `library-${new Date().toISOString().slice(0, 10)}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
