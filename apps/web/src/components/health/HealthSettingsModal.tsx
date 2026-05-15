/**
 * Modal de Settings do Hub Health.
 *
 * Cobre as configurações que antes só existiam na API mas não tinham UI:
 *
 *   1. **Globais** — hora do lembrete de sono (HH:MM) + visibilidade do
 *      card no Dashboard
 *   2. **Por domínio** — lembrete ativo, threshold de ausência, métrica
 *      primária do Dashboard, cor, ícone Lucide, ativo/arquivado, delete
 *   3. **Criar domínio novo** — formulário inline no fim da lista (slug +
 *      nome + template + ícone + cor)
 *
 * Estética: vocabulário CP2077 do tronco — `hq-glass-elevated` + chamfer-cross
 * + grain + hairline ice + animação modal-in. Header em `hq-tech-label`,
 * botões `hq-btn--primary` (chrome) / `hq-btn--ghost`. Por dentro, sub-rows
 * de domínio em `hq-glass` com border-left accent, como no Biomonitor.
 */
import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react'

import {
  useCreateHealthDomain,
  useDeleteHealthDomain,
  useHealthDomains,
  useHealthMetricsCatalog,
  useHealthSettings,
  useMigrateRefeicao2modos,
  useUpdateHealthDomain,
  useUpdateHealthSettings,
} from '../../lib/health-queries'
import type {
  HealthDomain,
  HealthDomainCreate,
  HealthDomainUpdate,
  HealthTemplate,
} from '../../types'
import { domainIconFor } from './domainIcon'
import { BODY, MONO, colorForDomain } from './tokens'

const TEMPLATES: { value: HealthTemplate; label: string; usa_itens: boolean }[] = [
  { value: 'janela_qualidade', label: 'Janela com qualidade (sono)', usa_itens: false },
  { value: 'atividade_tipo', label: 'Atividade com tipo (exercício)', usa_itens: true },
  { value: 'refeicao_2modos', label: 'Refeição em 2 modos (alimentação)', usa_itens: true },
  { value: 'consumo_vontade', label: 'Consumo com vontade (vícios)', usa_itens: true },
  { value: 'metrica_simples', label: 'Métrica numérica simples (medidas)', usa_itens: true },
  { value: 'evento_escala', label: 'Evento com escala (humor, energia)', usa_itens: false },
]

interface Props {
  onClose: () => void
}

export default function HealthSettingsModal({ onClose }: Props) {
  return (
    <div
      onClick={onClose}
      className="hq-animate-overlay-in"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 1000,
        paddingTop: '4vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="hq-glass-elevated hq-grain hq-animate-modal-in hq-chamfer-cross"
        style={{
          position: 'relative',
          padding: '20px 24px',
          width: 'min(800px, calc(100vw - 16px))',
          maxHeight: '92vh',
          overflowY: 'auto',
          color: 'var(--color-text-primary)',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        {/* Hairline ice no topo — assinatura CP2077 modal */}
        <div
          aria-hidden="true"
          className="hq-hairline-ice"
          style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        />

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <span
            className="hq-tech-label"
            style={{
              fontSize: 11,
              color: 'var(--color-ice-light)',
              letterSpacing: '0.28em',
            }}
          >
            BIOMONITOR
          </span>
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)' }}
          >
            SETTINGS
          </span>
          <button
            type="button"
            onClick={onClose}
            className="hq-icon-btn-bare"
            style={{ marginLeft: 'auto' }}
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        <GlobalSettings />
        <DomainsSettings />
        <AdminSection />
      </div>
    </div>
  )
}

// ─── Admin (migrations one-shot) ──────────────────────────────────────────

/**
 * Seção administrativa pra ferramentas de migração one-shot. Cresce conforme
 * surgem refactors no schema. Por enquanto: migração refeicao_2modos legacy
 * → agrupado.
 */
function AdminSection() {
  const migrate = useMigrateRefeicao2modos()
  const [result, setResult] = useState<{
    domains_processed: number
    days_migrated: number
    records_consolidated: number
    records_deleted: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    setResult(null)
    if (
      !confirm(
        'Consolidar registros antigos de alimentação em formato agrupado (1 record/dia)?\n\nSeguro: faz dump+insert+delete numa transação. Idempotente — pode rodar mais de uma vez.',
      )
    ) {
      return
    }
    migrate.mutate(undefined, {
      onSuccess: (data) => setResult(data),
      onError: (err) => setError((err as Error).message),
    })
  }

  return (
    <section
      style={{
        marginTop: 24,
        paddingTop: 16,
        borderTop: '1px dashed var(--color-divider)',
      }}
    >
      <SectionLabel>ADMIN</SectionLabel>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleClick}
          disabled={migrate.isPending}
          className="hq-btn hq-btn--ghost"
          style={{ fontSize: 11, padding: '8px 14px' }}
        >
          {migrate.isPending ? 'MIGRANDO…' : 'MIGRAR ALIMENTAÇÃO PRA AGRUPADO'}
        </button>
        <div
          style={{
            flex: '1 1 200px',
            fontSize: 11,
            color: 'var(--color-text-muted)',
            fontFamily: BODY,
            lineHeight: 1.4,
          }}
        >
          Consolida registros legacy (1 por refeição) em 1 record por dia com
          `refeicoes[]` no payload. Idempotente.
        </div>
      </div>
      {result && (
        <div
          className="hq-tech-id"
          style={{
            marginTop: 8,
            color: 'var(--color-ice-light)',
            padding: '6px 10px',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-primary)',
          }}
        >
          ✓ {result.days_migrated} DIAS · {result.records_deleted} REGISTROS CONSOLIDADOS EM {result.records_consolidated}
        </div>
      )}
      {error && (
        <div
          style={{
            marginTop: 8,
            color: 'var(--color-error)',
            padding: '6px 10px',
            border: '1px solid var(--color-danger-border)',
            background: 'var(--color-danger-bg)',
            fontSize: 11,
            fontFamily: BODY,
          }}
        >
          {error}
        </div>
      )}
    </section>
  )
}

// ─── Global ───────────────────────────────────────────────────────────────

function GlobalSettings() {
  const { data: settings } = useHealthSettings()

  // Render só quando settings chega — evita footgun de prop→state sync
  // (memória `feedback_prop_state_sync.md`). Sub-componente recebe `initial`
  // e mantém state local sem precisar sincronizar mudanças vindas do server.
  if (!settings) {
    return (
      <section style={{ marginBottom: 24 }}>
        <SectionLabel>GERAL</SectionLabel>
        <div
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)' }}
        >
          // CARREGANDO…
        </div>
      </section>
    )
  }

  return <GlobalSettingsForm initial={settings} />
}

function GlobalSettingsForm({
  initial,
}: {
  initial: { hora_lembrete_sono: string; dashboard_card_visivel: boolean }
}) {
  const updateSettings = useUpdateHealthSettings()
  const [horaLembrete, setHoraLembrete] = useState(initial.hora_lembrete_sono)
  const [cardVisivel, setCardVisivel] = useState(initial.dashboard_card_visivel)

  function saveHora() {
    if (horaLembrete && horaLembrete !== initial.hora_lembrete_sono) {
      updateSettings.mutate({ hora_lembrete_sono: horaLembrete })
    }
  }

  return (
    <section
      style={{
        marginBottom: 24,
        paddingBottom: 16,
        borderBottom: '1px dashed var(--color-divider)',
      }}
    >
      <SectionLabel>GERAL</SectionLabel>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <Field label="HORA LEMBRETE SONO">
          <input
            type="time"
            value={horaLembrete}
            onChange={(e) => setHoraLembrete(e.target.value)}
            onBlur={saveHora}
            style={inputStyle()}
          />
          <Hint>quando o lembrete de "registrar a noite" dispara</Hint>
        </Field>
        <Field label="CARD NO DASHBOARD">
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontFamily: BODY,
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              padding: '8px 0',
            }}
          >
            <input
              type="checkbox"
              checked={cardVisivel}
              onChange={(e) => {
                setCardVisivel(e.target.checked)
                updateSettings.mutate({ dashboard_card_visivel: e.target.checked })
              }}
            />
            mostrar vitals no dashboard
          </label>
        </Field>
      </div>
    </section>
  )
}

// ─── Domínios ─────────────────────────────────────────────────────────────

function DomainsSettings() {
  const { data: domains = [] } = useHealthDomains(true)         // include_inactive=true
  const [creating, setCreating] = useState(false)

  return (
    <section>
      <SectionLabel>DOMÍNIOS</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {domains.map((d) => (
          <DomainRow key={d.slug} domain={d} />
        ))}
      </div>

      {!creating ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="hq-btn hq-btn--ghost"
          style={{
            marginTop: 12,
            width: '100%',
            justifyContent: 'center',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderStyle: 'dashed',
          }}
        >
          <Plus size={13} strokeWidth={2} /> CRIAR DOMÍNIO
        </button>
      ) : (
        <CreateDomainForm
          onCancel={() => setCreating(false)}
          onDone={() => setCreating(false)}
        />
      )}
    </section>
  )
}

// ─── Row de domínio (expandable) ─────────────────────────────────────────

function DomainRow({ domain }: { domain: HealthDomain }) {
  const [expanded, setExpanded] = useState(false)
  const cor = colorForDomain(domain.slug, domain.cor)
  const Icon = domainIconFor(domain.icone, domain.template)

  return (
    <div
      className="hq-glass hq-chamfer-bl"
      style={{
        borderLeft: `2px solid ${cor}`,
        opacity: domain.ativo ? 1 : 0.5,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {expanded ? (
          <ChevronDown size={14} color="var(--color-text-muted)" />
        ) : (
          <ChevronRight size={14} color="var(--color-text-muted)" />
        )}
        <Icon size={14} strokeWidth={1.6} color={cor} />
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--color-text-primary)',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
          }}
        >
          {domain.nome}
        </span>
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {domain.template}
        </span>
        {!domain.ativo && (
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-warning)' }}
          >
            INATIVO
          </span>
        )}
      </button>

      {expanded && <DomainEditor domain={domain} cor={cor} />}
    </div>
  )
}

function DomainEditor({ domain, cor }: { domain: HealthDomain; cor: string }) {
  const update = useUpdateHealthDomain()
  const del = useDeleteHealthDomain()
  const { data: catalog = [] } = useHealthMetricsCatalog()
  const [errorBanner, setErrorBanner] = useState<string | null>(null)

  // Métricas disponíveis pra esse domínio (catálogo já filtra por domain_slug)
  const domainMetrics = catalog.filter((m) => m.domain_slug === domain.slug)

  const [nome, setNome] = useState(domain.nome)
  const [icone, setIcone] = useState(domain.icone ?? '')
  const [domainCor, setDomainCor] = useState(domain.cor ?? '')
  const [lembrete, setLembrete] = useState(domain.lembrete_ativo)
  const [ausencia, setAusencia] = useState<string>(
    domain.ausencia_threshold_dias?.toString() ?? '',
  )
  const [primary, setPrimary] = useState(domain.metric_primary_slug ?? '')

  function patchAndSync(patch: HealthDomainUpdate) {
    update.mutate(
      { slug: domain.slug, patch },
      {
        onError: (err) => setErrorBanner((err as Error).message),
      },
    )
  }

  function saveAusencia() {
    const num = ausencia.trim() === '' ? null : parseInt(ausencia, 10)
    if (num !== null && (Number.isNaN(num) || num < 1 || num > 365)) {
      setErrorBanner('Threshold deve ser número entre 1 e 365 (ou vazio)')
      return
    }
    patchAndSync({ ausencia_threshold_dias: num })
  }

  return (
    <div
      style={{
        padding: '10px 14px 14px',
        borderTop: '1px dashed var(--color-divider)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 10,
      }}
    >
      {errorBanner && (
        <div
          style={{
            gridColumn: '1 / -1',
            background: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger-border)',
            color: 'var(--color-error)',
            padding: '6px 10px',
            fontSize: 11,
            fontFamily: BODY,
          }}
        >
          {errorBanner}
        </div>
      )}

      <Field label="NOME">
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={() => nome !== domain.nome && patchAndSync({ nome })}
          style={inputStyle()}
        />
      </Field>

      <Field label="ÍCONE LUCIDE">
        <input
          type="text"
          value={icone}
          onChange={(e) => setIcone(e.target.value)}
          onBlur={() => icone !== (domain.icone ?? '') && patchAndSync({ icone: icone || null })}
          placeholder="ex: moon, dumbbell, scale"
          style={inputStyle()}
        />
        <Hint>nome em kebab-case</Hint>
      </Field>

      <Field label="COR">
        <input
          type="color"
          value={domainCor || cor}
          onChange={(e) => setDomainCor(e.target.value)}
          onBlur={() => domainCor !== (domain.cor ?? '') && patchAndSync({ cor: domainCor || null })}
          style={{
            width: '100%',
            height: 30,
            padding: 0,
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-primary)',
            cursor: 'pointer',
          }}
        />
      </Field>

      <Field label="LEMBRETE ATIVO">
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontFamily: BODY,
            padding: '8px 0',
          }}
        >
          <input
            type="checkbox"
            checked={lembrete}
            disabled={domain.template === 'consumo_vontade'}
            onChange={(e) => {
              setLembrete(e.target.checked)
              patchAndSync({ lembrete_ativo: e.target.checked })
            }}
          />
          {domain.template === 'consumo_vontade' ? 'travado (filosofia §3.5)' : 'avisar quando faltar'}
        </label>
      </Field>

      <Field label="AUSÊNCIA (DIAS)">
        <input
          type="number"
          value={ausencia}
          onChange={(e) => setAusencia(e.target.value)}
          onBlur={saveAusencia}
          min={1}
          max={365}
          placeholder="vazio = sem alerta"
          disabled={domain.template === 'consumo_vontade' || domain.template === 'metrica_simples'}
          style={inputStyle()}
        />
        <Hint>
          {domain.template === 'consumo_vontade' || domain.template === 'metrica_simples'
            ? 'fixo desabilitado (filosofia)'
            : 'após N dias sem registro, dispara âmbar'}
        </Hint>
      </Field>

      <Field label="MÉTRICA PRIMÁRIA (DASHBOARD)" style={{ gridColumn: 'span 2' }}>
        <select
          value={primary}
          onChange={(e) => {
            setPrimary(e.target.value)
            patchAndSync({ metric_primary_slug: e.target.value || null })
          }}
          style={inputStyle()}
        >
          <option value="">— default por template —</option>
          {domainMetrics.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.nome.split('—')[1]?.trim() ?? m.slug}
            </option>
          ))}
        </select>
        <Hint>qual leitura aparece no card "vitals"</Hint>
      </Field>

      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => patchAndSync({ ativo: !domain.ativo })}
          className="hq-btn hq-btn--ghost"
        >
          {domain.ativo ? 'DESATIVAR' : 'REATIVAR'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              confirm(
                `Deletar domínio "${domain.nome}" definitivamente? (Falha se houver itens ou registros — desative em vez disso pra preservar histórico.)`,
              )
            ) {
              del.mutate(domain.slug, {
                onError: (err) =>
                  setErrorBanner(
                    `Não foi possível deletar: ${(err as Error).message}\n\nUse "desativar" pra esconder sem perder.`,
                  ),
              })
            }
          }}
          className="hq-btn hq-btn--ghost"
          style={{
            color: 'var(--color-error)',
            borderColor: 'var(--color-danger-border)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Trash2 size={11} /> DELETAR
        </button>
      </div>
    </div>
  )
}

// ─── Form de criar domínio ───────────────────────────────────────────────

function CreateDomainForm({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const create = useCreateHealthDomain()
  const [slug, setSlug] = useState('')
  const [nome, setNome] = useState('')
  const [template, setTemplate] = useState<HealthTemplate>('metrica_simples')
  const [icone, setIcone] = useState('')
  const [cor, setCor] = useState('')
  const [error, setError] = useState<string | null>(null)

  const tplDef = TEMPLATES.find((t) => t.value === template)!

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const body: HealthDomainCreate = {
      slug: slug.trim() || nome.trim().toLowerCase().replace(/\s+/g, '_'),
      nome: nome.trim(),
      template,
      usa_itens: tplDef.usa_itens,
    }
    if (icone) body.icone = icone
    if (cor) body.cor = cor
    create.mutate(body, {
      onSuccess: () => onDone(),
      onError: (err) => setError((err as Error).message),
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="hq-glass hq-chamfer-bl"
      style={{
        marginTop: 12,
        borderLeft: '2px solid var(--color-warning)',
        padding: '12px 14px',
      }}
    >
      <div
        className="hq-tech-label"
        style={{
          fontSize: 10,
          color: 'var(--color-warning)',
          letterSpacing: '0.24em',
          marginBottom: 8,
        }}
      >
        NOVO DOMÍNIO
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10,
        }}
      >
        <Field label="NOME *">
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="ex: Hidratação"
            style={inputStyle()}
            required
            autoFocus
          />
        </Field>

        <Field label="SLUG (OPC)">
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="auto: nome em snake_case"
            pattern="^[a-z0-9_-]+$"
            style={inputStyle()}
          />
          <Hint>só a-z, 0-9, _ e -</Hint>
        </Field>

        <Field label="TEMPLATE *" style={{ gridColumn: 'span 2' }}>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as HealthTemplate)}
            style={inputStyle()}
            required
          >
            {TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <Hint>define os campos do registro</Hint>
        </Field>

        <Field label="ÍCONE LUCIDE (OPC)">
          <input
            type="text"
            value={icone}
            onChange={(e) => setIcone(e.target.value)}
            placeholder="ex: droplet, smile"
            style={inputStyle()}
          />
        </Field>

        <Field label="COR (OPC)">
          <input
            type="color"
            value={cor || '#8a939c'}
            onChange={(e) => setCor(e.target.value)}
            style={{
              width: '100%',
              height: 30,
              padding: 0,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-primary)',
              cursor: 'pointer',
            }}
          />
        </Field>
      </div>

      {error && (
        <div
          style={{
            background: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger-border)',
            color: 'var(--color-error)',
            padding: '6px 10px',
            fontSize: 11,
            marginTop: 8,
            fontFamily: BODY,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} className="hq-btn hq-btn--ghost">
          CANCELAR
        </button>
        <button
          type="submit"
          disabled={create.isPending || !nome.trim()}
          className="hq-btn hq-btn--primary"
        >
          {create.isPending ? 'CRIANDO…' : 'CRIAR'}
        </button>
      </div>
    </form>
  )
}

// ─── Helpers visuais ──────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="hq-tech-label"
      style={{
        fontSize: 10,
        color: 'var(--color-ice-light)',
        letterSpacing: '0.28em',
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  )
}

function Field({
  label,
  children,
  style,
}: {
  label: string
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div style={{ ...style }}>
      <div
        className="hq-tech-label"
        style={{
          fontSize: 9,
          color: 'var(--color-text-muted)',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        color: 'var(--color-text-muted)',
        marginTop: 3,
        fontStyle: 'italic',
        fontFamily: BODY,
      }}
    >
      {children}
    </div>
  )
}

function inputStyle(): React.CSSProperties {
  return {
    background: 'var(--color-bg-primary)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-primary)',
    padding: '6px 10px',
    fontFamily: MONO,
    fontSize: 12,
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
  }
}
