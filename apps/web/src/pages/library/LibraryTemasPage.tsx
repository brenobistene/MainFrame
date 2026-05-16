/**
 * /library/temas — Agregação dos itens por tag.
 *
 * Mostra "que assuntos eu mais consumo / mais fecho / mais começo".
 * Click em tag filtra a lista principal por aquela tag.
 *
 * Doc: docs/library/PLAN.md §6.2.
 */
import { ArrowLeft, BookOpen, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useLibraryTemas } from '../../lib/library-queries'
import { BODY, DISPLAY, MONO } from '../../components/health/tokens'

const LIBRARY_COR = '#7fb8a8'

export default function LibraryTemasPage() {
  const { data: temas = [] } = useLibraryTemas()

  // Ordenado pelo backend (count_total desc) — não-arquivados só.
  const maxTotal = temas.length > 0 ? Math.max(...temas.map((t) => t.count_total)) : 1

  const totals = {
    items: temas.reduce((acc, t) => acc + t.count_total, 0),
    done: temas.reduce((acc, t) => acc + t.count_done, 0),
    doing: temas.reduce((acc, t) => acc + t.count_doing, 0),
  }

  return (
    <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-10)' }}>
      <Link
        to="/library"
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
        <ArrowLeft size={12} /> LIBRARY
      </Link>

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
          <BookOpen size={20} strokeWidth={1.6} color={LIBRARY_COR} />
          <h1
            style={{
              fontFamily: DISPLAY,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: '0.18em',
              margin: 0,
              color: 'var(--color-text-primary)',
              textTransform: 'uppercase',
            }}
          >
            Temas
          </h1>
          <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
            {temas.length} TAGS
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-6)',
            alignItems: 'baseline',
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px dashed var(--color-divider)',
          }}
        >
          <Stat label="ITENS CATEGORIZADOS" value={String(totals.items)} accent={LIBRARY_COR} />
          <Stat label="EM ANDAMENTO" value={String(totals.doing)} accent={LIBRARY_COR} />
          <Stat label="FECHADOS" value={String(totals.done)} accent="var(--color-ice-light)" />
        </div>
      </header>

      {temas.length === 0 ? (
        <div
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 12,
            padding: 'var(--space-6) 0',
            fontStyle: 'italic',
            fontFamily: BODY,
          }}
        >
          Nenhuma tag ainda. Crie tags no detail de um item.
        </div>
      ) : (
        <div className="hq-glass hq-chamfer-bl" style={{ padding: 'var(--space-4)' }}>
          {temas.map((t) => {
            const fillPct = (t.count_total / maxTotal) * 100
            const cor = t.tag_cor ?? LIBRARY_COR
            return (
              <Link
                key={t.tag_id}
                to={`/library?tag_slug=${encodeURIComponent(t.tag_slug)}`}
                className="hq-row-hoverable"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '160px 1fr 90px 16px',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: '6px 0',
                  textDecoration: 'none',
                  color: 'inherit',
                  borderBottom: '1px dashed var(--color-divider)',
                }}
              >
                <span
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: cor,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.tag_nome}
                </span>
                {/* Barra com duas camadas — done = mais saturado; restante = mais transparente */}
                <div
                  style={{
                    position: 'relative',
                    height: 10,
                    background: 'var(--color-border)',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: `${fillPct}%`,
                      background: cor,
                      opacity: 0.4,
                    }}
                  />
                  {t.count_done > 0 && t.count_total > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: `${(t.count_done / maxTotal) * 100}%`,
                        background: cor,
                        opacity: 0.9,
                      }}
                    />
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    fontFamily: MONO,
                    fontSize: 11,
                    letterSpacing: 0,
                  }}
                >
                  <span
                    style={{
                      color: 'var(--color-text-primary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {t.count_total} total
                  </span>
                  <span
                    className="hq-tech-id"
                    style={{ color: 'var(--color-text-muted)', fontSize: 9 }}
                  >
                    {t.count_done} done · {t.count_doing} doing
                  </span>
                </div>
                <ChevronRight size={11} color="var(--color-text-muted)" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Stat({
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
