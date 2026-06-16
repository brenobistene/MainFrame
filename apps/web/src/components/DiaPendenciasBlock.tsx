/**
 * DiaPendenciasBlock — bloco no topo do /dia que junta:
 *  - Rituals do /Build atrasados ou agendados pra hoje (info-only)
 *  - Pendências do Hub Health (registrar sono/alimentação/exercício/etc)
 *
 * Filosofia (decisão do usuário, 2026-05-17):
 *  - Rituals aparecem aqui SÓ como lembrete. Play/pause/finalizar rolam no
 *    card do ritual depois que o user arrasta pra um período. Antes existia
 *    um player local com localStorage aqui — removido em favor da mecânica
 *    cluster-based dos cards (paridade com quest/task/rotina).
 *  - Health aparece como "task pra fazer" simples — click abre RegisterModal.
 */
import { useMemo, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2 } from 'lucide-react'

import { useRituals } from '../lib/build-queries'
import {
  useHealthDomains, useHealthPending,
} from '../lib/health-queries'
import type {
  BuildRitualCadencia, HealthDomain, HealthPendingItem,
} from '../types'
import { colorForDomain } from './health/tokens'
import { domainIconFor } from './health/domainIcon'
import RegisterModal from './health/RegisterModal'
import MindRegisterModal from './mind/MindRegisterModal'

const CADENCIA_LABELS: Record<BuildRitualCadencia, string> = {
  semanal: 'Semanal',
  mensal: 'Mensal',
  trimestral: 'Trimestral',
  anual: 'Anual',
}

const ACCENT_RITUAL = '#dc2531'           // Neomilitarism red
const COLOR_TEXT_MUTED = 'var(--color-text-muted)'

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

// ─── Componente principal ─────────────────────────────────────────────────

export function DiaPendenciasBlock() {
  const { data: rituals = [], isLoading: ritualsLoading } = useRituals()
  const { data: domains = [], isLoading: domainsLoading } = useHealthDomains()
  const { data: pending = [], isLoading: pendingLoading } = useHealthPending()
  // RegisterModal aberto: precisa de domain + cor pra renderizar
  const [openHealthModal, setOpenHealthModal] = useState<{
    domain: HealthDomain
    cor: string
  } | null>(null)

  // Filtra rituals urgentes (atrasados + hoje). Lembrete só some quando o
  // ritual está DONE — `ultima_execucao===hoje AND !cluster_has_active`.
  // Após REABRIR o cluster volta a ativo (record preservado) → lembrete
  // reaparece sem precisar deletar a session.
  const ritualsHoje = useMemo(() => {
    const today = todayIso()
    return rituals.filter(r => {
      if (!r.ativo) return false
      const doneToday = r.ultima_execucao === today && !r.cluster_has_active
      if (doneToday) return false
      if (r.dias_atraso > 0) return true
      if (r.proxima_data && daysFromToday(r.proxima_data) === 0) return true
      return false
    })
  }, [rituals])

  // Mind e Exercício agora aparecem como cards completos no planner (com
  // PLAY/PAUSE/FINALIZAR), então removemos do bloco do topo pra não duplicar.
  // Demais domínios (refeições, sono, etc) continuam aqui como lembrete rápido.
  const pendingFiltered = useMemo(() => {
    return pending.filter(p => p.domain_slug !== 'mind' && p.domain_slug !== 'exercicio')
  }, [pending])

  if (ritualsLoading || domainsLoading || pendingLoading) return null

  // Pra cada pendência health, resolvemos o domain object completo
  function domainOf(slug: string): HealthDomain | undefined {
    return domains.find(d => d.slug === slug)
  }

  const totalPendencias = ritualsHoje.length + pendingFiltered.length

  // Modal renderizado fora do return condicional — sem isso, quando o
  // user salva a ÚLTIMA pendência via auto-save (refeição clicando SIM),
  // `pending` invalida e fica vazio, `totalPendencias` vai pra 0, o
  // componente retornava null e DESMONTAVA O MODAL JUNTO. User via
  // "fecha automaticamente, não dá tempo de editar horário".
  const modalNode = openHealthModal
    ? openHealthModal.domain.template === 'observacao_estruturada'
      ? <MindRegisterModal onClose={() => setOpenHealthModal(null)} />
      : (
        <RegisterModal
          domain={openHealthModal.domain}
          cor={openHealthModal.cor}
          onClose={() => setOpenHealthModal(null)}
        />
      )
    : null

  if (totalPendencias === 0) return modalNode

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

      {/* Rituals primeiro (info-only). Play/pause/finalize rolam no card
          do ritual, depois que user arrasta pro período. */}
      {ritualsHoje.map(r => (
        <RitualRow key={r.cadencia} ritual={r} />
      ))}

      {/* Health pendências (sem player, click abre o modal correto pra
          template do domínio). Mind e Exercício foram removidos — agora
          são cards do planner. */}
      {pendingFiltered.map((p, idx) => (
        <HealthPendingRow
          key={`${p.domain_slug}-${p.tipo}-${idx}`}
          pending={p}
          domain={domainOf(p.domain_slug)}
          onRegistrar={(domain, cor) => setOpenHealthModal({ domain, cor })}
        />
      ))}

      {modalNode}
    </div>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────

function RitualRow({ ritual }: { ritual: { cadencia: BuildRitualCadencia; dias_atraso: number } }) {
  const isAtrasado = ritual.dias_atraso > 0
  const accent = ACCENT_RITUAL
  const subText = isAtrasado
    ? `${CADENCIA_LABELS[ritual.cadencia]} · ${ritual.dias_atraso}d atrasado`
    : `${CADENCIA_LABELS[ritual.cadencia]} · pra hoje`

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
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
