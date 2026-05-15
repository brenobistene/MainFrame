import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import './index.css'
import App from './App.tsx'
import { SaveIndicator } from './components/ui/SaveIndicator'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

// React Query Devtools — fica escondido por default. Pra ligar, criar
// `apps/web/.env.local` com:    VITE_RQ_DEVTOOLS=true
// Útil quando precisar inspecionar queries/mutations rodando.
const showDevtools = (import.meta as any).env?.VITE_RQ_DEVTOOLS === 'true'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      {/* SaveIndicator global — toast no canto inferior direito mostrando
          "salvando…" / "salvo ✓" pra QUALQUER mutation do app. Plugado
          uma vez aqui; cobre todas as surfaces que já têm auto-save. */}
      <SaveIndicator />
      {showDevtools && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>,
)
