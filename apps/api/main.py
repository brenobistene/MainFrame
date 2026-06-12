"""MAINFRAME API · entrypoint enxuto.

Responsabilidade desse arquivo: criar o app FastAPI, configurar CORS,
registrar o startup (init DB + Google Calendar) e incluir os routers.

Toda lógica de negócio fica em `routers/` (rotas) e `services/` (helpers).
Pydantic models em `models/`.

Rotas de introspecção (/, /routes, /docs) ficam aqui porque precisam ler
`app.routes` em runtime — depende de todos os routers já registrados.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.routing import APIRoute

from db import init_db
from routers import (
    active_session,
    areas,
    build,
    calendar,
    compromissos,
    deliverables,
    dia,
    dia_sessions,
    finance,
    health,
    lang,
    library,
    media,
    micro_tasks,
    profile,
    project_pages,
    projects,
    quests,
    routines,
    status,
    tasks,
    time_reports,
    wishlist,
)
from services.calendar_state import (
    GOOGLE_CALENDAR_ENABLED,
    calendar_state,
    init_calendar_service,
)
from services.meta import API_VERSION, SERVICE_NAME


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Startup/shutdown handler. Substitui o @app.on_event("startup")
    (deprecated em FastAPI 0.110+). Pre-yield = startup, post-yield = shutdown.
    Não temos shutdown logic por enquanto; o `yield` libera o app pra servir."""
    init_db()
    init_calendar_service()
    yield


app = FastAPI(
    title="MAINFRAME API",
    version=API_VERSION,
    docs_url="/swagger",
    redoc_url="/redoc",
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Ordem importa só pra docs/OpenAPI; em runtime o FastAPI resolve por path.
app.include_router(status.router)  # healthcheck do servidor (/api/status)
app.include_router(areas.router)
app.include_router(projects.router)
app.include_router(project_pages.router)  # Nested Pages (caderno virtual)
app.include_router(deliverables.router)
app.include_router(quests.router)
app.include_router(routines.router)
app.include_router(tasks.router)
app.include_router(active_session.router)
app.include_router(profile.router)
app.include_router(micro_tasks.router)
app.include_router(calendar.router)
app.include_router(finance.router)
app.include_router(wishlist.router)  # Hub Finance · Wishlist (/api/finance/wishlist/*)
app.include_router(build.router)
app.include_router(health.router)  # Hub Health (/api/health/*)
app.include_router(library.router)  # Library (/api/library/*)
app.include_router(lang.router)  # Lang Lab (/api/lang/*)
app.include_router(media.router)  # Mídia local — áudios do Lang Lab (/api/media/lang/*)
app.include_router(time_reports.router)  # Time reports (/api/time-reports/*)
app.include_router(dia.router)  # /Dia pendências agregadas (/api/dia/*)
app.include_router(dia_sessions.router)  # Sessões cronometradas Mind + health_item
app.include_router(compromissos.router)  # Compromissos (/api/compromissos)


def _service_flags() -> dict:
    return {
        "google_calendar_enabled": GOOGLE_CALENDAR_ENABLED,
        "google_calendar_authenticated": calendar_state.svc is not None,
    }


def _collect_routes() -> list[dict]:
    routes: list[dict] = []
    for r in app.routes:
        if not isinstance(r, APIRoute):
            continue
        if not getattr(r, "include_in_schema", True):
            continue
        methods = sorted(m for m in r.methods if m not in {"HEAD", "OPTIONS"})
        for method in methods:
            routes.append({
                "method": method,
                "path": r.path,
                "name": r.name,
                "summary": r.summary or "",
                "tags": list(r.tags or []),
            })
    routes.sort(key=lambda x: (x["path"], x["method"]))
    return routes


def _group_for(path: str) -> str:
    parts = [p for p in path.split("/") if p]
    if not parts:
        return "root"
    if parts[0] == "api" and len(parts) > 1:
        return parts[1]
    return parts[0]


@app.get("/")
def root():
    return {
        "ok": True,
        "service": SERVICE_NAME,
        "version": API_VERSION,
        "status": "running",
        **_service_flags(),
        "docs": "/docs",
        "swagger": "/swagger",
        "redoc": "/redoc",
        "health": "/api/health",
    }


@app.get("/api/routes")
@app.get("/routes")
def list_routes():
    routes = _collect_routes()
    return {
        "service": SERVICE_NAME,
        "version": API_VERSION,
        "total": len(routes),
        "swagger": "/swagger",
        "redoc": "/redoc",
        "openapi": "/openapi.json",
        "routes": routes,
    }


@app.get("/docs", response_class=HTMLResponse, include_in_schema=False)
def docs_page():
    routes = _collect_routes()
    groups: dict[str, list[dict]] = {}
    for r in routes:
        groups.setdefault(_group_for(r["path"]), []).append(r)

    method_order = {"GET": 0, "POST": 1, "PATCH": 2, "PUT": 3, "DELETE": 4}

    group_html_parts: list[str] = []
    for group_name in sorted(groups.keys()):
        items = sorted(
            groups[group_name],
            key=lambda x: (x["path"], method_order.get(x["method"], 99)),
        )
        rows = []
        for r in items:
            label = r["summary"] or r["name"].replace("_", " ")
            rows.append(
                f'<li class="route"><span class="method m-{r["method"]}">{r["method"]}</span>'
                f'<code class="path">{r["path"]}</code>'
                f'<span class="label">{label}</span></li>'
            )
        group_html_parts.append(
            f'<section class="group"><header><h2>{group_name}</h2>'
            f'<span class="count">{len(items)}</span></header>'
            f'<ul>{"".join(rows)}</ul></section>'
        )

    groups_html = "".join(group_html_parts)
    total = len(routes)
    flags = _service_flags()
    gcal_stat = (
        "on" if flags["google_calendar_authenticated"]
        else ("enabled" if flags["google_calendar_enabled"] else "off")
    )

    html = f"""<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8">
<title>MAINFRAME API · Docs</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {{
    --bg: #0b0d12;
    --panel: #131722;
    --panel-2: #1a2030;
    --border: #242b3d;
    --text: #e6e9ef;
    --muted: #8a93a6;
    --accent: #9d6cff;
    --get: #4a9eff;
    --post: #7fb069;
    --patch: #f5a962;
    --put: #f5a962;
    --delete: #e85d3a;
  }}
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; padding: 0; background: var(--bg); color: var(--text);
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }}
  .wrap {{ max-width: 1100px; margin: 0 auto; padding: 48px 24px 80px; }}
  header.top {{ display: flex; align-items: baseline; justify-content: space-between;
    flex-wrap: wrap; gap: 16px; margin-bottom: 8px; }}
  h1 {{ font-size: 28px; margin: 0; letter-spacing: -0.02em; }}
  h1 .dot {{ color: var(--accent); }}
  .sub {{ color: var(--muted); font-size: 14px; margin-top: 4px; }}
  .stats {{ display: flex; gap: 12px; flex-wrap: wrap; margin: 20px 0 32px; }}
  .stat {{ background: var(--panel); border: 1px solid var(--border);
    border-radius: 10px; padding: 10px 14px; font-size: 13px; }}
  .stat b {{ color: var(--accent); margin-right: 6px; }}
  .links {{ display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 32px; }}
  .links a {{ color: var(--text); background: var(--panel); border: 1px solid var(--border);
    padding: 8px 14px; border-radius: 8px; text-decoration: none; font-size: 13px;
    transition: border-color .15s, background .15s; }}
  .links a:hover {{ border-color: var(--accent); background: var(--panel-2); }}
  .group {{ background: var(--panel); border: 1px solid var(--border);
    border-radius: 14px; margin-bottom: 18px; overflow: hidden; }}
  .group > header {{ display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px; background: var(--panel-2); border-bottom: 1px solid var(--border); }}
  .group h2 {{ margin: 0; font-size: 15px; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--accent); }}
  .group .count {{ color: var(--muted); font-size: 13px;
    background: rgba(255,255,255,0.04); padding: 2px 10px; border-radius: 999px; }}
  ul {{ list-style: none; margin: 0; padding: 0; }}
  .route {{ display: grid; grid-template-columns: 72px 1fr auto; gap: 14px;
    align-items: center; padding: 12px 20px; border-bottom: 1px solid var(--border); }}
  .route:last-child {{ border-bottom: none; }}
  .route:hover {{ background: rgba(157, 108, 255, 0.04); }}
  .method {{ font-size: 11px; font-weight: 700; text-align: center;
    padding: 4px 0; border-radius: 6px; letter-spacing: 0.05em; color: #0b0d12; }}
  .m-GET {{ background: var(--get); }}
  .m-POST {{ background: var(--post); }}
  .m-PATCH {{ background: var(--patch); }}
  .m-PUT {{ background: var(--put); }}
  .m-DELETE {{ background: var(--delete); color: #fff; }}
  .path {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px; }}
  .label {{ color: var(--muted); font-size: 12px; text-transform: capitalize;
    text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 320px; }}
  footer {{ margin-top: 40px; color: var(--muted); font-size: 12px; text-align: center; }}
  @media (max-width: 640px) {{
    .route {{ grid-template-columns: 64px 1fr; }}
    .label {{ grid-column: 1 / -1; text-align: left; max-width: none; }}
  }}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <h1>MAINFRAME API<span class="dot">.</span></h1>
      <div class="sub">Documentação de rotas — gerada em runtime</div>
    </div>
  </header>

  <div class="stats">
    <div class="stat"><b>versão</b>{API_VERSION}</div>
    <div class="stat"><b>rotas</b>{total}</div>
    <div class="stat"><b>grupos</b>{len(groups)}</div>
    <div class="stat"><b>gcal</b>{gcal_stat}</div>
  </div>

  <div class="links">
    <a href="/swagger">Swagger UI</a>
    <a href="/redoc">ReDoc</a>
    <a href="/openapi.json">openapi.json</a>
    <a href="/routes">routes JSON</a>
    <a href="/health">health</a>
  </div>

  {groups_html}

  <footer>{SERVICE_NAME} · v{API_VERSION}</footer>
</div>
</body>
</html>"""
    return HTMLResponse(content=html)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
