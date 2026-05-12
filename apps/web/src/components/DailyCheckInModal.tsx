/**
 * Daily check-in — modal que abre 1x por dia no primeiro acesso,
 * resumindo "estado" pessoal do dia.
 *
 * Mostra:
 *  - Tasks atrasadas (passou data e ainda não-done) → ação: trazer pra hoje
 *  - Bills/parcelas vencendo nos próximos 7 dias
 *  - Próximo ritual estratégico (mais próximo da data)
 *  - Atalho pra ir pra Dia
 *
 * Trigger: localStorage 'hq-checkin-last' compara com hoje. Se !== hoje,
 * exibe e marca. Mostra só se tem ALGO relevante (tasks atrasadas OU
 * bills próximas OU ritual próximo) — não polui dias sem demanda.
 *
 * Esc / clique fora / botão "ok, vamo" → fecha + marca dismissed.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Calendar as CalendarIcon, AlertTriangle, Sparkles, X } from 'lucide-react'
import type { Task } from '../types'

const STORAGE_KEY = 'hq-checkin-last'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function DailyCheckInModal({
  tasks,
  upcomingBillsCount = 0,
  nextRitualLabel,
}: {
  tasks: Task[]
  /** count de bills/parcelas vencendo nos próximos 7 dias (calculado pelo pai). */
  upcomingBillsCount?: number
  /** texto do próximo ritual ex: "Revisão semanal · domingo". */
  nextRitualLabel?: string
}) {
  const navigate = useNavigate()
  const [show, setShow] = useState(false)

  const today = todayIso()
  const overdueTasks = tasks.filter(t =>
    !t.done && t.scheduled_date && t.scheduled_date < today
  )

  // Reviews semanais: domingo = dia natural pra revisão. Se hoje é domingo
  // (getDay()==0), prompt extra "ritual de revisão semanal" aparece no
  // check-in com prioridade visual (antes dos outros items).
  const isSunday = new Date().getDay() === 0
  const weeklyReviewPrompt = isSunday

  useEffect(() => {
    const last = localStorage.getItem(STORAGE_KEY)
    if (last === today) return  // já mostrou hoje
    // Só abre se tem algo significativo pra mostrar — não interrompe sem motivo
    const hasContent = overdueTasks.length > 0
      || upcomingBillsCount > 0
      || !!nextRitualLabel
      || weeklyReviewPrompt
    if (!hasContent) {
      localStorage.setItem(STORAGE_KEY, today)
      return
    }
    // Delay 500ms pra dar tempo do app carregar e não brigar com banner
    const t = setTimeout(() => setShow(true), 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length, upcomingBillsCount, nextRitualLabel, weeklyReviewPrompt])

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, today)
    setShow(false)
  }

  if (!show) return null

  return createPortal(
    <div
      onClick={dismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
        animation: 'hq-fade-up 220ms var(--ease-emphasis) both',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(560px, 92vw)',
          background: 'rgba(8, 12, 18, 0.96)',
          border: '1px solid rgba(143, 191, 211, 0.45)',
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)',
          boxShadow: '0 0 36px rgba(143, 191, 211, 0.22), 0 16px 48px rgba(0, 0, 0, 0.8)',
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <Sparkles size={16} strokeWidth={2} style={{ color: 'var(--color-ice-light)' }} />
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10, fontWeight: 700,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            DAILY.CHECK-IN
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={dismiss}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div style={{ fontSize: 16, color: 'var(--color-text-primary)', marginBottom: 18, lineHeight: 1.4 }}>
          {weeklyReviewPrompt
            ? 'Domingo. Hora de revisar a semana antes da próxima começar:'
            : 'Bom dia. Recap rápido antes do dia começar:'}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {weeklyReviewPrompt && (
            <CheckInItem
              icon={<Sparkles size={14} strokeWidth={2} />}
              accent="var(--color-success-light)"
              title="Revisão semanal sugerida"
              subtitle="Ver tempo investido + rituais estratégicos"
              onClick={() => { dismiss(); navigate('/tempo') }}
            />
          )}
          {overdueTasks.length > 0 && (
            <CheckInItem
              icon={<AlertTriangle size={14} strokeWidth={2} />}
              accent="var(--color-accent-light)"
              title={`${overdueTasks.length} ${overdueTasks.length === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'}`}
              subtitle="Vai pra Dia pra trazer pra hoje ou adiar"
              onClick={() => { dismiss(); navigate('/dia') }}
            />
          )}
          {upcomingBillsCount > 0 && (
            <CheckInItem
              icon={<CalendarIcon size={14} strokeWidth={2} />}
              accent="var(--color-ice-light)"
              title={`${upcomingBillsCount} ${upcomingBillsCount === 1 ? 'conta vencendo' : 'contas vencendo'} nos próximos 7 dias`}
              subtitle="Confere o Hub Finance"
              onClick={() => { dismiss(); navigate('/hub-finance') }}
            />
          )}
          {nextRitualLabel && (
            <CheckInItem
              icon={<Sparkles size={14} strokeWidth={2} />}
              accent="var(--color-success-light)"
              title="Próximo ritual estratégico"
              subtitle={nextRitualLabel}
              onClick={() => { dismiss(); navigate('/build') }}
            />
          )}
        </div>

        <div style={{
          marginTop: 20,
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={dismiss}
            style={{
              background: 'rgba(143, 191, 211, 0.14)',
              border: '1px solid var(--color-ice)',
              cursor: 'pointer',
              color: 'var(--color-ice-light)',
              fontFamily: 'var(--font-mono)',
              padding: '8px 18px',
              fontSize: 11, fontWeight: 700,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
              boxShadow: '0 0 14px rgba(143, 191, 211, 0.30)',
            }}
          >
            VAMO →
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CheckInItem({ icon, accent, title, subtitle, onClick }: {
  icon: React.ReactNode
  accent: string
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '10px 14px',
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid rgba(143, 191, 211, 0.22)',
        borderLeft: `2px solid ${accent}`,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
        cursor: 'pointer',
        textAlign: 'left',
        color: 'inherit',
        transition: 'transform 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateX(2px)'
        e.currentTarget.style.boxShadow = `0 0 14px ${accent}30`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateX(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <span style={{ color: accent, display: 'inline-flex', flexShrink: 0 }}>{icon}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{title}</div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9, fontWeight: 700,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.18em', textTransform: 'uppercase',
          marginTop: 2,
        }}>
          {subtitle}
        </div>
      </div>
      <ArrowRight size={13} strokeWidth={2} style={{ color: 'var(--color-text-muted)' }} />
    </button>
  )
}
