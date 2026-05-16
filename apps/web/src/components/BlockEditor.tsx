import { useEffect, useMemo } from 'react'
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems } from '@blocknote/core'
import type { Block, PartialBlock } from '@blocknote/core'
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { FileText, Sparkles } from 'lucide-react'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { pageBlockSpec, PageBlockProvider } from './PageBlock'
import type { PageBlockContextValue } from './PageBlock'

/**
 * Editor estilo Notion — blocos tipados (paragraph, heading 1-3, bullet,
 * numbered, checklist, divider) com menu slash, drag handle e botão "+"
 * no hover. Wrapper em volta do BlockNote pra encaixar no modelo de dados
 * do MAINFRAME, que hoje armazena `notes`/`description` como TEXT simples.
 *
 * Compatibilidade com legado: se o valor salvo for texto puro (não JSON),
 * é convertido pra um único bloco paragraph na carga. Na gravação sempre
 * salva como JSON serializado.
 *
 * Restringe o schema padrão do BlockNote pra só os tipos que o usuário
 * pediu — remove tabela, código, imagem, vídeo, áudio, arquivo etc.
 *
 * Nested Pages: quando `pages` é provido (uso dentro de Projeto), o schema
 * inclui o custom block `page` e o slash menu expõe `/page`. Doc completa:
 * docs/nested-pages/PLAN.md. Quando `pages` está ausente (uso legado em
 * descrição de quest filha, planned items etc), o item `/page` some.
 */

// Schema reduzido — apenas os tipos que queremos expor. O `page` é
// custom block (definido em PageBlock.tsx) — sempre incluído no schema
// pra JSON antigo com bloco `page` renderizar correto, mesmo em contextos
// sem o context provider (cai pro placeholder de órfão).
const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    divider: defaultBlockSpecs.divider,
    page: pageBlockSpec,
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

/**
 * Template de destilação inserido pelo slash `/estudo`. Estrutura forçada
 * que pede tese central, argumentos, conexões com o que já se sabe,
 * pergunta gerada, exercício Feynman e próxima ação. Anti-coleção-morta.
 * Doc: docs/library/PLAN.md §6.3.
 */
function buildEstudoTemplate(): PartialBlock<Schema['blockSchema']>[] {
  const p = (text: string) =>
    ({
      type: 'paragraph' as const,
      content: text ? [{ type: 'text' as const, text, styles: {} }] : [],
    }) as PartialBlock<Schema['blockSchema']>
  const h = (text: string) =>
    ({
      type: 'heading' as const,
      props: { level: 2 },
      content: [{ type: 'text' as const, text, styles: {} }],
    }) as PartialBlock<Schema['blockSchema']>
  const b = (text: string) =>
    ({
      type: 'bulletListItem' as const,
      content: text ? [{ type: 'text' as const, text, styles: {} }] : [],
    }) as PartialBlock<Schema['blockSchema']>
  return [
    h('Tese central'),
    p('(uma frase. Se não cabe em uma, ainda não entendeu.)'),
    h('Argumentos principais'),
    b(''),
    h('Onde concordo / Onde discordo'),
    b(''),
    h('Conexões'),
    b('com X que já li/vi:'),
    b('com Y que estou resolvendo:'),
    h('Pergunta que isso levanta'),
    p('(uma boa pergunta vale mais que decorar mil respostas)'),
    h('Explique pra um leigo em uma frase'),
    p('(princípio Feynman — se travou aqui, encontrou a lacuna)'),
    h('Próxima ação'),
    b('gerou hipótese? → linkar Mind'),
    b('gerou projeto/ação? → criar Quest'),
    b('gerou princípio? → linkar Build'),
  ]
}

export interface BlockEditorPagesContext {
  /** Lista flat das pages do projeto — usada pro lookup de título nos blocos `page`. */
  pages: { id: string; project_id: string; parent_page_id: string | null; title: string; sort_order: number; created_at: string | null; updated_at: string | null }[]
  /** Click num bloco `page` → navega no painel pra essa page. */
  onPageNavigate: (pageId: string) => void
  /** Cria nova page filha do contexto atual e devolve o id. Slash menu usa
   *  pra criar+inserir o bloco numa só ação. */
  onCreatePage: () => Promise<string>
  /** Ids de pages que foram deletadas em outra view — remove blocos `page`
   *  que apontam pra elas pra evitar órfãos pendurados no JSON do pai.
   *  Após processar, consumidor deve limpar o Set. */
  cleanupPageIds?: Set<string>
  /** Callback após o cleanup processar os ids — consumidor limpa o Set. */
  onCleanupDone?: (cleaned: string[]) => void
  /** True enquanto a query batch ainda está fetchando — sinaliza pro
   *  PageBlock renderizar placeholder neutro em vez de "Página excluída". */
  isLoading?: boolean
  /** Lazy fetch do preview rico (primeiros parágrafos do conteúdo) on-hover
   *  do card de page. Provider deve cachear. Quando undefined, hover só
   *  mostra o título no tooltip. */
  fetchPreview?: (pageId: string) => Promise<string | null>
}

export function BlockEditor({ value, onChange, placeholder, minHeight = 120, pages, enableEstudoTemplate }: {
  value: string | null | undefined
  onChange: (serialized: string) => void
  placeholder?: string
  minHeight?: number
  /** Quando provido, ativa Nested Pages: schema com bloco `page`, slash item
   *  `/page` e contexto pra lookup de título / navegação. */
  pages?: BlockEditorPagesContext
  /** Quando true, adiciona slash item `/estudo` que insere o template de
   *  destilação (tese central + argumentos + Feynman + próxima ação).
   *  Usado em LibraryItemPage. Doc: docs/library/PLAN.md §6.3. */
  enableEstudoTemplate?: boolean
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
  const getItems = async (query: string) => {
    const defaultItems = getDefaultReactSlashMenuItems(editor).filter(item =>
      ALLOWED_KEYS.has((item as any).key)
    )
    // Item custom `Page` — só aparece quando o editor tá em contexto de Projeto.
    // O onClick chama o callback `onCreatePage` (cria a row no backend, recebe id)
    // e insere o bloco `page` na posição atual do cursor.
    const extra: any[] = []
    if (pages) {
      extra.push({
        title: 'Page',
        key: 'page',
        aliases: ['page', 'pagina', 'página', 'subpage', 'subpágina'],
        group: 'Outros',
        icon: <FileText size={18} />,
        subtext: 'Nova página filha',
        onItemClick: async () => {
          try {
            const newPageId = await pages.onCreatePage()
            // "insert or update": se o bloco atual é um paragraph vazio,
            // substituímos; senão, inserimos depois. Reproduz o comportamento
            // do `insertOrUpdateBlockForSlashMenu` (não exportado em 0.48).
            const cursor = (editor as any).getTextCursorPosition?.()
            const current = cursor?.block
            const isEmptyParagraph =
              current && current.type === 'paragraph' &&
              (!current.content ||
                (Array.isArray(current.content) && current.content.length === 0))
            const newBlock = {
              type: 'page',
              props: { pageId: newPageId },
            } as any
            if (current && isEmptyParagraph) {
              ;(editor as any).replaceBlocks([current.id], [newBlock])
            } else if (current) {
              ;(editor as any).insertBlocks([newBlock], current.id, 'after')
            } else {
              // Sem cursor — inserir no final do doc.
              ;(editor as any).insertBlocks(
                [newBlock],
                (editor as any).document[(editor as any).document.length - 1]?.id,
                'after',
              )
            }
            // Auto-navigate Notion-style: depois de inserir o bloco no JSON
            // do pai, abre a page recém-criada. Pequeno delay deixa o
            // onChange disparar primeiro (salva o pai antes de trocar de
            // doc — evita race ao desmontar editor).
            setTimeout(() => pages.onPageNavigate(newPageId), 30)
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[BlockEditor] criar page falhou:', err)
          }
        },
      })
    }
    // Slash `/estudo` — insere template de destilação (princípio Feynman +
    // tese central + conexões + próxima ação). Usado em Library notes pra
    // forçar estrutura sem virar ditadura. Doc: docs/library/PLAN.md §6.3.
    if (enableEstudoTemplate) {
      extra.push({
        title: 'Template de estudo',
        key: 'estudo',
        aliases: ['estudo', 'feynman', 'tese', 'destilacao', 'destilação', 'study'],
        group: 'Outros',
        icon: <Sparkles size={18} />,
        subtext: 'Tese + argumentos + conexões + Feynman',
        onItemClick: () => {
          try {
            const cursor = (editor as any).getTextCursorPosition?.()
            const blocks = buildEstudoTemplate()
            if (cursor?.block) {
              ;(editor as any).insertBlocks(blocks, cursor.block.id, 'after')
            } else {
              const doc = (editor as any).document
              const last = doc[doc.length - 1]?.id
              if (last) (editor as any).insertBlocks(blocks, last, 'after')
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[BlockEditor] inserir template estudo falhou:', err)
          }
        },
      })
    }
    return filterSuggestionItems([...defaultItems, ...extra], query)
  }

  // Context pro custom block `page` ler lookup de título + callback de navegação.
  const pageCtx: PageBlockContextValue | null = useMemo(() => {
    if (!pages) return null
    const pagesById: Record<string, PageBlockContextValue['pagesById'][string]> = {}
    const childCountByParent: Record<string, number> = {}
    for (const p of pages.pages) {
      pagesById[p.id] = p
      if (p.parent_page_id) {
        childCountByParent[p.parent_page_id] = (childCountByParent[p.parent_page_id] || 0) + 1
      }
    }
    return {
      pagesById,
      childCountByParent,
      onPageNavigate: pages.onPageNavigate,
      isLoading: pages.isLoading,
      fetchPreview: pages.fetchPreview,
    }
  }, [pages])

  // Cleanup de blocos `page` órfãos — quando uma page (e suas filhas) é
  // deletada via PageDeleteModal, o JSON do pai ainda tem o bloco
  // apontando pro pageId morto. Esse efeito remove esses blocos via
  // `removeBlocks`, dispara onChange (que salva o JSON limpo) e avisa o
  // consumidor pra esvaziar o Set de pendentes. Doc: PLAN.md §7.3.
  const cleanupIds = pages?.cleanupPageIds
  const onCleanupDone = pages?.onCleanupDone
  useEffect(() => {
    if (!cleanupIds || cleanupIds.size === 0) return
    try {
      const doc = (editor as any).document as Array<{ id: string; type: string; props?: Record<string, unknown> }>
      const toRemove: string[] = []
      const cleaned: string[] = []
      for (const block of doc) {
        if (block.type !== 'page') continue
        const pid = (block.props as { pageId?: string } | undefined)?.pageId
        if (pid && cleanupIds.has(pid)) {
          toRemove.push(block.id)
          cleaned.push(pid)
        }
      }
      if (toRemove.length > 0) {
        ;(editor as any).removeBlocks(toRemove)
      }
      if (cleaned.length > 0 && onCleanupDone) onCleanupDone(cleaned)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[BlockEditor] cleanup órfãos falhou:', err)
    }
  }, [editor, cleanupIds, onCleanupDone])

  const view = (
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

  if (pageCtx) {
    return <PageBlockProvider value={pageCtx}>{view}</PageBlockProvider>
  }
  return view
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
