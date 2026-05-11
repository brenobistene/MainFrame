import { useMemo, useState } from 'react'
import {
  updateFinTransaction, createFinCategorizationRule,
  previewBackfillRule, reportApiError,
} from '../../../api'
import type { FinRuleBackfillPreview } from '../../../api'
import type { FinTransaction, FinCategory, FinAccount } from '../../../types'
import {
  sectionLabel, fieldLabel, inputStyle, primaryButton, ghostButton,
  formatBRL, formatDate,
  modalOverlay, modalShell, modalHairline, modalHeader, modalBody,
} from './styleHelpers'
import { BackfillConfirmModal } from './BackfillConfirmModal'
import { parseTxDescricao } from './parseTxDescricao'
import { alertDialog } from '../../../lib/dialog'

export function CategorizeModal({ tx, categories, accounts, onClose, onSaved }: {
  tx: FinTransaction
  categories: FinCategory[]
  accounts: FinAccount[]
  onClose: () => void
  onSaved: () => void
}) {
  const isEntry = tx.valor >= 0
  const filteredCats = useMemo(() => {
    if (isEntry) return categories.filter(c => c.tipo === 'receita' || c.tipo === 'estorno')
    return categories.filter(c => c.tipo === 'despesa')
  }, [categories, isEntry])
  // Cartões de crédito disponíveis pra link de pagamento (só faz sentido em saídas)
  const cartoesCredito = useMemo(
    () => (isEntry ? [] : accounts.filter(a => a.tipo === 'credito')),
    [accounts, isEntry],
  )

  const [categoriaId, setCategoriaId] = useState<string>(tx.categoria_id ?? filteredCats[0]?.id ?? '')
  // Pré-marcado: a expectativa do usuário é que categorizar uma vez já cubra
  // todas as próximas transações da mesma contraparte.
  const [createRule, setCreateRule] = useState(true)
  const [pattern, setPattern] = useState<string>(() => suggestPattern(tx.descricao))
  // Cartão alvo do auto-link de pagamento de fatura (opcional). Null = só
  // categoriza, não tenta linkar fatura.
  const [linkCartaoId, setLinkCartaoId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [backfillPrompt, setBackfillPrompt] = useState<{
    ruleId: string
    pattern: string
    categoryName: string
    preview: FinRuleBackfillPreview
  } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!categoriaId) { alertDialog({ title: 'Categoria obrigatória', message: 'Escolha uma categoria.', variant: 'warning' }); return }
    // Se user marcou "criar regra" mas esqueceu de preencher o pattern, avisa
    // ao invés de silenciosamente skipar a criação da regra (bug antigo).
    if (createRule && !pattern.trim()) {
      alertDialog({
        title: 'Texto da regra obrigatório',
        message: 'Você marcou "criar regra automática" mas o texto está vazio. Preencha um padrão (ex: "amicom", "uber") ou desmarque a opção.',
        variant: 'warning',
      })
      return
    }
    setBusy(true)
    try {
      await updateFinTransaction(tx.id, { categoria_id: categoriaId })
      if (createRule && pattern.trim()) {
        const rule = await createFinCategorizationRule({
          pattern: pattern.trim(),
          categoria_id: categoriaId,
          link_cartao_id: linkCartaoId || null,
        })
        // Tenta backfill: se já houver outras transações sem categoria que
        // batem com a regra, oferece aplicar agora. A transação atual acabou
        // de ser categorizada manualmente, então não conta no preview.
        try {
          const preview = await previewBackfillRule(rule.id)
          if (preview.matches_uncategorized > 0 || preview.matches_total > 1) {
            const cat = filteredCats.find(c => c.id === categoriaId)
            setBackfillPrompt({
              ruleId: rule.id,
              pattern: pattern.trim(),
              categoryName: cat?.nome ?? '?',
              preview,
            })
            setBusy(false)
            return  // espera o user decidir antes de fechar
          }
        } catch (err) {
          reportApiError('CategorizeModal.previewBackfill', err)
          // Não bloqueia o fluxo principal — só loga.
        }
      }
      onSaved()
    } catch (err) {
      reportApiError('CategorizeModal.submit', err)
      alertDialog({ title: 'Erro', message: 'Erro ao salvar — veja o console.', variant: 'danger' })
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={modalOverlay()}>
      <div onClick={e => e.stopPropagation()} style={{ ...modalShell(), minWidth: 420, maxWidth: 520 }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <div style={sectionLabel()}>Categorizar transação</div>
        </div>
        <div style={modalBody()}>

        <div style={{
          padding: 12, marginBottom: 16,
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderLeft: `3px solid ${isEntry ? 'var(--color-success)' : 'var(--color-accent-primary)'}`,
          borderRadius: 3,
        }}>
          <div style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{tx.descricao}</div>
          <div style={{
            fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4,
            fontFamily: 'var(--font-mono)',
          }}>
            {formatDate(tx.data)} · {isEntry ? '+' : ''}{formatBRL(tx.valor)}
          </div>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={fieldLabel()}>Categoria</label>
            <select value={categoriaId} onChange={e => setCategoriaId(e.target.value)} style={inputStyle()}>
              {filteredCats.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>

          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            cursor: 'pointer', padding: '8px 0',
          }}>
            <input
              type="checkbox"
              checked={createRule}
              onChange={e => setCreateRule(e.target.checked)}
              style={{ marginTop: 2, accentColor: 'var(--color-accent-primary)' }}
            />
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                criar regra automática
              </div>
              <div style={{ color: 'var(--color-text-muted)' }}>
                próximas transações cuja descrição contenha esse texto serão
                categorizadas automaticamente nessa categoria.
              </div>
            </div>
          </label>

          {createRule && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={fieldLabel()}>Texto da regra</label>
                <input
                  type="text"
                  value={pattern}
                  onChange={e => setPattern(e.target.value)}
                  placeholder="ex: ifood, amicom, uber"
                  style={inputStyle()}
                />
                <div style={hintStyle}>
                  comparação é case-insensitive — "iFood" combina com "iFood",
                  "IFOOD", "ifood almoço", etc.
                </div>
              </div>
              {/* Auto-link de pagamento de fatura — só pra saídas e quando há
                  cartão de crédito cadastrado. Quando setado, ao bater a
                  regra numa tx futura, sistema procura fatura desse cartão
                  com valor exato e marca como paga automaticamente. */}
              {!isEntry && cartoesCredito.length > 0 && (
                <div>
                  <label style={fieldLabel()}>Vincular como pagamento de fatura (opcional)</label>
                  <select
                    value={linkCartaoId}
                    onChange={e => setLinkCartaoId(e.target.value)}
                    style={inputStyle()}
                  >
                    <option value="">— não vincular (só categorizar) —</option>
                    {cartoesCredito.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                  <div style={hintStyle}>
                    quando a regra bater numa tx futura, procura fatura desse
                    cartão com valor exato e marca como paga. Use pra
                    "Pagamento de fatura" do Nubank — depois de criar a
                    regra, próximas viram automático.
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onClick={onClose} style={ghostButton()}>cancelar</button>
            <button type="submit" disabled={busy} style={primaryButton()}>
              {busy ? 'salvando…' : 'salvar'}
            </button>
          </div>
        </form>
        </div>
      </div>

      {backfillPrompt && (
        <BackfillConfirmModal
          ruleId={backfillPrompt.ruleId}
          pattern={backfillPrompt.pattern}
          categoryName={backfillPrompt.categoryName}
          preview={backfillPrompt.preview}
          onClose={() => { setBackfillPrompt(null); onSaved() }}
          onApplied={updated => {
            setBackfillPrompt(null)
            if (updated > 0) {
              alertDialog({
                title: 'Regra aplicada',
                message: `${updated} ${updated === 1 ? 'transação foi categorizada' : 'transações foram categorizadas'} retroativamente.`,
                variant: 'success',
              })
            }
            onSaved()
          }}
        />
      )}
    </div>
  )
}

const hintStyle: React.CSSProperties = {
  fontSize: 9, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic',
}

/** Sugere pattern de regra baseado em parser do Nubank quando possível.
 *  Prioridade: CNPJ (mais específico — só DONA GLORIA) > nome real
 *  ("DONA GLORIA PANIFICADORA E LANCHONETE") > heurística de palavra.
 *  CPF mascarado (•••.123.456-••) é pulado: não identifica unicamente. */
function suggestPattern(descricao: string): string {
  const parsed = parseTxDescricao(descricao)
  // Doc só serve como pattern se for CNPJ válido — CPF mascarado tem bullets
  // e identifica diferentes pessoas (qualquer CPF terminado em 456 bate).
  if (parsed.doc && /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(parsed.doc)) {
    return parsed.doc
  }
  if (parsed.nome && parsed.nome.length >= 4 && parsed.nome !== '—') {
    return parsed.nome
  }
  return guessFirstMeaningfulWord(descricao)
}

/** Fallback: primeira palavra com 3+ chars que não seja preposição/stopword. */
function guessFirstMeaningfulWord(descricao: string): string {
  const stopWords = new Set([
    'de', 'da', 'do', 'das', 'dos', 'na', 'no', 'em', 'para',
    'pra', 'compra', 'pix', 'transferencia', 'transferência', 'pagamento',
    'enviada', 'recebida', 'pelo', 'pela', 'fatura',
  ])
  const words = (descricao || '').split(/\s+/).filter(Boolean)
  for (const w of words) {
    const clean = w.toLowerCase().replace(/[^\wÀ-ÿ]/g, '')
    if (clean.length >= 3 && !stopWords.has(clean)) return w
  }
  return words[0] ?? ''
}
