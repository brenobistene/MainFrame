/**
 * Hub Lang — layout com tab bar fixa + Outlet (padrão HubFinanceLayout).
 * Doc: docs/lang-lab/PLAN.md §9.
 *
 * MAIN    = dashboard (métricas/evolução — observação)
 * EXEC    = o player de revisão (a execução real; play leva pra cá)
 * ESCRITA = produção escrita com IA tutora (pieces + assist + ask)
 * FALA    = pronúncia (ouvir TTS → gravar → comparar → checar)
 * ACERVO  = browser dos cards (a linguagem que você está construindo)
 * CONFIG  = tudo configurável estilo Anki (steps, retenção, voz, IA)
 */
import { NavLink, Outlet } from 'react-router-dom'

const TABS: { path: string; label: string }[] = [
  { path: '/lang/main',    label: 'MAIN' },
  { path: '/lang/exec',    label: 'EXEC' },
  { path: '/lang/escrita', label: 'ESCRITA' },
  { path: '/lang/fala',    label: 'FALA' },
  { path: '/lang/acervo',  label: 'ACERVO' },
  { path: '/lang/config',  label: 'CONFIG' },
]

export function HubLangLayout() {
  return (
    <div style={{ color: 'var(--color-text-primary)' }}>
      <div className="hq-hairline-ice" />

      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          padding: '12px 18px',
          background: 'linear-gradient(180deg, rgba(10, 14, 22, 0.95), rgba(8, 10, 14, 0.92))',
          borderBottom: '1px solid var(--color-ice-deep)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          minHeight: 56,
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

        <div className="hq-tech-label" style={{
          fontSize: 11,
          color: 'var(--color-ice-light)',
          letterSpacing: '0.28em',
          flexShrink: 0,
        }}>
          LANG.LAB
        </div>

        <div style={{ width: 1, height: 22, background: 'var(--color-border-strong)', flexShrink: 0 }} />

        <nav style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0, overflow: 'auto' }}>
          {TABS.map(t => (
            <NavLink
              key={t.path}
              to={t.path}
              style={({ isActive }) => ({
                padding: '6px 12px',
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
              })}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <div style={{ padding: '24px 4px 48px' }}>
        <Outlet />
      </div>
    </div>
  )
}
