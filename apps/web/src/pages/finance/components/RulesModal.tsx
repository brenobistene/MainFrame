import { useEffect, useMemo, useState } from 'react'
import { Pencil, Trash2, Wand2, X } from 'lucide-react'
import {
  fetchFinCategorizationRules, updateFinCategorizationRule,
  deleteFinCategorizationRule, previewBackfillRule, reportApiError,
} from '../../../api'
import type { FinRuleBackfillPreview } from '../../../api'
import type { FinCategory, FinCategorizationRule, FinAccount } from '../../../types'
import {
  sectionLabel, inputStyle, primaryButton, modalOverlay,
  modalShell, modalHairline, modalHeader, modalBody,
} from './styleHelpers'
import { BackfillConfirmModal } from './BackfillConfirmModal'
import { confirmDialog, alertDialog } from '../../../lib/dialog'

export function RulesModal({ categories, accounts, onClose }: {
  categories: FinCategory[]
  accounts: FinAccount[]
  onClose: () => void
}) {
  const [rules, setRules] = useState<FinCategorizationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftPattern, setDraftPattern] = useState('')
  const [draftCategoriaId, setDraftCategoriaId] = useState('')
  const [draftLinkCartaoId, setDraftLinkCartaoId] = useState('')

  // Cartões de crédito disponíveis pra auto-link de pagamento de fatura
  const cartoesCredito = useMemo(
    () => accounts.filter(a => a.tipo === 'credito'),
    [accounts],
  )
  const [busy, setBusy] = useState(false)
  const [backfillPrompt, setBackfillPrompt] = useState<{
    ruleId: string
    pattern: string
    categoryName: string
    preview: FinRuleBackfillPreview
  } | null>(null)

  async function handleBackfill(r: FinCategorizationRule) {
    setBusy(true)
    try {
      const preview = await previewBackfillRule(r.id)
      const cat = catById.get(r.categoria_id)
      if (preview.matches_total === 0) {
        alertDialog({ title: 'Sem matches', message: 'Nenhuma transação lançada bate com esse pattern.', variant: 'default' })
        return
      }
      setBackfillPrompt({
        ruleId: r.id,
        pattern: r.pattern,
        categoryName: cat?.nome ?? '?',
        preview,
      })
    } catch (err) {
      reportApiError('RulesModal.previewBackfill', err)
      alertDialog({ title: 'Erro', message: 'Erro ao consultar — veja o console.', variant: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const accById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])

  function refresh() {
    setLoading(true)
    fetchFinCategorizationRules()
      .then(setRules)
      .catch(err => reportApiError('RulesModal.fetch', err))
      .finally(() => setLoading(false))
  }
  useEffect(() => { refresh() }, [])

  function startEdit(r: FinCategorizationRule) {
    setEditingId(r.id)
    setDraftPattern(r.pattern)
    setDraftCategoriaId(r.categoria_id)
    setDraftLinkCartaoId(r.link_cartao_id ?? '')
  }
  function cancelEdit() {
    setEditingId(null)
    setDraftPattern(''); setDraftCategoriaId(''); setDraftLinkCartaoId('')
  }

  async function saveEdit(r: FinCategorizationRule) {
    if (!draftPattern.trim()) { alertDialog({ title: 'Pattern obrigatório', message: 'Pattern não pode ser vazio.', variant: 'warning' }); return }
    if (!draftCategoriaId) { alertDialog({ title: 'Categoria obrigatória', message: 'Escolha uma categoria.', variant: 'warning' }); return }
    setBusy(true)
    try {
      await updateFinCategorizationRule(r.id, {
        pattern: draftPattern.trim(),
        categoria_id: draftCategoriaId,
        link_cartao_id: draftLinkCartaoId || null,
      })
      cancelEdit()
      refresh()
    } catch (err) {
      reportApiError('RulesModal.save', err)
      alertDialog({ title: 'Erro', message: 'Erro ao salvar — veja o console.', variant: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(r: FinCategorizationRule) {
    const cat = catById.get(r.categoria_id)
    const ok = await confirmDialog({
      title: 'Deletar regra',
      message: `Deletar regra "${r.pattern}" → ${cat?.nome ?? '?'}?\nTransações já categorizadas continuam categorizadas, só não vai mais auto-categorizar futuras.`,
      confirmLabel: 'DELETAR',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await deleteFinCategorizationRule(r.id)
      refresh()
    } catch (err) {
      reportApiError('RulesModal.delete', err)
      alertDialog({ title: 'Erro', message: 'Erro ao deletar — veja o console.', variant: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={modalOverlay()}>
      <div onClick={e => e.stopPropagation()} style={{
        ...modalShell(),
        minWidth: 560, maxWidth: 720, maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div style={sectionLabel()}>Regras de auto-categorização</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-tertiary)', padding: 4,
            display: 'inline-flex',
          }}>
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        </div>
        <div style={{ ...modalBody(), overflowY: 'auto', flex: 1 }}>

        <div style={{
          fontSize: 11, color: 'var(--color-text-muted)',
          marginBottom: 14, lineHeight: 1.5,
        }}>
          Cada regra mapeia um <strong>texto na descrição</strong> (case-insensitive)
          pra uma categoria. Quando uma nova transação chega (manual, import CSV)
          e a descrição contém o texto, sistema categoriza automático. Pra criar
          nova regra, use o botão "categorizar" numa transação e marque "criar
          regra automática".
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            carregando…
          </div>
        ) : rules.length === 0 ? (
          <div style={{
            padding: '20px 16px',
            border: '1px dashed var(--color-border)', borderRadius: 4,
            textAlign: 'center', color: 'var(--color-text-muted)',
            fontSize: 11, fontStyle: 'italic',
          }}>
            nenhuma regra cadastrada ainda. categorize uma transação e marque
            "criar regra automática" no modal.
          </div>
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 4,
            overflowY: 'auto', flex: 1,
          }}>
            {rules.map(r => {
              const cat = catById.get(r.categoria_id)
              const isEditing = editingId === r.id
              return (
                <div key={r.id} style={{
                  display: 'grid',
                  gridTemplateColumns: isEditing ? '1fr 140px 140px auto' : '1fr 180px 70px auto',
                  gap: 8, alignItems: 'center',
                  padding: '8px 10px',
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  borderLeft: '3px solid var(--color-accent-light)',
                  borderRadius: 3,
                }}>
                  {isEditing ? (
                    <>
                      <input
                        type="text"
                        value={draftPattern}
                        onChange={e => setDraftPattern(e.target.value)}
                        autoFocus
                        style={inputStyle()}
                      />
                      <select
                        value={draftCategoriaId}
                        onChange={e => setDraftCategoriaId(e.target.value)}
                        style={inputStyle()}
                      >
                        {categories.map(c => (
                          <option key={c.id} value={c.id}>{c.nome}</option>
                        ))}
                      </select>
                      <select
                        value={draftLinkCartaoId}
                        onChange={e => setDraftLinkCartaoId(e.target.value)}
                        style={inputStyle()}
                        title="Vincular como pagamento de fatura — só pra regras de despesa em cartão"
                      >
                        <option value="">— sem fatura —</option>
                        {cartoesCredito.map(c => (
                          <option key={c.id} value={c.id}>⚡ {c.nome}</option>
                        ))}
                      </select>
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => saveEdit(r)}
                          disabled={busy}
                          style={{ ...primaryButton(), fontSize: 9, padding: '5px 10px' }}
                        >
                          salvar
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={busy}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--color-text-tertiary)', padding: 4,
                            display: 'inline-flex', alignItems: 'center',
                          }}
                        >
                          <X size={12} strokeWidth={1.8} />
                        </button>
                      </span>
                    </>
                  ) : (
                    <>
                      <span style={{
                        fontSize: 13, color: 'var(--color-text-primary)',
                        fontFamily: 'var(--font-mono)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {r.pattern}
                      </span>
                      <span style={{
                        display: 'flex', flexDirection: 'column', gap: 2,
                        fontSize: 11, color: 'var(--color-text-secondary)',
                        textTransform: 'uppercase', letterSpacing: '0.05em',
                      }}>
                        <span>→ {cat?.nome ?? '(categoria removida)'}</span>
                        {r.link_cartao_id && (
                          <span
                            title="quando bater, marca fatura desse cartão como paga (se valor exato)"
                            style={{
                              fontSize: 9, color: 'var(--color-accent-light)',
                              letterSpacing: '0.08em', fontWeight: 600,
                            }}
                          >
                            ⚡ paga fatura {accById.get(r.link_cartao_id)?.nome ?? '?'}
                          </span>
                        )}
                      </span>
                      <span
                        title={`bateu ${r.times_matched} vez${r.times_matched === 1 ? '' : 'es'}`}
                        style={{
                          fontSize: 10, color: 'var(--color-text-tertiary)',
                          fontFamily: 'var(--font-mono)',
                          textAlign: 'right',
                        }}
                      >
                        ×{r.times_matched}
                      </span>
                      <span style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={() => handleBackfill(r)}
                          disabled={busy}
                          title="aplicar essa regra a transações antigas (backfill)"
                          style={iconBtn('var(--color-accent-light)')}
                        >
                          <Wand2 size={12} strokeWidth={1.8} />
                        </button>
                        <button
                          onClick={() => startEdit(r)}
                          title="editar"
                          style={iconBtn('var(--color-accent-light)')}
                        >
                          <Pencil size={12} strokeWidth={1.8} />
                        </button>
                        <button
                          onClick={() => handleDelete(r)}
                          title="deletar"
                          style={iconBtn('var(--color-accent-primary)')}
                        >
                          <Trash2 size={12} strokeWidth={1.8} />
                        </button>
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div style={{
          marginTop: 16, fontSize: 10, color: 'var(--color-text-muted)',
          fontStyle: 'italic',
        }}>
          ×N = quantas vezes essa regra já casou e categorizou automaticamente.
          O ícone de varinha aplica a regra retroativamente em transações já lançadas.
        </div>
        </div>
      </div>

      {backfillPrompt && (
        <BackfillConfirmModal
          ruleId={backfillPrompt.ruleId}
          pattern={backfillPrompt.pattern}
          categoryName={backfillPrompt.categoryName}
          preview={backfillPrompt.preview}
          onClose={() => setBackfillPrompt(null)}
          onApplied={updated => {
            setBackfillPrompt(null)
            if (updated > 0) {
              alertDialog({
                title: 'Regra aplicada',
                message: `${updated} ${updated === 1 ? 'transação foi categorizada' : 'transações foram categorizadas'} retroativamente.`,
                variant: 'success',
              })
            }
            refresh()
          }}
        />
      )}
    </div>
  )
}

function iconBtn(hoverColor: string): React.CSSProperties {
  return {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--color-text-tertiary)', padding: 4,
    display: 'inline-flex', alignItems: 'center',
    transition: 'color 0.15s',
    // hover via inline mouseEnter/Leave seria melhor, mas pra MVP isso já funciona;
    // estilo se vê no hover via uso de :hover-friendly browsers (não-Edge).
    ['--hover-color' as any]: hoverColor,
  }
}
