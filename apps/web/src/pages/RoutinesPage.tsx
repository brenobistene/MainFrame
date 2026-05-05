import { useEffect, useState } from 'react'
import type { Routine } from '../types'
import { fetchAllRoutines, createRoutine, updateRoutine, deleteRoutine, reportApiError } from '../api'
import { RoutineEditor } from '../components/RoutineEditor'
import { Card } from '../components/ui/Primitives'

/**
 * `/rotinas` — gerenciador de rotinas. Agrupa por recorrência
 * (diárias & dias úteis / semanais / mensais). Clique em "+ nova rotina" ou
 * no ✎ de uma rotina abre o `RoutineEditor` inline.
 */
export function RoutinesView() {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<Partial<Routine>>({
    title: '',
    recurrence: 'daily',
    days_of_week: null,
    day_of_month: null,
    start_time: null,
    end_time: null,
    estimated_minutes: null,
    priority: 'critical',
  })

  useEffect(() => {
    loadRoutines()
  }, [])

  const loadRoutines = () => {
    setLoading(true)
    fetchAllRoutines().then(setRoutines).catch(err => reportApiError('RoutinesPage', err)).finally(() => setLoading(false))
  }

  const handleNewRoutine = () => {
    setEditingId('new')
    setFormData({
      title: '',
      recurrence: 'daily',
      days_of_week: null,
      day_of_month: null,
      start_time: null,
      end_time: null,
      estimated_minutes: null,
      priority: 'critical',
    })
  }

  const handleEditRoutine = (routine: Routine) => {
    setEditingId(routine.id)
    setFormData(routine)
  }

  const handleSave = async () => {
    if (!formData.title) return

    if ((formData.start_time && !formData.end_time) || (!formData.start_time && formData.end_time)) {
      alert('Preencha ambos os horários ou deixe em branco')
      return
    }

    if (!formData.start_time && !formData.end_time && !formData.estimated_minutes) {
      alert('Preencha a duração estimada ou o horário da rotina')
      return
    }

    try {
      if (editingId === 'new') {
        const newRoutine = await createRoutine(formData as any)
        setRoutines([...routines, newRoutine])
      } else {
        const updated = await updateRoutine(editingId!, formData)
        setRoutines(rs => rs.map(r => r.id === editingId ? updated : r))
      }
      setEditingId(null)
    } catch (err) {
      reportApiError('RoutinesPage.save', err)
      alert('Erro ao salvar rotina. Veja o console para detalhes.')
    }
  }

  const handleDelete = async () => {
    if (!editingId || editingId === 'new') return
    try {
      await deleteRoutine(editingId)
      setRoutines(rs => rs.filter(r => r.id !== editingId))
      setEditingId(null)
    } catch (err) {
      reportApiError('RoutinesPage.delete', err)
      alert('Erro ao excluir rotina.')
    }
  }

  const getRecurrenceLabel = (r: Routine) => {
    if (r.recurrence === 'daily') return 'Todo dia'
    if (r.recurrence === 'weekdays') return 'Dias úteis'
    if (r.recurrence === 'weekly' && r.days_of_week) {
      const dayLabels = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom']
      const days = r.days_of_week.split(',').map(d => dayLabels[parseInt(d)])
      return days.join(', ')
    }
    if (r.recurrence === 'monthly' && r.day_of_month) {
      return `Todo dia ${r.day_of_month}`
    }
    return ''
  }

  if (loading && routines.length === 0) {
    return <div style={{ color: 'var(--color-text-tertiary)' }}>Carregando rotinas...</div>
  }

  const totalDaily = routines.filter(r => r.recurrence === 'daily' || r.recurrence === 'weekdays').length
  const totalWeekly = routines.filter(r => r.recurrence === 'weekly').length
  const totalMonthly = routines.filter(r => r.recurrence === 'monthly').length

  return (
    <div style={{ color: 'var(--color-text-primary)' }}>
    <Card padding="none" style={{
      animation: 'hq-fade-up var(--motion-base) var(--ease-emphasis) both',
    }}>
      {/* Hairline accent — linha sutil oxblood no topo */}
      <div style={{
        height: 1,
        background: 'linear-gradient(90deg, transparent, var(--color-accent-primary), transparent)',
        opacity: 0.5,
      }} />
      {/* Header com gradient sutil */}
      <div style={{
        padding: 'var(--space-5) var(--space-6) var(--space-4)',
        background: `
          radial-gradient(ellipse 100% 80% at 0% 0%, rgba(159, 18, 57, 0.06), transparent 60%),
          linear-gradient(180deg, rgba(236, 232, 227, 0.02), transparent)
        `,
        borderBottom: '1px solid var(--color-divider)',
      }}>
      <header style={{
        display: 'flex', alignItems: 'flex-end', gap: 14,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 10, color: 'var(--color-text-tertiary)',
            letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600,
            marginBottom: 4,
          }}>
            Rotinas
          </div>
          <div style={{
            fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em',
            color: 'var(--color-text-primary)', lineHeight: 1.2,
            fontFamily: 'var(--font-mono)',
          }}>
            {routines.length} {routines.length === 1 ? 'rotina' : 'rotinas'}
            {routines.length > 0 && (
              <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400, marginLeft: 8 }}>
                · {totalDaily} diárias · {totalWeekly} semanais · {totalMonthly} mensais
              </span>
            )}
          </div>
        </div>
        <button
          onClick={handleNewRoutine}
          style={{
            background: 'var(--color-accent-primary)', border: 'none', cursor: 'pointer',
            color: 'var(--color-bg-primary)', fontSize: 11, fontWeight: 700,
            padding: '8px 16px', borderRadius: 3,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-accent-secondary)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-accent-primary)')}
        >
          + nova rotina
        </button>
      </header>
      </div>
      <div style={{ padding: 'var(--space-5) var(--space-6)' }}>

      {editingId === 'new' && (
        <div style={{ marginTop: 32 }}>
          <RoutineEditor
            routine={null}
            formData={formData}
            setFormData={setFormData}
            onSave={handleSave}
            onDelete={() => {}}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}

      <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {routines.length === 0 && editingId === null ? (
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            Nenhuma rotina configurada.
          </p>
        ) : (
          (() => {
            const daily = routines.filter(r => r.recurrence === 'daily' || r.recurrence === 'weekdays')
            const weekly = routines.filter(r => r.recurrence === 'weekly')
            const monthly = routines.filter(r => r.recurrence === 'monthly')

            const renderGroup = (title: string, items: Routine[]) => {
              if (items.length === 0 && editingId !== 'new') return null
              return (
                <section key={title} style={{ marginBottom: 40 }}>
                  <div style={{
                    fontSize: 10, color: 'var(--color-text-tertiary)',
                    letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600,
                    marginBottom: 14,
                  }}>
                    {title}
                  </div>
                  {items.map(r => (
                    <div key={r.id}>
                      {editingId === r.id && <RoutineEditor routine={r} formData={formData} setFormData={setFormData} onSave={handleSave} onDelete={handleDelete} onCancel={() => setEditingId(null)} />}
                      {editingId !== r.id && (
                        <div
                          style={{
                            padding: '14px 0', borderBottom: '1px solid var(--color-border)',
                            display: 'flex', alignItems: 'center', gap: 10, transition: 'opacity 0.15s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{
                              color: r.done ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                              fontWeight: 500, fontSize: 13,
                              textDecoration: r.done ? 'line-through' : 'none',
                              display: 'flex', alignItems: 'center', gap: 10,
                            }}>
                              {(() => {
                                const p = (r as any).priority || 'critical'
                                const color =
                                  p === 'critical' ? 'var(--color-accent-primary)'
                                  : p === 'high'   ? 'var(--color-warning)'
                                  : p === 'medium' ? 'var(--color-accent-light)'
                                  :                  'var(--color-text-tertiary)'
                                const label = p === 'critical' ? 'Crítica' : p === 'high' ? 'Alta' : p === 'medium' ? 'Média' : 'Baixa'
                                return (
                                  <span
                                    title={`Prioridade: ${label}`}
                                    style={{
                                      width: 7, height: 7, borderRadius: '50%',
                                      background: color, flexShrink: 0,
                                    }}
                                  />
                                )
                              })()}
                              <span>{r.title}</span>
                            </div>
                            <div style={{ marginTop: 4, fontSize: 10, color: 'var(--color-text-secondary)' }}>
                              {getRecurrenceLabel(r)}
                              {r.start_time && r.end_time && ` • ${r.start_time} – ${r.end_time}`}
                              {r.estimated_minutes && ` • ${r.estimated_minutes}min`}
                            </div>
                          </div>
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              if (confirm(`Excluir rotina "${r.title}"?`)) {
                                deleteRoutine(r.id).then(() => {
                                  setRoutines(rs => rs.filter(rot => rot.id !== r.id))
                                }).catch(() => alert('Erro ao excluir rotina'))
                              }
                            }}
                            style={{
                              background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer',
                              padding: '4px 8px', fontSize: 12, transition: 'color 0.15s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-error)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
                            title="Excluir rotina"
                          >
                            ✕
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); handleEditRoutine(r) }}
                            style={{
                              background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer',
                              padding: '4px 8px', fontSize: 12, transition: 'color 0.15s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
                            title="Editar rotina"
                          >
                            ✎
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              )
            }

            return (
              <>
                {renderGroup('Diárias & Dias úteis', daily)}
                {renderGroup('Semanais', weekly)}
                {renderGroup('Mensais', monthly)}
              </>
            )
          })()
        )}
      </div>

      </div>
    </Card>
    </div>
  )
}
