import { useEffect, useMemo, useState } from 'react'
import { Link2, Unlink } from 'lucide-react'
import {
  updateFinTransaction, fetchAllFinParcelas, reportApiError,
} from '../../../api'
import type {
  FinTransaction, FinAccount, FinCategory, FinDebt, FinParcela, FinInvoice,
  FinRecurringBill,
} from '../../../types'
import {
  sectionLabel, fieldLabel, inputStyle, primaryButton, ghostButton, modalOverlay,
  formatBRL, formatDate, parseBRL, sanitizeMoneyInput,
  modalShell, modalHairline, modalHeader, modalBody,
} from './styleHelpers'
import { alertDialog } from '../../../lib/dialog'
import { useHubFinance } from '../HubFinanceContext'

export function TransactionEditModal({ tx, accounts, categories, debts, invoices, onClose, onSaved }: {
  tx: FinTransaction
  accounts: FinAccount[]
  categories: FinCategory[]
  debts: FinDebt[]
  invoices: FinInvoice[]
  onClose: () => void
  onSaved: () => void
}) {
  const { recurringBills } = useHubFinance()
  const [data, setData] = useState(tx.data)
  const [tipo, setTipo] = useState<'entrada' | 'saida'>(tx.valor >= 0 ? 'entrada' : 'saida')
  const [valor, setValor] = useState(String(Math.abs(tx.valor)))
  const [descricao, setDescricao] = useState(tx.descricao)
  const [contaId, setContaId] = useState(tx.conta_id)
  const [categoriaId, setCategoriaId] = useState(tx.categoria_id ?? '')
  const [notas, setNotas] = useState(tx.notas ?? '')
  const [parcelaId, setParcelaId] = useState<string>(tx.parcela_id ?? '')
  const [dividaId, setDividaId] = useState<string>(tx.divida_id ?? '')
  const [pagamentoFaturaId, setPagamentoFaturaId] = useState<string>(tx.pagamento_fatura_id ?? '')
  const [recurringBillId, setRecurringBillId] = useState<string>(tx.recurring_bill_id ?? '')
  const [parcelas, setParcelas] = useState<FinParcela[]>([])
  const [busy, setBusy] = useState(false)

  const isEntry = tipo === 'entrada'

  // Carrega parcelas uma vez (cross-projeto). Sem filtro de status — precisamos
  // mostrar a parcela atualmente vinculada mesmo se já estiver "recebido".
  useEffect(() => {
    fetchAllFinParcelas()
      .then(setParcelas)
      .catch(err => reportApiError('TransactionEditModal.fetchParcelas', err))
  }, [])

  const filteredCats = useMemo(() => {
    if (isEntry) return categories.filter(c => c.tipo === 'receita' || c.tipo === 'estorno' || c.tipo === 'transferencia')
    return categories.filter(c => c.tipo === 'despesa' || c.tipo === 'transferencia')
  }, [categories, isEntry])

  // Opções de parcela: pendentes + a atualmente selecionada (mesmo se outro status)
  const parcelaOptions = useMemo(() => {
    return parcelas.filter(p => p.status === 'pendente' || p.id === parcelaId)
  }, [parcelas, parcelaId])

  // Opções de dívida: ativas + a atualmente selecionada
  const dividaOptions = useMemo(() => {
    return debts.filter(d => d.status === 'active' || d.id === dividaId)
  }, [debts, dividaId])

  // Opções de fatura pra "esta tx é o pagamento de tal fatura":
  // - Faturas não-pagas (aberta/fechada/atrasada) com total > 0
  // - Mais a já vinculada (mesmo se status='paga') pra permitir ver/desvincular
  const invoiceOptions = useMemo(() => {
    return invoices.filter(i =>
      (i.status !== 'paga' && i.total > 0) || i.id === pagamentoFaturaId
    )
  }, [invoices, pagamentoFaturaId])

  const linkedParcela = parcelas.find(p => p.id === tx.parcela_id) ?? null
  const linkedDivida = debts.find(d => d.id === tx.divida_id) ?? null
  const linkedInvoice = invoices.find(i => i.id === tx.pagamento_fatura_id) ?? null
  const linkedBill = recurringBills.find(b => b.id === tx.recurring_bill_id) ?? null

  // Bills compatíveis com o sinal da tx (entrada → receita, saída → despesa).
  // Inclui a já linkada mesmo se inativa pra permitir ver/desvincular.
  const billOptions = useMemo(() => {
    const wantedTipo = isEntry ? 'receita' : 'despesa'
    return recurringBills.filter(b =>
      (b.ativa && b.tipo === wantedTipo) || b.id === recurringBillId
    )
  }, [recurringBills, isEntry, recurringBillId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!descricao.trim()) { alertDialog({ title: 'Descrição obrigatória', message: 'Descrição é obrigatória.', variant: 'warning' }); return }
    const valorNum = parseBRL(valor)
    if (valorNum == null || valorNum === 0) { alertDialog({ title: 'Valor inválido', message: 'Valor inválido.', variant: 'warning' }); return }
    setBusy(true)
    try {
      await updateFinTransaction(tx.id, {
        data,
        valor: isEntry ? Math.abs(valorNum) : -Math.abs(valorNum),
        descricao: descricao.trim(),
        conta_id: contaId,
        categoria_id: categoriaId || null,
        notas: notas.trim() || null,
        // Vínculos: só envia o que faz sentido pro tipo (evita salvar parcela
        // numa saída ou dívida/pagamento-fatura numa entrada).
        parcela_id: isEntry ? (parcelaId || null) : null,
        divida_id: !isEntry ? (dividaId || null) : null,
        pagamento_fatura_id: !isEntry ? (pagamentoFaturaId || null) : null,
        // Conta fixa: pode estar em qualquer sinal (salário=entrada, casa=saída).
        recurring_bill_id: recurringBillId || null,
      })
      onSaved()
    } catch (err) {
      reportApiError('TransactionEditModal.submit', err)
      alertDialog({ title: 'Erro', message: 'Erro ao salvar — veja o console.', variant: 'danger' })
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={modalOverlay()}>
      <div onClick={e => e.stopPropagation()} style={{
        ...modalShell(),
        minWidth: 460, maxWidth: 540,
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <div style={sectionLabel()}>Editar transação</div>
        </div>
        <div style={{ ...modalBody(), overflowY: 'auto' }}>

        {tx.origem === 'nubank_csv' && (
          <div style={{
            fontSize: 10, color: 'var(--color-text-muted)',
            padding: '6px 10px', marginBottom: 12,
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)', borderRadius: 3,
            fontStyle: 'italic',
          }}>
            transação importada do Nubank — editar valor/data muda só o registro
            local, não afeta o extrato real.
          </div>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 110px 1fr', gap: 8 }}>
            <input
              type="date"
              value={data} onChange={e => setData(e.target.value)}
              style={inputStyle()}
            />
            <select
              value={tipo}
              onChange={e => {
                const newTipo = e.target.value as 'entrada' | 'saida'
                setTipo(newTipo)
                // Reseta categoria — tipos têm conjuntos de categoria distintos
                setCategoriaId('')
                // Limpa FKs incompatíveis pro novo tipo: parcela só faz sentido
                // em entrada (recebimento freela); divida + pagamento_fatura só
                // em saída. Manter o FK depois de trocar tipo deixa estado
                // inconsistente que o backend ignora silenciosamente — melhor
                // limpar visualmente pro user ver que perdeu o vínculo.
                if (newTipo === 'entrada') {
                  setDividaId('')
                  setPagamentoFaturaId('')
                } else {
                  setParcelaId('')
                }
              }}
              style={inputStyle()}
            >
              <option value="saida">saída</option>
              <option value="entrada">entrada</option>
            </select>
            <input
              type="text" inputMode="decimal" placeholder="valor"
              value={valor} onChange={e => setValor(sanitizeMoneyInput(e.target.value))}
              style={{ ...inputStyle(), textAlign: 'right', fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <input
            type="text" placeholder="descrição"
            value={descricao} onChange={e => setDescricao(e.target.value)}
            style={inputStyle()}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <select value={contaId} onChange={e => setContaId(e.target.value)} style={inputStyle()}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
            <select value={categoriaId} onChange={e => setCategoriaId(e.target.value)} style={inputStyle()}>
              <option value="">sem categoria</option>
              {filteredCats.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <input
            type="text" placeholder="notas (opcional)"
            value={notas} onChange={e => setNotas(e.target.value)}
            style={inputStyle()}
          />

          {/* Vínculos — parcela pra entradas; dívida + pagamento-de-fatura
              pra saídas; conta fixa pra ambos. Bloco só aparece quando há
              opção relevante. */}
          {(isEntry
            ? (parcelaOptions.length > 0 || linkedParcela || billOptions.length > 0 || linkedBill)
            : (dividaOptions.length > 0 || linkedDivida || invoiceOptions.length > 0 || linkedInvoice || billOptions.length > 0 || linkedBill)
          ) && (
            <div style={{
              marginTop: 6, padding: 12,
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)', borderRadius: 3,
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 9, color: 'var(--color-text-tertiary)',
                letterSpacing: '0.1em', textTransform: 'uppercase',
                fontWeight: 600,
              }}>
                <Link2 size={11} strokeWidth={1.8} />
                Vínculos
              </div>

              {isEntry ? (
                <ParcelaPicker
                  parcelaId={parcelaId}
                  setParcelaId={setParcelaId}
                  options={parcelaOptions}
                  linkedParcela={linkedParcela}
                />
              ) : (
                <>
                  {(dividaOptions.length > 0 || linkedDivida) && (
                    <DividaPicker
                      dividaId={dividaId}
                      setDividaId={setDividaId}
                      options={dividaOptions}
                      linkedDivida={linkedDivida}
                    />
                  )}
                  {(invoiceOptions.length > 0 || linkedInvoice) && (
                    <InvoicePagamentoPicker
                      invoiceId={pagamentoFaturaId}
                      setInvoiceId={setPagamentoFaturaId}
                      options={invoiceOptions}
                      linkedInvoice={linkedInvoice}
                      accounts={accounts}
                    />
                  )}
                </>
              )}

              {/* Conta fixa — disponível em entrada (receita fixa) e saída
                  (despesa fixa). Permite desvincular via botão Unlink. */}
              {(billOptions.length > 0 || linkedBill) && (
                <RecurringBillPicker
                  billId={recurringBillId}
                  setBillId={setRecurringBillId}
                  options={billOptions}
                />
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
    </div>
  )
}

function ParcelaPicker({ parcelaId, setParcelaId, options, linkedParcela }: {
  parcelaId: string
  setParcelaId: (v: string) => void
  options: FinParcela[]
  linkedParcela: FinParcela | null
}) {
  const wasAutoLinked = !!linkedParcela
  return (
    <div>
      <label style={fieldLabel()}>Parcela esperada</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          value={parcelaId}
          onChange={e => setParcelaId(e.target.value)}
          style={{ ...inputStyle(), flex: 1 }}
        >
          <option value="">— sem vínculo —</option>
          {options.map(p => (
            <option key={p.id} value={p.id}>
              {p.projeto_titulo ?? '?'} · #{p.numero} · {formatBRL(p.valor)}
              {p.data_prevista ? ` (vence ${formatDate(p.data_prevista)})` : ''}
              {p.status !== 'pendente' ? ` [${p.status}]` : ''}
            </option>
          ))}
        </select>
        {parcelaId && (
          <button
            type="button"
            onClick={() => setParcelaId('')}
            title="desvincular"
            style={{
              ...ghostButton(),
              padding: '6px 10px',
              color: 'var(--color-accent-primary)',
              borderColor: 'var(--color-accent-primary)',
            }}
          >
            <Unlink size={11} strokeWidth={1.8} />
          </button>
        )}
      </div>
      {wasAutoLinked && (
        <div style={{
          fontSize: 9, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic',
        }}>
          {parcelaId === linkedParcela?.id
            ? 'vinculada automaticamente por CPF/CNPJ — desvincule se foi outro evento.'
            : 'vínculo automático será substituído ao salvar.'}
        </div>
      )}
    </div>
  )
}

function InvoicePagamentoPicker({
  invoiceId, setInvoiceId, options, linkedInvoice, accounts,
}: {
  invoiceId: string
  setInvoiceId: (v: string) => void
  options: FinInvoice[]
  linkedInvoice: FinInvoice | null
  accounts: FinAccount[]
}) {
  const cartaoNome = (cartaoId: string) =>
    accounts.find(a => a.id === cartaoId)?.nome ?? '?'
  return (
    <div>
      <label style={fieldLabel()}>Pagamento de fatura</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          value={invoiceId}
          onChange={e => setInvoiceId(e.target.value)}
          style={{ ...inputStyle(), flex: 1 }}
        >
          <option value="">— sem vínculo —</option>
          {options.map(i => (
            <option key={i.id} value={i.id}>
              {cartaoNome(i.cartao_id)} · ref. {i.mes_referencia} · {formatBRL(i.total)}
              {i.status !== 'aberta' && i.status !== 'fechada' ? ` [${i.status}]` : ''}
            </option>
          ))}
        </select>
        {invoiceId && (
          <button
            type="button"
            onClick={() => setInvoiceId('')}
            title="desvincular (volta fatura pra fechada)"
            style={{
              ...ghostButton(),
              padding: '6px 10px',
              color: 'var(--color-accent-primary)',
              borderColor: 'var(--color-accent-primary)',
            }}
          >
            <Unlink size={11} strokeWidth={1.8} />
          </button>
        )}
      </div>
      <div style={{
        fontSize: 9, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic',
      }}>
        vincular marca a fatura como <strong>paga</strong> + data desta tx.
        Use pra reconciliar "Pagamento de fatura" importado do Nubank.
      </div>
      {linkedInvoice && invoiceId !== linkedInvoice.id && (
        <div style={{
          fontSize: 9, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic',
        }}>
          vínculo anterior será revertido (fatura volta pra fechada) ao salvar.
        </div>
      )}
    </div>
  )
}

function DividaPicker({ dividaId, setDividaId, options, linkedDivida }: {
  dividaId: string
  setDividaId: (v: string) => void
  options: FinDebt[]
  linkedDivida: FinDebt | null
}) {
  const wasLinked = !!linkedDivida
  return (
    <div>
      <label style={fieldLabel()}>Dívida</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          value={dividaId}
          onChange={e => setDividaId(e.target.value)}
          style={{ ...inputStyle(), flex: 1 }}
        >
          <option value="">— sem vínculo —</option>
          {options.map(d => (
            <option key={d.id} value={d.id}>
              {d.descricao} (saldo {formatBRL(d.saldo_devedor)})
              {d.status !== 'active' ? ` [${d.status}]` : ''}
            </option>
          ))}
        </select>
        {dividaId && (
          <button
            type="button"
            onClick={() => setDividaId('')}
            title="desvincular"
            style={{
              ...ghostButton(),
              padding: '6px 10px',
              color: 'var(--color-accent-primary)',
              borderColor: 'var(--color-accent-primary)',
            }}
          >
            <Unlink size={11} strokeWidth={1.8} />
          </button>
        )}
      </div>
      {wasLinked && dividaId !== linkedDivida?.id && (
        <div style={{
          fontSize: 9, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic',
        }}>
          vínculo anterior será substituído ao salvar.
        </div>
      )}
    </div>
  )
}

function RecurringBillPicker({ billId, setBillId, options }: {
  billId: string
  setBillId: (v: string) => void
  options: FinRecurringBill[]
}) {
  return (
    <div>
      <label style={fieldLabel()}>Conta fixa</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          value={billId}
          onChange={e => setBillId(e.target.value)}
          style={{ ...inputStyle(), flex: 1 }}
        >
          <option value="">— sem vínculo —</option>
          {options.map(b => (
            <option key={b.id} value={b.id}>
              {b.descricao} · {formatBRL(b.valor_estimado)}
              {b.dia_vencimento ? ` (dia ${b.dia_vencimento})` : ''}
              {!b.ativa ? ' [pausada]' : ''}
            </option>
          ))}
        </select>
        {billId && (
          <button
            type="button"
            onClick={() => setBillId('')}
            title="desvincular (bill volta a aparecer como pendente)"
            style={{
              ...ghostButton(),
              padding: '6px 10px',
              color: 'var(--color-accent-primary)',
              borderColor: 'var(--color-accent-primary)',
            }}
          >
            <Unlink size={11} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  )
}
