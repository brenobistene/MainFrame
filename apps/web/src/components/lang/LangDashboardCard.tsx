/**
 * Card do Lang Lab no Dashboard — padrão MindDashboardCard: só aparece
 * quando há algo factual a dizer (fila do dia ou ausência). Card sem
 * conteúdo é ruído; dashboard que vira nag é veneno (filosofia da casa).
 * Respeita lang_settings.dashboard_card_visivel.
 */
import { useNavigate } from 'react-router-dom'
import { Languages, Play } from 'lucide-react'

import { useLangSettings, useLangToday } from '../../lib/lang-queries'

export default function LangDashboardCard() {
  const navigate = useNavigate()
  const { data: today } = useLangToday()
  const { data: settings } = useLangSettings()

  const visivel = settings?.dashboard_card_visivel ?? true
  const fila = (today?.due ?? 0) + (today?.novos_disponiveis ?? 0)
  const ausencia = today?.dias_sem_estudo ?? null
  if (!visivel || !today || (fila === 0 && ausencia == null)) return null

  return (
    <div
      className="hq-glass"
      style={{
        border: '1px solid var(--color-border)',
        padding: '14px 18px',
        display: 'flex', alignItems: 'center', gap: 14,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
      }}
    >
      <span style={{ color: 'var(--color-ice)', display: 'flex', flexShrink: 0 }}>
        <Languages size={16} strokeWidth={1.8} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
          letterSpacing: '0.25em', textTransform: 'uppercase',
          color: 'var(--color-ice-light)', marginBottom: 3,
        }}>
          LANG.LAB
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          color: ausencia != null ? 'var(--color-warning)' : 'var(--color-text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {ausencia != null
            ? `SEM ESTUDO HÁ ${ausencia} DIAS`
            : [
                today.due > 0 ? `${today.due} REVIEWS` : null,
                today.novos_disponiveis > 0 ? `${today.novos_disponiveis} NOVOS` : null,
                today.tempo_hoje_min > 0 ? `${today.tempo_hoje_min} MIN HOJE` : null,
              ].filter(Boolean).join(' · ')}
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigate('/lang/exec')}
        title="Estudar agora"
        style={{
          background: 'rgba(143, 191, 211, 0.10)',
          border: '1px solid var(--color-ice)',
          color: 'var(--color-ice-light)',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          fontSize: 9, fontWeight: 700,
          letterSpacing: '0.22em', textTransform: 'uppercase',
          padding: '6px 14px', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        <Play size={11} strokeWidth={2} />
        ESTUDAR
      </button>
    </div>
  )
}
