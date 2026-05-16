/**
 * Card "Próximo Ritual" — surface única do estrategista (/Build) em páginas
 * operacionais. Surface deliberada (decisão #15 do PLAN /Build): Ritual é
 * a única coisa estratégica com urgência real → merece exceção à regra
 * "operações ficam limpas".
 *
 * Comportamento:
 * - Se há rituais atrasados: card vermelho com count + label do mais antigo
 * - Senão: card sóbrio mostrando próxima execução (label + countdown)
 * - Click → navega pra /build
 *
 * Reusável em DashboardPage hoje. Pode entrar em DiaPage / CalendarPage no
 * futuro se a surface ali fizer sentido.
 */
import { useNavigate } from 'react-router-dom'
import { Activity, AlertTriangle, ChevronRight } from 'lucide-react'

import { useRituals } from '../lib/build-queries'
import type { BuildRitual, BuildRitualCadencia } from '../types'

const CADENCIA_LABELS: Record<BuildRitualCadencia, string> = {
  semanal: 'Semanal',
  mensal: 'Mensal',
  trimestral: 'Trimestral',
  anual: 'Anual',
}

function daysFromToday(iso: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${iso}T00:00:00`)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function fmtDateShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function RitualNextCard({ urgentOnly = false }: { urgentOnly?: boolean }) {
  const navigate = useNavigate()
  const { data: rituals = [], isLoading } = useRituals()

  if (isLoading) return null
  if (rituals.length === 0) return null

  const ativos = rituals.filter((r) => r.ativo)
  if (ativos.length === 0) return null

  const atrasados = ativos.filter((r) => r.dias_atraso > 0)
  const proximo = pickProximo(ativos)
  const proximoIsHoje = proximo?.proxima_data ? daysFromToday(proximo.proxima_data) === 0 : false

  // Modo `urgentOnly`: só renderiza quando há ritual atrasado OU agendado
  // pra hoje. Usado no Dia/Calendar — operação fica limpa quando não há
  // urgência. Modo default (urgentOnly=false): sempre renderiza próximo.
  if (urgentOnly && atrasados.length === 0 && !proximoIsHoje) return null

  const isAtrasado = atrasados.length > 0
  const accent = '#dc2531' // Neomilitarism accent
  const muted = 'var(--color-text-muted, #6a7079)'

  return (
    <button
      type="button"
      onClick={() => navigate('/build')}
      style={{
        background: isAtrasado
          ? `linear-gradient(90deg, ${accent}0d 0%, transparent 45%), transparent`
          : 'transparent',
        border: `1px solid ${isAtrasado ? accent : 'var(--color-border)'}`,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        width: '100%',
      }}
    >
      <span
        style={{
          color: isAtrasado ? accent : muted,
          display: 'flex',
        }}
      >
        {isAtrasado ? <AlertTriangle size={16} /> : <Activity size={16} />}
      </span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color: isAtrasado ? accent : muted,
            fontWeight: 700,
          }}
        >
          {isAtrasado
            ? `${atrasados.length} ritual${atrasados.length === 1 ? '' : 'is'} atrasado${atrasados.length === 1 ? '' : 's'}`
            : 'próximo ritual'}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {isAtrasado
            ? formatAtrasadoLabel(atrasados[0])
            : proximo
            ? formatProximoLabel(proximo)
            : 'sem próximo agendado'}
        </div>
      </div>
      <ChevronRight size={14} style={{ color: muted, flexShrink: 0 }} />
    </button>
  )
}

function pickProximo(ativos: BuildRitual[]): BuildRitual | null {
  // Próximo = menor data (no futuro) entre os ativos. Empate → cadência mais curta primeiro.
  const ordemCadencia: Record<BuildRitualCadencia, number> = {
    semanal: 1, mensal: 2, trimestral: 3, anual: 4,
  }
  const futuros = ativos.filter((r) => r.proxima_data && r.dias_atraso === 0)
  if (futuros.length === 0) return null
  const sorted = [...futuros].sort((a, b) => {
    const da = a.proxima_data ?? ''
    const db = b.proxima_data ?? ''
    if (da !== db) return da.localeCompare(db)
    return ordemCadencia[a.cadencia] - ordemCadencia[b.cadencia]
  })
  return sorted[0]
}

function formatAtrasadoLabel(r: BuildRitual): string {
  return `${CADENCIA_LABELS[r.cadencia]} · ${r.dias_atraso}d atrasado`
}

function formatProximoLabel(r: BuildRitual): string {
  if (!r.proxima_data) return CADENCIA_LABELS[r.cadencia]
  const d = daysFromToday(r.proxima_data)
  const when = d === 0 ? 'hoje' : d === 1 ? 'amanhã' : `em ${d}d · ${fmtDateShort(r.proxima_data)}`
  return `${CADENCIA_LABELS[r.cadencia]} ${when}`
}
