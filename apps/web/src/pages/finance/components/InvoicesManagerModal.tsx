import { useState } from 'react'
import { CreditCard, X } from 'lucide-react'
import { closeFinInvoice, payFinInvoice, reportApiError } from '../../../api'
import type { FinAccount, FinInvoice } from '../../../types'
import {
  sectionLabel, fieldLabel, inputStyle, primaryButton, ghostButton,
  modalOverlay, formatBRL, formatDate,
  modalShell, modalHairline, modalHeader, modalBody,
} from './styleHelpers'
import { confirmDialog, alertDialog } from '../../../lib/dialog'

/**
 * Modal de gerenciamento de faturas — abre via botão "gerenciar" no card
 * Faturas da Visão Geral. Lista todas faturas (abertas, fechadas, pagas)
 * + ações fechar/pagar. Substitui a aba "Cartões" que era redundante (só
 * 1 cartão, ações pouco frequentes).
 *
 * Cadastro de cartão novo é via /carteira → "+ nova carteira" → tipo crédito.
 */
export function InvoicesManagerModal({ invoices, accounts, onClose, onChanged }: {
  invoices: FinInvoice[]
  accounts: FinAccount[]
  onClose: () => void
  /** Chamado após qualquer ação (fechar/pagar) — recarrega dados do parent. */
  onChanged: () => void
}) {
  const [payingInvoice, setPayingInvoice] = useState<FinInvoice | null>(null)

  const accountById = new Map(accounts.map(a => [a.id, a]))
  const pendentes = invoices.filter(i => i.status === 'aberta' || i.status === 'fechada')
  const historicas = invoices.filter(i => i.status === 'paga' || i.status === 'atrasada').slice(0, 10)

  async function handleClose(inv: FinInvoice) {
    const ok = await confirmDialog({
      title: 'Fechar fatura',
      message: `Fechar fatura ${inv.mes_referencia} (${formatBRL(inv.total)})?\nPróximas compras no cartão criarão nova fatura aberta.`,
      confirmLabel: 'FECHAR',
    })
    if (!ok) return
    try {
      await closeFinInvoice(inv.id)
      onChanged()
    } catch (err: any) {
      reportApiError('closeFinInvoice', err)
      alertDialog({ title: 'Erro', message: err?.message ?? 'Erro ao fechar fatura.', variant: 'danger' })
    }
  }

  return (
    <>
      <div onClick={onClose} style={modalOverlay()}>
        <div onClick={e => e.stopPropagation()} style={{
          ...modalShell(),
          width: 'min(760px, calc(100vw - 16px))', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={modalHairline} />
          <div style={modalHeader()}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <CreditCard size={14} strokeWidth={1.8} style={{ color: 'var(--color-text-tertiary)' }} />
            <div style={sectionLabel()}>Gerenciar faturas</div>
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

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {/* Faturas pendentes */}
            <div style={{
              fontSize: 10, color: 'var(--color-text-tertiary)',
              letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600,
              marginBottom: 10,
            }}>
              Em aberto
            </div>

            {pendentes.length === 0 ? (
              <div style={{
                padding: '20px 16px',
                border: '1px dashed var(--color-border)', borderRadius: 4,
                textAlign: 'center', color: 'var(--color-text-muted)',
                fontSize: 11, fontStyle: 'italic', lineHeight: 1.5,
              }}>
                nenhuma fatura aberta. compras no cartão de crédito criam faturas
                automaticamente; só viram despesa do mês quando você marcar a fatura
                como paga.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {pendentes.map(inv => {
                  const card = accountById.get(inv.cartao_id)
                  const isAberta = inv.status === 'aberta'
                  const accentColor = isAberta ? 'var(--color-accent-light)' : 'var(--color-warning)'
                  return (
                    <div key={inv.id} style={{
                      background: 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-border)',
                      borderLeft: `3px solid ${accentColor}`,
                      borderRadius: 4, padding: '12px 14px',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {card?.nome ?? '?'} · {inv.mes_referencia}
                          </div>
                          <div style={{
                            fontSize: 9, color: 'var(--color-text-tertiary)',
                            textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2,
                          }}>
                            {inv.transacoes_count} compra{inv.transacoes_count === 1 ? '' : 's'}
                          </div>
                        </div>
                        <span style={{
                          fontSize: 8, color: accentColor,
                          letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 700,
                          whiteSpace: 'nowrap',
                        }}>
                          {inv.status}
                        </span>
                      </div>
                      <div style={{
                        fontSize: 18, fontWeight: 700, marginTop: 10,
                        color: 'var(--color-text-primary)',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {formatBRL(inv.total)}
                      </div>
                      {inv.data_vencimento && (
                        <div style={{
                          fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4,
                        }}>
                          vence {formatDate(inv.data_vencimento)}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                        {isAberta && (
                          <button
                            onClick={() => handleClose(inv)}
                            disabled={inv.transacoes_count === 0}
                            title={inv.transacoes_count === 0 ? 'fatura vazia — adicione compras antes de fechar' : 'fechar fatura'}
                            style={{ ...ghostButton(), fontSize: 9, padding: '5px 10px' }}
                          >
                            fechar
                          </button>
                        )}
                        <button
                          onClick={() => setPayingInvoice(inv)}
                          disabled={inv.transacoes_count === 0}
                          title={inv.transacoes_count === 0 ? 'fatura vazia' : 'marcar como paga'}
                          style={{ ...primaryButton(), fontSize: 9, padding: '5px 10px' }}
                        >
                          pagar
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Histórico de pagas */}
            {historicas.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{
                  fontSize: 10, color: 'var(--color-text-tertiary)',
                  letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600,
                  marginBottom: 10,
                }}>
                  Histórico (pagas recentes)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {historicas.map(inv => {
                    const card = accountById.get(inv.cartao_id)
                    return (
                      <div key={inv.id} style={{
                        display: 'grid', gridTemplateColumns: '1fr 100px 100px',
                        gap: 12, alignItems: 'center', padding: '6px 12px',
                        background: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border)',
                        borderLeft: '3px solid var(--color-success)',
                        borderRadius: 3,
                        opacity: 0.75,
                      }}>
                        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                          {card?.nome} · {inv.mes_referencia}
                        </span>
                        <span style={{
                          fontSize: 11, color: 'var(--color-text-muted)',
                          fontFamily: 'var(--font-mono)',
                        }}>
                          {formatBRL(inv.total)}
                        </span>
                        <span style={{
                          fontSize: 9, color: 'var(--color-text-muted)',
                          fontFamily: 'var(--font-mono)',
                        }}>
                          paga {inv.data_pagamento ? formatDate(inv.data_pagamento) : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div style={{
            marginTop: 16, paddingTop: 14,
            borderTop: '1px solid var(--color-border)',
            fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic',
          }}>
            pra adicionar um novo cartão, vai em "carteira" no menu e clica em "+ nova carteira" → tipo "cartão de crédito".
          </div>
        </div>
        </div>
      </div>

      {/* Sub-modal de pagamento */}
      {payingInvoice && (
        <PayInvoiceModal
          invoice={payingInvoice}
          accounts={accounts.filter(a => a.tipo !== 'credito' && a.moeda === 'BRL')}
          onClose={() => setPayingInvoice(null)}
          onPaid={() => { setPayingInvoice(null); onChanged() }}
        />
      )}
    </>
  )
}

// ─── Sub-modal de pagamento ──────────────────────────────────────────────

function PayInvoiceModal({ invoice, accounts, onClose, onPaid }: {
  invoice: FinInvoice
  accounts: FinAccount[]
  onClose: () => void
  onPaid: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [contaId, setContaId] = useState<string>(accounts[0]?.id ?? '')
  const [dataPagamento, setDataPagamento] = useState<string>(today)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!contaId) { alertDialog({ title: 'Conta obrigatória', message: 'Selecione a conta de pagamento.', variant: 'warning' }); return }
    setBusy(true)
    try {
      await payFinInvoice(invoice.id, {
        conta_pagamento_id: contaId,
        data_pagamento: dataPagamento,
      })
      onPaid()
    } catch (err: any) {
      reportApiError('payFinInvoice', err)
      alertDialog({ title: 'Erro', message: err?.message ?? 'Erro ao pagar — veja o console.', variant: 'danger' })
      setBusy(false)
    }
  }

  if (accounts.length === 0) {
    return (
      <div onClick={onClose} style={{ ...modalOverlay(), zIndex: 110 }}>
        <div onClick={e => e.stopPropagation()} style={{ ...modalShell(), minWidth: 380 }}>
          <div style={modalHairline} />
          <div style={modalHeader()}>
            <div style={sectionLabel()}>Sem carteira pra pagar</div>
          </div>
          <div style={modalBody()}>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
            Pra pagar fatura você precisa de uma carteira do tipo conta corrente em BRL.
            Cria uma em /carteira → "+ nova carteira".
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={primaryButton()}>fechar</button>
          </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div onClick={onClose} style={{ ...modalOverlay(), zIndex: 110 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...modalShell(), minWidth: 420, maxWidth: 480 }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <div style={sectionLabel()}>Pagar fatura {invoice.mes_referencia}</div>
        </div>
        <div style={modalBody()}>

        <div style={{
          padding: 12, marginBottom: 16,
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderLeft: '3px solid var(--color-accent-light)',
          borderRadius: 3,
        }}>
          <div style={{
            fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-mono)',
          }}>
            {formatBRL(invoice.total)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {invoice.transacoes_count} compra{invoice.transacoes_count === 1 ? '' : 's'} vinculada{invoice.transacoes_count === 1 ? '' : 's'}
          </div>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={fieldLabel()}>Conta de pagamento</label>
            <select value={contaId} onChange={e => setContaId(e.target.value)} style={inputStyle()}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={fieldLabel()}>Data do pagamento</label>
            <input
              type="date"
              value={dataPagamento} onChange={e => setDataPagamento(e.target.value)}
              style={inputStyle()}
            />
            <div style={{
              fontSize: 9, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic',
            }}>
              compras vão contar como despesa no mês dessa data (regra de
              competência). pagamento em si é registrado como Transferência
              Interna entre as 2 contas.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onClick={onClose} style={ghostButton()}>cancelar</button>
            <button type="submit" disabled={busy} style={primaryButton()}>
              {busy ? 'pagando…' : 'pagar fatura'}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}
