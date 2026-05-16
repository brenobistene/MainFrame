import { createContext, useContext, useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { FileText } from 'lucide-react'
import type { ProjectPageMeta } from '../types'

/**
 * Custom block `page` do BlockNote — renderiza um card-link clicável pra
 * navegar pra outra `project_page`. Doc: docs/nested-pages/PLAN.md
 *
 * Armazenagem no JSON do BlockNote: só o `pageId`. Título e demais metadados
 * vêm do contexto (lookup batch via `fetchProjectPages`). Renomear uma page
 * atualiza o card em todos os lugares automaticamente — não precisa mexer
 * no JSON dos pais.
 *
 * Quando `pageId` não existir mais na tabela (deletado fora do fluxo
 * normal ou referência pendurada), o card renderiza estado dimmed.
 */

export interface PageBlockContextValue {
  /** Mapa pageId → meta. Lookup O(1) pra hidratar título dos cards. */
  pagesById: Record<string, ProjectPageMeta>
  /** Mapa pageId → quantidade de filhas diretas. Usado pro contador no card
   *  (Notion-style "▸ 3"). Calculado uma vez no BlockEditor a partir da
   *  lista flat. */
  childCountByParent: Record<string, number>
  /** Callback ao clicar no card — sobe pro painel pra atualizar currentPageId. */
  onPageNavigate: (pageId: string) => void
  /** True enquanto a query batch ainda está fetchando — render mostra
   *  placeholder neutro em vez de "Página excluída" pra evitar flash
   *  visual no primeiro render. */
  isLoading?: boolean
  /** Lazy fetch do preview do conteúdo (primeiros parágrafos) on-hover.
   *  Retorna texto plano (já extraído de content_json) ou null se vazio.
   *  Cacheado pelo provider — chamadas repetidas pro mesmo pageId não
   *  refazem fetch. */
  fetchPreview?: (pageId: string) => Promise<string | null>
}

const PageBlockContext = createContext<PageBlockContextValue | null>(null)

export function PageBlockProvider({ value, children }: {
  value: PageBlockContextValue
  children: React.ReactNode
}) {
  return <PageBlockContext.Provider value={value}>{children}</PageBlockContext.Provider>
}

function usePageBlockContext(): PageBlockContextValue | null {
  return useContext(PageBlockContext)
}

/**
 * Block spec — registrado no schema do BlockNote em `BlockEditor.tsx`.
 * `content: 'none'` = bloco atômico, sem conteúdo inline editável.
 *
 * `createReactBlockSpec` retorna uma **factory** `(options?) => BlockSpec`
 * desde 0.48, então invocamos aqui (sem options) pra exportar o spec já
 * pronto pro consumidor não precisar saber dessa peculiaridade.
 */
export const pageBlockSpec = createReactBlockSpec(
  {
    type: 'page',
    propSchema: {
      pageId: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block }) => {
      const ctx = usePageBlockContext()
      const pageId = (block.props as { pageId: string }).pageId
      const meta = ctx?.pagesById[pageId]
      const childCount = ctx?.childCountByParent[pageId] ?? 0
      // Preview rico (primeiros parágrafos do conteúdo) carregado on-hover.
      // Strings: '' = ainda não fetchou; null = página vazia/sem texto;
      // texto = preview pronto pra mostrar no tooltip.
      const [preview, setPreview] = useState<string | null | ''>('')

      // Distingue 3 estados:
      //  - meta encontrada → render normal
      //  - meta não encontrada E ctx loading → "Carregando…" (sem flash de "excluída")
      //  - meta não encontrada E não loading → "Página excluída" (órfão real)
      const isLoading = ctx?.isLoading === true && !meta
      const isOrphan = !meta && !isLoading
      const title = meta?.title || (isLoading ? 'Carregando…' : 'Página excluída')

      const handleClick = () => {
        if (!ctx || isOrphan || isLoading) return
        ctx.onPageNavigate(pageId)
      }

      return (
        <div
          contentEditable={false}
          onClick={handleClick}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 10px',
            borderRadius: 4,
            background: isOrphan
              ? 'transparent'
              : isLoading
              ? 'rgba(143, 191, 211, 0.03)'
              : 'rgba(143, 191, 211, 0.06)',
            border: `1px solid ${isOrphan
              ? 'rgba(255, 99, 99, 0.25)'
              : isLoading
              ? 'rgba(143, 191, 211, 0.10)'
              : 'rgba(143, 191, 211, 0.20)'}`,
            color: isOrphan || isLoading
              ? 'var(--color-text-muted)'
              : 'var(--color-text-primary)',
            cursor: isOrphan ? 'not-allowed' : isLoading ? 'progress' : 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            transition: 'all 0.15s',
            userSelect: 'none',
            width: 'fit-content',
            maxWidth: '100%',
          }}
          onMouseEnter={e => {
            if (isOrphan || isLoading) return
            e.currentTarget.style.background = 'rgba(143, 191, 211, 0.14)'
            e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.40)'
            // Preview lazy: dispara fetch só na primeira vez que o mouse
            // entra no card. Resultado vai pro state, próximas hover usam
            // direto. Cache compartilhado fica no provider (fetchPreview).
            if (preview === '' && ctx?.fetchPreview && meta) {
              ctx.fetchPreview(pageId).then(p => setPreview(p))
            }
          }}
          onMouseLeave={e => {
            if (isOrphan || isLoading) return
            e.currentTarget.style.background = 'rgba(143, 191, 211, 0.06)'
            e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.20)'
          }}
          title={
            isOrphan
              ? 'Referência a página que não existe mais'
              : isLoading
              ? 'Carregando…'
              : preview && preview !== ''
              ? `${title}\n\n${preview}`
              : `Abrir "${title}"`
          }
        >
          <FileText
            size={14}
            style={{
              flexShrink: 0,
              opacity: isOrphan ? 0.5 : 0.85,
            }}
          />
          <span style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontStyle: isOrphan ? 'italic' : 'normal',
            opacity: isOrphan ? 0.6 : 1,
          }}>
            {title}
          </span>
          {!isOrphan && childCount > 0 && (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--color-text-muted)',
              opacity: 0.7,
              marginLeft: 4,
              flexShrink: 0,
              letterSpacing: '0.05em',
            }}>
              · {childCount}
            </span>
          )}
        </div>
      )
    },
  },
)()


