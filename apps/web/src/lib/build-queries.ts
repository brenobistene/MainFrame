/**
 * React Query hooks pro módulo /Build.
 *
 * Padrão deste arquivo (TanStack Query foi adotado a partir do /Build —
 * docs/metas-de-vida/PLAN.md §4.4):
 *  - Query keys agrupados em `buildKeys` pra invalidação granular
 *  - Cada query/mutation com hook próprio
 *  - Mutations invalidam só o que muda
 *
 * Quando `/Build` ganhar mais entidades (Meta, Sprint, Guardrail, Ritual),
 * adicionar hooks aqui no mesmo padrão.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  addGoalDependency,
  classifyProject,
  createBuildGoal,
  createBuildPrinciple,
  createBuildRitualSession,
  createBuildSprint,
  createGoalGuardrail,
  deleteBuildGoal,
  deleteBuildPrinciple,
  deleteBuildSprint,
  deleteGoalGuardrail,
  evaluateGoalGuardrails,
  fetchBuildGoals,
  fetchBuildPrinciples,
  fetchBuildPurpose,
  fetchBuildRitualSchedule,
  fetchBuildRitualSessions,
  fetchBuildRituals,
  fetchBuildSettings,
  fetchBuildSprints,
  fetchBuildVision,
  fetchBuildVisionHistory,
  fetchGoalDependencies,
  fetchGoalGuardrails,
  fetchProjectsAlignment,
  linkProjectToGoal,
  removeGoalDependency,
  replaceBuildGoalAreas,
  unlinkProjectFromGoal,
  updateBuildGoal,
  updateBuildPrinciple,
  updateBuildPurpose,
  updateBuildRitual,
  updateBuildSettings,
  updateBuildSprint,
  updateBuildVision,
  updateGoalGuardrail,
  updateGoalProgress,
  versionBuildVision,
} from '../api'
import type {
  BuildGoalAreaLink,
  BuildGoalCreate,
  BuildGoalStatus,
  BuildGoalUpdate,
  BuildGuardrailCreate,
  BuildGuardrailUpdate,
  BuildPrinciple,
  BuildProjectClassification,
  BuildRitualCadencia,
  BuildRitualSessionCreate,
  BuildRitualUpdate,
  BuildSettings,
  BuildSprintCreate,
  BuildSprintUpdate,
  BuildVision,
} from '../types'

export const buildKeys = {
  all: ['build'] as const,
  purpose: () => [...buildKeys.all, 'purpose'] as const,
  principles: (includeArchived = false) =>
    [...buildKeys.all, 'principles', { includeArchived }] as const,
  vision: () => [...buildKeys.all, 'vision'] as const,
  visionHistory: () => [...buildKeys.all, 'vision-history'] as const,
  settings: () => [...buildKeys.all, 'settings'] as const,
  goals: (status?: BuildGoalStatus) =>
    [...buildKeys.all, 'goals', { status: status ?? 'all' }] as const,
  alignment: (params?: { driftOnly?: boolean; goalId?: string }) =>
    [
      ...buildKeys.all,
      'alignment',
      {
        driftOnly: params?.driftOnly ?? false,
        goalId: params?.goalId ?? null,
      },
    ] as const,
  sprints: (goalId?: string) =>
    [...buildKeys.all, 'sprints', { goalId: goalId ?? null }] as const,
  dependencies: (goalId: string) =>
    [...buildKeys.all, 'dependencies', goalId] as const,
  rituals: () => [...buildKeys.all, 'rituals'] as const,
  ritualSessions: (cadencia: BuildRitualCadencia) =>
    [...buildKeys.all, 'ritual-sessions', cadencia] as const,
  ritualSchedule: (from: string, to: string) =>
    [...buildKeys.all, 'ritual-schedule', { from, to }] as const,
  guardrails: (goalId: string) =>
    [...buildKeys.all, 'guardrails', goalId] as const,
  guardrailsEval: (goalId: string) =>
    [...buildKeys.all, 'guardrails-eval', goalId] as const,
}

// ─── Propósito ────────────────────────────────────────────────────────────

export function usePurpose() {
  return useQuery({
    queryKey: buildKeys.purpose(),
    queryFn: fetchBuildPurpose,
  })
}

export function useUpdatePurpose() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (texto: string) => updateBuildPurpose(texto),
    onSuccess: (data) => {
      qc.setQueryData(buildKeys.purpose(), data)
    },
  })
}

// ─── Princípios negativos ─────────────────────────────────────────────────

export function usePrinciples(includeArchived = false) {
  return useQuery({
    queryKey: buildKeys.principles(includeArchived),
    queryFn: () => fetchBuildPrinciples(includeArchived),
  })
}

export function useCreatePrinciple() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ texto, ordem }: { texto: string; ordem?: number }) =>
      createBuildPrinciple(texto, ordem),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...buildKeys.all, 'principles'] })
    },
  })
}

export function useUpdatePrinciple() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: number
      patch: Partial<Pick<BuildPrinciple, 'texto' | 'ordem' | 'arquivado'>>
    }) => updateBuildPrinciple(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...buildKeys.all, 'principles'] })
    },
  })
}

export function useDeletePrinciple() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteBuildPrinciple(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...buildKeys.all, 'principles'] })
    },
  })
}

// ─── Visão ────────────────────────────────────────────────────────────────

export function useVision() {
  return useQuery({
    queryKey: buildKeys.vision(),
    queryFn: fetchBuildVision,
  })
}

export function useVisionHistory() {
  return useQuery({
    queryKey: buildKeys.visionHistory(),
    queryFn: fetchBuildVisionHistory,
  })
}

export function useVersionVision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      texto,
      dataAlvo,
      motivoArquivamento,
    }: {
      texto: string
      dataAlvo: string | null
      motivoArquivamento?: string
    }) => versionBuildVision(texto, dataAlvo, motivoArquivamento),
    onSuccess: (data: BuildVision) => {
      qc.setQueryData(buildKeys.vision(), data)
      qc.invalidateQueries({ queryKey: buildKeys.visionHistory() })
    },
  })
}

export function useUpdateVision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: { texto?: string; data_alvo?: string | null }) =>
      updateBuildVision(patch),
    onSuccess: (data: BuildVision) => {
      qc.setQueryData(buildKeys.vision(), data)
    },
  })
}

// ─── Settings ─────────────────────────────────────────────────────────────

export function useBuildSettings() {
  return useQuery({
    queryKey: buildKeys.settings(),
    queryFn: fetchBuildSettings,
  })
}

export function useUpdateBuildSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<BuildSettings>) => updateBuildSettings(patch),
    onSuccess: (data) => {
      qc.setQueryData(buildKeys.settings(), data)
    },
  })
}

// ─── Metas ────────────────────────────────────────────────────────────────

export function useGoals(status?: BuildGoalStatus) {
  return useQuery({
    queryKey: buildKeys.goals(status),
    queryFn: () => fetchBuildGoals(status),
  })
}

export function useCreateGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: BuildGoalCreate) => createBuildGoal(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...buildKeys.all, 'goals'] })
    },
  })
}

export function useUpdateGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: BuildGoalUpdate }) =>
      updateBuildGoal(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...buildKeys.all, 'goals'] })
    },
  })
}

export function useDeleteGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteBuildGoal(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...buildKeys.all, 'goals'] })
    },
  })
}

export function useReplaceGoalAreas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      areas,
    }: {
      id: string
      areas: BuildGoalAreaLink[]
    }) => replaceBuildGoalAreas(id, areas),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...buildKeys.all, 'goals'] })
    },
  })
}

// ─── Alinhamento Projeto ↔ Meta + drift ───────────────────────────────────

export function useProjectsAlignment(params?: {
  driftOnly?: boolean
  goalId?: string
}) {
  return useQuery({
    queryKey: buildKeys.alignment(params),
    queryFn: () => fetchProjectsAlignment(params),
  })
}

export function useLinkProjectToGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      goalId,
    }: {
      projectId: string
      goalId: string
    }) => linkProjectToGoal(projectId, goalId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...buildKeys.all, 'alignment'] })
    },
  })
}

export function useUnlinkProjectFromGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      goalId,
    }: {
      projectId: string
      goalId: string
    }) => unlinkProjectFromGoal(projectId, goalId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...buildKeys.all, 'alignment'] })
    },
  })
}

export function useClassifyProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      classification,
    }: {
      projectId: string
      classification: BuildProjectClassification | null
    }) => classifyProject(projectId, classification),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...buildKeys.all, 'alignment'] })
    },
  })
}

// ─── Sprints ──────────────────────────────────────────────────────────────

export function useSprints(goalId?: string) {
  return useQuery({
    queryKey: buildKeys.sprints(goalId),
    queryFn: () => fetchBuildSprints(goalId),
    enabled: goalId !== undefined,
  })
}

export function useCreateSprint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: BuildSprintCreate) => createBuildSprint(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...buildKeys.all, 'sprints'] })
    },
  })
}

export function useUpdateSprint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: BuildSprintUpdate }) =>
      updateBuildSprint(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...buildKeys.all, 'sprints'] })
    },
  })
}

export function useDeleteSprint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteBuildSprint(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...buildKeys.all, 'sprints'] })
    },
  })
}

// ─── Dependências entre Metas ─────────────────────────────────────────────

export function useGoalDependencies(goalId: string) {
  return useQuery({
    queryKey: buildKeys.dependencies(goalId),
    queryFn: () => fetchGoalDependencies(goalId),
  })
}

export function useAddGoalDependency() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      goalId,
      requiresGoalId,
    }: {
      goalId: string
      requiresGoalId: string
    }) => addGoalDependency(goalId, requiresGoalId),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: buildKeys.dependencies(vars.goalId) })
    },
  })
}

export function useRemoveGoalDependency() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      goalId,
      requiresGoalId,
    }: {
      goalId: string
      requiresGoalId: string
    }) => removeGoalDependency(goalId, requiresGoalId),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: buildKeys.dependencies(vars.goalId) })
    },
  })
}

// ─── Progresso (v1 — manual) ──────────────────────────────────────────────

export function useUpdateGoalProgress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: number }) =>
      updateGoalProgress(id, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...buildKeys.all, 'goals'] })
    },
  })
}

// ─── Rituais ──────────────────────────────────────────────────────────────

export function useRituals() {
  return useQuery({
    queryKey: buildKeys.rituals(),
    queryFn: fetchBuildRituals,
  })
}

export function useUpdateRitual() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      cadencia,
      patch,
    }: {
      cadencia: BuildRitualCadencia
      patch: BuildRitualUpdate
    }) => updateBuildRitual(cadencia, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: buildKeys.rituals() })
    },
  })
}

export function useRitualSessions(cadencia: BuildRitualCadencia) {
  return useQuery({
    queryKey: buildKeys.ritualSessions(cadencia),
    queryFn: () => fetchBuildRitualSessions(cadencia),
  })
}

export function useCreateRitualSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      cadencia,
      body,
    }: {
      cadencia: BuildRitualCadencia
      body: BuildRitualSessionCreate
    }) => createBuildRitualSession(cadencia, body),
    onSuccess: (_, vars) => {
      // Invalida list de sessions + lista de rituais (proxima_data muda)
      qc.invalidateQueries({
        queryKey: buildKeys.ritualSessions(vars.cadencia),
      })
      qc.invalidateQueries({ queryKey: buildKeys.rituals() })
    },
  })
}

/**
 * Schedule de cada cadência num intervalo de datas. Usado pra renderizar
 * marcadores no Calendar (mês/semana). TTL longo porque o agendamento muda
 * raramente (só quando usuário edita schedule_config) — 15min.
 */
export function useRitualSchedule(from: string | null, to: string | null) {
  return useQuery({
    queryKey: buildKeys.ritualSchedule(from ?? '', to ?? ''),
    queryFn: () => fetchBuildRitualSchedule(from!, to!),
    enabled: from !== null && to !== null,
    staleTime: 15 * 60 * 1000,
  })
}

// ─── Guardrails (v2 — pontes Hub Health) ──────────────────────────────────

export function useGoalGuardrails(goalId: string) {
  return useQuery({
    queryKey: buildKeys.guardrails(goalId),
    queryFn: () => fetchGoalGuardrails(goalId),
  })
}

/**
 * Avaliação dos guardrails: chama Hub Health e calcula estado de cada um.
 * TTL de 5min — alinhado com decisão #15 do PLAN (cache leve no frontend).
 */
export function useGoalGuardrailsEval(goalId: string) {
  return useQuery({
    queryKey: buildKeys.guardrailsEval(goalId),
    queryFn: () => evaluateGoalGuardrails(goalId),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateGoalGuardrail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ goalId, body }: { goalId: string; body: BuildGuardrailCreate }) =>
      createGoalGuardrail(goalId, body),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: buildKeys.guardrails(vars.goalId) })
      qc.invalidateQueries({ queryKey: buildKeys.guardrailsEval(vars.goalId) })
    },
  })
}

export function useUpdateGoalGuardrail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      goalId,
      guardrailId,
      patch,
    }: {
      goalId: string
      guardrailId: number
      patch: BuildGuardrailUpdate
    }) => updateGoalGuardrail(goalId, guardrailId, patch),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: buildKeys.guardrails(vars.goalId) })
      qc.invalidateQueries({ queryKey: buildKeys.guardrailsEval(vars.goalId) })
    },
  })
}

export function useDeleteGoalGuardrail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ goalId, guardrailId }: { goalId: string; guardrailId: number }) =>
      deleteGoalGuardrail(goalId, guardrailId),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: buildKeys.guardrails(vars.goalId) })
      qc.invalidateQueries({ queryKey: buildKeys.guardrailsEval(vars.goalId) })
    },
  })
}
