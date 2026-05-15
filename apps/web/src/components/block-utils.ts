/**
 * Helpers leves do BlockNote — sem dependência da lib pesada.
 *
 * Separados do `BlockEditor.tsx` (que importa ~1.1 MB de @blocknote)
 * pra permitir que consumers usem `isBlockDocEmpty` no save flow sem
 * forçar o chunk pesado a baixar. O componente `<BlockEditor>` em si
 * é lazy-loaded onde for renderizado.
 */

/**
 * Detecta se o JSON serializado do BlockNote representa documento vazio
 * (zero blocos, ou único bloco paragraph sem texto). Usado pra gravar
 * `null` no DB em vez de poluir com JSON vazio.
 *
 * Aceita também texto legado (não-JSON): vazio se só-whitespace.
 */
export function isBlockDocEmpty(serialized: string | null | undefined): boolean {
  if (!serialized) return true
  const s = serialized.trim()
  if (!s) return true
  try {
    const doc = JSON.parse(s)
    if (!Array.isArray(doc)) return !s
    if (doc.length === 0) return true
    if (doc.length === 1) {
      const b = doc[0]
      if (b?.type === 'paragraph') {
        const content = b.content
        if (!content) return true
        if (Array.isArray(content) && content.length === 0) return true
        if (Array.isArray(content) && content.every((c: any) => !c?.text?.trim())) return true
      }
    }
    return false
  } catch {
    // Não é JSON — texto legado. Vazio se só-whitespace.
    return !s
  }
}
