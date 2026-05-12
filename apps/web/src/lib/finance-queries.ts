/**
 * React Query hooks pro Hub Finance.
 *
 * Mesmo padrão de `build-queries.ts`:
 *  - `financeKeys` agrupa query keys pra invalidação granular
 *  - Cada fetch vira um hook com cache automático
 *  - `useFinanceInvalidator()` expõe helpers de invalidate semantically
 *    correspondendo aos antigos `refreshAll/refreshGlobal/refreshForMonth`
 *
 * O `HubFinanceContext` usa esses hooks internamente — interface pública
 * (`useHubFinance()`) permanece idêntica pra não quebrar consumers.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  fetchFinAccounts, fetchFinCategories, fetchFinTransactions, fetchFinSummary,
  fetchFinMonthlySummary, fetchFinHourlyRateStats,
  fetchFinDebts, fetchFinClients, fetchFinInvoices,
  fetchFinFreelaProjects,
  fetchFinRecurringBills, fetchFinRecurringBillsStatus,
  fetchFinMonthCommitments,
} from '../api'

// ─── Keys ───────────────────────────────────────────────────────────────

export const financeKeys = {
  all: ['finance'] as const,
  accounts: () => [...financeKeys.all, 'accounts'] as const,
  categories: () => [...financeKeys.all, 'categories'] as const,
  summary: () => [...financeKeys.all, 'summary'] as const,
  debts: () => [...financeKeys.all, 'debts'] as const,
  clients: () => [...financeKeys.all, 'clients'] as const,
  hourlyStats: () => [...financeKeys.all, 'hourly-stats'] as const,
  invoices: () => [...financeKeys.all, 'invoices'] as const,
  freelaProjects: () => [...financeKeys.all, 'freela-projects'] as const,
  recurringBills: () => [...financeKeys.all, 'recurring-bills'] as const,
  // Month-scoped — incluem ano/mês no key pra cache por mês
  monthlySummary: (year: number, month: number) =>
    [...financeKeys.all, 'monthly-summary', year, month] as const,
  transactions: (year: number, month: number) =>
    [...financeKeys.all, 'transactions', year, month] as const,
  recurringBillsStatus: (year: number, month: number) =>
    [...financeKeys.all, 'recurring-bills-status', year, month] as const,
  monthCommitments: (year: number, month: number) =>
    [...financeKeys.all, 'month-commitments', year, month] as const,
}

// ─── Queries (globais) ──────────────────────────────────────────────────

export function useFinAccounts() {
  return useQuery({
    queryKey: financeKeys.accounts(),
    queryFn: fetchFinAccounts,
  })
}

export function useFinCategories() {
  return useQuery({
    queryKey: financeKeys.categories(),
    queryFn: () => fetchFinCategories(),
  })
}

export function useFinSummary() {
  return useQuery({
    queryKey: financeKeys.summary(),
    queryFn: fetchFinSummary,
  })
}

export function useFinDebts() {
  return useQuery({
    queryKey: financeKeys.debts(),
    queryFn: () => fetchFinDebts(),
  })
}

export function useFinClients() {
  return useQuery({
    queryKey: financeKeys.clients(),
    queryFn: fetchFinClients,
  })
}

export function useFinHourlyStats() {
  return useQuery({
    queryKey: financeKeys.hourlyStats(),
    queryFn: fetchFinHourlyRateStats,
  })
}

export function useFinInvoices() {
  return useQuery({
    queryKey: financeKeys.invoices(),
    queryFn: () => fetchFinInvoices(),
  })
}

export function useFinFreelaProjects() {
  return useQuery({
    queryKey: financeKeys.freelaProjects(),
    queryFn: fetchFinFreelaProjects,
  })
}

export function useFinRecurringBills() {
  return useQuery({
    queryKey: financeKeys.recurringBills(),
    queryFn: fetchFinRecurringBills,
  })
}

// ─── Queries (escopo do mês) ────────────────────────────────────────────

export function useFinMonthlySummary(year: number, month: number) {
  return useQuery({
    queryKey: financeKeys.monthlySummary(year, month),
    queryFn: () => fetchFinMonthlySummary(year, month),
  })
}

export function useFinTransactions(year: number, month: number) {
  const lastDay = new Date(year, month, 0).getDate()
  const dataDe = `${year}-${String(month).padStart(2, '0')}-01`
  const dataAte = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return useQuery({
    queryKey: financeKeys.transactions(year, month),
    queryFn: () => fetchFinTransactions({ data_de: dataDe, data_ate: dataAte, limit: 500 }),
  })
}

export function useFinRecurringBillsStatus(year: number, month: number) {
  return useQuery({
    queryKey: financeKeys.recurringBillsStatus(year, month),
    queryFn: () => fetchFinRecurringBillsStatus(year, month),
  })
}

export function useFinMonthCommitments(year: number, month: number) {
  return useQuery({
    queryKey: financeKeys.monthCommitments(year, month),
    queryFn: () => fetchFinMonthCommitments(year, month),
  })
}

// ─── Invalidator helpers ────────────────────────────────────────────────

/**
 * Helper pra invalidar grupos de queries — substitui os antigos
 * `refreshGlobal/refreshForMonth/refreshAll` do context.
 *
 * Diferença sutil vs refresh manual:
 *  - `invalidateQueries` apenas MARCA stale. O refetch acontece quando o
 *    componente que usa a query re-renderiza.
 *  - Em prática, pra componente já montado, React Query refaz fetch
 *    automaticamente após invalidate.
 */
export function useFinanceInvalidator() {
  const queryClient = useQueryClient()
  return {
    /** Invalida tudo do finance — equivalente ao antigo refreshAll. */
    all: () => queryClient.invalidateQueries({ queryKey: financeKeys.all }),
    /** Invalida queries globais (não depende de mês). */
    global: () => {
      const keys = [
        financeKeys.accounts(), financeKeys.categories(), financeKeys.summary(),
        financeKeys.debts(), financeKeys.clients(), financeKeys.hourlyStats(),
        financeKeys.invoices(), financeKeys.freelaProjects(),
        financeKeys.recurringBills(),
      ]
      return Promise.all(keys.map(k => queryClient.invalidateQueries({ queryKey: k })))
    },
    /** Invalida queries do mês selecionado. */
    forMonth: (year: number, month: number) => {
      const keys = [
        financeKeys.monthlySummary(year, month),
        financeKeys.transactions(year, month),
        financeKeys.recurringBillsStatus(year, month),
        financeKeys.monthCommitments(year, month),
      ]
      return Promise.all(keys.map(k => queryClient.invalidateQueries({ queryKey: k })))
    },
  }
}
