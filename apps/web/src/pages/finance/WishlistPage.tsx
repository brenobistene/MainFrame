/**
 * Wishlist — página dedicada à lista de desejos com cronograma opcional
 * de reserva mensal. Submódulo do Hub Finance.
 *
 * Fase 1 (esta): CRUD básico (items + categorias + links), 4 tabs por
 * status (desejado · poupando · comprado · desistido), drag-and-drop de
 * prioridade dentro de categoria, modal de comprar (sem busca de transação
 * ainda — vínculo opcional via input manual).
 *
 * Fase 2 (próxima): cronograma de reserva + sobra real.
 *
 * Doc completo: docs/hub-finance/wishlist-PLAN.md.
 */
import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, MoreHorizontal, ExternalLink, AlertTriangle, Settings } from 'lucide-react'

import { Card } from '../../components/ui/Primitives'
import { StaggerList, StaggerItem, SkeletonStatCard, SkeletonRow } from '../../components/ui/Motion'
import {
  useWishlistCategorias,
  useWishlistItems,
  useWishlistSummary,
  useWishlistSettings,
  useReorderWishlistItems,
  useDeleteWishlistItem,
  useDesistirWishlistItem,
  useReabrirWishlistItem,
} from '../../lib/wishlist-queries'
import type { WishlistItem, WishlistStatus, WishlistCategoria, WishlistSummary } from '../../types'
import { formatBRL } from './components/styleHelpers'
import { WishlistItemModal } from './components/WishlistItemModal'
import { WishlistComprarModal } from './components/WishlistComprarModal'
import { WishlistSettingsModal } from './components/WishlistSettingsModal'

// ─── Tabs por status ──────────────────────────────────────────────────────

const STATUS_TABS: { value: WishlistStatus; label: string }[] = [
  { value: 'desejado',  label: 'DESEJADO' },
  { value: 'poupando',  label: 'POUPANDO' },
  { value: 'comprado',  label: 'COMPRADO' },
  { value: 'desistido', label: 'DESISTIDO' },
]

const STATUS_COLOR: Record<WishlistStatus, string> = {
  desejado:  'var(--color-text-secondary)',
  poupando:  'var(--color-warning)',
  comprado:  'var(--color-success)',
  desistido: 'var(--color-text-muted)',
}

export function WishlistPage() {
  const [activeStatus, setActiveStatus] = useState<WishlistStatus>('desejado')
  const [editingItem, setEditingItem] = useState<WishlistItem | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [comprandoItem, setComprandoItem] = useState<WishlistItem | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()

  // Atalho via querystring `?new=1` (CommandPalette / link externo).
  // Limpa o param depois pra não re-disparar em re-renders.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setCreatingNew(true)
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const { data: items = [], isLoading: itemsLoading } = useWishlistItems({
    status: activeStatus,
    includeDone: activeStatus === 'comprado' || activeStatus === 'desistido',
  })
  const { data: categorias = [] } = useWishlistCategorias()
  const { data: summary } = useWishlistSummary()
  const { data: settings } = useWishlistSettings()
  const reorderMut = useReorderWishlistItems()
  const deleteMut = useDeleteWishlistItem()
  const desistirMut = useDesistirWishlistItem()
  const reabrirMut = useReabrirWishlistItem()

  const envelhecimentoMeses = settings?.envelhecimento_threshold_meses ?? 6

  // Conta por status (todos) — chamadas separadas dariam 4 requests; aproveito
  // summary que já contém os ativos e faço fetches específicos curtos. Pra v0
  // simplifico: só mostra contagem do tab atual.
  const counts: Partial<Record<WishlistStatus, number>> = useMemo(() => {
    const m: Partial<Record<WishlistStatus, number>> = {}
    m[activeStatus] = items.length
    return m
  }, [items, activeStatus])

  // Agrupa items por categoria, mantendo ordenação por `prioridade`
  const grouped = useMemo(() => {
    const groups = new Map<string | null, WishlistItem[]>()
    for (const it of items) {
      const key = it.categoria_id
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(it)
    }
    return groups
  }, [items])

  function handleReorder(itemId: string, direction: 'up' | 'down', within: WishlistItem[]) {
    const idx = within.findIndex(i => i.id === itemId)
    if (idx === -1) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= within.length) return
    const reordered = [...within]
    const [moved] = reordered.splice(idx, 1)
    reordered.splice(targetIdx, 0, moved)
    reorderMut.mutate(
      reordered.map((it, i) => ({ id: it.id, prioridade: i })),
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Card padding="none">
        <div className="hq-hairline-ice" />

        {/* Header com tab marker + tab nav + ações */}
        <div
          style={{
            padding: 'var(--space-5) var(--space-6) var(--space-4)',
            background: `
              radial-gradient(ellipse 100% 80% at 0% 0%, rgba(143, 191, 211, 0.05), transparent 60%),
              radial-gradient(ellipse 60% 80% at 100% 0%, rgba(50, 62, 73, 0.20), transparent 65%),
              linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
            `,
            borderBottom: '1px solid var(--color-ice-deep)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <span
              style={{
                width: 3, height: 14,
                background: 'var(--color-warning)',
                boxShadow: '0 0 8px rgba(192, 138, 58, 0.55)',
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                fontWeight: 700,
              }}
            >
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              WISHLIST.STACK
              {summary && (
                <span style={{ marginLeft: 10, color: 'var(--color-text-secondary)' }}>
                  {summary.total_items_ativos.toString().padStart(2, '0')} ATIVOS · {formatBRL(summary.total_valor_estimado)}
                </span>
              )}
            </span>
            <div style={{ flex: 1 }} />
            <CyberButton onClick={() => setShowSettings(true)} variant="ghost">
              <Settings size={11} strokeWidth={2} />
              CONFIG
            </CyberButton>
            <CyberButton onClick={() => setCreatingNew(true)} variant="ice">
              <Plus size={11} strokeWidth={2} />
              NOVO ITEM
            </CyberButton>
          </div>

          {/* Peso real — barra com próxima compra estimada + média + meses
              estimados pra zerar. Só aparece quando há items ativos. */}
          {summary && summary.total_items_ativos > 0 && (
            <PesoRealBar summary={summary} />
          )}

          {/* Tabs por status */}
          <div style={{ display: 'flex', gap: 4 }}>
            {STATUS_TABS.map(t => {
              const isActive = activeStatus === t.value
              return (
                <button
                  key={t.value}
                  onClick={() => setActiveStatus(t.value)}
                  style={{
                    padding: '6px 14px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700,
                    letterSpacing: '0.22em', textTransform: 'uppercase',
                    color: isActive ? STATUS_COLOR[t.value] : 'var(--color-text-tertiary)',
                    background: isActive
                      ? 'rgba(8, 12, 18, 0.85)'
                      : 'rgba(8, 12, 18, 0.45)',
                    border: `1px solid ${isActive ? STATUS_COLOR[t.value] : 'var(--color-border)'}`,
                    borderBottom: isActive ? 'none' : '1px solid var(--color-border)',
                    cursor: 'pointer',
                    borderRadius: 0,
                    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                    transition: 'all 0.15s',
                  }}
                >
                  {t.label}
                  {counts[t.value] !== undefined && (
                    <span style={{ marginLeft: 6, color: 'var(--color-text-muted)' }}>
                      {counts[t.value]}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Conteúdo: lista agrupada por categoria */}
        <div style={{ padding: 'var(--space-5) var(--space-6)' }}>
          {itemsLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <SkeletonStatCard labelWidth={120} numberWidth={180} />
              {Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : items.length === 0 ? (
            <EmptyState status={activeStatus} onNew={() => setCreatingNew(true)} />
          ) : (
            <StaggerList style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {Array.from(grouped.entries()).map(([catId, catItems]) => {
                const cat = catId ? categorias.find(c => c.id === catId) : null
                return (
                  <StaggerItem key={catId ?? '__no_cat__'}>
                    <CategorySection
                      categoria={cat}
                      items={catItems}
                      onEdit={item => setEditingItem(item)}
                      onComprar={item => setComprandoItem(item)}
                      onDelete={id => {
                        if (confirm('Deletar este item permanentemente?')) {
                          deleteMut.mutate(id)
                        }
                      }}
                      onDesistir={id => {
                        const motivo = prompt('Motivo (opcional):') ?? undefined
                        desistirMut.mutate({ id, body: { motivo } })
                      }}
                      onReabrir={id => reabrirMut.mutate({ id, body: {} })}
                      onMoveUp={(id) => handleReorder(id, 'up', catItems)}
                      onMoveDown={(id) => handleReorder(id, 'down', catItems)}
                      openMenuId={openMenuId}
                      onToggleMenu={(id) => setOpenMenuId(prev => prev === id ? null : id)}
                      status={activeStatus}
                      envelhecimentoMeses={envelhecimentoMeses}
                    />
                  </StaggerItem>
                )
              })}
            </StaggerList>
          )}
        </div>
      </Card>

      {(creatingNew || editingItem) && (
        <WishlistItemModal
          item={editingItem}
          categorias={categorias}
          onClose={() => { setEditingItem(null); setCreatingNew(false) }}
        />
      )}

      {comprandoItem && (
        <WishlistComprarModal
          item={comprandoItem}
          onClose={() => setComprandoItem(null)}
        />
      )}

      {showSettings && (
        <WishlistSettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────

function CategorySection({
  categoria, items, onEdit, onComprar, onDelete, onDesistir, onReabrir,
  onMoveUp, onMoveDown, openMenuId, onToggleMenu, status, envelhecimentoMeses,
}: {
  categoria: WishlistCategoria | null | undefined
  items: WishlistItem[]
  onEdit: (item: WishlistItem) => void
  onComprar: (item: WishlistItem) => void
  onDelete: (id: string) => void
  onDesistir: (id: string) => void
  onReabrir: (id: string) => void
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
  openMenuId: string | null
  onToggleMenu: (id: string) => void
  status: WishlistStatus
  envelhecimentoMeses: number
}) {
  const cor = categoria?.cor || 'var(--color-text-muted)'
  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 8, paddingBottom: 6,
          borderBottom: '1px solid var(--color-divider)',
        }}
      >
        <span
          style={{
            width: 6, height: 6,
            background: cor,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            letterSpacing: '0.22em', textTransform: 'uppercase',
            color: 'var(--color-text-secondary)',
          }}
        >
          {categoria?.nome || 'Sem categoria'}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: 'var(--color-text-muted)',
          }}
        >
          {items.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item, idx) => (
          <WishlistRow
            key={item.id}
            item={item}
            status={status}
            isFirst={idx === 0}
            isLast={idx === items.length - 1}
            menuOpen={openMenuId === item.id}
            onToggleMenu={() => onToggleMenu(item.id)}
            onEdit={() => onEdit(item)}
            onComprar={() => onComprar(item)}
            onDelete={() => onDelete(item.id)}
            onDesistir={() => onDesistir(item.id)}
            onReabrir={() => onReabrir(item.id)}
            onMoveUp={() => onMoveUp(item.id)}
            onMoveDown={() => onMoveDown(item.id)}
            envelhecimentoMeses={envelhecimentoMeses}
          />
        ))}
      </div>
    </div>
  )
}

function WishlistRow({
  item, status, isFirst, isLast, menuOpen, onToggleMenu,
  onEdit, onComprar, onDelete, onDesistir, onReabrir, onMoveUp, onMoveDown,
  envelhecimentoMeses,
}: {
  item: WishlistItem
  status: WishlistStatus
  isFirst: boolean
  isLast: boolean
  menuOpen: boolean
  onToggleMenu: () => void
  onEdit: () => void
  onComprar: () => void
  onDelete: () => void
  onDesistir: () => void
  onReabrir: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  envelhecimentoMeses: number
}) {
  const accent = STATUS_COLOR[item.status]
  const isActive = item.status === 'desejado' || item.status === 'poupando'
  const showProgress = item.status === 'poupando' && item.reservas.length > 0
  const isAging = isActive && item.meses_parado >= envelhecimentoMeses
  const linkCount = item.links.length

  return (
    <div
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto',
        gap: 12,
        alignItems: 'center',
        padding: '10px 14px',
        background: 'rgba(8, 12, 18, 0.45)',
        border: '1px solid var(--color-border)',
        borderLeft: `2px solid ${accent}`,
      }}
    >
      {/* Drag handle / move buttons */}
      {isActive ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            title="Subir prioridade"
            style={{
              background: 'none', border: 'none', cursor: isFirst ? 'default' : 'pointer',
              color: isFirst ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
              padding: 0, height: 14, opacity: isFirst ? 0.3 : 1,
              fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
            }}
          >▲</button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            title="Descer prioridade"
            style={{
              background: 'none', border: 'none', cursor: isLast ? 'default' : 'pointer',
              color: isLast ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
              padding: 0, height: 14, opacity: isLast ? 0.3 : 1,
              fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
            }}
          >▼</button>
        </div>
      ) : (
        <span style={{ width: 12 }} />
      )}

      {/* Nome + metadados */}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <button
          onClick={onEdit}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            textAlign: 'left', color: 'inherit',
            fontFamily: 'var(--font-display)',
            fontSize: 13, fontWeight: 600,
            color: status === 'desistido' ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
            textDecoration: status === 'desistido' ? 'line-through' : 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {item.nome}
        </button>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            fontFamily: 'var(--font-mono)', fontSize: 9,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.12em', textTransform: 'uppercase',
          }}
        >
          {linkCount > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <ExternalLink size={9} strokeWidth={2} /> {linkCount} link{linkCount === 1 ? '' : 's'}
            </span>
          )}
          {item.data_alvo && <span>alvo {item.data_alvo}</span>}
          {showProgress && (
            <>
              <span style={{ color: 'var(--color-success)' }}>
                guardado {formatBRL(item.reservado_acumulado)} / {formatBRL(item.valor_estimado)} · {item.progresso_pct.toFixed(0)}%
              </span>
              {item.reservado_pendente > 0 && (
                <span style={{ color: 'var(--color-warning)' }}>
                  aguardando confirmar {formatBRL(item.reservado_pendente)}
                </span>
              )}
            </>
          )}
          {item.status === 'comprado' && (
            <span style={{ color: item.transacao_id ? 'var(--color-success)' : 'var(--color-warning)' }}>
              {item.transacao_id ? 'vinculado' : 'vínculo pendente'}
            </span>
          )}
          {isAging && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--color-warning)' }}>
              <AlertTriangle size={9} strokeWidth={2} /> parado {item.meses_parado}m
            </span>
          )}
        </div>
        {showProgress && (
          <div
            style={{
              marginTop: 4,
              height: 3,
              background: 'rgba(255,255,255,0.05)',
              position: 'relative',
            }}
          >
            {/* Soft mode: barra só preenche com o CONFIRMADO (transação
                vinculada). Pendente continua visível como texto ("aguardando
                confirmar Rx") mas não ocupa espaço na barra — o número só
                sobe quando você materializa de verdade. */}
            {(() => {
              const total = item.valor_estimado
              const confPct = total > 0 ? Math.min(100, (item.reservado_acumulado / total) * 100) : 0
              return (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: `${confPct}%`,
                    background: 'var(--color-success)',
                    boxShadow: confPct > 0 ? '0 0 8px rgba(94, 122, 82, 0.4)' : 'none',
                  }}
                />
              )
            })()}
          </div>
        )}
      </div>

      {/* Valor */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 13, fontWeight: 700,
          color: item.status === 'comprado' && item.valor_real
            ? 'var(--color-success)'
            : 'var(--color-text-primary)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {formatBRL(item.status === 'comprado' && item.valor_real ? item.valor_real : item.valor_estimado)}
      </div>

      {/* Menu dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={onToggleMenu}
          aria-label="menu do item"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-tertiary)',
            padding: 4, display: 'inline-flex', alignItems: 'center',
          }}
        >
          <MoreHorizontal size={14} strokeWidth={2} />
        </button>
        {menuOpen && (
          <div
            style={{
              position: 'absolute',
              right: 0, top: '100%',
              marginTop: 4,
              background: 'rgba(8, 12, 18, 0.97)',
              border: '1px solid var(--color-ice-deep)',
              padding: 4,
              display: 'flex', flexDirection: 'column',
              minWidth: 160, zIndex: 10,
            }}
          >
            <MenuButton onClick={() => { onEdit(); onToggleMenu() }}>Editar</MenuButton>
            {isActive && (
              <MenuButton onClick={() => { onComprar(); onToggleMenu() }}>
                Marcar comprado…
              </MenuButton>
            )}
            {isActive && (
              <MenuButton onClick={() => { onDesistir(); onToggleMenu() }}>Desistir</MenuButton>
            )}
            {(item.status === 'comprado' || item.status === 'desistido') && (
              <MenuButton onClick={() => { onReabrir(); onToggleMenu() }}>Reabrir</MenuButton>
            )}
            <MenuButton onClick={() => { onDelete(); onToggleMenu() }} danger>Deletar</MenuButton>
          </div>
        )}
      </div>
    </div>
  )
}

function MenuButton({
  children, onClick, danger,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        textAlign: 'left',
        padding: '7px 10px',
        fontFamily: 'var(--font-mono)',
        fontSize: 10, fontWeight: 600,
        letterSpacing: '0.14em', textTransform: 'uppercase',
        color: danger ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(143, 191, 211, 0.08)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

function EmptyState({ status, onNew }: { status: WishlistStatus; onNew: () => void }) {
  const msg = {
    desejado:  'Nenhum item desejado ainda.',
    poupando:  'Nenhum item com plano de reserva ativo.',
    comprado:  'Nenhuma compra registrada por aqui.',
    desistido: 'Nenhum item desistido.',
  }[status]

  return (
    <div
      style={{
        padding: 'var(--space-7) var(--space-6)',
        textAlign: 'center',
        color: 'var(--color-text-muted)',
        fontFamily: 'var(--font-display)',
        fontSize: 13,
      }}
    >
      <div style={{ marginBottom: 14 }}>{msg}</div>
      {(status === 'desejado' || status === 'poupando') && (
        <CyberButton onClick={onNew} variant="ice">
          <Plus size={11} strokeWidth={2} />
          ADICIONAR PRIMEIRO ITEM
        </CyberButton>
      )}
    </div>
  )
}

function CyberButton({
  children, onClick, variant = 'ghost',
}: {
  children: React.ReactNode
  onClick: () => void
  variant?: 'ghost' | 'ice'
}) {
  const styles: React.CSSProperties = variant === 'ice'
    ? {
        background: 'rgba(143, 191, 211, 0.10)',
        border: '1px solid rgba(143, 191, 211, 0.45)',
        color: 'var(--color-ice-light)',
      }
    : {
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-tertiary)',
      }
  return (
    <button
      onClick={onClick}
      style={{
        ...styles,
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 9, fontWeight: 700,
        padding: '6px 12px',
        letterSpacing: '0.22em', textTransform: 'uppercase',
        borderRadius: 0,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
        display: 'inline-flex', alignItems: 'center', gap: 5,
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  )
}

// ─── Peso real (Fase 4) ───────────────────────────────────────────────────

function PesoRealBar({ summary }: { summary: WishlistSummary }) {
  const total = summary.total_valor_estimado
  const confirmado = summary.total_reservado_acumulado
  const pendente = summary.total_reservado_pendente
  const restante = Math.max(0, total - confirmado)
  const confPct = total > 0 ? Math.min(100, (confirmado / total) * 100) : 0

  // Meses estimados pra zerar (caso haja média mensal de reserva > 0)
  let mesesPraZerar: string | null = null
  if (summary.media_mensal_reserva > 0 && restante > 0) {
    const m = restante / summary.media_mensal_reserva
    if (m < 1) mesesPraZerar = '< 1m'
    else if (m < 100) mesesPraZerar = `~${Math.ceil(m)}m`
    else mesesPraZerar = '∞'
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        background: 'rgba(192, 138, 58, 0.04)',
        border: '1px solid rgba(192, 138, 58, 0.22)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--color-text-muted)',
        }}
      >
        <Stat label="guardado" value={formatBRL(confirmado)} highlight />
        {pendente > 0 && (
          <Stat label="aguardando" value={formatBRL(pendente)} color="var(--color-warning)" />
        )}
        <Stat label="restante" value={formatBRL(restante)} />
        {summary.media_mensal_reserva > 0 && (
          <Stat label="média/mês" value={formatBRL(summary.media_mensal_reserva)} />
        )}
        {mesesPraZerar && <Stat label="zerar em" value={mesesPraZerar} />}
        {summary.proxima_compra_nome && (
          <Stat
            label="próxima"
            value={
              <>
                {summary.proxima_compra_nome.length > 18
                  ? summary.proxima_compra_nome.slice(0, 17) + '…'
                  : summary.proxima_compra_nome}
                {summary.proxima_compra_progresso_pct != null && (
                  <span style={{ color: 'var(--color-warning)', marginLeft: 4 }}>
                    {Math.round(summary.proxima_compra_progresso_pct)}%
                  </span>
                )}
              </>
            }
          />
        )}
      </div>
      {/* Barra global — só CONFIRMADO. Pendente fica como Stat textual. */}
      <div
        style={{
          height: 3,
          background: 'rgba(255,255,255,0.05)',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${confPct}%`,
            background: 'var(--color-success)',
            boxShadow: confPct > 0 ? '0 0 8px rgba(94, 122, 82, 0.4)' : 'none',
          }}
        />
      </div>
    </div>
  )
}

function Stat({
  label, value, highlight, color,
}: {
  label: string
  value: React.ReactNode
  highlight?: boolean
  color?: string
}) {
  const valueColor = color
    ?? (highlight ? 'var(--color-success)' : 'var(--color-text-secondary)')
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ color: valueColor, letterSpacing: 0 }}>
        {value}
      </span>
    </span>
  )
}
