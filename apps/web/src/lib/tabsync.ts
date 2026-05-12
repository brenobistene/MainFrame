/**
 * Sincronização entre abas via BroadcastChannel.
 *
 * Quando uma aba muta dados (cria tx, marca rotina done, etc), outras abas
 * abertas recebem um evento e re-fetcham sem precisar de polling.
 *
 * Uso:
 *   tabSync.emit('routines')          // notifica que rotinas mudaram
 *   tabSync.on('routines', () => …)   // reage a mudanças vindas de OUTRA aba
 *
 * Channels nomeados por escopo do dado pra evitar over-refresh:
 *   - 'session'   → activeSession mudou (banner sync)
 *   - 'finance'   → tx/bills/dividas/categorias
 *   - 'routines'  → rotinas (create/edit/delete/log)
 *   - 'tasks'     → tasks
 *   - 'quests'    → quests / projects / areas
 *   - 'profile'   → user profile (name/role/avatar)
 *   - 'build'     → metas/visão/rituais
 *   - 'health'    → hub health
 *   - 'all'       → catch-all (full refresh)
 */

export type SyncChannel =
  | 'session' | 'finance' | 'routines' | 'tasks'
  | 'quests' | 'profile' | 'build' | 'health' | 'all'

const CHANNEL_NAME = 'hq-data-sync'
const bc = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel(CHANNEL_NAME)
  : null

type Listener = () => void
const listeners = new Map<SyncChannel, Set<Listener>>()

if (bc) {
  bc.onmessage = (e: MessageEvent<{ channel: SyncChannel }>) => {
    const ch = e.data?.channel
    if (!ch) return
    // Dispatch handlers do channel especifico + handlers do 'all'
    const exact = listeners.get(ch)
    if (exact) for (const l of exact) l()
    if (ch !== 'all') {
      const wildcards = listeners.get('all')
      if (wildcards) for (const l of wildcards) l()
    }
  }
}

export const tabSync = {
  emit(channel: SyncChannel) {
    if (!bc) return
    bc.postMessage({ channel })
  },
  on(channel: SyncChannel, listener: Listener): () => void {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    listeners.get(channel)!.add(listener)
    return () => {
      listeners.get(channel)?.delete(listener)
    }
  },
}
