/**
 * Hub Finance — sub-página Categorias.
 *
 * CRUD de categorias agrupadas por tipo (Despesas, Receitas, Estornos,
 * Transferências). Cada categoria tem cor + nome + opcional subcategorias
 * (via `categoria_pai_id`). Ações por linha: + subcategoria · editar · deletar.
 *
 * Refator Sprint 1 (ui-ux-pro-max): tokens CSS + IconButton + EmptyState.
 */
import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2, X, Tag } from 'lucide-react'
import {
  createFinCategory, updateFinCategory, deleteFinCategory, reportApiError,
} from '../../api'
import type { FinCategory, FinCategoryType } from '../../types'
import { useHubFinance } from './HubFinanceContext'
import {
  sectionLabel, fieldLabel, inputStyle, primaryButton, ghostButton,
  modalOverlay, ICON_SIZE, ICON_STROKE, ICON_STROKE_HEAVY,
} from './components/styleHelpers'
import { Card, EmptyState, IconButton } from '../../components/ui/Primitives'

const TIPO_TABS: { tipo: FinCategoryType; label: string }[] = [
  { tipo: 'despesa',       label: 'Despesas' },
  { tipo: 'receita',       label: 'Receitas' },
  { tipo: 'estorno',       label: 'Estornos' },
  { tipo: 'transferencia', label: 'Transferências' },
]

// Paleta curada — cobre todos os matizes principais sem virar arco-íris caótico.
const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#ec4899', '#f43f5e', '#94a3b8',
]

const DEFAULT_COLOR = '#94a3b8'

export function CategoriasPage() {
  const { categories, refreshGlobal } = useHubFinance()
  const [activeTipo, setActiveTipo] = useState<FinCategoryType>('despesa')
  const [editing, setEditing] = useState<FinCategory | null>(null)
  const [creatingFor, setCreatingFor] = useState<{ tipo: FinCategoryType; pai?: FinCategory } | null>(null)
  const [inlineSubFor, setInlineSubFor] = useState<string | null>(null)

  // Agrupa: pais (categoria_pai_id == null) e mapa pai_id → filhos
  const grouped = useMemo(() => {
    const ofTipo = categories.filter(c => c.tipo === activeTipo)
    const parents = ofTipo.filter(c => !c.categoria_pai_id)
    const childrenByParent = new Map<string, FinCategory[]>()
    for (const c of ofTipo) {
      if (c.categoria_pai_id) {
        const arr = childrenByParent.get(c.categoria_pai_id) ?? []
        arr.push(c)
        childrenByParent.set(c.categoria_pai_id, arr)
      }
    }
    return { parents, childrenByParent }
  }, [categories, activeTipo])

  async function handleDelete(c: FinCategory) {
    const isParent = !c.categoria_pai_id
    const childCount = grouped.childrenByParent.get(c.id)?.length ?? 0
    let msg = `Deletar categoria "${c.nome}"?`
    if (isParent && childCount > 0) {
      msg += `\n\nEla tem ${childCount} sub-categoria(s) que também serão deletadas.`
    }
    msg += `\n\nTransações já vinculadas perderão a categoria (não serão apagadas).`
    if (!window.confirm(msg)) return
    try {
      if (isParent) {
        const children = grouped.childrenByParent.get(c.id) ?? []
        for (const ch of children) await deleteFinCategory(ch.id)
      }
      await deleteFinCategory(c.id)
      refreshGlobal()
    } catch (err) {
      reportApiError('CategoriasPage.delete', err)
      alert('Erro ao deletar — veja o console.')
    }
  }

  const tipoLabel = TIPO_TABS.find(t => t.tipo === activeTipo)?.label.toLowerCase() ?? ''

  return (
    <Card padding="none" style={{
      animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
    }}>
      {/* Hairline ice elétrica — assinatura HUD CP2077 */}
      <div className="hq-hairline-ice" />
      {/* Header com atmosphere ice/fog + tabs juntos pra dar peso visual */}
      <div style={{
        padding: 'var(--space-5) var(--space-6) 0',
        background: `
          radial-gradient(ellipse 100% 80% at 0% 0%, rgba(143, 191, 211, 0.05), transparent 60%),
          radial-gradient(ellipse 60% 80% at 100% 0%, rgba(50, 62, 73, 0.20), transparent 65%),
          linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
        `,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}>
          <Tag
            size={ICON_SIZE.md}
            strokeWidth={ICON_STROKE}
            style={{ color: 'var(--color-text-tertiary)' }}
          />
          <div style={sectionLabel()}>Categorias</div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setCreatingFor({ tipo: activeTipo })}
            style={primaryButton()}
          >
            <Plus size={ICON_SIZE.xs} strokeWidth={ICON_STROKE_HEAVY} />
            nova categoria de {tipoLabel.replace(/s$/, '')}
          </button>
        </div>

        {/* Tabs por tipo */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-1)',
          borderBottom: '1px solid var(--color-divider)',
        }}>
        {TIPO_TABS.map(t => {
          const count = categories.filter(c => c.tipo === t.tipo).length
          const isActive = t.tipo === activeTipo
          return (
            <button
              key={t.tipo}
              type="button"
              onClick={() => setActiveTipo(t.tipo)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 'var(--space-3) var(--space-4)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                borderBottom: isActive
                  ? '2px solid var(--color-accent-light)'
                  : '2px solid transparent',
                marginBottom: -1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                transition: 'color var(--motion-fast) var(--motion-easing), border-color var(--motion-fast) var(--motion-easing)',
              }}
            >
              {t.label}
              <span style={{
                fontSize: 'var(--text-xs)',
                fontWeight: 500,
                color: 'var(--color-text-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {count}
              </span>
            </button>
          )
        })}
        </div>
      </div>

      {/* Lista */}
      <div style={{ padding: 'var(--space-4) var(--space-6) var(--space-5)' }}>
      {grouped.parents.length === 0 ? (
        <EmptyState
          text={`Nenhuma categoria de ${tipoLabel} ainda`}
          sub="Crie a primeira pelo botão no topo direito."
        />
      ) : (
        <div className="hq-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {grouped.parents.map((p, i) => {
            const children = grouped.childrenByParent.get(p.id) ?? []
            return (
              <div
                key={p.id}
                className="hq-animate-fade-up"
                style={{ ['--stagger-i' as any]: i }}
              >
                <CategoryRow
                  category={p}
                  isParent
                  onEdit={() => setEditing(p)}
                  onDelete={() => handleDelete(p)}
                  onAddSub={() => setInlineSubFor(inlineSubFor === p.id ? null : p.id)}
                />
                {inlineSubFor === p.id && (
                  <InlineSubcategoryForm
                    parent={p}
                    onCancel={() => setInlineSubFor(null)}
                    onSaved={() => { setInlineSubFor(null); refreshGlobal() }}
                  />
                )}
                {children.map(ch => (
                  <CategoryRow
                    key={ch.id}
                    category={ch}
                    isParent={false}
                    onEdit={() => setEditing(ch)}
                    onDelete={() => handleDelete(ch)}
                  />
                ))}
              </div>
            )
          })}
        </div>
      )}
      </div>

      {/* Modais */}
      {creatingFor && (
        <CategoryFormModal
          mode="create"
          tipoFixed={creatingFor.tipo}
          paiFixed={creatingFor.pai ?? null}
          parentOptions={categories.filter(c => c.tipo === creatingFor.tipo && !c.categoria_pai_id)}
          onClose={() => setCreatingFor(null)}
          onSaved={() => { setCreatingFor(null); refreshGlobal() }}
        />
      )}
      {editing && (
        <CategoryFormModal
          mode="edit"
          existing={editing}
          parentOptions={categories.filter(
            c => c.tipo === editing.tipo && !c.categoria_pai_id && c.id !== editing.id,
          )}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refreshGlobal() }}
        />
      )}
    </Card>
  )
}

// ─── Linha de categoria (pai ou filha) ───────────────────────────────────

function CategoryRow({ category, isParent, onEdit, onDelete, onAddSub }: {
  category: FinCategory
  isParent: boolean
  onEdit: () => void
  onDelete: () => void
  onAddSub?: () => void
}) {
  const color = category.cor || DEFAULT_COLOR
  return (
    <div
      className="hq-row-hoverable"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        paddingLeft: isParent ? 'var(--space-3)' : 'var(--space-8)',
        borderRadius: 'var(--radius-sm)',
        borderLeft: isParent ? `3px solid ${color}` : '3px solid transparent',
      }}
    >
      {!isParent && (
        <div style={{
          width: 12, height: 1, background: 'var(--color-border)', flexShrink: 0,
        }} />
      )}
      <div
        aria-hidden="true"
        style={{
          width: 18, height: 18, borderRadius: '50%',
          background: color, flexShrink: 0,
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      />
      <div style={{
        fontSize: isParent ? 'var(--text-base)' : 'var(--text-sm)',
        fontWeight: isParent ? 600 : 500,
        color: 'var(--color-text-primary)',
      }}>
        {category.nome}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
        {isParent && onAddSub && (
          <IconButton label="adicionar subcategoria" onClick={onAddSub}>
            <Plus size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
          </IconButton>
        )}
        <IconButton label={`editar ${category.nome}`} onClick={onEdit}>
          <Pencil size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
        </IconButton>
        <IconButton
          label={`deletar ${category.nome}`}
          onClick={onDelete}
          variant="danger"
        >
          <Trash2 size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
    </div>
  )
}

// ─── Form inline pra subcategoria ────────────────────────────────────────

function InlineSubcategoryForm({ parent, onCancel, onSaved }: {
  parent: FinCategory
  onCancel: () => void
  onSaved: () => void
}) {
  const [nome, setNome] = useState('')
  const [cor, setCor] = useState(parent.cor || DEFAULT_COLOR)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return
    setBusy(true)
    try {
      await createFinCategory({
        nome: nome.trim(),
        tipo: parent.tipo,
        cor,
        categoria_pai_id: parent.id,
      })
      onSaved()
    } catch (err) {
      reportApiError('InlineSubcategoryForm.submit', err)
      alert('Erro ao salvar — veja o console.')
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3) var(--space-2) var(--space-8)',
        background: 'var(--color-bg-secondary)',
        borderRadius: 'var(--radius-sm)',
        marginTop: 2,
        marginBottom: 2,
      }}
    >
      <button
        type="button"
        onClick={() => {
          const idx = PALETTE.indexOf(cor)
          setCor(PALETTE[(idx + 1) % PALETTE.length])
        }}
        title="Trocar cor"
        aria-label="Trocar cor da subcategoria"
        style={{
          width: 18, height: 18, borderRadius: '50%',
          background: cor, flexShrink: 0,
          border: '1px solid rgba(255, 255, 255, 0.15)',
          cursor: 'pointer', padding: 0,
        }}
      />
      <input
        autoFocus
        type="text"
        placeholder="nome da subcategoria"
        value={nome}
        onChange={e => setNome(e.target.value)}
        style={{ ...inputStyle(), flex: 1 }}
      />
      <button type="submit" disabled={busy} style={primaryButton()}>
        {busy ? '…' : 'adicionar'}
      </button>
      <button type="button" onClick={onCancel} style={ghostButton()}>
        cancelar
      </button>
    </form>
  )
}

// ─── Modal de criação/edição ─────────────────────────────────────────────

type FormMode =
  | { mode: 'create'; tipoFixed: FinCategoryType; paiFixed: FinCategory | null }
  | { mode: 'edit';   existing: FinCategory }

function CategoryFormModal(props: FormMode & {
  parentOptions: FinCategory[]
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = props.mode === 'edit'
  const initialTipo = isEdit ? props.existing.tipo : props.tipoFixed
  const initialPaiId = isEdit
    ? props.existing.categoria_pai_id
    : (props.paiFixed?.id ?? null)
  const initialNome = isEdit ? props.existing.nome : ''
  const initialCor = isEdit ? (props.existing.cor || DEFAULT_COLOR) : DEFAULT_COLOR

  const [isSub, setIsSub] = useState<boolean>(initialPaiId !== null)
  const [paiId, setPaiId] = useState<string | null>(initialPaiId)
  const [nome, setNome] = useState(initialNome)
  const [cor, setCor] = useState(initialCor)
  const [busy, setBusy] = useState(false)

  const tipo = initialTipo
  const tipoLabel = TIPO_TABS.find(t => t.tipo === tipo)?.label.toLowerCase().replace(/s$/, '') ?? tipo

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) { alert('Nome é obrigatório.'); return }
    if (isSub && !paiId) { alert('Escolha a categoria pai.'); return }
    setBusy(true)
    try {
      if (isEdit) {
        await updateFinCategory(props.existing.id, {
          nome: nome.trim(),
          cor,
          categoria_pai_id: isSub ? paiId : null,
        })
      } else {
        await createFinCategory({
          nome: nome.trim(),
          tipo,
          cor,
          categoria_pai_id: isSub ? paiId : null,
        })
      }
      props.onSaved()
    } catch (err) {
      reportApiError('CategoryFormModal.submit', err)
      alert('Erro ao salvar — veja o console.')
      setBusy(false)
    }
  }

  return (
    <div onClick={props.onClose} style={modalOverlay()}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--color-bg-primary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-6)',
        minWidth: 440, maxWidth: 520,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}>
          <div style={sectionLabel()}>
            {isEdit
              ? `Editar categoria de ${tipoLabel}`
              : `Nova categoria de ${tipoLabel}`}
          </div>
          <div style={{ flex: 1 }} />
          <IconButton label="fechar" onClick={props.onClose} variant="bare">
            <X size={ICON_SIZE.md} strokeWidth={ICON_STROKE_HEAVY} />
          </IconButton>
        </div>

        <form onSubmit={submit} style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}>
          {props.parentOptions.length > 0 && (
            <div style={{
              display: 'flex',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
            }}>
              <ToggleSeg
                active={!isSub}
                onClick={() => { setIsSub(false); setPaiId(null) }}
                label="Categoria principal"
              />
              <ToggleSeg
                active={isSub}
                onClick={() => {
                  setIsSub(true)
                  if (!paiId) setPaiId(props.parentOptions[0].id)
                }}
                label="Subcategoria"
              />
            </div>
          )}

          {isSub && (
            <div>
              <label style={fieldLabel()}>Categoria pai</label>
              <select
                value={paiId ?? ''}
                onChange={e => setPaiId(e.target.value || null)}
                style={{ ...inputStyle(), width: '100%' }}
              >
                {props.parentOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label style={fieldLabel()}>Nome</label>
            <input
              autoFocus
              type="text"
              placeholder={isSub ? 'ex: Padaria, Uber' : 'ex: Alimentação, Transporte'}
              value={nome}
              onChange={e => setNome(e.target.value)}
              style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <label style={fieldLabel()}>Cor</label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(8, 1fr)',
              gap: 'var(--space-2)',
            }}>
              {PALETTE.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCor(c)}
                  title={c}
                  aria-label={`Cor ${c}${cor === c ? ' (selecionada)' : ''}`}
                  aria-pressed={cor === c}
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: c,
                    border: cor === c
                      ? '2px solid var(--color-text-primary)'
                      : '1px solid rgba(255, 255, 255, 0.1)',
                    cursor: 'pointer', padding: 0,
                    transition: 'transform var(--motion-fast) var(--motion-easing)',
                    transform: cor === c ? 'scale(1.1)' : 'scale(1)',
                  }}
                />
              ))}
            </div>
          </div>


          <div style={{
            display: 'flex',
            gap: 'var(--space-2)',
            justifyContent: 'flex-end',
            marginTop: 'var(--space-2)',
          }}>
            <button type="button" onClick={props.onClose} style={ghostButton()}>
              cancelar
            </button>
            <button type="submit" disabled={busy} style={primaryButton()}>
              {busy ? 'salvando…' : (isEdit ? 'salvar' : 'criar categoria')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ToggleSeg({ active, onClick, label }: {
  active: boolean; onClick: () => void; label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: 1,
        background: active ? 'var(--color-bg-secondary)' : 'transparent',
        border: 'none',
        borderRight: '1px solid var(--color-border)',
        cursor: 'pointer',
        padding: 'var(--space-3) var(--space-4)',
        fontSize: 'var(--text-sm)',
        fontWeight: 600,
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
        transition: 'background var(--motion-fast) var(--motion-easing), color var(--motion-fast) var(--motion-easing)',
      }}
    >
      {label}
    </button>
  )
}
