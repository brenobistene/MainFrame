import { useMemo } from 'react'

// Densidade da malha — COLS calibrado pra cells ficarem ~quadradas no banner
// padrão (1500-1700px de largura por 64px altura ≈ aspect 23-27:1). Com
// ROWS=5 e COLS=120, cada célula no viewBox é 12×12 (1:1) e o stretch via
// preserveAspectRatio="none" mantém aspect próximo a 1:1 nos viewports usuais.
const COLS = 120
const ROWS = 5
const CELL_W = 12
const CELL_H = 12
const STAGGER_MS = 750

/**
 * Overlay SVG da cutscene de materialize/dematerialize do banner.
 *
 * Renderiza uma malha de COLS×ROWS células (~320 cells). Cada cell anima
 * individualmente (scale 0→1 + stroke-width 0.3→1 + fill-opacity 0→0.7) com
 * `animation-delay` pseudoaleatório determinístico baseado em hash da
 * posição (c, r). Resultado: cubinhos crescem em ordem espalhada (não L→R)
 * e "esquentam" — linhas começam finas, ficam mais grossas e brilhantes.
 *
 * Renderizado como SIBLING do banner (não child), pra escapar do
 * `overflow: hidden` e do contexto de stacking interno do banner.
 *
 * Posicionado via `position: fixed` no mesmo retângulo que o banner.
 */
export function BannerGridOverlay({ stage, left }: {
  stage: 'entering' | 'exiting'
  /** Offset horizontal (px) do banner — acompanha o sidebar/drawer.
   *  Passado pronto pelo App pra ficar consistente em mobile (0) e desktop. */
  left: number
}) {
  const cells = useMemo(() => {
    const arr: { x: number; y: number; delay: number }[] = []
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        // Hash determinístico — mesma posição sempre tem mesmo delay, mas
        // a distribuição parece aleatória pro olho. Mistura três primos
        // grandes pra evitar padrões visíveis.
        const hash = ((c * 73856093) ^ (r * 19349663) ^ ((c + r) * 83492791)) >>> 0
        const delay = hash % STAGGER_MS
        arr.push({ x: c * CELL_W, y: r * CELL_H, delay })
      }
    }
    return arr
  }, [])

  const isEntering = stage === 'entering'

  // Wrapper div carrega o `position: fixed` com left/right; SVG recebe
  // width/height 100% pra preencher o wrapper (sem isso herda default
  // 300×150 do user-agent e deixa um gap na direita do banner).
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left,
        right: 0,
        height: 64,
        zIndex: 100,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    >
      <svg
        className={`hq-banner-grid-svg hq-banner-grid-svg--${isEntering ? 'in' : 'out'}`}
        width="100%"
        height="100%"
        viewBox={`0 0 ${COLS * CELL_W} ${ROWS * CELL_H}`}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        {cells.map((cell, i) => (
          <rect
            key={i}
            x={cell.x + 1}
            y={cell.y + 1}
            width={CELL_W - 2}
            height={CELL_H - 2}
            className={isEntering ? 'hq-banner-grid-cell--in' : 'hq-banner-grid-cell--out'}
            style={{
              animationDelay: isEntering
                ? `${cell.delay}ms`
                : `${STAGGER_MS - cell.delay}ms`,
            }}
          />
        ))}
      </svg>
    </div>
  )
}
