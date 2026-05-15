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

  // Exercício multi-select (criação): permite registrar Cardio + Alongamento
  // de uma vez sem reabrir o modal. Cada atividade marcada vira 1 record
  // separado (preserva granularidade pra analytics).
  //
  // Campos opcionais hora_inicio/hora_fim por atividade — quando ambos
  // preenchidos, a duração é AUTO-CALCULADA do delta. Se você não souber
  // os horários, deixa em branco e digita só a duração.
  //
  // Edit mode: comportamento single-item antigo (acima); este map fica vazio.
  type AtividadeEntry = {
    duracao: number
    intensidade: number | null
    horaInicio: string                   // '' = não preenchido
    horaFim: string                      // '' = não preenchido
  }
  const [atividadesByItem, setAtividadesByItem] = useState<Map<number, AtividadeEntry>>(
    () => new Map(),
  )

  // Alimentação — formato AGRUPADO (1 record/dia, refeicoes[] no payload).
  // Eventos heterogêneos: planned (item + comeu tri-state) vs free (descricao + horario).
  // Substituiu o flow antigo (1 record por refeição com `comeu` ou `descricao`).
  const [refeicoes, setRefeicoes] = useState<Refeicao[]>(() =>
    migrateOrLoadRefeicoes(ep, existing?.item_id ?? null, existing?.horario ?? null),
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
  //
  // Migração suave: se o registro veio do formato legado ({quantidade: N}),
  // hidrata `eventos` com N placeholders no horário do registro (ou 12:00).
  // Usuário pode então ajustar os horários inline. Preserva a contagem
  // diária sem inventar horários precisos.
  const [eventos, setEventos] = useState<CigarroEvent[]>(() =>
    migrateOrLoadEventos(ep, existing?.horario ?? null),
  )

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

  // Em criação de Exercício, NÃO usa picker de item único — render multi-select
  // (checkbox por item) dentro do bloco do template. Edit mode mantém single.
  const isAtividadeMulti = domain.template === 'atividade_tipo' && !isEdit

  // Calcula minutos entre HH:MM de início e fim. Trata cross-midnight
  // somando 24h (improvável pra exercício, mas seguro). Retorna null se
  // input inválido ou incompleto.
  function diffHHMM(inicio: string, fim: string): number | null {
    const re = /^(\d{2}):(\d{2})$/
    const a = re.exec(inicio)
    const b = re.exec(fim)
    if (!a || !b) return null
    const aMin = parseInt(a[1], 10) * 60 + parseInt(a[2], 10)
    let bMin = parseInt(b[1], 10) * 60 + parseInt(b[2], 10)
    if (bMin < aMin) bMin += 24 * 60
    return bMin - aMin
  }

  // Defaults por item (Fase 5+ do exercício): pega o último record de cada
  // item dos últimos 30 dias e usa hora_inicio/hora_fim/duracao_min como
  // pré-preenchimento ao marcar o checkbox. Economiza digitação se você
  // segue uma rotina (cardio 7-8, musculação 18-19).
  // `lookupRecords` declarado mais abaixo — TS hoist OK porque usamos
  // dentro de função/useMemo, não no top level.

  // ─── Modo Agrupado de Alimentação (refeicao_2modos) ────────────────────
  // SEMPRE ativo pra esse template. Substituiu o flow legacy de 1 record/refeição.
  // Padrão simétrico ao cigarro: 1 record/dia, payload.refeicoes[] guarda eventos.
  const isRefeicoesAgrupado = domain.template === 'refeicao_2modos'

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

  // Pra exercício multi-select: último registro de cada item dos últimos
  // 30 dias, com hora_inicio/hora_fim/duracao_min/data pré-extraídos. Usado:
  //  - onChange do checkbox: pré-preenche horários habituais
  //  - hint sob o item não-marcado: "última: 07:00-07:40 · 2d atrás"
  type AtividadeDefault = {
    horaInicio: string
    horaFim: string
    duracao: number
    data: string                  // YYYY-MM-DD do último registro
  }
  const lastAtividadeByItem = useMemo(() => {
    const out = new Map<number, AtividadeDefault>()
    if (domain.template !== 'atividade_tipo') return out
    // Ordena por (data desc, horario desc) e fica com o primeiro de cada item
    const sorted = [...lookupRecords].sort((a, b) => {
      if (a.data !== b.data) return a.data < b.data ? 1 : -1
      const ah = a.horario ?? ''
      const bh = b.horario ?? ''
      if (ah !== bh) return ah < bh ? 1 : -1
      return 0
    })
    for (const r of sorted) {
      if (r.item_id == null) continue
      if (out.has(r.item_id)) continue
      const pl = (r.payload ?? {}) as Record<string, unknown>
      const hi = typeof pl.hora_inicio === 'string' ? pl.hora_inicio : ''
      const hf = typeof pl.hora_fim === 'string' ? pl.hora_fim : ''
      const d = typeof pl.duracao_min === 'number' ? pl.duracao_min : 30
      out.set(r.item_id, { horaInicio: hi, horaFim: hf, duracao: d, data: r.data })
    }
    return out
  }, [domain.template, lookupRecords])

  // "0d ago" pra label do hint. Conta diferença em dias civis ISO.
  function daysAgoLabel(isoData: string, refIso: string): string {
    const a = new Date(`${refIso}T00:00:00`).getTime()
    const b = new Date(`${isoData}T00:00:00`).getTime()
    const days = Math.max(0, Math.round((a - b) / 86400000))
    if (days === 0) return 'hoje'
    if (days === 1) return 'ontem'
    return `${days}d atrás`
  }

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

  // Registro agrupado do dia pra refeições. Diferente de cigarro: filtra pelos
  // records que JÁ ESTÃO no formato agrupado (item_id null + payload.refeicoes
  // array). Records legacy do dia ficam de fora — devem ser convertidos via
  // botão "MIGRAR" em Settings antes do uso normal.
  const refeicoesDayRecord: HealthRecord | null = useMemo(() => {
    if (!isRefeicoesAgrupado || isEdit) return null
    return (
      lookupRecords.find((r) => {
        if (r.data !== effectiveData) return false
        if (r.item_id !== null) return false
        const p = r.payload as { refeicoes?: unknown }
        return Array.isArray(p.refeicoes)
      }) ?? null
    )
  }, [isRefeicoesAgrupado, isEdit, lookupRecords, effectiveData])

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
    setEventos(
      migrateOrLoadEventos(
        cigarroDayRecord.payload as Record<string, unknown>,
        cigarroDayRecord.horario,
      ),
    )
    setSeededFromRecordId(cigarroDayRecord.id)
  }, [cigarroDayRecord, seededFromRecordId])

  // Hidratação simétrica pra refeições: ao descobrir agrupado do dia, carrega
  // refeicoes[]. Mesma proteção via id pra evitar re-hidratar quando user já
  // editou local.
  const [seededRefeicoesFromId, setSeededRefeicoesFromId] = useState<number | null>(null)
  useEffect(() => {
    if (!refeicoesDayRecord) return
    if (refeicoesDayRecord.id === seededRefeicoesFromId) return
    setRefeicoes(
      migrateOrLoadRefeicoes(
        refeicoesDayRecord.payload as Record<string, unknown>,
        refeicoesDayRecord.item_id,
        refeicoesDayRecord.horario,
      ),
    )
    setSeededRefeicoesFromId(refeicoesDayRecord.id)
  }, [refeicoesDayRecord, seededRefeicoesFromId])

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
        // Formato sempre agrupado agora. Sanitiza eventos antes de persistir:
        // free precisa de horario (fallback 12:00 se faltar); planned sem
        // horario fica sem horario mesmo (item.horario_esperado vira o anchor
        // implícito pra métricas).
        return {
          refeicoes: refeicoes.map((r) => {
            if (r.tipo === 'free') {
              return {
                tipo: 'free' as const,
                descricao: r.descricao,
                horario: /^\d{2}:\d{2}$/.test(r.horario) ? r.horario : '12:00',
              }
            }
            const out: RefeicaoPlanned = {
              tipo: 'planned',
              item_id: r.item_id,
              comeu: r.comeu,
            }
            if (r.horario && /^\d{2}:\d{2}$/.test(r.horario)) out.horario = r.horario
            return out
          }),
        }
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
              const out: CigarroEvent = { horario: e.horario }
              if (typeof e.vontade === 'number') out.vontade = e.vontade
              if (typeof e.nota === 'string' && e.nota.length > 0) out.nota = e.nota
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

    // Pra modos agrupados: horário do registro reflete o primeiro evento
    // (cigarro usa o último por convenção de "mais recente"; refeições usam
    // o primeiro pra refletir o início do dia). Mantém `horario` semântico
    // pra ordenação/display.
    let effectiveHorario: string | null = horario || null
    if (isCigarroMode && eventos.length > 0) {
      const sorted = [...eventos]
        .filter((ev) => /^\d{2}:\d{2}$/.test(ev.horario))
        .sort((a, b) => a.horario.localeCompare(b.horario))
      effectiveHorario = sorted[sorted.length - 1]?.horario ?? null
    } else if (isRefeicoesAgrupado && refeicoes.length > 0) {
      const horarios = refeicoes
        .map((r) => r.horario)
        .filter((h): h is string => typeof h === 'string' && /^\d{2}:\d{2}$/.test(h))
        .sort()
      effectiveHorario = horarios[0] ?? null
    }

    const body: HealthRecordCreate = {
      payload: buildPayload(),
      data: finalData,
      horario: effectiveHorario,
      ...(notas ? { notas } : { notas: null }),
    }
    if (domain.template === 'refeicao_2modos') {
      // Modo agrupado sempre: item_id do record é null (info está no payload).
      body.item_id = null
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
  useEffect(() => {
    if (refeicoesDayRecord && savedRecordId !== refeicoesDayRecord.id) {
      setSavedRecordId(refeicoesDayRecord.id)
    }
  }, [refeicoesDayRecord, savedRecordId])

  // Auto-save debounced no cigarro. Compara JSON dos eventos contra o
  // último estado persistido — pula a primeira reconciliação (hidratação).
  const lastPersistedEventosJsonRef = useRef<string | null>(null)
  const debounceTimerRef = useRef<number | null>(null)
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')

  // Executa o save imediatamente (sem debounce). Usado pelo timer normal e
  // pelo flush-on-close. Idempotente: se json já foi persistido, no-op.
  function runAutoSave(json: string) {
    setAutoSaveStatus('saving')
    const body = buildSubmitBody()
    const onDone = () => {
      lastPersistedEventosJsonRef.current = json
      setAutoSaveStatus('saved')
      window.setTimeout(() => {
        setAutoSaveStatus((s) => (s === 'saved' ? 'idle' : s))
      }, 1800)
    }
    const onErr = () => setAutoSaveStatus('error')
    if (savedRecordId !== null) {
      updateRecord.mutate(
        { id: savedRecordId, patch: body },
        { onSuccess: onDone, onError: onErr },
      )
    } else {
      createRecord.mutate(
        { domainSlug: domain.slug, body },
        {
          onSuccess: (created) => {
            setSavedRecordId(created.id)
            onDone()
          },
          onError: onErr,
        },
      )
    }
  }

  useEffect(() => {
    if (!isCigarroMode) return
    const json = JSON.stringify(eventos)
    // Primeira reconciliação: só registra estado atual, não salva.
    if (lastPersistedEventosJsonRef.current === null) {
      lastPersistedEventosJsonRef.current = json
      return
    }
    if (json === lastPersistedEventosJsonRef.current) return
    debounceTimerRef.current = window.setTimeout(() => {
      runAutoSave(json)
      debounceTimerRef.current = null
    }, 400)
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
    // Intencionalmente NÃO incluímos buildSubmitBody/updateRecord/createRecord/
    // savedRecordId nas deps: queremos refire só quando eventos mudam. As
    // outras refs são lidas na hora pela closure (sempre valor atual).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventos, isCigarroMode])

  // Auto-save pra refeições — espelha cigarro, em ref/timer próprios.
  const lastPersistedRefeicoesJsonRef = useRef<string | null>(null)
  const refeicoesDebounceTimerRef = useRef<number | null>(null)
  function runAutoSaveRefeicoes(json: string) {
    setAutoSaveStatus('saving')
    const body = buildSubmitBody()
    const onDone = () => {
      lastPersistedRefeicoesJsonRef.current = json
      setAutoSaveStatus('saved')
      window.setTimeout(() => {
        setAutoSaveStatus((s) => (s === 'saved' ? 'idle' : s))
      }, 1800)
    }
    const onErr = () => setAutoSaveStatus('error')
    if (savedRecordId !== null) {
      updateRecord.mutate(
        { id: savedRecordId, patch: body },
        { onSuccess: onDone, onError: onErr },
      )
    } else {
      createRecord.mutate(
        { domainSlug: domain.slug, body },
        {
          onSuccess: (created) => {
            setSavedRecordId(created.id)
            onDone()
          },
          onError: onErr,
        },
      )
    }
  }
  useEffect(() => {
    if (!isRefeicoesAgrupado) return
    const json = JSON.stringify(refeicoes)
    if (lastPersistedRefeicoesJsonRef.current === null) {
      lastPersistedRefeicoesJsonRef.current = json
      return
    }
    if (json === lastPersistedRefeicoesJsonRef.current) return
    refeicoesDebounceTimerRef.current = window.setTimeout(() => {
      runAutoSaveRefeicoes(json)
      refeicoesDebounceTimerRef.current = null
    }, 400)
    return () => {
      if (refeicoesDebounceTimerRef.current !== null) {
        clearTimeout(refeicoesDebounceTimerRef.current)
        refeicoesDebounceTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refeicoes, isRefeicoesAgrupado])

  // Flush-on-close: se o debounce está pendente OU eventos divergem do
  // último persistido, dispara o save imediatamente antes de fechar o modal.
  // Sem isso, fechar dentro da janela de 400ms perdia o cigarro.
  function handleClose() {
    if (isCigarroMode) {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      const json = JSON.stringify(eventos)
      if (
        lastPersistedEventosJsonRef.current !== null &&
        json !== lastPersistedEventosJsonRef.current
      ) {
        runAutoSave(json)
        // Mutation é fire-and-forget — TanStack continua após o unmount.
      }
    }
    if (isRefeicoesAgrupado) {
      if (refeicoesDebounceTimerRef.current !== null) {
        clearTimeout(refeicoesDebounceTimerRef.current)
        refeicoesDebounceTimerRef.current = null
      }
      const json = JSON.stringify(refeicoes)
      if (
        lastPersistedRefeicoesJsonRef.current !== null &&
        json !== lastPersistedRefeicoesJsonRef.current
      ) {
        runAutoSaveRefeicoes(json)
      }
    }
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Exercício multi-select: cria N records em paralelo (1 por item marcado).
    // Cada record reusa data/horario/notas globais; payload do template tem
    // duracao_min + intensidade por item.
    if (isAtividadeMulti) {
      if (atividadesByItem.size === 0) return
      const baseEffectiveHorario = horario || hhmm
      try {
        await Promise.all(
          Array.from(atividadesByItem.entries()).map(([id, entry]) => {
            // Duração final: auto-calc se ambos horários, senão valor digitado
            const autoDur = diffHHMM(entry.horaInicio, entry.horaFim)
            const duracaoFinal = autoDur !== null ? autoDur : entry.duracao
            // `horario` do record = inicio da atividade se preenchido,
            // senão usa o horário global do modal.
            const horarioFinal = entry.horaInicio || baseEffectiveHorario
            return createRecord.mutateAsync({
              domainSlug: domain.slug,
              body: {
                data: effectiveData,
                horario: horarioFinal,
                ...(notas ? { notas } : { notas: null }),
                item_id: id,
                payload: {
                  duracao_min: duracaoFinal,
                  ...(entry.intensidade !== null ? { intensidade: entry.intensidade } : {}),
                  ...(entry.horaInicio ? { hora_inicio: entry.horaInicio } : {}),
                  ...(entry.horaFim ? { hora_fim: entry.horaFim } : {}),
                },
              },
            })
          }),
        )
        onClose()
      } catch (err) {
        // Erro em qualquer create — preserva modal aberto pra retry.
        console.warn('[RegisterModal] atividade multi-create falhou:', err)
      }
      return
    }

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
      onClick={handleClose}
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
          width: 'min(640px, calc(100vw - 16px))',
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
            onClick={handleClose}
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

        {/* Item picker — escondido pra refeições agrupado (editor é por dia, não por item) */}
        {domain.usa_itens && activeItems.length > 0 && !isRefeicoesAgrupado && !isAtividadeMulti && (
          <FormGroup label="ITEM">
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

        {domain.template === 'atividade_tipo' && !isAtividadeMulti && (
          /* Edit mode: 1 item só (o existente) com seus campos */
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

        {isAtividadeMulti && (
          /* Criação: lista todos os items como checkboxes. Cada um marcado
             abre os campos duração + intensidade. Submit cria N records
             (1 por item marcado) em paralelo. */
          <FormGroup label="ATIVIDADES FEITAS">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activeItems.map((it) => {
                const entry = atividadesByItem.get(it.id)
                const checked = entry !== undefined
                return (
                  <div
                    key={it.id}
                    style={{
                      border: `1px solid ${checked ? cor : 'var(--color-border)'}`,
                      background: checked
                        ? 'rgba(255, 255, 255, 0.02)'
                        : 'transparent',
                      padding: '8px 12px',
                      display: 'flex', flexDirection: 'column', gap: 8,
                    }}
                  >
                    <label
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        cursor: 'pointer',
                        fontFamily: 'var(--font-display)',
                        fontSize: 13,
                        fontWeight: 500,
                        color: checked ? cor : 'var(--color-text-primary)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setAtividadesByItem((prev) => {
                            const next = new Map(prev)
                            if (e.target.checked) {
                              // Pré-preenche com o último registro do item se
                              // houver — economiza digitação de quem segue
                              // rotina (cardio 7-8, musculação 18-19, etc).
                              const last = lastAtividadeByItem.get(it.id)
                              next.set(it.id, {
                                duracao: last?.duracao ?? 30,
                                intensidade: null,
                                horaInicio: last?.horaInicio ?? '',
                                horaFim: last?.horaFim ?? '',
                              })
                            } else {
                              next.delete(it.id)
                            }
                            return next
                          })
                        }}
                        style={{ accentColor: cor }}
                      />
                      <span>{it.nome}</span>
                      {!checked && lastAtividadeByItem.has(it.id) && (() => {
                        // Hint do último registro — só pra itens não-marcados,
                        // pra contexto sem poluir o estado expandido.
                        const last = lastAtividadeByItem.get(it.id)!
                        const hasHoras = last.horaInicio && last.horaFim
                        const hint = hasHoras
                          ? `${last.horaInicio}–${last.horaFim}`
                          : last.horaInicio
                            ? last.horaInicio
                            : `${last.duracao}min`
                        return (
                          <span
                            style={{
                              marginLeft: 'auto',
                              fontFamily: MONO,
                              fontSize: 9,
                              color: 'var(--color-text-muted)',
                              letterSpacing: '0.14em',
                              textTransform: 'uppercase',
                              fontWeight: 500,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            última: {hint} · {daysAgoLabel(last.data, effectiveData)}
                          </span>
                        )
                      })()}
                    </label>
                    {checked && entry && (() => {
                      const autoDur = diffHHMM(entry.horaInicio, entry.horaFim)
                      const durDisplay = autoDur !== null ? autoDur : entry.duracao
                      return (
                        <>
                          <FormRow>
                            <FormGroup label="INÍCIO (opcional)" style={{ flex: 1 }}>
                              <input
                                type="time"
                                value={entry.horaInicio}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setAtividadesByItem((prev) => {
                                    const next = new Map(prev)
                                    const cur = next.get(it.id)!
                                    const upd = { ...cur, horaInicio: v }
                                    // Se ambos preenchidos, sincroniza duração
                                    const d = diffHHMM(upd.horaInicio, upd.horaFim)
                                    if (d !== null) upd.duracao = d
                                    next.set(it.id, upd)
                                    return next
                                  })
                                }}
                                style={inputStyle()}
                              />
                            </FormGroup>
                            <FormGroup label="FIM (opcional)" style={{ flex: 1 }}>
                              <input
                                type="time"
                                value={entry.horaFim}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setAtividadesByItem((prev) => {
                                    const next = new Map(prev)
                                    const cur = next.get(it.id)!
                                    const upd = { ...cur, horaFim: v }
                                    const d = diffHHMM(upd.horaInicio, upd.horaFim)
                                    if (d !== null) upd.duracao = d
                                    next.set(it.id, upd)
                                    return next
                                  })
                                }}
                                style={inputStyle()}
                              />
                            </FormGroup>
                          </FormRow>
                          <FormRow>
                            <FormGroup
                              label={
                                autoDur !== null
                                  ? 'DURAÇÃO (auto · MIN)'
                                  : 'DURAÇÃO (MIN)'
                              }
                              style={{ flex: 1 }}
                            >
                              <input
                                type="number"
                                min={0}
                                value={durDisplay}
                                onChange={(e) => {
                                  const v = Number(e.target.value)
                                  setAtividadesByItem((prev) => {
                                    const next = new Map(prev)
                                    next.set(it.id, { ...entry, duracao: v })
                                    return next
                                  })
                                }}
                                style={{
                                  ...inputStyle(),
                                  ...(autoDur !== null
                                    ? { opacity: 0.7, cursor: 'not-allowed' }
                                    : {}),
                                }}
                                disabled={autoDur !== null}
                                required={autoDur === null}
                              />
                            </FormGroup>
                            <FormGroup label="INTENSIDADE (1-5)" style={{ flex: 1 }}>
                              <ScalePicker
                                value={entry.intensidade}
                                onChange={(v) => {
                                  setAtividadesByItem((prev) => {
                                    const next = new Map(prev)
                                    next.set(it.id, { ...entry, intensidade: v })
                                    return next
                                  })
                                }}
                                cor={cor}
                              />
                            </FormGroup>
                          </FormRow>
                        </>
                      )
                    })()}
                  </div>
                )
              })}
              {atividadesByItem.size === 0 && (
                <div
                  style={{
                    padding: 8,
                    fontFamily: MONO,
                    fontSize: 10,
                    color: 'var(--color-text-muted)',
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                  }}
                >
                  marque ao menos 1 atividade
                </div>
              )}
            </div>
          </FormGroup>
        )}

        {domain.template === 'refeicao_2modos' && (
          <RefeicoesEditor
            refeicoes={refeicoes}
            onChange={setRefeicoes}
            items={activeItems}
            hhmm={hhmm}
            cor={cor}
            autoSaveStatus={autoSaveStatus}
            onRetry={() => runAutoSaveRefeicoes(JSON.stringify(refeicoes))}
          />
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
              autoSaveStatus={autoSaveStatus}
              onRetry={() => runAutoSave(JSON.stringify(eventos))}
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
          {!isNoiteDe && !isCigarroMode && !isRefeicoesAgrupado && !isAtividadeMulti && (
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
            onClick={handleClose}
            className="hq-btn hq-btn--ghost"
            style={{ fontSize: 11, padding: '9px 18px' }}
          >
            CANCELAR
          </button>
          <button
            type="submit"
            disabled={
              submitting ||
              (!isEdit && noItemsAvailable) ||
              (isAtividadeMulti && atividadesByItem.size === 0)
            }
            className="hq-btn hq-btn--primary"
            style={{ fontSize: 11, padding: '9px 22px' }}
          >
            {submitting
              ? 'SALVANDO…'
              : isAtividadeMulti
                ? atividadesByItem.size > 0
                  ? `REGISTRAR (${atividadesByItem.size} ${
                      atividadesByItem.size === 1 ? 'ATIVIDADE' : 'ATIVIDADES'
                    })`
                  : 'REGISTRAR'
                : isEdit ? 'SALVAR' : 'REGISTRAR'}
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

/**
 * Detecta se o nome do item corresponde a "Cigarro"/"Cigarros". Restrito a
 * essas variantes — não vaza pra outros vícios.
 */
// Vocabulário aceito pra detectar item cigarro. Espelha o set em DomainPage.
const CIGARRO_NAMES = new Set(['cigarro', 'cigarros', 'fumo', 'fumos'])

function isCigarroName(nome: string): boolean {
  return CIGARRO_NAMES.has(nome.trim().toLowerCase())
}

/**
 * Lê os eventos do payload, com migração suave do formato legado.
 *
 *   - Se `payload.eventos` é array válido: hidrata diretamente (preservando
 *     `vontade?` por evento).
 *   - Caso contrário, se `payload.quantidade` é número > 0: cria N
 *     placeholders no mesmo horário (do registro, ou 12:00 como fallback).
 *     Capped em 50 pra não estourar com valores absurdos.
 *   - Senão: array vazio.
 *
 * O usuário pode ajustar os horários dos placeholders inline — assim a
 * contagem diária do registro legado é preservada sem perder dados quando
 * o auto-save fizer o PATCH com o novo schema.
 */
function migrateOrLoadEventos(
  payload: Record<string, unknown>,
  recordHorario: string | null,
): CigarroEvent[] {
  const ev = (payload as { eventos?: unknown }).eventos
  if (Array.isArray(ev)) {
    return ev
      .filter(
        (e): e is { horario: string; vontade?: unknown; nota?: unknown } =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as { horario?: unknown }).horario === 'string',
      )
      .map((e) => {
        const out: CigarroEvent = { horario: e.horario }
        const v = (e as { vontade?: unknown }).vontade
        if (typeof v === 'number') out.vontade = v
        const n = (e as { nota?: unknown }).nota
        if (typeof n === 'string' && n.length > 0) out.nota = n
        return out
      })
  }
  const q = (payload as { quantidade?: unknown }).quantidade
  if (typeof q === 'number' && q > 0) {
    const baseHorario =
      typeof recordHorario === 'string' && /^\d{2}:\d{2}$/.test(recordHorario)
        ? recordHorario
        : '12:00'
    const count = Math.min(Math.floor(q), 50)
    return Array.from({ length: count }, () => ({ horario: baseHorario }))
  }
  return []
}

type CigarroEvent = { horario: string; vontade?: number; nota?: string }

// ─── Tipos de Refeição agrupada (refeicao_2modos novo formato) ──────────

type RefeicaoComeu = 'sim' | 'parcial' | 'nao'

type RefeicaoPlanned = {
  tipo: 'planned'
  item_id: number
  comeu: RefeicaoComeu
  horario?: string
}

type RefeicaoFree = {
  tipo: 'free'
  descricao: string
  horario: string
}

type Refeicao = RefeicaoPlanned | RefeicaoFree

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
  autoSaveStatus,
  onRetry,
}: {
  eventos: CigarroEvent[]
  onChange: (next: CigarroEvent[]) => void
  hhmm: string
  cor: string
  autoSaveStatus: 'idle' | 'saving' | 'saved' | 'error'
  onRetry: () => void
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
  function updateNotaAt(originalIdx: number, novaNota: string) {
    onChange(
      eventos.map((e, k) => {
        if (k !== originalIdx) return e
        const trimmed = novaNota.trim()
        if (trimmed === '') {
          const { nota: _n, ...rest } = e
          return rest
        }
        return { ...e, nota: trimmed.slice(0, 500) }
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
        <AutoSaveStatus status={autoSaveStatus} onRetry={onRetry} />
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
                nota={ev.nota}
                cor={cor}
                detailsOpen={activeVontadeIdx === ev._idx}
                onHorarioChange={(h) => updateHorarioAt(ev._idx, h)}
                onDetailsToggle={() =>
                  setActiveVontadeIdx(
                    activeVontadeIdx === ev._idx ? null : ev._idx,
                  )
                }
                onVontadeChange={(v) => updateVontadeAt(ev._idx, v)}
                onNotaChange={(n) => updateNotaAt(ev._idx, n)}
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
  nota,
  cor,
  detailsOpen,
  onHorarioChange,
  onDetailsToggle,
  onVontadeChange,
  onNotaChange,
  onRemove,
}: {
  horario: string
  vontade?: number
  nota?: string
  cor: string
  detailsOpen: boolean
  onHorarioChange: (h: string) => void
  onDetailsToggle: () => void
  onVontadeChange: (v: number | null) => void
  onNotaChange: (n: string) => void
  onRemove: () => void
}) {
  // Label do botão "detalhes": mostra vN quando set; sinaliza nota com `•`.
  // Indicador inline pra at-a-glance sem precisar abrir popover.
  const detailsLabel = (() => {
    if (vontade !== undefined && nota) return `v${vontade}•`
    if (vontade !== undefined) return `v${vontade}`
    if (nota) return 'n•'
    return 'v−'
  })()
  const hasDetails = vontade !== undefined || !!nota

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
        onClick={onDetailsToggle}
        className="hq-icon-btn-bare"
        style={{
          minWidth: 22,
          minHeight: 18,
          padding: '2px 4px',
          color: hasDetails ? cor : 'var(--color-text-muted)',
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: 0,
          opacity: hasDetails ? 1 : 0.6,
        }}
        title={
          hasDetails
            ? `Vontade${vontade !== undefined ? `: ${vontade}/5` : ''}${nota ? ' · com nota' : ''}`
            : 'Definir vontade ou nota'
        }
        aria-label="Detalhes do evento"
      >
        {detailsLabel}
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

      {detailsOpen && (
        <EventDetailsPopover
          vontade={vontade ?? null}
          nota={nota ?? ''}
          cor={cor}
          onVontadeChange={onVontadeChange}
          onNotaChange={onNotaChange}
        />
      )}
    </span>
  )
}

// ─── Popover de vontade ───────────────────────────────────────────────────

function EventDetailsPopover({
  vontade,
  nota,
  cor,
  onVontadeChange,
  onNotaChange,
}: {
  vontade: number | null
  nota: string
  cor: string
  onVontadeChange: (v: number | null) => void
  onNotaChange: (n: string) => void
}) {
  // Auto-flip pra direita quando popover passaria do viewport. Roda antes
  // do paint (useEffect síncrono no React 19 vs useLayoutEffect — usamos o
  // primeiro por ser suficiente e evitar warnings em SSR.)
  const ref = useRef<HTMLDivElement | null>(null)
  const [anchor, setAnchor] = useState<'left' | 'right'>('left')
  useEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    if (rect.right > window.innerWidth - 8) setAnchor('right')
  }, [])

  return (
    <div
      ref={ref}
      className="hq-chamfer-bl"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: anchor === 'left' ? 0 : 'auto',
        right: anchor === 'right' ? 0 : 'auto',
        zIndex: 20,
        background: 'var(--color-bg-secondary)',
        border: `1px solid ${cor}`,
        padding: '8px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        boxShadow: 'var(--shadow-modal)',
        minWidth: 220,
      }}
    >
      {/* Linha 1: scale de vontade + clear */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)', minWidth: 50 }}
        >
          VONTADE
        </span>
        <div style={{ display: 'flex', gap: 3 }}>
          {[1, 2, 3, 4, 5].map((n) => {
            const active = vontade === n
            return (
              <button
                key={n}
                type="button"
                onClick={() => onVontadeChange(n)}
                className="hq-chamfer-bl"
                style={{
                  width: 24,
                  height: 24,
                  background: active ? cor : 'var(--color-bg-primary)',
                  border: active
                    ? `1px solid ${cor}`
                    : '1px solid var(--color-border)',
                  color: active ? '#000' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontFamily: MONO,
                  fontSize: 11,
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
            onClick={() => onVontadeChange(null)}
            title="Limpar vontade"
            className="hq-chamfer-bl"
            style={{
              width: 24,
              height: 24,
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontFamily: MONO,
              fontSize: 11,
            }}
          >
            ×
          </button>
        </div>
      </div>
      {/* Linha 2: textarea de nota */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)' }}
        >
          NOTA (OPC, MÁX 500)
        </span>
        <textarea
          value={nota}
          onChange={(e) => onNotaChange(e.target.value)}
          placeholder="ex: após almoço, trabalho estressante…"
          maxLength={500}
          rows={2}
          style={{
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            padding: '6px 8px',
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            outline: 'none',
            resize: 'vertical',
            minHeight: 40,
            maxHeight: 120,
            width: '100%',
            boxSizing: 'border-box',
            letterSpacing: 0,
          }}
        />
      </div>
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

// ─── Refeições: helpers ──────────────────────────────────────────────────

/**
 * Lê o payload e devolve `refeicoes[]` no formato canônico. Suporta:
 *   1. Novo agrupado: `payload.refeicoes` array → carrega como veio
 *   2. Legado dieta: record com item_id + `payload.comeu` (bool) → 1 evento planned
 *   3. Legado livre: record com item_id=null + `payload.descricao` → 1 evento free
 *   4. Vazio → []
 *
 * Pra edit-mode de record legado, isso converte ele on-the-fly em 1 evento
 * agrupado. O save subsequente PATCHa o record com o novo formato (e item_id=null).
 */
function migrateOrLoadRefeicoes(
  payload: Record<string, unknown>,
  recordItemId: number | null,
  recordHorario: string | null,
): Refeicao[] {
  const refs = (payload as { refeicoes?: unknown }).refeicoes
  if (Array.isArray(refs)) {
    const out: Refeicao[] = []
    for (const r of refs) {
      if (typeof r !== 'object' || r === null) continue
      const tipo = (r as { tipo?: unknown }).tipo
      const horario = (r as { horario?: unknown }).horario
      if (tipo === 'planned') {
        const item_id = (r as { item_id?: unknown }).item_id
        const comeu = (r as { comeu?: unknown }).comeu
        if (typeof item_id !== 'number') continue
        if (comeu !== 'sim' && comeu !== 'parcial' && comeu !== 'nao') continue
        const planned: RefeicaoPlanned = { tipo: 'planned', item_id, comeu }
        if (typeof horario === 'string' && /^\d{2}:\d{2}$/.test(horario)) {
          planned.horario = horario
        }
        out.push(planned)
      } else if (tipo === 'free') {
        const descricao = (r as { descricao?: unknown }).descricao
        if (typeof descricao !== 'string' || !descricao.trim()) continue
        const h =
          typeof horario === 'string' && /^\d{2}:\d{2}$/.test(horario)
            ? horario
            : '12:00'
        out.push({ tipo: 'free', descricao: descricao.trim(), horario: h })
      }
    }
    return out
  }
  // Legado: 1 record = 1 refeição. Converte em 1 evento agrupado.
  if (recordItemId !== null) {
    const comeu_bool = (payload as { comeu?: unknown }).comeu
    const comeu: RefeicaoComeu = comeu_bool === false ? 'nao' : 'sim'
    const planned: RefeicaoPlanned = {
      tipo: 'planned',
      item_id: recordItemId,
      comeu,
    }
    if (recordHorario && /^\d{2}:\d{2}$/.test(recordHorario)) {
      planned.horario = recordHorario
    }
    return [planned]
  }
  const descricao = (payload as { descricao?: unknown }).descricao
  if (typeof descricao === 'string' && descricao.trim()) {
    const h =
      typeof recordHorario === 'string' && /^\d{2}:\d{2}$/.test(recordHorario)
        ? recordHorario
        : '12:00'
    return [{ tipo: 'free', descricao: descricao.trim(), horario: h }]
  }
  return []
}

// ─── RefeicoesEditor — checklist + fora dieta ────────────────────────────

/**
 * Editor do dia pra refeições agrupadas.
 *
 * Estrutura:
 *   - Bloco PLANEJADAS: lista os items ativos do domain. Cada linha tem 3
 *     botões tri-state (SIM / PARCIAL / NÃO). Clicar adiciona/atualiza evento.
 *     Re-clicar o estado ativo remove (volta pra pendente).
 *   - Bloco FORA DIETA: linhas com horário + descrição. Botão `+ ADICIONAR`
 *     mostra inputs inline; commitar adiciona evento.
 *
 * Header insight: contagem + % adesão derivada dos eventos.
 * Status indicator igual cigarro: auto-save status com botão de retry no erro.
 */
function RefeicoesEditor({
  refeicoes,
  onChange,
  items,
  hhmm,
  cor,
  autoSaveStatus,
  onRetry,
}: {
  refeicoes: Refeicao[]
  onChange: (next: Refeicao[]) => void
  items: import('../../types').HealthItem[]
  hhmm: string
  cor: string
  autoSaveStatus: 'idle' | 'saving' | 'saved' | 'error'
  onRetry: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [addHorario, setAddHorario] = useState(hhmm)
  const [addDescricao, setAddDescricao] = useState('')

  const plannedItems = items // já filtrado pra ativos no callsite
  const plannedEvents = refeicoes.filter(
    (r): r is RefeicaoPlanned => r.tipo === 'planned',
  )
  const freeEvents = refeicoes.filter(
    (r): r is RefeicaoFree => r.tipo === 'free',
  )

  function findPlannedForItem(itemId: number): RefeicaoPlanned | undefined {
    return plannedEvents.find((e) => e.item_id === itemId)
  }

  function setPlanned(itemId: number, comeu: RefeicaoComeu | null) {
    const existing = findPlannedForItem(itemId)
    if (comeu === null) {
      // Remove
      onChange(
        refeicoes.filter((r) => !(r.tipo === 'planned' && r.item_id === itemId)),
      )
      return
    }
    // Horário só faz sentido quando houve consumo (sim/parcial). Em 'nao',
    // não há instante a registrar — strip o horário se mudar pra 'nao'.
    if (existing) {
      onChange(
        refeicoes.map((r) => {
          if (r.tipo === 'planned' && r.item_id === itemId) {
            if (comeu === 'nao') {
              const { horario: _h, ...rest } = r
              return { ...rest, comeu } as RefeicaoPlanned
            }
            const next: RefeicaoPlanned = { ...r, comeu }
            if (!next.horario) next.horario = hhmm
            return next
          }
          return r
        }),
      )
    } else {
      const novo: RefeicaoPlanned = { tipo: 'planned', item_id: itemId, comeu }
      if (comeu !== 'nao') novo.horario = hhmm
      onChange([...refeicoes, novo])
    }
  }

  function updatePlannedHorario(itemId: number, horario: string) {
    if (!/^\d{2}:\d{2}$/.test(horario)) return
    onChange(
      refeicoes.map((r) =>
        r.tipo === 'planned' && r.item_id === itemId ? { ...r, horario } : r,
      ),
    )
  }

  function addFree() {
    const desc = addDescricao.trim()
    if (!desc) return
    if (!/^\d{2}:\d{2}$/.test(addHorario)) return
    onChange([
      ...refeicoes,
      { tipo: 'free', descricao: desc, horario: addHorario },
    ])
    setAddDescricao('')
    setAddHorario(hhmm)
    setAdding(false)
  }

  function updateFreeHorario(idxInFree: number, horario: string) {
    if (!/^\d{2}:\d{2}$/.test(horario)) return
    let freeSeen = -1
    onChange(
      refeicoes.map((r) => {
        if (r.tipo !== 'free') return r
        freeSeen++
        return freeSeen === idxInFree ? { ...r, horario } : r
      }),
    )
  }

  function updateFreeDescricao(idxInFree: number, descricao: string) {
    let freeSeen = -1
    onChange(
      refeicoes.map((r) => {
        if (r.tipo !== 'free') return r
        freeSeen++
        return freeSeen === idxInFree
          ? { ...r, descricao: descricao.slice(0, 200) }
          : r
      }),
    )
  }

  function removeFree(idxInFree: number) {
    let freeSeen = -1
    onChange(
      refeicoes.filter((r) => {
        if (r.tipo !== 'free') return true
        freeSeen++
        return freeSeen !== idxInFree
      }),
    )
  }

  // Insight: contagem + adesão (sim=1, parcial=0.5, nao=0)
  const sim = plannedEvents.filter((e) => e.comeu === 'sim').length
  const parcial = plannedEvents.filter((e) => e.comeu === 'parcial').length
  const nao = plannedEvents.filter((e) => e.comeu === 'nao').length
  const denom = plannedItems.length
  const pct = denom > 0
    ? Math.round(((sim + parcial * 0.5) / denom) * 100)
    : 0

  const insight = denom > 0
    ? ` · ${sim + parcial}/${denom} OK · ${pct}% adesão`
    : ''

  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      {/* Header */}
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
        <span>PLANEJADAS</span>
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {sim} SIM · {parcial} PARCIAL · {nao} NÃO · {denom - sim - parcial - nao} PENDENTE{insight}
        </span>
        <AutoSaveStatus status={autoSaveStatus} onRetry={onRetry} />
      </div>

      {/* Lista planejadas */}
      {plannedItems.length === 0 ? (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            fontStyle: 'italic',
            fontFamily: 'var(--font-body)',
            padding: 'var(--space-2) 0',
          }}
        >
          nenhum item cadastrado. cadastre refeições planejadas em ITENS.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 'var(--space-3)' }}>
          {plannedItems.map((it) => {
            const ev = findPlannedForItem(it.id)
            return (
              <PlannedRow
                key={it.id}
                item={it}
                event={ev}
                cor={cor}
                onSetComeu={(c) => setPlanned(it.id, c)}
                onHorarioChange={(h) => updatePlannedHorario(it.id, h)}
              />
            )
          })}
        </div>
      )}

      {/* Header fora dieta */}
      <div
        className="hq-tech-label"
        style={{
          fontSize: 9,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          marginTop: 'var(--space-2)',
        }}
      >
        <span>FORA DIETA</span>
        <span
          className="hq-tech-id"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {freeEvents.length}
        </span>
      </div>

      {/* Lista fora dieta */}
      {freeEvents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
          {freeEvents.map((ev, idx) => (
            <FreeRow
              key={idx}
              horario={ev.horario}
              descricao={ev.descricao}
              cor={cor}
              onHorarioChange={(h) => updateFreeHorario(idx, h)}
              onDescricaoChange={(d) => updateFreeDescricao(idx, d)}
              onRemove={() => removeFree(idx)}
            />
          ))}
        </div>
      )}

      {/* Adicionar fora dieta */}
      {adding ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="time"
            value={addHorario}
            onChange={(e) => setAddHorario(e.target.value)}
            style={{
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              padding: '4px 8px',
              fontFamily: MONO,
              fontSize: 12,
              outline: 'none',
              colorScheme: 'dark',
            }}
          />
          <input
            type="text"
            value={addDescricao}
            onChange={(e) => setAddDescricao(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addFree()
              }
            }}
            placeholder="ex: bolo no aniversário"
            maxLength={200}
            autoFocus
            style={{
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              padding: '4px 8px',
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              outline: 'none',
              flex: '1 1 220px',
              maxWidth: 320,
            }}
          />
          <button
            type="button"
            onClick={addFree}
            className="hq-btn hq-btn--primary"
            style={{ fontSize: 11, padding: '6px 10px' }}
          >
            ADICIONAR
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false)
              setAddDescricao('')
            }}
            className="hq-btn hq-btn--ghost"
            style={{ fontSize: 11, padding: '6px 10px' }}
          >
            CANCELAR
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true)
            setAddHorario(hhmm)
          }}
          className="hq-btn hq-btn--ghost"
          style={{ fontSize: 11, padding: '7px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Plus size={12} strokeWidth={2} /> ADICIONAR FORA DIETA
        </button>
      )}
    </div>
  )
}

function PlannedRow({
  item,
  event,
  cor,
  onSetComeu,
  onHorarioChange,
}: {
  item: import('../../types').HealthItem
  event?: RefeicaoPlanned
  cor: string
  onSetComeu: (c: RefeicaoComeu | null) => void
  onHorarioChange: (h: string) => void
}) {
  const active = event?.comeu ?? null

  const opcoes: Array<{ valor: RefeicaoComeu; label: string }> = [
    { valor: 'sim', label: 'SIM' },
    { valor: 'parcial', label: 'PARCIAL' },
    { valor: 'nao', label: 'NÃO' },
  ]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '4px 0',
        fontFamily: MONO,
        fontSize: 12,
      }}
    >
      {/* Nome do item */}
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 12,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: active ? cor : 'var(--color-text-secondary)',
          minWidth: 120,
        }}
      >
        {item.nome}
      </span>

      {/* Horário esperado */}
      <span
        className="hq-tech-id"
        style={{ color: 'var(--color-text-muted)', minWidth: 50 }}
      >
        {item.horario_esperado ?? '—'}
      </span>

      {/* Tri-state buttons com palette semântica (traffic-light dessaturado):
          - SIM     → cor do domínio (verde alimentação, success natural)
          - PARCIAL → `--color-warning` (gold dim) — estado intermediário,
                      ecoa "ausência" do PendingPanel
          - NÃO     → `--color-error` (red dessaturado) — negativo categórico
          Tudo em fundo escuro com texto preto no ativo, mantendo o vocabulário
          existente de delete/danger no resto do app. */}
      <div style={{ display: 'flex', gap: 3 }}>
        {opcoes.map((o) => {
          const isActive = active === o.valor
          const accent =
            o.valor === 'nao'
              ? 'var(--color-error)'
              : o.valor === 'parcial'
                ? 'var(--color-warning)'
                : cor
          return (
            <button
              key={o.valor}
              type="button"
              onClick={() => onSetComeu(isActive ? null : o.valor)}
              className="hq-chamfer-bl"
              style={{
                background: isActive ? accent : 'var(--color-bg-primary)',
                border: isActive
                  ? `1px solid ${accent}`
                  : '1px solid var(--color-border)',
                color: isActive ? '#000' : 'var(--color-text-secondary)',
                cursor: 'pointer',
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: isActive ? 700 : 500,
                letterSpacing: '0.15em',
                padding: '4px 8px',
              }}
            >
              {o.label}
            </button>
          )
        })}
      </div>

      {/* Horário real do evento — só faz sentido pra sim/parcial.
          `nao` significa "não comi" → sem instante a registrar. */}
      {event?.horario && event.comeu !== 'nao' && (
        <input
          type="time"
          value={event.horario}
          onChange={(e) => onHorarioChange(e.target.value)}
          style={{
            background: 'transparent',
            border: '1px dashed var(--color-border)',
            color: cor,
            fontFamily: MONO,
            fontSize: 11,
            padding: '2px 4px',
            width: 70,
            outline: 'none',
            colorScheme: 'dark',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: 0,
          }}
          title="Horário real (editar)"
        />
      )}
    </div>
  )
}

function FreeRow({
  horario,
  descricao,
  cor,
  onHorarioChange,
  onDescricaoChange,
  onRemove,
}: {
  horario: string
  descricao: string
  cor: string
  onHorarioChange: (h: string) => void
  onDescricaoChange: (d: string) => void
  onRemove: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 0',
      }}
    >
      <input
        type="time"
        value={horario}
        onChange={(e) => onHorarioChange(e.target.value)}
        style={{
          background: 'var(--color-bg-primary)',
          border: `1px solid ${cor}`,
          color: cor,
          padding: '3px 6px',
          fontFamily: MONO,
          fontSize: 11,
          outline: 'none',
          colorScheme: 'dark',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0,
          width: 70,
        }}
      />
      <input
        type="text"
        value={descricao}
        onChange={(e) => onDescricaoChange(e.target.value)}
        maxLength={200}
        style={{
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-primary)',
          padding: '3px 6px',
          fontFamily: 'var(--font-body)',
          fontSize: 12,
          outline: 'none',
          flex: 1,
          minWidth: 180,
        }}
      />
      <button
        type="button"
        onClick={onRemove}
        className="hq-icon-btn-bare"
        style={{ minWidth: 22, minHeight: 22, padding: 2, color: 'var(--color-text-muted)' }}
        aria-label="Remover"
        title="Remover"
      >
        <X size={12} />
      </button>
    </div>
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

// ─── Indicador de auto-save ──────────────────────────────────────────────

/**
 * Tag discreta no header do editor que reflete o estado do auto-save:
 *   - 'idle'    → nada
 *   - 'saving'  → `⋯ SALVANDO`  (text-muted)
 *   - 'saved'   → `✓ SALVO`      (color-success-ish — usamos cor accent neutra)
 *   - 'error'   → `⚠ ERRO`       (color-error)
 *
 * O fade saved→idle é feito no parent via setTimeout — aqui só renderiza.
 */
function AutoSaveStatus({
  status,
  onRetry,
}: {
  status: 'idle' | 'saving' | 'saved' | 'error'
  onRetry: () => void
}) {
  if (status === 'idle') return null
  if (status === 'error') {
    // Clicável: refire o último save com o estado atual.
    return (
      <button
        type="button"
        onClick={onRetry}
        className="hq-tech-id"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: 'var(--color-error)',
          letterSpacing: '0.18em',
          cursor: 'pointer',
          textDecoration: 'underline dotted',
          textUnderlineOffset: 3,
        }}
        title="Tentar salvar novamente"
      >
        · ⚠ ERRO · TENTAR DE NOVO
      </button>
    )
  }
  const map = {
    saving: { label: '⋯ SALVANDO', color: 'var(--color-text-muted)' },
    saved: { label: '✓ SALVO', color: 'var(--color-ice-light)' },
  } as const
  const { label, color } = map[status]
  return (
    <span
      className="hq-tech-id"
      style={{
        color,
        letterSpacing: '0.18em',
        transition: 'opacity var(--motion-fast) var(--ease-smooth)',
      }}
    >
      · {label}
    </span>
  )
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
