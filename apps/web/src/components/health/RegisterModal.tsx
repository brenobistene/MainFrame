/**
 * Modal de criar/editar registro dentro de um domínio do Hub Health.
 *
 * Campos variam por template do domínio:
 *  - janela_qualidade (Sono): hora_inicio + hora_fim + qualidade + tipo
 *  - atividade_tipo (Exercício): item + duracao_min + intensidade
 *  - refeicao_2modos (Alimentação): item + comeu OU descricao livre
 *  - consumo_vontade (Vícios): item + quantidade + vontade
 *  - metrica_simples (Medidas): item + valor
 *  - evento_escala: escala 1-5
 *
 * Estética: vocabulário CP2077 do tronco — `hq-glass-elevated` + chamfer-cross
 * + grain, modal-in animação spring, overlay com fade+blur (`hq-animate-overlay-in`).
 * Header `// REGISTRAR · DOMÍNIO` em hq-tech-label, close em hq-icon-btn-bare.
 * Botões cancelar/salvar em `hq-btn--ghost` / `hq-btn--primary` (chrome —
 * não cor accent do domínio).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Plus, X } from 'lucide-react'

import {
  useCreateHealthRecord,
  useHealthItems,
  useHealthRecords,
  useUpdateHealthRecord,
} from '../../lib/health-queries'
import type {
  HealthDomain,
  HealthRecord,
  HealthRecordCreate,
  HealthRecordPayload,
  HealthTemplate,
} from '../../types'
import { MONO, formatDuration } from './tokens'
import { useNowHHMM } from './useNowHHMM'

interface Props {
  domain: HealthDomain
  cor: string
  onClose: () => void
  existing?: HealthRecord            // se passado, modal opera em modo edição
}

export default function RegisterModal({ domain, cor, onClose, existing }: Props) {
  const isEdit = existing !== undefined
  const { data: items = [] } = useHealthItems(domain.slug)
  const activeItems = items.filter((i) => !i.arquivado)
  const createRecord = useCreateHealthRecord()
  const updateRecord = useUpdateHealthRecord()

  const ep = (existing?.payload ?? {}) as HealthRecordPayload

  const [itemId, setItemId] = useState<number | null>(
    existing?.item_id ?? activeItems[0]?.id ?? null,
  )
  const [data, setData] = useState<string>(() => existing?.data ?? '')
  const [horario, setHorario] = useState<string>(existing?.horario ?? '')
  const [notas, setNotas] = useState<string>(existing?.notas ?? '')

  // Sono (janela_qualidade)
  const [horaInicio, setHoraInicio] = useState(
    typeof ep.hora_inicio === 'string' ? ep.hora_inicio : '23:00',
  )
  const [horaFim, setHoraFim] = useState(
    typeof ep.hora_fim === 'string' ? ep.hora_fim : '07:00',
  )
  const [qualidade, setQualidade] = useState<number | null>(
    typeof ep.qualidade === 'number' ? ep.qualidade : null,
  )
  const [tipo, setTipo] = useState<'noturno' | 'cochilo'>(
    ep.tipo === 'cochilo' ? 'cochilo' : 'noturno',
  )

  // Exercício
  const [duracaoMin, setDuracaoMin] = useState<number>(
    typeof ep.duracao_min === 'number' ? ep.duracao_min : 30,
  )
  const [intensidade, setIntensidade] = useState<number | null>(
    typeof ep.intensidade === 'number' ? ep.intensidade : null,
  )

  // Alimentação
  const [modoLivre, setModoLivre] = useState(
    isEdit ? existing!.item_id === null : false,
  )
  const [comeu, setComeu] = useState(typeof ep.comeu === 'boolean' ? ep.comeu : true)
  const [descricaoLivre, setDescricaoLivre] = useState(
    typeof ep.descricao === 'string' ? ep.descricao : '',
  )

  // Vícios — formato padrão (consumo_vontade)
  const [quantidade, setQuantidade] = useState<number>(
    typeof ep.quantidade === 'number' ? ep.quantidade : 0,
  )
  const [vontade, setVontade] = useState<number | null>(
    typeof ep.vontade === 'number' ? ep.vontade : null,
  )

  // Vícios — formato especial pro item "Cigarro": payload.eventos[] = lista
  // de horários (1 registro por dia, vários eventos dentro). Cada evento
  // pode ter `vontade` opcional (1-5) — registra o nível de urge daquele
  // cigarro específico.
  const [eventos, setEventos] = useState<Array<{ horario: string; vontade?: number }>>(() => {
    const ev = (ep as { eventos?: unknown }).eventos
    if (Array.isArray(ev)) {
      return ev
        .filter(
          (e): e is { horario: string; vontade?: unknown } =>
            typeof e === 'object' &&
            e !== null &&
            typeof (e as { horario?: unknown }).horario === 'string',
        )
        .map((e) => {
          const out: { horario: string; vontade?: number } = { horario: e.horario }
          const v = (e as { vontade?: unknown }).vontade
          if (typeof v === 'number') out.vontade = v
          return out
        })
    }
    return []
  })

  // Medidas
  const [valor, setValor] = useState<number>(
    typeof ep.valor === 'number' ? ep.valor : 0,
  )

  // Evento escala
  const [escala, setEscala] = useState<number>(
    typeof ep.escala === 'number' ? ep.escala : 3,
  )

  const needsItem = domain.usa_itens && domain.template !== 'refeicao_2modos'
  const noItemsAvailable = needsItem && activeItems.length === 0

  // ─── Modo Cigarro (consumo_vontade + item.nome ≈ "cigarro") ─────────────
  // 1 registro por dia, payload.eventos[] guarda horários individuais.
  // O modal carrega o registro do dia (se existir) pra append/edit em vez de
  // criar registros duplicados.
  const selectedItem = activeItems.find((i) => i.id === itemId)
  const isCigarroMode =
    domain.template === 'consumo_vontade' &&
    !!selectedItem &&
    isCigarroName(selectedItem.nome)

  const hhmm = useNowHHMM()

  // Lookup do registro existente daquele item+data, pra cigarro. Range 30d
  // reaproveita o cache da DomainPage (mesma query key).
  const lookupRange = useMemo(() => {
    const today = new Date()
    const from = new Date(today)
    from.setDate(today.getDate() - 29)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    return { from: fmt(from), to: fmt(today), limit: 500 }
  }, [])
  const { data: lookupRecords = [] } = useHealthRecords(
    domain.slug,
    lookupRange,
  )

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const effectiveData = data || todayIso

  // Registro do dia pra o item cigarro. Se em edit mode (`existing` setado)
  // já estamos editando ele — não precisa lookup.
  const cigarroDayRecord: HealthRecord | null = useMemo(() => {
    if (!isCigarroMode || isEdit) return null
    return (
      lookupRecords.find(
        (r) => r.item_id === itemId && r.data === effectiveData,
      ) ?? null
    )
  }, [isCigarroMode, isEdit, lookupRecords, itemId, effectiveData])

  // Quando descobre que há registro pré-existente, hidrata os eventos UMA
  // vez por record id. Depende só do `id` (stable), não da referência do
  // array (TanStack reemite arrays novas). Footgun de array-prop docs em
  // memory `feedback_prop_state_sync`.
  const [seededFromRecordId, setSeededFromRecordId] = useState<number | null>(
    null,
  )
  useEffect(() => {
    if (!cigarroDayRecord) return
    if (cigarroDayRecord.id === seededFromRecordId) return
    const ev = (cigarroDayRecord.payload as { eventos?: unknown }).eventos
    if (Array.isArray(ev)) {
      setEventos(
        ev
          .filter(
            (e): e is { horario: string; vontade?: unknown } =>
              typeof e === 'object' &&
              e !== null &&
              typeof (e as { horario?: unknown }).horario === 'string',
          )
          .map((e) => {
            const out: { horario: string; vontade?: number } = { horario: e.horario }
            const v = (e as { vontade?: unknown }).vontade
            if (typeof v === 'number') out.vontade = v
            return out
          }),
      )
    }
    setSeededFromRecordId(cigarroDayRecord.id)
  }, [cigarroDayRecord, seededFromRecordId])

  function buildPayload(): HealthRecordPayload {
    switch (domain.template as HealthTemplate) {
      case 'janela_qualidade':
        return {
          hora_inicio: horaInicio,
          hora_fim: horaFim,
          ...(qualidade !== null ? { qualidade } : {}),
          tipo,
        }
      case 'atividade_tipo':
        return {
          duracao_min: duracaoMin,
          ...(intensidade !== null ? { intensidade } : {}),
        }
      case 'refeicao_2modos':
        if (modoLivre) {
          return { descricao: descricaoLivre }
        }
        return { comeu }
      case 'consumo_vontade':
        if (isCigarroMode) {
          // Novo formato: eventos = lista de horários ordenados.
          // Cada evento pode ter `vontade` própria (1-5); preservada quando
          // setada. `vontade` no nível do registro continua existindo como
          // "vontade do dia" agregada.
          const sortedEventos = [...eventos]
            .filter((e) => /^\d{2}:\d{2}$/.test(e.horario))
            .sort((a, b) => a.horario.localeCompare(b.horario))
            .map((e) => {
              const out: { horario: string; vontade?: number } = { horario: e.horario }
              if (typeof e.vontade === 'number') out.vontade = e.vontade
              return out
            })
          return {
            eventos: sortedEventos,
            ...(vontade !== null ? { vontade } : {}),
          }
        }
        return {
          quantidade,
          ...(vontade !== null ? { vontade } : {}),
        }
      case 'metrica_simples':
        return { valor }
      case 'evento_escala':
        return { escala }
      default:
        return {}
    }
  }

  // Sugestão de data — pra sono noturno na manhã, "noite de" = ontem.
  const sugestedData = (() => {
    const now = new Date()
    const isSonoNoturno = domain.template === 'janela_qualidade' && tipo === 'noturno'
    if (isSonoNoturno && now.getHours() < 12) {
      const yesterday = new Date(now)
      yesterday.setDate(now.getDate() - 1)
      return yesterday.toISOString().slice(0, 10)
    }
    return now.toISOString().slice(0, 10)
  })()

  const isNoiteDe = domain.template === 'janela_qualidade' && tipo === 'noturno'
  const dataLabel = isNoiteDe ? 'NOITE DE' : 'DATA'

  // ─── Body builder (factor — usado por handleSubmit E pelo auto-save) ────
  function buildSubmitBody(): HealthRecordCreate {
    const finalData = data || sugestedData

    // Pra cigarro: horário do registro = último evento (sorted). Mantém
    // `horario` semanticamente útil pra display/ordenação downstream.
    let effectiveHorario: string | null = horario || null
    if (isCigarroMode && eventos.length > 0) {
      const sorted = [...eventos]
        .filter((ev) => /^\d{2}:\d{2}$/.test(ev.horario))
        .sort((a, b) => a.horario.localeCompare(b.horario))
      effectiveHorario = sorted[sorted.length - 1]?.horario ?? null
    }

    const body: HealthRecordCreate = {
      payload: buildPayload(),
      data: finalData,
      horario: effectiveHorario,
      ...(notas ? { notas } : { notas: null }),
    }
    if (domain.template === 'refeicao_2modos') {
      body.item_id = modoLivre ? null : itemId
    } else if (domain.usa_itens) {
      body.item_id = itemId
    }
    return body
  }

  // ─── Auto-save state (cigarro) ───────────────────────────────────────────
  // `savedRecordId` reflete "onde meu próximo save vai cair":
  //   - edit mode → existing.id
  //   - cigarro com lookup → cigarroDayRecord.id (sincronizado no useEffect)
  //   - sem registro ainda → null (POST cria; capturamos o id no onSuccess)
  const [savedRecordId, setSavedRecordId] = useState<number | null>(
    existing?.id ?? null,
  )
  useEffect(() => {
    if (cigarroDayRecord && savedRecordId !== cigarroDayRecord.id) {
      setSavedRecordId(cigarroDayRecord.id)
    }
  }, [cigarroDayRecord, savedRecordId])

  // Auto-save debounced no cigarro. Compara JSON dos eventos contra o
  // último estado persistido — pula a primeira reconciliação (hidratação).
  const lastPersistedEventosJsonRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isCigarroMode) return
    const json = JSON.stringify(eventos)
    // Primeira reconciliação: só registra estado atual, não salva.
    if (lastPersistedEventosJsonRef.current === null) {
      lastPersistedEventosJsonRef.current = json
      return
    }
    if (json === lastPersistedEventosJsonRef.current) return
    const timer = setTimeout(() => {
      const body = buildSubmitBody()
      if (savedRecordId !== null) {
        updateRecord.mutate(
          { id: savedRecordId, patch: body },
          {
            onSuccess: () => {
              lastPersistedEventosJsonRef.current = json
            },
          },
        )
      } else {
        createRecord.mutate(
          { domainSlug: domain.slug, body },
          {
            onSuccess: (created) => {
              setSavedRecordId(created.id)
              lastPersistedEventosJsonRef.current = json
            },
          },
        )
      }
    }, 400)
    return () => clearTimeout(timer)
    // Intencionalmente NÃO incluímos buildSubmitBody/updateRecord/createRecord/
    // savedRecordId nas deps: queremos refire só quando eventos mudam. As
    // outras refs são lidas na hora pela closure (sempre valor atual).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventos, isCigarroMode])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const body = buildSubmitBody()

    if (savedRecordId !== null) {
      updateRecord.mutate(
        { id: savedRecordId, patch: body },
        { onSuccess: onClose },
      )
    } else if (isCigarroMode && !isEdit && cigarroDayRecord) {
      // Fallback: lookup encontrou registro do dia mas savedRecordId ainda
      // não foi sincronizado pelo useEffect (race com submit muito rápido).
      updateRecord.mutate(
        { id: cigarroDayRecord.id, patch: body },
        { onSuccess: onClose },
      )
    } else if (isEdit) {
      updateRecord.mutate(
        { id: existing!.id, patch: body },
        { onSuccess: onClose },
      )
    } else {
      createRecord.mutate(
        { domainSlug: domain.slug, body },
        { onSuccess: onClose },
      )
    }
  }

  const submitting = createRecord.isPending || updateRecord.isPending
  const submitError = createRecord.error || updateRecord.error

  return (
    <div
      onClick={onClose}
      className="hq-animate-overlay-in"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="hq-glass-elevated hq-grain hq-animate-modal-in hq-chamfer-cross"
        style={{
          position: 'relative',
          padding: 'var(--space-5) var(--space-6)',
          minWidth: 520,
          maxWidth: 640,
          maxHeight: '88vh',
          overflowY: 'auto',
          color: 'var(--color-text-primary)',
          // Border-left dessaturada do domínio — único accent
          borderLeft: `2px solid ${cor}`,
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        {/* Hairline ice no topo */}
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
          <span
            className="hq-tech-label"
            style={{
              fontSize: 11,
              color: 'var(--color-ice-light)',
              letterSpacing: '0.28em',
            }}
          >
            {isEdit ? 'EDITAR' : 'REGISTRAR'}
          </span>
          <span
            className="hq-tech-id"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {domain.nome.toUpperCase()}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="hq-icon-btn-bare"
            style={{ marginLeft: 'auto', minWidth: 28, minHeight: 28, padding: 4 }}
            title="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Aviso "sem itens" */}
        {noItemsAvailable && (
          <div
            style={{
              background: 'var(--color-warning-bg)',
              border: '1px dashed var(--color-warning-border)',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 12,
              color: 'var(--color-warning)',
              marginBottom: 'var(--space-3)',
              fontFamily: 'var(--font-body)',
            }}
          >
            Nenhum item cadastrado em <strong>{domain.nome}</strong>. Use o
            botão "ITENS" pra cadastrar antes de registrar.
          </div>
        )}

        {/* Item picker */}
        {domain.usa_itens && activeItems.length > 0 && (
          <FormGroup label="ITEM">
            {domain.template === 'refeicao_2modos' && (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--color-text-secondary)',
                  marginRight: 'var(--space-3)',
                  marginBottom: 6,
                  fontFamily: 'var(--font-body)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={modoLivre}
                  onChange={(e) => setModoLivre(e.target.checked)}
                />
                fora da dieta (modo livre)
              </label>
            )}
            {!modoLivre && (
              <select
                value={itemId ?? ''}
                onChange={(e) =>
                  setItemId(e.target.value ? Number(e.target.value) : null)
                }
                style={inputStyle()}
                required
              >
                {activeItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.nome}
                    {it.unidade ? ` (${it.unidade})` : ''}
                    {it.horario_esperado ? ` · ${it.horario_esperado}` : ''}
                  </option>
                ))}
              </select>
            )}
          </FormGroup>
        )}

        {/* Campos por template */}
        {domain.template === 'janela_qualidade' && (
          <>
            <FormRow>
              <FormGroup label="HORA DORMIR" style={{ flex: 1 }}>
                <input
                  type="time"
                  value={horaInicio}
                  onChange={(e) => setHoraInicio(e.target.value)}
                  style={inputStyle()}
                  required
                />
              </FormGroup>
              <FormGroup label="HORA ACORDAR" style={{ flex: 1 }}>
                <input
                  type="time"
                  value={horaFim}
                  onChange={(e) => setHoraFim(e.target.value)}
                  style={inputStyle()}
                  required
                />
              </FormGroup>
              <FormGroup label="DURAÇÃO" style={{ flex: 1 }}>
                <div
                  style={{
                    background: 'var(--color-bg-primary)',
                    border: '1px solid var(--color-border)',
                    color: cor,
                    padding: '8px 12px',
                    fontFamily: MONO,
                    fontSize: 14,
                    fontWeight: 500,
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: 0,
                  }}
                >
                  {formatDuration(horaInicio, horaFim)}
                </div>
              </FormGroup>
            </FormRow>
            <FormRow>
              <FormGroup label="QUALIDADE (1-5)" style={{ flex: 1 }}>
                <ScalePicker value={qualidade} onChange={setQualidade} cor={cor} />
              </FormGroup>
              <FormGroup label="TIPO" style={{ flex: 1 }}>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as 'noturno' | 'cochilo')}
                  style={inputStyle()}
                >
                  <option value="noturno">noturno</option>
                  <option value="cochilo">cochilo</option>
                </select>
              </FormGroup>
            </FormRow>
          </>
        )}

        {domain.template === 'atividade_tipo' && (
          <FormRow>
            <FormGroup label="DURAÇÃO (MIN)" style={{ flex: 1 }}>
              <input
                type="number"
                min={0}
                value={duracaoMin}
                onChange={(e) => setDuracaoMin(Number(e.target.value))}
                style={inputStyle()}
                required
              />
            </FormGroup>
            <FormGroup label="INTENSIDADE (1-5)" style={{ flex: 1 }}>
              <ScalePicker value={intensidade} onChange={setIntensidade} cor={cor} />
            </FormGroup>
          </FormRow>
        )}

        {domain.template === 'refeicao_2modos' && (
          <>
            {modoLivre ? (
              <FormGroup label="DESCRIÇÃO">
                <input
                  type="text"
                  value={descricaoLivre}
                  onChange={(e) => setDescricaoLivre(e.target.value)}
                  placeholder="ex: hambúrguer com amigo"
                  style={inputStyle()}
                  required
                />
              </FormGroup>
            ) : (
              <FormGroup label="STATUS">
                <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                  <RadioOption
                    label="comi"
                    checked={comeu}
                    onChange={() => setComeu(true)}
                  />
                  <RadioOption
                    label="pulei"
                    checked={!comeu}
                    onChange={() => setComeu(false)}
                  />
                </div>
              </FormGroup>
            )}
          </>
        )}

        {domain.template === 'consumo_vontade' && !isCigarroMode && (
          <>
            <FormRow>
              <FormGroup label="QUANTIDADE" style={{ flex: 1 }}>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={quantidade}
                  onChange={(e) => setQuantidade(Number(e.target.value))}
                  style={inputStyle()}
                  required
                />
              </FormGroup>
              <FormGroup label="VONTADE (1-5)" style={{ flex: 1 }}>
                <ScalePicker value={vontade} onChange={setVontade} cor={cor} />
              </FormGroup>
            </FormRow>
            {/* Atalho: vontade sem consumo. Quantidade=0 + vontade>0 é
                registro ouro pra observar tendência sem zerar streak. */}
            {quantidade !== 0 && vontade !== null && (
              <button
                type="button"
                onClick={() => setQuantidade(0)}
                className="hq-btn"
                style={{
                  background: 'transparent',
                  border: `1px dashed ${cor}`,
                  color: cor,
                  padding: 'var(--space-2) var(--space-3)',
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  fontWeight: 500,
                  marginBottom: 'var(--space-3)',
                  width: '100%',
                  justifyContent: 'flex-start',
                }}
              >
                ↺ senti vontade mas não consumi (quantidade = 0)
              </button>
            )}
            {quantidade === 0 && vontade !== null && (
              <div
                style={{
                  fontSize: 10,
                  color: cor,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  marginBottom: 'var(--space-3)',
                  paddingLeft: 'var(--space-3)',
                  borderLeft: `2px solid ${cor}`,
                  paddingTop: 4,
                  paddingBottom: 4,
                  fontFamily: MONO,
                }}
              >
                vontade sem consumo · tendência captada
              </div>
            )}
          </>
        )}

        {domain.template === 'consumo_vontade' && isCigarroMode && (
          <>
            <CigarroEventsEditor
              eventos={eventos}
              onChange={setEventos}
              hhmm={hhmm}
              cor={cor}
            />
            <FormGroup label="VONTADE DO DIA (1-5, OPCIONAL)">
              <ScalePicker value={vontade} onChange={setVontade} cor={cor} />
            </FormGroup>
            {eventos.length === 0 && vontade !== null && (
              <div
                style={{
                  fontSize: 10,
                  color: cor,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  marginBottom: 'var(--space-3)',
                  paddingLeft: 'var(--space-3)',
                  borderLeft: `2px solid ${cor}`,
                  paddingTop: 4,
                  paddingBottom: 4,
                  fontFamily: MONO,
                }}
              >
                vontade sem consumo · tendência captada
              </div>
            )}
          </>
        )}

        {domain.template === 'metrica_simples' && (
          <FormGroup
            label={`VALOR${
              activeItems.find((i) => i.id === itemId)?.unidade
                ? ` (${activeItems.find((i) => i.id === itemId)!.unidade})`
                : ''
            }`}
          >
            <input
              type="number"
              step="any"
              value={valor}
              onChange={(e) => setValor(Number(e.target.value))}
              style={inputStyle()}
              required
            />
          </FormGroup>
        )}

        {domain.template === 'evento_escala' && (
          <FormGroup label="ESCALA (1-5)">
            <ScalePicker
              value={escala}
              onChange={(v) => v !== null && setEscala(v)}
              cor={cor}
            />
          </FormGroup>
        )}

        {/* Campos comuns: data + horário */}
        <FormRow>
          <FormGroup label={dataLabel} style={{ flex: 1 }}>
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              style={inputStyle()}
            />
            {!isEdit && !data && (
              <Hint>
                {isNoiteDe
                  ? `default: ${formatBR(sugestedData)} (calculado pela hora atual)`
                  : `default: ${formatBR(sugestedData)}`}
              </Hint>
            )}
          </FormGroup>
          {!isNoiteDe && !isCigarroMode && (
            <FormGroup label="HORÁRIO (OPCIONAL)" style={{ flex: 1 }}>
              <input
                type="time"
                value={horario}
                onChange={(e) => setHorario(e.target.value)}
                style={inputStyle()}
              />
            </FormGroup>
          )}
        </FormRow>

        <FormGroup label="NOTAS (OPCIONAL)">
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            style={{
              ...inputStyle(),
              resize: 'vertical',
              fontFamily: 'var(--font-body)',
              minHeight: 56,
            }}
          />
        </FormGroup>

        {submitError && (
          <div
            style={{
              color: 'var(--color-error)',
              fontSize: 12,
              marginTop: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              border: '1px solid var(--color-danger-border)',
              background: 'var(--color-danger-bg)',
              fontFamily: 'var(--font-body)',
            }}
          >
            {(submitError as Error).message}
          </div>
        )}

        {/* Footer com botões */}
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
            disabled={submitting || (!isEdit && noItemsAvailable)}
            className="hq-btn hq-btn--primary"
            style={{ fontSize: 11, padding: '9px 22px' }}
          >
            {submitting ? 'SALVANDO…' : isEdit ? 'SALVAR' : 'REGISTRAR'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Helpers visuais ──────────────────────────────────────────────────────

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
      <div
        className="hq-tech-label"
        style={{ fontSize: 9, marginBottom: 6 }}
      >
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

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        color: 'var(--color-text-muted)',
        marginTop: 4,
        fontStyle: 'italic',
        fontFamily: 'var(--font-body)',
        letterSpacing: 0,
      }}
    >
      {children}
    </div>
  )
}

function formatBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
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
  }
}

function RadioOption({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: 'var(--color-text-primary)',
        fontSize: 13,
        fontFamily: 'var(--font-body)',
        cursor: 'pointer',
      }}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
      />
      {label}
    </label>
  )
}

/**
 * Detecta se o nome do item corresponde a "Cigarro"/"Cigarros". Restrito a
 * essas variantes — não vaza pra outros vícios.
 */
function isCigarroName(nome: string): boolean {
  const n = nome.trim().toLowerCase()
  return n === 'cigarro' || n === 'cigarros'
}

type CigarroEvent = { horario: string; vontade?: number }

/**
 * Editor de eventos diários do cigarro.
 *
 * UX (em 1 visual):
 *   - Chips ordenados por horário. Entre chips consecutivos, marcador de
 *     gap (`→ 3h →`) — radar passivo do espaçamento sem cobrar nada.
 *   - Cada chip: horário editável inline + botão vontade (`v−`/`v3`) com
 *     popover de escala 1-5 + botão remover.
 *   - Adicionar: `AGORA · HH:MM` (primary) + atalhos relativos
 *     (`-30m`, `-1h`, `-2h`, `-3h`) + picker inline pra horário arbitrário
 *     que comita ao mudar (sem 2-step "abrir/confirmar").
 */
function CigarroEventsEditor({
  eventos,
  onChange,
  hhmm,
  cor,
}: {
  eventos: CigarroEvent[]
  onChange: (next: CigarroEvent[]) => void
  hhmm: string
  cor: string
}) {
  const [activeVontadeIdx, setActiveVontadeIdx] = useState<number | null>(null)

  // Click-outside fecha o popover. O próprio popover faz stopPropagation no
  // mousedown, então clicks dentro dele não disparam o close. Clicks no
  // botão `v−`/`vN` também propagam — mas o toggle do botão reabre depois,
  // resultado líquido: popover continua aberto. Pra clicks em qualquer
  // outra parte do documento, fecha.
  useEffect(() => {
    if (activeVontadeIdx === null) return
    const close = () => setActiveVontadeIdx(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [activeVontadeIdx])

  // Mantém índice original do array durante o sort — edit/remove usam
  // índice estável (sem ambiguidade quando dois eventos têm o mesmo horário).
  const sorted = eventos
    .map((e, i) => ({ ...e, _idx: i }))
    .sort((a, b) => a.horario.localeCompare(b.horario))

  function addAt(horario: string) {
    if (!/^\d{2}:\d{2}$/.test(horario)) return
    onChange([...eventos, { horario }])
  }
  function addManyAt(horarios: string[]) {
    const valid = horarios.filter((h) => /^\d{2}:\d{2}$/.test(h))
    if (valid.length === 0) return
    onChange([...eventos, ...valid.map((horario) => ({ horario }))])
  }
  function addRelative(minutesAgo: number) {
    const now = new Date()
    const t = new Date(now.getTime() - minutesAgo * 60000)
    addAt(timeOfDay(t))
  }
  function updateHorarioAt(originalIdx: number, novoHorario: string) {
    if (!/^\d{2}:\d{2}$/.test(novoHorario)) return
    onChange(
      eventos.map((e, k) =>
        k === originalIdx ? { ...e, horario: novoHorario } : e,
      ),
    )
  }
  function updateVontadeAt(originalIdx: number, novoVontade: number | null) {
    onChange(
      eventos.map((e, k) => {
        if (k !== originalIdx) return e
        if (novoVontade === null) {
          const { vontade: _v, ...rest } = e
          return rest
        }
        return { ...e, vontade: novoVontade }
      }),
    )
  }
  function removeAt(originalIdx: number) {
    onChange(eventos.filter((_, k) => k !== originalIdx))
    if (activeVontadeIdx === originalIdx) setActiveVontadeIdx(null)
  }

  // ─── Insight derivado: gap médio, primeiro/último ──────────────────────
  const insight = (() => {
    if (sorted.length === 0) return ''
    if (sorted.length === 1) return ` · às ${sorted[0].horario}`
    const totalMin = sorted.reduce((acc, ev, i) => {
      if (i === 0) return 0
      const [ah, am] = sorted[i - 1].horario.split(':').map(Number)
      const [bh, bm] = ev.horario.split(':').map(Number)
      return acc + (bh * 60 + bm - (ah * 60 + am))
    }, 0)
    const avgMin = Math.round(totalMin / (sorted.length - 1))
    const first = sorted[0].horario
    const last = sorted[sorted.length - 1].horario
    return ` · ${first}–${last} · médio ${formatMinutesShort(avgMin)}`
  })()

  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      <div
        className="hq-tech-label"
        style={{
          fontSize: 9,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span>CIGARROS NO DIA</span>
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {eventos.length}x{insight}
        </span>
      </div>

      {/* Mini-timeline 24h — barra horizontal com pontos por evento */}
      {sorted.length > 0 && (
        <Timeline24h events={sorted} cor={cor} />
      )}

      {/* Lista de horários com gap markers entre consecutivos */}
      {sorted.length === 0 ? (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            fontStyle: 'italic',
            fontFamily: 'var(--font-body)',
            padding: 'var(--space-2) 0',
          }}
        >
          nenhum cigarro registrado pra esse dia ainda.
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
            marginBottom: 'var(--space-2)',
            rowGap: 8,
          }}
        >
          {sorted.map((ev, i) => (
            <span
              key={ev._idx}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <CigarroChip
                horario={ev.horario}
                vontade={ev.vontade}
                cor={cor}
                vontadeOpen={activeVontadeIdx === ev._idx}
                onHorarioChange={(h) => updateHorarioAt(ev._idx, h)}
                onVontadeToggle={() =>
                  setActiveVontadeIdx(
                    activeVontadeIdx === ev._idx ? null : ev._idx,
                  )
                }
                onVontadeChange={(v) => {
                  updateVontadeAt(ev._idx, v)
                  setActiveVontadeIdx(null)
                }}
                onRemove={() => removeAt(ev._idx)}
              />
              {/* Gap marker até o próximo */}
              {i < sorted.length - 1 && (
                <GapMarker from={ev.horario} to={sorted[i + 1].horario} />
              )}
            </span>
          ))}
        </div>
      )}

      {/* Linha 1: AGORA primary + relativos */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <button
          type="button"
          onClick={() => addAt(hhmm)}
          className="hq-btn hq-btn--primary"
          style={{ fontSize: 11, padding: '7px 12px' }}
        >
          <Plus size={12} strokeWidth={2.5} />
          AGORA · {hhmm}
        </button>
        {[30, 60, 120, 180].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => addRelative(m)}
            className="hq-btn hq-btn--ghost"
            style={{ fontSize: 11, padding: '7px 10px' }}
            title={`Adicionar cigarro há ${m < 60 ? `${m}min` : `${m / 60}h`}`}
          >
            −{m < 60 ? `${m}m` : `${m / 60}h`}
          </button>
        ))}
      </div>

      {/* Linha 2: picker inline — comita ao mudar (sem botão "adicionar") */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <Clock size={11} color="var(--color-text-muted)" strokeWidth={2} />
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)' }}
        >
          OU HORÁRIO ESPECÍFICO
        </span>
        <input
          type="time"
          onChange={(e) => {
            if (/^\d{2}:\d{2}$/.test(e.target.value)) addAt(e.target.value)
          }}
          // Reset visual após adicionar — usamos key pra forçar remount.
          key={`picker-${eventos.length}`}
          style={{
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            padding: '4px 8px',
            fontFamily: MONO,
            fontSize: 12,
            outline: 'none',
            colorScheme: 'dark',
            width: 110,
          }}
          title="Selecione um horário pra adicionar — comita ao escolher"
        />
      </div>

      {/* Linha 3: bulk import — paste de horários separados por vírgula */}
      <BulkImportRow onImport={addManyAt} />
    </div>
  )
}

// ─── Chip individual de cigarro ───────────────────────────────────────────

function CigarroChip({
  horario,
  vontade,
  cor,
  vontadeOpen,
  onHorarioChange,
  onVontadeToggle,
  onVontadeChange,
  onRemove,
}: {
  horario: string
  vontade?: number
  cor: string
  vontadeOpen: boolean
  onHorarioChange: (h: string) => void
  onVontadeToggle: () => void
  onVontadeChange: (v: number | null) => void
  onRemove: () => void
}) {
  return (
    <span
      className="hq-chamfer-bl"
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: 'var(--color-bg-primary)',
        border: `1px solid ${cor}`,
        color: cor,
        padding: '2px 4px 2px 6px',
        fontFamily: MONO,
        fontSize: 12,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: 0,
      }}
    >
      <input
        type="time"
        value={horario}
        onChange={(e) => onHorarioChange(e.target.value)}
        style={{
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: cor,
          fontFamily: MONO,
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0,
          padding: '2px 0',
          width: 64,
          cursor: 'pointer',
          colorScheme: 'dark',
        }}
        title="Editar horário"
      />
      <button
        type="button"
        onClick={onVontadeToggle}
        className="hq-icon-btn-bare"
        style={{
          minWidth: 22,
          minHeight: 18,
          padding: '2px 4px',
          color: vontade !== undefined ? cor : 'var(--color-text-muted)',
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: 0,
          opacity: vontade !== undefined ? 1 : 0.6,
        }}
        title={vontade !== undefined ? `Vontade: ${vontade}/5` : 'Definir vontade'}
        aria-label="Definir vontade"
      >
        {vontade !== undefined ? `v${vontade}` : 'v−'}
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="hq-icon-btn-bare"
        style={{
          minWidth: 18,
          minHeight: 18,
          padding: 2,
          color: 'var(--color-text-muted)',
        }}
        aria-label="Remover este cigarro"
        title="Remover"
      >
        <X size={11} />
      </button>

      {vontadeOpen && (
        <VontadePopover
          value={vontade ?? null}
          cor={cor}
          onChange={onVontadeChange}
        />
      )}
    </span>
  )
}

// ─── Popover de vontade ───────────────────────────────────────────────────

function VontadePopover({
  value,
  cor,
  onChange,
}: {
  value: number | null
  cor: string
  onChange: (v: number | null) => void
}) {
  return (
    <div
      className="hq-chamfer-bl"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: 0,
        zIndex: 20,
        background: 'var(--color-bg-secondary)',
        border: `1px solid ${cor}`,
        padding: '6px 6px',
        display: 'flex',
        gap: 3,
        boxShadow: 'var(--shadow-modal)',
      }}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const active = value === n
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className="hq-chamfer-bl"
            style={{
              width: 26,
              height: 26,
              background: active ? cor : 'var(--color-bg-primary)',
              border: active
                ? `1px solid ${cor}`
                : '1px solid var(--color-border)',
              color: active ? '#000' : 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontFamily: MONO,
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {n}
          </button>
        )
      })}
      <button
        type="button"
        onClick={() => onChange(null)}
        title="Limpar"
        className="hq-chamfer-bl"
        style={{
          width: 26,
          height: 26,
          background: 'transparent',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          fontFamily: MONO,
          fontSize: 12,
        }}
      >
        ×
      </button>
    </div>
  )
}

// ─── Gap marker entre chips ───────────────────────────────────────────────

function GapMarker({ from, to }: { from: string; to: string }) {
  const gap = formatGap(from, to)
  if (!gap) return null
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.05em',
        color: 'var(--color-text-muted)',
        opacity: 0.7,
        whiteSpace: 'nowrap',
      }}
      title={`Intervalo: ${gap}`}
    >
      →{gap}→
    </span>
  )
}

function formatGap(a: string, b: string): string {
  const [ah, am] = a.split(':').map(Number)
  const [bh, bm] = b.split(':').map(Number)
  if ([ah, am, bh, bm].some((n) => Number.isNaN(n))) return ''
  const diff = bh * 60 + bm - (ah * 60 + am)
  if (diff <= 0) return ''
  if (diff < 60) return `${diff}m`
  const h = Math.floor(diff / 60)
  const m = diff % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

function timeOfDay(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatMinutesShort(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

// ─── Mini-timeline 24h ────────────────────────────────────────────────────

/**
 * Barra horizontal 0h→24h com ponto pra cada evento. Tick marks discretos
 * em 0/6/12/18. Visual passivo — só observação, sem clique. Cresce com a
 * largura do container (responsive).
 */
function Timeline24h({
  events,
  cor,
}: {
  events: Array<{ horario: string }>
  cor: string
}) {
  const height = 22
  const padX = 2
  const padY = 6
  return (
    <div
      style={{
        marginBottom: 10,
        position: 'relative',
      }}
    >
      <svg
        viewBox={`0 0 100 ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        {/* Baseline */}
        <line
          x1={padX}
          x2={100 - padX}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--color-border)"
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
        />
        {/* Ticks @ 0, 6, 12, 18, 24 */}
        {[0, 6, 12, 18, 24].map((h) => {
          const x = padX + ((100 - padX * 2) * h) / 24
          return (
            <line
              key={h}
              x1={x}
              x2={x}
              y1={padY}
              y2={height - padY}
              stroke="var(--color-text-muted)"
              strokeWidth={0.4}
              vectorEffect="non-scaling-stroke"
              opacity={0.5}
            />
          )
        })}
        {/* Pontos dos eventos */}
        {events.map((ev, i) => {
          const [h, m] = ev.horario.split(':').map(Number)
          if (Number.isNaN(h) || Number.isNaN(m)) return null
          const hr = h + m / 60
          const x = padX + ((100 - padX * 2) * hr) / 24
          return (
            <circle
              key={`${ev.horario}-${i}`}
              cx={x}
              cy={height / 2}
              r={1.6}
              fill={cor}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </svg>
      {/* Rótulos discretos pros ticks principais */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: MONO,
          fontSize: 8,
          color: 'var(--color-text-muted)',
          letterSpacing: '0.05em',
          marginTop: 1,
          padding: '0 2px',
          opacity: 0.6,
        }}
      >
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>24h</span>
      </div>
    </div>
  )
}

// ─── Bulk import (paste de horários) ──────────────────────────────────────

/**
 * Caixa pra colar/digitar `08:00, 11:30, 14:15` e importar de uma vez.
 * Separadores aceitos: vírgula, ponto-e-vírgula, espaço, quebra de linha.
 * Horários inválidos são silenciosamente ignorados.
 *
 * Começa colapsada — só revela ao clicar no link. UI subdiscreta pra não
 * competir com os atalhos principais (AGORA / relativos / picker).
 */
function BulkImportRow({
  onImport,
}: {
  onImport: (horarios: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')

  function parseAndImport() {
    const tokens = value
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    const valid = tokens.filter((t) => /^\d{1,2}:\d{2}$/.test(t)).map((t) => {
      // Normaliza pra HH:MM com zeros à esquerda (`8:00` → `08:00`)
      const [h, m] = t.split(':')
      return `${h.padStart(2, '0')}:${m}`
    })
    if (valid.length === 0) return
    onImport(valid)
    setValue('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hq-tech-id"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          padding: 0,
          textDecoration: 'underline dotted',
          textUnderlineOffset: 3,
        }}
        title="Colar lista de horários separados por vírgula"
      >
        IMPORTAR LISTA…
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span
        className="hq-tech-id"
        style={{ color: 'var(--color-text-muted)' }}
      >
        COLAR LISTA
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            parseAndImport()
          }
        }}
        placeholder="ex: 08:00, 11:30, 14:15"
        style={{
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-primary)',
          padding: '4px 8px',
          fontFamily: MONO,
          fontSize: 12,
          outline: 'none',
          flex: '1 1 220px',
          maxWidth: 280,
        }}
        autoFocus
      />
      <button
        type="button"
        onClick={parseAndImport}
        className="hq-btn hq-btn--primary"
        style={{ fontSize: 11, padding: '6px 10px' }}
      >
        IMPORTAR
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false)
          setValue('')
        }}
        className="hq-btn hq-btn--ghost"
        style={{ fontSize: 11, padding: '6px 10px' }}
      >
        CANCELAR
      </button>
    </div>
  )
}

/**
 * ScalePicker — 5 cells angulares pra rating 1-5. Cell ativa fica com
 * background na cor accent dessaturada do domínio + chamfer-bl sutil.
 * Última cell é "limpar" (×).
 */
function ScalePicker({
  value,
  onChange,
  cor,
}: {
  value: number | null
  onChange: (v: number | null) => void
  cor: string
}) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const active = value === n
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(active ? null : n)}
            className="hq-chamfer-bl"
            style={{
              flex: 1,
              background: active ? cor : 'var(--color-bg-primary)',
              border: active
                ? `1px solid ${cor}`
                : '1px solid var(--color-border)',
              color: active ? '#000' : 'var(--color-text-secondary)',
              padding: '8px 0',
              cursor: 'pointer',
              fontFamily: MONO,
              fontSize: 13,
              fontWeight: active ? 700 : 500,
              fontVariantNumeric: 'tabular-nums',
              transition: 'background var(--motion-fast) var(--ease-smooth), border-color var(--motion-fast) var(--ease-smooth)',
            }}
          >
            {n}
          </button>
        )
      })}
      <button
        type="button"
        onClick={() => onChange(null)}
        title="Limpar"
        className="hq-chamfer-bl"
        style={{
          background: 'transparent',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
          padding: '8px 12px',
          cursor: 'pointer',
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}
