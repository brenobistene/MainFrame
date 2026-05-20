/**
 * /build/historia — Histórico unificado de rituais.
 *
 * Visão consolidada das execuções de todos os rituais (semanal/mensal/
 * trimestral/anual). Cabeçalho estilo Hub Finance (sticky + tab nav).
 *
 * Cada tab mostra:
 *  - Card-resumo do ritual (nome, direcionamento, próxima_data, dias_atraso)
 *  - Stats (streak, completion 90d, total executados, total pulados)
 *  - Heatmap (12 slots semanal/mensal, 8 trimestral, 4 anual)
 *  - Timeline cronológica de sessões com edit/delete inline
 */
import { useMemo, useState } from 'react'
import { Pencil, Trash2, Check, X, Activity, AlertTriangle } from 'lucide-react'

import type { BuildRitual, BuildRitualCadencia, BuildRitualSession } from '../types'
import {
  useRituals,
  useRitualSessions,
  useUpdateRitualSession,
  useDeleteRitualSession,
} from '../lib/build-queries'

const CADENCIAS: { value: BuildRitualCadencia; label: string }[] = [
  { value: 'semanal', label: 'SEMANAL' },
  { value: 'mensal', label: 'MENSAL' },
  { value: 'trimestral', label: 'TRIMESTRAL' },
  { value: 'anual', label: 'ANUAL' },
]

const COLORS = {
  panel: 'rgba(11, 13, 18, 0.55)',
  border: 'var(--color-border-strong)',
  borderIce: 'rgba(143, 191, 211, 0.35)',
  textPrimary: 'var(--color-text-primary)',
  textSecondary: 'var(--color-text-secondary)',
  textMuted: 'var(--color-text-muted)',
  textTertiary: 'var(--color-text-tertiary)',
  ice: 'var(--color-ice)',
  iceLight: 'var(--color-ice-light)',
  iceDeep: 'var(--color-ice-deep)',
  amber: '#c08a3a',
  danger: 'var(--color-accent-primary)',
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') || iso.includes(' ') ? iso : `${iso}T00:00:00`)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function slotsForCadencia(c: BuildRitualCadencia): number {
  return c === 'semanal' ? 12 : c === 'mensal' ? 12 : c === 'trimestral' ? 8 : 4
}

function calcStats(sessions: BuildRitualSession[], cadencia: BuildRitualCadencia) {
  // Sessions sorted desc por data (vem assim do backend)
  let streak = 0
  for (const s of sessions) {
    if (s.skipped) continue
    streak++
  }
  const cap = cadencia === 'semanal' ? 52 : cadencia === 'mensal' ? 12 : cadencia === 'trimestral' ? 4 : 1
  streak = Math.min(streak, cap * 2)

  const completed = sessions.filter(s => !s.skipped)
  const skipped = sessions.filter(s => s.skipped)

  const slotsEsperados90d =
    cadencia === 'semanal' ? Math.floor(90 / 7)
    : cadencia === 'mensal' ? 3
    : cadencia === 'trimestral' ? 1
    : 0
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
  const recent90 = completed.filter(
    s => new Date(`${s.data_executado}T00:00:00`) >= ninetyDaysAgo
  )
  const completionPct =
    slotsEsperados90d > 0
      ? Math.min(100, Math.round((recent90.length / slotsEsperados90d) * 100))
      : null

  return {
    streak,
    completionPct,
    totalExecutados: completed.length,
    totalPulados: skipped.length,
  }
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function BuildHistoriaPage() {
  const [active, setActive] = useState<BuildRitualCadencia>('semanal')
  const { data: rituais = [] } = useRituals()
  const ritualAtivo = useMemo(
    () => rituais.find(r => r.cadencia === active) ?? null,
    [rituais, active],
  )

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto', color: COLORS.textPrimary }}>
      {/* Sub-tabs de cadência — pílulas inline (não sticky; sticky fica no
          BuildLayout). Visual igual ao header pra continuidade. */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 20,
          overflow: 'auto',
          paddingBottom: 4,
        }}
      >
        {CADENCIAS.map(c => {
          const isActive = c.value === active
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => setActive(c.value)}
              style={{
                padding: '6px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: isActive ? COLORS.iceLight : COLORS.textTertiary,
                background: isActive ? 'rgba(143, 191, 211, 0.10)' : 'rgba(8, 12, 18, 0.55)',
                border: `1px solid ${isActive ? 'rgba(143, 191, 211, 0.45)' : 'var(--color-border)'}`,
                borderRadius: 0,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s',
                boxShadow: isActive ? '0 0 12px rgba(143, 191, 211, 0.18)' : 'none',
              }}
            >
              {c.label}
            </button>
          )
        })}
      </div>

      {ritualAtivo ? (
        <CadenciaPanel ritual={ritualAtivo} />
      ) : (
        <div
          style={{
            padding: 32,
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: COLORS.textMuted,
            letterSpacing: '0.1em',
          }}
        >
          Ritual {active} não configurado.
        </div>
      )}
    </div>
  )
}

// ─── CadenciaPanel ──────────────────────────────────────────────────────

function CadenciaPanel({ ritual }: { ritual: BuildRitual }) {
  const { data: sessions = [], isLoading } = useRitualSessions(ritual.cadencia)
  const stats = useMemo(() => calcStats(sessions, ritual.cadencia), [sessions, ritual.cadencia])
  const isAtrasado = ritual.dias_atraso > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Card-resumo do ritual */}
      <section
        style={{
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.2em',
                color: COLORS.iceLight,
                fontWeight: 700,
              }}
            >
              RITUAL · {ritual.cadencia.toUpperCase()}
            </div>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: '0.02em',
                margin: 0,
                color: COLORS.textPrimary,
                textTransform: 'uppercase',
              }}
            >
              {ritual.nome || `Ritual ${ritual.cadencia}`}
            </h2>
          </div>
          {isAtrasado && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                background: 'rgba(159, 18, 57, 0.12)',
                border: `1px solid ${COLORS.danger}`,
                color: 'var(--color-accent-light)',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
              }}
            >
              <AlertTriangle size={10} strokeWidth={2} />
              {ritual.dias_atraso}d atraso
            </div>
          )}
        </div>

        {ritual.direcionamento_pensar && (
          <div>
            <div style={miniLabel}>DIRECIONAMENTO</div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.5, marginTop: 4 }}>
              {ritual.direcionamento_pensar}
            </div>
          </div>
        )}
        {ritual.direcionamento_evitar && (
          <div>
            <div style={miniLabel}>EVITAR</div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.5, marginTop: 4 }}>
              {ritual.direcionamento_evitar}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 4 }}>
          <Metric label="Próxima" value={fmtDate(ritual.proxima_data)} />
          <Metric label="Última" value={fmtDate(ritual.ultima_execucao)} />
          <Metric label="Duração alvo" value={ritual.duracao_alvo_min ? `${ritual.duracao_alvo_min}m` : '—'} />
        </div>
      </section>

      {/* Stats */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
        }}
      >
        <StatCard label="Streak atual" value={stats.streak} accent={COLORS.iceLight} icon={<Activity size={14} strokeWidth={2} />} />
        <StatCard
          label="Completion 90d"
          value={stats.completionPct === null ? '—' : `${stats.completionPct}%`}
          accent={COLORS.iceLight}
        />
        <StatCard label="Executados" value={stats.totalExecutados} accent={COLORS.iceLight} />
        <StatCard label="Pulados" value={stats.totalPulados} accent={COLORS.amber} />
      </section>

      {/* Heatmap */}
      <section
        style={{
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          padding: '14px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={miniLabel}>HEATMAP · ÚLTIMOS {slotsForCadencia(ritual.cadencia)} SLOTS</div>
        <Heatmap sessions={sessions} cadencia={ritual.cadencia} />
        <div style={{ display: 'flex', gap: 14, fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: COLORS.textMuted }}>
          <LegendDot color={COLORS.iceLight} label="EXECUTADO" />
          <LegendDot color={COLORS.amber} label="PULADO" />
          <LegendDot color="transparent" border label="VAZIO" />
        </div>
      </section>

      {/* Timeline */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={miniLabel}>TIMELINE · {sessions.length} SESSÕES</div>
        {isLoading ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: COLORS.textMuted, padding: 12 }}>
            Carregando…
          </div>
        ) : sessions.length === 0 ? (
          <div
            style={{
              padding: 24,
              background: COLORS.panel,
              border: `1px dashed ${COLORS.border}`,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: COLORS.textMuted,
              letterSpacing: '0.1em',
              textAlign: 'center',
            }}
          >
            Nenhuma sessão registrada ainda.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sessions.map(s => (
              <SessionRow key={s.id} session={s} cadencia={ritual.cadencia} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────

const miniLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.2em',
  color: COLORS.textMuted,
  textTransform: 'uppercase',
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={miniLabel}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: COLORS.textPrimary, letterSpacing: '0.05em' }}>
        {value}
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string
  value: string | number
  accent: string
  icon?: React.ReactNode
}) {
  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
      }}
    >
      <div style={{ ...miniLabel, display: 'flex', alignItems: 'center', gap: 4, color: COLORS.textTertiary }}>
        {icon}
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 600,
          color: accent,
          letterSpacing: '0.02em',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  )
}

function Heatmap({ sessions, cadencia }: { sessions: BuildRitualSession[]; cadencia: BuildRitualCadencia }) {
  const slots = slotsForCadencia(cadencia)
  const recent = sessions.slice(0, slots).reverse()
  const padded = Array.from({ length: slots }, (_, i) => {
    const idx = recent.length - (slots - i)
    return idx >= 0 ? recent[idx] : null
  })
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {padded.map((s, i) => {
        const color = !s ? 'transparent' : s.skipped ? COLORS.amber : COLORS.iceLight
        return (
          <span
            key={i}
            title={!s ? '—' : `${s.data_executado}${s.skipped ? ' (pulado)' : ''}`}
            style={{
              flex: 1,
              height: 14,
              background: color,
              border: !s ? `1px solid ${COLORS.border}` : 'none',
              opacity: s ? 1 : 0.4,
            }}
          />
        )
      })}
    </div>
  )
}

function LegendDot({ color, border, label }: { color: string; border?: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          width: 8,
          height: 8,
          background: color,
          border: border ? `1px solid ${COLORS.border}` : 'none',
          opacity: border ? 0.5 : 1,
        }}
      />
      {label}
    </span>
  )
}

function SessionRow({ session, cadencia }: { session: BuildRitualSession; cadencia: BuildRitualCadencia }) {
  const updateSession = useUpdateRitualSession()
  const deleteSession = useDeleteRitualSession()
  const [editing, setEditing] = useState(false)
  const [dataExec, setDataExec] = useState(session.data_executado)
  const [duracao, setDuracao] = useState(session.duracao_min != null ? String(session.duracao_min) : '')
  const [notas, setNotas] = useState(session.notas ?? '')
  const [skipReason, setSkipReason] = useState(session.skip_reason ?? '')

  const accent = session.skipped ? COLORS.amber : COLORS.iceLight

  function save() {
    updateSession.mutate(
      {
        cadencia,
        sessionId: session.id,
        patch: {
          data_executado: dataExec,
          duracao_min: duracao.trim() ? Number(duracao) : null,
          notas: notas.trim() || null,
          skip_reason: session.skipped ? skipReason.trim() || null : session.skip_reason,
        },
      },
      { onSuccess: () => setEditing(false) },
    )
  }

  function del() {
    if (confirm(`Deletar esta sessão de ${fmtDate(session.data_executado)}? Não dá pra desfazer.`)) {
      deleteSession.mutate({ cadencia, sessionId: session.id })
    }
  }

  if (editing) {
    return (
      <div
        style={{
          background: COLORS.panel,
          border: `1px solid ${COLORS.iceLight}`,
          borderLeft: `2px solid ${COLORS.iceLight}`,
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={miniLabel}>DATA</div>
            <input
              type="date"
              value={dataExec}
              onChange={e => setDataExec(e.target.value)}
              style={inputStyle}
            />
          </div>
          {!session.skipped && (
            <div style={{ width: 120 }}>
              <div style={miniLabel}>DURAÇÃO (MIN)</div>
              <input
                type="number"
                value={duracao}
                onChange={e => setDuracao(e.target.value)}
                style={inputStyle}
              />
            </div>
          )}
        </div>
        {session.skipped ? (
          <div>
            <div style={miniLabel}>MOTIVO</div>
            <input
              type="text"
              value={skipReason}
              onChange={e => setSkipReason(e.target.value)}
              maxLength={500}
              style={inputStyle}
            />
          </div>
        ) : (
          <div>
            <div style={miniLabel}>NOTAS</div>
            <textarea
              value={notas}
              onChange={e => setNotas(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={() => setEditing(false)} style={ghostBtn}>
            <X size={11} strokeWidth={2} /> CANCELAR
          </button>
          <button onClick={save} style={iceBtn}>
            <Check size={11} strokeWidth={2} /> SALVAR
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderLeft: `2px solid ${accent}`,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
      }}
    >
      <div style={{ width: 100, flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: COLORS.textPrimary, letterSpacing: '0.04em' }}>
          {fmtDate(session.data_executado)}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: accent, letterSpacing: '0.18em', fontWeight: 700, marginTop: 3 }}>
          {session.skipped ? 'PULADO' : `${session.duracao_min ?? 0}M`}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {session.skipped ? (
          <div style={{ fontSize: 12, color: COLORS.textSecondary, fontStyle: 'italic' }}>
            {session.skip_reason || '—'}
          </div>
        ) : (
          <>
            {session.notas && (
              <div style={{ fontSize: 12, color: COLORS.textSecondary, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {session.notas}
              </div>
            )}
            {session.foco_proxima_periodo && (
              <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>
                <span style={{ ...miniLabel, marginRight: 6 }}>FOCO →</span>
                {session.foco_proxima_periodo}
              </div>
            )}
            {!session.notas && !session.foco_proxima_periodo && (
              <div style={{ fontSize: 11, color: COLORS.textMuted, fontStyle: 'italic' }}>
                Sem anotações.
              </div>
            )}
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button onClick={() => setEditing(true)} title="editar" style={iconBtn}>
          <Pencil size={12} strokeWidth={2} />
        </button>
        <button onClick={del} title="deletar" style={iconBtn}>
          <Trash2 size={12} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

// ─── Styles compartilhadas ───────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 4,
  padding: '6px 8px',
  background: 'rgba(0, 0, 0, 0.4)',
  border: `1px solid ${COLORS.border}`,
  color: COLORS.textPrimary,
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  borderRadius: 0,
}

const ghostBtn: React.CSSProperties = {
  background: 'rgba(8, 12, 18, 0.55)',
  border: `1px solid ${COLORS.border}`,
  color: COLORS.textTertiary,
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.18em',
  padding: '5px 10px',
  cursor: 'pointer',
  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
}

const iceBtn: React.CSSProperties = {
  background: 'rgba(143, 191, 211, 0.10)',
  border: `1px solid rgba(143, 191, 211, 0.45)`,
  color: COLORS.iceLight,
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.18em',
  padding: '5px 10px',
  cursor: 'pointer',
  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  boxShadow: '0 0 10px rgba(143, 191, 211, 0.15)',
}

const iconBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: COLORS.textMuted,
  padding: '4px 6px',
  display: 'inline-flex',
  alignItems: 'center',
}
