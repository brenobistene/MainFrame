/**
 * /library/item/:id — Detail completo de um LibraryItem.
 *
 * Painéis principais:
 *  - Header com tipo + título editável inline + status dropdown
 *  - DESTILAÇÃO (tese central + o que ficou) — sempre visível
 *  - SESSÕES (cronômetro com tempo total)
 *  - REVISITA (campo revisitar_em + atalhos +1m/+3m/+6m)
 *  - CONEXÕES (links cross-module — esboço, popover em v0.5)
 *  - NOTAS livre (texto cru no v0, BlockNote em v0.5)
 *
 * Status flow: queue → doing → done | abandoned. Done exige tese+o_que_ficou.
 *
 * Doc: docs/library/PLAN.md.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Eye, Play, Pause, Plus, Trash2, X } from 'lucide-react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import {
  useDeleteLibraryItem,
  useDeleteLibraryLink,
  useLibraryItem,
  useLibrarySagas,
  useLibrarySessions,
  usePauseLibrarySession,
  useStartLibrarySession,
  useUpdateLibraryItem,
} from '../../lib/library-queries'
import { useGoals, usePrinciples } from '../../lib/build-queries'
import { useMindHipoteses } from '../../lib/health-queries'
import { useQuests } from '../../lib/app-queries'
import CrossLinkPicker from '../../components/library/CrossLinkPicker'
import MindRegisterModal from '../../components/mind/MindRegisterModal'
import { alertDialog } from '../../lib/dialog'
import type {
  LibraryItem,
  LibraryItemStatus,
  LibraryItemTipo,
  LibraryLink,
  LibraryLinkTargetType,
} from '../../types'
import { BODY, DISPLAY, MONO } from '../../components/health/tokens'

// Lazy import — BlockNote é pesado (~150KB gzip).
const BlockEditor = lazy(() =>
  import('../../components/BlockEditor').then((m) => ({ default: m.BlockEditor })),
)

const LIBRARY_COR = '#7fb8a8'

const TIPO_LABEL: Record<LibraryItemTipo, string> = {
  livro: 'LIVRO',
  filme: 'FILME',
  serie: 'SÉRIE',
  podcast: 'PODCAST',
  artigo: 'ARTIGO',
  video: 'VÍDEO',
  curso: 'CURSO',
  palestra: 'PALESTRA',
  paper: 'PAPER',
  outro: 'OUTRO',
}

const STATUS_LABEL: Record<LibraryItemStatus, string> = {
  queue: 'FILA',
  doing: 'EM ANDAMENTO',
  done: 'FECHADO',
  abandoned: 'ABANDONADO',
}

const STATUS_COR: Record<LibraryItemStatus, string> = {
  queue: 'var(--color-text-muted)',
  doing: LIBRARY_COR,
  done: 'var(--color-ice-light)',
  abandoned: 'var(--color-text-secondary)',
}

// Transições permitidas (espelha _validate_status_transition do backend).
const ALLOWED_TRANSITIONS: Record<LibraryItemStatus, LibraryItemStatus[]> = {
  queue: ['doing', 'abandoned'],
  doing: ['done', 'abandoned', 'queue'],
  done: ['doing'],
  abandoned: ['doing'],
}

export default function LibraryItemPage() {
  const { id: idStr } = useParams<{ id: string }>()
  const id = idStr ? parseInt(idStr, 10) : NaN
  const navigate = useNavigate()

  const { data: item, isLoading, error } = useLibraryItem(id)
  const { data: sessions = [] } = useLibrarySessions(id)
  const update = useUpdateLibraryItem()
  const deleteItem = useDeleteLibraryItem()
  const startSession = useStartLibrarySession()
  const pauseSession = usePauseLibrarySession()
  const [mindModalOpen, setMindModalOpen] = useState(false)

  if (isNaN(id) || id <= 0) return <Navigate to="/library" replace />

  if (isLoading) {
    return (
      <div
        style={{
          padding: 'var(--space-5) var(--space-6)',
          color: 'var(--color-text-muted)',
          fontFamily: MONO,
          fontSize: 12,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}
      >
        carregando…
      </div>
    )
  }

  if (error || !item) {
    return (
      <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-10)' }}>
        <Link
          to="/library"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--color-text-muted)',
            fontFamily: MONO,
            fontSize: 11,
            textDecoration: 'none',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            marginBottom: 'var(--space-3)',
          }}
        >
          <ArrowLeft size={12} /> LIBRARY
        </Link>
        <div
          className="hq-glass-elevated hq-grain hq-chamfer-cross"
          style={{
            padding: 'var(--space-5) var(--space-6)',
            borderLeft: '2px solid var(--color-warning)',
          }}
        >
          <div
            className="hq-tech-label"
            style={{ color: 'var(--color-warning)', marginBottom: 'var(--space-2)' }}
          >
            ITEM NÃO ENCONTRADO
          </div>
          <div style={{ fontFamily: BODY, fontSize: 14 }}>
            O item solicitado não existe ou foi removido.
          </div>
        </div>
      </div>
    )
  }

  const activeSession = sessions.find((s) => s.ended_at === null) ?? null

  return (
    <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-10)' }}>
      <Link
        to="/library"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--color-text-muted)',
          fontFamily: MONO,
          fontSize: 11,
          textDecoration: 'none',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          marginBottom: 'var(--space-3)',
        }}
      >
        <ArrowLeft size={12} /> LIBRARY
      </Link>

      {/* HERO */}
      <header
        className="hq-glass-elevated hq-grain hq-chamfer-cross"
        style={{
          position: 'relative',
          padding: 'var(--space-4) var(--space-5)',
          marginBottom: 'var(--space-4)',
          borderLeft: `2px solid ${STATUS_COR[item.status]}`,
        }}
      >
        <div
          aria-hidden="true"
          className="hq-hairline-ice"
          style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
          }}
        >
          <BookOpen size={20} strokeWidth={1.6} color={LIBRARY_COR} />
          <span
            className="hq-tech-id"
            style={{
              color: STATUS_COR[item.status],
              border: `1px solid ${STATUS_COR[item.status]}`,
              padding: '2px 8px',
              letterSpacing: '0.18em',
            }}
          >
            {TIPO_LABEL[item.tipo]} · {STATUS_LABEL[item.status]}
          </span>
          {item.minutos_total > 0 && (
            <span
              className="hq-tech-id"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {formatMinutes(item.minutos_total)} TOTAL
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <StatusDropdown
              current={item.status}
              onChange={(next) => {
                if (next === 'done') {
                  if (!(item.tese_central?.trim() && item.o_que_ficou?.trim())) {
                    alert(
                      'Pra fechar (done), preencha "tese central" e "o que ficou" primeiro.',
                    )
                    return
                  }
                }
                if (next === 'abandoned') {
                  const reason = prompt(
                    'Por que abandonou? (ex: ficou chato / não era hora / saturei)',
                    item.abandoned_reason ?? '',
                  )
                  if (reason === null) return
                  update.mutate({
                    id: item.id,
                    patch: { status: 'abandoned', abandoned_reason: reason.trim() },
                  })
                  return
                }
                update.mutate({ id: item.id, patch: { status: next } })
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (
                  confirm(
                    `Deletar "${item.titulo}"? Apaga tudo (notas, sessões, conexões). Não dá pra desfazer.`,
                  )
                ) {
                  deleteItem.mutate(item.id, {
                    onSuccess: () => navigate('/library'),
                  })
                }
              }}
              className="hq-btn hq-btn--ghost"
              style={{
                fontSize: 11,
                padding: '7px 12px',
                color: 'var(--color-error)',
              }}
              title="Deletar"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        <InlineEditableTitle
          value={item.titulo}
          onSave={(v) => update.mutate({ id: item.id, patch: { titulo: v } })}
        />
        <InlineMetaRow item={item} />
      </header>

      {/* DESTILAÇÃO */}
      <section style={{ marginBottom: 'var(--space-5)' }}>
        <SectionLabel>
          DESTILAÇÃO{' '}
          <span style={{ color: 'var(--color-text-muted)' }}>
            · obrigatório pra fechar
          </span>
        </SectionLabel>
        <DestilacaoPanel item={item} />
      </section>

      {/* SESSÕES */}
      <section style={{ marginBottom: 'var(--space-5)' }}>
        <SectionLabel>SESSÕES · {sessions.length}</SectionLabel>
        <div
          className="hq-glass hq-chamfer-bl"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              flexWrap: 'wrap',
            }}
          >
            {activeSession ? (
              <button
                type="button"
                onClick={() => pauseSession.mutate(item.id)}
                disabled={pauseSession.isPending}
                className="hq-btn hq-btn--ghost"
                style={{ fontSize: 11, padding: '7px 14px' }}
              >
                <Pause size={13} strokeWidth={2.5} /> PAUSAR
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  startSession.mutate(item.id, {
                    onError: (err) => {
                      // Backend retorna 409 com `detail = title` da sessão
                      // rival (quest/task/routine/library). jsonFetch
                      // extrai `detail` → vira err.message.
                      const rival = (err as Error).message || 'outra atividade'
                      alertDialog({
                        title: 'Sessão em conflito',
                        message:
                          `Você tem "${rival}" rodando agora. ` +
                          'Pause ou finalize a atividade em andamento antes ' +
                          'de iniciar essa sessão. Regra do sistema: uma ' +
                          'sessão ativa por vez.',
                        variant: 'warning',
                        confirmLabel: 'ENTENDIDO',
                      })
                    },
                  })
                }
                disabled={startSession.isPending}
                className="hq-btn hq-btn--primary"
                style={{ fontSize: 11, padding: '7px 14px' }}
              >
                <Play size={13} strokeWidth={2.5} /> INICIAR SESSÃO
              </button>
            )}
            {activeSession && (
              <LiveTimer startedAt={activeSession.started_at} />
            )}
            <button
              type="button"
              onClick={() => setMindModalOpen(true)}
              className="hq-btn hq-btn--ghost"
              style={{
                fontSize: 11,
                padding: '7px 12px',
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color: '#9b88c4',
              }}
              title="Registrar observação no Mind a partir deste item (cross-link automático se gerar hipótese)"
            >
              <Eye size={12} strokeWidth={2} /> MIND
            </button>
            <span
              className="hq-tech-id"
              style={{ color: 'var(--color-text-muted)' }}
            >
              TOTAL: {formatMinutes(item.minutos_total)}
            </span>
          </div>

          {sessions.length > 0 && (
            <div
              style={{
                paddingTop: 'var(--space-2)',
                borderTop: '1px dashed var(--color-divider)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                  fontFamily: MONO,
                  fontSize: 9,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                }}
              >
                <span>30D ATRÁS</span>
                <span>DENSIDADE DE LEITURA (min/dia)</span>
                <span>HOJE</span>
              </div>
              <SessionsSparkline sessions={sessions} days={30} />
            </div>
          )}
        </div>
      </section>

      {/* REVISITA */}
      <section style={{ marginBottom: 'var(--space-5)' }}>
        <SectionLabel>REVISITA</SectionLabel>
        <RevisitaPanel item={item} />
      </section>

      {/* CONEXÕES — cross-links pra Mind hipóteses, Quests, princípios Build */}
      <section style={{ marginBottom: 'var(--space-5)' }}>
        <ConexoesPanel item={item} />
      </section>

      {/* NOTAS — BlockNote completo com slash menu (`/estudo` insere o
          template de destilação Feynman + tese + conexões + próxima ação). */}
      <section style={{ marginBottom: 'var(--space-5)' }}>
        <SectionLabel>
          NOTAS{' '}
          <span style={{ color: 'var(--color-text-muted)' }}>
            · digite "/" pras opções · "/estudo" insere o template
          </span>
        </SectionLabel>
        <NotesPanel item={item} />
      </section>

      {/* Modal Mind com origin pré-filled — cross-link library→hipótese é
          criado auto após submit se a sessão registrar hipótese. */}
      {mindModalOpen && (
        <MindRegisterModal
          originLibraryItemId={item.id}
          onClose={() => setMindModalOpen(false)}
        />
      )}
    </div>
  )
}

// ─── Subcomponentes ───────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="hq-tech-label"
      style={{
        marginTop: 'var(--space-5)',
        marginBottom: 'var(--space-2)',
        fontSize: 10,
      }}
    >
      {children}
    </div>
  )
}

function InlineEditableTitle({
  value,
  onSave,
}: {
  value: string
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  if (!editing) {
    return (
      <h1
        onClick={() => setEditing(true)}
        style={{
          fontFamily: DISPLAY,
          fontSize: 26,
          fontWeight: 600,
          margin: 'var(--space-3) 0 0',
          color: 'var(--color-text-primary)',
          cursor: 'text',
          lineHeight: 1.2,
        }}
        title="Clique pra editar"
      >
        {value}
      </h1>
    )
  }
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const v = draft.trim()
        if (v && v !== value) onSave(v)
        setEditing(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setDraft(value)
          setEditing(false)
        }
      }}
      autoFocus
      style={{
        background: 'transparent',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-primary)',
        padding: '4px 8px',
        fontFamily: DISPLAY,
        fontSize: 26,
        fontWeight: 600,
        marginTop: 'var(--space-3)',
        width: '100%',
        outline: 'none',
      }}
    />
  )
}

function InlineMetaRow({ item }: { item: LibraryItem }) {
  const update = useUpdateLibraryItem()
  const { data: sagas = [] } = useLibrarySagas()
  const [autor, setAutor] = useState(item.autor ?? '')
  const [ano, setAno] = useState(item.ano ? String(item.ano) : '')
  const [origem, setOrigem] = useState(item.origem ?? '')

  useEffect(() => setAutor(item.autor ?? ''), [item.autor])
  useEffect(() => setAno(item.ano ? String(item.ano) : ''), [item.ano])
  useEffect(() => setOrigem(item.origem ?? ''), [item.origem])

  function persist(field: 'autor' | 'ano' | 'origem', raw: string) {
    if (field === 'ano') {
      const v = raw.trim() ? parseInt(raw, 10) : null
      if (v !== item.ano) update.mutate({ id: item.id, patch: { ano: v } })
    } else {
      const v = raw.trim() || null
      if (v !== item[field]) update.mutate({ id: item.id, patch: { [field]: v } as any })
    }
  }

  function changeSaga(raw: string) {
    const next = raw === '' ? null : parseInt(raw, 10)
    if (next === item.saga_id) return
    update.mutate({ id: item.id, patch: { saga_id: next } })
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        marginTop: 'var(--space-2)',
        flexWrap: 'wrap',
      }}
    >
      <MetaInput
        label="autor / criador"
        value={autor}
        onChange={setAutor}
        onBlur={() => persist('autor', autor)}
      />
      <MetaInput
        label="ano"
        value={ano}
        onChange={setAno}
        onBlur={() => persist('ano', ano)}
        inputMode="numeric"
        width={80}
      />
      <MetaInput
        label="origem"
        value={origem}
        onChange={setOrigem}
        onBlur={() => persist('origem', origem)}
      />
      {/* Saga dropdown — pode vincular/desvincular sem sair da página */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
          saga
        </span>
        <select
          value={item.saga_id ?? ''}
          onChange={(e) => changeSaga(e.target.value)}
          style={{
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            padding: '4px 8px',
            fontFamily: BODY,
            fontSize: 12,
            outline: 'none',
            letterSpacing: 0,
            minWidth: 160,
          }}
        >
          <option value="">— sem saga —</option>
          {sagas.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
              {item.saga_id === s.id && item.saga_ordem > 0
                ? ` · #${String(item.saga_ordem).padStart(2, '0')}`
                : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function MetaInput({
  label,
  value,
  onChange,
  onBlur,
  inputMode,
  width,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur: () => void
  inputMode?: 'numeric'
  width?: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        placeholder="—"
        style={{
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-primary)',
          padding: '4px 8px',
          fontFamily: BODY,
          fontSize: 12,
          outline: 'none',
          letterSpacing: 0,
          width: width ?? undefined,
          minWidth: width ?? 140,
        }}
      />
    </div>
  )
}

function StatusDropdown({
  current,
  onChange,
}: {
  current: LibraryItemStatus
  onChange: (next: LibraryItemStatus) => void
}) {
  return (
    <select
      value={current}
      onChange={(e) => {
        const next = e.target.value as LibraryItemStatus
        if (next !== current) onChange(next)
      }}
      style={{
        background: 'var(--color-bg-primary)',
        border: `1px solid ${STATUS_COR[current]}`,
        color: STATUS_COR[current],
        padding: '6px 10px',
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        outline: 'none',
        cursor: 'pointer',
      }}
    >
      <option value={current}>{STATUS_LABEL[current].toLowerCase()}</option>
      {ALLOWED_TRANSITIONS[current].map((s) => (
        <option key={s} value={s}>
          → {STATUS_LABEL[s].toLowerCase()}
        </option>
      ))}
    </select>
  )
}

function DestilacaoPanel({ item }: { item: LibraryItem }) {
  const update = useUpdateLibraryItem()
  const [tese, setTese] = useState(item.tese_central ?? '')
  const [oQueFicou, setOQueFicou] = useState(item.o_que_ficou ?? '')
  const [reason, setReason] = useState(item.abandoned_reason ?? '')

  useEffect(() => setTese(item.tese_central ?? ''), [item.tese_central])
  useEffect(() => setOQueFicou(item.o_que_ficou ?? ''), [item.o_que_ficou])
  useEffect(() => setReason(item.abandoned_reason ?? ''), [item.abandoned_reason])

  function persist(field: 'tese_central' | 'o_que_ficou' | 'abandoned_reason', v: string) {
    const val = v.trim() || null
    if (val !== item[field]) {
      update.mutate({ id: item.id, patch: { [field]: val } as any })
    }
  }

  if (item.status === 'abandoned') {
    return (
      <div
        className="hq-glass hq-chamfer-bl"
        style={{
          padding: 'var(--space-3) var(--space-4)',
          borderLeft: '2px solid var(--color-text-secondary)',
        }}
      >
        <div
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}
        >
          MOTIVO DO ABANDONO
        </div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => persist('abandoned_reason', reason)}
          placeholder="ex: ficou chato / não era hora / saturei nesse tema"
          rows={2}
          style={textareaStyle}
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div
        className="hq-glass hq-chamfer-bl"
        style={{
          padding: 'var(--space-3) var(--space-4)',
          borderLeft: `2px solid ${LIBRARY_COR}`,
        }}
      >
        <div
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}
        >
          TESE CENTRAL{' '}
          <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            · uma frase. se não cabe em uma, ainda não entendeu.
          </span>
        </div>
        <textarea
          value={tese}
          onChange={(e) => setTese(e.target.value)}
          onBlur={() => persist('tese_central', tese)}
          placeholder="A ideia principal em uma frase…"
          rows={2}
          style={textareaStyle}
        />
      </div>

      <div
        className="hq-glass hq-chamfer-bl"
        style={{
          padding: 'var(--space-3) var(--space-4)',
          borderLeft: `2px solid ${LIBRARY_COR}`,
        }}
      >
        <div
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}
        >
          O QUE FICOU{' '}
          <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            · o que mudou ou ficou ressoando depois de fechar
          </span>
        </div>
        <textarea
          value={oQueFicou}
          onChange={(e) => setOQueFicou(e.target.value)}
          onBlur={() => persist('o_que_ficou', oQueFicou)}
          placeholder="O que mudou no seu modelo mental, ou o que ficou ressoando…"
          rows={3}
          style={textareaStyle}
        />
      </div>
    </div>
  )
}

function NotesPanel({ item }: { item: LibraryItem }) {
  const update = useUpdateLibraryItem()
  // notes_json é JSON serializado do BlockNote (mesmo formato dos
  // nested-pages). String vazia/null = editor vazio.
  // Debounce de salva via ref — evita gravar a cada keystroke.
  const initialRef = useRef(item.notes_json ?? '')
  const lastSavedRef = useRef(item.notes_json ?? '')
  const timerRef = useRef<number | null>(null)

  function handleChange(serialized: string) {
    if (serialized === lastSavedRef.current) return
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      const v = serialized || null
      if (v === lastSavedRef.current) return
      lastSavedRef.current = serialized
      update.mutate({ id: item.id, patch: { notes_json: v } })
    }, 600)
  }

  // Cleanup do timer ao desmontar
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <div
      className="hq-glass hq-chamfer-bl"
      style={{
        padding: 'var(--space-3) var(--space-4)',
        minHeight: 200,
      }}
    >
      <Suspense
        fallback={
          <div
            style={{
              color: 'var(--color-text-muted)',
              fontSize: 12,
              fontFamily: MONO,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: 'var(--space-3) 0',
            }}
          >
            carregando editor…
          </div>
        }
      >
        <BlockEditor
          value={initialRef.current}
          onChange={handleChange}
          placeholder="Digite / para opções. Tente /estudo pro template de destilação."
          minHeight={180}
          enableEstudoTemplate
        />
      </Suspense>
    </div>
  )
}

function RevisitaPanel({ item }: { item: LibraryItem }) {
  const update = useUpdateLibraryItem()
  const [data, setData] = useState(item.revisitar_em ?? '')
  useEffect(() => setData(item.revisitar_em ?? ''), [item.revisitar_em])

  function setRel(months: number) {
    const d = new Date()
    d.setMonth(d.getMonth() + months)
    const iso = d.toISOString().slice(0, 10)
    setData(iso)
    update.mutate({ id: item.id, patch: { revisitar_em: iso } })
  }

  function clearDate() {
    setData('')
    update.mutate({ id: item.id, patch: { revisitar_em: '' } })
  }

  function persistManual() {
    const v = data || ''
    if (v !== (item.revisitar_em ?? '')) {
      update.mutate({ id: item.id, patch: { revisitar_em: v } })
    }
  }

  return (
    <div
      className="hq-glass hq-chamfer-bl"
      style={{
        padding: 'var(--space-3) var(--space-4)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        flexWrap: 'wrap',
      }}
    >
      <input
        type="date"
        value={data}
        onChange={(e) => setData(e.target.value)}
        onBlur={persistManual}
        style={{
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-primary)',
          padding: '6px 10px',
          fontFamily: MONO,
          fontSize: 12,
          outline: 'none',
        }}
      />
      <div style={{ display: 'flex', gap: 4 }}>
        {[
          { label: '+1 MÊS', m: 1 },
          { label: '+3 MESES', m: 3 },
          { label: '+6 MESES', m: 6 },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => setRel(opt.m)}
            className="hq-btn hq-btn--ghost"
            style={{ fontSize: 10, padding: '5px 10px' }}
          >
            {opt.label}
          </button>
        ))}
        {data && (
          <button
            type="button"
            onClick={clearDate}
            className="hq-btn hq-btn--ghost"
            style={{
              fontSize: 10,
              padding: '5px 10px',
              color: 'var(--color-error)',
            }}
          >
            LIMPAR
          </button>
        )}
      </div>
      <span
        className="hq-tech-id"
        style={{
          color: 'var(--color-text-muted)',
          fontStyle: 'italic',
          marginLeft: 'auto',
        }}
      >
        relê suas notas, não o material
      </span>
    </div>
  )
}

function ConexoesPanel({ item }: { item: LibraryItem }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const deleteLink = useDeleteLibraryLink(item.id)

  // Carrega catálogos das entidades de destino pra resolver labels.
  // Sem isso o link ficaria com "mind_hipotese → 5" em vez do texto.
  const { data: hipoteses = [] } = useMindHipoteses(undefined)
  const { data: quests = [] } = useQuests()
  const { data: principles = [] } = usePrinciples(true)
  const { data: goals = [] } = useGoals()

  const lookup = useMemo(() => {
    const map = new Map<string, { label: string; sublabel?: string }>()
    for (const h of hipoteses) {
      map.set(`mind_hipotese:${h.id}`, { label: h.texto, sublabel: h.status })
    }
    for (const q of quests) {
      map.set(`quest:${q.id}`, { label: q.title, sublabel: q.area_slug })
    }
    for (const p of principles) {
      map.set(`build_principle:${p.id}`, { label: p.texto })
    }
    for (const g of goals) {
      map.set(`build_goal:${g.id}`, { label: g.titulo, sublabel: g.horizon })
    }
    return map
  }, [hipoteses, quests, principles, goals])

  const existingKeys = useMemo(
    () => new Set(item.links.map((l) => `${l.target_type}:${l.target_id}`)),
    [item.links],
  )

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-2)',
        }}
      >
        <SectionLabel>CONEXÕES · {item.links.length}</SectionLabel>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="hq-btn hq-btn--ghost"
          style={{
            fontSize: 11,
            padding: '5px 12px',
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Plus size={12} strokeWidth={2.5} /> ADICIONAR
        </button>
      </div>

      {item.links.length === 0 ? (
        <div
          className="hq-glass hq-chamfer-bl"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            color: 'var(--color-text-muted)',
            fontSize: 12,
            fontFamily: BODY,
            fontStyle: 'italic',
          }}
        >
          Nenhuma conexão ainda. Conecta esse item a uma hipótese do Mind, uma
          quest ou um princípio do /Build — é o que transforma item solto em
          parte do sistema.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {item.links.map((l) => (
            <CrossLinkRow
              key={l.id}
              link={l}
              resolved={lookup.get(`${l.target_type}:${l.target_id}`)}
              onDelete={() => deleteLink.mutate(l.id)}
            />
          ))}
        </div>
      )}

      {pickerOpen && (
        <CrossLinkPicker
          itemId={item.id}
          existingKeys={existingKeys}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  )
}

function CrossLinkRow({
  link,
  resolved,
  onDelete,
}: {
  link: LibraryLink
  resolved: { label: string; sublabel?: string } | undefined
  onDelete: () => void
}) {
  const typeLabel: Record<LibraryLinkTargetType, string> = {
    mind_hipotese: 'HIPÓTESE',
    quest: 'QUEST',
    build_principle: 'PRINCÍPIO',
    build_goal: 'META',
  }
  const typeColor: Record<LibraryLinkTargetType, string> = {
    mind_hipotese: '#9b88c4',
    quest: 'var(--color-ice-light)',
    build_principle: 'var(--color-warning)',
    build_goal: 'var(--color-ice-light)',
  }
  const cor = typeColor[link.target_type]
  return (
    <div
      className="hq-glass hq-chamfer-bl"
      style={{
        padding: 'var(--space-2) var(--space-3)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-2)',
        borderLeft: `2px solid ${cor}`,
      }}
    >
      <span
        className="hq-tech-id"
        style={{
          color: cor,
          border: `1px solid ${cor}`,
          padding: '1px 6px',
          letterSpacing: '0.12em',
          fontSize: 9,
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {typeLabel[link.target_type]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: BODY,
            fontSize: 13,
            color: 'var(--color-text-primary)',
            lineHeight: 1.4,
          }}
        >
          {resolved ? (
            resolved.label
          ) : (
            <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              (alvo não encontrado — pode ter sido deletado)
            </span>
          )}
          {resolved?.sublabel && (
            <span
              className="hq-tech-id"
              style={{
                color: 'var(--color-text-muted)',
                marginLeft: 8,
                fontSize: 9,
              }}
            >
              {resolved.sublabel.toUpperCase()}
            </span>
          )}
        </div>
        {link.nota && (
          <div
            style={{
              fontFamily: BODY,
              fontSize: 11,
              color: 'var(--color-text-muted)',
              fontStyle: 'italic',
              marginTop: 2,
            }}
          >
            {link.nota}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="hq-icon-btn-bare"
        style={{ color: 'var(--color-error)', flexShrink: 0 }}
        title="Remover conexão"
      >
        <X size={12} />
      </button>
    </div>
  )
}

/**
 * Sparkline 30d das sessões — uma barra vertical por dia, altura
 * proporcional a minutos lidos naquele dia. Dia sem leitura = traço fino
 * cinza (mantém a régua temporal). Dia com sessão em curso (ended_at=null)
 * usa "agora" como fim pra incluir o tempo da sessão ativa.
 *
 * Filosofia: bate-papo visual com a consistência ("estou lendo todo dia?")
 * sem precisar abrir TimeReports.
 */
function SessionsSparkline({
  sessions,
  days,
}: {
  sessions: ReturnType<typeof useLibrarySessions>['data']
  days: number
}) {
  const list = sessions ?? []
  const buckets = new Array(days).fill(0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const now = Date.now()

  for (const s of list) {
    try {
      const start = new Date(s.started_at.replace('Z', '+00:00')).getTime()
      const end = s.ended_at
        ? new Date(s.ended_at.replace('Z', '+00:00')).getTime()
        : now
      const minutes = Math.max(0, Math.floor((end - start) / 60000))
      if (minutes === 0) continue
      // Bucket pelo dia em que a sessão *começou* (alinha com TimeReports).
      const startDate = new Date(s.started_at.replace('Z', '+00:00'))
      startDate.setHours(0, 0, 0, 0)
      const diff = Math.floor(
        (today.getTime() - startDate.getTime()) / 86_400_000,
      )
      if (diff >= 0 && diff < days) {
        buckets[days - 1 - diff] += minutes
      }
    } catch {
      // Sessão com timestamp malformado — ignora silenciosamente.
    }
  }

  const max = Math.max(1, ...buckets)
  return (
    <div
      aria-label={`Sessões nos últimos ${days} dias`}
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 1,
        height: 28,
        width: '100%',
      }}
      title={`Total: ${formatMinutes(buckets.reduce((a, b) => a + b, 0))}`}
    >
      {buckets.map((v, i) => {
        const h = v === 0 ? 1 : 3 + (v / max) * 24
        return (
          <div
            key={i}
            title={
              v > 0
                ? `${formatMinutes(v)} (${i + 1 === days ? 'hoje' : `${days - 1 - i}d atrás`})`
                : 'sem leitura'
            }
            style={{
              flex: 1,
              minWidth: 0,
              height: h,
              background: v === 0 ? 'var(--color-divider)' : LIBRARY_COR,
              opacity: v === 0 ? 0.5 : 0.4 + 0.6 * (v / max),
              borderRadius: 0.5,
            }}
          />
        )
      })}
    </div>
  )
}

function LiveTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const start = new Date(startedAt.replace('Z', '+00:00')).getTime()
  const seconds = Math.max(0, Math.floor((now - start) / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 16,
        fontVariantNumeric: 'tabular-nums',
        color: LIBRARY_COR,
        letterSpacing: '0.06em',
      }}
    >
      {pad(h)}:{pad(m)}:{pad(s)}
    </span>
  )
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--color-bg-primary)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-primary)',
  padding: '8px 10px',
  fontFamily: BODY,
  fontSize: 13,
  outline: 'none',
  letterSpacing: 0,
  resize: 'vertical',
  lineHeight: 1.5,
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}
