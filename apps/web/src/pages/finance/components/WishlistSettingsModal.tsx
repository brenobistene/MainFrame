/**
 * Modal de configurações da Wishlist — Fase 4.
 *
 * Hoje a única setting é `envelhecimento_threshold_meses` (após quantos
 * meses sem atividade um item ativo ganha badge "parado Xm"). Pode crescer
 * pra incluir: filtros default ao abrir, dias_janela default no Modal
 * Comprar, etc.
 *
 * Sem hardcoded: sistema usa o threshold do servidor; user define o que
 * faz sentido pro próprio ritmo.
 */
import { useState } from 'react'
import { Settings, X } from 'lucide-react'

import {
  fieldLabel, ghostButton, inputStyle, modalBody, modalHairline,
  modalHeader, modalOverlay, modalShell, primaryButton, sectionLabel,
} from './styleHelpers'
import {
  useUpdateWishlistSettings,
  useWishlistSettings,
} from '../../../lib/wishlist-queries'
import { reportApiError } from '../../../api'

export function WishlistSettingsModal({ onClose }: { onClose: () => void }) {
  const { data: settings } = useWishlistSettings()
  const [threshold, setThreshold] = useState(
    String(settings?.envelhecimento_threshold_meses ?? 6),
  )
  const updateMut = useUpdateWishlistSettings()

  const parsed = parseInt(threshold, 10)
  const canSubmit = !isNaN(parsed) && parsed >= 1 && parsed <= 60

  async function handleSubmit() {
    if (!canSubmit) return
    try {
      await updateMut.mutateAsync({
        envelhecimento_threshold_meses: parsed,
      })
      onClose()
    } catch (err) {
      reportApiError('WishlistSettingsModal.save', err)
      alert('Erro ao salvar configurações.')
    }
  }

  return (
    <div onClick={onClose} style={modalOverlay()}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          ...modalShell(),
          minWidth: 440, maxWidth: 520,
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <Settings size={13} strokeWidth={1.8} style={{ color: 'var(--color-text-tertiary)' }} />
          <div style={sectionLabel()}>Configurações da Wishlist</div>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: 4,
              display: 'inline-flex', alignItems: 'center', borderRadius: 0,
            }}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div style={modalBody()}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={fieldLabel()}>Envelhecimento (em meses)</span>
            <input
              autoFocus
              type="number"
              min={1}
              max={60}
              style={inputStyle()}
              value={threshold}
              onChange={e => setThreshold(e.target.value)}
              placeholder="6"
            />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.06em',
                lineHeight: 1.5,
                marginTop: 4,
              }}
            >
              Items ativos parados (sem edição) por mais de <b>{canSubmit ? parsed : '...'}</b> {parsed === 1 ? 'mês' : 'meses'} ganham
              badge "parado Xm" pra te lembrar de reavaliar — ainda quer mesmo
              ou já saiu de moda? Não bloqueia nada, é só visual.
            </span>
          </div>
        </div>

        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--color-ice-deep)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={ghostButton()}>cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              ...primaryButton(),
              opacity: canSubmit ? 1 : 0.4,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            salvar
          </button>
        </div>
      </div>
    </div>
  )
}
