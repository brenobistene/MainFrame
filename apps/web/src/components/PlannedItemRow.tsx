import { useEffect, useState, lazy, Suspense } from 'react'
import type { ActiveSession, Area, Quest } from '../types'
import {
  fetchSessions, fetchTaskSessions, fetchRoutineSessions,
  patchQuest, updateTask, updateRoutine, toggleRoutine,
  reportApiError,
} from '../api'
import { useAppInvalidator } from '../lib/app-queries'
import { tabSync } from '../lib/tabsync'
import { RunnableControls } from './RunnableControls'
import { isBlockDocEmpty } from './block-utils'
import { alertDialog } from '../lib/dialog'

// BlockEditor é pesado (~1.1 MB de @blocknote) — só baixa quando o user
// expande a descrição de uma quest/task/rotina. Lazy load via React.lazy
// com Suspense fallback minimalista. `isBlockDocEmpty` segue eager via
// `block-utils.ts` pra logic de save não esperar o chunk.
const BlockEditor = lazy(() =>
  import('./BlockEditor').then(m => ({ default: m.BlockEditor }))
)

/**
 * Row usado dentro dos períodos (manhã/tarde/noite) da tela Dia.
 * Play/pause/stop completos + cronômetro para qualquer tipo (quest/task/routine).
 */
export function PlannedItemRow({ item, areas, activeSession, onSessionUpdate, onRemoveFromPlan, target, parentTitle, deliverableTitle, onOpen, migratedFromLabel }: {
  item: any
  areas: Area[]
  activeSession: ActiveSession | null
  onSessionUpdate: () => void
  onRemoveFromPlan: () => void
  target: string
  /** Breadcrumb pro card: mostrado quando item é quest subtarefa. */
  parentTitle?: string | null
  deliverableTitle?: string | null
  /** Se fornecido, o título vira clicável (usado pra navegar pro projeto
   *  quando o item é uma quest). `undefined` = título não-clicável. */
  onOpen?: () => void
  /** Rótulo do turno de origem se o item foi migrado automaticamente
   *  (ex: "manhã"). Renderiza um indicador discreto "↑ veio da manhã". */
  migratedFromLabel?: string
}) {
  const [showDescription, setShowDescription] = useState(false)
  const [descDraft, setDescDraft] = useState<string | null>(null)
  const appInv = useAppInvalidator()
  const isRoutine = !!item?.isRoutine
  const isTask = !!item?.isTask
  const kind: 'quest' | 'task' | 'routine' = isRoutine ? 'routine' : isTask ? 'task' : 'quest'

  // Auto-save da descrição com debounce de 800ms. Cada tipo tem endpoint
  // próprio: quests via patchQuest, tasks via updateTask, routines via
  // updateRoutine. Doc-vazio do BlockEditor é gravado como null.
  // Invalida cache + emite tabSync depois do save pra outras views da mesma
  // entidade (no /tarefas, /rotinas, /areas/*) verem a descrição atualizada
  // sem F5.
  useEffect(() => {
    if (descDraft === null) return
    const current = item?.description ?? null
    if (descDraft === (current ?? '')) return
    const t = setTimeout(() => {
      const newVal = isBlockDocEmpty(descDraft) ? null : descDraft
      if (newVal === current) return
      const save = kind === 'quest'
        ? patchQuest(item.id, { description: newVal })
        : kind === 'task'
          ? updateTask(item.id, { description: newVal })
          : updateRoutine(item.id, { description: newVal })
      save
        .then(() => {
          if (kind === 'quest') { appInv.quests(); tabSync.emit('quests') }
          else if (kind === 'task') { appInv.tasks(); tabSync.emit('tasks') }
          else { appInv.routines(); tabSync.emit('routines') }
        })
        .catch(err => reportApiError(`PlannedItemRow.save(${kind})`, err))
    }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descDraft, item?.description, item?.id, kind])

  const itemColor = isTask
    ? 'var(--color-gold)'
    : isRoutine
      ? 'var(--color-routine-block)'
      : (areas.find(a => a.slug === (item as Quest).area_slug)?.color || 'var(--color-text-tertiary)')

  // `id` preservado pra permitir edição/exclusão da sessão pelo
  // SessionHistoryModal (PATCH/DELETE /api/{kind}-sessions/{id}).
  const [sessions, setSessions] = useState<{ id?: number; started_at: string; ended_at: string | null }[]>([])
  // Trigger pra refetch quando session é editada/deletada via modal. O
  // activeSession só muda quando a sessão LIVE muda — deletar uma sessão
  // antiga (não-ativa) não dispara nenhum dep, então sessions ficavam
  // stale e modal mostrava entrada já deletada.
  const [sessionsTick, setSessionsTick] = useState(0)
  useEffect(() => {
    if (!item?.id) { setSessions([]); return }
    let cancelled = false
    const loader = kind === 'quest'
      ? fetchSessions(item.id)
      : kind === 'task'
        ? fetchTaskSessions(item.id)
        : fetchRoutineSessions(item.id, target)
    loader
      .then(list => {
        if (cancelled) return
        const safe = Array.isArray(list) ? list : []
        setSessions(safe.map((s: any) => ({
          id: s?.id,
          started_at: s?.started_at ?? '',
          ended_at: s?.ended_at ?? null,
        })))
      })
      .catch(() => { if (!cancelled) setSessions([]) })
    return () => { cancelled = true }
  }, [item?.id, kind, target, activeSession?.type, activeSession?.id, activeSession?.started_at, activeSession?.ended_at, sessionsTick])

  // Wrappa onSessionUpdate pra refetchar sessions local quando o modal
  // delete/edita uma row. Sem isso, sessions stale ficam visíveis no modal.
  const handleSessionUpdate = () => {
    setSessionsTick(t => t + 1)
    onSessionUpdate()
  }

  const done = item.status === 'done' || item.done === true
  const typeLabel = isTask ? 'Tarefa' : isRoutine ? 'Rotina' : (item as Quest).area_slug

  // Thumbnail content: type code (QST/TSK/RTN) + duração mono.
  const typeCode = isRoutine ? 'RTN' : isTask ? 'TSK' : 'QST'
  const typeAccent = isRoutine ? 'var(--color-success)'
    : isTask ? 'var(--color-warning)'
    : 'var(--color-ice)'
  const durMin = isTask
    ? (item.duration_minutes ?? 0)
    : (item.estimated_minutes ?? 0)
  const durLabel = durMin > 0
    ? (durMin >= 60
      ? `${Math.floor(durMin / 60)}H${durMin % 60 ? ` ${durMin % 60}M` : ''}`
      : `${durMin}M`)
    : '—'
  const borderColor = done
    ? 'rgba(255, 255, 255, 0.06)'
    : 'rgba(143, 191, 211, 0.22)'

  return (
    <div
      style={{
        // Wrapper externo: posiciona thumbnail + main side-by-side e
        // permite description expandida ocupar largura total abaixo.
        display: 'flex', flexDirection: 'column', gap: 0,
        width: '100%', boxSizing: 'border-box', minWidth: 0, maxWidth: '100%',
        opacity: done ? 0.5 : 1,
      }}
    >
    <div
      style={{
        display: 'flex', alignItems: 'stretch', gap: 6,
        position: 'relative',
        transition: 'transform var(--motion-fast) var(--ease-smooth)',
      }}
      onMouseEnter={e => {
        if (done) return
        e.currentTarget.style.transform = 'translateX(2px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateX(0)'
      }}
    >
      {/* THUMBNAIL — bloco esquerdo separado com type code + duração.
          Top-left chamfer angular, bg gradient na cor do tipo/área. */}
      <div
        style={{
          width: 64, flexShrink: 0,
          background: `linear-gradient(135deg, ${itemColor}22, ${itemColor}08 60%, transparent)`,
          border: `1px solid ${borderColor}`,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 4,
          clipPath: 'polygon(8px 0, 100% 0, 100% 100%, 0 100%, 0 8px)',
          transition: 'border-color var(--motion-fast) var(--ease-smooth)',
        }}
      >
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12, fontWeight: 700,
          color: typeAccent,
          letterSpacing: '0.12em',
          lineHeight: 1,
          textShadow: done ? 'none' : `0 0 6px ${typeAccent}55`,
        }}>
          {typeCode}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9, fontWeight: 700,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.08em',
          lineHeight: 1,
        }}>
          {durLabel}
        </div>
        {/* Dot da área (só pra quests) — micro reforço visual */}
        {!isTask && !isRoutine && (
          <div
            aria-hidden="true"
            style={{
              width: 5, height: 5,
              background: itemColor,
              marginTop: 2,
            }}
          />
        )}
      </div>

      {/* MAIN CARD — body principal com title + breadcrumb + controles.
          Bottom-right chamfer assinatura CP2077. */}
      <div
        style={{
          flex: 1, minWidth: 0,
          background: 'rgba(8, 12, 18, 0.55)',
          border: `1px solid ${borderColor}`,
          borderRadius: 0,
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
          padding: '10px 14px',
          display: 'flex', flexDirection: 'column', gap: 6,
          transition: 'border-color var(--motion-fast) var(--ease-smooth), background var(--motion-fast) var(--ease-smooth), box-shadow var(--motion-fast) var(--ease-smooth)',
        }}
        onMouseEnter={e => {
          if (done) return
          e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
          e.currentTarget.style.boxShadow = '0 0 12px rgba(143, 191, 211, 0.18)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = borderColor
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
      {/* Header em linha — título/breadcrumb à esquerda, controles à direita */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap',
        width: '100%', minWidth: 0,
      }}>
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              onClick={onOpen}
              title={onOpen ? 'Abrir projeto' : undefined}
              style={{
                fontFamily: 'var(--font-display)',
                color: 'var(--color-text-primary)', fontWeight: 600, fontSize: 13,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
                textDecoration: done ? 'line-through' : 'none',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                cursor: onOpen ? 'pointer' : 'default',
                transition: 'color 0.12s',
              }}
              onMouseEnter={e => { if (onOpen) e.currentTarget.style.color = 'var(--color-ice-light)' }}
              onMouseLeave={e => { if (onOpen) e.currentTarget.style.color = 'var(--color-text-primary)' }}
            >
              {item.title}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowDescription(!showDescription)
              }}
              title={item?.description ? (showDescription ? 'Ocultar descrição' : 'Ver descrição') : 'Adicionar descrição'}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                color: item?.description ? 'var(--color-ice-light)' : 'var(--color-text-muted)',
                fontSize: 9, padding: '2px 4px',
                fontWeight: 700,
                letterSpacing: '0.18em',
                display: 'inline-flex', alignItems: 'center', gap: 3,
                transition: 'color 0.15s', flexShrink: 0,
                opacity: item?.description ? 1 : 0.7,
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ice-light)')}
              onMouseLeave={e => (e.currentTarget.style.color = item?.description ? 'var(--color-ice-light)' : 'var(--color-text-muted)')}
            >
              <span style={{ fontSize: 9 }}>{showDescription ? '▼' : '▶'}</span>
              <span style={{ textTransform: 'uppercase' }}>INFO</span>
            </button>
          </div>
          {(parentTitle || deliverableTitle) && (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9, color: 'var(--color-text-muted)',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              fontWeight: 600,
              marginTop: 4,
              display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
            }}>
              {parentTitle && <span>{parentTitle}</span>}
              {parentTitle && deliverableTitle && (
                <span style={{ opacity: 0.4 }}>·</span>
              )}
              {deliverableTitle && (
                <span style={{ color: 'var(--color-ice-light)' }}>{deliverableTitle}</span>
              )}
            </div>
          )}
          {/* Meta row — só extras (start/end time + migration label).
              Type code e duração já vivem na thumbnail. */}
          {((item.start_time && item.end_time) || migratedFromLabel || (!isTask && !isRoutine && (item as Quest).area_slug && !parentTitle)) && (
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
              display: 'flex', gap: 10, marginTop: 2, flexWrap: 'wrap',
            }}>
              {!isTask && !isRoutine && (item as Quest).area_slug && !parentTitle && (
                <span style={{ color: 'var(--color-ice)' }}>{typeLabel}</span>
              )}
              {(item.start_time && item.end_time) && (
                <span style={{ opacity: 0.85 }}>{item.start_time}–{item.end_time}</span>
              )}
              {migratedFromLabel && (
                <span
                  title={`Migrado automaticamente da ${migratedFromLabel} porque o turno encerrou`}
                  style={{
                    color: 'var(--color-ice-deep)',
                    letterSpacing: '0.18em',
                  }}
                >
                  <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                  ↑ FROM {migratedFromLabel.toUpperCase()}
                </span>
              )}
            </div>
          )}
        </div>
        <RunnableControls
          runnableType={kind}
          id={item.id}
          sessions={sessions}
          activeSession={activeSession}
          onSessionUpdate={handleSessionUpdate}
          target={kind === 'routine' ? target : undefined}
          done={done}
          onReopen={async () => {
            try {
              if (kind === 'quest') await patchQuest(item.id, { status: 'doing' })
              else if (kind === 'task') await updateTask(item.id, { done: false })
              else await toggleRoutine(item.id)
              if (kind === 'quest') { appInv.quests(); tabSync.emit('quests') }
              else if (kind === 'task') { appInv.tasks(); tabSync.emit('tasks') }
              else { appInv.routines(); tabSync.emit('routines') }
              handleSessionUpdate()
            } catch (err) {
              console.error('[runnable] reopen failed', { kind, id: item.id, err })
              alertDialog({ title: 'Erro', message: 'Erro ao reabrir — veja o console (F12).', variant: 'danger' })
            }
          }}
        />
        <button
          onClick={onRemoveFromPlan}
          title="remover do plano do dia"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-muted)', fontSize: 12, padding: '0 6px',
            opacity: 0.55, transition: 'opacity 0.15s, color 0.15s',
            alignSelf: 'flex-start',
            lineHeight: 1,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.opacity = '1'
            e.currentTarget.style.color = 'var(--color-accent-light)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.opacity = '0.55'
            e.currentTarget.style.color = 'var(--color-text-muted)'
          }}
        >
          ✕
        </button>
      </div>
      </div>
    </div>

    {/* Descrição expandida — wrapper cyber com header tech-label +
        container border ice + chamfer-bl. Indented pra alinhar com main. */}
    {showDescription && (
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          paddingLeft: 70,
          paddingTop: 6,
        }}
      >
        <div style={{
          background: 'rgba(8, 10, 14, 0.55)',
          border: '1px solid rgba(143, 191, 211, 0.22)',
          borderRadius: 0,
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
          padding: '10px 14px',
        }}>
          {/* Header tech-label */}
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 8, fontWeight: 700,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
            marginBottom: 8,
            paddingBottom: 6,
            borderBottom: '1px solid var(--color-divider)',
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            DESCRIPTION
          </div>
          <Suspense fallback={
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 9,
              color: 'var(--color-text-muted)', letterSpacing: '0.18em',
              textTransform: 'uppercase', padding: '20px 0',
            }}>
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              LOADING.EDITOR
            </div>
          }>
            <BlockEditor
              value={descDraft ?? item?.description ?? ''}
              onChange={setDescDraft}
              placeholder="Digite / pra ver os blocos…"
              minHeight={80}
            />
          </Suspense>
        </div>
      </div>
    )}
    </div>
  )
}
