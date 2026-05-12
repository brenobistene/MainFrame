/**
 * /health/{slug} — Página dedicada de um domínio do Hub Health.
 *
 * Estrutura CP2077:
 *  - Header stamp do domínio (hq-glass-elevated + chamfer-bl + brackets ice
 *    opcional). Nome em Rajdhani uppercase grande, template tag, status.
 *  - Stats em row com labels hq-tech-id e valores em mono.
 *  - Pendências (PendingPanel filtrado por domínio).
 *  - Visualizações (heatmap + sparkline) com header `// TENDÊNCIA · 30D`.
 *  - Métricas calculadas (`// MÉTRICAS`).
 *  - Lista de registros (`// REGISTROS · 30D`) — cada row em hq-glass +
 *    chamfer-bl + border-left accent. Edit/delete em hq-icon-btn (hover ice
 *    e danger respectivamente).
 *
 * Botões REGISTRAR/ITENS herdados do tronco (hq-btn--primary chrome /
 * hq-btn--ghost). Cor accent do domínio fica restrita à border-left e ao
 * pulse-square dos registros ao vivo — chrome+ice dominam.
 */
import { useMemo, useState } from 'react'
import { ListChecks, Pencil, Plus, Trash2 } from 'lucide-react'
import { Navigate, useParams } from 'react-router-dom'

import { domainIconFor } from '../../components/health/domainIcon'
import Heatmap30d from '../../components/health/Heatmap30d'
import ItemsManagerModal from '../../components/health/ItemsManagerModal'
import MetricsPanel from '../../components/health/MetricsPanel'
import PendingPanel from '../../components/health/PendingPanel'
import RegisterModal from '../../components/health/RegisterModal'
import Sparkline from '../../components/health/Sparkline'
import { extractTimeseries } from '../../components/health/timeseries'
import {
  DISPLAY,
  MONO,
  colorForDomain,
  formatRecordDate,
  isLiveRecord,
  summarizeRecordPayload,
} from '../../components/health/tokens'
import { useNowHHMM } from '../../components/health/useNowHHMM'
import {
  useDeleteHealthRecord,
  useHealthDomain,
  useHealthItems,
  useHealthRecords,
} from '../../lib/health-queries'
import type { HealthDomain, HealthItem, HealthRecord } from '../../types'

export default function DomainPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: domain, isLoading, error } = useHealthDomain(slug ?? '')

  if (!slug) return <Navigate to="/health/biomonitor" replace />

  if (isLoading) {
    return (
      <div
        className="hq-tech-id"
        style={{
          padding: 'var(--space-5) var(--space-6)',
          color: 'var(--color-text-muted)',
        }}
      >
        // CARREGANDO…
      </div>
    )
  }

  if (error || !domain) {
    return (
      <div style={{ padding: 'var(--space-5) var(--space-6)' }}>
        <div
          style={{
            color: 'var(--color-error)',
            fontSize: 14,
            fontFamily: MONO,
            letterSpacing: '0.05em',
          }}
        >
          // DOMÍNIO "{slug}" NÃO ENCONTRADO
        </div>
      </div>
    )
  }

  return <DomainContent domain={domain} />
}

function DomainContent({ domain }: { domain: HealthDomain }) {
  const cor = colorForDomain(domain.slug, domain.cor)
  const Icon = domainIconFor(domain.icone, domain.template)
  const hhmm = useNowHHMM()

  const range7d = useMemo(() => {
    const today = new Date()
    const from = new Date(today)
    from.setDate(today.getDate() - 6)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    return { from: fmt(from), to: fmt(today) }
  }, [])

  const range30d = useMemo(() => {
    const today = new Date()
    const from = new Date(today)
    from.setDate(today.getDate() - 29)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    return { from: fmt(from), to: fmt(today) }
  }, [])

  const { data: records7d = [] } = useHealthRecords(domain.slug, range7d)
  const { data: records30d = [] } = useHealthRecords(domain.slug, {
    ...range30d,
    limit: 500,
  })
  const { data: items = [] } = useHealthItems(domain.slug, true)

  const [registerOpen, setRegisterOpen] = useState(false)
  const [itemsOpen, setItemsOpen] = useState(false)
  const [editing, setEditing] = useState<HealthRecord | null>(null)

  // ─── BigStat "SEM FUMAR" ─────────────────────────────────────────────────
  // Só ativa quando o domínio é `vicios` e existe item ativo "Cigarro"/"Cigarros".
  // Filosofia: um registro por dia, payload.eventos = lista de horários dos
  // cigarros. "Sem fumar" = agora − último evento (do registro mais recente).
  const cigarroItem =
    domain.slug === 'vicios' ? findCigarroItem(items) : undefined

  // `useNowHHMM` re-renderiza a cada minuto — derivamos `now` daqui pra que
  // o "tempo sem fumar" atualize sozinho sem precisar de timer dedicado.
  const now = useMemo(() => new Date(), [hhmm])
  const tempoSemFumar = useMemo(
    () =>
      cigarroItem ? formatTempoSemFumar(records30d, cigarroItem.id, now) : null,
    [cigarroItem, records30d, now],
  )

  // Quantos cigarros foram registrados hoje — soma de eventos (formato novo)
  // ou quantidade (legado). Aparece como BigStat ao lado do "SEM FUMAR".
  const cigarrosHoje = useMemo(() => {
    if (!cigarroItem) return null
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const todayRecord = records30d.find(
      (r) => r.item_id === cigarroItem.id && r.data === todayIso,
    )
    if (!todayRecord) return 0
    return countConsumo(todayRecord)
  }, [cigarroItem, records30d, now])

  return (
    <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-10)' }}>
      {/* ─── Header stamp do domínio ───────────────────────────────── */}
      <DomainHeader
        domain={domain}
        cor={cor}
        Icon={Icon}
        hhmm={hhmm}
        records7d={records7d.length}
        records30d={records30d.length}
        ultimoRegistro={
          records30d.length > 0
            ? formatRecordDate(records30d[0].data, domain.slug, records30d[0].payload)
            : null
        }
        onOpenItems={() => setItemsOpen(true)}
        onOpenRegister={() => setRegisterOpen(true)}
        hasCigarro={!!cigarroItem}
        tempoSemFumar={tempoSemFumar}
        cigarrosHoje={cigarrosHoje}
      />

      {/* ─── Pendências do dia (filtradas por este domínio) ────────── */}
      <PendingPanel filterDomain={domain.slug} />

      {/* ─── Visualizações ─────────────────────────────────────────── */}
      <VisualizationsPanel
        domain={domain}
        items={items}
        records={records30d}
        cor={cor}
      />

      {/* ─── Métricas ──────────────────────────────────────────────── */}
      <MetricsPanel domain={domain} items={items} cor={cor} />

      {/* ─── Lista de registros ────────────────────────────────────── */}
      <SectionLabel>REGISTROS · 30D</SectionLabel>
      {records30d.length === 0 ? (
        <div
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 12,
            padding: 'var(--space-6) 0',
            fontStyle: 'italic',
            fontFamily: 'var(--font-body)',
          }}
        >
          Nenhum registro nos últimos 30 dias. Toca em REGISTRAR pra começar.
        </div>
      ) : (
        <div>
          {records30d.map((r) => (
            <RecordRow
              key={r.id}
              record={r}
              items={items}
              domainSlug={domain.slug}
              cor={cor}
              onEdit={() => setEditing(r)}
            />
          ))}
        </div>
      )}

      {/* Modais */}
      {registerOpen && (
        <RegisterModal
          domain={domain}
          cor={cor}
          onClose={() => setRegisterOpen(false)}
        />
      )}
      {editing && (
        <RegisterModal
          domain={domain}
          cor={cor}
          existing={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {itemsOpen && (
        <ItemsManagerModal
          domain={domain}
          cor={cor}
          onClose={() => setItemsOpen(false)}
        />
      )}
    </div>
  )
}

// ─── Header stamp do domínio ──────────────────────────────────────────────

function DomainHeader({
  domain,
  cor,
  Icon,
  hhmm,
  records7d,
  records30d,
  ultimoRegistro,
  onOpenItems,
  onOpenRegister,
  hasCigarro,
  tempoSemFumar,
  cigarrosHoje,
}: {
  domain: HealthDomain
  cor: string
  Icon: ReturnType<typeof domainIconFor>
  hhmm: string
  records7d: number
  records30d: number
  ultimoRegistro: string | null
  onOpenItems: () => void
  onOpenRegister: () => void
  hasCigarro: boolean
  tempoSemFumar: string | null
  cigarrosHoje: number | null
}) {
  return (
    <header
      className="hq-glass-elevated hq-grain hq-chamfer-cross"
      style={{
        position: 'relative',
        padding: 'var(--space-4) var(--space-5)',
        marginBottom: 'var(--space-4)',
        // Border-left dessaturada do domínio — único accent forte de cor
        borderLeft: `2px solid ${cor}`,
      }}
    >
      {/* Hairline ice no topo, assinatura CP2077 hero card */}
      <div
        aria-hidden="true"
        className="hq-hairline-ice"
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Icon size={22} strokeWidth={1.6} color={cor} />
        <h1
          style={{
            fontFamily: DISPLAY,
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '0.18em',
            margin: 0,
            color: 'var(--color-text-primary)',
            textTransform: 'uppercase',
          }}
        >
          {domain.nome}
        </h1>
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}
        >
          {domain.template.toUpperCase()}.SCAN
        </span>

        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)', marginRight: 'var(--space-2)' }}
          >
            @ {hhmm}
          </span>
          {domain.usa_itens && (
            <button
              type="button"
              onClick={onOpenItems}
              className="hq-btn hq-btn--ghost"
              style={{ fontSize: 11, padding: '7px 12px' }}
            >
              <ListChecks size={13} strokeWidth={2} />
              ITENS
            </button>
          )}
          <button
            type="button"
            onClick={onOpenRegister}
            className="hq-btn hq-btn--primary"
            style={{ fontSize: 11, padding: '7px 14px' }}
          >
            <Plus size={13} strokeWidth={2.5} />
            REGISTRAR
          </button>
        </div>
      </div>

      {/* Stats inline — peso visual maior, valores em mono tabular */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-8)',
          alignItems: 'baseline',
          marginTop: 'var(--space-3)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px dashed var(--color-divider)',
        }}
      >
        {hasCigarro && (
          <BigStat
            label="SEM FUMAR"
            value={tempoSemFumar ?? '—'}
            accent={cor}
          />
        )}
        {hasCigarro && (
          <BigStat
            label="HOJE"
            value={`${cigarrosHoje ?? 0}x`}
            accent={cor}
          />
        )}
        <BigStat label="7D" value={String(records7d)} accent={cor} />
        <BigStat label="30D" value={String(records30d)} accent={cor} />
        <BigStat label="ÚLTIMO" value={ultimoRegistro ?? '—'} accent="var(--color-text-secondary)" />
        {domain.lembrete_ativo && (
          <BigStat label="LEMBRETE" value="ON" accent="var(--color-warning)" />
        )}
      </div>
    </header>
  )
}

function BigStat({
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

// ─── Section label ────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="hq-tech-label"
      style={{
        marginTop: 'var(--space-5)',
        marginBottom: 'var(--space-3)',
        fontSize: 10,
      }}
    >
      {children}
    </div>
  )
}

// ─── RecordRow ────────────────────────────────────────────────────────────

function RecordRow({
  record,
  items,
  domainSlug,
  cor,
  onEdit,
}: {
  record: HealthRecord
  items: HealthItem[]
  domainSlug: string
  cor: string
  onEdit: () => void
}) {
  const del = useDeleteHealthRecord()
  const item = items.find((i) => i.id === record.item_id) ?? null
  const live = isLiveRecord(record.criado_em)

  return (
    <div
      className="hq-glass hq-row-hoverable hq-chamfer-bl"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: '6px 12px',
        marginBottom: 3,
        fontSize: 12,
        fontFamily: MONO,
        borderLeft: `2px solid ${cor}`,
      }}
    >
      <div
        style={{
          minWidth: 150,
          color: 'var(--color-text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <PulseSquare live={live} cor={cor} />
        <span>
          {formatRecordDate(record.data, domainSlug, record.payload)}
          {record.horario && (
            <span style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}>
              {record.horario}
            </span>
          )}
        </span>
      </div>
      {item && (
        <div style={{ color: 'var(--color-text-primary)', minWidth: 110 }}>
          {item.nome}
          {item.unidade && (
            <span style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}>
              ({item.unidade})
            </span>
          )}
        </div>
      )}
      <div style={{ flex: 1, color: 'var(--color-text-primary)' }}>
        {summarizeRecordPayload(record.payload)}
        {record.notas && (
          <span
            style={{
              color: 'var(--color-text-muted)',
              marginLeft: 10,
              fontStyle: 'italic',
              fontFamily: 'var(--font-body)',
            }}
          >
            "{record.notas}"
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onEdit}
        title="Editar"
        className="hq-icon-btn"
        style={{ minWidth: 24, minHeight: 24, padding: 0 }}
      >
        <Pencil size={11} />
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirm('Deletar este registro?')) {
            del.mutate(record.id)
          }
        }}
        disabled={del.isPending}
        title="Deletar"
        className="hq-icon-btn hq-icon-btn--danger"
        style={{ minWidth: 24, minHeight: 24, padding: 0 }}
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

/**
 * Indicador angular HUD — quadradinho com glow oxblood (live) ou cor accent
 * estática (antigo). Substitui o `◉` de fonte do código antigo.
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

// ─── Visualizações (sparkline + heatmap) ──────────────────────────────────

function VisualizationsPanel({
  domain,
  items,
  records,
  cor,
}: {
  domain: HealthDomain
  items: HealthItem[]
  records: HealthRecord[]
  cor: string
}) {
  const activeItems = items.filter((i) => !i.arquivado)
  const isPerItem =
    domain.template === 'consumo_vontade' || domain.template === 'metrica_simples'

  return (
    <div>
      <SectionLabel>TENDÊNCIA · 30D</SectionLabel>

      {/* Heatmap */}
      <div style={{ marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-5)' }}>
        <Heatmap30d records={records} cor={cor} />
      </div>

      {/* Sparkline(s) */}
      {!isPerItem && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)', minWidth: 90 }}
          >
            {sparklineLabel(domain.template)}
          </span>
          <Sparkline
            points={extractTimeseries(records, domain.template)}
            cor={cor}
            width={420}
            height={40}
            fixedZero={domain.template !== 'janela_qualidade'}
          />
        </div>
      )}

      {isPerItem && activeItems.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {activeItems.map((item) => (
            <div
              key={item.id}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  color: 'var(--color-text-secondary)',
                  minWidth: 110,
                  letterSpacing: 0,
                }}
              >
                {item.nome.toLowerCase()}
              </span>
              <Sparkline
                points={extractTimeseries(records, domain.template, {
                  itemId: item.id,
                })}
                cor={cor}
                width={420}
                height={32}
                fixedZero={domain.template === 'consumo_vontade'}
              />
            </div>
          ))}
        </div>
      )}

      {isPerItem && activeItems.length === 0 && (
        <div
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 11,
            fontStyle: 'italic',
            padding: '4px 0',
            fontFamily: 'var(--font-body)',
          }}
        >
          Cadastre um item pra ver a tendência.
        </div>
      )}
    </div>
  )
}

function sparklineLabel(template: string): string {
  switch (template) {
    case 'janela_qualidade':
      return 'duração (h)'
    case 'atividade_tipo':
      return 'minutos'
    case 'refeicao_2modos':
      return 'refeições'
    case 'evento_escala':
      return 'escala'
    default:
      return 'valor'
  }
}

// ─── Helpers cigarro ──────────────────────────────────────────────────────
// Detecção por nome ativo. Aceita "Cigarro" e "Cigarros" (case-insensitive).
// Restrito ao domínio `vicios` no callsite — não vaza pra outros vícios.

function findCigarroItem(items: HealthItem[]): HealthItem | undefined {
  return items.find((i) => {
    if (i.arquivado) return false
    const n = i.nome.trim().toLowerCase()
    return n === 'cigarro' || n === 'cigarros'
  })
}

/**
 * Conta o consumo de um registro, suportando os dois formatos:
 *   - Legado: { quantidade: N }                                — retorna N
 *   - Novo (cigarro): { eventos: [...] }                       — retorna length
 */
function countConsumo(r: HealthRecord): number {
  const p = r.payload as { quantidade?: unknown; eventos?: unknown }
  if (Array.isArray(p.eventos)) return p.eventos.length
  if (typeof p.quantidade === 'number') return p.quantidade
  return 0
}

/**
 * Timestamp semântico do último cigarro fumado num registro:
 *
 *   1. Se `payload.eventos` é array e tem entradas — pega o horário máximo
 *      dos eventos, combinado com `data` do registro. Isso reflete o último
 *      cigarro fumado naquele dia, independente da ordem de adição.
 *   2. Senão, formato legado — usa `data + horario` do próprio registro.
 *   3. Fallbacks: `criado_em`, ou `data 12:00` como último anchor.
 */
function recordTimestamp(r: HealthRecord): Date | null {
  const payload = r.payload as { eventos?: Array<{ horario?: string }> }
  if (Array.isArray(payload.eventos) && payload.eventos.length > 0 && r.data) {
    const horarios = payload.eventos
      .map((e) => e?.horario)
      .filter((h): h is string => typeof h === 'string' && /^\d{2}:\d{2}$/.test(h))
    if (horarios.length > 0) {
      horarios.sort()
      const ultimo = horarios[horarios.length - 1]
      const d = new Date(`${r.data}T${ultimo}:00`)
      if (!Number.isNaN(d.getTime())) return d
    }
  }
  if (r.data && r.horario) {
    const d = new Date(`${r.data}T${r.horario}:00`)
    if (!Number.isNaN(d.getTime())) return d
  }
  if (r.criado_em) {
    const d = new Date(r.criado_em)
    if (!Number.isNaN(d.getTime())) return d
  }
  if (r.data) {
    const d = new Date(`${r.data}T12:00:00`)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

/**
 * Formata o intervalo desde o último cigarro:
 *   < 1h   → "12m"
 *   < 24h  → "3h" ou "3h45"
 *   ≥ 24h  → "2d"
 *
 * Como o modelo é 1 registro por dia, varremos todos os registros do item
 * e pegamos o timestamp máximo dentre os eventos. Não dependemos da ordem
 * da lista de records.
 */
function formatTempoSemFumar(
  records: HealthRecord[],
  itemId: number,
  now: Date,
): string | null {
  const cigarroRecords = records.filter((r) => r.item_id === itemId)
  if (cigarroRecords.length === 0) return null
  let latestTs: Date | null = null
  for (const r of cigarroRecords) {
    const ts = recordTimestamp(r)
    if (ts && (!latestTs || ts.getTime() > latestTs.getTime())) {
      latestTs = ts
    }
  }
  if (!latestTs) return null
  const diffMs = now.getTime() - latestTs.getTime()
  if (diffMs < 60000) return '0m'   // < 1 min — ainda fresco
  const totalMin = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (hours < 1) return `${mins}m`
  if (hours < 24) {
    return mins === 0 ? `${hours}h` : `${hours}h${String(mins).padStart(2, '0')}`
  }
  const days = Math.floor(hours / 24)
  return `${days}d`
}
