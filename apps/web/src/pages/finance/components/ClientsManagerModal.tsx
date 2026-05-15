import { useEffect, useState } from 'react'
import { Trash2, Users, X } from 'lucide-react'
import {
  fetchFinClients, createFinClient, updateFinClient, deleteFinClient,
  reportApiError,
} from '../../../api'
import type { FinClient } from '../../../types'
import {
  sectionLabel, fieldLabel, inputStyle, primaryButton, ghostButton, modalOverlay,
  modalShell, modalHairline, modalHeader, modalBody,
} from './styleHelpers'
import { confirmDialog, alertDialog } from '../../../lib/dialog'

/**
 * Modal de gerenciamento de clientes — abre via botão "gerenciar" no card
 * de Clientes da FreelasPage. Lista + criar + editar + deletar.
 */
export function ClientsManagerModal({ onClose, onChanged }: {
  onClose: () => void
  onChanged: () => void
}) {
  const [clients, setClients] = useState<FinClient[]>([])
  const [loading, setLoading] = useState(true)
  const [editingClient, setEditingClient] = useState<FinClient | 'new' | null>(null)

  function refresh() {
    setLoading(true)
    fetchFinClients()
      .then(setClients)
      .catch(err => reportApiError('ClientsManagerModal.fetch', err))
      .finally(() => setLoading(false))
  }
  useEffect(() => { refresh() }, [])

  return (
    <>
      <div onClick={onClose} style={modalOverlay()}>
        <div onClick={e => e.stopPropagation()} style={{
          ...modalShell(),
          width: 'min(720px, calc(100vw - 16px))', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={modalHairline} />
          <div style={modalHeader()}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <Users size={14} strokeWidth={1.8} style={{ color: 'var(--color-text-tertiary)' }} />
            <div style={sectionLabel()}>Gerenciar clientes</div>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setEditingClient('new')}
              style={{ ...ghostButton(), fontSize: 9, padding: '6px 10px' }}
            >
              + novo cliente
            </button>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', padding: 4,
              display: 'inline-flex', marginLeft: 6,
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
            Cadastre quem te paga (com CPF/CNPJ) pra ativar o auto-vínculo
            de receita: quando uma transação chega com esse CPF na descrição,
            o sistema marca automaticamente a parcela esperada como recebida.
          </div>

          <div>
            {loading ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                carregando…
              </div>
            ) : clients.length === 0 ? (
              <div style={{
                padding: '20px 16px',
                border: '1px dashed var(--color-border)', borderRadius: 4,
                textAlign: 'center', color: 'var(--color-text-muted)',
                fontSize: 11, fontStyle: 'italic',
              }}>
                nenhum cliente cadastrado.
              </div>
            ) : (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10,
              }}>
                {clients.map(c => (
                  <div
                    key={c.id}
                    onClick={() => setEditingClient(c)}
                    style={{
                      background: 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-border)',
                      borderLeft: '3px solid var(--color-accent-light)',
                      borderRadius: 4, padding: '12px 14px',
                      cursor: 'pointer', transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-accent-light)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
                  >
                    <div style={{
                      fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {c.nome}
                    </div>
                    {c.cpf_cnpj ? (
                      <div style={{
                        fontSize: 10, color: 'var(--color-text-tertiary)',
                        marginTop: 4, fontFamily: 'var(--font-mono)',
                        letterSpacing: '0.05em',
                      }}>
                        {c.cpf_cnpj}
                      </div>
                    ) : (
                      <div style={{
                        fontSize: 10, color: 'var(--color-text-muted)',
                        marginTop: 4, fontStyle: 'italic',
                      }}>
                        sem CPF/CNPJ — auto-vínculo desativado
                      </div>
                    )}
                    {c.notas && (
                      <div style={{
                        fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {c.notas}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      {editingClient && (
        <ClientFormModal
          client={editingClient === 'new' ? null : editingClient}
          onClose={() => setEditingClient(null)}
          onSaved={() => { setEditingClient(null); refresh(); onChanged() }}
          onDeleted={() => { setEditingClient(null); refresh(); onChanged() }}
        />
      )}
    </>
  )
}

// ─── Sub-modal de cliente ────────────────────────────────────────────────

function ClientFormModal({ client, onClose, onSaved, onDeleted }: {
  client: FinClient | null
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const isNew = client === null
  const [nome, setNome] = useState(client?.nome ?? '')
  const [cpfCnpj, setCpfCnpj] = useState(client?.cpf_cnpj ?? '')
  const [notas, setNotas] = useState(client?.notas ?? '')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) { alertDialog({ title: 'Nome obrigatório', message: 'Nome é obrigatório.', variant: 'warning' }); return }
    // Valida CPF/CNPJ se preenchido — sem isso o auto-vínculo por descrição
    // nunca casa porque depende de match exato do formato.
    const docTrim = cpfCnpj.trim()
    if (docTrim) {
      const stripped = docTrim.replace(/\D/g, '')
      const isCpf = stripped.length === 11
      const isCnpj = stripped.length === 14
      if (!isCpf && !isCnpj) {
        alertDialog({
          title: 'CPF/CNPJ inválido',
          message: 'Use formato com 11 dígitos (CPF) ou 14 dígitos (CNPJ). Pontuação opcional. Deixe em branco se não tiver.',
          variant: 'warning',
        })
        return
      }
    }
    setBusy(true)
    try {
      const body = {
        nome: nome.trim(),
        cpf_cnpj: docTrim || null,
        notas: notas.trim() || null,
      }
      if (isNew) await createFinClient(body)
      else await updateFinClient(client!.id, body)
      onSaved()
    } catch (err) {
      reportApiError('ClientFormModal.submit', err)
      alertDialog({ title: 'Erro', message: 'Erro ao salvar — veja o console.', variant: 'danger' })
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!client) return
    const ok = await confirmDialog({
      title: 'Deletar cliente',
      message: `Deletar cliente "${client.nome}"?\nProjetos vinculados continuam existindo, mas perdem o vínculo com cliente (e o auto-vínculo de receita).`,
      confirmLabel: 'DELETAR',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await deleteFinClient(client.id)
      onDeleted()
    } catch (err) {
      reportApiError('ClientFormModal.delete', err)
      alertDialog({ title: 'Erro', message: 'Erro ao deletar — veja o console.', variant: 'danger' })
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ ...modalOverlay(), zIndex: 110 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...modalShell(), minWidth: 420, maxWidth: 520 }}>
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <div style={sectionLabel()}>{isNew ? 'Novo cliente' : 'Editar cliente'}</div>
        </div>
        <div style={modalBody()}>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={fieldLabel()}>Nome</label>
            <input
              autoFocus
              type="text" placeholder="ex: Joana Silva, Empresa XYZ"
              value={nome} onChange={e => setNome(e.target.value)}
              style={inputStyle()}
            />
          </div>
          <div>
            <label style={fieldLabel()}>CPF / CNPJ (opcional)</label>
            <input
              type="text" placeholder="ex: 123.456.789-10 ou 12.345.678/0001-99"
              value={cpfCnpj} onChange={e => setCpfCnpj(e.target.value)}
              style={{ ...inputStyle(), fontFamily: 'var(--font-mono)' }}
            />
            <div style={{
              fontSize: 9, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic',
            }}>
              quando esse CPF/CNPJ aparecer na descrição de uma transação de
              entrada, o sistema vincula automaticamente à parcela pendente
              do projeto desse cliente.
            </div>
          </div>
          <div>
            <label style={fieldLabel()}>Notas (opcional)</label>
            <input
              type="text" placeholder="ex: cliente desde 2024, paga sempre via Pix"
              value={notas} onChange={e => setNotas(e.target.value)}
              style={inputStyle()}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 8 }}>
            {!isNew ? (
              <button type="button" onClick={handleDelete} disabled={busy} style={{
                ...ghostButton(),
                color: 'var(--color-accent-primary)',
                borderColor: 'var(--color-accent-primary)',
              }}>
                <Trash2 size={11} strokeWidth={1.8} style={{ marginRight: 4 }} />
                deletar
              </button>
            ) : <div />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onClose} style={ghostButton()}>cancelar</button>
              <button type="submit" disabled={busy} style={primaryButton()}>
                {busy ? 'salvando…' : (isNew ? 'criar' : 'salvar')}
              </button>
            </div>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}

