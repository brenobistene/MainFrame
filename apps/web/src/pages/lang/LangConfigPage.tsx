/**
 * Lang Lab · CONFIG — tudo configurável estilo Anki (pedido literal:
 * "de quanto em quanto tempo os cards voltam e tudo mais, nada
 * hardcoded"). Doc: docs/lang-lab/PLAN.md §3.9/§4.
 *
 * Como o FSRS agenda: os LEARNING STEPS (minutos, CSV) controlam os
 * retornos intraday de card novo/errado; depois de graduar, quem decide
 * o intervalo é a RETENÇÃO DESEJADA (a alavanca-mestra — 0.90 = o card
 * volta quando a chance de você lembrar cai pra 90%). Não há
 * multiplicadores fixos como no Anki antigo: retenção maior = intervalos
 * menores e mais reviews; menor = o oposto.
 */
import { useEffect, useMemo, useState } from 'react'

import {
  fetchLangAiStatus,
  fetchLangLanguages,
  fetchLangVoices,
  reportApiError,
  updateLangLanguage,
} from '../../api'
import { TechLabel } from '../../components/ui/CyberShell'
import { useLangSettings, useUpdateLangSettings } from '../../lib/lang-queries'
import type { LangAiStatus, LangLanguage, LangSettingsUpdate, LangVoice } from '../../types'

const fieldStyle: React.CSSProperties = {
  background: 'rgba(8, 12, 18, 0.55)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-ice-light)',
  fontFamily: 'var(--font-mono)', fontSize: 12,
  padding: '7px 10px', outline: 'none', borderRadius: 0,
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ marginBottom: 4 }}><TechLabel>{title}</TechLabel></div>
      {hint && (
        <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12, maxWidth: 640, lineHeight: 1.55 }}>
          {hint}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 28px', alignItems: 'flex-end' }}>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
        letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--color-text-muted)',
      }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        background: value ? 'rgba(143, 191, 211, 0.12)' : 'rgba(8, 12, 18, 0.55)',
        border: `1px solid ${value ? 'rgba(143, 191, 211, 0.5)' : 'var(--color-border)'}`,
        color: value ? 'var(--color-ice-light)' : 'var(--color-text-muted)',
        fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
        letterSpacing: '0.14em', textTransform: 'uppercase',
        padding: '7px 12px', cursor: 'pointer', borderRadius: 0,
      }}
    >
      {label} · {value ? 'ON' : 'OFF'}
    </button>
  )
}

export function LangConfigPage() {
  const { data: settings } = useLangSettings()
  const updateSettings = useUpdateLangSettings()
  const [form, setForm] = useState<LangSettingsUpdate>({})
  const [langs, setLangs] = useState<LangLanguage[]>([])
  const [voices, setVoices] = useState<LangVoice[]>([])
  const [ai, setAi] = useState<LangAiStatus | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchLangLanguages().then(setLangs).catch(err => reportApiError('Config.langs', err))
    fetchLangVoices('en').then(setVoices).catch(() => setVoices([]))
    fetchLangAiStatus().then(setAi).catch(() => setAi(null))
  }, [])

  // Form começa vazio; cada campo lê do form OU do settings carregado.
  const v = useMemo(() => ({ ...settings, ...form }), [settings, form])
  const set = (patch: LangSettingsUpdate) => { setSaved(false); setForm(f => ({ ...f, ...patch })) }

  async function salvar() {
    if (Object.keys(form).length === 0) return
    try {
      await updateSettings.mutateAsync(form)
      setForm({})
      setSaved(true)
      fetchLangAiStatus().then(setAi).catch(() => undefined)
    } catch (err) {
      reportApiError('Config.salvar', err)
    }
  }

  async function trocarVoz(langId: number, voice: string) {
    const updated = await updateLangLanguage(langId, { tts_voice: voice })
      .catch(err => { reportApiError('Config.voz', err); return null })
    if (updated) setLangs(ls => ls.map(l => (l.id === updated.id ? updated : l)))
  }

  if (!settings) return <TechLabel>CARREGANDO…</TechLabel>

  const dirty = Object.keys(form).length > 0

  return (
    <div style={{ maxWidth: 860 }}>
      <Section
        title="AGENDAMENTO · SRS"
        hint="Learning steps = de quanto em quanto tempo (minutos) o card volta enquanto você está aprendendo ou errou (ex.: 1,10 = volta em 1 min, depois em 10). Depois de graduar, a retenção desejada manda: 0.90 significa que o card volta quando a chance de lembrar cai pra 90%: subir aproxima os retornos, descer espaça."
      >
        <Field label="LEARNING STEPS (MIN, CSV)">
          <input
            value={v.learning_steps_min ?? ''}
            onChange={e => set({ learning_steps_min: e.target.value })}
            placeholder="1,10"
            style={{ ...fieldStyle, width: 110 }}
          />
        </Field>
        <Field label="RELEARNING STEPS">
          <input
            value={v.relearning_steps_min ?? ''}
            onChange={e => set({ relearning_steps_min: e.target.value })}
            placeholder="10"
            style={{ ...fieldStyle, width: 90 }}
          />
        </Field>
        <Field label="RETENÇÃO DESEJADA">
          <input
            type="number" step={0.01} min={0.7} max={0.99}
            value={v.desired_retention ?? 0.9}
            onChange={e => set({ desired_retention: Number(e.target.value) })}
            style={{ ...fieldStyle, width: 80 }}
          />
        </Field>
        <Field label="NOVOS POR DIA">
          <input
            type="number" min={0} max={200}
            value={v.new_cards_per_day ?? 15}
            onChange={e => set({ new_cards_per_day: Number(e.target.value) })}
            style={{ ...fieldStyle, width: 70 }}
          />
        </Field>
        <Field label="TETO DE REVIEWS/DIA">
          <input
            type="number" min={0} max={2000}
            value={v.max_reviews_per_day ?? ''}
            placeholder="sem teto"
            onChange={e => set({ max_reviews_per_day: e.target.value === '' ? null : Number(e.target.value) })}
            style={{ ...fieldStyle, width: 90 }}
          />
        </Field>
        <Field label="INTERVALO MÁXIMO (DIAS)">
          <input
            type="number" min={7} max={36500}
            value={v.maximum_interval_days ?? 36500}
            onChange={e => set({ maximum_interval_days: Number(e.target.value) })}
            style={{ ...fieldStyle, width: 90 }}
          />
        </Field>
        <Field label="CARD MADURO APÓS (DIAS)">
          <input
            type="number" min={7} max={365}
            value={v.mature_threshold_days ?? 21}
            onChange={e => set({ mature_threshold_days: Number(e.target.value) })}
            style={{ ...fieldStyle, width: 70 }}
          />
        </Field>
        <Toggle
          label="FUZZING"
          value={v.enable_fuzzing ?? true}
          onChange={x => set({ enable_fuzzing: x })}
        />
      </Section>

      <Section
        title="DIA & RITMO"
        hint="A virada do dia define quando contadores e cota de novos resetam (4h = estudar à meia-noite ainda conta como hoje). Meta diária é referência visual, nunca cobrança."
      >
        <Field label="META DE REFERÊNCIA (MIN/DIA)">
          <input
            type="number" min={1} max={600}
            value={v.daily_goal_min ?? 15}
            onChange={e => set({ daily_goal_min: Number(e.target.value) })}
            style={{ ...fieldStyle, width: 70 }}
          />
        </Field>
        <Field label="DIA VIRA ÀS (HORA)">
          <input
            type="number" min={0} max={12}
            value={v.day_cutoff_hour ?? 4}
            onChange={e => set({ day_cutoff_hour: Number(e.target.value) })}
            style={{ ...fieldStyle, width: 60 }}
          />
        </Field>
        <Field label="AUSÊNCIA APÓS (DIAS)">
          <input
            type="number" min={1} max={90}
            value={v.ausencia_threshold_dias ?? 3}
            onChange={e => set({ ausencia_threshold_dias: Number(e.target.value) })}
            style={{ ...fieldStyle, width: 60 }}
          />
        </Field>
      </Section>

      <Section title="ÁUDIO & VOZ">
        <Toggle label="TTS" value={v.tts_enabled ?? true} onChange={x => set({ tts_enabled: x })} />
        <Toggle label="AUTOPLAY" value={v.audio_autoplay ?? true} onChange={x => set({ audio_autoplay: x })} />
        {langs.map(l => (
          <Field key={l.id} label={`VOZ · ${l.nome.toUpperCase()}`}>
            <select
              value={l.tts_voice}
              onChange={e => trocarVoz(l.id, e.target.value)}
              style={{ ...fieldStyle, minWidth: 230, colorScheme: 'dark' }}
            >
              {!voices.some(vc => vc.short_name === l.tts_voice) && (
                <option value={l.tts_voice}>{l.tts_voice}</option>
              )}
              {voices.map(vc => (
                <option key={vc.short_name} value={vc.short_name}>
                  {vc.short_name.replace('Neural', '')} · {vc.gender === 'Female' ? 'fem' : 'masc'}
                </option>
              ))}
            </select>
          </Field>
        ))}
        {voices.length === 0 && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>
            catálogo de vozes indisponível (rede) · a voz atual continua valendo
          </span>
        )}
      </Section>

      <Section
        title="SESSÃO"
        hint="Comportamento de quest: com outra sessão global rodando, a EXEC bloqueia. Auto-sessão inicia o cronômetro sozinho ao entrar na EXEC."
      >
        <Toggle
          label="AUTO-SESSÃO NA EXEC"
          value={v.auto_session_on_review ?? true}
          onChange={x => set({ auto_session_on_review: x })}
        />
      </Section>

      <Section
        title="IA TUTORA"
        hint='Chave NUNCA fica no banco: adicione LANG_AI_API_KEY=sua-chave em apps/api/.env e reinicie o backend. Free tier: Google AI Studio (gemini) ou Groq (openai-compat). "openai-compat" + base URL custom cobre até Ollama local.'
      >
        <Field label="PROVEDOR">
          <select
            value={v.ai_provider ?? 'none'}
            onChange={e => set({ ai_provider: e.target.value as 'gemini' | 'openai-compat' | 'none' })}
            style={{ ...fieldStyle, width: 150, colorScheme: 'dark' }}
          >
            <option value="none">desligada</option>
            <option value="gemini">gemini (free)</option>
            <option value="openai-compat">openai-compat (groq…)</option>
          </select>
        </Field>
        <Field label="MODELO">
          <input
            value={v.ai_model ?? ''}
            onChange={e => set({ ai_model: e.target.value })}
            placeholder="gemini-flash-latest"
            style={{ ...fieldStyle, width: 200 }}
          />
        </Field>
        {v.ai_provider === 'openai-compat' && (
          <Field label="BASE URL">
            <input
              value={v.ai_base_url ?? ''}
              onChange={e => set({ ai_base_url: e.target.value })}
              placeholder="https://api.groq.com/openai/v1"
              style={{ ...fieldStyle, width: 280 }}
            />
          </Field>
        )}
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: ai?.configured ? 'var(--color-success-light)' : 'var(--color-warning)',
        }}>
          {ai?.configured ? '● CONFIGURADA' : `○ ${ai?.reason ?? 'desligada'}`}
        </span>
      </Section>

      <Section
        title="SUPERFÍCIES"
        hint="Onde o Lang Lab aparece fora daqui. Tudo desligável: aviso é observação, não nag."
      >
        <Toggle label="CARD NO EXEC" value={v.exec_card_visivel ?? true} onChange={x => set({ exec_card_visivel: x })} />
        <Toggle label="CARD NO DASHBOARD" value={v.dashboard_card_visivel ?? true} onChange={x => set({ dashboard_card_visivel: x })} />
        <Toggle label="BADGE NA SIDEBAR" value={v.sidebar_badge_visivel ?? true} onChange={x => set({ sidebar_badge_visivel: x })} />
      </Section>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button
          type="button"
          className="hq-btn hq-btn--primary"
          onClick={salvar}
          disabled={!dirty || updateSettings.isPending}
          style={{ padding: '10px 24px' }}
        >
          <span style={{ fontWeight: 600, letterSpacing: '0.08em' }}>
            {updateSettings.isPending ? 'SALVANDO…' : 'SALVAR'}
          </span>
        </button>
        {saved && !dirty && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.14em', color: 'var(--color-success-light)',
          }}>
            SALVO
          </span>
        )}
      </div>
    </div>
  )
}
