/**
 * Card vitals do módulo Library no Dashboard.
 *
 * Espelha visualmente o `HealthDashboardCard`: hero CP2077 (glass-elevated +
 * grain + chamfer-cross + hairline ice) com leitura essencial — em andamento,
 * fila, fechados na semana, revisitas pendentes.
 *
 * Click leva pra /library. Se tiver revisita atrasada, mostra rodapé warning.
 *
 * Filosofia: descoberta diária do estado da biblioteca. Sem rating, sem
 * progresso %. Doc: docs/library/PLAN.md.
 */
import { BookOpen, ChevronRight, AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useLibraryItems, useLibraryPending } from '../../lib/library-queries'
import { MONO } from '../health/tokens'

const LIBRARY_COR = '#7fb8a8'

export default function LibraryDashboardCard() {
  const { data: items = [] } = useLibraryItems()
  const { data: pending = [] } = useLibraryPending(7)

  // Calcula stats mínimas — mesmo cálculo da LibraryPage pra não divergir.
  const doing = items.filter((i) => i.status === 'doing').length
  const queue = items.filter((i) => i.status === 'queue').length
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 6)
  const cutoffIso = cutoff.toISOString().slice(0, 10)
  const done7 = items.filter(
    (i) => i.status === 'done' && (i.data_fim ?? '') >= cutoffIso,
  ).length
  const atrasados = pending.filter((p) => p.dias_ate < 0).length

  // Esconde card se nada na biblioteca ainda (estado virgem) — combate ruído
  // no Dashboard pra quem acabou de instalar.
  if (items.length === 0 && pending.length === 0) return null

  return (
    <div
      className="hq-glass-elevated hq-grain hq-card-hoverable hq-chamfer-cross"
      style={{
        position: 'relative',
        padding: 'var(--space-4) var(--space-5)',
      }}
    >
      <div
        aria-hidden="true"
        className="hq-hairline-ice"
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
      />

      <Link
        to="/library"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          textDecoration: 'none',
          color: 'inherit',
          marginBottom: 'var(--space-3)',
        }}
      >
        <BookOpen size={14} strokeWidth={1.8} color={LIBRARY_COR} />
        <span
          className="hq-tech-label"
          style={{
            fontSize: 11,
            color: LIBRARY_COR,
            letterSpacing: '0.28em',
          }}
        >
          LIBRARY
        </span>
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)' }}
        >
          INPUT.CURADO
        </span>
        <ChevronRight
          size={12}
          color="var(--color-text-muted)"
          style={{ marginLeft: 'auto' }}
        />
      </Link>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--space-4)',
        }}
      >
        <Vital label="EM ANDAMENTO" value={String(doing)} accent={LIBRARY_COR} />
        <Vital label="FILA" value={String(queue)} accent="var(--color-text-secondary)" />
        <Vital label="DONE 7D" value={String(done7)} accent="var(--color-ice-light)" />
        <Vital
          label="REVISITAR"
          value={String(pending.length)}
          accent={pending.length > 0 ? 'var(--color-warning)' : 'var(--color-text-secondary)'}
        />
      </div>

      {atrasados > 0 && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-2)',
            borderTop: '1px dashed var(--color-divider)',
          }}
        >
          <Link
            to="/library"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontFamily: MONO,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--color-warning)',
              textDecoration: 'none',
            }}
          >
            <AlertTriangle size={11} strokeWidth={2} />
            <span>
              {atrasados} REVISITA{atrasados !== 1 ? 'S' : ''} ATRASADA{atrasados !== 1 ? 'S' : ''}
            </span>
          </Link>
        </div>
      )}
    </div>
  )
}

function Vital({
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
