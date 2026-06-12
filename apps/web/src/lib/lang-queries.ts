/**
 * Lang Lab — hooks TanStack Query (padrão da casa: key factory + hooks +
 * invalidator). Design: docs/lang-lab/PLAN.md.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createLangCard,
  fetchLangCards,
  fetchLangQueue,
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
  return useQuery({ queryKey: langKeys.today(), queryFn: fetchLangToday })
}

export function useLangSettings() {
  return useQuery({ queryKey: langKeys.settings(), queryFn: fetchLangSettings })
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
