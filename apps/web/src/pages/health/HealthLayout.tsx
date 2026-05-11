/**
 * Hub Health — layout com header band CP2077 + tab bar de sub-páginas.
 *
 * Estrutura coerente com DashboardPage e HubFinanceLayout:
 *   1. Header band stamp (mesma altura ~56px, gradient slate, hairline ice
 *      embaixo, tab marker `// HUB HEALTH`, status techo direito).
 *   2. Tab bar abaixo do header (sticky), uma tab por domínio ativo +
 *      botão settings em `hq-icon-btn`. Tab ativa com border-bottom ice
 *      glow + label em Rajdhani uppercase (var(--font-display)).
 *   3. Glitch line vertical lateral esquerda em ice (não cyan saturado).
 *
 * Fonte do tab label vira display (Rajdhani) — coerente com sidebar do
 * App.tsx e tab bar do Hub Finance. Antes era IBM Plex Mono.
 */
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Settings } from 'lucide-react'

import HealthSettingsModal from '../../components/health/HealthSettingsModal'
import { useHealthDomains } from '../../lib/health-queries'
import { BIO, DISPLAY, colorForDomain } from '../../components/health/tokens'
import { useNowHHMM } from '../../components/health/useNowHHMM'

export default function HealthLayout() {
  const { data: domains = [] } = useHealthDomains()
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div
      style={{
        minHeight: '100vh',
        color: BIO.textPrimary,
        position: 'relative',
        // background: nenhum próprio — herda atmosphere global do body
      }}
    >
      {/* Glitch line vertical lateral — agora em ice, coordena com a
          identidade do tronco em vez de gritar cyan saturado. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: 80,
          bottom: 80,
          width: 1,
          background:
            'linear-gradient(180deg, transparent 0%, var(--color-ice) 30%, var(--color-ice) 70%, transparent 100%)',
          opacity: 0.18,
          boxShadow: '0 0 12px var(--color-ice-glow)',
          pointerEvents: 'none',
        }}
      />

      <HeaderBand />
      <TabBar domains={domains} onOpenSettings={() => setSettingsOpen(true)} />
      <Outlet />
      {settingsOpen && <HealthSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

// ─── Header band CP2077 ──────────────────────────────────────────────────

function HeaderBand() {
  const hhmm = useNowHHMM()
  const today = new Date()
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`

  return (
    <header
      style={{
        position: 'relative',
        padding: '12px 18px',
        background: 'linear-gradient(180deg, rgba(10, 14, 22, 0.92), rgba(8, 10, 14, 0.88))',
        borderBottom: '1px solid var(--color-ice-deep)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-5)',
        minHeight: 56,
      }}
    >
      {/* Tab marker — pequeno trilho ice estendendo abaixo do header.
          Assinatura "tab pull" das HUDs CP2077 (igual Dashboard). */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          bottom: -1,
          width: 64,
          height: 2,
          background: 'var(--color-ice)',
          boxShadow: '0 0 12px var(--color-ice-glow)',
        }}
      />

      <div
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: 1, minWidth: 0 }}
      >
        <div
          className="hq-tech-label"
          style={{
            fontSize: 11,
            color: 'var(--color-ice-light)',
            letterSpacing: '0.28em',
            flexShrink: 0,
          }}
        >
          HUB HEALTH
        </div>
        <div style={{ width: 1, height: 22, background: 'var(--color-border-strong)', flexShrink: 0 }} />
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            color: 'var(--color-text-tertiary)',
            letterSpacing: '0.04em',
            fontStyle: 'italic',
          }}
        >
          prática contínua observada
        </div>
      </div>

      {/* Stack metadata técnico direita — formato Dashboard SW.LINE. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end', flexShrink: 0 }}>
        <div className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
          SCAN @ {hhmm}
        </div>
        <div
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)', display: 'flex', gap: 8, alignItems: 'center' }}
        >
          <span>SW.{ymd}</span>
          <span style={{ color: 'var(--color-success)' }}>· OBSERVE</span>
        </div>
      </div>
    </header>
  )
}

// ─── Tab bar ─────────────────────────────────────────────────────────────

function TabBar({
  domains,
  onOpenSettings,
}: {
  domains: { slug: string; nome: string; cor: string | null }[]
  onOpenSettings: () => void
}) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: 'rgba(10, 14, 22, 0.92)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--color-border)',
        padding: '0 18px',
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        overflowX: 'auto',
      }}
    >
      <Tab to="/health/biomonitor" label="BIOMONITOR" cor="var(--color-ice-light)" />
      {domains.map((d) => (
        <Tab
          key={d.slug}
          to={`/health/${d.slug}`}
          label={d.nome.toUpperCase()}
          cor={colorForDomain(d.slug, d.cor)}
        />
      ))}
      <button
        type="button"
        onClick={onOpenSettings}
        title="Configurações do Hub Health"
        className="hq-icon-btn-bare"
        style={{
          marginLeft: 'auto',
          padding: '0 12px',
          minHeight: 36,
          color: 'var(--color-text-muted)',
        }}
      >
        <Settings size={14} strokeWidth={1.6} />
      </button>
    </div>
  )
}

function Tab({ to, label, cor }: { to: string; label: string; cor: string }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        padding: '11px 16px 9px',
        fontFamily: DISPLAY,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        textDecoration: 'none',
        color: isActive ? cor : 'var(--color-text-tertiary)',
        borderBottom: isActive ? `2px solid ${cor}` : '2px solid transparent',
        marginBottom: -1,
        whiteSpace: 'nowrap',
        transition: 'color var(--motion-fast) var(--ease-smooth), border-color var(--motion-fast) var(--ease-smooth)',
        position: 'relative',
        // Glow sutil na tab ativa — assinatura ice CP2077
        ...(isActive && {
          textShadow: `0 0 8px ${cor === 'var(--color-ice-light)' ? 'var(--color-ice-glow)' : 'rgba(143, 191, 211, 0.20)'}`,
        }),
      })}
    >
      {label}
    </NavLink>
  )
}

