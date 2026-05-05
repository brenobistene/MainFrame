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
import { Briefcase, Clock, ExternalLink, TrendingDown, TrendingUp, Users } from 'lucide-react'
import { useHubFinance } from './HubFinanceContext'
import { ClientsManagerModal } from './components/ClientsManagerModal'
import { formatBRL, cardLabel } from './components/styleHelpers'
import { MonthPicker } from './components/MonthPicker'
import { Card } from '../../components/ui/Primitives'

// Helpers visuais reutilizados nos 4 cards da página — extraídos pra evitar
// repetir markup do header com gradient + hairline em cada um.
const cardWrap: React.CSSProperties = {
  animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
}

function CardHairline() {
  return (
    <div style={{
      height: 1,
      background: 'linear-gradient(90deg, transparent, var(--color-accent-primary), transparent)',
      opacity: 0.5,
    }} />
  )
}

const headerWithGradient: React.CSSProperties = {
  padding: 'var(--space-5) var(--space-6) var(--space-4)',
  background: `
    radial-gradient(ellipse 100% 80% at 0% 0%, rgba(159, 18, 57, 0.06), transparent 60%),
    linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
  `,
  borderBottom: '1px solid var(--color-divider)',
}

const cardBody: React.CSSProperties = {
  padding: 'var(--space-5) var(--space-6)',
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

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>Carregando…</p>

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
        <div>
          <div style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-tertiary)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}>
            Freelas
          </div>
          <div style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            marginTop: 2,
          }}>
            pipeline filtra pelo mês · estatísticas e projetos ativos são globais
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
          <Clock size={12} strokeWidth={1.8} style={{ color: 'var(--color-text-tertiary)' }} />
          <div style={cardLabel}>Sua média de R$/hora</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            baseline pra precificar próximos projetos
          </div>
        </div>
      </div>
      <div style={cardBody}>

      {!hasData ? (
        <div style={{
          padding: '20px 16px',
          border: '1px dashed var(--color-border)', borderRadius: 4,
          textAlign: 'center', color: 'var(--color-text-muted)',
          fontSize: 11, fontStyle: 'italic', lineHeight: 1.6,
        }}>
          ainda não tem dados pra calcular sua R$/hora — você precisa de pelo menos
          um projeto da área <strong>Freelas</strong> com valor acordado e tempo trabalhado
          (sessões nas quests).
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
            marginBottom: 14,
          }}>
            <RateCard
              label="Real (recebido)"
              value={stats!.media_real_brl_h}
              accent="var(--color-success)"
              footer={stats!.media_real_brl_h != null
                ? `${formatBRL(stats!.valor_recebido_total)} em ${fmtH(stats!.horas_totais_real)} · ${stats!.projetos_considerados_real} projeto${stats!.projetos_considerados_real === 1 ? '' : 's'}`
                : 'sem recebimentos vinculados ainda'}
            />
            <RateCard
              label="Estimado (acordado)"
              value={stats!.media_estimada_brl_h}
              accent="var(--color-accent-light)"
              footer={stats!.media_estimada_brl_h != null
                ? `${formatBRL(stats!.valor_acordado_total)} em ${fmtH(stats!.horas_totais_estim)} · ${stats!.projetos_considerados_estim} projeto${stats!.projetos_considerados_estim === 1 ? '' : 's'}`
                : 'sem valor acordado preenchido'}
            />
          </div>

          {/* Sub-stats agregados de TODOS os projetos */}
          <div style={{
            paddingTop: 12,
            borderTop: '1px solid var(--color-border)',
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16,
          }}>
            <SubStat label="Total recebido" value={formatBRL(totalRecebido)} color="var(--color-success)" />
            <SubStat label="Total acordado" value={formatBRL(totalAcordado)} color="var(--color-text-primary)" />
            <SubStat label="Total horas" value={fmtH(totalHoras)} color="var(--color-text-primary)" />
          </div>

          {stats!.media_real_brl_h != null && stats!.media_estimada_brl_h != null
            && stats!.media_real_brl_h < stats!.media_estimada_brl_h && (
            <div style={{
              marginTop: 12, fontSize: 11, color: 'var(--color-text-muted)',
              fontStyle: 'italic',
            }}>
              R$/hora real está abaixo do estimado — projetos demoram mais que o
              esperado, ou ainda há valor a receber. Use a real pra orçar próximos
              trabalhos.
            </div>
          )}
        </>
      )}
      </div>
    </Card>
  )
}

function RateCard({ label, value, accent, footer }: {
  label: string; value: number | null; accent: string; footer: string
}) {
  return (
    <div style={{
      padding: '12px 14px',
      background: 'var(--color-bg-primary)',
      border: '1px solid var(--color-border)',
      borderLeft: `3px solid ${accent}`,
      borderRadius: 3,
    }}>
      <div style={{
        fontSize: 9, color: 'var(--color-text-tertiary)',
        letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600,
      }}>
        {label}
      </div>
      <div className="hq-money" style={{
        fontSize: 24, fontWeight: 700, marginTop: 6,
        color: value != null ? accent : 'var(--color-text-muted)',
        fontFamily: 'var(--font-mono)',
      }}>
        {value != null ? `${formatBRL(value)}/h` : '—'}
      </div>
      <div style={{
        fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4,
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
        fontSize: 9, color: 'var(--color-text-tertiary)',
        letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2,
      }}>
        {label}
      </div>
      <div className="hq-money" style={{
        fontSize: 13, fontWeight: 700, color,
        fontFamily: 'var(--font-mono)',
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
          <div style={cardLabel}>Recebimentos previstos · {mesLabel}</div>
          {itens.length > 0 && (
            <div className="hq-money" style={{
              fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-success)',
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {formatBRL(total)}
            </div>
          )}
        </div>
      </div>
      <div style={cardBody}>

      {itens.length === 0 ? (
        <div style={{
          fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic',
          padding: '12px 0',
        }}>
          nenhum recebimento previsto pra {mesLabel}. cadastre parcelas
          esperadas nos seus projetos freela pra ver o pipeline, ou troque
          o mês no seletor acima.
        </div>
      ) : (
        <div className="hq-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {itens.map(({ projeto, parcela }, i) => (
            <div
              key={parcela.id}
              className="hq-animate-fade-up"
              style={{
                display: 'grid', gridTemplateColumns: '1fr 110px 100px',
                gap: 12, alignItems: 'center', padding: '8px 12px',
                background: 'var(--color-bg-primary)',
                border: '1px solid var(--color-border)',
                borderLeft: '3px solid var(--color-success)',
                borderRadius: 'var(--radius-sm)',
                transition: 'border-color var(--motion-fast) var(--ease-smooth), background var(--motion-fast) var(--ease-smooth)',
                ['--stagger-i' as any]: i,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--color-border-strong)'
                e.currentTarget.style.background = 'var(--glass-bg-hover)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--color-border)'
                e.currentTarget.style.background = 'var(--color-bg-primary)'
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 13, color: 'var(--color-text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {projeto.title} · parcela #{parcela.numero}
                </div>
                {projeto.cliente_nome && (
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {projeto.cliente_nome}
                  </div>
                )}
              </div>
              <span style={{
                fontSize: 10, color: 'var(--color-text-muted)',
                fontFamily: 'var(--font-mono)',
              }}>
                {parcela.data_prevista ?? 'sem data'}
              </span>
              <span className="hq-money" style={{
                fontSize: 13, fontWeight: 600, textAlign: 'right',
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-success)',
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
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)',
        }}>
          <Briefcase size={12} strokeWidth={1.8} style={{ color: 'var(--color-text-tertiary)' }} />
          <div style={cardLabel}>Projetos ativos</div>
          {projetos.length > 0 && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              {projetos.length}
            </div>
          )}
        </div>
      </div>
      <div style={cardBody}>

      {projetos.length === 0 ? (
        <div style={{
          fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic',
          padding: '20px 16px',
          border: '1px dashed var(--color-border)', borderRadius: 4,
          textAlign: 'center', lineHeight: 1.6,
        }}>
          nenhum projeto freela ativo. crie um projeto na área <strong>Freelas</strong>
          do Hub Quest e adicione valor acordado pra ver aqui.
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
    // Os projetos vivem em /areas/{slug}, com selectedProjectId controlado
    // por App.tsx. Pra simplicidade, navegamos pra área Freelas — o user
    // localiza o projeto na lista.
    navigate('/areas/freelas')
  }

  return (
    <div style={{
      background: 'var(--color-bg-primary)',
      border: '1px solid var(--color-border)',
      borderLeft: '3px solid var(--color-accent-light)',
      borderRadius: 4, padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)',
          }}>
            {p.title}
          </div>
          {p.cliente_nome && (
            <div style={{
              fontSize: 10, color: 'var(--color-text-tertiary)',
              textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2,
            }}>
              {p.cliente_nome}
            </div>
          )}
        </div>
        <button
          onClick={openInHubQuest}
          title="abrir projeto no Hub Quest"
          style={{
            background: 'none', border: '1px solid var(--color-border)',
            cursor: 'pointer', borderRadius: 3,
            color: 'var(--color-text-tertiary)',
            padding: '4px 8px', fontSize: 9,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-accent-light)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-tertiary)' }}
        >
          abrir
          <ExternalLink size={10} strokeWidth={2} />
        </button>
      </div>

      {/* R$/hora + comparação */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14,
        marginTop: 12,
      }}>
        <div>
          <div style={{
            fontSize: 9, color: 'var(--color-text-muted)',
            letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2,
          }}>
            R$/h estimado
          </div>
          <div className="hq-money" style={{
            fontSize: 14, fontWeight: 700,
            color: p.hourly_estimado != null ? 'var(--color-accent-light)' : 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            {p.hourly_estimado != null ? `${formatBRL(p.hourly_estimado)}/h` : '—'}
          </div>
        </div>
        <div>
          <div style={{
            fontSize: 9, color: 'var(--color-text-muted)',
            letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2,
          }}>
            R$/h real
          </div>
          <div className="hq-money" style={{
            fontSize: 14, fontWeight: 700,
            color: p.hourly_real != null ? 'var(--color-success)' : 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            {p.hourly_real != null ? `${formatBRL(p.hourly_real)}/h` : '—'}
          </div>
        </div>
      </div>

      {showCompare && (
        <div style={{
          marginTop: 8, fontSize: 10,
          display: 'flex', alignItems: 'center', gap: 6,
          color: acimaMedia ? 'var(--color-success)' : 'var(--color-accent-primary)',
        }}>
          {acimaMedia ? <TrendingUp size={11} strokeWidth={2} /> : <TrendingDown size={11} strokeWidth={2} />}
          <span style={{ fontWeight: 600 }}>
            {formatBRL(Math.abs(diff))}/h {acimaMedia ? 'acima' : 'abaixo'}
          </span>
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
            da sua média {tipoRate}
          </span>
        </div>
      )}

      {/* Recebido / a receber + barra */}
      {p.valor_acordado != null && (
        <div style={{
          marginTop: 14, paddingTop: 12,
          borderTop: '1px solid var(--color-border)',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            marginBottom: 6,
          }}>
            <span className="hq-money" style={{
              fontSize: 11, fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-success)',
            }}>
              {formatBRL(p.valor_pago)}
            </span>
            <span style={{
              fontSize: 10, color: 'var(--color-text-muted)',
            }}>
              de <span className="hq-money">{formatBRL(p.valor_acordado)}</span> ({progresso.toFixed(0)}%)
            </span>
          </div>
          <div style={{
            height: 4, background: 'var(--color-border)',
            borderRadius: 2, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${progresso}%`,
              background: 'var(--color-success)', transition: 'width 0.3s',
            }} />
          </div>
          {p.parcelas_total > 0 && (
            <div style={{
              fontSize: 10, color: 'var(--color-text-muted)',
              marginTop: 6,
            }}>
              {p.parcelas_pagas} de {p.parcelas_total} parcelas pagas
              {p.proxima_parcela && (
                <> · próxima: <strong style={{ fontFamily: 'var(--font-mono)' }}>{formatBRL(p.proxima_parcela.valor)}</strong>{p.proxima_parcela.data_prevista ? ` em ${p.proxima_parcela.data_prevista}` : ''}</>
              )}
            </div>
          )}
        </div>
      )}
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
          <Users size={12} strokeWidth={1.8} style={{ color: 'var(--color-text-tertiary)' }} />
          <div style={cardLabel}>Clientes</div>
          {clients.length > 0 && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              {clients.length}
            </div>
          )}
        </div>
      </div>
      <div style={cardBody}>

      {clients.length === 0 ? (
        <div style={{
          fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic',
          padding: '12px 0', lineHeight: 1.5,
        }}>
          nenhum cliente cadastrado. cadastre quem te paga (com CPF/CNPJ) pra
          ativar o auto-vínculo de receita.
        </div>
      ) : (
        <div className="hq-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {clients.slice(0, 8).map((c, i) => {
            const count = projetosPorCliente.get(c.id) ?? 0
            return (
              <div
                key={c.id}
                className="hq-row-hoverable hq-animate-fade-up"
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  ['--stagger-i' as any]: i,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {c.nome}
                  </div>
                  {c.cpf_cnpj && (
                    <div style={{
                      fontSize: 9, color: 'var(--color-text-muted)',
                      fontFamily: 'var(--font-mono)',
                    }}>
                      {c.cpf_cnpj}
                    </div>
                  )}
                </div>
                <span style={{
                  fontSize: 10, color: 'var(--color-text-tertiary)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {count} projeto{count === 1 ? '' : 's'}
                </span>
              </div>
            )
          })}
          {clients.length > 8 && (
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 4 }}>
              + {clients.length - 8} clientes
            </div>
          )}
        </div>
      )}

      </div>
      {/* Footer-action button — mesmo padrão do Carteira: full-width
          borderless com hover suave de cor + bg. */}
      <button
        onClick={onManage}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderTop: '1px solid var(--color-divider)',
          padding: 'var(--space-3) var(--space-6)',
          color: 'var(--color-text-tertiary)',
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          letterSpacing: '0.05em',
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--glass-bg-hover)'
          e.currentTarget.style.color = 'var(--color-accent-light)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--color-text-tertiary)'
        }}
      >
        gerenciar clientes
        <span style={{ marginLeft: 'auto' }}>→</span>
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
