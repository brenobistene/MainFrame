/**
 * Black Mirror — hooks TanStack Query (padrão da casa: key factory + hooks).
 * Doc/decisões: docs/black-mirror, memória project-black-mirror.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  fetchBlackMirrorHistory,
  fetchBlackMirrorToday,
  generateBlackMirror,
  saveBlackMirrorPasso,
} from '../api'
import type { BlackMirrorReflection } from '../types'

export const blackMirrorKeys = {
  all: ['black-mirror'] as const,
  today: () => [...blackMirrorKeys.all, 'today'] as const,
  history: (limit: number) => [...blackMirrorKeys.all, 'history', limit] as const,
}

export function useBlackMirrorToday() {
  return useQuery({ queryKey: blackMirrorKeys.today(), queryFn: fetchBlackMirrorToday })
}

export function useBlackMirrorHistory(limit = 30) {
  return useQuery({
    queryKey: blackMirrorKeys.history(limit),
    queryFn: () => fetchBlackMirrorHistory(limit),
  })
}

export function useGenerateBlackMirror() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => generateBlackMirror(),
    onSuccess: (data: BlackMirrorReflection) => {
      qc.setQueryData(blackMirrorKeys.today(), data)
      qc.invalidateQueries({ queryKey: blackMirrorKeys.all })
    },
  })
}

export function useSaveBlackMirrorPasso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (meuPasso: string | null) => saveBlackMirrorPasso(meuPasso),
    onSuccess: (data: BlackMirrorReflection) => qc.setQueryData(blackMirrorKeys.today(), data),
  })
}
