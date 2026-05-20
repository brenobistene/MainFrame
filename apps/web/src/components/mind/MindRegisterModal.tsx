/**
 * Modal de registro/edição de sessão de Mind (Observação Estruturada).
 *
 * Estrutura do fluxo:
 *   - Tipo: ROTINA (99%) vs REVELAÇÃO (breakthrough raro, destacado depois).
 *   - Duração com chips rápidos (5/10/15/20/30/45min).
 *   - Intenção pré-sessão (opcional) — pathworking estruturado.
 *   - Observação POST (obrigatória) — fato específico, não sentimento vago.
 *   - Hipótese (opc) — vira entidade própria com status pending.
 *   - Tags (0-3) — controladas via catálogo Mind.
 *
 * Estética: vocabulário CP2077 do tronco. Mind tem accent roxo dessaturado
 * `#9b88c4` aplicado nas bordas e botões primários.
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, ChevronDown, ChevronRight, Eye, Sparkles, X } from 'lucide-react'

import {
  useCreateMindSession,
  useHealthDomains,
  useHealthRecords,
  useMindTags,
  useUpdateMindSession,
} from '../../lib/health-queries'
import { useCreateLibraryLink, useLibraryItem } from '../../lib/library-queries'
import type { MindSession, MindTipo } from '../../types'
import { BODY, MONO } from '../health/tokens'
import { isoToLocalYmd } from '../../utils/datetime'

const MIND_COR = '#9b88c4'
const DURACAO_PRESETS = [5, 10, 15, 20, 30, 45]

interface Props {
  existing?: MindSession
  onClose: () => void
  /** Quando setado, indica que a sessão nasceu a partir de um LibraryItem.
   *  Mostra banner no topo e, após criar a sessão com hipótese, dispara um
   *  cross-link automático library_item → mind_hipotese (com nota "originou
   *  no [título]"). Doc: docs/library/PLAN.md §7. */
  originLibraryItemId?: number
  /** Disparado por FINALIZAR de um mind_session cronometrado (pendência
   *  arrastada no /Dia). Pré-preenche duração + horário + data. Após save,
   *  linka todas as rows do cluster ao record criado. */
  prefillFromSession?: {
    started_at: string
    ended_at?: string | null
    duracao_min: number
  }
  /** Callback síncrono pra linkar o cluster Mind ao record_id recém-criado.
   *  Chamado dentro do onSuccess do createSession. */
  onSessionLink?: (recordId: number) => void
}

export default function MindRegisterModal({
  existing,
  onClose,
  originLibraryItemId,
  prefillFromSession,
  onSessionLink,
}: Props) {
  const isEdit = !!existing
  const createSession = useCreateMindSession()
  const updateSession = useUpdateMindSession()
  const { data: tags = [] } = useMindTags(false)
  const createLibraryLink = useCreateLibraryLink()
  const { data: originItem } = useLibraryItem(originLibraryItemId ?? null)

  // LOCAL hoje (não UTC) — sem isso, user em BRT depois de 21h salva como
  // "amanhã" e o card no /Dia some porque a pendência consulta hoje local.
  const today = isoToLocalYmd(new Date())
  const nowHHMM = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`

  // Se vem de sessão cronometrada, pré-preenche data/horário a partir
  // de started_at e duração da sessão. Override só pra entries não-edit.
  // IMPORTANTE: usa isoToLocalYmd em vez de slice(0,10) porque started_at
  // é UTC com Z suffix — se o user iniciar 22:00 BRT (01:00 UTC do dia
  // seguinte), slicing direto pega a data UTC e o record fica salvo no
  // dia errado, sumindo da pendência de hoje.
  const sessionStartDate = prefillFromSession?.started_at
    ? isoToLocalYmd(new Date(prefillFromSession.started_at))
    : null
  const sessionStartHHMM = prefillFromSession?.started_at
    ? new Date(prefillFromSession.started_at).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  // localStorage key pra rascunho da próxima sessão (pathworking — intent
  // setada na sessão anterior puxa pro form da próxima).
  const DRAFT_KEY = 'mind-next-intent'
  const draftIntent =
    !existing && typeof window !== 'undefined'
      ? window.localStorage.getItem(DRAFT_KEY)
      : null

  // Estado pré-preenchido em edit mode OU em sessão cronometrada
  const [data, setData] = useState(existing?.data ?? sessionStartDate ?? today)
  const [horario, setHorario] = useState(
    existing?.horario ?? sessionStartHHMM ?? nowHHMM,
  )
  const [tipo, setTipo] = useState<MindTipo>(existing?.payload.tipo ?? 'rotina')
  const [duracao, setDuracao] = useState(
    existing?.payload.duracao_min != null
      ? String(existing.payload.duracao_min)
      : prefillFromSession?.duracao_min != null
        ? String(prefillFromSession.duracao_min)
        : '20',
  )
  const [intencao, setIntencao] = useState(
    existing?.payload.intencao ?? draftIntent ?? '',
  )
  const [observacao, setObservacao] = useState(existing?.payload.observacao ?? '')
  const [hipotese, setHipotese] = useState(existing?.payload.hipotese ?? '')
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(() => {
    if (!existing) return new Set()
    return new Set(existing.tags.map((t) => t.id))
  })
  const [error, setError] = useState<string | null>(null)
  const [nextIntent, setNextIntent] = useState('')
  const [showContext, setShowContext] = useState(false)
  const [tagQuery, setTagQuery] = useState('')

  // Tags filtradas pelo search — busca em nome, slug e descricao (case-insensitive).
  // Selecionadas sempre aparecem (mesmo se não baterem o filtro) pra não sumir
  // de vista quando o usuário tá refinando a busca.
  const filteredTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase()
    if (!q) return tags
    return tags.filter((t) => {
      if (selectedTagIds.has(t.id)) return true
      return (
        t.nome.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.descricao?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [tags, tagQuery, selectedTagIds])

  // Limpa draft de intenção depois que abriu o form (foi usado).
  useEffect(() => {
    if (draftIntent && typeof window !== 'undefined') {
      window.localStorage.removeItem(DRAFT_KEY)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleTag(id: number) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!observacao.trim()) {
      setError('Observação é obrigatória')
      return
    }
    const dur = duracao.trim() ? Number(duracao) : undefined
    const payload = {
      observacao: observacao.trim(),
      tipo,
      ...(dur ? { duracao_min: dur } : {}),
      ...(intencao.trim() ? { intencao: intencao.trim() } : {}),
      ...(hipotese.trim() ? { hipotese: hipotese.trim() } : {}),
    }
    const tag_ids = Array.from(selectedTagIds)
    // Salva intenção da próxima sessão no localStorage (pathworking).
    if (nextIntent.trim() && typeof window !== 'undefined') {
      window.localStorage.setItem(DRAFT_KEY, nextIntent.trim())
    }
    if (isEdit && existing) {
      updateSession.mutate(
        { id: existing.id, patch: { data, horario, payload, tag_ids } },
        {
          onSuccess: onClose,
          onError: (err) => setError((err as Error).message),
        },
      )
    } else {
      createSession.mutate(
        { data, horario, payload, tag_ids },
        {
          onSuccess: (created) => {
            // Cross-link a partir de Library origin (já existente)
            if (originLibraryItemId && created.hipotese?.id) {
              createLibraryLink.mutate({
                itemId: originLibraryItemId,
                body: {
                  target_type: 'mind_hipotese',
                  target_id: String(created.hipotese.id),
                  nota: originItem
                    ? `Hipótese originada em "${originItem.titulo}"`
                    : 'Hipótese originada nesta leitura',
                },
              })
            }
            // Linka cluster de mind_session ao health_record criado.
            // `created` é a MindSession (que carrega o health_record_id no
            // backend). O frontend não tem o record_id direto — usamos o
            // callback fornecido pelo parent que sabe disparar a link via
            // hook (useLinkMindSessionToRecord). Parent passa a referência
            // do record_id derivada de `created.id` (que é o mind_session
            // id da nova session).
            if (onSessionLink) onSessionLink(created.id)
            onClose()
          },
          onError: (err) => setError((err as Error).message),
        },
      )
    }
  }

  const submitting = createSession.isPending || updateSession.isPending

  return createPortal(
    <div
      role="dialog"
      onClick={onClose}
      className="hq-animate-overlay-in"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        overflow: 'hidden',
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="hq-glass-elevated hq-grain hq-animate-modal-in hq-chamfer-cross"
        style={{
          position: 'relative',
          padding: 'var(--space-5) var(--space-6)',
          width: 'min(640px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          color: 'var(--color-text-primary)',
          borderLeft: `2px solid ${MIND_COR}`,
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <div
          aria-hidden="true"
          className="hq-hairline-ice"
          style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        />

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <Eye size={16} strokeWidth={1.6} color={MIND_COR} />
          <span
            className="hq-tech-label"
            style={{
              fontSize: 11,
              color: 'var(--color-ice-light)',
              letterSpacing: '0.28em',
            }}
          >
            {isEdit ? 'EDITAR' : 'MEDITAR'}
          </span>
          <span className="hq-tech-id" style={{ color: 'var(--color-text-muted)' }}>
            MIND
          </span>
          <button
            type="button"
            onClick={onClose}
            className="hq-icon-btn-bare"
            style={{ marginLeft: 'auto', minWidth: 28, minHeight: 28, padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Banner de origem — quando a sessão nasce a partir de um LibraryItem.
            Mostra título do livro/filme/etc + dica de que cross-link vai
            acontecer auto se a sessão registrar hipótese. */}
        {originLibraryItemId && (
          <div
            className="hq-chamfer-bl"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              marginBottom: 'var(--space-3)',
              background: 'var(--color-bg-primary)',
              border: '1px solid #7fb8a8',
              borderLeft: '2px solid #7fb8a8',
            }}
          >
            <BookOpen size={12} color="#7fb8a8" strokeWidth={2} />
            <span
              className="hq-tech-id"
              style={{ color: '#7fb8a8', letterSpacing: '0.18em' }}
            >
              VINDO DE
            </span>
            <span
              style={{
                fontFamily: BODY,
                fontSize: 12,
                color: 'var(--color-text-primary)',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {originItem?.titulo ?? '…'}
            </span>
            <span
              className="hq-tech-id"
              style={{
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
                fontSize: 9,
              }}
              title="Se você registrar hipótese, o cross-link Library → Hipótese é criado automaticamente"
            >
              auto-link
            </span>
          </div>
        )}

        {/* Toggle tipo */}
        <FormGroup label="TIPO">
          <div style={{ display: 'flex', gap: 6 }}>
            {(['rotina', 'revelacao'] as const).map((t) => {
              const active = tipo === t
              const accent = t === 'revelacao' ? '#c08a3a' : MIND_COR
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className="hq-chamfer-bl"
                  style={{
                    background: active ? accent : 'var(--color-bg-primary)',
                    border: active
                      ? `1px solid ${accent}`
                      : '1px solid var(--color-border)',
                    color: active ? '#000' : 'var(--color-text-secondary)',
                    padding: '6px 14px',
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: active ? 700 : 500,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {t === 'revelacao' && <Sparkles size={11} />}
                  {t === 'rotina' ? 'rotina' : 'revelação'}
                </button>
              )
            })}
          </div>
        </FormGroup>

        {/* Duração + data + hora — escondidos quando o registro vem de
            uma sessão cronometrada (started_at + duração já conhecidos).
            Os states continuam inicializados com os valores da sessão pro
            payload sair certo. */}
        {!prefillFromSession && (
        <FormRow>
          <FormGroup label="DURAÇÃO (MIN)" style={{ flex: 1 }}>
            <div
              style={{
                display: 'flex',
                gap: 4,
                flexWrap: 'wrap',
                marginBottom: 6,
              }}
            >
              {DURACAO_PRESETS.map((p) => {
                const active = duracao === String(p)
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setDuracao(String(p))}
                    className="hq-chamfer-bl"
                    style={{
                      background: active ? MIND_COR : 'var(--color-bg-primary)',
                      border: active
                        ? `1px solid ${MIND_COR}`
                        : '1px solid var(--color-border)',
                      color: active ? '#000' : 'var(--color-text-secondary)',
                      padding: '4px 10px',
                      fontFamily: MONO,
                      fontSize: 11,
                      fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {p}
                  </button>
                )
              })}
            </div>
            <input
              type="number"
              min={1}
              max={600}
              value={duracao}
              onChange={(e) => setDuracao(e.target.value)}
              style={inputStyle()}
              placeholder="customizar"
            />
          </FormGroup>
          <FormGroup label="DATA" style={{ width: 140 }}>
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              style={inputStyle()}
            />
          </FormGroup>
          <FormGroup label="HORA" style={{ width: 110 }}>
            <input
              type="time"
              value={horario}
              onChange={(e) => setHorario(e.target.value)}
              style={inputStyle()}
            />
          </FormGroup>
        </FormRow>
        )}

        {/* Contexto recente (cruzamento com outros domínios) — colapsável.
            Mostra leituras dos últimos 7d de Sono/Exercício/Alimentação/Vícios
            pra informar formação de hipótese. Diferencial vs journaling apps. */}
        <ContextoRecente
          dataRef={data}
          expanded={showContext}
          onToggle={() => setShowContext((v) => !v)}
        />

        {/* Intenção pré */}
        <FormGroup label="INTENÇÃO (OPC, PRÉ-SESSÃO)">
          <input
            type="text"
            value={intencao}
            onChange={(e) => setIntencao(e.target.value)}
            placeholder="vou observar minha relação com X"
            maxLength={2000}
            style={inputStyle()}
          />
        </FormGroup>

        {/* Observação obrigatória */}
        <FormGroup label="OBSERVAÇÃO *">
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="fato específico, não sentimento vago. ex: 'noto rigidez pra começar tarefas, vontade de negociar'"
            rows={4}
            maxLength={5000}
            style={{ ...inputStyle(), resize: 'vertical', fontFamily: BODY, minHeight: 80 }}
            autoFocus
          />
        </FormGroup>

        {/* Hipótese */}
        <FormGroup label="HIPÓTESE (OPC)">
          <input
            type="text"
            value={hipotese}
            onChange={(e) => setHipotese(e.target.value)}
            placeholder="talvez porque Y"
            maxLength={2000}
            style={inputStyle()}
          />
        </FormGroup>

        {/* Tags — sem limite, com busca quando catálogo cresce.
            Selecionadas sempre visíveis (filtro preserva), pra não sumir
            de vista enquanto o usuário busca novas. */}
        <FormGroup label={`TAGS · ${selectedTagIds.size} SELECIONADAS`}>
          {tags.length === 0 ? (
            <span
              style={{
                fontSize: 11,
                color: 'var(--color-text-muted)',
                fontFamily: BODY,
                fontStyle: 'italic',
              }}
            >
              Nenhuma tag ativa. Adicione via botão TAGS no header.
            </span>
          ) : (
            <>
              {/* Busca — só mostra quando há mais de 6 tags pra não poluir */}
              {tags.length > 6 && (
                <input
                  type="text"
                  value={tagQuery}
                  onChange={(e) => setTagQuery(e.target.value)}
                  placeholder="buscar tag (nome, slug, descrição)…"
                  style={{
                    width: '100%',
                    background: 'var(--color-bg-primary)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)',
                    padding: '5px 10px',
                    fontFamily: BODY,
                    fontSize: 12,
                    outline: 'none',
                    marginBottom: 6,
                    letterSpacing: 0,
                  }}
                />
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {filteredTags.length === 0 ? (
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--color-text-muted)',
                      fontFamily: BODY,
                      fontStyle: 'italic',
                    }}
                  >
                    Nenhuma tag bate com "{tagQuery}".
                  </span>
                ) : (
                  filteredTags.map((t) => {
                    const selected = selectedTagIds.has(t.id)
                    const accent = t.cor ?? MIND_COR
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTag(t.id)}
                        className="hq-chamfer-bl"
                        style={{
                          background: selected ? accent : 'var(--color-bg-primary)',
                          border: selected
                            ? `1px solid ${accent}`
                            : '1px solid var(--color-border)',
                          color: selected ? '#000' : 'var(--color-text-secondary)',
                          padding: '3px 10px',
                          fontFamily: MONO,
                          fontSize: 11,
                          fontWeight: selected ? 700 : 500,
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                        }}
                        title={t.descricao ?? undefined}
                      >
                        {t.nome}
                      </button>
                    )
                  })
                )}
              </div>
            </>
          )}
        </FormGroup>

        {/* Path-working — intenção concatenada entre sessions. Salva em
            localStorage, próxima abertura do form puxa. Só no fluxo CREATE. */}
        {!isEdit && (
          <FormGroup label="INTENÇÃO PRÓXIMA SESSÃO (OPC)">
            <input
              type="text"
              value={nextIntent}
              onChange={(e) => setNextIntent(e.target.value)}
              placeholder="o que você quer observar da próxima vez?"
              maxLength={2000}
              style={inputStyle()}
            />
          </FormGroup>
        )}

        {error && (
          <div
            style={{
              color: 'var(--color-error)',
              fontSize: 12,
              padding: 'var(--space-2) var(--space-3)',
              border: '1px solid var(--color-danger-border)',
              background: 'var(--color-danger-bg)',
              marginTop: 'var(--space-2)',
              fontFamily: BODY,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            marginTop: 'var(--space-5)',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="hq-btn hq-btn--ghost"
            style={{ fontSize: 11, padding: '9px 18px' }}
          >
            CANCELAR
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="hq-btn hq-btn--primary"
            style={{ fontSize: 11, padding: '9px 22px' }}
          >
            {submitting ? 'SALVANDO…' : isEdit ? 'SALVAR' : 'REGISTRAR'}
          </button>
        </div>
        {/* hint: discrete prompt at bottom — won't hurt screen real estate */}
        <div
          style={{
            marginTop: 'var(--space-2)',
            fontSize: 10,
            color: 'var(--color-text-muted)',
            fontFamily: BODY,
            fontStyle: 'italic',
            textAlign: 'right',
          }}
        >
          tip: hipóteses são pontos a confirmar, não autoflagelo.
        </div>
      </form>
    </div>,
    document.body,
  )
}

/**
 * Cruzamento de dados — puxa últimos 7d de outros domains pra ajudar a
 * formar hipóteses informadas. Painel colapsável (default fechado) pra não
 * poluir o form da meditação que é o foco.
 *
 * Diferencial vs journaling app qualquer: a hipótese "talvez porque não
 * tiro folga" pode ser confrontada com dados objetivos do mesmo Hub.
 */
function ContextoRecente({
  dataRef,
  expanded,
  onToggle,
}: {
  dataRef: string
  expanded: boolean
  onToggle: () => void
}) {
  const { data: domains = [] } = useHealthDomains()
  const range = useMemo(() => {
    const to = new Date(`${dataRef}T00:00:00`)
    const from = new Date(to)
    from.setDate(from.getDate() - 6)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    return { from: fmt(from), to: fmt(to) }
  }, [dataRef])
  const { data: sonoRecs = [] } = useHealthRecords('sono', range)
  const { data: exRecs = [] } = useHealthRecords('exercicio', range)
  const { data: alimRecs = [] } = useHealthRecords('alimentacao', range)
  const { data: viciosRecs = [] } = useHealthRecords('vicios', range)

  // Resumos
  const sonoSummary = useMemo(() => {
    const horas = sonoRecs
      .map((r) => {
        const p = r.payload as Record<string, unknown>
        if (p.tipo === 'cochilo') return 0
        const hi = typeof p.hora_inicio === 'string' ? p.hora_inicio : ''
        const hf = typeof p.hora_fim === 'string' ? p.hora_fim : ''
        if (!hi || !hf) return 0
        const [h1, m1] = hi.split(':').map(Number)
        const [h2, m2] = hf.split(':').map(Number)
        let diff = h2 * 60 + m2 - (h1 * 60 + m1)
        if (diff < 0) diff += 24 * 60
        return diff / 60
      })
      .filter((h) => h > 0)
    if (horas.length === 0) return null
    const media = horas.reduce((a, b) => a + b, 0) / horas.length
    return `média ${media.toFixed(1)}h · ${horas.length}/7 noites registradas`
  }, [sonoRecs])

  const exSummary = useMemo(() => {
    if (exRecs.length === 0) return null
    const totMin = exRecs.reduce((acc, r) => {
      const d = (r.payload as Record<string, unknown>).duracao_min
      return acc + (typeof d === 'number' ? d : 0)
    }, 0)
    return `${exRecs.length} sessões · ${totMin}min totais`
  }, [exRecs])

  const alimSummary = useMemo(() => {
    if (alimRecs.length === 0) return null
    let sim = 0
    let parcial = 0
    let nao = 0
    let livre = 0
    for (const r of alimRecs) {
      const p = r.payload as Record<string, unknown>
      const refeicoes = (p as { refeicoes?: unknown }).refeicoes
      if (Array.isArray(refeicoes)) {
        for (const ref of refeicoes) {
          if (typeof ref !== 'object' || ref === null) continue
          const o = ref as Record<string, unknown>
          if (o.tipo === 'planned') {
            if (o.comeu === 'sim') sim++
            else if (o.comeu === 'parcial') parcial++
            else if (o.comeu === 'nao') nao++
          } else if (o.tipo === 'free') {
            livre++
          }
        }
      } else {
        if (p.comeu === true) sim++
        else if (p.comeu === false) nao++
      }
    }
    const total = sim + parcial + nao
    if (total === 0 && livre === 0) return null
    return `${sim}/${total} planejadas OK · ${livre} fora dieta`
  }, [alimRecs])

  const viciosSummary = useMemo(() => {
    if (viciosRecs.length === 0) return 'sem registros (limpo ou não logado)'
    let total = 0
    for (const r of viciosRecs) {
      const p = r.payload as Record<string, unknown>
      const eventos = p.eventos
      if (Array.isArray(eventos)) {
        total += eventos.length
      } else if (typeof p.quantidade === 'number') {
        total += p.quantidade
      }
    }
    return `${total} consumos · ${viciosRecs.length} registros`
  }, [viciosRecs])

  // Não mostra contexto pra domains que o user não tem
  const hasSono = domains.some((d) => d.slug === 'sono')
  const hasEx = domains.some((d) => d.slug === 'exercicio')
  const hasAlim = domains.some((d) => d.slug === 'alimentacao')
  const hasVicios = domains.some((d) => d.slug === 'vicios')

  return (
    <div
      style={{
        marginBottom: 'var(--space-3)',
        border: '1px dashed var(--color-divider)',
        padding: '8px 12px',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: 'var(--color-text-secondary)',
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        contexto recente (7d) — pra informar a hipótese
      </button>
      {expanded && (
        <div
          style={{
            marginTop: 8,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 8,
          }}
        >
          {hasSono && (
            <ContextoRow label="SONO" value={sonoSummary} />
          )}
          {hasEx && <ContextoRow label="EXERCÍCIO" value={exSummary} />}
          {hasAlim && <ContextoRow label="ALIMENTAÇÃO" value={alimSummary} />}
          {hasVicios && <ContextoRow label="VÍCIOS" value={viciosSummary} />}
        </div>
      )}
    </div>
  )
}

function ContextoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div
      style={{
        padding: '6px 10px',
        background: 'var(--color-bg-primary)',
        border: '1px solid var(--color-border)',
        fontFamily: MONO,
        fontSize: 11,
      }}
    >
      <div
        className="hq-tech-id"
        style={{ color: 'var(--color-text-muted)', marginBottom: 2 }}
      >
        {label}
      </div>
      <div
        style={{
          color: value ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          fontStyle: value ? 'normal' : 'italic',
          fontFamily: value ? MONO : BODY,
          letterSpacing: 0,
        }}
      >
        {value ?? 'sem dados'}
      </div>
    </div>
  )
}

function FormGroup({
  label,
  children,
  style,
}: {
  label: string
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div style={{ marginBottom: 'var(--space-3)', ...(style ?? {}) }}>
      <div className="hq-tech-label" style={{ fontSize: 9, marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function FormRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-3)' }}>{children}</div>
  )
}

function inputStyle(): React.CSSProperties {
  return {
    background: 'var(--color-bg-primary)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-primary)',
    padding: '8px 12px',
    fontFamily: MONO,
    fontSize: 13,
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
    colorScheme: 'dark',
  }
}
