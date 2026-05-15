/**
 * Modal de criar/editar item da Wishlist.
 *
 * Fase 1 (esta): nome, valor estimado, categoria, data-alvo, notas, links
 * múltiplos. Sem cronograma de reserva ainda (Fase 2).
 */
import { useEffect, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'

import {
  fieldLabel, ghostButton, inputStyle, modalBody, modalHairline,
  modalHeader, modalOverlay, modalShell, parseBRL, primaryButton,
  sanitizeMoneyInput, sectionLabel,
} from './styleHelpers'
import type {
  WishlistCategoria, WishlistItem, WishlistLink, WishlistLinkCreate,
} from '../../../types'
import {
  useCreateWishlistItem,
  useUpdateWishlistItem,
  useCreateWishlistLink,
  useUpdateWishlistLink,
  useDeleteWishlistLink,
  useReplaceWishlistReservas,
} from '../../../lib/wishlist-queries'
import { reportApiError } from '../../../api'
import {
  CronogramaReservasEditor,
  reservasToRows,
  rowsToPayload,
  type CronogramaRow,
} from './CronogramaReservasEditor'

export function WishlistItemModal({
  item, categorias, onClose,
}: {
  item: WishlistItem | null
  categorias: WishlistCategoria[]
  onClose: () => void
}) {
  const isEdit = !!item
  const [nome, setNome] = useState(item?.nome ?? '')
  const [valor, setValor] = useState(item ? String(item.valor_estimado).replace('.', ',') : '')
  const [categoriaId, setCategoriaId] = useState<string>(item?.categoria_id ?? '')
  const [dataAlvo, setDataAlvo] = useState(item?.data_alvo ?? '')
  const [descricao, setDescricao] = useState(item?.descricao ?? '')
  // Links — gerenciamos localmente (id já existente OU `tmpId` pra novos)
  const [links, setLinks] = useState<EditableLink[]>(
    (item?.links ?? []).map(l => ({ ...l, _tmpId: l.id, _isNew: false, _toDelete: false })),
  )
  const [cronograma, setCronograma] = useState<CronogramaRow[]>(
    reservasToRows(item?.reservas ?? [], item?.nome),
  )

  const createMut = useCreateWishlistItem()
  const updateMut = useUpdateWishlistItem()
  const createLinkMut = useCreateWishlistLink()
  const updateLinkMut = useUpdateWishlistLink()
  const deleteLinkMut = useDeleteWishlistLink()
  const replaceReservasMut = useReplaceWishlistReservas()

  const valorNumber = parseBRL(valor)
  const canSubmit = nome.trim() && valorNumber !== null && valorNumber > 0

  async function handleSubmit() {
    if (!canSubmit || valorNumber === null) return
    try {
      let savedId = item?.id
      if (isEdit && item) {
        await updateMut.mutateAsync({
          id: item.id,
          patch: {
            nome: nome.trim(),
            valor_estimado: valorNumber,
            categoria_id: categoriaId || null,
            data_alvo: dataAlvo || null,
            descricao: descricao || null,
          },
        })
      } else {
        const created = await createMut.mutateAsync({
          nome: nome.trim(),
          valor_estimado: valorNumber,
          categoria_id: categoriaId || null,
          data_alvo: dataAlvo || null,
          descricao: descricao || null,
        })
        savedId = created.id
      }

      if (savedId) {
        // Sincroniza links: cria novos, atualiza existentes editados, deleta
        // marcados pra remoção. Operações em paralelo dentro de cada bucket.
        const ops: Promise<unknown>[] = []
        for (const l of links) {
          if (l._toDelete && !l._isNew) {
            ops.push(deleteLinkMut.mutateAsync(l.id))
          } else if (l._isNew && !l._toDelete) {
            const body: WishlistLinkCreate = {
              url: l.url,
              label: l.label,
              preco: l.preco ?? null,
            }
            if (body.url.trim()) ops.push(createLinkMut.mutateAsync({ itemId: savedId, body }))
          } else if (!l._isNew && !l._toDelete) {
            ops.push(updateLinkMut.mutateAsync({
              linkId: l.id,
              patch: { url: l.url, label: l.label, preco: l.preco ?? null },
            }))
          }
        }
        await Promise.all(ops)

        // Cronograma: PUT é idempotente — substitui tudo. Mesmo sem mudanças
        // o backend só lê e re-escreve, então salvar sempre é seguro.
        await replaceReservasMut.mutateAsync({
          itemId: savedId,
          cronograma: rowsToPayload(cronograma),
        })
      }
      onClose()
    } catch (err) {
      reportApiError('WishlistItemModal.save', err)
      alert('Erro ao salvar item.')
    }
  }

  function addLink() {
    setLinks(prev => [...prev, {
      id: '', _tmpId: `tmp-${Date.now()}-${prev.length}`, _isNew: true, _toDelete: false,
      url: '', label: '', preco: null, sort_order: prev.length,
    }])
  }

  function removeLink(tmpId: string) {
    setLinks(prev =>
      prev.map(l => l._tmpId === tmpId ? { ...l, _toDelete: true } : l)
        .filter(l => !(l._isNew && l._toDelete)),  // novos com toDelete=true somem direto
    )
  }

  function updateLink(tmpId: string, patch: Partial<EditableLink>) {
    setLinks(prev => prev.map(l => l._tmpId === tmpId ? { ...l, ...patch } : l))
  }

  const visibleLinks = links.filter(l => !l._toDelete)

  return (
    <div onClick={onClose} style={modalOverlay()}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ ...modalShell(), minWidth: 540, maxWidth: 640, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <div style={sectionLabel()}>{isEdit ? 'Editar item' : 'Novo item da wishlist'}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={ghostButtonIcon()}>
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        <div style={modalBody()}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Nome">
              <input
                autoFocus
                style={inputStyle()}
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="ex: Colchão queen"
              />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Valor estimado">
                <input
                  style={inputStyle()}
                  value={valor}
                  onChange={e => setValor(sanitizeMoneyInput(e.target.value))}
                  placeholder="0,00"
                  inputMode="decimal"
                />
              </Field>

              <Field label="Categoria">
                <select
                  style={inputStyle()}
                  value={categoriaId}
                  onChange={e => setCategoriaId(e.target.value)}
                >
                  <option value="">Sem categoria</option>
                  {categorias.map(c => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Data-alvo (opcional)">
              <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                <input
                  style={{ ...inputStyle(), flex: '1 1 0', minWidth: 0, width: 'auto' }}
                  value={dataAlvo}
                  onChange={e => setDataAlvo(e.target.value)}
                  type="date"
                />
                <button
                  type="button"
                  onClick={() => setDataAlvo('')}
                  disabled={!dataAlvo}
                  title="Limpar data-alvo"
                  style={{
                    ...ghostButton(),
                    padding: '0 14px',
                    fontSize: 9,
                    flexShrink: 0,
                    opacity: dataAlvo ? 1 : 0.4,
                    cursor: dataAlvo ? 'pointer' : 'default',
                  }}
                >
                  limpar
                </button>
              </div>
            </Field>

            <Field label="Notas (opcional)">
              <textarea
                style={{ ...inputStyle(), minHeight: 60, resize: 'vertical' }}
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
                placeholder="detalhes, marca, modelo…"
              />
            </Field>

            {/* Links */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={fieldLabel()}>Links</span>
                <div style={{ flex: 1 }} />
                <button onClick={addLink} style={{ ...ghostButton(), fontSize: 9, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Plus size={10} strokeWidth={2} /> adicionar
                </button>
              </div>
              {visibleLinks.length === 0 ? (
                <div
                  style={{
                    padding: 10,
                    border: '1px dashed var(--color-border)',
                    color: 'var(--color-text-muted)',
                    fontFamily: 'var(--font-mono)', fontSize: 10,
                    letterSpacing: '0.14em', textTransform: 'uppercase',
                    textAlign: 'center',
                  }}
                >
                  Nenhum link adicionado
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {visibleLinks.map(l => (
                    <div
                      key={l._tmpId}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '110px 1fr 120px auto',
                        gap: 6, alignItems: 'center',
                      }}
                    >
                      <input
                        style={{ ...inputStyle(), padding: '6px 8px', fontSize: 11 }}
                        value={l.label ?? ''}
                        onChange={e => updateLink(l._tmpId, { label: e.target.value })}
                        placeholder="loja"
                      />
                      <input
                        style={{ ...inputStyle(), padding: '6px 8px', fontSize: 11 }}
                        value={l.url}
                        onChange={e => updateLink(l._tmpId, { url: e.target.value })}
                        placeholder="https://…"
                      />
                      <input
                        style={{ ...inputStyle(), padding: '6px 8px', fontSize: 11 }}
                        value={l.preco != null ? String(l.preco).replace('.', ',') : ''}
                        onChange={e => {
                          const v = sanitizeMoneyInput(e.target.value)
                          updateLink(l._tmpId, { preco: parseBRL(v) })
                        }}
                        placeholder="preço"
                        inputMode="decimal"
                      />
                      <button
                        onClick={() => removeLink(l._tmpId)}
                        title="remover link"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--color-text-tertiary)', padding: 4,
                        }}
                      >
                        <Trash2 size={12} strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Plano de reserva — cronograma mensal opcional */}
            <CronogramaReservasEditor
              rows={cronograma}
              onChange={setCronograma}
              valorEstimado={valorNumber}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--color-ice-deep)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={ghostButton()}>cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{ ...primaryButton(), opacity: canSubmit ? 1 : 0.4, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          >
            {isEdit ? 'salvar' : 'criar item'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Tipo interno do form (sobrescreve WishlistLink com flags de UI)
type EditableLink = WishlistLink & {
  _tmpId: string
  _isNew: boolean
  _toDelete: boolean
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={fieldLabel()}>{label}</span>
      {children}
    </div>
  )
}

function ghostButtonIcon(): React.CSSProperties {
  return {
    background: 'none',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-tertiary)',
    cursor: 'pointer',
    padding: 4,
    display: 'inline-flex', alignItems: 'center',
    borderRadius: 0,
  }
}
