import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Area, Project } from '../types'
import {
  fetchMicroTasks, createMicroTask, deleteMicroTask,
  createTask, createRoutine,
  reportApiError,
} from '../api'
import { parseTimeToMinutes, isValidDateInput } from '../utils/datetime'
import { PageShell, TechId } from '../components/ui/CyberShell'

/**
 * `/micro-dump` — inbox pra capturar ideias soltas sem triagem. Cada item
 * pode virar tarefa, rotina ou ideia arquivada (repassada pro root via
 * `onArchive`, que persiste em localStorage).
 *
 * Promoção pra quest foi removida: no novo modelo toda quest precisa de
 * project_id + deliverable_id. Pra transformar uma ideia em quest, o
 * usuário captura aqui e depois cria no painel do projeto correspondente.
 */
export function MicroDumpView({ areas, projects, onArchive }: { areas: Area[]; projects: Project[]; onArchive: (idea: any) => void }) {
  const navigate = useNavigate()
  const [microTasks, setMicroTasks] = useState<any[]>([])
  const [microTaskInput, setMicroTaskInput] = useState('')
  const [modalMode, setModalMode] = useState<'tarefa' | 'quest' | 'rotina' | null>(null)
  const [selectedMicroTask, setSelectedMicroTask] = useState<any | null>(null)
  const [formData, setFormData] = useState<any>({})
  // Buffer de texto dos inputs h:mm — permite digitação intermediária (ex:
  // "1:") sem perder o caractere enquanto `parseTimeToMinutes` ainda não
  // consegue extrair um valor numérico.
  const [durationInput, setDurationInput] = useState<string>('')
  const [estimatedInput, setEstimatedInput] = useState<string>('')

  async function consumeMicroTask(id: string) {
    try { await deleteMicroTask(id) } catch {}
    setMicroTasks(prev => prev.filter(t => t.id !== id))
  }

  useEffect(() => {
    fetchMicroTasks().then(setMicroTasks).catch(err => reportApiError('MicroDumpPage', err))
  }, [])

  return (
    <PageShell
      headerLabel="DUMP"
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
            INBOX · {microTasks.length} {microTasks.length === 1 ? 'IDEIA' : 'IDEIAS'}
          </span>
          <TechId>RAW.CAPTURE · TRIAGE LATER</TechId>
        </div>
      }
      footerCaption={
        <>
          <div>// IDEAS.BUFFER · {microTasks.length} PENDING TRIAGE</div>
          <div style={{ opacity: 0.6, marginTop: 2 }}>TYPE: TACTICAL.DUMP</div>
        </>
      }
    >

      <section style={{ marginTop: 36 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!microTaskInput.trim()) return
            createMicroTask(microTaskInput)
              .then(task => {
                setMicroTasks([task, ...microTasks])
                setMicroTaskInput('')
              })
              .catch(() => alert('Erro ao criar micro tarefa'))
          }}
          style={{ display: 'flex', gap: 12, alignItems: 'center' }}
        >
          <input
            type="text"
            autoComplete="off"
            value={microTaskInput}
            onChange={(e) => setMicroTaskInput(e.target.value)}
            placeholder="nova ideia…"
            onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-accent-primary)')}
            onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--color-border)')}
            style={{
              flex: 1, padding: '8px 2px',
              background: 'transparent',
              border: 'none', borderBottom: '2px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              fontSize: 14, fontFamily: "'Satoshi', sans-serif", fontWeight: 500,
              outline: 'none',
              transition: 'border-color 0.15s',
            }}
          />
          <button
            type="submit"
            disabled={!microTaskInput.trim()}
            style={{
              background: microTaskInput.trim() ? 'var(--color-accent-primary)' : 'var(--color-bg-tertiary)',
              color: microTaskInput.trim() ? 'var(--color-bg-primary)' : 'var(--color-text-muted)',
              border: 'none', cursor: microTaskInput.trim() ? 'pointer' : 'not-allowed',
              padding: '8px 16px', borderRadius: 3, fontSize: 10, fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              transition: 'background 0.15s',
            }}
          >
            + adicionar
          </button>
        </form>
      </section>

      <section style={{ marginTop: 48 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18,
        }}>
          <div style={{
            fontSize: 10, color: 'var(--color-text-tertiary)',
            letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600,
          }}>
            Todas as ideias
          </div>
          <div style={{
            fontSize: 10, color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            {microTasks.length}
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', fontSize: 10,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              padding: 0, transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-light)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
          >
            ← dashboard
          </button>
        </div>

        {microTasks.length > 0 ? (
          <div className="hq-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {microTasks.map((task, idx) => (
              <div
                key={task.id}
                className="hq-glass hq-grain hq-card-hoverable hq-animate-fade-up"
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  ['--stagger-i' as any]: idx,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', minWidth: 20, paddingTop: 2 }}>
                    {idx + 1}.
                  </span>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-primary)' }}>{task.title}</span>
                  <button
                    onClick={() => {
                      deleteMicroTask(task.id)
                        .then(() => setMicroTasks(microTasks.filter(t => t.id !== task.id)))
                        .catch(() => alert('Erro ao deletar'))
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text-secondary)',
                      cursor: 'pointer',
                      fontSize: 10,
                      padding: '2px 6px',
                      opacity: 0.6,
                      transition: 'opacity 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 6, paddingLeft: 20, fontSize: 9, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => { setSelectedMicroTask(task); setModalMode('tarefa'); setFormData({ title: task.title }); setDurationInput(''); setEstimatedInput('') }}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-tertiary)',
                      cursor: 'pointer',
                      padding: '4px 8px',
                      borderRadius: 3,
                      fontSize: 9,
                      fontWeight: 500,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-accent-light)'; e.currentTarget.style.color = 'var(--color-accent-light)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-tertiary)' }}
                  >
                    → Tarefa
                  </button>
                  <button
                    onClick={() => { setSelectedMicroTask(task); setModalMode('quest'); setFormData({ title: task.title, area_slug: areas[0]?.slug || '' }); setDurationInput(''); setEstimatedInput('') }}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-tertiary)',
                      cursor: 'pointer',
                      padding: '4px 8px',
                      borderRadius: 3,
                      fontSize: 9,
                      fontWeight: 500,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-accent-light)'; e.currentTarget.style.color = 'var(--color-accent-light)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-tertiary)' }}
                  >
                    → Quest
                  </button>
                  <button
                    onClick={() => { setSelectedMicroTask(task); setModalMode('rotina'); setFormData({ title: task.title }); setDurationInput(''); setEstimatedInput('') }}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-tertiary)',
                      cursor: 'pointer',
                      padding: '4px 8px',
                      borderRadius: 3,
                      fontSize: 9,
                      fontWeight: 500,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-accent-light)'; e.currentTarget.style.color = 'var(--color-accent-light)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-tertiary)' }}
                  >
                    → Rotina
                  </button>
                  <button
                    onClick={async () => {
                      onArchive({ id: task.id, title: task.title, created_at: task.created_at })
                      await consumeMicroTask(task.id)
                    }}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-tertiary)',
                      cursor: 'pointer',
                      padding: '4px 8px',
                      borderRadius: 3,
                      fontSize: 9,
                      fontWeight: 500,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-accent-light)'; e.currentTarget.style.color = 'var(--color-accent-light)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-tertiary)' }}
                  >
                    → Arquivo
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            textAlign: 'center',
            padding: '32px 16px',
            color: 'var(--color-text-tertiary)',
            fontSize: 12,
            fontStyle: 'italic',
          }}>
            Nenhuma ideia capturada ainda
          </div>
        )}
      </section>

      {modalMode && selectedMicroTask && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}
          onClick={() => { setModalMode(null); setSelectedMicroTask(null) }}
        >
          <div style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: 28,
            maxWidth: 500,
            width: '90%',
            maxHeight: '80vh',
            overflowY: 'auto',
          }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 16, color: 'var(--color-text-primary)', marginBottom: 20, fontWeight: 600 }}>
              Converter para {modalMode === 'tarefa' ? 'Tarefa' : modalMode === 'quest' ? 'Quest' : 'Rotina'}
            </h2>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8, fontWeight: 600 }}>
                Título
              </label>
              <input
                type="text"
                autoComplete="off"
                value={formData.title || ''}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                style={{
                  width: '100%',
                  background: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                  padding: '10px 12px',
                  fontSize: 13,
                  borderRadius: 3,
                  outline: 'none',
                  fontFamily: "'Satoshi', sans-serif",
                  fontWeight: 500,
                  boxSizing: 'border-box',
                  transition: 'all 0.2s',
                }}
              />
            </div>

            {modalMode === 'quest' && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 11, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8, fontWeight: 600 }}>
                    Área
                  </label>
                  <select
                    value={formData.area_slug || ''}
                    onChange={e => setFormData({ ...formData, area_slug: e.target.value })}
                    style={{
                      width: '100%',
                      background: 'var(--color-bg-tertiary)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-primary)',
                      padding: '10px 12px',
                      fontSize: 13,
                      borderRadius: 3,
                      outline: 'none',
                      fontFamily: "'Satoshi', sans-serif",
                      fontWeight: 500,
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="">Selecione uma área</option>
                    {areas.map(a => (
                      <option key={a.slug} value={a.slug}>{a.name}</option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 11, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8, fontWeight: 600 }}>
                    Projeto (opcional)
                  </label>
                  <select
                    value={formData.parent_id || ''}
                    onChange={e => setFormData({ ...formData, parent_id: e.target.value || undefined })}
                    style={{
                      width: '100%',
                      background: 'var(--color-bg-tertiary)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-primary)',
                      padding: '10px 12px',
                      fontSize: 13,
                      borderRadius: 3,
                      outline: 'none',
                      fontFamily: "'Satoshi', sans-serif",
                      fontWeight: 500,
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="">Nenhum (quest independente)</option>
                    {projects.filter(p => p.area_slug === formData.area_slug).map(p => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {modalMode === 'tarefa' && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 11, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8, fontWeight: 600 }}>
                    Data (opcional)
                  </label>
                  <input
                    type="date"
                    autoComplete="off"
                    value={formData.scheduled_date || ''}
                    onChange={e => {
                      if (isValidDateInput(e.target.value)) {
                        setFormData({ ...formData, scheduled_date: e.target.value || null })
                      }
                    }}
                    style={{
                      width: '100%', background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)',
                      color: 'var(--color-text-primary)', padding: '8px 10px', fontSize: 12, borderRadius: 3, outline: 'none',
                      boxSizing: 'border-box', colorScheme: 'dark',
                    } as any}
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 11, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8, fontWeight: 600 }}>
                    Horário (opcional)
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="time"
                      value={formData.start_time || ''}
                      onChange={e => setFormData({ ...formData, start_time: e.target.value || null })}
                      placeholder="Início"
                      style={{
                        flex: 1, background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)',
                        padding: '8px 10px', fontSize: 12, borderRadius: 3, outline: 'none',
                        fontFamily: 'var(--font-mono)', fontWeight: 500, colorScheme: 'dark',
                      } as any}
                    />
                    <span style={{ color: 'var(--color-text-secondary)' }}>–</span>
                    <input
                      type="time"
                      value={formData.end_time || ''}
                      onChange={e => setFormData({ ...formData, end_time: e.target.value || null })}
                      placeholder="Fim"
                      style={{
                        flex: 1, background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)',
                        padding: '8px 10px', fontSize: 12, borderRadius: 3, outline: 'none',
                        fontFamily: 'var(--font-mono)', fontWeight: 500, colorScheme: 'dark',
                      } as any}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 11, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8, fontWeight: 600 }}>
                    Duração estimada (opcional)
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="h:mm (ex: 1:30) ou minutos"
                    title="Aceita '1:30' ou '90' (minutos)"
                    value={durationInput}
                    onChange={e => {
                      setDurationInput(e.target.value)
                      const parsed = parseTimeToMinutes(e.target.value)
                      setFormData({ ...formData, duration_minutes: parsed ?? null })
                    }}
                    style={{
                      width: '100%', background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)',
                      padding: '8px 10px', fontSize: 12, borderRadius: 3, outline: 'none', boxSizing: 'border-box',
                      fontFamily: 'var(--font-mono)', fontWeight: 500,
                    }}
                  />
                </div>

                <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 8, fontStyle: 'italic' }}>
                  ↳ Tudo opcional. Uma tarefa é só uma coisa pra fazer — com ou sem agenda.
                </div>
              </>
            )}

            {modalMode === 'rotina' && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 11, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8, fontWeight: 600 }}>
                    Horário (opcional)
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="time"
                      value={formData.start_time || ''}
                      onChange={e => setFormData({ ...formData, start_time: e.target.value || null })}
                      placeholder="Início"
                      onFocus={e => {
                        e.currentTarget.style.borderColor = 'var(--color-accent-primary)'
                        e.currentTarget.style.boxShadow = '0 0 0 2px rgba(139, 46, 46, 0.2)'
                      }}
                      onBlur={e => {
                        e.currentTarget.style.borderColor = 'var(--color-border)'
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                      style={{
                        flex: 1, background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)',
                        padding: '8px 10px', fontSize: 12, borderRadius: 3, outline: 'none',
                        fontFamily: 'var(--font-mono)', fontWeight: 500,
                        transition: 'all 0.2s cubic-bezier(0.3, 0, 0.7, 1)',
                      }}
                    />
                    <span style={{ color: 'var(--color-text-secondary)' }}>–</span>
                    <input
                      type="time"
                      value={formData.end_time || ''}
                      onChange={e => setFormData({ ...formData, end_time: e.target.value || null })}
                      placeholder="Fim"
                      onFocus={e => {
                        e.currentTarget.style.borderColor = 'var(--color-accent-primary)'
                        e.currentTarget.style.boxShadow = '0 0 0 2px rgba(139, 46, 46, 0.2)'
                      }}
                      onBlur={e => {
                        e.currentTarget.style.borderColor = 'var(--color-border)'
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                      style={{
                        flex: 1, background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)',
                        padding: '8px 10px', fontSize: 12, borderRadius: 3, outline: 'none',
                        fontFamily: 'var(--font-mono)', fontWeight: 500,
                        transition: 'all 0.2s cubic-bezier(0.3, 0, 0.7, 1)',
                      }}
                    />
                  </div>
                  {((formData.start_time && !formData.end_time) || (!formData.start_time && formData.end_time)) && (
                    <div style={{ fontSize: 10, color: 'var(--color-error)', marginTop: 4 }}>
                      ⚠ Preencha ambos os horários
                    </div>
                  )}
                </div>

                {formData.start_time && formData.end_time && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 11, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8, fontWeight: 600 }}>
                      Recorrência <span style={{ color: 'var(--color-error)' }}>*</span>
                    </label>
                    <select
                      value={formData.recurrence || ''}
                      onChange={e => setFormData({ ...formData, recurrence: e.target.value })}
                      style={{
                        width: '100%',
                        background: 'var(--color-bg-tertiary)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-primary)',
                        padding: '10px 12px',
                        fontSize: 13,
                        borderRadius: 3,
                        outline: 'none',
                        fontFamily: "'Satoshi', sans-serif",
                        fontWeight: 500,
                        boxSizing: 'border-box',
                      }}
                    >
                      <option value="">Selecione uma recorrência</option>
                      <option value="daily">Diária</option>
                      <option value="weekdays">Dias úteis</option>
                      <option value="weekly">Semanal</option>
                      <option value="monthly">Mensal</option>
                    </select>
                  </div>
                )}

                {!formData.start_time && !formData.end_time && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 11, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8, fontWeight: 600 }}>
                      Duração estimada
                    </label>
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="h:mm (ex: 1:30) ou minutos"
                      title="Aceita '1:30' ou '90' (minutos)"
                      value={estimatedInput}
                      onChange={e => {
                        setEstimatedInput(e.target.value)
                        const parsed = parseTimeToMinutes(e.target.value)
                        setFormData({ ...formData, estimated_minutes: parsed ?? null })
                      }}
                      onFocus={e => {
                        e.currentTarget.style.borderColor = 'var(--color-accent-primary)'
                        e.currentTarget.style.boxShadow = '0 0 0 2px rgba(139, 46, 46, 0.2)'
                      }}
                      onBlur={e => {
                        e.currentTarget.style.borderColor = 'var(--color-border)'
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                      style={{
                        width: '100%', background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)',
                        padding: '8px 10px', fontSize: 12, borderRadius: 3, outline: 'none', boxSizing: 'border-box',
                        fontFamily: 'var(--font-mono)', fontWeight: 500,
                        transition: 'all 0.2s cubic-bezier(0.3, 0, 0.7, 1)',
                      }}
                    />
                  </div>
                )}
              </>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={async () => {
                  try {
                    if (!formData.title) {
                      alert('Título é obrigatório')
                      return
                    }

                    if (modalMode === 'quest') {
                      alert('Pra criar quest: vá no projeto correspondente e use "+ nova quest" dentro de um entregável. Toda quest precisa de projeto + entregável.')
                      return
                    } else if (modalMode === 'tarefa') {
                      if ((formData.start_time && !formData.end_time) || (!formData.start_time && formData.end_time)) {
                        alert('Preencha os dois horários, início e fim')
                        return
                      }
                      await createTask({
                        title: formData.title,
                        priority: formData.priority || 'critical',
                        scheduled_date: formData.scheduled_date || null,
                        start_time: formData.start_time || null,
                        end_time: formData.end_time || null,
                        duration_minutes: formData.duration_minutes || null,
                      })
                    } else if (modalMode === 'rotina') {
                      const temHorario = formData.start_time && formData.end_time
                      const temDuracao = formData.estimated_minutes

                      if (!temHorario && !temDuracao) {
                        alert('Preencha horário OU duração estimada')
                        return
                      }
                      if (temHorario && !formData.recurrence) {
                        alert('Recorrência é obrigatória quando há horário fixo')
                        return
                      }

                      const routineData: any = {
                        title: formData.title,
                        recurrence: formData.recurrence || 'daily',
                        priority: formData.priority || 'critical',
                      }
                      if (temHorario) {
                        routineData.start_time = formData.start_time
                        routineData.end_time = formData.end_time
                      }
                      if (temDuracao) {
                        routineData.estimated_minutes = formData.estimated_minutes
                      }
                      await createRoutine(routineData)
                    }

                    await consumeMicroTask(selectedMicroTask.id)
                    setModalMode(null)
                    setSelectedMicroTask(null)
                    setFormData({})
                  } catch (err) {
                    console.error('[microdump] convert failed', err)
                    alert('Erro ao criar')
                  }
                }}
                style={{
                  flex: 1,
                  background: 'var(--color-accent-primary)',
                  border: '1px solid var(--color-accent-primary)',
                  color: 'var(--color-bg-primary)',
                  cursor: 'pointer',
                  padding: '10px 12px',
                  fontSize: 12,
                  borderRadius: 3,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--color-accent-secondary)'
                  e.currentTarget.style.borderColor = 'var(--color-accent-secondary)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'var(--color-accent-primary)'
                  e.currentTarget.style.borderColor = 'var(--color-accent-primary)'
                }}
              >
                Criar
              </button>
              <button
                onClick={() => { setModalMode(null); setSelectedMicroTask(null) }}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  padding: '10px 12px',
                  fontSize: 12,
                  borderRadius: 3,
                  fontWeight: 600,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--color-accent-light)'
                  e.currentTarget.style.color = 'var(--color-accent-light)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                  e.currentTarget.style.color = 'var(--color-text-secondary)'
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
