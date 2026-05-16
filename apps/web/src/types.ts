/**
 * Project — container estratégico. Agrupa deliverables e quests.
 * Antes da refatoração, projetos eram quests com parent_id=null; agora
 * são entidade própria (tabela `projects`). Hierarquia explícita:
 *
 *   Área > Projeto > Entregável > Quest
 */
export interface Project {
  id: string
  title: string
  area_slug: string
  status: string
  priority: string
  deadline: string | null
  /** Anotações longas em formato BlockNote (JSON serializado). */
  notes: string | null
  calendar_event_id: string | null
  completed_at: string | null
  /** ISO quando projeto foi arquivado (gaveta). Null = ativo. */
  archived_at: string | null
  sort_order: number
  /** Valor cobrado/acordado do projeto (BRL). Null = projeto não-monetizado
   *  (estudo, área Trabalho fixa, hobby). Hub Finance usa pra calcular
   *  R$/hora estimado contra o tempo total trabalhado nas quests. */
  valor_acordado: number | null
  /** Template informativo da forma de pagamento — só pra UI lembrar qual
   *  template foi aplicado por último. Validações: 'a_vista' | '50_50' |
   *  'parcelado_3x' | 'parcelado_4x' | 'custom'. */
  forma_pagamento_template: string | null
  /** Cliente vinculado (FK pra fin_client). Habilita auto-vínculo de
   *  receita por CPF/CNPJ na descrição da transação. */
  cliente_id: string | null
}

export interface FinClient {
  id: string
  nome: string
  cpf_cnpj: string | null
  notas: string | null
  sort_order: number
}

export type FinInvoiceStatus = 'aberta' | 'fechada' | 'paga' | 'atrasada'

export interface FinInvoice {
  id: string
  cartao_id: string
  /** YYYY-MM (mês de referência da fatura — quando ela vai/foi paga). */
  mes_referencia: string
  data_fechamento: string | null
  data_vencimento: string | null
  data_pagamento: string | null
  status: FinInvoiceStatus
  /** Soma absoluta das compras vinculadas (computado pelo backend). */
  total: number
  transacoes_count: number
}

export interface FinFreelaProject {
  id: string
  title: string
  status: string
  valor_acordado: number | null
  cliente_id: string | null
  cliente_nome: string | null
  forma_pagamento_template: string | null
  horas_trabalhadas: number
  valor_pago: number
  valor_a_receber: number
  parcelas_total: number
  parcelas_pagas: number
  /** valor_acordado / horas. null se sem horas ou sem valor. */
  hourly_estimado: number | null
  /** valor_pago / horas. null se nada pago ou sem horas. */
  hourly_real: number | null
  proxima_parcela: {
    id: string
    numero: number
    valor: number
    data_prevista: string | null
  } | null
}

export interface FinHourlyRateStats {
  /** R$/hora médio considerando só projetos freela com receita já recebida.
   *  null quando não há dados suficientes (sem projetos com recebido + horas). */
  media_real_brl_h: number | null
  /** R$/hora médio considerando projetos com `valor_acordado` cadastrado
   *  (mesmo sem recebimento). null quando vazio. */
  media_estimada_brl_h: number | null
  projetos_considerados_real: number
  projetos_considerados_estim: number
  horas_totais_real: number
  horas_totais_estim: number
  valor_recebido_total: number
  valor_acordado_total: number
}

export type FinPaymentTemplate = 'a_vista' | '50_50' | 'parcelado_3x' | 'parcelado_4x' | 'custom'
export type FinParcelaStatus = 'pendente' | 'recebido' | 'atrasado' | 'cancelada'

export interface FinParcela {
  id: string
  projeto_id: string
  numero: number
  valor: number
  data_prevista: string | null
  status: FinParcelaStatus
  observacao: string | null
  /** ID da transação que pagou essa parcela (FK reverso). */
  transacao_recebimento_id: string | null
  /** Title do projeto (apenas no endpoint cross-projeto `/api/finance/parcelas`). */
  projeto_titulo?: string
}

/**
 * Quest — item de trabalho (subtarefa). Toda quest pertence a um projeto
 * (`project_id`) e a uma entrega desse projeto (`deliverable_id`).
 */
export interface Quest {
  id: string
  project_id: string | null
  title: string
  area_slug: string
  status: string
  priority: string
  /**
   * @deprecated Quest não tem mais deadline própria — herda do entregável
   * (e em fallback, do projeto). Sempre vem `null` do backend. Use
   * `effectiveQuestDeadline(quest, delivsByProject, projects)` em
   * `utils/quests.ts` pra resolver o prazo correto.
   */
  deadline: string | null
  estimated_minutes: number | null
  next_action: string | null
  description?: string | null
  deliverable_id?: string | null
  completed_at?: string | null
  /** Soma das sessões fechadas (em minutos), independente de status. */
  worked_minutes?: number
}

export interface Area {
  slug: string
  name: string
  description: string
  color: string
}

export interface CalendarEvent {
  id: string
  title: string
  starts_at: string | null
  ends_at: string | null
  is_all_day: boolean
  location: string | null
}

export interface FreeWindow {
  starts_at: string
  ends_at: string
  duration_minutes: number
}

export interface Routine {
  id: string
  title: string
  recurrence: string
  day_of_week: number | null
  days_of_week: string | null
  day_of_month: number | null
  start_time: string | null
  end_time: string | null
  estimated_minutes: number | null
  calendar_event_id: string | null
  done: boolean
  /** 'critical' | 'high' | 'medium' | 'low' — obrigatório na criação. */
  priority: string
  /** Notas em formato BlockNote (JSON serializado). */
  description?: string | null
}

export interface DayData {
  date: string
  timezone: string
  events: CalendarEvent[]
  free_windows: FreeWindow[]
  total_free_minutes: number
}

export interface Deliverable {
  id: string
  project_id: string
  title: string
  done: boolean
  sort_order: number
  estimated_minutes?: number | null
  deadline?: string | null
  /** Legado: antes a API incrementava isso no `status='done'`. Não usar. */
  minutes_worked?: number
  /** Soma dinâmica de sessões fechadas das quests **done** amarradas. */
  executed_minutes?: number
}

export interface ActiveSession {
  type: 'quest' | 'task' | 'routine' | 'library' | 'mind' | 'health_item' | 'ritual'
  id: string
  title: string
  area_slug: string | null
  started_at: string
  ended_at: string | null
  is_active: boolean
  /** Nome do projeto pai quando `type='quest'` e é subtarefa. */
  parent_title?: string | null
  /** Nome do entregável quando `type='quest'` e é subtarefa amarrada. */
  deliverable_title?: string | null
  /** @deprecated use `id` + `type`. Kept for back-compat with older UI code. */
  quest_id?: string | null
  /** Para `type='routine'`: data (YYYY-MM-DD) da sessão ativa.
   *  Usada pelo banner pra escopear o "+tempo acumulado" ao dia certo
   *  e pra passar `target` correto em finalizações cross-midnight. */
  routine_date?: string | null
  /** Estimativa em minutos da entidade vinculada (quest/task/routine), usada
   *  pelo banner pra detectar overflow vs. tempo executado. */
  estimated_minutes?: number | null
}

export interface MicroTask {
  id: string
  title: string
  created_at: string
}

export interface Profile {
  name: string
  role: string
  avatar_url: string
}

export interface Task {
  id: string
  title: string
  scheduled_date: string | null
  start_time: string | null
  end_time: string | null
  duration_minutes: number | null
  done: boolean
  completed_at: string | null
  sort_order: number
  /** 'critical' | 'high' | 'medium' | 'low' — obrigatório na criação. */
  priority: string
  /** Notas em formato BlockNote (JSON serializado). */
  description?: string | null
}

// ─── Hub Finance (v0) ─────────────────────────────────────────────────────

export type FinAccountType = 'corrente' | 'credito' | 'wallet' | 'wise'
export type FinAccountOrigin = 'manual' | 'pynubank'
export type FinCategoryType = 'receita' | 'despesa' | 'estorno' | 'transferencia'

export interface FinAccount {
  id: string
  nome: string
  tipo: FinAccountType
  moeda: string
  origem_dados: FinAccountOrigin
  sort_order: number
  /** Saldo calculado pelo backend (soma das transações). */
  saldo: number
  /** Cotação manual da moeda nativa pra BRL (só usado se moeda != BRL).
   *  Null = não converte (não soma no saldo total da Visão Geral). */
  cotacao_brl: number | null
}

export interface FinCategory {
  id: string
  nome: string
  tipo: FinCategoryType
  cor: string | null
  categoria_pai_id: string | null
  sort_order: number
}

export interface FinTransaction {
  id: string
  /** YYYY-MM-DD */
  data: string
  /** Positivo = entrada, negativo = saída. */
  valor: number
  descricao: string
  conta_id: string
  categoria_id: string | null
  origem: 'manual' | 'nubank_csv'
  notas: string | null
  /** Identificador único da transação no extrato Nubank (preenchido só
   *  quando origem='nubank_csv'). Usado pra deduplicar import re-rodado. */
  nubank_id: string | null
  /** Vínculo opcional a uma dívida (faculdade, financiamento). Quando
   *  preenchido e valor < 0, abate o saldo devedor da dívida. */
  divida_id: string | null
  /** Vínculo opcional a uma parcela esperada de projeto. Quando preenchido
   *  e valor > 0, marca a parcela como 'recebido'. */
  parcela_id: string | null
  /** Vínculo opcional a uma fatura de cartão de crédito. Compras no cartão
   *  são auto-vinculadas pela fatura aberta. Não conta no resumo mensal
   *  até a fatura ser paga. */
  fatura_id: string | null
  /** "Esta transação É O PAGAMENTO desta fatura" — distinto de fatura_id
   *  ("é uma compra dentro da fatura"). Setar marca a fatura como `paga`
   *  + `data_pagamento = data desta tx`. Usado pra reconciliar txs
   *  importadas do Nubank tipo "Pagamento de fatura" com a fatura. */
  pagamento_fatura_id: string | null
  /** Vínculo opcional: esta tx paga a recurring_bill X no mês. Usado
   *  pra conciliar uma tx já importada do banco com uma fixa cadastrada,
   *  evitando duplicação no resumo mensal. */
  recurring_bill_id: string | null
  created_at?: string
  updated_at?: string
}

export interface FinImportSummary {
  imported: number
  duplicates: number
  errors: number
  error_samples: string[]
  /** Quantas transações o sistema já categorizou automaticamente via regras
   *  cadastradas (substring case-insensitive da descrição). */
  auto_categorized: number
  /** Quantas transações foram auto-vinculadas a uma parcela esperada
   *  (CPF/CNPJ do cliente apareceu na descrição + valor casa com parcela
   *  pendente). */
  auto_linked_parcelas: number
}

export interface FinCategorizationRule {
  id: string
  pattern: string
  categoria_id: string
  times_matched: number
  created_at?: string
  /** Quando setado: ao aplicar a regra numa tx de saída, tenta linkar como
   *  pagamento da fatura aberta/fechada desse cartão (auto-link por valor). */
  link_cartao_id?: string | null
}

export type FinDebtStatus = 'active' | 'paid_off' | 'cancelled'

export interface FinDebt {
  id: string
  descricao: string
  valor_total_original: number
  parcela_mensal: number | null
  /** YYYY-MM-DD do início (1ª parcela), opcional. */
  data_inicio: string | null
  /** Categoria pra onde os pagamentos costumam ir (ex: "Faculdade"). */
  categoria_id: string | null
  status: FinDebtStatus
  sort_order: number
  // Computados pelo backend a cada GET:
  /** Soma absoluta das transações com `divida_id = this.id` E valor < 0. */
  valor_pago: number
  /** max(0, valor_total_original - valor_pago). */
  saldo_devedor: number
  /** Contagem de transações vinculadas (proxy pra "parcelas pagas"). */
  parcelas_pagas: number
  /** Estimativa baseada em parcela_mensal. null se sem parcela cadastrada. */
  parcelas_restantes: number | null
  /** 0..100. */
  progresso_pct: number
}

export type FinDebtParcelaStatus = 'pendente' | 'paga' | 'atrasada'

/** Parcela individual de uma dívida — cronograma flexível.
 *  `valor_planejado` null = "auto" (rateia o saldo restante).
 *  `valor_efetivo` é computado pelo backend (rateio quando auto). */
export interface FinDebtParcela {
  id: string
  divida_id: string
  numero: number
  data_prevista: string | null
  valor_planejado: number | null  // null = auto
  transacao_pagamento_id: string | null
  notas: string | null
  // Computados pelo backend
  valor_efetivo: number
  is_auto: boolean
  status: FinDebtParcelaStatus
  valor_pago: number | null
  data_pagamento: string | null
}

export interface FinMonthlySummary {
  year: number
  month: number
  /** YYYY-MM-DD do primeiro dia do mês. */
  data_de: string
  /** YYYY-MM-DD do último dia do mês. */
  data_ate: string
  /** Soma das transações com valor > 0 no período. */
  receita: number
  /** Soma absoluta das transações com valor < 0 no período. */
  despesa: number
  /** receita - despesa (pode ser negativa). */
  sobra: number
  /** Soma das reservas wishlist planejadas pro mês (passivas, virtuais).
   *  Só conta itens ativos (desejado | poupando). */
  reservas_wishlist: number
  /** Sobra DEPOIS de comprometer com a wishlist do mês.
   *  Métrica que decide se você pode comprar mais coisa.
   *  Cálculo: sobra - reservas_wishlist. */
  sobra_real: number
  transacoes_total: number
}

export interface FinSummary {
  /** Saldo total em BRL — inclui contas BRL + contas em outras moedas
   *  convertidas via `cotacao_brl`. Contas sem cotação ficam de fora. */
  saldo_total: number
  /** Saldos agregados por moeda nativa (ex: {BRL: 1500, USD: 380}). */
  saldos_por_moeda: Record<string, number>
  /** Equivalente em BRL dos saldos não-BRL convertidos no `saldo_total`
   *  (ex: {USD: 1976.0} se Wise tinha $380 a R$5.20). */
  saldos_convertidos_por_moeda: Record<string, number>
  /** Cotações usadas no cálculo, por moeda. */
  cotacoes_usadas: Record<string, number>
  /** Contas em moeda != BRL que não tinham cotação definida — não entraram
   *  no saldo_total. UI deve alertar pro usuário cadastrar a cotação. */
  saldos_nao_convertidos: Array<{
    conta_id: string
    nome: string
    moeda: string
    saldo: number
  }>
  contas: FinAccount[]
  transacoes_total: number
}

export interface FinExchangeRate {
  from: string
  to: string
  rate: number
  fetched_at: string
  source: string
}

// ─── Recurring Bills (contas fixas: luz, água, internet, etc) ────────────

export type FinRecurringBillTipo = 'despesa' | 'receita'

/** Conta fixa cadastrada — luz, água, internet, aluguel, streaming, salário, etc.
 *  `tipo='despesa'` = saída fixa; `tipo='receita'` = entrada fixa (salário, etc). */
export interface FinRecurringBill {
  id: string
  descricao: string
  /** Valor médio mensal em BRL (estimativa). */
  valor_estimado: number
  /** Dia do mês em que vence/cai (1-31). Opcional. */
  dia_vencimento: number | null
  categoria_id: string | null
  conta_pagamento_id: string | null
  ativa: boolean
  recorrencia: 'mensal'
  tipo: FinRecurringBillTipo
  notas: string | null
  sort_order: number
}

export type FinRecurringBillStatus = 'paga' | 'recebida' | 'pendente' | 'atrasada'

/** Status de uma conta fixa num mês — inferido pelo backend. */
export interface FinRecurringBillStatusItem {
  bill_id: string
  descricao: string
  valor_estimado: number
  dia_vencimento: number | null
  categoria_id: string | null
  tipo: FinRecurringBillTipo
  status: FinRecurringBillStatus
  /** Quando paga/recebida, valor real da transação encontrada. */
  valor_pago: number | null
  transacao_id: string | null
  data_pagamento: string | null
}

// ─── Compromissos do Mês (visão consolidada) ────────────────────────────

export type FinMonthCommitmentKind = 'bill' | 'debt_parcela' | 'freela_parcela' | 'invoice' | 'wishlist'
export type FinMonthCommitmentTipo = 'despesa' | 'receita'
export type FinMonthCommitmentStatus = 'pendente' | 'paga' | 'recebida' | 'atrasada'

/** Compromisso unificado — pode ser bill recorrente, parcela de dívida,
 *  parcela de freela (recebimento) ou fatura de cartão. UI lista todos
 *  juntos ordenados por dia. */
export interface FinMonthCommitment {
  kind: FinMonthCommitmentKind
  id: string
  descricao: string
  sub_descricao: string | null
  tipo: FinMonthCommitmentTipo
  dia: number | null
  data_prevista: string | null
  valor: number
  valor_pago: number | null
  status: FinMonthCommitmentStatus
  transacao_id: string | null
  data_pagamento: string | null
  bill_id?: string
  debt_id?: string
  debt_descricao?: string
  parcela_numero?: number
  parcela_total?: number
  /** Quando kind='freela_parcela': id do projeto pra navegar até /freelas. */
  freela_projeto_id?: string
  /** Quando kind='invoice': id da fatura + cartão pra abrir o modal. */
  invoice_id?: string
  cartao_id?: string
  cartao_nome?: string
  /** Quando kind='wishlist': id do item pra navegar até /hub-finance/wishlist. */
  wishlist_item_id?: string
}

export interface FinMonthCommitments {
  year: number
  month: number
  items: FinMonthCommitment[]
  total_a_pagar: number
  total_a_receber: number
  total_pago: number
  total_recebido: number
  sobra_projetada: number
}

export interface FinRecurringBillStatusMonth {
  year: number
  month: number
  items: FinRecurringBillStatusItem[]
  total_estimado: number
  total_pago: number
  total_pendente: number
  // Totais separados por tipo (pra UI de previsão na Visão Geral)
  despesa_total_estimado: number
  despesa_total_pago: number
  despesa_total_pendente: number
  receita_total_estimado: number
  receita_total_recebido: number
  receita_total_pendente: number
}

// ─── /Build (Sistema de Metas) ───────────────────────────────────────────
// Schema completo em docs/metas-de-vida/PLAN.md.

export interface BuildPurpose {
  texto: string
  criado_em: string
  revisado_em: string
}

export interface BuildPrinciple {
  id: number
  texto: string
  ordem: number
  arquivado: boolean
  criado_em: string
}

export interface BuildVision {
  id: number
  texto: string
  data_alvo: string | null
  ativa: boolean
  criada_em: string
  arquivada_em: string | null
  motivo_arquivamento: string | null
}

export interface BuildSettings {
  max_metas_ativas: number
  default_dependency_threshold_pct: number
  metric_data_age_threshold_days: number
  dashboard_card_visivel: boolean
  atualizado_em: string
}

export type BuildGoalHorizon = 'anual' | 'trimestral'
export type BuildGoalStatus = 'ativa' | 'concluida' | 'abandonada' | 'pausada'
export type BuildGoalCriterionType = 'boolean' | 'numeric'

export interface BuildGoalAreaLink {
  area_slug: string
  is_primary: boolean
}

// v2.1: progresso resolvido pelo backend. Pra Meta booleana = null.
// Pra numérica: vem auto se metric_slug setado, manual se não.
export type BuildGoalProgressFonte = 'manual' | 'health' | 'sem_dados' | 'metrica_sumiu'

export interface BuildGoalProgressResolved {
  valor: number | null
  fonte: BuildGoalProgressFonte
  ultima_atualizacao: string | null
  detalhe: string | null
}

export interface BuildGoal {
  id: string
  titulo: string
  descricao: string | null
  horizon: BuildGoalHorizon
  data_inicio: string | null
  data_alvo: string
  status: BuildGoalStatus
  criterion_type: BuildGoalCriterionType
  criterion_target_value: number | null
  criterion_current_value: number | null
  criterion_metric_slug: string | null
  criterion_metric_item_id: number | null
  is_foundational: boolean
  requires_threshold_pct: number
  criada_em: string
  atualizada_em: string
  concluida_em: string | null
  abandonada_em: string | null
  // Notes long-form (BlockNote JSON serializado). Diferente de `descricao`
  // — descricao é hint curto (1-2 frases), notes é caderno completo.
  notes: string | null
  areas: BuildGoalAreaLink[]
  // v2.1: vem populado no GET. Null pra Meta booleana.
  progress_resolved: BuildGoalProgressResolved | null
}

export interface BuildGoalCreate {
  titulo: string
  descricao?: string | null
  horizon: BuildGoalHorizon
  data_inicio?: string | null
  data_alvo: string
  criterion_type: BuildGoalCriterionType
  criterion_target_value?: number | null
  // v2.1: se setado, progresso vem auto de Hub Health
  criterion_metric_slug?: string | null
  criterion_metric_item_id?: number | null
  is_foundational?: boolean
  requires_threshold_pct?: number | null
  areas: BuildGoalAreaLink[]
}

export type BuildGoalUpdate = Partial<{
  titulo: string
  descricao: string | null
  horizon: BuildGoalHorizon
  data_inicio: string | null
  data_alvo: string
  status: BuildGoalStatus
  criterion_type: BuildGoalCriterionType
  criterion_target_value: number | null
  // v2.1: passar "" pra desvincular Meta de Health
  criterion_metric_slug: string | null
  criterion_metric_item_id: number | null
  is_foundational: boolean
  requires_threshold_pct: number
  // Notes long-form (BlockNote JSON). Aceita null pra limpar.
  notes: string | null
}>

// Classificação de Projeto sem Meta (decisão #8 do PLAN). Drift = nem
// vinculado nem classificado.
export type BuildProjectClassification =
  | 'manutencao'
  | 'reativo'
  | 'exploratorio'

export type BuildAlignmentStatus = 'aligned' | 'classified' | 'drift'

export interface BuildProjectAlignment {
  id: string
  title: string
  area_slug: string
  status: string
  archived_at: string | null
  classification: BuildProjectClassification | null
  classified_at: string | null
  goal_ids: string[]
  alignment_status: BuildAlignmentStatus
}

export type BuildSprintStatus = 'planejado' | 'ativo' | 'concluido' | 'abandonado'

export interface BuildSprint {
  id: string
  goal_id: string
  numero: number
  data_inicio: string
  data_fim: string
  foco: string | null
  status: BuildSprintStatus
  criado_em: string
  atualizado_em: string
}

export interface BuildSprintCreate {
  goal_id: string
  numero?: number | null
  data_inicio: string
  data_fim: string
  foco?: string | null
  status?: BuildSprintStatus
}

export type BuildSprintUpdate = Partial<{
  numero: number
  data_inicio: string
  data_fim: string
  foco: string | null
  status: BuildSprintStatus
}>

export interface BuildGoalDependency {
  requires_goal_id: string
  requires_titulo: string
  requires_status: BuildGoalStatus
  is_satisfied: boolean
}

export type BuildRitualCadencia = 'semanal' | 'mensal' | 'trimestral' | 'anual'

// schedule_config tem formato dependente da cadência. Tipamos amplo aqui;
// validação fina fica no backend e na UI de configuração.
export type BuildRitualScheduleConfig = Record<string, unknown>

export interface BuildRitual {
  cadencia: BuildRitualCadencia
  /** Nome customizável. Null = front cai pra label da cadência. */
  nome: string | null
  ativo: boolean
  schedule_config: BuildRitualScheduleConfig
  direcionamento_pensar: string
  direcionamento_evitar: string
  duracao_alvo_min: number
  criado_em: string
  atualizado_em: string
  // Calculados pelo backend:
  proxima_data: string | null
  ultima_execucao: string | null
  dias_atraso: number
}

export type BuildRitualUpdate = Partial<{
  nome: string | null
  ativo: boolean
  schedule_config: BuildRitualScheduleConfig
  direcionamento_pensar: string
  direcionamento_evitar: string
  duracao_alvo_min: number
}>

export interface BuildRitualSession {
  id: string
  cadencia: BuildRitualCadencia
  data_executado: string
  duracao_min: number | null
  notas: string | null
  foco_proxima_periodo: string | null
  /** Pulado intencionalmente (viagem, doente). Streak no front filtra. */
  skipped: boolean
  skip_reason: string | null
  criado_em: string
}

export interface BuildRitualSessionCreate {
  data_executado?: string | null
  duracao_min?: number | null
  notas?: string | null
  foco_proxima_periodo?: string | null
  skipped?: boolean
  skip_reason?: string | null
}

export type BuildRitualSessionUpdate = Partial<{
  data_executado: string
  duracao_min: number | null
  notas: string | null
  foco_proxima_periodo: string | null
  skipped: boolean
  skip_reason: string | null
}>

// Lista de datas de cada cadência ativa num intervalo. Usado pra renderizar
// marcadores no Calendar.
export interface BuildRitualScheduleItem {
  cadencia: BuildRitualCadencia
  datas: string[]                     // YYYY-MM-DD
}

// ─── Guardrail (v2 — pontes Hub Health) ───────────────────────────────────

export type BuildGuardrailOperador = '>=' | '<=' | '>' | '<' | '==' | '!='

export type BuildGuardrailEstado =
  | 'OK'
  | 'VIOLADO'
  | 'ESPERANDO_DADOS'
  | 'METRICA_NAO_ENCONTRADA'

export interface BuildGuardrail {
  id: number
  goal_id: string
  metric_slug: string
  item_id: number | null
  operador: BuildGuardrailOperador
  valor_alvo: number
  descricao: string | null
  ordem: number
  criado_em: string
  atualizado_em: string
}

export interface BuildGuardrailCreate {
  metric_slug: string
  item_id?: number | null
  operador: BuildGuardrailOperador
  valor_alvo: number
  descricao?: string | null
  ordem?: number | null
}

export type BuildGuardrailUpdate = Partial<{
  metric_slug: string
  item_id: number | null
  operador: BuildGuardrailOperador
  valor_alvo: number
  descricao: string | null
  ordem: number
}>

export interface BuildGuardrailEvaluation {
  id: number
  metric_slug: string
  item_id: number | null
  operador: BuildGuardrailOperador
  valor_alvo: number
  descricao: string | null
  estado: BuildGuardrailEstado
  valor_atual: number | null
  unidade: string | null
  ultima_atualizacao: string | null
  detalhe: string | null
}

// ─── Hub Health ───────────────────────────────────────────────────────────
// Módulo de saúde como prática contínua observada. Tabelas health_* no DB.
// Schema completo em docs/hub-health/PLAN.md.

export type HealthTemplate =
  | 'janela_qualidade'      // Sono: hora_inicio + hora_fim + qualidade + tipo
  | 'atividade_tipo'        // Exercício: item + duracao_min + intensidade
  | 'refeicao_2modos'       // Alimentação: item+comeu OU descricao livre
  | 'consumo_vontade'       // Vícios: item + quantidade + vontade
  | 'metrica_simples'       // Medidas Corporais: item + valor
  | 'evento_escala'         // Genérico: escala 1-5 (Humor, Energia, etc.)
  | 'observacao_estruturada' // Mind: duração + intenção? + observação + hipótese? + tipo

export interface HealthDomain {
  slug: string
  nome: string
  cor: string | null
  icone: string | null
  template: HealthTemplate
  usa_itens: boolean
  lembrete_ativo: boolean
  ausencia_threshold_dias: number | null
  ordem: number
  ativo: boolean
  /** Métrica primária a exibir no Dashboard. Null = sistema escolhe um
   *  default razoável baseado no template. Configurável pelo usuário via
   *  PATCH /domains/{slug}. */
  metric_primary_slug: string | null
  criado_em: string
  atualizado_em: string
}

export interface HealthDomainCreate {
  slug: string
  nome: string
  template: HealthTemplate
  usa_itens?: boolean
  cor?: string | null
  icone?: string | null
  lembrete_ativo?: boolean
  ausencia_threshold_dias?: number | null
  ordem?: number
  metric_primary_slug?: string | null
}

export type HealthDomainUpdate = Partial<{
  nome: string
  cor: string | null
  icone: string | null
  lembrete_ativo: boolean
  ausencia_threshold_dias: number | null
  ordem: number
  ativo: boolean
  metric_primary_slug: string | null
}>

export interface HealthItem {
  id: number
  domain_slug: string
  nome: string
  unidade: string | null
  horario_esperado: string | null     // HH:MM
  descricao: string | null
  cor: string | null
  arquivado: boolean
  arquivado_em: string | null
  ordem: number
  // Agenda diária — quando `diario=true`, item gera pendência arrastável
  // em /Dia. Doc: docs/library/PLAN.md (mesmo padrão).
  diario: boolean
  duracao_media_min: number | null
  horario_sugerido: string | null     // HH:MM
  criado_em: string
  atualizado_em: string
}

export interface HealthItemCreate {
  nome: string
  unidade?: string | null
  horario_esperado?: string | null
  descricao?: string | null
  cor?: string | null
  ordem?: number
  diario?: boolean
  duracao_media_min?: number | null
  horario_sugerido?: string | null
}

export type HealthItemUpdate = Partial<HealthItemCreate>

// Payload de Registro varia por template. Mantemos como `Record<string, unknown>`
// no TypeScript — validação real do formato fica no backend.
export type HealthRecordPayload = Record<string, unknown>

export interface HealthRecord {
  id: number
  domain_slug: string
  item_id: number | null
  data: string                        // YYYY-MM-DD
  horario: string | null              // HH:MM
  payload: HealthRecordPayload
  notas: string | null
  criado_em: string
  atualizado_em: string
}

export interface HealthRecordCreate {
  item_id?: number | null
  data?: string                       // default: hoje no backend
  horario?: string | null
  payload: HealthRecordPayload
  notas?: string | null
}

export type HealthRecordUpdate = Partial<HealthRecordCreate>

export interface HealthSettings {
  hora_lembrete_sono: string             // HH:MM, quando lembrete de sono dispara
  dashboard_card_visivel: boolean
  mind_challenge_ativo: boolean
  mind_challenge_min_aparicoes: number
  mind_challenge_janela_dias: number
  mind_suspender_por_dias: number
  // Mind agenda — quando `mind_diario=true`, Mind gera pendência diária em /Dia.
  mind_diario: boolean
  mind_duracao_media_min: number
  mind_horario_sugerido: string | null    // HH:MM
  atualizado_em: string
}

export type HealthSettingsUpdate = Partial<{
  hora_lembrete_sono: string
  dashboard_card_visivel: boolean
  mind_challenge_ativo: boolean
  mind_challenge_min_aparicoes: number
  mind_challenge_janela_dias: number
  mind_suspender_por_dias: number
  mind_diario: boolean
  mind_duracao_media_min: number
  mind_horario_sugerido: string | null
}>

// ─── Mind — Observação Estruturada ────────────────────────────────────────

export type MindTipo = 'rotina' | 'revelacao'
export type MindHipoteseStatus = 'pending' | 'validated' | 'refuted' | 'suspended'

export interface MindTag {
  id: number
  slug: string
  nome: string
  descricao: string | null
  cor: string | null
  arquivado: boolean
  ordem: number
  criado_em: string
  atualizado_em: string
}

export interface MindTagCreate {
  slug: string
  nome: string
  descricao?: string | null
  cor?: string | null
  ordem?: number
}

export type MindTagUpdate = Partial<{
  nome: string
  descricao: string | null
  cor: string | null
  arquivado: boolean
  ordem: number
}>

export interface MindHipotese {
  id: number
  record_id: number
  texto: string
  status: MindHipoteseStatus
  suspended_until: string | null
  criado_em: string
  atualizado_em: string
  record_data: string | null
  tags: string[]                          // slugs
  aparicoes_recentes: number
}

export interface MindPayload {
  duracao_min?: number
  intencao?: string | null
  observacao: string
  hipotese?: string | null
  tipo: MindTipo
}

export interface MindSessionTag {
  id: number
  slug: string
  nome: string
  cor: string | null
}

export interface MindSession {
  id: number
  data: string
  horario: string | null
  payload: MindPayload
  notas: string | null
  criado_em: string
  atualizado_em: string
  tags: MindSessionTag[]
  hipotese: {
    id: number
    texto: string
    status: MindHipoteseStatus
    suspended_until: string | null
    criado_em: string
    atualizado_em: string
  } | null
}

export interface MindSessionCreate {
  data?: string | null
  horario?: string | null
  notas?: string | null
  payload: MindPayload
  tag_ids: number[]
}

export type MindSessionUpdate = Partial<{
  data: string
  horario: string | null
  notas: string | null
  payload: MindPayload
  tag_ids: number[]
}>

export interface MindPadrao {
  tag_slug: string
  tag_nome: string
  tag_cor: string | null
  count: number
  primeira: string
  ultima: string
}

export interface MindChallenge {
  hipotese: MindHipotese
  tags_relacionadas: MindPadrao[]
}

// Métricas — cidadãs de primeira classe (decisão #4 do PLAN.md de Health).
// Catálogo retornado por GET /api/health/metrics; valores via GET
// /api/health/metrics/{slug}?item_id=X (item_id obrigatório se precisa_item).

export type HealthMetricReturnType =
  | 'float'
  | 'int'
  | 'string'
  | 'date'
  | 'enum'
  | 'dict'

export interface HealthMetricMeta {
  slug: string                        // ex: 'sono_duracao_media_30d'
  nome: string                        // human-readable
  domain_slug: string                 // ex: 'sono'
  tipo_retorno: HealthMetricReturnType
  unidade: string | null              // ex: 'h', '%', null pra enum/dict
  precisa_item: boolean
}

export interface HealthMetricValue {
  slug: string
  valor: number | string | Record<string, number> | null
  unidade: string | null
  tipo_retorno: HealthMetricReturnType | null
  dados_disponiveis: boolean
  ultima_atualizacao: string | null
  erro?: string                       // só presente em erros suaves
}

// Pendências do dia — lembretes proativos (passou do horário, sem registro)
// e ausências retroativas (passou do threshold de dias). Vícios e Medidas
// Corporais NÃO geram ausência (ausencia_threshold_dias=null). Filosofia
// em RASCUNHO §3.2.

export type HealthPendingTipo = 'lembrete' | 'ausencia'

export interface HealthPendingItem {
  tipo: HealthPendingTipo
  domain_slug: string
  domain_nome: string
  item_id: number | null
  item_nome: string | null
  descricao: string
  horario_esperado: string | null     // HH:MM (só pra lembrete)
  dias: number | null                 // só pra ausência
}

// ─── Wishlist (submódulo do Hub Finance) ──────────────────────────────────
// Lista de desejos com cronograma opcional de reserva mensal. Schema completo
// em docs/hub-finance/wishlist-PLAN.md.

export type WishlistStatus = 'desejado' | 'poupando' | 'comprado' | 'desistido'

export interface WishlistCategoria {
  id: string
  nome: string
  cor: string | null
  sort_order: number
}

export interface WishlistCategoriaCreate {
  nome: string
  cor?: string | null
  sort_order?: number | null
}

export type WishlistCategoriaUpdate = Partial<WishlistCategoriaCreate>

export interface WishlistLink {
  id: string
  url: string
  label: string | null
  preco: number | null
  sort_order: number
}

export interface WishlistLinkCreate {
  url: string
  label?: string | null
  preco?: number | null
  sort_order?: number | null
}

export type WishlistLinkUpdate = Partial<WishlistLinkCreate>

export interface WishlistReserva {
  id: string
  ano: number
  mes: number                          // 1-12
  /** Dia preferido pra guardar. Null = último dia do mês (default na UI). */
  dia: number | null
  valor_planejado: number              // BRL
  notas: string | null
  /** Fase 5: transação que materializou a reserva. Null = ainda pendente
   *  (aparece como "aguardando confirmação"). */
  transacao_id: string | null
}

export interface WishlistReservaInput {
  ano: number
  mes: number
  dia?: number | null
  valor_planejado: number
  notas?: string | null
}

export interface WishlistReservaVincularBody {
  transacao_id: string | null          // null = limpar vínculo
}

export interface WishlistReservaMatchGroup {
  reserva: WishlistReserva
  item_id: string
  item_nome: string
  candidates: WishlistTransactionCandidate[]
}

export interface WishlistItem {
  id: string
  nome: string
  descricao: string | null
  categoria_id: string | null
  valor_estimado: number               // BRL
  prioridade: number
  status: WishlistStatus
  data_alvo: string | null             // YYYY-MM-DD opcional

  // Compra (preenchidos quando status='comprado')
  valor_real: number | null
  comprado_em: string | null           // YYYY-MM-DD
  transacao_id: string | null

  // Desistência (preenchidos quando status='desistido')
  desistido_em: string | null
  motivo_desistencia: string | null

  criada_em: string | null
  atualizada_em: string | null

  // Computados pelo backend
  links: WishlistLink[]
  reservas: WishlistReserva[]
  /** Fase 5 (soft mode): só conta reservas CONFIRMADAS (com transacao_id). */
  reservado_acumulado: number
  /** Reservas passadas (mês <= atual) SEM vínculo — "aguardando confirmação". */
  reservado_pendente: number
  /** max(0, estimado - acumulado). */
  reservado_restante: number
  /** 0..100 — baseado em reservado_acumulado (confirmado). */
  progresso_pct: number
  proxima_reserva: WishlistReserva | null
  meses_parado: number                 // pra badge "envelhecendo"
}

export interface WishlistItemCreate {
  nome: string
  descricao?: string | null
  categoria_id?: string | null
  valor_estimado: number
  data_alvo?: string | null
}

export type WishlistItemUpdate = Partial<{
  nome: string
  descricao: string | null
  categoria_id: string | null
  valor_estimado: number
  prioridade: number
  status: WishlistStatus
  data_alvo: string | null
}>

export interface WishlistComprarBody {
  valor_real: number
  data?: string | null                 // YYYY-MM-DD; default = hoje no backend
  transacao_id?: string | null         // null = vincular depois
}

export interface WishlistDesistirBody {
  motivo?: string | null
}

export interface WishlistReabrirBody {
  novo_status?: 'desejado' | 'poupando' | null
}

export interface WishlistVincularBody {
  transacao_id: string | null          // null = limpar vínculo
}

export interface WishlistReorderItem {
  id: string
  prioridade: number
}

export interface WishlistSettings {
  envelhecimento_threshold_meses: number
  atualizado_em: string | null
}

export type WishlistSettingsUpdate = Partial<{
  envelhecimento_threshold_meses: number
}>

export interface WishlistSummary {
  total_items_ativos: number           // desejado + poupando
  total_valor_estimado: number
  /** Fase 5: só reservas CONFIRMADAS (com transacao_id). */
  total_reservado_acumulado: number
  /** Reservas passadas SEM vínculo — pendente de confirmação. */
  total_reservado_pendente: number
  itens_em_curso: number               // só 'poupando'
  proxima_compra_id: string | null
  proxima_compra_nome: string | null
  proxima_compra_progresso_pct: number | null
  media_mensal_reserva: number
}

export interface WishlistMonthReservas {
  ano: number
  mes: number
  total_reservado: number
  detalhamento: Array<{
    item_id: string
    item_nome: string
    valor_planejado: number
  }>
}

// ─── Match transação ↔ item (Fase 3) ──────────────────────────────────────

export interface WishlistTransactionCandidate {
  id: string
  data: string                         // YYYY-MM-DD
  valor: number                        // sempre < 0 (despesa)
  descricao: string
  conta_id: string | null
  conta_nome: string | null
  /** |Δ| relativo em %, pra UI ordenar/destacar match exato. */
  diff_pct: number
}

export interface WishlistMatchGroup {
  item: WishlistItem
  candidates: WishlistTransactionCandidate[]
}

// ─── Nested Pages (caderno virtual dentro de Projetos) ────────────────────
// Doc: docs/nested-pages/PLAN.md

/** Metadado da page — devolvido pela listagem batch (sem content_json). */
export interface ProjectPageMeta {
  id: string
  project_id: string
  parent_page_id: string | null
  title: string
  sort_order: number
  created_at: string | null
  updated_at: string | null
}

/** Page completa, com content_json (BlockNote serializado). */
export interface ProjectPage extends ProjectPageMeta {
  content_json: string | null
}

export interface ProjectPageDescendant {
  id: string
  title: string
  depth: number
}

export interface ProjectPageDescendantsResponse {
  count: number
  titles: string[]
  descendants: ProjectPageDescendant[]
}

// ─── Library ──────────────────────────────────────────────────────────────
// Doc: docs/library/PLAN.md. Módulo de input curado (livros, filmes, podcasts,
// artigos, cursos). Filosofia: destilação > consumo.

export type LibraryItemTipo =
  | 'livro'
  | 'filme'
  | 'serie'
  | 'podcast'
  | 'artigo'
  | 'video'
  | 'curso'
  | 'palestra'
  | 'paper'
  | 'outro'

export type LibraryItemStatus = 'queue' | 'doing' | 'done' | 'abandoned'

export type LibraryLinkTargetType =
  | 'mind_hipotese'
  | 'quest'
  | 'build_principle'
  | 'build_goal'

export interface LibraryTag {
  id: number
  slug: string
  nome: string
  cor: string | null
  arquivado: boolean
  ordem: number
  criado_em: string
}

export interface LibraryTagCreate {
  slug: string
  nome: string
  cor?: string | null
  ordem?: number
}

export type LibraryTagUpdate = Partial<{
  nome: string
  cor: string | null
  arquivado: boolean
  ordem: number
}>

export interface LibraryItemTagRef {
  id: number
  slug: string
  nome: string
  cor: string | null
}

export interface LibraryLink {
  id: number
  target_type: LibraryLinkTargetType
  target_id: string
  nota: string | null
  criado_em: string
}

export interface LibraryItem {
  id: number
  tipo: LibraryItemTipo
  titulo: string
  autor: string | null
  ano: number | null
  status: LibraryItemStatus
  data_inicio: string | null
  data_fim: string | null
  tese_central: string | null
  o_que_ficou: string | null
  abandoned_reason: string | null
  origem: string | null
  revisitar_em: string | null
  notes_json: string | null
  sort_order: number
  saga_id: number | null
  saga_ordem: number
  tags: LibraryItemTagRef[]
  links: LibraryLink[]
  minutos_total: number
  criado_em: string
  atualizado_em: string
}

/** Versão enxuta da listagem — sem notes_json nem links. */
export interface LibraryItemListEntry {
  id: number
  tipo: LibraryItemTipo
  titulo: string
  autor: string | null
  ano: number | null
  status: LibraryItemStatus
  data_inicio: string | null
  data_fim: string | null
  revisitar_em: string | null
  origem: string | null
  sort_order: number
  saga_id: number | null
  saga_ordem: number
  tags: LibraryItemTagRef[]
  minutos_total: number
  criado_em: string
  atualizado_em: string
}

export interface LibraryItemCreate {
  tipo: LibraryItemTipo
  titulo: string
  autor?: string | null
  ano?: number | null
  origem?: string | null
  tag_ids?: number[]
  saga_id?: number | null
}

export type LibraryItemUpdate = Partial<{
  tipo: LibraryItemTipo
  titulo: string
  autor: string | null
  ano: number | null
  status: LibraryItemStatus
  tese_central: string | null
  o_que_ficou: string | null
  abandoned_reason: string | null
  origem: string | null
  revisitar_em: string | null
  notes_json: string | null
  sort_order: number
  tag_ids: number[]
  saga_id: number | null
  saga_ordem: number
}>

export interface LibrarySession {
  id: number
  item_id: number
  session_num: number
  started_at: string
  ended_at: string | null
  elapsed_seconds: number
}

export interface LibraryLinkCreate {
  target_type: LibraryLinkTargetType
  target_id: string
  nota?: string | null
}

export interface LibraryTema {
  tag_id: number
  tag_slug: string
  tag_nome: string
  tag_cor: string | null
  count_total: number
  count_done: number
  count_doing: number
}

export interface LibraryPending {
  id: number
  titulo: string
  tipo: LibraryItemTipo
  revisitar_em: string
  dias_ate: number
}

export interface LibraryBacklink {
  link_id: number
  item_id: number
  item_tipo: LibraryItemTipo
  item_titulo: string
  item_status: LibraryItemStatus
  item_autor: string | null
  nota: string | null
  criado_em: string
}

// ─── /Dia pendências ──────────────────────────────────────────────────────
// Pendências agregadas (Mind + health_items com `diario=true`) que aparecem
// como cards arrastáveis em /Dia. Endpoint: GET /api/dia/pendencias?data=.

export type DiaPendenciaOrigem = 'mind' | 'health_item'
export type DiaPendenciaModalType = 'mind' | 'health_register'

export interface DiaPendencia {
  origem: DiaPendenciaOrigem
  /** ID estável usado pelo frontend pra colocar em dayPlan (localStorage).
   *  "mind" pra Mind, "health_item:<id>" pra health items. */
  pendencia_id: string
  titulo: string
  duracao_min: number | null
  horario_sugerido: string | null
  cor: string | null
  modal_type: DiaPendenciaModalType
  /** Refs adicionais pro modal — pra health: { domain_slug, domain_nome,
   *  domain_template, domain_cor, item_id, item_nome }. */
  target: Record<string, unknown>
}

// ─── Saga ────────────────────────────────────────────────────────────────
// Agrupamento puramente visual de items (28 dias depois → 28 semanas →
// 28 anos). Item pertence a 0 ou 1 saga, saga_ordem governa posição.

export interface LibrarySaga {
  id: number
  nome: string
  descricao: string | null
  cor: string | null
  ordem: number
  items_count: number
  criado_em: string
  atualizado_em: string
}

export interface LibrarySagaCreate {
  nome: string
  descricao?: string | null
  cor?: string | null
  ordem?: number
}

export type LibrarySagaUpdate = Partial<{
  nome: string
  descricao: string | null
  cor: string | null
  ordem: number
}>
