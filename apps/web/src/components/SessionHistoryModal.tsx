import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, Trash2, Check, X as XIcon, AlertTriangle } from 'lucide-react'
import { parseIsoAsUtc, formatHMS } from '../utils/datetime'
import {
  editQuestSession, editTaskSession, editRoutineSession,
  editMindSession, editHealthItemSession, editRitualClusterSession,
  editLangSession,
  deleteQuestSession, deleteTaskSession, deleteRoutineSessionById,
  deleteMindSessionRow, deleteHealthItemSessionRow, deleteRitualClusterRow,
  deleteLangSessionRow,
  reportApiError,
} from '../api'
import {
  modalOverlay, modalShell, modalHairline, modalHeader, modalBody,
} from '../pages/finance/components/styleHelpers'
import { confirmDialog, alertDialog } from '../lib/dialog'

/**
 * Modal listando todas as sessões (fechadas + em andamento) de uma entity.
 * Triggered pelo cronômetro do RunnableControls e pelo banner global.
 *
 * Estilo cyber CP2077: chamfer-bl + ice borders + mono `// LABEL` + glow.
 *
 * Quando `kind` é fornecido junto com sessões que têm `id`, cada linha
 * ganha botões editar (lápis) + excluir (lixeira). Editar abre subdialog
 * inline com 2 inputs `datetime-local`. Sessão em andamento (ended_at=null)
 * só permite editar `started_at` — pra mexer no fim, usuário pausa antes.
 */
export function SessionHistoryModal({ sessions, onClose, kind, onChanged }: {
  sessions: { id?: number; started_at: string; ended_at: string | null }[]
  onClose: () => void
  /** Tipo da entity — necessário pra escolher o endpoint de PATCH/DELETE.
   *  Se omitido, modal fica em modo read-only (sem editar/excluir). */
  kind?: 'quest' | 'task' | 'routine' | 'mind' | 'health' | 'ritual' | 'lang'
  /** Disparado após uma edição/exclusão bem-sucedida. Geralmente é o
   *  `onSessionUpdate` do parent, que refaz fetch global de sessões. */
  onChanged?: () => void
}) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const canEdit = !!kind && !!onChanged

  function fmtRange(startIso: string, endIso: string | null): { time: string; date: string; ongoing: boolean } {
    if (!startIso) return { time: '', date: '', ongoing: false }
    const start = parseIsoAsUtc(startIso)
    const startT = start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })
    const date = start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    if (!endIso) return { time: `${startT} → LIVE`, date, ongoing: true }
    const end = parseIsoAsUtc(endIso)
    const endT = end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })
    return { time: `${startT} → ${endT}`, date, ongoing: false }
  }

  function durSec(s: { started_at: string; ended_at: string | null }): number {
    if (!s.started_at) return 0
    const st = parseIsoAsUtc(s.started_at).getTime()
    const en = s.ended_at ? parseIsoAsUtc(s.ended_at).getTime() : Date.now()
    return Math.max(0, Math.floor((en - st) / 1000))
  }

  const editFn =
    kind === 'quest' ? editQuestSession
    : kind === 'task' ? editTaskSession
    : kind === 'routine' ? editRoutineSession
    : kind === 'mind' ? editMindSession
    : kind === 'health' ? editHealthItemSession
    : kind === 'ritual' ? editRitualClusterSession
    : kind === 'lang' ? editLangSession
    : editRoutineSession  // fallback inalcançável (canEdit guarda chamadas)
  const deleteFn =
    kind === 'quest' ? deleteQuestSession
    : kind === 'task' ? deleteTaskSession
    : kind === 'routine' ? deleteRoutineSessionById
    : kind === 'mind' ? deleteMindSessionRow
    : kind === 'health' ? deleteHealthItemSessionRow
    : kind === 'ritual' ? deleteRitualClusterRow
    : kind === 'lang' ? deleteLangSessionRow
    : deleteRoutineSessionById

  async function handleDelete(sid: number) {
    if (!canEdit) return
    const ok = await confirmDialog({
      title: 'Excluir sessão',
      message: 'Excluir esta sessão?\nO tempo registrado será removido permanentemente.',
      confirmLabel: 'EXCLUIR',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteFn(sid)
      onChanged!()
    } catch (err) {
      reportApiError('SessionHistoryModal.delete', err)
      alertDialog({ title: 'Erro', message: 'Erro ao excluir — veja o console (F12).', variant: 'danger' })
    }
  }

  const total = sessions.reduce((sum, s) => sum + durSec(s), 0)
  const ongoingCount = sessions.filter(s => s.ended_at == null).length

  return createPortal(
    <div onClick={onClose} style={{ ...modalOverlay(), zIndex: 1000 }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          ...modalShell(),
          maxWidth: 520, minWidth: 380, maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
          // Override do shape pra alinhar com chamfer cyber.
          borderRadius: 0,
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)',
        }}
      >
        <div style={modalHairline} />
        <div style={modalHeader()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                aria-hidden="true"
                style={{
                  width: 3, height: 16,
                  background: 'var(--color-ice)',
                  boxShadow: '0 0 8px var(--color-ice-glow)',
                }}
              />
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11, fontWeight: 700,
                color: 'var(--color-ice-light)',
                letterSpacing: '0.25em', textTransform: 'uppercase',
              }}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                SESSION.LOG
                <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>
                  [{sessions.length.toString().padStart(2, '0')}]
                </span>
              </span>
            </div>
            <button
              onClick={onClose}
              title="Fechar"
              style={{
                background: 'rgba(8, 12, 18, 0.55)',
                border: '1px solid var(--color-border)',
                cursor: 'pointer',
                color: 'var(--color-text-tertiary)',
                width: 28, height: 28,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 0,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'var(--color-accent-light)'
                e.currentTarget.style.borderColor = 'rgba(159, 18, 57, 0.45)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--color-text-tertiary)'
                e.currentTarget.style.borderColor = 'var(--color-border)'
              }}
            >
              <XIcon size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div style={{ ...modalBody(), overflowY: 'auto', flex: 1 }}>

          {warning && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', marginBottom: 14,
              background: 'rgba(200, 169, 122, 0.12)',
              border: '1px solid var(--color-warning)',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
              boxShadow: '0 0 10px rgba(200, 169, 122, 0.18)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10, fontWeight: 700,
              color: 'var(--color-warning-light)',
              letterSpacing: '0.18em', textTransform: 'uppercase',
            }}>
              <AlertTriangle size={13} strokeWidth={2} />
              <span>{warning}</span>
            </div>
          )}

          {sessions.length === 0 ? (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10, fontWeight: 700,
              color: 'var(--color-text-muted)',
              letterSpacing: '0.18em', textTransform: 'uppercase',
              padding: '14px 16px',
              border: '1px dashed rgba(143, 191, 211, 0.30)',
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
            }}>
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              NENHUMA SESSÃO INICIADA
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sessions.map((s, idx) => {
                const isEditing = editingId != null && s.id === editingId
                const range = fmtRange(s.started_at, s.ended_at)
                const accentColor = range.ongoing ? 'var(--color-accent-vivid)' : 'var(--color-ice-light)'
                return (
                  <div
                    key={s.id ?? idx}
                    style={{
                      padding: '10px 12px',
                      background: 'rgba(8, 12, 18, 0.55)',
                      border: '1px solid rgba(143, 191, 211, 0.18)',
                      borderLeft: `2px solid ${accentColor}`,
                      borderRadius: 0,
                      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
                      color: 'var(--color-text-primary)',
                      transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
                    }}
                    onMouseEnter={e => {
                      if (isEditing) return
                      e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.40)'
                      e.currentTarget.style.boxShadow = `0 0 10px ${range.ongoing ? 'rgba(159, 18, 57, 0.20)' : 'rgba(143, 191, 211, 0.15)'}`
                      e.currentTarget.style.transform = 'translateX(2px)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.18)'
                      e.currentTarget.style.boxShadow = 'none'
                      e.currentTarget.style.transform = 'translateX(0)'
                    }}
                  >
                    {isEditing ? (
                      <SessionEditForm
                        session={s}
                        onCancel={() => setEditingId(null)}
                        onSave={async (patch) => {
                          if (!canEdit || !s.id) return
                          try {
                            const resp = await editFn(s.id, patch) as any
                            setEditingId(null)
                            setWarning(resp?.overlap_warning
                              ? 'ATENÇÃO: SESSÃO SE SOBREPÕE COM OUTRA DA MESMA ATIVIDADE'
                              : null)
                            onChanged!()
                          } catch (err: any) {
                            alertDialog({ title: 'Erro', message: err?.detail || err?.message || 'Erro ao salvar.', variant: 'danger' })
                          }
                        }}
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          {/* Header: nº sessão + duração */}
                          <div style={{
                            display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
                            fontFamily: 'var(--font-mono)',
                          }}>
                            <span style={{
                              fontSize: 9, fontWeight: 700,
                              color: 'var(--color-text-muted)',
                              letterSpacing: '0.22em', textTransform: 'uppercase',
                            }}>
                              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                              SESSÃO {String(idx + 1).padStart(2, '0')}
                            </span>
                            <span style={{
                              fontSize: 13, fontWeight: 700,
                              color: accentColor,
                              letterSpacing: '0.05em',
                              textShadow: range.ongoing ? '0 0 8px rgba(159, 18, 57, 0.45)' : 'none',
                            }}>
                              {formatHMS(durSec(s))}
                            </span>
                            {range.ongoing && (
                              <span style={{
                                fontSize: 8, fontWeight: 700,
                                color: 'var(--color-accent-light)',
                                background: 'rgba(159, 18, 57, 0.14)',
                                border: '1px solid var(--color-accent-primary)',
                                padding: '2px 6px',
                                letterSpacing: '0.22em', textTransform: 'uppercase',
                                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
                                boxShadow: '0 0 6px rgba(159, 18, 57, 0.30)',
                              }}>
                                LIVE
                              </span>
                            )}
                          </div>
                          {/* Range time + date */}
                          <div style={{
                            marginTop: 5,
                            display: 'flex', gap: 10, flexWrap: 'wrap',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10, fontWeight: 700,
                            letterSpacing: '0.15em', textTransform: 'uppercase',
                          }}>
                            <span style={{ color: 'var(--color-text-tertiary)' }}>
                              <span style={{ color: 'var(--color-text-muted)', marginRight: 4 }}>T</span>
                              {range.time}
                            </span>
                            <span style={{ color: 'var(--color-text-muted)' }}>·</span>
                            <span style={{ color: 'var(--color-text-tertiary)' }}>
                              <span style={{ color: 'var(--color-text-muted)', marginRight: 4 }}>D</span>
                              {range.date}
                            </span>
                          </div>
                        </div>
                        {canEdit && s.id != null && (
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                            <button
                              onClick={() => { setEditingId(s.id!); setWarning(null) }}
                              title="Editar horários"
                              style={iconBtnStyle}
                              onMouseEnter={e => {
                                e.currentTarget.style.color = 'var(--color-ice-light)'
                                e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                                e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.color = 'var(--color-text-tertiary)'
                                e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.18)'
                                e.currentTarget.style.background = 'rgba(143, 191, 211, 0.04)'
                              }}
                            >
                              <Pencil size={12} strokeWidth={1.8} />
                            </button>
                            <button
                              onClick={() => handleDelete(s.id!)}
                              title="Excluir sessão"
                              style={iconBtnStyle}
                              onMouseEnter={e => {
                                e.currentTarget.style.color = 'var(--color-accent-light)'
                                e.currentTarget.style.borderColor = 'rgba(159, 18, 57, 0.45)'
                                e.currentTarget.style.background = 'rgba(159, 18, 57, 0.10)'
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.color = 'var(--color-text-tertiary)'
                                e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.18)'
                                e.currentTarget.style.background = 'rgba(143, 191, 211, 0.04)'
                              }}
                            >
                              <Trash2 size={12} strokeWidth={1.8} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {/* Footer com totais — paddingTop hairline ice */}
              <div style={{
                marginTop: 14, paddingTop: 12,
                borderTop: '1px solid var(--color-ice-deep)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                flexWrap: 'wrap', gap: 8,
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                }}>
                  <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                  TOTAL · {sessions.length.toString().padStart(2, '0')} SESS
                  {ongoingCount > 0 && (
                    <span style={{ color: 'var(--color-accent-light)', marginLeft: 6 }}>
                      · {ongoingCount} LIVE
                    </span>
                  )}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 16, fontWeight: 700,
                  color: 'var(--color-ice-light)',
                  letterSpacing: '-0.02em',
                  textShadow: '0 0 12px var(--color-ice-glow)',
                }}>
                  {formatHMS(total)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

const iconBtnStyle: React.CSSProperties = {
  background: 'rgba(143, 191, 211, 0.04)',
  border: '1px solid rgba(143, 191, 211, 0.18)',
  cursor: 'pointer',
  color: 'var(--color-text-tertiary)',
  padding: '5px 7px',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 0,
  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
  transition: 'all 0.15s',
}

/** Form inline pra editar started_at/ended_at de uma sessão. */
function SessionEditForm({ session, onSave, onCancel }: {
  session: { id?: number; started_at: string; ended_at: string | null }
  onSave: (patch: { started_at?: string; ended_at?: string | null }) => Promise<void>
  onCancel: () => void
}) {
  // ISO UTC do backend → string local pro input datetime-local (sem tz).
  const toLocalInput = (iso: string): string => {
    if (!iso) return ''
    const d = parseIsoAsUtc(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const toIsoUtc = (local: string): string => {
    if (!local) return ''
    return new Date(local).toISOString()
  }

  const isOngoing = session.ended_at == null
  const [start, setStart] = useState(toLocalInput(session.started_at))
  const [end, setEnd] = useState(session.ended_at ? toLocalInput(session.ended_at) : '')
  const [saving, setSaving] = useState(false)

  const durMin = (() => {
    if (!start) return 0
    const s = new Date(start).getTime()
    const e = end ? new Date(end).getTime() : Date.now()
    return Math.max(0, Math.floor((e - s) / 60000))
  })()
  const durLabel = (() => {
    const h = Math.floor(durMin / 60)
    const m = durMin % 60
    if (h > 0 && m > 0) return `${h}h ${m}m`
    if (h > 0) return `${h}h`
    return `${m}m`
  })()

  async function handleSave() {
    setSaving(true)
    try {
      const patch: { started_at?: string; ended_at?: string | null } = {}
      const startIso = toIsoUtc(start)
      if (startIso !== session.started_at) patch.started_at = startIso
      if (!isOngoing) {
        const endIso = end ? toIsoUtc(end) : null
        if (endIso !== session.ended_at) patch.ended_at = endIso
      }
      await onSave(patch)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9, fontWeight: 700,
          color: 'var(--color-ice-light)',
          letterSpacing: '0.22em', textTransform: 'uppercase',
        }}>
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
          INÍCIO
        </span>
        <input
          type="datetime-local"
          autoComplete="off"
          name="session-start"
          value={start}
          onChange={e => setStart(e.target.value)}
          style={inputStyle}
          onFocus={e => {
            e.currentTarget.style.borderColor = 'var(--color-ice)'
            e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = 'var(--color-border)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9, fontWeight: 700,
          color: 'var(--color-ice-light)',
          letterSpacing: '0.22em', textTransform: 'uppercase',
        }}>
          <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
          FIM
          {isOngoing && (
            <span style={{ color: 'var(--color-warning-light)', marginLeft: 8, fontStyle: 'normal' }}>
              · EM ANDAMENTO — PAUSE ANTES PRA EDITAR
            </span>
          )}
        </span>
        <input
          type="datetime-local"
          autoComplete="off"
          name="session-end"
          value={end}
          onChange={e => setEnd(e.target.value)}
          disabled={isOngoing}
          style={{ ...inputStyle, opacity: isOngoing ? 0.4 : 1, cursor: isOngoing ? 'not-allowed' : 'text' }}
          onFocus={e => {
            if (isOngoing) return
            e.currentTarget.style.borderColor = 'var(--color-ice)'
            e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = 'var(--color-border)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        />
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10, fontWeight: 700,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.22em', textTransform: 'uppercase',
        marginTop: 2,
      }}>
        <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
        DURAÇÃO · <span style={{ color: 'var(--color-ice-light)', textTransform: 'lowercase', letterSpacing: '0.05em' }}>{durLabel}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            ...actionBtn,
            background: 'rgba(94, 122, 82, 0.16)',
            color: 'var(--color-success-light)',
            border: '1px solid var(--color-success)',
            boxShadow: '0 0 10px rgba(94, 122, 82, 0.25)',
            opacity: saving ? 0.6 : 1,
          }}
          onMouseEnter={e => {
            if (saving) return
            e.currentTarget.style.background = 'rgba(94, 122, 82, 0.24)'
            e.currentTarget.style.boxShadow = '0 0 16px rgba(94, 122, 82, 0.45)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(94, 122, 82, 0.16)'
            e.currentTarget.style.boxShadow = '0 0 10px rgba(94, 122, 82, 0.25)'
          }}
        >
          <Check size={11} strokeWidth={2.4} /> {saving ? 'SALVANDO…' : 'SALVAR'}
        </button>
        <button
          onClick={onCancel}
          style={{
            ...actionBtn,
            background: 'rgba(8, 12, 18, 0.55)',
            color: 'var(--color-text-tertiary)',
            border: '1px solid var(--color-border)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = 'var(--color-accent-light)'
            e.currentTarget.style.borderColor = 'rgba(159, 18, 57, 0.45)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--color-text-tertiary)'
            e.currentTarget.style.borderColor = 'var(--color-border)'
          }}
        >
          <XIcon size={11} strokeWidth={2.4} /> CANCELAR
        </button>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(8, 12, 18, 0.55)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-ice-light)',
  padding: '6px 10px',
  fontSize: 11, fontWeight: 700,
  borderRadius: 0,
  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
  outline: 'none',
  fontFamily: 'var(--font-mono)',
  letterSpacing: '0.05em',
  colorScheme: 'dark',
  transition: 'border-color 0.15s, box-shadow 0.15s',
}

const actionBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 10, fontWeight: 700,
  padding: '7px 14px',
  letterSpacing: '0.22em', textTransform: 'uppercase',
  borderRadius: 0,
  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
  transition: 'all 0.15s',
}
