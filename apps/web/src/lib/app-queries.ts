/**
 * React Query hooks pras entidades globais do app (projects, quests, areas,
 * tasks, routines, debts).
 *
 * Mesmo padrão de `build-queries.ts` e `finance-queries.ts`. Substitui o
 * pool de `useState` em `App.tsx` que ficava com state stale entre rotas
 * e exigia `sessionUpdateTrigger` pra forçar refetch.
 *
 * Com React Query: cada hook tem cache automático, invalidação via
 * `useAppInvalidator()`, e refetch em background.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchProjects, fetchQuests, fetchAreas, fetchTasks,
  fetchAllRoutines, fetchRoutinesForDate, fetchDeliverables, fetchFinDebts, fetchProfile,
  fetchMicroTasks,
} from '../api'
import type {
  Project, Quest, Area, Task, Routine, Deliverable, FinDebt, Profile, MicroTask,
} from '../types'

export const appKeys = {
  all: ['app'] as const,
  projects: () => [...appKeys.all, 'projects'] as const,
  quests: () => [...appKeys.all, 'quests'] as const,
  areas: () => [...appKeys.all, 'areas'] as const,
  tasks: () => [...appKeys.all, 'tasks'] as const,
  routines: () => [...appKeys.all, 'routines'] as const,
  /** Rotinas com escopo de data (vem com `done` resolvido pra aquele dia). */
  routinesForDate: (ymd: string) => [...appKeys.all, 'routines', 'forDate', ymd] as const,
  deliverablesByProject: (projectId: string) =>
    [...appKeys.all, 'deliverables', 'byProject', projectId] as const,
  microTasks: () => [...appKeys.all, 'micro-tasks'] as const,
  debts: () => [...appKeys.all, 'debts'] as const,
  profile: () => [...appKeys.all, 'profile'] as const,
}

export function useProjects() {
  return useQuery<Project[]>({ queryKey: appKeys.projects(), queryFn: () => fetchProjects() })
}
export function useQuests() {
  return useQuery<Quest[]>({ queryKey: appKeys.quests(), queryFn: () => fetchQuests() })
}
export function useAreas() {
  return useQuery<Area[]>({ queryKey: appKeys.areas(), queryFn: fetchAreas })
}
export function useTasks() {
  return useQuery<Task[]>({ queryKey: appKeys.tasks(), queryFn: () => fetchTasks() })
}
export function useRoutines() {
  return useQuery<Routine[]>({ queryKey: appKeys.routines(), queryFn: fetchAllRoutines })
}
/** Rotinas resolvidas pra uma data específica — `done`, `start_time`,
 *  `routine_date` já vêm do backend. Cache separado por dia, então
 *  invalidate em `routines()` derruba ambos. */
export function useRoutinesForDate(ymd: string) {
  return useQuery<Routine[]>({
    queryKey: appKeys.routinesForDate(ymd),
    queryFn: () => fetchRoutinesForDate(ymd),
  })
}
/** Entregáveis de um projeto. Habilitar via `enabled` quando o ID existe. */
export function useDeliverablesByProject(projectId: string | null | undefined) {
  return useQuery<Deliverable[]>({
    queryKey: appKeys.deliverablesByProject(projectId ?? ''),
    queryFn: () => fetchDeliverables(projectId!),
    enabled: !!projectId,
  })
}
export function useDebts() {
  return useQuery<FinDebt[]>({ queryKey: appKeys.debts(), queryFn: () => fetchFinDebts() })
}
export function useProfile() {
  return useQuery<Profile>({ queryKey: appKeys.profile(), queryFn: fetchProfile })
}
export function useMicroTasks() {
  return useQuery<MicroTask[]>({ queryKey: appKeys.microTasks(), queryFn: fetchMicroTasks })
}

/**
 * Invalidator pra mutações em entidades globais.
 *
 * Uso: `const inv = useAppInvalidator(); await mutation(); inv.tasks()`.
 *
 * `all()` invalida tudo do escopo app — equivalente ao antigo
 * `onSessionUpdate` que disparava `sessionUpdateTrigger` pra forçar
 * refetch de quests/projects/tasks/etc. Útil em ações cross-entity
 * (ex: finalizar quest pausa sessão + marca done + pode mudar tasks).
 */
export function useAppInvalidator() {
  const qc = useQueryClient()
  return {
    all: () => qc.invalidateQueries({ queryKey: appKeys.all }),
    projects: () => qc.invalidateQueries({ queryKey: appKeys.projects() }),
    quests: () => qc.invalidateQueries({ queryKey: appKeys.quests() }),
    areas: () => qc.invalidateQueries({ queryKey: appKeys.areas() }),
    tasks: () => qc.invalidateQueries({ queryKey: appKeys.tasks() }),
    /** Invalida `useRoutines()` E todos os `useRoutinesForDate(*)` em cache,
     *  porque a key começa com `appKeys.routines()` (prefixo). */
    routines: () => qc.invalidateQueries({ queryKey: appKeys.routines() }),
    deliverablesByProject: (projectId: string) =>
      qc.invalidateQueries({ queryKey: appKeys.deliverablesByProject(projectId) }),
    microTasks: () => qc.invalidateQueries({ queryKey: appKeys.microTasks() }),
    debts: () => qc.invalidateQueries({ queryKey: appKeys.debts() }),
    profile: () => qc.invalidateQueries({ queryKey: appKeys.profile() }),
  }
}
