"""Requisições — lista de compras pessoal (NÃO toca no Finance).

É lembrete + estimativa: o usuário anota o que precisa repor (cotonete,
desodorante, creme...) sem registrar transação. Cada item tem uma
CADÊNCIA e reabre sozinho quando o ritmo vence, igual um ritual. Ao
marcar comprado, o valor pago (opcional) alimenta a MÉDIA DE PREÇO real,
e o histórico fica filtrável por mês.

Padrão da casa: ids INTEGER (espelha Lang Lab), get_conn() com `with`,
*Out/*Create/*Update, PATCH parcial via model_fields_set.
"""
from __future__ import annotations

import re
from datetime import date

from fastapi import APIRouter, HTTPException, Query

from db import get_conn
from models.requisicoes import (
    MarcarCompradoIn,
    RequisicaoItemCreate,
    RequisicaoItemOut,
    RequisicaoItemUpdate,
    RequisicaoPurchaseOut,
    RequisicaoReorderItem,
)
from services.utils import utcnow_iso_z

router = APIRouter(tags=["requisicoes"])

# Dias de cada cadência. 'avulso' não recorre (compra única). Os presets
# vêm do design acordado com o usuário; não é valor de usuário tunável
# por enquanto (se virar, vira coluna). Mensal = 30d (simples e previsível).
CADENCE_DAYS = {"quinzenal": 15, "mensal": 30, "bimestral": 60, "trimestral": 90}

_ITEM_COLS = (
    "id, nome, categoria, cadencia, preco_estimado, last_bought, "
    "arquivado, ordem, criado_em, atualizado_em"
)


def _today() -> str:
    return date.today().isoformat()


def _days_since(iso_date: str) -> int:
    """Dias entre uma data YYYY-MM-DD e hoje. Tolera lixo → 0."""
    try:
        return (date.today() - date.fromisoformat(iso_date[:10])).days
    except (ValueError, TypeError):
        return 0


def _item_out(conn, row) -> dict:
    """Enriquece a row com os campos computados (aberta/atraso/média)."""
    d = dict(row)
    d["arquivado"] = bool(d["arquivado"])
    cad = d["cadencia"]
    last = d["last_bought"]

    agg = conn.execute(
        "SELECT COUNT(*) AS n, AVG(valor_pago) AS media "
        "FROM shopping_purchase WHERE item_id = ? AND valor_pago IS NOT NULL",
        (d["id"],),
    ).fetchone()
    total = conn.execute(
        "SELECT COUNT(*) AS n FROM shopping_purchase WHERE item_id = ?",
        (d["id"],),
    ).fetchone()["n"]
    d["compras_count"] = total
    # Média do que pagou; se nunca informou valor, cai pra estimativa.
    d["preco_medio"] = round(agg["media"], 2) if agg["media"] is not None else d["preco_estimado"]

    aberta = False
    atrasado = None
    proximo = None
    if cad == "avulso":
        # Avulso: aberto até a primeira (e única) compra.
        aberta = last is None
    else:
        alvo = CADENCE_DAYS.get(cad, 30)
        if last is None:
            aberta = True  # nunca comprado → entra na lista
        else:
            dias = _days_since(last)
            if dias >= alvo:
                aberta = True
                atrasado = dias - alvo  # 0 = venceu hoje; >0 = atrasado
            else:
                proximo = alvo - dias   # em dia: volta em N dias
    d["aberta"] = aberta
    d["atrasado_dias"] = atrasado
    d["proximo_em_dias"] = proximo
    return d


# ─── Itens ─────────────────────────────────────────────────────────────────


@router.get("/api/requisicoes/itens", response_model=list[RequisicaoItemOut])
def list_itens(categoria: str | None = Query(None)):
    """Todos os itens ativos (não arquivados), enriquecidos. O frontend
    separa em ABERTAS (aberta=true) e EM DIA (recorrentes satisfeitos)."""
    sql = f"SELECT {_ITEM_COLS} FROM shopping_item WHERE arquivado = 0"
    params: list = []
    if categoria:
        sql += " AND categoria = ?"
        params.append(categoria)
    sql += " ORDER BY ordem ASC, nome COLLATE NOCASE ASC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_item_out(conn, r) for r in rows]


@router.post("/api/requisicoes/itens", response_model=RequisicaoItemOut, status_code=201)
def create_item(body: RequisicaoItemCreate):
    nome = body.nome.strip()
    if not nome:
        raise HTTPException(400, detail="nome é obrigatório")
    categoria = body.categoria.strip() if body.categoria else None
    with get_conn() as conn:
        # Novo item entra no FIM da ordem manual (drag-and-drop).
        next_ordem = conn.execute(
            "SELECT COALESCE(MAX(ordem), -1) + 1 AS n FROM shopping_item"
        ).fetchone()["n"]
        cur = conn.execute(
            "INSERT INTO shopping_item(nome, categoria, cadencia, preco_estimado, ordem) "
            "VALUES (?, ?, ?, ?, ?)",
            (nome, categoria or None, body.cadencia, body.preco_estimado, next_ordem),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {_ITEM_COLS} FROM shopping_item WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return _item_out(conn, row)


@router.patch("/api/requisicoes/itens/{item_id}", response_model=RequisicaoItemOut)
def update_item(item_id: int, body: RequisicaoItemUpdate):
    fields = body.model_dump(exclude_unset=True)
    if "nome" in fields:
        nome = (fields["nome"] or "").strip()
        if not nome:
            raise HTTPException(400, detail="nome não pode ficar vazio")
        fields["nome"] = nome
    if "categoria" in fields:
        cat = (fields["categoria"] or "").strip() if fields["categoria"] else None
        fields["categoria"] = cat or None
    if not fields:
        raise HTTPException(400, detail="nada pra atualizar")
    fields["atualizado_em"] = utcnow_iso_z()
    sets = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE shopping_item SET {sets} WHERE id = ?",
            (*fields.values(), item_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, detail="item não encontrado")
        conn.commit()
        row = conn.execute(
            f"SELECT {_ITEM_COLS} FROM shopping_item WHERE id = ?", (item_id,)
        ).fetchone()
        return _item_out(conn, row)


@router.delete("/api/requisicoes/itens/{item_id}", status_code=204)
def delete_item(item_id: int):
    with get_conn() as conn:
        # Apaga o histórico explicitamente (não depende de PRAGMA cascade).
        conn.execute("DELETE FROM shopping_purchase WHERE item_id = ?", (item_id,))
        conn.execute("DELETE FROM shopping_item WHERE id = ?", (item_id,))
        conn.commit()
    return None


@router.post("/api/requisicoes/itens/reorder", status_code=204)
def reorder_itens(body: list[RequisicaoReorderItem]):
    """Persiste a ordem manual (drag-and-drop). Idempotente."""
    now = utcnow_iso_z()
    with get_conn() as conn:
        for entry in body:
            conn.execute(
                "UPDATE shopping_item SET ordem = ?, atualizado_em = ? WHERE id = ?",
                (entry.ordem, now, entry.id),
            )
        conn.commit()
    return None


# ─── Comprar / desfazer ──────────────────────────────────────────────────


@router.post("/api/requisicoes/itens/{item_id}/comprar", response_model=RequisicaoItemOut)
def marcar_comprado(item_id: int, body: MarcarCompradoIn):
    """Registra uma compra: cria purchase, atualiza last_bought e arquiva
    se for avulso (compra única, não volta). O valor pago é opcional e
    alimenta a média."""
    bought_at = (body.bought_at or _today())[:10]
    # Valida a data: formato ISO e nada no futuro (corromperia a cadência).
    try:
        if date.fromisoformat(bought_at) > date.today():
            raise HTTPException(400, detail="data da compra não pode ser no futuro")
    except ValueError:
        raise HTTPException(400, detail="data inválida (use YYYY-MM-DD)")
    with get_conn() as conn:
        item = conn.execute(
            "SELECT cadencia FROM shopping_item WHERE id = ?", (item_id,)
        ).fetchone()
        if not item:
            raise HTTPException(404, detail="item não encontrado")
        conn.execute(
            "INSERT INTO shopping_purchase(item_id, bought_at, valor_pago) VALUES (?, ?, ?)",
            (item_id, bought_at, body.valor_pago),
        )
        # last_bought = compra mais recente (cobre data retroativa).
        newest = conn.execute(
            "SELECT MAX(bought_at) AS d FROM shopping_purchase WHERE item_id = ?",
            (item_id,),
        ).fetchone()["d"]
        arquiva = 1 if item["cadencia"] == "avulso" else 0
        conn.execute(
            "UPDATE shopping_item SET last_bought = ?, arquivado = ?, atualizado_em = ? WHERE id = ?",
            (newest, arquiva, utcnow_iso_z(), item_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {_ITEM_COLS} FROM shopping_item WHERE id = ?", (item_id,)
        ).fetchone()
        return _item_out(conn, row)


@router.delete("/api/requisicoes/compras/{purchase_id}", response_model=RequisicaoItemOut)
def desfazer_compra(purchase_id: int):
    """Desfaz uma compra (destique acidental). Recalcula last_bought e
    reabre o item avulso que tinha sido arquivado."""
    with get_conn() as conn:
        pur = conn.execute(
            "SELECT item_id FROM shopping_purchase WHERE id = ?", (purchase_id,)
        ).fetchone()
        if not pur:
            raise HTTPException(404, detail="compra não encontrada")
        item_id = pur["item_id"]
        conn.execute("DELETE FROM shopping_purchase WHERE id = ?", (purchase_id,))
        newest = conn.execute(
            "SELECT MAX(bought_at) AS d FROM shopping_purchase WHERE item_id = ?",
            (item_id,),
        ).fetchone()["d"]
        # Reabre avulso (se voltou a não ter compra) e atualiza last_bought.
        item = conn.execute(
            "SELECT cadencia FROM shopping_item WHERE id = ?", (item_id,)
        ).fetchone()
        arquiva = 1 if (item and item["cadencia"] == "avulso" and newest is not None) else 0
        conn.execute(
            "UPDATE shopping_item SET last_bought = ?, arquivado = ?, atualizado_em = ? WHERE id = ?",
            (newest, arquiva, utcnow_iso_z(), item_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {_ITEM_COLS} FROM shopping_item WHERE id = ?", (item_id,)
        ).fetchone()
        return _item_out(conn, row)


# ─── Histórico (ATENDIDAS por mês) + categorias ──────────────────────────


@router.get("/api/requisicoes/compras", response_model=list[RequisicaoPurchaseOut])
def list_compras(mes: str | None = Query(None, description="YYYY-MM")):
    """Compras de um mês (default: mês corrente) — alimenta a seção
    ATENDIDAS e o gasto do mês. Junta o item pra mostrar nome/categoria."""
    alvo = mes or _today()[:7]
    if not re.fullmatch(r"\d{4}-\d{2}", alvo):
        raise HTTPException(400, detail="mês deve ser YYYY-MM")
    sql = (
        "SELECT p.id, p.item_id, i.nome, i.categoria, i.cadencia, "
        "       p.bought_at, p.valor_pago "
        "FROM shopping_purchase p JOIN shopping_item i ON i.id = p.item_id "
        "WHERE substr(p.bought_at, 1, 7) = ? "
        "ORDER BY p.bought_at DESC, p.id DESC"
    )
    with get_conn() as conn:
        rows = conn.execute(sql, (alvo,)).fetchall()
        return [dict(r) for r in rows]


@router.get("/api/requisicoes/categorias", response_model=list[str])
def list_categorias():
    """Categorias distintas em uso — pros chips de filtro e o datalist."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT categoria FROM shopping_item "
            "WHERE categoria IS NOT NULL AND categoria != '' AND arquivado = 0 "
            "ORDER BY categoria COLLATE NOCASE ASC"
        ).fetchall()
    return [r["categoria"] for r in rows]
