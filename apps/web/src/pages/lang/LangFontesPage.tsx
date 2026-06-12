/**
 * Lang Lab · FONTES — o pipeline do método Vergara: cola a lição/
 * transcrição/letra (uma frase por linha), anexa o áudio original se
 * tiver, seleciona as frases que valem e MINERA — viram cards em lote.
 * Os MP3s do TTS chegam em background (a mineração não trava); card sem
 * arquivo toca via speechSynthesis até o áudio ficar pronto.
 *
 * Fonte NÃO é a Library: aqui é corpus cru pra virar cards, sem
 * status/tese/destilação (PLAN §3.2).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Pickaxe, Plus, Trash2, Upload } from 'lucide-react'

import {
  BASE,
  createLangSource,
  deleteLangSource,
  fetchLangSources,
  mineLangSource,
  reportApiError,
  uploadLangSourceAudio,
} from '../../api'
import { TechLabel } from '../../components/ui/CyberShell'
import { confirmDialog } from '../../lib/dialog'
import type { LangSource } from '../../types'

const TIPOS: { key: LangSource['tipo']; label: string }[] = [
  { key: 'lesson', label: 'LIÇÃO' },
  { key: 'video', label: 'VÍDEO' },
  { key: 'music', label: 'MÚSICA' },
  { key: 'article', label: 'ARTIGO' },
  { key: 'conversation', label: 'CONVERSA' },
  { key: 'other', label: 'OUTRO' },
]

const inputStyle: React.CSSProperties = {
  background: 'rgba(8, 12, 18, 0.55)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-primary)',
  fontSize: 13, padding: '8px 11px',
  outline: 'none', borderRadius: 0, fontFamily: 'inherit',
}

export function LangFontesPage() {
  const [sources, setSources] = useState<LangSource[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [tipo, setTipo] = useState<LangSource['tipo']>('lesson')
  const [origem, setOrigem] = useState('')
  const [texto, setTexto] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  function reload() {
    fetchLangSources().then(setSources).catch(err => reportApiError('Fontes.load', err))
  }
  useEffect(reload, [])

  async function handleCriar() {
    if (!titulo.trim()) return
    try {
      const s = await createLangSource({
        titulo: titulo.trim(),
        tipo,
        origem: origem.trim() || null,
        texto: texto.trim() || null,
      })
      setSources(list => [s, ...list])
      setTitulo(''); setOrigem(''); setTexto(''); setShowForm(false)
      setOpenId(s.id)
    } catch (err) {
      reportApiError('Fontes.criar', err)
      setMsg('falha ao criar fonte')
    }
  }

  async function handleExcluir(s: LangSource) {
    const ok = await confirmDialog({
      title: 'Excluir fonte',
      message: `"${s.titulo}"\nOs ${s.cards_count} cards minerados dela CONTINUAM no acervo.`,
      confirmLabel: 'EXCLUIR',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deleteLangSource(s.id)
      setSources(list => list.filter(x => x.id !== s.id))
    } catch (err) {
      reportApiError('Fontes.excluir', err)
      setMsg('falha ao excluir a fonte')
    }
  }

  return (
    <div style={{ maxWidth: 860 }}>
      {msg && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--color-warning)', marginBottom: 12,
        }}>
          // {msg}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <TechLabel>FONTES · CORPUS DE MINERAÇÃO</TechLabel>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="hq-btn hq-btn--primary"
          onClick={() => setShowForm(v => !v)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Plus size={13} strokeWidth={2} />
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>NOVA FONTE</span>
        </button>
      </div>

      {showForm && (
        <div style={{
          border: '1px solid var(--color-ice-deep)',
          background: 'rgba(8, 12, 18, 0.55)',
          padding: '16px 18px', marginBottom: 20,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder="título (ex: Vergara · unidade 12)"
              style={{ ...inputStyle, flex: '2 1 240px' }}
            />
            <select
              value={tipo}
              onChange={e => setTipo(e.target.value as LangSource['tipo'])}
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 11, colorScheme: 'dark' }}
            >
              {TIPOS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <input
              value={origem}
              onChange={e => setOrigem(e.target.value)}
              placeholder="origem/URL (opcional)"
              style={{ ...inputStyle, flex: '1 1 180px', fontSize: 12 }}
            />
          </div>
          <textarea
            value={texto}
            onChange={e => setTexto(e.target.value)}
            placeholder={'Cole o texto aqui, UMA FRASE POR LINHA facilita a mineração.\nI should have known better.\nIt went south pretty fast.\n…'}
            rows={6}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6, fontSize: 13 }}
          />
          <div>
            <button
              type="button"
              className="hq-btn hq-btn--primary"
              onClick={handleCriar}
              disabled={!titulo.trim()}
            >
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>CRIAR</span>
            </button>
          </div>
        </div>
      )}

      {sources.length === 0 && !showForm && (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Nenhuma fonte ainda. Cola uma lição do Vergara, a transcrição de um
          vídeo ou a letra de uma música, e minera as frases que valem.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sources.map(s => (
          <SourceCard
            key={s.id}
            source={s}
            open={openId === s.id}
            onToggle={() => setOpenId(openId === s.id ? null : s.id)}
            onDelete={() => handleExcluir(s)}
            onChanged={reload}
          />
        ))}
      </div>
    </div>
  )
}

function SourceCard({ source, open, onToggle, onDelete, onChanged }: {
  source: LangSource
  open: boolean
  onToggle: () => void
  onDelete: () => void
  onChanged: () => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set())
  const [direction, setDirection] = useState<'recognition' | 'production'>('recognition')
  const [mining, setMining] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  const linhas = useMemo(
    () => (source.texto ?? '').split('\n').map(l => l.trim()).filter(Boolean),
    [source.texto],
  )

  function toggleLinha(i: number) {
    setSelecionadas(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  async function minerar() {
    const lines = [...selecionadas].sort((a, b) => a - b).map(i => linhas[i])
    if (lines.length === 0 || mining) return
    setMining(true)
    setResultado(null)
    try {
      const r = await mineLangSource(source.id, lines, direction)
      setResultado(`${r.criados} cards criados · ${r.duplicados} já existiam · áudio chegando em background`)
      setSelecionadas(new Set())
      onChanged()
    } catch (err) {
      reportApiError('Fontes.minerar', err)
      setResultado('falha na mineração')
    } finally {
      setMining(false)
    }
  }

  async function uploadAudio(file: File) {
    try {
      await uploadLangSourceAudio(source.id, file)
      onChanged()
    } catch (err) {
      reportApiError('Fontes.audio', err)
      setResultado('falha no upload do áudio')
    }
  }

  return (
    <div style={{ border: '1px solid var(--color-border)', background: 'rgba(8, 12, 18, 0.45)' }}>
      <div
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer' }}
      >
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 8.5, fontWeight: 700,
          letterSpacing: '0.16em', color: 'var(--color-ice)', width: 64, flexShrink: 0,
        }}>
          {TIPOS.find(t => t.key === source.tipo)?.label ?? source.tipo.toUpperCase()}
        </span>
        <span style={{ flex: 1, fontSize: 13.5, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {source.titulo}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-muted)', letterSpacing: '0.12em' }}>
          {source.cards_count} CARDS
        </span>
        <ChevronDown
          size={14}
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s', color: 'var(--color-text-muted)' }}
        />
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--color-divider)', padding: '14px' }}>
          {/* Áudio da fonte */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            {source.audio_url ? (
              <audio controls src={`${BASE}${source.audio_url}`} style={{ height: 32, maxWidth: 360 }} />
            ) : (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
                SEM ÁUDIO DA FONTE (os cards usam TTS)
              </span>
            )}
            <button
              type="button"
              className="hq-btn hq-btn--ghost"
              onClick={() => fileRef.current?.click()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px' }}
            >
              <Upload size={11} strokeWidth={2} />
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em' }}>
                {source.audio_url ? 'TROCAR ÁUDIO' : 'SUBIR ÁUDIO'}
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".mp3,.m4a,.wav,.ogg,.webm"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadAudio(f) }}
            />
            <span style={{ flex: 1 }} />
            <button type="button" className="hq-icon-btn hq-icon-btn--danger" onClick={onDelete} title="excluir fonte" aria-label="excluir fonte">
              <Trash2 size={13} strokeWidth={1.8} />
            </button>
          </div>

          {/* Mineração */}
          {linhas.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              Fonte sem texto: edite e cole as frases (uma por linha) pra minerar.
            </span>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="hq-btn hq-btn--ghost"
                  onClick={() => setSelecionadas(selecionadas.size === linhas.length ? new Set() : new Set(linhas.map((_, i) => i)))}
                  style={{ padding: '4px 10px' }}
                >
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em' }}>
                    {selecionadas.size === linhas.length ? 'DESMARCAR TODAS' : 'MARCAR TODAS'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDirection(d => (d === 'recognition' ? 'production' : 'recognition'))}
                  style={{
                    background: 'rgba(8, 12, 18, 0.55)',
                    border: `1px solid ${direction === 'production' ? 'var(--color-warning)' : 'var(--color-border)'}`,
                    color: direction === 'production' ? 'var(--color-warning)' : 'var(--color-text-muted)',
                    fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
                    letterSpacing: '0.12em', padding: '5px 10px', cursor: 'pointer', borderRadius: 0,
                  }}
                >
                  {direction === 'production' ? 'CARDS DE PRODUÇÃO' : 'CARDS DE RECONHECIMENTO'}
                </button>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="hq-btn hq-btn--primary"
                  onClick={minerar}
                  disabled={selecionadas.size === 0 || mining}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                >
                  <Pickaxe size={13} strokeWidth={2} />
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>
                    {mining ? 'MINERANDO…' : `MINERAR ${selecionadas.size || ''}`}
                  </span>
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflow: 'auto' }}>
                {linhas.map((l, i) => (
                  <label
                    key={i}
                    style={{
                      display: 'flex', alignItems: 'baseline', gap: 10,
                      padding: '5px 8px', cursor: 'pointer',
                      background: selecionadas.has(i) ? 'rgba(143, 191, 211, 0.07)' : 'transparent',
                      border: `1px solid ${selecionadas.has(i) ? 'rgba(143, 191, 211, 0.3)' : 'transparent'}`,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selecionadas.has(i)}
                      onChange={() => toggleLinha(i)}
                      style={{ accentColor: 'var(--color-ice)' }}
                    />
                    <span style={{ fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.45 }}>{l}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {resultado && (
            <div style={{
              marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 10,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              color: resultado.includes('falha') ? 'var(--color-warning)' : 'var(--color-success-light)',
            }}>
              // {resultado}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
