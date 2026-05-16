/**
 * /health/biomonitor — Visão geral do Hub Health.
 *
 * Estrutura HUD CP2077 com peso visual coerente com DashboardPage:
 *   1. HERO BIOMÉTRICO  → veredict gigante + stats agregados (scoreboard ice)
 *   2. PENDING.QUEUE    → painel de lembretes/ausências (só aparece se >0)
 *   3. BIO.MATRIX       → grid 2-col de domínios, cada panel com sparkline 7d
 *                         + heatmap 30d + streak + records recentes
 *
 * Estética: hq-glass painéis, chamfer-bl, brackets ice opcional, Rajdhani
 * uppercase nos nomes, JetBrains Mono nos stats, oxblood pulse-square pros
 * registros ao vivo. Cor por domínio dessaturada só como accent.
 *
 * Header da página fica no HealthLayout (header band CP2077). Aqui só
 * conteúdo.
 */
import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { domainIconFor } from '../../components/health/domainIcon'
import PendingPanel from '../../components/health/PendingPanel'
import Sparkline from '../../components/health/Sparkline'
import Heatmap30d from '../../components/health/Heatmap30d'
import { extractTimeseries, lastNDays } from '../../components/health/timeseries'
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
  useHealthPending,
  useHealthRecords,
} from '../../lib/health-queries'
import { AnimatedNumber, SkeletonBlock } from '../../components/ui/Motion'
import type { HealthDomain } from '../../types'

export default function BiomonitorPage() {
  const { data: allDomains = [], isLoading } = useHealthDomains()
  const { data: pending = [] } = useHealthPending()

  // Mind virou peer top-level — não aparece mais no Biomonitor (filtra pelo
  // template). Doc: ARCHITECTURE §3.
  const domains = allDomains.filter((d) => d.template !== 'observacao_estruturada')

  return (
    <div
      style={{
        padding: 'var(--space-5) var(--space-6) var(--space-10)',
        position: 'relative',
      }}
    >
      <HeroBiometric
        domains={domains}
        pendingCount={pending.length}
        isLoading={isLoading}
      />

      <PendingPanel />

      <SectionHeader label="BIO.MATRIX" count={domains.length} />

      {isLoading ? (
        <SkeletonGrid />
      ) : domains.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            fontStyle: 'italic',
            marginTop: 14,
          }}
        >
          Nenhum domínio cadastrado.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
            gap: 'var(--space-3)',
            marginTop: 14,
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

// ─── HERO BIOMÉTRICO ─────────────────────────────────────────────────────

/**
 * Veredict gigante + 3 stats scoreboard (DOMAINS / PENDING / STATE).
 *
 * O veredict é derivado direto dos dados disponíveis no client (sem novo
 * endpoint): combina total de domínios ativos com count de pendências.
 * Mantém vibe HUD do Dashboard sem inventar métricas.
 */
function HeroBiometric({
  domains,
  pendingCount,
  isLoading,
}: {
  domains: HealthDomain[]
  pendingCount: number
  isLoading: boolean
}) {
  const total = domains.length

  // Veredict + cor + glow proporcional à "saúde" do sistema bio.
  const { headline, color, glow, hint } = useMemo(() => {
    if (total === 0) {
      return {
        headline: 'AWAITING SIGNAL',
        color: 'var(--color-text-tertiary)',
        glow: 'none',
        hint: '// SEM DOMÍNIOS ATIVOS',
      }
    }
    if (pendingCount === 0) {
      return {
        headline: 'VITALS NOMINAL',
        color: 'var(--color-success)',
        glow: '0 0 24px rgba(110, 167, 122, 0.35)',
        hint: '// SEM PENDÊNCIAS NO FLUXO',
      }
    }
    if (pendingCount <= 2) {
      return {
        headline: 'MINOR DRIFT',
        color: 'var(--color-ice-light)',
        glow: '0 0 24px var(--color-ice-glow)',
        hint: '// LEITURA PARCIAL · OBSERVAR',
      }
    }
    return {
      headline: 'SIGNAL FRAGMENTED',
      color: 'var(--color-accent-vivid)',
      glow: '0 0 28px rgba(184, 58, 58, 0.45)',
      hint: '// MÚLTIPLAS PENDÊNCIAS · ATENÇÃO',
    }
  }, [total, pendingCount])

  return (
    <section
      className="hq-glass hq-grain hq-chamfer-bl"
      style={{
        position: 'relative',
        padding: '24px 28px',
        marginBottom: 'var(--space-5)',
      }}
    >
      {/* HEADER da seção — tom técnico HUD */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
          color: 'var(--color-text-muted)',
        }}
      >
        <span
          className="hq-tech-label"
          style={{
            fontSize: 10,
            letterSpacing: '0.28em',
            color: 'var(--color-ice-light)',
          }}
        >
          BIO.STATUS
        </span>
        <div
          style={{
            width: 1,
            height: 14,
            background: 'var(--color-border-strong)',
          }}
        />
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)' }}
        >
          OBSERVATIONAL ONLY
        </span>
      </div>

      {!isLoading ? (
        <>
          {/* HEADLINE GIGANTE — veredict */}
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 40,
              fontWeight: 700,
              lineHeight: 1,
              color,
              textShadow: glow,
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}
          >
            {headline}
          </div>

          <div
            className="hq-tech-id"
            style={{
              color: 'var(--color-text-muted)',
              marginTop: 6,
              fontSize: 10,
            }}
          >
            {hint}
          </div>

          {/* STATS SCOREBOARD — auto-fit, mesmo padrão Dashboard */}
          <div
            style={{
              marginTop: 22,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '14px 32px',
              paddingTop: 16,
              borderTop: '1px solid var(--color-divider)',
            }}
          >
            <Stat
              label="DOMAINS"
              value={total}
              format={(n) => String(Math.round(n)).padStart(2, '0')}
              focal
            />
            <Stat
              label="PENDING"
              value={pendingCount}
              format={(n) => String(Math.round(n)).padStart(2, '0')}
              tone={
                pendingCount === 0
                  ? 'mute'
                  : pendingCount <= 2
                    ? 'ice'
                    : 'danger'
              }
            />
            <StatStatic
              label="STATE"
              value={total === 0 ? 'IDLE' : pendingCount === 0 ? 'CLEAR' : 'WATCH'}
              tone={
                total === 0
                  ? 'mute'
                  : pendingCount === 0
                    ? 'ok'
                    : pendingCount <= 2
                      ? 'ice'
                      : 'danger'
              }
            />
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SkeletonBlock height={42} width="60%" />
          <SkeletonBlock height={16} width="40%" />
          <SkeletonBlock height={14} width="50%" />
        </div>
      )}
    </section>
  )
}

function Stat({
  label,
  value,
  format,
  focal,
  tone,
}: {
  label: string
  value: number
  format: (n: number) => string
  focal?: boolean
  tone?: 'ice' | 'mute' | 'danger' | 'ok'
}) {
  const color =
    tone === 'danger'
      ? 'var(--color-accent-vivid)'
      : tone === 'ice'
        ? 'var(--color-ice-light)'
        : tone === 'ok'
          ? 'var(--color-success)'
          : tone === 'mute'
            ? 'var(--color-text-tertiary)'
            : focal
              ? 'var(--color-ice-light)'
              : 'var(--color-text-primary)'

  const glow =
    tone === 'ice' || focal
      ? '0 0 12px var(--color-ice-glow)'
      : tone === 'danger'
        ? '0 0 12px rgba(184, 58, 58, 0.35)'
        : 'none'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        className="hq-tech-label"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 18,
          fontWeight: 700,
          color,
          textShadow: glow,
          letterSpacing: '0.02em',
        }}
      >
        <AnimatedNumber value={value} format={format} duration={0.7} />
      </span>
    </div>
  )
}

function StatStatic({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'ice' | 'mute' | 'danger' | 'ok'
}) {
  const color =
    tone === 'danger'
      ? 'var(--color-accent-vivid)'
      : tone === 'ice'
        ? 'var(--color-ice-light)'
        : tone === 'ok'
          ? 'var(--color-success)'
          : 'var(--color-text-tertiary)'

  const glow =
    tone === 'ice'
      ? '0 0 12px var(--color-ice-glow)'
      : tone === 'danger'
        ? '0 0 12px rgba(184, 58, 58, 0.35)'
        : tone === 'ok'
          ? '0 0 12px rgba(110, 167, 122, 0.35)'
          : 'none'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        className="hq-tech-label"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16,
          fontWeight: 600,
          color,
          textShadow: glow,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        {value}
      </span>
    </div>
  )
}

// ─── SECTION HEADER ──────────────────────────────────────────────────────

/**
 * Cabeçalho técnico estilo Dashboard (`PROJECT.MATRIX · 12`). Não-colapsável
 * pra manter consistência com a vibe de "tudo visível" do biomonitor.
 */
function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        marginTop: 'var(--space-5)',
        paddingBottom: 6,
        borderBottom: '1px solid var(--color-divider)',
      }}
    >
      <span
        className="hq-tech-label"
        style={{
          fontSize: 10,
          letterSpacing: '0.28em',
          color: 'var(--color-text-primary)',
        }}
      >
        {label}
      </span>
      <span
        className="hq-tech-id"
        style={{ color: 'var(--color-text-muted)' }}
      >
        · {String(count).padStart(2, '0')}
      </span>
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
        gap: 'var(--space-3)',
        marginTop: 14,
      }}
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonBlock
          key={i}
          height={170}
          radius={'var(--radius-md)'}
        />
      ))}
    </div>
  )
}

// ─── DOMAIN PANEL ────────────────────────────────────────────────────────

/**
 * Panel de domínio enriquecido:
 *  - Header com ícone grande, nome, template e streak
 *  - Body com sparkline 7d (direita) + recent records (esquerda)
 *  - Footer com heatmap 30d compacto
 *
 * Border-left mais grossa que antes (3px) com glow sutil — assina presença
 * sem competir com o accent global oxblood.
 */
function DomainPanel({ domain }: { domain: HealthDomain }) {
  const cor = colorForDomain(domain.slug, domain.cor)
  const Icon = domainIconFor(domain.icone, domain.template)

  const range = useMemo(() => {
    const today = new Date()
    const from = new Date(today)
    from.setDate(today.getDate() - 29)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    return { from: fmt(from), to: fmt(today) }
  }, [])

  const { data: records = [] } = useHealthRecords(domain.slug, range)

  const range7d = useMemo(() => {
    const today = new Date()
    const from = new Date(today)
    from.setDate(today.getDate() - 6)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    return { from: fmt(from), to: fmt(today) }
  }, [])

  const recent7d = useMemo(
    () => records.filter((r) => r.data >= range7d.from && r.data <= range7d.to),
    [records, range7d.from, range7d.to],
  )

  // Sparkline 7d: extrai timeseries do template do domínio.
  const series = useMemo(
    () => extractTimeseries(recent7d, domain.template as any),
    [recent7d, domain.template],
  )

  // Streak: dias consecutivos olhando pra trás (incluindo hoje) com >=1 record.
  const streak = useMemo(() => calcStreak(records), [records])

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
        // Tint diagonal sutil na cor do domínio em vez de side-stripe.
        // Identifica o domínio sem violar o ban de border-stripe da DESIGN.md.
        backgroundImage: `linear-gradient(135deg, ${cor}14 0%, transparent 50%)`,
      }}
    >
      {/* HEADER */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 10,
        }}
      >
        <Icon size={22} strokeWidth={1.6} color={cor} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2
            style={{
              fontFamily: DISPLAY,
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '0.18em',
              margin: 0,
              color: 'var(--color-text-primary)',
              textTransform: 'uppercase',
              lineHeight: 1.2,
            }}
          >
            {domain.nome}
          </h2>
          <span
            className="hq-tech-id"
            style={{
              color: 'var(--color-text-muted)',
              fontSize: 9,
            }}
          >
            {domain.template.toUpperCase()}
          </span>
        </div>

        {streak > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 1,
            }}
          >
            <span
              className="hq-tech-label"
              style={{
                fontSize: 9,
                color: 'var(--color-text-muted)',
              }}
            >
              STREAK
            </span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 14,
                fontWeight: 700,
                color: cor,
                letterSpacing: '0.02em',
                textShadow: `0 0 8px ${cor}66`,
              }}
            >
              {streak}D
            </span>
          </div>
        )}

        <ChevronRight
          size={14}
          color="var(--color-text-muted)"
          style={{ flexShrink: 0, marginLeft: 4 }}
        />
      </div>

      {/* BODY — sparkline + meta */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          paddingTop: 8,
          borderTop: '1px dashed var(--color-divider)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flexShrink: 0,
            minWidth: 100,
          }}
        >
          <MiniStat label="7D" value={String(recent7d.length).padStart(2, '0')} cor={cor} />
          <MiniStat
            label="ÚLTIMO"
            value={
              records.length > 0
                ? formatRecordDate(records[0].data, domain.slug, records[0].payload)
                : '—'
            }
            cor="var(--color-text-secondary)"
          />
          {domain.lembrete_ativo && (
            <span
              className="hq-tech-id"
              style={{ color: 'var(--color-warning)', fontSize: 9 }}
            >
              · LEMBRETE ON
            </span>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <Sparkline points={series} cor={cor} width={220} height={42} />
        </div>
      </div>

      {/* RECENT RECORDS — só os 2 mais novos pra não pesar visual */}
      {records.length > 0 && (
        <RecentRecords
          records={records.slice(0, 2)}
          domainSlug={domain.slug}
          template={domain.template}
          cor={cor}
        />
      )}

      {/* FOOTER — heatmap 30d compacto */}
      <div
        style={{
          marginTop: 10,
          paddingTop: 8,
          borderTop: '1px dashed var(--color-divider)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span
            className="hq-tech-label"
            style={{
              fontSize: 9,
              color: 'var(--color-text-muted)',
            }}
          >
            30D
          </span>
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)', fontSize: 8 }}
          >
            · {countActiveDays(records)} ATIVOS
          </span>
        </div>
        <Heatmap30d records={records} cor={cor} cellSize={7} gap={2} />
      </div>
    </Link>
  )
}

function MiniStat({
  label,
  value,
  cor,
}: {
  label: string
  value: string
  cor: string
}) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline' }}>
      <span
        className="hq-tech-id"
        style={{ color: 'var(--color-text-muted)', fontSize: 9 }}
      >
        {label}
      </span>
      <span
        style={{
          color: cor,
          fontFamily: MONO,
          fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0,
          fontWeight: 600,
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
  template,
  cor,
}: {
  records: any[]
  domainSlug: string
  template: string
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
        // Pulse só pra registro do dia atual. Sono noturno usa criado_em
        // (data=ontem mas evento ainda recente); demais usam data — fix
        // do bug de registro retroativo "fica como hoje ativo".
        const live = isLiveRecord(r, template)
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
 * Indicador angular HUD — quadradinho com glow ice/cor accent. Live = pulsa
 * em oxblood (mesmo padrão do banner CP2077). Não-live = estático na cor do
 * domínio (accent dessaturada).
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

// ─── Helpers locais ──────────────────────────────────────────────────────

/** Conta dias consecutivos olhando pra trás (incluindo hoje) com >=1 record. */
function calcStreak(records: Array<{ data: string }>): number {
  if (records.length === 0) return 0
  const dates = new Set(records.map((r) => r.data))
  const days = lastNDays(60)
  // Itera do hoje pra trás
  let streak = 0
  for (let i = days.length - 1; i >= 0; i--) {
    if (dates.has(days[i])) {
      streak += 1
    } else {
      break
    }
  }
  return streak
}

/** Quantos dias dos últimos 30 têm pelo menos 1 record. */
function countActiveDays(records: Array<{ data: string }>): number {
  const last30 = new Set(lastNDays(30))
  const days = new Set<string>()
  for (const r of records) {
    if (last30.has(r.data)) days.add(r.data)
  }
  return days.size
}
