/**
 * useBreakpoint — runtime detection do tamanho da viewport pra ramificar
 * styles inline em mobile/tablet/desktop. O app usa inline styles
 * massivamente (sem CSS class-based responsivo), então precisamos ler o
 * breakpoint em JS pra adaptar.
 *
 * Breakpoints alinhados com Tailwind: mobile <640px, tablet 640-1023,
 * desktop ≥1024.
 *
 * Listener via matchMedia (não window resize) — evita re-render em todo
 * pixel de mudança, só dispara quando cruza um breakpoint.
 *
 * SSR-safe via guard `typeof window === 'undefined'` no estado inicial.
 */
import { useEffect, useState } from 'react'

export interface Breakpoint {
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  /** Atalho pra `!isDesktop` — sidebar overlay, nav drawer, etc. */
  isCompact: boolean
}

const MOBILE_QUERY = '(max-width: 639px)'
const TABLET_QUERY = '(min-width: 640px) and (max-width: 1023px)'
const DESKTOP_QUERY = '(min-width: 1024px)'

function read(): Breakpoint {
  if (typeof window === 'undefined') {
    return { isMobile: false, isTablet: false, isDesktop: true, isCompact: false }
  }
  const isMobile = window.matchMedia(MOBILE_QUERY).matches
  const isTablet = window.matchMedia(TABLET_QUERY).matches
  const isDesktop = window.matchMedia(DESKTOP_QUERY).matches
  return { isMobile, isTablet, isDesktop, isCompact: !isDesktop }
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(read)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mqs = [MOBILE_QUERY, TABLET_QUERY, DESKTOP_QUERY].map(q => window.matchMedia(q))
    const handler = () => setBp(read())
    mqs.forEach(mq => mq.addEventListener('change', handler))
    return () => mqs.forEach(mq => mq.removeEventListener('change', handler))
  }, [])

  return bp
}
