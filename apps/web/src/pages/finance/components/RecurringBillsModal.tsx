/**
 * Modal de gerenciamento de Contas Fixas Recorrentes (luz, água, internet,
 * aluguel, streaming, etc).
 *
 * Lista todas as contas + status do mês selecionado (paga / pendente /
 * atrasada). Cada item mostra dia de vencimento, valor estimado, e — se já
 * paga — valor real e link pra transação.
 *
 * Status é INFERIDO pelo backend (sem persistir vínculo): match por
 * categoria + descrição contendo palavras do nome da bill.
 */
import { useMemo, useState } from 'react'
import {
  CheckCircle2, ClipboardList, Pause, Pencil, Play,
  Plus, Trash2, Wallet, X,
} from 'lucide-react'
import {
  createFinRecurringBill, updateFinRecurringBill, deleteFinRecurringBill,
  createFinTransaction, reportApiError,
} from '../../../api'
import type {
  FinAccount, FinCategory, FinRecurringBill, FinRecurringBillStatusItem,
  FinRecurringBillStatusMonth,
} from '../../../types'
import { useHubFinance } from '../HubFinanceContext'
import {
  sectionLabel, fieldLabel, hintText, inputStyle, primaryButton, ghostButton,
  modalOverlay, formatBRL, parseBRL, sanitizeMoneyInput, ICON_SIZE, ICON_STROKE,
  modalShell, modalHairline, modalHeader, modalBody,
} from './styleHelpers'
import { EmptyState, IconButton } from '../../../components/ui/Primitives'

export function RecurringBillsModal({
  bills, status, accounts, categories, onClose, onChanged,
}: {
  bills: FinRecurringBill[]
  status: FinRecurringBillStatusMonth | null
  accounts: FinAccount[]
  categories: FinCategory[]
  onClose: () => void
  onChanged: () => void
}) {
  type EditState =
    | { kind: 'edit'; bill: FinRecurringBill }
    | { kind: 'new'; tipo: 'despesa' | 'receita' }
    | null
  const [editing, setEditing] = useState<EditState>(null)
  const [markingPaid, setMarkingPaid] = useState<FinRecurringBill | null>(null)

  // Index status por bill_id
  const statusById = useMemo(
    () => new Map<string, FinRecurringBillStatusItem>(
      (status?.items ?? []).map(s => [s.bill_id, s]),
    ),
    [status],
  )

  // Agrupa bills por tipo (despesas | receitas)
  const billsDespesa = bills.filter(b => b.tipo === 'despesa')
  const billsReceita = bills.filter(b => b.tipo === 'receita')

  async function handleDelete(bill: FinRecurringBill) {
    if (!window.confirm(
      `Deletar "${bill.descricao}"? Histórico de transações já lançadas ` +
      `não é afetado — só remove o cadastro recorrente.`
    )) return
    try {
      await deleteFinRecurringBill(bill.id)
      onChanged()
    } catch (err) {
      reportApiError('RecurringBillsModal.delete', err)
      alert('Erro ao deletar — veja o console.')
    }
  }

  async function togglePause(bill: FinRecurringBill) {
    try {
      await updateFinRecurringBill(bill.id, { ativa: !bill.ativa })
      onChanged()
    } catch (err) {
      reportApiError('RecurringBillsModal.togglePause', err)
      alert('Erro ao alterar — veja o console.')
    }
  }

  return (
    <>
      <div onClick={onClose} style={modalOverlay()}>
        <div onClick={e => e.stopPropagation()} style={{
          ...modalShell(),
          minWidth: 620, maxWidth: 760, maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={modalHairline} />
          <div style={modalHeader()}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center',
            gap: 'var(--space-3)',
          }}>
            <ClipboardList
              size={ICON_SIZE.md}
              strokeWidth={ICON_STROKE}
              style={{ color: 'var(--color-text-tertiary)' }}
            />
            <div style={sectionLabel()}>Recorrências fixas</div>
            <div style={{ flex: 1 }} />
            <IconButton label="fechar" onClick={onClose} variant="bare">
              <X size={ICON_SIZE.md} strokeWidth={2} />
            </IconButton>
          </div>
          </div>
          <div style={{ ...modalBody(), overflowY: 'auto', flex: 1 }}>

          {/* Resumo do mês */}
          {status && status.items.length > 0 && (
            <div
              className="hq-glass"
              style={{
                padding: 'var(--space-3) var(--space-4)',
                marginBottom: 'var(--space-4)',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 'var(--space-4)',
              }}
            >
              <Stat label="Despesas estimadas" value={status.despesa_total_estimado} color="var(--color-accent-light)" />
              <Stat label="Receitas estimadas" value={status.receita_total_estimado} color="var(--color-success-light)" />
              <Stat label="Sobra prevista" value={status.receita_total_estimado - status.despesa_total_estimado}
                color={(status.receita_total_estimado - status.despesa_total_estimado) >= 0
                  ? 'var(--color-text-primary)' : 'var(--color-accent-primary)'} />
            </div>
          )}

          <div style={hintText()}>
            Status é inferido buscando transação do mês com a mesma categoria
            e palavras parecidas no nome. Se errar, ajuste o nome da bill pra
            bater com o que você lança.
          </div>

          {/* Lista — duas seções: Despesas e Receitas */}
          <div style={{ flex: 1, overflowY: 'auto', marginTop: 'var(--space-4)' }}>
            {bills.length === 0 ? (
              <EmptyState
                text="Nenhuma recorrência cadastrada"
                sub="Cadastre suas contas mensais (luz, água, aluguel) e/ou receitas fixas (salário) pra ter um teto previsível."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                <BillsSection
                  title="Despesas fixas"
                  tipo="despesa"
                  bills={billsDespesa}
                  statusById={statusById}
                  categories={categories}
                  onAdd={() => setEditing({ kind: 'new', tipo: 'despesa' })}
                  onEdit={bill => setEditing({ kind: 'edit', bill })}
                  onDelete={handleDelete}
                  onTogglePause={togglePause}
                  onMarkPaid={bill => setMarkingPaid(bill)}
                />
                <BillsSection
                  title="Receitas fixas"
                  tipo="receita"
                  bills={billsReceita}
                  statusById={statusById}
                  categories={categories}
                  onAdd={() => setEditing({ kind: 'new', tipo: 'receita' })}
                  onEdit={bill => setEditing({ kind: 'edit', bill })}
                  onDelete={handleDelete}
                  onTogglePause={togglePause}
                  onMarkPaid={bill => setMarkingPaid(bill)}
                />
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      {editing && (
        <RecurringBillFormModal
          bill={editing.kind === 'edit' ? editing.bill : null}
          defaultTipo={editing.kind === 'new' ? editing.tipo : undefined}
          accounts={accounts}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged() }}
        />
      )}

      {markingPaid && (
        <MarkPaidModal
          bill={markingPaid}
          accounts={accounts}
          onClose={() => setMarkingPaid(null)}
          onPaid={() => { setMarkingPaid(null); onChanged() }}
        />
      )}
    </>
  )
}

// ─── Seção (Despesas ou Receitas) ──────────────────────────────────────

function BillsSection({
  title, tipo, bills, statusById, categories,
  onAdd, onEdit, onDelete, onTogglePause, onMarkPaid,
}: {
  title: string
  tipo: 'despesa' | 'receita'
  bills: FinRecurringBill[]
  statusById: Map<string, FinRecurringBillStatusItem>
  categories: FinCategory[]
  onAdd: () => void
  onEdit: (bill: FinRecurringBill) => void
  onDelete: (bill: FinRecurringBill) => void
  onTogglePause: (bill: FinRecurringBill) => void
  onMarkPaid: (bill: FinRecurringBill) => void
}) {
  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-2)',
      }}>
        <span style={{
          fontSize: 'var(--text-xs)',
          color: tipo === 'receita' ? 'var(--color-success-light)' : 'var(--color-accent-light)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          fontWeight: 700,
        }}>
          {title}
        </span>
        <span style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
        }}>
          {bills.length}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onAdd}
          className="hq-btn hq-btn--ghost"
          style={{ padding: '4px 10px', fontSize: 'var(--text-xs)' }}
        >
          <Plus size={ICON_SIZE.xs} strokeWidth={2} />
          nova {tipo === 'receita' ? 'receita fixa' : 'despesa fixa'}
        </button>
      </div>
      {bills.length === 0 ? (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          border: '1px dashed var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--text-xs)',
          fontStyle: 'italic',
        }}>
          {tipo === 'receita'
            ? 'nenhuma receita fixa cadastrada (ex: salário, mesada)'
            : 'nenhuma despesa fixa cadastrada (ex: luz, água, aluguel)'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {bills.map(bill => {
            const st = statusById.get(bill.id)
            const cat = categories.find(c => c.id === bill.categoria_id)
            return (
              <BillRow
                key={bill.id}
                bill={bill}
                status={st}
                categoryName={cat?.nome}
                categoryColor={cat?.cor ?? null}
                onEdit={() => onEdit(bill)}
                onDelete={() => onDelete(bill)}
                onTogglePause={() => onTogglePause(bill)}
                onMarkPaid={() => onMarkPaid(bill)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Linha individual ───────────────────────────────────────────────────

function BillRow({
  bill, status, categoryName, categoryColor,
  onEdit, onDelete, onTogglePause, onMarkPaid,
}: {
  bill: FinRecurringBill
  status: FinRecurringBillStatusItem | undefined
  categoryName: string | undefined
  categoryColor: string | null
  onEdit: () => void
  onDelete: () => void
  onTogglePause: () => void
  onMarkPaid: () => void
}) {
  const inactive = !bill.ativa
  const isReceita = bill.tipo === 'receita'
  // Status "paga" pra despesa = "recebida" pra receita (semântica)
  const isCompleted = status?.status === 'paga' || status?.status === 'recebida'
  const statusLabel = inactive
    ? 'pausada'
    : isCompleted
      ? (isReceita ? 'recebida' : 'paga')
      : (status?.status ?? 'pendente')
  const statusColor = inactive
    ? 'var(--color-text-muted)'
    : isCompleted
      ? 'var(--color-success-light)'
      : statusLabel === 'atrasada'
        ? 'var(--color-error)'
        : 'var(--color-text-tertiary)'

  return (
    <div
      className="hq-glass"
      style={{
        padding: 'var(--space-3) var(--space-4)',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr 110px 110px auto',
        gap: 'var(--space-3)',
        alignItems: 'center',
        opacity: inactive ? 0.5 : 1,
      }}
    >
      {/* Status dot */}
      <div
        title={statusLabel}
        style={{
          width: 8, height: 8, borderRadius: '50%',
          background: statusColor,
          flexShrink: 0,
          boxShadow: isCompleted
            ? '0 0 8px rgba(122, 154, 138, 0.5)'
            : statusLabel === 'atrasada'
              ? '0 0 8px rgba(220, 38, 38, 0.5)'
              : 'none',
        }}
      />

      {/* Descrição + categoria */}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{
          fontSize: 'var(--text-base)',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {bill.descricao}
        </div>
        <div style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-tertiary)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        }}>
          {categoryName && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {categoryColor && (
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: categoryColor, display: 'inline-block',
                }} />
              )}
              {categoryName}
            </span>
          )}
          {bill.dia_vencimento && (
            <span>· {isReceita ? 'cai dia' : 'vence dia'} {bill.dia_vencimento}</span>
          )}
          {!inactive && isCompleted && status?.data_pagamento && (
            <span style={{ color: 'var(--color-success-light)' }}>
              · {isReceita ? 'recebido em' : 'pago em'} {formatDate(status.data_pagamento)}
            </span>
          )}
          {inactive && <span>· pausada</span>}
        </div>
      </div>

      {/* Valor estimado */}
      <div style={{
        textAlign: 'right',
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text-secondary)',
      }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          estimado
        </div>
        {formatBRL(bill.valor_estimado)}
      </div>

      {/* Valor real (quando paga/recebida) */}
      <div style={{
        textAlign: 'right',
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        fontSize: 'var(--text-sm)',
        fontWeight: 600,
        color: isCompleted ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
      }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 400 }}>
          {isCompleted ? (isReceita ? 'recebido' : 'pago') : '—'}
        </div>
        {status?.valor_pago != null ? formatBRL(status.valor_pago) : '—'}
      </div>

      {/* Ações */}
      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
        {/* Marcar como paga/recebida: só faz sentido se ativa e ainda não foi processada */}
        {!inactive && !isCompleted && (
          <IconButton
            label={`marcar ${bill.descricao} como ${isReceita ? 'recebida' : 'paga'}`}
            onClick={onMarkPaid}
            variant="accent"
          >
            <Wallet size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
          </IconButton>
        )}
        <IconButton
          label={inactive ? 'reativar' : 'pausar'}
          onClick={onTogglePause}
        >
          {inactive
            ? <Play size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
            : <Pause size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
        </IconButton>
        <IconButton label={`editar ${bill.descricao}`} onClick={onEdit}>
          <Pencil size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
        </IconButton>
        <IconButton
          label={`deletar ${bill.descricao}`}
          onClick={onDelete}
          variant="danger"
        >
          <Trash2 size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
    </div>
  )
}

function Stat({ label, value, color, muted }: {
  label: string
  value: number
  color?: string
  muted?: boolean
}) {
  return (
    <div>
      <div style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        fontWeight: 600,
        marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 'var(--text-md)',
        fontWeight: 700,
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        color: color ?? (muted ? 'var(--color-text-secondary)' : 'var(--color-text-primary)'),
      }}>
        {formatBRL(value)}
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

// ─── Sub-modal: criar/editar ────────────────────────────────────────────

function RecurringBillFormModal({
  bill, accounts, categories, defaultTipo, onClose, onSaved,
}: {
  bill: FinRecurringBill | null
  accounts: FinAccount[]
  categories: FinCategory[]
  defaultTipo?: 'despesa' | 'receita'
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = bill !== null
  const [tipo, setTipo] = useState<'despesa' | 'receita'>(
    bill?.tipo ?? defaultTipo ?? 'despesa'
  )
  const [descricao, setDescricao] = useState(bill?.descricao ?? '')
  const [valorEstimado, setValorEstimado] = useState(
    bill ? String(bill.valor_estimado).replace('.', ',') : ''
  )
  const [diaVencimento, setDiaVencimento] = useState<string>(
    bill?.dia_vencimento ? String(bill.dia_vencimento) : ''
  )
  const [categoriaId, setCategoriaId] = useState<string>(bill?.categoria_id ?? '')
  const [contaPagamentoId, setContaPagamentoId] = useState<string>(bill?.conta_pagamento_id ?? '')
  const [notas, setNotas] = useState(bill?.notas ?? '')
  const [busy, setBusy] = useState(false)

  // Categorias filtradas pelo tipo selecionado. Despesa filtra só categorias
  // de despesa; receita filtra só de receita. Trocar tipo limpa categoria
  // selecionada se ela não bater com novo tipo.
  const filteredCats = categories.filter(c => c.tipo === tipo)

  function handleTipoChange(novo: 'despesa' | 'receita') {
    setTipo(novo)
    // Se categoria atual não é compatível com novo tipo, limpa.
    const currentCat = categories.find(c => c.id === categoriaId)
    if (currentCat && currentCat.tipo !== novo) {
      setCategoriaId('')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!descricao.trim()) { alert('Descrição é obrigatória.'); return }
    const valorNum = parseBRL(valorEstimado)
    if (valorNum == null || valorNum <= 0) { alert('Valor inválido.'); return }

    let diaNum: number | null = null
    if (diaVencimento.trim()) {
      diaNum = parseInt(diaVencimento, 10)
      if (isNaN(diaNum) || diaNum < 1 || diaNum > 31) {
        alert('Dia entre 1 e 31, ou vazio.')
        return
      }
    }

    setBusy(true)
    try {
      const body = {
        descricao: descricao.trim(),
        valor_estimado: valorNum,
        dia_vencimento: diaNum,
        categoria_id: categoriaId || null,
        conta_pagamento_id: contaPagamentoId || null,
        tipo,
        notas: notas.trim() || null,
      }
      if (isEdit) {
        await updateFinRecurringBill(bill!.id, body)
      } else {
        await createFinRecurringBill(body)
      }
      onSaved()
    } catch (err) {
      reportApiError('RecurringBillFormModal.submit', err)
      alert('Erro ao salvar — veja o console.')
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ ...modalOverlay(), zIndex: 110 }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...modalShell(),
        minWidth: 460, maxWidth: 540,
      }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={sectionLabel()}>
            {isEdit ? 'Editar' : 'Nova'} {tipo === 'receita' ? 'receita fixa' : 'conta fixa'}
          </div>
          <div style={{ flex: 1 }} />
          <IconButton label="fechar" onClick={onClose} variant="bare">
            <X size={ICON_SIZE.md} strokeWidth={2} />
          </IconButton>
        </div>
        </div>
        <div style={modalBody()}>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Toggle Despesa / Receita — só permite trocar quando criando.
              Trocar tipo de uma bill existente quebra inferência de status. */}
          <div>
            <label style={fieldLabel()}>Tipo</label>
            <div style={{
              display: 'flex',
              gap: 0,
              background: 'var(--glass-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-pill)',
              padding: 3,
              opacity: isEdit ? 0.6 : 1,
            }}>
              {(['despesa', 'receita'] as const).map(t => {
                const active = tipo === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => !isEdit && handleTipoChange(t)}
                    disabled={isEdit}
                    style={{
                      flex: 1,
                      background: active ? 'var(--chrome-grad)' : 'transparent',
                      border: 'none',
                      cursor: isEdit ? 'not-allowed' : 'pointer',
                      color: active ? '#1a1a1c' : 'var(--color-text-tertiary)',
                      fontSize: 'var(--text-xs)',
                      fontWeight: active ? 700 : 500,
                      padding: '6px 14px',
                      borderRadius: 'var(--radius-pill)',
                      letterSpacing: '0.04em',
                      fontFamily: 'var(--font-body)',
                      boxShadow: active ? 'var(--shadow-chrome-inner)' : 'none',
                      transition: 'background var(--motion-fast) var(--ease-smooth), color var(--motion-fast) var(--ease-smooth)',
                    }}
                  >
                    {t === 'receita' ? 'receita (entrada)' : 'despesa (saída)'}
                  </button>
                )
              })}
            </div>
            {isEdit && (
              <div style={hintText()}>
                tipo não pode ser alterado depois de criada — afeta inferência
                de status. Delete e recadastre se quiser trocar.
              </div>
            )}
          </div>

          <div>
            <label style={fieldLabel()}>Descrição</label>
            <input
              autoFocus
              type="text"
              placeholder={tipo === 'receita'
                ? 'ex: Salário AMICOM, Freela XYZ, Mesada'
                : 'ex: Energia elétrica, Internet Vivo, Aluguel'}
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
            />
            <div style={hintText()}>
              Use palavras que aparecem na transação real (ex: "salário",
              "amicom", "energia") — o sistema procura por essas palavras
              pra inferir status.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 'var(--space-3)' }}>
            <div>
              <label style={fieldLabel()}>Valor estimado (R$)</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="ex: 250,00"
                value={valorEstimado}
                onChange={e => setValorEstimado(sanitizeMoneyInput(e.target.value))}
                style={{
                  ...inputStyle(), width: '100%', boxSizing: 'border-box',
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
            </div>
            <div>
              <label style={fieldLabel()}>
                {tipo === 'receita' ? 'Cai dia (1-31)' : 'Vence dia (1-31)'}
              </label>
              <input
                type="text"
                inputMode="numeric"
                placeholder={tipo === 'receita' ? 'ex: 5' : 'ex: 15'}
                value={diaVencimento}
                onChange={e => setDiaVencimento(e.target.value)}
                style={{
                  ...inputStyle(), width: '100%', boxSizing: 'border-box',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>
          </div>

          <div>
            <label style={fieldLabel()}>
              Categoria de {tipo} (opcional, mas recomendada)
            </label>
            <select
              value={categoriaId}
              onChange={e => setCategoriaId(e.target.value)}
              style={{ ...inputStyle(), width: '100%' }}
            >
              <option value="">— sem categoria —</option>
              {filteredCats.map(c => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
            <div style={hintText()}>
              Categoria ajuda a inferência de status — transação na mesma
              categoria + palavra parecida = match mais confiável.
              {filteredCats.length === 0 && (
                <span style={{ color: 'var(--color-warning)' }}>
                  {' '}Você ainda não tem categoria de {tipo} cadastrada — crie uma em Categorias.
                </span>
              )}
            </div>
          </div>

          <div>
            <label style={fieldLabel()}>
              {tipo === 'receita' ? 'Conta de recebimento (opcional)' : 'Conta pra pagar (opcional)'}
            </label>
            <select
              value={contaPagamentoId}
              onChange={e => setContaPagamentoId(e.target.value)}
              style={{ ...inputStyle(), width: '100%' }}
            >
              <option value="">— qualquer —</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.nome}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={fieldLabel()}>Notas (opcional)</label>
            <input
              type="text"
              placeholder="ex: débito automático no dia 5, ou paga em CC dia 10"
              value={notas}
              onChange={e => setNotas(e.target.value)}
              style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
            <button type="button" onClick={onClose} style={ghostButton()}>cancelar</button>
            <button type="submit" disabled={busy} style={primaryButton()}>
              <CheckCircle2 size={ICON_SIZE.xs} strokeWidth={2} />
              {busy ? 'salvando…' : (isEdit ? 'salvar' : 'criar')}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-modal: marcar como paga ────────────────────────────────────────

/** Modal pequeno que cria uma transação real pré-preenchida com os dados
 *  da bill — economiza a digitação repetitiva de "Energia · 250 · Casa". */
function MarkPaidModal({ bill, accounts, onClose, onPaid }: {
  bill: FinRecurringBill
  accounts: FinAccount[]
  onClose: () => void
  onPaid: () => void
}) {
  const { selectedMonth } = useHubFinance()

  // Default da data: dia_vencimento do mês selecionado, ou hoje se não tem
  // dia, ou último dia do mês se dia > último dia do mês
  const defaultDate = useMemo(() => {
    const lastDay = new Date(selectedMonth.year, selectedMonth.month, 0).getDate()
    if (bill.dia_vencimento) {
      const d = Math.min(bill.dia_vencimento, lastDay)
      return `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    // Sem dia de vencimento: usa hoje (dentro do mês selecionado se possível)
    const today = new Date()
    const isCurrentMonth = today.getFullYear() === selectedMonth.year
      && today.getMonth() + 1 === selectedMonth.month
    if (isCurrentMonth) {
      return `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    }
    return `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  }, [bill.dia_vencimento, selectedMonth.year, selectedMonth.month])

  const [data, setData] = useState(defaultDate)
  const [valor, setValor] = useState(String(bill.valor_estimado).replace('.', ','))
  const [descricao, setDescricao] = useState(bill.descricao)
  const [contaId, setContaId] = useState(
    bill.conta_pagamento_id ?? accounts[0]?.id ?? ''
  )
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!descricao.trim() || !contaId) {
      alert('Descrição e conta são obrigatórias.')
      return
    }
    const valorNum = parseBRL(valor)
    if (valorNum == null || valorNum <= 0) {
      alert('Valor inválido.')
      return
    }
    setBusy(true)
    try {
      // Sinal do valor depende do tipo: despesa = negativo, receita = positivo.
      // Categoria preserva pra inferência marcar como paga/recebida no refetch.
      const isReceita = bill.tipo === 'receita'
      await createFinTransaction({
        data,
        valor: isReceita ? Math.abs(valorNum) : -Math.abs(valorNum),
        descricao: descricao.trim(),
        conta_id: contaId,
        categoria_id: bill.categoria_id ?? null,
      })
      onPaid()
    } catch (err) {
      reportApiError('MarkPaidModal.submit', err)
      alert('Erro ao registrar — veja o console.')
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ ...modalOverlay(), zIndex: 110 }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...modalShell(),
        minWidth: 440, maxWidth: 520,
      }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
        <div style={{
          display: 'flex', alignItems: 'center',
          gap: 'var(--space-3)',
        }}>
          <Wallet size={ICON_SIZE.md} strokeWidth={ICON_STROKE} style={{ color: 'var(--color-text-tertiary)' }} />
          <div style={sectionLabel()}>
            Marcar como {bill.tipo === 'receita' ? 'recebida' : 'paga'}
          </div>
          <div style={{ flex: 1 }} />
          <IconButton label="fechar" onClick={onClose} variant="bare">
            <X size={ICON_SIZE.md} strokeWidth={2} />
          </IconButton>
        </div>
        </div>
        <div style={modalBody()}>

        <div style={hintText()}>
          {bill.tipo === 'receita'
            ? <>Cria uma transação de receita pré-preenchida com os dados de <strong>{bill.descricao}</strong>. Ajuste valor real se diferente do estimado. A bill vira "recebida" automaticamente.</>
            : <>Cria uma transação de despesa pré-preenchida com os dados de <strong>{bill.descricao}</strong>. Ajuste valor real se diferente do estimado. A bill vira "paga" automaticamente.</>
          }
        </div>

        <form onSubmit={submit} style={{
          display: 'flex', flexDirection: 'column',
          gap: 'var(--space-3)',
          marginTop: 'var(--space-4)',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label style={fieldLabel()}>
                Data {bill.tipo === 'receita' ? 'do recebimento' : 'do pagamento'}
              </label>
              <input
                type="date"
                value={data}
                onChange={e => setData(e.target.value)}
                style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={fieldLabel()}>Valor real (R$)</label>
              <input
                autoFocus
                type="text"
                inputMode="decimal"
                value={valor}
                onChange={e => setValor(sanitizeMoneyInput(e.target.value))}
                style={{
                  ...inputStyle(), width: '100%', boxSizing: 'border-box',
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
              <div style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                marginTop: 4,
              }}>
                estimado era {formatBRL(bill.valor_estimado)}
              </div>
            </div>
          </div>

          <div>
            <label style={fieldLabel()}>Descrição</label>
            <input
              type="text"
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <label style={fieldLabel()}>
              {bill.tipo === 'receita' ? 'Conta de recebimento' : 'Conta de pagamento'}
            </label>
            <select
              value={contaId}
              onChange={e => setContaId(e.target.value)}
              style={{ ...inputStyle(), width: '100%' }}
            >
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.nome}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
            <button type="button" onClick={onClose} style={ghostButton()}>cancelar</button>
            <button type="submit" disabled={busy} style={primaryButton()}>
              <CheckCircle2 size={ICON_SIZE.xs} strokeWidth={2} />
              {busy
                ? 'registrando…'
                : bill.tipo === 'receita' ? 'registrar recebimento' : 'registrar pagamento'}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}
