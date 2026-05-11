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
import { useState } from 'react'
import { X } from 'lucide-react'

import {
  useCreateHealthRecord,
  useHealthItems,
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

  // Vícios
  const [quantidade, setQuantidade] = useState<number>(
    typeof ep.quantidade === 'number' ? ep.quantidade : 0,
  )
  const [vontade, setVontade] = useState<number | null>(
    typeof ep.vontade === 'number' ? ep.vontade : null,
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const finalData = data || sugestedData
    const body: HealthRecordCreate = {
      payload: buildPayload(),
      data: finalData,
      ...(horario ? { horario } : { horario: null }),
      ...(notas ? { notas } : { notas: null }),
    }
    if (domain.template === 'refeicao_2modos') {
      body.item_id = modoLivre ? null : itemId
    } else if (domain.usa_itens) {
      body.item_id = itemId
    }

    if (isEdit) {
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

        {domain.template === 'consumo_vontade' && (
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
          {!isNoiteDe && (
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
