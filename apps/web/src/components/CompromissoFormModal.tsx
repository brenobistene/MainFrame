/**
 * CompromissoFormModal — criar ou editar compromisso (hora improdutiva
 * planejada). Acessado pelo /calendario.
 *
 * Suporta:
 *  - Evento único (recurrence='none')
 *  - Recorrente semanal (recurrence='weekly' + days_of_week)
 *  - Recorrente mensal (recurrence='monthly' + day_of_month)
 *
 * Estética cyber CP2077 do app — hq-glass-elevated + chamfer-cross + tech-label.
 */
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Calendar as CalIcon, X, Check, Trash2 } from 'lucide-react'

import type { Compromisso, CompromissoCreate, CompromissoRecurrence } from '../types'
import { useCreateCompromisso, useUpdateCompromisso, useDeleteCompromisso } from '../lib/app-queries'
import { confirmDialog, alertDialog } from '../lib/dialog'

const ACCENT = 'var(--color-warning)'    // âmbar — sinaliza "atenção, mas não alarme"

const WEEKDAYS = [
  { value: 0, label: 'D' },
  { value: 1, label: 'S' },
  { value: 2, label: 'T' },
  { value: 3, label: 'Q' },
  { value: 4, label: 'Q' },
  { value: 5, label: 'S' },
  { value: 6, label: 'S' },
]

export function CompromissoFormModal({
  existing,
  defaultDate,
  onClose,
}: {
  existing?: Compromisso
  defaultDate?: string             // YYYY-MM-DD (quando criando do calendar)
  onClose: () => void
}) {
  const isEdit = !!existing
  const createMut = useCreateCompromisso()
  const updateMut = useUpdateCompromisso()
  const deleteMut = useDeleteCompromisso()

  const today = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  const [title, setTitle] = useState(existing?.title ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [startDate, setStartDate] = useState(existing?.start_date ?? defaultDate ?? today)
  const [startTime, setStartTime] = useState(existing?.start_time ?? '10:00')
  const [endTime, setEndTime] = useState(existing?.end_time ?? '11:00')
  const [recurrence, setRecurrence] = useState<CompromissoRecurrence>(existing?.recurrence ?? 'none')
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(existing?.days_of_week ?? [])
  const [dayOfMonth, setDayOfMonth] = useState<number>(existing?.day_of_month ?? 1)
  const [endDate, setEndDate] = useState(existing?.end_date ?? '')

  useEffect(() => {
    if (recurrence === 'monthly' && !existing) {
      // sincroniza dayOfMonth com o dia do startDate
      const [, , d] = startDate.split('-')
      if (d) setDayOfMonth(Number(d))
    }
  }, [startDate, recurrence, existing])

  const isPending = createMut.isPending || updateMut.isPending || deleteMut.isPending

  const canSubmit = (() => {
    if (isPending) return false
    if (!title.trim()) return false
    if (!startDate || !startTime || !endTime) return false
    if (endTime <= startTime) return false
    if (recurrence === 'weekly' && daysOfWeek.length === 0) return false
    return true
  })()

  function toggleDow(d: number) {
    setDaysOfWeek(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort()
    )
  }

  async function submit() {
    if (!canSubmit) return
    const body: CompromissoCreate = {
      title: title.trim(),
      notes: notes.trim() || null,
      start_date: startDate,
      start_time: startTime,
      end_time: endTime,
      recurrence,
      days_of_week: recurrence === 'weekly' ? daysOfWeek : null,
      day_of_month: recurrence === 'monthly' ? dayOfMonth : null,
      end_date: endDate || null,
    }
    try {
      if (isEdit && existing) {
        await updateMut.mutateAsync({ id: existing.id, patch: body })
      } else {
        await createMut.mutateAsync(body)
      }
      onClose()
    } catch (err) {
      alertDialog({
        title: 'Erro ao salvar',
        message: err instanceof Error ? err.message : 'Erro inesperado.',
        variant: 'danger',
      })
    }
  }

  async function handleDelete() {
    if (!existing) return
    const ok = await confirmDialog({
      title: 'Excluir compromisso',
      message: existing.recurrence === 'none'
        ? 'Excluir esse compromisso?'
        : 'Excluir TODA a série recorrente desse compromisso?',
      confirmLabel: 'EXCLUIR',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteMut.mutateAsync(existing.id)
      onClose()
    } catch (err) {
      alertDialog({
        title: 'Erro ao excluir',
        message: err instanceof Error ? err.message : 'Erro inesperado.',
        variant: 'danger',
      })
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        overflow: 'hidden',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="hq-glass-elevated hq-grain hq-chamfer-cross"
        style={{
          width: 'min(640px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          padding: '20px 24px',
          borderLeft: `2px solid ${ACCENT}`,
          boxShadow: 'var(--shadow-modal)',
          position: 'relative',
        }}
      >
        <div aria-hidden="true" className="hq-hairline-ice" style={{ position: 'absolute', top: 0, left: 0, right: 0 }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <CalIcon size={14} strokeWidth={1.8} color={ACCENT} />
          <span className="hq-tech-label" style={{ color: ACCENT, letterSpacing: '0.28em', fontSize: 11 }}>
            {isEdit ? 'EDITAR COMPROMISSO' : 'NOVO COMPROMISSO'}
          </span>
          <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
            hora improdutiva
          </span>
          <button
            onClick={onClose}
            aria-label="fechar"
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Título */}
        <Field label="TÍTULO" required>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='ex: "corte de cabelo", "terapia", "consulta médica"'
            maxLength={200}
            style={inputStyle}
            autoFocus
          />
        </Field>

        {/* Data inicial + duração */}
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <Field label="DATA">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>
          <div style={{ width: 110 }}>
            <Field label="INÍCIO">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>
          <div style={{ width: 110 }}>
            <Field label="FIM">
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>
        </div>

        {/* Recorrência */}
        <div style={{ marginTop: 14 }}>
          <FieldLabel>RECORRÊNCIA</FieldLabel>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            {(['none', 'weekly', 'monthly'] as CompromissoRecurrence[]).map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setRecurrence(r)}
                style={{
                  ...pillStyle,
                  background: recurrence === r ? `${ACCENT}22` : 'transparent',
                  border: `1px solid ${recurrence === r ? ACCENT : 'var(--color-border)'}`,
                  color: recurrence === r ? ACCENT : 'var(--color-text-tertiary)',
                  boxShadow: recurrence === r ? `0 0 10px ${ACCENT}33` : 'none',
                }}
              >
                {r === 'none' ? 'ÚNICO' : r === 'weekly' ? 'SEMANAL' : 'MENSAL'}
              </button>
            ))}
          </div>

          {recurrence === 'weekly' && (
            <div style={{ marginTop: 10 }}>
              <FieldLabel>DIAS DA SEMANA</FieldLabel>
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                {WEEKDAYS.map(({ value, label }) => {
                  const active = daysOfWeek.includes(value)
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleDow(value)}
                      style={{
                        width: 30, height: 30,
                        background: active ? ACCENT : 'transparent',
                        border: `1px solid ${active ? ACCENT : 'var(--color-border)'}`,
                        color: active ? '#000' : 'var(--color-text-tertiary)',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11, fontWeight: 700,
                        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                      }}
                      title={['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][value]}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {recurrence === 'monthly' && (
            <div style={{ marginTop: 10 }}>
              <Field label="DIA DO MÊS">
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                  style={{ ...inputStyle, width: 80 }}
                />
              </Field>
            </div>
          )}

          {recurrence !== 'none' && (
            <div style={{ marginTop: 10 }}>
              <Field label="ATÉ (OPCIONAL)">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={{ ...inputStyle, width: 200 }}
                />
              </Field>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic', letterSpacing: '0.08em' }}>
                vazio = pra sempre
              </div>
            </div>
          )}
        </div>

        {/* Notas */}
        <div style={{ marginTop: 14 }}>
          <Field label="NOTAS (OPC)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="contexto, endereço, lembrete..."
              rows={2}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'var(--font-body)' }}
              maxLength={2000}
            />
          </Field>
        </div>

        {/* Actions */}
        <div style={{ marginTop: 18, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {isEdit && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              style={{
                ...ghostBtn,
                color: 'var(--color-error)',
                borderColor: 'var(--color-error)',
                marginRight: 'auto',
              }}
            >
              <Trash2 size={11} strokeWidth={2} />
              EXCLUIR
            </button>
          )}
          <button type="button" onClick={onClose} disabled={isPending} style={ghostBtn}>
            CANCELAR
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              ...accentBtn,
              opacity: canSubmit ? 1 : 0.4,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            <Check size={11} strokeWidth={2} />
            {isPending ? '...' : isEdit ? 'SALVAR' : 'CRIAR'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Subcomponents ──────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="hq-tech-label" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.22em' }}>
      {children}
    </div>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <FieldLabel>
        {label}
        {required && <span style={{ color: ACCENT, marginLeft: 4 }}>*</span>}
      </FieldLabel>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  background: 'rgba(0, 0, 0, 0.4)',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  borderRadius: 0,
  boxSizing: 'border-box',
  outline: 'none',
}

const pillStyle: React.CSSProperties = {
  padding: '5px 12px',
  fontFamily: 'var(--font-mono)',
  fontSize: 9, fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  borderRadius: 0,
  cursor: 'pointer',
  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
  transition: 'all 0.15s',
}

const ghostBtn: React.CSSProperties = {
  background: 'rgba(8, 12, 18, 0.55)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-tertiary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10, fontWeight: 700,
  letterSpacing: '0.18em',
  padding: '6px 14px',
  cursor: 'pointer',
  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
}

const accentBtn: React.CSSProperties = {
  background: `${ACCENT}22`,
  border: `1px solid ${ACCENT}`,
  color: ACCENT,
  fontFamily: 'var(--font-mono)',
  fontSize: 10, fontWeight: 700,
  letterSpacing: '0.18em',
  padding: '6px 14px',
  boxShadow: `0 0 10px ${ACCENT}33`,
  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
}
