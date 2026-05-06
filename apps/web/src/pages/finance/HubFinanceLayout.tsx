/**
 * Hub Finance — layout com tab bar de sub-páginas + Outlet pra rota ativa.
 *
 * Tab bar é sticky no topo do container (fica abaixo do banner de sessão
 * ativa via marginTop do <main> em App.tsx). Modais globais (criar conta,
 * importar CSV, gerenciar regras) ficam no header do layout — disponíveis
 * em qualquer sub-página.
 *
 * Doc: docs/hub-finance/PLAN.md
 */
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Settings, Upload, Eye, EyeOff } from 'lucide-react'
import { HubFinanceProvider, useHubFinance } from './HubFinanceContext'
import { ImportCsvModal } from './components/ImportCsvModal'
import { RulesModal } from './components/RulesModal'

const TABS: { path: string; label: string }[] = [
  { path: '/hub-finance/visao-geral',  label: 'VISÃO GERAL' },
  { path: '/hub-finance/carteira',     label: 'CARTEIRA' },
  { path: '/hub-finance/lancamentos',  label: 'LANÇAMENTOS' },
  { path: '/hub-finance/fixas',        label: 'FIXAS' },
  { path: '/hub-finance/dividas',      label: 'DÍVIDAS' },
  { path: '/hub-finance/freelas',      label: 'FREELAS' },
  { path: '/hub-finance/categorias',   label: 'CATEGORIAS' },
]

/** Botão CP2077 com chamfer-bl. Variant ice (default), oxblood (active),
 *  ghost (icon-text). Usa mono uppercase. */
function CyberButton({
  children,
  onClick,
  active,
  ariaPressed,
  title,
  variant = 'ghost',
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  ariaPressed?: boolean
  title?: string
  variant?: 'ghost' | 'oxblood' | 'ice'
}) {
  const styles: React.CSSProperties = (() => {
    if (variant === 'oxblood' || (variant === 'ghost' && active)) {
      return {
        background: 'rgba(159, 18, 57, 0.14)',
        border: '1px solid var(--color-accent-primary)',
        color: 'var(--color-accent-light)',
      }
    }
    if (variant === 'ice') {
      return {
        background: 'rgba(143, 191, 211, 0.10)',
        border: '1px solid rgba(143, 191, 211, 0.45)',
        color: 'var(--color-ice-light)',
      }
    }
    return {
      background: 'rgba(8, 12, 18, 0.55)',
      border: '1px solid var(--color-border)',
      color: 'var(--color-text-tertiary)',
    }
  })()
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={ariaPressed}
      style={{
        ...styles,
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 9, fontWeight: 700,
        padding: '6px 10px',
        letterSpacing: '0.18em', textTransform: 'uppercase',
        borderRadius: 0,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
        display: 'inline-flex', alignItems: 'center', gap: 4,
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  )
}

export function HubFinanceLayout() {
  return (
    <HubFinanceProvider>
      <LayoutInner />
    </HubFinanceProvider>
  )
}

function LayoutInner() {
  const { accounts, categories, refreshAll, privateMode, togglePrivate } = useHubFinance()
  const [showImportModal, setShowImportModal] = useState(false)
  const [showRulesModal, setShowRulesModal] = useState(false)

  const hasAccounts = accounts.length > 0

  return (
    <div
      data-finance-private={privateMode || undefined}
      style={{ color: 'var(--color-text-primary)' }}
    >
      {/* Hairline ice topo */}
      <div className="hq-hairline-ice" />

      {/* Header band CP2077 — // HUB.FINANCE label + tab nav + controles */}
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
        {/* Tab marker ice */}
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
          HUB.FINANCE
        </div>

        <div style={{ width: 1, height: 22, background: 'var(--color-border-strong)', flexShrink: 0 }} />

        {/* Tab nav — pills cyber com chamfer-bl, active ice */}
        <div style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0, overflow: 'auto' }}>
          {TABS.map(t => (
            <NavLink
              key={t.path}
              to={t.path}
              style={({ isActive }) => ({
                padding: '6px 10px',
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
                whiteSpace: 'nowrap',
                boxShadow: isActive ? '0 0 12px rgba(143, 191, 211, 0.18)' : 'none',
              })}
            >
              {t.label}
            </NavLink>
          ))}
        </div>

        {/* Controles direita */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <CyberButton
            onClick={togglePrivate}
            ariaPressed={privateMode}
            title={privateMode ? 'Clique pra mostrar os valores' : 'Esconder valores (modo privacidade)'}
            active={privateMode}
          >
            {privateMode
              ? <EyeOff size={11} strokeWidth={2} />
              : <Eye size={11} strokeWidth={2} />}
            {privateMode ? 'MOSTRAR' : 'OCULTAR'}
          </CyberButton>

          {hasAccounts && (
            <>
              <CyberButton
                onClick={() => setShowRulesModal(true)}
                title="Gerenciar regras de auto-categorização"
              >
                <Settings size={11} strokeWidth={2} />
                REGRAS
              </CyberButton>
              <CyberButton
                onClick={() => setShowImportModal(true)}
                title="Importar CSV de extrato Nubank"
              >
                <Upload size={11} strokeWidth={2} />
                IMPORTAR
              </CyberButton>
            </>
          )}
        </div>
      </header>

      {/* Conteúdo da sub-rota */}
      <div style={{
        padding: '24px',
      }}>
        <Outlet />
      </div>

      {/* Modais globais — disponíveis em qualquer sub-página.
          Nova carteira saiu daqui — virou ação dentro de /carteira. */}
      {showImportModal && (
        <ImportCsvModal
          accounts={accounts}
          onClose={() => setShowImportModal(false)}
          onImported={() => { setShowImportModal(false); refreshAll() }}
        />
      )}
      {showRulesModal && (
        <RulesModal
          categories={categories}
          accounts={accounts}
          onClose={() => setShowRulesModal(false)}
        />
      )}
    </div>
  )
}
