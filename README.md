# MAINFRAME

App pessoal de produtividade single-user — organiza projetos, tarefas, rotinas e sessões de tempo por áreas da vida. Roda 100% local, sem deploy, sem autenticação, sem nuvem.

É um sistema feito pra quem quer ter o próprio painel de controle em vez de espalhar trabalho entre Notion, To-do, planilha, calendário e quatro apps diferentes. Tudo num lugar só, cada entidade com seu propósito claro.

---

## O que tem dentro

**Dashboard** — visão geral da semana/mês. Status híbrido dos projetos (tudo em dia / em risco / atrasado), quanto você precisa trabalhar hoje pra se manter em dia, e o item mais urgente.

**Dia** — planejamento do dia atual. Arrasta quests, tarefas e rotinas pros períodos (manhã / tarde / noite). Timer de sessão por item, banner flutuante enquanto uma sessão está ativa, busca textual no drawer de planejar.

**Calendário** — visões de dia, semana, mês e ano. Eventos sobrepostos exibidos lado a lado (estilo Google Calendar), altura proporcional à duração real, marcas de meia hora no zoom. Deadlines de projetos e entregáveis distribuídos nas datas. Blocos improdutivos configuráveis.

**Quests** — lista agrupada dos projetos por área, com suas subtarefas. Entregáveis drag-and-drop reordenáveis, inline editing, descrição em editor estilo Notion (headings, bullets, checklists, divider).

**Áreas** — áreas de vida totalmente editáveis. Cada área tem cor própria que pinta os elementos relacionados no app todo. Cards de projeto com barra de progresso (% de entregáveis concluídos), botões de finalizar / arquivar / excluir.

**Tarefas** — to-dos soltos não amarrados a projetos. Agendáveis por data e hora.

**Rotinas** — hábitos recorrentes (diário, dias úteis, semanal, mensal). Geram sessões no calendário automaticamente.

**Micro Dump** — inbox pra ideias soltas que não viraram nada ainda. Promove pra tarefa, quest ou rotina.

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

**Windows (recomendado):** duplo clique no atalho **MAINFRAME** do Desktop, ou no `start-hub.bat` da raiz. Sobe backend + frontend em duas abas do Windows Terminal e abre o Chrome em `http://localhost:5174/`.

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

Projeto pessoal em iteração ativa. Versão atual: **v0.8.1**. Breaking changes podem acontecer a qualquer momento — não use em ambiente onde você não seja o próprio usuário.

Issues e PRs estão abertos, mas não há compromisso de responder rápido.
