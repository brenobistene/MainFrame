/**
 * Hub Lang — layout com tab bar fixa + Outlet (padrão HubFinanceLayout),
 * vestindo a identidade SIGNAL (transceptor RX/TX — ver langUi.tsx).
 *
 * O header carrega o READOUT DE SESSÃO AO VIVO: a sessão de estudo é do
 * módulo inteiro (cluster), então o cronômetro segue contando quando o
 * usuário vai da EXEC pra ESCRITA ou FALA — e agora dá pra VER isso em
 * qualquer aba (pergunta literal do usuário: "ao dar play eu treino a
 * escrita e fala também?" — sim, e o header mostra).
 */
import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { RadioTower } from 'lucide-react'

import { fetchLangSession } from '../../api'
import type { DiaSessionCluster } from '../../api'
import { FreqRuler, LangSignalStyles } from './langUi'

const TABS: { path: string; label: string; reg?: 'RX' | 'TX' }[] = [
  { path: '/lang/main',    label: 'MAIN' },
  { path: '/lang/exec',    label: 'EXEC',    reg: 'RX' },
  { path: '/lang/escrita', label: 'ESCRITA', reg: 'TX' },
  { path: '/lang/fala',    label: 'FALA',    reg: 'TX' },
  { path: '/lang/fontes',  label: 'FONTES',  reg: 'RX' },
  { path: '/lang/acervo',  label: 'ACERVO' },
  { path: '/lang/config',  label: 'CONFIG' },
]

function fmtMmSs(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Cronômetro da sessão do módulo — visível em TODAS as abas. */
function SessionReadout() {
  const [cluster, setCluster] = useState<DiaSessionCluster | null>(null)
  const fetchedAtRef = useRef(0)
  const [, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    function load() {
      fetchLangSession()
        .then(c => {
          if (cancelled) return
          fetchedAtRef.current = Date.now()
          setCluster(c)
        })
        .catch(() => undefined)
    }
    load()
    const poll = setInterval(load, 15_000)
    const tick = setInterval(() => setTick(t => t + 1), 1_000)
    function onChanged() { load() }
    window.addEventListener('hq-session-changed', onChanged)
    return () => {
      cancelled = true
      clearInterval(poll)
      clearInterval(tick)
      window.removeEventListener('hq-session-changed', onChanged)
    }
  }, [])

  if (!cluster?.has_active) return null
  const extra = cluster.is_running
    ? Math.floor((Date.now() - fetchedAtRef.current) / 1000)
    : 0
  const elapsed = (cluster.elapsed_seconds ?? 0) + extra

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <span
        aria-hidden="true"
        className={cluster.is_running ? 'lang-rec-dot' : undefined}
        style={{
          width: 8, height: 8,
          background: cluster.is_running ? 'var(--color-accent-primary)' : 'var(--color-success)',
          boxShadow: cluster.is_running ? '0 0 8px rgba(159, 18, 57, 0.6)' : 'none',
        }}
      />
      <span style={{
        fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
        fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
        color: cluster.is_running ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
      }}>
        {fmtMmSs(elapsed)}
      </span>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 8.5, fontWeight: 700,
        letterSpacing: '0.2em', color: 'var(--color-text-muted)', textTransform: 'uppercase',
      }}>
        {cluster.is_running ? 'EM SESSÃO · TODAS AS ABAS CONTAM' : 'SESSÃO PAUSADA'}
      </span>
    </div>
  )
}

export function HubLangLayout() {
  return (
    <div style={{ color: 'var(--color-text-primary)' }}>
      <LangSignalStyles />
      <div className="hq-hairline-ice" />

      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          padding: '12px 18px',
          background: `
            radial-gradient(ellipse 45% 120% at 8% 0%, rgba(143, 191, 211, 0.07), transparent 65%),
            linear-gradient(180deg, rgba(10, 14, 22, 0.96), rgba(8, 10, 14, 0.93))
          `,
          borderBottom: '1px solid var(--color-ice-deep)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          minHeight: 60,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0, bottom: -1,
            width: 64, height: 2,
            background: 'var(--color-ice)',
            boxShadow: '0 0 12px var(--color-ice-glow)',
          }}
        />

        {/* Identidade: glyph + nome + sub-label de rádio */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <RadioTower size={16} strokeWidth={1.6} color="var(--color-ice)" aria-hidden="true" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div className="hq-tech-label" style={{
              fontSize: 11,
              color: 'var(--color-ice-light)',
              letterSpacing: '0.28em',
            }}>
              LANG.LAB
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 600,
              letterSpacing: '0.3em', color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
            }}>
              SIGNAL TRAINER · EN-US
            </div>
          </div>
        </div>

        <div style={{ width: 1, height: 26, background: 'var(--color-border-strong)', flexShrink: 0 }} />

        <nav style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0, overflow: 'auto' }}>
          {TABS.map(t => (
            <NavLink
              key={t.path}
              to={t.path}
              style={({ isActive }) => ({
                display: 'inline-flex', alignItems: 'baseline', gap: 6,
                padding: '7px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: 9, fontWeight: 700,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                color: isActive ? 'var(--color-ice-light)' : 'var(--color-text-tertiary)',
                background: isActive ? 'rgba(143, 191, 211, 0.10)' : 'rgba(8, 12, 18, 0.55)',
                border: `1px solid ${isActive ? 'rgba(143, 191, 211, 0.45)' : 'var(--color-border)'}`,
                textDecoration: 'none',
                borderRadius: 0,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap' as const,
                boxShadow: isActive ? '0 0 12px rgba(143, 191, 211, 0.18)' : 'none',
                cursor: 'pointer',
              })}
            >
              {t.label}
              {t.reg && (
                <span style={{
                  fontSize: 7, letterSpacing: '0.12em',
                  color: t.reg === 'TX' ? 'var(--color-warning)' : 'var(--color-ice)',
                  opacity: 0.8,
                }}>
                  {t.reg}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <SessionReadout />

        <div style={{ flexShrink: 0, opacity: 0.7 }}>
          <FreqRuler width={120} />
        </div>
      </header>

      <div style={{ padding: '24px 4px 48px' }}>
        <Outlet />
      </div>
    </div>
  )
}
