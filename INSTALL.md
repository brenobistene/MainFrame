# Instalação manual do MAINFRAME

Se você não puder ou não quiser usar o `setup.bat` (ex: outro sistema operacional, ou prefere visibilidade do que está sendo instalado), siga os passos abaixo.

> Pra instalação automática no Windows 11, basta duplo clique em `setup.bat` na raiz do repo. Esse documento é só pra quem quer fazer manualmente.

---

## Programas necessários

| Programa | Versão mínima | Pra que serve |
|---|---|---|
| **Python** | 3.12 | Roda o backend (FastAPI) |
| **Node.js** | 20 LTS | Roda o frontend (Vite + React) |
| **Git** | qualquer recente | Clonar o repositório |

Sistemas operacionais testados:
- Windows 11 (caminho principal)
- Windows 10 1709+ (deve funcionar igual; precisa do `winget` se for usar setup.bat)
- macOS / Linux (caminho 100% manual — pular pra "Passos de instalação" mais abaixo)

---

## Passo 1 — Instalar os programas

### Opção A — Windows 11 com `winget` (rápido)

Abre o **PowerShell** ou **cmd** e roda os 3 comandos abaixo (cada um em sequência, esperando o anterior terminar):

```bash
winget install --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
winget install --id Git.Git --accept-source-agreements --accept-package-agreements
```

> **Importante:** depois de instalar, **feche o terminal e abra outro**. O Windows precisa de uma sessão nova pra reconhecer os comandos novos no `PATH`. Senão, qualquer `python`, `node` ou `git` vai responder "comando não encontrado".

### Opção B — Sem `winget` ou outro sistema operacional

Baixar e instalar manualmente:

- **Python 3.12+:** https://www.python.org/downloads/
  Marcar "Add Python to PATH" no instalador.
- **Node.js 20 LTS:** https://nodejs.org/
  O instalador padrão já adiciona ao PATH automaticamente.
- **Git:** https://git-scm.com/downloads

---

## Passo 2 — Clonar o repositório

Num terminal, na pasta onde você quer guardar o projeto:

```bash
git clone https://github.com/brenobistene/mainframe.git
cd mainframe
```

Confirma que entrou na pasta certa:
```bash
ls
# Deve listar: apps, README.md, setup.bat, start-hub.bat, tools, ...
```

---

## Passo 3 — Instalar dependências do backend

Dentro da pasta do projeto:

```bash
cd apps/api
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cd ../..
```

Isso instala:
- `fastapi` — framework web
- `uvicorn[standard]` — servidor HTTP
- `python-dotenv` — leitura do `.env` opcional
- `google-api-python-client` + `google-auth*` — Google Calendar (opcional, só usado se você habilitar)

---

## Passo 4 — Instalar dependências do frontend

```bash
cd apps/web
npm install
cd ../..
```

`npm install` baixa ~600 pacotes (React 19, Vite, BlockNote, etc) na pasta `apps/web/node_modules`. Pode demorar 1-3 minutos na primeira vez.

---

## Passo 5 — Rodar o app

Você precisa de **2 terminais abertos simultaneamente** (um pro backend, um pro frontend).

### Terminal 1 — backend

```bash
cd apps/api
python -m uvicorn main:app --reload --port 8001
```

Deve imprimir algo como `Uvicorn running on http://0.0.0.0:8001`. Não feche esse terminal.

### Terminal 2 — frontend

```bash
cd apps/web
npm run dev
```

Deve imprimir um link tipo `Local: http://localhost:5174/`. Abrir esse link no navegador.

> No Windows, há uma alternativa: duplo clique em `start-hub.bat` na raiz do repo. Ele abre 2 abas do Windows Terminal automaticamente e abre o Chrome no link. Vale o esforço de configurar uma vez.

---

## Configuração opcional — Google Calendar

Por padrão, a integração com Google Calendar está **desligada** e o app funciona normalmente sem ela. Se quiser ativar:

1. Criar projeto OAuth2 no Google Cloud Console
2. Baixar `credentials.json` e colocar em `apps/api/`
3. Criar `apps/api/.env` com:

```env
GOOGLE_CALENDAR_ENABLED=true
GOOGLE_CALENDAR_ID=primary
```

4. Reiniciar o backend. Na primeira execução abrirá um browser pra autorizar o acesso.

> `credentials.json`, `token.json` e `.env` estão no `.gitignore` — nunca vão pro repositório.

---

## Problemas comuns

**`'python' não é reconhecido como comando interno`**
→ Você instalou o Python mas o terminal atual não vê. Feche e abra outro terminal. Se persistir, o instalador não adicionou ao PATH — reinstale marcando "Add to PATH".

**`'npm' não é reconhecido como comando interno`**
→ Mesmo cenário, mas pra Node.js. Feche/abre o terminal.

**`Address already in use` na porta 8001 ou 5174**
→ Outro processo (uvicorn antigo? Vite anterior?) está segurando a porta. No Windows:
```bash
netstat -ano | findstr :8001
taskkill /PID <numero> /F
```

**`pip install` falha em algum pacote**
→ Verifica que tá usando Python 3.12+: `python --version`. Se for menor, atualize.

**`npm install` muito lento ou trava**
→ Antivírus corporativo pode estar inspecionando cada arquivo do `node_modules`. Tenta excluir a pasta do projeto da varredura, ou usar a rede de casa pra primeira instalação.

---

## Atualizar pra última versão

Sempre que quiser puxar atualizações:

```bash
cd mainframe
git pull
cd apps/api && python -m pip install -r requirements.txt && cd ../..
cd apps/web && npm install && cd ../..
```

(O `git pull` só atualiza arquivos do código; `pip` e `npm install` reaplicam dependências caso alguma tenha mudado.)
