/**
 * Lang Lab · MAIN — dashboard de observação (métricas + evolução).
 * Doc: docs/lang-lab/PLAN.md §8-9. Fatos, sem quota: a meta diária
 * aparece como referência discreta, nunca como fração de cobrança.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Plus, Sparkles } from 'lucide-react'

import {
  analyzeLangToday,
  fetchLangAiStatus,
  fetchLangAnalyses,
  fetchLangMetricsSummary,
  reportApiError,
} from '../../api'
import { TechLabel } from '../../components/ui/CyberShell'
import {
  useCreateLangCard,
  useLangSettings,
  useLangToday,
} from '../../lib/lang-queries'
import type { LangAnalysis, LangMetricsSummary } from '../../types'

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
  const [aiOn, setAiOn] = useState(false)
  const [analise, setAnalise] = useState<LangAnalysis | null>(null)
  const [analisando, setAnalisando] = useState(false)
  const [analiseErro, setAnaliseErro] = useState<string | null>(null)

  useEffect(() => {
    fetchLangMetricsSummary().then(setMetrics).catch(() => setMetrics(null))
  }, [today?.reviews_hoje])

  useEffect(() => {
    fetchLangAiStatus().then(s => setAiOn(s.configured)).catch(() => setAiOn(false))
    fetchLangAnalyses(1).then(list => setAnalise(list[0] ?? null)).catch(() => undefined)
  }, [])

  async function rodarAnalise() {
    if (analisando) return
    setAnalisando(true)
    setAnaliseErro(null)
    try {
      setAnalise(await analyzeLangToday())
    } catch (err) {
      reportApiError('LangMain.analise', err)
      const msg = err instanceof Error ? err.message : ''
      setAnaliseErro(msg.includes('502') ? 'IA falhou (rate limit?) · tente de novo' : 'análise indisponível')
    } finally {
      setAnalisando(false)
    }
  }

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
  // Primeiro uso: acervo zerado. Dashboard de zeros é ruído; a página
  // recebe o operador e aponta os dois caminhos de entrada.
  const firstRun = metrics != null && metrics.cards_total === 0

  return (
    <div style={{ maxWidth: 980 }}>
      {today?.dias_sem_estudo != null && !firstRun && (
        <div style={{ marginBottom: 16 }}>
          <TechLabel color="var(--color-warning)">
            SEM ESTUDO HÁ {today.dias_sem_estudo} DIAS
          </TechLabel>
        </div>
      )}

      {/* Primeiro uso — a UI fala com o operador (Serif Reserved Rule). */}
      {firstRun && (
        <div style={{ marginBottom: 36, maxWidth: 640 }}>
          <p style={{
            fontFamily: 'Bitter, Iowan Old Style, Georgia, serif',
            fontStyle: 'italic', fontSize: 17, lineHeight: 1.7,
            color: 'var(--color-text-secondary)', margin: '0 0 14px',
          }}>
            Toda língua que você admira em alguém foi construída frase por
            frase. A sua começa com a primeira.
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.6 }}>
            Cola uma frase no campo abaixo, ou leva um texto inteiro
            (lição, transcrição, letra) pra aba <span
              onClick={() => navigate('/lang/fontes')}
              style={{ color: 'var(--color-ice-light)', cursor: 'pointer', fontWeight: 600 }}
            >FONTES</span> e minera as frases que valem.
          </p>
        </div>
      )}

      {/* Hoje */}
      {!firstRun && (
        <>
          <div style={{ marginBottom: 10 }}><TechLabel>HOJE</TechLabel></div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <StatBlock label="DUE AGORA" value={today?.due ?? '—'} />
            <StatBlock label="NOVOS" value={today?.novos_disponiveis ?? '—'} />
            <StatBlock label="REVIEWS" value={today?.reviews_hoje ?? '—'} />
            <StatBlock label="TEMPO" value={today?.tempo_hoje_min ?? '—'} suffix="min" />
          </div>
        </>
      )}
      <div style={{ display: firstRun ? 'none' : 'flex', alignItems: 'center', gap: 16, marginBottom: 30 }}>
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

      {/* Evolução 30d — observação, não ação: leitura mono quieta (hoje
          acionável ganha blocos; 30d observacional ganha texto). */}
      {metrics && !firstRun && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ marginBottom: 10 }}><TechLabel>EVOLUÇÃO · 30D</TechLabel></div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
            fontSize: 11, letterSpacing: '0.06em', lineHeight: 2,
            color: 'var(--color-text-muted)', marginBottom: 14, maxWidth: 760,
          }}>
            {[
              ['RETENÇÃO', ret == null ? null : `${Math.round(ret * 100)}%`],
              ['DIAS SEGUIDOS', metrics.streak_dias],
              ['REVIEWS', metrics.reviews_30d],
              ['TEMPO', `${metrics.tempo_30d_min}min`],
              ['ACERVO', metrics.cards_total],
              ['MADUROS', metrics.cards_maduros],
              ['PRODUÇÕES', metrics.pieces_30d],
            ].filter(([, v]) => v !== null).map(([label, value], i) => (
              <span key={String(label)} style={{ whiteSpace: 'nowrap' }}>
                {i > 0 && <span style={{ margin: '0 10px', opacity: 0.4 }}>·</span>}
                {label}{' '}
                <span style={{ color: 'var(--color-ice-light)', fontWeight: 700 }}>{String(value)}</span>
              </span>
            ))}
          </div>
          <Heatmap30d data={metrics.heatmap} />
        </div>
      )}

      {/* Análise do dia — a tutora julga o progresso COMPARANDO com as
          semanas anteriores (pedido literal). Sob demanda, nunca automática. */}
      {aiOn && !firstRun && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
            <TechLabel>ANÁLISE DO DIA</TechLabel>
            <button
              type="button"
              className="hq-btn hq-btn--ghost"
              onClick={rodarAnalise}
              disabled={analisando}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px' }}
            >
              <Sparkles size={12} strokeWidth={2} />
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em' }}>
                {analisando ? 'ANALISANDO…' : analise ? 'ANALISAR DE NOVO' : 'ANALISAR'}
              </span>
            </button>
            {analise && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)', letterSpacing: '0.12em' }}>
                {analise.date.split('-').reverse().join('/')}
              </span>
            )}
          </div>
          {analiseErro && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-warning)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              // {analiseErro}
            </div>
          )}
          {analise?.analise && (
            <div style={{
              border: '1px solid var(--color-border)',
              background: 'rgba(8, 12, 18, 0.45)',
              padding: '14px 18px',
              maxWidth: 760,
            }}>
              <p style={{ fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.6, margin: '0 0 10px' }}>
                {analise.analise.resumo}
              </p>
              {analise.analise.padroes.length > 0 && (
                <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                  {analise.analise.padroes.map((p, i) => (
                    <li key={i} style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>{p}</li>
                  ))}
                </ul>
              )}
              {analise.analise.comparacao && (
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 10px', lineHeight: 1.55 }}>
                  {analise.analise.comparacao}
                </p>
              )}
              {analise.analise.foco_sugerido && (
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.14em', textTransform: 'uppercase',
                  color: 'var(--color-ice-light)',
                }}>
                  FOCO · {analise.analise.foco_sugerido}
                </div>
              )}
            </div>
          )}
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
