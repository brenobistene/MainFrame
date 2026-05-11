/**
 * Resolve ícone Lucide pra um domínio do Hub Health.
 *
 * Antes era hardcoded por slug (`sono`, `exercicio`, etc) em cada
 * componente — quebrava com domínio customizado. Agora:
 *
 *   1. Se `domain.icone` está setado, tenta resolver dinamicamente via
 *      Lucide (case-insensitive, formato kebab-case ou PascalCase).
 *   2. Senão, fallback por **template** (faz sentido pra qualquer domínio
 *      que use aquele template).
 *   3. Último fallback: ícone genérico Activity.
 */
import * as Lucide from 'lucide-react'

export type IconComponent = React.ComponentType<{
  size?: number
  strokeWidth?: number
  color?: string
}>

const FALLBACK_BY_TEMPLATE: Record<string, IconComponent> = {
  janela_qualidade: Lucide.Moon,
  atividade_tipo: Lucide.Activity,
  refeicao_2modos: Lucide.Utensils,
  consumo_vontade: Lucide.AlertTriangle,
  metrica_simples: Lucide.Scale,
  evento_escala: Lucide.Smile,
}

/**
 * Converte um nome de ícone (kebab-case ou PascalCase) pra a referência
 * exportada pelo lucide-react. Ex: "moon", "alert-triangle", "AlertTriangle".
 */
function resolveLucideIcon(name: string): IconComponent | null {
  const cleaned = name.trim()
  if (!cleaned) return null
  const pascal = cleaned
    .split(/[-_\s]+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('')
  const candidate = (Lucide as Record<string, unknown>)[pascal]
  if (typeof candidate === 'function' || typeof candidate === 'object') {
    return candidate as IconComponent
  }
  return null
}

export function domainIconFor(
  iconeField: string | null | undefined,
  template: string,
): IconComponent {
  if (iconeField) {
    const resolved = resolveLucideIcon(iconeField)
    if (resolved) return resolved
  }
  return FALLBACK_BY_TEMPLATE[template] ?? Lucide.Activity
}
