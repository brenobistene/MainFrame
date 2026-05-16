/**
 * /build — Página da camada estratégica do MAINFRAME.
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
import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Pencil, Plus, X, Check, Archive, History, Star, Target, AlertTriangle, Calendar,
  Link2, ChevronDown, ChevronRight, Wrench, Zap, Compass, Pause, Trash2,
  Clock, Activity, Settings as SettingsIcon, Shield, ShieldAlert, ShieldQuestion,
  RotateCw, CheckSquare, MoreHorizontal,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { fetchAreas, createProject } from '../api'
import { confirmDialog, alertDialog } from '../lib/dialog'
import { isBlockDocEmpty } from '../components/block-utils'

// BlockEditor lazy — chunk pesado (~1.1 MB de @blocknote) só baixa quando
// o usuário expande a seção "Notas" de uma Meta.
const BlockEditor = lazy(() =>
  import('../components/BlockEditor').then((m) => ({ default: m.BlockEditor })),
)
import {
  useAddGoalDependency,
  useBuildSettings,
  useClassifyProject,
  useCreateGoal,
  useCreateGoalGuardrail,
  useUpdateGoalGuardrail,
  useCreatePrinciple,
  useCreateRitualSession,
  useUpdateRitualSession,
  useDeleteRitualSession,
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
  useReplaceGoalAreas,
  useRituals,
  useRitualSessions,
  useSprints,
  useUpdateGoal,
  useUpdateGoalProgress,
  useUpdatePrinciple,
  useUpdateRitual,
  useUpdateSprint,
  useUpdatePurpose,
  useVersionVision,
  useVision,
  useVisionHistory,
  useUpdateVision,
} from '../lib/build-queries'
import {
  useHealthMetricsCatalog,
  useHealthItems,
  useMindHipoteses,
  useMindSessions,
} from '../lib/health-queries'
import LibraryBacklinksBadge from '../components/library/LibraryBacklinksBadge'
import type {
  Area,
  BuildGoal,
  BuildGoalAreaLink,
  BuildGoalCreate,
  BuildGoalCriterionType,
  BuildGoalHorizon,
  BuildGoalStatus,
  BuildGuardrailEvaluation,
  BuildGuardrailOperador,
  BuildPrinciple,
  BuildProjectAlignment,
  BuildProjectClassification,
  BuildRitual,
  BuildRitualCadencia,
  BuildRitualSession,
  BuildSprint,
  BuildVision,
  HealthMetricMeta,
} from '../types'

// ─── Tokens visuais (Neomilitarism — calibrado em 2026-05-09 com refs CP2077) ──
// Paleta autoritativa em docs/design-system/STYLES.md §3.2.
// Calibração baseada em: Summary Screen (fa8d26), Tarot (15df40), Metro Map
// (d2b52e). Vermelho queimado (não bubble-gum), preto frio profundo, cyan
// como accent tech secundário.

// Paleta consolidada com o resto do app (CP2077 / Hell Is Us). Antes a /build
// usava "neomilitarism" — bg quase preto puro + accent vermelho saturado +
// cyan claro. Conflitava com a estética do app: ice como brand primário,
// oxblood reservado pra danger/live, chamfer cross em painéis, hairline ice.
//
// Os nomes do objeto NEO foram preservados pra não tocar 4900 linhas de
// consumers — os VALORES agora apontam pras CSS vars centrais (index.html).
// Status warnings (drift, atrasos) ainda usam oxblood (= accent-primary).
const NEO = {
  bg: 'transparent',                                  // deixa o body atmospheric mostrar (fog azul + halo)
  panel: 'rgba(11, 13, 18, 0.55)',                    // glass com leve translucidez (combina com hq-glass)
  border: 'var(--color-border-strong)',
  borderHot: 'rgba(143, 191, 211, 0.35)',             // hairline ice no header dos painéis
  textPrimary: 'var(--color-text-primary)',
  textSecondary: 'var(--color-text-secondary)',
  textMuted: 'var(--color-text-muted)',
  accent: 'var(--color-ice)',                         // ICE (era red — biggest change)
  accentDim: 'var(--color-ice-deep)',
  cyan: 'var(--color-ice-light)',                     // ice claro pros HUD readouts (consolida com accent)
  cyanDim: 'var(--color-ice-deep)',
  // Reservado pra estados de DANGER/LIVE: drift, ritual atrasado, error.
  // Usar EXPLICITAMENTE — não como brand color.
  danger: 'var(--color-accent-primary)',              // oxblood
  dangerLight: 'var(--color-accent-light)',
}

// Fontes alinhadas com o resto do app. Display = Rajdhani (hero/headers),
// Body = Chakra Petch (parágrafos), Mono = JetBrains Mono (labels técnicos).
const MONO = 'var(--font-mono)'
const DISPLAY = 'var(--font-display)'
const BODY = 'var(--font-body)'
void DISPLAY; void BODY;  // exposed for future panel internals; keep tree-shake-friendly

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
    <div style={{ color: 'var(--color-text-primary)', position: 'relative', fontFamily: BODY }}>
      <Header />

      {/* Body como cena CP2077 — mesmo tratamento da DashboardPage:
          - Base sólida quase preta + multi-layer radials (halo branco-ice,
            fog azul-aço denso, halo ice off-axis, whisper oxblood,
            vinheta inferior).
          - Grain extra-denso bluish overlay pra textura cinemática.
          Sem isso a página fica "achatada" e perde a vibe Hell Is Us. */}
      <div
        style={{
          padding: '32px 40px 64px',
          position: 'relative',
          overflow: 'hidden',
          background: `
            radial-gradient(ellipse 50% 35% at 50% 12%, rgba(220, 224, 228, 0.12), transparent 75%),
            radial-gradient(ellipse 90% 55% at 50% 18%, rgba(50, 62, 73, 0.38), transparent 75%),
            radial-gradient(ellipse 40% 35% at 100% 45%, rgba(143, 191, 211, 0.10), transparent 70%),
            radial-gradient(ellipse 55% 45% at 0% 75%, rgba(40, 50, 57, 0.30), transparent 70%),
            radial-gradient(ellipse 50% 35% at 0% 8%, rgba(159, 18, 57, 0.06), transparent 60%),
            radial-gradient(ellipse 110% 70% at 50% 115%, rgba(0, 0, 0, 0.85), transparent 70%),
            #06080c
          `,
          minHeight: 'calc(100vh - 96px)',
        }}
      >
        {/* Grain extra-denso bluish — overlay acima do body global. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            opacity: 0.13,
            mixBlendMode: 'overlay',
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='dn'><feTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0.6 0 0 0 0.45  0.7 0 0 0 0.55  0.85 0 0 0 0.7  0 0 0 0.8 0'/></filter><rect width='100%25' height='100%25' filter='url(%23dn)'/></svg>\")",
            zIndex: 0,
          }}
        />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
              gap: 20,
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
      </div>
    </div>
  )
}

// ─── Painel das Metas ─────────────────────────────────────────────────────

const STATUS_TABS: Array<{
  value: BuildGoalStatus | 'all'
  label: string
}> = [
  { value: 'ativa', label: 'Ativas' },
  { value: 'concluida', label: 'Concluídas' },
  { value: 'pausada', label: 'Pausadas' },
  { value: 'abandonada', label: 'Abandonadas' },
  { value: 'all', label: 'Todas' },
]

function GoalsPanel() {
  const [filter, setFilter] = useState<BuildGoalStatus | 'all'>('ativa')
  const { data: goals = [], isLoading } = useGoals(
    filter === 'all' ? undefined : filter,
  )
  const [creating, setCreating] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  // Atalhos de teclado globais quando /build está aberto:
  //  - N: nova Meta (só quando filter === 'ativa')
  //  - ?: abre help modal com lista de atalhos
  //
  // Skip quando foco está em input/textarea/contenteditable, ou modal já
  // aberto (creating) — evita conflitar com edição inline. Listener cleanup
  // automático no unmount.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignora se modificadores (Ctrl/Cmd/Alt) ativos — só atalhos puros.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return
      }
      // ESC fecha help (mesmo que outras coisas estejam abertas)
      if (e.key === 'Escape' && showHelp) {
        e.preventDefault()
        setShowHelp(false)
        return
      }
      // Ignora restante quando algum modal já tá aberto.
      if (creating || showHelp) return
      if (e.key === 'n' || e.key === 'N') {
        if (filter === 'ativa') {
          e.preventDefault()
          setCreating(true)
        }
      }
      if (e.key === '?') {
        e.preventDefault()
        setShowHelp(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [creating, showHelp, filter])

  const subtitle =
    filter === 'ativa'
      ? `${goals.length} ${goals.length === 1 ? 'meta ativa' : 'metas ativas'} no caminho`
      : filter === 'all'
      ? `${goals.length} ${goals.length === 1 ? 'meta' : 'metas'} no histórico total`
      : `${goals.length} ${goals.length === 1 ? 'meta' : 'metas'} — ${
          GOAL_STATUS_LABEL[filter as BuildGoalStatus]?.toLowerCase() ?? filter
        }`

  return (
    <Panel
      title="METAS"
      subtitle={subtitle}
    >
      {/* Tabs de filtro de status */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        {STATUS_TABS.map((tab) => {
          const isActive = filter === tab.value
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter(tab.value)}
              style={{
                background: isActive ? NEO.accent : 'transparent',
                color: isActive ? '#000' : NEO.textSecondary,
                border: `1px solid ${isActive ? NEO.accent : NEO.border}`,
                padding: '3px 10px',
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {isLoading ? (
        <PanelLoading />
      ) : (
        <>
          {goals.length === 0 && !creating ? (
            filter === 'ativa' ? (
              <PanelEmpty
                message="Nenhuma Meta ativa."
                hint='Meta = outcome com prazo (não ação). Ex.: "ter 5k/mês fixo até dez/2027" — não "fazer curso X".'
                action={{
                  label: 'Nova Meta',
                  icon: <Plus size={13} />,
                  onClick: () => setCreating(true),
                }}
              />
            ) : (
              <PanelEmpty
                message={`Nenhuma Meta com status "${
                  GOAL_STATUS_LABEL[filter as BuildGoalStatus]?.toLowerCase() ?? filter
                }".`}
              />
            )
          ) : null}

          {goals.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {goals.map((g) => (
                <GoalRow key={g.id} goal={g} />
              ))}
            </div>
          )}

          {filter === 'ativa' && goals.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <ActionBtn
                onClick={() => setCreating(true)}
                icon={<Plus size={13} />}
                label="Nova Meta"
                variant="accent"
              />
            </div>
          )}
        </>
      )}

      {creating && <GoalCreateModal onClose={() => setCreating(false)} />}
      {showHelp && <KeyboardShortcutsHelp onClose={() => setShowHelp(false)} />}
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
  const [editing, setEditing] = useState(false)

  const primary = goal.areas.find((a) => a.is_primary)
  const secondaries = goal.areas.filter((a) => !a.is_primary)
  const primaryArea = primary && areas.find((a: Area) => a.slug === primary.area_slug)
  // Resolve cada secundária pra Area completa (com cor + name) — usado pra
  // renderizar mini-pílulas coloridas no L3 + tooltip caso truncado.
  const secondaryAreas: Area[] = secondaries
    .map((s) => areas.find((a: Area) => a.slug === s.area_slug))
    .filter((a): a is Area => !!a)
  const secondaryNames = secondaryAreas.map((a) => a.name).join(', ')

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
            color:
              goal.status === 'ativa'
                ? NEO.textPrimary
                : goal.status === 'concluida'
                ? NEO.cyan
                : NEO.textMuted,
            letterSpacing: '0.02em',
            textDecoration:
              goal.status === 'abandonada' || goal.status === 'concluida'
                ? 'line-through'
                : 'none',
            flex: 1,
          }}
        >
          {goal.titulo}
        </span>
        {goal.status !== 'ativa' && (
          <span
            style={{
              fontSize: 9,
              padding: '1px 6px',
              border: `1px solid ${
                goal.status === 'concluida' ? NEO.cyanDim : NEO.borderHot
              }`,
              color:
                goal.status === 'concluida' ? NEO.cyan : NEO.textMuted,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
          >
            {GOAL_STATUS_LABEL[goal.status as BuildGoalStatus] ?? goal.status}
          </span>
        )}
        <LibraryBacklinksBadge targetType="build_goal" targetId={goal.id} />
      </div>

      {/* L2 — info de ação: prazo, critério, área primária. Tamanho médio,
          cor textSecondary. É o que o usuário precisa ver pra decidir. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          fontSize: 11,
          color: NEO.textSecondary,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Calendar size={11} />
          até {fmtDate(goal.data_alvo)}
        </span>
        {/* Critério — boolean usa ícone CheckSquare + "ao concluir"; numeric
            mostra "alvo: N" com Target. Sem termos técnicos cru ("booleano",
            "target") expostos pro usuário. */}
        {goal.criterion_type === 'numeric' ? (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            title="Alvo numérico — progresso é medido contra esse valor"
          >
            <Target size={11} />
            alvo: {goal.criterion_target_value?.toLocaleString('pt-BR')}
          </span>
        ) : (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            title="Critério tudo-ou-nada — marca quando atingir"
          >
            <CheckSquare size={11} />
            ao concluir
          </span>
        )}
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
      </div>

      {/* L3 — metadata secundária: horizon, áreas extras, projetos vinculados.
          Tamanho menor, cor mais sutil. Contexto sem competir com L1/L2 pelo
          olhar. Só aparece quando há algo relevante (horizon sempre vem). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 9,
          color: NEO.textMuted,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          fontWeight: 700,
          flexWrap: 'wrap',
          marginTop: -2,
        }}
      >
        <span
          title={
            goal.horizon === 'anual'
              ? 'Horizonte: 1+ ano'
              : 'Horizonte: 12 semanas'
          }
        >
          {GOAL_HORIZON_LABEL[goal.horizon as BuildGoalHorizon] ?? goal.horizon}
        </span>
        {/* Áreas secundárias como mini-pílulas coloridas — visualmente
            identificam as áreas sem hover. Acima de 3, mostra as 3
            primeiras + "+N" pra evitar overflow horizontal. */}
        {secondaryAreas.length > 0 && (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            title={`Áreas adicionais: ${secondaryNames}`}
          >
            {secondaryAreas.slice(0, 3).map((a) => (
              <span
                key={a.slug}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: a.color,
                  flexShrink: 0,
                  display: 'inline-block',
                }}
                title={a.name}
              />
            ))}
            {secondaryAreas.length > 3 && (
              <span style={{ fontSize: 9, color: NEO.textMuted, marginLeft: 2 }}>
                +{secondaryAreas.length - 3}
              </span>
            )}
          </span>
        )}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: linkedProjects.length > 0 ? NEO.cyan : NEO.textMuted,
          }}
          title={
            linkedProjects.length === 0
              ? 'Nenhum projeto vinculado'
              : `Projetos servindo essa Meta:\n• ${linkedProjects.map((p) => p.title ?? p.id).join('\n• ')}`
          }
        >
          <Link2 size={10} />
          {linkedProjects.length} projeto{linkedProjects.length === 1 ? '' : 's'}
        </span>
        <QuickCreateProjectButton goal={goal} primaryAreaSlug={primary?.area_slug ?? null} />
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

      {/* Sub-painéis: progresso (numérico) sempre aberto — informação
          principal pra ação. Sprints/Deps/Guardrails dentro de collapse pra
          reduzir densidade visual de Metas com muito conteúdo. */}
      {goal.criterion_type === 'numeric' && <GoalProgressBar goal={goal} />}
      {goal.horizon === 'anual' && (
        <CollapsibleSection
          label="Sprints"
          storageKey={`hq-build-collapse-${goal.id}-sprints`}
        >
          <SprintsInline goal={goal} />
        </CollapsibleSection>
      )}
      <CollapsibleSection
        label="Dependências"
        storageKey={`hq-build-collapse-${goal.id}-deps`}
      >
        <DependenciesInline goal={goal} />
      </CollapsibleSection>
      <CollapsibleSection
        label="Guardrails"
        storageKey={`hq-build-collapse-${goal.id}-guardrails`}
      >
        <GuardrailsInline goal={goal} />
      </CollapsibleSection>
      <CollapsibleSection
        label="Notas"
        storageKey={`hq-build-collapse-${goal.id}-notes`}
      >
        <GoalNotesSection goal={goal} />
      </CollapsibleSection>

      {/* Ações — uma ação primária visível conforme o status, demais no
          menu ⋯. Reduz a poluição dos 5 botões antigos empilhados. */}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Ação primária contextual */}
        {goal.status === 'ativa' && (
          <MicroBtn
            onClick={() =>
              updateGoal.mutate({ id: goal.id, patch: { status: 'concluida' } })
            }
            icon={<Check size={10} />}
            label="concluir"
          />
        )}
        {(goal.status === 'pausada' || goal.status === 'abandonada') && (
          <MicroBtn
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Reativar Meta',
                message:
                  `Reativar "${goal.titulo}" (status atual: ${
                    GOAL_STATUS_LABEL[goal.status as BuildGoalStatus] ?? goal.status
                  })? ` +
                  `Ela volta pra lista de Metas ativas, sujeita ao limite duro ` +
                  `(default 5 ativas).`,
                confirmLabel: 'REATIVAR',
              })
              if (!ok) return
              updateGoal.mutate({ id: goal.id, patch: { status: 'ativa' } })
            }}
            icon={<RotateCw size={10} />}
            label="reativar"
          />
        )}

        {/* Menu ⋯ — sempre tem editar; demais ações conforme status */}
        <ActionMenu
          items={[
            {
              label: 'editar',
              icon: <Pencil size={11} />,
              onClick: () => setEditing(true),
            },
            ...(goal.status === 'ativa'
              ? [{
                  label: 'pausar',
                  icon: <Pause size={11} />,
                  onClick: () =>
                    updateGoal.mutate({ id: goal.id, patch: { status: 'pausada' } }),
                }]
              : []),
            ...(goal.status === 'concluida'
              ? [{
                  label: 'reativar',
                  icon: <RotateCw size={11} />,
                  onClick: async () => {
                    const ok = await confirmDialog({
                      title: 'Reativar Meta',
                      message: `Reativar "${goal.titulo}" (atualmente concluída)?`,
                      confirmLabel: 'REATIVAR',
                    })
                    if (!ok) return
                    updateGoal.mutate({ id: goal.id, patch: { status: 'ativa' } })
                  },
                }]
              : []),
            ...(goal.status !== 'abandonada' && goal.status !== 'concluida'
              ? [{
                  label: 'abandonar',
                  icon: <X size={11} />,
                  danger: true,
                  onClick: async () => {
                    const ok = await confirmDialog({
                      title: 'Abandonar Meta',
                      message:
                        `Vai abandonar "${goal.titulo}"? A Meta sai da lista de ativas mas o ` +
                        'histórico fica preservado (não deleta nada). Você pode reativá-la ' +
                        'depois editando o status.',
                      confirmLabel: 'ABANDONAR',
                      danger: true,
                    })
                    if (!ok) return
                    updateGoal.mutate({ id: goal.id, patch: { status: 'abandonada' } })
                  },
                }]
              : []),
          ]}
        />
      </div>

      {editing && (
        <GoalEditModal goal={goal} onClose={() => setEditing(false)} />
      )}
    </div>
  )
}

// ─── Barra de progresso pra Meta numérica ─────────────────────────────────

/**
 * Parser pt-BR pra número com formato brasileiro (`1.234,56`).
 * Aceita também `1234.56` (US), `1234,56` e `1234`. Retorna null se inválido.
 */
function parseNumberPtBR(s: string): number | null {
  const trimmed = s.trim()
  if (trimmed === '') return null
  // Remove separadores de milhar `.` E troca decimal `,` por `.`. Cobre
  // ambos formatos brasileiros: "1.234,56", "1234,56", "1234.56", "1234".
  const cleaned = trimmed.replace(/\./g, '').replace(',', '.')
  const n = Number(cleaned)
  return isNaN(n) ? null : n
}

function GoalProgressBar({ goal }: { goal: BuildGoal }) {
  const updateProgress = useUpdateGoalProgress()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  // v2.1: progresso vem do backend resolvido. Se metric_slug setado, fonte='health'.
  const resolved = goal.progress_resolved
  const target = goal.criterion_target_value ?? 0
  const current = resolved?.valor ?? 0
  const pct = target > 0 ? Math.max(0, Math.min(100, (current / target) * 100)) : 0

  const fonteHealth = resolved?.fonte === 'health'
  const fonteSemDados = resolved?.fonte === 'sem_dados'
  const fonteMetricaSumiu = resolved?.fonte === 'metrica_sumiu'
  const isHealthLinked = goal.criterion_metric_slug != null

  function startEdit() {
    // Prefill formatado em pt-BR ("5.000" em vez de "5000") pra o usuário
    // reconhecer o formato e poder editar mantendo a vírgula brasileira.
    setDraft(current.toLocaleString('pt-BR'))
    setEditing(true)
  }
  function save() {
    const num = parseNumberPtBR(draft)
    if (num === null) return
    updateProgress.mutate(
      { id: goal.id, value: num },
      { onSuccess: () => setEditing(false) },
    )
  }

  // Cor da barra varia com a fonte
  const barColor = fonteMetricaSumiu
    ? '#ffb300'
    : fonteSemDados
    ? NEO.textMuted
    : fonteHealth
    ? NEO.cyan
    : NEO.accent

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
          {fonteSemDados || fonteMetricaSumiu ? (
            <span
              style={{ color: barColor, fontStyle: 'italic' }}
              title={resolved?.detalhe ?? undefined}
            >
              {fonteMetricaSumiu ? 'métrica sumiu' : 'esperando dados…'}
            </span>
          ) : (
            <>
              <span style={{ color: NEO.textPrimary, fontWeight: 700 }}>
                {current.toLocaleString('pt-BR')}
              </span>{' '}
              / {target.toLocaleString('pt-BR')}{' '}
              <span style={{ color: NEO.cyan, marginLeft: 4 }}>{pct.toFixed(0)}%</span>
            </>
          )}
          {fonteHealth && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 9,
                color: NEO.cyan,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                fontWeight: 700,
              }}
              title={
                resolved?.ultima_atualizacao
                  ? `última atualização: ${resolved.ultima_atualizacao}`
                  : undefined
              }
            >
              ◉ via Health
            </span>
          )}
        </span>
        {!isHealthLinked &&
          (editing ? (
            <span style={{ display: 'flex', gap: 4 }}>
              <input
                type="text"
                inputMode="decimal"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save()
                  if (e.key === 'Escape') setEditing(false)
                }}
                autoFocus
                placeholder="ex.: 1.234,56"
                title="Formato brasileiro: . pra milhar, , pra decimal"
                style={{
                  background: NEO.bg,
                  color: NEO.textPrimary,
                  border: `1px solid ${NEO.accent}`,
                  padding: '2px 6px',
                  fontFamily: MONO,
                  fontSize: 11,
                  width: 100,
                  outline: 'none',
                }}
              />
              <MicroBtn onClick={save} icon={<Check size={10} />} label="ok" />
              <MicroBtn onClick={() => setEditing(false)} icon={<X size={10} />} label="" />
            </span>
          ) : (
            <MicroBtn onClick={startEdit} icon={<RotateCw size={10} />} label="atualizar" />
          ))}
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
            background: barColor,
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
        <MicroBtn onClick={quickCreate} icon={<Plus size={10} />} label="Sprint (12 sem)" />
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
        <MicroBtn onClick={quickCreate} icon={<Plus size={10} />} label="próximo sprint" />
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

  // Detecta se "agora" está dentro do range do sprint — se sim, marca como
  // "atual" mesmo que o status seja `planejado` (usuário pode ter esquecido
  // de mudar pra `ativo`). Visual: borda mais grossa + tag "AGORA".
  const today = new Date().toISOString().slice(0, 10)
  const isCurrent = today >= sprint.data_inicio && today <= sprint.data_fim &&
    sprint.status !== 'abandonado' && sprint.status !== 'concluido'

  return (
    <div
      style={{
        background: isCurrent ? `${NEO.accent}08` : 'transparent',
        border: `1px solid ${isCurrent ? NEO.borderHot : NEO.border}`,
        borderLeft: `${isCurrent ? 3 : 2}px solid ${statusColor}`,
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
      {isCurrent && (
        <span
          style={{
            fontSize: 8,
            color: NEO.accent,
            letterSpacing: '0.22em',
            fontWeight: 700,
            textTransform: 'uppercase',
            background: `${NEO.accent}15`,
            padding: '1px 5px',
            border: `1px solid ${NEO.borderHot}`,
            flexShrink: 0,
          }}
          title="Hoje está dentro do período deste sprint"
        >
          AGORA
        </span>
      )}
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
        <option value="planejado">Planejado</option>
        <option value="ativo">Ativo</option>
        <option value="concluido">Concluído</option>
        <option value="abandonado">Abandonado</option>
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
        <MicroBtn onClick={() => setPicking(true)} icon={<Plus size={10} />} label="depende de…" />
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
          <MicroBtn onClick={() => setPicking(true)} icon={<Plus size={10} />} label="pré-requisito" />
        </div>
      )}
    </div>
  )
}

// ─── Painel Drift (projetos órfãos) ───────────────────────────────────────

function DriftPanel() {
  const { data: drift = [], isLoading } = useProjectsAlignment({ driftOnly: true })
  // Segunda fetch: TODOS os projetos pra extrair os classificados.
  // Backend não tem filtro `classifiedOnly` — filtramos client-side. Pra
  // escala pessoal (dezenas de projetos), custo é desprezível.
  const { data: allAlignment = [] } = useProjectsAlignment()
  const classified = useMemo(
    () => allAlignment.filter((p) => p.alignment_status === 'classified'),
    [allAlignment],
  )
  const { data: areasList = [] } = useQuery({
    queryKey: ['areas-list'],
    queryFn: fetchAreas,
    staleTime: 5 * 60 * 1000,
  })
  const [expanded, setExpanded] = useState(false)
  const [areaFilter, setAreaFilter] = useState<string | 'all'>('all')
  const [classifiedExpanded, setClassifiedExpanded] = useState(false)

  // Conta por área (só áreas que têm drift) — pra mostrar count nos chips
  const countByArea = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of drift) m[p.area_slug] = (m[p.area_slug] ?? 0) + 1
    return m
  }, [drift])

  const filtered = useMemo(
    () => (areaFilter === 'all' ? drift : drift.filter((p) => p.area_slug === areaFilter)),
    [drift, areaFilter],
  )

  // Lista só de áreas que têm pelo menos 1 drift
  const areasWithDrift = areasList.filter((a) => countByArea[a.slug] > 0)

  return (
    <Panel
      title="DRIFT · PROJETOS SEM ALINHAMENTO"
      subtitle={
        drift.length === 0
          ? 'nenhum projeto em drift — vida ordenada'
          : `${drift.length} ${drift.length === 1 ? 'projeto sem' : 'projetos sem'} meta nem classificação`
      }
    >
      {isLoading ? (
        <PanelLoading />
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
            <>
              {/* Filtro por área — chips coloridos com count */}
              {areasWithDrift.length > 1 && (
                <div
                  style={{
                    display: 'flex',
                    gap: 4,
                    flexWrap: 'wrap',
                    marginBottom: 8,
                    paddingTop: 4,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setAreaFilter('all')}
                    style={{
                      background: areaFilter === 'all' ? NEO.accent : 'transparent',
                      color: areaFilter === 'all' ? '#000' : NEO.textSecondary,
                      border: `1px solid ${
                        areaFilter === 'all' ? NEO.accent : NEO.border
                      }`,
                      padding: '2px 8px',
                      fontFamily: MONO,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                    }}
                  >
                    Todas ({drift.length})
                  </button>
                  {areasWithDrift.map((a) => {
                    const active = areaFilter === a.slug
                    return (
                      <button
                        key={a.slug}
                        type="button"
                        onClick={() => setAreaFilter(a.slug)}
                        style={{
                          background: active ? `${a.color}25` : 'transparent',
                          color: active ? a.color : NEO.textSecondary,
                          border: `1px solid ${active ? a.color : NEO.border}`,
                          padding: '2px 8px',
                          fontFamily: MONO,
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '0.15em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                        }}
                      >
                        {a.name} ({countByArea[a.slug]})
                      </button>
                    )
                  })}
                </div>
              )}

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
                {filtered.map((p) => (
                  <DriftRow key={p.id} project={p} />
                ))}
                {filtered.length === 0 && (
                  <div
                    style={{
                      color: NEO.textMuted,
                      fontSize: 12,
                      fontStyle: 'italic',
                      padding: '8px 0',
                    }}
                  >
                    Nenhum drift nessa área.
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Classificados — projetos que o usuário declarou intencionalmente
          sem Meta (manutenção/reativo/exploratório). Seção separada do
          drift porque a semântica é diferente: aqui é "está OK assim".
          Toggle independente; aparece só se houver classificados. */}
      {classified.length > 0 && (
        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: `1px dashed ${NEO.border}`,
          }}
        >
          <button
            type="button"
            onClick={() => setClassifiedExpanded((e) => !e)}
            style={{
              background: 'transparent',
              border: 'none',
              color: NEO.textSecondary,
              cursor: 'pointer',
              padding: '6px 0',
              fontFamily: MONO,
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              textAlign: 'left',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            {classifiedExpanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
            <span style={{ color: NEO.cyan }}>{classified.length}</span> projetos
            classificados — clique pra revisar
          </button>
          {classifiedExpanded && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                marginTop: 8,
                maxHeight: 320,
                overflowY: 'auto',
                paddingRight: 4,
              }}
            >
              {classified.map((p) => (
                <ClassifiedRow key={p.id} project={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

function ClassifiedRow({ project }: { project: BuildProjectAlignment }) {
  const { data: areas = [] } = useQuery({
    queryKey: ['areas-list'],
    queryFn: fetchAreas,
    staleTime: 5 * 60 * 1000,
  })
  const classifyProj = useClassifyProject()
  const area = areas.find((a: Area) => a.slug === project.area_slug)
  const classLabel =
    project.classification === 'manutencao'
      ? 'Manutenção'
      : project.classification === 'reativo'
        ? 'Reativo'
        : project.classification === 'exploratorio'
          ? 'Exploratório'
          : '—'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: 'transparent',
        border: `1px solid ${NEO.border}`,
        borderLeft: `2px solid ${area?.color ?? NEO.borderHot}`,
        fontFamily: MONO,
        fontSize: 11,
      }}
    >
      <span style={{ flex: 1, color: NEO.textPrimary }}>
        {project.title}
        {area && (
          <span style={{ color: NEO.textMuted, marginLeft: 6, fontSize: 10 }}>
            · {area.name}
          </span>
        )}
      </span>
      <span
        style={{
          color: NEO.cyan,
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        {classLabel}
      </span>
      <button
        type="button"
        onClick={() =>
          classifyProj.mutate({ projectId: project.id, classification: null })
        }
        disabled={classifyProj.isPending}
        title="Remover classificação (volta pro Drift)"
        style={{
          background: 'transparent',
          color: NEO.textMuted,
          border: `1px solid ${NEO.border}`,
          padding: '3px 8px',
          fontFamily: MONO,
          fontSize: 9,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          cursor: classifyProj.isPending ? 'wait' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <X size={10} /> remover
      </button>
    </div>
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

  // Desktop notifications — quando há rituais atrasados, dispara 1 notificação
  // por sessão (sem spam). Permissão pedida no primeiro atraso detectado.
  // Notification API funciona enquanto a página está aberta. Para true
  // background, precisaria service worker — fora do escopo aqui.
  useEffect(() => {
    if (totalAtrasados === 0) return
    if (typeof Notification === 'undefined') return
    const key = `ritual-notif-${new Date().toISOString().slice(0, 10)}-${totalAtrasados}`
    if (sessionStorage.getItem(key)) return
    const fire = () => {
      try {
        new Notification('Rituais atrasados', {
          body: `${totalAtrasados} ritual${totalAtrasados === 1 ? '' : 'is'} esperando revisão`,
          tag: 'mainframe-rituais',
        })
        sessionStorage.setItem(key, '1')
      } catch {
        /* ignora — alguns browsers bloqueiam após blur */
      }
    }
    if (Notification.permission === 'granted') {
      fire()
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then((p) => {
        if (p === 'granted') fire()
      })
    }
  }, [totalAtrasados])

  return (
    <Panel
      title="RITUAIS · REVISÃO"
      subtitle={
        totalAtrasados > 0
          ? `${totalAtrasados} ritual${totalAtrasados === 1 ? '' : 'is'} atrasado${totalAtrasados === 1 ? '' : 's'}`
          : 'ponte entre estrategista e executor'
      }
    >
      {isLoading ? (
        <PanelLoading />
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

/**
 * Calcula stats de execução: streak atual + completion%.
 *
 * Streak: número de slots consecutivos do ritual com sessão completada
 * (não skipped), olhando do mais recente pra trás. `skipped` quebra o
 * raciocínio "vacation mode" — não conta como fail nem como sucesso, então
 * paramos no primeiro slot skipped (não conta, mas também não zera).
 *
 * Completion: %, calculado nos últimos 90d. Numerador = sessões não-skipped;
 * denominador = slots esperados nesse intervalo (deriva da cadência).
 */
function calcRitualStats(sessions: BuildRitualSession[], cadencia: BuildRitualCadencia): {
  streak: number
  completionPct: number | null
  pendingCount: number
} {
  // Sessions já vêm sorted desc por data
  const completed = sessions.filter((s) => !s.skipped)
  let streak = 0
  // Streak: conta sessões consecutivas não-skipped começando da mais recente.
  for (const s of sessions) {
    if (s.skipped) continue   // pula sem zerar streak (vacation mode)
    streak++
    // Quebra ao encontrar a primeira gap (se sessões pulam mais de 1 slot).
    // MVP: confia que cada session = 1 slot. Aproximação suficiente.
    // Para versão rigorosa, comparar data_executado contra schedule esperado.
  }
  // Cap streak ao número total de slots em 1y pra não escalar absurdo
  const cap = cadencia === 'semanal' ? 52 : cadencia === 'mensal' ? 12 : cadencia === 'trimestral' ? 4 : 1
  streak = Math.min(streak, cap * 2)

  // Completion 90d: nº slots esperados em 90 dias por cadência
  const slotsEsperados90d =
    cadencia === 'semanal' ? Math.floor(90 / 7) :
    cadencia === 'mensal' ? 3 :
    cadencia === 'trimestral' ? 1 :
    0   // anual em 90d = 0, retorna null
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
  const recent = completed.filter((s) => new Date(`${s.data_executado}T00:00:00`) >= ninetyDaysAgo)
  const completionPct = slotsEsperados90d > 0
    ? Math.min(100, Math.round((recent.length / slotsEsperados90d) * 100))
    : null

  return { streak, completionPct, pendingCount: completed.length }
}

/**
 * Mini-heatmap: 12 quadradinhos representando últimas N rodadas (cap pela
 * cadência). Verde = completada, âmbar = skipped, vazio = sem registro.
 * Visual passivo, não interativo.
 */
function RitualHeatmap({ sessions, cadencia }: {
  sessions: BuildRitualSession[]
  cadencia: BuildRitualCadencia
}) {
  const slots = cadencia === 'semanal' ? 12 : cadencia === 'mensal' ? 12 : cadencia === 'trimestral' ? 8 : 4
  const recent = sessions.slice(0, slots).reverse()  // cronologicamente
  const padded = Array.from({ length: slots }, (_, i) => {
    const idx = recent.length - (slots - i)
    return idx >= 0 ? recent[idx] : null
  })
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {padded.map((s, i) => {
        const color = !s
          ? 'transparent'
          : s.skipped
            ? '#c08a3a'  // âmbar (warning)
            : NEO.cyan
        return (
          <span
            key={i}
            title={
              !s
                ? '—'
                : `${s.data_executado}${s.skipped ? ' (pulado)' : ''}`
            }
            style={{
              flex: 1,
              height: 6,
              background: color,
              border: !s ? `1px solid ${NEO.border}` : 'none',
              opacity: s ? 1 : 0.4,
            }}
          />
        )
      })}
    </div>
  )
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
  const { data: sessions = [] } = useRitualSessions(ritual.cadencia)
  const stats = useMemo(
    () => calcRitualStats(sessions, ritual.cadencia),
    [sessions, ritual.cadencia],
  )

  // Display do dia da semana + warning weekend pra próxima data
  const proximaWeekday = ritual.proxima_data ? weekdayLabel(ritual.proxima_data) : null
  const proximaIsWeekend = ritual.proxima_data ? isWeekend(ritual.proxima_data) : false

  // Nome customizável: fallback pra label da cadência se null/empty.
  const displayName = ritual.nome?.trim() || CADENCIA_LABELS[ritual.cadencia]
  const showCadenciaTag = !!ritual.nome?.trim()   // mostra tag pequena se renomeou

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
      {/* Header com nome + cadência tag + settings */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontSize: 11,
              color: isAtrasado ? NEO.accent : NEO.cyan,
              letterSpacing: showCadenciaTag ? '0.1em' : '0.25em',
              fontWeight: 700,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={displayName}
          >
            {displayName}
          </span>
          {showCadenciaTag && (
            <span
              style={{
                fontSize: 8,
                color: NEO.textMuted,
                letterSpacing: '0.18em',
                fontWeight: 600,
              }}
            >
              {CADENCIA_LABELS[ritual.cadencia]}
            </span>
          )}
        </div>
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
            flexShrink: 0,
          }}
        >
          <SettingsIcon size={11} />
        </button>
      </div>

      {/* Próxima data com dia da semana */}
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
        <div
          style={{
            fontSize: 10,
            color: proximaIsWeekend ? '#c08a3a' : NEO.textMuted,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
          title={proximaIsWeekend ? 'Cai em fim de semana' : undefined}
        >
          {ritual.proxima_data ? (
            <>
              {proximaWeekday && <span>{proximaWeekday},</span>}
              <span>{fmtDate(ritual.proxima_data)}</span>
              {proximaIsWeekend && <span style={{ marginLeft: 2 }}>· fds</span>}
            </>
          ) : (
            '—'
          )}
        </div>
      </div>

      {/* Mini-heatmap */}
      {sessions.length > 0 && (
        <div style={{ paddingTop: 4 }}>
          <RitualHeatmap sessions={sessions} cadencia={ritual.cadencia} />
        </div>
      )}

      {/* Stats: streak + completion */}
      {sessions.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 9,
            color: NEO.textMuted,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          {stats.streak > 0 && (
            <span>
              streak{' '}
              <span style={{ color: NEO.cyan, fontWeight: 700 }}>
                {stats.streak}
              </span>
            </span>
          )}
          {stats.completionPct !== null && (
            <span>
              90d{' '}
              <span
                style={{
                  color:
                    stats.completionPct >= 80
                      ? NEO.cyan
                      : stats.completionPct >= 50
                        ? '#c08a3a'
                        : NEO.accent,
                  fontWeight: 700,
                }}
              >
                {stats.completionPct}%
              </span>
            </span>
          )}
        </div>
      )}

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

/**
 * Linha do histórico de sessões — exibe + edita inline + deleta.
 *
 * Estados: collapsed (default, mostra dados) → editing (form inline). Skip
 * sessions têm visual diferenciado (border âmbar + label "PULADO").
 *
 * Antes era read-only; usuário não conseguia corrigir typos nem desfazer
 * "Concluir Revisão" clicado por engano.
 */
function RitualSessionHistoryRow({
  session,
  cadencia,
}: {
  session: BuildRitualSession
  cadencia: BuildRitualCadencia
}) {
  const updateSession = useUpdateRitualSession()
  const deleteSession = useDeleteRitualSession()
  const [editing, setEditing] = useState(false)
  const [dataExec, setDataExec] = useState(session.data_executado)
  const [duracao, setDuracao] = useState(
    session.duracao_min != null ? String(session.duracao_min) : '',
  )
  const [notas, setNotas] = useState(session.notas ?? '')
  const [skipReason, setSkipReason] = useState(session.skip_reason ?? '')

  function save() {
    updateSession.mutate(
      {
        cadencia,
        sessionId: session.id,
        patch: {
          data_executado: dataExec,
          duracao_min: duracao.trim() ? Number(duracao) : null,
          notas: notas.trim() || null,
          skip_reason: session.skipped
            ? skipReason.trim() || null
            : session.skip_reason,
        },
      },
      { onSuccess: () => setEditing(false) },
    )
  }

  function del() {
    if (
      confirm(
        `Deletar esta sessão de ${fmtDate(session.data_executado)}? Não dá pra desfazer.`,
      )
    ) {
      deleteSession.mutate({ cadencia, sessionId: session.id })
    }
  }

  const accent = session.skipped ? '#c08a3a' : NEO.cyanDim

  if (editing) {
    return (
      <div
        style={{
          background: NEO.bg,
          border: `1px solid ${NEO.cyan}`,
          borderLeft: `2px solid ${NEO.cyan}`,
          padding: '10px 12px',
          fontSize: 11,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Label>DATA</Label>
            <input
              type="date"
              value={dataExec}
              onChange={(e) => setDataExec(e.target.value)}
              style={{ ...inputBlockStyle, marginTop: 4, fontSize: 11 }}
            />
          </div>
          {!session.skipped && (
            <div style={{ width: 110 }}>
              <Label>DURAÇÃO</Label>
              <input
                type="number"
                value={duracao}
                onChange={(e) => setDuracao(e.target.value)}
                style={{ ...inputBlockStyle, marginTop: 4, fontSize: 11 }}
              />
            </div>
          )}
        </div>
        {session.skipped ? (
          <div>
            <Label>MOTIVO</Label>
            <input
              type="text"
              value={skipReason}
              onChange={(e) => setSkipReason(e.target.value)}
              maxLength={500}
              style={{ ...inputBlockStyle, marginTop: 4, fontSize: 11 }}
            />
          </div>
        ) : (
          <div>
            <Label>NOTAS</Label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={3}
              style={{ ...textareaStyle, marginTop: 4, fontSize: 11 }}
            />
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <MicroBtn onClick={() => setEditing(false)} label="cancelar" />
          <button
            type="button"
            onClick={save}
            disabled={updateSession.isPending}
            style={{
              background: NEO.accent,
              color: '#000',
              border: 'none',
              padding: '3px 10px',
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              opacity: updateSession.isPending ? 0.6 : 1,
            }}
          >
            salvar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        background: NEO.bg,
        border: `1px solid ${NEO.border}`,
        borderLeft: `2px solid ${accent}`,
        padding: '8px 10px',
        fontSize: 11,
        color: NEO.textSecondary,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <span
          style={{
            color: session.skipped ? '#c08a3a' : NEO.cyan,
            fontWeight: 700,
            letterSpacing: '0.1em',
          }}
        >
          {fmtDate(session.data_executado)}
        </span>
        {session.skipped ? (
          <span
            style={{
              fontSize: 9,
              color: '#c08a3a',
              letterSpacing: '0.18em',
              fontWeight: 700,
              padding: '1px 6px',
              border: '1px solid #c08a3a',
            }}
          >
            PULADO
          </span>
        ) : session.duracao_min !== null ? (
          <span style={{ color: NEO.textMuted, fontSize: 10 }}>
            {session.duracao_min} min
          </span>
        ) : null}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Editar sessão"
            style={{
              background: 'transparent',
              border: 'none',
              color: NEO.textMuted,
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
            }}
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            onClick={del}
            disabled={deleteSession.isPending}
            title="Deletar sessão"
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
      </div>
      {session.skipped && session.skip_reason && (
        <div
          style={{
            marginTop: 4,
            color: NEO.textMuted,
            fontStyle: 'italic',
            fontSize: 11,
          }}
        >
          motivo: {session.skip_reason}
        </div>
      )}
      {!session.skipped && session.notas && (
        <div
          style={{
            marginTop: 6,
            color: NEO.textPrimary,
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}
        >
          {session.notas}
        </div>
      )}
      {!session.skipped && session.foco_proxima_periodo && (
        <div
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: `1px dashed ${NEO.border}`,
            fontSize: 11,
            color: NEO.textMuted,
          }}
        >
          <span
            style={{
              color: NEO.cyan,
              letterSpacing: '0.15em',
              fontSize: 9,
              fontWeight: 700,
              textTransform: 'uppercase',
              marginRight: 6,
            }}
          >
            foco próx.:
          </span>
          <span style={{ color: NEO.textPrimary, fontStyle: 'italic' }}>
            {session.foco_proxima_periodo}
          </span>
        </div>
      )}
    </div>
  )
}

function weekdayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (isNaN(d.getTime())) return ''
  const dias = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']
  return dias[d.getDay()]
}

function isWeekend(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00`)
  if (isNaN(d.getTime())) return false
  const dow = d.getDay()
  return dow === 0 || dow === 6
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
  const { data: pastSessions = [] } = useRitualSessions(cadencia)
  const { data: activeGoals = [] } = useGoals('ativa')
  const today = new Date().toISOString().slice(0, 10)
  const [mode, setMode] = useState<'completar' | 'pular'>('completar')
  const [dataExecutado, setDataExecutado] = useState(today)
  const [duracao, setDuracao] = useState('')
  const [notas, setNotas] = useState('')
  const [focoProx, setFocoProx] = useState('')
  const [skipReason, setSkipReason] = useState('')
  const [reviewedGoalIds, setReviewedGoalIds] = useState<Set<string>>(new Set())
  const [showHistory, setShowHistory] = useState(false)

  function submit() {
    const isSkip = mode === 'pular'
    // Anexa lista de Metas revisadas no início das notas (semantic linking).
    // Schema simples: prefixo "Metas revisadas: x, y, z\n\n" + notas livres.
    const metasRevisadas = activeGoals
      .filter((g) => reviewedGoalIds.has(g.id))
      .map((g) => g.titulo)
    const notasFinal = (() => {
      if (isSkip) return null  // skip não tem notas, tem skip_reason
      const parts: string[] = []
      if (metasRevisadas.length > 0) {
        parts.push(`Metas revisadas: ${metasRevisadas.join(' · ')}`)
      }
      if (notas.trim()) parts.push(notas.trim())
      return parts.length > 0 ? parts.join('\n\n') : null
    })()
    createSession.mutate(
      {
        cadencia,
        body: {
          data_executado: dataExecutado,
          duracao_min: isSkip ? null : duracao.trim() ? Number(duracao) : null,
          notas: notasFinal,
          foco_proxima_periodo: isSkip ? null : focoProx.trim() || null,
          skipped: isSkip,
          skip_reason: isSkip ? skipReason.trim() || null : null,
        },
      },
      { onSuccess: onClose },
    )
  }

  function toggleReviewedGoal(id: string) {
    setReviewedGoalIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Portal — escapa do clip-path do Panel ancestral. Mesmo bug do
  // GoalCreateModal: sem portal, o overlay fica recortado dentro do painel.
  return createPortal(
    <div
      role="dialog"
      className="hq-animate-overlay-in"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        overflow: 'hidden',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="hq-animate-modal-in"
        style={{
          width: 'min(720px, calc(100vw - 32px))',
          background: '#0b0d12',
          border: `1px solid ${NEO.accent}`,
          padding: '28px 32px',
          position: 'relative',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          boxSizing: 'border-box',
          boxShadow: 'var(--shadow-modal), 0 0 0 1px rgba(0,0,0,0.4)',
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
          duração alvo: {ritual.duracao_alvo_min} min · escopo disciplinado abaixo
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
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Check size={11} strokeWidth={2.5} />
                O QUE PENSAR
              </span>
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
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <X size={11} strokeWidth={2.5} />
                O QUE NÃO PENSAR
              </span>
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

        {/* Mind como matéria-prima da reflexão — hipóteses pendentes do log
            inteiro + sessões/revelações registradas no período do ritual.
            Sem isso o usuário escreve `notas` cego; com isso, a observação
            estruturada vira combustível pra revisão estratégica. */}
        <MindContextPanel cadencia={cadencia} />

        {/* Toggle mode: completar vs pular intencionalmente */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginBottom: 14,
            paddingTop: 12,
            borderTop: `1px dashed ${NEO.border}`,
          }}
        >
          {(['completar', 'pular'] as const).map((m) => {
            const active = mode === m
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                style={{
                  background: active ? NEO.accent : 'transparent',
                  color: active ? '#000' : NEO.textSecondary,
                  border: `1px solid ${active ? NEO.accent : NEO.border}`,
                  padding: '5px 12px',
                  fontFamily: MONO,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                {m === 'completar' ? 'completar' : 'pular esta rodada'}
              </button>
            )
          })}
        </div>

        {/* Data (sempre) */}
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
          {mode === 'completar' && (
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
          )}
        </div>

        {mode === 'pular' ? (
          /* Modo SKIP: só motivo opcional. Sem notas/foco — preserva semântica. */
          <div style={{ marginBottom: 12 }}>
            <Label>MOTIVO (OPC)</Label>
            <input
              type="text"
              value={skipReason}
              onChange={(e) => setSkipReason(e.target.value)}
              placeholder='ex.: "viagem", "doente", "sobreposição"'
              maxLength={500}
              style={{ ...inputBlockStyle, marginTop: 4 }}
            />
            <div
              style={{
                fontSize: 10,
                color: NEO.textMuted,
                marginTop: 6,
                fontStyle: 'italic',
              }}
            >
              Pular preserva o schedule sem virar falso positivo de atraso. Não
              quebra streak.
            </div>
          </div>
        ) : (
          <>
            {/* Metas ativas pra checar quais foram revisadas */}
            {activeGoals.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Label>METAS REVISADAS NESTA SESSÃO (OPC)</Label>
                <div
                  style={{
                    marginTop: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    maxHeight: 160,
                    overflowY: 'auto',
                    paddingRight: 4,
                  }}
                >
                  {activeGoals.map((g) => {
                    const checked = reviewedGoalIds.has(g.id)
                    return (
                      <label
                        key={g.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 8px',
                          background: checked ? `${NEO.cyan}15` : 'transparent',
                          border: `1px solid ${checked ? NEO.cyan : NEO.border}`,
                          cursor: 'pointer',
                          fontSize: 12,
                          color: NEO.textPrimary,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleReviewedGoal(g.id)}
                          style={{ accentColor: NEO.cyan }}
                        />
                        <span style={{ flex: 1 }}>{g.titulo}</span>
                        <span
                          style={{
                            fontSize: 9,
                            color: NEO.textMuted,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                          }}
                        >
                          {g.horizon}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

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

            {/* Foco da próxima rodada — agora em todas cadências */}
            <div style={{ marginBottom: 12 }}>
              <Label>
                FOCO DA PRÓXIMA{' '}
                {cadencia === 'semanal'
                  ? 'SEMANA'
                  : cadencia === 'mensal'
                    ? 'RODADA MENSAL'
                    : cadencia === 'trimestral'
                      ? 'RODADA TRIMESTRAL'
                      : 'RODADA ANUAL'}
              </Label>
              <textarea
                value={focoProx}
                onChange={(e) => setFocoProx(e.target.value)}
                placeholder="1-2 Metas como foco explícito"
                rows={2}
                style={{ ...textareaStyle, marginTop: 4 }}
              />
            </div>
          </>
        )}

        {/* Histórico recente — colapsado por default */}
        {pastSessions.length > 0 && (
          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: `1px dashed ${NEO.border}`,
            }}
          >
            <button
              type="button"
              onClick={() => setShowHistory((s) => !s)}
              style={{
                background: 'transparent',
                border: 'none',
                color: NEO.textSecondary,
                cursor: 'pointer',
                padding: 0,
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {showHistory ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Histórico recente ({pastSessions.length})
            </button>
            {showHistory && (
              <div
                style={{
                  marginTop: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxHeight: 320,
                  overflowY: 'auto',
                  paddingRight: 4,
                }}
              >
                {pastSessions.slice(0, 20).map((s) => (
                  <RitualSessionHistoryRow
                    key={s.id}
                    session={s}
                    cadencia={cadencia}
                  />
                ))}
                {pastSessions.length > 20 && (
                  <div
                    style={{
                      fontSize: 10,
                      color: NEO.textMuted,
                      fontStyle: 'italic',
                      textAlign: 'center',
                      padding: 4,
                    }}
                  >
                    + {pastSessions.length - 20} sessões mais antigas
                  </div>
                )}
              </div>
            )}
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
    </div>,
    document.body,
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
  const [nome, setNome] = useState(ritual.nome ?? '')
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
          nome: nome.trim() || null,
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

  // Portal — mesmo fix dos outros modais (clip-path do Panel).
  return createPortal(
    <div
      role="dialog"
      className="hq-animate-overlay-in"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        overflow: 'hidden',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="hq-animate-modal-in"
        style={{
          width: 'min(640px, calc(100vw - 32px))',
          background: '#0b0d12',
          border: `1px solid ${NEO.accent}`,
          padding: '28px 32px',
          position: 'relative',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          boxSizing: 'border-box',
          boxShadow: 'var(--shadow-modal), 0 0 0 1px rgba(0,0,0,0.4)',
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

        {/* Nome customizável — default null = usa label da cadência */}
        <Label>NOME DO RITUAL (OPC)</Label>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={80}
          placeholder={`ex.: "Revisão de Sexta" — vazio usa ${CADENCIA_LABELS[cadencia]}`}
          style={{ ...inputBlockStyle, marginTop: 4, marginBottom: 14 }}
        />

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
    </div>,
    document.body,
  )
}

// ─── Notas long-form da Meta ──────────────────────────────────────────────

/**
 * Caderno da Meta (BlockNote). Diferente de `descricao` (1-2 frases curtas
 * exibidas no card), `notes` é long-form pra registrar razões profundas,
 * links, raciocínio, status detalhado. Edita com BlockEditor + autosave
 * debounced (mesma lógica do PageView/QuestDetailPanel).
 *
 * Lazy import do BlockEditor — chunk pesado (~1.1 MB) só baixa quando o
 * usuário expande a seção "Notas".
 */
function GoalNotesSection({ goal }: { goal: BuildGoal }) {
  const updateGoal = useUpdateGoal()
  const [draft, setDraft] = useState<string | null>(null)

  // Autosave do `notes` com debounce 800ms (mesmo padrão dos outros
  // BlockEditors do projeto). Doc-vazio do BlockNote vira `null` no DB
  // pra não poluir com JSON vazio.
  useEffect(() => {
    if (draft === null) return
    const current = goal.notes ?? null
    if (draft === (current ?? '')) return
    const t = setTimeout(() => {
      const incoming = isBlockDocEmpty(draft) ? null : draft
      if (incoming !== current) {
        updateGoal.mutate({ id: goal.id, patch: { notes: incoming } })
      }
    }, 800)
    return () => clearTimeout(t)
  }, [draft, goal.id, goal.notes])

  return (
    <div style={{ marginTop: 6 }}>
      <Suspense
        fallback={
          <div
            style={{
              fontSize: 9,
              color: NEO.textMuted,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: '12px 0',
            }}
          >
            <span style={{ color: NEO.cyan, marginRight: 4, letterSpacing: 0 }}>//</span>
            LOADING.EDITOR
          </div>
        }
      >
        <BlockEditor
          // key força remount se trocar de Meta (initialContent é memoizado).
          key={goal.id}
          value={draft ?? goal.notes ?? ''}
          onChange={setDraft}
          placeholder="Caderno da Meta — razões, links, raciocínio. Digite / pra blocos…"
          minHeight={120}
        />
      </Suspense>
    </div>
  )
}

// ─── Guardrails (v2 — pontes Health) ──────────────────────────────────

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
    color: '#ffb300',  // âmbar (alinhado com Health)
    icon: <AlertTriangle size={11} />,
    label: 'MÉTRICA SUMIU',
  },
}

function GuardrailsInline({ goal }: { goal: BuildGoal }) {
  const { data: guardrails = [] } = useGoalGuardrailsEval(goal.id)
  const removeGuardrail = useDeleteGoalGuardrail()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  const editing = editingId !== null
    ? guardrails.find((g) => g.id === editingId) ?? null
    : null

  if (guardrails.length === 0 && !adding) {
    return (
      <div style={{ marginTop: 4 }}>
        <MicroBtn onClick={() => setAdding(true)} icon={<Plus size={10} />} label="guardrail (espírito)" />
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
                onEdit={() => {
                  setEditingId(g.id)
                  setAdding(false)
                }}
                onRemove={() =>
                  removeGuardrail.mutate({ goalId: goal.id, guardrailId: g.id })
                }
              />
            ))}
          </div>
        </>
      )}
      {/* Form: edit tem prioridade sobre add */}
      {editing ? (
        <GuardrailForm
          key={`edit-${editing.id}`}
          goalId={goal.id}
          initial={editing}
          onClose={() => setEditingId(null)}
        />
      ) : adding ? (
        <GuardrailForm
          goalId={goal.id}
          onClose={() => setAdding(false)}
        />
      ) : (
        <div style={{ marginTop: 4 }}>
          <MicroBtn onClick={() => setAdding(true)} icon={<Plus size={10} />} label="guardrail" />
        </div>
      )}
    </div>
  )
}

function GuardrailRow({
  ev,
  onEdit,
  onRemove,
}: {
  ev: BuildGuardrailEvaluation
  onEdit: () => void
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
        onClick={onEdit}
        title="Editar guardrail"
        style={{
          background: 'transparent',
          border: 'none',
          color: NEO.textMuted,
          cursor: 'pointer',
          padding: 2,
          display: 'flex',
        }}
      >
        <Pencil size={10} />
      </button>
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

function GuardrailForm({
  goalId,
  initial,
  onClose,
}: {
  goalId: string
  /** Quando setado, opera em modo edição. Senão, criação. */
  initial?: BuildGuardrailEvaluation | null
  onClose: () => void
}) {
  const isEdit = !!initial
  const { data: catalog = [] } = useHealthMetricsCatalog()
  const createGuardrail = useCreateGoalGuardrail()
  const updateGuardrail = useUpdateGoalGuardrail()
  const [metricSlug, setMetricSlug] = useState(initial?.metric_slug ?? '')
  const [itemId, setItemId] = useState<string>(
    initial?.item_id != null ? String(initial.item_id) : '',
  )
  const [operador, setOperador] = useState<BuildGuardrailOperador>(
    (initial?.operador as BuildGuardrailOperador) ?? '>=',
  )
  const [valorAlvo, setValorAlvo] = useState(
    initial?.valor_alvo != null ? String(initial.valor_alvo) : '',
  )
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
    const payload = {
      metric_slug: metricSlug,
      item_id: needsItem ? Number(itemId) : null,
      operador,
      valor_alvo: Number(valorAlvo),
    }
    if (isEdit && initial) {
      updateGuardrail.mutate(
        { goalId, guardrailId: initial.id, patch: payload },
        {
          onSuccess: onClose,
          onError: (err) => setError(err instanceof Error ? err.message : 'Erro'),
        },
      )
    } else {
      createGuardrail.mutate(
        { goalId, body: payload },
        {
          onSuccess: onClose,
          onError: (err) => setError(err instanceof Error ? err.message : 'Erro'),
        },
      )
    }
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
        {isEdit ? 'Editar guardrail (Health)' : 'Adicionar guardrail (Health)'}
      </div>

      {/* Select de métrica.
          `colorScheme: dark` força o browser a usar UI escura no dropdown
          nativo (sem isso, em Windows light mode a lista vinha branca).
          `background: var(--color-bg-primary)` substitui o transparent que
          deixava o campo invisível. */}
      <select
        value={metricSlug}
        onChange={(e) => {
          setMetricSlug(e.target.value)
          setItemId('')
        }}
        style={{
          background: 'var(--color-bg-primary)',
          color: NEO.textPrimary,
          border: '1px solid var(--color-border)',
          padding: '4px 8px',
          fontFamily: MONO,
          fontSize: 11,
          outline: 'none',
          colorScheme: 'dark',
        }}
      >
        <option value="">— escolha uma métrica —</option>
        {Object.entries(grouped).map(([domain, metrics]) => (
          <optgroup key={domain} label={domain}>
            {metrics.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.nome}
                {/* Sufixo "precisa item" removido — info técnica do schema.
                    Quando true, o segundo dropdown (item) aparece logo abaixo
                    automaticamente; UI fala por si só. */}
                {''}
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
            background: 'var(--color-bg-primary)',
            color: NEO.textPrimary,
            border: '1px solid var(--color-border)',
            padding: '4px 8px',
            fontFamily: MONO,
            fontSize: 11,
            outline: 'none',
            colorScheme: 'dark',
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
            background: 'var(--color-bg-primary)',
            color: NEO.cyan,
            border: '1px solid var(--color-border)',
            padding: '4px 8px',
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 700,
            outline: 'none',
            colorScheme: 'dark',
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
            background: 'var(--color-bg-primary)',
            color: NEO.textPrimary,
            border: '1px solid var(--color-border)',
            padding: '4px 8px',
            fontFamily: MONO,
            fontSize: 11,
            outline: 'none',
            colorScheme: 'dark',
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
          disabled={createGuardrail.isPending || updateGuardrail.isPending}
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
            cursor:
              createGuardrail.isPending || updateGuardrail.isPending
                ? 'wait'
                : 'pointer',
            opacity:
              createGuardrail.isPending || updateGuardrail.isPending ? 0.6 : 1,
          }}
        >
          {isEdit ? 'salvar' : 'adicionar'}
        </button>
      </div>
    </div>
  )
}

function MicroBtn({ onClick, label, icon, title }: {
  onClick: () => void
  label: string
  icon?: ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
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
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
      }}
    >
      {icon}
      {label}
    </button>
  )
}

/**
 * Loading state padrão usado dentro dos painéis principais (Goals,
 * Drift, Rituals, Purpose, Vision). Substitui o div solto duplicado
 * em 5+ lugares — uma fonte só pra mudar tom/tipo.
 */
function PanelLoading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div style={{ color: NEO.textMuted, fontSize: 13 }}>{label}</div>
  )
}

/**
 * Seletor de áreas reusável pelos modais de criar/editar Meta. Renderiza
 * lista de áreas com checkbox visual + estrela pra primária. Mesmo
 * comportamento dos dois lugares (toggle + makePrimary). Antes era código
 * duplicado de ~80 linhas entre Create e Edit modals.
 */
function AreasSelector({
  areas,
  selectedSlugs,
  primarySlug,
  onToggle,
  onMakePrimary,
}: {
  areas: Area[]
  selectedSlugs: Set<string>
  primarySlug: string | null
  onToggle: (slug: string) => void
  onMakePrimary: (slug: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {areas.map((a) => {
        const isSelected = selectedSlugs.has(a.slug)
        const isPrimary = primarySlug === a.slug
        return (
          <div
            key={a.slug}
            onClick={() => onToggle(a.slug)}
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

            {/* Estrela pra trocar a primária — só clicável se selecionada */}
            <button
              type="button"
              title={isPrimary ? 'Esta é a área primária' : 'Tornar primária'}
              disabled={!isSelected}
              onClick={(e) => {
                e.stopPropagation() // evita disparar onToggle
                if (isSelected) onMakePrimary(a.slug)
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
                minWidth: 70,
                textAlign: 'right',
              }}
            >
              {isPrimary ? 'PRIMÁRIA' : isSelected ? 'secundária' : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Modal pequeno listando atalhos de teclado disponíveis no /build.
 * Renderizado pelo GoalsPanel quando usuário aperta `?`. Esc fecha.
 */
function KeyboardShortcutsHelp({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    { key: 'N', label: 'Nova Meta' },
    { key: '?', label: 'Mostrar/esconder este atalho' },
    { key: 'Esc', label: 'Fechar modal/diálogo' },
  ]
  return createPortal(
    <div
      role="dialog"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(420px, calc(100vw - 32px))',
          background: '#0b0d12',
          border: `1px solid ${NEO.accent}`,
          padding: '24px 28px',
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
          <div style={{ fontSize: 11, letterSpacing: '0.32em', color: NEO.accent, fontWeight: 700 }}>
            ❰ ATALHOS
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
            <X size={14} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shortcuts.map((s) => (
            <div
              key={s.key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 16,
                fontSize: 12,
                color: NEO.textSecondary,
              }}
            >
              <span>{s.label}</span>
              <kbd
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  background: NEO.bg,
                  border: `1px solid ${NEO.border}`,
                  color: NEO.cyan,
                  letterSpacing: '0.05em',
                  minWidth: 28,
                  textAlign: 'center',
                  display: 'inline-block',
                }}
              >
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Quick-create de projeto vinculado a uma Meta — botão "+ projeto" inline
 * no L3 do card de Meta. Click expande input inline (Enter cria + vincula
 * + invalida queries; Esc cancela). Sem modal full pra fluxo rápido.
 *
 * Usa a área primária da Meta (ou fallback no slug) como area_slug do
 * projeto criado. Dispara link em sequência — UX é "novo projeto pra essa
 * Meta", não "criar e vincular separado".
 */
function QuickCreateProjectButton({ goal, primaryAreaSlug }: {
  goal: BuildGoal
  primaryAreaSlug: string | null
}) {
  const linkProject = useLinkProjectToGoal()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const title = draft.trim()
    if (!title || !primaryAreaSlug || busy) return
    setBusy(true)
    try {
      const proj = await createProject({ title, area_slug: primaryAreaSlug })
      // Vincula o projeto recém-criado à Meta. Backend valida tudo.
      await new Promise<void>((resolve, reject) => {
        linkProject.mutate(
          { projectId: proj.id, goalId: goal.id },
          { onSuccess: () => resolve(), onError: (e) => reject(e) },
        )
      })
      // Invalida cross-cutting: lista de projetos do alignment + lista geral.
      queryClient.invalidateQueries({ queryKey: ['build', 'projects-alignment'] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDraft('')
      setAdding(false)
    } catch (err) {
      alertDialog({
        title: 'Falha ao criar projeto',
        message: err instanceof Error ? err.message : 'Erro desconhecido',
        variant: 'danger',
      })
    } finally {
      setBusy(false)
    }
  }

  if (!primaryAreaSlug) return null  // sem área primária, não dá pra criar

  if (adding) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') {
              setDraft('')
              setAdding(false)
            }
          }}
          autoFocus
          placeholder="título do projeto…"
          disabled={busy}
          style={{
            background: NEO.bg,
            color: NEO.textPrimary,
            border: `1px solid ${NEO.accent}`,
            padding: '1px 6px',
            fontFamily: MONO,
            fontSize: 10,
            width: 180,
            outline: 'none',
            opacity: busy ? 0.6 : 1,
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !draft.trim()}
          title="Criar e vincular"
          style={{
            background: 'transparent',
            border: 'none',
            color: NEO.cyan,
            cursor: busy || !draft.trim() ? 'not-allowed' : 'pointer',
            padding: 1,
            display: 'flex',
            opacity: busy || !draft.trim() ? 0.4 : 1,
          }}
        >
          <Check size={11} />
        </button>
        <button
          type="button"
          onClick={() => { setDraft(''); setAdding(false) }}
          disabled={busy}
          title="Cancelar"
          style={{
            background: 'transparent',
            border: 'none',
            color: NEO.textMuted,
            cursor: 'pointer',
            padding: 1,
            display: 'flex',
          }}
        >
          <X size={11} />
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setAdding(true)}
      title="Criar projeto vinculado a esta Meta"
      style={{
        background: 'transparent',
        border: 'none',
        color: NEO.textMuted,
        cursor: 'pointer',
        padding: 1,
        display: 'inline-flex',
        alignItems: 'center',
        opacity: 0.5,
        transition: 'opacity 0.15s, color 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = '1'
        e.currentTarget.style.color = NEO.cyan
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = '0.5'
        e.currentTarget.style.color = NEO.textMuted
      }}
    >
      <Plus size={11} />
    </button>
  )
}

/**
 * Empty state padrão pra painéis. `message` é a mensagem principal
 * (em itálico, muted), `hint` é um sub-texto explicativo opcional, e
 * `action` é um CTA opcional pra convidar o usuário a popular.
 *
 * Antes cada painel reimplementava com `<p>` ad-hoc; agora padronizado:
 * mesmo tom (itálico muted), mesmas dimensões, ação primária consistente.
 */
function PanelEmpty({
  message,
  hint,
  action,
}: {
  message: string
  hint?: string
  action?: { label: string; icon?: ReactNode; onClick: () => void }
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: NEO.textMuted,
          fontStyle: 'italic',
          lineHeight: 1.6,
        }}
      >
        {message}
      </p>
      {hint && (
        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: NEO.textMuted,
            lineHeight: 1.5,
          }}
        >
          {hint}
        </p>
      )}
      {action && (
        <div>
          <ActionBtn
            onClick={action.onClick}
            icon={action.icon}
            label={action.label}
            variant="accent"
          />
        </div>
      )}
    </div>
  )
}

// Labels PT-BR pra status de Meta — substituem strings cruas do banco no card.
const GOAL_STATUS_LABEL: Record<BuildGoalStatus, string> = {
  ativa: 'Em andamento',
  pausada: 'Pausada',
  concluida: 'Concluída',
  abandonada: 'Abandonada',
}

// Labels PT-BR pra horizon — usado em filtros e detalhe da Meta.
const GOAL_HORIZON_LABEL: Record<BuildGoalHorizon, string> = {
  anual: 'Anual',
  trimestral: 'Trimestral',
}

/**
 * Sub-seção colapsável dentro do card de Meta — usado pra Sprints,
 * Dependências e Guardrails. Default fechado pra reduzir densidade visual
 * de Metas com muito conteúdo. Quando fechado, os children NÃO são
 * montados — economiza fetch das queries internas (cada sub-componente
 * tem seu próprio `useQuery`).
 *
 * Persiste estado open/closed em localStorage por `storageKey` (formato
 * sugerido: `hq-build-collapse-{goalId}-{sectionName}`). Sem `storageKey`,
 * comportamento legacy (in-memory). Útil pra Meta que o usuário consulta
 * muito — não fecha a Section toda vez que o painel re-renderiza.
 */
function CollapsibleSection({ label, defaultOpen, storageKey, children }: {
  label: string
  defaultOpen?: boolean
  storageKey?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState<boolean>(() => {
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey)
        if (raw === '1') return true
        if (raw === '0') return false
      } catch {}
    }
    return defaultOpen ?? false
  })

  function toggle() {
    setOpen((prev) => {
      const next = !prev
      if (storageKey) {
        try { localStorage.setItem(storageKey, next ? '1' : '0') } catch {}
      }
      return next
    })
  }

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          background: 'transparent',
          border: 'none',
          color: NEO.textMuted,
          padding: '2px 0',
          fontFamily: MONO,
          fontSize: 9,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontWeight: 700,
        }}
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {label}
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

/**
 * Menu dropdown pra ações secundárias da Meta (pausar, abandonar, etc).
 * A ação primária (concluir/reativar/etc, depende do status) fica como
 * botão visível ao lado. Reduz a poluição de 5 botões empilhados.
 *
 * Acessibilidade:
 *  - Click fora fecha
 *  - ESC fecha (capture phase pra não vazar pra outros listeners)
 *  - ↑/↓ navegam itens (focus); Enter dispara o item focado
 *  - Tab também navega (default do browser nos buttons internos)
 *  - Auto-focus no primeiro item ao abrir
 */
function ActionMenu({ items }: {
  items: { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean }[]
}) {
  const [open, setOpen] = useState(false)
  const [focusIdx, setFocusIdx] = useState(0)
  const ref = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      // Menu agora é portalizado pra escapar do clipPath ancestral — o
      // handler precisa checar AMBOS o wrapper do trigger E o menu portaled.
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusIdx((i) => {
          const next = Math.min(i + 1, items.length - 1)
          itemRefs.current[next]?.focus()
          return next
        })
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusIdx((i) => {
          const next = Math.max(i - 1, 0)
          itemRefs.current[next]?.focus()
          return next
        })
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true) // capture
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, items.length])

  // Auto-focus no primeiro item ao abrir.
  useEffect(() => {
    if (open) {
      setFocusIdx(0)
      // microtask: deixa o DOM renderizar antes de tentar focar
      queueMicrotask(() => itemRefs.current[0]?.focus())
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Mais ações"
        style={{
          background: 'transparent',
          color: NEO.textMuted,
          border: `1px solid ${NEO.border}`,
          padding: '2px 6px',
          fontFamily: MONO,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          height: 19,
        }}
      >
        <MoreHorizontal size={12} />
      </button>
      {open && (() => {
        // Portal-rendered + position:fixed — escapa do clipPath dos painéis
        // ancestrais do Build (mesmo bug que afeta GoalCreateModal e
        // RitualSessionFormModal). Posição calculada do bounding box do
        // trigger; ancorado à direita pra alinhar com o ícone do botão.
        const rect = triggerRef.current?.getBoundingClientRect()
        if (!rect) return null
        const menu = (
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: 'fixed',
              top: rect.bottom + 2,
              // Âncora pela esquerda → menu se expande pra direita do botão.
              left: rect.left,
              background: '#0b0d12',
              border: `1px solid ${NEO.border}`,
              zIndex: 1000,
              minWidth: 140,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0, 0, 0, 0.4)',
            }}
          >
            {items.map((item, i) => (
              <button
                key={i}
                ref={(el) => { itemRefs.current[i] = el }}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
                onFocus={() => setFocusIdx(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  background: focusIdx === i ? NEO.panel : 'transparent',
                  border: 'none',
                  color: item.danger ? NEO.accent : NEO.textSecondary,
                  padding: '6px 10px',
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  textAlign: 'left',
                  outline: 'none',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = NEO.panel)}
                onMouseLeave={(e) => {
                  if (focusIdx !== i) e.currentTarget.style.background = 'transparent'
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        )
        return createPortal(menu, document.body)
      })()}
    </div>
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
  // v2.1: origem do valor (Meta numérica) — manual ou puxa de Health
  const [valorOrigem, setValorOrigem] = useState<'manual' | 'health'>('manual')
  const [metricSlug, setMetricSlug] = useState('')
  const [metricItemId, setMetricItemId] = useState('')
  // Áreas — UX nova: Set de slugs selecionados + qual é primária.
  // Primária é sempre a primeira selecionada (auto), mas pode ser trocada.
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set())
  const [primarySlug, setPrimarySlug] = useState<string | null>(null)

  // Catálogo de métricas pra dropdown (só carregado quando usuário escolhe Health)
  const { data: metricsCatalog = [] } = useHealthMetricsCatalog()
  const selectedMetric: HealthMetricMeta | undefined = metricsCatalog.find(
    (m) => m.slug === metricSlug,
  )
  const { data: metricItems = [] } = useHealthItems(
    selectedMetric?.domain_slug ?? '',
    false,
  )
  const groupedMetrics = useMemo(() => {
    const g: Record<string, HealthMetricMeta[]> = {}
    for (const m of metricsCatalog) {
      if (!g[m.domain_slug]) g[m.domain_slug] = []
      g[m.domain_slug].push(m)
    }
    return g
  }, [metricsCatalog])

  const [error, setError] = useState<string | null>(null)

  const canSubmit = useMemo(
    () => {
      const baseOK =
        titulo.trim() !== '' &&
        dataAlvo !== '' &&
        primarySlug !== null &&
        selectedSlugs.size >= 1
      if (!baseOK) return false
      if (criterionType === 'boolean') return true
      if (criterionTarget.trim() === '') return false
      // v2.1: se origem é health, exige metric_slug + (item_id se necessário)
      if (valorOrigem === 'health') {
        if (!metricSlug) return false
        if (selectedMetric?.precisa_item && !metricItemId) return false
      }
      return true
    },
    [
      titulo, dataAlvo, primarySlug, selectedSlugs, criterionType,
      criterionTarget, valorOrigem, metricSlug, metricItemId, selectedMetric,
    ],
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
      criterion_metric_slug:
        criterionType === 'numeric' && valorOrigem === 'health' ? metricSlug : null,
      criterion_metric_item_id:
        criterionType === 'numeric' &&
        valorOrigem === 'health' &&
        selectedMetric?.precisa_item
          ? Number(metricItemId)
          : null,
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

  // Portal pro document.body — o modal é renderizado dentro de `<Panel>`,
  // que tem `clip-path` na linha 4850. Sem o portal, o overlay (position
  // fixed) seria clipado dentro do retângulo do Panel, renderizando dentro
  // do painel em vez de cobrir a tela inteira. Portal escapa essa árvore.
  return createPortal(
    <div
      role="dialog"
      className="hq-animate-overlay-in"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        // Centralizado vertical/horizontal — popup tradicional. Quando o
        // conteúdo passa do limite, o card faz scroll interno (não o overlay).
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        overflow: 'hidden',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="hq-animate-modal-in"
        style={{
          width: 'min(640px, calc(100vw - 32px))',
          // Background opaco — NEO.panel (0.55 alpha) combinado com backdrop
          // blur deixava o card "fantasma". Aqui queremos foco total no form.
          background: '#0b0d12',
          border: `1px solid ${NEO.accent}`,
          padding: '28px 32px',
          position: 'relative',
          // Scroll por dentro do card — header e botões sempre acessíveis.
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          boxSizing: 'border-box',
          boxShadow: 'var(--shadow-modal), 0 0 0 1px rgba(0,0,0,0.4)',
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
            fontSize: 12,
            color: NEO.textSecondary,
            marginBottom: 24,
            lineHeight: 1.5,
            fontStyle: 'italic',
          }}
        >
          Uma meta é um <em>outcome</em> com prazo — não uma ação. Sua, não
          importada.
        </div>

        {/* Pergunta 1 — qual o outcome (estado final desejado) */}
        <Question
          numero="·"
          titulo="Qual o estado que você quer ter atingido?"
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

        {/* Pergunta 2 — critério objetivo de sucesso */}
        <Question
          numero="·"
          titulo="Como vai saber objetivamente que atingiu?"
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
          <>
            <input
              type="number"
              value={criterionTarget}
              onChange={(e) => setCriterionTarget(e.target.value)}
              placeholder="valor alvo (ex.: 5000)"
              style={{ ...inputBlockStyle, marginTop: 10, width: 220 }}
            />

            {/* v2.1: Origem do valor — manual ou Health */}
            <div style={{ marginTop: 14 }}>
              <Label>DE ONDE VEM O VALOR ATUAL</Label>
              <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                <RadioOpt
                  checked={valorOrigem === 'manual'}
                  onClick={() => setValorOrigem('manual')}
                  label="Eu digito"
                  sub="atualizo manualmente quando muda"
                />
                <RadioOpt
                  checked={valorOrigem === 'health'}
                  onClick={() => setValorOrigem('health')}
                  label="Vem de Health"
                  sub="puxa de uma Métrica automaticamente"
                />
              </div>

              {valorOrigem === 'health' && (
                <div
                  style={{
                    marginTop: 10,
                    padding: 10,
                    border: `1px solid ${NEO.cyanDim}`,
                    background: `${NEO.cyan}05`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <select
                    value={metricSlug}
                    onChange={(e) => {
                      setMetricSlug(e.target.value)
                      setMetricItemId('')
                    }}
                    style={{
                      background: 'var(--color-bg-primary)',
                      color: NEO.textPrimary,
                      border: `1px solid ${NEO.cyanDim}`,
                      padding: '6px 10px',
                      fontFamily: MONO,
                      fontSize: 12,
                      outline: 'none',
                      colorScheme: 'dark',
                    }}
                  >
                    <option value="">— escolha uma Métrica —</option>
                    {Object.entries(groupedMetrics).map(([domain, metrics]) => (
                      <optgroup key={domain} label={domain}>
                        {metrics.map((m) => (
                          <option key={m.slug} value={m.slug}>
                            {m.nome}
                            {/* Sufixo "precisa item" removido — info técnica do schema.
                    Quando true, o segundo dropdown (item) aparece logo abaixo
                    automaticamente; UI fala por si só. */}
                {''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {selectedMetric?.precisa_item && (
                    <select
                      value={metricItemId}
                      onChange={(e) => setMetricItemId(e.target.value)}
                      style={{
                        background: 'var(--color-bg-primary)',
                        color: NEO.textPrimary,
                        border: `1px solid ${NEO.cyanDim}`,
                        padding: '6px 10px',
                        fontFamily: MONO,
                        fontSize: 12,
                        outline: 'none',
                        colorScheme: 'dark',
                      }}
                    >
                      <option value="">— item de {selectedMetric.domain_slug} —</option>
                      {metricItems.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.nome}
                        </option>
                      ))}
                    </select>
                  )}
                  <div style={{ fontSize: 10, color: NEO.textMuted, fontStyle: 'italic' }}>
                    O valor atual será puxado direto de Health — não precisa atualizar manualmente.
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Pergunta 3 */}
        <Question numero="·" titulo="Até quando?" />
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
        <Question numero="·" titulo="Áreas da vida que a meta atravessa" />
        <div style={{ fontSize: 10, color: NEO.textMuted, marginBottom: 8 }}>
          Clique nas áreas pra selecionar (várias permitidas). A primeira vira{' '}
          <strong style={{ color: NEO.accent }}>primária</strong> automaticamente
          — clique na ★ pra trocar qual é a principal.
        </div>
        <AreasSelector
          areas={areas}
          selectedSlugs={selectedSlugs}
          primarySlug={primarySlug}
          onToggle={toggleArea}
          onMakePrimary={makePrimary}
        />

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
    </div>,
    document.body,
  )
}

// ─── Modal de edição de Meta ──────────────────────────────────────────────

function GoalEditModal({
  goal,
  onClose,
}: {
  goal: BuildGoal
  onClose: () => void
}) {
  const updateGoal = useUpdateGoal()
  const replaceAreas = useReplaceGoalAreas()
  const { data: areasList = [] } = useQuery({
    queryKey: ['areas-list'],
    queryFn: fetchAreas,
    staleTime: 5 * 60 * 1000,
  })
  const [titulo, setTitulo] = useState(goal.titulo)
  const [descricao, setDescricao] = useState(goal.descricao ?? '')
  const [horizon, setHorizon] = useState<BuildGoalHorizon>(goal.horizon)
  const [dataAlvo, setDataAlvo] = useState(goal.data_alvo)
  const [criterionTarget, setCriterionTarget] = useState(
    goal.criterion_target_value !== null ? String(goal.criterion_target_value) : '',
  )
  const [isFoundational, setIsFoundational] = useState(goal.is_foundational)
  const [valorOrigem, setValorOrigem] = useState<'manual' | 'health'>(
    goal.criterion_metric_slug ? 'health' : 'manual',
  )
  const [metricSlug, setMetricSlug] = useState(goal.criterion_metric_slug ?? '')
  const [metricItemId, setMetricItemId] = useState(
    goal.criterion_metric_item_id !== null
      ? String(goal.criterion_metric_item_id)
      : '',
  )
  // Áreas — inicializa do goal atual. Set selecionados + primária.
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(
    () => new Set(goal.areas.map((a) => a.area_slug)),
  )
  const [primarySlug, setPrimarySlug] = useState<string | null>(
    () => goal.areas.find((a) => a.is_primary)?.area_slug ?? null,
  )
  const [error, setError] = useState<string | null>(null)

  const { data: metricsCatalog = [] } = useHealthMetricsCatalog()
  const selectedMetric: HealthMetricMeta | undefined = metricsCatalog.find(
    (m) => m.slug === metricSlug,
  )
  const { data: metricItems = [] } = useHealthItems(
    selectedMetric?.domain_slug ?? '',
    false,
  )
  const groupedMetrics = useMemo(() => {
    const g: Record<string, HealthMetricMeta[]> = {}
    for (const m of metricsCatalog) {
      if (!g[m.domain_slug]) g[m.domain_slug] = []
      g[m.domain_slug].push(m)
    }
    return g
  }, [metricsCatalog])

  const isNumeric = goal.criterion_type === 'numeric'

  // Helpers de seleção de áreas — mesmo padrão do GoalCreateModal
  function toggleArea(slug: string) {
    setSelectedSlugs((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) {
        next.delete(slug)
        if (primarySlug === slug) {
          const replacement = next.values().next().value ?? null
          setPrimarySlug(replacement)
        }
      } else {
        next.add(slug)
        if (primarySlug === null) setPrimarySlug(slug)
      }
      return next
    })
  }
  function makePrimary(slug: string) {
    setSelectedSlugs((prev) => {
      if (prev.has(slug)) return prev
      const next = new Set(prev)
      next.add(slug)
      return next
    })
    setPrimarySlug(slug)
  }

  // Detecta se a lista de áreas mudou vs goal atual
  const areasChanged = useMemo(() => {
    const currentSet = new Set(goal.areas.map((a) => a.area_slug))
    if (currentSet.size !== selectedSlugs.size) return true
    for (const s of selectedSlugs) if (!currentSet.has(s)) return true
    const currentPrimary = goal.areas.find((a) => a.is_primary)?.area_slug ?? null
    return currentPrimary !== primarySlug
  }, [goal.areas, selectedSlugs, primarySlug])

  function submit() {
    if (!titulo.trim() || !dataAlvo) {
      setError('Título e data alvo são obrigatórios')
      return
    }
    // Validações de áreas
    if (selectedSlugs.size === 0) {
      setError('Meta precisa de pelo menos 1 área')
      return
    }
    if (!primarySlug || !selectedSlugs.has(primarySlug)) {
      setError('Marque uma área como primária (★)')
      return
    }
    if (isNumeric && !criterionTarget.trim()) {
      setError('Critério numérico exige valor alvo')
      return
    }
    if (isNumeric && valorOrigem === 'health') {
      if (!metricSlug) {
        setError('Escolha uma Métrica de Health')
        return
      }
      if (selectedMetric?.precisa_item && !metricItemId) {
        setError('Essa Métrica precisa de um item específico')
        return
      }
    }
    setError(null)

    // Monta patch só com o que mudou (evita writes desnecessários)
    const patch: Record<string, unknown> = {}
    if (titulo.trim() !== goal.titulo) patch.titulo = titulo.trim()
    if ((descricao.trim() || null) !== goal.descricao)
      patch.descricao = descricao.trim() || null
    if (horizon !== goal.horizon) patch.horizon = horizon
    if (dataAlvo !== goal.data_alvo) patch.data_alvo = dataAlvo
    if (isFoundational !== goal.is_foundational)
      patch.is_foundational = isFoundational

    if (isNumeric) {
      const newTarget = Number(criterionTarget)
      if (newTarget !== goal.criterion_target_value)
        patch.criterion_target_value = newTarget

      // Origem do valor: comparar estado novo vs goal atual
      if (valorOrigem === 'health') {
        if (metricSlug !== goal.criterion_metric_slug)
          patch.criterion_metric_slug = metricSlug
        const newItemId = selectedMetric?.precisa_item ? Number(metricItemId) : null
        if (newItemId !== goal.criterion_metric_item_id)
          patch.criterion_metric_item_id = newItemId
      } else {
        // Manual: desvincula se estava vinculado
        if (goal.criterion_metric_slug !== null) {
          patch.criterion_metric_slug = ''
          patch.criterion_metric_item_id = null
        }
      }
    }

    const hasPatch = Object.keys(patch).length > 0
    if (!hasPatch && !areasChanged) {
      onClose()
      return
    }

    // Salva primeiro o patch de campos (se houver), depois áreas (se mudaram).
    // Sequencial pra reportar erro do primeiro que falhar sem confundir UI.
    const saveAreasThenClose = () => {
      if (!areasChanged) {
        onClose()
        return
      }
      const allAreas: BuildGoalAreaLink[] = [
        { area_slug: primarySlug!, is_primary: true },
        ...Array.from(selectedSlugs)
          .filter((s) => s !== primarySlug)
          .map((s) => ({ area_slug: s, is_primary: false })),
      ]
      replaceAreas.mutate(
        { id: goal.id, areas: allAreas },
        {
          onSuccess: () => onClose(),
          onError: (err) =>
            setError(err instanceof Error ? err.message : 'Erro nas áreas'),
        },
      )
    }

    if (hasPatch) {
      updateGoal.mutate(
        { id: goal.id, patch: patch as any },
        {
          onSuccess: () => saveAreasThenClose(),
          onError: (err) => setError(err instanceof Error ? err.message : 'Erro'),
        },
      )
    } else {
      saveAreasThenClose()
    }
  }

  // Portal — mesma razão do GoalCreateModal (escapa do clip-path do Panel).
  return createPortal(
    <div
      role="dialog"
      className="hq-animate-overlay-in"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        overflow: 'hidden',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="hq-animate-modal-in"
        style={{
          width: 'min(640px, calc(100vw - 32px))',
          background: '#0b0d12',
          border: `1px solid ${NEO.accent}`,
          padding: '28px 32px',
          position: 'relative',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          boxSizing: 'border-box',
          boxShadow: 'var(--shadow-modal), 0 0 0 1px rgba(0,0,0,0.4)',
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
            ❰ EDITAR META
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
            fontSize: 12,
            color: NEO.textSecondary,
            marginBottom: 24,
            lineHeight: 1.5,
            fontStyle: 'italic',
          }}
        >
          Dependências têm fluxo próprio (no card da Meta). O tipo de critério
          (atingir um valor ou marcar quando feito) não pode ser alterado depois
          de criada.
        </div>

        <Label>TÍTULO</Label>
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          style={{ ...inputBlockStyle, marginTop: 4, marginBottom: 12 }}
        />

        <Label>DESCRIÇÃO (OPCIONAL)</Label>
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          rows={2}
          style={{ ...textareaStyle, marginTop: 4, marginBottom: 12, fontSize: 12 }}
        />

        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <Label>HORIZONTE</Label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
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
          </div>
          <div style={{ width: 200 }}>
            <Label>DATA ALVO</Label>
            <input
              type="date"
              value={dataAlvo}
              onChange={(e) => setDataAlvo(e.target.value)}
              style={{ ...inputBlockStyle, marginTop: 4 }}
            />
          </div>
        </div>

        {isNumeric && (
          <>
            <Label>VALOR ALVO</Label>
            <input
              type="number"
              value={criterionTarget}
              onChange={(e) => setCriterionTarget(e.target.value)}
              step="any"
              style={{
                ...inputBlockStyle,
                marginTop: 4,
                marginBottom: 14,
                width: 220,
              }}
            />

            <Label>DE ONDE VEM O VALOR ATUAL</Label>
            <div style={{ display: 'flex', gap: 12, marginTop: 4, marginBottom: 8 }}>
              <RadioOpt
                checked={valorOrigem === 'manual'}
                onClick={() => setValorOrigem('manual')}
                label="Eu digito"
                sub="atualizo manualmente"
              />
              <RadioOpt
                checked={valorOrigem === 'health'}
                onClick={() => setValorOrigem('health')}
                label="Vem de Health"
                sub="puxa de uma Métrica"
              />
            </div>

            {valorOrigem === 'health' && (
              <div
                style={{
                  marginBottom: 14,
                  padding: 10,
                  border: `1px solid ${NEO.cyanDim}`,
                  background: `${NEO.cyan}05`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <select
                  value={metricSlug}
                  onChange={(e) => {
                    setMetricSlug(e.target.value)
                    setMetricItemId('')
                  }}
                  style={{
                    background: NEO.bg,
                    color: NEO.textPrimary,
                    border: `1px solid ${NEO.cyanDim}`,
                    padding: '6px 10px',
                    fontFamily: MONO,
                    fontSize: 12,
                    outline: 'none',
                  }}
                >
                  <option value="">— escolha uma Métrica —</option>
                  {Object.entries(groupedMetrics).map(([domain, metrics]) => (
                    <optgroup key={domain} label={domain}>
                      {metrics.map((m) => (
                        <option key={m.slug} value={m.slug}>
                          {m.nome}
                          {/* Sufixo "precisa item" removido — info técnica do schema.
                    Quando true, o segundo dropdown (item) aparece logo abaixo
                    automaticamente; UI fala por si só. */}
                {''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {selectedMetric?.precisa_item && (
                  <select
                    value={metricItemId}
                    onChange={(e) => setMetricItemId(e.target.value)}
                    style={{
                      background: NEO.bg,
                      color: NEO.textPrimary,
                      border: `1px solid ${NEO.cyanDim}`,
                      padding: '6px 10px',
                      fontFamily: MONO,
                      fontSize: 12,
                      outline: 'none',
                    }}
                  >
                    <option value="">— item de {selectedMetric.domain_slug} —</option>
                    {metricItems.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.nome}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </>
        )}

        {/* Áreas — seletor inline */}
        <div style={{ marginBottom: 14 }}>
          <Label>ÁREAS DA VIDA</Label>
          <div
            style={{
              fontSize: 10,
              color: NEO.textMuted,
              marginTop: 4,
              marginBottom: 8,
            }}
          >
            Clique pra selecionar/desselecionar. ★ marca a área primária (cor).
          </div>
          <AreasSelector
            areas={areasList}
            selectedSlugs={selectedSlugs}
            primarySlug={primarySlug}
            onToggle={toggleArea}
            onMakePrimary={makePrimary}
          />
        </div>

        <div
          style={{
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
            id={`is-foundational-edit-${goal.id}`}
            checked={isFoundational}
            onChange={(e) => setIsFoundational(e.target.checked)}
            style={{ accentColor: NEO.accent, width: 14, height: 14 }}
          />
          <label
            htmlFor={`is-foundational-edit-${goal.id}`}
            style={{ fontSize: 12, color: NEO.textPrimary, cursor: 'pointer', flex: 1 }}
          >
            Meta de <strong>fundação</strong> (pré-requisito de outras)
          </label>
          <Star
            size={13}
            color={NEO.accent}
            fill={isFoundational ? NEO.accent : 'transparent'}
          />
        </div>

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
            label="Salvar"
            variant="accent"
            disabled={updateGoal.isPending}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Section header dentro do modal de criar/editar Meta. A prop `numero`
 * vira um marcador estético sutil ("·") em vez do antigo "01/02/03" rígido
 * que parecia tutorial.
 *
 * Tipografia suavizada (sentence case + tamanho médio) pra ficar mais
 * conversacional — antes era uppercase letter-spaced agressivo, que somado
 * à numeração reforçava sensação de "formulário militar". Pergunta agora
 * lê como pergunta, não como label de campo.
 */
function Question({ numero, titulo }: { numero: string; titulo: string }) {
  return (
    <div
      style={{
        marginTop: 22,
        marginBottom: 10,
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: NEO.accent,
          fontWeight: 700,
          minWidth: 8,
        }}
      >
        {numero}
      </span>
      <span
        style={{
          fontSize: 13,
          color: NEO.textPrimary,
          fontWeight: 600,
          letterSpacing: '0.01em',
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
  // Stats globais — visão imediata da camada estratégica
  const { data: activeGoals = [] } = useGoals('ativa')
  const { data: drift = [] } = useProjectsAlignment({ driftOnly: true })
  const { data: rituals = [] } = useRituals()
  const { data: settings } = useBuildSettings()

  const maxMetas = settings?.max_metas_ativas ?? 5
  const ritualsAtrasados = rituals.filter((r) => r.ativo && r.dias_atraso > 0).length

  return (
    <header
      style={{
        position: 'relative',
        padding: '14px 40px',
        background: 'linear-gradient(180deg, rgba(10, 14, 22, 0.92), rgba(8, 10, 14, 0.88))',
        borderBottom: '1px solid var(--color-ice-deep)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-5)',
        minHeight: 64,
        flexWrap: 'wrap',
      }}
    >
      {/* TAB MARKER — indicador ice estendendo abaixo, assinatura "tab pull"
          das HUDs CP2077 (mesma da DashboardPage). */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0, bottom: -1,
          width: 64, height: 2,
          background: 'var(--color-ice)',
          boxShadow: '0 0 12px var(--color-ice-glow)',
        }}
      />

      {/* LEFT — tab title + hero + subtítulo empilhados. Em formato BAND
          (não card), igual o Dashboard header. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flex: 1, minWidth: 0 }}>
        <div
          className="hq-tech-label"
          style={{
            fontSize: 11,
            color: 'var(--color-ice-light)',
            letterSpacing: '0.28em',
            flexShrink: 0,
          }}
        >
          BUILD
        </div>
        <div style={{ width: 1, height: 28, background: 'var(--color-border-strong)', flexShrink: 0 }} />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{
            fontFamily: DISPLAY,
            fontSize: 18, fontWeight: 600,
            letterSpacing: '0.04em',
            color: 'var(--color-text-primary)',
            lineHeight: 1.1,
            textTransform: 'uppercase',
            textShadow: '0 0 16px rgba(143, 191, 211, 0.18)',
          }}>
            STRATEGIC.COMMAND
          </div>
          <div className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
            propósito → visão → metas
          </div>
        </div>
      </div>

      {/* RIGHT — stats stack em formato HUD readout (igual o lado direito
          do Dashboard header). Cada stat tem label mono + value mono colorido
          conforme estado (oxblood quando alerta). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)', flexShrink: 0 }}>
        <HeaderReadout
          label="METAS"
          value={`${activeGoals.length}/${maxMetas}`}
          tone={
            activeGoals.length >= maxMetas
              ? 'danger'
              : activeGoals.length === 0
              ? 'muted'
              : 'ice'
          }
        />
        <HeaderReadout
          label="DRIFT"
          value={String(drift.length)}
          tone={drift.length > 0 ? 'danger' : 'muted'}
        />
        <HeaderReadout
          label="ATRASOS"
          value={String(ritualsAtrasados)}
          tone={ritualsAtrasados > 0 ? 'danger' : 'success'}
        />
        <div style={{ width: 1, height: 28, background: 'var(--color-border-strong)' }} />
        <div className="hq-tech-id" style={{ color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
          <span>SYS.ONLINE</span>
          <span style={{ color: 'var(--color-success)' }}>· CONN.OK</span>
        </div>
      </div>

    </header>
  )
}

function HeaderReadout({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'ice' | 'danger' | 'muted' | 'success'
}) {
  const color =
    tone === 'danger' ? 'var(--color-accent-light)'
    : tone === 'muted' ? 'var(--color-text-tertiary)'
    : tone === 'success' ? 'var(--color-success-light)'
    : 'var(--color-ice-light)'
  const glow =
    tone === 'danger' ? '0 0 10px rgba(251, 113, 133, 0.30)'
    : tone === 'ice' ? '0 0 10px var(--color-ice-glow)'
    : 'none'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
      <span className="hq-tech-label" style={{ color: 'var(--color-text-muted)', fontSize: 9 }}>
        {label}
      </span>
      <span style={{
        fontFamily: MONO,
        fontSize: 16, fontWeight: 700,
        color,
        textShadow: glow,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.02em',
      }}>
        {value}
      </span>
    </div>
  )
}

// HeaderStat (old) removido — substituído por HeaderReadout no novo header BAND.

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
        <PanelLoading />
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
            <>
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
              <div style={{ marginTop: 16 }}>
                <ActionBtn
                  onClick={startEdit}
                  icon={<Pencil size={13} />}
                  label="Editar"
                  variant="accent"
                />
              </div>
            </>
          ) : (
            <PanelEmpty
              message="Propósito ainda não articulado."
              hint="É o arquétipo da sua build — atemporal. Comece com 1-3 frases sobre quem você está sendo, não o que vai fazer."
              action={{
                label: 'Articular Propósito',
                icon: <Pencil size={13} />,
                onClick: startEdit,
              }}
            />
          )}
        </>
      )}

      <PrinciplesSection />
    </Panel>
  )
}

// ─── Princípios negativos (anti-metas) ────────────────────────────────────

function PrincipleRow({ principle }: { principle: BuildPrinciple }) {
  const updatePrinciple = useUpdatePrinciple()
  const deletePrinciple = useDeletePrinciple()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(principle.texto)

  function save() {
    const texto = draft.trim()
    if (!texto || texto === principle.texto) {
      setEditing(false)
      setDraft(principle.texto)
      return
    }
    updatePrinciple.mutate(
      { id: principle.id, patch: { texto } },
      { onSuccess: () => setEditing(false) },
    )
  }

  return (
    <li
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
      {editing ? (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') {
              setDraft(principle.texto)
              setEditing(false)
            }
          }}
          autoFocus
          style={{
            flex: 1,
            background: NEO.bg,
            color: NEO.textPrimary,
            border: `1px solid ${NEO.accent}`,
            padding: '3px 8px',
            fontFamily: MONO,
            fontSize: 13,
            fontStyle: 'italic',
            outline: 'none',
          }}
        />
      ) : (
        <span
          style={{ flex: 1, lineHeight: 1.5, cursor: 'pointer' }}
          onClick={() => {
            setDraft(principle.texto)
            setEditing(true)
          }}
          title="Click pra editar"
        >
          {principle.texto}
        </span>
      )}
      <LibraryBacklinksBadge targetType="build_principle" targetId={principle.id} />
      <button
        type="button"
        onClick={() => deletePrinciple.mutate(principle.id)}
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
  )
}

function PrinciplesSection() {
  const { data: principles = [], isLoading } = usePrinciples()
  const createPrinciple = useCreatePrinciple()
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
        <PanelEmpty
          message="Nenhum princípio negativo definido."
          hint='Esses são os "não-quero-ser" — filtram decisões e Metas. Ex.: "Não trabalhar > 45h/sem sustentado".'
        />
      )}

      {principles.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {principles.map((p) => (
            <PrincipleRow key={p.id} principle={p} />
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

function VisionHistoryBtn() {
  const { data: history = [], isLoading } = useVisionHistory()
  const [open, setOpen] = useState(false)

  if (isLoading || history.length === 0) return null

  return (
    <>
      <ActionBtn
        onClick={() => setOpen(true)}
        icon={<Archive size={13} />}
        label={`Histórico (${history.length})`}
        variant="muted"
      />
      {open && (
        <VisionHistoryModal
          versions={history}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function VisionHistoryModal({
  versions,
  onClose,
}: {
  versions: BuildVision[]
  onClose: () => void
}) {
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
            ❰ HISTÓRICO DE VISÕES
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
            fontSize: 12,
            color: NEO.textSecondary,
            marginBottom: 24,
            lineHeight: 1.5,
            fontStyle: 'italic',
          }}
        >
          {versions.length} {versions.length === 1 ? 'versão arquivada' : 'versões arquivadas'} — ordem cronológica reversa.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {versions.map((v) => (
            <div
              key={v.id}
              style={{
                background: NEO.bg,
                border: `1px solid ${NEO.border}`,
                borderLeft: `2px solid ${NEO.textMuted}`,
                padding: '14px 16px',
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: NEO.textMuted,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <span>criada: {fmtDate(v.criada_em)}</span>
                {v.arquivada_em && (
                  <span>arquivada: {fmtDate(v.arquivada_em)}</span>
                )}
                {v.data_alvo && <span>alvo era: {fmtDate(v.data_alvo)}</span>}
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: NEO.textPrimary,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {v.texto}
              </p>
              {v.motivo_arquivamento && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 10px',
                    borderLeft: `2px solid ${NEO.borderHot}`,
                    background: `${NEO.accent}05`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      color: NEO.accent,
                      letterSpacing: '0.2em',
                      textTransform: 'uppercase',
                      marginBottom: 4,
                      fontWeight: 700,
                    }}
                  >
                    motivo de arquivar
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: NEO.textPrimary,
                      fontStyle: 'italic',
                      lineHeight: 1.5,
                    }}
                  >
                    {v.motivo_arquivamento}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <ActionBtn
            onClick={onClose}
            icon={<X size={14} />}
            label="Fechar"
            variant="muted"
          />
        </div>
      </div>
    </div>
  )
}

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

  async function commitVersion() {
    // Só pede confirmação se já existe Visão atual (vai arquivar). Primeira
    // criação não precisa.
    if (vision) {
      const ok = await confirmDialog({
        title: 'Versionar Visão',
        message:
          `A Visão atual será arquivada (preservada no histórico) e a nova ` +
          `entra como ativa. Use isso quando sua direção mudou de verdade — ` +
          `pra ajustes pequenos use 'Editar'. Continuar?`,
        confirmLabel: 'VERSIONAR',
        danger: true,
      })
      if (!ok) return
    }
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
        <PanelLoading />
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
            <VisionHistoryBtn />
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
  // Frame estilo "DATA DISPLAY" do Dashboard veredito:
  //  - Outer: hq-brackets-full (corner ice glow) + 1px ice-deep + clipPath
  //    chamfer-bl + radial subtle gradients no fundo
  //  - TITLE BAR: faixa solid no topo com pulse-square ice + tech-label +
  //    optional subtitle/range no canto direito
  //  - CONTENT: padding generoso, children
  // Mesma assinatura visual da DashboardPage frame de veredito.
  return (
    <div
      className="hq-brackets-full"
      style={{
        position: 'relative',
        border: '1px solid var(--color-ice-deep)',
        background: `
          radial-gradient(ellipse 60% 100% at 50% 0%, rgba(143, 191, 211, 0.05), transparent 70%),
          radial-gradient(ellipse 80% 60% at 50% 100%, rgba(40, 50, 57, 0.25), transparent 70%),
          rgba(8, 12, 18, 0.65)
        `,
        color: 'var(--color-ice)', // for hq-brackets-full corner color
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)',
      }}
    >
      {/* TITLE BAR — faixa solid no topo, separa do CONTENT. */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--color-ice-deep)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'rgba(40, 50, 57, 0.45)',
          flexWrap: 'wrap',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 8, height: 8,
            background: 'var(--color-ice)',
            boxShadow: '0 0 8px var(--color-ice-glow)',
            flexShrink: 0,
          }}
        />
        <span
          className="hq-tech-label"
          style={{
            color: 'var(--color-ice-light)',
            letterSpacing: '0.28em',
            fontSize: 10,
          }}
        >
          {title}
        </span>
        {subtitle && (
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)', marginLeft: 'auto' }}
          >
            {subtitle}
          </span>
        )}
      </div>

      {/* CONTENT */}
      <div style={{ padding: '20px 24px 24px' }}>
        {children}
      </div>
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

/**
 * Painel "MIND DO PERÍODO" injetado no RitualSessionFormModal.
 *
 * Mostra hipóteses pendentes (sempre relevantes, não filtradas por data) +
 * revelações + contagem de sessões no período do ritual. Click numa hipótese
 * leva pra /mind/hipoteses pra confrontar. Pretende ser matéria-prima da
 * reflexão — sem isso, `notas` é escrita às cegas.
 *
 * Esconde-se quando nada relevante existe (não polui rituais de quem ainda
 * não tem prática de observação).
 */
function MindContextPanel({ cadencia }: { cadencia: BuildRitualCadencia }) {
  // Janela de período por cadência — alinha com o sentido temporal do ritual.
  const days = (() => {
    switch (cadencia) {
      case 'semanal': return 7
      case 'mensal': return 30
      case 'trimestral': return 90
      case 'anual': return 365
      default: return 7
    }
  })()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - (days - 1))
  const cutoffIso = cutoff.toISOString().slice(0, 10)

  const { data: pendingHipoteses = [] } = useMindHipoteses('pending')
  const { data: sessions = [] } = useMindSessions({ limit: 200 })
  const periodSessions = sessions.filter((s) => s.data >= cutoffIso)
  const revelacoes = periodSessions.filter((s) => s.payload.tipo === 'revelacao')

  if (pendingHipoteses.length === 0 && periodSessions.length === 0) return null

  return (
    <div
      style={{
        border: '1px solid #9b88c4',
        borderLeft: '2px solid #9b88c4',
        padding: '12px 14px',
        background: 'rgba(155, 136, 196, 0.04)',
        marginBottom: 20,
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: '#9b88c4',
          letterSpacing: '0.25em',
          fontWeight: 700,
          marginBottom: 8,
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>MIND · ÚLTIMOS {days}D</span>
        <span style={{ color: NEO.textMuted, fontWeight: 500 }}>
          · matéria-prima da reflexão
        </span>
      </div>

      {/* Stats compactos */}
      <div
        style={{
          display: 'flex',
          gap: 18,
          marginBottom: 10,
          fontSize: 11,
          fontFamily: MONO,
          color: NEO.textSecondary,
          flexWrap: 'wrap',
        }}
      >
        <span>
          <span style={{ color: '#9b88c4', fontWeight: 700 }}>
            {periodSessions.length}
          </span>{' '}
          sessões
        </span>
        {revelacoes.length > 0 && (
          <span>
            <span style={{ color: '#c08a3a', fontWeight: 700 }}>
              {revelacoes.length}
            </span>{' '}
            revelações
          </span>
        )}
        {pendingHipoteses.length > 0 && (
          <span>
            <span style={{ color: 'var(--color-warning)', fontWeight: 700 }}>
              {pendingHipoteses.length}
            </span>{' '}
            hipóteses pendentes
          </span>
        )}
      </div>

      {/* Hipóteses pendentes — itálico, máx 5 */}
      {pendingHipoteses.length > 0 && (
        <div style={{ marginBottom: revelacoes.length > 0 ? 10 : 0 }}>
          <div
            style={{
              fontSize: 9,
              color: 'var(--color-warning)',
              letterSpacing: '0.2em',
              marginBottom: 4,
              textTransform: 'uppercase',
            }}
          >
            A confrontar
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pendingHipoteses.slice(0, 5).map((h) => (
              <a
                key={h.id}
                href="/mind/hipoteses"
                style={{
                  fontSize: 12,
                  fontFamily: BODY,
                  fontStyle: 'italic',
                  color: NEO.textPrimary,
                  textDecoration: 'none',
                  borderLeft: '2px solid var(--color-warning)',
                  paddingLeft: 8,
                  lineHeight: 1.45,
                }}
              >
                "{h.texto}"
                {h.tags.length > 0 && (
                  <span
                    style={{
                      fontFamily: MONO,
                      fontStyle: 'normal',
                      color: NEO.textMuted,
                      fontSize: 10,
                      marginLeft: 6,
                    }}
                  >
                    · {h.tags.join(' · ')}
                  </span>
                )}
              </a>
            ))}
            {pendingHipoteses.length > 5 && (
              <span
                style={{
                  fontSize: 10,
                  color: NEO.textMuted,
                  fontFamily: MONO,
                  fontStyle: 'italic',
                  paddingLeft: 8,
                }}
              >
                + {pendingHipoteses.length - 5} outras
              </span>
            )}
          </div>
        </div>
      )}

      {/* Revelações no período — destacadas em âmbar */}
      {revelacoes.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 9,
              color: '#c08a3a',
              letterSpacing: '0.2em',
              marginBottom: 4,
              textTransform: 'uppercase',
            }}
          >
            ✦ Revelações no período
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {revelacoes.slice(0, 3).map((s) => (
              <div
                key={s.id}
                style={{
                  fontSize: 12,
                  fontFamily: BODY,
                  color: NEO.textPrimary,
                  borderLeft: '2px solid #c08a3a',
                  paddingLeft: 8,
                  lineHeight: 1.45,
                }}
              >
                {s.payload.observacao.length > 180
                  ? `${s.payload.observacao.slice(0, 180).trimEnd()}…`
                  : s.payload.observacao}
              </div>
            ))}
            {revelacoes.length > 3 && (
              <span
                style={{
                  fontSize: 10,
                  color: NEO.textMuted,
                  fontFamily: MONO,
                  fontStyle: 'italic',
                  paddingLeft: 8,
                }}
              >
                + {revelacoes.length - 3} outras revelações
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const textareaStyle: React.CSSProperties = {
  // Bg sólido — antes `NEO.bg = transparent` deixava o campo invisível
  // sobre o card. Border discreta (não accent) pra não competir com input.
  // Fonte BODY (Chakra Petch) — texto livre lê melhor que mono.
  background: 'var(--color-bg-primary)',
  color: NEO.textPrimary,
  border: '1px solid var(--color-border)',
  padding: '10px 12px',
  fontFamily: BODY,
  fontSize: 13,
  lineHeight: 1.55,
  resize: 'vertical',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  letterSpacing: 0,
}

const inputStyle: React.CSSProperties = {
  background: 'var(--color-bg-primary)',
  color: NEO.textPrimary,
  border: '1px solid var(--color-border)',
  padding: '6px 10px',
  fontFamily: MONO,
  fontSize: 12,
  outline: 'none',
  width: 180,
}

const inputBlockStyle: React.CSSProperties = {
  // Bg sólido — mesmo motivo do textareaStyle.
  background: 'var(--color-bg-primary)',
  color: NEO.textPrimary,
  border: '1px solid var(--color-border)',
  padding: '8px 12px',
  fontFamily: MONO,
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}
