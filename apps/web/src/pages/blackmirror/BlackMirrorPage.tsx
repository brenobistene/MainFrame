/**
 * Black Mirror — o espelho de dados.
 *
 * Superfície cinematográfica: shader (BlackMirrorCanvas) ao fundo, a leitura
 * diária por cima. NÃO aconselha — reflete, aponta a tensão e devolve UMA
 * pergunta. O if-then (`meu_passo`) é escrito pelo usuário, não pela IA.
 *
 * Geração é lazy: ao abrir num dia novo, dispara o generate uma vez. Doc:
 * docs/black-mirror, memória project-black-mirror.
 */
import { useEffect, useRef, useState } from 'react'
import { RefreshCw, CornerDownRight, AlertTriangle, ChevronDown } from 'lucide-react'

import { BlackMirrorCanvas } from '../../components/BlackMirrorCanvas'
import {
  useBlackMirrorHistory,
  useBlackMirrorToday,
  useGenerateBlackMirror,
  useSaveBlackMirrorPasso,
} from '../../lib/blackmirror-queries'

const INK = '#d2e2e8'
const DIM = '#62787f'
const PANEL = 'rgba(5, 10, 12, 0.55)'
const BORDER = 'rgba(120, 160, 172, 0.18)'

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono, monospace)', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.34em', textTransform: 'uppercase', color: DIM, marginBottom: 10,
    }}>
      {children}
    </div>
  )
}

export default function BlackMirrorPage() {
  const todayQ = useBlackMirrorToday()
  const gen = useGenerateBlackMirror()
  const savePasso = useSaveBlackMirrorPasso()
  const historyQ = useBlackMirrorHistory(30)

  const data = todayQ.data
  const triedRef = useRef(false)

  // Geração lazy: 1ª abertura do dia sem leitura → gera uma vez.
  useEffect(() => {
    if (data && !data.generated && !triedRef.current && !gen.isPending) {
      triedRef.current = true
      gen.mutate()
    }
  }, [data, gen])

  const [passo, setPasso] = useState('')
  useEffect(() => { setPasso(data?.meu_passo ?? '') }, [data?.meu_passo, data?.date])

  const [histOpen, setHistOpen] = useState(false)

  const notConfigured = (gen.error as any)?.status === 409
  const aiError = gen.error && !notConfigured
  const generating = gen.isPending
  const ready = data?.generated

  const regenerate = () => { triedRef.current = true; gen.mutate() }

  return (
    <>
      {/* Shader em TELA CHEIA — fixed atrás de tudo. A sidebar e o banner
          flutuam por cima com o próprio frosted glass. pointerEvents:none
          pra não bloquear cliques na leitura. */}
      <BlackMirrorCanvas style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }} />

      {/* Leitura por cima, no fluxo da página (respeita sidebar + banner). */}
      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        minHeight: 'calc(100vh - 180px)',
        fontFamily: 'var(--font-mono, monospace)',
      }}>
        {/* Header */}
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: INK,
              boxShadow: `0 0 12px 2px ${INK}88`, flexShrink: 0,
            }} />
            <h1 style={{
              margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: '0.42em',
              textTransform: 'uppercase', color: INK,
            }}>
              Black&nbsp;Mirror
            </h1>
            <span style={{ fontSize: 11, letterSpacing: '0.34em', textTransform: 'uppercase', color: DIM }}>
              espelho de dados
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: DIM }}>
              {data?.date ?? '—'}
            </span>
            <button
              type="button"
              onClick={regenerate}
              disabled={generating}
              title="Regerar a leitura de hoje"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'rgba(8,14,16,0.6)', border: `1px solid ${BORDER}`,
                color: INK, padding: '8px 14px', borderRadius: 0, cursor: generating ? 'wait' : 'pointer',
                fontFamily: 'var(--font-mono, monospace)', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.18em', textTransform: 'uppercase', opacity: generating ? 0.5 : 1,
                clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)',
              }}
            >
              <RefreshCw size={13} strokeWidth={2} style={generating ? { animation: 'bmspin 1s linear infinite' } : undefined} />
              {generating ? 'lendo' : 'regerar'}
            </button>
          </div>
        </header>

        {/* Corpo central */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
          maxWidth: 760, margin: '0 auto', width: '100%', padding: '48px 0',
        }}>
          {notConfigured ? (
            <div style={{ ...cardStyle, textAlign: 'center' }}>
              <AlertTriangle size={20} color={DIM} style={{ marginBottom: 12 }} />
              <p style={{ color: INK, fontSize: 15, lineHeight: 1.6, margin: 0 }}>
                A IA não está configurada.
              </p>
              <p style={{ color: DIM, fontSize: 13, lineHeight: 1.7, marginTop: 10 }}>
                O Black Mirror usa a mesma IA do Lang Lab. Configure o provedor em
                <strong style={{ color: INK }}> Lang Lab → Config </strong>
                e a chave <code style={{ color: INK }}>LANG_AI_API_KEY</code> no
                <code style={{ color: INK }}> apps/api/.env</code>.
              </p>
            </div>
          ) : aiError ? (
            <div style={{ ...cardStyle, textAlign: 'center' }}>
              <AlertTriangle size={20} color={DIM} style={{ marginBottom: 12 }} />
              <p style={{ color: INK, fontSize: 14, margin: 0 }}>Falha ao gerar a leitura.</p>
              <p style={{ color: DIM, fontSize: 12, marginTop: 8 }}>{(gen.error as any)?.message}</p>
              <button type="button" onClick={regenerate} style={{ ...ghostBtn, marginTop: 16 }}>tentar de novo</button>
            </div>
          ) : ready ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              {/* Reflexo */}
              <section>
                <Label>reflexo</Label>
                <p style={{ color: INK, fontSize: 'clamp(20px, 2.6vw, 28px)', lineHeight: 1.45, margin: 0, fontWeight: 300, textShadow: '0 2px 20px rgba(0,0,0,0.9)' }}>
                  {data!.reflexo}
                </p>
              </section>

              {/* Tensão */}
              {data!.tensao && (
                <section style={{
                  ...cardStyle,
                  borderLeft: `2px solid ${INK}`,
                  background: 'rgba(8, 16, 19, 0.6)',
                }}>
                  <Label>tensão</Label>
                  <p style={{ color: INK, fontSize: 16, lineHeight: 1.6, margin: 0 }}>{data!.tensao}</p>
                </section>
              )}

              {/* Padrão */}
              {data!.padrao && (
                <section>
                  <Label>padrão</Label>
                  <p style={{ color: DIM, fontSize: 14, lineHeight: 1.65, margin: 0 }}>{data!.padrao}</p>
                </section>
              )}

              {/* Pergunta */}
              {data!.pergunta && (
                <section style={{ marginTop: 8 }}>
                  <Label>a pergunta</Label>
                  <p style={{ color: INK, fontSize: 'clamp(18px, 2.2vw, 22px)', lineHeight: 1.5, margin: 0, fontStyle: 'italic', fontWeight: 300, textShadow: '0 2px 20px rgba(0,0,0,0.9)' }}>
                    {data!.pergunta}
                  </p>
                </section>
              )}

              {/* Meu passo — if-then escrito pelo usuário */}
              <section style={{ ...cardStyle, marginTop: 8 }}>
                <Label>meu passo (se… então…)</Label>
                <textarea
                  value={passo}
                  onChange={e => setPasso(e.target.value)}
                  onBlur={() => { if (passo !== (data?.meu_passo ?? '')) savePasso.mutate(passo.trim() || null) }}
                  placeholder="Se eu abrir o PC, então faço 25 min do que declarei importante antes de qualquer outra coisa."
                  rows={2}
                  style={{
                    width: '100%', resize: 'vertical', background: 'transparent',
                    border: 'none', borderBottom: `1px solid ${BORDER}`, outline: 'none',
                    color: INK, fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6, padding: '4px 0',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: DIM }}>
                    <CornerDownRight size={12} /> a ação é sua — o espelho só reflete
                  </span>
                  <button
                    type="button"
                    onClick={() => savePasso.mutate(passo.trim() || null)}
                    disabled={savePasso.isPending || passo === (data?.meu_passo ?? '')}
                    style={{ ...ghostBtn, opacity: (savePasso.isPending || passo === (data?.meu_passo ?? '')) ? 0.4 : 1 }}
                  >
                    {savePasso.isPending ? 'salvando' : 'salvar'}
                  </button>
                </div>
              </section>
            </div>
          ) : (
            <div style={{ ...cardStyle, textAlign: 'center' }}>
              <RefreshCw size={18} color={DIM} style={{ marginBottom: 12, animation: 'bmspin 1s linear infinite' }} />
              <p style={{ color: INK, fontSize: 14, margin: 0 }}>Lendo seus dados…</p>
              <p style={{ color: DIM, fontSize: 12, marginTop: 8 }}>cruzando o que você diz querer com o que você fez</p>
            </div>
          )}
        </div>

        {/* Histórico */}
        {(historyQ.data?.length ?? 0) > 1 && (
          <div style={{ marginTop: 'auto' }}>
            <button
              type="button"
              onClick={() => setHistOpen(o => !o)}
              style={{
                ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 8,
                border: 'none', background: 'transparent', paddingLeft: 0,
              }}
            >
              <ChevronDown size={13} style={{ transform: histOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
              leituras anteriores ({(historyQ.data?.length ?? 1) - 1})
            </button>
            {histOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 12 }}>
                {historyQ.data!.filter(h => h.date !== data?.date).map(h => (
                  <div key={h.date} style={{
                    display: 'grid', gridTemplateColumns: '100px 1fr', gap: 16, alignItems: 'baseline',
                    padding: '12px 0', borderTop: `1px solid ${BORDER}`,
                  }}>
                    <span style={{ fontSize: 11, letterSpacing: '0.18em', color: DIM }}>{h.date}</span>
                    <span style={{ fontSize: 13, color: INK, lineHeight: 1.55, opacity: 0.85 }}>{h.reflexo}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`@keyframes bmspin { to { transform: rotate(360deg) } }`}</style>
    </>
  )
}

const cardStyle: React.CSSProperties = {
  background: PANEL,
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: '20px 22px',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
}

const ghostBtn: React.CSSProperties = {
  background: 'transparent', border: `1px solid ${BORDER}`, color: INK,
  padding: '7px 14px', borderRadius: 0, cursor: 'pointer',
  fontFamily: 'var(--font-mono, monospace)', fontSize: 10, fontWeight: 700,
  letterSpacing: '0.18em', textTransform: 'uppercase',
}
