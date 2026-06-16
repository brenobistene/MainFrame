/**
 * Lang Lab — hooks TanStack Query (padrão da casa: key factory + hooks +
 * invalidator). Design: docs/lang-lab/PLAN.md.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createLangCard,
  fetchLangCards,
  fetchLangQueue,
  fetchLangSession,
  fetchLangSettings,
  fetchLangToday,
  reviewLangCard,
  undoLangReview,
  updateLangCard,
  updateLangSettings,
} from '../api'
import type { LangCard, LangSettingsUpdate } from '../types'

export const langKeys = {
  all: ['lang'] as const,
  today: () => [...langKeys.all, 'today'] as const,
  queue: () => [...langKeys.all, 'queue'] as const,
  settings: () => [...langKeys.all, 'settings'] as const,
  cards: (q?: string) => [...langKeys.all, 'cards', q ?? ''] as const,
}

export function useLangInvalidator() {
  const qc = useQueryClient()
  return {
    all: () => qc.invalidateQueries({ queryKey: langKeys.all }),
    today: () => qc.invalidateQueries({ queryKey: langKeys.today() }),
    queue: () => qc.invalidateQueries({ queryKey: langKeys.queue() }),
  }
}

export function useLangToday() {
  // refetchInterval: badge da sidebar e card do Exec não podem congelar o
  // valor da manhã o dia inteiro (QA 2026-06-12) — due muda com o relógio.
  // Este é o ÚNICO consumo lang que roda em TODA página (badge sempre
  // montada); explícito que NÃO roda em aba oculta e a 120s pra manter a
  // carga de fundo mínima (2026-06-14).
  return useQuery({
    queryKey: langKeys.today(),
    queryFn: fetchLangToday,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  })
}

export function useLangSettings() {
  return useQuery({ queryKey: langKeys.settings(), queryFn: fetchLangSettings })
}

export function useLangSessionCluster() {
  // Cluster da sessão pro card estilo quest no /dia (play/pause/finalizar +
  // timer). refetch manual após start/pause/stop; o evento hq-session-changed
  // sincroniza o banner global.
  return useQuery({ queryKey: [...langKeys.all, 'session-cluster'], queryFn: fetchLangSession })
}

export function useUpdateLangSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: LangSettingsUpdate) => updateLangSettings(patch),
    onSuccess: data => qc.setQueryData(langKeys.settings(), data),
  })
}

export function useLangQueue() {
  return useQuery({ queryKey: langKeys.queue(), queryFn: fetchLangQueue })
}

export function useLangRecentCards(limit = 6) {
  return useQuery({
    queryKey: langKeys.cards(`recent-${limit}`),
    queryFn: () => fetchLangCards({ limit }),
  })
}

export function useCreateLangCard() {
  const inv = useLangInvalidator()
  return useMutation({
    mutationFn: (body: Parameters<typeof createLangCard>[0]) => createLangCard(body),
    onSuccess: () => inv.all(),
  })
}

export function useUpdateLangCard() {
  const inv = useLangInvalidator()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof updateLangCard>[1] }) =>
      updateLangCard(id, patch),
    onSuccess: () => inv.all(),
  })
}

export function useReviewLangCard() {
  const inv = useLangInvalidator()
  return useMutation({
    mutationFn: ({ cardId, rating }: { cardId: number; rating: 1 | 2 | 3 | 4 }) =>
      reviewLangCard(cardId, rating),
    onSuccess: () => inv.today(),
  })
}

export function useUndoLangReview() {
  const inv = useLangInvalidator()
  return useMutation({
    mutationFn: () => undoLangReview(),
    onSuccess: () => inv.today(),
  })
}

export type { LangCard }
