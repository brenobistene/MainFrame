/**
 * Hook que retorna "HH:MM" no fuso local e re-renderiza a cada minuto.
 *
 * Usado nos headers do Hub Health pra dar sensação de "live HUD" — o
 * timestamp `// SCAN @ HH:MM` precisa atualizar mesmo quando a página
 * fica aberta sem interação.
 */
import { useEffect, useState } from 'react'
import { nowHHMM } from './tokens'

export function useNowHHMM(): string {
  const [hhmm, setHHMM] = useState(nowHHMM())

  useEffect(() => {
    // Atualiza imediatamente quando o minuto vira pra evitar drift.
    const tick = () => setHHMM(nowHHMM())

    // Calcula ms até o próximo minuto pra alinhar updates com o relógio.
    const now = new Date()
    const msToNextMinute =
      (60 - now.getSeconds()) * 1000 - now.getMilliseconds()

    const initial = setTimeout(() => {
      tick()
      const interval = setInterval(tick, 60 * 1000)
      // Cleanup do interval fica encadeado abaixo
      ;(initial as any)._interval = interval
    }, msToNextMinute)

    return () => {
      clearTimeout(initial)
      const interval = (initial as any)._interval
      if (interval) clearInterval(interval)
    }
  }, [])

  return hhmm
}
