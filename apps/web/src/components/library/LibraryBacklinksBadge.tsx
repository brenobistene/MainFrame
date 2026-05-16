/**
 * Badge inline que mostra "N items da Library linkam pra cá".
 *
 * Renderização condicional — só aparece se count > 0. Click expande uma
 * lista compacta com os itens (tipo + título + nota), cada um clicável
 * pro detail do LibraryItem.
 *
 * Fecha a simetria dos cross-links: a partir de uma hipótese Mind / quest
 * / princípio Build, o usuário descobre quais Library items "passaram"
 * por ali. Doc: docs/library/PLAN.md §7.
 */
import { useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useLibraryBacklinks } from '../../lib/library-queries'
import type { LibraryLinkTargetType } from '../../types'
import { BODY, MONO } from '../health/tokens'

const LIBRARY_COR = '#7fb8a8'

interface Props {
  targetType: LibraryLinkTargetType
  targetId: string | number
  /** Variante visual: 'compact' (default) é uma tag chevron inline;
   *  'block' é um card expandido próprio pra detail pages. */
  variant?: 'compact' | 'block'
}

const TIPO_LABEL_SHORT: Record<string, string> = {
  livro: 'LV',
  filme: 'FL',
  serie: 'SR',
  podcast: 'PC',
  artigo: 'AR',
  video: 'VD',
  curso: 'CR',
  palestra: 'PL',
  paper: 'PP',
  outro: '?',
}

export default function LibraryBacklinksBadge({
  targetType,
  targetId,
  variant = 'compact',
}: Props) {
  const [open, setOpen] = useState(false)
  const { data: backlinks = [] } = useLibraryBacklinks(targetType, targetId)

  if (backlinks.length === 0) return null

  if (variant === 'compact') {
    return (
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            setOpen((v) => !v)
          }}
          className="hq-tech-id"
          style={{
            background: 'transparent',
            border: `1px solid ${LIBRARY_COR}`,
            color: LIBRARY_COR,
            padding: '1px 6px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
            fontFamily: MONO,
            fontSize: 9,
            letterSpacing: '0.12em',
          }}
          title={`${backlinks.length} item${backlinks.length !== 1 ? 's' : ''} da Library linkam aqui`}
        >
          <BookOpen size={9} strokeWidth={2} />
          {backlinks.length}
          {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
        </button>
        {open && (
          <BacklinksPopover
            backlinks={backlinks}
            onClose={() => setOpen(false)}
            anchor="compact"
          />
        )}
      </span>
    )
  }

  // Variant: block (sempre expandido)
  return (
    <div
      style={{
        marginTop: 'var(--space-2)',
        paddingTop: 'var(--space-2)',
        borderTop: '1px dashed var(--color-divider)',
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 10,
          color: LIBRARY_COR,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 4,
        }}
      >
        <BookOpen size={11} strokeWidth={2} />
        {backlinks.length} {backlinks.length === 1 ? 'item' : 'items'} da Library
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {backlinks.map((b) => (
          <BacklinkRow key={b.link_id} backlink={b} />
        ))}
      </div>
    </div>
  )
}

function BacklinksPopover({
  backlinks,
  onClose,
}: {
  backlinks: ReturnType<typeof useLibraryBacklinks>['data']
  onClose: () => void
  anchor: 'compact'
}) {
  const items = backlinks ?? []
  return (
    <>
      {/* Backdrop só capta click pra fechar — sem visual */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 50,
          background: 'transparent',
        }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        className="hq-glass-elevated hq-chamfer-bl"
        style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: 4,
          minWidth: 260,
          maxWidth: 360,
          zIndex: 51,
          padding: 'var(--space-2)',
          borderLeft: `2px solid ${LIBRARY_COR}`,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}
      >
        <div
          className="hq-tech-id"
          style={{
            color: LIBRARY_COR,
            marginBottom: 4,
            letterSpacing: '0.18em',
            fontSize: 9,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <BookOpen size={10} /> LIBRARY · {items.length}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((b) => (
            <BacklinkRow key={b.link_id} backlink={b} />
          ))}
        </div>
      </div>
    </>
  )
}

function BacklinkRow({
  backlink,
}: {
  backlink: NonNullable<ReturnType<typeof useLibraryBacklinks>['data']>[number]
}) {
  return (
    <Link
      to={`/library/item/${backlink.item_id}`}
      onClick={(e) => e.stopPropagation()}
      className="hq-row-hoverable"
      style={{
        display: 'block',
        padding: '4px 6px',
        textDecoration: 'none',
        color: 'inherit',
        borderLeft: `2px solid ${LIBRARY_COR}`,
        background: 'var(--color-bg-primary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          className="hq-tech-id"
          style={{
            color: LIBRARY_COR,
            border: `1px solid ${LIBRARY_COR}`,
            padding: '0 4px',
            fontSize: 8,
            letterSpacing: '0.12em',
          }}
        >
          {TIPO_LABEL_SHORT[backlink.item_tipo] ?? '?'}
        </span>
        <span
          style={{
            fontFamily: BODY,
            fontSize: 12,
            color: 'var(--color-text-primary)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {backlink.item_titulo}
        </span>
      </div>
      {backlink.nota && (
        <div
          style={{
            fontFamily: BODY,
            fontSize: 10,
            color: 'var(--color-text-muted)',
            fontStyle: 'italic',
            marginTop: 1,
            marginLeft: 16,
          }}
        >
          {backlink.nota}
        </div>
      )}
    </Link>
  )
}
