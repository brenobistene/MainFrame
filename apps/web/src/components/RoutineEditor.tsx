import { useState } from 'react'
import { Repeat, Clock, Flag, Trash2, Check } from 'lucide-react'
import type { Routine } from '../types'
import { PrioritySelect } from './PrioritySelect'
import { parseTimeToMinutes, minutesToHmm } from '../utils/datetime'

/**
 * Form for creating/editing a Routine. Title + recurrence (diária / dias úteis
 * / semanal / mensal) + day pickers + optional time window or estimated
 * duration. The parent owns `formData` state and decides when to save.
 *
 * Layout: mini-modal inline — hairline oxblood top, header grainy com input
 * de título grande, body com seções (Recorrência, Quando, Prioridade)
 * separadas por dividers sutis, footer grainy com ações (destructive à
 * esquerda, primary+cancel à direita).
 */
export function RoutineEditor({
  routine,
  formData,
  setFormData,
  onSave,
  onDelete,
  onCancel
}: {
  routine: Routine | null
  formData: Partial<Routine>
  setFormData: (data: Partial<Routine>) => void
  onSave: () => void
  onDelete: () => void
  onCancel: () => void
}) {
  const dayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
  const pythonDayToDom = (pd: number) => (pd + 1) % 7

  // Modo "horário fixo" vs "duração estimada" como state local (não derivado
  // do formData). Derivar causava trava: clicar "horário fixo" limpava
  // `estimated_minutes` mas não populava `start_time`, então o modo ficava
  // 'duration' no próximo render. Com state local, o toggle sempre funciona.
  const [mode, setMode] = useState<'fixed' | 'duration'>(() =>
    (formData.start_time || formData.end_time) ? 'fixed' : 'duration'
  )
  // Buffer local do input de duração — permite digitar "1:" antes de completar
  // sem perder o estado enquanto o parser não consegue extrair minutos.
  const [estimatedInput, setEstimatedInput] = useState<string>(
    formData.estimated_minutes ? minutesToHmm(formData.estimated_minutes) : ''
  )
  const switchMode = (m: 'fixed' | 'duration') => {
    if (m === 'fixed') {
      setFormData({ ...formData, estimated_minutes: null })
    } else {
      setFormData({ ...formData, start_time: null, end_time: null })
    }
    setMode(m)
  }

  const toggleDay = (pythonDay: number) => {
    const days = formData.days_of_week ? formData.days_of_week.split(',').map(Number) : []
    const idx = days.indexOf(pythonDay)
    if (idx > -1) {
      days.splice(idx, 1)
    } else {
      days.push(pythonDay)
    }
    setFormData({ ...formData, days_of_week: days.length > 0 ? days.join(',') : null })
  }

  const selectedDays = formData.days_of_week ? formData.days_of_week.split(',').map(Number) : []
  const recurrence = formData.recurrence ?? 'daily'
  const titleEmpty = !(formData.title ?? '').trim()
  const timeMismatch = (formData.start_time && !formData.end_time) || (!formData.start_time && formData.end_time)

  const RECURRENCES: { key: NonNullable<Routine['recurrence']>; label: string }[] = [
    { key: 'daily',    label: 'Diária' },
    { key: 'weekdays', label: 'Dias úteis' },
    { key: 'weekly',   label: 'Semanal' },
    { key: 'monthly',  label: 'Mensal' },
  ]

  return (
    <div
      className="hq-animate-fade-up"
      style={{
        background: 'var(--color-bg-primary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-lg)',
        marginBottom: 'var(--space-4)',
      }}
    >
      {/* Hairline ice elétrica — assinatura HUD CP2077 */}
      <div className="hq-hairline-ice" />

      {/* Header compacto: eyebrow + título input em linha */}
      <div
        className="hq-grain"
        style={{
          padding: '14px 18px 12px',
          background: `
            radial-gradient(ellipse 100% 80% at 0% 0%, rgba(159, 18, 57, 0.05), transparent 60%)
          `,
          borderBottom: '1px solid var(--color-divider)',
        }}
      >
        <div style={{
          fontSize: 9,
          color: 'var(--color-accent-light)',
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          fontWeight: 700,
          marginBottom: 6,
          lineHeight: 1,
        }}>
          {routine ? 'Editar' : 'Nova rotina'}
        </div>

        <input
          type="text"
          autoComplete="off"
          autoFocus
          aria-label="Título da rotina"
          placeholder="Nome da rotina"
          value={formData.title || ''}
          onChange={e => setFormData({ ...formData, title: e.target.value })}
          onFocus={e => { e.currentTarget.style.borderBottomColor = 'var(--color-accent-primary)' }}
          onBlur={e => { e.currentTarget.style.borderBottomColor = 'transparent' }}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid transparent',
            color: 'var(--color-text-primary)',
            padding: '2px 0 4px',
            fontSize: 'var(--text-md)',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            boxSizing: 'border-box',
            outline: 'none',
            fontFamily: 'inherit',
            transition: 'border-color var(--motion-fast) var(--ease-smooth)',
          }}
        />
      </div>

      {/* Body compacto */}
      <div style={{
        padding: '14px 18px',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
      }}>

        {/* ─── Recorrência ─── */}
        <Section icon={<Repeat size={11} strokeWidth={2} />} label="Recorrência">
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {RECURRENCES.map(rec => {
              const active = recurrence === rec.key
              return (
                <button
                  key={rec.key}
                  onClick={() => setFormData({ ...formData, recurrence: rec.key, days_of_week: null, day_of_month: null })}
                  style={{
                    background: active ? 'var(--color-accent-primary)' : 'transparent',
                    border: `1px solid ${active ? 'var(--color-accent-primary)' : 'var(--color-border)'}`,
                    color: active ? 'var(--color-bg-primary)' : 'var(--color-text-secondary)',
                    cursor: 'pointer',
                    padding: '5px 10px',
                    fontSize: 11,
                    borderRadius: 'var(--radius-sm)',
                    fontWeight: active ? 600 : 500,
                    transition: 'all var(--motion-fast) var(--ease-smooth)',
                  }}
                  onMouseEnter={e => {
                    if (active) return
                    e.currentTarget.style.borderColor = 'var(--color-border-chrome)'
                    e.currentTarget.style.color = 'var(--color-text-primary)'
                  }}
                  onMouseLeave={e => {
                    if (active) return
                    e.currentTarget.style.borderColor = 'var(--color-border)'
                    e.currentTarget.style.color = 'var(--color-text-secondary)'
                  }}
                >
                  {rec.label}
                </button>
              )
            })}
          </div>

          {recurrence === 'weekly' && (
            <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {Array.from({ length: 7 }, (_, i) => i).map(pythonDay => {
                const sel = selectedDays.includes(pythonDay)
                return (
                  <button
                    key={pythonDay}
                    onClick={() => toggleDay(pythonDay)}
                    aria-pressed={sel}
                    style={{
                      minWidth: 32, height: 26,
                      padding: '0 6px',
                      borderRadius: 'var(--radius-sm)',
                      background: sel ? 'var(--color-accent-primary)' : 'transparent',
                      border: `1px solid ${sel ? 'var(--color-accent-primary)' : 'var(--color-border)'}`,
                      color: sel ? 'var(--color-bg-primary)' : 'var(--color-text-secondary)',
                      cursor: 'pointer',
                      fontSize: 10,
                      fontWeight: sel ? 600 : 500,
                      fontFamily: 'var(--font-mono)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all var(--motion-fast) var(--ease-smooth)',
                    }}
                    onMouseEnter={e => {
                      if (sel) return
                      e.currentTarget.style.borderColor = 'var(--color-border-chrome)'
                      e.currentTarget.style.color = 'var(--color-text-primary)'
                    }}
                    onMouseLeave={e => {
                      if (sel) return
                      e.currentTarget.style.borderColor = 'var(--color-border)'
                      e.currentTarget.style.color = 'var(--color-text-secondary)'
                    }}
                  >
                    {dayLabels[pythonDayToDom(pythonDay)]}
                  </button>
                )
              })}
            </div>
          )}

          {recurrence === 'monthly' && (
            <div style={{
              marginTop: 8,
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, color: 'var(--color-text-secondary)',
            }}>
              <span>Todo dia</span>
              <input
                type="number"
                autoComplete="off"
                min="1" max="31"
                placeholder="15"
                aria-label="Dia do mês"
                value={formData.day_of_month || ''}
                onChange={e => setFormData({ ...formData, day_of_month: e.target.value ? parseInt(e.target.value) : null })}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-accent-primary)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
                style={{
                  width: 44, height: 26,
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                  padding: '0 6px',
                  fontSize: 11, borderRadius: 'var(--radius-sm)',
                  outline: 'none',
                  fontFamily: 'var(--font-mono)', fontWeight: 600,
                  textAlign: 'center',
                  fontVariantNumeric: 'tabular-nums',
                  transition: 'border-color var(--motion-fast) var(--ease-smooth)',
                }}
              />
              <span>do mês</span>
            </div>
          )}
        </Section>

        {/* ─── Quando ─── */}
        <Section icon={<Clock size={11} strokeWidth={2} />} label="Quando">
          <div style={{
            display: 'inline-flex',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: 2,
            background: 'transparent',
          }}>
            {([
              { key: 'fixed' as const,    label: 'Horário' },
              { key: 'duration' as const, label: 'Duração' },
            ]).map(m => {
              const active = mode === m.key
              return (
                <button
                  key={m.key}
                  onClick={() => switchMode(m.key)}
                  style={{
                    background: active ? 'var(--color-bg-secondary)' : 'transparent',
                    border: 'none',
                    color: active ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                    cursor: 'pointer',
                    padding: '4px 10px',
                    fontSize: 10,
                    borderRadius: 2,
                    fontWeight: active ? 600 : 500,
                    transition: 'all var(--motion-fast) var(--ease-smooth)',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--color-text-primary)' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--color-text-tertiary)' }}
                >
                  {m.label}
                </button>
              )
            })}
          </div>

          {mode === 'fixed' && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <TimeInput
                  value={formData.start_time || ''}
                  onChange={v => setFormData({ ...formData, start_time: v || null })}
                  ariaLabel="Horário de início"
                />
                <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>—</span>
                <TimeInput
                  value={formData.end_time || ''}
                  onChange={v => setFormData({ ...formData, end_time: v || null })}
                  ariaLabel="Horário de fim"
                />
              </div>
              {timeMismatch && (
                <div role="alert" style={{
                  fontSize: 10, color: 'var(--color-error)', marginTop: 4,
                }}>
                  Preencha início e fim.
                </div>
              )}
            </div>
          )}

          {mode === 'duration' && (
            <input
              type="text"
              autoComplete="off"
              placeholder="ex: 1:30 ou 90"
              aria-label="Duração estimada"
              title="Aceita '1:30' ou minutos puros como '90'"
              value={estimatedInput}
              onChange={e => {
                setEstimatedInput(e.target.value)
                const parsed = parseTimeToMinutes(e.target.value)
                setFormData({ ...formData, estimated_minutes: parsed ?? null })
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-accent-primary)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
              style={{
                width: 140, height: 26, marginTop: 8,
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                padding: '0 8px',
                fontSize: 11, borderRadius: 'var(--radius-sm)',
                outline: 'none', boxSizing: 'border-box',
                fontFamily: 'var(--font-mono)', fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
                transition: 'border-color var(--motion-fast) var(--ease-smooth)',
              }}
            />
          )}
        </Section>

        {/* ─── Prioridade — inline compacta ─── */}
        <Section icon={<Flag size={11} strokeWidth={2} />} label="Prioridade">
          <PrioritySelect
            value={formData.priority || 'critical'}
            onChange={v => setFormData({ ...formData, priority: v })}
          />
        </Section>
      </div>

      {/* Footer compacto */}
      <div style={{
        borderTop: '1px solid var(--color-divider)',
        padding: '10px 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 6,
      }}>
        {routine ? (
          <button
            onClick={onDelete}
            aria-label="Excluir rotina"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              padding: '4px 6px',
              fontSize: 10, fontWeight: 500,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              borderRadius: 'var(--radius-sm)',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              transition: 'color var(--motion-fast) var(--ease-smooth)',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-error)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >
            <Trash2 size={10} strokeWidth={1.8} />
            Excluir
          </button>
        ) : <div />}

        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              padding: '5px 12px',
              fontSize: 10, fontWeight: 600,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              borderRadius: 'var(--radius-sm)',
              transition: 'all var(--motion-fast) var(--ease-smooth)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-text-primary)'
              e.currentTarget.style.borderColor = 'var(--color-border-chrome)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-tertiary)'
              e.currentTarget.style.borderColor = 'var(--color-border)'
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={titleEmpty}
            aria-disabled={titleEmpty}
            title={titleEmpty ? 'Dê um título antes de salvar' : undefined}
            style={{
              background: titleEmpty ? 'var(--color-bg-tertiary)' : 'var(--color-accent-primary)',
              border: `1px solid ${titleEmpty ? 'var(--color-border)' : 'var(--color-accent-primary)'}`,
              color: titleEmpty ? 'var(--color-text-muted)' : 'var(--color-bg-primary)',
              cursor: titleEmpty ? 'not-allowed' : 'pointer',
              padding: '5px 14px',
              fontSize: 10, fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              borderRadius: 'var(--radius-sm)',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              transition: 'all var(--motion-fast) var(--ease-smooth)',
              opacity: titleEmpty ? 0.6 : 1,
            }}
            onMouseEnter={e => {
              if (titleEmpty) return
              e.currentTarget.style.background = 'var(--color-accent-secondary)'
              e.currentTarget.style.borderColor = 'var(--color-accent-secondary)'
            }}
            onMouseLeave={e => {
              if (titleEmpty) return
              e.currentTarget.style.background = 'var(--color-accent-primary)'
              e.currentTarget.style.borderColor = 'var(--color-accent-primary)'
            }}
          >
            <Check size={10} strokeWidth={2.2} />
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Internal ────────────────────────────────────────────────────────────

function Section({ icon, label, children }: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: 8,
      }}>
        <span style={{ color: 'var(--color-text-muted)', display: 'inline-flex' }}>
          {icon}
        </span>
        <span style={{
          fontSize: 9,
          color: 'var(--color-text-tertiary)',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 600,
        }}>
          {label}
        </span>
      </div>
      {children}
    </div>
  )
}

function TimeInput({ value, onChange, ariaLabel }: {
  value: string
  onChange: (v: string) => void
  ariaLabel: string
}) {
  return (
    <input
      type="time"
      aria-label={ariaLabel}
      value={value}
      onChange={e => onChange(e.target.value)}
      onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-accent-primary)' }}
      onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
      style={{
        width: 84, height: 26,
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-primary)',
        padding: '0 6px',
        fontSize: 11, borderRadius: 'var(--radius-sm)',
        outline: 'none',
        fontFamily: 'var(--font-mono)', fontWeight: 500,
        fontVariantNumeric: 'tabular-nums',
        colorScheme: 'dark',
        transition: 'border-color var(--motion-fast) var(--ease-smooth)',
      } as React.CSSProperties}
    />
  )
}
