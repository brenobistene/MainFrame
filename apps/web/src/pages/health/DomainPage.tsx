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
import { extractTimeseries, lastNDays } from '../../components/health/timeseries'
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
import { AnimatedNumber, SkeletonBlock } from '../../components/ui/Motion'
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

  // Streak: dias consecutivos olhando pra trás com >=1 record.
  const streak = useMemo(() => calcStreak(records30d), [records30d])

  return (
    <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-10)' }}>
      {/* ─── HERO do domínio (CP2077 veredict + scoreboard) ─────────── */}
      <DomainHero
        domain={domain}
        cor={cor}
        Icon={Icon}
        hhmm={hhmm}
        records7d={records7d.length}
        records30d={records30d.length}
        streak={streak}
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
      <SectionHeader label="LOG.STREAM · 30D" count={records30d.length} />
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
        <div style={{ marginTop: 'var(--space-3)' }}>
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

// ─── Hero do domínio (CP2077 veredict + scoreboard) ──────────────────────

/**
 * Hero card do domínio: top stripe (icon + nome + actions), VEREDICT gigante
 * derivado do estado (streak / atividade recente / ausência), e scoreboard
 * com AnimatedNumber. Mesmo padrão do BiomonitorPage HeroBiometric.
 */
function DomainHero({
  domain,
  cor,
  Icon,
  hhmm,
  records7d,
  records30d,
  streak,
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
  streak: number
  ultimoRegistro: string | null
  onOpenItems: () => void
  onOpenRegister: () => void
  hasCigarro: boolean
  tempoSemFumar: string | null
  cigarrosHoje: number | null
}) {
  // Veredict + cor + glow derivados do estado do domínio.
  const { headline, headlineColor, glow, hint } = useMemo(
    () => deriveDomainVeredict({ streak, records7d, records30d, cor }),
    [streak, records7d, records30d, cor],
  )

  return (
    <header
      className="hq-glass-elevated hq-grain hq-chamfer-cross"
      style={{
        position: 'relative',
        padding: 'var(--space-5) var(--space-6)',
        marginBottom: 'var(--space-4)',
        borderLeft: `3px solid ${cor}`,
        boxShadow: `inset 1px 0 8px -4px ${cor}`,
      }}
    >
      {/* Hairline ice no topo, assinatura CP2077 hero card */}
      <div
        aria-hidden="true"
        className="hq-hairline-ice"
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
      />

      {/* TOP STRIPE — icon + nome + scan tag + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Icon size={22} strokeWidth={1.6} color={cor} />
        <h1
          style={{
            fontFamily: DISPLAY,
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: '0.22em',
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

      {/* VEREDICT GIGANTE — derivado do estado */}
      <div
        style={{
          marginTop: 'var(--space-4)',
          fontFamily: DISPLAY,
          fontSize: 38,
          fontWeight: 700,
          lineHeight: 1,
          color: headlineColor,
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

      {/* SCOREBOARD — auto-fit, AnimatedNumber, glow ice/cor accent */}
      <div
        style={{
          marginTop: 'var(--space-4)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: '14px 28px',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--color-divider)',
        }}
      >
        {hasCigarro && (
          <HeroStatStatic
            label="SEM FUMAR"
            value={tempoSemFumar ?? '—'}
            color={cor}
            glow={`0 0 12px ${cor}66`}
          />
        )}
        {hasCigarro && (
          <HeroStatNumber
            label="HOJE"
            value={cigarrosHoje ?? 0}
            format={(n) => `${Math.round(n)}x`}
            color={cor}
          />
        )}
        <HeroStatNumber
          label="STREAK"
          value={streak}
          format={(n) => `${Math.round(n)}D`}
          color={streak > 0 ? cor : 'var(--color-text-tertiary)'}
          glow={streak > 0 ? `0 0 12px ${cor}66` : 'none'}
        />
        <HeroStatNumber label="7D" value={records7d} color={cor} />
        <HeroStatNumber label="30D" value={records30d} color={cor} />
        <HeroStatStatic
          label="ÚLTIMO"
          value={ultimoRegistro ?? '—'}
          color="var(--color-text-secondary)"
          glow="none"
        />
        {domain.lembrete_ativo && (
          <HeroStatStatic
            label="LEMBRETE"
            value="ON"
            color="var(--color-warning)"
            glow="0 0 12px rgba(192, 138, 58, 0.35)"
          />
        )}
      </div>
    </header>
  )
}

function HeroStatNumber({
  label,
  value,
  format = (n) => String(Math.round(n)),
  color,
  glow,
}: {
  label: string
  value: number
  format?: (n: number) => string
  color: string
  glow?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="hq-tech-label" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 20,
          fontWeight: 700,
          color,
          textShadow: glow ?? 'none',
          letterSpacing: '0.02em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <AnimatedNumber value={value} format={format} duration={0.7} />
      </span>
    </div>
  )
}

function HeroStatStatic({
  label,
  value,
  color,
  glow,
}: {
  label: string
  value: string
  color: string
  glow: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="hq-tech-label" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 18,
          fontWeight: 600,
          color,
          textShadow: glow,
          letterSpacing: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}

// ─── Section header técnico (estilo BIO.MATRIX) ──────────────────────────

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
        padding: '9px 14px',
        marginBottom: 4,
        fontSize: 12,
        fontFamily: MONO,
        borderLeft: `3px solid ${cor}`,
        boxShadow: `inset 1px 0 6px -3px ${cor}`,
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
      <SectionHeader label="TREND.SIGNAL · 30D" count={records.length} />

      {/* Heatmap */}
      <div style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-5)' }}>
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

// Vocabulário aceito pra detectar o item cigarro. Aceita variações comuns
// em PT-BR. Restrito ao domínio `vicios` no callsite.
const CIGARRO_NAMES = new Set(['cigarro', 'cigarros', 'fumo', 'fumos'])

function findCigarroItem(items: HealthItem[]): HealthItem | undefined {
  return items.find((i) => {
    if (i.arquivado) return false
    return CIGARRO_NAMES.has(i.nome.trim().toLowerCase())
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

// ─── Helpers do domínio (streak + veredict) ───────────────────────────────

/** Conta dias consecutivos olhando pra trás (incluindo hoje) com >=1 record. */
function calcStreak(records: Array<{ data: string }>): number {
  if (records.length === 0) return 0
  const dates = new Set(records.map((r) => r.data))
  const days = lastNDays(60)
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

/**
 * Deriva veredict + cor + glow do domínio baseado no estado atual.
 *
 * Hierarquia (mais específico → mais geral):
 *   STREAK LOCKED   → streak ≥ 7 dias
 *   STREAK STEADY   → streak 3-6 dias
 *   STREAK BUILDING → streak 1-2 dias
 *   SIGNAL ACTIVE   → records 7d > 0 mas streak quebrou
 *   DRIFT DETECTED  → 30d > 0 mas 7d = 0
 *   NO RECENT SIGNAL → sem records nos últimos 30d
 *
 * Cor: cor do domínio quando ativo, accent vivid quando drift/no-signal.
 */
function deriveDomainVeredict({
  streak,
  records7d,
  records30d,
  cor,
}: {
  streak: number
  records7d: number
  records30d: number
  cor: string
}): { headline: string; headlineColor: string; glow: string; hint: string } {
  if (streak >= 7) {
    return {
      headline: 'STREAK LOCKED',
      headlineColor: 'var(--color-success)',
      glow: '0 0 24px rgba(110, 167, 122, 0.40)',
      hint: `// ${streak} DIAS CONSECUTIVOS · MANTENHA O RITMO`,
    }
  }
  if (streak >= 3) {
    return {
      headline: 'STREAK STEADY',
      headlineColor: cor,
      glow: `0 0 22px ${cor}66`,
      hint: `// ${streak} DIAS CONSECUTIVOS · CONSTRUINDO`,
    }
  }
  if (streak >= 1) {
    return {
      headline: 'STREAK BUILDING',
      headlineColor: cor,
      glow: `0 0 20px ${cor}40`,
      hint: `// ${streak} DIA${streak === 1 ? '' : 'S'} · INICIANDO ESTABILIDADE`,
    }
  }
  if (records7d > 0) {
    return {
      headline: 'SIGNAL ACTIVE',
      headlineColor: 'var(--color-ice-light)',
      glow: '0 0 22px var(--color-ice-glow)',
      hint: `// ${records7d} REGISTRO${records7d === 1 ? '' : 'S'} NOS ÚLTIMOS 7D · STREAK QUEBRADO`,
    }
  }
  if (records30d > 0) {
    return {
      headline: 'DRIFT DETECTED',
      headlineColor: 'var(--color-warning)',
      glow: '0 0 22px rgba(192, 138, 58, 0.35)',
      hint: '// SEM REGISTROS NOS ÚLTIMOS 7D · REATIVAR OBSERVAÇÃO',
    }
  }
  return {
    headline: 'NO RECENT SIGNAL',
    headlineColor: 'var(--color-accent-vivid)',
    glow: '0 0 24px rgba(184, 58, 58, 0.40)',
    hint: '// SEM REGISTROS EM 30D · DOMÍNIO DORMENTE',
  }
}
