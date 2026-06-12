/**
 * Lang Lab · ESCRITA — produção escrita com IA tutora ativa.
 *
 * A dor declarada do usuário: entende inglês fácil, mas trava pra
 * ESCREVER e arquitetar frases. Aqui ele treina isso de verdade:
 * - ASSIST destrava DURANTE a escrita (conectores/estrutura, sem
 *   escrever por ele) — o "concatenar ideias".
 * - FEEDBACK corrige DEPOIS explicando O PORQUÊ de cada erro.
 * - PERGUNTAR responde dúvida pontual sem sair do MAINFRAME.
 * - Frase corrigida vira card de PRODUÇÃO em 1 clique (fecha o ciclo:
 *   o que você errou volta na repetição espaçada até virar seu).
 *
 * Sem IA configurada o treino livre continua (pieces salvam sempre);
 * as superfícies de IA aparecem como instruções de setup.
 */
import { useEffect, useState } from 'react'

import {
  askLangAi,
  createLangCard,
  createLangPiece,
  deleteLangPiece,
  fetchLangAiStatus,
  fetchLangAsks,
  fetchLangPieces,
  langComposeAssist,
  reportApiError,
  requestLangPieceFeedback,
} from '../../api'
import { TechLabel } from '../../components/ui/CyberShell'
import type { LangAiStatus, LangAsk, LangPiece } from '../../types'

const PROMPTS = [
  'Describe your day in 3-5 sentences.',
  'Explain a problem you solved at work this week.',
  'Give your opinion about something you watched or read.',
  'Write the message you would send to a coworker about a delay.',
]

const inputStyle: React.CSSProperties = {
  background: 'rgba(8, 12, 18, 0.55)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-primary)',
  fontSize: 13, padding: '9px 12px',
  outline: 'none', borderRadius: 0, fontFamily: 'inherit',
}

function MonoNote({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
      textTransform: 'uppercase', color: color ?? 'var(--color-text-muted)',
    }}>
      {children}
    </div>
  )
}

/** Pergunta respondida + "virar card": a frase que valeu da resposta vira
 *  card de PRODUÇÃO — o ciclo dúvida → estudo espaçado se fecha. */
function AskRow({ ask, onCard }: { ask: LangAsk; onCard: (frase: string) => void }) {
  const [showCardForm, setShowCardForm] = useState(false)
  const [frase, setFrase] = useState('')
  return (
    <div style={{
      border: '1px solid var(--color-border)',
      background: 'rgba(8, 12, 18, 0.45)', padding: '12px 16px',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
        color: 'var(--color-ice-light)', marginBottom: 8,
      }}>
        {ask.pergunta}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
        {ask.resposta}
      </div>
      <div style={{ marginTop: 10 }}>
        {!showCardForm ? (
          <button
            type="button"
            className="hq-btn hq-btn--ghost"
            onClick={() => setShowCardForm(true)}
            style={{ padding: '3px 10px' }}
          >
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em' }}>+ VIRAR CARD</span>
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={frase}
              onChange={e => setFrase(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && frase.trim()) { onCard(frase.trim()); setFrase(''); setShowCardForm(false) } }}
              placeholder="cola aqui a frase em inglês da resposta que você quer treinar"
              autoFocus
              style={{ ...inputStyle, flex: 1, fontSize: 12 }}
            />
            <button
              type="button"
              className="hq-btn hq-btn--ghost"
              onClick={() => { if (frase.trim()) { onCard(frase.trim()); setFrase(''); setShowCardForm(false) } }}
              disabled={!frase.trim()}
              style={{ padding: '3px 10px' }}
            >
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em' }}>CRIAR</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function LangEscritaPage() {
  const [ai, setAi] = useState<LangAiStatus | null>(null)
  const [prompt, setPrompt] = useState('')
  const [texto, setTexto] = useState('')
  const [intencao, setIntencao] = useState('')
  const [assist, setAssist] = useState<string | null>(null)
  const [assistLoading, setAssistLoading] = useState(false)
  const [pieces, setPieces] = useState<LangPiece[]>([])
  const [feedbackLoading, setFeedbackLoading] = useState<number | null>(null)
  const [pergunta, setPergunta] = useState('')
  const [asks, setAsks] = useState<LangAsk[]>([])
  const [askLoading, setAskLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetchLangAiStatus().then(setAi).catch(() => setAi(null))
    fetchLangPieces(10).then(setPieces).catch(err => reportApiError('Escrita.pieces', err))
    fetchLangAsks(8).then(setAsks).catch(err => reportApiError('Escrita.asks', err))
  }, [])

  const aiOn = ai?.configured === true

  async function handleAssist() {
    if (!texto.trim() || assistLoading) return
    setAssistLoading(true)
    setErro(null)
    try {
      const r = await langComposeAssist(texto, intencao || undefined)
      setAssist(r.sugestoes)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setErro(msg.includes('502') ? 'IA falhou (rate limit?) · tente de novo' : 'assist indisponível')
    } finally {
      setAssistLoading(false)
    }
  }

  async function handleSalvar() {
    const t = texto.trim()
    if (!t) return
    setErro(null)
    try {
      const piece = await createLangPiece(t, prompt || undefined)
      setPieces(ps => [piece, ...ps])
      setTexto(''); setAssist(null)
    } catch (err) {
      reportApiError('Escrita.salvar', err)
      setErro('falha ao salvar')
    }
  }

  async function handleFeedback(pieceId: number) {
    setFeedbackLoading(pieceId)
    setErro(null)
    try {
      const updated = await requestLangPieceFeedback(pieceId)
      setPieces(ps => ps.map(p => (p.id === pieceId ? updated : p)))
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setErro(msg.includes('502')
        ? 'feedback falhou (rate limit?) · o texto está salvo, tente de novo'
        : 'feedback indisponível · o texto está salvo')
    } finally {
      setFeedbackLoading(null)
    }
  }

  async function handleAsk() {
    const q = pergunta.trim()
    if (!q || askLoading) return
    setAskLoading(true)
    setErro(null)
    try {
      const a = await askLangAi(q)
      setAsks(list => [a, ...list])
      setPergunta('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setErro(msg.includes('502') ? 'IA falhou (rate limit?) · tente de novo' : 'pergunta indisponível')
    } finally {
      setAskLoading(false)
    }
  }

  async function fraseParaCard(frase: string) {
    try {
      await createLangCard({ frente: frase, direction: 'production' })
      setErro(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setErro(msg.includes('409') ? 'já existe card com essa frase' : 'falha ao criar card')
    }
  }

  return (
    <div style={{ maxWidth: 860 }}>
      {/* Status da IA / instrução de setup */}
      {ai && !aiOn && (
        <div style={{
          border: '1px solid var(--color-border-strong)',
          background: 'rgba(8, 12, 18, 0.55)',
          padding: '14px 18px', marginBottom: 24,
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)',
        }}>
          <div style={{ marginBottom: 8 }}>
            <TechLabel color="var(--color-warning)">IA TUTORA DESLIGADA</TechLabel>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6, margin: 0 }}>
            O treino livre funciona normal (seus textos salvam). Pra ligar o tutor
            (assist, feedback com porquê, perguntas): 1. pegue uma chave gratuita no
            Google AI Studio; 2. adicione <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>LANG_AI_API_KEY=sua-chave</code> em
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}> apps/api/.env</code>;
            3. na aba CONFIG, mude o provedor pra "gemini". {ai.reason ? `(${ai.reason})` : ''}
          </p>
        </div>
      )}

      {erro && (
        <div style={{ marginBottom: 16 }}>
          <MonoNote color="var(--color-warning)">// {erro}</MonoNote>
        </div>
      )}

      {/* Treino de produção */}
      <div style={{ marginBottom: 10 }}><TechLabel>TREINO DE PRODUÇÃO</TechLabel></div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {PROMPTS.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => setPrompt(prompt === p ? '' : p)}
            style={{
              background: prompt === p ? 'rgba(143, 191, 211, 0.12)' : 'rgba(8, 12, 18, 0.55)',
              border: `1px solid ${prompt === p ? 'rgba(143, 191, 211, 0.5)' : 'var(--color-border)'}`,
              color: prompt === p ? 'var(--color-ice-light)' : 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)', fontSize: 10,
              padding: '5px 10px', cursor: 'pointer', borderRadius: 0,
              letterSpacing: '0.04em',
            }}
          >
            {p}
          </button>
        ))}
      </div>
      <textarea
        value={texto}
        onChange={e => setTexto(e.target.value)}
        placeholder={prompt || 'Escreva em inglês. Errar aqui é o método — o feedback explica o porquê.'}
        rows={5}
        style={{ ...inputStyle, width: '100%', resize: 'vertical', lineHeight: 1.6 }}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        {aiOn && (
          <>
            <input
              value={intencao}
              onChange={e => setIntencao(e.target.value)}
              placeholder="travou? diga o que quer expressar (pra o ASSIST)"
              style={{ ...inputStyle, flex: '1 1 260px', fontSize: 12 }}
            />
            <button
              type="button"
              className="hq-btn hq-btn--ghost"
              onClick={handleAssist}
              disabled={assistLoading || !texto.trim()}
            >
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>
                {assistLoading ? 'PENSANDO…' : 'ASSIST'}
              </span>
            </button>
          </>
        )}
        <button
          type="button"
          className="hq-btn hq-btn--primary"
          onClick={handleSalvar}
          disabled={!texto.trim()}
        >
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>SALVAR</span>
        </button>
      </div>

      {assist && (
        <div style={{
          marginTop: 14, border: '1px solid rgba(143, 191, 211, 0.35)',
          background: 'rgba(143, 191, 211, 0.05)', padding: '12px 16px',
        }}>
          <div style={{ marginBottom: 6 }}><TechLabel size={9}>ASSIST · ESTRUTURA</TechLabel></div>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {assist}
          </div>
        </div>
      )}

      {/* Perguntar à IA */}
      {aiOn && (
        <div style={{ marginTop: 36 }}>
          <div style={{ marginBottom: 10 }}><TechLabel>PERGUNTAR</TechLabel></div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              value={pergunta}
              onChange={e => setPergunta(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAsk() }}
              placeholder='ex.: como digo "deu ruim" informal? · por que "I have been working"?'
              style={{ ...inputStyle, flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
            <button
              type="button"
              className="hq-btn hq-btn--ghost"
              onClick={handleAsk}
              disabled={askLoading || !pergunta.trim()}
            >
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>
                {askLoading ? '…' : 'PERGUNTAR'}
              </span>
            </button>
          </div>
          {asks.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
              {asks.map(a => (
                <AskRow key={a.id} ask={a} onCard={fraseParaCard} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Produções salvas + feedback */}
      <div style={{ marginTop: 36, marginBottom: 10 }}><TechLabel>SUAS PRODUÇÕES</TechLabel></div>
      {pieces.length === 0 && (
        <MonoNote>NENHUMA AINDA — a primeira é a mais difícil, e é só sua</MonoNote>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {pieces.map(p => (
          <div key={p.id} style={{
            border: '1px solid var(--color-border)',
            background: 'rgba(8, 12, 18, 0.45)', padding: '14px 18px',
          }}>
            {p.prompt && <MonoNote>// {p.prompt}</MonoNote>}
            <div style={{ fontSize: 14, color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: '8px 0' }}>
              {p.texto}
            </div>
            {!p.feedback ? (
              <div style={{ display: 'flex', gap: 10 }}>
                {aiOn && (
                  <button
                    type="button"
                    className="hq-btn hq-btn--ghost"
                    onClick={() => handleFeedback(p.id)}
                    disabled={feedbackLoading === p.id}
                  >
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em' }}>
                      {feedbackLoading === p.id ? 'CORRIGINDO…' : 'FEEDBACK'}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className="hq-icon-btn hq-icon-btn--danger"
                  onClick={() => deleteLangPiece(p.id).then(() => setPieces(ps => ps.filter(x => x.id !== p.id)))}
                  title="excluir"
                  aria-label="excluir produção"
                  style={{ fontSize: 10 }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 12, marginTop: 4 }}>
                {p.feedback.versao_natural && (
                  <div style={{ marginBottom: 10 }}>
                    <MonoNote color="var(--color-success-light)">VERSÃO NATURAL</MonoNote>
                    <div style={{ fontSize: 13, color: 'var(--color-success-light)', marginTop: 4, lineHeight: 1.5 }}>
                      {p.feedback.versao_natural}
                    </div>
                  </div>
                )}
                {p.feedback.erros.map((e, i) => (
                  <div key={i} style={{ marginBottom: 8, fontSize: 12.5, lineHeight: 1.55 }}>
                    <span style={{ color: 'var(--color-accent-light)', textDecoration: 'line-through' }}>{e.trecho}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}> · </span>
                    <span style={{ color: 'var(--color-ice-light)' }}>{e.correcao}</span>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
                      textTransform: 'uppercase', color: 'var(--color-text-muted)',
                      border: '1px solid var(--color-border)', padding: '1px 6px', marginLeft: 8,
                    }}>
                      {e.tag}
                    </span>
                    <div style={{ color: 'var(--color-text-secondary)', fontSize: 12, marginTop: 2 }}>
                      {e.por_que}
                    </div>
                  </div>
                ))}
                {p.feedback.observacao_registro && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic', marginBottom: 8 }}>
                    {p.feedback.observacao_registro}
                  </div>
                )}
                {p.feedback.frases_pra_card.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                    <MonoNote>VALE VIRAR CARD (produção)</MonoNote>
                    {p.feedback.frases_pra_card.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 12.5, color: 'var(--color-text-primary)' }}>{f}</span>
                        <button
                          type="button"
                          className="hq-btn hq-btn--ghost"
                          onClick={() => fraseParaCard(f)}
                          style={{ padding: '3px 8px' }}
                        >
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em' }}>+ CARD</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
