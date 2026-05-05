/**
 * Hub Finance — context compartilhado entre as sub-páginas (Visão Geral,
 * Lançamentos, Cartões, Dívidas, Freelas, Categorias).
 *
 * Centraliza state + fetches pra evitar N requests por página e duplicação
 * de lógica. Cada sub-página chama `useHubFinance()` e usa só o que precisa.
 *
 * Doc autoritativa do módulo: docs/hub-finance/PLAN.md
 */
import { createContext, useContext, useEffect, useState } from 'react'
import {
  fetchFinAccounts, fetchFinCategories, fetchFinTransactions, fetchFinSummary,
  fetchFinMonthlySummary, fetchFinHourlyRateStats,
  fetchFinDebts, fetchFinClients, fetchFinInvoices,
  fetchFinFreelaProjects,
  fetchFinRecurringBills, fetchFinRecurringBillsStatus,
  fetchFinMonthCommitments,
  reportApiError,
} from '../../api'
import type {
  FinAccount, FinCategory, FinTransaction, FinSummary, FinMonthlySummary,
  FinDebt, FinClient, FinHourlyRateStats, FinInvoice, FinFreelaProject,
  FinRecurringBill, FinRecurringBillStatusMonth,
  FinMonthCommitments,
} from '../../types'

interface HubFinanceContextValue {
  // Dados globais (não dependem do mês)
  accounts: FinAccount[]
  categories: FinCategory[]
  summary: FinSummary | null
  debts: FinDebt[]
  clients: FinClient[]
  hourlyStats: FinHourlyRateStats | null
  invoices: FinInvoice[]
  freelaProjects: FinFreelaProject[]
  recurringBills: FinRecurringBill[]

  // Dados do mês selecionado
  transactions: FinTransaction[]
  monthlySummary: FinMonthlySummary | null
  recurringBillsStatus: FinRecurringBillStatusMonth | null
  monthCommitments: FinMonthCommitments | null
  selectedMonth: { year: number; month: number }
  setSelectedMonth: (m: { year: number; month: number }) => void

  loading: boolean
  /** Refetch tudo. Use quando ação afeta múltiplos blocos (ex: pagar fatura,
   *  importar CSV). Pra ações isoladas, prefira o refresh específico. */
  refreshAll: () => void
  /** Refetch só dados globais (não recarrega transações do mês). */
  refreshGlobal: () => void
  /** Refetch só dados do mês atualmente selecionado. */
  refreshForMonth: () => void

  /** Modo privacidade: quando true, valores monetários (qualquer span com
   *  className `hq-money`) ficam borrados via CSS. Persistido em localStorage
   *  pra sobreviver reload. Toggle vive na tab bar do HubFinanceLayout. */
  privateMode: boolean
  togglePrivate: () => void
}

const HubFinanceContext = createContext<HubFinanceContextValue | null>(null)

export function useHubFinance(): HubFinanceContextValue {
  const ctx = useContext(HubFinanceContext)
  if (!ctx) throw new Error('useHubFinance: precisa estar dentro de <HubFinanceProvider>')
  return ctx
}

export function HubFinanceProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<FinAccount[]>([])
  const [categories, setCategories] = useState<FinCategory[]>([])
  const [transactions, setTransactions] = useState<FinTransaction[]>([])
  const [summary, setSummary] = useState<FinSummary | null>(null)
  const [monthlySummary, setMonthlySummary] = useState<FinMonthlySummary | null>(null)
  const [debts, setDebts] = useState<FinDebt[]>([])
  const [clients, setClients] = useState<FinClient[]>([])
  const [hourlyStats, setHourlyStats] = useState<FinHourlyRateStats | null>(null)
  const [invoices, setInvoices] = useState<FinInvoice[]>([])
  const [freelaProjects, setFreelaProjects] = useState<FinFreelaProject[]>([])
  const [recurringBills, setRecurringBills] = useState<FinRecurringBill[]>([])
  const [recurringBillsStatus, setRecurringBillsStatus] = useState<FinRecurringBillStatusMonth | null>(null)
  const [monthCommitments, setMonthCommitments] = useState<FinMonthCommitments | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState<{ year: number; month: number }>(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })

  // Private mode: ON por padrão (usuário pediu pra Hub Finance abrir sempre
  // com os valores escondidos). Persiste em localStorage — se usuário
  // desligar manualmente, fica desligado até religar.
  const [privateMode, setPrivateMode] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('hq-finance-private')
      // null (primeira vez) → ON. '0' explícito (usuário desligou) → OFF.
      return v === null ? true : v === '1'
    } catch { return true }
  })
  function togglePrivate() {
    setPrivateMode(prev => {
      const next = !prev
      try { localStorage.setItem('hq-finance-private', next ? '1' : '0') } catch {}
      return next
    })
  }

  function refreshGlobal() {
    Promise.all([
      fetchFinAccounts(),
      fetchFinCategories(),
      fetchFinSummary(),
      fetchFinDebts(),
      fetchFinClients(),
      fetchFinHourlyRateStats(),
      fetchFinInvoices(),
      fetchFinFreelaProjects(),
      fetchFinRecurringBills(),
    ])
      .then(([a, c, s, d, cl, hs, inv, fp, rb]) => {
        setAccounts(a); setCategories(c); setSummary(s); setDebts(d)
        setClients(cl); setHourlyStats(hs); setInvoices(inv); setFreelaProjects(fp)
        setRecurringBills(rb)
      })
      .catch(err => reportApiError('HubFinance.refreshGlobal', err))
      .finally(() => setLoading(false))
  }

  function refreshForMonth() {
    const { year, month } = selectedMonth
    const lastDay = new Date(year, month, 0).getDate()
    const dataDe = `${year}-${String(month).padStart(2, '0')}-01`
    const dataAte = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    Promise.all([
      fetchFinMonthlySummary(year, month),
      fetchFinTransactions({ data_de: dataDe, data_ate: dataAte, limit: 500 }),
      fetchFinRecurringBillsStatus(year, month),
      fetchFinMonthCommitments(year, month),
    ])
      .then(([ms, txs, rbs, mc]) => {
        setMonthlySummary(ms); setTransactions(txs)
        setRecurringBillsStatus(rbs)
        setMonthCommitments(mc)
      })
      .catch(err => reportApiError('HubFinance.refreshForMonth', err))
  }

  function refreshAll() { refreshGlobal(); refreshForMonth() }

  useEffect(() => { refreshGlobal() }, [])
  useEffect(() => { refreshForMonth() },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedMonth.year, selectedMonth.month])

  const value: HubFinanceContextValue = {
    accounts, categories, transactions, summary, monthlySummary,
    debts, clients, hourlyStats, invoices, freelaProjects,
    recurringBills, recurringBillsStatus, monthCommitments,
    selectedMonth, setSelectedMonth,
    loading,
    refreshAll, refreshGlobal, refreshForMonth,
    privateMode, togglePrivate,
  }

  return <HubFinanceContext.Provider value={value}>{children}</HubFinanceContext.Provider>
}
