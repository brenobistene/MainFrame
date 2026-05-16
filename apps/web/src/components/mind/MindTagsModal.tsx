/**
 * Modal de gerenciamento de tags do Mind.
 *
 * Tags são vocabulário operacional pra agrupar observações. Backend tem
 * seeds default (12 tags), mas user pode criar/editar/arquivar.
 *
 * Filosoficamente: tags são CATEGORIAS DE PADRÃO OBSERVÁVEL, não rótulos
 * emocionais. Vocabulário deliberado pra forçar precisão em vez de
 * generalização (`rigidez` em vez de `mal`, `presença` em vez de `bem`).
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Archive, ArchiveRestore, Pencil, Plus, Trash2, X } from 'lucide-react'

import {
  useCreateMindTag,
  useDeleteMindTag,
  useMindTags,
  useUpdateMindTag,
} from '../../lib/health-queries'
import type { MindTag } from '../../types'
import { BODY, MONO } from '../health/tokens'

const MIND_COR = '#9b88c4'

interface Props {
  onClose: () => void
}

export default function MindTagsModal({ onClose }: Props) {
  const [showArchived, setShowArchived] = useState(false)
  const { data: tags = [] } = useMindTags(showArchived)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<MindTag | null>(null)
  const [error, setError] = useState<string | null>(null)

  return createPortal(
    <div
      role="dialog"
      onClick={onClose}
      className="hq-animate-overlay-in"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        overflow: 'hidden',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="hq-glass-elevated hq-grain hq-animate-modal-in hq-chamfer-cross"
        style={{
          position: 'relative',
          padding: 'var(--space-5) var(--space-6)',
          width: 'min(640px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          color: 'var(--color-text-primary)',
          borderLeft: `2px solid ${MIND_COR}`,
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <div
          aria-hidden="true"
          className="hq-hairline-ice"
          style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <span
            className="hq-tech-label"
            style={{
              fontSize: 11,
              color: 'var(--color-ice-light)',
              letterSpacing: '0.28em',
            }}
          >
            TAGS
          </span>
          <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
            MIND · VOCABULÁRIO
          </span>
          <button
            type="button"
            onClick={onClose}
            className="hq-icon-btn-bare"
            style={{ marginLeft: 'auto' }}
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div
            style={{
              background: 'var(--color-danger-bg)',
              border: '1px solid var(--color-danger-border)',
              color: 'var(--color-error)',
              padding: '8px 12px',
              fontSize: 12,
              marginBottom: 12,
              fontFamily: BODY,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            paddingBottom: 12,
            borderBottom: '1px dashed var(--color-divider)',
            marginBottom: 12,
          }}
        >
          <label
            className="hq-tech-id"
            style={{
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              style={{ accentColor: MIND_COR }}
            />
            MOSTRAR ARQUIVADAS
          </label>
          <button
            type="button"
            onClick={() => {
              setCreating(true)
              setEditing(null)
            }}
            className="hq-btn hq-btn--ghost"
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              padding: '6px 12px',
            }}
          >
            <Plus size={12} strokeWidth={2} /> NOVA TAG
          </button>
        </div>

        {(creating || editing) && (
          <TagForm
            initial={editing}
            onCancel={() => {
              setCreating(false)
              setEditing(null)
              setError(null)
            }}
            onDone={() => {
              setCreating(false)
              setEditing(null)
              setError(null)
            }}
            onError={setError}
          />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tags.length === 0 ? (
            <div
              style={{
                color: 'var(--color-text-muted)',
                fontSize: 12,
                padding: '24px 0',
                textAlign: 'center',
                fontStyle: 'italic',
                fontFamily: BODY,
              }}
            >
              Nenhuma tag {showArchived ? '' : 'ativa'}.
            </div>
          ) : (
            tags.map((t) => (
              <TagRow
                key={t.id}
                tag={t}
                onEdit={() => {
                  setEditing(t)
                  setCreating(false)
                }}
                onError={setError}
              />
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function TagRow({
  tag,
  onEdit,
  onError,
}: {
  tag: MindTag
  onEdit: () => void
  onError: (msg: string) => void
}) {
  const update = useUpdateMindTag()
  const del = useDeleteMindTag()

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        border: '1px solid var(--color-divider)',
        borderLeft: `2px solid ${tag.cor ?? MIND_COR}`,
        opacity: tag.arquivado ? 0.55 : 1,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: tag.cor ?? MIND_COR,
          minWidth: 110,
        }}
      >
        {tag.nome}
      </span>
      <span
        style={{
          fontFamily: BODY,
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          flex: 1,
          fontStyle: tag.descricao ? 'italic' : 'normal',
        }}
      >
        {tag.descricao ?? '—'}
      </span>
      <button
        type="button"
        onClick={onEdit}
        className="hq-icon-btn"
        title="Editar"
      >
        <Pencil size={12} />
      </button>
      <button
        type="button"
        onClick={() =>
          update.mutate({ id: tag.id, patch: { arquivado: !tag.arquivado } })
        }
        disabled={update.isPending}
        className="hq-icon-btn"
        title={tag.arquivado ? 'Desarquivar' : 'Arquivar'}
      >
        {tag.arquivado ? <ArchiveRestore size={12} /> : <Archive size={12} />}
      </button>
      <button
        type="button"
        onClick={() => {
          if (
            confirm(
              `Deletar tag "${tag.nome}" definitivamente? Vai remover de TODAS as sessões anteriores. Prefira arquivar pra preservar histórico.`,
            )
          ) {
            del.mutate(tag.id, {
              onError: (err) => onError((err as Error).message),
            })
          }
        }}
        disabled={del.isPending}
        className="hq-icon-btn hq-icon-btn--danger"
        title="Deletar"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function TagForm({
  initial,
  onCancel,
  onDone,
  onError,
}: {
  initial: MindTag | null
  onCancel: () => void
  onDone: () => void
  onError: (msg: string) => void
}) {
  const isEdit = !!initial
  const create = useCreateMindTag()
  const update = useUpdateMindTag()

  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [nome, setNome] = useState(initial?.nome ?? '')
  const [descricao, setDescricao] = useState(initial?.descricao ?? '')
  const [cor, setCor] = useState(initial?.cor ?? '')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) {
      onError('Nome obrigatório')
      return
    }
    if (isEdit && initial) {
      update.mutate(
        {
          id: initial.id,
          patch: {
            nome: nome.trim(),
            descricao: descricao.trim() || null,
            cor: cor.trim() || null,
          },
        },
        { onSuccess: onDone, onError: (err) => onError((err as Error).message) },
      )
    } else {
      const auto_slug = slug.trim() || nome.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
      create.mutate(
        {
          slug: auto_slug,
          nome: nome.trim(),
          descricao: descricao.trim() || null,
          cor: cor.trim() || null,
        },
        { onSuccess: onDone, onError: (err) => onError((err as Error).message) },
      )
    }
  }

  const pending = create.isPending || update.isPending

  return (
    <form
      onSubmit={submit}
      className="hq-glass hq-chamfer-bl"
      style={{
        marginBottom: 12,
        padding: '12px 14px',
        borderLeft: `2px solid ${MIND_COR}`,
      }}
    >
      <div
        className="hq-tech-label"
        style={{
          fontSize: 10,
          marginBottom: 10,
          color: 'var(--color-ice-light)',
          letterSpacing: '0.24em',
        }}
      >
        {isEdit ? 'EDITAR TAG' : 'NOVA TAG'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 10 }}>
        <div>
          <Label>NOME *</Label>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={80}
            style={inputStyle()}
            required
            autoFocus
          />
        </div>
        {!isEdit && (
          <div>
            <Label>SLUG (OPC)</Label>
            <input
              type="text"
              value={slug}
              onChange={(e) =>
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
              }
              placeholder="auto: snake_case do nome"
              maxLength={50}
              style={inputStyle()}
            />
          </div>
        )}
        <div style={{ gridColumn: isEdit ? '2 / span 2' : '3 / span 1' }}>
          <Label>COR (OPC)</Label>
          <input
            type="color"
            value={cor || '#9b88c4'}
            onChange={(e) => setCor(e.target.value)}
            style={{
              width: '100%',
              height: 30,
              padding: 0,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-primary)',
              cursor: 'pointer',
            }}
          />
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <Label>DESCRIÇÃO (OPC)</Label>
        <input
          type="text"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          maxLength={200}
          placeholder='ex: "dificuldade de iniciar"'
          style={inputStyle()}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} className="hq-btn hq-btn--ghost" style={{ fontSize: 11 }}>
          CANCELAR
        </button>
        <button
          type="submit"
          disabled={pending}
          className="hq-btn hq-btn--primary"
          style={{ fontSize: 11 }}
        >
          {pending ? 'SALVANDO…' : isEdit ? 'SALVAR' : 'CRIAR'}
        </button>
      </div>
    </form>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="hq-tech-label" style={{ fontSize: 9, marginBottom: 4 }}>
      {children}
    </div>
  )
}

function inputStyle(): React.CSSProperties {
  return {
    background: 'var(--color-bg-primary)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-primary)',
    padding: '6px 10px',
    fontFamily: MONO,
    fontSize: 12,
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
    colorScheme: 'dark',
  }
}
