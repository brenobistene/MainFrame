/**
 * DiaPendenciasBlock — bloco no topo do /dia que junta:
 *  - Rituals do /Build atrasados ou agendados pra hoje (com play/pause/stop)
 *  - Pendências do Hub Health (registrar sono/alimentação/exercício/etc)
 *
 * Filosofia (decisão do usuário, 2026-05-12):
 *  - Health: aparece como "task pra fazer" simples, SEM player — registrar
 *    é rápido. Click abre RegisterModal direto do domínio correto.
 *  - Rituals: aparecem COM play/pause/stop — são execuções de tempo (revisão
 *    semanal, planejamento mensal). Tempo decorrido vira `duracao_min` da
 *    ritual session quando finaliza.
 *
 * Substitui o `<RitualNextCard urgentOnly />` no /dia (que era só um link).
 * O RitualNextCard continua disponível pra outras telas (Dashboard etc).
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, CheckCircle2, Pause, Play, Square,
} from 'lucide-react'

import { useRituals, useCreateRitualSession } from '../lib/build-queries'
import {
  useHealthDomains, useHealthPending,
} from '../lib/health-queries'
import type {
  BuildRitual, BuildRitualCadencia, HealthDomain, HealthPendingItem,
} from '../types'
import { reportApiError } from '../api'
import { colorForDomain } from './health/tokens'
import { domainIconFor } from './health/domainIcon'
import RegisterModal from './health/RegisterModal'

const CADENCIA_LABELS: Record<BuildRitualCadencia, string> = {
  semanal: 'Semanal',
  mensal: 'Mensal',
  trimestral: 'Trimestral',
  anual: 'Anual',
}

const ACCENT_RITUAL = '#dc2531'           // Neomilitarism red
const COLOR_TEXT_MUTED = 'var(--color-text-muted)'

// ─── Player de ritual (estado local, persistido em localStorage) ──────────

type RitualPlayerState = {
  ritualId: string
  accumulatedMs: number       // tempo acumulado em pausas anteriores
  lastStartMs: number | null  // null = pausado; setado = rodando
}

const PLAYER_STORAGE_KEY = 'hq-ritual-player-v1'

function loadPlayer(): RitualPlayerState | null {
  try {
    const raw = localStorage.getItem(PLAYER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RitualPlayerState>
    if (typeof parsed.ritualId !== 'string') return null
    if (typeof parsed.accumulatedMs !== 'number') return null
    return {
      ritualId: parsed.ritualId,
      accumulatedMs: parsed.accumulatedMs,
      lastStartMs: typeof parsed.lastStartMs === 'number' ? parsed.lastStartMs : null,
    }
  } catch {
    return null
  }
}

function savePlayer(p: RitualPlayerState | null): void {
  try {
    if (p === null) localStorage.removeItem(PLAYER_STORAGE_KEY)
    else localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* localStorage cheio/proibido — ignora silenciosamente */
  }
}

function daysFromToday(iso: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${iso}T00:00:00`)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function todayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtHMS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(ss)}`
  return `${pad(m)}:${pad(ss)}`
}

// ─── Componente principal ─────────────────────────────────────────────────

export function DiaPendenciasBlock() {
  const { data: rituals = [], isLoading: ritualsLoading } = useRituals()
  const { data: domains = [], isLoading: domainsLoading } = useHealthDomains()
  const { data: pending = [], isLoading: pendingLoading } = useHealthPending()
  const createSession = useCreateRitualSession()

  // Player restaurado do localStorage (sobrevive refresh) — timer continua
  // marcando mesmo se você fechou a aba e voltou. Pra rituais longos isso
  // evita perder o tempo decorrido por engano.
  const [player, setPlayer] = useState<RitualPlayerState | null>(() => loadPlayer())
  const [tick, setTick] = useState(0)            // força re-render do timer
  const [doneRituals, setDoneRituals] = useState<Set<string>>(new Set())

  // Persiste qualquer mudança do player
  useEffect(() => {
    savePlayer(player)
  }, [player])
  // RegisterModal aberto: precisa de domain + cor pra renderizar
  const [openHealthModal, setOpenHealthModal] = useState<{
    domain: HealthDomain
    cor: string
  } | null>(null)

  // Tick de 1s pra atualizar timer visual enquanto algum ritual roda
  useEffect(() => {
    if (!player || player.lastStartMs === null) return
    const iv = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(iv)
  }, [player])

  // Filtra rituals urgentes (atrasados + hoje), exclui já-feitos no client
  const ritualsHoje = useMemo(() => {
    return rituals.filter(r => {
      if (!r.ativo) return false
      if (doneRituals.has(r.cadencia)) return false
      if (r.dias_atraso > 0) return true
      if (r.proxima_data && daysFromToday(r.proxima_data) === 0) return true
      return false
    })
  }, [rituals, doneRituals])

  if (ritualsLoading || domainsLoading || pendingLoading) return null

  const totalPendencias = ritualsHoje.length + pending.length
  if (totalPendencias === 0) return null

  // Pra cada pendência health, resolvemos o domain object completo
  function domainOf(slug: string): HealthDomain | undefined {
    return domains.find(d => d.slug === slug)
  }

  // ── Handlers do player ──
  function togglePlayPause(ritualId: string) {
    setPlayer(prev => {
      // Trocando de ritual: se já tinha um rolando, descarta
      if (prev && prev.ritualId !== ritualId) {
        return { ritualId, accumulatedMs: 0, lastStartMs: Date.now() }
      }
      if (!prev || prev.ritualId !== ritualId) {
        return { ritualId, accumulatedMs: 0, lastStartMs: Date.now() }
      }
      // Mesmo ritual: alterna pause/resume
      if (prev.lastStartMs === null) {
        return { ...prev, lastStartMs: Date.now() }
      }
      const elapsed = Date.now() - prev.lastStartMs
      return { ...prev, accumulatedMs: prev.accumulatedMs + elapsed, lastStartMs: null }
    })
  }

  async function stopAndComplete(ritual: BuildRitual) {
    // Calcula tempo total (0 se não tinha player ativo)
    let totalMs = 0
    if (player && player.ritualId === ritual.cadencia) {
      totalMs = player.accumulatedMs
      if (player.lastStartMs !== null) totalMs += Date.now() - player.lastStartMs
    }
    const totalMin = totalMs > 0 ? Math.max(1, Math.round(totalMs / 60000)) : null

    // Confirma antes de marcar como feito — Stop é destrutivo (ritual sai
    // da lista; pra reabrir tem que apagar a session em /build).
    const tempoLabel = totalMin ? `${totalMin} min` : 'sem timer'
    const ok = window.confirm(
      `Finalizar Ritual ${CADENCIA_LABELS[ritual.cadencia]} agora?\n\n` +
      `Duração registrada: ${tempoLabel}.\n` +
      `Pra desfazer depois, vá em /build e apague a session.`,
    )
    if (!ok) return

    try {
      await createSession.mutateAsync({
        cadencia: ritual.cadencia,
        body: { data_executado: todayIso(), duracao_min: totalMin },
      })
      if (player && player.ritualId === ritual.cadencia) setPlayer(null)
      setDoneRituals(prev => new Set(prev).add(ritual.cadencia))
    } catch (err) {
      reportApiError('DiaPendenciasBlock.stopRitual', err)
      alert('Erro ao finalizar ritual.')
    }
  }

  function ritualElapsedSec(ritualId: string): number {
    if (!player || player.ritualId !== ritualId) return 0
    let ms = player.accumulatedMs
    if (player.lastStartMs !== null) ms += Date.now() - player.lastStartMs
    // tick é usado pra forçar re-render; lemos abaixo só pra TS não reclamar
    void tick
    return Math.floor(ms / 1000)
  }

  return (
    <div
      style={{
        marginBottom: 12,
        display: 'flex', flexDirection: 'column', gap: 6,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 9, fontWeight: 700,
          letterSpacing: '0.25em', textTransform: 'uppercase',
          color: COLOR_TEXT_MUTED,
        }}
      >
        <span style={{ color: 'var(--color-ice)', opacity: 0.85 }}>//</span>
        PENDÊNCIAS HOJE
        <span style={{ color: 'var(--color-text-secondary)' }}>
          [{String(totalPendencias).padStart(2, '0')}]
        </span>
      </div>

      {/* Rituals primeiro (com player) */}
      {ritualsHoje.map(r => (
        <RitualRow
          key={r.cadencia}
          ritual={r}
          isActive={player?.ritualId === r.cadencia}
          isRunning={!!player && player.ritualId === r.cadencia && player.lastStartMs !== null}
          elapsedSec={ritualElapsedSec(r.cadencia)}
          onTogglePlayPause={() => togglePlayPause(r.cadencia)}
          onStop={() => stopAndComplete(r)}
        />
      ))}

      {/* Health pendências (sem player, click abre RegisterModal) */}
      {pending.map((p, idx) => (
        <HealthPendingRow
          key={`${p.domain_slug}-${p.tipo}-${idx}`}
          pending={p}
          domain={domainOf(p.domain_slug)}
          onRegistrar={(domain, cor) => setOpenHealthModal({ domain, cor })}
        />
      ))}

      {/* Modal de registro */}
      {openHealthModal && (
        <RegisterModal
          domain={openHealthModal.domain}
          cor={openHealthModal.cor}
          onClose={() => setOpenHealthModal(null)}
        />
      )}
    </div>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────

function RitualRow({
  ritual, isActive, isRunning, elapsedSec,
  onTogglePlayPause, onStop,
}: {
  ritual: BuildRitual
  isActive: boolean
  isRunning: boolean
  elapsedSec: number
  onTogglePlayPause: () => void
  onStop: () => void
}) {
  const isAtrasado = ritual.dias_atraso > 0
  const accent = ACCENT_RITUAL
  const subText = (() => {
    if (isAtrasado) {
      return `${CADENCIA_LABELS[ritual.cadencia]} · ${ritual.dias_atraso}d atrasado`
    }
    return `${CADENCIA_LABELS[ritual.cadencia]} · pra hoje`
  })()

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto auto',
        gap: 10,
        alignItems: 'center',
        padding: '8px 12px',
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid var(--color-border)',
        borderLeft: `2px solid ${accent}`,
      }}
    >
      <span style={{ color: isAtrasado ? accent : COLOR_TEXT_MUTED, display: 'flex' }}>
        {isAtrasado ? <AlertTriangle size={14} /> : <Activity size={14} />}
      </span>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13, fontWeight: 600,
            color: 'var(--color-text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          Ritual {CADENCIA_LABELS[ritual.cadencia]}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            letterSpacing: '0.22em', textTransform: 'uppercase',
            color: isAtrasado ? accent : COLOR_TEXT_MUTED,
          }}
        >
          {subText}
        </span>
      </div>

      {/* Cronômetro decorrido */}
      {isActive && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12, fontWeight: 700,
            color: isRunning ? 'var(--color-ice-light)' : COLOR_TEXT_MUTED,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: 0,
          }}
        >
          {fmtHMS(elapsedSec)}
        </span>
      )}

      {/* Play / Pause */}
      <button
        type="button"
        onClick={onTogglePlayPause}
        title={isRunning ? 'Pausar' : (isActive ? 'Continuar' : 'Iniciar')}
        style={{
          background: isRunning ? 'rgba(143, 191, 211, 0.10)' : 'transparent',
          border: `1px solid ${isRunning ? 'var(--color-ice)' : 'var(--color-border)'}`,
          color: isRunning ? 'var(--color-ice-light)' : COLOR_TEXT_MUTED,
          cursor: 'pointer',
          padding: '4px 8px',
          display: 'inline-flex', alignItems: 'center',
        }}
      >
        {isRunning
          ? <Pause size={12} strokeWidth={2} />
          : <Play size={12} strokeWidth={2} />}
      </button>

      {/* Stop / Finalizar */}
      <button
        type="button"
        onClick={onStop}
        title="Finalizar ritual"
        style={{
          background: 'transparent',
          border: `1px solid ${accent}`,
          color: accent,
          cursor: 'pointer',
          padding: '4px 8px',
          display: 'inline-flex', alignItems: 'center',
        }}
      >
        <Square size={12} strokeWidth={2} />
      </button>
    </div>
  )
}

function HealthPendingRow({
  pending, domain, onRegistrar,
}: {
  pending: HealthPendingItem
  domain: HealthDomain | undefined
  onRegistrar: (domain: HealthDomain, cor: string) => void
}) {
  if (!domain) return null
  const cor = colorForDomain(domain.slug, domain.cor)
  const Icon = domainIconFor(domain.icone, domain.template)
  const isAusencia = pending.tipo === 'ausencia'

  // Texto principal: nome do domínio + (item se for específico)
  const titulo = pending.item_nome
    ? `${domain.nome} · ${pending.item_nome}`
    : domain.nome

  // Sub-texto: descricao do pending (já vem formatado do backend)
  const sub = pending.descricao
    .toUpperCase()
    .replace(/\s+/g, ' ')

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 10,
        alignItems: 'center',
        padding: '8px 12px',
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid var(--color-border)',
        borderLeft: `2px solid ${cor}`,
      }}
    >
      <span style={{ color: cor, display: 'flex' }}>
        <Icon size={14} strokeWidth={1.8} />
      </span>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13, fontWeight: 600,
            color: 'var(--color-text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {titulo}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: isAusencia ? 'var(--color-warning)' : COLOR_TEXT_MUTED,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {sub}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onRegistrar(domain, cor)}
        title="Registrar agora"
        style={{
          background: 'rgba(143, 191, 211, 0.10)',
          border: '1px solid var(--color-ice)',
          color: 'var(--color-ice-light)',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          fontSize: 9, fontWeight: 700,
          letterSpacing: '0.22em', textTransform: 'uppercase',
          padding: '5px 12px',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}
      >
        <CheckCircle2 size={11} strokeWidth={2} />
        Registrar
      </button>
    </div>
  )
}
