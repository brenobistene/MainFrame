/**
 * Lang Lab · FALA — pronúncia por shadowing (método clássico):
 * 1. OUVIR o modelo (TTS neural do card);
 * 2. GRAVAR a sua voz e ouvir lado a lado (espelho honesto);
 * 3. CHECAR: você fala e o reconhecimento do navegador transcreve —
 *    se a máquina entendeu as palavras certas, a pronúncia passou.
 *
 * Tudo client-side e efêmero: a gravação NÃO é salva em lugar nenhum
 * (URL de blob revogada ao trocar de card). O check usa a Web Speech
 * API do navegador; sem suporte/mic, a superfície explica e some.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Mic, Square, Volume2 } from 'lucide-react'

import { BASE, fetchLangCards, reportApiError } from '../../api'
import { TechLabel } from '../../components/ui/CyberShell'
import type { LangCard } from '../../types'

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null
  onerror: ((ev: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null
}

function normalizeWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Similaridade palavra-a-palavra (interseção / tamanho do alvo). */
function similarity(target: string, heard: string): { pct: number; hits: Set<string> } {
  const t = normalizeWords(target)
  const h = new Set(normalizeWords(heard))
  if (t.length === 0) return { pct: 0, hits: new Set() }
  const hits = new Set(t.filter(w => h.has(w)))
  return { pct: Math.round((hits.size / t.length) * 100), hits }
}

export function LangFalaPage() {
  const [cards, setCards] = useState<LangCard[]>([])
  const [idx, setIdx] = useState(0)
  const [recording, setRecording] = useState(false)
  const [recUrl, setRecUrl] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const card = cards[idx] ?? null
  const speechSupported = getSpeechRecognition() !== null

  useEffect(() => {
    fetchLangCards({ limit: 200 })
      .then(list => setCards(list.filter(c => !c.suspenso)))
      .catch(err => reportApiError('Fala.cards', err))
  }, [])

  // Gravação é efêmera por design — revoga o blob ao trocar/sair.
  useEffect(() => () => { if (recUrl) URL.revokeObjectURL(recUrl) }, [recUrl])

  const playModel = useCallback(() => {
    if (!card) return
    if (audioRef.current) audioRef.current.pause()
    if (card.audio_url) {
      const a = new Audio(`${BASE}${card.audio_url}`)
      audioRef.current = a
      a.play().catch(() => {
        try {
          const u = new SpeechSynthesisUtterance(card.frente)
          u.lang = 'en'
          window.speechSynthesis.speak(u)
        } catch { /* sem som disponível */ }
      })
    } else {
      try {
        const u = new SpeechSynthesisUtterance(card.frente)
        u.lang = 'en'
        window.speechSynthesis.speak(u)
      } catch { /* sem som disponível */ }
    }
  }, [card])

  async function toggleRecord() {
    setErro(null)
    if (recording) {
      mediaRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (recUrl) URL.revokeObjectURL(recUrl)
        setRecUrl(URL.createObjectURL(blob))
        setRecording(false)
      }
      mediaRef.current = rec
      rec.start()
      setRecording(true)
    } catch {
      setErro('microfone indisponível ou permissão negada')
    }
  }

  function playRecording() {
    if (!recUrl) return
    const a = new Audio(recUrl)
    a.play().catch(() => setErro('falha ao tocar a gravação'))
  }

  function checkPronunciation() {
    const Ctor = getSpeechRecognition()
    if (!Ctor || !card) return
    setErro(null)
    setHeard(null)
    const rec = new Ctor()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = ev => setHeard(ev.results[0][0].transcript)
    rec.onerror = ev => {
      setListening(false)
      setErro(ev.error === 'not-allowed'
        ? 'permissão de microfone negada'
        : ev.error === 'network'
          ? 'reconhecimento indisponível (rede)'
          : `reconhecimento falhou: ${ev.error}`)
    }
    rec.onend = () => setListening(false)
    setListening(true)
    rec.start()
  }

  function nextCard() {
    if (recUrl) { URL.revokeObjectURL(recUrl); setRecUrl(null) }
    setHeard(null)
    setErro(null)
    setIdx(i => (cards.length ? (i + 1) % cards.length : 0))
  }

  if (!card) {
    return <TechLabel>SEM CARDS · ADICIONE FRASES NA MAIN OU NO ACERVO PRIMEIRO</TechLabel>
  }

  const sim = heard ? similarity(card.frente, heard) : null
  const targetWords = normalizeWords(card.frente)

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
          fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--color-text-muted)',
        }}>
          {idx + 1}/{cards.length}
        </span>
        <TechLabel size={9}>SHADOWING · OUÇA, IMITE, CONFIRA</TechLabel>
        <span style={{ flex: 1 }} />
        <button type="button" className="hq-btn hq-btn--ghost" onClick={nextCard}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>PRÓXIMA</span>
          <ChevronRight size={13} strokeWidth={2} />
        </button>
      </div>

      <div style={{
        border: '1px solid var(--color-ice-deep)',
        background: 'rgba(8, 12, 18, 0.6)',
        padding: '32px',
        marginBottom: 20,
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)',
      }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.45 }}>
          {sim
            ? targetWords.map((w, i) => (
                <span key={i} style={{ color: sim.hits.has(w) ? 'var(--color-success-light)' : 'var(--color-accent-light)' }}>
                  {w}{' '}
                </span>
              ))
            : card.frente}
        </div>
        {card.verso && (
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 10 }}>{card.verso}</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
        <button type="button" className="hq-btn hq-btn--primary" onClick={playModel}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Volume2 size={14} strokeWidth={2} />
          <span style={{ fontWeight: 600, letterSpacing: '0.08em' }}>OUVIR MODELO</span>
        </button>
        <button type="button" className="hq-btn hq-btn--ghost" onClick={toggleRecord}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            borderColor: recording ? 'var(--color-accent-light)' : undefined,
            color: recording ? 'var(--color-accent-light)' : undefined,
          }}>
          {recording ? <Square size={13} strokeWidth={2} /> : <Mic size={13} strokeWidth={2} />}
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>
            {recording ? 'PARAR' : 'GRAVAR MINHA VOZ'}
          </span>
        </button>
        {recUrl && !recording && (
          <button type="button" className="hq-btn hq-btn--ghost" onClick={playRecording}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>OUVIR GRAVAÇÃO</span>
          </button>
        )}
        {speechSupported && (
          <button type="button" className="hq-btn hq-btn--ghost" onClick={checkPronunciation} disabled={listening}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>
              {listening ? 'OUVINDO… FALE' : 'CHECAR PRONÚNCIA'}
            </span>
          </button>
        )}
      </div>

      {erro && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--color-warning)', marginBottom: 12,
        }}>
          // {erro}
        </div>
      )}

      {sim && heard && (
        <div style={{
          border: '1px solid var(--color-border)',
          background: 'rgba(8, 12, 18, 0.45)', padding: '14px 18px',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
            <TechLabel size={9}>RECONHECIDO</TechLabel>
            <span style={{
              fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
              fontSize: 18, fontWeight: 700,
              color: sim.pct >= 80 ? 'var(--color-success-light)'
                : sim.pct >= 50 ? 'var(--color-warning)' : 'var(--color-accent-light)',
            }}>
              {sim.pct}%
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
            "{heard}"
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--color-text-muted)', marginTop: 8,
          }}>
            verde = a máquina entendeu · vermelho = repetir essa palavra
          </div>
        </div>
      )}

      {!speechSupported && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--color-text-muted)', marginTop: 8,
        }}>
          // reconhecimento de fala indisponível neste navegador · use Chrome/Edge pro CHECAR
        </div>
      )}

      <div style={{
        marginTop: 28, paddingTop: 10, borderTop: '1px solid var(--color-divider)',
        fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)',
        letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: 1.8,
      }}>
        GRAVAÇÃO É EFÊMERA · NADA É SALVO OU ENVIADO · O CHECAR USA O RECONHECIMENTO DO PRÓPRIO NAVEGADOR
      </div>
    </div>
  )
}
