/**
 * /health/biomonitor — Visão geral do Hub Health.
 *
 * Visualização pura — sem botões de ação. Cada painel é um link clicável
 * pra DomainPage do domínio (onde fica o registro/edit).
 *
 * Estética: vocabulário CP2077 do tronco — `hq-glass` painéis, chamfer-bl,
 * brackets ice opcional, Rajdhani uppercase nos nomes, JetBrains Mono nos
 * stats, oxblood pulse-square pros registros ao vivo. Cor por domínio
 * dessaturada (Fase 0) só como accent na border-left.
 *
 * Header da página foi pro HealthLayout (header band CP2077). Aqui só
 * conteúdo.
 */
import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { domainIconFor } from '../../components/health/domainIcon'
import PendingPanel from '../../components/health/PendingPanel'
import {
  DISPLAY,
  MONO,
  colorForDomain,
  formatRecordDate,
  isLiveRecord,
  summarizeRecordPayload,
} from '../../components/health/tokens'
import {
  useHealthDomains,
  useHealthRecords,
} from '../../lib/health-queries'
import type { HealthDomain } from '../../types'

export default function BiomonitorPage() {
  const { data: domains = [], isLoading } = useHealthDomains()

  return (
    <div
      style={{
        padding: 'var(--space-5) var(--space-6) var(--space-10)',
        position: 'relative',
      }}
    >
      <PendingPanel />

      {isLoading ? (
        <div
          className="hq-tech-id"
          style={{ marginTop: 16, color: 'var(--color-text-muted)' }}
        >
          // CARREGANDO DOMÍNIOS…
        </div>
      ) : (
        <div
          style={{
            marginTop: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {domains.map((d) => (
            <DomainPanel key={d.slug} domain={d} />
          ))}
        </div>
      )}
    </div>
  )
}

function DomainPanel({ domain }: { domain: HealthDomain }) {
  const cor = colorForDomain(domain.slug, domain.cor)
  const Icon = domainIconFor(domain.icone, domain.template)

  const range = useMemo(() => {
    const today = new Date()
    const from = new Date(today)
    from.setDate(today.getDate() - 6)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    return { from: fmt(from), to: fmt(today) }
  }, [])

  const { data: records = [] } = useHealthRecords(domain.slug, range)

  return (
    <Link
      to={`/health/${domain.slug}`}
      className="hq-glass hq-grain hq-card-hoverable hq-chamfer-bl"
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        padding: '14px 18px',
        position: 'relative',
        // Border-left dessaturada do domínio — único acento de cor
        borderLeft: `2px solid ${cor}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icon size={16} strokeWidth={1.6} color={cor} />
        <h2
          style={{
            fontFamily: DISPLAY,
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '0.18em',
            margin: 0,
            color: 'var(--color-text-primary)',
            textTransform: 'uppercase',
          }}
        >
          {domain.nome}
        </h2>
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}
        >
          {domain.template.toUpperCase()}
        </span>

        <div
          style={{
            display: 'flex',
            gap: 'var(--space-5)',
            alignItems: 'baseline',
            marginLeft: 'var(--space-4)',
            fontFamily: MONO,
            fontSize: 11,
          }}
        >
          <Stat label="7D" value={String(records.length)} valueColor={cor} />
          <Stat
            label="ÚLTIMO"
            value={
              records.length > 0
                ? formatRecordDate(records[0].data, domain.slug, records[0].payload)
                : '—'
            }
            valueColor="var(--color-text-secondary)"
          />
          {domain.lembrete_ativo && (
            <span
              className="hq-tech-id"
              style={{ color: 'var(--color-warning)' }}
            >
              LEMBRETE ON
            </span>
          )}
        </div>

        <ChevronRight
          size={14}
          color="var(--color-text-muted)"
          style={{ marginLeft: 'auto', flexShrink: 0 }}
        />
      </div>

      {records.length > 0 && (
        <RecentRecords
          records={records.slice(0, 3)}
          domainSlug={domain.slug}
          cor={cor}
        />
      )}
    </Link>
  )
}

function Stat({
  label,
  value,
  valueColor,
}: {
  label: string
  value: string
  valueColor: string
}) {
  return (
    <span style={{ display: 'inline-flex', gap: 5, alignItems: 'baseline' }}>
      <span
        className="hq-tech-id"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {label}
      </span>
      <span
        style={{
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0,
        }}
      >
        {value}
      </span>
    </span>
  )
}

function RecentRecords({
  records,
  domainSlug,
  cor,
}: {
  records: any[]
  domainSlug: string
  cor: string
}) {
  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 8,
        borderTop: '1px dashed var(--color-divider)',
      }}
    >
      {records.map((r) => {
        const live = isLiveRecord(r.criado_em)
        return (
          <div
            key={r.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              fontSize: 11,
              padding: '3px 0',
              fontFamily: MONO,
              color: 'var(--color-text-secondary)',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <PulseSquare live={live} cor={cor} />
              <span>
                {formatRecordDate(r.data, domainSlug, r.payload)}
                {r.horario && (
                  <span style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}>
                    {r.horario}
                  </span>
                )}
              </span>
            </span>
            <span style={{ color: 'var(--color-text-muted)' }}>
              {summarizeRecordPayload(r.payload)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Indicador angular HUD — quadradinho com glow ice/cor accent.
 * Live = pulsa em oxblood (mesmo padrão do banner CP2077). Não-live =
 * estático na cor do domínio (accent dessaturada).
 *
 * Substitui o `◉` de fonte que era o sinal antigo.
 */
function PulseSquare({ live, cor }: { live: boolean; cor: string }) {
  if (live) {
    return <span className="hq-pulse-square" />
  }
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        background: cor,
        boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.12)',
        flexShrink: 0,
        opacity: 0.65,
      }}
    />
  )
}

