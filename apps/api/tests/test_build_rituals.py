"""Testes do agendamento de Ritual (/Build) — foco no comportamento de
ritual perdido.

Regra confirmada com o usuário (2026-06-07): um ritual perdido NÃO some nem
rola pro próximo período silenciosamente — fica pendente na data da ocorrência
que venceu até ser executado/pulado. Antes desse fix, `proxima_data` era sempre
calculada pra frente a partir de hoje, então a ocorrência vencida rolava pro
próximo mês e `dias_atraso` ficava sempre 0 (o caminho "atrasado" nunca
disparava pra nenhuma cadência).
"""
from __future__ import annotations

from datetime import date

from routers.build import _prev_occurrence, _resolve_ritual_schedule

# Junho/2026: 01 = segunda; primeiro sábado = 06 (o ritual mensal seedado usa
# "primeiro_fim_de_semana"). Julho/2026: primeiro sábado = 04.
MENSAL = {"modo": "primeiro_fim_de_semana"}
PASSADO = "2020-01-01T00:00:00"  # criada_em bem antigo → não limita atraso


# ─── _prev_occurrence ──────────────────────────────────────────────────────

def test_prev_occurrence_mensal_pega_ocorrencia_que_ja_passou():
    # Domingo 07/06 — o primeiro sábado (06/06) já passou.
    assert _prev_occurrence("mensal", MENSAL, date(2026, 6, 7)) == date(2026, 6, 6)


def test_prev_occurrence_inclui_hoje_quando_hoje_e_a_ocorrencia():
    # Sábado 06/06 É a ocorrência → conta como a mais recente <= hoje.
    assert _prev_occurrence("mensal", MENSAL, date(2026, 6, 6)) == date(2026, 6, 6)


# ─── ritual mensal perdido (o bug do usuário) ──────────────────────────────

def test_mensal_perdido_sem_execucao_fica_pendente_na_data_vencida():
    # Ontem (06/06) era o ritual mensal; hoje é 07/06 e nada foi executado.
    proxima, atraso = _resolve_ritual_schedule(
        "mensal", MENSAL, ativo=True, ultima=None,
        today=date(2026, 6, 7), criada_em=PASSADO,
    )
    # Não rola pra julho: fica pendente em 06/06, 1 dia atrasado.
    assert proxima == date(2026, 6, 6)
    assert atraso == 1


def test_mensal_perdido_continua_atrasado_com_execucao_do_mes_anterior():
    # Última execução foi a do mês passado (02/05) → slot de junho em aberto.
    proxima, atraso = _resolve_ritual_schedule(
        "mensal", MENSAL, ativo=True, ultima="2026-05-02",
        today=date(2026, 6, 7), criada_em=PASSADO,
    )
    assert proxima == date(2026, 6, 6)
    assert atraso == 1


def test_mensal_executado_hoje_limpa_atraso_e_aponta_proximo_mes():
    # Usuário recupera o ritual perdido executando hoje (07/06).
    proxima, atraso = _resolve_ritual_schedule(
        "mensal", MENSAL, ativo=True, ultima="2026-06-07",
        today=date(2026, 6, 7), criada_em=PASSADO,
    )
    assert atraso == 0
    assert proxima == date(2026, 7, 4)  # próximo primeiro sábado


def test_mensal_executado_no_dia_da_ocorrencia_aponta_proximo_mes():
    proxima, atraso = _resolve_ritual_schedule(
        "mensal", MENSAL, ativo=True, ultima="2026-06-06",
        today=date(2026, 6, 7), criada_em=PASSADO,
    )
    assert atraso == 0
    assert proxima == date(2026, 7, 4)


def test_mensal_due_hoje_nao_e_atraso():
    # Hoje É a ocorrência (sábado 06/06) e ainda não foi executado → "pra hoje".
    proxima, atraso = _resolve_ritual_schedule(
        "mensal", MENSAL, ativo=True, ultima=None,
        today=date(2026, 6, 6), criada_em=PASSADO,
    )
    assert proxima == date(2026, 6, 6)
    assert atraso == 0


def test_ritual_recem_criado_nao_nasce_atrasado():
    # Criado hoje (07/06): a ocorrência de 06/06 é anterior à criação → não
    # conta como perdida. Aponta pra próxima futura sem atraso.
    proxima, atraso = _resolve_ritual_schedule(
        "mensal", MENSAL, ativo=True, ultima=None,
        today=date(2026, 6, 7), criada_em="2026-06-07T10:00:00",
    )
    assert atraso == 0
    assert proxima == date(2026, 7, 4)


def test_ritual_inativo_nao_tem_proxima_nem_atraso():
    proxima, atraso = _resolve_ritual_schedule(
        "mensal", MENSAL, ativo=False, ultima=None,
        today=date(2026, 6, 7), criada_em=PASSADO,
    )
    assert proxima is None
    assert atraso == 0


# ─── outras cadências ───────────────────────────────────────────────────────

def test_semanal_perdido_fica_pendente_no_dia_vencido():
    # dia_semana=0 (domingo). Hoje quarta 10/06; último domingo foi 07/06.
    cfg = {"dia_semana": 0}
    proxima, atraso = _resolve_ritual_schedule(
        "semanal", cfg, ativo=True, ultima=None,
        today=date(2026, 6, 10), criada_em=PASSADO,
    )
    assert proxima == date(2026, 6, 7)
    assert atraso == 3


def test_mensal_data_fixa_perdido():
    # data_fixa dia=1: a ocorrência mais recente <= hoje (07/06) é 01/06.
    cfg = {"modo": "data_fixa", "dia": 1}
    proxima, atraso = _resolve_ritual_schedule(
        "mensal", cfg, ativo=True, ultima=None,
        today=date(2026, 6, 7), criada_em=PASSADO,
    )
    assert proxima == date(2026, 6, 1)
    assert atraso == 6


# ─── integração via API ─────────────────────────────────────────────────────

def test_api_rituais_seedados_aparecem_com_dados_de_agendamento(client):
    """GET /api/build/rituals devolve as 4 cadências hidratadas com os campos
    de agendamento que as surfaces (planner/pendências/card) consomem."""
    resp = client.get("/api/build/rituals")
    assert resp.status_code == 200
    rituais = {r["cadencia"]: r for r in resp.json()}
    assert set(rituais) == {"semanal", "mensal", "trimestral", "anual"}
    for r in rituais.values():
        assert "proxima_data" in r
        assert "dias_atraso" in r
        assert "ultima_execucao" in r
        assert r["dias_atraso"] >= 0


def test_api_ritual_mensal_executado_some_do_atraso(client):
    """Executar o ritual mensal hoje zera o atraso e empurra a próxima data
    pra frente — o lembrete de pendência deixa de aparecer."""
    today = date.today().isoformat()
    # Registra execução de hoje.
    resp = client.post(
        "/api/build/rituals/mensal/sessions",
        json={"data_executado": today, "duracao_min": 12},
    )
    assert resp.status_code == 201

    r = client.get("/api/build/rituals/mensal").json()
    assert r["ultima_execucao"] == today
    assert r["dias_atraso"] == 0
    # Próxima ocorrência fica estritamente no futuro (slot atual fechado).
    assert r["proxima_data"] is not None
    assert r["proxima_data"] > today
