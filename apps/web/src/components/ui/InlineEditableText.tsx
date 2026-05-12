/**
 * InlineEditableText — clicar duplo (ou enter, ou clicar no botão "edit")
 * vira input. Enter ou blur commita. Esc cancela.
 *
 * Reduz atrito vs abrir modal só pra mudar título. Usado em quest/task/
 * routine/project/etc onde só queremos editar texto rápido.
 *
 * Props:
 *  - value: texto atual
 *  - onSave: async callback (recebe novo valor)
 *  - placeholder: caso vazio
 *  - style: aplicado em ambos (display + input)
 *  - disabled: bloqueia edição (ex: item done)
 */
import { useEffect, useRef, useState } from 'react'

export function InlineEditableText({
  value, onSave, placeholder, style, disabled,
}: {
  value: string
  onSave: (next: string) => Promise<void> | void
  placeholder?: string
  style?: React.CSSProperties
  disabled?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  async function commit() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === value) {
      setEditing(false)
      setDraft(value)
      return
    }
    setBusy(true)
    try {
      await onSave(trimmed)
      setEditing(false)
    } catch {
      // mantém em editing pra user retentar
    } finally {
      setBusy(false)
    }
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  if (!editing) {
    return (
      <span
        onDoubleClick={() => { if (!disabled) setEditing(true) }}
        title={disabled ? undefined : 'duplo-clique pra editar'}
        style={{
          cursor: disabled ? 'default' : 'text',
          ...style,
        }}
      >
        {value || (placeholder ? <span style={{ opacity: 0.4 }}>{placeholder}</span> : null)}
      </span>
    )
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        else if (e.key === 'Escape') { e.preventDefault(); cancel() }
      }}
      disabled={busy}
      placeholder={placeholder}
      style={{
        background: 'rgba(143, 191, 211, 0.08)',
        border: '1px solid var(--color-ice)',
        color: 'var(--color-text-primary)',
        outline: 'none',
        padding: '2px 6px',
        minWidth: 100,
        boxShadow: '0 0 8px rgba(143, 191, 211, 0.30)',
        ...style,
      }}
    />
  )
}
