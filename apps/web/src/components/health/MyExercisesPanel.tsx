/**
 * MyExercisesPanel — grid de items do domínio com stats agregados, exibido
 * no topo do /health/{slug} pra templates `atividade_tipo` (Exercício).
 *
 * Filosofia: pra atividade_tipo, o fluxo principal é "play no /dia → stop
 * cria record" — não "abrir REGISTRAR aqui". Esse painel substitui o botão
 * REGISTRAR gigante como ponto focal: mostra "o que você tem cadastrado"
 * (Cardio, Musculação, etc) + "quando foi a última vez" + "frequência 7d".
 * Click no card abre o RegisterModal já com o item selecionado, em modo
 * retroativo (pra registrar sessão sem timer).
 *
 * Stats por item (últimos 7d):
 *   - Count de records (vezes)
 *   - Soma de `payload.duracao_min` (minutos totais)
 *   - Última record (data formatada)
 *
 * Sem records nos últimos 30d: tag "sem atividade" em cor muted.
 */
import { useMemo } from 'react'
import { Clock, Plus } from 'lucide-react'

import type { HealthItem, HealthRecord } from '../../types'
import { MONO, colorForDomain } from './tokens'
import { domainIconFor } from './domainIcon'

interface ItemStats {
  count7d: number
  duracaoMin7d: number
  ultimaData: string | null   // YYYY-MM-DD da última record
  ultimaHorario: string | null  // HH:MM, opcional
  diasAtras: number | null
}

function calcItemStats(itemId: number, records: HealthRecord[]): ItemStats {
  const itemRecords = records.filter((r) => r.item_id === itemId)
  if (itemRecords.length === 0) {
    return { count7d: 0, duracaoMin7d: 0, ultimaData: null, ultimaHorario: null, diasAtras: null }
  }
  // Records dos últimos 7d (inclusivo de hoje).
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() - 6)
  const cutoffIso = cutoff.toISOString().slice(0, 10)

  const last7 = itemRecords.filter((r) => (r.data ?? '') >= cutoffIso)
  let duracaoMin7d = 0
  for (const r of last7) {
    const dur = (r.payload as { duracao_min?: unknown })?.duracao_min
    if (typeof dur === 'number') duracaoMin7d += dur
  }

  // Última record (data desc; em caso de empate, horário desc).
  const ordered = [...itemRecords].sort((a, b) => {
    const da = a.data ?? ''
    const db = b.data ?? ''
    if (da !== db) return db.localeCompare(da)
    const ha = a.horario ?? ''
    const hb = b.horario ?? ''
    return hb.localeCompare(ha)
  })
  const ultima = ordered[0]
  const ultimaData = ultima.data ?? null
  const ultimaHorario = ultima.horario ?? null

  let diasAtras: number | null = null
  if (ultimaData) {
    const last = new Date(`${ultimaData}T00:00:00`)
    last.setHours(0, 0, 0, 0)
    diasAtras = Math.round((today.getTime() - last.getTime()) / 86400000)
  }

  return { count7d: last7.length, duracaoMin7d, ultimaData, ultimaHorario, diasAtras }
}

function formatTimeAgo(stats: ItemStats): string {
  if (stats.diasAtras === null) return 'sem atividade'
  if (stats.diasAtras === 0) {
    return stats.ultimaHorario ? `hoje ${stats.ultimaHorario}` : 'hoje'
  }
  if (stats.diasAtras === 1) return 'ontem'
  if (stats.diasAtras < 7) return `${stats.diasAtras}d atrás`
  if (stats.diasAtras < 30) {
    const weeks = Math.floor(stats.diasAtras / 7)
    return `${weeks}sem atrás`
  }
  return `${stats.diasAtras}d atrás`
}

function formatDuracao(min: number): string {
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

export default function MyExercisesPanel({
  domain,
  items,
  records,
  onPickItem,
}: {
  domain: { slug: string; cor: string | null; icone: string | null; template: string }
  items: HealthItem[]
  records: HealthRecord[]
  /** Click num card abre RegisterModal com este item pré-selecionado em
   *  modo retroativo. Caller (DomainPage) que orquestra. */
  onPickItem: (itemId: number) => void
}) {
  // Só itens ativos (não arquivados) aparecem. Ordenados por última
  // atividade (mais recente primeiro) — atividade mais corrente tem mais
  // chance de ser registrada de novo.
  const activeItems = useMemo(
    () => items.filter((i) => !i.arquivado),
    [items],
  )

  const itemsWithStats = useMemo(
    () =>
      activeItems
        .map((item) => ({ item, stats: calcItemStats(item.id, records) }))
        .sort((a, b) => {
          // Items com registro recente vêm primeiro. Sem registro vai pro fim.
          if (a.stats.diasAtras === null && b.stats.diasAtras === null) return 0
          if (a.stats.diasAtras === null) return 1
          if (b.stats.diasAtras === null) return -1
          return a.stats.diasAtras - b.stats.diasAtras
        }),
    [activeItems, records],
  )

  if (activeItems.length === 0) {
    return null  // sem items, o painel não faz sentido (CTA "ITENS" cobre)
  }

  const cor = colorForDomain(domain.slug, domain.cor)

  return (
    <section style={{ marginBottom: 'var(--space-5)' }}>
      <SectionHeader label="MEUS EXERCÍCIOS" count={activeItems.length} />
      <div
        style={{
          marginTop: 'var(--space-3)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 'var(--space-2)',
        }}
      >
        {itemsWithStats.map(({ item, stats }) => (
          <ExerciseCard
            key={item.id}
            item={item}
            stats={stats}
            cor={cor}
            template={domain.template}
            onPick={() => onPickItem(item.id)}
          />
        ))}
      </div>
    </section>
  )
}

// ─── Subcomponentes ─────────────────────────────────────────────────────

function ExerciseCard({
  item,
  stats,
  cor,
  template,
  onPick,
}: {
  item: HealthItem
  stats: ItemStats
  cor: string
  template: string
  onPick: () => void
}) {
  const Icon = domainIconFor(item.cor, template)  // fallback no template
  const inativo = stats.diasAtras === null || stats.diasAtras > 14

  return (
    <button
      type="button"
      onClick={onPick}
      title="Registrar sessão deste exercício (retroativo)"
      className="hq-glass hq-row-hoverable hq-chamfer-bl"
      style={{
        position: 'relative',
        padding: '12px 14px',
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid var(--color-border)',
        borderLeft: `2px solid ${inativo ? 'var(--color-border)' : cor}`,
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontFamily: MONO,
        color: 'var(--color-text-primary)',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {/* Top — ícone + nome + botão "+" */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flexShrink: 0, display: 'inline-flex' }}>
          <Icon
            size={14}
            strokeWidth={1.8}
            color={inativo ? 'var(--color-text-tertiary)' : cor}
          />
        </span>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--color-text-primary)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.nome}
        </span>
        <Plus
          size={12}
          strokeWidth={2}
          color="var(--color-text-tertiary)"
          style={{ flexShrink: 0, opacity: 0.6 }}
        />
      </div>

      {/* Stats — última vez + count + tempo (7d) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: inativo
              ? 'var(--color-text-tertiary)'
              : stats.diasAtras === 0
                ? cor
                : 'var(--color-text-muted)',
          }}
        >
          <Clock size={10} strokeWidth={2} />
          {formatTimeAgo(stats)}
        </span>
        {stats.count7d > 0 && (
          <>
            <span style={{ color: 'var(--color-text-muted)' }}>·</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>
              {stats.count7d}×/7d
            </span>
          </>
        )}
        {stats.duracaoMin7d > 0 && (
          <>
            <span style={{ color: 'var(--color-text-muted)' }}>·</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>
              {formatDuracao(stats.duracaoMin7d)}
            </span>
          </>
        )}
      </div>
    </button>
  )
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        fontFamily: MONO,
        fontSize: 9,
        fontWeight: 700,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.25em',
        textTransform: 'uppercase',
      }}
    >
      <span style={{ color: 'var(--color-ice)', opacity: 0.85 }}>//</span>
      {label}
      <span style={{ color: 'var(--color-text-secondary)', marginLeft: 2 }}>
        [{String(count).padStart(2, '0')}]
      </span>
    </div>
  )
}
