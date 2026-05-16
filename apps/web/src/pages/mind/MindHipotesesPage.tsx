/**
 * /health/mind/hipoteses — Histórico global de hipóteses.
 *
 * Mostra hipóteses agrupadas por status (pending, validated, refuted, suspended).
 * Permite revisitar o que foi validado/refutado ao longo do tempo —
 * perspectiva longa que MindPage não dá (lá só aparece pending).
 */
import { useState } from 'react'
import { ArrowLeft, Eye } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useMindHipoteses, useUpdateMindHipotese } from '../../lib/health-queries'
import type { MindHipotese, MindHipoteseStatus } from '../../types'
import { BODY, DISPLAY, MONO } from '../../components/health/tokens'
import LibraryBacklinksBadge from '../../components/library/LibraryBacklinksBadge'

const MIND_COR = '#9b88c4'

const STATUS_LABEL: Record<MindHipoteseStatus, string> = {
  pending: 'PENDENTES',
  validated: 'VALIDADAS',
  refuted: 'REFUTADAS',
  suspended: 'SUSPENSAS',
}

const STATUS_COR: Record<MindHipoteseStatus, string> = {
  pending: 'var(--color-text-secondary)',
  validated: 'var(--color-ice-light)',
  refuted: 'var(--color-error)',
  suspended: 'var(--color-warning)',
}

export default function MindHipotesesPage() {
  const [filter, setFilter] = useState<MindHipoteseStatus | 'todos'>('todos')

  const { data: all = [] } = useMindHipoteses(undefined)
  const filtered = filter === 'todos' ? all : all.filter((h) => h.status === filter)

  // Agrupar por status
  const grouped = (['pending', 'validated', 'refuted', 'suspended'] as MindHipoteseStatus[])
    .map((s) => ({ status: s, items: all.filter((h) => h.status === s) }))
    .filter((g) => g.items.length > 0)

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
          borderLeft: `2px solid ${MIND_COR}`,
        }}
      >
        <div
          aria-hidden="true"
          className="hq-hairline-ice"
          style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Eye size={18} strokeWidth={1.6} color={MIND_COR} />
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
            HIPÓTESES
          </h1>
          <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
            HISTÓRICO GLOBAL · {all.length}
          </span>
        </div>

        {/* Resumo por status */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-5)',
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px dashed var(--color-divider)',
            flexWrap: 'wrap',
          }}
        >
          {grouped.map((g) => (
            <button
              key={g.status}
              type="button"
              onClick={() => setFilter(filter === g.status ? 'todos' : g.status)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                alignItems: 'flex-start',
                opacity: filter === 'todos' || filter === g.status ? 1 : 0.4,
              }}
            >
              <span
                className="hq-tech-id"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {STATUS_LABEL[g.status]}
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 18,
                  fontWeight: 500,
                  color: STATUS_COR[g.status],
                  letterSpacing: 0,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {g.items.length}
              </span>
            </button>
          ))}
        </div>
      </header>

      {filtered.length === 0 ? (
        <div
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 12,
            padding: 'var(--space-6) 0',
            fontStyle: 'italic',
            fontFamily: BODY,
          }}
        >
          {all.length === 0
            ? 'Nenhuma hipótese registrada ainda.'
            : 'Nenhuma hipótese no filtro.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map((h) => (
            <HipoteseRow key={h.id} hipotese={h} />
          ))}
        </div>
      )}
    </div>
  )
}

function HipoteseRow({ hipotese }: { hipotese: MindHipotese }) {
  const update = useUpdateMindHipotese()
  const cor = STATUS_COR[hipotese.status]

  return (
    <div
      className="hq-glass hq-chamfer-bl"
      style={{
        padding: 'var(--space-3) var(--space-4)',
        borderLeft: `2px solid ${cor}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--space-2)',
          marginBottom: 4,
          flexWrap: 'wrap',
        }}
      >
        <span
          className="hq-tech-id"
          style={{ color: cor, letterSpacing: '0.18em' }}
        >
          {STATUS_LABEL[hipotese.status]}
        </span>
        {hipotese.record_data && (
          <span
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: 'var(--color-text-muted)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatDateBR(hipotese.record_data)}
          </span>
        )}
        {hipotese.tags.length > 0 && (
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)' }}
          >
            tags: {hipotese.tags.join(' · ')}
          </span>
        )}
        {hipotese.suspended_until && (
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-warning)' }}
          >
            até {formatDateBR(hipotese.suspended_until)}
          </span>
        )}
        <LibraryBacklinksBadge
          targetType="mind_hipotese"
          targetId={hipotese.id}
        />
      </div>
      <div
        style={{
          fontFamily: BODY,
          fontSize: 14,
          color: 'var(--color-text-primary)',
          lineHeight: 1.5,
          fontStyle: 'italic',
        }}
      >
        "{hipotese.texto}"
      </div>
      {hipotese.status !== 'pending' && (
        <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() =>
              update.mutate({ id: hipotese.id, status: 'pending' })
            }
            disabled={update.isPending}
            className="hq-btn hq-btn--ghost"
            style={{ fontSize: 10, padding: '4px 10px' }}
            title="Reabrir como pendente"
          >
            REABRIR
          </button>
        </div>
      )}
      {hipotese.status === 'pending' && (
        <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(['validated', 'refuted', 'suspended'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => update.mutate({ id: hipotese.id, status: s })}
              disabled={update.isPending}
              className="hq-btn hq-btn--ghost"
              style={{ fontSize: 10, padding: '4px 10px' }}
            >
              {s === 'validated' ? 'VALIDAR' : s === 'refuted' ? 'REFUTAR' : 'SUSPENDER'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function formatDateBR(iso: string): string {
  const parts = iso.split('-')
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : iso
}
