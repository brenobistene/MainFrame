"""Hub Finance — submódulo Wishlist.

Endpoints CRUD pra categorias, items, links, reservas + ações de fluxo
(comprar, desistir, reabrir, vincular transação) + settings + summary.

Filosofia (ver docs/hub-finance/wishlist-PLAN.md):
 - Item de wishlist NÃO cria transação; só vincula a uma transação existente
   (evita duplicação na reconciliação do extrato).
 - Reserva é PASSIVA e VIRTUAL: backend assume que o planejado foi cumprido
   conforme o mês corre, soma no acumulado. Sem conta separada.
 - Sobra real = receita − despesa − fixas − dívidas − reservas_wishlist_mês.
   Esse cálculo é consumido por monthly-summary (extensão futura).
"""
from __future__ import annotations

import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from db import get_conn
from models.wishlist import (
    WishlistCategoriaCreate,
    WishlistCategoriaOut,
    WishlistCategoriaUpdate,
    WishlistComprarBody,
    WishlistDesistirBody,
    WishlistItemCreate,
    WishlistItemOut,
    WishlistItemUpdate,
    WishlistLinkCreate,
    WishlistLinkOut,
    WishlistLinkUpdate,
    WishlistMatchGroup,
    WishlistMonthReservas,
    WishlistReabrirBody,
    WishlistReorderItem,
    WishlistReservaInput,
    WishlistReservaMatchGroup,
    WishlistReservaOut,
    WishlistReservaVincularBody,
    WishlistSettingsOut,
    WishlistSettingsUpdate,
    WishlistSummary,
    WishlistTransactionCandidate,
    WishlistVincularBody,
)
from services.utils import utcnow_iso_z


router = APIRouter()


def _new_id() -> str:
    return str(uuid.uuid4())[:8]


def _today_iso() -> str:
    return date.today().isoformat()


# ─── Helpers de conversão de row ──────────────────────────────────────────

CATEGORIA_COLUMNS = "id, nome, cor, sort_order"
ITEM_COLUMNS = (
    "id, nome, descricao, categoria_id, valor_estimado, prioridade, status, "
    "data_alvo, valor_real, comprado_em, transacao_id, desistido_em, "
    "motivo_desistencia, criada_em, atualizada_em"
)
LINK_COLUMNS = "id, url, label, preco, sort_order"
RESERVA_COLUMNS = "id, ano, mes, dia, valor_planejado, notas, transacao_id"


def _categoria_dict(row) -> dict:
    return dict(row)


def _link_dict(row) -> dict:
    return dict(row)


def _reserva_dict(row) -> dict:
    return dict(row)


def _months_between(d1: date, d2: date) -> int:
    """Inteiro de meses cheios entre d1 e d2 (d2 > d1). Conta diferença em meses civis."""
    return (d2.year - d1.year) * 12 + (d2.month - d1.month)


def _enrich_item(conn, row) -> dict:
    """Combina row de fin_wishlist_item com links, reservas e campos computados."""
    d = dict(row)
    item_id = d["id"]

    # Links
    link_rows = conn.execute(
        f"SELECT {LINK_COLUMNS} FROM fin_wishlist_link "
        f"WHERE item_id = ? ORDER BY sort_order ASC, criado_em ASC",
        (item_id,),
    ).fetchall()
    d["links"] = [_link_dict(r) for r in link_rows]

    # Reservas (ordenadas por ano, mes)
    reserva_rows = conn.execute(
        f"SELECT {RESERVA_COLUMNS} FROM fin_wishlist_reserva "
        f"WHERE item_id = ? ORDER BY ano ASC, mes ASC",
        (item_id,),
    ).fetchall()
    d["reservas"] = [_reserva_dict(r) for r in reserva_rows]

    # Fase 5 — "soft mode":
    #  * reservado_acumulado = só as CONFIRMADAS (com transacao_id), de qualquer mês
    #  * reservado_pendente   = passadas (ano,mes <= atual) SEM vínculo
    #  * proxima_reserva       = primeira futura
    today = date.today()
    cur_ym = today.year * 100 + today.month
    confirmado = 0.0
    pendente = 0.0
    proxima_reserva = None
    for r in d["reservas"]:
        rym = r["ano"] * 100 + r["mes"]
        v = float(r["valor_planejado"] or 0)
        has_link = bool(r.get("transacao_id"))
        if has_link:
            confirmado += v
        elif rym <= cur_ym:
            pendente += v
        if rym > cur_ym and proxima_reserva is None:
            proxima_reserva = r

    estimado = float(d["valor_estimado"] or 0)
    d["reservado_acumulado"] = round(confirmado, 2)
    d["reservado_pendente"] = round(pendente, 2)
    d["reservado_restante"] = round(max(0.0, estimado - confirmado), 2)
    d["progresso_pct"] = (
        round(min(100.0, (confirmado / estimado) * 100), 1) if estimado > 0 else 0.0
    )
    d["proxima_reserva"] = proxima_reserva

    # Meses parado: desde atualizada_em (ou criada_em se nula).
    ref_str = d.get("atualizada_em") or d.get("criada_em")
    meses_parado = 0
    if ref_str:
        try:
            ref_date = date.fromisoformat(ref_str[:10])
            meses_parado = max(0, _months_between(ref_date, today))
        except ValueError:
            meses_parado = 0
    d["meses_parado"] = meses_parado

    return d


# ─── Categorias ───────────────────────────────────────────────────────────

@router.get("/api/finance/wishlist/categorias", response_model=list[WishlistCategoriaOut])
def list_wishlist_categorias():
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT {CATEGORIA_COLUMNS} FROM fin_wishlist_categoria "
            f"ORDER BY sort_order ASC, criada_em ASC"
        ).fetchall()
        return [_categoria_dict(r) for r in rows]


@router.post(
    "/api/finance/wishlist/categorias",
    response_model=WishlistCategoriaOut,
    status_code=201,
)
def create_wishlist_categoria(body: WishlistCategoriaCreate):
    nome = body.nome.strip()
    if not nome:
        raise HTTPException(400, detail="nome é obrigatório")
    cat_id = _new_id()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT 1 FROM fin_wishlist_categoria WHERE nome = ?", (nome,)
        ).fetchone()
        if existing:
            raise HTTPException(422, detail="já existe categoria com esse nome")
        sort_order = body.sort_order
        if sort_order is None:
            row = conn.execute(
                "SELECT COALESCE(MAX(sort_order), 0) AS m FROM fin_wishlist_categoria"
            ).fetchone()
            sort_order = (row["m"] or 0) + 1
        conn.execute(
            "INSERT INTO fin_wishlist_categoria(id, nome, cor, sort_order) "
            "VALUES(?,?,?,?)",
            (cat_id, nome, body.cor, sort_order),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {CATEGORIA_COLUMNS} FROM fin_wishlist_categoria WHERE id = ?",
            (cat_id,),
        ).fetchone()
        return _categoria_dict(row)


@router.patch(
    "/api/finance/wishlist/categorias/{cat_id}",
    response_model=WishlistCategoriaOut,
)
def update_wishlist_categoria(cat_id: str, body: WishlistCategoriaUpdate):
    fields: dict = {name: getattr(body, name) for name in body.model_fields_set}
    if not fields:
        raise HTTPException(400, detail="nada a atualizar")
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_wishlist_categoria WHERE id = ?", (cat_id,)
        ).fetchone():
            raise HTTPException(404, detail="categoria não encontrada")
        if "nome" in fields:
            fields["nome"] = (fields["nome"] or "").strip()
            if not fields["nome"]:
                raise HTTPException(400, detail="nome não pode ser vazio")
            dup = conn.execute(
                "SELECT 1 FROM fin_wishlist_categoria WHERE nome = ? AND id != ?",
                (fields["nome"], cat_id),
            ).fetchone()
            if dup:
                raise HTTPException(422, detail="já existe categoria com esse nome")
        fields["atualizada_em"] = utcnow_iso_z()
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE fin_wishlist_categoria SET {set_clause} WHERE id = ?",
            [*fields.values(), cat_id],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {CATEGORIA_COLUMNS} FROM fin_wishlist_categoria WHERE id = ?",
            (cat_id,),
        ).fetchone()
        return _categoria_dict(row)


@router.delete("/api/finance/wishlist/categorias/{cat_id}", status_code=204)
def delete_wishlist_categoria(cat_id: str):
    with get_conn() as conn:
        # ON DELETE SET NULL no FK de fin_wishlist_item.categoria_id já cuida —
        # items existentes ficam com categoria_id=null.
        conn.execute("DELETE FROM fin_wishlist_categoria WHERE id = ?", (cat_id,))
        conn.commit()
    return None


# ─── Items ────────────────────────────────────────────────────────────────

@router.get("/api/finance/wishlist/items", response_model=list[WishlistItemOut])
def list_wishlist_items(
    status: Optional[str] = Query(None, description="Filtra por status exato"),
    categoria_id: Optional[str] = Query(None),
    include_done: bool = Query(False, description="Inclui comprado/desistido"),
):
    sql = f"SELECT {ITEM_COLUMNS} FROM fin_wishlist_item"
    where: list[str] = []
    params: list = []
    if status:
        where.append("status = ?")
        params.append(status)
    elif not include_done:
        where.append("status NOT IN ('comprado', 'desistido')")
    if categoria_id:
        where.append("categoria_id = ?")
        params.append(categoria_id)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY prioridade ASC, criada_em ASC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_enrich_item(conn, r) for r in rows]


@router.get("/api/finance/wishlist/items/{item_id}", response_model=WishlistItemOut)
def get_wishlist_item(item_id: str):
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="item não encontrado")
        return _enrich_item(conn, row)


@router.post(
    "/api/finance/wishlist/items",
    response_model=WishlistItemOut,
    status_code=201,
)
def create_wishlist_item(body: WishlistItemCreate):
    nome = body.nome.strip()
    if not nome:
        raise HTTPException(400, detail="nome é obrigatório")
    item_id = _new_id()
    with get_conn() as conn:
        if body.categoria_id and not conn.execute(
            "SELECT 1 FROM fin_wishlist_categoria WHERE id = ?", (body.categoria_id,)
        ).fetchone():
            raise HTTPException(422, detail="categoria_id não existe")
        # Nova prioridade = MAX + 1 entre items ativos
        max_p = conn.execute(
            "SELECT COALESCE(MAX(prioridade), 0) AS m FROM fin_wishlist_item "
            "WHERE status IN ('desejado', 'poupando')"
        ).fetchone()["m"]
        conn.execute(
            "INSERT INTO fin_wishlist_item("
            "id, nome, descricao, categoria_id, valor_estimado, prioridade, "
            "status, data_alvo) "
            "VALUES(?, ?, ?, ?, ?, ?, 'desejado', ?)",
            (
                item_id,
                nome,
                body.descricao,
                body.categoria_id,
                body.valor_estimado,
                (max_p or 0) + 1,
                body.data_alvo,
            ),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone()
        return _enrich_item(conn, row)


@router.patch("/api/finance/wishlist/items/{item_id}", response_model=WishlistItemOut)
def update_wishlist_item(item_id: str, body: WishlistItemUpdate):
    fields: dict = {name: getattr(body, name) for name in body.model_fields_set}
    if not fields:
        raise HTTPException(400, detail="nada a atualizar")
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone():
            raise HTTPException(404, detail="item não encontrado")
        if "categoria_id" in fields and fields["categoria_id"] and not conn.execute(
            "SELECT 1 FROM fin_wishlist_categoria WHERE id = ?", (fields["categoria_id"],)
        ).fetchone():
            raise HTTPException(422, detail="categoria_id não existe")
        if "nome" in fields:
            fields["nome"] = (fields["nome"] or "").strip()
            if not fields["nome"]:
                raise HTTPException(400, detail="nome não pode ser vazio")
        if "valor_estimado" in fields and (
            fields["valor_estimado"] is None or fields["valor_estimado"] <= 0
        ):
            raise HTTPException(400, detail="valor_estimado deve ser > 0")
        fields["atualizada_em"] = utcnow_iso_z()
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE fin_wishlist_item SET {set_clause} WHERE id = ?",
            [*fields.values(), item_id],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone()
        return _enrich_item(conn, row)


@router.delete("/api/finance/wishlist/items/{item_id}", status_code=204)
def delete_wishlist_item(item_id: str):
    with get_conn() as conn:
        # CASCADE em fin_wishlist_link e fin_wishlist_reserva limpa juntos.
        conn.execute("DELETE FROM fin_wishlist_item WHERE id = ?", (item_id,))
        conn.commit()
    return None


@router.post("/api/finance/wishlist/items/reorder", status_code=204)
def reorder_wishlist_items(body: list[WishlistReorderItem]):
    """Atualiza prioridade de vários items de uma vez. Idempotente."""
    with get_conn() as conn:
        for entry in body:
            conn.execute(
                "UPDATE fin_wishlist_item SET prioridade = ?, atualizada_em = ? "
                "WHERE id = ?",
                (entry.prioridade, utcnow_iso_z(), entry.id),
            )
        conn.commit()
    return None


# ─── Ações de fluxo ───────────────────────────────────────────────────────

@router.post(
    "/api/finance/wishlist/items/{item_id}/comprar",
    response_model=WishlistItemOut,
)
def comprar_wishlist_item(item_id: str, body: WishlistComprarBody):
    data = body.data or _today_iso()
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone():
            raise HTTPException(404, detail="item não encontrado")
        if body.transacao_id and not conn.execute(
            "SELECT 1 FROM fin_transaction WHERE id = ?", (body.transacao_id,)
        ).fetchone():
            raise HTTPException(422, detail="transacao_id não existe")
        conn.execute(
            "UPDATE fin_wishlist_item SET status = 'comprado', valor_real = ?, "
            "comprado_em = ?, transacao_id = ?, desistido_em = NULL, "
            "motivo_desistencia = NULL, atualizada_em = ? WHERE id = ?",
            (body.valor_real, data, body.transacao_id, utcnow_iso_z(), item_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone()
        return _enrich_item(conn, row)


@router.post(
    "/api/finance/wishlist/items/{item_id}/desistir",
    response_model=WishlistItemOut,
)
def desistir_wishlist_item(item_id: str, body: WishlistDesistirBody):
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone():
            raise HTTPException(404, detail="item não encontrado")
        conn.execute(
            "UPDATE fin_wishlist_item SET status = 'desistido', "
            "desistido_em = ?, motivo_desistencia = ?, "
            "valor_real = NULL, comprado_em = NULL, transacao_id = NULL, "
            "atualizada_em = ? WHERE id = ?",
            (_today_iso(), body.motivo, utcnow_iso_z(), item_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone()
        return _enrich_item(conn, row)


@router.post(
    "/api/finance/wishlist/items/{item_id}/reabrir",
    response_model=WishlistItemOut,
)
def reabrir_wishlist_item(item_id: str, body: WishlistReabrirBody):
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone():
            raise HTTPException(404, detail="item não encontrado")
        # Tem plano de reserva? Vira 'poupando' se não especificou.
        novo = body.novo_status
        if novo is None:
            has_plan = conn.execute(
                "SELECT 1 FROM fin_wishlist_reserva WHERE item_id = ? LIMIT 1",
                (item_id,),
            ).fetchone()
            novo = "poupando" if has_plan else "desejado"
        conn.execute(
            "UPDATE fin_wishlist_item SET status = ?, valor_real = NULL, "
            "comprado_em = NULL, transacao_id = NULL, desistido_em = NULL, "
            "motivo_desistencia = NULL, atualizada_em = ? WHERE id = ?",
            (novo, utcnow_iso_z(), item_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone()
        return _enrich_item(conn, row)


@router.patch(
    "/api/finance/wishlist/items/{item_id}/transacao",
    response_model=WishlistItemOut,
)
def vincular_transacao_wishlist(item_id: str, body: WishlistVincularBody):
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone():
            raise HTTPException(404, detail="item não encontrado")
        if body.transacao_id and not conn.execute(
            "SELECT 1 FROM fin_transaction WHERE id = ?", (body.transacao_id,)
        ).fetchone():
            raise HTTPException(422, detail="transacao_id não existe")
        conn.execute(
            "UPDATE fin_wishlist_item SET transacao_id = ?, atualizada_em = ? "
            "WHERE id = ?",
            (body.transacao_id, utcnow_iso_z(), item_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone()
        return _enrich_item(conn, row)


@router.get(
    "/api/finance/wishlist/items/aguardando-vinculo",
    response_model=list[WishlistItemOut],
)
def list_aguardando_vinculo():
    """Items 'comprado' sem transacao_id — pra UI sugerir match na importação."""
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM fin_wishlist_item "
            f"WHERE status = 'comprado' AND transacao_id IS NULL "
            f"ORDER BY comprado_em DESC"
        ).fetchall()
        return [_enrich_item(conn, r) for r in rows]


# ─── Links ────────────────────────────────────────────────────────────────

@router.post(
    "/api/finance/wishlist/items/{item_id}/links",
    response_model=WishlistLinkOut,
    status_code=201,
)
def create_wishlist_link(item_id: str, body: WishlistLinkCreate):
    url = body.url.strip()
    if not url:
        raise HTTPException(400, detail="url é obrigatória")
    link_id = _new_id()
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone():
            raise HTTPException(404, detail="item não encontrado")
        sort_order = body.sort_order
        if sort_order is None:
            row = conn.execute(
                "SELECT COALESCE(MAX(sort_order), 0) AS m FROM fin_wishlist_link "
                "WHERE item_id = ?",
                (item_id,),
            ).fetchone()
            sort_order = (row["m"] or 0) + 1
        conn.execute(
            "INSERT INTO fin_wishlist_link(id, item_id, url, label, preco, sort_order) "
            "VALUES(?,?,?,?,?,?)",
            (link_id, item_id, url, body.label, body.preco, sort_order),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {LINK_COLUMNS} FROM fin_wishlist_link WHERE id = ?",
            (link_id,),
        ).fetchone()
        return _link_dict(row)


@router.patch("/api/finance/wishlist/links/{link_id}", response_model=WishlistLinkOut)
def update_wishlist_link(link_id: str, body: WishlistLinkUpdate):
    fields: dict = {name: getattr(body, name) for name in body.model_fields_set}
    if not fields:
        raise HTTPException(400, detail="nada a atualizar")
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_wishlist_link WHERE id = ?", (link_id,)
        ).fetchone():
            raise HTTPException(404, detail="link não encontrado")
        if "url" in fields:
            fields["url"] = (fields["url"] or "").strip()
            if not fields["url"]:
                raise HTTPException(400, detail="url não pode ser vazia")
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE fin_wishlist_link SET {set_clause} WHERE id = ?",
            [*fields.values(), link_id],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {LINK_COLUMNS} FROM fin_wishlist_link WHERE id = ?", (link_id,)
        ).fetchone()
        return _link_dict(row)


@router.delete("/api/finance/wishlist/links/{link_id}", status_code=204)
def delete_wishlist_link(link_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM fin_wishlist_link WHERE id = ?", (link_id,))
        conn.commit()
    return None


# ─── Reservas (cronograma) ────────────────────────────────────────────────

@router.get(
    "/api/finance/wishlist/items/{item_id}/reservas",
    response_model=list[WishlistReservaOut],
)
def list_wishlist_reservas(item_id: str):
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone():
            raise HTTPException(404, detail="item não encontrado")
        rows = conn.execute(
            f"SELECT {RESERVA_COLUMNS} FROM fin_wishlist_reserva "
            f"WHERE item_id = ? ORDER BY ano ASC, mes ASC",
            (item_id,),
        ).fetchall()
        return [_reserva_dict(r) for r in rows]


@router.put(
    "/api/finance/wishlist/items/{item_id}/reservas",
    response_model=WishlistItemOut,
)
def replace_wishlist_reservas(item_id: str, body: list[WishlistReservaInput]):
    """Substitui cronograma inteiro do item. Idempotente."""
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone():
            raise HTTPException(404, detail="item não encontrado")
        # Antes de deletar, captura os vínculos existentes (item_id, ano, mes
        # → transacao_id) pra preservar quando user re-PUTa o cronograma só
        # pra mudar valor/dia sem perder o vínculo já feito.
        existing_links = {
            (r["ano"], r["mes"]): r["transacao_id"]
            for r in conn.execute(
                "SELECT ano, mes, transacao_id FROM fin_wishlist_reserva "
                "WHERE item_id = ? AND transacao_id IS NOT NULL",
                (item_id,),
            ).fetchall()
        }
        conn.execute("DELETE FROM fin_wishlist_reserva WHERE item_id = ?", (item_id,))
        for entry in body:
            preserved_tx = existing_links.get((entry.ano, entry.mes))
            conn.execute(
                "INSERT INTO fin_wishlist_reserva("
                "id, item_id, ano, mes, dia, valor_planejado, notas, transacao_id) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (
                    _new_id(),
                    item_id,
                    entry.ano,
                    entry.mes,
                    entry.dia,
                    entry.valor_planejado,
                    entry.notas,
                    preserved_tx,
                ),
            )
        # Se ganhou plano e estava 'desejado', vira 'poupando'.
        # Se perdeu plano (body=[]) e estava 'poupando', volta a 'desejado'.
        status_row = conn.execute(
            "SELECT status FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone()
        cur = status_row["status"]
        if body and cur == "desejado":
            conn.execute(
                "UPDATE fin_wishlist_item SET status = 'poupando', atualizada_em = ? "
                "WHERE id = ?",
                (utcnow_iso_z(), item_id),
            )
        elif not body and cur == "poupando":
            conn.execute(
                "UPDATE fin_wishlist_item SET status = 'desejado', atualizada_em = ? "
                "WHERE id = ?",
                (utcnow_iso_z(), item_id),
            )
        else:
            conn.execute(
                "UPDATE fin_wishlist_item SET atualizada_em = ? WHERE id = ?",
                (utcnow_iso_z(), item_id),
            )
        conn.commit()
        row = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM fin_wishlist_item WHERE id = ?", (item_id,)
        ).fetchone()
        return _enrich_item(conn, row)


@router.delete(
    "/api/finance/wishlist/items/{item_id}/reservas/{ano}/{mes}",
    status_code=204,
)
def delete_wishlist_reserva(item_id: str, ano: int, mes: int):
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM fin_wishlist_reserva "
            "WHERE item_id = ? AND ano = ? AND mes = ?",
            (item_id, ano, mes),
        )
        conn.commit()
    return None


# ─── Agregados ────────────────────────────────────────────────────────────

@router.get("/api/finance/wishlist/summary", response_model=WishlistSummary)
def wishlist_summary():
    with get_conn() as conn:
        ativos = conn.execute(
            "SELECT COUNT(*) AS n, COALESCE(SUM(valor_estimado), 0) AS total "
            "FROM fin_wishlist_item WHERE status IN ('desejado', 'poupando')"
        ).fetchone()
        em_curso = conn.execute(
            "SELECT COUNT(*) AS n FROM fin_wishlist_item WHERE status = 'poupando'"
        ).fetchone()["n"]

        # Fase 5 soft mode:
        #   * total_reservado_acumulado = SÓ reservas com vínculo (confirmadas)
        #   * total_reservado_pendente   = passadas SEM vínculo
        today = date.today()
        cur_ym = today.year * 100 + today.month
        conf_row = conn.execute(
            "SELECT COALESCE(SUM(r.valor_planejado), 0) AS total "
            "FROM fin_wishlist_reserva r "
            "JOIN fin_wishlist_item i ON i.id = r.item_id "
            "WHERE i.status IN ('desejado', 'poupando') "
            "AND r.transacao_id IS NOT NULL",
            (),
        ).fetchone()
        total_acum = float(conf_row["total"] or 0)
        pend_row = conn.execute(
            "SELECT COALESCE(SUM(r.valor_planejado), 0) AS total "
            "FROM fin_wishlist_reserva r "
            "JOIN fin_wishlist_item i ON i.id = r.item_id "
            "WHERE i.status IN ('desejado', 'poupando') "
            "AND r.transacao_id IS NULL "
            "AND (r.ano * 100 + r.mes) <= ?",
            (cur_ym,),
        ).fetchone()
        total_pendente = float(pend_row["total"] or 0)

        # Próxima compra estimada = item com maior progresso_pct entre 'poupando'.
        # Calculado em Python pra evitar SQL complexo.
        rows = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM fin_wishlist_item WHERE status = 'poupando'"
        ).fetchall()
        enriched = [_enrich_item(conn, r) for r in rows]
        proxima = max(enriched, key=lambda x: x["progresso_pct"], default=None)

        # Média mensal de reserva: média dos últimos 6 meses (passados) de
        # `valor_planejado` somado, considerando items ativos.
        media_mensal = 0.0
        if total_acum > 0:
            # Aproximação simples: total acumulado / meses desde primeira reserva.
            first_row = conn.execute(
                "SELECT MIN(ano * 100 + mes) AS first_ym "
                "FROM fin_wishlist_reserva r "
                "JOIN fin_wishlist_item i ON i.id = r.item_id "
                "WHERE i.status IN ('desejado', 'poupando')"
            ).fetchone()
            first_ym = first_row["first_ym"]
            if first_ym:
                fy, fm = divmod(int(first_ym), 100)
                meses = max(1, _months_between(date(fy, fm, 1), today) + 1)
                media_mensal = round(total_acum / meses, 2)

        return {
            "total_items_ativos": int(ativos["n"] or 0),
            "total_valor_estimado": float(ativos["total"] or 0),
            "total_reservado_acumulado": round(total_acum, 2),
            "total_reservado_pendente": round(total_pendente, 2),
            "itens_em_curso": int(em_curso or 0),
            "proxima_compra_id": proxima["id"] if proxima else None,
            "proxima_compra_nome": proxima["nome"] if proxima else None,
            "proxima_compra_progresso_pct": (
                proxima["progresso_pct"] if proxima else None
            ),
            "media_mensal_reserva": media_mensal,
        }


@router.get(
    "/api/finance/wishlist/reservas/mes",
    response_model=WishlistMonthReservas,
)
def wishlist_reservas_mes(year: int = Query(...), month: int = Query(...)):
    """Soma das reservas planejadas pro mês — consumido por monthly-summary
    pra calcular sobra real."""
    if month < 1 or month > 12:
        raise HTTPException(400, detail="month deve estar entre 1 e 12")
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT r.valor_planejado, r.item_id, i.nome "
            "FROM fin_wishlist_reserva r "
            "JOIN fin_wishlist_item i ON i.id = r.item_id "
            "WHERE r.ano = ? AND r.mes = ? "
            "AND i.status IN ('desejado', 'poupando')",
            (year, month),
        ).fetchall()
        total = sum(float(r["valor_planejado"] or 0) for r in rows)
        detalhamento = [
            {
                "item_id": r["item_id"],
                "item_nome": r["nome"],
                "valor_planejado": float(r["valor_planejado"] or 0),
            }
            for r in rows
        ]
        return {
            "ano": year,
            "mes": month,
            "total_reservado": round(total, 2),
            "detalhamento": detalhamento,
        }


# ─── Settings ─────────────────────────────────────────────────────────────

@router.get("/api/finance/wishlist/settings", response_model=WishlistSettingsOut)
def get_wishlist_settings():
    with get_conn() as conn:
        row = conn.execute(
            "SELECT envelhecimento_threshold_meses, atualizado_em "
            "FROM fin_wishlist_settings WHERE id = 1"
        ).fetchone()
        if not row:
            # Singleton ainda não inserido — devolve default.
            return {"envelhecimento_threshold_meses": 6, "atualizado_em": None}
        return dict(row)


@router.patch("/api/finance/wishlist/settings", response_model=WishlistSettingsOut)
def update_wishlist_settings(body: WishlistSettingsUpdate):
    fields: dict = {name: getattr(body, name) for name in body.model_fields_set}
    if not fields:
        raise HTTPException(400, detail="nada a atualizar")
    fields["atualizado_em"] = utcnow_iso_z()
    with get_conn() as conn:
        # Garante linha singleton (idempotente — se já existe, INSERT OR IGNORE no-op).
        conn.execute(
            "INSERT OR IGNORE INTO fin_wishlist_settings(id, envelhecimento_threshold_meses) "
            "VALUES(1, 6)"
        )
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE fin_wishlist_settings SET {set_clause} WHERE id = 1",
            list(fields.values()),
        )
        conn.commit()
        row = conn.execute(
            "SELECT envelhecimento_threshold_meses, atualizado_em "
            "FROM fin_wishlist_settings WHERE id = 1"
        ).fetchone()
        return dict(row)


# ─── Match transação ↔ item (Fase 3) ──────────────────────────────────────
#
# Heurística (decisão #10 e §5.4 do wishlist-PLAN):
#  - Transação `valor < 0` (despesa).
#  - Diferença de valor: `|abs(t.valor) - valor_alvo| <= max(5% * valor_alvo, 50)`.
#  - Data dentro de `± dias_janela` do `data_alvo`.
#  - Não vinculada a outro item de wishlist (`fin_wishlist_item.transacao_id`).
#  - Não é transferência interna nem parcela de dívida.
#  - Ordenadas por proximidade de valor, depois proximidade de data.


def _parse_iso_date(s: str):
    """Parse YYYY-MM-DD; deixa propagar ValueError se formato inválido."""
    from datetime import date as _date
    y, m, d = s.split("-")
    return _date(int(y), int(m), int(d))


def _find_match_candidates(
    conn,
    valor_alvo: float,
    data_alvo: str,
    dias_janela: int = 7,
    max_candidates: int = 10,
    *,
    incluir_transferencia: bool = False,
) -> list[dict]:
    """Retorna lista de dicts com {id, data, valor, descricao, conta_id,
    conta_nome, diff_pct}. valor_alvo é módulo (sempre positivo).

    `incluir_transferencia=True` é usado pra match de RESERVAS (Fase 5) —
    transferências internas tipo "Aplicação RDB" / pix pra caixinha são
    exatamente o que materializa uma reserva. Pra COMPRAS, mantém False
    (a compra real não é uma transferência interna)."""
    if valor_alvo <= 0:
        return []
    tol = max(0.05 * valor_alvo, 50.0)
    try:
        center = _parse_iso_date(data_alvo)
    except ValueError:
        return []
    from datetime import timedelta as _td
    de = (center - _td(days=dias_janela)).isoformat()
    ate = (center + _td(days=dias_janela)).isoformat()

    transf_clause = (
        ""
        if incluir_transferencia
        else " AND (c.tipo IS NULL OR c.tipo != 'transferencia')"
    )

    rows = conn.execute(
        f"""
        SELECT t.id, t.data, t.valor, t.descricao, t.conta_id,
               a.nome AS conta_nome
        FROM fin_transaction t
        LEFT JOIN fin_account a ON a.id = t.conta_id
        LEFT JOIN fin_category c ON c.id = t.categoria_id
        LEFT JOIN fin_wishlist_item wi ON wi.transacao_id = t.id
        LEFT JOIN fin_wishlist_reserva wr ON wr.transacao_id = t.id
        WHERE t.valor < 0
          AND ABS(ABS(t.valor) - ?) <= ?
          AND t.data >= ?
          AND t.data <= ?
          AND wi.id IS NULL
          AND wr.id IS NULL
          {transf_clause}
          AND t.divida_id IS NULL
        ORDER BY ABS(ABS(t.valor) - ?) ASC, t.data DESC
        LIMIT ?
        """,
        (valor_alvo, tol, de, ate, valor_alvo, max_candidates),
    ).fetchall()

    out: list[dict] = []
    for r in rows:
        valor = float(r["valor"])
        diff = abs(abs(valor) - valor_alvo)
        diff_pct = round((diff / valor_alvo) * 100, 1) if valor_alvo > 0 else 0.0
        out.append({
            "id": r["id"],
            "data": r["data"],
            "valor": valor,
            "descricao": r["descricao"],
            "conta_id": r["conta_id"],
            "conta_nome": r["conta_nome"],
            "diff_pct": diff_pct,
        })
    return out


@router.get(
    "/api/finance/wishlist/match-candidates",
    response_model=list[WishlistTransactionCandidate],
)
def match_candidates(
    valor: float = Query(..., gt=0, description="valor alvo absoluto em BRL"),
    data: str = Query(..., description="data alvo YYYY-MM-DD"),
    dias_janela: int = Query(7, ge=0, le=60),
    limit: int = Query(10, ge=1, le=50),
):
    """Lista transações candidatas a vincular a um item (preview pra Modal
    Comprar). User passa o `valor_real` e a `data` que pretende registrar,
    backend devolve transações compatíveis ainda não vinculadas."""
    with get_conn() as conn:
        return _find_match_candidates(conn, valor, data, dias_janela, limit)


@router.get(
    "/api/finance/wishlist/match-suggestions",
    response_model=list[WishlistMatchGroup],
)
def match_suggestions(
    dias_janela: int = Query(7, ge=0, le=60),
    limit_per_item: int = Query(5, ge=1, le=20),
):
    """Pós-importação: lista todos os items `comprado` sem `transacao_id`
    e devolve candidatas pra cada. Consumido pela tela de import e por um
    eventual painel "vínculos pendentes"."""
    with get_conn() as conn:
        items_rows = conn.execute(
            f"SELECT {ITEM_COLUMNS} FROM fin_wishlist_item "
            f"WHERE status = 'comprado' AND transacao_id IS NULL "
            f"ORDER BY comprado_em DESC"
        ).fetchall()
        out: list[dict] = []
        for r in items_rows:
            item_dict = _enrich_item(conn, r)
            valor_alvo = item_dict.get("valor_real") or item_dict.get("valor_estimado") or 0
            data_alvo = item_dict.get("comprado_em") or _today_iso()
            candidates = _find_match_candidates(
                conn,
                valor_alvo=float(valor_alvo),
                data_alvo=str(data_alvo),
                dias_janela=dias_janela,
                max_candidates=limit_per_item,
            )
            out.append({"item": item_dict, "candidates": candidates})
        return out


# ─── Vínculo de reserva ↔ transação (Fase 5) ──────────────────────────────
#
# Reservas deixam de ser passivas: só contam como "guardado" depois que você
# vincula a transação real que materializou (ex: transferência pra caixinha).
# Endpoints abaixo cobrem o ciclo:
#  - PATCH /reservas/{id}/transacao         → set/clear vínculo manual
#  - GET   /reservas/{id}/match-candidates  → preview pra Modal Vincular
#  - GET   /reservas/aguardando-vinculo     → reservas passadas sem vínculo
#  - GET   /match-suggestions-reservas      → pós-import (todas + candidatas)


def _last_day_of_month(year: int, month: int) -> int:
    from calendar import monthrange
    return monthrange(year, month)[1]


def _reserva_data_alvo(ano: int, mes: int, dia: int | None) -> str:
    """Data alvo da reserva pro match — usa `dia` se setado, senão último
    dia do mês. Útil porque "subi pra caixinha" geralmente acontece num
    dia específico do mês."""
    last = _last_day_of_month(ano, mes)
    d = min(dia, last) if dia else last
    return f"{ano:04d}-{mes:02d}-{d:02d}"


@router.patch(
    "/api/finance/wishlist/reservas/{reserva_id}/transacao",
    response_model=WishlistReservaOut,
)
def vincular_transacao_reserva(reserva_id: str, body: WishlistReservaVincularBody):
    """Vincula (ou desvincula com transacao_id=null) uma transação real a
    uma reserva planejada — marca a reserva como CONFIRMADA."""
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_wishlist_reserva WHERE id = ?", (reserva_id,)
        ).fetchone():
            raise HTTPException(404, detail="reserva não encontrada")
        if body.transacao_id:
            if not conn.execute(
                "SELECT 1 FROM fin_transaction WHERE id = ?", (body.transacao_id,)
            ).fetchone():
                raise HTTPException(422, detail="transacao_id não existe")
            # Garante exclusividade: a mesma transação não pode estar vinculada
            # a 2 reservas ou a item + reserva simultaneamente.
            outra_reserva = conn.execute(
                "SELECT id FROM fin_wishlist_reserva "
                "WHERE transacao_id = ? AND id != ?",
                (body.transacao_id, reserva_id),
            ).fetchone()
            if outra_reserva:
                raise HTTPException(
                    422, detail="transação já vinculada a outra reserva"
                )
            item_vinc = conn.execute(
                "SELECT id FROM fin_wishlist_item WHERE transacao_id = ?",
                (body.transacao_id,),
            ).fetchone()
            if item_vinc:
                raise HTTPException(
                    422, detail="transação já vinculada a um item de wishlist"
                )
        conn.execute(
            "UPDATE fin_wishlist_reserva SET transacao_id = ? WHERE id = ?",
            (body.transacao_id, reserva_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {RESERVA_COLUMNS} FROM fin_wishlist_reserva WHERE id = ?",
            (reserva_id,),
        ).fetchone()
        return _reserva_dict(row)


@router.get(
    "/api/finance/wishlist/reservas/{reserva_id}/match-candidates",
    response_model=list[WishlistTransactionCandidate],
)
def reserva_match_candidates(
    reserva_id: str,
    dias_janela: int = Query(15, ge=0, le=60),
    limit: int = Query(10, ge=1, le=50),
):
    """Lista transações candidatas pra materializar a reserva. Inclui
    transferências internas (categoria tipo 'transferencia') — diferente
    do match de compras, porque "subir pra caixinha" é exatamente isso."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT ano, mes, dia, valor_planejado FROM fin_wishlist_reserva "
            "WHERE id = ?",
            (reserva_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="reserva não encontrada")
        data_alvo = _reserva_data_alvo(row["ano"], row["mes"], row["dia"])
        return _find_match_candidates(
            conn,
            valor_alvo=float(row["valor_planejado"] or 0),
            data_alvo=data_alvo,
            dias_janela=dias_janela,
            max_candidates=limit,
            incluir_transferencia=True,
        )


@router.get(
    "/api/finance/wishlist/match-suggestions-reservas",
    response_model=list[WishlistReservaMatchGroup],
)
def match_suggestions_reservas(
    dias_janela: int = Query(15, ge=0, le=60),
    limit_per_reserva: int = Query(5, ge=1, le=20),
):
    """Pós-importação: reservas passadas/correntes sem vínculo + candidatas.
    Consumido pelo bloco "Sugestão da Wishlist" no ImportCsvModal pra você
    vincular as transferências/caixinha às reservas planejadas."""
    today = date.today()
    cur_ym = today.year * 100 + today.month
    with get_conn() as conn:
        reserva_rows = conn.execute(
            "SELECT r.id, r.ano, r.mes, r.dia, r.valor_planejado, r.notas, "
            "r.transacao_id, r.item_id, i.nome AS item_nome "
            "FROM fin_wishlist_reserva r "
            "JOIN fin_wishlist_item i ON i.id = r.item_id "
            "WHERE r.transacao_id IS NULL "
            "AND (r.ano * 100 + r.mes) <= ? "
            "AND i.status IN ('desejado', 'poupando') "
            "ORDER BY r.ano DESC, r.mes DESC",
            (cur_ym,),
        ).fetchall()
        out: list[dict] = []
        for r in reserva_rows:
            data_alvo = _reserva_data_alvo(r["ano"], r["mes"], r["dia"])
            candidates = _find_match_candidates(
                conn,
                valor_alvo=float(r["valor_planejado"] or 0),
                data_alvo=data_alvo,
                dias_janela=dias_janela,
                max_candidates=limit_per_reserva,
                incluir_transferencia=True,
            )
            reserva_dict = {
                "id": r["id"], "ano": r["ano"], "mes": r["mes"], "dia": r["dia"],
                "valor_planejado": r["valor_planejado"], "notas": r["notas"],
                "transacao_id": r["transacao_id"],
            }
            out.append({
                "reserva": reserva_dict,
                "item_id": r["item_id"],
                "item_nome": r["item_nome"],
                "candidates": candidates,
            })
        return out
