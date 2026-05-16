/**
 * /health/mind/tag/{slug} — Detail de uma tag específica.
 *
 * Mostra todas as sessions com a tag, hipóteses associadas, e mini-timeline
 * de quando ela apareceu. É a ferramenta de análise: pra entender quando e
 * por que esse padrão se repete.
 */
import { useMemo } from 'react'
import { ArrowLeft, Eye } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useState } from 'react'

import { useMindSessions, useMindTags } from '../../lib/health-queries'
import type { MindSession } from '../../types'
import { BODY, DISPLAY, MONO } from '../../components/health/tokens'
import MindRegisterModal from '../../components/mind/MindRegisterModal'

const MIND_COR = '#9b88c4'

export default function MindTagPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: tags, isLoading: tagsLoading } = useMindTags(true)
  const { data: sessions = [] } = useMindSessions({
    tag_slug: slug,
    limit: 200,
  })
  const [editingSession, setEditingSession] = useState<MindSession | null>(null)

  // IMPORTANTE: TODOS os hooks (useMemo etc) ANTES de qualquer early return,
  // senão React Rules of Hooks quebra ("Rendered more hooks than during the
  // previous render") e a página fica em branco/preta no runtime.
  const hipoteses = useMemo(() => {
    const map = new Map<string, { texto: string; status: string; count: number }>()
    for (const s of sessions) {
      if (s.payload.hipotese && s.hipotese) {
        const key = s.payload.hipotese
        const prev = map.get(key)
        if (prev) {
          prev.count++
        } else {
          map.set(key, { texto: key, status: s.hipotese.status, count: 1 })
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count)
  }, [sessions])

  // Early returns DEPOIS de todos os hooks.
  if (!slug) return <Navigate to="/health/mind" replace />

  // Estado de carregamento — não decide ainda se a tag existe ou não.
  if (tagsLoading || tags === undefined) {
    return (
      <div
        style={{
          padding: 'var(--space-5) var(--space-6)',
          color: 'var(--color-text-muted)',
          fontFamily: MONO,
          fontSize: 12,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}
      >
        carregando…
      </div>
    )
  }

  const tag = tags.find((t) => t.slug === slug)
  if (!tag) {
    return (
      <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-10)' }}>
        <Link
          to="/health/mind"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--color-text-muted)',
            fontFamily: MONO,
            fontSize: 11,
            textDecoration: 'none',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            marginBottom: 'var(--space-3)',
          }}
        >
          <ArrowLeft size={12} /> MIND
        </Link>
        <div
          className="hq-glass-elevated hq-grain hq-chamfer-cross"
          style={{
            position: 'relative',
            padding: 'var(--space-5) var(--space-6)',
            borderLeft: '2px solid var(--color-warning)',
          }}
        >
          <div
            aria-hidden="true"
            className="hq-hairline-ice"
            style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
          />
          <div
            className="hq-tech-label"
            style={{
              fontSize: 10,
              color: 'var(--color-warning)',
              letterSpacing: '0.28em',
              marginBottom: 'var(--space-2)',
            }}
          >
            TAG NÃO ENCONTRADA
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontSize: 14,
              color: 'var(--color-text-primary)',
              lineHeight: 1.5,
              marginBottom: 'var(--space-3)',
            }}
          >
            A tag <strong style={{ fontFamily: MONO }}>{slug}</strong> não
            existe ou foi removida.
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontSize: 12,
              color: 'var(--color-text-muted)',
              fontStyle: 'italic',
              marginBottom: 'var(--space-4)',
            }}
          >
            Pode ter sido deletada do catálogo (sessões antigas que usavam essa
            tag continuam no log, mas perdem o link).
          </div>
          <Link
            to="/health/mind"
            className="hq-btn hq-btn--ghost"
            style={{
              fontSize: 11,
              padding: '7px 14px',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <ArrowLeft size={12} /> VOLTAR AO MIND
          </Link>
        </div>
      </div>
    )
  }

  const accent = tag.cor ?? MIND_COR

  return (
    <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-10)' }}>
      <Link
        to="/health/mind"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--color-text-muted)',
          fontFamily: MONO,
          fontSize: 11,
          textDecoration: 'none',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          marginBottom: 'var(--space-3)',
        }}
      >
        <ArrowLeft size={12} /> MIND
      </Link>

      <header
        className="hq-glass-elevated hq-grain hq-chamfer-cross"
        style={{
          position: 'relative',
          padding: 'var(--space-4) var(--space-5)',
          marginBottom: 'var(--space-4)',
          borderLeft: `2px solid ${accent}`,
        }}
      >
        <div
          aria-hidden="true"
          className="hq-hairline-ice"
          style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Eye size={20} strokeWidth={1.6} color={accent} />
          <h1
            style={{
              fontFamily: DISPLAY,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '0.18em',
              margin: 0,
              color: accent,
              textTransform: 'uppercase',
            }}
          >
            {tag.nome}
          </h1>
          <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
            {sessions.length} APARIÇÕES
          </span>
        </div>
        {tag.descricao && (
          <div
            style={{
              fontFamily: BODY,
              fontSize: 13,
              fontStyle: 'italic',
              color: 'var(--color-text-secondary)',
              marginTop: 'var(--space-2)',
            }}
          >
            {tag.descricao}
          </div>
        )}
      </header>

      {hipoteses.length > 0 && (
        <>
          <SectionLabel>HIPÓTESES ASSOCIADAS</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
            {hipoteses.map((h, i) => (
              <div
                key={i}
                className="hq-glass hq-chamfer-bl"
                style={{
                  padding: 'var(--space-2) var(--space-3)',
                  borderLeft: `2px solid ${
                    h.status === 'validated'
                      ? 'var(--color-ice-light)'
                      : h.status === 'refuted'
                        ? 'var(--color-error)'
                        : h.status === 'suspended'
                          ? 'var(--color-warning)'
                          : 'var(--color-border)'
                  }`,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 'var(--space-3)',
                }}
              >
                <span
                  style={{
                    fontFamily: BODY,
                    fontSize: 13,
                    color: 'var(--color-text-primary)',
                    fontStyle: 'italic',
                    flex: 1,
                  }}
                >
                  "{h.texto}"
                </span>
                <span
                  className="hq-tech-id"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {h.count}x
                </span>
                <span
                  className="hq-tech-id"
                  style={{
                    color:
                      h.status === 'validated'
                        ? 'var(--color-ice-light)'
                        : h.status === 'refuted'
                          ? 'var(--color-error)'
                          : h.status === 'suspended'
                            ? 'var(--color-warning)'
                            : 'var(--color-text-secondary)',
                  }}
                >
                  {h.status.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionLabel>SESSÕES COM ESTA TAG</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'var(--space-2)' }}>
        {sessions.length === 0 && (
          <div
            style={{
              color: 'var(--color-text-muted)',
              fontSize: 12,
              padding: 'var(--space-4) 0',
              fontStyle: 'italic',
              fontFamily: BODY,
            }}
          >
            Nenhuma sessão registrada com esta tag ainda.
          </div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => setEditingSession(s)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setEditingSession(s)
              }
            }}
            className="hq-glass hq-row-hoverable hq-chamfer-bl"
            style={{
              padding: 'var(--space-3) var(--space-4)',
              borderLeft: `2px solid ${accent}`,
              cursor: 'pointer',
            }}
            title="Clique pra editar"
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  color: 'var(--color-text-secondary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatDateBR(s.data)}
              </span>
              {s.payload.duracao_min != null && (
                <span
                  className="hq-tech-id"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {s.payload.duracao_min}min
                </span>
              )}
            </div>
            <div
              style={{
                fontFamily: BODY,
                fontSize: 13,
                color: 'var(--color-text-primary)',
                lineHeight: 1.5,
                marginTop: 4,
                whiteSpace: 'pre-wrap',
              }}
            >
              {s.payload.observacao}
            </div>
            {s.payload.hipotese && (
              <div
                style={{
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: '1px dashed var(--color-divider)',
                  fontFamily: BODY,
                  fontSize: 12,
                  color: 'var(--color-text-secondary)',
                  fontStyle: 'italic',
                }}
              >
                hipótese: {s.payload.hipotese}
              </div>
            )}
          </div>
        ))}
      </div>

      {editingSession && (
        <MindRegisterModal
          existing={editingSession}
          onClose={() => setEditingSession(null)}
        />
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="hq-tech-label"
      style={{
        marginTop: 'var(--space-5)',
        fontSize: 10,
      }}
    >
      {children}
    </div>
  )
}

function formatDateBR(iso: string): string {
  const parts = iso.split('-')
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : iso
}
