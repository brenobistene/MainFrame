/**
 * Lang Lab · ACERVO — o browser da coleção ("construir minha linguagem"
 * = acumular E curar). Busca, filtros, ouvir, editar inline, suspender,
 * excluir. Sem isso a coleção seria write-only (crítica do PLAN v0.1).
 */
import { useEffect, useMemo, useState } from 'react'
import { Pause, Pencil, Play, Trash2, Volume2 } from 'lucide-react'

import {
  BASE,
  deleteLangCard,
  fetchLangCards,
  reportApiError,
  updateLangCard,
} from '../../api'
import { TechLabel } from '../../components/ui/CyberShell'
import { confirmDialog } from '../../lib/dialog'
import type { LangCard } from '../../types'

type Filtro = 'todos' | 'novos' | 'aprendendo' | 'maduros' | 'producao' | 'suspensos'

const FILTROS: { key: Filtro; label: string }[] = [
  { key: 'todos', label: 'TODOS' },
  { key: 'novos', label: 'NOVOS' },
  { key: 'aprendendo', label: 'APRENDENDO' },
  { key: 'maduros', label: 'REVIEW' },
  { key: 'producao', label: 'PRODUÇÃO' },
  { key: 'suspensos', label: 'SUSPENSOS' },
]

export function LangAcervoPage() {
  const [cards, setCards] = useState<LangCard[]>([])
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editFrente, setEditFrente] = useState('')
  const [editVerso, setEditVerso] = useState('')

  function reload() {
    fetchLangCards({ limit: 500 })
      .then(setCards)
      .catch(err => reportApiError('Acervo.load', err))
  }
  useEffect(reload, [])

  const visiveis = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return cards.filter(c => {
      if (ql && !(`${c.frente} ${c.verso ?? ''} ${c.notas ?? ''}`.toLowerCase().includes(ql))) return false
      switch (filtro) {
        case 'novos': return !c.suspenso && c.last_review === null
        case 'aprendendo': return !c.suspenso && c.last_review !== null && c.state !== 'review'
        case 'maduros': return !c.suspenso && c.state === 'review'
        case 'producao': return !c.suspenso && c.direction === 'production'
        case 'suspensos': return c.suspenso
        default: return true
      }
    })
  }, [cards, q, filtro])

  function ouvir(c: LangCard) {
    if (c.audio_url) {
      new Audio(`${BASE}${c.audio_url}`).play().catch(() => {
        try {
          const u = new SpeechSynthesisUtterance(c.frente)
          u.lang = 'en'
          window.speechSynthesis.speak(u)
        } catch { /* sem som */ }
      })
    } else {
      try {
        const u = new SpeechSynthesisUtterance(c.frente)
        u.lang = 'en'
        window.speechSynthesis.speak(u)
      } catch { /* sem som */ }
    }
  }

  async function toggleSuspenso(c: LangCard) {
    const updated = await updateLangCard(c.id, { suspenso: !c.suspenso })
      .catch(err => { reportApiError('Acervo.suspender', err); return null })
    if (updated) setCards(cs => cs.map(x => (x.id === c.id ? updated : x)))
  }

  async function salvarEdicao(c: LangCard) {
    const updated = await updateLangCard(c.id, {
      frente: editFrente.trim() || c.frente,
      verso: editVerso.trim() || null,
    }).catch(err => { reportApiError('Acervo.editar', err); return null })
    if (updated) {
      setCards(cs => cs.map(x => (x.id === c.id ? updated : x)))
      setEditingId(null)
    }
  }

  async function excluir(c: LangCard) {
    const ok = await confirmDialog({
      title: 'Excluir card',
      message: `"${c.frente}"\nO histórico de reviews dele também some.`,
      confirmLabel: 'EXCLUIR',
      variant: 'danger',
    })
    if (!ok) return
    // Remove da UI só APÓS o servidor confirmar — DELETE falho sumia o
    // card da tela mas ele continuava no banco (QA 2026-06-12).
    try {
      await deleteLangCard(c.id)
      setCards(cs => cs.filter(x => x.id !== c.id))
    } catch (err) {
      reportApiError('Acervo.excluir', err)
    }
  }

  return (
    <div style={{ maxWidth: 920 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="buscar no acervo…"
          style={{
            flex: '1 1 240px', background: 'rgba(8, 12, 18, 0.55)',
            border: '1px solid var(--color-border)', color: 'var(--color-ice-light)',
            fontFamily: 'var(--font-mono)', fontSize: 12, padding: '8px 12px',
            outline: 'none', borderRadius: 0,
          }}
        />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {FILTROS.map(f => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFiltro(f.key)}
              style={{
                background: filtro === f.key ? 'rgba(143, 191, 211, 0.12)' : 'rgba(8, 12, 18, 0.55)',
                border: `1px solid ${filtro === f.key ? 'rgba(143, 191, 211, 0.5)' : 'var(--color-border)'}`,
                color: filtro === f.key ? 'var(--color-ice-light)' : 'var(--color-text-muted)',
                fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.14em', padding: '5px 9px', cursor: 'pointer', borderRadius: 0,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)',
          letterSpacing: '0.12em', marginLeft: 'auto',
        }}>
          {visiveis.length}/{cards.length}
        </span>
      </div>

      {visiveis.length === 0 && <TechLabel>NADA AQUI COM ESSES FILTROS</TechLabel>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visiveis.map(c => (
          <div key={c.id} style={{
            border: '1px solid rgba(143, 191, 211, 0.14)',
            background: 'rgba(8, 12, 18, 0.45)',
            padding: '10px 14px',
            opacity: c.suspenso ? 0.45 : 1,
          }}>
            {editingId === c.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  value={editFrente}
                  onChange={e => setEditFrente(e.target.value)}
                  autoFocus
                  style={{
                    background: 'rgba(8, 12, 18, 0.7)', border: '1px solid var(--color-ice)',
                    color: 'var(--color-text-primary)', fontSize: 13, padding: '7px 10px',
                    fontFamily: 'inherit', outline: 'none', borderRadius: 0,
                  }}
                />
                <input
                  value={editVerso}
                  onChange={e => setEditVerso(e.target.value)}
                  placeholder="tradução / nota"
                  style={{
                    background: 'rgba(8, 12, 18, 0.7)', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-secondary)', fontSize: 12, padding: '6px 10px',
                    fontFamily: 'inherit', outline: 'none', borderRadius: 0,
                  }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="hq-btn hq-btn--primary" onClick={() => salvarEdicao(c)} style={{ padding: '5px 12px' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em' }}>SALVAR</span>
                  </button>
                  <button type="button" className="hq-btn hq-btn--ghost" onClick={() => setEditingId(null)} style={{ padding: '5px 12px' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em' }}>CANCELAR</span>
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 8.5, fontWeight: 700,
                  letterSpacing: '0.16em', textTransform: 'uppercase', flexShrink: 0,
                  color: c.suspenso ? 'var(--color-text-muted)'
                    : c.direction === 'production' ? 'var(--color-warning)'
                    : c.last_review ? 'var(--color-ice)' : 'var(--color-text-muted)',
                  width: 52,
                }}>
                  {c.suspenso ? 'SUSP' : c.direction === 'production' ? 'PROD' : c.last_review ? c.state.slice(0, 5) : 'NOVO'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13.5, color: 'var(--color-text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {c.frente}
                  </div>
                  {c.verso && (
                    <div style={{
                      fontSize: 11, color: 'var(--color-text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {c.verso}
                    </div>
                  )}
                </div>
                <button type="button" className="hq-icon-btn" onClick={() => ouvir(c)} title="ouvir" aria-label="ouvir">
                  <Volume2 size={13} strokeWidth={1.8} />
                </button>
                <button
                  type="button" className="hq-icon-btn"
                  onClick={() => { setEditingId(c.id); setEditFrente(c.frente); setEditVerso(c.verso ?? '') }}
                  title="editar" aria-label="editar"
                >
                  <Pencil size={13} strokeWidth={1.8} />
                </button>
                <button
                  type="button" className="hq-icon-btn"
                  onClick={() => toggleSuspenso(c)}
                  title={c.suspenso ? 'retomar (volta pra fila)' : 'suspender (sai da fila sem apagar)'}
                  aria-label={c.suspenso ? 'retomar' : 'suspender'}
                >
                  {c.suspenso ? <Play size={13} strokeWidth={1.8} /> : <Pause size={13} strokeWidth={1.8} />}
                </button>
                <button type="button" className="hq-icon-btn hq-icon-btn--danger" onClick={() => excluir(c)} title="excluir" aria-label="excluir">
                  <Trash2 size={13} strokeWidth={1.8} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
