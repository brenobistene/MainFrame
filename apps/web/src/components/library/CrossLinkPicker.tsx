/**
 * Popover de criação de cross-link de um LibraryItem pra:
 *  - Mind hipótese (pending/validated/refuted/suspended)
 *  - Quest (work item)
 *  - Build princípio (negativo / anti-meta)
 *  - Build meta (goal)
 *
 * Filosofia: o link é o que transforma 3 ilhas em sistema. "Esse livro
 * gerou tal hipótese / virou tal princípio / abriu tal projeto."
 *
 * Doc: docs/library/PLAN.md §7.
 */
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'

import { useGoals, usePrinciples } from '../../lib/build-queries'
import { useMindHipoteses } from '../../lib/health-queries'
import { useQuests } from '../../lib/app-queries'
import { useCreateLibraryLink } from '../../lib/library-queries'
import type { LibraryLinkTargetType } from '../../types'
import { BODY, DISPLAY, MONO } from '../health/tokens'

const LIBRARY_COR = '#7fb8a8'

interface Props {
  itemId: number
  /** Set de target_type:target_id já linkados — escondidos do picker. */
  existingKeys: Set<string>
  onClose: () => void
}

type Target = {
  id: string
  label: string
  /** Tag/badge curta exibida no início do item (status, area, etc). */
  badge?: string
  /** Cor opcional pro badge — quando dá contexto semântico (status). */
  badgeColor?: string
}

const TYPE_LABEL: Record<LibraryLinkTargetType, string> = {
  mind_hipotese: 'Hipótese (Mind)',
  quest: 'Projeto / Quest',
  build_principle: 'Princípio (Build)',
  build_goal: 'Meta (Build)',
}

export default function CrossLinkPicker({ itemId, existingKeys, onClose }: Props) {
  const [type, setType] = useState<LibraryLinkTargetType>('mind_hipotese')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [nota, setNota] = useState('')

  const { data: hipoteses = [] } = useMindHipoteses(undefined)
  const { data: quests = [] } = useQuests()
  const { data: principles = [] } = usePrinciples(false)
  const { data: goals = [] } = useGoals()

  const createLink = useCreateLibraryLink()

  const targets: Target[] = useMemo(() => {
    if (type === 'mind_hipotese') {
      return hipoteses.map((h) => ({
        id: String(h.id),
        label: h.texto,
        badge: h.status.toUpperCase(),
        badgeColor:
          h.status === 'validated'
            ? 'var(--color-ice-light)'
            : h.status === 'refuted'
              ? 'var(--color-error)'
              : h.status === 'suspended'
                ? 'var(--color-warning)'
                : 'var(--color-text-muted)',
      }))
    }
    if (type === 'quest') {
      return quests
        .filter((q) => q.status !== 'archived')
        .map((q) => ({
          id: q.id,
          label: q.title,
          badge: q.area_slug?.toUpperCase(),
        }))
    }
    if (type === 'build_principle') {
      return principles.map((p) => ({ id: String(p.id), label: p.texto }))
    }
    if (type === 'build_goal') {
      return goals.map((g) => ({
        id: g.id,
        label: g.titulo,
        badge: g.horizon?.toUpperCase(),
      }))
    }
    return []
  }, [type, hipoteses, quests, principles, goals])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const available = targets.filter((t) => !existingKeys.has(`${type}:${t.id}`))
    if (!q) return available
    return available.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        (t.badge && t.badge.toLowerCase().includes(q)),
    )
  }, [targets, query, existingKeys, type])

  function submit() {
    if (!selectedId) return
    createLink.mutate(
      {
        itemId,
        body: {
          target_type: type,
          target_id: selectedId,
          nota: nota.trim() || null,
        },
      },
      { onSuccess: () => onClose() },
    )
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
          width: 'min(600px, 92vw)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 'var(--space-4) var(--space-5)',
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
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: '0.18em',
              margin: 0,
              color: 'var(--color-text-primary)',
              textTransform: 'uppercase',
            }}
          >
            Adicionar conexão
          </h2>
          <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
            LIBRARY → MÓDULO
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

        {/* Tabs de target_type */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            flexWrap: 'wrap',
            marginBottom: 'var(--space-3)',
          }}
        >
          {(Object.keys(TYPE_LABEL) as LibraryLinkTargetType[]).map((t) => {
            const active = type === t
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setType(t)
                  setSelectedId(null)
                  setQuery('')
                }}
                className="hq-chamfer-bl"
                style={{
                  background: active ? LIBRARY_COR : 'var(--color-bg-primary)',
                  border: active
                    ? `1px solid ${LIBRARY_COR}`
                    : '1px solid var(--color-border)',
                  color: active ? '#000' : 'var(--color-text-secondary)',
                  padding: '4px 12px',
                  fontFamily: MONO,
                  fontSize: 10,
                  fontWeight: active ? 700 : 500,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                {TYPE_LABEL[t]}
              </button>
            )
          })}
        </div>

        {/* Busca */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 'var(--space-2)',
          }}
        >
          <Search size={12} color="var(--color-text-muted)" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="buscar…"
            autoFocus
            style={{
              flex: 1,
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              padding: '6px 10px',
              fontFamily: BODY,
              fontSize: 12,
              outline: 'none',
            }}
          />
        </div>

        {/* Lista */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            border: '1px solid var(--color-border)',
            maxHeight: 320,
            minHeight: 120,
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                padding: 'var(--space-4)',
                color: 'var(--color-text-muted)',
                fontSize: 12,
                fontFamily: BODY,
                fontStyle: 'italic',
                textAlign: 'center',
              }}
            >
              {targets.length === 0
                ? `Nenhum ${TYPE_LABEL[type].toLowerCase()} cadastrado ainda.`
                : 'Nenhum resultado pra essa busca.'}
            </div>
          ) : (
            filtered.map((t) => {
              const active = selectedId === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: active
                      ? 'var(--glass-bg-hover)'
                      : 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--color-divider)',
                    borderLeft: active
                      ? `2px solid ${LIBRARY_COR}`
                      : '2px solid transparent',
                    padding: 'var(--space-2) var(--space-3)',
                    cursor: 'pointer',
                    fontFamily: BODY,
                    fontSize: 13,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {t.badge && (
                    <span
                      className="hq-tech-id"
                      style={{
                        color: t.badgeColor ?? 'var(--color-text-muted)',
                        border: `1px solid ${t.badgeColor ?? 'var(--color-border)'}`,
                        padding: '1px 6px',
                        marginRight: 8,
                        letterSpacing: '0.12em',
                      }}
                    >
                      {t.badge}
                    </span>
                  )}
                  {t.label}
                </button>
              )
            })
          )}
        </div>

        {/* Nota opcional */}
        <div style={{ marginTop: 'var(--space-3)' }}>
          <div
            className="hq-tech-id"
            style={{
              color: 'var(--color-text-muted)',
              marginBottom: 4,
            }}
          >
            NOTA OPCIONAL · por que esse link existe
          </div>
          <input
            type="text"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="ex: aqui nasce a hipótese da volatilidade…"
            style={{
              width: '100%',
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              padding: '6px 10px',
              fontFamily: BODY,
              fontSize: 12,
              outline: 'none',
            }}
          />
        </div>

        {createLink.isError && (
          <div
            style={{
              color: 'var(--color-error)',
              fontFamily: BODY,
              fontSize: 12,
              fontStyle: 'italic',
              marginTop: 'var(--space-2)',
            }}
          >
            {(createLink.error as Error).message}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            justifyContent: 'flex-end',
            marginTop: 'var(--space-3)',
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
            disabled={!selectedId || createLink.isPending}
            className="hq-btn hq-btn--primary"
            style={{
              fontSize: 11,
              padding: '7px 14px',
              opacity: selectedId && !createLink.isPending ? 1 : 0.5,
            }}
          >
            CONECTAR
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
