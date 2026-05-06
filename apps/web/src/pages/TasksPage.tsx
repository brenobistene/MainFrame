import { useEffect, useState } from 'react'
import type { ActiveSession, Task } from '../types'
import { fetchTasks, createTask, updateTask, toggleTask, deleteTask, reportApiError } from '../api'
import type { DateRange } from '../utils/dateRange'
import { computeRange, isInRange } from '../utils/dateRange'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { TaskRow } from '../components/TaskRow'
import { PrioritySelect } from '../components/PrioritySelect'
import { parseTimeToMinutes, isValidDateInput } from '../utils/datetime'
import { PageShell, TechId } from '../components/ui/CyberShell'

type TaskFilter = 'all' | 'today' | 'no-date'

/**
 * `/tarefas` — CRUD de tarefas standalone (não vinculadas a quest). Formulário
 * de criação expansível com detalhes (data, horários, duração), filtros
 * "Todas / Hoje / Sem data" e seção retrátil de concluídas com
 * `DateRangeFilter`.
 */
export function TasksView({ activeSession, onSessionUpdate, sessionUpdateTrigger = 0 }: {
  activeSession?: ActiveSession | null
  onSessionUpdate?: () => void
  sessionUpdateTrigger?: number
}) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [newTitle, setNewTitle] = useState('')
  const todayYmd = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const [newDate, setNewDate] = useState<string>(todayYmd)
  const [newStartTime, setNewStartTime] = useState('')
  const [newEndTime, setNewEndTime] = useState('')
  const [newDuration, setNewDuration] = useState('')
  const [newPriority, setNewPriority] = useState('critical')
  const [showExtras, setShowExtras] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [doneRange, setDoneRange] = useState<DateRange>(() => computeRange('7d'))

  useEffect(() => {
    fetchTasks().then(setTasks).catch(err => reportApiError('TasksPage', err))
  }, [])

  useEffect(() => {
    if (!sessionUpdateTrigger) return
    fetchTasks().then(setTasks).catch(err => reportApiError('TasksPage', err))
  }, [sessionUpdateTrigger])

  const todayIso = todayYmd

  const active = tasks.filter(t => !t.done)
  const filtered = active.filter(t => {
    if (filter === 'today') return t.scheduled_date === todayIso
    if (filter === 'no-date') return !t.scheduled_date
    return true
  })
  const doneAll = tasks.filter(t => t.done)
  const doneFiltered = doneAll.filter(t => isInRange(t.completed_at, doneRange))

  // Regra: toda tarefa precisa ter OU duração OU horário (início + fim), pra
  // caber em algum lugar do dia. Sem isso, não dá pra estimar carga.
  const hasRange = !!(newStartTime && newEndTime)
  const parsedDuration = parseTimeToMinutes(newDuration)
  const hasDuration = !!parsedDuration && parsedDuration > 0
  const timeOK = hasRange || hasDuration
  const canCreate = !!newTitle.trim() && timeOK

  async function handleCreate() {
    const title = newTitle.trim()
    if (!title) return
    if (!timeOK) {
      // Abre detalhes pra usuário preencher o campo que falta.
      setShowExtras(true)
      alert('Preencha a duração em minutos OU os horários de início e fim.')
      return
    }
    try {
      const created = await createTask({
        title,
        priority: newPriority,
        scheduled_date: newDate || null,
        start_time: newStartTime || null,
        end_time: newEndTime || null,
        duration_minutes: hasDuration ? parsedDuration : null,
      })
      setTasks(prev => [...prev, created])
      setNewTitle('')
      setNewDate(todayYmd)
      setNewStartTime('')
      setNewEndTime('')
      setNewDuration('')
      setNewPriority('critical')
      setShowExtras(false)
    } catch {
      alert('Erro ao criar tarefa')
    }
  }

  async function handleToggle(id: string) {
    try {
      const updated = await toggleTask(id)
      setTasks(prev => prev.map(t => t.id === id ? updated : t))
      // Avisa o App pra refazer o fetch da sessão ativa — sem isso o banner
      // continua mostrando esta task como "pausada" até o próximo polling de
      // 15s, mesmo após ser marcada como done.
      onSessionUpdate?.()
    } catch {}
  }

  async function handleUpdate(id: string, patch: Partial<Task>) {
    try {
      const updated = await updateTask(id, patch as any)
      setTasks(prev => prev.map(t => t.id === id ? updated : t))
    } catch {
      alert('Erro ao atualizar tarefa')
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteTask(id)
      setTasks(prev => prev.filter(t => t.id !== id))
    } catch {
      alert('Erro ao deletar tarefa')
    }
  }

  const filterButtons: { key: TaskFilter; label: string }[] = [
    { key: 'all', label: 'Todas' },
    { key: 'today', label: 'Hoje' },
    { key: 'no-date', label: 'Sem data' },
  ]

  const inputBase = {
    flex: 1, background: 'transparent',
    border: 'none', borderBottom: '1px solid var(--color-border)',
    color: 'var(--color-text-primary)',
    padding: '6px 2px', fontSize: 13,
    outline: 'none', transition: 'border-color 0.15s',
  } as any

  return (
    <PageShell
      headerLabel="TAREFAS"
      headerLeftContent={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 14, fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--color-text-primary)',
            lineHeight: 1.1,
          }}>
            {active.length} ativa{active.length !== 1 ? 's' : ''} · {doneAll.length} concluída{doneAll.length !== 1 ? 's' : ''}
          </span>
          <TechId>TASK.QUEUE</TechId>
        </div>
      }
      footerCaption={
        <>
          <div>// TASK.PIPELINE · {active.length} ACTIVE / {doneAll.length} DONE</div>
          <div style={{ opacity: 0.6, marginTop: 2 }}>TYPE: TACTICAL.TASKS</div>
        </>
      }
    >

      {/* Criar tarefa — linha aberta tipo Notion */}
      <section style={{ marginTop: 36 }}>
        <div style={{
          fontSize: 10, color: 'var(--color-text-tertiary)',
          letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600,
          marginBottom: 10,
        }}>
          Nova tarefa
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !showExtras) handleCreate() }}
            placeholder="título da tarefa…"
            style={inputBase}
            onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-accent-primary)')}
            onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--color-border)')}
          />
          <PrioritySelect value={newPriority} onChange={setNewPriority} />
          <button
            onClick={() => setShowExtras(o => !o)}
            title={showExtras ? 'ocultar detalhes' : 'adicionar detalhes'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', fontSize: 10,
              padding: '6px 8px',
              letterSpacing: '0.1em', textTransform: 'uppercase',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
          >
            {showExtras ? '– detalhes' : '+ detalhes'}
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            title={
              !newTitle.trim() ? 'Preencha o título'
              : !timeOK ? 'Preencha a duração ou os horários início/fim'
              : undefined
            }
            style={{
              background: canCreate ? 'var(--color-accent-primary)' : 'var(--color-bg-tertiary)',
              color: canCreate ? 'var(--color-bg-primary)' : 'var(--color-text-muted)',
              border: 'none', cursor: canCreate ? 'pointer' : 'not-allowed',
              fontSize: 10, padding: '8px 14px', borderRadius: 3, fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}
          >
            Criar
          </button>
        </div>
        {showExtras && (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 14 }}>
            {[
              {
                label: 'data', value: newDate, type: 'date' as const, width: 140,
                placeholder: undefined as string | undefined,
                title: undefined as string | undefined,
                onChange: (v: string) => { if (isValidDateInput(v)) setNewDate(v) },
              },
              {
                label: 'início', value: newStartTime, type: 'time' as const, width: 90,
                placeholder: undefined,
                title: undefined,
                onChange: (v: string) => setNewStartTime(v),
              },
              {
                label: 'fim', value: newEndTime, type: 'time' as const, width: 90,
                placeholder: undefined,
                title: undefined,
                onChange: (v: string) => setNewEndTime(v),
              },
              {
                label: 'duração', value: newDuration, type: 'text' as const, width: 90,
                placeholder: 'h:mm',
                title: "Aceita '1:30' ou '90' (minutos)",
                onChange: (v: string) => setNewDuration(v),
              },
            ].map(f => (
              <label key={f.label} style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 9, color: 'var(--color-text-muted)', letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 700 }}>
                  {f.label}
                </span>
                <input
                  type={f.type}
                  autoComplete="off"
                  value={f.value}
                  placeholder={f.placeholder}
                  title={f.title}
                  onChange={e => f.onChange(e.target.value)}
                  style={{
                    width: f.width, background: 'transparent',
                    border: 'none', borderBottom: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)', fontSize: 12, padding: '4px 2px',
                    outline: 'none', colorScheme: 'dark',
                    fontFamily: 'var(--font-mono)',
                    transition: 'border-color 0.15s',
                  } as any}
                  onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-accent-light)')}
                  onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--color-border)')}
                />
              </label>
            ))}
          </div>
        )}
      </section>

      {/* Tabs de filtro */}
      <section style={{ marginTop: 48 }}>
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-divider)', marginBottom: 18 }}>
          {filterButtons.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px 14px', fontSize: 10, fontWeight: filter === f.key ? 700 : 500,
                color: filter === f.key ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                letterSpacing: '0.15em', textTransform: 'uppercase',
                borderBottom: filter === f.key ? '2px solid var(--color-accent-primary)' : '2px solid transparent',
                marginBottom: -1, transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (filter !== f.key) e.currentTarget.style.color = 'var(--color-text-secondary)' }}
              onMouseLeave={e => { if (filter !== f.key) e.currentTarget.style.color = 'var(--color-text-muted)' }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            {filter === 'today' ? 'Nenhuma tarefa pra hoje.' : filter === 'no-date' ? 'Nenhuma tarefa sem data.' : 'Nenhuma tarefa ainda. Crie uma acima.'}
          </div>
        ) : (
          <div>
            {filtered.map(t => (
              <TaskRow key={t.id} task={t} onToggle={handleToggle} onUpdate={handleUpdate} onDelete={handleDelete} activeSession={activeSession} onSessionUpdate={onSessionUpdate} sessionUpdateTrigger={sessionUpdateTrigger} />
            ))}
          </div>
        )}
      </section>

      {doneAll.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => setShowDone(o => !o)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', fontSize: 10, fontWeight: 600,
              letterSpacing: '0.2em', textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: 6, padding: 0,
            }}>
              <span style={{ fontSize: 9 }}>{showDone ? '▼' : '▶'}</span>
              {doneFiltered.length} concluída{doneFiltered.length !== 1 ? 's' : ''}
            </button>
            <DateRangeFilter value={doneRange} onChange={setDoneRange} />
          </div>
          {showDone && doneFiltered.length > 0 && (
            <div style={{ marginTop: 12, opacity: 0.5 }}>
              {doneFiltered.map(t => (
                <TaskRow key={t.id} task={t} onToggle={handleToggle} onUpdate={handleUpdate} onDelete={handleDelete} activeSession={activeSession} onSessionUpdate={onSessionUpdate} sessionUpdateTrigger={sessionUpdateTrigger} />
              ))}
            </div>
          )}
          {showDone && doneFiltered.length === 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              Nenhuma concluída no período ({doneAll.length} no total).
            </div>
          )}
        </section>
      )}

    </PageShell>
  )
}
