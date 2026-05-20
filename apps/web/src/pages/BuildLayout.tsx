/**
 * /build — Layout com tab bar de sub-páginas + Outlet pra rota ativa.
 *
 * Cabeçalho sticky estilo Hub Finance (mesmo padrão visual de HubFinanceLayout).
 * Tabs:
 *   - PRINCIPAL → /build (Propósito, Visão, Metas, Sprints, Rituais, …)
 *   - HISTÓRIA  → /build/historia (timeline + stats de execuções de rituais)
 *
 * Modais globais (REGRAS, IMPORTAR) do finance não se aplicam aqui — header
 * fica enxuto. Se ações compartilhadas surgirem, plug-na zona da direita.
 */
import { NavLink, Outlet } from 'react-router-dom'

const TABS: { path: string; label: string; end?: boolean }[] = [
  { path: '/build', label: 'PRINCIPAL', end: true },
  { path: '/build/historia', label: 'HISTÓRIA' },
]

export default function BuildLayout() {
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
            left: 0,
            bottom: -1,
            width: 64,
            height: 2,
            background: 'var(--color-ice)',
            boxShadow: '0 0 12px var(--color-ice-glow)',
          }}
        />

        <div
          className="hq-tech-label"
          style={{
            fontSize: 11,
            color: 'var(--color-ice-light)',
            letterSpacing: '0.28em',
            flexShrink: 0,
          }}
        >
          BUILD
        </div>

        <div
          style={{
            width: 1,
            height: 22,
            background: 'var(--color-border-strong)',
            flexShrink: 0,
          }}
        />

        <div style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0, overflow: 'auto' }}>
          {TABS.map((t) => (
            <NavLink
              key={t.path}
              to={t.path}
              end={t.end}
              style={({ isActive }) => ({
                padding: '6px 10px',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: isActive ? 'var(--color-ice-light)' : 'var(--color-text-tertiary)',
                background: isActive ? 'rgba(143, 191, 211, 0.10)' : 'rgba(8, 12, 18, 0.55)',
                border: `1px solid ${isActive ? 'rgba(143, 191, 211, 0.45)' : 'var(--color-border)'}`,
                textDecoration: 'none',
                borderRadius: 0,
                clipPath:
                  'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
                boxShadow: isActive ? '0 0 12px rgba(143, 191, 211, 0.18)' : 'none',
              })}
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </header>

      <Outlet />
    </div>
  )
}
