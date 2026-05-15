/**
 * SaveIndicator — pequeno toast global no canto inferior direito que
 * dá feedback visual de que MUTATIONS estão rolando no app inteiro.
 *
 * O hub já tem auto-save por toda parte (debounce em descrições, onBlur
 * em inputs inline, toggles imediatos, drag-reorder, etc) — mas o usuário
 * não SENTE que está salvando porque não há feedback visível. Esse
 * componente preenche essa lacuna sem precisar plugar em cada surface.
 *
 * Funciona observando `useIsMutating()` do TanStack Query — toda mutation
 * (POST/PATCH/PUT/DELETE) registra automaticamente. Sem código por
 * componente.
 *
 * Estados:
 *  - idle           → não renderiza
 *  - saving         → "salvando…" (azul ice, fica enquanto há mutations)
 *  - saved          → "salvo ✓" (verde, 1.5s e fade out)
 *
 * Posição: bottom-right fixed, não bloqueia interação.
 */
import { useEffect, useState } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { CheckCircle2, Loader2 } from 'lucide-react'

type State = 'idle' | 'saving' | 'saved'

const SAVED_VISIBLE_MS = 1500       // tempo que "salvo ✓" permanece

export function SaveIndicator() {
  const isMutating = useIsMutating()
  const [state, setState] = useState<State>('idle')

  useEffect(() => {
    if (isMutating > 0) {
      setState('saving')
      return
    }
    // Voltou a zero — só mostra "salvo ✓" se estávamos salvando antes
    // (evita piscar "salvo" no mount inicial sem nenhuma mutation).
    setState(prev => (prev === 'saving' ? 'saved' : prev))
  }, [isMutating])

  // Auto-esconde o "salvo ✓" depois do tempo configurado
  useEffect(() => {
    if (state !== 'saved') return
    const t = setTimeout(() => setState('idle'), SAVED_VISIBLE_MS)
    return () => clearTimeout(t)
  }, [state])

  if (state === 'idle') return null

  const isSaving = state === 'saving'

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 9999,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '6px 12px',
        background: 'rgba(8, 12, 18, 0.92)',
        border: `1px solid ${isSaving ? 'var(--color-ice-deep)' : 'var(--color-success)'}`,
        borderLeft: `2px solid ${isSaving ? 'var(--color-ice)' : 'var(--color-success)'}`,
        color: isSaving ? 'var(--color-ice-light)' : 'var(--color-success)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        boxShadow: isSaving
          ? '0 0 12px rgba(143, 191, 211, 0.18)'
          : '0 0 12px rgba(94, 122, 82, 0.18)',
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
        animation: 'hq-save-indicator-in 180ms ease-out both',
        pointerEvents: 'none',
      }}
    >
      <style>
        {`@keyframes hq-save-indicator-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes hq-save-indicator-spin {
          to { transform: rotate(360deg); }
        }`}
      </style>
      {isSaving ? (
        <Loader2
          size={11}
          strokeWidth={2}
          style={{
            animation: 'hq-save-indicator-spin 800ms linear infinite',
            color: 'var(--color-ice)',
          }}
        />
      ) : (
        <CheckCircle2 size={11} strokeWidth={2} />
      )}
      <span>{isSaving ? 'salvando…' : 'salvo'}</span>
    </div>
  )
}
