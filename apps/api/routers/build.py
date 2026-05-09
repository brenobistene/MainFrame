"""Endpoints do módulo /Build (Sistema de Metas) — v0.

Cobre Propósito, Princípios negativos, Visão (versionada), Settings.
Demais entidades (Meta, Sprint, Guardrail, Ritual) entram em v0.5+.
"""
from __future__ import annotations

import json
import uuid
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from db import get_conn
from services.health_metrics import calculate_metric, get_metric_meta
from models.build import (
    ClassifyProjectBody,
    GoalAreaLink,
    GoalAreasUpdate,
    GoalCreate,
    GoalDependencyCreate,
    GoalDependencyOut,
    GoalOut,
    GoalProgressUpdate,
    GoalUpdate,
    GuardrailCreate,
    GuardrailEvaluation,
    GuardrailOut,
    GuardrailUpdate,
    LinkProjectGoalBody,
    PrincipleCreate,
    PrincipleOut,
    PrincipleUpdate,
    ProjectAlignmentOut,
    PurposeOut,
    PurposeUpdate,
    RitualOut,
    RitualScheduleItem,
    RitualSessionCreate,
    RitualSessionOut,
    RitualUpdate,
    SettingsOut,
    SettingsUpdate,
    SprintCreate,
    SprintOut,
    SprintUpdate,
    VisionOut,
    VisionUpdate,
    VisionVersion,
)
from services.utils import utcnow_iso_z

router = APIRouter(prefix="/api/build", tags=["build"])


# ─── Propósito ────────────────────────────────────────────────────────────

@router.get("/purpose", response_model=PurposeOut)
def get_purpose():
    with get_conn() as conn:
        row = conn.execute(
            "SELECT texto, criado_em, revisado_em FROM build_purpose WHERE id = 1"
        ).fetchone()
        if not row:
            # init_db deveria ter inserido. Cria fallback aqui pra resiliência.
            now = utcnow_iso_z()
            conn.execute(
                "INSERT INTO build_purpose(id, texto, criado_em, revisado_em) "
                "VALUES (1, '', ?, ?)",
                (now, now),
            )
            conn.commit()
            return {"texto": "", "criado_em": now, "revisado_em": now}
    return dict(row)


@router.put("/purpose", response_model=PurposeOut)
def update_purpose(body: PurposeUpdate):
    """Edita o texto do Propósito. Atualiza `revisado_em`."""
    revisado_em = utcnow_iso_z()
    with get_conn() as conn:
        conn.execute(
            "UPDATE build_purpose SET texto = ?, revisado_em = ? WHERE id = 1",
            (body.texto, revisado_em),
        )
        conn.commit()
        row = conn.execute(
            "SELECT texto, criado_em, revisado_em FROM build_purpose WHERE id = 1"
        ).fetchone()
    return dict(row)


# ─── Princípios negativos (anti-metas) ────────────────────────────────────

@router.get("/principles", response_model=list[PrincipleOut])
def list_principles(include_archived: bool = False):
    sql = (
        "SELECT id, texto, ordem, arquivado, criado_em "
        "FROM build_purpose_principle "
        "WHERE proposito_id = 1"
    )
    if not include_archived:
        sql += " AND arquivado = 0"
    sql += " ORDER BY ordem ASC, id ASC"
    with get_conn() as conn:
        rows = conn.execute(sql).fetchall()
    return [
        {**dict(r), "arquivado": bool(r["arquivado"])}
        for r in rows
    ]


@router.post("/principles", response_model=PrincipleOut, status_code=201)
def create_principle(body: PrincipleCreate):
    with get_conn() as conn:
        # Se ordem não foi passada, vai pro fim da lista (ativos)
        if body.ordem is None:
            row = conn.execute(
                "SELECT COALESCE(MAX(ordem), -1) + 1 AS next_ordem "
                "FROM build_purpose_principle "
                "WHERE proposito_id = 1 AND arquivado = 0"
            ).fetchone()
            ordem = row["next_ordem"]
        else:
            ordem = body.ordem
        cursor = conn.execute(
            "INSERT INTO build_purpose_principle(proposito_id, texto, ordem, criado_em) "
            "VALUES (1, ?, ?, ?)",
            (body.texto, ordem, utcnow_iso_z()),
        )
        new_id = cursor.lastrowid
        conn.commit()
        row = conn.execute(
            "SELECT id, texto, ordem, arquivado, criado_em "
            "FROM build_purpose_principle WHERE id = ?",
            (new_id,),
        ).fetchone()
    return {**dict(row), "arquivado": bool(row["arquivado"])}


@router.patch("/principles/{principle_id}", response_model=PrincipleOut)
def update_principle(principle_id: int, body: PrincipleUpdate):
    fields: dict = {}
    for name in body.model_fields_set:
        val = getattr(body, name)
        # arquivado vira 0/1 no SQLite
        fields[name] = int(val) if isinstance(val, bool) else val
    if not fields:
        raise HTTPException(400, detail="Nothing to update")
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE build_purpose_principle SET {set_clause} WHERE id = ?",
            [*fields.values(), principle_id],
        )
        if conn.total_changes == 0:
            raise HTTPException(404, detail="Princípio não encontrado")
        conn.commit()
        row = conn.execute(
            "SELECT id, texto, ordem, arquivado, criado_em "
            "FROM build_purpose_principle WHERE id = ?",
            (principle_id,),
        ).fetchone()
    return {**dict(row), "arquivado": bool(row["arquivado"])}


@router.delete("/principles/{principle_id}", status_code=204)
def delete_principle(principle_id: int):
    """Soft-delete: marca arquivado=1. Preserva histórico."""
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE build_purpose_principle SET arquivado = 1 WHERE id = ? AND arquivado = 0",
            (principle_id,),
        )
        if cur.rowcount == 0:
            # Pode ser 404 ou já arquivado — ambos retornam 204 (idempotente)
            existing = conn.execute(
                "SELECT 1 FROM build_purpose_principle WHERE id = ?",
                (principle_id,),
            ).fetchone()
            if not existing:
                raise HTTPException(404, detail="Princípio não encontrado")
        conn.commit()


# ─── Visão (3 anos, versionada) ───────────────────────────────────────────

@router.get("/vision", response_model=Optional[VisionOut])
def get_active_vision():
    """Retorna a Visão ativa, ou null se nenhuma foi criada ainda."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, texto, data_alvo, ativa, criada_em, arquivada_em, motivo_arquivamento "
            "FROM build_vision WHERE ativa = 1 LIMIT 1"
        ).fetchone()
    if not row:
        return None
    return {**dict(row), "ativa": bool(row["ativa"])}


@router.get("/vision/history", response_model=list[VisionOut])
def list_archived_visions():
    """Retorna Visões arquivadas em ordem cronológica reversa."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, texto, data_alvo, ativa, criada_em, arquivada_em, motivo_arquivamento "
            "FROM build_vision WHERE ativa = 0 ORDER BY arquivada_em DESC NULLS LAST, id DESC"
        ).fetchall()
    return [{**dict(r), "ativa": bool(r["ativa"])} for r in rows]


@router.post("/vision/version", response_model=VisionOut, status_code=201)
def version_vision(body: VisionVersion):
    """Cria nova Visão e arquiva a anterior — operação atômica.

    - Se existe Visão ativa, vira ativa=0 + arquivada_em + motivo
    - Nova Visão entra como ativa=1
    """
    now = utcnow_iso_z()
    with get_conn() as conn:
        # Arquiva a ativa atual (se existir)
        conn.execute(
            "UPDATE build_vision SET ativa = 0, arquivada_em = ?, motivo_arquivamento = ? "
            "WHERE ativa = 1",
            (now, body.motivo_arquivamento),
        )
        cur = conn.execute(
            "INSERT INTO build_vision(texto, data_alvo, ativa, criada_em) "
            "VALUES (?, ?, 1, ?)",
            (body.texto, body.data_alvo, now),
        )
        new_id = cur.lastrowid
        conn.commit()
        row = conn.execute(
            "SELECT id, texto, data_alvo, ativa, criada_em, arquivada_em, motivo_arquivamento "
            "FROM build_vision WHERE id = ?",
            (new_id,),
        ).fetchone()
    return {**dict(row), "ativa": bool(row["ativa"])}


@router.patch("/vision", response_model=VisionOut)
def update_active_vision(body: VisionUpdate):
    """Ajustes pequenos (typo, refinamento de redação) na Visão ativa
    sem versionar. Pra mudança de direção real, usar /vision/version."""
    fields: dict = {}
    for name in body.model_fields_set:
        fields[name] = getattr(body, name)
    if not fields:
        raise HTTPException(400, detail="Nothing to update")
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE build_vision SET {set_clause} WHERE ativa = 1",
            [*fields.values()],
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Nenhuma Visão ativa pra editar")
        conn.commit()
        row = conn.execute(
            "SELECT id, texto, data_alvo, ativa, criada_em, arquivada_em, motivo_arquivamento "
            "FROM build_vision WHERE ativa = 1"
        ).fetchone()
    return {**dict(row), "ativa": bool(row["ativa"])}


# ─── Settings ─────────────────────────────────────────────────────────────

@router.get("/settings", response_model=SettingsOut)
def get_settings():
    with get_conn() as conn:
        row = conn.execute(
            "SELECT max_metas_ativas, default_dependency_threshold_pct, "
            "metric_data_age_threshold_days, dashboard_card_visivel, atualizado_em "
            "FROM build_settings WHERE id = 1"
        ).fetchone()
    return {
        **dict(row),
        "dashboard_card_visivel": bool(row["dashboard_card_visivel"]),
    }


# ─── Meta ─────────────────────────────────────────────────────────────────

GOAL_COLUMNS = (
    "id, titulo, descricao, horizon, data_inicio, data_alvo, status, "
    "criterion_type, criterion_target_value, criterion_current_value, "
    "criterion_metric_slug, criterion_metric_item_id, is_foundational, "
    "requires_threshold_pct, criada_em, atualizada_em, concluida_em, "
    "abandonada_em"
)


def _hydrate_goal(conn, row) -> dict:
    """Adiciona lista de áreas + converte bool fields. Conexão reaproveitada
    pra evitar overhead em listagens."""
    areas = conn.execute(
        "SELECT area_slug, is_primary FROM build_goal_area WHERE goal_id = ? "
        "ORDER BY is_primary DESC, area_slug ASC",
        (row["id"],),
    ).fetchall()
    return {
        **dict(row),
        "is_foundational": bool(row["is_foundational"]),
        "areas": [
            {"area_slug": a["area_slug"], "is_primary": bool(a["is_primary"])}
            for a in areas
        ],
    }


def _validate_areas(conn, areas: list[GoalAreaLink]) -> None:
    """Valida regras: exatamente 1 primária; todas existem em `areas`."""
    if sum(1 for a in areas if a.is_primary) != 1:
        raise HTTPException(
            422,
            detail="Meta deve ter exatamente 1 área primária (is_primary=true)",
        )
    if len({a.area_slug for a in areas}) != len(areas):
        raise HTTPException(422, detail="Áreas duplicadas no payload")
    for a in areas:
        exists = conn.execute(
            "SELECT 1 FROM areas WHERE slug = ?", (a.area_slug,)
        ).fetchone()
        if not exists:
            raise HTTPException(
                422, detail=f"Área '{a.area_slug}' não existe"
            )


@router.get("/goals", response_model=list[GoalOut])
def list_goals(status: Optional[str] = None):
    """Lista Metas. Filtro opcional por status. Inclui áreas hidratadas."""
    sql = f"SELECT {GOAL_COLUMNS} FROM build_goal WHERE 1=1"
    params: list = []
    if status is not None:
        sql += " AND status = ?"
        params.append(status)
    sql += " ORDER BY is_foundational DESC, criada_em ASC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_hydrate_goal(conn, r) for r in rows]


@router.get("/goals/{goal_id}", response_model=GoalOut)
def get_goal(goal_id: str):
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT {GOAL_COLUMNS} FROM build_goal WHERE id = ?", (goal_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="Meta não encontrada")
        return _hydrate_goal(conn, row)


@router.post("/goals", response_model=GoalOut, status_code=201)
def create_goal(body: GoalCreate):
    """Cria Meta nova com áreas. Valida limite duro de Metas ativas."""
    # Limite vem de build_settings — configurável, sem hardcoded
    with get_conn() as conn:
        max_ativas = conn.execute(
            "SELECT max_metas_ativas FROM build_settings WHERE id = 1"
        ).fetchone()["max_metas_ativas"]
        ativas = conn.execute(
            "SELECT COUNT(*) AS n FROM build_goal WHERE status = 'ativa'"
        ).fetchone()["n"]
        if ativas >= max_ativas:
            raise HTTPException(
                409,
                detail=f"Limite de {max_ativas} Metas ativas atingido. "
                "Conclua, abandone ou pause uma Meta antes de criar outra.",
            )

        _validate_areas(conn, body.areas)

        if body.criterion_type == "numeric" and body.criterion_target_value is None:
            raise HTTPException(
                422,
                detail="Critério numérico exige criterion_target_value",
            )

        # requires_threshold_pct: snapshot do default das settings se não passou
        threshold = body.requires_threshold_pct
        if threshold is None:
            threshold = conn.execute(
                "SELECT default_dependency_threshold_pct FROM build_settings WHERE id = 1"
            ).fetchone()["default_dependency_threshold_pct"]

        goal_id = str(uuid.uuid4())[:8]
        now = utcnow_iso_z()
        conn.execute(
            "INSERT INTO build_goal("
            "id, titulo, descricao, horizon, data_inicio, data_alvo, status, "
            "criterion_type, criterion_target_value, is_foundational, "
            "requires_threshold_pct, criada_em, atualizada_em"
            ") VALUES (?, ?, ?, ?, ?, ?, 'ativa', ?, ?, ?, ?, ?, ?)",
            (
                goal_id,
                body.titulo,
                body.descricao,
                body.horizon,
                body.data_inicio,
                body.data_alvo,
                body.criterion_type,
                body.criterion_target_value,
                int(body.is_foundational),
                threshold,
                now,
                now,
            ),
        )
        for a in body.areas:
            conn.execute(
                "INSERT INTO build_goal_area(goal_id, area_slug, is_primary) "
                "VALUES (?, ?, ?)",
                (goal_id, a.area_slug, int(a.is_primary)),
            )
        conn.commit()
        row = conn.execute(
            f"SELECT {GOAL_COLUMNS} FROM build_goal WHERE id = ?", (goal_id,)
        ).fetchone()
        return _hydrate_goal(conn, row)


@router.patch("/goals/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: str, body: GoalUpdate):
    """Edita Meta. Não mexe nas áreas — pra isso, use PUT /goals/{id}/areas."""
    fields: dict = {}
    for name in body.model_fields_set:
        val = getattr(body, name)
        fields[name] = int(val) if isinstance(val, bool) else val

    if not fields:
        raise HTTPException(400, detail="Nothing to update")

    # Se está mudando status pra 'concluida' ou 'abandonada', preencher timestamp
    new_status = fields.get("status")
    now = utcnow_iso_z()
    if new_status == "concluida":
        fields["concluida_em"] = now
    elif new_status == "abandonada":
        fields["abandonada_em"] = now
    elif new_status == "ativa":
        # Reativar limpa timestamps de fechamento
        fields["concluida_em"] = None
        fields["abandonada_em"] = None
    fields["atualizada_em"] = now

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE build_goal SET {set_clause} WHERE id = ?",
            [*fields.values(), goal_id],
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Meta não encontrada")

        # Validar limite de ativas se reativando
        if new_status == "ativa":
            max_ativas = conn.execute(
                "SELECT max_metas_ativas FROM build_settings WHERE id = 1"
            ).fetchone()["max_metas_ativas"]
            ativas = conn.execute(
                "SELECT COUNT(*) AS n FROM build_goal WHERE status = 'ativa'"
            ).fetchone()["n"]
            if ativas > max_ativas:
                raise HTTPException(
                    409,
                    detail=f"Reativar excederia limite de {max_ativas} Metas ativas.",
                )

        conn.commit()
        row = conn.execute(
            f"SELECT {GOAL_COLUMNS} FROM build_goal WHERE id = ?", (goal_id,)
        ).fetchone()
        return _hydrate_goal(conn, row)


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: str):
    """Hard delete. Pra "encerrar" uma Meta sem perder histórico, use
    PATCH com status='concluida' ou 'abandonada' (preferido). Esse endpoint
    é pra correção/teste."""
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM build_goal WHERE id = ?", (goal_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Meta não encontrada")
        conn.commit()


@router.put("/goals/{goal_id}/areas", response_model=GoalOut)
def replace_goal_areas(goal_id: str, body: GoalAreasUpdate):
    """Substitui a lista inteira de áreas da Meta atomicamente."""
    with get_conn() as conn:
        exists = conn.execute(
            "SELECT 1 FROM build_goal WHERE id = ?", (goal_id,)
        ).fetchone()
        if not exists:
            raise HTTPException(404, detail="Meta não encontrada")

        _validate_areas(conn, body.areas)

        conn.execute(
            "DELETE FROM build_goal_area WHERE goal_id = ?", (goal_id,)
        )
        for a in body.areas:
            conn.execute(
                "INSERT INTO build_goal_area(goal_id, area_slug, is_primary) "
                "VALUES (?, ?, ?)",
                (goal_id, a.area_slug, int(a.is_primary)),
            )
        conn.execute(
            "UPDATE build_goal SET atualizada_em = ? WHERE id = ?",
            (utcnow_iso_z(), goal_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {GOAL_COLUMNS} FROM build_goal WHERE id = ?", (goal_id,)
        ).fetchone()
        return _hydrate_goal(conn, row)


# ─── Projetos × Metas (alinhamento + drift + classificação) ──────────────


def _alignment_status(goal_count: int, classification: Optional[str]) -> str:
    if goal_count > 0:
        return "aligned"
    if classification is not None:
        return "classified"
    return "drift"


@router.get("/projects/alignment", response_model=list[ProjectAlignmentOut])
def list_projects_alignment(
    drift_only: bool = False,
    goal_id: Optional[str] = None,
    include_archived: bool = False,
):
    """Lista projetos com status de alinhamento.

    - `drift_only=true`: só projetos em drift (sem goal AND sem classification)
    - `goal_id=<id>`: só projetos vinculados a essa Meta
    - `include_archived=false` (default): exclui projetos com archived_at
    """
    sql = (
        "SELECT p.id, p.title, p.area_slug, p.status, p.archived_at, "
        "       p.classification, p.classified_at, "
        "       (SELECT GROUP_CONCAT(goal_id, '|') "
        "          FROM build_project_goal "
        "         WHERE project_id = p.id) AS goal_ids_concat "
        "FROM projects p WHERE 1=1"
    )
    params: list = []
    if not include_archived:
        sql += " AND p.archived_at IS NULL"
    if goal_id is not None:
        sql += (
            " AND EXISTS ("
            "   SELECT 1 FROM build_project_goal "
            "    WHERE project_id = p.id AND goal_id = ?"
            " )"
        )
        params.append(goal_id)
    sql += " ORDER BY p.created_at ASC"

    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()

    out = []
    for r in rows:
        ids_concat = r["goal_ids_concat"] or ""
        goal_ids = [g for g in ids_concat.split("|") if g]
        align = _alignment_status(len(goal_ids), r["classification"])
        if drift_only and align != "drift":
            continue
        out.append(
            {
                "id": r["id"],
                "title": r["title"],
                "area_slug": r["area_slug"],
                "status": r["status"],
                "archived_at": r["archived_at"],
                "classification": r["classification"],
                "classified_at": r["classified_at"],
                "goal_ids": goal_ids,
                "alignment_status": align,
            }
        )
    return out


@router.post(
    "/projects/{project_id}/goals",
    response_model=ProjectAlignmentOut,
    status_code=201,
)
def link_project_to_goal(project_id: str, body: LinkProjectGoalBody):
    """Vincula um Projeto a uma Meta. Idempotente — re-vincular não dá erro."""
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM projects WHERE id = ?", (project_id,)
        ).fetchone():
            raise HTTPException(404, detail="Projeto não encontrado")
        if not conn.execute(
            "SELECT 1 FROM build_goal WHERE id = ?", (body.goal_id,)
        ).fetchone():
            raise HTTPException(404, detail="Meta não encontrada")
        conn.execute(
            "INSERT OR IGNORE INTO build_project_goal(project_id, goal_id) "
            "VALUES (?, ?)",
            (project_id, body.goal_id),
        )
        conn.commit()
    return _get_project_alignment(project_id)


@router.delete(
    "/projects/{project_id}/goals/{goal_id}",
    response_model=ProjectAlignmentOut,
)
def unlink_project_from_goal(project_id: str, goal_id: str):
    """Desvincula. Se Projeto não existe ou já não estava vinculado, 404."""
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM build_project_goal "
            "WHERE project_id = ? AND goal_id = ?",
            (project_id, goal_id),
        )
        if cur.rowcount == 0:
            # Distingue "projeto não existe" de "vínculo não existia"
            project_exists = conn.execute(
                "SELECT 1 FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if not project_exists:
                raise HTTPException(404, detail="Projeto não encontrado")
            raise HTTPException(404, detail="Vínculo não existe")
        conn.commit()
    return _get_project_alignment(project_id)


@router.patch(
    "/projects/{project_id}/classification",
    response_model=ProjectAlignmentOut,
)
def classify_project(project_id: str, body: ClassifyProjectBody):
    """Define (ou limpa, com null) a classificação do Projeto sem Meta.

    Valores: 'manutencao' | 'reativo' | 'exploratorio' | null.

    Setar null + sem goals vinculados = volta a estado de drift.
    """
    classified_at = utcnow_iso_z() if body.classification is not None else None
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE projects SET classification = ?, classified_at = ? WHERE id = ?",
            (body.classification, classified_at, project_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Projeto não encontrado")
        conn.commit()
    return _get_project_alignment(project_id)


def _get_project_alignment(project_id: str) -> dict:
    """Retorna alignment de 1 projeto. Auxiliar pros endpoints de
    link/unlink/classify devolverem o estado novo."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, title, area_slug, status, archived_at, "
            "       classification, classified_at "
            "FROM projects WHERE id = ?",
            (project_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="Projeto não encontrado")
        goals = conn.execute(
            "SELECT goal_id FROM build_project_goal WHERE project_id = ?",
            (project_id,),
        ).fetchall()
    goal_ids = [g["goal_id"] for g in goals]
    return {
        "id": row["id"],
        "title": row["title"],
        "area_slug": row["area_slug"],
        "status": row["status"],
        "archived_at": row["archived_at"],
        "classification": row["classification"],
        "classified_at": row["classified_at"],
        "goal_ids": goal_ids,
        "alignment_status": _alignment_status(len(goal_ids), row["classification"]),
    }


# ─── Sprint (sub-unidade de Meta longa) ───────────────────────────────────


SPRINT_COLUMNS = (
    "id, goal_id, numero, data_inicio, data_fim, foco, status, "
    "criado_em, atualizado_em"
)


@router.get("/sprints", response_model=list[SprintOut])
def list_sprints(goal_id: Optional[str] = None):
    sql = f"SELECT {SPRINT_COLUMNS} FROM build_sprint WHERE 1=1"
    params: list = []
    if goal_id is not None:
        sql += " AND goal_id = ?"
        params.append(goal_id)
    sql += " ORDER BY goal_id, numero ASC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


@router.post("/sprints", response_model=SprintOut, status_code=201)
def create_sprint(body: SprintCreate):
    """Cria Sprint dentro de Meta anual. Rejeita se Meta é trimestral."""
    with get_conn() as conn:
        goal = conn.execute(
            "SELECT horizon FROM build_goal WHERE id = ?", (body.goal_id,)
        ).fetchone()
        if not goal:
            raise HTTPException(404, detail="Meta não encontrada")
        if goal["horizon"] == "trimestral":
            raise HTTPException(
                422,
                detail="Sprint só faz sentido em Meta anual. Meta trimestral "
                "já é o sprint dela mesma.",
            )

        # Auto-numero: max+1 dos sprints existentes da Meta
        if body.numero is None:
            row = conn.execute(
                "SELECT COALESCE(MAX(numero), 0) + 1 AS next_num "
                "FROM build_sprint WHERE goal_id = ?",
                (body.goal_id,),
            ).fetchone()
            numero = row["next_num"]
        else:
            numero = body.numero

        sprint_id = str(uuid.uuid4())[:8]
        now = utcnow_iso_z()
        conn.execute(
            "INSERT INTO build_sprint("
            "id, goal_id, numero, data_inicio, data_fim, foco, status, "
            "criado_em, atualizado_em"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                sprint_id,
                body.goal_id,
                numero,
                body.data_inicio,
                body.data_fim,
                body.foco,
                body.status or "planejado",
                now,
                now,
            ),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {SPRINT_COLUMNS} FROM build_sprint WHERE id = ?",
            (sprint_id,),
        ).fetchone()
    return dict(row)


@router.patch("/sprints/{sprint_id}", response_model=SprintOut)
def update_sprint(sprint_id: str, body: SprintUpdate):
    fields: dict = {}
    for name in body.model_fields_set:
        fields[name] = getattr(body, name)
    if not fields:
        raise HTTPException(400, detail="Nothing to update")
    fields["atualizado_em"] = utcnow_iso_z()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE build_sprint SET {set_clause} WHERE id = ?",
            [*fields.values(), sprint_id],
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Sprint não encontrado")
        conn.commit()
        row = conn.execute(
            f"SELECT {SPRINT_COLUMNS} FROM build_sprint WHERE id = ?",
            (sprint_id,),
        ).fetchone()
    return dict(row)


@router.delete("/sprints/{sprint_id}", status_code=204)
def delete_sprint(sprint_id: str):
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM build_sprint WHERE id = ?", (sprint_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Sprint não encontrado")
        conn.commit()


# ─── Dependência entre Metas ──────────────────────────────────────────────


def _has_cycle(conn, goal_id: str, requires_goal_id: str) -> bool:
    """Detecta ciclo: adicionar (goal_id depende de requires_goal_id) cria
    ciclo se requires_goal_id já depende (transitivamente) de goal_id.

    DFS a partir de requires_goal_id seguindo edges de dependência.
    """
    if goal_id == requires_goal_id:
        return True
    visited = set()
    stack = [requires_goal_id]
    while stack:
        current = stack.pop()
        if current == goal_id:
            return True
        if current in visited:
            continue
        visited.add(current)
        rows = conn.execute(
            "SELECT requires_goal_id FROM build_goal_dependency WHERE goal_id = ?",
            (current,),
        ).fetchall()
        stack.extend(r["requires_goal_id"] for r in rows)
    return False


@router.get(
    "/goals/{goal_id}/dependencies", response_model=list[GoalDependencyOut]
)
def list_goal_dependencies(goal_id: str):
    """Lista as Metas das quais essa Meta depende (pré-requisitos).

    Cada item inclui status atual da required + flag is_satisfied.
    """
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM build_goal WHERE id = ?", (goal_id,)
        ).fetchone():
            raise HTTPException(404, detail="Meta não encontrada")
        rows = conn.execute(
            "SELECT d.requires_goal_id, g.titulo, g.status "
            "FROM build_goal_dependency d "
            "JOIN build_goal g ON g.id = d.requires_goal_id "
            "WHERE d.goal_id = ?",
            (goal_id,),
        ).fetchall()
    return [
        {
            "requires_goal_id": r["requires_goal_id"],
            "requires_titulo": r["titulo"],
            "requires_status": r["status"],
            "is_satisfied": r["status"] == "concluida",
        }
        for r in rows
    ]


@router.post(
    "/goals/{goal_id}/dependencies",
    response_model=GoalDependencyOut,
    status_code=201,
)
def add_goal_dependency(goal_id: str, body: GoalDependencyCreate):
    """Adiciona dependência. Valida sem-ciclos (DFS)."""
    if goal_id == body.requires_goal_id:
        raise HTTPException(422, detail="Meta não pode depender de si mesma")

    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM build_goal WHERE id = ?", (goal_id,)
        ).fetchone():
            raise HTTPException(404, detail="Meta não encontrada")
        req = conn.execute(
            "SELECT id, titulo, status FROM build_goal WHERE id = ?",
            (body.requires_goal_id,),
        ).fetchone()
        if not req:
            raise HTTPException(
                404, detail="Meta pré-requisito não encontrada"
            )

        if _has_cycle(conn, goal_id, body.requires_goal_id):
            raise HTTPException(
                422,
                detail="Adicionar essa dependência criaria um ciclo de Metas",
            )

        conn.execute(
            "INSERT OR IGNORE INTO build_goal_dependency"
            "(goal_id, requires_goal_id) VALUES (?, ?)",
            (goal_id, body.requires_goal_id),
        )
        conn.commit()

    return {
        "requires_goal_id": req["id"],
        "requires_titulo": req["titulo"],
        "requires_status": req["status"],
        "is_satisfied": req["status"] == "concluida",
    }


@router.delete(
    "/goals/{goal_id}/dependencies/{requires_goal_id}", status_code=204
)
def remove_goal_dependency(goal_id: str, requires_goal_id: str):
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM build_goal_dependency "
            "WHERE goal_id = ? AND requires_goal_id = ?",
            (goal_id, requires_goal_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Dependência não encontrada")
        conn.commit()


# ─── Progresso (v1 — digitado manual; v2 vem de Health) ───────────────────

@router.patch("/goals/{goal_id}/progress", response_model=GoalOut)
def update_goal_progress(goal_id: str, body: GoalProgressUpdate):
    """Atualiza criterion_current_value manualmente (v1, pré-Health).

    Só faz sentido pra Meta com criterion_type='numeric'.
    """
    with get_conn() as conn:
        row = conn.execute(
            "SELECT criterion_type FROM build_goal WHERE id = ?", (goal_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="Meta não encontrada")
        if row["criterion_type"] != "numeric":
            raise HTTPException(
                422,
                detail="Progresso digitado só se aplica a Meta com critério numérico",
            )
        conn.execute(
            "UPDATE build_goal SET criterion_current_value = ?, "
            "atualizada_em = ? WHERE id = ?",
            (body.criterion_current_value, utcnow_iso_z(), goal_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {GOAL_COLUMNS} FROM build_goal WHERE id = ?", (goal_id,)
        ).fetchone()
        return _hydrate_goal(conn, row)


# ─── Ritual ───────────────────────────────────────────────────────────────


def _next_weekly(dia_semana: int, ref: date) -> date:
    """Próxima ocorrência (>= ref) do dia da semana (0=domingo, 6=sábado).

    Python `weekday()`: 0=segunda, 6=domingo. Convertemos pra convenção
    domingo-base usada no schedule_config.
    """
    # Converter weekday Python (0=seg) pra nosso (0=dom)
    py_to_us = lambda py: (py + 1) % 7
    today_us = py_to_us(ref.weekday())
    delta = (dia_semana - today_us) % 7
    return ref + timedelta(days=delta)


def _next_monthly(cfg: dict, ref: date) -> date:
    """Próxima ocorrência mensal a partir de ref."""
    modo = cfg.get("modo", "primeiro_fim_de_semana")
    if modo == "data_fixa":
        dia = int(cfg.get("dia", 1))
        # Tenta esse mês; se já passou, próximo
        try:
            candidate = ref.replace(day=dia)
        except ValueError:
            # Mês não tem esse dia (ex: 31 em fev). Usa último dia do mês
            candidate = (
                (ref.replace(day=1) + timedelta(days=32))
                .replace(day=1)
                - timedelta(days=1)
            )
        if candidate < ref:
            # Próximo mês
            month = ref.month + 1 if ref.month < 12 else 1
            year = ref.year if ref.month < 12 else ref.year + 1
            try:
                candidate = date(year, month, dia)
            except ValueError:
                next_month_first = date(year, month, 1)
                candidate = (
                    (next_month_first + timedelta(days=32)).replace(day=1)
                    - timedelta(days=1)
                )
        return candidate
    # primeiro_fim_de_semana — primeiro sábado a partir do dia 1 do mês
    first = ref.replace(day=1)
    # weekday: 5=sábado em Python
    days_to_sat = (5 - first.weekday()) % 7
    candidate = first + timedelta(days=days_to_sat)
    if candidate < ref:
        # Próximo mês
        month = ref.month + 1 if ref.month < 12 else 1
        year = ref.year if ref.month < 12 else ref.year + 1
        next_first = date(year, month, 1)
        days_to_sat = (5 - next_first.weekday()) % 7
        candidate = next_first + timedelta(days=days_to_sat)
    return candidate


def _next_quarterly(cfg: dict, ref: date) -> date:
    """Próxima ocorrência trimestral."""
    modo = cfg.get("modo", "marcos_padrao")
    if modo == "datas_custom":
        # Lista de "MM-DD" no ano corrente; pega a próxima
        datas: list[str] = cfg.get("datas", [])
        candidates: list[date] = []
        for d in datas:
            try:
                m, day = d.split("-")
                candidates.append(date(ref.year, int(m), int(day)))
            except (ValueError, IndexError):
                continue
        candidates = sorted(c for c in candidates if c >= ref)
        if candidates:
            return candidates[0]
        # Todas no passado — primeira do próximo ano
        for d in datas:
            try:
                m, day = d.split("-")
                return date(ref.year + 1, int(m), int(day))
            except (ValueError, IndexError):
                continue
        return ref + timedelta(days=90)  # fallback
    # marcos_padrao: 15/mar, 15/jun, 15/set, 15/dez
    marcos = [
        date(ref.year, 3, 15),
        date(ref.year, 6, 15),
        date(ref.year, 9, 15),
        date(ref.year, 12, 15),
    ]
    futuros = [m for m in marcos if m >= ref]
    if futuros:
        return futuros[0]
    return date(ref.year + 1, 3, 15)


def _next_annual(cfg: dict, ref: date) -> date:
    """Próxima ocorrência anual."""
    data_str = cfg.get("data", "01-01")
    try:
        m, day = data_str.split("-")
        candidate = date(ref.year, int(m), int(day))
    except (ValueError, IndexError):
        candidate = date(ref.year, 1, 1)
    if candidate < ref:
        candidate = candidate.replace(year=candidate.year + 1)
    return candidate


def _calc_proxima_data(cadencia: str, schedule_config: dict, ref: date) -> Optional[date]:
    try:
        if cadencia == "semanal":
            return _next_weekly(int(schedule_config.get("dia_semana", 0)), ref)
        if cadencia == "mensal":
            return _next_monthly(schedule_config, ref)
        if cadencia == "trimestral":
            return _next_quarterly(schedule_config, ref)
        if cadencia == "anual":
            return _next_annual(schedule_config, ref)
    except Exception:
        return None
    return None


def _hydrate_ritual(conn, row) -> dict:
    """Adiciona próxima_data, ultima_execucao, dias_atraso. Conexão reusada."""
    cfg = json.loads(row["schedule_config"]) if row["schedule_config"] else {}
    today = date.today()
    proxima = _calc_proxima_data(row["cadencia"], cfg, today) if row["ativo"] else None

    last_session = conn.execute(
        "SELECT data_executado FROM build_ritual_session "
        "WHERE cadencia = ? ORDER BY data_executado DESC LIMIT 1",
        (row["cadencia"],),
    ).fetchone()
    ultima = last_session["data_executado"] if last_session else None

    # dias_atraso: se proxima_data já passou, conta quantos dias
    dias_atraso = 0
    if proxima and proxima < today:
        dias_atraso = (today - proxima).days

    return {
        "cadencia": row["cadencia"],
        "ativo": bool(row["ativo"]),
        "schedule_config": cfg,
        "direcionamento_pensar": row["direcionamento_pensar"],
        "direcionamento_evitar": row["direcionamento_evitar"],
        "duracao_alvo_min": row["duracao_alvo_min"],
        "criado_em": row["criado_em"],
        "atualizado_em": row["atualizado_em"],
        "proxima_data": proxima.isoformat() if proxima else None,
        "ultima_execucao": ultima,
        "dias_atraso": dias_atraso,
    }


def _generate_schedule_dates(
    cadencia: str, cfg: dict, d_from: date, d_to: date
) -> list[date]:
    """Gera todas as ocorrências de uma cadência num intervalo [d_from, d_to].

    Reusa _calc_proxima_data iterativamente: pega a próxima a partir de
    d_from, depois "avança 1 dia" e pede a próxima de novo, até passar de
    d_to. Cap de 1000 datas por segurança (intervalo absurdo + cadência
    semanal daria ~52/ano).
    """
    out: list[date] = []
    cursor = d_from
    while cursor <= d_to and len(out) < 1000:
        nxt = _calc_proxima_data(cadencia, cfg, cursor)
        if not nxt or nxt > d_to:
            break
        out.append(nxt)
        cursor = nxt + timedelta(days=1)
    return out


@router.get("/rituals/schedule", response_model=list[RitualScheduleItem])
def list_rituals_schedule(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
):
    """Datas agendadas de cada cadência no intervalo. Usado pra renderizar
    marcadores no Calendar (mês/semana). Só rituais ativos entram."""
    try:
        d_from = date.fromisoformat(from_)
        d_to = date.fromisoformat(to)
    except ValueError:
        raise HTTPException(422, detail="Datas inválidas (use YYYY-MM-DD)")
    if d_to < d_from:
        raise HTTPException(422, detail="`to` deve ser >= `from`")
    if (d_to - d_from).days > 730:
        raise HTTPException(422, detail="Intervalo máximo: 2 anos")

    with get_conn() as conn:
        rows = conn.execute(
            "SELECT cadencia, schedule_config FROM build_ritual WHERE ativo = 1"
        ).fetchall()

    out = []
    for row in rows:
        cfg = json.loads(row["schedule_config"]) if row["schedule_config"] else {}
        datas = _generate_schedule_dates(row["cadencia"], cfg, d_from, d_to)
        out.append(
            {"cadencia": row["cadencia"], "datas": [d.isoformat() for d in datas]}
        )
    return out


@router.get("/rituals", response_model=list[RitualOut])
def list_rituals():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT cadencia, ativo, schedule_config, direcionamento_pensar, "
            "       direcionamento_evitar, duracao_alvo_min, "
            "       criado_em, atualizado_em "
            "FROM build_ritual ORDER BY "
            "       CASE cadencia "
            "         WHEN 'semanal' THEN 1 "
            "         WHEN 'mensal' THEN 2 "
            "         WHEN 'trimestral' THEN 3 "
            "         WHEN 'anual' THEN 4 END"
        ).fetchall()
        return [_hydrate_ritual(conn, r) for r in rows]


@router.get("/rituals/{cadencia}", response_model=RitualOut)
def get_ritual(cadencia: str):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT cadencia, ativo, schedule_config, direcionamento_pensar, "
            "       direcionamento_evitar, duracao_alvo_min, "
            "       criado_em, atualizado_em "
            "FROM build_ritual WHERE cadencia = ?",
            (cadencia,),
        ).fetchone()
        if not row:
            raise HTTPException(404, detail=f"Ritual '{cadencia}' não encontrado")
        return _hydrate_ritual(conn, row)


@router.patch("/rituals/{cadencia}", response_model=RitualOut)
def update_ritual(cadencia: str, body: RitualUpdate):
    fields: dict = {}
    for name in body.model_fields_set:
        val = getattr(body, name)
        if name == "schedule_config":
            fields[name] = json.dumps(val) if val is not None else None
        elif isinstance(val, bool):
            fields[name] = int(val)
        else:
            fields[name] = val
    if not fields:
        raise HTTPException(400, detail="Nothing to update")
    fields["atualizado_em"] = utcnow_iso_z()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE build_ritual SET {set_clause} WHERE cadencia = ?",
            [*fields.values(), cadencia],
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail=f"Ritual '{cadencia}' não encontrado")
        conn.commit()
        row = conn.execute(
            "SELECT cadencia, ativo, schedule_config, direcionamento_pensar, "
            "       direcionamento_evitar, duracao_alvo_min, "
            "       criado_em, atualizado_em "
            "FROM build_ritual WHERE cadencia = ?",
            (cadencia,),
        ).fetchone()
        return _hydrate_ritual(conn, row)


@router.get(
    "/rituals/{cadencia}/sessions", response_model=list[RitualSessionOut]
)
def list_ritual_sessions(cadencia: str, limit: int = 50):
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM build_ritual WHERE cadencia = ?", (cadencia,)
        ).fetchone():
            raise HTTPException(404, detail=f"Ritual '{cadencia}' não encontrado")
        rows = conn.execute(
            "SELECT id, cadencia, data_executado, duracao_min, notas, "
            "       foco_proxima_periodo, criado_em "
            "FROM build_ritual_session WHERE cadencia = ? "
            "ORDER BY data_executado DESC, id DESC LIMIT ?",
            (cadencia, limit),
        ).fetchall()
    return [dict(r) for r in rows]


@router.post(
    "/rituals/{cadencia}/sessions",
    response_model=RitualSessionOut,
    status_code=201,
)
def create_ritual_session(cadencia: str, body: RitualSessionCreate):
    """Registra execução do ritual. data_executado default = today."""
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM build_ritual WHERE cadencia = ?", (cadencia,)
        ).fetchone():
            raise HTTPException(404, detail=f"Ritual '{cadencia}' não encontrado")
        session_id = str(uuid.uuid4())[:8]
        data_exec = body.data_executado or date.today().isoformat()
        conn.execute(
            "INSERT INTO build_ritual_session"
            "(id, cadencia, data_executado, duracao_min, notas, foco_proxima_periodo) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                session_id,
                cadencia,
                data_exec,
                body.duracao_min,
                body.notas,
                body.foco_proxima_periodo,
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, cadencia, data_executado, duracao_min, notas, "
            "       foco_proxima_periodo, criado_em "
            "FROM build_ritual_session WHERE id = ?",
            (session_id,),
        ).fetchone()
    return dict(row)


# ─── Guardrail (v2 — pontes Hub Health) ───────────────────────────────────


GUARDRAIL_COLUMNS = (
    "id, goal_id, metric_slug, item_id, operador, valor_alvo, "
    "descricao, ordem, criado_em, atualizado_em"
)


def _validate_metric_slug(metric_slug: str, item_id: Optional[int]) -> None:
    """Valida que o slug existe no catálogo de Hub Health e que item_id
    é fornecido se a métrica precisa.

    Importante: slug é validado em runtime contra o catálogo do Health,
    NUNCA contra const espelhada no /Build (princípio "sem hardcoded").
    """
    meta = get_metric_meta(metric_slug)
    if meta is None:
        raise HTTPException(
            422,
            detail=f"Métrica '{metric_slug}' não existe em Hub Health",
        )
    if meta["precisa_item"] and item_id is None:
        raise HTTPException(
            422,
            detail=f"Métrica '{metric_slug}' precisa de item_id (varia por item)",
        )


@router.get("/goals/{goal_id}/guardrails", response_model=list[GuardrailOut])
def list_goal_guardrails(goal_id: str):
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM build_goal WHERE id = ?", (goal_id,)
        ).fetchone():
            raise HTTPException(404, detail="Meta não encontrada")
        rows = conn.execute(
            f"SELECT {GUARDRAIL_COLUMNS} FROM build_goal_guardrail "
            "WHERE goal_id = ? ORDER BY ordem ASC, id ASC",
            (goal_id,),
        ).fetchall()
    return [dict(r) for r in rows]


@router.post(
    "/goals/{goal_id}/guardrails", response_model=GuardrailOut, status_code=201
)
def create_guardrail(goal_id: str, body: GuardrailCreate):
    """Cria guardrail apontando pra Métrica de Hub Health. Valida slug."""
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM build_goal WHERE id = ?", (goal_id,)
        ).fetchone():
            raise HTTPException(404, detail="Meta não encontrada")

        _validate_metric_slug(body.metric_slug, body.item_id)

        # Auto-ordem: max+1
        if body.ordem is None:
            row = conn.execute(
                "SELECT COALESCE(MAX(ordem), -1) + 1 AS next_ordem "
                "FROM build_goal_guardrail WHERE goal_id = ?",
                (goal_id,),
            ).fetchone()
            ordem = row["next_ordem"]
        else:
            ordem = body.ordem

        cursor = conn.execute(
            "INSERT INTO build_goal_guardrail("
            "goal_id, metric_slug, item_id, operador, valor_alvo, "
            "descricao, ordem) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                goal_id,
                body.metric_slug,
                body.item_id,
                body.operador,
                body.valor_alvo,
                body.descricao,
                ordem,
            ),
        )
        new_id = cursor.lastrowid
        conn.commit()
        row = conn.execute(
            f"SELECT {GUARDRAIL_COLUMNS} FROM build_goal_guardrail WHERE id = ?",
            (new_id,),
        ).fetchone()
    return dict(row)


@router.patch(
    "/goals/{goal_id}/guardrails/{guardrail_id}", response_model=GuardrailOut
)
def update_guardrail(goal_id: str, guardrail_id: int, body: GuardrailUpdate):
    fields: dict = {}
    for name in body.model_fields_set:
        fields[name] = getattr(body, name)
    if not fields:
        raise HTTPException(400, detail="Nothing to update")

    # Se mudou metric_slug ou item_id, revalida
    if "metric_slug" in fields or "item_id" in fields:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT metric_slug, item_id FROM build_goal_guardrail WHERE id = ?",
                (guardrail_id,),
            ).fetchone()
            if not row:
                raise HTTPException(404, detail="Guardrail não encontrado")
            new_slug = fields.get("metric_slug", row["metric_slug"])
            new_item = fields.get("item_id", row["item_id"])
            _validate_metric_slug(new_slug, new_item)

    fields["atualizado_em"] = utcnow_iso_z()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE build_goal_guardrail SET {set_clause} "
            "WHERE id = ? AND goal_id = ?",
            [*fields.values(), guardrail_id, goal_id],
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Guardrail não encontrado")
        conn.commit()
        row = conn.execute(
            f"SELECT {GUARDRAIL_COLUMNS} FROM build_goal_guardrail WHERE id = ?",
            (guardrail_id,),
        ).fetchone()
    return dict(row)


@router.delete(
    "/goals/{goal_id}/guardrails/{guardrail_id}", status_code=204
)
def delete_guardrail(goal_id: str, guardrail_id: int):
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM build_goal_guardrail "
            "WHERE id = ? AND goal_id = ?",
            (guardrail_id, goal_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="Guardrail não encontrado")
        conn.commit()


def _evaluate_condition(operador: str, valor_atual: float, valor_alvo: float) -> bool:
    if operador == ">=": return valor_atual >= valor_alvo
    if operador == "<=": return valor_atual <= valor_alvo
    if operador == ">": return valor_atual > valor_alvo
    if operador == "<": return valor_atual < valor_alvo
    if operador == "==": return valor_atual == valor_alvo
    if operador == "!=": return valor_atual != valor_alvo
    return False


def _is_data_too_old(ultima_atualizacao: Optional[str], threshold_days: int) -> bool:
    """Verifica se a Métrica tem dados mas eles estão velhos demais."""
    if not ultima_atualizacao:
        return False
    try:
        # Formato esperado: ISO 8601 (UTC ou local)
        ts = ultima_atualizacao.replace("Z", "+00:00")
        from datetime import datetime
        dt = datetime.fromisoformat(ts)
        idade = (datetime.now(dt.tzinfo) - dt).days
        return idade > threshold_days
    except Exception:
        return False


@router.get(
    "/goals/{goal_id}/guardrails/evaluate",
    response_model=list[GuardrailEvaluation],
)
def evaluate_goal_guardrails(goal_id: str):
    """Avalia todos os guardrails da Meta. Calcula estado on-the-fly chamando
    `calculate_metric` de Hub Health in-process (sem HTTP overhead)."""
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM build_goal WHERE id = ?", (goal_id,)
        ).fetchone():
            raise HTTPException(404, detail="Meta não encontrada")

        guardrails = conn.execute(
            f"SELECT {GUARDRAIL_COLUMNS} FROM build_goal_guardrail "
            "WHERE goal_id = ? ORDER BY ordem ASC, id ASC",
            (goal_id,),
        ).fetchall()

        # Threshold de dados antigos vem das settings
        settings_row = conn.execute(
            "SELECT metric_data_age_threshold_days FROM build_settings WHERE id = 1"
        ).fetchone()
        threshold_days = (
            settings_row["metric_data_age_threshold_days"] if settings_row else 60
        )

        out: list[dict] = []
        for g in guardrails:
            metric_meta = get_metric_meta(g["metric_slug"])
            if metric_meta is None:
                # Slug deletado ou renomeado em Hub Health — alerta
                out.append({
                    "id": g["id"],
                    "metric_slug": g["metric_slug"],
                    "item_id": g["item_id"],
                    "operador": g["operador"],
                    "valor_alvo": g["valor_alvo"],
                    "descricao": g["descricao"],
                    "estado": "METRICA_NAO_ENCONTRADA",
                    "valor_atual": None,
                    "unidade": None,
                    "ultima_atualizacao": None,
                    "detalhe": (
                        f"Métrica '{g['metric_slug']}' não existe mais em Hub Health"
                    ),
                })
                continue

            result = calculate_metric(conn, g["metric_slug"], g["item_id"])
            valor_atual = result.get("valor")
            dados_ok = result.get("dados_disponiveis", False)
            ultima = result.get("ultima_atualizacao")

            if not dados_ok or valor_atual is None:
                estado = "ESPERANDO_DADOS"
                detalhe = result.get("erro") or "Sem dados registrados ainda"
            elif _is_data_too_old(ultima, threshold_days):
                estado = "ESPERANDO_DADOS"
                detalhe = f"Dados antigos (>{threshold_days}d sem atualização)"
            else:
                # Avalia condição. Só funciona pra valores numéricos.
                if not isinstance(valor_atual, (int, float)):
                    estado = "ESPERANDO_DADOS"
                    detalhe = "Métrica não-numérica não suporta condição"
                else:
                    ok = _evaluate_condition(
                        g["operador"], float(valor_atual), g["valor_alvo"]
                    )
                    estado = "OK" if ok else "VIOLADO"
                    detalhe = None

            out.append({
                "id": g["id"],
                "metric_slug": g["metric_slug"],
                "item_id": g["item_id"],
                "operador": g["operador"],
                "valor_alvo": g["valor_alvo"],
                "descricao": g["descricao"],
                "estado": estado,
                "valor_atual": valor_atual if isinstance(valor_atual, (int, float)) else None,
                "unidade": result.get("unidade"),
                "ultima_atualizacao": ultima,
                "detalhe": detalhe,
            })

    return out


# ─── Settings (continuação) ───────────────────────────────────────────────

@router.patch("/settings", response_model=SettingsOut)
def update_settings(body: SettingsUpdate):
    fields: dict = {}
    for name in body.model_fields_set:
        val = getattr(body, name)
        fields[name] = int(val) if isinstance(val, bool) else val
    if not fields:
        raise HTTPException(400, detail="Nothing to update")
    fields["atualizado_em"] = utcnow_iso_z()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE build_settings SET {set_clause} WHERE id = 1",
            [*fields.values()],
        )
        conn.commit()
        row = conn.execute(
            "SELECT max_metas_ativas, default_dependency_threshold_pct, "
            "metric_data_age_threshold_days, dashboard_card_visivel, atualizado_em "
            "FROM build_settings WHERE id = 1"
        ).fetchone()
    return {
        **dict(row),
        "dashboard_card_visivel": bool(row["dashboard_card_visivel"]),
    }
