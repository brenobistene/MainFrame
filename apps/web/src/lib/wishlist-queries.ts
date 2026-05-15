/**
 * React Query hooks pro submódulo Wishlist do Hub Finance.
 *
 * Mesmo padrão de finance-queries.ts e build-queries.ts:
 *  - `wishlistKeys` agrupa query keys pra invalidação granular
 *  - Cada fetch vira um hook com cache automático
 *  - Mutations invalidam grupos relevantes
 *
 * Doc completo: docs/hub-finance/wishlist-PLAN.md.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { financeKeys } from './finance-queries'
import {
  comprarWishlistItem,
  createWishlistCategoria,
  createWishlistItem,
  createWishlistLink,
  deleteWishlistCategoria,
  deleteWishlistItem,
  deleteWishlistLink,
  deleteWishlistReserva,
  desistirWishlistItem,
  fetchReservaMatchCandidates,
  fetchWishlistAguardandoVinculo,
  fetchWishlistCategorias,
  fetchWishlistItem,
  fetchWishlistItems,
  fetchWishlistMatchCandidates,
  fetchWishlistMatchSuggestions,
  fetchWishlistMatchSuggestionsReservas,
  fetchWishlistReservas,
  fetchWishlistReservasMes,
  fetchWishlistSettings,
  fetchWishlistSummary,
  reabrirWishlistItem,
  reorderWishlistItems,
  replaceWishlistReservas,
  updateWishlistCategoria,
  updateWishlistItem,
  updateWishlistLink,
  updateWishlistSettings,
  vincularReservaTransacao,
  vincularWishlistTransacao,
} from '../api'
import type {
  WishlistCategoriaCreate,
  WishlistCategoriaUpdate,
  WishlistComprarBody,
  WishlistDesistirBody,
  WishlistItemCreate,
  WishlistItemUpdate,
  WishlistLinkCreate,
  WishlistLinkUpdate,
  WishlistReabrirBody,
  WishlistReorderItem,
  WishlistReservaInput,
  WishlistReservaVincularBody,
  WishlistSettingsUpdate,
  WishlistStatus,
  WishlistVincularBody,
} from '../types'

// ─── Keys ───────────────────────────────────────────────────────────────

export const wishlistKeys = {
  all: ['wishlist'] as const,
  categorias: () => [...wishlistKeys.all, 'categorias'] as const,
  items: (params?: { status?: WishlistStatus; categoriaId?: string; includeDone?: boolean }) =>
    [...wishlistKeys.all, 'items', params ?? {}] as const,
  item: (id: string) => [...wishlistKeys.all, 'item', id] as const,
  reservas: (itemId: string) => [...wishlistKeys.all, 'reservas', itemId] as const,
  reservasMes: (year: number, month: number) =>
    [...wishlistKeys.all, 'reservas-mes', year, month] as const,
  aguardandoVinculo: () => [...wishlistKeys.all, 'aguardando-vinculo'] as const,
  summary: () => [...wishlistKeys.all, 'summary'] as const,
  settings: () => [...wishlistKeys.all, 'settings'] as const,
  matchCandidates: (valor: number, data: string, diasJanela: number) =>
    [...wishlistKeys.all, 'match-candidates', valor, data, diasJanela] as const,
  matchSuggestions: (diasJanela: number) =>
    [...wishlistKeys.all, 'match-suggestions', diasJanela] as const,
  reservaMatchCandidates: (reservaId: string, diasJanela: number) =>
    [...wishlistKeys.all, 'reserva-match-candidates', reservaId, diasJanela] as const,
  matchSuggestionsReservas: (diasJanela: number) =>
    [...wishlistKeys.all, 'match-suggestions-reservas', diasJanela] as const,
}

// ─── Categorias ─────────────────────────────────────────────────────────

export function useWishlistCategorias() {
  return useQuery({
    queryKey: wishlistKeys.categorias(),
    queryFn: fetchWishlistCategorias,
  })
}

export function useCreateWishlistCategoria() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: WishlistCategoriaCreate) => createWishlistCategoria(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.categorias() })
    },
  })
}

export function useUpdateWishlistCategoria() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: WishlistCategoriaUpdate }) =>
      updateWishlistCategoria(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.categorias() })
    },
  })
}

export function useDeleteWishlistCategoria() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteWishlistCategoria(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.categorias() })
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
    },
  })
}

// ─── Items ──────────────────────────────────────────────────────────────

/**
 * Helper interno: mutações que afetam `fin_wishlist_reserva` (criar/editar
 * reservas, mudar status do item entre ativo↔não-ativo, deletar item)
 * precisam invalidar as queries do Hub Finance também, porque o backend
 * de `monthly-summary` e `month-commitments` lê reservas pra calcular
 * `sobra_real` e `total_a_pagar`. Sem isso, a Visão Geral mostra cache
 * stale e o número não atualiza até dar F5.
 */
function invalidateFinanceMonthQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: financeKeys.all })
}

export function useWishlistItems(params?: {
  status?: WishlistStatus
  categoriaId?: string
  includeDone?: boolean
}) {
  return useQuery({
    queryKey: wishlistKeys.items(params),
    queryFn: () => fetchWishlistItems(params),
  })
}

export function useWishlistItem(id: string | null | undefined) {
  return useQuery({
    queryKey: wishlistKeys.item(id ?? ''),
    queryFn: () => fetchWishlistItem(id as string),
    enabled: !!id,
  })
}

export function useCreateWishlistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: WishlistItemCreate) => createWishlistItem(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
    },
  })
}

export function useUpdateWishlistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: WishlistItemUpdate }) =>
      updateWishlistItem(id, patch),
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
      qc.setQueryData(wishlistKeys.item(item.id), item)
      // Status pode mudar (poupando→desejado etc) → recalcula compromissos.
      invalidateFinanceMonthQueries(qc)
    },
  })
}

export function useDeleteWishlistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteWishlistItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
      // CASCADE em fin_wishlist_reserva — reservas somem junto.
      invalidateFinanceMonthQueries(qc)
    },
  })
}

export function useReorderWishlistItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: WishlistReorderItem[]) => reorderWishlistItems(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
    },
  })
}

// ─── Ações de fluxo ─────────────────────────────────────────────────────

export function useComprarWishlistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: WishlistComprarBody }) =>
      comprarWishlistItem(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
      // Status: ativo→comprado, item sai dos compromissos virtuais.
      invalidateFinanceMonthQueries(qc)
    },
  })
}

export function useDesistirWishlistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: WishlistDesistirBody }) =>
      desistirWishlistItem(id, body ?? {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
      // Status: ativo→desistido, item sai dos compromissos virtuais.
      invalidateFinanceMonthQueries(qc)
    },
  })
}

export function useReabrirWishlistItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: WishlistReabrirBody }) =>
      reabrirWishlistItem(id, body ?? {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
      // Status: comprado/desistido→ativo, reservas voltam a contar.
      invalidateFinanceMonthQueries(qc)
    },
  })
}

export function useVincularWishlistTransacao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: WishlistVincularBody }) =>
      vincularWishlistTransacao(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
    },
  })
}

export function useWishlistAguardandoVinculo() {
  return useQuery({
    queryKey: wishlistKeys.aguardandoVinculo(),
    queryFn: fetchWishlistAguardandoVinculo,
  })
}

// ─── Links ──────────────────────────────────────────────────────────────

export function useCreateWishlistLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: WishlistLinkCreate }) =>
      createWishlistLink(itemId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
    },
  })
}

export function useUpdateWishlistLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ linkId, patch }: { linkId: string; patch: WishlistLinkUpdate }) =>
      updateWishlistLink(linkId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
    },
  })
}

export function useDeleteWishlistLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (linkId: string) => deleteWishlistLink(linkId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
    },
  })
}

// ─── Reservas ───────────────────────────────────────────────────────────

export function useWishlistReservas(itemId: string | null | undefined) {
  return useQuery({
    queryKey: wishlistKeys.reservas(itemId ?? ''),
    queryFn: () => fetchWishlistReservas(itemId as string),
    enabled: !!itemId,
  })
}

export function useReplaceWishlistReservas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      itemId,
      cronograma,
    }: {
      itemId: string
      cronograma: WishlistReservaInput[]
    }) => replaceWishlistReservas(itemId, cronograma),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
      // Mexer no cronograma muda direto as reservas do mês → invalida
      // monthly-summary e month-commitments pra refletir na Visão Geral.
      invalidateFinanceMonthQueries(qc)
    },
  })
}

export function useDeleteWishlistReserva() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, ano, mes }: { itemId: string; ano: number; mes: number }) =>
      deleteWishlistReserva(itemId, ano, mes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
      invalidateFinanceMonthQueries(qc)
    },
  })
}

export function useWishlistReservasMes(year: number, month: number) {
  return useQuery({
    queryKey: wishlistKeys.reservasMes(year, month),
    queryFn: () => fetchWishlistReservasMes(year, month),
  })
}

// ─── Agregados ──────────────────────────────────────────────────────────

export function useWishlistSummary() {
  return useQuery({
    queryKey: wishlistKeys.summary(),
    queryFn: fetchWishlistSummary,
  })
}

// ─── Settings ───────────────────────────────────────────────────────────

export function useWishlistSettings() {
  return useQuery({
    queryKey: wishlistKeys.settings(),
    queryFn: fetchWishlistSettings,
  })
}

export function useUpdateWishlistSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: WishlistSettingsUpdate) => updateWishlistSettings(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.settings() })
    },
  })
}

// ─── Match candidates (Fase 3) ──────────────────────────────────────────

/** Candidatas pra vincular a um item. Reativa a (valor, data) — busca
 *  novamente quando user muda o valor real ou a data no Modal Comprar. */
export function useWishlistMatchCandidates(params: {
  valor: number | null
  data: string | null
  diasJanela?: number
  enabled?: boolean
}) {
  const valor = params.valor ?? 0
  const data = params.data ?? ''
  const diasJanela = params.diasJanela ?? 7
  return useQuery({
    queryKey: wishlistKeys.matchCandidates(valor, data, diasJanela),
    queryFn: () => fetchWishlistMatchCandidates({ valor, data, diasJanela }),
    enabled: (params.enabled ?? true) && valor > 0 && !!data,
  })
}

/** Grupos de sugestão (item + candidatas) pra todos items aguardando vínculo.
 *  Usado na tela de import pós-CSV. */
export function useWishlistMatchSuggestions(diasJanela: number = 7) {
  return useQuery({
    queryKey: wishlistKeys.matchSuggestions(diasJanela),
    queryFn: () => fetchWishlistMatchSuggestions({ diasJanela }),
  })
}

// ─── Fase 5: vínculo de reserva ↔ transação ─────────────────────────────

export function useReservaMatchCandidates(reservaId: string | null, diasJanela: number = 15) {
  return useQuery({
    queryKey: wishlistKeys.reservaMatchCandidates(reservaId ?? '', diasJanela),
    queryFn: () => fetchReservaMatchCandidates({ reservaId: reservaId as string, diasJanela }),
    enabled: !!reservaId,
  })
}

export function useVincularReservaTransacao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ reservaId, body }: { reservaId: string; body: WishlistReservaVincularBody }) =>
      vincularReservaTransacao(reservaId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: wishlistKeys.all })
      // Vínculo muda o "confirmado/pendente" da reserva → afeta status
      // no compromisso do mês (pendente → paga), recalcula sobra real.
      invalidateFinanceMonthQueries(qc)
    },
  })
}

export function useWishlistMatchSuggestionsReservas(diasJanela: number = 15) {
  return useQuery({
    queryKey: wishlistKeys.matchSuggestionsReservas(diasJanela),
    queryFn: () => fetchWishlistMatchSuggestionsReservas({ diasJanela }),
  })
}
