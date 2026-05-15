# Testing

Suite de testes automatizados pro Hub Quest. Frontend e backend são independentes, cada um com seu próprio framework.

## Quick start

```sh
# Frontend (Vitest)
cd apps/web
npm test                # roda uma vez
npm run test:watch      # watch mode (re-roda em save)
npm run test:ui         # interface visual no browser
npm run test:coverage   # roda + relatório de cobertura

# Backend (pytest)
cd apps/api
pytest tests/ -v        # roda uma vez
pytest tests/ --cov     # com cobertura
pytest tests/test_finance_parcelas.py -v  # arquivo específico
```

## O que está coberto

### Frontend — 54 testes em 4 arquivos

| arquivo | escopo |
|---|---|
| [datetime.test.ts](apps/web/src/utils/datetime.test.ts) | `parseTimeToMinutes` (h:mm + minutos + edge cases), `formatHMS`, `minutesToHmm` (round-trip), `sumClosedSessionsSeconds`, `parseIsoAsUtc` (tolera ISO sem Z do DB legado), `isValidDateInput` (bug clássico `0003-...`) |
| [dateRange.test.ts](apps/web/src/utils/dateRange.test.ts) | Presets today/7d/30d/all/custom, `isInRange` com edge cases de timezone |
| [quests.test.ts](apps/web/src/utils/quests.test.ts) | `effectiveQuestDeadline` — herança entregável → projeto + fallbacks |
| [block-utils.test.ts](apps/web/src/components/block-utils.test.ts) | `isBlockDocEmpty` em todas as variantes de BlockNote + texto legado |

### Backend — 25 testes em 3 arquivos

| arquivo | escopo |
|---|---|
| [test_finance_accounts.py](apps/api/tests/test_finance_accounts.py) | Saldo de conta — soma de transações, sinais corretos, centavos, conta nova começa em zero |
| [test_finance_parcelas.py](apps/api/tests/test_finance_parcelas.py) | `apply_template` — a_vista/50_50/3x/4x, **correção de drift de arredondamento na última parcela**, distribuição de datas mensais (incluindo cap em fevereiro), proteção de parcelas recebidas em re-apply |
| [test_sessions_idempotency.py](apps/api/tests/test_sessions_idempotency.py) | Idempotência de `start`/`resume` (quest/task/routine), toggle de rotina fechando sessão aberta, active_session enxergando sessão de rotina com log do dia, conflito 409 cross-entidade |

## Convenções

### Frontend (Vitest)

- Arquivos: `*.test.ts` ou `*.test.tsx` colocados **ao lado** do código testado (`datetime.ts` + `datetime.test.ts`).
- Foco: **funções puras**. Não testamos componentes React por enquanto — só lógica.
- Environment: `happy-dom` (mais leve que jsdom). Config em [vitest.config.ts](apps/web/vitest.config.ts).
- Use `describe` pra agrupar por função, `it` em PT pra descrever o caso.

### Backend (pytest)

- Arquivos: `tests/test_*.py` no diretório `apps/api/tests/`.
- Cada teste recebe um **DB SQLite isolado** num arquivo tmp via fixture `isolated_db`. Schema completo é inicializado via `db.init_db()`.
- TestClient do FastAPI é exposto via fixture `client` — chama endpoints sem subir uvicorn.
- Fixtures factory: `account_factory`, `project_factory` em [conftest.py](apps/api/tests/conftest.py) — usar pra setup rápido.
- DB é destruído entre testes (cada um começa do zero).

## CI

`.github/workflows/test.yml` roda em todo push pra main e PR:

1. **Frontend**: typecheck (`tsc --noEmit`) + vitest + production build.
2. **Backend**: pytest + coverage report.

Jobs rodam em paralelo. Falha bloqueia merge se branch protection estiver habilitado.

## Cobertura

Não buscamos % alto — buscamos cobrir **lógica crítica e bugs já capturados**.

Atual (~0.7.1):
- Backend: **19% global**, mas **>60% nos hot paths** (saldo, parcelas, sessões, active_session).
- Frontend: **~1.1% global**, mas **100% das funções puras** identificadas como críticas.

O resto do código é UI React — esses testes seriam de baixo valor (testando que `<div>` renderiza) ou caros (testes de integração com mocks pesados).

## Adicionar testes novos

**Quando vale a pena:**
- Bug encontrado em produção → escrever teste regressão antes de fixar.
- Função pura com lógica não-trivial (arredondamento, parsing, branching complexo).
- Cálculo financeiro (saldo, conversão, conciliação).
- State machine (status transitions de parcela/quest/task/routine).

**Quando NÃO vale:**
- Wrapper trivial (renderiza prop sem transformar).
- Lógica que já está testada indiretamente por outro teste de integração.
- "Cobertura visual" (que `<button>` tem texto X) — fragile e baixo valor.

## Limitações conhecidas

- **Componentes React não testados.** Para isso, adicionar `@testing-library/react` e escrever testes pra componentes com lógica complexa (drag-and-drop, BlockEditor, banner state machine).
- **Wishlist (em desenvolvimento)** — testes vão junto com o feature lá.
- **Routine recurrence** (`blocks.ts`) — lógica complexa de datas, deserve dedicated suite quando houver bug.
- **Backend warnings** de `datetime.utcnow()` deprecated e FastAPI `on_event` deprecated — limpeza pra próxima.
