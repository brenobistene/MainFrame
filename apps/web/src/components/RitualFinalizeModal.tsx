/**
 * RitualFinalizeModal — modal pra finalizar (ou pular) um ritual na /exec.
 *
 * Diferente do RitualReviewModal de /build:
 *  - Sem MindContextPanel (mais leve, abre rápido durante execução)
 *  - Pré-preenche `duração` com o tempo do cluster (cronômetro)
 *  - Notas + foco da próxima são OBRIGATÓRIOS no modo "completar" (button
 *    desabilita até ambos preenchidos). Filosofia: ritual sem reflexão
 *    escrita é só checkmark — força o usuário a destilar a sessão.
 *  - Modo "pular": skipReason opcional, sem notas/foco.
 *
 * Onsubmit:
 *  1. createRitualSession (upsert por data_executado)
 *  2. linkRitualClusterToRecord (linka cluster.rows à session)
 *  3. invalidações + onClose
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'

import type { BuildRitual, BuildRitualCadencia } from '../types'
import {
  useCreateRitualSession,
} from '../lib/build-queries'
import { useLinkRitualClusterToRecord } from '../lib/dia-queries'
import { reportApiError } from '../api'

const CADENCIA_LABELS: Record<BuildRitualCadencia, string> = {
  semanal: 'Semanal',
  mensal: 'Mensal',
  trimestral: 'Trimestral',
  anual: 'Anual',
}

const FOCO_LABEL: Record<BuildRitualCadencia, string> = {
  semanal: 'PRÓXIMA SEMANA',
  mensal: 'PRÓXIMA RODADA MENSAL',
  trimestral: 'PRÓXIMA RODADA TRIMESTRAL',
  anual: 'PRÓXIMA RODADA ANUAL',
}

const RITUAL_ACCENT = '#dc2531'

export function RitualFinalizeModal({
  ritual,
  prefillDuracaoMin,
  onClose,
  onSuccess,
}: {
  ritual: BuildRitual
  /** Tempo do cluster em min — pré-preenche o campo "Duração". */
  prefillDuracaoMin: number | null
  onClose: () => void
  /** Chamado após session criada + cluster linkado com sucesso. */
  onSuccess: () => void
}) {
  const cadencia = ritual.cadencia
  const createSession = useCreateRitualSession()
  const linkCluster = useLinkRitualClusterToRecord()
  const today = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  const [mode, setMode] = useState<'completar' | 'pular'>('completar')
  const [dataExec, setDataExec] = useState(today)
  const [duracao, setDuracao] = useState(prefillDuracaoMin != null ? String(prefillDuracaoMin) : '')
  const [notas, setNotas] = useState('')
  const [focoProx, setFocoProx] = useState('')
  const [skipReason, setSkipReason] = useState('')

  const isPending = createSession.isPending || linkCluster.isPending

  // Validação: completar exige notas + foco preenchidos (depois de trim).
  // Skip não exige nada — motivo é opcional. Sem essa regra a UI deixava
  // o usuário "concluir" ritual sem reflexão escrita, o que mata o sentido.
  const canSubmit = (() => {
    if (isPending) return false
    if (mode === 'pular') return true
    return notas.trim().length > 0 && focoProx.trim().length > 0
  })()

  function submit() {
    if (!canSubmit) return
    const isSkip = mode === 'pular'
    const body = {
      data_executado: dataExec,
      duracao_min: isSkip ? null : duracao.trim() ? Number(duracao) : null,
      notas: isSkip ? null : notas.trim() || null,
      foco_proxima_periodo: isSkip ? null : focoProx.trim() || null,
      skipped: isSkip,
      skip_reason: isSkip ? skipReason.trim() || null : null,
    }
    createSession.mutate(
      { cadencia, body },
      {
        onSuccess: (created: any) => {
          if (created?.id) {
            linkCluster.mutate(
              { cadencia, recordId: created.id },
              {
                onSuccess: () => {
                  onSuccess()
                  onClose()
                },
                onError: (err) => reportApiError('RitualFinalizeModal.linkCluster', err),
              },
            )
          } else {
            onSuccess()
            onClose()
          }
        },
        onError: (err) => reportApiError('RitualFinalizeModal.createSession', err),
      },
    )
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        overflow: 'hidden',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, calc(100vw - 32px))',
          background: '#0b0d12',
          border: `1px solid ${RITUAL_ACCENT}`,
          padding: '24px 28px',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          boxSizing: 'border-box',
          boxShadow: 'var(--shadow-modal), 0 0 0 1px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.28em',
            color: RITUAL_ACCENT,
            fontWeight: 700,
          }}>
            ❰ RITUAL · {CADENCIA_LABELS[cadencia].toUpperCase()}
          </div>
          <button
            onClick={onClose}
            aria-label="fechar"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--color-text-muted)',
          marginBottom: 18,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}>
          duração alvo: {ritual.duracao_alvo_min} min
        </div>

        {/* Direcionamentos */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
          <div style={{
            border: '1px solid rgba(143, 191, 211, 0.35)',
            padding: '10px 12px',
            background: 'rgba(143, 191, 211, 0.05)',
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: 'var(--color-ice-light)',
              letterSpacing: '0.22em',
              fontWeight: 700,
              marginBottom: 6,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <Check size={11} strokeWidth={2.5} />
              O QUE PENSAR
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--color-text-primary)',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}>
              {ritual.direcionamento_pensar || '—'}
            </div>
          </div>
          <div style={{
            border: `1px solid ${RITUAL_ACCENT}55`,
            padding: '10px 12px',
            background: `${RITUAL_ACCENT}08`,
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: RITUAL_ACCENT,
              letterSpacing: '0.22em',
              fontWeight: 700,
              marginBottom: 6,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <X size={11} strokeWidth={2.5} />
              O QUE NÃO PENSAR
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--color-text-primary)',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}>
              {ritual.direcionamento_evitar || '—'}
            </div>
          </div>
        </div>

        {/* Mode toggle */}
        <div style={{
          display: 'flex',
          gap: 6,
          marginBottom: 14,
          paddingTop: 12,
          borderTop: '1px dashed var(--color-border)',
        }}>
          {(['completar', 'pular'] as const).map((m) => {
            const active = mode === m
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                style={{
                  background: active ? RITUAL_ACCENT : 'transparent',
                  color: active ? '#000' : 'var(--color-text-secondary)',
                  border: `1px solid ${active ? RITUAL_ACCENT : 'var(--color-border)'}`,
                  padding: '5px 12px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  borderRadius: 0,
                }}
              >
                {m === 'completar' ? 'completar' : 'pular esta rodada'}
              </button>
            )
          })}
        </div>

        {/* Data + Duração */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel>DATA</FieldLabel>
            <input
              type="date"
              value={dataExec}
              onChange={(e) => setDataExec(e.target.value)}
              style={inputStyle}
            />
          </div>
          {mode === 'completar' && (
            <div style={{ width: 140 }}>
              <FieldLabel>DURAÇÃO (MIN)</FieldLabel>
              <input
                type="number"
                value={duracao}
                onChange={(e) => setDuracao(e.target.value)}
                placeholder={String(ritual.duracao_alvo_min)}
                style={inputStyle}
              />
            </div>
          )}
        </div>

        {mode === 'pular' ? (
          <div style={{ marginBottom: 12 }}>
            <FieldLabel>MOTIVO (OPC)</FieldLabel>
            <input
              type="text"
              value={skipReason}
              onChange={(e) => setSkipReason(e.target.value)}
              placeholder='ex.: "viagem", "doente", "sobreposição"'
              maxLength={500}
              style={inputStyle}
            />
            <div style={{
              fontSize: 10,
              color: 'var(--color-text-muted)',
              marginTop: 6,
              fontStyle: 'italic',
            }}>
              Pular preserva o schedule sem virar falso positivo de atraso.
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <FieldLabel required>NOTAS DA REFLEXÃO</FieldLabel>
              <textarea
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="o que saiu da reflexão? (visível só pra você)"
                rows={4}
                style={textareaStyle}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <FieldLabel required>FOCO DA {FOCO_LABEL[cadencia]}</FieldLabel>
              <textarea
                value={focoProx}
                onChange={(e) => setFocoProx(e.target.value)}
                placeholder="1-2 Metas como foco explícito"
                rows={2}
                style={textareaStyle}
              />
            </div>
          </>
        )}

        {/* Validation message — explica por que o botão tá desabilitado */}
        {mode === 'completar' && !canSubmit && !isPending && (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.08em',
            fontStyle: 'italic',
            marginTop: 8,
            marginBottom: 4,
          }}>
            preencha NOTAS e FOCO pra finalizar
          </div>
        )}

        {/* Actions */}
        <div style={{ marginTop: 18, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            type="button"
            style={{
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.18em',
              padding: '6px 14px',
              cursor: 'pointer',
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <X size={12} strokeWidth={2} />
            CANCELAR
          </button>
          <button
            onClick={submit}
            type="button"
            disabled={!canSubmit}
            style={{
              background: canSubmit ? `${RITUAL_ACCENT}22` : 'rgba(8, 12, 18, 0.4)',
              border: `1px solid ${canSubmit ? RITUAL_ACCENT : 'var(--color-border)'}`,
              color: canSubmit ? RITUAL_ACCENT : 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.18em',
              padding: '6px 14px',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              boxShadow: canSubmit ? `0 0 10px ${RITUAL_ACCENT}33` : 'none',
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              opacity: canSubmit ? 1 : 0.5,
            }}
          >
            <Check size={12} strokeWidth={2} />
            {isPending ? '...' : mode === 'pular' ? 'PULAR' : 'FINALIZAR'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.2em',
      color: 'var(--color-text-muted)',
      textTransform: 'uppercase',
      marginBottom: 4,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
    }}>
      {children}
      {required && <span style={{ color: RITUAL_ACCENT }}>*</span>}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 4,
  padding: '7px 10px',
  background: 'rgba(0, 0, 0, 0.4)',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  borderRadius: 0,
  boxSizing: 'border-box',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  fontFamily: 'var(--font-body)',
  lineHeight: 1.5,
}
