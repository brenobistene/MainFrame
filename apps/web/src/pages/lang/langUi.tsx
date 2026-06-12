/**
 * Lang Lab · assinaturas visuais do conceito SIGNAL (transceptor RX/TX).
 *
 * RX = recepção (ouvir/reconhecer — o que o usuário já domina) → ice.
 * TX = transmissão (escrever/falar — o que ele veio treinar) → gold-dim
 * (mesma cor que os cards de produção já usavam; não é cor nova).
 *
 * A identidade vem da FORMA: waveform/EQ vivo quando o áudio toca
 * (funcional: mostra que há som), régua de frequência, tags TX/RX,
 * labels de rádio. Tronco comum intacto: dark, mono em números, Lucide,
 * zero gamificação. Sem neon genérico, sem gradient text, sem
 * glassmorphism decorativo (bans do impeccable + DESIGN.md).
 */
import type { CSSProperties } from 'react'

export const RX_COLOR = 'var(--color-ice)'          // recepção
export const RX_LIGHT = 'var(--color-ice-light)'
export const TX_COLOR = 'var(--color-warning)'       // transmissão (gold-dim)

/** Keyframes + reduced-motion guard — montar UMA vez (no HubLangLayout). */
export function LangSignalStyles() {
  return (
    <style>{`
      @keyframes lang-eq {
        0%   { transform: scaleY(0.25); }
        25%  { transform: scaleY(0.95); }
        50%  { transform: scaleY(0.45); }
        75%  { transform: scaleY(0.8); }
        100% { transform: scaleY(0.25); }
      }
      .lang-eq-bar { transform-origin: bottom; transform: scaleY(0.18); }
      .lang-eq-bar--live { animation: lang-eq 0.9s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) {
        .lang-eq-bar--live { animation: none; transform: scaleY(0.6); }
      }
      @keyframes lang-rec-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.25; }
      }
      .lang-rec-dot { animation: lang-rec-pulse 1.4s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) {
        .lang-rec-dot { animation: none; }
      }
    `}</style>
  )
}

/** EQ/waveform — vivo enquanto `active` (áudio tocando), repouso sutil
 *  quando não. Alturas determinísticas (sem Math.random: estável entre
 *  renders). É sinal funcional, não decoração: diz "tem som agora". */
export function Waveform({ active, color = RX_COLOR, bars = 28, height = 22 }: {
  active: boolean
  color?: string
  bars?: number
  height?: number
}) {
  return (
    <div
      aria-hidden="true"
      style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }}
    >
      {Array.from({ length: bars }, (_, i) => {
        // Envelope pseudo-orgânico determinístico (picos no meio).
        const env = 0.35 + 0.65 * Math.sin((i / (bars - 1)) * Math.PI)
        const jitter = ((i * 37) % 13) / 26
        const h = Math.max(3, Math.round(height * env * (0.55 + jitter * 0.45)))
        return (
          <span
            key={i}
            className={`lang-eq-bar${active ? ' lang-eq-bar--live' : ''}`}
            style={{
              width: 2,
              height: h,
              background: color,
              opacity: active ? 0.9 : 0.28,
              animationDelay: active ? `${(i % 7) * 0.09}s` : undefined,
              transition: 'opacity 0.3s ease-out',
            }}
          />
        )
      })}
    </div>
  )
}

/** Tag RX/TX — registro do exercício, não badge de conquista. */
export function TxRxTag({ tx, label }: { tx: boolean; label?: string }) {
  const color = tx ? TX_COLOR : RX_COLOR
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      border: `1px solid ${color}`,
      color,
      fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
      letterSpacing: '0.22em', textTransform: 'uppercase',
      padding: '3px 9px',
      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
    }}>
      <span aria-hidden="true" style={{ width: 6, height: 6, background: color, opacity: 0.85 }} />
      {label ?? (tx ? 'TX · TRANSMISSÃO' : 'RX · RECEPÇÃO')}
    </span>
  )
}

/** Moldura-herói do player: brackets de canto + chamfer (linguagem HUD da
 *  casa, peso onde importa). */
export function SignalFrame({ children, accent = RX_COLOR, style }: {
  children: React.ReactNode
  accent?: string
  style?: CSSProperties
}) {
  const tick: CSSProperties = {
    position: 'absolute', width: 14, height: 14,
    borderColor: accent, borderStyle: 'solid', opacity: 0.85,
  }
  return (
    <div style={{
      position: 'relative',
      border: '1px solid var(--color-ice-deep)',
      background: `
        radial-gradient(ellipse 70% 90% at 50% 0%, rgba(143, 191, 211, 0.05), transparent 70%),
        rgba(8, 12, 18, 0.65)
      `,
      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)',
      ...style,
    }}>
      <span aria-hidden="true" style={{ ...tick, top: -1, left: -1, borderWidth: '2px 0 0 2px' }} />
      <span aria-hidden="true" style={{ ...tick, top: -1, right: -1, borderWidth: '2px 2px 0 0' }} />
      <span aria-hidden="true" style={{ ...tick, bottom: -1, left: -1, borderWidth: '0 0 2px 2px' }} />
      {children}
    </div>
  )
}

/** Régua de frequência — ornamento de identidade (header/divisores). */
export function FreqRuler({ width = 180 }: { width?: number }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: 3, width, overflow: 'hidden' }}>
      {Array.from({ length: Math.floor(width / 7) }, (_, i) => (
        <span
          key={i}
          style={{
            width: 1,
            height: i % 5 === 0 ? 10 : 5,
            background: 'var(--color-ice)',
            opacity: i % 5 === 0 ? 0.55 : 0.25,
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  )
}
