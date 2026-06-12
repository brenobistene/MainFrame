/**
 * Lang Lab · MAIN — dashboard de observação (métricas + evolução).
 * Doc: docs/lang-lab/PLAN.md §8-9. Fatos, sem quota: a meta diária
 * aparece como referência discreta, nunca como fração de cobrança.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Plus } from 'lucide-react'

import { fetchLangMetricsSummary } from '../../api'
import { TechLabel } from '../../components/ui/CyberShell'
import {
  useCreateLangCard,
  useLangSettings,
  useLangToday,
} from '../../lib/lang-queries'
import type { LangMetricsSummary } from '../../types'

function StatBlock({ label, value, suffix }: { label: string; value: number | string; suffix?: string }) {
  return (
    <div style={{
      flex: '1 1 130px',
      border: '1px solid var(--color-ice-deep)',
      background: 'rgba(8, 12, 18, 0.55)',
      padding: '14px 18px',
      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
        letterSpacing: '0.22em', textTransform: 'uppercase',
        color: 'var(--color-text-muted)', marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
        fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1,
      }}>
        {value}
        {suffix && <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 4 }}>{suffix}</span>}
      </div>
    </div>
  )
}

/** Heatmap 30d — reviews (ice) + pieces (âmbar) por dia, opacidade por
 *  densidade. Observação da textura real, não streak-troféu. */
function Heatmap30d({ data }: { data: LangMetricsSummary['heatmap'] }) {
  const max = Math.max(1, ...data.map(d => d.reviews + d.pieces))
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {data.map(d => {
        const total = d.reviews + d.pieces
        const op = total === 0 ? 0.12 : 0.25 + 0.75 * (total / max)
        const cor = d.pieces > 0 ? 'var(--color-warning)' : 'var(--color-ice)'
        return (
          <div
            key={d.date}
            title={`${d.date.split('-').reverse().slice(0, 2).join('/')} · ${d.reviews} reviews${d.pieces ? ` · ${d.pieces} produções` : ''}`}
            style={{
              width: 16, height: 16,
              background: total === 0 ? 'rgba(143, 191, 211, 0.10)' : cor,
              opacity: op,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
            }}
          />
        )
      })}
    </div>
  )
}

export function LangMainPage() {
  const navigate = useNavigate()
  const { data: today } = useLangToday()
  const { data: settings } = useLangSettings()
  const createCard = useCreateLangCard()
  const [metrics, setMetrics] = useState<LangMetricsSummary | null>(null)
  const [frente, setFrente] = useState('')
  const [verso, setVerso] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    fetchLangMetricsSummary().then(setMetrics).catch(() => setMetrics(null))
  }, [today?.reviews_hoje])

  async function handleQuickAdd() {
    const f = frente.trim()
    if (!f) return
    setFeedback(null)
    try {
      await createCard.mutateAsync({ frente: f, verso: verso.trim() || null })
      setFrente(''); setVerso('')
      setFeedback('card criado · áudio gerado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setFeedback(msg.includes('409') ? 'card com essa frase já existe' : 'falha ao criar card')
    }
  }

  const fila = (today?.due ?? 0) + (today?.novos_disponiveis ?? 0)
  const ret = metrics?.retencao_30d

  return (
    <div style={{ maxWidth: 980 }}>
      {today?.dias_sem_estudo != null && (
        <div style={{ marginBottom: 16 }}>
          <TechLabel color="var(--color-warning)">
            SEM ESTUDO HÁ {today.dias_sem_estudo} DIAS
          </TechLabel>
        </div>
      )}

      {/* Hoje */}
      <div style={{ marginBottom: 10 }}><TechLabel>HOJE</TechLabel></div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <StatBlock label="DUE AGORA" value={today?.due ?? '—'} />
        <StatBlock label="NOVOS" value={today?.novos_disponiveis ?? '—'} />
        <StatBlock label="REVIEWS" value={today?.reviews_hoje ?? '—'} />
        <StatBlock label="TEMPO" value={today?.tempo_hoje_min ?? '—'} suffix="min" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 30 }}>
        <button
          type="button"
          className="hq-btn hq-btn--primary"
          onClick={() => navigate('/lang/exec')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px' }}
        >
          <Play size={14} strokeWidth={2} />
          <span style={{ fontWeight: 600, letterSpacing: '0.08em' }}>ESTUDAR AGORA</span>
        </button>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
          letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--color-text-muted)',
        }}>
          {fila > 0 ? `${fila} NA FILA` : 'FILA LIMPA'} · REF {today?.daily_goal_min ?? settings?.daily_goal_min ?? '—'} MIN/DIA
        </span>
      </div>

      {/* Evolução 30d */}
      <div style={{ marginBottom: 10 }}><TechLabel>EVOLUÇÃO · 30D</TechLabel></div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <StatBlock label="TEMPO 30D" value={metrics?.tempo_30d_min ?? '—'} suffix="min" />
        <StatBlock label="REVIEWS 30D" value={metrics?.reviews_30d ?? '—'} />
        <StatBlock
          label="RETENÇÃO"
          value={ret == null ? '—' : Math.round(ret * 100)}
          suffix={ret == null ? undefined : '%'}
        />
        <StatBlock label="DIAS SEGUIDOS" value={metrics?.streak_dias ?? '—'} />
        <StatBlock label="ACERVO" value={metrics?.cards_total ?? '—'} />
        <StatBlock label="MADUROS" value={metrics?.cards_maduros ?? '—'} />
        <StatBlock label="PRODUÇÕES 30D" value={metrics?.pieces_30d ?? '—'} />
      </div>
      {metrics && (
        <div style={{ marginBottom: 32 }}>
          <Heatmap30d data={metrics.heatmap} />
        </div>
      )}

      {/* Quick-add */}
      <div style={{ marginBottom: 10 }}><TechLabel>NOVO CARD</TechLabel></div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', maxWidth: 760 }}>
        <input
          value={frente}
          onChange={e => setFrente(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd() }}
          placeholder="frase em inglês (frente)"
          autoComplete="off"
          style={{
            flex: '2 1 280px', background: 'rgba(8, 12, 18, 0.55)',
            border: '1px solid var(--color-border)', color: 'var(--color-ice-light)',
            fontFamily: 'var(--font-mono)', fontSize: 12, padding: '9px 12px',
            outline: 'none', letterSpacing: '0.03em', borderRadius: 0,
          }}
        />
        <input
          value={verso}
          onChange={e => setVerso(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd() }}
          placeholder="tradução / nota (opcional)"
          autoComplete="off"
          style={{
            flex: '1 1 200px', background: 'rgba(8, 12, 18, 0.55)',
            border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-mono)', fontSize: 12, padding: '9px 12px',
            outline: 'none', letterSpacing: '0.03em', borderRadius: 0,
          }}
        />
        <button
          type="button"
          className="hq-btn hq-btn--ghost"
          onClick={handleQuickAdd}
          disabled={createCard.isPending || !frente.trim()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Plus size={13} strokeWidth={2} />
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>
            {createCard.isPending ? 'CRIANDO…' : 'CARD'}
          </span>
        </button>
      </div>
      {feedback && (
        <div style={{
          marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 10,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: feedback.includes('já existe') || feedback.includes('falha')
            ? 'var(--color-warning)' : 'var(--color-success-light)',
        }}>
          // {feedback}
        </div>
      )}
    </div>
  )
}
