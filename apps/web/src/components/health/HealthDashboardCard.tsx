/**
 * Card "vitals" do Hub Health pro Dashboard.
 *
 * 1 leitura essencial por domínio + footer com contagem de pendências.
 * Acesso direto: clicar no card leva pra /health/biomonitor.
 *
 * Estética: vocabulário CP2077 do tronco — `hq-glass-elevated` + chamfer-cross
 * + grain + hairline ice no topo. Header `// BIOMONITOR` em hq-tech-label
 * (mesmo padrão das outras seções do Dashboard como PROJECT.MATRIX).
 * Tipografia mista: nome do domínio em Rajdhani uppercase, valor em
 * JetBrains Mono tabular-nums com cor accent dessaturada.
 *
 * Filosofia: NÃO é "performance dashboard" — é vitals (estado atual).
 * Sem cor de "bom"/"ruim", sem score reducionista. Cada leitura é factual.
 */
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import {
  useHealthDomains,
  useHealthItems,
  useHealthMetricValue,
  useHealthMetricsCatalog,
  useHealthPending,
  useHealthSettings,
} from '../../lib/health-queries'
import type {
  HealthDomain,
  HealthMetricMeta,
  HealthMetricValue,
} from '../../types'
import { DISPLAY, MONO, colorForDomain } from './tokens'
import { domainIconFor } from './domainIcon'

/**
 * Defaults de métrica primária por **template** (não por slug). Domínios
 * customizados que usem o mesmo template ganham o default automaticamente.
 * Usuário pode sobrescrever em qualquer domínio via `metric_primary_slug`.
 */
const PRIMARY_BY_TEMPLATE: Record<string, string> = {
  janela_qualidade: 'duracao_media_7d',
  atividade_tipo: 'frequencia_semanal',
  refeicao_2modos: 'aderencia_dieta_semanal',
  consumo_vontade: 'dias_desde_ultimo_consumo',
  metrica_simples: 'ultimo_valor',
  evento_escala: 'media_7d',
}

export default function HealthDashboardCard() {
  const { data: settings } = useHealthSettings()
  const { data: domains = [] } = useHealthDomains()
  const { data: pending = [] } = useHealthPending()
  const { data: catalog = [] } = useHealthMetricsCatalog()

  // Respeita preferência do usuário — pode esconder o card via settings.
  // `undefined` (settings ainda carregando) = mostra (estado padrão).
  if (settings && settings.dashboard_card_visivel === false) return null

  return (
    <div
      className="hq-glass-elevated hq-grain hq-card-hoverable hq-chamfer-cross"
      style={{
        position: 'relative',
        padding: 'var(--space-4) var(--space-5)',
      }}
    >
      {/* Hairline ice no topo — assinatura CP2077 hero card */}
      <div
        aria-hidden="true"
        className="hq-hairline-ice"
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
      />

      <Link
        to="/health/biomonitor"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          textDecoration: 'none',
          color: 'inherit',
          marginBottom: 'var(--space-3)',
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
          BIOMONITOR
        </span>
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)' }}
        >
          VITALS
        </span>
        <ChevronRight
          size={12}
          color="var(--color-text-muted)"
          style={{ marginLeft: 'auto' }}
        />
      </Link>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {domains.map((d) => (
          <VitalRow key={d.slug} domain={d} catalog={catalog} />
        ))}
      </div>

      {pending.length > 0 && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-2)',
            borderTop: '1px dashed var(--color-divider)',
          }}
        >
          <Link
            to="/health/biomonitor"
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
              {pending.length} {pending.length === 1 ? 'PENDÊNCIA' : 'PENDÊNCIAS'} HOJE
            </span>
          </Link>
        </div>
      )}
    </div>
  )
}

// ─── Vital row ────────────────────────────────────────────────────────────

function VitalRow({
  domain,
  catalog,
}: {
  domain: HealthDomain
  catalog: HealthMetricMeta[]
}) {
  const cor = colorForDomain(domain.slug, domain.cor)
  const Icon = domainIconFor(domain.icone, domain.template)

  // Resolve métrica primária:
  //   1. `domain.metric_primary_slug` se setado
  //   2. Default por template + slug do domínio
  const primarySlug = (() => {
    if (domain.metric_primary_slug) return domain.metric_primary_slug
    const stat = PRIMARY_BY_TEMPLATE[domain.template]
    if (!stat) return null
    return `${domain.slug}_${stat}`
  })()

  const primaryMeta = primarySlug
    ? catalog.find((m) => m.slug === primarySlug)
    : undefined

  const { data: items = [] } = useHealthItems(domain.slug)
  const firstActiveItem = items.find((i) => !i.arquivado)

  const itemId =
    primaryMeta?.precisa_item && firstActiveItem ? firstActiveItem.id : undefined

  const enabled =
    !!primarySlug && (!primaryMeta?.precisa_item || itemId !== undefined)

  const { data: metric } = useHealthMetricValue(primarySlug ?? '', itemId, enabled)

  return (
    <Link
      to={`/health/${domain.slug}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '14px 1fr auto',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: '3px 0',
        fontSize: 12,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <Icon size={13} strokeWidth={1.6} color={cor} />
      <span
        style={{
          fontFamily: DISPLAY,
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.18em',
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
        }}
      >
        {shortDomainName(domain.nome)}
        {primaryMeta?.precisa_item && firstActiveItem && (
          <span
            className="hq-tech-id"
            style={{
              color: 'var(--color-text-muted)',
              marginLeft: 6,
              letterSpacing: '0.12em',
            }}
          >
            · {firstActiveItem.nome.toUpperCase()}
          </span>
        )}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 13,
          fontWeight: 500,
          color: cor,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0,
        }}
      >
        {formatVital(metric, domain.slug)}
      </span>
    </Link>
  )
}

function shortDomainName(nome: string): string {
  // "Medidas Corporais" vira "Medidas" pra caber no card compacto
  if (nome.toLowerCase().startsWith('medidas')) return 'Medidas'
  return nome
}

function formatVital(
  metric: HealthMetricValue | undefined,
  domainSlug: string,
): string {
  if (!metric || !metric.dados_disponiveis) return '—'
  const v = metric.valor
  if (v === null || v === undefined) return '—'

  switch (metric.tipo_retorno) {
    case 'float': {
      const num = typeof v === 'number' ? v : parseFloat(String(v))
      if (Number.isNaN(num)) return '—'
      if (domainSlug === 'sono') {
        const h = Math.floor(num)
        const m = Math.round((num - h) * 60)
        return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
      }
      return `${num.toFixed(2).replace(/\.?0+$/, '')}${unitSuffix(metric.unidade)}`
    }
    case 'int':
      return `${v}${unitSuffix(metric.unidade)}`
    case 'string':
      return String(v)
    case 'date':
      return formatBR(String(v))
    case 'enum':
      if (v === 'subindo') return '↑'
      if (v === 'caindo') return '↓'
      if (v === 'estavel') return '→'
      return String(v)
    default:
      return String(v)
  }
}

function unitSuffix(unidade: string | null): string {
  if (!unidade) return ''
  if (unidade === '%' || unidade === 'h' || unidade === 'min') return unidade
  if (unidade === 'sessões/sem') return '/sem'
  if (unidade === 'dias') return 'd'
  return ''
}

function formatBR(iso: string): string {
  const parts = iso.split('-')
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : iso
}
