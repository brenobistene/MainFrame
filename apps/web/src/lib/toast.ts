/**
 * Toast notifications — feedback não-bloqueante pra ações comuns.
 *
 * Substitui `alertDialog` em casos onde queremos confirmar uma ação
 * sem interromper o fluxo. Pop-up no canto inferior direito que some
 * em 3-4s, com gravidade visual (default/success/warning/danger).
 *
 * Uso:
 *   toast.success('Conta criada')
 *   toast.danger('Falha ao salvar', 'Veja o console (F12)')
 *
 * O `ToastPortal` precisa estar montado uma vez na raiz do app
 * (App.tsx) pra os toasts aparecerem.
 */

export type ToastVariant = 'default' | 'success' | 'warning' | 'danger'

export interface ToastEntry {
  id: number
  variant: ToastVariant
  title: string
  message?: string
  duration: number
}

type Listener = (toasts: ToastEntry[]) => void

let nextId = 1
const listeners = new Set<Listener>()
let toasts: ToastEntry[] = []

function notify() {
  for (const l of listeners) l(toasts)
}

function add(variant: ToastVariant, title: string, message?: string, duration = 3500) {
  const id = nextId++
  toasts = [...toasts, { id, variant, title, message, duration }]
  notify()
  setTimeout(() => dismiss(id), duration)
  return id
}

function dismiss(id: number) {
  toasts = toasts.filter(t => t.id !== id)
  notify()
}

export const toast = {
  default: (title: string, message?: string) => add('default', title, message),
  success: (title: string, message?: string) => add('success', title, message),
  warning: (title: string, message?: string) => add('warning', title, message),
  danger:  (title: string, message?: string) => add('danger', title, message, 5000),
  dismiss,
  /** Inscreve um listener pra receber updates da lista. Usado pelo Portal. */
  subscribe(l: Listener): () => void {
    listeners.add(l)
    l(toasts)
    return () => { listeners.delete(l) }
  },
}
