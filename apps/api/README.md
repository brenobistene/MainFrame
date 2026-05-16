# MAINFRAME API (Fase 0)

Backend FastAPI reaproveitando `calendar_service.py` do projeto original.

## Setup

```bash
cd "/home/bstn/projects/MAINFRAME/apps/api"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`credentials.json` e `token.json` já estão copiados do `lifeX_bot`.

## Criar o calendário dedicado "MAINFRAME" (uma vez só)

```bash
python create_hub_calendar.py
```

Vai imprimir o `calendar_id`. Crie `.env` com:

```
GOOGLE_CALENDAR_ID=<cole aqui o id impresso>
GOOGLE_CALENDAR_IDS=primary,<cole aqui o id impresso>
GOOGLE_CALENDAR_TIMEZONE=America/Sao_Paulo
```

(`GOOGLE_CALENDAR_IDS` lista todos os calendars que vamos ler — primary tem seus eventos fixos, o novo tem os do Hub.)

## Rodar

```bash
uvicorn main:app --reload --port 8001
```

## Testar

```bash
curl http://127.0.0.1:8001/api/health
curl http://127.0.0.1:8001/api/day/today
```

Resposta esperada: `events` (o que já tem na sua agenda hoje) + `free_windows` (os buracos entre 06:00 e 22:00) + `total_free_minutes`.
