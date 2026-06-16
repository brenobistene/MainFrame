/**
 * REQUISIÇÕES — lista de compras pessoal (grupo Finance, mas NÃO toca no
 * caixa: lembrete + estimativa). Item tem cadência e reabre sozinho quando
 * o ritmo vence (estilo ritual); marcar comprado registra o valor pago
 * (opcional) que alimenta a média de preço real. Filtro por mês na seção
 * ATENDIDAS.
 *
 * UX: tabela estilo Notion — célula editável direto + linha de adição inline
 * (digita, Enter, já entra e foca a próxima) + drag-and-drop pra reordenar.
 * Sem popup. Mês no topo é o guia que dirige a página inteira.
 *
 * Design dark/tático: ice + mono + chamfer, sem border-left colorida como
 * acento, sem emoji (Lucide), sem em-dash, números mono+tabular.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Check, ChevronDown, ChevronLeft, ChevronRight, Clock,
  GripVertical, Plus, ShoppingCart, Trash2, X,
} from 'lucide-react'

import { reportApiError } from '../../api'
import { EmptyState, IconButton } from '../../components/ui/Primitives'
import { PageShell, SectionHeader, TechLabel } from '../../components/ui/CyberShell'
import {
  reqKeys,
  useComprarRequisicao,
  useCreateRequisicao,
  useDeleteRequisicao,
  useDesfazerCompra,
  useReorderRequisicao,
  useRequisicaoCategorias,
  useRequisicaoCompras,
  useRequisicaoItens,
  useUpdateRequisicao,
} from '../../lib/requisicoes-queries'
import type {
  RequisicaoCadencia,
  RequisicaoItem,
  RequisicaoItemUpdate,
} from '../../types'

// ─── Constantes / helpers ─────────────────────────────────────────────────────

const CADENCIAS: { value: RequisicaoCadencia; label: string }[] = [
  { value: 'avulso', label: 'AVULSO' },
  { value: 'quinzenal', label: 'QUINZENAL' },
  { value: 'mensal', label: 'MENSAL' },
  { value: 'bimestral', label: 'BIMESTRAL' },
  { value: 'trimestral', label: 'TRIMESTRAL' },
]
const CADENCIA_LABEL: Record<string, string> = Object.fromEntries(CADENCIAS.map(c => [c.value, c.label]))
const MESES = [
  'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
]
// [grip] [check] [item] [cadência] [categoria] [preço] [ações]
const GRID = '18px 20px minmax(0, 1fr) 124px 116px 118px 52px'

function fmtBRL(n: number): string {
  return n.toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: n % 1 === 0 ? 0 : 2,
  })
}
function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MESES[(m || 1) - 1]} ${y}`
}
function buildMonthOptions(): { value: string; label: string }[] {
  const now = new Date()
  const cur = currentMonth()
  const out: { value: string; label: string }[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ value, label: value === cur ? `${monthLabel(value)} · ATUAL` : monthLabel(value) })
  }
  return out
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function dmShort(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}
function parseValor(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}

// Célula editável: parece texto, vira input no foco (vibe Notion). O foco
// tem anel visível (box-shadow) além da borda, pra acessibilidade (WCAG).
function focusCell(e: React.FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--color-ice)'
  e.currentTarget.style.background = 'rgba(143, 191, 211, 0.08)'
  e.currentTarget.style.boxShadow = '0 0 0 1px var(--color-ice-glow)'
}
function blurCellStyle(e: React.FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'transparent'
  e.currentTarget.style.background = 'transparent'
  e.currentTarget.style.boxShadow = 'none'
}
const cellBase: React.CSSProperties = {
  background: 'transparent', border: '1px solid transparent', borderRadius: 0,
  padding: '5px 7px', outline: 'none', width: '100%', cursor: 'text',
  transition: 'border-color 0.12s, background 0.12s, box-shadow 0.12s',
}
const nomeCell: React.CSSProperties = {
  ...cellBase, color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-display)', fontSize: 13.5, fontWeight: 600,
}
const monoCell: React.CSSProperties = {
  ...cellBase, color: 'var(--color-text-secondary)',
  fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em',
}
const cadSelect: React.CSSProperties = {
  ...cellBase, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer',
  color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)',
  fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
  paddingRight: 18,
}

// ─── Cabeçalho da tabela ──────────────────────────────────────────────────────

function HeaderRow() {
  const lbl: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 8.5, fontWeight: 700,
    letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--color-text-muted)',
    padding: '0 7px',
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, alignItems: 'center', padding: '0 4px 2px' }}>
      <span /><span />
      <span style={lbl}>Item</span>
      <span style={lbl}>Cadência</span>
      <span style={lbl}>Categoria</span>
      <span style={lbl}>Preço</span>
      <span />
    </div>
  )
}

// ─── Linha de item (editável + arrastável) ────────────────────────────────────

function ItemRow({
  item, dimmed, busy, canReorder, isDragging, isOver,
  onBuy, onUpdate, onDelete,
  onGripDragStart, onRowDragOver, onRowDrop, onDragEnd,
}: {
  item: RequisicaoItem
  dimmed?: boolean
  busy?: boolean
  canReorder?: boolean
  isDragging?: boolean
  isOver?: boolean
  onBuy: (valorPago: number | null) => void
  onUpdate: (patch: RequisicaoItemUpdate) => void
  onDelete: () => void
  onGripDragStart: () => void
  onRowDragOver: (e: React.DragEvent) => void
  onRowDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const [nome, setNome] = useState(item.nome)
  const [cat, setCat] = useState(item.categoria ?? '')
  const [preco, setPreco] = useState(item.preco_estimado != null ? String(item.preco_estimado) : '')
  const [mode, setMode] = useState<'idle' | 'buying' | 'deleting'>('idle')
  const [buyValor, setBuyValor] = useState('')

  // Reseed defensivo se a linha for reusada pra outro item (a key por id ja
  // remonta; este efeito so dispara em troca de id, nunca durante a digitacao,
  // entao nao ha clobber). Cobre o footgun de prop->state.
  useEffect(() => {
    setNome(item.nome)
    setCat(item.categoria ?? '')
    setPreco(item.preco_estimado != null ? String(item.preco_estimado) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  function startBuy() {
    setBuyValor(item.preco_medio != null ? String(item.preco_medio) : '')
    setMode('buying')
  }
  function confirmBuy() {
    onBuy(parseValor(buyValor))
    setMode('idle')
  }
  const isEstimate = item.compras_count === 0

  return (
    <div
      onDragOver={canReorder ? onRowDragOver : undefined}
      onDrop={canReorder ? onRowDrop : undefined}
      style={{
        display: 'grid', gridTemplateColumns: GRID, gap: 8, alignItems: 'center',
        background: 'rgba(8, 12, 18, 0.5)',
        border: '1px solid rgba(143, 191, 211, 0.16)',
        borderTop: isOver ? '2px solid var(--color-ice)' : '1px solid rgba(143, 191, 211, 0.16)',
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%)',
        padding: '5px 6px', opacity: isDragging ? 0.4 : dimmed ? 0.62 : 1,
      }}
    >
      {/* Campo pegável à esquerda — alça de arraste de altura cheia, acende
          no hover. Só onde reordenar faz sentido (lista ativa, sem filtro). */}
      {canReorder ? (
        <span
          draggable onDragStart={onGripDragStart} onDragEnd={onDragEnd}
          aria-label={`arrastar ${item.nome}`} title="arrastar pra reordenar"
          style={{
            cursor: 'grab', color: 'var(--color-text-muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            alignSelf: 'stretch', margin: '-5px 0 -5px -6px', paddingLeft: 2, width: 20,
            borderRight: '1px solid rgba(143, 191, 211, 0.1)',
            transition: 'color 0.12s, background 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-ice)'; e.currentTarget.style.background = 'rgba(143, 191, 211, 0.08)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.background = 'transparent' }}
        >
          <GripVertical size={14} strokeWidth={2} aria-hidden="true" />
        </span>
      ) : <span />}

      {/* Checkbox = comprar */}
      <button
        type="button" onClick={startBuy} disabled={busy || mode !== 'idle'}
        aria-label={`comprar ${item.nome}`} title="marcar comprado"
        style={{
          width: 20, height: 20, justifySelf: 'center', padding: 0,
          background: 'transparent', border: '1.5px solid var(--color-ice)', borderRadius: 0,
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
          cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
          boxShadow: '0 0 6px rgba(143, 191, 211, 0.18)', transition: 'box-shadow 0.15s',
        }}
        onMouseEnter={e => { if (!busy) e.currentTarget.style.boxShadow = '0 0 9px rgba(143, 191, 211, 0.5)' }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 0 6px rgba(143, 191, 211, 0.18)' }}
      />

      {mode === 'buying' ? (
        <>
          <span style={{ ...nomeCell, cursor: 'default', opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.nome}
          </span>
          <div style={{ gridColumn: '4 / -1', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-ice-light)' }}>
              PAGOU
            </span>
            <input
              autoFocus value={buyValor} onChange={e => setBuyValor(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmBuy(); if (e.key === 'Escape') setMode('idle') }}
              placeholder="R$ (opcional)" aria-label="valor pago (opcional)"
              style={{
                width: 110, background: 'rgba(8, 12, 18, 0.6)', border: '1px solid var(--color-ice)',
                color: 'var(--color-ice-light)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                fontSize: 12, padding: '5px 8px', outline: 'none', borderRadius: 0,
              }}
            />
            <IconButton label="confirmar compra" variant="accent" onClick={confirmBuy} disabled={busy}><Check size={14} strokeWidth={2.5} /></IconButton>
            <IconButton label="cancelar" variant="bare" onClick={() => setMode('idle')}><X size={14} strokeWidth={2} /></IconButton>
          </div>
        </>
      ) : (
        <>
          {/* ITEM (editável) + badges de status */}
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              value={nome} onChange={e => setNome(e.target.value)} aria-label="nome do item"
              onFocus={focusCell} onBlur={e => {
                blurCellStyle(e)
                const v = nome.trim()
                if (v && v !== item.nome) onUpdate({ nome: v })
                else if (!v) setNome(item.nome)
              }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              style={{ ...nomeCell, flex: 1, minWidth: 0 }}
            />
            {item.atrasado_dias != null && item.atrasado_dias > 0 && (
              <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--color-accent-primary)' }}>
                ATRASADO {item.atrasado_dias}D
              </span>
            )}
            {dimmed && item.proximo_em_dias != null && (
              <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'var(--font-mono)', fontSize: 8.5, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--color-text-muted)' }}>
                <Clock size={9} strokeWidth={2} aria-hidden="true" /> {item.proximo_em_dias}D
              </span>
            )}
          </div>

          {/* CADÊNCIA */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <select
              value={item.cadencia} onChange={e => onUpdate({ cadencia: e.target.value as RequisicaoCadencia })}
              onFocus={focusCell} onBlur={blurCellStyle} style={cadSelect} aria-label="cadência de recompra"
            >
              {CADENCIAS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <ChevronDown size={11} strokeWidth={2} aria-hidden="true" style={{ position: 'absolute', right: 5, pointerEvents: 'none', color: 'var(--color-text-muted)' }} />
          </div>

          {/* CATEGORIA */}
          <input
            value={cat} onChange={e => setCat(e.target.value)} list="req-cats" placeholder="" aria-label="categoria"
            onFocus={focusCell} onBlur={e => {
              blurCellStyle(e)
              const v = cat.trim() || null
              if (v !== (item.categoria ?? null)) onUpdate({ categoria: v })
            }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={monoCell}
          />

          {/* PREÇO (estimativa editável; média real vira placeholder fantasma) */}
          <input
            value={preco} onChange={e => setPreco(e.target.value)} aria-label="preço estimado"
            placeholder={!isEstimate && item.preco_medio != null ? `méd ${fmtBRL(item.preco_medio)}` : 'R$'}
            onFocus={focusCell} onBlur={e => {
              blurCellStyle(e)
              const v = parseValor(preco)
              if (v !== (item.preco_estimado ?? null)) onUpdate({ preco_estimado: v })
            }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{ ...monoCell, fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--color-text-primary)' }}
          />

          {/* AÇÕES */}
          <div style={{ justifySelf: 'end' }}>
            {mode === 'deleting' ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <IconButton label="confirmar exclusão permanente" variant="danger" onClick={onDelete} disabled={busy}><Check size={13} strokeWidth={2.5} /></IconButton>
                <IconButton label="cancelar" variant="bare" onClick={() => setMode('idle')}><X size={13} strokeWidth={2} /></IconButton>
              </div>
            ) : (
              <IconButton label={`excluir ${item.nome} e seu histórico (permanente)`} variant="bare" onClick={() => setMode('deleting')}>
                <Trash2 size={13} strokeWidth={1.8} />
              </IconButton>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Linha de adição inline (digita, Enter, próxima) ──────────────────────────

function AddRow({ onAdd }: { onAdd: (b: { nome: string; cadencia: RequisicaoCadencia; categoria: string | null; preco_estimado: number | null }) => Promise<void> }) {
  const [nome, setNome] = useState('')
  const [cad, setCad] = useState<RequisicaoCadencia>('mensal')
  const [cat, setCat] = useState('')
  const [preco, setPreco] = useState('')
  const [saving, setSaving] = useState(false)
  const nomeRef = useRef<HTMLInputElement>(null)

  async function commit() {
    const n = nome.trim()
    if (!n || saving) return
    setSaving(true)
    try {
      await onAdd({ nome: n, cadencia: cad, categoria: cat.trim() || null, preco_estimado: parseValor(preco) })
      setNome(''); setCat(''); setPreco('')
      nomeRef.current?.focus()
    } catch (e) {
      reportApiError('Requisicoes.add', e)
    } finally {
      setSaving(false)
    }
  }
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') commit() }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: GRID, gap: 8, alignItems: 'center',
      background: 'rgba(143, 191, 211, 0.04)', border: '1px dashed rgba(143, 191, 211, 0.3)',
      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%)',
      padding: '5px 6px',
    }}>
      <span />
      <Plus size={14} strokeWidth={2.5} aria-hidden="true" style={{ justifySelf: 'center', color: 'var(--color-ice)' }} />
      <input
        ref={nomeRef} value={nome} onChange={e => setNome(e.target.value)} onKeyDown={onEnter}
        placeholder="novo item, Enter pra adicionar…" aria-label="novo item"
        onFocus={focusCell} onBlur={blurCellStyle} style={{ ...nomeCell, fontWeight: 500 }}
      />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <select value={cad} onChange={e => setCad(e.target.value as RequisicaoCadencia)} onFocus={focusCell} onBlur={blurCellStyle} style={cadSelect} aria-label="cadência do novo item">
          {CADENCIAS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <ChevronDown size={11} strokeWidth={2} aria-hidden="true" style={{ position: 'absolute', right: 5, pointerEvents: 'none', color: 'var(--color-text-muted)' }} />
      </div>
      <input value={cat} onChange={e => setCat(e.target.value)} onKeyDown={onEnter} list="req-cats" placeholder="categoria" aria-label="categoria do novo item" onFocus={focusCell} onBlur={blurCellStyle} style={monoCell} />
      <input value={preco} onChange={e => setPreco(e.target.value)} onKeyDown={onEnter} placeholder="R$" aria-label="preço estimado do novo item" onFocus={focusCell} onBlur={blurCellStyle} style={{ ...monoCell, fontVariantNumeric: 'tabular-nums' }} />
      <div style={{ justifySelf: 'end' }}>
        <IconButton label="adicionar item" variant="accent" onClick={commit} disabled={!nome.trim() || saving}>
          <Plus size={14} strokeWidth={2.5} />
        </IconButton>
      </div>
    </div>
  )
}

// ─── Linha de compra (ATENDIDAS) ──────────────────────────────────────────────

function PurchaseRow({ nome, cadencia, boughtAt, valor, onUndo, busy }: {
  nome: string; cadencia: string; boughtAt: string; valor: number | null; onUndo: () => void; busy?: boolean
}) {
  return (
    <div style={{
      background: 'rgba(8, 12, 18, 0.4)', border: '1px solid var(--color-border)', borderRadius: 0,
      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <Check size={15} strokeWidth={2.5} color="var(--color-success)" style={{ flexShrink: 0 }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {nome}
        </div>
        <div style={{ marginTop: 3, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{dmShort(boughtAt)}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>{CADENCIA_LABEL[cadencia] ?? cadencia}</span>
        </div>
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em', color: valor != null ? 'var(--color-text-primary)' : 'var(--color-text-muted)', flexShrink: 0 }}>
        {valor != null ? fmtBRL(valor) : 'sem valor'}
      </span>
      <IconButton label="desfazer compra" variant="bare" onClick={onUndo} disabled={busy}><X size={13} strokeWidth={2} /></IconButton>
    </div>
  )
}

// ─── Navegador de mês (guia principal, no topo) ───────────────────────────────

function MonthNav({ mes, setMes, options }: {
  mes: string; setMes: (m: string) => void; options: { value: string; label: string }[]
}) {
  const atOrFuture = mes >= currentMonth()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <IconButton label="mês anterior" variant="bare" onClick={() => setMes(shiftMonth(mes, -1))}>
        <ChevronLeft size={16} strokeWidth={2} />
      </IconButton>
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
        <select
          value={mes} onChange={e => setMes(e.target.value)} aria-label="mês"
          style={{
            appearance: 'none', WebkitAppearance: 'none', background: 'rgba(8, 12, 18, 0.7)',
            border: '1px solid rgba(143, 191, 211, 0.4)', color: 'var(--color-ice-light)',
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            padding: '7px 30px 7px 14px', cursor: 'pointer', borderRadius: 0,
            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
          }}
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={13} strokeWidth={2} aria-hidden="true" style={{ position: 'absolute', right: 10, pointerEvents: 'none', color: 'var(--color-ice)' }} />
      </div>
      <IconButton label="próximo mês" variant="bare" onClick={() => setMes(shiftMonth(mes, 1))} disabled={atOrFuture}>
        <ChevronRight size={16} strokeWidth={2} />
      </IconButton>
    </div>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────────

export function RequisicoesPage() {
  const qc = useQueryClient()
  const [mes, setMes] = useState(currentMonth())
  const [catFiltro, setCatFiltro] = useState<string | null>(null)
  const [emDiaOpen, setEmDiaOpen] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)

  const { data: itens = [], isLoading } = useRequisicaoItens()
  const { data: compras = [] } = useRequisicaoCompras(mes)
  const { data: categorias = [] } = useRequisicaoCategorias()

  const createMut = useCreateRequisicao()
  const updateMut = useUpdateRequisicao()
  const deleteMut = useDeleteRequisicao()
  const comprarMut = useComprarRequisicao()
  const desfazerMut = useDesfazerCompra()
  const reorderMut = useReorderRequisicao()

  const filtrados = useMemo(
    () => (catFiltro ? itens.filter(i => i.categoria === catFiltro) : itens),
    [itens, catFiltro],
  )
  const abertas = filtrados.filter(i => i.aberta)
  const emDia = filtrados.filter(i => !i.aberta)
  const idaEstimada = abertas.reduce((s, i) => s + (i.preco_medio ?? 0), 0)
  const gastoMes = compras.reduce((s, c) => s + (c.valor_pago ?? 0), 0)
  const monthOptions = useMemo(buildMonthOptions, [])
  const isCurrentMonth = mes === currentMonth()
  // Reordenar só faz sentido na lista ativa, sem filtro (a renumeração cobre
  // a lista inteira; com filtro a reconstrução seria ambígua).
  const canReorder = isCurrentMonth && !catFiltro
  const rowBusy = comprarMut.isPending || updateMut.isPending || deleteMut.isPending

  async function buy(item: RequisicaoItem, valorPago: number | null) {
    try { await comprarMut.mutateAsync({ id: item.id, body: { valor_pago: valorPago } }) }
    catch (e) { reportApiError('Requisicoes.comprar', e) }
  }
  function patch(id: number, p: RequisicaoItemUpdate) {
    updateMut.mutate({ id, patch: p }, { onError: e => reportApiError('Requisicoes.update', e) })
  }
  function handleDrop(dropId: number) {
    const from = abertas.findIndex(i => i.id === dragId)
    const to = abertas.findIndex(i => i.id === dropId)
    setDragId(null); setOverId(null)
    if (from < 0 || to < 0 || from === to) return
    const novaAbertas = [...abertas]
    const [moved] = novaAbertas.splice(from, 1)
    novaAbertas.splice(to, 0, moved)
    // Lista completa renumerada (abertas reordenadas + emDia) — ordem global.
    const full = [...novaAbertas, ...emDia].map((it, idx) => ({ ...it, ordem: idx }))
    qc.setQueryData<RequisicaoItem[]>(reqKeys.itens(), full)  // otimista
    reorderMut.mutate(full.map((it, idx) => ({ id: it.id, ordem: idx })))
  }

  const atendidasSection = (
    <section>
      <SectionHeader
        label="ATENDIDAS"
        count={compras.length}
        rightSlot={gastoMes > 0 ? (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.06em', color: 'var(--color-text-secondary)' }}>
            GASTO {fmtBRL(gastoMes)}
          </span>
        ) : undefined}
      />
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {compras.length === 0 ? (
          <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '8px 2px' }}>
            Nada comprado em {monthLabel(mes).toLowerCase()}.
          </p>
        ) : (
          compras.map(c => (
            <PurchaseRow
              key={c.id} nome={c.nome} cadencia={c.cadencia} boughtAt={c.bought_at} valor={c.valor_pago}
              busy={desfazerMut.isPending}
              onUndo={async () => { try { await desfazerMut.mutateAsync(c.id) } catch (e) { reportApiError('Requisicoes.desfazer', e) } }}
            />
          ))
        )}
      </div>
    </section>
  )

  return (
    <PageShell
      headerLabel="REQUISIÇÕES"
      headerRightControls={<MonthNav mes={mes} setMes={setMes} options={monthOptions} />}
      footerCaption="Lembrete e estimativa. Não entra no seu fluxo de caixa."
    >
      <datalist id="req-cats">{categorias.map(c => <option key={c} value={c} />)}</datalist>

      {/* Chips de categoria (só no mês atual, onde a lista é editável) */}
      {isCurrentMonth && categorias.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          {[null, ...categorias].map(c => {
            const active = catFiltro === c
            return (
              <button
                key={c ?? '__all'} type="button" onClick={() => setCatFiltro(c)} aria-pressed={active}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase',
                  color: active ? 'var(--color-ice-light)' : 'var(--color-text-tertiary)',
                  background: active ? 'rgba(143, 191, 211, 0.12)' : 'rgba(8, 12, 18, 0.55)',
                  border: `1px solid ${active ? 'rgba(143, 191, 211, 0.45)' : 'var(--color-border)'}`,
                  padding: '5px 11px', cursor: 'pointer', borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                }}
              >
                {c ?? 'TUDO'}
              </button>
            )
          })}
        </div>
      )}

      {isLoading ? (
        <TechLabel>CARREGANDO…</TechLabel>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {/* Mês passado: visão histórica (abertas é sempre o agora) */}
          {!isCurrentMonth && (
            <div style={{
              background: 'rgba(143, 191, 211, 0.05)', border: '1px solid var(--color-border)',
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
              padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.02em', color: 'var(--color-text-secondary)' }}>
                Vendo o histórico de {monthLabel(mes).toLowerCase()}. As requisições abertas valem o mês atual.
              </span>
              <button
                type="button" onClick={() => setMes(currentMonth())}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.16em',
                  textTransform: 'uppercase', color: 'var(--color-ice-light)',
                  background: 'rgba(143, 191, 211, 0.1)', border: '1px solid rgba(143, 191, 211, 0.45)',
                  padding: '5px 11px', cursor: 'pointer', borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                }}
              >
                ir pro mês atual
              </button>
            </div>
          )}

          {/* ABERTAS — tabela editável + adição inline + drag (só mês atual) */}
          {isCurrentMonth && (
            <section>
              <SectionHeader
                label="ABERTAS · A REQUISITAR"
                count={abertas.length}
                rightSlot={idaEstimada > 0 ? (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.06em', color: 'var(--color-ice-light)' }}>
                    IDA ~ {fmtBRL(idaEstimada)}
                  </span>
                ) : undefined}
              />
              <div style={{ marginTop: 12, overflowX: 'auto' }}>
                <div style={{ minWidth: 600, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {itens.length > 0 && <HeaderRow />}
                  {abertas.map(i => (
                    <ItemRow
                      key={i.id} item={i} busy={rowBusy}
                      canReorder={canReorder}
                      isDragging={dragId === i.id}
                      isOver={overId === i.id && dragId !== null && dragId !== i.id}
                      onGripDragStart={() => setDragId(i.id)}
                      onRowDragOver={e => { if (dragId !== null && dragId !== i.id) { e.preventDefault(); setOverId(i.id) } }}
                      onRowDrop={e => { e.preventDefault(); handleDrop(i.id) }}
                      onDragEnd={() => { setDragId(null); setOverId(null) }}
                      onBuy={v => buy(i, v)} onUpdate={p => patch(i.id, p)}
                      onDelete={() => deleteMut.mutate(i.id, { onError: e => reportApiError('Requisicoes.del', e) })}
                    />
                  ))}
                  <AddRow onAdd={async b => { await createMut.mutateAsync(b) }} />
                  {itens.length === 0 && (
                    <div style={{ marginTop: 8 }}>
                      <EmptyState
                        icon={<ShoppingCart size={20} strokeWidth={1.5} />}
                        text="Sua lista começa aqui"
                        sub="Digite na linha acima e aperte Enter. Cotonete, creme, desodorante: o que sempre acaba."
                        dense
                      />
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* EM DIA — recorrentes satisfeitos (colapsável, só mês atual) */}
          {isCurrentMonth && emDia.length > 0 && (
            <section>
              <SectionHeader label="EM DIA" count={emDia.length} collapsed={!emDiaOpen} onToggle={() => setEmDiaOpen(o => !o)} />
              {emDiaOpen && (
                <div style={{ marginTop: 12, overflowX: 'auto' }}>
                  <div style={{ minWidth: 600, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {emDia.map(i => (
                      <ItemRow
                        key={i.id} item={i} dimmed busy={rowBusy}
                        canReorder={false}
                        onGripDragStart={() => undefined} onRowDragOver={() => undefined}
                        onRowDrop={() => undefined} onDragEnd={() => undefined}
                        onBuy={v => buy(i, v)} onUpdate={p => patch(i.id, p)}
                        onDelete={() => deleteMut.mutate(i.id, { onError: e => reportApiError('Requisicoes.del', e) })}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {atendidasSection}
        </div>
      )}
    </PageShell>
  )
}
