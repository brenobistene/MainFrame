/**
 * ToastPortal — render container pros toasts no canto inferior direito.
 *
 * Mount this ONCE no root do app (App.tsx). Subscribe ao store de toasts
 * e renderiza cada um com animação cyber.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, AlertTriangle, AlertCircle, X } from 'lucide-react'
import { toast, type ToastEntry, type ToastVariant } from '../../lib/toast'

export function ToastPortal() {
  const [items, setItems] = useState<ToastEntry[]>([])
  useEffect(() => toast.subscribe(setItems), [])

  if (items.length === 0) return null

  return createPortal(
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      zIndex: 10000,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      pointerEvents: 'none',
    }}>
      {items.map(t => (
        <ToastCard key={t.id} entry={t} />
      ))}
    </div>,
    document.body,
  )
}

function ToastCard({ entry }: { entry: ToastEntry }) {
  const { accent, glow, icon } = variantStyle(entry.variant)
  return (
    <div
      style={{
        pointerEvents: 'auto',
        minWidth: 280, maxWidth: 380,
        background: 'rgba(8, 12, 18, 0.95)',
        border: '1px solid rgba(143, 191, 211, 0.25)',
        borderLeft: `3px solid ${accent}`,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
        backdropFilter: 'blur(8px)',
        boxShadow: `0 6px 24px rgba(0, 0, 0, 0.5), 0 0 12px ${glow}`,
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        animation: 'hq-toast-in 200ms var(--ease-emphasis) both',
      }}
    >
      <span style={{ color: accent, display: 'inline-flex', flexShrink: 0, marginTop: 1 }}>
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          lineHeight: 1.3,
        }}>
          {entry.title}
        </div>
        {entry.message && (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10, fontWeight: 700,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.08em',
            marginTop: 2,
            lineHeight: 1.4,
          }}>
            {entry.message}
          </div>
        )}
      </div>
      <button
        onClick={() => toast.dismiss(entry.id)}
        title="fechar"
        style={{
          background: 'none', border: 'none',
          color: 'var(--color-text-muted)',
          cursor: 'pointer', padding: 2,
          display: 'inline-flex',
          flexShrink: 0,
        }}
      >
        <X size={11} strokeWidth={2} />
      </button>
    </div>
  )
}

function variantStyle(v: ToastVariant) {
  switch (v) {
    case 'success':
      return {
        accent: 'var(--color-success-light)',
        glow: 'rgba(125, 154, 111, 0.30)',
        icon: <CheckCircle2 size={14} strokeWidth={2} />,
      }
    case 'warning':
      return {
        accent: 'var(--color-accent-light)',
        glow: 'rgba(159, 18, 57, 0.25)',
        icon: <AlertTriangle size={14} strokeWidth={2} />,
      }
    case 'danger':
      return {
        accent: 'var(--color-accent-primary)',
        glow: 'rgba(159, 18, 57, 0.40)',
        icon: <AlertCircle size={14} strokeWidth={2} />,
      }
    default:
      return {
        accent: 'var(--color-ice-light)',
        glow: 'rgba(143, 191, 211, 0.25)',
        icon: <CheckCircle2 size={14} strokeWidth={2} />,
      }
  }
}
