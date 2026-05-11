/**
 * Freelas — diferencial Hub Finance vs Organizze.
 *
 * Layout pensado pra responder "como tá indo meu freela?":
 * - Hero: R$/hora médio (real + estimado) + agregados (recebido/acordado/horas)
 * - Pipeline: próximos recebimentos (parcelas pendentes próximas)
 * - 2 colunas: Projetos ativos (cards detalhados) | Clientes (lista compacta)
 *
 * Comparação visual de cada projeto vs média histórica (↑/↓) ajuda a
 * decidir precificação de novos projetos.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, TrendingDown, TrendingUp } from 'lucide-react'
import { useHubFinance } from './HubFinanceContext'
import { ClientsManagerModal } from './components/ClientsManagerModal'
import { formatBRL } from './components/styleHelpers'
import { MonthPicker } from './components/MonthPicker'
import { Card } from '../../components/ui/Primitives'
import { SkeletonStatCard, SkeletonRow, SkeletonCardGrid } from '../../components/ui/Motion'

// Helpers visuais reutilizados nos 4 cards da página — extraídos pra evitar
// repetir markup do header com gradient + hairline em cada um.
const cardWrap: React.CSSProperties = {
  animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
}

function CardHairline() {
  return <div className="hq-hairline-ice" />
}

const headerWithGradient: React.CSSProperties = {
  padding: 'var(--space-5) var(--space-6) var(--space-4)',
  background: `
    radial-gradient(ellipse 100% 80% at 0% 0%, rgba(143, 191, 211, 0.05), transparent 60%),
    radial-gradient(ellipse 60% 80% at 100% 0%, rgba(50, 62, 73, 0.20), transparent 65%),
    linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
  `,
  borderBottom: '1px solid var(--color-ice-deep)',
}

const cardBody: React.CSSProperties = {
  padding: 'var(--space-5) var(--space-6)',
}

/** Tab marker semantic + // LABEL [NN] mono — padrão consistente
 *  com VisaoGeral / Carteira / Fixas / Dividas. */
function CardHeaderTab({
  label, count, accent = 'var(--color-ice)', glow = 'var(--color-ice-glow)',
}: {
  label: string
  count?: number
  accent?: string
  glow?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        width: 3, height: 14,
        background: accent,
        boxShadow: `0 0 8px ${glow}`,
        flexShrink: 0,
      }} />
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9, fontWeight: 700,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.22em', textTransform: 'uppercase',
      }}>
        <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
        {label}{count != null && ` [${count.toString().padStart(2, '0')}]`}
      </span>
    </div>
  )
}
import type { FinFreelaProject, FinHourlyRateStats, FinClient } from '../../types'

export function FreelasPage() {
  const {
    freelaProjects, hourlyStats, clients, selectedMonth, setSelectedMonth,
    refreshGlobal, loading,
  } = useHubFinance()
  const [showClientsManager, setShowClientsManager] = useState(false)

  // IMPORTANTE: useMemo ANTES do early return de loading. Se você mover
  // o `if (loading) return` pra cima, React quebra com "Rules of Hooks
  // violation" — quando loading vai de true→false, ordem dos hooks muda
  // e a árvore inteira crasha (tela preta).
  //
  // Pipeline reage ao MÊS SELECIONADO: parcelas previstas dentro do mês.
  // Sem parcelas com data → mostra todas pendentes (fallback).
  const pipelineDoMes = useMemo(() => {
    const monthStart = `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}-01`
    const lastDay = new Date(selectedMonth.year, selectedMonth.month, 0).getDate()
    const monthEnd = `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    return freelaProjects
      .filter(p => p.proxima_parcela)
      .map(p => ({ projeto: p, parcela: p.proxima_parcela! }))
      .filter(({ parcela }) =>
        !parcela.data_prevista
        || (parcela.data_prevista >= monthStart && parcela.data_prevista <= monthEnd)
      )
      .sort((a, b) => (a.parcela.data_prevista ?? 'z').localeCompare(b.parcela.data_prevista ?? 'z'))
  }, [freelaProjects, selectedMonth.year, selectedMonth.month])

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div className="hq-glass" style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <SkeletonStatCard labelWidth={120} numberWidth={200} />
        <SkeletonCardGrid count={2} height={80} />
      </div>
      <div className="hq-glass" style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    </div>
  )

  const ativos = freelaProjects.filter(p => p.status === 'doing' || p.status === 'pending')

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 24,
      animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
    }}>
      {/* Header com MonthPicker — sincroniza com Visão Geral e Lançamentos.
          O hourlyStats e a lista de projetos ativos NÃO filtram por mês
          (são agregados globais e estado vivo). Só o pipeline reage. */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <CardHeaderTab label="FREELAS" count={ativos.length} />
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.18em', textTransform: 'uppercase',
            opacity: 0.75,
          }}>
            PIPELINE FILTRA POR MÊS · STATS E ATIVOS SÃO GLOBAIS
          </div>
        </div>
        <MonthPicker selectedMonth={selectedMonth} onChange={setSelectedMonth} />
      </div>

      <Hero stats={hourlyStats} projetos={freelaProjects} />

      <PipelineRecebimentos itens={pipelineDoMes} mes={selectedMonth} />

      <div style={twoColumns}>
        <ProjetosAtivos projetos={ativos} hourlyStats={hourlyStats} />
        <ClientesSidebar
          clients={clients}
          projetos={freelaProjects}
          onManage={() => setShowClientsManager(true)}
        />
      </div>

      {showClientsManager && (
        <ClientsManagerModal
          onClose={() => setShowClientsManager(false)}
          onChanged={refreshGlobal}
        />
      )}
    </div>
  )
}

// ─── Layout helper ───────────────────────────────────────────────────────

const twoColumns: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
  gap: 16,
}

// ─── Hero: R$/hora médio ────────────────────────────────────────────────

function Hero({ stats, projetos }: {
  stats: FinHourlyRateStats | null
  projetos: FinFreelaProject[]
}) {
  const hasData = !!stats && (stats.media_real_brl_h != null || stats.media_estimada_brl_h != null)

  // Totais agregados de TODOS os projetos freela (não só os que entram na média).
  const totalRecebido = projetos.reduce((s, p) => s + p.valor_pago, 0)
  const totalAcordado = projetos.reduce((s, p) => s + (p.valor_acordado ?? 0), 0)
  const totalHoras = projetos.reduce((s, p) => s + p.horas_trabalhadas, 0)

  return (
    <Card padding="none" style={cardWrap}>
      <CardHairline />
      <div style={headerWithGradient}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <CardHeaderTab label="HOURLY.RATE" />
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.18em', textTransform: 'uppercase',
            opacity: 0.7,
          }}>
            BASELINE · PRECIFICAR PRÓXIMOS PROJETOS
          </div>
        </div>
      </div>
      <div style={cardBody}>

      {!hasData ? (
        <div style={{
          padding: '14px 16px',
          border: '1px dashed rgba(143, 191, 211, 0.30)',
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10, fontWeight: 700,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.18em', textTransform: 'uppercase',
          lineHeight: 1.7,
        }}>
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
          AINDA SEM DADOS · CRIE PROJETO DA ÁREA "FREELAS" COM VALOR ACORDADO + SESSÕES
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
            marginBottom: 14,
          }}>
            <RateCard
              label="REAL · RECEBIDO"
              value={stats!.media_real_brl_h}
              accent="var(--color-success-light)"
              accentGlow="rgba(125, 154, 111, 0.40)"
              footer={stats!.media_real_brl_h != null
                ? `${formatBRL(stats!.valor_recebido_total)} · ${fmtH(stats!.horas_totais_real)} · ${stats!.projetos_considerados_real.toString().padStart(2, '0')} PROJ`
                : 'SEM RECEBIMENTOS VINCULADOS'}
            />
            <RateCard
              label="ESTIMADO · ACORDADO"
              value={stats!.media_estimada_brl_h}
              accent="var(--color-ice-light)"
              accentGlow="var(--color-ice-glow)"
              footer={stats!.media_estimada_brl_h != null
                ? `${formatBRL(stats!.valor_acordado_total)} · ${fmtH(stats!.horas_totais_estim)} · ${stats!.projetos_considerados_estim.toString().padStart(2, '0')} PROJ`
                : 'SEM VALOR ACORDADO'}
            />
          </div>

          {/* Sub-stats agregados de TODOS os projetos */}
          <div style={{
            paddingTop: 14,
            borderTop: '1px solid var(--color-ice-deep)',
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16,
          }}>
            <SubStat label="TOTAL.RCB" value={formatBRL(totalRecebido)} color="var(--color-success-light)" />
            <SubStat label="TOTAL.ACORDO" value={formatBRL(totalAcordado)} color="var(--color-text-primary)" />
            <SubStat label="TOTAL.HORAS" value={fmtH(totalHoras)} color="var(--color-text-primary)" />
          </div>

          {stats!.media_real_brl_h != null && stats!.media_estimada_brl_h != null
            && stats!.media_real_brl_h < stats!.media_estimada_brl_h && (
            <div style={{
              marginTop: 12,
              padding: '8px 12px',
              background: 'rgba(159, 18, 57, 0.06)',
              border: '1px solid rgba(159, 18, 57, 0.22)',
              borderLeft: '2px solid var(--color-accent-primary)',
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              color: 'var(--color-accent-light)',
              letterSpacing: '0.18em', textTransform: 'uppercase',
              lineHeight: 1.6,
            }}>
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              ALERTA · REAL ABAIXO DO ESTIMADO · USE REAL PRA ORÇAR
            </div>
          )}
        </>
      )}
      </div>
    </Card>
  )
}

function RateCard({ label, value, accent, accentGlow, footer }: {
  label: string
  value: number | null
  accent: string
  accentGlow: string
  footer: string
}) {
  return (
    <div style={{
      padding: '14px 16px',
      background: 'rgba(8, 12, 18, 0.55)',
      border: '1px solid rgba(143, 191, 211, 0.22)',
      borderLeft: `2px solid ${accent}`,
      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9, fontWeight: 700,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.22em', textTransform: 'uppercase',
      }}>
        <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
        {label}
      </div>
      <div className="hq-money" style={{
        fontSize: 24, fontWeight: 700, marginTop: 8,
        color: value != null ? accent : 'var(--color-text-muted)',
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-0.02em',
        textShadow: value != null ? `0 0 18px ${accentGlow}` : 'none',
      }}>
        {value != null ? `${formatBRL(value)}/h` : '—'}
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9, fontWeight: 700,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.15em', textTransform: 'uppercase',
        marginTop: 6,
      }}>
        {footer}
      </div>
    </div>
  )
}

function SubStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9, fontWeight: 700,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.22em', textTransform: 'uppercase',
        marginBottom: 4,
      }}>
        <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
        {label}
      </div>
      <div className="hq-money" style={{
        fontSize: 13, fontWeight: 700, color,
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
    </div>
  )
}

// ─── Pipeline próximos recebimentos ─────────────────────────────────────

function PipelineRecebimentos({ itens, mes }: {
  itens: { projeto: FinFreelaProject; parcela: NonNullable<FinFreelaProject['proxima_parcela']> }[]
  mes: { year: number; month: number }
}) {
  const total = itens.reduce((s, i) => s + i.parcela.valor, 0)
  const monthsPt = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const mesLabel = `${monthsPt[mes.month - 1]}/${String(mes.year).slice(2)}`

  return (
    <Card padding="none" style={cardWrap}>
      <CardHairline />
      <div style={headerWithGradient}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <CardHeaderTab
            label={`PIPELINE.RCB · ${mesLabel.toUpperCase()}`}
            count={itens.length}
            accent="var(--color-success-light)"
            glow="rgba(125, 154, 111, 0.55)"
          />
          {itens.length > 0 && (
            <>
              <div style={{ flex: 1 }} />
              <div className="hq-money" style={{
                fontSize: 14, fontWeight: 700,
                color: 'var(--color-success-light)',
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
                textShadow: '0 0 12px rgba(125, 154, 111, 0.40)',
              }}>
                {formatBRL(total)}
              </div>
            </>
          )}
        </div>
      </div>
      <div style={cardBody}>

      {itens.length === 0 ? (
        <div style={{
          padding: '14px 16px',
          border: '1px dashed rgba(143, 191, 211, 0.30)',
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10, fontWeight: 700,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.18em', textTransform: 'uppercase',
          lineHeight: 1.7,
        }}>
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
          NENHUM RECEBIMENTO EM {mesLabel.toUpperCase()} · CADASTRE PARCELAS NOS PROJETOS
        </div>
      ) : (
        <div className="hq-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {itens.map(({ projeto, parcela }, i) => (
            <div
              key={parcela.id}
              className="hq-animate-fade-up"
              style={{
                display: 'grid', gridTemplateColumns: '1fr 110px 110px',
                gap: 12, alignItems: 'center', padding: '10px 14px',
                background: 'rgba(8, 12, 18, 0.55)',
                border: '1px solid rgba(143, 191, 211, 0.22)',
                borderLeft: '2px solid var(--color-success-light)',
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
                transition: 'transform 0.18s var(--ease-emphasis), box-shadow 0.18s, border-color 0.18s',
                ['--stagger-i' as any]: i,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateX(2px)'
                e.currentTarget.style.boxShadow = '0 0 14px rgba(125, 154, 111, 0.18)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateX(0)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 6, height: 6,
                  background: 'var(--color-success-light)',
                  boxShadow: '0 0 6px rgba(125, 154, 111, 0.55)',
                  flexShrink: 0,
                  opacity: 0.95,
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, color: 'var(--color-text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {projeto.title} <span style={{
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text-muted)',
                      fontSize: 10,
                      letterSpacing: '0.1em',
                    }}>· P{parcela.numero.toString().padStart(2, '0')}</span>
                  </div>
                  {projeto.cliente_nome && (
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9, fontWeight: 700,
                      color: 'var(--color-text-muted)',
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                      marginTop: 2,
                    }}>
                      {projeto.cliente_nome}
                    </div>
                  )}
                </div>
              </div>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-text-tertiary)',
                letterSpacing: '0.15em', textTransform: 'uppercase',
              }}>
                {parcela.data_prevista
                  ? parcela.data_prevista.split('-').reverse().slice(0, 2).join('/')
                  : 'SEM DATA'}
              </span>
              <span className="hq-money" style={{
                fontSize: 13, fontWeight: 600, textAlign: 'right',
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--color-success-light)',
              }}>
                {formatBRL(parcela.valor)}
              </span>
            </div>
          ))}
        </div>
      )}
      </div>
    </Card>
  )
}

// ─── Projetos ativos ────────────────────────────────────────────────────

function ProjetosAtivos({ projetos, hourlyStats }: {
  projetos: FinFreelaProject[]
  hourlyStats: FinHourlyRateStats | null
}) {
  return (
    <Card padding="none" style={cardWrap}>
      <CardHairline />
      <div style={headerWithGradient}>
        <CardHeaderTab label="PROJETOS.ATIVOS" count={projetos.length} />
      </div>
      <div style={cardBody}>

      {projetos.length === 0 ? (
        <div style={{
          padding: '14px 16px',
          border: '1px dashed rgba(143, 191, 211, 0.30)',
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10, fontWeight: 700,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.18em', textTransform: 'uppercase',
          lineHeight: 1.7,
        }}>
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
          NENHUM PROJETO FREELA ATIVO · CRIE PROJETO NA ÁREA "FREELAS" COM VALOR ACORDADO
        </div>
      ) : (
        <div className="hq-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {projetos.map((p, i) => (
            <div
              key={p.id}
              className="hq-animate-fade-up"
              style={{ ['--stagger-i' as any]: i }}
            >
              <ProjectCard projeto={p} hourlyStats={hourlyStats} />
            </div>
          ))}
        </div>
      )}
      </div>
    </Card>
  )
}

function ProjectCard({ projeto: p, hourlyStats }: {
  projeto: FinFreelaProject
  hourlyStats: FinHourlyRateStats | null
}) {
  const navigate = useNavigate()
  const progresso = (p.valor_acordado ?? 0) > 0
    ? Math.min(100, (p.valor_pago / p.valor_acordado!) * 100)
    : 0

  // Comparação contra média
  const projetoRate = p.hourly_real ?? p.hourly_estimado
  const mediaRate = p.hourly_real != null
    ? hourlyStats?.media_real_brl_h
    : hourlyStats?.media_estimada_brl_h
  const tipoRate = p.hourly_real != null ? 'real' : 'estimado'
  const showCompare = projetoRate != null && mediaRate != null
  const diff = showCompare ? projetoRate - mediaRate! : 0
  const acimaMedia = diff >= 0

  function openInHubQuest() {
    // Persiste no localStorage (bootstrap do App.tsx) E dispara evento custom
    // pra atualizar o estado React do selectedProjectId que já está montado.
    // App.tsx tem listener pro evento que faz setSelectedProjectId.
    try {
      const nav = JSON.parse(localStorage.getItem('hq-navigation') || '{}')
      nav.projectId = p.id
      localStorage.setItem('hq-navigation', JSON.stringify(nav))
    } catch {}
    window.dispatchEvent(new CustomEvent('hq-select-project', { detail: { projectId: p.id } }))
    // Esta página lista projetos da área "freelas" — fallback seguro.
    navigate('/areas/freelas')
  }

  // Border-left semantic baseado no progresso (consistente com Dividas):
  // olive-light se quase entregue (>=75%), ice-light se andou (>=30%),
  // ice-deep se cedo.
  const accentColor = progresso >= 75
    ? 'var(--color-success-light)'
    : progresso >= 30
      ? 'var(--color-ice-light)'
      : 'var(--color-ice-deep)'
  const accentGlow = progresso >= 75
    ? 'rgba(125, 154, 111, 0.40)'
    : 'var(--color-ice-glow)'

  return (
    <div
      style={{
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid rgba(143, 191, 211, 0.22)',
        borderLeft: `2px solid ${accentColor}`,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
        padding: '14px 16px',
        transition: 'transform 0.18s var(--ease-emphasis), box-shadow 0.18s, border-color 0.18s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateX(2px)'
        e.currentTarget.style.boxShadow = `0 0 16px ${accentGlow}`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateX(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{
            width: 6, height: 6,
            background: accentColor,
            boxShadow: `0 0 6px ${accentGlow}`,
            flexShrink: 0,
            marginTop: 6,
            opacity: 0.95,
          }} />
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)',
            }}>
              {p.title}
            </div>
            {p.cliente_nome && (
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.22em', textTransform: 'uppercase',
                marginTop: 3,
              }}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                {p.cliente_nome}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={openInHubQuest}
          title="abrir projeto no Hub Quest"
          style={{
            background: 'rgba(8, 12, 18, 0.55)',
            border: '1px solid var(--color-border)',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
            padding: '4px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            letterSpacing: '0.22em', textTransform: 'uppercase',
            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            whiteSpace: 'nowrap',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = 'var(--color-ice-light)'
            e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
            e.currentTarget.style.boxShadow = '0 0 8px rgba(143, 191, 211, 0.20)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--color-text-muted)'
            e.currentTarget.style.borderColor = 'var(--color-border)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        >
          ABRIR
          <ExternalLink size={10} strokeWidth={2} />
        </button>
      </div>

      {/* R$/hora + comparação */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14,
        marginTop: 14,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
            marginBottom: 4,
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            R$/H ESTIM
          </div>
          <div className="hq-money" style={{
            fontSize: 14, fontWeight: 700,
            color: p.hourly_estimado != null ? 'var(--color-ice-light)' : 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {p.hourly_estimado != null ? `${formatBRL(p.hourly_estimado)}/h` : '—'}
          </div>
        </div>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
            marginBottom: 4,
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            R$/H REAL
          </div>
          <div className="hq-money" style={{
            fontSize: 14, fontWeight: 700,
            color: p.hourly_real != null ? 'var(--color-success-light)' : 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {p.hourly_real != null ? `${formatBRL(p.hourly_real)}/h` : '—'}
          </div>
        </div>
      </div>

      {showCompare && (
        <div style={{
          marginTop: 10,
          fontFamily: 'var(--font-mono)',
          fontSize: 9, fontWeight: 700,
          letterSpacing: '0.18em', textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: 6,
          color: acimaMedia ? 'var(--color-success-light)' : 'var(--color-accent-light)',
        }}>
          {acimaMedia ? <TrendingUp size={11} strokeWidth={2} /> : <TrendingDown size={11} strokeWidth={2} />}
          <span>
            {formatBRL(Math.abs(diff))}/H {acimaMedia ? 'ACIMA' : 'ABAIXO'}
          </span>
          <span style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
            · MED {tipoRate.toUpperCase()}
          </span>
        </div>
      )}

      {/* Recebido / a receber + 10-segment progress */}
      {p.valor_acordado != null && (
        <div style={{
          marginTop: 14, paddingTop: 12,
          borderTop: '1px solid var(--color-ice-deep)',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            marginBottom: 8,
          }}>
            <span className="hq-money" style={{
              fontSize: 13, fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--color-success-light)',
              textShadow: '0 0 10px rgba(125, 154, 111, 0.30)',
            }}>
              {formatBRL(p.valor_pago)}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.18em', textTransform: 'uppercase',
            }}>
              DE <span className="hq-money" style={{ color: 'var(--color-text-secondary)' }}>{formatBRL(p.valor_acordado)}</span> · {progresso.toFixed(0)}%
            </span>
          </div>
          <ProjectSegmentedProgress value={progresso} />
          {p.parcelas_total > 0 && (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.18em', textTransform: 'uppercase',
              marginTop: 8,
              lineHeight: 1.6,
            }}>
              {p.parcelas_pagas.toString().padStart(2, '0')}/{p.parcelas_total.toString().padStart(2, '0')} PARC PG
              {p.proxima_parcela && (
                <>
                  {' · NEXT '}
                  <span className="hq-money" style={{ color: 'var(--color-ice-light)' }}>
                    {formatBRL(p.proxima_parcela.valor)}
                  </span>
                  {p.proxima_parcela.data_prevista && (
                    <> · {p.proxima_parcela.data_prevista.split('-').reverse().slice(0, 2).join('/')}</>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 10-segment cyber progress pra ProjectCard. */
function ProjectSegmentedProgress({ value }: { value: number }) {
  const segments = 10
  const filled = Math.round((value / 100) * segments)
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 6,
            background: i < filled ? 'var(--color-success-light)' : 'rgba(143, 191, 211, 0.10)',
            border: i < filled
              ? '1px solid transparent'
              : '1px solid rgba(143, 191, 211, 0.18)',
            boxShadow: i < filled ? '0 0 6px rgba(125, 154, 111, 0.35)' : 'none',
            transition: 'background 0.3s, box-shadow 0.3s',
          }}
        />
      ))}
    </div>
  )
}

// ─── Sidebar de clientes ────────────────────────────────────────────────

function ClientesSidebar({ clients, projetos, onManage }: {
  clients: FinClient[]
  projetos: FinFreelaProject[]
  onManage: () => void
}) {
  // Conta projetos por cliente
  const projetosPorCliente = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of projetos) {
      if (p.cliente_id) map.set(p.cliente_id, (map.get(p.cliente_id) ?? 0) + 1)
    }
    return map
  }, [projetos])

  return (
    <Card padding="none" style={cardWrap}>
      <CardHairline />
      <div style={headerWithGradient}>
        <CardHeaderTab label="CLIENTES" count={clients.length} />
      </div>
      <div style={cardBody}>

      {clients.length === 0 ? (
        <div style={{
          padding: '14px 16px',
          border: '1px dashed rgba(143, 191, 211, 0.30)',
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10, fontWeight: 700,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.18em', textTransform: 'uppercase',
          lineHeight: 1.7,
        }}>
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
          NENHUM CLIENTE · CADASTRE COM CPF/CNPJ PRA AUTO-VÍNCULO
        </div>
      ) : (
        <div className="hq-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {clients.slice(0, 8).map((c, i) => {
            const count = projetosPorCliente.get(c.id) ?? 0
            const hasProjects = count > 0
            return (
              <div
                key={c.id}
                className="hq-animate-fade-up"
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  background: 'rgba(8, 12, 18, 0.55)',
                  border: '1px solid rgba(143, 191, 211, 0.22)',
                  borderLeft: hasProjects
                    ? '2px solid var(--color-ice-light)'
                    : '2px solid var(--color-ice-deep)',
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                  ['--stagger-i' as any]: i,
                  transition: 'transform 0.18s var(--ease-emphasis), box-shadow 0.18s, border-color 0.18s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translateX(2px)'
                  e.currentTarget.style.boxShadow = '0 0 12px rgba(143, 191, 211, 0.10)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'translateX(0)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {c.nome}
                  </div>
                  {c.cpf_cnpj && (
                    <div style={{
                      fontSize: 9, fontWeight: 700,
                      color: 'var(--color-text-muted)',
                      fontFamily: 'var(--font-mono)',
                      letterSpacing: '0.05em',
                      marginTop: 2,
                    }}>
                      {c.cpf_cnpj}
                    </div>
                  )}
                </div>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: hasProjects ? 'var(--color-ice-light)' : 'var(--color-text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.18em',
                  flexShrink: 0,
                }}>
                  {count.toString().padStart(2, '0')} PROJ
                </span>
              </div>
            )
          })}
          {clients.length > 8 && (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.22em', textTransform: 'uppercase',
              textAlign: 'center', marginTop: 6,
            }}>
              + {(clients.length - 8).toString().padStart(2, '0')} CLIENTES
            </div>
          )}
        </div>
      )}

      </div>
      {/* Footer-action button cyber-mono */}
      <button
        onClick={onManage}
        style={{
          width: '100%',
          background: 'rgba(143, 191, 211, 0.04)',
          border: 'none',
          borderTop: '1px solid var(--color-ice-deep)',
          padding: 'var(--space-3) var(--space-6)',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10, fontWeight: 700,
          letterSpacing: '0.22em', textTransform: 'uppercase',
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          transition: 'background 0.18s, color 0.18s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
          e.currentTarget.style.color = 'var(--color-ice-light)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'rgba(143, 191, 211, 0.04)'
          e.currentTarget.style.color = 'var(--color-text-muted)'
        }}
      >
        <span style={{ color: 'var(--color-ice)', opacity: 0.85, letterSpacing: 0 }}>//</span>
        GERENCIAR CLIENTES
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>→</span>
      </button>
    </Card>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────

function fmtH(h: number): string {
  const totalMin = Math.round(h * 60)
  const hh = Math.floor(totalMin / 60)
  const mm = totalMin % 60
  if (hh === 0) return `${mm}min`
  if (mm === 0) return `${hh}h`
  return `${hh}h ${mm}m`
}
