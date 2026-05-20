/**
 * /health/mind — Página dedicada do módulo Mind (Observação Estruturada).
 *
 * Diferença das outras DomainPages: Mind tem **ciclo de observação→hipótese
 * →validação** próprio. Não cabe no fluxo genérico (RegisterModal+items+payload).
 * Página própria com:
 *  - Header com vitals (TEMPO 30D, SESSÕES, STREAK, HIP. PENDENTES)
 *  - Painel PADRÕES RECORRENTES (tags com sparkline de frequência)
 *  - Painel HIPÓTESES PENDENTES com adversarial challenge
 *  - LOG 30D (sessions com tags + hipótese inline, editáveis)
 *
 * Filosofia: observação estruturada, não diário. Tags são vocabulário operacional,
 * hipóteses são pontos a confirmar/refutar (não autoflagelação).
 */
import { useMemo, useState } from 'react'
import { ChevronRight, Download, Eye, History, Plus, Search, Sparkles, Tags, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import {
  useDeleteMindSession,
  useHealthSettings,
  useMindChallenges,
  useMindHipoteses,
  useMindPadroes,
  useMindSessions,
  useUpdateHealthSettings,
  useUpdateMindHipotese,
} from '../../lib/health-queries'
import type { MindHipotese, MindSession } from '../../types'
import { BODY, DISPLAY, MONO } from '../../components/health/tokens'
import MindHeatmap30d from '../../components/mind/MindHeatmap30d'
import MindRegisterModal from '../../components/mind/MindRegisterModal'
import MindTagsModal from '../../components/mind/MindTagsModal'
import LibraryBacklinksBadge from '../../components/library/LibraryBacklinksBadge'

const MIND_COR = '#9b88c4'

export default function MindPage() {
  const [registerOpen, setRegisterOpen] = useState(false)
  const [editingSession, setEditingSession] = useState<MindSession | null>(null)
  const [tagsOpen, setTagsOpen] = useState(false)

  const [filterText, setFilterText] = useState('')
  const [filterTipo, setFilterTipo] = useState<'todos' | 'rotina' | 'revelacao'>('todos')

  const { data: sessions = [] } = useMindSessions({ limit: 100 })
  const { data: padroes = [] } = useMindPadroes(30)
  const { data: challenges = [] } = useMindChallenges()
  const { data: pendingHipoteses = [] } = useMindHipoteses('pending')
  const { data: allHipoteses = [] } = useMindHipoteses(undefined)
  const { data: settings } = useHealthSettings()
  const updateSettings = useUpdateHealthSettings()

  // Sessões filtradas pelo search/tipo
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (filterTipo !== 'todos' && s.payload.tipo !== filterTipo) return false
      if (filterText.trim()) {
        const q = filterText.toLowerCase()
        const match =
          s.payload.observacao.toLowerCase().includes(q) ||
          (s.payload.hipotese?.toLowerCase().includes(q) ?? false) ||
          (s.payload.intencao?.toLowerCase().includes(q) ?? false) ||
          s.tags.some((t) => t.nome.toLowerCase().includes(q))
        if (!match) return false
      }
      return true
    })
  }, [sessions, filterText, filterTipo])

  // Revelações separadas pra painel destacado
  const revelacoes = useMemo(
    () => sessions.filter((s) => s.payload.tipo === 'revelacao'),
    [sessions],
  )

  // Stats derivados
  const stats = useMemo(() => {
    const cutoff30d = new Date()
    cutoff30d.setDate(cutoff30d.getDate() - 29)
    const cutoff30dIso = cutoff30d.toISOString().slice(0, 10)
    const last30 = sessions.filter((s) => s.data >= cutoff30dIso)
    const tempoTotal = last30.reduce(
      (acc, s) => acc + (s.payload.duracao_min ?? 0),
      0,
    )
    return {
      tempoTotal,
      sessoesCount: last30.length,
      hipotesesPendentes: pendingHipoteses.length,
      streak: calcStreak(sessions),
    }
  }, [sessions, pendingHipoteses])

  return (
    <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-10)' }}>
      {/* HERO */}
      <header
        className="hq-glass-elevated hq-grain hq-chamfer-cross"
        style={{
          position: 'relative',
          padding: 'var(--space-4) var(--space-5)',
          marginBottom: 'var(--space-4)',
          borderLeft: `2px solid ${MIND_COR}`,
        }}
      >
        <div
          aria-hidden="true"
          className="hq-hairline-ice"
          style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Eye size={22} strokeWidth={1.6} color={MIND_COR} />
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
            Mind
          </h1>
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}
          >
            OBSERVAÇÃO.ESTRUTURADA
          </span>

          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              flexWrap: 'wrap',
            }}
          >
            <Link
              to="/health/mind/hipoteses"
              className="hq-btn hq-btn--ghost"
              style={{
                fontSize: 11,
                padding: '7px 12px',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
              title="Histórico de hipóteses"
            >
              <History size={13} strokeWidth={2} /> HIPÓTESES
            </Link>
            <button
              type="button"
              onClick={() => exportMarkdown(sessions)}
              className="hq-btn hq-btn--ghost"
              style={{ fontSize: 11, padding: '7px 12px' }}
              title="Exportar log em markdown"
            >
              <Download size={13} strokeWidth={2} /> EXPORT
            </button>
            <button
              type="button"
              onClick={() => setTagsOpen(true)}
              className="hq-btn hq-btn--ghost"
              style={{ fontSize: 11, padding: '7px 12px' }}
              title="Gerenciar tags"
            >
              <Tags size={13} strokeWidth={2} /> TAGS
            </button>
            <button
              type="button"
              onClick={() => setRegisterOpen(true)}
              className="hq-btn hq-btn--primary"
              style={{ fontSize: 11, padding: '7px 14px' }}
            >
              <Plus size={13} strokeWidth={2.5} /> MEDITAR
            </button>
          </div>
        </div>

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
          <BigStat
            label="TEMPO 30D"
            value={formatMinutes(stats.tempoTotal)}
            accent={MIND_COR}
          />
          <BigStat label="SESSÕES" value={String(stats.sessoesCount)} accent={MIND_COR} />
          <BigStat
            label="STREAK"
            value={stats.streak > 0 ? `${stats.streak}d` : '—'}
            accent="var(--color-text-secondary)"
          />
          <BigStat
            label="HIPÓTESES"
            value={String(stats.hipotesesPendentes)}
            accent={stats.hipotesesPendentes > 0 ? 'var(--color-warning)' : 'var(--color-text-secondary)'}
          />
        </div>

        {/* AGENDA DIÁRIA — quando ativada, Mind gera pendência arrastável
            no /Dia. Persiste em health_settings (mind_diario, duração média,
            horário sugerido). */}
        {settings && (
          <AgendaPanel
            ativo={settings.mind_diario}
            duracao={settings.mind_duracao_media_min}
            horario={settings.mind_horario_sugerido}
            onToggle={(v) =>
              updateSettings.mutate({ mind_diario: v })
            }
            onChangeDuracao={(v) =>
              updateSettings.mutate({ mind_duracao_media_min: v })
            }
            onChangeHorario={(v) =>
              updateSettings.mutate({ mind_horario_sugerido: v || null })
            }
          />
        )}

        {/* Pipeline de hipóteses — barra empilhada compacta */}
        {allHipoteses.length > 0 && (
          <Link
            to="/health/mind/hipoteses"
            style={{
              display: 'block',
              marginTop: 'var(--space-3)',
              paddingTop: 'var(--space-2)',
              borderTop: '1px dashed var(--color-divider)',
              textDecoration: 'none',
              color: 'inherit',
            }}
            title="Ver histórico completo de hipóteses"
          >
            <HipotesesPipeline hipoteses={allHipoteses} />
          </Link>
        )}
      </header>

      {/* HEATMAP 30D — controle visual de marcação dia-a-dia.
          Mesmo vocabulário de Vícios/Alimentação (Heatmap30d), mas Mind-
          específico: roxo = rotina, âmbar = dia com revelação. */}
      <section style={{ marginBottom: 'var(--space-5)' }}>
        <SectionLabel>
          MARCAÇÃO · 30D{' '}
          <span style={{ color: 'var(--color-text-muted)' }}>
            · roxo rotina · âmbar revelação
          </span>
        </SectionLabel>
        <div
          className="hq-glass hq-chamfer-bl"
          style={{
            padding: 'var(--space-4) var(--space-4) calc(var(--space-4) + 10px)',
            marginTop: 'var(--space-3)',
            overflow: 'hidden',
          }}
        >
          <MindHeatmap30d sessions={sessions} cellSize={14} gap={3} />
        </div>
      </section>

      {/* CHALLENGES — adversarial inquiry sobre hipóteses recorrentes */}
      {challenges.length > 0 && (
        <section style={{ marginBottom: 'var(--space-5)' }}>
          <SectionLabel>HIPÓTESES A CONFRONTAR</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
            {challenges.map((c) => (
              <ChallengeRow key={c.hipotese.id} challenge={c} />
            ))}
          </div>
        </section>
      )}

      {/* PADRÕES RECORRENTES — sparkline temporal por tag (30d) */}
      {padroes.length > 0 && (
        <section style={{ marginBottom: 'var(--space-5)' }}>
          <SectionLabel>
            PADRÕES · 30D{' '}
            <span style={{ color: 'var(--color-text-muted)' }}>
              · densidade temporal
            </span>
          </SectionLabel>
          <div
            className="hq-glass hq-chamfer-bl"
            style={{
              padding: 'var(--space-3) var(--space-4)',
              marginTop: 'var(--space-3)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {/* Régua temporal compartilhada — 30D…HOJE */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr 50px 16px',
                alignItems: 'center',
                gap: 'var(--space-3)',
                paddingBottom: 4,
                borderBottom: '1px dashed var(--color-divider)',
              }}
            >
              <span />
              <div
                className="hq-tech-id"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: 'var(--color-text-muted)',
                  fontSize: 9,
                  letterSpacing: '0.15em',
                }}
              >
                <span>30D ATRÁS</span>
                <span>HOJE</span>
              </div>
              <span
                className="hq-tech-id"
                style={{
                  color: 'var(--color-text-muted)',
                  textAlign: 'right',
                  fontSize: 9,
                  letterSpacing: '0.15em',
                }}
              >
                TOTAL
              </span>
              <span />
            </div>

            {padroes.map((p) => {
              const sparks = tagSparkline(sessions, p.tag_slug, 30)
              const cor = p.tag_cor ?? MIND_COR
              return (
                <Link
                  key={p.tag_slug}
                  to={`/health/mind/tag/${p.tag_slug}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '120px 1fr 50px 16px',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: '2px 0',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                  className="hq-row-hoverable"
                  title={`${p.tag_nome} — ${p.count} aparições, primeira ${formatDateBR(p.primeira)} · última ${formatDateBR(p.ultima)}`}
                >
                  <span
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: cor,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.tag_nome}
                  </span>
                  <Sparkline values={sparks} color={cor} />
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--color-text-primary)',
                      textAlign: 'right',
                      letterSpacing: 0,
                    }}
                  >
                    {p.count}
                  </span>
                  <ChevronRight size={11} color="var(--color-text-muted)" />
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* REVELAÇÕES — painel destacado */}
      {revelacoes.length > 0 && (
        <section style={{ marginBottom: 'var(--space-5)' }}>
          <SectionLabel>
            <span style={{ color: '#c08a3a' }}>✦ REVELAÇÕES</span>{' '}
            <span style={{ color: 'var(--color-text-muted)' }}>· {revelacoes.length}</span>
          </SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'var(--space-3)' }}>
            {revelacoes.slice(0, 5).map((s) => (
              <RevelacaoRow key={s.id} session={s} onEdit={() => setEditingSession(s)} />
            ))}
            {revelacoes.length > 5 && (
              <div
                className="hq-tech-id"
                style={{
                  color: 'var(--color-text-muted)',
                  fontStyle: 'italic',
                  padding: 'var(--space-2) 0',
                }}
              >
                + {revelacoes.length - 5} revelações mais antigas no log
              </div>
            )}
          </div>
        </section>
      )}

      {/* LOG com filtros */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginTop: 'var(--space-5)', flexWrap: 'wrap' }}>
        <SectionLabel>LOG · 30D</SectionLabel>
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {filteredSessions.length} / {sessions.length}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(['todos', 'rotina', 'revelacao'] as const).map((t) => {
            const active = filterTipo === t
            return (
              <button
                key={t}
                type="button"
                onClick={() => setFilterTipo(t)}
                className="hq-chamfer-bl"
                style={{
                  background: active ? MIND_COR : 'var(--color-bg-primary)',
                  border: active ? `1px solid ${MIND_COR}` : '1px solid var(--color-border)',
                  color: active ? '#000' : 'var(--color-text-secondary)',
                  padding: '2px 10px',
                  fontFamily: MONO,
                  fontSize: 10,
                  fontWeight: active ? 700 : 500,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                {t === 'todos' ? 'todos' : t === 'rotina' ? 'rotina' : 'revelações'}
              </button>
            )
          })}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}
      >
        <Search size={12} color="var(--color-text-muted)" />
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="buscar em observação, hipótese, intenção, tags…"
          style={{
            flex: 1,
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            padding: '6px 10px',
            fontFamily: BODY,
            fontSize: 12,
            outline: 'none',
            letterSpacing: 0,
          }}
        />
      </div>
      {filteredSessions.length === 0 ? (
        <div
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 12,
            padding: 'var(--space-6) 0',
            fontStyle: 'italic',
            fontFamily: BODY,
          }}
        >
          {sessions.length === 0
            ? 'Nenhuma observação ainda. Toca em MEDITAR pra começar.'
            : 'Nenhuma sessão bate com o filtro.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filteredSessions.map((s) => (
            <SessionRow key={s.id} session={s} onEdit={() => setEditingSession(s)} />
          ))}
        </div>
      )}

      {/* Modais */}
      {registerOpen && (
        <MindRegisterModal onClose={() => setRegisterOpen(false)} />
      )}
      {editingSession && (
        <MindRegisterModal
          existing={editingSession}
          onClose={() => setEditingSession(null)}
        />
      )}
      {tagsOpen && <MindTagsModal onClose={() => setTagsOpen(false)} />}
    </div>
  )
}

// ─── Subcomponentes ───────────────────────────────────────────────────────

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="hq-tech-label"
      style={{
        marginTop: 'var(--space-5)',
        marginBottom: 'var(--space-2)',
        fontSize: 10,
      }}
    >
      {children}
    </div>
  )
}

function ChallengeRow({
  challenge,
}: {
  challenge: import('../../types').MindChallenge
}) {
  const updateHip = useUpdateMindHipotese()
  const { hipotese, tags_relacionadas } = challenge
  const tagNames = tags_relacionadas
    .map((t) => `${t.tag_nome} (${t.count}x)`)
    .join(' · ')

  function setStatus(status: MindHipotese['status']) {
    updateHip.mutate({ id: hipotese.id, status })
  }

  return (
    <div
      className="hq-glass hq-grain hq-chamfer-bl"
      style={{
        padding: 'var(--space-3) var(--space-4)',
        borderLeft: '2px solid var(--color-warning)',
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
            color: 'var(--color-warning)',
            letterSpacing: '0.28em',
          }}
        >
          ⚠ CONFRONTAR HIPÓTESE
        </span>
        <LibraryBacklinksBadge
          targetType="mind_hipotese"
          targetId={hipotese.id}
        />
      </div>
      <div
        style={{
          fontFamily: BODY,
          fontSize: 14,
          color: 'var(--color-text-primary)',
          lineHeight: 1.5,
          fontStyle: 'italic',
          marginBottom: 'var(--space-2)',
        }}
      >
        "{hipotese.texto}"
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color: 'var(--color-text-muted)',
          letterSpacing: 0,
          marginBottom: 'var(--space-3)',
        }}
      >
        padrões relacionados: {tagNames}
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-text-secondary)',
          fontFamily: BODY,
          fontStyle: 'italic',
          marginBottom: 'var(--space-3)',
        }}
      >
        Você ainda acredita nesse motivo, ou está repetindo a explicação fácil?
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setStatus('validated')}
          disabled={updateHip.isPending}
          className="hq-btn hq-btn--ghost"
          style={{ fontSize: 10, padding: '6px 10px' }}
        >
          VALIDAR
        </button>
        <button
          type="button"
          onClick={() => setStatus('refuted')}
          disabled={updateHip.isPending}
          className="hq-btn hq-btn--ghost"
          style={{ fontSize: 10, padding: '6px 10px' }}
        >
          REFUTAR
        </button>
        <button
          type="button"
          onClick={() => setStatus('suspended')}
          disabled={updateHip.isPending}
          className="hq-btn hq-btn--ghost"
          style={{ fontSize: 10, padding: '6px 10px' }}
        >
          SUSPENDER
        </button>
      </div>
    </div>
  )
}

function SessionRow({
  session,
  onEdit,
}: {
  session: MindSession
  onEdit: () => void
}) {
  const del = useDeleteMindSession()
  const isRevelacao = session.payload.tipo === 'revelacao'

  // Cluster cronometrado: quando user usa PLAY/PAUSE no /Dia, cada
  // segmento vira uma row em mind_session. A duração somada das rows
  // (em minutos) é a ground truth — vs payload.duracao_min que pode
  // ter sido inserido manualmente. Mostra também o horário do primeiro
  // segmento e contagem de sub-sessões se > 1.
  const clusterRows = session.cluster_rows ?? []
  const clusterStartedAt = clusterRows.length > 0 ? clusterRows[0].started_at : null
  const clusterTotalMin = clusterRows.reduce((acc, r) => {
    if (!r.ended_at || !r.started_at) return acc
    try {
      const s = new Date(r.started_at.replace('Z', '+00:00')).getTime()
      const e = new Date(r.ended_at.replace('Z', '+00:00')).getTime()
      return acc + Math.max(0, Math.floor((e - s) / 60000))
    } catch { return acc }
  }, 0)
  const fmtHHMM = (iso: string | null): string => {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    } catch { return '' }
  }
  // Prioridade pro horário: cluster primeiro segmento > session.horario (manual)
  const horarioLabel = clusterStartedAt ? fmtHHMM(clusterStartedAt) : session.horario
  // Prioridade pra duração: soma do cluster (ground truth) > payload.duracao_min
  const duracaoMin = clusterTotalMin > 0
    ? clusterTotalMin
    : (session.payload.duracao_min ?? null)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onEdit()
        }
      }}
      className="hq-glass hq-row-hoverable hq-chamfer-bl"
      style={{
        padding: 'var(--space-3) var(--space-4)',
        borderLeft: `2px solid ${isRevelacao ? '#c08a3a' : MIND_COR}`,
        cursor: 'pointer',
      }}
      title="Clique pra editar"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--space-2)',
          marginBottom: 4,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: 'var(--color-text-secondary)',
            letterSpacing: 0,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatDateBR(session.data)}
          {horarioLabel ? ` · ${horarioLabel}` : ''}
        </span>
        {duracaoMin != null && duracaoMin > 0 && (
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)' }}
            title={clusterTotalMin > 0 ? 'somatório das sessões cronometradas' : 'duração informada'}
          >
            {duracaoMin} min
          </span>
        )}
        {clusterRows.length > 1 && (
          <span
            className="hq-tech-id"
            style={{ color: MIND_COR, borderColor: MIND_COR }}
            title={`Registro feito em ${clusterRows.length} sub-sessões (play/pause/resume)`}
          >
            {clusterRows.length}×
          </span>
        )}
        {isRevelacao && (
          <span
            className="hq-tech-id"
            style={{
              color: '#c08a3a',
              padding: '1px 6px',
              border: '1px solid #c08a3a',
            }}
          >
            REVELAÇÃO
          </span>
        )}
        {session.tags.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {session.tags.map((t) => (
              <Link
                key={t.id}
                to={`/health/mind/tag/${t.slug}`}
                onClick={(e) => e.stopPropagation()}
                className="hq-tech-id"
                style={{
                  color: t.cor ?? MIND_COR,
                  border: `1px solid ${t.cor ?? MIND_COR}`,
                  padding: '1px 6px',
                  textDecoration: 'none',
                }}
              >
                {t.nome}
              </Link>
            ))}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (confirm('Deletar esta observação? Não dá pra desfazer.')) {
                del.mutate(session.id)
              }
            }}
            disabled={del.isPending}
            className="hq-icon-btn-bare"
            style={{
              minWidth: 22,
              minHeight: 22,
              padding: 2,
              color: 'var(--color-error)',
            }}
            title="Deletar"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {session.payload.intencao && (
        <div
          style={{
            fontFamily: BODY,
            fontSize: 12,
            color: 'var(--color-text-muted)',
            fontStyle: 'italic',
            marginTop: 2,
          }}
        >
          intenção: {session.payload.intencao}
        </div>
      )}
      <div
        style={{
          fontFamily: BODY,
          fontSize: 13,
          color: 'var(--color-text-primary)',
          lineHeight: 1.5,
          marginTop: 4,
          whiteSpace: 'pre-wrap',
        }}
      >
        {session.payload.observacao}
      </div>
      {session.payload.hipotese && (
        <div
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: '1px dashed var(--color-divider)',
            fontFamily: BODY,
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            fontStyle: 'italic',
          }}
        >
          hipótese: {session.payload.hipotese}
          {session.hipotese && session.hipotese.status !== 'pending' && (
            <span
              className="hq-tech-id"
              style={{
                marginLeft: 8,
                color:
                  session.hipotese.status === 'validated'
                    ? 'var(--color-ice-light)'
                    : session.hipotese.status === 'refuted'
                      ? 'var(--color-error)'
                      : 'var(--color-warning)',
              }}
            >
              · {statusLabel(session.hipotese.status)}
            </span>
          )}
          {session.hipotese && (
            <span style={{ marginLeft: 8 }}>
              <LibraryBacklinksBadge
                targetType="mind_hipotese"
                targetId={session.hipotese.id}
              />
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Versão destacada do SessionRow pra revelações — accent âmbar, ícone
 * Sparkles, observação inteira (não preview), mais ar.
 */
function RevelacaoRow({
  session,
  onEdit,
}: {
  session: MindSession
  onEdit: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onEdit()
        }
      }}
      className="hq-glass hq-grain hq-row-hoverable hq-chamfer-bl"
      style={{
        padding: 'var(--space-3) var(--space-4)',
        borderLeft: '2px solid #c08a3a',
        cursor: 'pointer',
      }}
      title="Clique pra editar"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--space-2)',
          marginBottom: 4,
        }}
      >
        <Sparkles size={13} color="#c08a3a" />
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: '#c08a3a',
            fontWeight: 700,
            letterSpacing: '0.18em',
          }}
        >
          {formatDateBR(session.data)}
          {session.horario ? ` · ${session.horario}` : ''}
        </span>
      </div>
      <div
        style={{
          fontFamily: BODY,
          fontSize: 14,
          color: 'var(--color-text-primary)',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}
      >
        {session.payload.observacao}
      </div>
    </div>
  )
}

/**
 * Sparkline temporal — 30 colunas (1 por dia). Cada coluna tem altura
 * proporcional ao count daquele dia. Dias sem evento ficam invisíveis (apenas
 * um traço fino na base, pra dar a régua temporal).
 *
 * Decisão: bars verticais em vez de linha contínua porque eventos diários
 * discretos (sessões) representam melhor por densidade pontual do que curva.
 * Lê-se "quando o padrão aconteceu" sem precisar achar números.
 */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1)
  const total = values.reduce((acc, v) => acc + v, 0)
  return (
    <div
      aria-label={`${total} aparições em ${values.length} dias`}
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 1,
        height: 18,
        width: '100%',
      }}
    >
      {values.map((v, i) => {
        const h = v === 0 ? 1 : 2 + (v / max) * 16
        return (
          <div
            key={i}
            style={{
              flex: 1,
              minWidth: 0,
              height: h,
              background: v === 0 ? 'var(--color-divider)' : color,
              opacity: v === 0 ? 0.5 : 0.4 + 0.6 * (v / max),
              borderRadius: 0.5,
            }}
          />
        )
      })}
    </div>
  )
}

/**
 * Pipeline de hipóteses — barra empilhada compacta (pending / validated /
 * refuted / suspended) com contagens. Mostra a saúde do processo: muito
 * pending = não tá fechando ciclos; muito validated/refuted = tá processando.
 */
function HipotesesPipeline({ hipoteses }: { hipoteses: MindHipotese[] }) {
  const counts = {
    pending: hipoteses.filter((h) => h.status === 'pending').length,
    validated: hipoteses.filter((h) => h.status === 'validated').length,
    refuted: hipoteses.filter((h) => h.status === 'refuted').length,
    suspended: hipoteses.filter((h) => h.status === 'suspended').length,
  }
  const total = hipoteses.length
  if (total === 0) return null

  const segments: Array<{ key: string; count: number; color: string; label: string }> = [
    { key: 'pending', count: counts.pending, color: 'var(--color-warning)', label: 'pendente' },
    { key: 'validated', count: counts.validated, color: 'var(--color-ice-light)', label: 'validada' },
    { key: 'refuted', count: counts.refuted, color: 'var(--color-error)', label: 'refutada' },
    { key: 'suspended', count: counts.suspended, color: 'var(--color-text-muted)', label: 'suspensa' },
  ]

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}
      >
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)' }}
        >
          PIPELINE HIPÓTESES · {total}
        </span>
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)' }}
        >
          HISTÓRICO →
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          height: 6,
          background: 'var(--color-divider)',
          overflow: 'hidden',
        }}
      >
        {segments.map((s) =>
          s.count > 0 ? (
            <div
              key={s.key}
              style={{
                width: `${(s.count / total) * 100}%`,
                background: s.color,
              }}
              title={`${s.count} ${s.label}`}
            />
          ) : null,
        )}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-3)',
          marginTop: 4,
          flexWrap: 'wrap',
        }}
      >
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <span
              key={s.key}
              className="hq-tech-id"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: 'var(--color-text-secondary)',
                fontSize: 9,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  background: s.color,
                }}
              />
              {s.label} {s.count}
            </span>
          ))}
      </div>
    </div>
  )
}

/**
 * Densidade temporal de uma tag — retorna array com `days` posições, da
 * mais antiga (esquerda) à mais recente (direita = hoje). Cada posição é o
 * número de sessions daquele dia que carregam a tag.
 */
function tagSparkline(
  sessions: MindSession[],
  tagSlug: string,
  days: number,
): number[] {
  const buckets = new Array(days).fill(0)
  // "Hoje" como meia-noite local pra alinhar com `session.data` (date string).
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (const s of sessions) {
    if (!s.tags.some((t) => t.slug === tagSlug)) continue
    const d = new Date(`${s.data}T00:00:00`)
    const diff = Math.floor((today.getTime() - d.getTime()) / 86_400_000)
    if (diff >= 0 && diff < days) {
      // diff=0 é hoje → última posição
      buckets[days - 1 - diff]++
    }
  }
  return buckets
}

/**
 * Exporta log Mind em markdown — útil pra retiro / backup / revisão anual.
 * Browser-side: cria blob e dispara download. Sem dependência externa.
 */
function exportMarkdown(sessions: MindSession[]) {
  if (sessions.length === 0) {
    alert('Nada pra exportar — log vazio.')
    return
  }
  const lines: string[] = ['# Mind — log de observações', '']
  for (const s of sessions) {
    const data = formatDateBR(s.data)
    const horario = s.horario ? ` · ${s.horario}` : ''
    const duracao =
      s.payload.duracao_min != null ? ` · ${s.payload.duracao_min}min` : ''
    const tipo = s.payload.tipo === 'revelacao' ? ' · ✦ REVELAÇÃO' : ''
    lines.push(`## ${data}${horario}${duracao}${tipo}`, '')
    if (s.tags.length > 0) {
      lines.push(`*tags*: ${s.tags.map((t) => t.nome).join(' · ')}`, '')
    }
    if (s.payload.intencao) {
      lines.push(`**intenção**: ${s.payload.intencao}`, '')
    }
    lines.push(s.payload.observacao, '')
    if (s.payload.hipotese) {
      const status = s.hipotese?.status
      const statusLabel =
        status === 'validated'
          ? ' [VALIDADA]'
          : status === 'refuted'
            ? ' [REFUTADA]'
            : status === 'suspended'
              ? ' [SUSPENSA]'
              : ''
      lines.push(`**hipótese**${statusLabel}: ${s.payload.hipotese}`, '')
    }
    lines.push('---', '')
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `mind-log-${new Date().toISOString().slice(0, 10)}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Painel AGENDA — inline no header. Toggle "ativar pendência diária" +
 * inputs de duração média e horário sugerido. Quando ativo, Mind aparece
 * como card arrastável no /Dia.
 */
function AgendaPanel({
  ativo,
  duracao,
  horario,
  onToggle,
  onChangeDuracao,
  onChangeHorario,
}: {
  ativo: boolean
  duracao: number
  horario: string | null
  onToggle: (v: boolean) => void
  onChangeDuracao: (v: number) => void
  onChangeHorario: (v: string) => void
}) {
  return (
    <div
      style={{
        marginTop: 'var(--space-3)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px dashed var(--color-divider)',
        display: 'flex',
        gap: 'var(--space-4)',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: ativo ? MIND_COR : 'var(--color-text-muted)',
        }}
      >
        <input
          type="checkbox"
          checked={ativo}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ accentColor: MIND_COR }}
        />
        Agenda diária
      </label>
      {ativo && (
        <>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              className="hq-tech-id"
              style={{ color: 'var(--color-text-muted)' }}
            >
              duração
            </span>
            <input
              type="number"
              min={1}
              max={300}
              value={duracao}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v) && v > 0) onChangeDuracao(v)
              }}
              style={{
                background: 'var(--color-bg-primary)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                padding: '3px 8px',
                fontFamily: MONO,
                fontSize: 12,
                width: 70,
                outline: 'none',
                fontVariantNumeric: 'tabular-nums',
              }}
            />
            <span
              className="hq-tech-id"
              style={{ color: 'var(--color-text-muted)' }}
            >
              min
            </span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              className="hq-tech-id"
              style={{ color: 'var(--color-text-muted)' }}
            >
              horário sugerido
            </span>
            <input
              type="time"
              value={horario ?? ''}
              onChange={(e) => onChangeHorario(e.target.value)}
              style={{
                background: 'var(--color-bg-primary)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                padding: '3px 8px',
                fontFamily: MONO,
                fontSize: 12,
                outline: 'none',
              }}
            />
          </span>
          <span
            className="hq-tech-id"
            style={{
              color: 'var(--color-text-muted)',
              fontStyle: 'italic',
              fontSize: 9,
            }}
          >
            aparece como card arrastável em /dia
          </span>
        </>
      )}
    </div>
  )
}

function statusLabel(s: MindHipotese['status']): string {
  switch (s) {
    case 'validated':
      return 'VALIDADA'
    case 'refuted':
      return 'REFUTADA'
    case 'suspended':
      return 'SUSPENSA'
    default:
      return 'PENDENTE'
  }
}

function formatDateBR(iso: string): string {
  const parts = iso.split('-')
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : iso
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

function calcStreak(sessions: MindSession[]): number {
  if (sessions.length === 0) return 0
  const datas = Array.from(new Set(sessions.map((s) => s.data))).sort().reverse()
  const today = new Date().toISOString().slice(0, 10)
  const ontem = new Date()
  ontem.setDate(ontem.getDate() - 1)
  const ontemIso = ontem.toISOString().slice(0, 10)
  let streak = 0
  let expected: string = ''
  for (const d of datas) {
    if (expected === '') {
      if (d === today || d === ontemIso) {
        expected = d
      } else {
        break
      }
    }
    if (d === expected) {
      streak++
      const prevDay: Date = new Date(`${expected}T00:00:00`)
      prevDay.setDate(prevDay.getDate() - 1)
      expected = prevDay.toISOString().slice(0, 10)
    } else if (d < expected) {
      break
    }
  }
  return streak
}
