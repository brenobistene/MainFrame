/**
 * Command Palette global — abre com Ctrl+K (ou Cmd+K no Mac).
 *
 * Indexa quests, projetos, áreas, tarefas, rotinas e dívidas do estado
 * global, faz fuzzy match no nome e permite navegar pra entidade clicando.
 * Não substitui filtros das páginas — é um atalho de "achar X rápido".
 *
 * Single file dependency-light: sem fuse.js, só substring + case fold.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import {
  Search, Target, Folder, Layers, CheckSquare, Repeat,
  Wallet, Calendar as CalendarIcon, FileText, X,
} from 'lucide-react'
import type {
  Area, Project, Quest, Task, Routine, FinDebt,
} from '../types'

interface CommandItem {
  id: string
  type: 'quest' | 'project' | 'area' | 'task' | 'routine' | 'debt' | 'page'
  title: string
  subtitle?: string
  /** Route to navigate to. Optional side-effect on click. */
  navigate: () => void
}

export function CommandPalette({
  open, onClose,
  areas, projects, quests, tasks, routines, debts,
  onSelectProject,
}: {
  open: boolean
  onClose: () => void
  areas: Area[]
  projects: Project[]
  quests: Quest[]
  tasks: Task[]
  routines: Routine[]
  debts: FinDebt[]
  onSelectProject?: (id: string) => void
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset query/active quando abre
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      // Focar input no próximo tick (depois do portal montar)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  // Index: fixed pages + entidades
  const allItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      { id: 'page:dashboard', type: 'page', title: 'Dashboard', subtitle: 'Visão geral', navigate: () => navigate('/dashboard') },
      { id: 'page:dia', type: 'page', title: 'Dia', subtitle: 'Foco de hoje', navigate: () => navigate('/dia') },
      { id: 'page:calendario', type: 'page', title: 'Calendário', subtitle: 'Semana e mês', navigate: () => navigate('/calendario') },
      { id: 'page:areas', type: 'page', title: 'Áreas', subtitle: 'Mapa de vida', navigate: () => navigate('/areas') },
      { id: 'page:tarefas', type: 'page', title: 'Tarefas', subtitle: 'Caixa de tarefas', navigate: () => navigate('/tarefas') },
      { id: 'page:rotinas', type: 'page', title: 'Rotinas', subtitle: 'Hábitos', navigate: () => navigate('/rotinas') },
      { id: 'page:micro-dump', type: 'page', title: 'Dump', subtitle: 'Captura rápida', navigate: () => navigate('/micro-dump') },
      { id: 'page:hub-finance', type: 'page', title: 'Hub Finance', subtitle: 'Finanças', navigate: () => navigate('/hub-finance') },
      { id: 'page:health', type: 'page', title: 'Hub Health', subtitle: 'Saúde', navigate: () => navigate('/health') },
      { id: 'page:build', type: 'page', title: '/Build', subtitle: 'Estratégia', navigate: () => navigate('/build') },
    ]
    for (const a of areas) {
      items.push({
        id: `area:${a.slug}`,
        type: 'area',
        title: a.name,
        subtitle: 'Área',
        navigate: () => navigate(`/areas/${a.slug}`),
      })
    }
    for (const p of projects) {
      const area = areas.find(a => a.slug === p.area_slug)
      items.push({
        id: `proj:${p.id}`,
        type: 'project',
        title: p.title,
        subtitle: area?.name ?? 'Projeto',
        navigate: () => {
          onSelectProject?.(p.id)
          navigate(`/areas/${p.area_slug}`)
        },
      })
    }
    for (const q of quests) {
      items.push({
        id: `quest:${q.id}`,
        type: 'quest',
        title: q.title,
        subtitle: q.area_slug ?? 'Quest',
        navigate: () => navigate(`/areas/${q.area_slug}`),
      })
    }
    for (const t of tasks.filter(t => !t.done)) {
      items.push({
        id: `task:${t.id}`,
        type: 'task',
        title: t.title,
        subtitle: 'Tarefa',
        navigate: () => navigate('/tarefas'),
      })
    }
    for (const r of routines) {
      items.push({
        id: `routine:${r.id}`,
        type: 'routine',
        title: r.title,
        subtitle: 'Rotina',
        navigate: () => navigate('/rotinas'),
      })
    }
    for (const d of debts.filter(d => d.status === 'active')) {
      items.push({
        id: `debt:${d.id}`,
        type: 'debt',
        title: d.descricao,
        subtitle: 'Dívida',
        navigate: () => navigate('/hub-finance/dividas'),
      })
    }
    return items
  }, [areas, projects, quests, tasks, routines, debts, navigate, onSelectProject])

  // Filter por query: case-insensitive substring no title e subtitle
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allItems.slice(0, 50)  // limit empty state
    return allItems.filter(it =>
      it.title.toLowerCase().includes(q)
      || it.subtitle?.toLowerCase().includes(q)
    ).slice(0, 50)
  }, [allItems, query])

  // Reset cursor quando filtered muda
  useEffect(() => { setActiveIdx(0) }, [query])

  // Keyboard nav: ↑/↓/Enter/Esc
  useEffect(() => {
    if (!open) return
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        const item = filtered[activeIdx]
        if (item) {
          item.navigate()
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [open, filtered, activeIdx, onClose])

  // Scroll do item ativo pra área visível
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const active = list.children[activeIdx] as HTMLElement | undefined
    if (active) active.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  if (!open) return null

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
        animation: 'hq-fade-up 180ms var(--ease-emphasis) both',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(640px, 92vw)',
          maxHeight: '70vh',
          display: 'flex', flexDirection: 'column',
          background: 'rgba(8, 12, 18, 0.95)',
          border: '1px solid rgba(143, 191, 211, 0.45)',
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)',
          boxShadow: '0 0 30px rgba(143, 191, 211, 0.20), 0 12px 40px rgba(0, 0, 0, 0.8)',
        }}
      >
        {/* Input header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px',
          borderBottom: '1px solid var(--color-ice-deep)',
        }}>
          <Search size={16} strokeWidth={2} style={{ color: 'var(--color-ice)' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar quests, projetos, tarefas, rotinas, dívidas, páginas…"
            style={{
              flex: 1,
              background: 'none', border: 'none', outline: 'none',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
            }}
          />
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-muted)', padding: 4,
              display: 'inline-flex',
            }}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {/* List */}
        <div
          ref={listRef}
          style={{
            flex: 1, overflowY: 'auto',
            padding: 6,
          }}
        >
          {filtered.length === 0 ? (
            <div style={{
              padding: '24px 16px', textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 11, fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.18em', textTransform: 'uppercase',
            }}>
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              NENHUM RESULTADO
            </div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { item.navigate(); onClose() }}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  width: '100%',
                  padding: '8px 12px',
                  background: i === activeIdx
                    ? 'rgba(143, 191, 211, 0.14)'
                    : 'transparent',
                  border: 'none',
                  borderLeft: i === activeIdx
                    ? '2px solid var(--color-ice)'
                    : '2px solid transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.1s',
                }}
              >
                <span style={{ color: 'var(--color-ice-light)', display: 'inline-flex', flexShrink: 0 }}>
                  {iconFor(item.type)}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 13,
                    color: 'var(--color-text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {item.title}
                  </div>
                  {item.subtitle && (
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9, fontWeight: 700,
                      color: 'var(--color-text-muted)',
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                      marginTop: 1,
                    }}>
                      {item.subtitle}
                    </div>
                  )}
                </div>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.18em', textTransform: 'uppercase',
                  opacity: 0.5,
                }}>
                  {item.type}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--color-ice-deep)',
          fontFamily: 'var(--font-mono)',
          fontSize: 9, fontWeight: 700,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.18em', textTransform: 'uppercase',
          display: 'flex', gap: 16,
        }}>
          <span><kbd style={kbdStyle}>↑↓</kbd> navegar</span>
          <span><kbd style={kbdStyle}>↵</kbd> abrir</span>
          <span><kbd style={kbdStyle}>esc</kbd> fechar</span>
          <span style={{ marginLeft: 'auto' }}>{filtered.length} resultado{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const kbdStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9, fontWeight: 700,
  padding: '1px 5px',
  background: 'rgba(143, 191, 211, 0.10)',
  border: '1px solid rgba(143, 191, 211, 0.30)',
  color: 'var(--color-ice-light)',
  marginRight: 4,
}

function iconFor(type: CommandItem['type']) {
  switch (type) {
    case 'page': return <FileText size={13} strokeWidth={1.8} />
    case 'area': return <Layers size={13} strokeWidth={1.8} />
    case 'project': return <Folder size={13} strokeWidth={1.8} />
    case 'quest': return <Target size={13} strokeWidth={1.8} />
    case 'task': return <CheckSquare size={13} strokeWidth={1.8} />
    case 'routine': return <Repeat size={13} strokeWidth={1.8} />
    case 'debt': return <Wallet size={13} strokeWidth={1.8} />
    default: return <CalendarIcon size={13} strokeWidth={1.8} />
  }
}
