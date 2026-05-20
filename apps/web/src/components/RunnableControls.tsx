import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import type { ActiveSession, Routine } from '../types'
import {
  startSession, pauseSession, resumeSession, patchQuest,
  startTaskSession, pauseTaskSession, resumeTaskSession, stopTaskSession,
  startRoutineSession, pauseRoutineSession, resumeRoutineSession, stopRoutineSession,
} from '../api'
import { appKeys } from '../lib/app-queries'
import { parseIsoAsUtc, sumClosedSessionsSeconds, formatHMS } from '../utils/datetime'
import { SessionHistoryModal } from './SessionHistoryModal'
import { alertDialog } from '../lib/dialog'

/**
 * Play/pause/resume/stop cluster + live timer for a quest / task / routine.
 *
 * Behavior:
 * - If this entity is the currently active (or paused) session globally,
 *   shows the current-session timer (same as banner) + pause/resume + finalize.
 * - If another entity is active, shows total accumulated time (if any) + play.
 *   A 409 on start/resume means something else is running; the user is alerted
 *   with the conflicting entity title.
 * - If `done` is true, shows a "FEITO" badge + optional reopen button.
 *
 * Finalize semantics:
 * - quest → patchQuest status='done' (after pausing if still running)
 * - task  → stopTaskSession (fecha sessão + marca done)
 * - routine → stopRoutineSession (fecha sessão + cria routine_log do dia)
 */
export function RunnableControls({ runnableType, id, sessions, activeSession, onSessionUpdate, target, done, onReopen }: {
  runnableType: 'quest' | 'task' | 'routine'
  id: string
  sessions: { id?: number; started_at: string; ended_at: string | null }[]
  activeSession: ActiveSession | null
  onSessionUpdate: () => void
  target?: string
  done?: boolean
  onReopen?: () => void
}) {
  const qc = useQueryClient()
  const isThis = !!activeSession && activeSession.type === runnableType && activeSession.id === id
  const running = isThis && activeSession!.is_active

  const closedSec = sumClosedSessionsSeconds(sessions)
  const [liveSec, setLiveSec] = useState(0)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    if (!isThis || !activeSession) { setLiveSec(0); return }
    const start = parseIsoAsUtc(activeSession.started_at).getTime()
    if (isNaN(start)) { setLiveSec(0); return }
    if (running) {
      const tick = () => setLiveSec(Math.max(0, Math.floor((Date.now() - start) / 1000)))
      tick()
      const iv = setInterval(tick, 100)
      return () => clearInterval(iv)
    } else if (activeSession.ended_at) {
      const end = parseIsoAsUtc(activeSession.ended_at).getTime()
      if (!isNaN(end)) setLiveSec(Math.max(0, Math.floor((end - start) / 1000)))
      else setLiveSec(0)
    } else {
      setLiveSec(0)
    }
  }, [isThis, running, activeSession?.started_at, activeSession?.ended_at])

  const displaySec = isThis ? liveSec : closedSec

  async function handlePlay() {
    try {
      if (runnableType === 'quest') await startSession(id)
      else if (runnableType === 'task') await startTaskSession(id)
      else await startRoutineSession(id, target)
      onSessionUpdate()
    } catch (err: any) {
      if (err?.conflictTitle) {
        alertDialog({ title: 'Sessão em execução', message: `"${err.conflictTitle}" está em execução. Pause antes.`, variant: 'warning' })
      } else {
        alertDialog({ title: 'Erro', message: 'Erro ao iniciar sessão — veja o console (F12).', variant: 'danger' })
      }
      console.error('[runnable] start failed', { runnableType, id, err })
    }
  }
  async function handlePause() {
    try {
      if (runnableType === 'quest') await pauseSession(id)
      else if (runnableType === 'task') await pauseTaskSession(id)
      else await pauseRoutineSession(id, target)
      onSessionUpdate()
    } catch (err) {
      console.error('[runnable] pause failed', { runnableType, id, err })
      alertDialog({ title: 'Erro', message: 'Erro ao pausar — veja o console (F12).', variant: 'danger' })
    }
  }
  async function handleResume() {
    try {
      if (runnableType === 'quest') await resumeSession(id)
      else if (runnableType === 'task') await resumeTaskSession(id)
      else await resumeRoutineSession(id, target)
      onSessionUpdate()
    } catch (err: any) {
      if (err?.conflictTitle) {
        alertDialog({ title: 'Sessão em execução', message: `"${err.conflictTitle}" está em execução. Pause antes.`, variant: 'warning' })
      } else {
        alertDialog({ title: 'Erro', message: 'Erro ao retomar — veja o console (F12).', variant: 'danger' })
      }
      console.error('[runnable] resume failed', { runnableType, id, err })
    }
  }
  async function handleStop() {
    try {
      if (runnableType === 'quest') {
        if (running) await pauseSession(id)
        await patchQuest(id, { status: 'done' })
      } else if (runnableType === 'task') {
        await stopTaskSession(id)
      } else {
        await stopRoutineSession(id, target)
        if (target) {
          // Optimistic cache update: marca a rotina como done na cache de
          // useRoutinesForDate(target). Funciona se a rotina já estava na
          // lista do dia. Pra rotinas off-schedule arrastadas pro plano, o
          // invalidate abaixo é que pega — backend agora retorna rotina com
          // log mesmo se ela não passa em _routine_passes_on.
          qc.setQueryData<Routine[]>(appKeys.routinesForDate(target), (old) => {
            if (!old) return old
            return old.map(r => r.id === id ? { ...r, done: true } : r)
          })
          qc.invalidateQueries({ queryKey: appKeys.routines() })
        }
      }
      onSessionUpdate()
    } catch (err) {
      console.error('[runnable] stop failed', { runnableType, id, err })
      alertDialog({ title: 'Erro', message: 'Erro ao finalizar — veja o console (F12).', variant: 'danger' })
    }
  }

  const canShowHistory = sessions.length > 0

  // ─── Estilos cyber compartilhados ───────────────────────────────────────
  const cyberBtnBase = {
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: 9, fontWeight: 700,
    padding: '5px 10px',
    letterSpacing: '0.18em', textTransform: 'uppercase' as const,
    borderRadius: 0,
    clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
    display: 'inline-flex', alignItems: 'center', gap: 4,
    transition: 'all 0.15s',
  }

  const timerStyle = (color: string, glow = false) => ({
    fontFamily: 'var(--font-mono)',
    fontSize: 11, fontWeight: 700,
    color,
    letterSpacing: '0.04em',
    textShadow: glow ? `0 0 8px ${color}55` : 'none',
    cursor: canShowHistory ? 'pointer' : 'default',
    transition: 'color 0.15s',
  })

  if (done) {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, color: 'var(--color-success)', letterSpacing: '0.22em',
            textTransform: 'uppercase', fontWeight: 700,
          }}>
            <span style={{ color: 'var(--color-success)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            FEITO
          </span>
          {displaySec > 0 && (
            <span
              onClick={() => canShowHistory && setShowHistory(true)}
              title={canShowHistory ? 'ver histórico' : undefined}
              style={timerStyle('var(--color-text-tertiary)')}
              onMouseEnter={e => { if (canShowHistory) e.currentTarget.style.color = 'var(--color-ice-light)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-tertiary)' }}
            >
              {formatHMS(displaySec)}
            </span>
          )}
          {onReopen && (
            <button
              onClick={onReopen}
              title="reabrir"
              style={{
                ...cyberBtnBase,
                background: 'rgba(8, 12, 18, 0.55)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-tertiary)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'var(--color-ice-light)'
                e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
                e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.20)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--color-text-tertiary)'
                e.currentTarget.style.borderColor = 'var(--color-border)'
                e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              ↻ REABRIR
            </button>
          )}
        </div>
        {showHistory && <SessionHistoryModal sessions={sessions} kind={runnableType} onChanged={onSessionUpdate} onClose={() => setShowHistory(false)} />}
      </>
    )
  }

  if (!isThis) {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {displaySec > 0 && (
            <span
              onClick={() => canShowHistory && setShowHistory(true)}
              title={canShowHistory ? 'ver histórico' : undefined}
              style={timerStyle('var(--color-text-tertiary)')}
              onMouseEnter={e => { if (canShowHistory) e.currentTarget.style.color = 'var(--color-ice-light)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-tertiary)' }}
            >
              {formatHMS(displaySec)}
            </span>
          )}
          <button
            onClick={handlePlay}
            title="iniciar sessão"
            style={{
              ...cyberBtnBase,
              background: 'rgba(143, 191, 211, 0.10)',
              border: '1px solid rgba(143, 191, 211, 0.45)',
              color: 'var(--color-ice-light)',
              boxShadow: '0 0 10px rgba(143, 191, 211, 0.15)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(143, 191, 211, 0.20)'
              e.currentTarget.style.boxShadow = '0 0 16px rgba(143, 191, 211, 0.40)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
              e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.15)'
            }}
          >
            <Play size={9} strokeWidth={2} fill="currentColor" />
            PLAY
          </button>
        </div>
        {showHistory && <SessionHistoryModal sessions={sessions} kind={runnableType} onChanged={onSessionUpdate} onClose={() => setShowHistory(false)} />}
      </>
    )
  }

  // Estado: este item é a sessão ativa (running ou paused).
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          onClick={() => canShowHistory && setShowHistory(true)}
          title={canShowHistory ? 'ver histórico' : undefined}
          style={timerStyle(
            running ? 'var(--color-ice-light)' : 'var(--color-text-secondary)',
            running, // glow só quando rodando
          )}
          onMouseEnter={e => { if (canShowHistory) e.currentTarget.style.color = 'var(--color-text-primary)' }}
          onMouseLeave={e => {
            e.currentTarget.style.color = running ? 'var(--color-ice-light)' : 'var(--color-text-secondary)'
          }}
        >
          {formatHMS(displaySec)}
        </span>
        {running ? (
          <button
            onClick={handlePause}
            title="pausar"
            style={{
              ...cyberBtnBase,
              background: 'rgba(159, 18, 57, 0.14)',
              border: '1px solid var(--color-accent-primary)',
              color: 'var(--color-accent-light)',
              boxShadow: '0 0 12px rgba(159, 18, 57, 0.22)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(159, 18, 57, 0.22)'
              e.currentTarget.style.boxShadow = '0 0 16px rgba(159, 18, 57, 0.40)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(159, 18, 57, 0.14)'
              e.currentTarget.style.boxShadow = '0 0 12px rgba(159, 18, 57, 0.22)'
            }}
          >
            ❚❚ PAUSAR
          </button>
        ) : (
          <button
            onClick={handleResume}
            title="retomar"
            style={{
              ...cyberBtnBase,
              background: 'rgba(143, 191, 211, 0.10)',
              border: '1px solid rgba(143, 191, 211, 0.45)',
              color: 'var(--color-ice-light)',
              boxShadow: '0 0 10px rgba(143, 191, 211, 0.15)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(143, 191, 211, 0.20)'
              e.currentTarget.style.boxShadow = '0 0 16px rgba(143, 191, 211, 0.40)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
              e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.15)'
            }}
          >
            <Play size={9} strokeWidth={2} fill="currentColor" />
            RETOMAR
          </button>
        )}
        <button
          onClick={handleStop}
          title={runnableType === 'task' ? 'finalizar tarefa' : runnableType === 'routine' ? 'marcar feita hoje' : 'finalizar quest'}
          style={{
            ...cyberBtnBase,
            background: 'rgba(94, 122, 82, 0.14)',
            border: '1px solid var(--color-success)',
            color: 'var(--color-success-light)',
            boxShadow: '0 0 10px rgba(94, 122, 82, 0.18)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(94, 122, 82, 0.22)'
            e.currentTarget.style.boxShadow = '0 0 16px rgba(94, 122, 82, 0.40)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(94, 122, 82, 0.14)'
            e.currentTarget.style.boxShadow = '0 0 10px rgba(94, 122, 82, 0.18)'
          }}
        >
          ✓ FINALIZAR
        </button>
      </div>
      {showHistory && <SessionHistoryModal sessions={sessions} kind={runnableType} onChanged={onSessionUpdate} onClose={() => setShowHistory(false)} />}
    </>
  )
}
