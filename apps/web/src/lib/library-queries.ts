/**
 * React Query hooks pro módulo Library.
 *
 * Padrão segue lib/health-queries.ts:
 *  - Query keys agrupados em `libraryKeys` pra invalidação granular
 *  - Cada query/mutation com hook próprio
 *  - Mutations invalidam só o que muda (items invalidam list + detail; sessões
 *    invalidam só do item)
 *
 * Doc: docs/library/PLAN.md.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createLibraryItem,
  createLibraryLink,
  createLibrarySaga,
  createLibraryTag,
  deleteLibraryItem,
  deleteLibraryLink,
  deleteLibrarySaga,
  deleteLibraryTag,
  fetchLibraryBacklinks,
  fetchLibraryItem,
  fetchLibraryItems,
  fetchLibraryPending,
  fetchLibrarySagas,
  fetchLibrarySessions,
  fetchLibraryTags,
  fetchLibraryTemas,
  pauseLibrarySession,
  reorderSagaItems,
  resumeLibrarySession,
  startLibrarySession,
  stopLibrarySession,
  updateLibraryItem,
  updateLibrarySaga,
  updateLibraryTag,
  type LibraryItemsQuery,
} from '../api'
import type {
  LibraryItemCreate,
  LibraryItemUpdate,
  LibraryLinkCreate,
  LibrarySagaCreate,
  LibrarySagaUpdate,
  LibraryTagCreate,
  LibraryTagUpdate,
} from '../types'

export const libraryKeys = {
  all: ['library'] as const,
  tags: (includeArchived = false) =>
    [...libraryKeys.all, 'tags', { includeArchived }] as const,
  items: (params?: LibraryItemsQuery) =>
    [...libraryKeys.all, 'items', params ?? {}] as const,
  item: (id: number) => [...libraryKeys.all, 'item', id] as const,
  sessions: (itemId: number) =>
    [...libraryKeys.all, 'sessions', itemId] as const,
  pending: (janelaDias: number) =>
    [...libraryKeys.all, 'pending', janelaDias] as const,
  temas: () => [...libraryKeys.all, 'temas'] as const,
  backlinks: (targetType: string, targetId: string) =>
    [...libraryKeys.all, 'backlinks', targetType, targetId] as const,
  sagas: () => [...libraryKeys.all, 'sagas'] as const,
}

// ─── Tags ─────────────────────────────────────────────────────────────────

export function useLibraryTags(includeArchived = false) {
  return useQuery({
    queryKey: libraryKeys.tags(includeArchived),
    queryFn: () => fetchLibraryTags(includeArchived),
  })
}

export function useCreateLibraryTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LibraryTagCreate) => createLibraryTag(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...libraryKeys.all, 'tags'] })
    },
  })
}

export function useUpdateLibraryTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: LibraryTagUpdate }) =>
      updateLibraryTag(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...libraryKeys.all, 'tags'] })
      qc.invalidateQueries({ queryKey: libraryKeys.temas() })
    },
  })
}

export function useDeleteLibraryTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteLibraryTag(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...libraryKeys.all, 'tags'] })
      qc.invalidateQueries({ queryKey: libraryKeys.temas() })
    },
  })
}

// ─── Items ────────────────────────────────────────────────────────────────

export function useLibraryItems(params?: LibraryItemsQuery) {
  return useQuery({
    queryKey: libraryKeys.items(params),
    queryFn: () => fetchLibraryItems(params),
  })
}

export function useLibraryItem(id: number | null | undefined) {
  return useQuery({
    queryKey: libraryKeys.item(id ?? -1),
    queryFn: () => fetchLibraryItem(id!),
    enabled: id !== null && id !== undefined && id > 0,
  })
}

export function useCreateLibraryItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LibraryItemCreate) => createLibraryItem(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...libraryKeys.all, 'items'] })
      qc.invalidateQueries({ queryKey: libraryKeys.temas() })
    },
  })
}

export function useUpdateLibraryItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: LibraryItemUpdate }) =>
      updateLibraryItem(id, patch),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: [...libraryKeys.all, 'items'] })
      qc.invalidateQueries({ queryKey: libraryKeys.item(vars.id) })
      qc.invalidateQueries({ queryKey: libraryKeys.temas() })
      qc.invalidateQueries({ queryKey: [...libraryKeys.all, 'pending'] })
    },
  })
}

export function useDeleteLibraryItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteLibraryItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...libraryKeys.all, 'items'] })
      qc.invalidateQueries({ queryKey: libraryKeys.temas() })
      qc.invalidateQueries({ queryKey: [...libraryKeys.all, 'pending'] })
    },
  })
}

// ─── Sessions ─────────────────────────────────────────────────────────────

export function useLibrarySessions(itemId: number | null | undefined) {
  return useQuery({
    queryKey: libraryKeys.sessions(itemId ?? -1),
    queryFn: () => fetchLibrarySessions(itemId!),
    enabled: itemId !== null && itemId !== undefined && itemId > 0,
  })
}

export function useStartLibrarySession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: number) => startLibrarySession(itemId),
    onSuccess: (_, itemId) => {
      qc.invalidateQueries({ queryKey: libraryKeys.sessions(itemId) })
      qc.invalidateQueries({ queryKey: libraryKeys.item(itemId) })
      qc.invalidateQueries({ queryKey: [...libraryKeys.all, 'items'] })
    },
  })
}

export function usePauseLibrarySession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: number) => pauseLibrarySession(itemId),
    onSuccess: (_, itemId) => {
      qc.invalidateQueries({ queryKey: libraryKeys.sessions(itemId) })
      qc.invalidateQueries({ queryKey: libraryKeys.item(itemId) })
      qc.invalidateQueries({ queryKey: [...libraryKeys.all, 'items'] })
    },
  })
}

export function useResumeLibrarySession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: number) => resumeLibrarySession(itemId),
    onSuccess: (_, itemId) => {
      qc.invalidateQueries({ queryKey: libraryKeys.sessions(itemId) })
      qc.invalidateQueries({ queryKey: libraryKeys.item(itemId) })
    },
  })
}

export function useStopLibrarySession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: number) => stopLibrarySession(itemId),
    onSuccess: (_, itemId) => {
      qc.invalidateQueries({ queryKey: libraryKeys.sessions(itemId) })
      qc.invalidateQueries({ queryKey: libraryKeys.item(itemId) })
      qc.invalidateQueries({ queryKey: [...libraryKeys.all, 'items'] })
    },
  })
}

// ─── Cross-links ──────────────────────────────────────────────────────────

export function useCreateLibraryLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      itemId,
      body,
    }: {
      itemId: number
      body: LibraryLinkCreate
    }) => createLibraryLink(itemId, body),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: libraryKeys.item(vars.itemId) })
    },
  })
}

export function useDeleteLibraryLink(itemId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (linkId: number) => deleteLibraryLink(linkId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryKeys.item(itemId) })
    },
  })
}

// ─── Painéis agregados ───────────────────────────────────────────────────

export function useLibraryPending(janelaDias = 7) {
  return useQuery({
    queryKey: libraryKeys.pending(janelaDias),
    queryFn: () => fetchLibraryPending(janelaDias),
  })
}

export function useLibraryTemas() {
  return useQuery({
    queryKey: libraryKeys.temas(),
    queryFn: () => fetchLibraryTemas(),
  })
}

// ─── Sagas ────────────────────────────────────────────────────────────────

export function useLibrarySagas() {
  return useQuery({
    queryKey: libraryKeys.sagas(),
    queryFn: () => fetchLibrarySagas(),
  })
}

export function useCreateLibrarySaga() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LibrarySagaCreate) => createLibrarySaga(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryKeys.sagas() })
    },
  })
}

export function useUpdateLibrarySaga() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: LibrarySagaUpdate }) =>
      updateLibrarySaga(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryKeys.sagas() })
    },
  })
}

export function useDeleteLibrarySaga() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteLibrarySaga(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryKeys.sagas() })
      // Items mudaram (saga_id NULL) — invalida lista.
      qc.invalidateQueries({ queryKey: [...libraryKeys.all, 'items'] })
    },
  })
}

export function useReorderSagaItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sagaId, itemIds }: { sagaId: number; itemIds: number[] }) =>
      reorderSagaItems(sagaId, itemIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...libraryKeys.all, 'items'] })
    },
  })
}

/**
 * Backlinks: items da Library que apontam pra um target (hipótese Mind,
 * quest, princípio Build, meta Build). Fecha a simetria dos cross-links.
 *
 * `enabled` permite pular o fetch quando o consumidor já sabe que não
 * faz sentido (e.g., hipótese sem id estável ainda).
 */
export function useLibraryBacklinks(
  targetType: string | null | undefined,
  targetId: string | number | null | undefined,
  enabled = true,
) {
  const tid = targetId !== null && targetId !== undefined ? String(targetId) : ''
  return useQuery({
    queryKey: libraryKeys.backlinks(targetType ?? '', tid),
    queryFn: () => fetchLibraryBacklinks(targetType!, tid),
    enabled: enabled && !!targetType && !!tid,
  })
}
