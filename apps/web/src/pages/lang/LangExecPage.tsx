/**
 * Lang Lab · EXEC — o player de revisão SRS (a execução real).
 *
 * Comportamento de SESSÃO igual quest (pedido explícito do usuário): se
 * OUTRA sessão global está rodando, esta página BLOQUEIA — nada de revisar
 * "sem cronômetro". Finalize a outra no banner e volte.
 *
 * Fluxo Anki: frente (áudio automático) → espaço revela → 1-4 avalia.
 * R replay · Z desfaz · E edita inline (TTS regenera). Cards 'production'
 * mostram PT primeiro — você CONSTRÓI a frase — e o EN+áudio vêm no reveal.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ban, Pencil, Play, RotateCcw, Square, Volume2 } from 'lucide-react'

import {
  BASE,
  askLangAi,
  fetchActiveSession,
  fetchLangAiStatus,
  fetchLangQueue,
  fetchLangSettings,
  reportApiError,
  startLangSession,
  stopLangSession,
  updateLangCard,
} from '../../api'
import { TechLabel } from '../../components/ui/CyberShell'
import { useLangToday, useReviewLangCard, useUndoLangReview } from '../../lib/lang-queries'
import type { LangCard, LangSettings } from '../../types'
import { SignalFrame, TxRxTag, Waveform, RX_COLOR, TX_COLOR } from './langUi'

const RATING_LABELS: { rating: 1 | 2 | 3 | 4; label: string; color: string }[] = [
  { rating: 1, label: 'DE NOVO', color: 'var(--color-accent-light)' },
  { rating: 2, label: 'DIFÍCIL', color: 'var(--color-warning)' },
  { rating: 3, label: 'BOM', color: 'var(--color-ice-light)' },
  { rating: 4, label: 'FÁCIL', color: 'var(--color-success-light)' },
]

export function LangExecPage() {
  const navigate = useNavigate()
  const reviewMut = useReviewLangCard()
  const undoMut = useUndoLangReview()
  const { data: today } = useLangToday()

  const [settings, setSettings] = useState<LangSettings | null>(null)
  const [blockedBy, setBlockedBy] = useState<string | null>(null)
  const [needsManualStart, setNeedsManualStart] = useState(false)
  const [cards, setCards] = useState<LangCard[]>([])
  const [idx, setIdx] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [needsGesture, setNeedsGesture] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editFrente, setEditFrente] = useState('')
  const [editVerso, setEditVerso] = useState('')
  const [reviewedCount, setReviewedCount] = useState(0)
  const [nextDue, setNextDue] = useState<number | null>(null)
  const [queueErro, setQueueErro] = useState<string | null>(null)
  // Waveform vivo: sinal funcional de "tem áudio tocando agora".
  const [audioPlaying, setAudioPlaying] = useState(false)
  // Dúvida contextual — pergunta à tutora COM o card como contexto, sem
  // sair do player (pedido literal: não sair do MAINFRAME pra pesquisar).
  const [aiOn, setAiOn] = useState(false)
  const [duvidaOpen, setDuvidaOpen] = useState(false)
  const [duvida, setDuvida] = useState('')
  const [duvidaResposta, setDuvidaResposta] = useState<string | null>(null)
  const [duvidaLoading, setDuvidaLoading] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const card = cards[idx] ?? null

  function trySpeech(text: string) {
    try {
      // cancel() antes: replays com R não podem ENFILEIRAR utterances (QA).
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'en'
      u.onstart = () => setAudioPlaying(true)
      u.onend = () => setAudioPlaying(false)
      u.onerror = () => setAudioPlaying(false)
      window.speechSynthesis.speak(u)
    } catch { /* sem TTS local — review segue sem som */ }
  }

  // Som morre com a página: navegar/ENCERRAR não pode deixar áudio tocando
  // nem utterance pendente (QA 2026-06-12).
  useEffect(() => () => {
    audioRef.current?.pause()
    try { window.speechSynthesis.cancel() } catch { /* indisponível */ }
  }, [])

  const playAudio = useCallback((c: LangCard | null) => {
    if (!c) return
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (c.audio_url) {
      const a = new Audio(`${BASE}${c.audio_url}`)
      audioRef.current = a
      a.onplay = () => setAudioPlaying(true)
      a.onpause = () => setAudioPlaying(false)
      a.onended = () => setAudioPlaying(false)
      a.play().catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'NotAllowedError') setNeedsGesture(true)
        else trySpeech(c.frente)
      })
    } else {
      trySpeech(c.frente)
    }
  }, [])

  async function loadQueue() {
    const q = await fetchLangQueue()
    setCards(q.cards)
    setReviewedCount(q.reviews_done_today)
    setIdx(0)
    setRevealed(false)
    setDone(q.cards.length === 0)
    setNextDue(q.next_due_seconds)
  }

  async function startAndLoad() {
    try {
      await startLangSession()
      // Banner global atualiza na hora, não no próximo poll de 15s (QA).
      window.dispatchEvent(new CustomEvent('hq-session-changed'))
    } catch (err) {
      // 409 = outra sessão entrou no meio tempo — re-checa e bloqueia.
      const active = await fetchActiveSession().catch(() => null)
      if (active && active.type !== 'lang') {
        setBlockedBy(active.title)
        setLoading(false)
        return
      }
      reportApiError('LangExecPage.start', err)
    }
    // loadQueue FORA do try da sessão mas com guarda própria: falha de
    // rede não pode deixar CARREGANDO… eterno (QA 2026-06-12).
    try {
      await loadQueue()
    } catch (err) {
      reportApiError('LangExecPage.queue', err)
      setQueueErro('falha ao buscar a fila')
    } finally {
      setLoading(false)
    }
  }

  // Boot: regra de quest — outra sessão rodando bloqueia a página.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await fetchLangSettings()
        if (cancelled) return
        setSettings(s)
        fetchLangAiStatus().then(st => { if (!cancelled) setAiOn(st.configured) }).catch(() => undefined)
        const active = await fetchActiveSession().catch(() => null)
        if (cancelled) return
        if (active && active.type !== 'lang') {
          setBlockedBy(active.title)
          setLoading(false)
          return
        }
        if (s.auto_session_on_review || active?.type === 'lang') {
          await startAndLoad()
        } else {
          setNeedsManualStart(true)
          setLoading(false)
        }
      } catch (err) {
        reportApiError('LangExecPage.boot', err)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Áudio automático: recognition na frente; production só no reveal.
  useEffect(() => {
    if (!card || editing) return
    if (!settings?.audio_autoplay) return
    if (card.direction === 'recognition' && !revealed) playAudio(card)
    if (card.direction === 'production' && revealed) playAudio(card)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, revealed, editing])

  async function perguntarDuvida() {
    const q = duvida.trim()
    if (!q || !card || duvidaLoading) return
    setDuvidaLoading(true)
    try {
      const a = await askLangAi(q, card.frente)
      setDuvidaResposta(a.resposta)
      setDuvida('')
    } catch (err) {
      reportApiError('LangExec.duvida', err)
      setDuvidaResposta('(IA falhou, tente de novo em instantes)')
    } finally {
      setDuvidaLoading(false)
    }
  }

  const advance = useCallback(async () => {
    setRevealed(false)
    setEditing(false)
    setDuvidaOpen(false)
    setDuvidaResposta(null)
    if (idx + 1 < cards.length) {
      setIdx(idx + 1)
      return
    }
    try {
      const q = await fetchLangQueue()
      if (q.cards.length > 0) { setCards(q.cards); setIdx(0) }
      else { setDone(true); setNextDue(q.next_due_seconds) }
    } catch (err) {
      // Rede falhou ≠ fila limpa: "FILA LIMPA" falsa faria o usuário
      // encerrar com cards pendentes (QA 2026-06-12).
      reportApiError('LangExecPage.advance', err)
      setQueueErro('rede falhou ao buscar a fila')
    }
  }, [idx, cards.length])

  const rate = useCallback(async (rating: 1 | 2 | 3 | 4) => {
    if (!card || !revealed || reviewMut.isPending) return
    try {
      await reviewMut.mutateAsync({ cardId: card.id, rating })
      setReviewedCount(n => n + 1)
      await advance()
    } catch (err) { reportApiError('LangExecPage.rate', err) }
  }, [card, revealed, reviewMut, advance])

  const undo = useCallback(async () => {
    if (undoMut.isPending) return
    try {
      const r = await undoMut.mutateAsync()
      setReviewedCount(n => Math.max(0, n - 1))
      // O card desfeito volta JÁ REVELADO como card atual — recarregar a
      // fila inteira jogava ele pro fim e mostrava outro card, impedindo
      // corrigir o rating na hora (QA 2026-06-12).
      setCards(cs => [r.card, ...cs.filter(c => c.id !== r.card.id)])
      setIdx(0)
      setRevealed(true)
      setEditing(false)
      setDone(false)
    } catch (err) { reportApiError('LangExecPage.undo', err) }
  }, [undoMut])

  async function saveEdit() {
    if (!card) return
    try {
      const updated = await updateLangCard(card.id, {
        frente: editFrente.trim() || card.frente,
        verso: editVerso.trim() || null,
      })
      setCards(cs => cs.map(c => (c.id === card.id ? updated : c)))
      setEditing(false)
      playAudio(updated)
    } catch (err) { reportApiError('LangExecPage.saveEdit', err) }
  }

  async function endSession() {
    try {
      await stopLangSession()
      window.dispatchEvent(new CustomEvent('hq-session-changed'))
    } catch (err) { reportApiError('LangExecPage.stop', err) }
    navigate('/lang/main')
  }

  // Learn-ahead: fila vazia com learning step a segundos de vencer →
  // re-busca sozinho no vencimento ("Again volta na MESMA sessão").
  useEffect(() => {
    if (!done || nextDue == null) return
    const t = setTimeout(() => {
      loadQueue().catch(() => setQueueErro('falha ao buscar a fila'))
    }, (nextDue + 2) * 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, nextDue])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (editing || done || !card || blockedBy) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (!revealed) setRevealed(true)
        else playAudio(card)
      } else if (e.key >= '1' && e.key <= '4') {
        rate(Number(e.key) as 1 | 2 | 3 | 4)
      } else if (e.key === 'r' || e.key === 'R') {
        playAudio(card)
      } else if (e.key === 'z' || e.key === 'Z') {
        undo()
      } else if (e.key === 'e' || e.key === 'E') {
        setEditFrente(card.frente)
        setEditVerso(card.verso ?? '')
        setEditing(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, revealed, editing, done, blockedBy, rate, undo, playAudio])

  const frontText = card
    ? card.direction === 'production'
      ? card.verso ?? '(sem tradução · produza a frase)'
      : card.frente
    : ''
  const backText = card
    ? card.direction === 'production' ? card.frente : card.verso ?? '(sem tradução)'
    : ''

  // ── Bloqueio estilo quest ──
  if (blockedBy) {
    return (
      <div style={{ maxWidth: 560 }}>
        <div style={{
          border: '1px solid rgba(159, 18, 57, 0.55)',
          background: 'rgba(159, 18, 57, 0.08)',
          padding: '24px 28px',
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Ban size={16} color="var(--color-accent-light)" strokeWidth={2} />
            <TechLabel color="var(--color-accent-light)">SESSÃO ATIVA EM OUTRO LUGAR</TechLabel>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
            <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{blockedBy}</span> está rodando agora.
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 18 }}>
            Uma sessão por vez, como em tudo no sistema. Pause ou finalize no banner e volte.
          </p>
          <button type="button" className="hq-btn hq-btn--ghost" onClick={() => navigate('/lang/main')}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>VOLTAR</span>
          </button>
        </div>
      </div>
    )
  }

  if (loading) return <TechLabel>CARREGANDO…</TechLabel>

  if (needsManualStart) {
    // Portal de início (default manual a pedido do usuário). Bônus: o
    // CLIQUE é o gesto que o navegador exige — o primeiro áudio toca sem
    // CTA de destrave.
    const filaDesc = today
      ? [
          today.due > 0 ? `${today.due} reviews` : null,
          today.novos_disponiveis > 0 ? `${today.novos_disponiveis} novos` : null,
        ].filter(Boolean).join(' · ') || 'fila limpa por agora'
      : '…'
    return (
      <SignalFrame style={{ maxWidth: 560, padding: '34px 36px 30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <TxRxTag tx={false} />
          <span style={{ flex: 1 }} />
          <Waveform active={false} bars={22} height={18} />
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
          fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)',
          letterSpacing: '0.02em', marginBottom: 6,
        }}>
          {filaDesc}
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '0 0 22px', lineHeight: 1.6 }}>
          O cronômetro entra no banner global ao iniciar, e segue contando
          na ESCRITA e na FALA. Encerre quando o treino inteiro acabar.
        </p>
        <button
          type="button"
          className="hq-btn hq-btn--primary"
          onClick={() => { setNeedsManualStart(false); setLoading(true); startAndLoad() }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 28px' }}
        >
          <Play size={15} strokeWidth={2} />
          <span style={{ fontWeight: 600, letterSpacing: '0.1em', fontSize: 13 }}>INICIAR SESSÃO</span>
        </button>
      </SignalFrame>
    )
  }

  return (
    <div style={{ maxWidth: 760 }}>
      {/* Header da execução */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        {!done && card && (
          <>
            <span style={{
              fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.15em',
              color: 'var(--color-text-muted)',
            }}>
              {idx + 1}/{cards.length}
            </span>
            <TechLabel size={9}>
              {card.last_review ? card.state : 'novo'} · {card.direction === 'production' ? 'PRODUÇÃO' : 'RECONHECIMENTO'}
            </TechLabel>
          </>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="hq-btn hq-btn--ghost"
          onClick={endSession}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Square size={12} strokeWidth={2} />
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>ENCERRAR</span>
        </button>
      </div>

      {needsGesture && card && (
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            className="hq-btn hq-btn--primary"
            onClick={() => { setNeedsGesture(false); playAudio(card) }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <Volume2 size={14} strokeWidth={2} />
            <span style={{ fontWeight: 600, letterSpacing: '0.08em' }}>TOCAR ÁUDIO</span>
          </button>
        </div>
      )}

      {queueErro ? (
        <div style={{ maxWidth: 560 }}>
          <div style={{ marginBottom: 12 }}>
            <TechLabel color="var(--color-warning)">{queueErro.toUpperCase()}</TechLabel>
          </div>
          <button
            type="button"
            className="hq-btn hq-btn--primary"
            onClick={() => {
              setQueueErro(null)
              setLoading(true)
              loadQueue()
                .catch(() => setQueueErro('falha ao buscar a fila'))
                .finally(() => setLoading(false))
            }}
          >
            <span style={{ fontWeight: 600, letterSpacing: '0.08em' }}>TENTAR DE NOVO</span>
          </button>
        </div>
      ) : done ? (
        <div style={{ maxWidth: 560 }}>
          <div style={{ marginBottom: 12 }}>
            <TechLabel color="var(--color-success-light)">
              {nextDue != null ? 'FILA LIMPA · UM CARD VOLTANDO' : 'FILA LIMPA POR AGORA'}
            </TechLabel>
          </div>
          {nextDue != null && (
            <p style={{
              fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
              fontSize: 12, color: 'var(--color-ice-light)', marginBottom: 10,
              letterSpacing: '0.06em',
            }}>
              próximo card em ~{nextDue < 90 ? `${Math.max(nextDue, 5)}s` : `${Math.ceil(nextDue / 60)}min`} · a fila reabre sozinha
            </p>
          )}
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
            {reviewedCount} reviews hoje. Recepção treinada; o que te falta é
            transmissão. A sessão CONTINUA contando nas abas TX:
          </p>
          {/* Esteira de treino: RX → TX, mesma sessão (cluster do módulo). */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0 18px' }}>
            <button
              type="button"
              onClick={() => navigate('/lang/escrita')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 10,
                background: 'rgba(192, 138, 58, 0.08)',
                border: '1px solid var(--color-warning)',
                color: 'var(--color-warning)',
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                letterSpacing: '0.14em', padding: '12px 20px',
                cursor: 'pointer', borderRadius: 0,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
                transition: 'background 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(192, 138, 58, 0.16)'; e.currentTarget.style.boxShadow = '0 0 14px rgba(192, 138, 58, 0.25)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(192, 138, 58, 0.08)'; e.currentTarget.style.boxShadow = 'none' }}
            >
              TX · ESCRITA
            </button>
            <button
              type="button"
              onClick={() => navigate('/lang/fala')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 10,
                background: 'rgba(192, 138, 58, 0.08)',
                border: '1px solid var(--color-warning)',
                color: 'var(--color-warning)',
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                letterSpacing: '0.14em', padding: '12px 20px',
                cursor: 'pointer', borderRadius: 0,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
                transition: 'background 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(192, 138, 58, 0.16)'; e.currentTarget.style.boxShadow = '0 0 14px rgba(192, 138, 58, 0.25)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(192, 138, 58, 0.08)'; e.currentTarget.style.boxShadow = 'none' }}
            >
              TX · FALA
            </button>
          </div>
          <button type="button" className="hq-btn hq-btn--ghost" onClick={endSession}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>ENCERRAR SESSÃO</span>
          </button>
        </div>
      ) : !card ? (
        <TechLabel>FILA VAZIA · ADICIONE CARDS NA MAIN OU NO ACERVO</TechLabel>
      ) : (
        <>
          <SignalFrame
            accent={card.direction === 'production' ? TX_COLOR : RX_COLOR}
            style={{ padding: '30px 34px 24px', marginBottom: 20 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <TxRxTag tx={card.direction === 'production'} />
              <span style={{ flex: 1 }} />
              <Waveform
                active={audioPlaying}
                color={card.direction === 'production' ? TX_COLOR : RX_COLOR}
                bars={22}
                height={18}
              />
            </div>
            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  value={editFrente}
                  onChange={e => setEditFrente(e.target.value)}
                  autoFocus
                  style={{
                    background: 'rgba(8, 12, 18, 0.7)', border: '1px solid var(--color-ice)',
                    color: 'var(--color-text-primary)', fontSize: 16, padding: '10px 12px',
                    fontFamily: 'inherit', outline: 'none', borderRadius: 0,
                  }}
                />
                <input
                  value={editVerso}
                  onChange={e => setEditVerso(e.target.value)}
                  placeholder="tradução / nota"
                  style={{
                    background: 'rgba(8, 12, 18, 0.7)', border: '1px solid var(--color-border)',
                    color: 'var(--color-text-secondary)', fontSize: 13, padding: '8px 12px',
                    fontFamily: 'inherit', outline: 'none', borderRadius: 0,
                  }}
                />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" className="hq-btn hq-btn--primary" onClick={saveEdit}>
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>SALVAR</span>
                  </button>
                  <button type="button" className="hq-btn hq-btn--ghost" onClick={() => setEditing(false)}>
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>CANCELAR</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* A frase é O conteúdo do player — escala de destaque
                    (1.4x sobre o verso, polish F5). */}
                <div style={{
                  fontSize: 27, fontWeight: 600, color: 'var(--color-text-primary)',
                  lineHeight: 1.45, marginBottom: revealed ? 20 : 0,
                  letterSpacing: '0.005em',
                }}>
                  {frontText}
                </div>
                {revealed && (
                  <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 16 }}>
                    <div style={{ fontSize: 19, color: 'var(--color-ice-light)', lineHeight: 1.5 }}>
                      {backText}
                    </div>
                    {card.notas && (
                      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                        {card.notas}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </SignalFrame>

          {!editing && (
            !revealed ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  type="button"
                  className="hq-btn hq-btn--primary"
                  onClick={() => setRevealed(true)}
                  style={{ padding: '10px 26px' }}
                >
                  <span style={{ fontWeight: 600, letterSpacing: '0.08em' }}>REVELAR</span>
                </button>
                <button type="button" className="hq-icon-btn" onClick={() => playAudio(card)} title="replay (R)" aria-label="tocar áudio">
                  <Volume2 size={15} strokeWidth={1.8} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {/* Teclas de console: o número É a tecla física (1-4) —
                    affordance de teclado em vez de botão genérico. */}
                {RATING_LABELS.map(r => (
                  <button
                    key={r.rating}
                    type="button"
                    onClick={() => rate(r.rating)}
                    disabled={reviewMut.isPending}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 10,
                      background: 'rgba(8, 12, 18, 0.55)',
                      border: `1px solid ${r.color}`,
                      color: r.color,
                      fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                      letterSpacing: '0.12em', padding: '9px 16px 9px 9px',
                      cursor: 'pointer', borderRadius: 0,
                      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
                      transition: 'background 0.15s, box-shadow 0.15s, transform 0.1s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(143, 191, 211, 0.07)'
                      e.currentTarget.style.boxShadow = `0 0 12px ${r.color}33`
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(8, 12, 18, 0.55)'
                      e.currentTarget.style.boxShadow = 'none'
                      e.currentTarget.style.transform = 'none'
                    }}
                    onMouseDown={e => { e.currentTarget.style.transform = 'translateY(1px)' }}
                    onMouseUp={e => { e.currentTarget.style.transform = 'none' }}
                  >
                    <span aria-hidden="true" style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 24, height: 24,
                      border: `1px solid ${r.color}`,
                      fontSize: 13, fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {r.rating}
                    </span>
                    {r.label}
                  </button>
                ))}
                <span style={{ flex: 1 }} />
                <button type="button" className="hq-icon-btn" onClick={() => playAudio(card)} title="replay (R)" aria-label="tocar áudio">
                  <Volume2 size={15} strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  className="hq-icon-btn"
                  onClick={() => { setEditFrente(card.frente); setEditVerso(card.verso ?? ''); setEditing(true) }}
                  title="editar (E)" aria-label="editar card"
                >
                  <Pencil size={14} strokeWidth={1.8} />
                </button>
                <button type="button" className="hq-icon-btn" onClick={undo} title="desfazer (Z)" aria-label="desfazer rating">
                  <RotateCcw size={14} strokeWidth={1.8} />
                </button>
              </div>
            )
          )}

          {/* Dúvida contextual com a tutora — só após revelar (a dúvida
              real nasce vendo a resposta). */}
          {aiOn && revealed && !editing && (
            <div style={{ marginTop: 18 }}>
              {!duvidaOpen ? (
                <button
                  type="button"
                  className="hq-btn hq-btn--ghost"
                  onClick={() => setDuvidaOpen(true)}
                  style={{ padding: '5px 12px' }}
                >
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em' }}>
                    DÚVIDA SOBRE ESSA FRASE?
                  </span>
                </button>
              ) : (
                <div style={{
                  border: '1px solid rgba(143, 191, 211, 0.25)',
                  background: 'rgba(143, 191, 211, 0.04)',
                  padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={duvida}
                      onChange={e => setDuvida(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') perguntarDuvida(); e.stopPropagation() }}
                      placeholder="ex.: por que esse tempo verbal? · quando uso essa expressão?"
                      autoFocus
                      style={{
                        flex: 1, background: 'rgba(8, 12, 18, 0.7)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-primary)', fontSize: 12.5,
                        padding: '7px 10px', outline: 'none', borderRadius: 0,
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                    <button
                      type="button"
                      className="hq-btn hq-btn--ghost"
                      onClick={perguntarDuvida}
                      disabled={duvidaLoading || !duvida.trim()}
                    >
                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em' }}>
                        {duvidaLoading ? '…' : 'PERGUNTAR'}
                      </span>
                    </button>
                  </div>
                  {duvidaResposta && (
                    <div style={{
                      marginTop: 10, fontSize: 12.5, color: 'var(--color-text-secondary)',
                      whiteSpace: 'pre-wrap', lineHeight: 1.6,
                    }}>
                      {duvidaResposta}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{
            marginTop: 28, paddingTop: 10, borderTop: '1px solid var(--color-divider)',
            fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)',
            letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            ESPAÇO REVELA · 1-4 AVALIA · R REPLAY · Z DESFAZ · E EDITA
          </div>
        </>
      )}
    </div>
  )
}
