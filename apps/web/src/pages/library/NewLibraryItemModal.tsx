/**
 * Modal de criação de novo LibraryItem.
 *
 * Campos: tipo (obrigatório) + título (obrigatório) + autor + ano + origem
 * + tags opcionais. Status nasce sempre `queue` — usuário muda depois.
 *
 * Doc: docs/library/PLAN.md §6.
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X } from 'lucide-react'

import {
  useCreateLibraryItem,
  useCreateLibrarySaga,
  useLibrarySagas,
  useLibraryTags,
} from '../../lib/library-queries'
import type { LibraryItemTipo } from '../../types'
import { BODY, DISPLAY, MONO } from '../../components/health/tokens'

const LIBRARY_COR = '#7fb8a8'

const TIPO_LABEL: Record<LibraryItemTipo, string> = {
  livro: 'Livro',
  filme: 'Filme',
  serie: 'Série',
  podcast: 'Podcast',
  artigo: 'Artigo',
  video: 'Vídeo',
  curso: 'Curso',
  palestra: 'Palestra',
  paper: 'Paper',
  outro: 'Outro',
}

export default function NewLibraryItemModal({
  onClose,
}: {
  onClose: () => void
}) {
  const [tipo, setTipo] = useState<LibraryItemTipo>('livro')
  const [titulo, setTitulo] = useState('')
  const [autor, setAutor] = useState('')
  const [ano, setAno] = useState('')
  const [origem, setOrigem] = useState('')
  const [tagIds, setTagIds] = useState<Set<number>>(new Set())
  const [sagaId, setSagaId] = useState<number | null>(null)
  const [creatingSaga, setCreatingSaga] = useState(false)
  const [newSagaNome, setNewSagaNome] = useState('')

  const { data: tags = [] } = useLibraryTags(false)
  const { data: sagas = [] } = useLibrarySagas()
  const create = useCreateLibraryItem()
  const createSaga = useCreateLibrarySaga()

  const canSubmit = titulo.trim().length > 0 && !create.isPending

  function submit() {
    if (!canSubmit) return
    create.mutate(
      {
        tipo,
        titulo: titulo.trim(),
        autor: autor.trim() || null,
        ano: ano.trim() ? parseInt(ano, 10) : null,
        origem: origem.trim() || null,
        tag_ids: Array.from(tagIds),
        saga_id: sagaId,
      },
      { onSuccess: () => onClose() },
    )
  }

  function submitNewSaga() {
    const nome = newSagaNome.trim()
    if (!nome) return
    createSaga.mutate(
      { nome },
      {
        onSuccess: (saga) => {
          setSagaId(saga.id)
          setNewSagaNome('')
          setCreatingSaga(false)
        },
      },
    )
  }

  function toggleTag(id: number) {
    const next = new Set(tagIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setTagIds(next)
  }

  const body = (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="hq-glass-elevated hq-grain hq-chamfer-cross"
        style={{
          width: 'min(560px, 92vw)',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: 'var(--space-5) var(--space-5) var(--space-4)',
          borderLeft: `2px solid ${LIBRARY_COR}`,
          position: 'relative',
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
            alignItems: 'baseline',
            gap: 'var(--space-2)',
            marginBottom: 'var(--space-3)',
          }}
        >
          <h2
            style={{
              fontFamily: DISPLAY,
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: '0.18em',
              margin: 0,
              color: 'var(--color-text-primary)',
              textTransform: 'uppercase',
            }}
          >
            Novo item
          </h2>
          <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
            LIBRARY
          </span>
          <button
            type="button"
            onClick={onClose}
            className="hq-icon-btn-bare"
            style={{ marginLeft: 'auto' }}
            title="Fechar"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tipo */}
        <Field label="TIPO">
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as LibraryItemTipo)}
            style={inputStyle}
          >
            {(Object.keys(TIPO_LABEL) as LibraryItemTipo[]).map((t) => (
              <option key={t} value={t}>
                {TIPO_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="TÍTULO" required>
          <input
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="ex: Antifrágil — Nassim Taleb"
            autoFocus
            style={inputStyle}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-3)' }}>
          <Field label="AUTOR / CRIADOR">
            <input
              type="text"
              value={autor}
              onChange={(e) => setAutor(e.target.value)}
              placeholder="opcional"
              style={inputStyle}
            />
          </Field>
          <Field label="ANO">
            <input
              type="number"
              inputMode="numeric"
              value={ano}
              onChange={(e) => setAno(e.target.value)}
              placeholder="opcional"
              style={inputStyle}
            />
          </Field>
        </div>

        <Field label="ORIGEM">
          <input
            type="text"
            value={origem}
            onChange={(e) => setOrigem(e.target.value)}
            placeholder="quem indicou / onde achou (opcional)"
            style={inputStyle}
          />
        </Field>

        {/* Saga — agrupamento visual (28 dias depois → 28 semanas → 28 anos).
            Permite criar saga nova inline sem sair do modal. */}
        <Field label="SAGA">
          {!creatingSaga ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={sagaId ?? ''}
                onChange={(e) =>
                  setSagaId(e.target.value === '' ? null : parseInt(e.target.value, 10))
                }
                style={{ ...inputStyle, flex: 1 }}
              >
                <option value="">— sem saga —</option>
                {sagas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome} ({s.items_count})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setCreatingSaga(true)}
                className="hq-btn hq-btn--ghost"
                style={{ fontSize: 11, padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                title="Criar nova saga"
              >
                <Plus size={12} strokeWidth={2.5} /> NOVA
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={newSagaNome}
                onChange={(e) => setNewSagaNome(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitNewSaga()
                  }
                  if (e.key === 'Escape') {
                    setCreatingSaga(false)
                    setNewSagaNome('')
                  }
                }}
                placeholder='ex: "28 dias depois"'
                autoFocus
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                type="button"
                onClick={submitNewSaga}
                disabled={!newSagaNome.trim() || createSaga.isPending}
                className="hq-btn hq-btn--primary"
                style={{ fontSize: 11, padding: '0 12px' }}
              >
                CRIAR
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatingSaga(false)
                  setNewSagaNome('')
                }}
                className="hq-btn hq-btn--ghost"
                style={{ fontSize: 11, padding: '0 12px' }}
              >
                <X size={12} />
              </button>
            </div>
          )}
        </Field>

        {/* Tags */}
        {tags.length > 0 && (
          <Field label="TAGS">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {tags.map((t) => {
                const active = tagIds.has(t.id)
                const cor = t.cor ?? LIBRARY_COR
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTag(t.id)}
                    className="hq-tech-id"
                    style={{
                      background: active ? cor : 'transparent',
                      color: active ? '#000' : cor,
                      border: `1px solid ${cor}`,
                      padding: '2px 8px',
                      cursor: 'pointer',
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: '0.12em',
                    }}
                  >
                    {t.nome}
                  </button>
                )
              })}
            </div>
          </Field>
        )}

        {create.isError && (
          <div
            style={{
              color: 'var(--color-error)',
              fontFamily: BODY,
              fontSize: 12,
              fontStyle: 'italic',
              marginTop: 'var(--space-2)',
            }}
          >
            {(create.error as Error).message}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            justifyContent: 'flex-end',
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px dashed var(--color-divider)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="hq-btn hq-btn--ghost"
            style={{ fontSize: 11, padding: '7px 14px' }}
          >
            CANCELAR
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="hq-btn hq-btn--primary"
            style={{
              fontSize: 11,
              padding: '7px 14px',
              opacity: canSubmit ? 1 : 0.5,
            }}
          >
            CRIAR
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--color-bg-primary)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-primary)',
  padding: '8px 10px',
  fontFamily: BODY,
  fontSize: 13,
  outline: 'none',
  letterSpacing: 0,
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      <div
        className="hq-tech-label"
        style={{
          fontSize: 10,
          marginBottom: 4,
          color: 'var(--color-text-muted)',
        }}
      >
        {label}
        {required && <span style={{ color: 'var(--color-warning)', marginLeft: 4 }}>*</span>}
      </div>
      {children}
    </div>
  )
}
