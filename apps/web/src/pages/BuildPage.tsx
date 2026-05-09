/**
 * /build — Página da camada estratégica do Hub Quest.
 *
 * Layout v0: Character Sheet inicial com 3 painéis principais
 *  - Propósito (texto livre + lista de princípios negativos)
 *  - Visão de 3 anos (texto + data alvo + ação "versionar")
 *  - Settings (placeholder no v0; UI completa em v0.5+)
 *
 * Próximos painéis (Metas, Sprints, Rituais, Drift) entram nas próximas
 * fases. Detalhe em docs/metas-de-vida/PLAN.md.
 *
 * Estética: Neomilitarism — preto fosco + vermelho saturado + monospace.
 * Sem brilho/gradiente. Tipografia agressiva pra títulos. Refs visuais em
 * docs/design-system/STYLES.md §3.2.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Pencil, Plus, X, Check, Archive, History, Star, Target, AlertTriangle, Calendar,
  Link2, ChevronDown, ChevronRight, Wrench, Zap, Compass, Pause, Trash2,
  Clock, Activity, Settings as SettingsIcon, Shield, ShieldAlert, ShieldQuestion,
} from 'lucide-react'

import { fetchAreas } from '../api'
import {
  useAddGoalDependency,
  useClassifyProject,
  useCreateGoal,
  useCreateGoalGuardrail,
  useCreatePrinciple,
  useCreateRitualSession,
  useCreateSprint,
  useDeleteGoalGuardrail,
  useDeletePrinciple,
  useDeleteSprint,
  useGoalDependencies,
  useGoalGuardrailsEval,
  useGoals,
  useLinkProjectToGoal,
  usePrinciples,
  useProjectsAlignment,
  usePurpose,
  useRemoveGoalDependency,
  useRituals,
  useSprints,
  useUpdateGoal,
  useUpdateGoalProgress,
  useUpdateRitual,
  useUpdateSprint,
  useUpdatePurpose,
  useVersionVision,
  useVision,
  useUpdateVision,
} from '../lib/build-queries'
import { useHealthMetricsCatalog, useHealthItems } from '../lib/health-queries'
import type {
  Area,
  BuildGoal,
  BuildGoalAreaLink,
  BuildGoalCreate,
  BuildGoalCriterionType,
  BuildGoalHorizon,
  BuildGuardrailEvaluation,
  BuildGuardrailOperador,
  BuildProjectAlignment,
  BuildProjectClassification,
  BuildRitual,
  BuildRitualCadencia,
  BuildSprint,
  HealthMetricMeta,
} from '../types'

// ─── Tokens visuais (Neomilitarism — calibrado em 2026-05-09 com refs CP2077) ──
// Paleta autoritativa em docs/design-system/STYLES.md §3.2.
// Calibração baseada em: Summary Screen (fa8d26), Tarot (15df40), Metro Map
// (d2b52e). Vermelho queimado (não bubble-gum), preto frio profundo, cyan
// como accent tech secundário.

const NEO = {
  bg: '#050608',            // preto frio profundo
  panel: '#0c0d10',         // painel: tom acima do bg
  border: '#1a1a1f',        // borda inativa
  borderHot: '#3d1418',     // borda com tinge vermelho (sutil)
  textPrimary: '#dde3e8',   // branco-cyan ligeiramente frio
  textSecondary: '#8a9098',
  textMuted: '#4d5258',
  accent: '#dc2531',        // vermelho-sangue saturado (não pink)
  accentDim: '#7a1015',     // pra hover/disabled
  cyan: '#4dd0e1',          // accent tech (headers de status, brackets)
  cyanDim: '#1f6b75',
}

const MONO = '"IBM Plex Mono", "SF Mono", Consolas, monospace'

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  // Aceita YYYY-MM-DD ou YYYY-MM-DD HH:MM:SS
  const d = new Date(iso.includes('T') || iso.includes(' ') ? iso : `${iso}T00:00:00`)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ─── Página ───────────────────────────────────────────────────────────────

export default function BuildPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: NEO.bg,
        color: NEO.textPrimary,
        fontFamily: MONO,
        padding: '24px 40px 64px',
        position: 'relative',
      }}
    >
      {/* Glitch line vermelha vertical no canto esquerdo — assinatura visual
          do Neomilitarism CP2077. Muito sutil. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 80,
          bottom: 80,
          width: 2,
          background: `linear-gradient(180deg, transparent 0%, ${NEO.accent} 20%, ${NEO.accent} 80%, transparent 100%)`,
          opacity: 0.6,
          pointerEvents: 'none',
        }}
      />
      <Header />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 20,
          marginTop: 28,
        }}
      >
        <PurposePanel />
        <VisionPanel />
      </div>
      <div style={{ marginTop: 20 }}>
        <RitualsPanel />
      </div>
      <div style={{ marginTop: 20 }}>
        <GoalsPanel />
      </div>
      <div style={{ marginTop: 20 }}>
        <DriftPanel />
      </div>
    </div>
  )
}

// ─── Painel das Metas ─────────────────────────────────────────────────────

function GoalsPanel() {
  const { data: goals = [], isLoading } = useGoals('ativa')
  const [creating, setCreating] = useState(false)

  return (
    <Panel
      title="METAS ATIVAS"
      subtitle={`${goals.length} ${goals.length === 1 ? 'breakpoint' : 'breakpoints'} no caminho`}
    >
      {isLoading ? (
        <div style={{ color: NEO.textMuted, fontSize: 13 }}>Carregando…</div>
      ) : (
        <>
          {goals.length === 0 && !creating && (
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: NEO.textMuted,
                fontStyle: 'italic',
                lineHeight: 1.6,
              }}
            >
              Nenhuma Meta ativa. Meta = outcome com prazo (não ação). Ex.: "ter 5k/mês fixo até dez/2027" — não "fazer curso X".
            </p>
          )}

          {goals.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {goals.map((g) => (
                <GoalRow key={g.id} goal={g} />
              ))}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <ActionBtn
              onClick={() => setCreating(true)}
              icon={<Plus size={13} />}
              label="Nova Meta"
              variant="accent"
            />
          </div>
        </>
      )}

      {creating && <GoalCreateModal onClose={() => setCreating(false)} />}
    </Panel>
  )
}

// ─── Linha de Meta ────────────────────────────────────────────────────────

function GoalRow({ goal }: { goal: BuildGoal }) {
  const { data: areas = [] } = useQuery({
    queryKey: ['areas-list'],
    queryFn: fetchAreas,
    staleTime: 5 * 60 * 1000,
  })
  const { data: linkedProjects = [] } = useProjectsAlignment({ goalId: goal.id })
  const updateGoal = useUpdateGoal()

  const primary = goal.areas.find((a) => a.is_primary)
  const secondaries = goal.areas.filter((a) => !a.is_primary)
  const primaryArea = primary && areas.find((a: Area) => a.slug === primary.area_slug)

  return (
    <div
      style={{
        position: 'relative',
        background: NEO.bg,
        border: `1px solid ${NEO.border}`,
        borderLeft: `2px solid ${primaryArea?.color ?? NEO.accent}`,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {goal.is_foundational && (
          <span
            title="Meta de fundação — pré-requisito"
            style={{ display: 'inline-flex', color: NEO.accent }}
          >
            <Star size={14} fill={NEO.accent} />
          </span>
        )}
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: NEO.textPrimary,
            letterSpacing: '0.02em',
            flex: 1,
          }}
        >
          {goal.titulo}
        </span>
        <span
          style={{
            fontSize: 9,
            color: NEO.textMuted,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
          }}
        >
          {goal.horizon}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          fontSize: 11,
          color: NEO.textSecondary,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Calendar size={11} />
          até {fmtDate(goal.data_alvo)}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Target size={11} />
          {goal.criterion_type === 'numeric'
            ? `target ${goal.criterion_target_value}`
            : 'booleano'}
        </span>
        {primaryArea && (
          <span
            style={{
              padding: '1px 6px',
              border: `1px solid ${primaryArea.color}55`,
              color: primaryArea.color,
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            {primaryArea.name}
          </span>
        )}
        {secondaries.length > 0 && (
          <span style={{ fontSize: 10, color: NEO.textMuted }}>
            +{secondaries.length} cross
          </span>
        )}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            color: linkedProjects.length > 0 ? NEO.cyan : NEO.textMuted,
            letterSpacing: '0.1em',
          }}
          title={`${linkedProjects.length} projeto(s) servindo essa Meta`}
        >
          <Link2 size={10} />
          {linkedProjects.length} projeto{linkedProjects.length === 1 ? '' : 's'}
        </span>
      </div>

      {goal.descricao && (
        <div
          style={{
            fontSize: 12,
            color: NEO.textMuted,
            lineHeight: 1.5,
            marginTop: 2,
          }}
        >
          {goal.descricao}
        </div>
      )}

      {/* Sub-painéis: progresso (numérico) + sprints (anual) + deps + guardrails */}
      {goal.criterion_type === 'numeric' && <GoalProgressBar goal={goal} />}
      {goal.horizon === 'anual' && <SprintsInline goal={goal} />}
      <DependenciesInline goal={goal} />
      <GuardrailsInline goal={goal} />

      {/* Ações rápidas */}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <MicroBtn
          onClick={() =>
            updateGoal.mutate({ id: goal.id, patch: { status: 'concluida' } })
          }
          label="✓ concluir"
        />
        <MicroBtn
          onClick={() =>
            updateGoal.mutate({ id: goal.id, patch: { status: 'pausada' } })
          }
          label="∥ pausar"
        />
        <MicroBtn
          onClick={() =>
            updateGoal.mutate({ id: goal.id, patch: { status: 'abandonada' } })
          }
          label="× abandonar"
        />
      </div>
    </div>
  )
}

// ─── Barra de progresso pra Meta numérica ─────────────────────────────────

function GoalProgressBar({ goal }: { goal: BuildGoal }) {
  const updateProgress = useUpdateGoalProgress()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const target = goal.criterion_target_value ?? 0
  const current = goal.criterion_current_value ?? 0
  const pct = target > 0 ? Math.max(0, Math.min(100, (current / target) * 100)) : 0

  function startEdit() {
    setDraft(String(current))
    setEditing(true)
  }
  function save() {
    const num = Number(draft)
    if (isNaN(num)) return
    updateProgress.mutate(
      { id: goal.id, value: num },
      { onSuccess: () => setEditing(false) },
    )
  }

  return (
    <div style={{ marginTop: 6 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: NEO.textSecondary,
          marginBottom: 4,
        }}
      >
        <span style={{ flex: 1 }}>
          progresso:{' '}
          <span style={{ color: NEO.textPrimary, fontWeight: 700 }}>
            {current.toLocaleString('pt-BR')}
          </span>{' '}
          / {target.toLocaleString('pt-BR')}{' '}
          <span style={{ color: NEO.cyan, marginLeft: 4 }}>{pct.toFixed(0)}%</span>
        </span>
        {editing ? (
          <span style={{ display: 'flex', gap: 4 }}>
            <input
              type="number"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
                if (e.key === 'Escape') setEditing(false)
              }}
              autoFocus
              style={{
                background: NEO.bg,
                color: NEO.textPrimary,
                border: `1px solid ${NEO.accent}`,
                padding: '2px 6px',
                fontFamily: MONO,
                fontSize: 11,
                width: 80,
                outline: 'none',
              }}
            />
            <MicroBtn onClick={save} label="ok" />
            <MicroBtn onClick={() => setEditing(false)} label="x" />
          </span>
        ) : (
          <MicroBtn onClick={startEdit} label="↻ atualizar" />
        )}
      </div>
      {/* Barra fina */}
      <div
        style={{
          height: 4,
          background: NEO.border,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: NEO.accent,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  )
}

// ─── Sprints inline pra Meta anual ────────────────────────────────────────

function SprintsInline({ goal }: { goal: BuildGoal }) {
  const { data: sprints = [] } = useSprints(goal.id)
  const createSprint = useCreateSprint()
  const updateSprint = useUpdateSprint()
  const deleteSprint = useDeleteSprint()
  const [adding, setAdding] = useState(false)

  function quickCreate() {
    // Defaults sensatos: 12 semanas a partir de hoje (próximo Sprint)
    const lastEnd = sprints.length > 0
      ? sprints[sprints.length - 1].data_fim
      : new Date().toISOString().slice(0, 10)
    const start = new Date(lastEnd)
    start.setDate(start.getDate() + 1)
    const end = new Date(start)
    end.setDate(end.getDate() + 7 * 12 - 1) // 12 semanas

    createSprint.mutate(
      {
        goal_id: goal.id,
        data_inicio: start.toISOString().slice(0, 10),
        data_fim: end.toISOString().slice(0, 10),
      },
      { onSuccess: () => setAdding(false) },
    )
  }

  if (sprints.length === 0 && !adding) {
    return (
      <div
        style={{
          marginTop: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 10,
          color: NEO.textMuted,
          letterSpacing: '0.05em',
        }}
      >
        <MicroBtn onClick={quickCreate} label="+ Sprint (12 sem)" />
        <span>· marcos de 12 semanas dentro da Meta anual</span>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 6 }}>
      <div
        style={{
          fontSize: 9,
          color: NEO.textMuted,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        Sprints ({sprints.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {sprints.map((s: BuildSprint) => (
          <SprintRow
            key={s.id}
            sprint={s}
            onUpdate={(patch) => updateSprint.mutate({ id: s.id, patch })}
            onDelete={() => deleteSprint.mutate(s.id)}
          />
        ))}
      </div>
      <div style={{ marginTop: 4 }}>
        <MicroBtn onClick={quickCreate} label="+ próximo sprint" />
      </div>
    </div>
  )
}

function SprintRow({
  sprint,
  onUpdate,
  onDelete,
}: {
  sprint: BuildSprint
  onUpdate: (patch: { foco?: string | null; status?: BuildSprint['status'] }) => void
  onDelete: () => void
}) {
  const [editingFoco, setEditingFoco] = useState(false)
  const [draftFoco, setDraftFoco] = useState(sprint.foco ?? '')

  const statusColor = {
    planejado: NEO.textMuted,
    ativo: NEO.accent,
    concluido: NEO.cyan,
    abandonado: NEO.textMuted,
  }[sprint.status]

  return (
    <div
      style={{
        background: 'transparent',
        border: `1px solid ${NEO.border}`,
        borderLeft: `2px solid ${statusColor}`,
        padding: '4px 8px',
        fontSize: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        color: NEO.textSecondary,
      }}
    >
      <span style={{ color: NEO.cyan, fontWeight: 700, minWidth: 20 }}>
        #{sprint.numero}
      </span>
      <span style={{ fontSize: 10, color: NEO.textMuted, minWidth: 110 }}>
        {fmtDate(sprint.data_inicio)} → {fmtDate(sprint.data_fim)}
      </span>
      {editingFoco ? (
        <input
          value={draftFoco}
          onChange={(e) => setDraftFoco(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onUpdate({ foco: draftFoco.trim() || null })
              setEditingFoco(false)
            }
            if (e.key === 'Escape') setEditingFoco(false)
          }}
          onBlur={() => {
            onUpdate({ foco: draftFoco.trim() || null })
            setEditingFoco(false)
          }}
          autoFocus
          placeholder="foco do sprint"
          style={{
            flex: 1,
            background: NEO.bg,
            color: NEO.textPrimary,
            border: `1px solid ${NEO.accent}`,
            padding: '1px 6px',
            fontFamily: MONO,
            fontSize: 11,
            outline: 'none',
          }}
        />
      ) : (
        <span
          style={{
            flex: 1,
            color: sprint.foco ? NEO.textPrimary : NEO.textMuted,
            fontStyle: sprint.foco ? 'normal' : 'italic',
            cursor: 'pointer',
          }}
          onClick={() => {
            setDraftFoco(sprint.foco ?? '')
            setEditingFoco(true)
          }}
        >
          {sprint.foco || 'definir foco…'}
        </span>
      )}
      <select
        value={sprint.status}
        onChange={(e) =>
          onUpdate({ status: e.target.value as BuildSprint['status'] })
        }
        style={{
          background: NEO.bg,
          color: statusColor,
          border: `1px solid ${NEO.border}`,
          fontFamily: MONO,
          fontSize: 9,
          padding: '1px 4px',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        <option value="planejado">PLAN</option>
        <option value="ativo">ATIVO</option>
        <option value="concluido">DONE</option>
        <option value="abandonado">×</option>
      </select>
      <button
        type="button"
        onClick={onDelete}
        title="Excluir sprint"
        style={{
          background: 'transparent',
          border: 'none',
          color: NEO.textMuted,
          cursor: 'pointer',
          padding: 2,
          display: 'flex',
        }}
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

// ─── Dependências entre Metas ─────────────────────────────────────────────

function DependenciesInline({ goal }: { goal: BuildGoal }) {
  const { data: deps = [] } = useGoalDependencies(goal.id)
  const { data: allGoals = [] } = useGoals('ativa')
  const addDep = useAddGoalDependency()
  const removeDep = useRemoveGoalDependency()
  const [picking, setPicking] = useState(false)

  // Metas elegíveis pra ser pré-requisito: ativas, diferentes da atual, e
  // que ainda não são deps (backend valida ciclos, não preciso checar aqui)
  const eligible = allGoals.filter(
    (g) =>
      g.id !== goal.id &&
      !deps.some((d) => d.requires_goal_id === g.id),
  )

  if (deps.length === 0 && !picking) {
    return (
      <div
        style={{
          marginTop: 4,
          fontSize: 10,
          color: NEO.textMuted,
        }}
      >
        <MicroBtn onClick={() => setPicking(true)} label="+ depende de…" />
      </div>
    )
  }

  return (
    <div style={{ marginTop: 6 }}>
      {deps.length > 0 && (
        <>
          <div
            style={{
              fontSize: 9,
              color: NEO.textMuted,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            Depende de
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {deps.map((d) => (
              <div
                key={d.requires_goal_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '3px 8px',
                  background: 'transparent',
                  border: `1px solid ${
                    d.is_satisfied ? NEO.cyanDim : NEO.borderHot
                  }`,
                  fontSize: 11,
                }}
              >
                {d.is_satisfied ? (
                  <Check size={11} color={NEO.cyan} />
                ) : (
                  <Pause size={11} color={NEO.accent} />
                )}
                <span style={{ flex: 1, color: NEO.textPrimary }}>
                  {d.requires_titulo}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    color: d.is_satisfied ? NEO.cyan : NEO.accent,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}
                >
                  {d.is_satisfied ? 'OK' : d.requires_status}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    removeDep.mutate({
                      goalId: goal.id,
                      requiresGoalId: d.requires_goal_id,
                    })
                  }
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: NEO.textMuted,
                    cursor: 'pointer',
                    padding: 2,
                    display: 'flex',
                  }}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {picking ? (
        <div
          style={{
            marginTop: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            border: `1px dashed ${NEO.borderHot}`,
            padding: 6,
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: NEO.textMuted,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
            }}
          >
            adicionar pré-requisito:
          </div>
          {eligible.length === 0 && (
            <div style={{ fontSize: 11, color: NEO.textMuted, fontStyle: 'italic' }}>
              Nenhuma outra Meta ativa disponível.
            </div>
          )}
          {eligible.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => {
                addDep.mutate(
                  { goalId: goal.id, requiresGoalId: g.id },
                  { onSuccess: () => setPicking(false) },
                )
              }}
              style={{
                background: 'transparent',
                border: `1px solid ${NEO.border}`,
                color: NEO.textPrimary,
                fontFamily: MONO,
                fontSize: 11,
                padding: '3px 8px',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {g.is_foundational && <Star size={9} fill={NEO.accent} color={NEO.accent} />}
              {g.titulo}
            </button>
          ))}
          <MicroBtn onClick={() => setPicking(false)} label="cancelar" />
        </div>
      ) : (
        <div style={{ marginTop: 4 }}>
          <MicroBtn onClick={() => setPicking(true)} label="+ pré-requisito" />
        </div>
      )}
    </div>
  )
}

// ─── Painel Drift (projetos órfãos) ───────────────────────────────────────

function DriftPanel() {
  const { data: drift = [], isLoading } = useProjectsAlignment({ driftOnly: true })
  const [expanded, setExpanded] = useState(false)

  return (
    <Panel
      title="DRIFT · PROJETOS SEM ALINHAMENTO"
      subtitle={
        drift.length === 0
          ? '// nenhum projeto em drift — vida ordenada'
          : `// ${drift.length} ${drift.length === 1 ? 'projeto sem' : 'projetos sem'} meta nem classificação`
      }
    >
      {isLoading ? (
        <div style={{ color: NEO.textMuted, fontSize: 13 }}>Carregando…</div>
      ) : drift.length === 0 ? (
        <div
          style={{
            padding: '14px 0',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            color: NEO.cyan,
            fontSize: 12,
          }}
        >
          <Check size={14} />
          Toda execução está mapeada — alinhada a Meta ou classificada.
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            style={{
              background: 'transparent',
              border: 'none',
              color: NEO.textPrimary,
              cursor: 'pointer',
              padding: '8px 0',
              fontFamily: MONO,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              textAlign: 'left',
            }}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span style={{ color: NEO.accent, fontWeight: 700 }}>
              {drift.length}
            </span>{' '}
            projetos esperando classificação ou vínculo com Meta
          </button>
          {expanded && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                marginTop: 8,
                maxHeight: 480,
                overflowY: 'auto',
                paddingRight: 4,
              }}
            >
              {drift.map((p) => (
                <DriftRow key={p.id} project={p} />
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

function DriftRow({ project }: { project: BuildProjectAlignment }) {
  const { data: areas = [] } = useQuery({
    queryKey: ['areas-list'],
    queryFn: fetchAreas,
    staleTime: 5 * 60 * 1000,
  })
  const { data: goals = [] } = useGoals('ativa')
  const linkProject = useLinkProjectToGoal()
  const classifyProj = useClassifyProject()
  const [linking, setLinking] = useState(false)

  const area = areas.find((a: Area) => a.slug === project.area_slug)

  function classify(c: BuildProjectClassification) {
    classifyProj.mutate({ projectId: project.id, classification: c })
  }

  function link(goalId: string) {
    linkProject.mutate(
      { projectId: project.id, goalId },
      { onSuccess: () => setLinking(false) },
    )
  }

  return (
    <div
      style={{
        background: NEO.bg,
        border: `1px solid ${NEO.border}`,
        borderLeft: `2px solid ${area?.color ?? NEO.textMuted}`,
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 13,
            color: NEO.textPrimary,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={project.title}
        >
          {project.title}
        </span>
        {area && (
          <span
            style={{
              fontSize: 9,
              color: area.color,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
            }}
          >
            {area.name}
          </span>
        )}
      </div>

      {linking ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{
              fontSize: 9,
              color: NEO.textMuted,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
            }}
          >
            Vincular a:
          </div>
          {goals.length === 0 && (
            <div style={{ fontSize: 11, color: NEO.textMuted, fontStyle: 'italic' }}>
              Nenhuma Meta ativa pra vincular. Crie uma Meta primeiro.
            </div>
          )}
          {goals.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => link(g.id)}
              disabled={linkProject.isPending}
              style={{
                background: 'transparent',
                border: `1px solid ${NEO.border}`,
                color: NEO.textPrimary,
                fontFamily: MONO,
                fontSize: 11,
                padding: '4px 8px',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {g.is_foundational && <Star size={10} fill={NEO.accent} color={NEO.accent} />}
              {g.titulo}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setLinking(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: NEO.textMuted,
              fontFamily: MONO,
              fontSize: 10,
              padding: '4px 0',
              cursor: 'pointer',
              textAlign: 'left',
              letterSpacing: '0.1em',
            }}
          >
            cancelar
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <DriftAction
            onClick={() => setLinking(true)}
            icon={<Link2 size={11} />}
            label="Vincular a Meta"
            variant="accent"
          />
          <DriftAction
            onClick={() => classify('manutencao')}
            icon={<Wrench size={11} />}
            label="Manutenção"
          />
          <DriftAction
            onClick={() => classify('reativo')}
            icon={<Zap size={11} />}
            label="Reativo"
          />
          <DriftAction
            onClick={() => classify('exploratorio')}
            icon={<Compass size={11} />}
            label="Exploratório"
          />
        </div>
      )}
    </div>
  )
}

function DriftAction({
  onClick,
  icon,
  label,
  variant,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  variant?: 'accent'
}) {
  const isAccent = variant === 'accent'
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        color: isAccent ? NEO.accent : NEO.textSecondary,
        border: `1px solid ${isAccent ? NEO.accent : NEO.border}`,
        padding: '3px 8px',
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.1em',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        textTransform: 'uppercase',
      }}
    >
      {icon} {label}
    </button>
  )
}

// ─── Painel dos Rituais (4 cadências) ─────────────────────────────────────

function RitualsPanel() {
  const { data: rituals = [], isLoading } = useRituals()
  const [reviewing, setReviewing] = useState<BuildRitualCadencia | null>(null)
  const [configuring, setConfiguring] = useState<BuildRitualCadencia | null>(null)

  const totalAtrasados = rituals.filter((r) => r.dias_atraso > 0 && r.ativo).length

  return (
    <Panel
      title="RITUAIS · REVISÃO"
      subtitle={
        totalAtrasados > 0
          ? `// ${totalAtrasados} ritual${totalAtrasados === 1 ? '' : 'is'} atrasado${totalAtrasados === 1 ? '' : 's'}`
          : '// ponte entre estrategista e executor'
      }
    >
      {isLoading ? (
        <div style={{ color: NEO.textMuted, fontSize: 13 }}>Carregando…</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 10,
          }}
        >
          {rituals.map((r) => (
            <RitualCard
              key={r.cadencia}
              ritual={r}
              onReview={() => setReviewing(r.cadencia)}
              onConfigure={() => setConfiguring(r.cadencia)}
            />
          ))}
        </div>
      )}

      {reviewing && (
        <RitualReviewModal
          cadencia={reviewing}
          ritual={rituals.find((r) => r.cadencia === reviewing)!}
          onClose={() => setReviewing(null)}
        />
      )}
      {configuring && (
        <RitualConfigModal
          cadencia={configuring}
          ritual={rituals.find((r) => r.cadencia === configuring)!}
          onClose={() => setConfiguring(null)}
        />
      )}
    </Panel>
  )
}

const CADENCIA_LABELS: Record<BuildRitualCadencia, string> = {
  semanal: 'SEMANAL',
  mensal: 'MENSAL',
  trimestral: 'TRIMESTRAL',
  anual: 'ANUAL',
}

function daysFromToday(iso: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${iso}T00:00:00`)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function RitualCard({
  ritual,
  onReview,
  onConfigure,
}: {
  ritual: BuildRitual
  onReview: () => void
  onConfigure: () => void
}) {
  const isAtrasado = ritual.dias_atraso > 0
  const proximaDays = ritual.proxima_data ? daysFromToday(ritual.proxima_data) : null

  return (
    <div
      style={{
        position: 'relative',
        background: NEO.bg,
        border: `1px solid ${isAtrasado ? NEO.accent : NEO.border}`,
        padding: '10px 12px',
        opacity: ritual.ativo ? 1 : 0.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Header com cadência + settings */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: isAtrasado ? NEO.accent : NEO.cyan,
            letterSpacing: '0.25em',
            fontWeight: 700,
          }}
        >
          {CADENCIA_LABELS[ritual.cadencia]}
        </span>
        <button
          type="button"
          onClick={onConfigure}
          title="Configurar ritual"
          style={{
            background: 'transparent',
            border: 'none',
            color: NEO.textMuted,
            cursor: 'pointer',
            padding: 2,
            display: 'flex',
          }}
        >
          <SettingsIcon size={11} />
        </button>
      </div>

      {/* Próxima data */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div
          style={{
            fontSize: 9,
            color: NEO.textMuted,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
          }}
        >
          {isAtrasado ? 'atrasado há' : 'próxima'}
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: isAtrasado ? NEO.accent : NEO.textPrimary,
            letterSpacing: '0.02em',
            display: 'flex',
            alignItems: 'baseline',
            gap: 4,
          }}
        >
          {isAtrasado
            ? `${ritual.dias_atraso}d`
            : proximaDays !== null && proximaDays === 0
            ? 'hoje'
            : proximaDays !== null
            ? `${proximaDays}d`
            : '—'}
        </div>
        <div style={{ fontSize: 10, color: NEO.textMuted }}>
          {ritual.proxima_data ? fmtDate(ritual.proxima_data) : '—'}
        </div>
      </div>

      {/* Última execução */}
      <div
        style={{
          fontSize: 10,
          color: NEO.textMuted,
          paddingTop: 6,
          borderTop: `1px dashed ${NEO.border}`,
        }}
      >
        {ritual.ultima_execucao ? (
          <>
            <Clock size={10} style={{ verticalAlign: '-2px' }} /> última:{' '}
            {fmtDate(ritual.ultima_execucao)}
          </>
        ) : (
          <span style={{ fontStyle: 'italic' }}>nunca executado</span>
        )}
      </div>

      {/* Botão de iniciar */}
      <button
        type="button"
        onClick={onReview}
        disabled={!ritual.ativo}
        style={{
          background: isAtrasado ? NEO.accent : 'transparent',
          color: isAtrasado ? '#000' : NEO.accent,
          border: `1px solid ${NEO.accent}`,
          padding: '4px 8px',
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          cursor: ritual.ativo ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          opacity: ritual.ativo ? 1 : 0.4,
        }}
      >
        <Activity size={11} /> iniciar
      </button>
    </div>
  )
}

// ─── Modal de revisão ─────────────────────────────────────────────────────

function RitualReviewModal({
  cadencia,
  ritual,
  onClose,
}: {
  cadencia: BuildRitualCadencia
  ritual: BuildRitual
  onClose: () => void
}) {
  const createSession = useCreateRitualSession()
  const today = new Date().toISOString().slice(0, 10)
  const [dataExecutado, setDataExecutado] = useState(today)
  const [duracao, setDuracao] = useState('')
  const [notas, setNotas] = useState('')
  const [focoProx, setFocoProx] = useState('')

  function submit() {
    createSession.mutate(
      {
        cadencia,
        body: {
          data_executado: dataExecutado,
          duracao_min: duracao.trim() ? Number(duracao) : null,
          notas: notas.trim() || null,
          foco_proxima_periodo: focoProx.trim() || null,
        },
      },
      { onSuccess: onClose },
    )
  }

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.9)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 20px',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 720,
          background: NEO.panel,
          border: `1px solid ${NEO.accent}`,
          padding: '28px 32px',
          position: 'relative',
        }}
      >
        <CornerBracket position="tl" />
        <CornerBracket position="tr" />
        <CornerBracket position="bl" />
        <CornerBracket position="br" />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 6,
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.32em',
              color: NEO.accent,
              fontWeight: 700,
            }}
          >
            ❰ RITUAL · {CADENCIA_LABELS[cadencia]}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: NEO.textSecondary,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div
          style={{
            fontSize: 10,
            color: NEO.textMuted,
            marginBottom: 24,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          // duração alvo: {ritual.duracao_alvo_min} min · escopo disciplinado abaixo
        </div>

        {/* Direcionamentos em destaque */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              border: `1px solid ${NEO.cyanDim}`,
              padding: '12px 14px',
              background: `${NEO.cyan}05`,
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: NEO.cyan,
                letterSpacing: '0.25em',
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              ✓ O QUE PENSAR
            </div>
            <div
              style={{
                fontSize: 12,
                color: NEO.textPrimary,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}
            >
              {ritual.direcionamento_pensar}
            </div>
          </div>
          <div
            style={{
              border: `1px solid ${NEO.borderHot}`,
              padding: '12px 14px',
              background: `${NEO.accent}08`,
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: NEO.accent,
                letterSpacing: '0.25em',
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              × O QUE NÃO PENSAR
            </div>
            <div
              style={{
                fontSize: 12,
                color: NEO.textPrimary,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}
            >
              {ritual.direcionamento_evitar}
            </div>
          </div>
        </div>

        {/* Form de session */}
        <div
          style={{
            fontSize: 10,
            color: NEO.textSecondary,
            letterSpacing: '0.25em',
            fontWeight: 700,
            textTransform: 'uppercase',
            marginBottom: 8,
            paddingTop: 12,
            borderTop: `1px dashed ${NEO.border}`,
          }}
        >
          Registrar revisão
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <Label>DATA</Label>
            <input
              type="date"
              value={dataExecutado}
              onChange={(e) => setDataExecutado(e.target.value)}
              style={{ ...inputBlockStyle, marginTop: 4 }}
            />
          </div>
          <div style={{ width: 140 }}>
            <Label>DURAÇÃO (MIN)</Label>
            <input
              type="number"
              value={duracao}
              onChange={(e) => setDuracao(e.target.value)}
              placeholder={String(ritual.duracao_alvo_min)}
              style={{ ...inputBlockStyle, marginTop: 4 }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <Label>NOTAS DA REFLEXÃO</Label>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="o que saiu da reflexão? (visível só pra você)"
            rows={4}
            style={{ ...textareaStyle, marginTop: 4 }}
          />
        </div>

        {cadencia === 'semanal' && (
          <div style={{ marginBottom: 12 }}>
            <Label>FOCO DA PRÓXIMA SEMANA</Label>
            <textarea
              value={focoProx}
              onChange={(e) => setFocoProx(e.target.value)}
              placeholder="1-2 Metas como foco explícito"
              rows={2}
              style={{ ...textareaStyle, marginTop: 4 }}
            />
          </div>
        )}

        <div
          style={{
            marginTop: 20,
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <ActionBtn
            onClick={onClose}
            icon={<X size={14} />}
            label="Cancelar"
            variant="muted"
          />
          <ActionBtn
            onClick={submit}
            icon={<Check size={14} />}
            label="Concluir Revisão"
            variant="accent"
            disabled={createSession.isPending}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Modal de configuração ────────────────────────────────────────────────

function RitualConfigModal({
  cadencia,
  ritual,
  onClose,
}: {
  cadencia: BuildRitualCadencia
  ritual: BuildRitual
  onClose: () => void
}) {
  const updateRitual = useUpdateRitual()
  const [ativo, setAtivo] = useState(ritual.ativo)
  const [pensar, setPensar] = useState(ritual.direcionamento_pensar)
  const [evitar, setEvitar] = useState(ritual.direcionamento_evitar)
  const [duracao, setDuracao] = useState(String(ritual.duracao_alvo_min))
  // schedule_config: tratamos por cadência. Pra simplificar v1.5, expomos
  // só o caso mais comum de cada uma. Edição avançada (datas custom etc)
  // fica pra v2+.
  const [scheduleVal, setScheduleVal] = useState<string>(() => {
    if (cadencia === 'semanal') {
      return String(ritual.schedule_config.dia_semana ?? 0)
    }
    if (cadencia === 'mensal') {
      const modo = ritual.schedule_config.modo
      if (modo === 'data_fixa') {
        return `data:${ritual.schedule_config.dia ?? 1}`
      }
      return 'fim_de_semana'
    }
    if (cadencia === 'anual') {
      return String(ritual.schedule_config.data ?? '01-01')
    }
    return ''
  })

  function buildScheduleConfig(): Record<string, unknown> {
    if (cadencia === 'semanal') {
      return { dia_semana: Number(scheduleVal) }
    }
    if (cadencia === 'mensal') {
      if (scheduleVal === 'fim_de_semana') {
        return { modo: 'primeiro_fim_de_semana' }
      }
      const dia = Number(scheduleVal.replace('data:', ''))
      return { modo: 'data_fixa', dia }
    }
    if (cadencia === 'anual') {
      return { modo: 'data_fixa', data: scheduleVal }
    }
    return ritual.schedule_config
  }

  function save() {
    updateRitual.mutate(
      {
        cadencia,
        patch: {
          ativo,
          direcionamento_pensar: pensar,
          direcionamento_evitar: evitar,
          duracao_alvo_min: Number(duracao) || ritual.duracao_alvo_min,
          schedule_config: buildScheduleConfig(),
        },
      },
      { onSuccess: onClose },
    )
  }

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.9)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 20px',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 640,
          background: NEO.panel,
          border: `1px solid ${NEO.accent}`,
          padding: '28px 32px',
          position: 'relative',
        }}
      >
        <CornerBracket position="tl" />
        <CornerBracket position="tr" />
        <CornerBracket position="bl" />
        <CornerBracket position="br" />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.32em',
              color: NEO.accent,
              fontWeight: 700,
            }}
          >
            ❰ CONFIG · {CADENCIA_LABELS[cadencia]}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: NEO.textSecondary,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Toggle ativo */}
        <div
          style={{
            marginBottom: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <input
            type="checkbox"
            id="ritual-ativo"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
            style={{ accentColor: NEO.accent, width: 14, height: 14 }}
          />
          <label
            htmlFor="ritual-ativo"
            style={{ fontSize: 12, color: NEO.textPrimary, cursor: 'pointer' }}
          >
            Ritual ativo
          </label>
        </div>

        {/* Schedule */}
        <Label>QUANDO RODAR</Label>
        <div style={{ marginTop: 6, marginBottom: 14 }}>
          {cadencia === 'semanal' && (
            <select
              value={scheduleVal}
              onChange={(e) => setScheduleVal(e.target.value)}
              style={{ ...inputBlockStyle, width: 200 }}
            >
              <option value="0">Domingo</option>
              <option value="1">Segunda</option>
              <option value="2">Terça</option>
              <option value="3">Quarta</option>
              <option value="4">Quinta</option>
              <option value="5">Sexta</option>
              <option value="6">Sábado</option>
            </select>
          )}
          {cadencia === 'mensal' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <select
                value={scheduleVal.startsWith('data:') ? 'data_fixa' : 'fim_de_semana'}
                onChange={(e) =>
                  setScheduleVal(
                    e.target.value === 'fim_de_semana'
                      ? 'fim_de_semana'
                      : 'data:1',
                  )
                }
                style={{ ...inputBlockStyle, width: 240 }}
              >
                <option value="fim_de_semana">Primeiro fim de semana</option>
                <option value="data_fixa">Dia fixo do mês</option>
              </select>
              {scheduleVal.startsWith('data:') && (
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={Number(scheduleVal.replace('data:', '')) || 1}
                  onChange={(e) => setScheduleVal(`data:${e.target.value}`)}
                  style={{ ...inputBlockStyle, width: 80 }}
                />
              )}
            </div>
          )}
          {cadencia === 'trimestral' && (
            <div style={{ fontSize: 11, color: NEO.textMuted, fontStyle: 'italic' }}>
              Marcos padrão: 15/mar · 15/jun · 15/set · 15/dez (datas custom em v2)
            </div>
          )}
          {cadencia === 'anual' && (
            <input
              type="text"
              value={scheduleVal}
              onChange={(e) => setScheduleVal(e.target.value)}
              placeholder="MM-DD (ex.: 12-20)"
              style={{ ...inputBlockStyle, width: 140 }}
            />
          )}
        </div>

        {/* Duração */}
        <Label>DURAÇÃO ALVO (MIN)</Label>
        <input
          type="number"
          min={1}
          value={duracao}
          onChange={(e) => setDuracao(e.target.value)}
          style={{ ...inputBlockStyle, marginTop: 4, marginBottom: 14, width: 100 }}
        />

        {/* Direcionamentos */}
        <Label>O QUE PENSAR (default sugerido — edite à vontade)</Label>
        <textarea
          value={pensar}
          onChange={(e) => setPensar(e.target.value)}
          rows={4}
          style={{ ...textareaStyle, marginTop: 4, marginBottom: 12 }}
        />

        <Label>O QUE NÃO PENSAR</Label>
        <textarea
          value={evitar}
          onChange={(e) => setEvitar(e.target.value)}
          rows={3}
          style={{ ...textareaStyle, marginTop: 4 }}
        />

        <div
          style={{
            marginTop: 24,
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <ActionBtn
            onClick={onClose}
            icon={<X size={14} />}
            label="Cancelar"
            variant="muted"
          />
          <ActionBtn
            onClick={save}
            icon={<Check size={14} />}
            label="Salvar"
            variant="accent"
            disabled={updateRitual.isPending}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Guardrails (v2 — pontes Hub Health) ──────────────────────────────────

const GUARDRAIL_STATE_STYLE: Record<
  BuildGuardrailEvaluation['estado'],
  { color: string; icon: React.ReactNode; label: string }
> = {
  OK: {
    color: NEO.cyan,
    icon: <Shield size={11} />,
    label: 'OK',
  },
  VIOLADO: {
    color: NEO.accent,
    icon: <ShieldAlert size={11} />,
    label: 'VIOLADO',
  },
  ESPERANDO_DADOS: {
    color: NEO.textMuted,
    icon: <ShieldQuestion size={11} />,
    label: 'ESPERANDO DADOS',
  },
  METRICA_NAO_ENCONTRADA: {
    color: '#ffb300',  // âmbar (alinhado com Hub Health)
    icon: <AlertTriangle size={11} />,
    label: 'MÉTRICA SUMIU',
  },
}

function GuardrailsInline({ goal }: { goal: BuildGoal }) {
  const { data: guardrails = [] } = useGoalGuardrailsEval(goal.id)
  const removeGuardrail = useDeleteGoalGuardrail()
  const [adding, setAdding] = useState(false)

  if (guardrails.length === 0 && !adding) {
    return (
      <div style={{ marginTop: 4 }}>
        <MicroBtn onClick={() => setAdding(true)} label="+ guardrail (espírito)" />
      </div>
    )
  }

  return (
    <div style={{ marginTop: 6 }}>
      {guardrails.length > 0 && (
        <>
          <div
            style={{
              fontSize: 9,
              color: NEO.textMuted,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            Guardrails · Espírito da Meta
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {guardrails.map((g) => (
              <GuardrailRow
                key={g.id}
                ev={g}
                onRemove={() =>
                  removeGuardrail.mutate({ goalId: goal.id, guardrailId: g.id })
                }
              />
            ))}
          </div>
        </>
      )}
      {adding ? (
        <GuardrailAddForm
          goalId={goal.id}
          onClose={() => setAdding(false)}
        />
      ) : (
        <div style={{ marginTop: 4 }}>
          <MicroBtn onClick={() => setAdding(true)} label="+ guardrail" />
        </div>
      )}
    </div>
  )
}

function GuardrailRow({
  ev,
  onRemove,
}: {
  ev: BuildGuardrailEvaluation
  onRemove: () => void
}) {
  const style = GUARDRAIL_STATE_STYLE[ev.estado]
  const fmtVal = (v: number | null) =>
    v === null
      ? '—'
      : Number.isInteger(v)
      ? String(v)
      : v.toFixed(2).replace(/\.?0+$/, '')

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '3px 8px',
        background: 'transparent',
        border: `1px solid ${style.color}55`,
        borderLeft: `2px solid ${style.color}`,
        fontSize: 11,
      }}
      title={ev.detalhe ?? undefined}
    >
      <span style={{ color: style.color, display: 'flex' }}>{style.icon}</span>
      <span
        style={{
          flex: 1,
          color: NEO.textPrimary,
          fontFamily: MONO,
        }}
      >
        <span style={{ color: NEO.textMuted }}>{ev.metric_slug}</span>{' '}
        <span style={{ color: NEO.cyan }}>{ev.operador}</span>{' '}
        <span style={{ color: NEO.textPrimary, fontWeight: 700 }}>
          {fmtVal(ev.valor_alvo)}
          {ev.unidade ? ` ${ev.unidade}` : ''}
        </span>
        {ev.estado === 'OK' || ev.estado === 'VIOLADO' ? (
          <span style={{ color: NEO.textMuted, marginLeft: 8 }}>
            atual: <span style={{ color: style.color }}>{fmtVal(ev.valor_atual)}</span>
          </span>
        ) : null}
      </span>
      <span
        style={{
          fontSize: 9,
          color: style.color,
          letterSpacing: '0.1em',
          fontWeight: 700,
        }}
      >
        {style.label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        title="Remover guardrail"
        style={{
          background: 'transparent',
          border: 'none',
          color: NEO.textMuted,
          cursor: 'pointer',
          padding: 2,
          display: 'flex',
        }}
      >
        <X size={10} />
      </button>
    </div>
  )
}

function GuardrailAddForm({
  goalId,
  onClose,
}: {
  goalId: string
  onClose: () => void
}) {
  const { data: catalog = [] } = useHealthMetricsCatalog()
  const createGuardrail = useCreateGoalGuardrail()
  const [metricSlug, setMetricSlug] = useState('')
  const [itemId, setItemId] = useState<string>('')
  const [operador, setOperador] = useState<BuildGuardrailOperador>('>=')
  const [valorAlvo, setValorAlvo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const selectedMeta: HealthMetricMeta | undefined = catalog.find((m) => m.slug === metricSlug)
  // Items só carregados quando a métrica selecionada precisa de item
  const { data: items = [] } = useHealthItems(selectedMeta?.domain_slug ?? '', false)
  const needsItem = selectedMeta?.precisa_item ?? false

  // Agrupa catálogo por domínio pra select organizado
  const grouped = useMemo(() => {
    const g: Record<string, HealthMetricMeta[]> = {}
    for (const m of catalog) {
      if (!g[m.domain_slug]) g[m.domain_slug] = []
      g[m.domain_slug].push(m)
    }
    return g
  }, [catalog])

  function submit() {
    if (!metricSlug || !valorAlvo.trim()) {
      setError('Preencha métrica e valor alvo')
      return
    }
    if (needsItem && !itemId) {
      setError('Essa métrica precisa de um item específico')
      return
    }
    setError(null)
    createGuardrail.mutate(
      {
        goalId,
        body: {
          metric_slug: metricSlug,
          item_id: needsItem ? Number(itemId) : null,
          operador,
          valor_alvo: Number(valorAlvo),
        },
      },
      {
        onSuccess: onClose,
        onError: (err) => setError(err instanceof Error ? err.message : 'Erro'),
      },
    )
  }

  return (
    <div
      style={{
        marginTop: 6,
        padding: 10,
        border: `1px dashed ${NEO.borderHot}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: NEO.textMuted,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
        }}
      >
        Adicionar guardrail (Hub Health)
      </div>

      {/* Select de métrica */}
      <select
        value={metricSlug}
        onChange={(e) => {
          setMetricSlug(e.target.value)
          setItemId('')
        }}
        style={{
          background: NEO.bg,
          color: NEO.textPrimary,
          border: `1px solid ${NEO.border}`,
          padding: '4px 8px',
          fontFamily: MONO,
          fontSize: 11,
          outline: 'none',
        }}
      >
        <option value="">— escolha uma métrica —</option>
        {Object.entries(grouped).map(([domain, metrics]) => (
          <optgroup key={domain} label={domain}>
            {metrics.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.nome}
                {m.precisa_item ? ' (precisa item)' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* Select de item — só se métrica precisa */}
      {needsItem && (
        <select
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          style={{
            background: NEO.bg,
            color: NEO.textPrimary,
            border: `1px solid ${NEO.border}`,
            padding: '4px 8px',
            fontFamily: MONO,
            fontSize: 11,
            outline: 'none',
          }}
        >
          <option value="">— escolha um item de {selectedMeta?.domain_slug} —</option>
          {items.map((it) => (
            <option key={it.id} value={it.id}>
              {it.nome}
            </option>
          ))}
        </select>
      )}

      {/* Operador + valor alvo */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          value={operador}
          onChange={(e) => setOperador(e.target.value as BuildGuardrailOperador)}
          style={{
            background: NEO.bg,
            color: NEO.cyan,
            border: `1px solid ${NEO.border}`,
            padding: '4px 8px',
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 700,
            outline: 'none',
          }}
        >
          <option value=">=">≥</option>
          <option value="<=">≤</option>
          <option value=">">&gt;</option>
          <option value="<">&lt;</option>
          <option value="==">=</option>
          <option value="!=">≠</option>
        </select>
        <input
          type="number"
          value={valorAlvo}
          onChange={(e) => setValorAlvo(e.target.value)}
          placeholder="valor alvo"
          step="any"
          style={{
            flex: 1,
            background: NEO.bg,
            color: NEO.textPrimary,
            border: `1px solid ${NEO.border}`,
            padding: '4px 8px',
            fontFamily: MONO,
            fontSize: 11,
            outline: 'none',
          }}
        />
        {selectedMeta?.unidade && (
          <span style={{ fontSize: 10, color: NEO.textMuted }}>
            {selectedMeta.unidade}
          </span>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 10, color: NEO.accent }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <MicroBtn onClick={onClose} label="cancelar" />
        <button
          type="button"
          onClick={submit}
          disabled={createGuardrail.isPending}
          style={{
            background: NEO.accent,
            color: '#000',
            border: `1px solid ${NEO.accent}`,
            padding: '3px 10px',
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: createGuardrail.isPending ? 'wait' : 'pointer',
            opacity: createGuardrail.isPending ? 0.6 : 1,
          }}
        >
          adicionar
        </button>
      </div>
    </div>
  )
}

function MicroBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        color: NEO.textMuted,
        border: `1px solid ${NEO.border}`,
        padding: '2px 8px',
        fontFamily: MONO,
        fontSize: 9,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

// ─── Modal de criação de Meta ─────────────────────────────────────────────

function GoalCreateModal({ onClose }: { onClose: () => void }) {
  const createGoal = useCreateGoal()
  const { data: areas = [] } = useQuery({
    queryKey: ['areas-list'],
    queryFn: fetchAreas,
    staleTime: 5 * 60 * 1000,
  })

  // 3 perguntas obrigatórias
  const [titulo, setTitulo] = useState('')
  const [criterionType, setCriterionType] = useState<BuildGoalCriterionType>('boolean')
  const [criterionTarget, setCriterionTarget] = useState('')
  const [dataAlvo, setDataAlvo] = useState('')
  // Configurações
  const [descricao, setDescricao] = useState('')
  const [horizon, setHorizon] = useState<BuildGoalHorizon>('anual')
  const [isFoundational, setIsFoundational] = useState(false)
  // Áreas — UX nova: Set de slugs selecionados + qual é primária.
  // Primária é sempre a primeira selecionada (auto), mas pode ser trocada.
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set())
  const [primarySlug, setPrimarySlug] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)

  const canSubmit = useMemo(
    () =>
      titulo.trim() !== '' &&
      dataAlvo !== '' &&
      primarySlug !== null &&
      selectedSlugs.size >= 1 &&
      (criterionType === 'boolean' ||
        (criterionType === 'numeric' && criterionTarget.trim() !== '')),
    [titulo, dataAlvo, primarySlug, selectedSlugs, criterionType, criterionTarget],
  )

  function toggleArea(slug: string) {
    setSelectedSlugs((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) {
        next.delete(slug)
        // Se removeu a primária, eleger nova (primeira do Set restante)
        if (primarySlug === slug) {
          const replacement = next.values().next().value ?? null
          setPrimarySlug(replacement)
        }
      } else {
        next.add(slug)
        // Se nada estava selecionado, essa vira primária
        if (primarySlug === null) setPrimarySlug(slug)
      }
      return next
    })
  }

  function makePrimary(slug: string) {
    // Garante que está selecionada antes de promover
    setSelectedSlugs((prev) => {
      if (prev.has(slug)) return prev
      const next = new Set(prev)
      next.add(slug)
      return next
    })
    setPrimarySlug(slug)
  }

  function submit() {
    if (!canSubmit || !primarySlug) return
    setError(null)
    const allAreas: BuildGoalAreaLink[] = [
      { area_slug: primarySlug, is_primary: true },
      ...Array.from(selectedSlugs)
        .filter((s) => s !== primarySlug)
        .map((s) => ({ area_slug: s, is_primary: false })),
    ]
    const body: BuildGoalCreate = {
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      horizon,
      data_alvo: dataAlvo,
      criterion_type: criterionType,
      criterion_target_value:
        criterionType === 'numeric' ? Number(criterionTarget) : null,
      is_foundational: isFoundational,
      areas: allAreas,
    }
    createGoal.mutate(body, {
      onSuccess: () => onClose(),
      onError: (err: unknown) => {
        setError(err instanceof Error ? err.message : 'Erro desconhecido')
      },
    })
  }

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 20px',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 640,
          background: NEO.panel,
          border: `1px solid ${NEO.accent}`,
          padding: '28px 32px',
          position: 'relative',
        }}
      >
        <CornerBracket position="tl" />
        <CornerBracket position="tr" />
        <CornerBracket position="bl" />
        <CornerBracket position="br" />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.32em',
              color: NEO.accent,
              fontWeight: 700,
            }}
          >
            ❰ NOVA META
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: NEO.textSecondary,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div
          style={{
            fontSize: 10,
            color: NEO.textMuted,
            marginBottom: 24,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          // outcome com prazo · não ação · sua, não importada
        </div>

        {/* Pergunta 1 */}
        <Question
          numero="01"
          titulo="QUAL O ESTADO QUE VOCÊ QUER TER ATINGIDO?"
        />
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder='ex.: "ter 5k/mês fixo de renda comprovada"'
          style={inputBlockStyle}
        />
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="contexto opcional — por que essa meta? (visível só pra você)"
          rows={2}
          style={{ ...textareaStyle, marginTop: 8, fontSize: 12 }}
        />

        {/* Pergunta 2 */}
        <Question
          numero="02"
          titulo="COMO VAI SABER OBJETIVAMENTE QUE ATINGIU?"
        />
        <div style={{ display: 'flex', gap: 12 }}>
          <RadioOpt
            checked={criterionType === 'boolean'}
            onClick={() => setCriterionType('boolean')}
            label="Marca quando atingir"
            sub='ex.: "OSCP emitido", "casa comprada"'
          />
          <RadioOpt
            checked={criterionType === 'numeric'}
            onClick={() => setCriterionType('numeric')}
            label="Atingir um valor"
            sub='ex.: "5000 / mês", "70 kg"'
          />
        </div>
        {criterionType === 'numeric' && (
          <input
            type="number"
            value={criterionTarget}
            onChange={(e) => setCriterionTarget(e.target.value)}
            placeholder="valor alvo (ex.: 5000)"
            style={{ ...inputBlockStyle, marginTop: 10, width: 220 }}
          />
        )}

        {/* Pergunta 3 */}
        <Question numero="03" titulo="ATÉ QUANDO?" />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            type="date"
            value={dataAlvo}
            onChange={(e) => setDataAlvo(e.target.value)}
            style={{ ...inputBlockStyle, width: 200 }}
          />
          <RadioOpt
            checked={horizon === 'anual'}
            onClick={() => setHorizon('anual')}
            label="Anual"
            sub="1+ ano"
          />
          <RadioOpt
            checked={horizon === 'trimestral'}
            onClick={() => setHorizon('trimestral')}
            label="Trimestral"
            sub="12 semanas"
          />
        </div>

        {/* Áreas */}
        <Question numero="·" titulo="ÁREAS DA VIDA QUE A META ATRAVESSA" />
        <div style={{ fontSize: 10, color: NEO.textMuted, marginBottom: 8 }}>
          Clique nas áreas pra selecionar (várias permitidas). A primeira vira{' '}
          <strong style={{ color: NEO.accent }}>primária</strong> automaticamente
          — clique na ★ pra trocar qual é a principal.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {areas.map((a: Area) => {
            const isSelected = selectedSlugs.has(a.slug)
            const isPrimary = primarySlug === a.slug
            return (
              <div
                key={a.slug}
                onClick={() => toggleArea(a.slug)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  background: isSelected ? `${a.color}15` : 'transparent',
                  border: `1px solid ${isSelected ? a.color : NEO.border}`,
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'background 0.1s, border-color 0.1s',
                }}
              >
                {/* Checkbox visual — quadrado preenchido pra marcar selection */}
                <span
                  style={{
                    width: 14,
                    height: 14,
                    border: `1.5px solid ${isSelected ? a.color : NEO.textMuted}`,
                    background: isSelected ? a.color : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {isSelected && <Check size={10} color={NEO.bg} strokeWidth={3} />}
                </span>

                <span
                  style={{
                    color: isSelected ? NEO.textPrimary : NEO.textSecondary,
                    fontSize: 13,
                    flex: 1,
                  }}
                >
                  {a.name}
                </span>

                {/* Star pra trocar a primária — só clicável se a área está selecionada */}
                <button
                  type="button"
                  title={isPrimary ? 'Esta é a área primária' : 'Tornar primária'}
                  disabled={!isSelected}
                  onClick={(e) => {
                    e.stopPropagation() // evita disparar toggleArea
                    if (isSelected) makePrimary(a.slug)
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: isPrimary ? a.color : NEO.textMuted,
                    cursor: isSelected ? 'pointer' : 'not-allowed',
                    padding: 4,
                    display: 'flex',
                    opacity: isSelected ? 1 : 0.3,
                  }}
                >
                  <Star size={14} fill={isPrimary ? a.color : 'transparent'} />
                </button>

                <span
                  style={{
                    fontSize: 9,
                    color: isPrimary ? a.color : NEO.textMuted,
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    minWidth: 60,
                    textAlign: 'right',
                  }}
                >
                  {isPrimary ? 'PRIMÁRIA' : isSelected ? 'cross' : ''}
                </span>
              </div>
            )
          })}
        </div>

        {/* Foundational */}
        <div
          style={{
            marginTop: 18,
            padding: '10px 12px',
            background: isFoundational ? `${NEO.accent}15` : 'transparent',
            border: `1px solid ${isFoundational ? NEO.accent : NEO.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <input
            type="checkbox"
            id="is-foundational"
            checked={isFoundational}
            onChange={(e) => setIsFoundational(e.target.checked)}
            style={{ accentColor: NEO.accent, width: 14, height: 14 }}
          />
          <label
            htmlFor="is-foundational"
            style={{ fontSize: 12, color: NEO.textPrimary, cursor: 'pointer', flex: 1 }}
          >
            Essa Meta é <strong>fundação</strong> (pré-requisito de outras)
          </label>
          <Star size={13} color={NEO.accent} fill={isFoundational ? NEO.accent : 'transparent'} />
        </div>

        {/* Erro / Footer */}
        {error && (
          <div
            style={{
              marginTop: 14,
              padding: '8px 12px',
              border: `1px solid ${NEO.accent}`,
              background: `${NEO.accent}15`,
              color: NEO.accent,
              fontSize: 12,
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
            }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        <div
          style={{
            marginTop: 24,
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <ActionBtn
            onClick={onClose}
            icon={<X size={14} />}
            label="Cancelar"
            variant="muted"
          />
          <ActionBtn
            onClick={submit}
            icon={<Check size={14} />}
            label="Criar Meta"
            variant="accent"
            disabled={!canSubmit || createGoal.isPending}
          />
        </div>
      </div>
    </div>
  )
}

function Question({ numero, titulo }: { numero: string; titulo: string }) {
  return (
    <div
      style={{
        marginTop: 18,
        marginBottom: 8,
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: NEO.accent,
          fontWeight: 700,
          letterSpacing: '0.2em',
        }}
      >
        {numero}
      </span>
      <span
        style={{
          fontSize: 10,
          color: NEO.textSecondary,
          letterSpacing: '0.25em',
          fontWeight: 700,
          textTransform: 'uppercase',
        }}
      >
        {titulo}
      </span>
    </div>
  )
}

function RadioOpt({
  checked,
  onClick,
  label,
  sub,
}: {
  checked: boolean
  onClick: () => void
  label: string
  sub: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: checked ? `${NEO.accent}15` : 'transparent',
        border: `1px solid ${checked ? NEO.accent : NEO.border}`,
        padding: '8px 12px',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: MONO,
        flex: 1,
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: checked ? NEO.accent : NEO.textPrimary,
          fontWeight: 700,
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 10, color: NEO.textMuted, marginTop: 2 }}>{sub}</div>
    </button>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────

function Header() {
  return (
    <div
      style={{
        position: 'relative',
        borderBottom: `1px solid ${NEO.border}`,
        paddingBottom: 16,
      }}
    >
      {/* Eyebrow + status (canto direito) — vibe HUD CP2077 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: '0.35em',
            color: NEO.accent,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ color: NEO.accent }}>❱</span>
          STRATEGIC&nbsp;COMMAND
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: NEO.accent,
              marginLeft: 4,
            }}
          />
        </div>
        <div
          style={{
            fontSize: 10,
            letterSpacing: '0.25em',
            color: NEO.cyan,
            fontWeight: 700,
          }}
        >
          // SYS&nbsp;ONLINE
        </div>
      </div>
      <h1
        style={{
          margin: '8px 0 0',
          fontSize: 36,
          fontWeight: 800,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: NEO.textPrimary,
        }}
      >
        /BUILD
      </h1>
      <div
        style={{
          fontSize: 11,
          color: NEO.textSecondary,
          marginTop: 6,
          letterSpacing: '0.05em',
        }}
      >
        camada estratégica · propósito → visão → metas
      </div>
    </div>
  )
}

// ─── Painel do Propósito ──────────────────────────────────────────────────

function PurposePanel() {
  const { data: purpose, isLoading } = usePurpose()
  const updatePurpose = useUpdatePurpose()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() {
    setDraft(purpose?.texto ?? '')
    setEditing(true)
  }

  function save() {
    updatePurpose.mutate(draft.trim(), {
      onSuccess: () => setEditing(false),
    })
  }

  return (
    <Panel title="PROPÓSITO" subtitle="Atemporal · O arquétipo da build">
      {isLoading ? (
        <div style={{ color: NEO.textMuted, fontSize: 13 }}>Carregando…</div>
      ) : editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Em uma a três frases, articule o seu propósito atemporal — não o que vai fazer, mas quem está sendo. Esse texto sustenta toda a build."
            autoFocus
            rows={5}
            style={{
              background: NEO.bg,
              color: NEO.textPrimary,
              border: `1px solid ${NEO.accent}`,
              padding: 12,
              fontFamily: MONO,
              fontSize: 14,
              lineHeight: 1.6,
              resize: 'vertical',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <ActionBtn
              onClick={() => setEditing(false)}
              icon={<X size={14} />}
              label="Cancelar"
              variant="muted"
            />
            <ActionBtn
              onClick={save}
              icon={<Check size={14} />}
              label="Salvar"
              variant="accent"
              disabled={updatePurpose.isPending || draft.trim() === (purpose?.texto ?? '').trim()}
            />
          </div>
        </div>
      ) : (
        <>
          {purpose?.texto ? (
            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.7,
                color: NEO.textPrimary,
              }}
            >
              {purpose.texto}
            </p>
          ) : (
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: NEO.textMuted,
                fontStyle: 'italic',
                lineHeight: 1.6,
              }}
            >
              Propósito ainda não articulado. Clique em editar pra escrever.
            </p>
          )}
          <div style={{ marginTop: 16 }}>
            <ActionBtn
              onClick={startEdit}
              icon={<Pencil size={13} />}
              label={purpose?.texto ? 'Editar' : 'Articular Propósito'}
              variant="accent"
            />
          </div>
        </>
      )}

      <PrinciplesSection />
    </Panel>
  )
}

// ─── Princípios negativos (anti-metas) ────────────────────────────────────

function PrinciplesSection() {
  const { data: principles = [], isLoading } = usePrinciples()
  const createPrinciple = useCreatePrinciple()
  const deletePrinciple = useDeletePrinciple()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  function add() {
    const texto = draft.trim()
    if (!texto) return
    createPrinciple.mutate(
      { texto },
      {
        onSuccess: () => {
          setDraft('')
          setAdding(false)
        },
      },
    )
  }

  return (
    <div
      style={{
        marginTop: 24,
        paddingTop: 16,
        borderTop: `1px dashed ${NEO.border}`,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.25em',
          color: NEO.textSecondary,
          marginBottom: 12,
          fontWeight: 700,
        }}
      >
        PRINCÍPIOS NEGATIVOS · ANTI-METAS
      </div>

      {isLoading && (
        <div style={{ color: NEO.textMuted, fontSize: 12 }}>Carregando…</div>
      )}

      {!isLoading && principles.length === 0 && !adding && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: NEO.textMuted,
            fontStyle: 'italic',
          }}
        >
          Nenhum princípio negativo definido. Esses são os "não-quero-ser"
          que filtram decisões.
        </p>
      )}

      {principles.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {principles.map((p) => (
            <li
              key={p.id}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                padding: '6px 0',
                fontSize: 13,
                color: NEO.textPrimary,
                fontStyle: 'italic',
              }}
            >
              <span style={{ color: NEO.accent, flexShrink: 0 }}>·</span>
              <span style={{ flex: 1, lineHeight: 1.5 }}>{p.texto}</span>
              <button
                type="button"
                onClick={() => deletePrinciple.mutate(p.id)}
                title="Arquivar princípio"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: NEO.textMuted,
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Archive size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
              if (e.key === 'Escape') {
                setDraft('')
                setAdding(false)
              }
            }}
            placeholder='ex.: "Não trabalhar > 45h/sem sustentado"'
            autoFocus
            style={{
              flex: 1,
              background: NEO.bg,
              color: NEO.textPrimary,
              border: `1px solid ${NEO.accent}`,
              padding: '6px 10px',
              fontFamily: MONO,
              fontSize: 12,
              outline: 'none',
            }}
          />
          <ActionBtn
            onClick={add}
            icon={<Check size={12} />}
            label=""
            variant="accent"
            disabled={createPrinciple.isPending || !draft.trim()}
          />
          <ActionBtn
            onClick={() => {
              setDraft('')
              setAdding(false)
            }}
            icon={<X size={12} />}
            label=""
            variant="muted"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          style={{
            marginTop: 12,
            background: 'transparent',
            color: NEO.textSecondary,
            border: `1px dashed ${NEO.border}`,
            padding: '6px 10px',
            fontFamily: MONO,
            fontSize: 11,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          <Plus size={12} /> Adicionar princípio
        </button>
      )}
    </div>
  )
}

// ─── Painel da Visão ──────────────────────────────────────────────────────

function VisionPanel() {
  const { data: vision, isLoading } = useVision()
  const versionVision = useVersionVision()
  const updateVision = useUpdateVision()
  const [editing, setEditing] = useState(false)
  const [versioning, setVersioning] = useState(false)
  const [draftTexto, setDraftTexto] = useState('')
  const [draftData, setDraftData] = useState('')
  const [draftMotivo, setDraftMotivo] = useState('')

  // Inicializa draft sempre que entra em modo edição (não em mudanças de Visão)
  useEffect(() => {
    if (editing && vision) {
      setDraftTexto(vision.texto)
      setDraftData(vision.data_alvo ?? '')
    }
  }, [editing])

  function startVersioning() {
    setDraftTexto('')
    setDraftData('')
    setDraftMotivo('')
    setVersioning(true)
  }

  function commitVersion() {
    versionVision.mutate(
      {
        texto: draftTexto.trim(),
        dataAlvo: draftData || null,
        motivoArquivamento: draftMotivo.trim() || undefined,
      },
      { onSuccess: () => setVersioning(false) },
    )
  }

  function commitEdit() {
    updateVision.mutate(
      {
        texto: draftTexto.trim(),
        data_alvo: draftData || null,
      },
      { onSuccess: () => setEditing(false) },
    )
  }

  return (
    <Panel
      title="VISÃO · 3 ANOS"
      subtitle={vision ? `Até ${fmtDate(vision.data_alvo)} · A build alvo` : 'A build alvo no lvl 50'}
    >
      {isLoading ? (
        <div style={{ color: NEO.textMuted, fontSize: 13 }}>Carregando…</div>
      ) : versioning ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Label>NOVA VISÃO</Label>
          <textarea
            value={draftTexto}
            onChange={(e) => setDraftTexto(e.target.value)}
            placeholder="Em uma a três frases, descreva como você quer estar daqui 3 anos. Não é meta — é o estado-alvo."
            rows={4}
            autoFocus
            style={textareaStyle}
          />
          <Label>DATA ALVO</Label>
          <input
            type="date"
            value={draftData}
            onChange={(e) => setDraftData(e.target.value)}
            style={inputStyle}
          />
          {vision && (
            <>
              <Label>MOTIVO DE ARQUIVAR A VISÃO ATUAL (OPCIONAL)</Label>
              <textarea
                value={draftMotivo}
                onChange={(e) => setDraftMotivo(e.target.value)}
                placeholder="Por que essa Visão não é mais sua? Histórico importa."
                rows={2}
                style={textareaStyle}
              />
            </>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <ActionBtn
              onClick={() => setVersioning(false)}
              icon={<X size={14} />}
              label="Cancelar"
              variant="muted"
            />
            <ActionBtn
              onClick={commitVersion}
              icon={<Check size={14} />}
              label={vision ? 'Versionar' : 'Criar Visão'}
              variant="accent"
              disabled={versionVision.isPending || !draftTexto.trim()}
            />
          </div>
        </div>
      ) : editing && vision ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Label>TEXTO</Label>
          <textarea
            value={draftTexto}
            onChange={(e) => setDraftTexto(e.target.value)}
            rows={4}
            autoFocus
            style={textareaStyle}
          />
          <Label>DATA ALVO</Label>
          <input
            type="date"
            value={draftData}
            onChange={(e) => setDraftData(e.target.value)}
            style={inputStyle}
          />
          <div style={{ fontSize: 11, color: NEO.textMuted, fontStyle: 'italic' }}>
            Edição leve sem versionar. Pra mudança de direção real, use{' '}
            <strong>Versionar</strong>.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <ActionBtn
              onClick={() => setEditing(false)}
              icon={<X size={14} />}
              label="Cancelar"
              variant="muted"
            />
            <ActionBtn
              onClick={commitEdit}
              icon={<Check size={14} />}
              label="Salvar"
              variant="accent"
              disabled={updateVision.isPending || !draftTexto.trim()}
            />
          </div>
        </div>
      ) : vision ? (
        <>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.7,
              color: NEO.textPrimary,
            }}
          >
            {vision.texto}
          </p>
          <div
            style={{
              fontSize: 11,
              color: NEO.textMuted,
              marginTop: 12,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Criada em {fmtDate(vision.criada_em)}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <ActionBtn
              onClick={() => setEditing(true)}
              icon={<Pencil size={13} />}
              label="Editar"
              variant="muted"
            />
            <ActionBtn
              onClick={startVersioning}
              icon={<History size={13} />}
              label="Versionar"
              variant="accent"
            />
          </div>
        </>
      ) : (
        <>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: NEO.textMuted,
              fontStyle: 'italic',
              lineHeight: 1.6,
            }}
          >
            Visão ainda não definida. A Visão é como você quer estar daqui 3
            anos — destino concreto, não sonho.
          </p>
          <div style={{ marginTop: 16 }}>
            <ActionBtn
              onClick={startVersioning}
              icon={<Plus size={13} />}
              label="Definir Visão"
              variant="accent"
            />
          </div>
        </>
      )}
    </Panel>
  )
}

// ─── Componentes pequenos compartilhados ─────────────────────────────────

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        position: 'relative',
        background: NEO.panel,
        border: `1px solid ${NEO.border}`,
        padding: '20px 24px 24px',
      }}
    >
      {/* Corner brackets — vibe CP2077 menu */}
      <CornerBracket position="tl" />
      <CornerBracket position="tr" />
      <CornerBracket position="bl" />
      <CornerBracket position="br" />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          letterSpacing: '0.32em',
          color: NEO.accent,
          fontWeight: 700,
          marginBottom: 2,
        }}
      >
        <span style={{ color: NEO.accent }}>❰</span>
        <span>{title}</span>
        <span
          style={{
            flex: 1,
            height: 1,
            background: `linear-gradient(90deg, ${NEO.borderHot} 0%, transparent 100%)`,
            marginLeft: 4,
          }}
        />
      </div>
      {subtitle && (
        <div
          style={{
            fontSize: 10,
            color: NEO.textMuted,
            marginBottom: 18,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          {subtitle}
        </div>
      )}
      {children}
    </div>
  )
}

function CornerBracket({ position }: { position: 'tl' | 'tr' | 'bl' | 'br' }) {
  const size = 8
  const thickness = 1.5
  const inset = -1
  const base: React.CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    borderColor: NEO.accent,
    borderStyle: 'solid',
    pointerEvents: 'none',
  }
  const map: Record<typeof position, React.CSSProperties> = {
    tl: { top: inset, left: inset, borderWidth: `${thickness}px 0 0 ${thickness}px` },
    tr: { top: inset, right: inset, borderWidth: `${thickness}px ${thickness}px 0 0` },
    bl: { bottom: inset, left: inset, borderWidth: `0 0 ${thickness}px ${thickness}px` },
    br: { bottom: inset, right: inset, borderWidth: `0 ${thickness}px ${thickness}px 0` },
  }
  return <span style={{ ...base, ...map[position] }} />
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        letterSpacing: '0.25em',
        color: NEO.textSecondary,
        fontWeight: 700,
      }}
    >
      {children}
    </div>
  )
}

function ActionBtn({
  onClick,
  icon,
  label,
  variant,
  disabled,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  variant: 'accent' | 'muted'
  disabled?: boolean
}) {
  const isAccent = variant === 'accent'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: isAccent ? NEO.accent : 'transparent',
        color: isAccent ? '#000' : NEO.textSecondary,
        border: `1px solid ${isAccent ? NEO.accent : NEO.border}`,
        padding: '6px 12px',
        fontFamily: MONO,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {icon}
      {label}
    </button>
  )
}

const textareaStyle: React.CSSProperties = {
  background: NEO.bg,
  color: NEO.textPrimary,
  border: `1px solid ${NEO.accent}`,
  padding: 10,
  fontFamily: MONO,
  fontSize: 13,
  lineHeight: 1.6,
  resize: 'vertical',
  outline: 'none',
}

const inputStyle: React.CSSProperties = {
  background: NEO.bg,
  color: NEO.textPrimary,
  border: `1px solid ${NEO.accent}`,
  padding: '6px 10px',
  fontFamily: MONO,
  fontSize: 12,
  outline: 'none',
  width: 180,
}

const inputBlockStyle: React.CSSProperties = {
  background: NEO.bg,
  color: NEO.textPrimary,
  border: `1px solid ${NEO.border}`,
  padding: '8px 12px',
  fontFamily: MONO,
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}
