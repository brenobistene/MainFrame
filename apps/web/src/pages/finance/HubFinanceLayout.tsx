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
import { ghostButton } from './components/styleHelpers'

const TABS: { path: string; label: string }[] = [
  { path: '/hub-finance/visao-geral',  label: 'visão geral' },
  { path: '/hub-finance/carteira',     label: 'carteira' },
  { path: '/hub-finance/lancamentos',  label: 'lançamentos' },
  { path: '/hub-finance/fixas',        label: 'contas/receitas fixas' },
  { path: '/hub-finance/dividas',      label: 'dívidas' },
  { path: '/hub-finance/freelas',      label: 'freelas' },
  { path: '/hub-finance/categorias',   label: 'categorias' },
]

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
      {/* Tab bar sticky — gruda no topo do <main> (já offsetado pelo banner de sessão) */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'var(--color-bg-primary)',
        borderBottom: '1px solid var(--color-divider)',
      }}>
        <div style={{
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          height: 48,
        }}>
          {TABS.map(t => (
            <NavLink
              key={t.path}
              to={t.path}
              style={({ isActive }) => ({
                padding: '14px 12px',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                textDecoration: 'none',
                borderBottom: isActive
                  ? '2px solid var(--color-accent-light)'
                  : '2px solid transparent',
                transition: 'color 0.15s, border-color 0.15s',
                marginBottom: -1,
              })}
            >
              {t.label}
            </NavLink>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Toggle privacidade — texto + ícone pra ser óbvio.
                Vira oxblood quando ativo. */}
            <button
              onClick={togglePrivate}
              aria-pressed={privateMode}
              title={privateMode ? 'Clique pra mostrar os valores' : 'Esconder valores (modo privacidade)'}
              style={{
                ...ghostButton(),
                ...(privateMode ? {
                  background: 'rgba(159, 18, 57, 0.14)',
                  border: '1px solid var(--color-accent-primary)',
                  color: 'var(--color-accent-light)',
                } : {}),
              }}
            >
              {privateMode
                ? <EyeOff size={11} strokeWidth={2} style={{ marginRight: 4 }} />
                : <Eye size={11} strokeWidth={2} style={{ marginRight: 4 }} />}
              {privateMode ? 'mostrar' : 'ocultar'}
            </button>

            {hasAccounts && (
              <>
                <button
                  onClick={() => setShowRulesModal(true)}
                  title="Gerenciar regras de auto-categorização"
                  style={ghostButton()}
                >
                  <Settings size={11} strokeWidth={2} style={{ marginRight: 4 }} />
                  regras
                </button>
                <button
                  onClick={() => setShowImportModal(true)}
                  title="Importar CSV de extrato Nubank"
                  style={ghostButton()}
                >
                  <Upload size={11} strokeWidth={2} style={{ marginRight: 4 }} />
                  importar
                </button>
              </>
            )}
          </div>
        </div>
      </div>

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
