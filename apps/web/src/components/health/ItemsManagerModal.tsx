/**
 * Modal de gerenciamento de itens dentro de um domínio do Hub Health.
 *
 * Aparece em domínios que usam itens (Vícios, Exercício, Alimentação,
 * Medidas Corporais). Sono não usa itens.
 *
 * Funcionalidades:
 *  - Listar itens ativos + arquivados (toggle)
 *  - Criar novo item (campos variam por template)
 *  - Editar item existente (mesmo form)
 *  - Arquivar/desarquivar (soft-delete preserva FK histórica)
 *  - Deletar hard (backend bloqueia 409 se há registros)
 *
 * Estética: vocabulário CP2077 do tronco — `hq-glass-elevated` + chamfer-cross
 * + grain + hairline ice + animação modal-in. Tipografia: Rajdhani uppercase
 * pros titles, JetBrains Mono pros valores, Chakra Petch pros textos livres.
 * Botões `hq-btn--primary` (chrome) / `hq-btn--ghost`. Border-left accent
 * dessaturada do domínio como único acento de cor.
 */
import { useState } from 'react'
import { Archive, ArchiveRestore, Pencil, Plus, Trash2, X } from 'lucide-react'

import {
  useArchiveHealthItem,
  useCreateHealthItem,
  useDeleteHealthItem,
  useHealthItems,
  useUnarchiveHealthItem,
  useUpdateHealthItem,
} from '../../lib/health-queries'
import type {
  HealthDomain,
  HealthItem,
  HealthItemCreate,
  HealthItemUpdate,
  HealthTemplate,
} from '../../types'
import { BODY, DISPLAY, MONO } from './tokens'

interface Props {
  domain: HealthDomain
  cor: string                  // cor accent do domínio (calibrada em HealthPage)
  onClose: () => void
}

export default function ItemsManagerModal({ domain, cor, onClose }: Props) {
  const [showArchived, setShowArchived] = useState(false)
  const { data: items = [], isLoading } = useHealthItems(domain.slug, showArchived)
  const [editing, setEditing] = useState<HealthItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)

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
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="hq-glass-elevated hq-grain hq-animate-modal-in hq-chamfer-cross"
        style={{
          position: 'relative',
          padding: '20px 24px',
          minWidth: 560,
          maxWidth: 720,
          maxHeight: '85vh',
          overflowY: 'auto',
          color: 'var(--color-text-primary)',
          borderLeft: `2px solid ${cor}`,
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        {/* Hairline ice no topo — assinatura CP2077 modal */}
        <div
          aria-hidden="true"
          className="hq-hairline-ice"
          style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        />

        {/* Header — tech-label "ITENS" + nome do domínio em mute + close */}
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
            ITENS
          </span>
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {domain.nome.toUpperCase()}
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

        {errorBanner && (
          <div
            style={{
              background: 'var(--color-danger-bg)',
              border: '1px solid var(--color-danger-border)',
              color: 'var(--color-error)',
              padding: '8px 12px',
              fontSize: 12,
              marginBottom: 12,
              fontFamily: BODY,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{errorBanner}</span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="hq-icon-btn-bare"
              aria-label="Fechar erro"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Toolbar — toggle arquivados + botão novo */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            paddingBottom: 12,
            borderBottom: '1px dashed var(--color-divider)',
            marginBottom: 12,
          }}
        >
          <label
            className="hq-tech-id"
            style={{
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              style={{ accentColor: cor }}
            />
            MOSTRAR ARQUIVADOS
          </label>
          <button
            type="button"
            onClick={() => {
              setCreating(true)
              setEditing(null)
            }}
            className="hq-btn hq-btn--ghost"
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={12} strokeWidth={2} /> NOVO ITEM
          </button>
        </div>

        {/* Form de criar / editar */}
        {(creating || editing) && (
          <ItemForm
            domain={domain}
            cor={cor}
            initial={editing}
            onCancel={() => {
              setCreating(false)
              setEditing(null)
            }}
            onDone={() => {
              setCreating(false)
              setEditing(null)
            }}
          />
        )}

        {/* Lista de itens */}
        {isLoading ? (
          <div
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)', padding: 16 }}
          >
            // CARREGANDO…
          </div>
        ) : items.length === 0 ? (
          <div
            style={{
              color: 'var(--color-text-muted)',
              fontSize: 12,
              padding: '24px 0',
              textAlign: 'center',
              fontStyle: 'italic',
              fontFamily: BODY,
            }}
          >
            {showArchived
              ? 'Nenhum item (incluindo arquivados).'
              : `Nenhum item ativo em ${domain.nome}. Cadastre o primeiro acima.`}
          </div>
        ) : (
          <div>
            {items.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                cor={cor}
                onEdit={() => {
                  setEditing(it)
                  setCreating(false)
                }}
                onError={(msg) => setErrorBanner(msg)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Row de item na lista ─────────────────────────────────────────────────

function ItemRow({
  item,
  cor,
  onEdit,
  onError,
}: {
  item: HealthItem
  cor: string
  onEdit: () => void
  onError: (msg: string) => void
}) {
  const archive = useArchiveHealthItem()
  const unarchive = useUnarchiveHealthItem()
  const del = useDeleteHealthItem()

  const dim = item.arquivado

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderBottom: '1px solid var(--color-divider)',
        opacity: dim ? 0.5 : 1,
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontFamily: DISPLAY,
            fontWeight: 500,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--color-text-primary)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {item.nome}
          {item.arquivado && (
            <span
              className="hq-tech-id"
              style={{ color: 'var(--color-warning)' }}
            >
              ARQUIVADO
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            marginTop: 2,
            display: 'flex',
            gap: 12,
            fontFamily: MONO,
            letterSpacing: 0,
          }}
        >
          {item.unidade && <span>unidade: {item.unidade}</span>}
          {item.horario_esperado && <span>esperado: {item.horario_esperado}</span>}
          {item.descricao && (
            <span style={{ fontStyle: 'italic', fontFamily: BODY }}>
              "{item.descricao}"
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        title="Editar"
        className="hq-icon-btn"
      >
        <Pencil size={14} />
      </button>
      {item.arquivado ? (
        <button
          type="button"
          onClick={() => unarchive.mutate(item.id)}
          disabled={unarchive.isPending}
          title="Desarquivar"
          className="hq-icon-btn"
        >
          <ArchiveRestore size={14} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => archive.mutate(item.id)}
          disabled={archive.isPending}
          title="Arquivar"
          className="hq-icon-btn"
        >
          <Archive size={14} />
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          if (
            confirm(
              `Deletar "${item.nome}" definitivamente? (Falha se houver registros — use arquivar pra preservar histórico.)`,
            )
          ) {
            del.mutate(item.id, {
              onError: (err) => {
                onError(
                  `Não foi possível deletar "${item.nome}": ${(err as Error).message}\n\nUse arquivar em vez disso pra preservar os registros históricos.`,
                )
              },
            })
          }
        }}
        disabled={del.isPending}
        title="Deletar"
        className="hq-icon-btn hq-icon-btn--danger"
      >
        <Trash2 size={14} />
      </button>
      {/* Cor accent atrás dos ícones (visual subtle) */}
      <span aria-hidden="true" style={{ display: 'none', color: cor }} />
    </div>
  )
}

// ─── Form de criar / editar item ──────────────────────────────────────────

function ItemForm({
  domain,
  cor,
  initial,
  onCancel,
  onDone,
}: {
  domain: HealthDomain
  cor: string
  initial: HealthItem | null
  onCancel: () => void
  onDone: () => void
}) {
  const create = useCreateHealthItem()
  const update = useUpdateHealthItem()
  const isEdit = initial !== null

  const [nome, setNome] = useState(initial?.nome ?? '')
  const [unidade, setUnidade] = useState(initial?.unidade ?? '')
  const [horarioEsperado, setHorarioEsperado] = useState(
    initial?.horario_esperado ?? '',
  )
  const [descricao, setDescricao] = useState(initial?.descricao ?? '')
  const [itemCor, setItemCor] = useState(initial?.cor ?? '')

  // Campos relevantes por template
  const showUnidade =
    domain.template === 'consumo_vontade' || domain.template === 'metrica_simples'
  const showHorario = domain.template === 'refeicao_2modos'
  const showDescricao = domain.template === 'refeicao_2modos'
  const unidadeRequired = showUnidade

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (isEdit) {
      const patch: HealthItemUpdate = { nome }
      if (showUnidade) patch.unidade = unidade || null
      if (showHorario) patch.horario_esperado = horarioEsperado || null
      if (showDescricao) patch.descricao = descricao || null
      patch.cor = itemCor || null
      update.mutate(
        { id: initial!.id, patch },
        { onSuccess: onDone },
      )
    } else {
      const body: HealthItemCreate = { nome }
      if (showUnidade && unidade) body.unidade = unidade
      if (showHorario && horarioEsperado) body.horario_esperado = horarioEsperado
      if (showDescricao && descricao) body.descricao = descricao
      if (itemCor) body.cor = itemCor
      create.mutate(
        { domainSlug: domain.slug, body },
        { onSuccess: onDone },
      )
    }
  }

  const error = create.error || update.error
  const pending = create.isPending || update.isPending

  return (
    <form
      onSubmit={handleSubmit}
      className="hq-glass hq-chamfer-bl"
      style={{
        borderLeft: `2px solid ${cor}`,
        padding: '14px 16px',
        marginBottom: 16,
      }}
    >
      <div
        className="hq-tech-label"
        style={{
          fontSize: 10,
          color: 'var(--color-ice-light)',
          letterSpacing: '0.24em',
          marginBottom: 10,
        }}
      >
        {isEdit ? 'EDITAR ITEM' : 'NOVO ITEM'}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Field label="NOME" style={{ flex: 1, minWidth: 200 }}>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={placeholderForDomain(domain.template)}
            style={inputStyle()}
            required
            autoFocus
          />
        </Field>
        {showUnidade && (
          <Field label={`UNIDADE${unidadeRequired ? ' *' : ''}`} style={{ flex: 1, minWidth: 140 }}>
            <input
              type="text"
              value={unidade}
              onChange={(e) => setUnidade(e.target.value)}
              placeholder={domain.template === 'consumo_vontade' ? 'ex: cigarros' : 'ex: kg'}
              style={inputStyle()}
              required={unidadeRequired}
            />
          </Field>
        )}
        {showHorario && (
          <Field label="HORÁRIO ESPERADO" style={{ width: 140 }}>
            <input
              type="time"
              value={horarioEsperado}
              onChange={(e) => setHorarioEsperado(e.target.value)}
              style={inputStyle()}
            />
          </Field>
        )}
        <Field label="COR (OPC)" style={{ width: 100 }}>
          <input
            type="color"
            value={itemCor || '#000000'}
            onChange={(e) => setItemCor(e.target.value)}
            style={{
              width: '100%',
              height: 30,
              padding: 0,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-primary)',
              cursor: 'pointer',
            }}
            title="Vazio = herda cor do domínio"
          />
        </Field>
      </div>
      {itemCor && (
        <button
          type="button"
          onClick={() => setItemCor('')}
          className="hq-tech-id"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            marginTop: 4,
            padding: 0,
          }}
        >
          ↺ LIMPAR COR (HERDAR DO DOMÍNIO)
        </button>
      )}
      {showDescricao && (
        <Field label="DESCRIÇÃO (CONTEÚDO DA REFEIÇÃO)">
          <input
            type="text"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="ex: frango grelhado + arroz + brócolis"
            style={inputStyle()}
          />
        </Field>
      )}

      {error && (
        <div
          style={{
            color: 'var(--color-error)',
            fontSize: 11,
            padding: 6,
            border: '1px solid var(--color-danger-border)',
            background: 'var(--color-danger-bg)',
            marginTop: 8,
            fontFamily: BODY,
          }}
        >
          {(error as Error).message}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          className="hq-btn hq-btn--ghost"
        >
          CANCELAR
        </button>
        <button
          type="submit"
          disabled={pending || !nome.trim()}
          className="hq-btn hq-btn--primary"
        >
          {pending ? 'SALVANDO…' : isEdit ? 'SALVAR' : 'CRIAR'}
        </button>
      </div>
    </form>
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
    <div style={{ marginBottom: 8, ...(style ?? {}) }}>
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

function inputStyle(): React.CSSProperties {
  return {
    background: 'var(--color-bg-primary)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-primary)',
    padding: '6px 10px',
    fontFamily: MONO,
    fontSize: 13,
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
  }
}

function placeholderForDomain(template: HealthTemplate): string {
  switch (template) {
    case 'consumo_vontade':
      return 'ex: Cigarro, Álcool, Açúcar'
    case 'atividade_tipo':
      return 'ex: Yoga, Natação, Boxe'
    case 'refeicao_2modos':
      return 'ex: Pré-treino, Ceia'
    case 'metrica_simples':
      return 'ex: Cintura, % Gordura, Pressão'
    default:
      return ''
  }
}
