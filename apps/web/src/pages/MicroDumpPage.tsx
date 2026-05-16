import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Area, Project } from '../types'
import {
  createMicroTask, deleteMicroTask,
  createTask, createRoutine, createProject,
  createLibraryItem,
} from '../api'
import { useMicroTasks, useAppInvalidator } from '../lib/app-queries'
import type { LibraryItemTipo } from '../types'
import { tabSync } from '../lib/tabsync'
import { parseTimeToMinutes } from '../utils/datetime'
import { PageShell, TechId } from '../components/ui/CyberShell'
import { CyberDatePicker } from '../components/ui/CyberDatePicker'
import { CyberTimePicker } from '../components/ui/CyberTimePicker'
import { alertDialog } from '../lib/dialog'

/**
 * `/micro-dump` — inbox pra capturar ideias soltas sem triagem. Cada item
 * pode virar tarefa, projeto, rotina, library item ou ideia arquivada
 * (repassada pro root via `onArchive`, que persiste em localStorage).
 *
 * Promoção pra quest direto do dump foi removida: toda quest precisa de
 * project_id + deliverable_id. Promova pra projeto e edite lá dentro.
 */

/** Label cyber-mono uppercase pra campos do modal. */
const cyberFieldLabel: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: 9, fontWeight: 700,
  color: 'var(--color-text-muted)',
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  marginBottom: 6,
}

/** Input cyber-chamferado full-width pra modal. */
const cyberInputFull: React.CSSProperties = {
  width: '100%',
  background: 'rgba(8, 12, 18, 0.55)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-ice-light)',
  fontFamily: 'var(--font-mono)',
  fontWeight: 700,
  padding: '8px 12px',
  fontSize: 12,
  letterSpacing: '0.05em',
  outline: 'none',
  boxSizing: 'border-box',
  borderRadius: 0,
  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
  transition: 'all 0.15s',
}

/** Botão cyber pra converter idea em (tarefa/quest/rotina/arquivo). */
function ConvertButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'rgba(8, 12, 18, 0.55)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-tertiary)',
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        padding: '4px 10px',
        fontSize: 9, fontWeight: 700,
        letterSpacing: '0.22em', textTransform: 'uppercase',
        borderRadius: 0,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.color = 'var(--color-ice-light)'
        e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
        e.currentTarget.style.background = 'rgba(143, 191, 211, 0.10)'
        e.currentTarget.style.boxShadow = '0 0 8px rgba(143, 191, 211, 0.20)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = 'var(--color-text-tertiary)'
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {label}
    </button>
  )
}
export function MicroDumpView({ areas, projects: _projects, onArchive }: { areas: Area[]; projects: Project[]; onArchive: (idea: any) => void }) {
  // MicroTasks via React Query — substituiu useState + fetchMicroTasks manual.
  // Invalidator pro convert-flow (ideia → task/rotina). Sem isso, /tarefas
  // e /rotinas ficavam stale até F5 depois de promover uma ideia.
  const appInv = useAppInvalidator()
  const microTasksQ = useMicroTasks()
  const microTasks = microTasksQ.data ?? []
  const navigate = useNavigate()
  const [microTaskInput, setMicroTaskInput] = useState('')
  const [modalMode, setModalMode] = useState<'tarefa' | 'projeto' | 'rotina' | 'library' | null>(null)
  const [selectedMicroTask, setSelectedMicroTask] = useState<any | null>(null)
  const [formData, setFormData] = useState<any>({})
  // Buffer de texto dos inputs h:mm — permite digitação intermediária (ex:
  // "1:") sem perder o caractere enquanto `parseTimeToMinutes` ainda não
  // consegue extrair um valor numérico.
  const [durationInput, setDurationInput] = useState<string>('')
  const [estimatedInput, setEstimatedInput] = useState<string>('')

  async function consumeMicroTask(id: string) {
    try { await deleteMicroTask(id) } catch {}
    appInv.microTasks()
  }

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

      <section style={{ marginTop: 28 }}>
        <div style={{
          padding: '14px 16px',
          background: 'rgba(8, 12, 18, 0.55)',
          border: '1px solid var(--color-ice-deep)',
          borderRadius: 0,
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9, fontWeight: 700,
            color: 'var(--color-ice-light)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
            marginBottom: 10,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div
              aria-hidden="true"
              style={{
                width: 3, height: 12,
                background: 'var(--color-ice)',
                boxShadow: '0 0 6px var(--color-ice-glow)',
              }}
            />
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            CAPTURE
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!microTaskInput.trim()) return
              createMicroTask(microTaskInput)
                .then(() => {
                  appInv.microTasks()
                  setMicroTaskInput('')
                })
                .catch(() => alertDialog({ title: 'Erro', message: 'Erro ao criar micro tarefa', variant: 'danger' }))
            }}
            style={{ display: 'flex', gap: 10, alignItems: 'center' }}
          >
            <input
              type="text"
              autoComplete="off"
              value={microTaskInput}
              onChange={(e) => setMicroTaskInput(e.target.value)}
              placeholder="dump rápido…"
              onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--color-ice)')}
              onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--color-ice-deep)')}
              style={{
                flex: 1, padding: '6px 2px',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--color-ice-deep)',
                color: 'var(--color-ice-light)',
                fontFamily: 'var(--font-display)',
                fontWeight: 600,
                fontSize: 14,
                letterSpacing: '0.02em',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
            />
            <button
              type="submit"
              disabled={!microTaskInput.trim()}
              style={{
                background: microTaskInput.trim() ? 'rgba(143, 191, 211, 0.14)' : 'rgba(8, 12, 18, 0.55)',
                border: `1px solid ${microTaskInput.trim() ? 'var(--color-ice)' : 'var(--color-border)'}`,
                color: microTaskInput.trim() ? 'var(--color-ice-light)' : 'var(--color-text-muted)',
                cursor: microTaskInput.trim() ? 'pointer' : 'not-allowed',
                fontFamily: 'var(--font-mono)',
                padding: '6px 14px',
                fontSize: 10, fontWeight: 700,
                letterSpacing: '0.22em', textTransform: 'uppercase',
                borderRadius: 0,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                boxShadow: microTaskInput.trim() ? '0 0 12px rgba(143, 191, 211, 0.25)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              + ADICIONAR
            </button>
          </form>
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
          paddingBottom: 8,
          borderBottom: '1px solid var(--color-ice-deep)',
        }}>
          <div
            aria-hidden="true"
            style={{
              width: 3, height: 14,
              background: 'var(--color-ice)',
              boxShadow: '0 0 8px var(--color-ice-glow)',
            }}
          />
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10, fontWeight: 700,
            color: 'var(--color-ice-light)',
            letterSpacing: '0.25em', textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            IDEAS.LIST
            <span style={{ color: 'var(--color-text-muted)', fontWeight: 700 }}>
              [{microTasks.length.toString().padStart(2, '0')}]
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              background: 'rgba(8, 12, 18, 0.55)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 9, fontWeight: 700,
              padding: '5px 10px',
              letterSpacing: '0.22em', textTransform: 'uppercase',
              borderRadius: 0,
              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-ice-light)'
              e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
              e.currentTarget.style.boxShadow = '0 0 8px rgba(143, 191, 211, 0.20)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-tertiary)'
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            ← DASHBOARD
          </button>
        </div>

        {microTasks.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {microTasks.map((task, idx) => (
              <div
                key={task.id}
                style={{
                  position: 'relative',
                  background: 'rgba(8, 12, 18, 0.55)',
                  border: '1px solid rgba(143, 191, 211, 0.18)',
                  borderLeft: '2px solid rgba(143, 191, 211, 0.55)',
                  borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
                  padding: '12px 14px',
                  transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.45)'
                  e.currentTarget.style.boxShadow = '0 0 12px rgba(143, 191, 211, 0.18)'
                  e.currentTarget.style.transform = 'translateX(2px)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.18)'
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.transform = 'translateX(0)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9, fontWeight: 700,
                    color: 'var(--color-text-muted)',
                    letterSpacing: '0.18em',
                    minWidth: 24,
                    paddingTop: 4,
                  }}>
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span style={{
                    flex: 1,
                    fontFamily: 'var(--font-display)',
                    fontSize: 13, fontWeight: 600,
                    color: 'var(--color-text-primary)',
                    letterSpacing: '0.02em',
                  }}>{task.title}</span>
                  <button
                    onClick={() => {
                      deleteMicroTask(task.id)
                        .then(() => appInv.microTasks())
                        .catch(() => alertDialog({ title: 'Erro', message: 'Erro ao deletar', variant: 'danger' }))
                    }}
                    title="Deletar ideia"
                    style={{
                      background: 'rgba(143, 191, 211, 0.04)',
                      border: '1px solid rgba(143, 191, 211, 0.18)',
                      color: 'var(--color-text-tertiary)',
                      cursor: 'pointer',
                      fontSize: 11,
                      padding: '3px 7px',
                      borderRadius: 0,
                      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.color = 'var(--color-accent-light)'
                      e.currentTarget.style.borderColor = 'rgba(159, 18, 57, 0.45)'
                      e.currentTarget.style.background = 'rgba(159, 18, 57, 0.10)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = 'var(--color-text-tertiary)'
                      e.currentTarget.style.borderColor = 'rgba(143, 191, 211, 0.18)'
                      e.currentTarget.style.background = 'rgba(143, 191, 211, 0.04)'
                    }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{
                  display: 'flex', gap: 5, paddingLeft: 36, flexWrap: 'wrap',
                }}>
                  <ConvertButton
                    label="→ TAREFA"
                    onClick={() => { setSelectedMicroTask(task); setModalMode('tarefa'); setFormData({ title: task.title }); setDurationInput(''); setEstimatedInput('') }}
                  />
                  <ConvertButton
                    label="→ PROJETO"
                    onClick={() => { setSelectedMicroTask(task); setModalMode('projeto'); setFormData({ title: task.title, area_slug: areas[0]?.slug || '' }); setDurationInput(''); setEstimatedInput('') }}
                  />
                  <ConvertButton
                    label="→ ROTINA"
                    onClick={() => { setSelectedMicroTask(task); setModalMode('rotina'); setFormData({ title: task.title }); setDurationInput(''); setEstimatedInput('') }}
                  />
                  <ConvertButton
                    label="→ LIBRARY"
                    onClick={() => { setSelectedMicroTask(task); setModalMode('library'); setFormData({ title: task.title, tipo: 'livro' as LibraryItemTipo, autor: '' }) }}
                  />
                  <ConvertButton
                    label="→ ARQUIVO"
                    onClick={async () => {
                      onArchive({ id: task.id, title: task.title, created_at: task.created_at })
                      await consumeMicroTask(task.id)
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            padding: '14px 16px',
            border: '1px dashed rgba(143, 191, 211, 0.30)',
            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10, fontWeight: 700,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.18em', textTransform: 'uppercase',
            lineHeight: 1.7,
          }}>
            <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
            NENHUMA IDEIA CAPTURADA · USE O CAPTURE ACIMA
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
          background: 'rgba(0, 0, 0, 0.62)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}
          onClick={() => { setModalMode(null); setSelectedMicroTask(null) }}
        >
          <div style={{
            background: 'rgba(8, 12, 18, 0.96)',
            border: '1px solid rgba(143, 191, 211, 0.45)',
            borderRadius: 0,
            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)',
            boxShadow: '0 0 32px rgba(143, 191, 211, 0.20), 0 12px 40px rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(10px)',
            padding: 24,
            maxWidth: 500,
            width: '90%',
            maxHeight: '80vh',
            overflowY: 'auto',
          }}
            onClick={e => e.stopPropagation()}
          >
            {/* Hairline ice elétrica */}
            <div className="hq-hairline-ice" style={{
              position: 'absolute', top: 0, left: 0, right: 0,
            }} />
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11, fontWeight: 700,
              color: 'var(--color-ice-light)',
              letterSpacing: '0.25em', textTransform: 'uppercase',
              marginBottom: 18,
              paddingBottom: 10,
              borderBottom: '1px solid var(--color-ice-deep)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <div
                aria-hidden="true"
                style={{
                  width: 3, height: 14,
                  background: 'var(--color-ice)',
                  boxShadow: '0 0 8px var(--color-ice-glow)',
                }}
              />
              <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
              CONVERT.{modalMode === 'tarefa' ? 'TAREFA' : modalMode === 'projeto' ? 'PROJETO' : modalMode === 'library' ? 'LIBRARY' : 'ROTINA'}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={cyberFieldLabel}>
                <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                TÍTULO
              </label>
              <input
                type="text"
                autoComplete="off"
                value={formData.title || ''}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                onFocus={e => {
                  e.currentTarget.style.borderColor = 'var(--color-ice)'
                  e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
                style={cyberInputFull}
              />
            </div>

            {modalMode === 'projeto' && (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={cyberFieldLabel}>
                    <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                    ÁREA <span style={{ color: 'var(--color-accent-light)' }}>*</span>
                  </label>
                  <select
                    value={formData.area_slug || ''}
                    onChange={e => setFormData({ ...formData, area_slug: e.target.value })}
                    style={cyberInputFull}
                    onFocus={e => {
                      e.currentTarget.style.borderColor = 'var(--color-ice)'
                      e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
                    }}
                    onBlur={e => {
                      e.currentTarget.style.borderColor = 'var(--color-border)'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  >
                    <option value="">— SELECIONE UMA ÁREA —</option>
                    {areas.map(a => (
                      <option key={a.slug} value={a.slug}>{a.name}</option>
                    ))}
                  </select>
                </div>

                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.18em', textTransform: 'uppercase',
                  marginBottom: 14, lineHeight: 1.6,
                }}>
                  <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                  PROJETO NASCE EM RASCUNHO · ENTREGÁVEIS E QUESTS VOCÊ EDITA NA PRÓXIMA TELA
                </div>
              </>
            )}

            {modalMode === 'tarefa' && (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={cyberFieldLabel}>
                    <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                    DATA (OPCIONAL)
                  </label>
                  <CyberDatePicker
                    value={formData.scheduled_date || ''}
                    onChange={v => setFormData({ ...formData, scheduled_date: v || null })}
                    width="100%"
                  />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={cyberFieldLabel}>
                    <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                    HORÁRIO (OPCIONAL)
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <CyberTimePicker
                      value={formData.start_time || ''}
                      onChange={v => setFormData({ ...formData, start_time: v || null })}
                      placeholder="INÍCIO"
                      width={130}
                    />
                    <span style={{ color: 'var(--color-ice)', fontFamily: 'var(--font-mono)' }}>→</span>
                    <CyberTimePicker
                      value={formData.end_time || ''}
                      onChange={v => setFormData({ ...formData, end_time: v || null })}
                      placeholder="FIM"
                      width={130}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={cyberFieldLabel}>
                    <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                    DURAÇÃO ESTIMADA (OPCIONAL)
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
                    onFocus={e => {
                      e.currentTarget.style.borderColor = 'var(--color-ice)'
                      e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
                    }}
                    onBlur={e => {
                      e.currentTarget.style.borderColor = 'var(--color-border)'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                    style={cyberInputFull}
                  />
                </div>

                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.18em', textTransform: 'uppercase',
                  marginBottom: 12,
                  lineHeight: 1.6,
                }}>
                  <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                  TUDO OPCIONAL · UMA TAREFA É UMA COISA PRA FAZER · COM OU SEM AGENDA
                </div>
              </>
            )}

            {modalMode === 'rotina' && (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={cyberFieldLabel}>
                    <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                    HORÁRIO (OPCIONAL)
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <CyberTimePicker
                      value={formData.start_time || ''}
                      onChange={v => setFormData({ ...formData, start_time: v || null })}
                      placeholder="INÍCIO"
                      width={130}
                    />
                    <span style={{ color: 'var(--color-ice)', fontFamily: 'var(--font-mono)' }}>→</span>
                    <CyberTimePicker
                      value={formData.end_time || ''}
                      onChange={v => setFormData({ ...formData, end_time: v || null })}
                      placeholder="FIM"
                      width={130}
                    />
                  </div>
                  {((formData.start_time && !formData.end_time) || (!formData.start_time && formData.end_time)) && (
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9, fontWeight: 700,
                      color: 'var(--color-accent-light)',
                      letterSpacing: '0.18em', textTransform: 'uppercase',
                      marginTop: 6,
                    }}>
                      <span style={{ color: 'var(--color-accent-primary)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                      PREENCHA AMBOS OS HORÁRIOS
                    </div>
                  )}
                </div>

                {formData.start_time && formData.end_time && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={cyberFieldLabel}>
                      <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                      RECORRÊNCIA <span style={{ color: 'var(--color-accent-light)' }}>*</span>
                    </label>
                    <select
                      value={formData.recurrence || ''}
                      onChange={e => setFormData({ ...formData, recurrence: e.target.value })}
                      onFocus={e => {
                        e.currentTarget.style.borderColor = 'var(--color-ice)'
                        e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
                      }}
                      onBlur={e => {
                        e.currentTarget.style.borderColor = 'var(--color-border)'
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                      style={cyberInputFull}
                    >
                      <option value="">— SELECIONE UMA RECORRÊNCIA —</option>
                      <option value="daily">DIÁRIA</option>
                      <option value="weekdays">DIAS ÚTEIS</option>
                      <option value="weekly">SEMANAL</option>
                      <option value="monthly">MENSAL</option>
                    </select>
                  </div>
                )}

                {!formData.start_time && !formData.end_time && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={cyberFieldLabel}>
                      <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                      DURAÇÃO ESTIMADA
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
                        e.currentTarget.style.borderColor = 'var(--color-ice)'
                        e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
                      }}
                      onBlur={e => {
                        e.currentTarget.style.borderColor = 'var(--color-border)'
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                      style={cyberInputFull}
                    />
                  </div>
                )}
              </>
            )}

            {modalMode === 'library' && (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={cyberFieldLabel}>
                    <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                    TIPO
                  </label>
                  <select
                    value={formData.tipo || 'livro'}
                    onChange={e => setFormData({ ...formData, tipo: e.target.value as LibraryItemTipo })}
                    onFocus={e => {
                      e.currentTarget.style.borderColor = 'var(--color-ice)'
                      e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
                    }}
                    onBlur={e => {
                      e.currentTarget.style.borderColor = 'var(--color-border)'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                    style={cyberInputFull}
                  >
                    <option value="livro">LIVRO</option>
                    <option value="filme">FILME</option>
                    <option value="serie">SÉRIE</option>
                    <option value="podcast">PODCAST</option>
                    <option value="artigo">ARTIGO</option>
                    <option value="video">VÍDEO</option>
                    <option value="curso">CURSO</option>
                    <option value="palestra">PALESTRA</option>
                    <option value="paper">PAPER</option>
                    <option value="outro">OUTRO</option>
                  </select>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={cyberFieldLabel}>
                    <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                    AUTOR / CRIADOR (OPCIONAL)
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="ex: Nassim Taleb"
                    value={formData.autor || ''}
                    onChange={e => setFormData({ ...formData, autor: e.target.value })}
                    onFocus={e => {
                      e.currentTarget.style.borderColor = 'var(--color-ice)'
                      e.currentTarget.style.boxShadow = '0 0 10px rgba(143, 191, 211, 0.30)'
                    }}
                    onBlur={e => {
                      e.currentTarget.style.borderColor = 'var(--color-border)'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                    style={cyberInputFull}
                  />
                </div>

                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.18em', textTransform: 'uppercase',
                  marginBottom: 14,
                }}>
                  <span style={{ color: 'var(--color-ice)', opacity: 0.85, marginRight: 4, letterSpacing: 0 }}>//</span>
                  VAI PRA FILA (STATUS QUEUE) · DESTILE DEPOIS NO DETAIL
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={async () => {
                  try {
                    if (!formData.title) {
                      alertDialog({ title: 'Título obrigatório', message: 'Título é obrigatório.', variant: 'warning' })
                      return
                    }

                    if (modalMode === 'projeto') {
                      if (!formData.area_slug) {
                        alertDialog({ title: 'Área obrigatória', message: 'Selecione a área onde o projeto vai viver.', variant: 'warning' })
                        return
                      }
                      const proj = await createProject({
                        title: formData.title,
                        area_slug: formData.area_slug,
                      })
                      appInv.projects(); tabSync.emit('quests')
                      await consumeMicroTask(selectedMicroTask.id)
                      setModalMode(null)
                      setSelectedMicroTask(null)
                      setFormData({})
                      // Navega pra área do projeto e dispara evento pra abrir o
                      // painel de detalhe direto (mesmo padrão da FreelasPage).
                      navigate(`/areas/${formData.area_slug}`)
                      window.dispatchEvent(
                        new CustomEvent('hq-select-project', { detail: { projectId: proj.id } }),
                      )
                      return
                    } else if (modalMode === 'tarefa') {
                      if ((formData.start_time && !formData.end_time) || (!formData.start_time && formData.end_time)) {
                        alertDialog({ title: 'Horários incompletos', message: 'Preencha os dois horários, início e fim.', variant: 'warning' })
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
                      appInv.tasks(); tabSync.emit('tasks')
                    } else if (modalMode === 'rotina') {
                      const temHorario = formData.start_time && formData.end_time
                      const temDuracao = formData.estimated_minutes

                      if (!temHorario && !temDuracao) {
                        alertDialog({ title: 'Tempo obrigatório', message: 'Preencha horário OU duração estimada.', variant: 'warning' })
                        return
                      }
                      if (temHorario && !formData.recurrence) {
                        alertDialog({ title: 'Recorrência obrigatória', message: 'Recorrência é obrigatória quando há horário fixo.', variant: 'warning' })
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
                      appInv.routines(); tabSync.emit('routines')
                    } else if (modalMode === 'library') {
                      // Promove microtask pra LibraryItem na fila (status=queue
                      // default). Tipo + autor opcionais. React Query do
                      // Library invalida via createLibraryItem direto na API
                      // (sem useMutation aqui — capture page é fora do contexto
                      // do Library, então invalidação não-crítica).
                      await createLibraryItem({
                        tipo: (formData.tipo as LibraryItemTipo) || 'outro',
                        titulo: formData.title,
                        autor: formData.autor?.trim() || null,
                      })
                    }

                    await consumeMicroTask(selectedMicroTask.id)
                    setModalMode(null)
                    setSelectedMicroTask(null)
                    setFormData({})
                  } catch (err) {
                    console.error('[microdump] convert failed', err)
                    alertDialog({ title: 'Erro', message: 'Erro ao criar', variant: 'danger' })
                  }
                }}
                style={{
                  flex: 1,
                  background: 'rgba(143, 191, 211, 0.14)',
                  border: '1px solid var(--color-ice)',
                  color: 'var(--color-ice-light)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  padding: '8px 14px',
                  fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                  boxShadow: '0 0 12px rgba(143, 191, 211, 0.25)',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(143, 191, 211, 0.22)'
                  e.currentTarget.style.boxShadow = '0 0 18px rgba(143, 191, 211, 0.40)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(143, 191, 211, 0.14)'
                  e.currentTarget.style.boxShadow = '0 0 12px rgba(143, 191, 211, 0.25)'
                }}
              >
                ✓ CRIAR
              </button>
              <button
                onClick={() => { setModalMode(null); setSelectedMicroTask(null) }}
                style={{
                  flex: 1,
                  background: 'rgba(8, 12, 18, 0.55)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-tertiary)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  padding: '8px 14px',
                  fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.22em', textTransform: 'uppercase',
                  borderRadius: 0,
                  clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%)',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = 'var(--color-accent-light)'
                  e.currentTarget.style.borderColor = 'rgba(159, 18, 57, 0.45)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = 'var(--color-text-tertiary)'
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                }}
              >
                CANCELAR
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
