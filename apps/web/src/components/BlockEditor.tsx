import { useEffect, useMemo } from 'react'
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems } from '@blocknote/core'
import type { Block, PartialBlock } from '@blocknote/core'
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'

/**
 * Editor estilo Notion — blocos tipados (paragraph, heading 1-3, bullet,
 * numbered, checklist, divider) com menu slash, drag handle e botão "+"
 * no hover. Wrapper em volta do BlockNote pra encaixar no modelo de dados
 * do Hub Quest, que hoje armazena `notes`/`description` como TEXT simples.
 *
 * Compatibilidade com legado: se o valor salvo for texto puro (não JSON),
 * é convertido pra um único bloco paragraph na carga. Na gravação sempre
 * salva como JSON serializado.
 *
 * Restringe o schema padrão do BlockNote pra só os tipos que o usuário
 * pediu — remove tabela, código, imagem, vídeo, áudio, arquivo etc.
 */

// Schema reduzido — apenas os tipos que queremos expor.
const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    divider: defaultBlockSpecs.divider,
  },
})

type Schema = typeof schema

function parseInitial(value: string | null | undefined): PartialBlock<Schema['blockSchema']>[] | undefined {
  if (!value || !value.trim()) return undefined
  // Tenta JSON — se vier como array de blocos, usa direto.
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every(b => b && typeof b === 'object' && 'type' in b)) {
      return parsed as PartialBlock<Schema['blockSchema']>[]
    }
  } catch {
    // não é JSON — cai no fallback
  }
  // Legado: texto puro — quebra por linhas em blocos de parágrafo.
  const lines = value.split('\n')
  return lines.map(line => ({
    type: 'paragraph' as const,
    content: line ? [{ type: 'text' as const, text: line, styles: {} }] : [],
  }))
}

// Tipos de bloco que devem preservar seu tipo ao receber paste — paste
// default do BlockNote parseia HTML/Markdown do clipboard e pode substituir
// o bloco pelo que detectou, sumindo com a lista original.
const LIST_LIKE_TYPES = new Set(['checkListItem', 'bulletListItem', 'numberedListItem'])

export function BlockEditor({ value, onChange, placeholder, minHeight = 120 }: {
  value: string | null | undefined
  onChange: (serialized: string) => void
  placeholder?: string
  minHeight?: number
}) {
  const initialContent = useMemo(() => parseInitial(value), [])
  // eslint-disable-next-line react-hooks/exhaustive-deps

  const editor = useCreateBlockNote({
    schema,
    initialContent,
  })

  // Paste handler via listener DOM na fase de captura — roda ANTES de
  // qualquer handler do ProseMirror/BlockNote. Quando o cursor está num
  // bloco list-like (checkbox/bullet/numbered), paste como texto puro,
  // preservando o tipo do bloco. Em outros tipos, deixa o paste default.
  useEffect(() => {
    const dom: HTMLElement | null =
      (editor as any).domElement
      ?? (editor as any)._tiptapEditor?.view?.dom
      ?? null
    if (!dom) return
    const handler = (event: Event) => {
      const clipboard = (event as ClipboardEvent).clipboardData
      if (!clipboard) return
      try {
        const block = (editor as any).getTextCursorPosition?.().block
        if (!block || !LIST_LIKE_TYPES.has(block.type)) return
        const text = clipboard.getData('text/plain') ?? ''
        if (!text) return
        event.preventDefault()
        event.stopPropagation()
        ;(editor as any).insertInlineContent(text)
      } catch {}
    }
    dom.addEventListener('paste', handler, true) // capture phase
    return () => dom.removeEventListener('paste', handler, true)
  }, [editor])

  // onChange dispara quando o documento muda — serializamos como JSON.
  useEffect(() => {
    const handler = () => {
      try {
        onChange(JSON.stringify(editor.document))
      } catch {}
    }
    const unsub = editor.onChange(handler)
    return () => { if (typeof unsub === 'function') unsub() }
  }, [editor, onChange])

  // Slash menu — restringe aos itens que batem com nosso schema.
  // Filtro por `key` (estável, independe de locale) em vez de `title`.
  const ALLOWED_KEYS = new Set([
    'paragraph', 'heading', 'heading_2', 'heading_3',
    'bullet_list', 'numbered_list', 'check_list', 'divider',
  ])
  const getItems = async (query: string) =>
    filterSuggestionItems(
      getDefaultReactSlashMenuItems(editor).filter(item =>
        ALLOWED_KEYS.has((item as any).key)
      ),
      query,
    )

  return (
    <div
      className="hq-block-editor"
      data-placeholder={placeholder}
      style={{ minHeight, background: 'transparent' }}
    >
      <BlockNoteView editor={editor} theme="dark" slashMenu={false}>
        <SuggestionMenuController triggerCharacter="/" getItems={getItems} />
      </BlockNoteView>
    </div>
  )
}

export type { Block }

/**
 * Retorna `true` quando o valor serializado representa um editor vazio —
 * um único parágrafo sem conteúdo, ou string vazia/só-whitespace. Usa pra
 * decidir salvar `null` no banco em vez de JSON "vazio".
 */
// `isBlockDocEmpty` foi movido pra `block-utils.ts` (sem dependência
// pesada de @blocknote) pra permitir lazy-load deste arquivo. Re-export
// preserva compat dos imports antigos.
export { isBlockDocEmpty } from './block-utils'

