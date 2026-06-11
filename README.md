# MAINFRAME

Painel pessoal de produtividade single-user — substitui Notion + To-do + planilha + calendário + 5 outros apps por uma cockpit própria. Cobre projetos, finanças, saúde, leitura, pensamentos, metas estratégicas e tempo de execução, tudo amarrado por áreas de vida. Roda 100% local, sem deploy, sem autenticação, sem nuvem.

É um sistema feito pra quem quer o próprio painel de controle em vez de espalhar trabalho entre múltiplas ferramentas. Cada entidade tem propósito e UI próprias — nenhuma é "tabela genérica reutilizada".

---

## O que tem dentro

### Operação diária

**Dashboard** — visão geral. Perfil + frase do dia, status híbrido dos projetos (em dia / em risco / atrasado), próximo ritual estratégico, item mais urgente, horas necessárias hoje.

**EXEC** — planejamento do dia atual (rota `/exec`, antes era `/dia`). Arrasta quests, tarefas, rotinas e rituais pros 3 períodos (manhã / tarde / noite). Timer por item com banner flutuante quando há sessão ativa, drawer com busca textual, fallback de chips M/T/N pra touch.

**Calendário** — visões dia / semana / mês / ano. Eventos sobrepostos lado a lado (estilo Google Calendar), altura proporcional à duração, blocos improdutivos configuráveis, rituais como blocos com legenda RTL/EXC/MND, deadlines de projetos e entregáveis distribuídos.

**Tarefas** — to-dos pontuais não amarrados a projeto. Agendáveis por data e hora com prioridade.

**Rotinas** — hábitos recorrentes (diário, dias úteis, semanal, mensal). Geram sessões no calendário automaticamente.

**Micro Dump** — inbox de ideias soltas. Promove pra tarefa, quest, rotina ou arquiva.

**Time Reports** — analytics de tempo gasto agregado por área, projeto ou período.

### Quests & Áreas

**Hierarquia Área → Projeto → Entregável → Quest.** Cada nível tem tabela e UI próprias:

- **Áreas** — 5 áreas de vida editáveis com cor que pinta o app inteiro. Cards de projeto com barra de progresso.
- **Projetos** — container estratégico (deadline, prioridade, notes BlockNote rich-text, valor acordado, cliente, arquivamento).
- **Entregáveis** — agrupadores de quests com deadline própria. Auto-fecham quando todas as quests filhas terminam.
- **Quests** — unidade granular de trabalho. Sempre amarrada a projeto + entregável. Herda deadline.
- **Project Pages** — sub-páginas BlockNote dentro de projetos (estilo "caderno de matéria" do Notion).

### Hub Finance

Gestão financeira pessoal completa:

- Visão geral com saldo total multi-moeda (BRL + USD/outras via cotação manual + auto-fetch)
- Lançamentos (receita / despesa / estorno / transferência)
- Carteira (contas correntes, crédito, wallet, Wise)
- Categorias customizáveis com regras de auto-categorização por padrão de descrição
- Dívidas com cronograma flexível de parcelas (faculdade, financiamento)
- Contas fixas recorrentes (luz, internet, salário) com status mensal pago / pendente
- Freelas com R$/hora estimado vs. real, valor acordado, parcelas a receber, vínculo a cliente
- Wishlist com reservas mensais, simulação de compra e vínculo a transações reais
- Faturas de cartão de crédito com reconciliação automática (auto-link de pagamento)
- Import CSV Nubank com deduplicação e auto-link de parcelas por CPF/CNPJ
- Compromissos do mês (visão consolidada: contas fixas + dívidas + faturas + freelas)

### Build — Sistema de Metas de Vida

Camada estratégica acima do operacional:

- **Propósito** (texto livre) + **Princípios negativos** (anti-metas — o que você NÃO faz)
- **Visão de 3 anos** versionada (histórico de revisões com motivo de arquivamento)
- **Metas** trimestrais / anuais com critério numérico ou booleano
- **Sprints** (sub-unidades de meta anual)
- **Dependências entre metas** com validação anti-ciclo (DFS)
- **Guardrails** ancorados em métricas do Hub Health (ex: "não cair pra menos de 6h de sono")
- **Rituais** semanal / mensal / trimestral / anual com schedule próprio e tracking de execução
- **Cascade view** — propósito → visão → metas → sprints → projetos → quests
- **Drift detection** — destaque pra projetos sem meta vinculada (alinhamento estratégico)

### Hub Health — Biomonitor

Tracker de saúde pessoal modular:

- Visão geral biomonitor em grid responsivo dos domínios ativos
- Domínios pré-templados: Sono, Exercício, Alimentação, Vícios, Janela de qualidade, etc.
- Registros diários com payload customizável por template
- Heatmap 30 dias + sparkline de tendência
- Métricas calculadas por domínio (média 7d, consumo médio diário, streak, etc.)
- Itens cadastráveis dentro dos domínios (cigarros, alimentos, exercícios)
- Trackers especiais (ex: "tempo sem fumar" calculado em tempo real)
- Pendências detectadas (sem registro hoje, lembretes ativos)

### Mind

Diário estruturado de pensamentos e hipóteses:

- Registros datados com tags
- Promoção de pensamento → hipótese → tese
- Página por tag agregando todos os registros relacionados

### Library

Caderno de leitura e estudo:

- Items (livros, artigos, vídeos, papers) com status de progresso
- Temas pra categorização cruzada
- Cross-link picker pra amarrar items entre si e a projetos
- Métrica de densidade de leitura (minutos / dia)

### Sessões globais

Banner flutuante quando uma sessão (quest / tarefa / rotina) está ativa. Apenas **uma sessão por vez** em todo o sistema (validado no backend com HTTP 409 em conflito). Edição manual retroativa, finalização cross-midnight, refetch automático em delete/edit.

---

## Conceitos

Hierarquia: **Área → Projeto → Entregável → Quest**. Cada nível tem sua tabela própria.

- **Project** é o container estratégico. Tem deadline, prioridade, status e notes. Pode ser arquivado (entra na "gaveta" sem perder dado).
- **Deliverable** agrupa quests dentro de um projeto. Tem deadline própria. Marca-se automaticamente como `done` quando todas as quests filhas estão concluídas/canceladas.
- **Quest** é a unidade de trabalho granular. Sempre amarrada a um projeto + entregável. Não tem deadline própria — herda do entregável (e do projeto, em fallback).
- **Session** registra trabalho real numa quest/tarefa/rotina. Abertura e fechamento via play/pause/stop. Backend impede duas sessões abertas simultâneas.
- **Routine** é recorrente; gera uma sessão por ocorrência planejada.
- **Task** é one-off — diferente de quest porque não tem hierarquia (sem projeto/entregável).

---

## Stack

- **Frontend:** React 19, Vite, TypeScript, React Router 7. Estilos predominantemente inline; ícones via Lucide; editor Notion-like via BlockNote.
- **Backend:** FastAPI (Python 3.12), SQLite local via `sqlite3` stdlib — sem ORM.
- **Sem deploy** — roda na máquina do usuário. Banco em `apps/api/mainframe.db` (ignorado pelo Git).

---

## Instalação

### Caminho automático — Windows 11 (recomendado)

1. Clonar o repo:
   ```bash
   git clone https://github.com/brenobistene/mainframe.git
   cd mainframe
   ```
2. Duplo clique em **`setup.bat`** na raiz. Ele:
   - Verifica e instala **Python 3.12**, **Node.js LTS** e **Git** via `winget` (se ainda não tiverem)
   - Roda `pip install -r requirements.txt` no backend
   - Roda `npm install` no frontend
   - Cria um atalho **MAINFRAME** no Desktop com ícone customizado
3. Quando terminar, duplo clique em **MAINFRAME** no Desktop pra abrir o app.

> Se o `setup.bat` reclamar de "comando não reconhecido" logo depois de instalar Python ou Node, **feche e reabra o terminal** — o Windows só vê os PATHs novos em sessões novas. Rode o `setup.bat` de novo.

### Caminho manual

Se preferir comando por comando, estiver em Windows 10, macOS ou Linux, ou quiser visibilidade do que está sendo instalado, siga **[INSTALL.md](INSTALL.md)** com os passos detalhados (instalação de Python/Node/Git + dependências + troubleshooting).

### Rodando o app

**Windows (recomendado):** duplo clique no atalho **MAINFRAME** do Desktop, ou no `start-MainFrame.bat` da raiz. Sobe backend + frontend em duas abas do Windows Terminal e abre o Chrome em `http://localhost:5174/`.

**Manual (qualquer SO):** dois terminais:

```bash
# Terminal 1 — backend (porta 8001)
cd apps/api
python -m uvicorn main:app --reload --port 8001

# Terminal 2 — frontend (porta 5174 por default)
cd apps/web
npm run dev
```

Abrir o link que o Vite imprimir no terminal.

---

## Configuração opcional (.env)

O backend roda sem `.env`. Pra ativar a integração opcional com Google Calendar, criar `apps/api/.env`:

```env
GOOGLE_CALENDAR_ENABLED=true
GOOGLE_CALENDAR_ID=primary
# + credentials.json e token.json no mesmo diretório (OAuth2)
```

Sem essas variáveis, o app funciona normalmente sem integração externa.

---

## Status

Projeto pessoal em iteração ativa. Versão atual: **v0.8.3**. Breaking changes podem acontecer a qualquer momento — não use em ambiente onde você não seja o próprio usuário.

Issues e PRs estão abertos, mas não há compromisso de responder rápido.
