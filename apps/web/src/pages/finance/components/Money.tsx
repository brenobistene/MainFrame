import { formatBRL, formatMoney } from './styleHelpers'

/**
 * `<Money value={...} />` envolve o valor formatado num span que recebe
 * blur quando o root do HubFinanceLayout está em modo privado (toggle do
 * olho na tab bar).
 *
 * O blur é puramente CSS via `[data-finance-private="true"] .hq-money` em
 * index.html — animação suave (filter é GPU-accelerated), layout estável
 * (sem mudança de width), reversível em <300ms.
 *
 * Use em qualquer lugar onde você quer que o valor responda ao toggle —
 * principalmente saldos, totais, summary cards, stats. Pra cifras
 * "informativas" dentro de tooltips/strings, continue usando formatBRL()
 * (esses raramente aparecem em screen-share).
 */
export function Money({ value, moeda, style, className }: {
  value: number
  /** Padrão BRL. Use ex: 'USD', 'EUR' pra contas multi-moeda. */
  moeda?: string
  style?: React.CSSProperties
  /** Classes adicionais (ex: cor do valor). Sempre receberá `hq-money`. */
  className?: string
}) {
  const text = moeda ? formatMoney(value, moeda) : formatBRL(value)
  return (
    <span className={['hq-money', className].filter(Boolean).join(' ')} style={style}>
      {text}
    </span>
  )
}
