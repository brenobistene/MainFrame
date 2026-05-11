/**
 * Painel de Métricas de um domínio do Hub Health.
 *
 * Lê o catálogo via useHealthMetricsCatalog(), filtra pelas métricas do
 * domínio atual, e renderiza valor de cada uma. Métricas parametrizadas
 * por item (Vícios, Medidas) renderizam UMA linha por item ativo.
 *
 * Decisão arquitetural: cada valor é uma query independente. TanStack Query
 * cuida do cache; se latência virar problema, considerar batch endpoint
 * (decisão futura, anotada no PLAN.md §3.4).
 *
 * Estética: vocabulário CP2077 do tronco — cards em `hq-glass` + chamfer-bl,
 * Rajdhani uppercase pros nomes de métrica/item, JetBrains Mono tabular-nums
 * pros valores, sub-grupos por item com border-left accent dessaturada.
 */
import {
  useHealthMetricValue,
  useHealthMetricsCatalog,
} from '../../lib/health-queries'
import type { HealthDomain, HealthItem, HealthMetricMeta, HealthMetricValue } from '../../types'
import { BODY, DISPLAY, MONO } from './tokens'

interface Props {
  domain: HealthDomain
  items: HealthItem[]
  cor: string
}

export default function MetricsPanel({ domain, items, cor }: Props) {
  const { data: catalog = [], isLoading } = useHealthMetricsCatalog()
  const domainMetrics = catalog.filter((m) => m.domain_slug === domain.slug)
  const activeItems = items.filter((i) => !i.arquivado)

  if (isLoading) {
    return (
      <div
        className="hq-tech-id"
        style={{ color: 'var(--color-text-muted)', padding: '12px 0' }}
      >
        // CALCULANDO MÉTRICAS…
      </div>
    )
  }

  if (domainMetrics.length === 0) return null

  const globalMetrics = domainMetrics.filter((m) => !m.precisa_item)
  const itemMetrics = domainMetrics.filter((m) => m.precisa_item)

  return (
    <div>
      {globalMetrics.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 8,
            marginBottom: itemMetrics.length > 0 ? 16 : 0,
          }}
        >
          {globalMetrics.map((meta) => (
            <MetricCard key={meta.slug} meta={meta} cor={cor} />
          ))}
        </div>
      )}

      {itemMetrics.length > 0 &&
        activeItems.length > 0 &&
        activeItems.map((item) => (
          <div key={item.id} style={{ marginBottom: 12 }}>
            <div
              style={{
                marginBottom: 6,
                paddingLeft: 10,
                borderLeft: `2px solid ${cor}`,
                display: 'flex',
                alignItems: 'baseline',
                gap: 6,
              }}
            >
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
                {item.nome}
              </span>
              {item.unidade && (
                <span
                  className="hq-tech-id"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  ({item.unidade})
                </span>
              )}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: 8,
              }}
            >
              {itemMetrics.map((meta) => (
                <MetricCard
                  key={`${meta.slug}-${item.id}`}
                  meta={meta}
                  cor={cor}
                  itemId={item.id}
                />
              ))}
            </div>
          </div>
        ))}

      {itemMetrics.length > 0 && activeItems.length === 0 && (
        <div
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 11,
            fontStyle: 'italic',
            padding: '6px 0',
            fontFamily: BODY,
          }}
        >
          Cadastre um item primeiro pra ver métricas.
        </div>
      )}
    </div>
  )
}

function MetricCard({
  meta,
  cor,
  itemId,
}: {
  meta: HealthMetricMeta
  cor: string
  itemId?: number
}) {
  const { data, isLoading } = useHealthMetricValue(meta.slug, itemId, true)
  const live = !!data?.dados_disponiveis

  return (
    <div
      className="hq-glass hq-chamfer-bl"
      style={{
        padding: '8px 12px',
        position: 'relative',
      }}
    >
      <div
        className="hq-tech-label"
        style={{
          fontSize: 9,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.22em',
          marginBottom: 4,
        }}
      >
        {shortName(meta.nome)}
      </div>
      <div
        style={{
          fontSize: 14,
          color: live ? cor : 'var(--color-text-muted)',
          fontFamily: MONO,
          fontWeight: 500,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0,
          minHeight: 18,
          display: 'flex',
          alignItems: 'baseline',
          gap: 4,
        }}
      >
        <span>{isLoading ? '…' : formatValue(data, meta)}</span>
        {meta.unidade && live && (
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {meta.unidade}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Pega só a parte depois do "—" pra encurtar (ex: "Sono — duração média 30d"
 * vira "duração média 30d"). Se não tem hífen, retorna o nome inteiro.
 */
function shortName(nome: string): string {
  const idx = nome.indexOf('—')
  if (idx === -1) return nome
  return nome.slice(idx + 1).trim()
}

function formatValue(
  data: HealthMetricValue | undefined,
  meta: HealthMetricMeta,
): string {
  if (!data || !data.dados_disponiveis) return '—'
  const v = data.valor
  if (v === null || v === undefined) return '—'

  switch (meta.tipo_retorno) {
    case 'float':
      return typeof v === 'number' ? v.toFixed(2).replace(/\.?0+$/, '') : String(v)
    case 'int':
      return String(v)
    case 'string':
      return String(v)
    case 'date':
      return formatDateBR(String(v))
    case 'enum':
      return arrowForTrend(String(v))
    case 'dict':
      if (typeof v === 'object' && v !== null) {
        return Object.entries(v as Record<string, number>)
          .map(([k, p]) => `${k} ${p}%`)
          .join(' · ')
      }
      return String(v)
    default:
      return String(v)
  }
}

function arrowForTrend(trend: string): string {
  if (trend === 'subindo') return '↑ subindo'
  if (trend === 'caindo') return '↓ caindo'
  if (trend === 'estavel') return '→ estável'
  return trend
}

function formatDateBR(iso: string): string {
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}
