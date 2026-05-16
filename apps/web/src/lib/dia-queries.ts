/**
 * React Query hooks pro /Dia — pendências agregadas (Mind + health_items
 * diários) que aparecem como cards arrastáveis nos blocos manhã/tarde/noite.
 *
 * Endpoint: GET /api/dia/pendencias?data=YYYY-MM-DD.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  discardHealthItemSession,
  discardMindSession,
  discardRitualCluster,
  fetchDiaDoneToday,
  fetchDiaPendencias,
  fetchHealthItemSession,
  fetchMindSession,
  fetchRitualCluster,
  linkHealthItemSessionToRecord,
  linkMindSessionToRecord,
  linkRitualClusterToRecord,
  pauseHealthItemSession,
  pauseMindSession,
  pauseRitualCluster,
  resumeHealthItemSession,
  resumeMindSession,
  resumeRitualCluster,
  startHealthItemSession,
  startMindSession,
  startRitualCluster,
} from '../api'

export const diaKeys = {
  all: ['dia'] as const,
  pendencias: (data: string) => [...diaKeys.all, 'pendencias', data] as const,
  doneToday: (data: string) => [...diaKeys.all, 'done-today', data] as const,
  mindSession: () => [...diaKeys.all, 'mind-session'] as const,
  healthItemSession: (itemId: number) =>
    [...diaKeys.all, 'health-item-session', itemId] as const,
  ritualCluster: (cadencia: string) =>
    [...diaKeys.all, 'ritual-cluster', cadencia] as const,
}

export function useDiaPendencias(data: string) {
  return useQuery({
    queryKey: diaKeys.pendencias(data),
    queryFn: () => fetchDiaPendencias(data),
    enabled: !!data,
    // Refetch ao focar pra que pendências fechadas em outra aba/módulo
    // somam imediatamente quando o user volta pro /Dia.
    refetchOnWindowFocus: true,
  })
}

export function useDiaDoneToday(data: string) {
  return useQuery({
    queryKey: diaKeys.doneToday(data),
    queryFn: () => fetchDiaDoneToday(data),
    enabled: !!data,
    refetchOnWindowFocus: true,
  })
}

/** Helper pra invalidar pendências do /Dia após salvar Mind/Health record.
 *  Usado nos onSuccess de mutations de Mind/Health, e também depois de
 *  registrar via modal disparado por pendência. */
export function useInvalidateDiaPendencias() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: diaKeys.all })
  }
}

// ─── Sessões cronometradas pra Mind e health_item ──────────────────────

export function useMindSession() {
  return useQuery({
    queryKey: diaKeys.mindSession(),
    queryFn: fetchMindSession,
  })
}

export function useStartMindSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: startMindSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: diaKeys.mindSession() })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}

export function usePauseMindSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: pauseMindSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: diaKeys.mindSession() })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}

export function useResumeMindSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: resumeMindSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: diaKeys.mindSession() })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}

export function useDiscardMindSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: discardMindSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: diaKeys.mindSession() })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}

export function useLinkMindSessionToRecord() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (recordId: number) => linkMindSessionToRecord(recordId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: diaKeys.mindSession() })
      qc.invalidateQueries({ queryKey: diaKeys.all })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}

export function useHealthItemSession(itemId: number | null) {
  return useQuery({
    queryKey: diaKeys.healthItemSession(itemId ?? -1),
    queryFn: () => fetchHealthItemSession(itemId!),
    enabled: itemId !== null && itemId > 0,
  })
}

export function useStartHealthItemSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: number) => startHealthItemSession(itemId),
    onSuccess: (_, itemId) => {
      qc.invalidateQueries({ queryKey: diaKeys.healthItemSession(itemId) })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}

export function usePauseHealthItemSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: number) => pauseHealthItemSession(itemId),
    onSuccess: (_, itemId) => {
      qc.invalidateQueries({ queryKey: diaKeys.healthItemSession(itemId) })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}

export function useResumeHealthItemSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: number) => resumeHealthItemSession(itemId),
    onSuccess: (_, itemId) => {
      qc.invalidateQueries({ queryKey: diaKeys.healthItemSession(itemId) })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}

export function useDiscardHealthItemSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: number) => discardHealthItemSession(itemId),
    onSuccess: (_, itemId) => {
      qc.invalidateQueries({ queryKey: diaKeys.healthItemSession(itemId) })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}

export function useLinkHealthItemSessionToRecord() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, recordId }: { itemId: number; recordId: number }) =>
      linkHealthItemSessionToRecord(itemId, recordId),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: diaKeys.healthItemSession(vars.itemId) })
      qc.invalidateQueries({ queryKey: diaKeys.all })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}

// ─── Ritual cluster ────────────────────────────────────────────────────

export function useRitualCluster(cadencia: string | null) {
  return useQuery({
    queryKey: diaKeys.ritualCluster(cadencia ?? ''),
    queryFn: () => fetchRitualCluster(cadencia!),
    enabled: !!cadencia,
  })
}

export function useStartRitualCluster() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cadencia: string) => startRitualCluster(cadencia),
    onSuccess: (_, cadencia) => {
      qc.invalidateQueries({ queryKey: diaKeys.ritualCluster(cadencia) })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}

export function usePauseRitualCluster() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cadencia: string) => pauseRitualCluster(cadencia),
    onSuccess: (_, cadencia) => {
      qc.invalidateQueries({ queryKey: diaKeys.ritualCluster(cadencia) })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}

export function useResumeRitualCluster() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cadencia: string) => resumeRitualCluster(cadencia),
    onSuccess: (_, cadencia) => {
      qc.invalidateQueries({ queryKey: diaKeys.ritualCluster(cadencia) })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}

export function useDiscardRitualCluster() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cadencia: string) => discardRitualCluster(cadencia),
    onSuccess: (_, cadencia) => {
      qc.invalidateQueries({ queryKey: diaKeys.ritualCluster(cadencia) })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}

export function useLinkRitualClusterToRecord() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ cadencia, recordId }: { cadencia: string; recordId: string }) =>
      linkRitualClusterToRecord(cadencia, recordId),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: diaKeys.ritualCluster(vars.cadencia) })
      qc.invalidateQueries({ queryKey: diaKeys.all })
      qc.invalidateQueries({ queryKey: ['app', 'active-session'] })
    },
  })
}
