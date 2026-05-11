/**
 * Painel "PENDENTES HOJE" — exibido no topo da BiomonitorPage e DomainPage
 * quando há lembretes ou ausências.
 *
 * Tom factual, cor âmbar (atenção, não alarme). Sem cobrança nem peso
 * emocional — só sinaliza presença de info acionável. Filosofia em
 * RASCUNHO §3.2 e §6.9.
 *
 * Cada linha é clicável: leva pra DomainPage do domínio relevante (onde o
 * usuário pode registrar de fato).
 *
 * Estética: vocabulário CP2077 do tronco — `hq-glass` + chamfer-bl + border
 * left warning, `hq-tech-label` no header, tipografia mista (Rajdhani uppercase
 * pro nome do domínio, JetBrains Mono pra descrição).
 */
import { Link } from 'react-router-dom'
import { Bell, AlertTriangle } from 'lucide-react'

import { useHealthPending } from '../../lib/health-queries'
import type { HealthPendingItem } from '../../types'
import { DISPLAY, MONO, colorForDomain } from './tokens'

interface Props {
  /** Filtra pendências por domínio (usado na DomainPage). Se null, mostra todas. */
  filterDomain?: string
  /** Esconde se não há pendências (default: true). */
  hideIfEmpty?: boolean
}

export default function PendingPanel({ filterDomain, hideIfEmpty = true }: Props) {
  const { data: pending = [], isLoading } = useHealthPending()

  const filtered = filterDomain
    ? pending.filter((p) => p.domain_slug === filterDomain)
    : pending

  if (isLoading) return null
  if (filtered.length === 0 && hideIfEmpty) return null

  return (
    <div
      className="hq-glass hq-grain hq-chamfer-bl"
      style={{
        borderLeft: '2px solid var(--color-warning)',
        padding: '10px 14px',
        marginBottom: 'var(--space-3)',
      }}
    >
      <div
        className="hq-tech-label"
        style={{
          fontSize: 10,
          letterSpacing: '0.28em',
          color: 'var(--color-warning)',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <AlertTriangle size={11} strokeWidth={2} />
        PENDENTES HOJE · {filtered.length}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {filtered.map((p, i) => (
          <PendingRow key={`${p.domain_slug}-${p.item_id ?? 'g'}-${p.tipo}-${i}`} p={p} />
        ))}
      </div>
    </div>
  )
}

function PendingRow({ p }: { p: HealthPendingItem }) {
  const cor = colorForDomain(p.domain_slug)
  const Icon = p.tipo === 'lembrete' ? Bell : AlertTriangle

  return (
    <Link
      to={`/health/${p.domain_slug}`}
      className="hq-row-hoverable"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 12,
        color: 'var(--color-text-primary)',
        padding: '4px 6px',
        textDecoration: 'none',
      }}
    >
      <Icon size={11} color="var(--color-warning)" strokeWidth={2} />
      <span
        style={{
          color: cor,
          minWidth: 110,
          fontFamily: DISPLAY,
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}
      >
        {p.domain_nome}
        {p.item_nome && (
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}
          >
            · {p.item_nome}
          </span>
        )}
      </span>
      <span
        style={{
          color: 'var(--color-text-secondary)',
          flex: 1,
          fontFamily: MONO,
          letterSpacing: 0,
        }}
      >
        {p.descricao}
      </span>
      <span
        className="hq-tech-id"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {p.tipo}
      </span>
    </Link>
  )
}
