"""Hub Finance — endpoints v0 (vertical slice).

CRUD básico de Conta, Categoria, Transação + saldo. Sem pynubank, sem fatura,
sem dívida — essas vêm em fases posteriores. Doc autoritativa:
docs/hub-finance/PLAN.md.

Convenção de paths: /api/finance/<resource>. Mantém isolado dos outros
módulos do Hub Quest e fica claro no swagger/docs.
"""
from __future__ import annotations

import csv
import io
import uuid
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from db import get_conn
from models.finance import (
    AccountCreate,
    AccountOut,
    AccountUpdate,
    ApplyTemplateBody,
    CategorizationRuleCreate,
    CategorizationRuleOut,
    CategorizationRuleUpdate,
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    ClientCreate,
    ClientOut,
    ClientUpdate,
    DebtCreate,
    DebtOut,
    DebtParcelaComplete,
    DebtParcelaCreate,
    DebtParcelaGenerate,
    DebtParcelaOut,
    DebtParcelaUpdate,
    DebtUpdate,
    MonthCommitment,
    MonthCommitmentsResponse,
    ImportSummary,
    InvoiceCreate,
    InvoiceOut,
    InvoicePayBody,
    InvoiceUpdate,
    ParcelaCreate,
    ParcelaOut,
    ParcelaUpdate,
    RecurringBillCreate,
    RecurringBillOut,
    RecurringBillStatusMonth,
    RecurringBillUpdate,
    TransactionCreate,
    TransactionOut,
    TransactionUpdate,
)
from services.utils import utcnow_iso_z


router = APIRouter()


def _new_id() -> str:
    return str(uuid.uuid4())[:8]


# ─── Accounts ──────────────────────────────────────────────────────────────

ACCOUNT_COLUMNS = "id, nome, tipo, moeda, origem_dados, sort_order, cotacao_brl"


def _account_with_balance(conn, row) -> dict:
    """Combina row de fin_account com saldo calculado (soma das transações)."""
    d = dict(row)
    saldo_row = conn.execute(
        "SELECT COALESCE(SUM(valor), 0) AS saldo FROM fin_transaction WHERE conta_id = ?",
        (d["id"],),
    ).fetchone()
    d["saldo"] = float(saldo_row["saldo"] or 0)
    return d


@router.get("/api/finance/accounts", response_model=list[AccountOut])
def list_accounts():
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT {ACCOUNT_COLUMNS} FROM fin_account ORDER BY sort_order ASC, created_at ASC"
        ).fetchall()
        return [_account_with_balance(conn, r) for r in rows]


@router.post("/api/finance/accounts", response_model=AccountOut, status_code=201)
def create_account(body: AccountCreate):
    nome = body.nome.strip()
    if not nome:
        raise HTTPException(400, detail="nome é obrigatório")
    account_id = _new_id()
    with get_conn() as conn:
        max_sort = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) AS m FROM fin_account"
        ).fetchone()
        sort_order = (max_sort["m"] or 0) + 1
        conn.execute(
            "INSERT INTO fin_account(id, nome, tipo, moeda, origem_dados, sort_order, cotacao_brl) "
            "VALUES(?,?,?,?,?,?,?)",
            (account_id, nome, body.tipo, body.moeda, body.origem_dados, sort_order,
             body.cotacao_brl),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {ACCOUNT_COLUMNS} FROM fin_account WHERE id = ?",
            (account_id,),
        ).fetchone()
        return _account_with_balance(conn, row)


@router.patch("/api/finance/accounts/{account_id}", response_model=AccountOut)
def update_account(account_id: str, body: AccountUpdate):
    fields: dict = {name: getattr(body, name) for name in body.model_fields_set}
    if not fields:
        raise HTTPException(400, detail="Nada a atualizar")
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM fin_account WHERE id = ?", (account_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Conta não encontrada")
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE fin_account SET {set_clause} WHERE id = ?",
            [*fields.values(), account_id],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {ACCOUNT_COLUMNS} FROM fin_account WHERE id = ?",
            (account_id,),
        ).fetchone()
        return _account_with_balance(conn, row)


@router.delete("/api/finance/accounts/{account_id}", status_code=204)
def delete_account(account_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM fin_account WHERE id = ?", (account_id,))
        conn.commit()
    return None


@router.post("/api/finance/accounts/reorder", status_code=204)
def reorder_accounts(body: dict):
    """Reordena contas por sort_order. Body: `{"ids": [id1, id2, ...]}` na
    ordem desejada. Atribui sort_order = 1, 2, 3... pra cada id."""
    ids = body.get("ids") or []
    if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
        raise HTTPException(400, detail="body precisa de `ids` (lista de strings)")
    with get_conn() as conn:
        for idx, account_id in enumerate(ids, start=1):
            conn.execute(
                "UPDATE fin_account SET sort_order = ? WHERE id = ?",
                (idx, account_id),
            )
        conn.commit()
    return None


@router.get("/api/finance/accounts/{account_id}/usage")
def account_usage(account_id: str):
    """Conta o que tá vinculado a essa conta. Usado pelo modal de delete pra
    avisar quanta coisa será apagada (transações cascateiam, faturas idem).
    """
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_account WHERE id = ?", (account_id,)
        ).fetchone():
            raise HTTPException(404, detail="Conta não encontrada")
        tx_count = conn.execute(
            "SELECT COUNT(*) AS n FROM fin_transaction WHERE conta_id = ?",
            (account_id,),
        ).fetchone()["n"]
        invoice_count = conn.execute(
            "SELECT COUNT(*) AS n FROM fin_invoice WHERE cartao_id = ?",
            (account_id,),
        ).fetchone()["n"]
    return {
        "account_id": account_id,
        "transactions": tx_count,
        "invoices": invoice_count,
    }


# ─── Categories ────────────────────────────────────────────────────────────

CATEGORY_COLUMNS = "id, nome, tipo, cor, categoria_pai_id, sort_order"


@router.get("/api/finance/categories", response_model=list[CategoryOut])
def list_categories(tipo: Optional[str] = Query(None)):
    sql = f"SELECT {CATEGORY_COLUMNS} FROM fin_category"
    params: list = []
    if tipo is not None:
        sql += " WHERE tipo = ?"
        params.append(tipo)
    sql += " ORDER BY sort_order ASC, nome ASC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


@router.post("/api/finance/categories", response_model=CategoryOut, status_code=201)
def create_category(body: CategoryCreate):
    nome = body.nome.strip()
    if not nome:
        raise HTTPException(400, detail="nome é obrigatório")
    cat_id = _new_id()
    with get_conn() as conn:
        max_sort = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) AS m FROM fin_category"
        ).fetchone()
        sort_order = (max_sort["m"] or 0) + 1
        conn.execute(
            "INSERT INTO fin_category(id, nome, tipo, cor, categoria_pai_id, sort_order) "
            "VALUES(?,?,?,?,?,?)",
            (cat_id, nome, body.tipo, body.cor, body.categoria_pai_id, sort_order),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {CATEGORY_COLUMNS} FROM fin_category WHERE id = ?",
            (cat_id,),
        ).fetchone()
    return dict(row)


@router.patch("/api/finance/categories/{category_id}", response_model=CategoryOut)
def update_category(category_id: str, body: CategoryUpdate):
    fields: dict = {name: getattr(body, name) for name in body.model_fields_set}
    if not fields:
        raise HTTPException(400, detail="Nada a atualizar")
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM fin_category WHERE id = ?", (category_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Categoria não encontrada")
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE fin_category SET {set_clause} WHERE id = ?",
            [*fields.values(), category_id],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {CATEGORY_COLUMNS} FROM fin_category WHERE id = ?",
            (category_id,),
        ).fetchone()
    return dict(row)


@router.delete("/api/finance/categories/{category_id}", status_code=204)
def delete_category(category_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM fin_category WHERE id = ?", (category_id,))
        conn.commit()
    return None


# ─── Transactions ──────────────────────────────────────────────────────────

TRANSACTION_COLUMNS = (
    "id, data, valor, descricao, conta_id, categoria_id, origem, notas, "
    "nubank_id, divida_id, parcela_id, fatura_id, pagamento_fatura_id, "
    "recurring_bill_id, created_at, updated_at"
)


@router.get("/api/finance/transactions", response_model=list[TransactionOut])
def list_transactions(
    conta_id: Optional[str] = Query(None),
    categoria_id: Optional[str] = Query(None),
    data_de: Optional[str] = Query(None, description="YYYY-MM-DD inclusive"),
    data_ate: Optional[str] = Query(None, description="YYYY-MM-DD inclusive"),
    limit: int = Query(100, ge=1, le=500),
):
    sql = f"SELECT {TRANSACTION_COLUMNS} FROM fin_transaction WHERE 1=1"
    params: list = []
    if conta_id:
        sql += " AND conta_id = ?"
        params.append(conta_id)
    if categoria_id:
        sql += " AND categoria_id = ?"
        params.append(categoria_id)
    if data_de:
        sql += " AND data >= ?"
        params.append(data_de)
    if data_ate:
        sql += " AND data <= ?"
        params.append(data_ate)
    sql += " ORDER BY data DESC, created_at DESC LIMIT ?"
    params.append(limit)
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


@router.post("/api/finance/transactions", response_model=TransactionOut, status_code=201)
def create_transaction(body: TransactionCreate):
    descricao = body.descricao.strip()
    if not descricao:
        raise HTTPException(400, detail="descricao é obrigatória")
    tx_id = _new_id()
    with get_conn() as conn:
        # Valida FKs explicitamente — devolve 422 amigável em vez de IntegrityError.
        conta = conn.execute(
            "SELECT id, tipo FROM fin_account WHERE id = ?", (body.conta_id,)
        ).fetchone()
        if not conta:
            raise HTTPException(422, detail="conta_id não existe")
        if body.categoria_id and not conn.execute(
            "SELECT 1 FROM fin_category WHERE id = ?", (body.categoria_id,)
        ).fetchone():
            raise HTTPException(422, detail="categoria_id não existe")
        if body.recurring_bill_id and not conn.execute(
            "SELECT 1 FROM fin_recurring_bill WHERE id = ?", (body.recurring_bill_id,)
        ).fetchone():
            raise HTTPException(422, detail="recurring_bill_id não existe")
        # Auto-vínculo a parcela: só se for entrada (valor > 0) e usuário não
        # passou parcela_id explícito. Helper devolve None se ambíguo.
        suggested_parcela = _suggest_parcela_by_descricao(conn, descricao, body.valor)
        # Auto-vínculo a fatura: se conta é tipo cartão de crédito e
        # categoria não é transferência (pra não confundir pagamento de
        # fatura com compra), garante fatura aberta e vincula.
        fatura_id: Optional[str] = None
        if conta["tipo"] == "credito":
            cat_tipo = None
            if body.categoria_id:
                row = conn.execute(
                    "SELECT tipo FROM fin_category WHERE id = ?", (body.categoria_id,)
                ).fetchone()
                cat_tipo = row["tipo"] if row else None
            if cat_tipo != "transferencia":
                fatura_id = _ensure_open_invoice(conn, body.conta_id, body.data)
        conn.execute(
            "INSERT INTO fin_transaction(id, data, valor, descricao, conta_id, "
            "categoria_id, origem, notas, parcela_id, fatura_id, recurring_bill_id) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                tx_id, body.data, body.valor, descricao, body.conta_id,
                body.categoria_id, body.origem, body.notas, suggested_parcela,
                fatura_id, body.recurring_bill_id,
            ),
        )
        if suggested_parcela:
            _maybe_update_parcela_status(conn, suggested_parcela)
        conn.commit()
        row = conn.execute(
            f"SELECT {TRANSACTION_COLUMNS} FROM fin_transaction WHERE id = ?",
            (tx_id,),
        ).fetchone()
    return dict(row)


@router.patch("/api/finance/transactions/{tx_id}", response_model=TransactionOut)
def update_transaction(tx_id: str, body: TransactionUpdate):
    fields: dict = {name: getattr(body, name) for name in body.model_fields_set}
    if not fields:
        raise HTTPException(400, detail="Nada a atualizar")
    with get_conn() as conn:
        prev = conn.execute(
            "SELECT divida_id, parcela_id, pagamento_fatura_id, data "
            "FROM fin_transaction WHERE id = ?", (tx_id,)
        ).fetchone()
        if not prev:
            raise HTTPException(404, detail="Transação não encontrada")
        if "conta_id" in fields and not conn.execute(
            "SELECT 1 FROM fin_account WHERE id = ?", (fields["conta_id"],)
        ).fetchone():
            raise HTTPException(422, detail="conta_id não existe")
        if "categoria_id" in fields and fields["categoria_id"] and not conn.execute(
            "SELECT 1 FROM fin_category WHERE id = ?", (fields["categoria_id"],)
        ).fetchone():
            raise HTTPException(422, detail="categoria_id não existe")
        if "divida_id" in fields and fields["divida_id"] and not conn.execute(
            "SELECT 1 FROM fin_debt WHERE id = ?", (fields["divida_id"],)
        ).fetchone():
            raise HTTPException(422, detail="divida_id não existe")
        if "parcela_id" in fields and fields["parcela_id"] and not conn.execute(
            "SELECT 1 FROM fin_parcela WHERE id = ?", (fields["parcela_id"],)
        ).fetchone():
            raise HTTPException(422, detail="parcela_id não existe")
        if "fatura_id" in fields and fields["fatura_id"] and not conn.execute(
            "SELECT 1 FROM fin_invoice WHERE id = ?", (fields["fatura_id"],)
        ).fetchone():
            raise HTTPException(422, detail="fatura_id não existe")
        if "recurring_bill_id" in fields and fields["recurring_bill_id"] and not conn.execute(
            "SELECT 1 FROM fin_recurring_bill WHERE id = ?", (fields["recurring_bill_id"],)
        ).fetchone():
            raise HTTPException(422, detail="recurring_bill_id não existe")
        # Validar pagamento_fatura_id (link "esta tx é o pagamento da fatura X")
        if "pagamento_fatura_id" in fields and fields["pagamento_fatura_id"]:
            inv = conn.execute(
                "SELECT id, status FROM fin_invoice WHERE id = ?",
                (fields["pagamento_fatura_id"],)
            ).fetchone()
            if not inv:
                raise HTTPException(422, detail="pagamento_fatura_id não existe")
            # Permite re-link se a fatura já tava paga POR ESTA tx (idempotente);
            # rejeita se outra tx já pagou.
            if inv["status"] == "paga" and prev["pagamento_fatura_id"] != inv["id"]:
                raise HTTPException(409, detail="Fatura já está paga por outra transação")
        fields["updated_at"] = utcnow_iso_z()
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE fin_transaction SET {set_clause} WHERE id = ?",
            [*fields.values(), tx_id],
        )
        # Recalcula status das dívidas afetadas: tanto a anterior (pode ter
        # ficado active de novo) quanto a nova (pode ter zerado).
        affected_debts: set[str] = set()
        if prev["divida_id"]:
            affected_debts.add(prev["divida_id"])
        new_divida = fields.get("divida_id", prev["divida_id"])
        if new_divida:
            affected_debts.add(new_divida)

        # Quando divida_id muda na tx, parcelas que apontavam pra ela podem
        # ficar órfãs (a tx saiu da dívida). Se a nova divida_id da tx ainda
        # bate com a divida_id da parcela, mantém o link; senão, libera a
        # parcela (volta a ser pendente) e marca a dívida pra recálculo.
        # Sem isso, a parcela continuava marcada como "paga" apontando pra
        # uma tx que já não a referencia mais — bug user-visible.
        if "divida_id" in fields:
            orphan_parcelas = list(conn.execute(
                "SELECT id, divida_id FROM fin_debt_parcela WHERE transacao_pagamento_id = ?",
                (tx_id,),
            ).fetchall())
            for p in orphan_parcelas:
                if new_divida != p["divida_id"]:
                    conn.execute(
                        "UPDATE fin_debt_parcela SET transacao_pagamento_id = NULL "
                        "WHERE id = ?",
                        (p["id"],),
                    )
                    affected_debts.add(p["divida_id"])

        for did in affected_debts:
            _maybe_update_debt_status(conn, did)
        # Mesma lógica pras parcelas afetadas.
        affected_parcelas: set[str] = set()
        if prev["parcela_id"]:
            affected_parcelas.add(prev["parcela_id"])
        new_parcela = fields.get("parcela_id", prev["parcela_id"])
        if new_parcela:
            affected_parcelas.add(new_parcela)
        for pid in affected_parcelas:
            _maybe_update_parcela_status(conn, pid)
        # Sincroniza status das faturas pagas/des-pagas via pagamento_fatura_id.
        # - Linkando: marca fatura como `paga` + data_pagamento = data da tx
        # - Deslinkando: reverte fatura pra 'fechada' + clear data_pagamento
        if "pagamento_fatura_id" in fields:
            new_pag = fields["pagamento_fatura_id"]
            old_pag = prev["pagamento_fatura_id"]
            new_data = fields.get("data", prev["data"])
            now_iso = utcnow_iso_z()
            # Desvincula a fatura anterior se mudou
            if old_pag and old_pag != new_pag:
                conn.execute(
                    "UPDATE fin_invoice SET status = 'fechada', data_pagamento = NULL, "
                    "updated_at = ? WHERE id = ?",
                    (now_iso, old_pag),
                )
            # Marca a nova fatura como paga
            if new_pag:
                conn.execute(
                    "UPDATE fin_invoice SET status = 'paga', data_pagamento = ?, "
                    "updated_at = ? WHERE id = ?",
                    (new_data, now_iso, new_pag),
                )
        conn.commit()
        row = conn.execute(
            f"SELECT {TRANSACTION_COLUMNS} FROM fin_transaction WHERE id = ?",
            (tx_id,),
        ).fetchone()
    return dict(row)


@router.delete("/api/finance/transactions/{tx_id}", status_code=204)
def delete_transaction(tx_id: str):
    with get_conn() as conn:
        # Pega FKs antes de deletar pra recalcular/reverter o que depende.
        row = conn.execute(
            "SELECT divida_id, parcela_id, pagamento_fatura_id "
            "FROM fin_transaction WHERE id = ?", (tx_id,)
        ).fetchone()
        prev_divida = row["divida_id"] if row else None
        prev_parcela = row["parcela_id"] if row else None
        prev_pag_fatura = row["pagamento_fatura_id"] if row else None
        # Antes de deletar, libera quaisquer parcelas de dívida que apontavam
        # pra esta tx (transacao_pagamento_id agora aponta pra nada). Sem isso,
        # a parcela continuava marcada como paga após o usuário deletar a tx.
        orphan_parcela_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM fin_debt_parcela WHERE transacao_pagamento_id = ?",
            (tx_id,),
        ).fetchall()]
        if orphan_parcela_ids:
            conn.execute(
                "UPDATE fin_debt_parcela SET transacao_pagamento_id = NULL "
                "WHERE transacao_pagamento_id = ?",
                (tx_id,),
            )
        conn.execute("DELETE FROM fin_transaction WHERE id = ?", (tx_id,))
        if prev_divida:
            # Saldo voltou a subir — se era 'paid_off', volta pra 'active'.
            d = conn.execute(
                f"SELECT {DEBT_COLUMNS} FROM fin_debt WHERE id = ?", (prev_divida,)
            ).fetchone()
            if d:
                enriched = _debt_with_progress(conn, d)
                if d["status"] == "paid_off" and enriched["saldo_devedor"] > 0.01:
                    conn.execute(
                        "UPDATE fin_debt SET status = 'active', updated_at = ? WHERE id = ?",
                        (utcnow_iso_z(), prev_divida),
                    )
        if prev_parcela:
            _maybe_update_parcela_status(conn, prev_parcela)
        # Reverte fatura desvinculada — perdeu sua tx de pagamento.
        if prev_pag_fatura:
            conn.execute(
                "UPDATE fin_invoice SET status = 'fechada', data_pagamento = NULL, "
                "updated_at = ? WHERE id = ?",
                (utcnow_iso_z(), prev_pag_fatura),
            )
        conn.commit()
    return None


# ─── Summary ───────────────────────────────────────────────────────────────

# ─── Parcelas (recebimentos esperados de projetos) ───────────────────────

PARCELA_COLUMNS = (
    "id, projeto_id, numero, valor, data_prevista, status, observacao"
)


def _parcela_with_recebimento(conn, row) -> dict:
    """Anexa transacao_recebimento_id (FK reverso via fin_transaction.parcela_id).
    Como é 1:1 (uma parcela é paga por uma transação), pega LIMIT 1.
    """
    d = dict(row)
    tx = conn.execute(
        "SELECT id FROM fin_transaction WHERE parcela_id = ? LIMIT 1",
        (d["id"],),
    ).fetchone()
    d["transacao_recebimento_id"] = tx["id"] if tx else None
    return d


def _maybe_update_parcela_status(conn, parcela_id: str) -> None:
    """Se há transação de entrada (valor > 0) vinculada à parcela, marca como
    'recebido'. Se não há, e estava 'recebido', volta pra 'pendente'.
    Não mexe se status era 'cancelada' (decisão manual)."""
    parcela = conn.execute(
        f"SELECT {PARCELA_COLUMNS} FROM fin_parcela WHERE id = ?", (parcela_id,)
    ).fetchone()
    if not parcela or parcela["status"] == "cancelada":
        return
    has_payment = conn.execute(
        "SELECT 1 FROM fin_transaction WHERE parcela_id = ? AND valor > 0 LIMIT 1",
        (parcela_id,),
    ).fetchone()
    target_status = "recebido" if has_payment else "pendente"
    if parcela["status"] != target_status:
        conn.execute(
            "UPDATE fin_parcela SET status = ?, updated_at = ? WHERE id = ?",
            (target_status, utcnow_iso_z(), parcela_id),
        )


@router.get("/api/finance/parcelas")
def list_all_parcelas(status: Optional[str] = Query(None)):
    """Lista parcelas de todos os projetos. Suporta filtro por status.

    Retorna shape estendido com `projeto_titulo` pra UI mostrar contexto sem
    fazer N+1 queries no frontend (caso típico: select de "vincular a parcela"
    no CategorizeModal).
    """
    sql = (
        f"SELECT fp.id, fp.projeto_id, fp.numero, fp.valor, fp.data_prevista, "
        f"       fp.status, fp.observacao, p.title AS projeto_titulo "
        f"FROM fin_parcela fp JOIN projects p ON p.id = fp.projeto_id"
    )
    params: list = []
    if status:
        sql += " WHERE fp.status = ?"
        params.append(status)
    sql += " ORDER BY fp.data_prevista ASC NULLS LAST, fp.numero ASC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        out = []
        for r in rows:
            d = _parcela_with_recebimento(conn, r)
            d["projeto_titulo"] = r["projeto_titulo"]
            out.append(d)
        return out


@router.get("/api/finance/projects/{project_id}/parcelas", response_model=list[ParcelaOut])
def list_parcelas(project_id: str):
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone():
            raise HTTPException(404, detail="Projeto não encontrado")
        rows = conn.execute(
            f"SELECT {PARCELA_COLUMNS} FROM fin_parcela "
            "WHERE projeto_id = ? ORDER BY numero ASC",
            (project_id,),
        ).fetchall()
        return [_parcela_with_recebimento(conn, r) for r in rows]


@router.post(
    "/api/finance/projects/{project_id}/parcelas",
    response_model=ParcelaOut,
    status_code=201,
)
def create_parcela(project_id: str, body: ParcelaCreate):
    if body.valor <= 0:
        raise HTTPException(400, detail="valor deve ser > 0")
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone():
            raise HTTPException(404, detail="Projeto não encontrado")
        max_num = conn.execute(
            "SELECT COALESCE(MAX(numero), 0) AS m FROM fin_parcela WHERE projeto_id = ?",
            (project_id,),
        ).fetchone()["m"]
        parcela_id = _new_id()
        conn.execute(
            "INSERT INTO fin_parcela(id, projeto_id, numero, valor, data_prevista, observacao) "
            "VALUES(?,?,?,?,?,?)",
            (parcela_id, project_id, (max_num or 0) + 1, body.valor,
             body.data_prevista, body.observacao),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {PARCELA_COLUMNS} FROM fin_parcela WHERE id = ?", (parcela_id,)
        ).fetchone()
        return _parcela_with_recebimento(conn, row)


@router.post(
    "/api/finance/projects/{project_id}/parcelas/apply-template",
    response_model=list[ParcelaOut],
)
def apply_template(project_id: str, body: ApplyTemplateBody):
    """Cria N parcelas a partir do template + valor_acordado do projeto.

    Apaga TODAS as parcelas pendentes existentes (status='pendente') antes
    de aplicar — protege as recebidas. Útil pra testar templates sem perder
    histórico real.
    """
    with get_conn() as conn:
        proj = conn.execute(
            "SELECT id, valor_acordado FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        if not proj:
            raise HTTPException(404, detail="Projeto não encontrado")
        valor = proj["valor_acordado"]
        if not valor or valor <= 0:
            raise HTTPException(
                422,
                detail="Defina valor_acordado do projeto antes de gerar parcelas",
            )

        # Quantidades + percentuais por template (informativo).
        if body.template == "a_vista":
            partes = [1.0]
        elif body.template == "50_50":
            partes = [0.5, 0.5]
        elif body.template == "parcelado_3x":
            partes = [1/3, 1/3, 1/3]
        elif body.template == "parcelado_4x":
            partes = [0.25, 0.25, 0.25, 0.25]
        else:  # custom — cria 1 parcela vazia, usuário edita
            partes = [1.0]

        # Datas previstas: se data_inicio veio, distribui mensalmente.
        from datetime import date as _date
        from calendar import monthrange
        datas: list[Optional[str]] = []
        if body.data_inicio:
            try:
                d0 = _date.fromisoformat(body.data_inicio)
            except ValueError:
                raise HTTPException(400, detail="data_inicio inválida (use YYYY-MM-DD)")
            for i in range(len(partes)):
                # Avança i meses, capping no último dia do mês destino.
                month = d0.month + i
                year = d0.year + (month - 1) // 12
                month = ((month - 1) % 12) + 1
                day = min(d0.day, monthrange(year, month)[1])
                datas.append(_date(year, month, day).isoformat())
        else:
            datas = [None] * len(partes)

        # Apaga só pendentes — preserva recebidas.
        conn.execute(
            "DELETE FROM fin_parcela WHERE projeto_id = ? AND status = 'pendente'",
            (project_id,),
        )
        # Renumera começando após as recebidas existentes.
        max_num = conn.execute(
            "SELECT COALESCE(MAX(numero), 0) AS m FROM fin_parcela WHERE projeto_id = ?",
            (project_id,),
        ).fetchone()["m"] or 0

        # Arredondamento pra 2 casas + ajuste do último pra zerar a soma.
        valores = [round(valor * p, 2) for p in partes]
        # Corrige drift de arredondamento na última parcela.
        if valores:
            valores[-1] = round(valor - sum(valores[:-1]), 2)

        new_rows = []
        for i, (v, d) in enumerate(zip(valores, datas)):
            pid = _new_id()
            conn.execute(
                "INSERT INTO fin_parcela(id, projeto_id, numero, valor, data_prevista) "
                "VALUES(?,?,?,?,?)",
                (pid, project_id, max_num + i + 1, v, d),
            )
            new_rows.append(pid)

        # Salva o template no projeto pra UI lembrar.
        conn.execute(
            "UPDATE projects SET forma_pagamento_template = ?, updated_at = ? WHERE id = ?",
            (body.template, utcnow_iso_z(), project_id),
        )
        conn.commit()

        rows = conn.execute(
            f"SELECT {PARCELA_COLUMNS} FROM fin_parcela "
            "WHERE projeto_id = ? ORDER BY numero ASC",
            (project_id,),
        ).fetchall()
        return [_parcela_with_recebimento(conn, r) for r in rows]


@router.patch("/api/finance/parcelas/{parcela_id}", response_model=ParcelaOut)
def update_parcela(parcela_id: str, body: ParcelaUpdate):
    fields: dict = {name: getattr(body, name) for name in body.model_fields_set}
    if not fields:
        raise HTTPException(400, detail="Nada a atualizar")
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM fin_parcela WHERE id = ?", (parcela_id,)).fetchone():
            raise HTTPException(404, detail="Parcela não encontrada")
        fields["updated_at"] = utcnow_iso_z()
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE fin_parcela SET {set_clause} WHERE id = ?",
            [*fields.values(), parcela_id],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {PARCELA_COLUMNS} FROM fin_parcela WHERE id = ?", (parcela_id,)
        ).fetchone()
        return _parcela_with_recebimento(conn, row)


@router.delete("/api/finance/parcelas/{parcela_id}", status_code=204)
def delete_parcela(parcela_id: str):
    with get_conn() as conn:
        # Limpa vínculo de transações antes (FK ALTER não suporta SET NULL).
        conn.execute("UPDATE fin_transaction SET parcela_id = NULL WHERE parcela_id = ?", (parcela_id,))
        conn.execute("DELETE FROM fin_parcela WHERE id = ?", (parcela_id,))
        conn.commit()
    return None


# ─── Invoices (faturas de cartão de crédito) ─────────────────────────────

INVOICE_COLUMNS = (
    "id, cartao_id, mes_referencia, data_fechamento, data_vencimento, "
    "data_pagamento, status"
)


def _invoice_with_total(conn, row) -> dict:
    """Combina row de fin_invoice com total computado e contagem de transações."""
    d = dict(row)
    agg = conn.execute(
        "SELECT COALESCE(SUM(-valor), 0) AS total, COUNT(*) AS n "
        "FROM fin_transaction WHERE fatura_id = ? AND valor < 0",
        (d["id"],),
    ).fetchone()
    d["total"] = float(agg["total"] or 0)
    d["transacoes_count"] = int(agg["n"] or 0)
    return d


def _ensure_open_invoice(conn, cartao_id: str, ref_date: str) -> str:
    """Garante que existe fatura ABERTA pro cartão. Se não há, cria uma com
    `mes_referencia` = mês de `ref_date` (YYYY-MM-DD). Retorna o id da fatura.

    Usado no INSERT de transação numa conta de crédito — vincula a compra
    à fatura aberta automaticamente.
    """
    existing = conn.execute(
        "SELECT id FROM fin_invoice WHERE cartao_id = ? AND status = 'aberta' LIMIT 1",
        (cartao_id,),
    ).fetchone()
    if existing:
        return existing["id"]
    invoice_id = _new_id()
    mes_ref = ref_date[:7] if len(ref_date) >= 7 else ref_date
    conn.execute(
        "INSERT INTO fin_invoice(id, cartao_id, mes_referencia) VALUES(?,?,?)",
        (invoice_id, cartao_id, mes_ref),
    )
    return invoice_id


@router.get("/api/finance/invoices", response_model=list[InvoiceOut])
def list_invoices(
    cartao_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    sql = f"SELECT {INVOICE_COLUMNS} FROM fin_invoice WHERE 1=1"
    params: list = []
    if cartao_id:
        sql += " AND cartao_id = ?"
        params.append(cartao_id)
    if status:
        sql += " AND status = ?"
        params.append(status)
    sql += " ORDER BY mes_referencia DESC, created_at DESC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_invoice_with_total(conn, r) for r in rows]


@router.post("/api/finance/invoices", response_model=InvoiceOut, status_code=201)
def create_invoice(body: InvoiceCreate):
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_account WHERE id = ? AND tipo = 'credito'",
            (body.cartao_id,),
        ).fetchone():
            raise HTTPException(422, detail="cartao_id inválido (precisa ser conta tipo='credito')")
        invoice_id = _new_id()
        conn.execute(
            "INSERT INTO fin_invoice(id, cartao_id, mes_referencia, "
            "data_fechamento, data_vencimento) VALUES(?,?,?,?,?)",
            (invoice_id, body.cartao_id, body.mes_referencia,
             body.data_fechamento, body.data_vencimento),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {INVOICE_COLUMNS} FROM fin_invoice WHERE id = ?", (invoice_id,)
        ).fetchone()
        return _invoice_with_total(conn, row)


@router.patch("/api/finance/invoices/{invoice_id}", response_model=InvoiceOut)
def update_invoice(invoice_id: str, body: InvoiceUpdate):
    fields: dict = {name: getattr(body, name) for name in body.model_fields_set}
    if not fields:
        raise HTTPException(400, detail="Nada a atualizar")
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM fin_invoice WHERE id = ?", (invoice_id,)).fetchone():
            raise HTTPException(404, detail="Fatura não encontrada")
        fields["updated_at"] = utcnow_iso_z()
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE fin_invoice SET {set_clause} WHERE id = ?",
            [*fields.values(), invoice_id],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {INVOICE_COLUMNS} FROM fin_invoice WHERE id = ?", (invoice_id,)
        ).fetchone()
        return _invoice_with_total(conn, row)


@router.delete("/api/finance/invoices/{invoice_id}", status_code=204)
def delete_invoice(invoice_id: str):
    with get_conn() as conn:
        # Limpa vínculo das transações antes (FK ALTER não suporta SET NULL).
        conn.execute("UPDATE fin_transaction SET fatura_id = NULL WHERE fatura_id = ?", (invoice_id,))
        conn.execute("DELETE FROM fin_invoice WHERE id = ?", (invoice_id,))
        conn.commit()
    return None


@router.post("/api/finance/invoices/{invoice_id}/close", response_model=InvoiceOut)
def close_invoice(invoice_id: str):
    """Fecha a fatura — não aceita mais novas compras. Próxima compra no
    cartão cria nova fatura aberta automaticamente. Status muda
    'aberta' → 'fechada'. Pra pagar, use POST /pay."""
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT {INVOICE_COLUMNS} FROM fin_invoice WHERE id = ?", (invoice_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, detail="Fatura não encontrada")
        if row["status"] != "aberta":
            raise HTTPException(409, detail=f"Fatura não está aberta (status atual: {row['status']})")
        conn.execute(
            "UPDATE fin_invoice SET status = 'fechada', "
            "data_fechamento = COALESCE(data_fechamento, ?), updated_at = ? "
            "WHERE id = ?",
            (utcnow_iso_z()[:10], utcnow_iso_z(), invoice_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {INVOICE_COLUMNS} FROM fin_invoice WHERE id = ?", (invoice_id,)
        ).fetchone()
        return _invoice_with_total(conn, row)


@router.post("/api/finance/invoices/{invoice_id}/pay", response_model=InvoiceOut)
def pay_invoice(invoice_id: str, body: InvoicePayBody):
    """Paga uma fatura: cria 2 transações com categoria 'Transferência
    Interna' (saída da CC, entrada no cartão) e marca a fatura como paga.

    Após pagamento, as compras vinculadas viram despesa do mês de
    `data_pagamento` no resumo mensal (regra de competência).
    """
    with get_conn() as conn:
        invoice = conn.execute(
            f"SELECT {INVOICE_COLUMNS} FROM fin_invoice WHERE id = ?", (invoice_id,)
        ).fetchone()
        if not invoice:
            raise HTTPException(404, detail="Fatura não encontrada")
        if invoice["status"] == "paga":
            raise HTTPException(409, detail="Fatura já está paga")
        if not conn.execute(
            "SELECT 1 FROM fin_account WHERE id = ?", (body.conta_pagamento_id,)
        ).fetchone():
            raise HTTPException(422, detail="conta_pagamento_id não existe")
        # Total da fatura — precisa ter ao menos algo pra pagar.
        enriched = _invoice_with_total(conn, invoice)
        total = enriched["total"]
        if total <= 0:
            raise HTTPException(422, detail="Fatura sem compras pra pagar")
        # Acha categoria 'Transferência Interna' (deve existir do seed).
        trans_cat = conn.execute(
            "SELECT id FROM fin_category WHERE tipo = 'transferencia' LIMIT 1"
        ).fetchone()
        trans_cat_id = trans_cat["id"] if trans_cat else None
        # Lança transações: saída na CC + entrada no cartão (zera saldo do cartão).
        conn.execute(
            "INSERT INTO fin_transaction(id, data, valor, descricao, conta_id, "
            "categoria_id, origem, notas) VALUES(?,?,?,?,?,?,?,?)",
            (_new_id(), body.data_pagamento, -total,
             f"Pagamento fatura {invoice['mes_referencia']}",
             body.conta_pagamento_id, trans_cat_id, "manual", None),
        )
        conn.execute(
            "INSERT INTO fin_transaction(id, data, valor, descricao, conta_id, "
            "categoria_id, origem, notas) VALUES(?,?,?,?,?,?,?,?)",
            (_new_id(), body.data_pagamento, total,
             f"Pagamento fatura {invoice['mes_referencia']}",
             invoice["cartao_id"], trans_cat_id, "manual", None),
        )
        # Marca fatura como paga.
        conn.execute(
            "UPDATE fin_invoice SET status = 'paga', data_pagamento = ?, "
            "updated_at = ? WHERE id = ?",
            (body.data_pagamento, utcnow_iso_z(), invoice_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {INVOICE_COLUMNS} FROM fin_invoice WHERE id = ?", (invoice_id,)
        ).fetchone()
        return _invoice_with_total(conn, row)


# ─── Clients ───────────────────────────────────────────────────────────────

CLIENT_COLUMNS = "id, nome, cpf_cnpj, notas, sort_order"


@router.get("/api/finance/clients", response_model=list[ClientOut])
def list_clients():
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT {CLIENT_COLUMNS} FROM fin_client ORDER BY sort_order ASC, nome ASC"
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/api/finance/clients", response_model=ClientOut, status_code=201)
def create_client(body: ClientCreate):
    nome = body.nome.strip()
    if not nome:
        raise HTTPException(400, detail="nome é obrigatório")
    client_id = _new_id()
    with get_conn() as conn:
        max_sort = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) AS m FROM fin_client"
        ).fetchone()["m"]
        conn.execute(
            "INSERT INTO fin_client(id, nome, cpf_cnpj, notas, sort_order) VALUES(?,?,?,?,?)",
            (client_id, nome, body.cpf_cnpj, body.notas, (max_sort or 0) + 1),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {CLIENT_COLUMNS} FROM fin_client WHERE id = ?", (client_id,)
        ).fetchone()
    return dict(row)


@router.patch("/api/finance/clients/{client_id}", response_model=ClientOut)
def update_client(client_id: str, body: ClientUpdate):
    fields: dict = {name: getattr(body, name) for name in body.model_fields_set}
    if not fields:
        raise HTTPException(400, detail="Nada a atualizar")
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM fin_client WHERE id = ?", (client_id,)).fetchone():
            raise HTTPException(404, detail="Cliente não encontrado")
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE fin_client SET {set_clause}, updated_at = ? WHERE id = ?",
            [*fields.values(), utcnow_iso_z(), client_id],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {CLIENT_COLUMNS} FROM fin_client WHERE id = ?", (client_id,)
        ).fetchone()
    return dict(row)


@router.delete("/api/finance/clients/{client_id}", status_code=204)
def delete_client(client_id: str):
    with get_conn() as conn:
        # FK em projects.cliente_id é nullable mas declarativa não foi adicionada
        # via ALTER. Limpa manualmente pra evitar refs danglings.
        conn.execute("UPDATE projects SET cliente_id = NULL WHERE cliente_id = ?", (client_id,))
        conn.execute("DELETE FROM fin_client WHERE id = ?", (client_id,))
        conn.commit()
    return None


def _suggest_parcela_by_descricao(conn, descricao: str, valor: float) -> Optional[str]:
    """Auto-vínculo de receita a parcela: se CPF/CNPJ de algum cliente
    aparece na descrição (matching só dígitos pra tolerar formatação) E o
    valor da transação bate com alguma parcela pendente de projetos desse
    cliente, devolve o id da parcela.

    Quando há múltiplas parcelas com valor exato (caso comum em template
    50/50 ou parcelado_Nx), escolhe a com `data_prevista` mais antiga —
    cronologicamente é a próxima a ser paga. Usuário pode reatribuir
    manualmente no CategorizeModal se errar.
    """
    if not descricao or valor <= 0:
        return None
    desc_digits = "".join(ch for ch in descricao if ch.isdigit())
    if not desc_digits:
        return None
    clients = conn.execute(
        "SELECT id, cpf_cnpj FROM fin_client WHERE cpf_cnpj IS NOT NULL AND cpf_cnpj != ''"
    ).fetchall()
    matched_client_ids: list[str] = []
    for c in clients:
        cpf_digits = "".join(ch for ch in (c["cpf_cnpj"] or "") if ch.isdigit())
        if cpf_digits and cpf_digits in desc_digits:
            matched_client_ids.append(c["id"])
    if not matched_client_ids:
        return None
    placeholders = ",".join("?" * len(matched_client_ids))
    # Ordena por data_prevista (NULLS LAST), depois numero — pega a "próxima"
    # parcela pendente com valor exato.
    candidates = conn.execute(
        f"SELECT fp.id, fp.valor FROM fin_parcela fp "
        f"JOIN projects p ON p.id = fp.projeto_id "
        f"WHERE p.cliente_id IN ({placeholders}) AND fp.status = 'pendente' "
        f"ORDER BY fp.data_prevista ASC NULLS LAST, fp.numero ASC",
        matched_client_ids,
    ).fetchall()
    for c in candidates:
        if abs(c["valor"] - valor) < 0.01:
            return c["id"]
    return None


# ─── Debts ─────────────────────────────────────────────────────────────────

DEBT_COLUMNS = (
    "id, descricao, valor_total_original, parcela_mensal, data_inicio, "
    "categoria_id, status, sort_order"
)


def _debt_with_progress(conn, row) -> dict:
    """Combina row de fin_debt com campos computados (saldo/parcelas/progresso).

    valor_pago = soma absoluta das transações com divida_id = row.id E valor < 0
    (transação positiva vinculada a uma dívida não amortiza — seria estorno).
    saldo_devedor = max(0, total - pago).
    """
    d = dict(row)
    pago_row = conn.execute(
        "SELECT COALESCE(SUM(-valor), 0) AS pago, COUNT(*) AS n "
        "FROM fin_transaction WHERE divida_id = ? AND valor < 0",
        (d["id"],),
    ).fetchone()
    valor_pago = float(pago_row["pago"] or 0)
    parcelas_pagas = int(pago_row["n"] or 0)
    total = float(d["valor_total_original"] or 0)
    saldo = max(0.0, total - valor_pago)
    parcela = d.get("parcela_mensal")
    parcelas_restantes = (
        max(0, int((saldo + (parcela or 0) - 0.01) // (parcela or 1)))
        if parcela else None
    )
    progresso_pct = 0.0 if total <= 0 else min(100.0, round((valor_pago / total) * 100, 1))
    d["valor_pago"] = valor_pago
    d["saldo_devedor"] = saldo
    d["parcelas_pagas"] = parcelas_pagas
    d["parcelas_restantes"] = parcelas_restantes
    d["progresso_pct"] = progresso_pct
    return d


def _maybe_update_debt_status(conn, debt_id: str) -> None:
    """Se saldo zerou e status era 'active', muda pra 'paid_off'.
    Idempotente: chamadas com saldo > 0 não mexem em nada."""
    row = conn.execute(
        f"SELECT {DEBT_COLUMNS} FROM fin_debt WHERE id = ?", (debt_id,)
    ).fetchone()
    if not row:
        return
    enriched = _debt_with_progress(conn, row)
    if enriched["status"] == "active" and enriched["saldo_devedor"] <= 0.01:
        conn.execute(
            "UPDATE fin_debt SET status = 'paid_off', updated_at = ? WHERE id = ?",
            (utcnow_iso_z(), debt_id),
        )


@router.get("/api/finance/debts", response_model=list[DebtOut])
def list_debts(status: Optional[str] = Query(None)):
    sql = f"SELECT {DEBT_COLUMNS} FROM fin_debt"
    params: list = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY sort_order ASC, created_at ASC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_debt_with_progress(conn, r) for r in rows]


@router.post("/api/finance/debts", response_model=DebtOut, status_code=201)
def create_debt(body: DebtCreate):
    desc = body.descricao.strip()
    if not desc:
        raise HTTPException(400, detail="descricao é obrigatória")
    if body.valor_total_original <= 0:
        raise HTTPException(400, detail="valor_total_original deve ser > 0")
    debt_id = _new_id()
    with get_conn() as conn:
        if body.categoria_id and not conn.execute(
            "SELECT 1 FROM fin_category WHERE id = ?", (body.categoria_id,)
        ).fetchone():
            raise HTTPException(422, detail="categoria_id não existe")
        max_sort = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) AS m FROM fin_debt"
        ).fetchone()["m"]
        conn.execute(
            "INSERT INTO fin_debt(id, descricao, valor_total_original, "
            "parcela_mensal, data_inicio, categoria_id, sort_order) "
            "VALUES(?,?,?,?,?,?,?)",
            (
                debt_id, desc, body.valor_total_original, body.parcela_mensal,
                body.data_inicio, body.categoria_id, (max_sort or 0) + 1,
            ),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {DEBT_COLUMNS} FROM fin_debt WHERE id = ?", (debt_id,)
        ).fetchone()
        return _debt_with_progress(conn, row)


@router.patch("/api/finance/debts/{debt_id}", response_model=DebtOut)
def update_debt(debt_id: str, body: DebtUpdate):
    fields: dict = {name: getattr(body, name) for name in body.model_fields_set}
    if not fields:
        raise HTTPException(400, detail="Nada a atualizar")
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM fin_debt WHERE id = ?", (debt_id,)).fetchone():
            raise HTTPException(404, detail="Dívida não encontrada")
        if "categoria_id" in fields and fields["categoria_id"] and not conn.execute(
            "SELECT 1 FROM fin_category WHERE id = ?", (fields["categoria_id"],)
        ).fetchone():
            raise HTTPException(422, detail="categoria_id não existe")
        fields["updated_at"] = utcnow_iso_z()
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE fin_debt SET {set_clause} WHERE id = ?",
            [*fields.values(), debt_id],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {DEBT_COLUMNS} FROM fin_debt WHERE id = ?", (debt_id,)
        ).fetchone()
        return _debt_with_progress(conn, row)


@router.delete("/api/finance/debts/{debt_id}", status_code=204)
def delete_debt(debt_id: str):
    with get_conn() as conn:
        # FK em fin_transaction.divida_id é nullable, mas não tem ON DELETE
        # SET NULL declarado (foi adicionado via ALTER que não suporta FK
        # action). Fazemos manualmente: limpa vínculos antes.
        conn.execute("UPDATE fin_transaction SET divida_id = NULL WHERE divida_id = ?", (debt_id,))
        conn.execute("DELETE FROM fin_debt WHERE id = ?", (debt_id,))
        # Parcelas têm CASCADE declarado, somem junto.
        conn.commit()
    return None


# ─── Parcelas de Dívida (cronograma flexível com auto-balanço) ────────────

DEBT_PARCELA_COLUMNS = (
    "id, divida_id, numero, data_prevista, valor_planejado, "
    "transacao_pagamento_id, notas"
)


def _enrich_debt_parcelas(conn, divida_id: str) -> list[dict]:
    """Carrega parcelas + computa `valor_efetivo`, `is_auto`, `status`,
    `valor_pago`, `data_pagamento`. Auto-balança: rateia o saldo restante
    (total - sum(planejados fixos)) entre parcelas com valor_planejado=NULL.
    """
    from datetime import date as _date
    debt = conn.execute(
        "SELECT valor_total_original FROM fin_debt WHERE id = ?", (divida_id,)
    ).fetchone()
    if not debt:
        return []
    total_debt = float(debt["valor_total_original"])

    rows = conn.execute(
        f"SELECT {DEBT_PARCELA_COLUMNS} FROM fin_debt_parcela "
        "WHERE divida_id = ? ORDER BY numero ASC",
        (divida_id,),
    ).fetchall()
    if not rows:
        return []
    parcelas = [dict(r) for r in rows]

    # Calcula rateio das auto. Soma os fixos (planejado != NULL).
    fixed_sum = sum(float(p["valor_planejado"] or 0) for p in parcelas if p["valor_planejado"] is not None)
    auto_count = sum(1 for p in parcelas if p["valor_planejado"] is None)
    remaining = total_debt - fixed_sum
    auto_value = remaining / auto_count if auto_count > 0 else 0.0
    # Negativo possível: usuário fixou mais que o total. Mostra negativo
    # pra ele ver que está superalocando — UI alerta.

    today = _date.today().isoformat()
    out: list[dict] = []
    for p in parcelas:
        is_auto = p["valor_planejado"] is None
        valor_efetivo = float(p["valor_planejado"]) if not is_auto else auto_value

        # Status: paga se tem transação; senão atrasada/pendente baseado em data
        valor_pago = None
        data_pagamento = None
        status = "pendente"
        tx_id = p["transacao_pagamento_id"]
        if tx_id:
            tx = conn.execute(
                "SELECT valor, data FROM fin_transaction WHERE id = ?", (tx_id,)
            ).fetchone()
            if tx:
                status = "paga"
                valor_pago = abs(float(tx["valor"]))
                data_pagamento = tx["data"]
            else:
                # Transação foi deletada — limpa vínculo orfão
                conn.execute(
                    "UPDATE fin_debt_parcela SET transacao_pagamento_id = NULL WHERE id = ?",
                    (p["id"],),
                )
                conn.commit()
        if status != "paga" and p["data_prevista"] and p["data_prevista"] < today:
            status = "atrasada"

        out.append({
            **p,
            "valor_efetivo": round(valor_efetivo, 2),
            "is_auto": is_auto,
            "status": status,
            "valor_pago": valor_pago,
            "data_pagamento": data_pagamento,
        })
    return out


@router.get("/api/finance/debts/{debt_id}/parcelas", response_model=list[DebtParcelaOut])
def list_debt_parcelas(debt_id: str):
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_debt WHERE id = ?", (debt_id,)
        ).fetchone():
            raise HTTPException(404, detail="Dívida não encontrada")
        return _enrich_debt_parcelas(conn, debt_id)


@router.post("/api/finance/debts/{debt_id}/parcelas", response_model=DebtParcelaOut, status_code=201)
def create_debt_parcela(debt_id: str, body: DebtParcelaCreate):
    """Cria uma parcela ao final do cronograma (numero = max(numero)+1)."""
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_debt WHERE id = ?", (debt_id,)
        ).fetchone():
            raise HTTPException(404, detail="Dívida não encontrada")
        max_num = conn.execute(
            "SELECT COALESCE(MAX(numero), 0) AS m FROM fin_debt_parcela WHERE divida_id = ?",
            (debt_id,),
        ).fetchone()["m"]
        parcela_id = _new_id()
        conn.execute(
            "INSERT INTO fin_debt_parcela"
            "(id, divida_id, numero, data_prevista, valor_planejado, notas) "
            "VALUES(?,?,?,?,?,?)",
            (parcela_id, debt_id, max_num + 1,
             body.data_prevista, body.valor_planejado, body.notas),
        )
        conn.commit()
        # Devolve com computed fields
        all_p = _enrich_debt_parcelas(conn, debt_id)
        for p in all_p:
            if p["id"] == parcela_id:
                return p
    raise HTTPException(500, detail="Erro inesperado ao criar parcela")


@router.post("/api/finance/debts/{debt_id}/parcelas/generate", status_code=204)
def generate_debt_parcelas(debt_id: str, body: DebtParcelaGenerate):
    """Gera N parcelas iniciais (modo uniforme = total/N, open = null)."""
    if body.n_parcelas <= 0 or body.n_parcelas > 360:
        raise HTTPException(400, detail="n_parcelas deve estar entre 1 e 360")
    if body.modo not in ("uniforme", "open"):
        raise HTTPException(400, detail="modo deve ser 'uniforme' ou 'open'")
    with get_conn() as conn:
        debt = conn.execute(
            "SELECT valor_total_original FROM fin_debt WHERE id = ?", (debt_id,)
        ).fetchone()
        if not debt:
            raise HTTPException(404, detail="Dívida não encontrada")
        total = float(debt["valor_total_original"])
        valor_each = round(total / body.n_parcelas, 2) if body.modo == "uniforme" else None
        # Avança data de mês em mês a partir de body.data_inicio.
        from datetime import date
        try:
            yy, mm, dd = (int(x) for x in body.data_inicio.split("-"))
            base = date(yy, mm, dd)
        except Exception:
            raise HTTPException(400, detail="data_inicio inválida (use YYYY-MM-DD)")
        # Acha o próximo numero pra continuar a sequência
        max_num = conn.execute(
            "SELECT COALESCE(MAX(numero), 0) AS m FROM fin_debt_parcela WHERE divida_id = ?",
            (debt_id,),
        ).fetchone()["m"]
        for i in range(body.n_parcelas):
            month = base.month + i
            year = base.year + (month - 1) // 12
            month = ((month - 1) % 12) + 1
            # Ajusta dia se mês não tem (ex: dia 31 em fev → último dia)
            from calendar import monthrange
            last_day = monthrange(year, month)[1]
            day = min(base.day, last_day)
            data_iso = f"{year:04d}-{month:02d}-{day:02d}"
            conn.execute(
                "INSERT INTO fin_debt_parcela"
                "(id, divida_id, numero, data_prevista, valor_planejado) "
                "VALUES(?,?,?,?,?)",
                (_new_id(), debt_id, max_num + 1 + i, data_iso, valor_each),
            )
        conn.commit()
    return None


@router.post("/api/finance/debts/{debt_id}/parcelas/complete", status_code=204)
def complete_debt_parcelas(debt_id: str, body: DebtParcelaComplete):
    """Cria N parcelas FIXAS com valor = (total − soma_fixas_atuais) / N.
    Datas começam em `body.data_inicio` ou em (última_parcela.data_prevista
    + 1 mês) se não dado. Não toca em parcelas existentes — apenas adiciona
    no fim do cronograma. Se há parcelas auto pendentes, elas vão recalcular
    naturalmente após a soma fixa aumentar.
    """
    if body.n_parcelas <= 0 or body.n_parcelas > 360:
        raise HTTPException(400, detail="n_parcelas deve estar entre 1 e 360")
    with get_conn() as conn:
        debt = conn.execute(
            "SELECT valor_total_original FROM fin_debt WHERE id = ?", (debt_id,)
        ).fetchone()
        if not debt:
            raise HTTPException(404, detail="Dívida não encontrada")
        total = float(debt["valor_total_original"])

        # Soma das parcelas com valor_planejado fixo (ignora auto/null)
        sum_fixed_row = conn.execute(
            "SELECT COALESCE(SUM(valor_planejado), 0) AS s "
            "FROM fin_debt_parcela WHERE divida_id = ? AND valor_planejado IS NOT NULL",
            (debt_id,),
        ).fetchone()
        sum_fixed = float(sum_fixed_row["s"] or 0)
        restante = total - sum_fixed
        # Threshold mais forgiving: rejeita só se MUITO pequeno (centavos) ou
        # negativo (parcelas fixas excedem total).
        if restante < -0.01:
            raise HTTPException(
                400,
                detail=f"Parcelas fixas (R${sum_fixed:.2f}) excedem o total da dívida (R${total:.2f}). Reduza alguma parcela fixa primeiro.",
            )
        if restante < 1.0:  # menos de 1 real não vale criar parcelas
            raise HTTPException(
                400,
                detail=f"Saldo restante (R${restante:.2f}) muito pequeno pra dividir. Total: R${total:.2f}, fixas somam R${sum_fixed:.2f}.",
            )
        valor_each = round(restante / body.n_parcelas, 2)

        # Determina data_inicio: dado ou inferido (last + 1 mês)
        from datetime import date
        from calendar import monthrange
        if body.data_inicio:
            try:
                yy, mm, dd = (int(x) for x in body.data_inicio.split("-"))
                base = date(yy, mm, dd)
            except Exception:
                raise HTTPException(400, detail="data_inicio inválida (use YYYY-MM-DD)")
        else:
            last_row = conn.execute(
                "SELECT data_prevista FROM fin_debt_parcela "
                "WHERE divida_id = ? AND data_prevista IS NOT NULL "
                "ORDER BY numero DESC LIMIT 1",
                (debt_id,),
            ).fetchone()
            if last_row:
                yy, mm, dd = (int(x) for x in last_row["data_prevista"].split("-"))
                # +1 mês
                next_month = mm + 1
                next_year = yy + (next_month - 1) // 12
                next_month = ((next_month - 1) % 12) + 1
                last_day = monthrange(next_year, next_month)[1]
                day = min(dd, last_day)
                base = date(next_year, next_month, day)
            else:
                base = date.today()

        max_num = conn.execute(
            "SELECT COALESCE(MAX(numero), 0) AS m FROM fin_debt_parcela WHERE divida_id = ?",
            (debt_id,),
        ).fetchone()["m"]
        for i in range(body.n_parcelas):
            month = base.month + i
            year = base.year + (month - 1) // 12
            month = ((month - 1) % 12) + 1
            last_day = monthrange(year, month)[1]
            day = min(base.day, last_day)
            data_iso = f"{year:04d}-{month:02d}-{day:02d}"
            conn.execute(
                "INSERT INTO fin_debt_parcela"
                "(id, divida_id, numero, data_prevista, valor_planejado) "
                "VALUES(?,?,?,?,?)",
                (_new_id(), debt_id, max_num + 1 + i, data_iso, valor_each),
            )
        conn.commit()
    return None


@router.patch("/api/finance/debts/parcelas/{parcela_id}", response_model=DebtParcelaOut)
def update_debt_parcela(parcela_id: str, body: DebtParcelaUpdate):
    fields: dict = {name: getattr(body, name) for name in body.model_fields_set}
    if not fields:
        raise HTTPException(400, detail="Nada a atualizar")
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT divida_id FROM fin_debt_parcela WHERE id = ?", (parcela_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, detail="Parcela não encontrada")
        # Valida transacao_pagamento_id se setando
        if "transacao_pagamento_id" in fields and fields["transacao_pagamento_id"]:
            if not conn.execute(
                "SELECT 1 FROM fin_transaction WHERE id = ?",
                (fields["transacao_pagamento_id"],),
            ).fetchone():
                raise HTTPException(422, detail="transacao_pagamento_id não existe")
        fields["updated_at"] = utcnow_iso_z()
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE fin_debt_parcela SET {set_clause} WHERE id = ?",
            [*fields.values(), parcela_id],
        )
        conn.commit()
        for p in _enrich_debt_parcelas(conn, existing["divida_id"]):
            if p["id"] == parcela_id:
                return p
    raise HTTPException(500, detail="Erro inesperado ao atualizar parcela")


@router.delete("/api/finance/debts/parcelas/{parcela_id}", status_code=204)
def delete_debt_parcela(parcela_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM fin_debt_parcela WHERE id = ?", (parcela_id,))
        conn.commit()
    return None


# ─── Recurring Bills (contas fixas: luz, água, internet, etc) ─────────────

RECURRING_BILL_COLUMNS = (
    "id, descricao, valor_estimado, dia_vencimento, categoria_id, "
    "conta_pagamento_id, ativa, recorrencia, tipo, notas, sort_order"
)


def _bill_row_to_dict(row) -> dict:
    """SQLite armazena boolean como INTEGER. Converte de volta pra bool."""
    d = dict(row)
    d["ativa"] = bool(d.get("ativa", 1))
    return d


@router.get("/api/finance/recurring-bills", response_model=list[RecurringBillOut])
def list_recurring_bills():
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT {RECURRING_BILL_COLUMNS} FROM fin_recurring_bill "
            "ORDER BY ativa DESC, sort_order ASC, descricao ASC"
        ).fetchall()
    return [_bill_row_to_dict(r) for r in rows]


@router.post("/api/finance/recurring-bills", response_model=RecurringBillOut, status_code=201)
def create_recurring_bill(body: RecurringBillCreate):
    descricao = body.descricao.strip()
    if not descricao:
        raise HTTPException(400, detail="descricao é obrigatória")
    bill_id = _new_id()
    with get_conn() as conn:
        # Valida FKs opcionais
        if body.categoria_id and not conn.execute(
            "SELECT 1 FROM fin_category WHERE id = ?", (body.categoria_id,)
        ).fetchone():
            raise HTTPException(422, detail="categoria_id não existe")
        if body.conta_pagamento_id and not conn.execute(
            "SELECT 1 FROM fin_account WHERE id = ?", (body.conta_pagamento_id,)
        ).fetchone():
            raise HTTPException(422, detail="conta_pagamento_id não existe")
        max_sort = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) AS m FROM fin_recurring_bill"
        ).fetchone()["m"]
        conn.execute(
            "INSERT INTO fin_recurring_bill"
            "(id, descricao, valor_estimado, dia_vencimento, categoria_id, "
            "conta_pagamento_id, ativa, recorrencia, tipo, notas, sort_order) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                bill_id, descricao, body.valor_estimado, body.dia_vencimento,
                body.categoria_id, body.conta_pagamento_id,
                1 if body.ativa else 0, 'mensal', body.tipo,
                body.notas, max_sort + 1,
            ),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {RECURRING_BILL_COLUMNS} FROM fin_recurring_bill WHERE id = ?",
            (bill_id,),
        ).fetchone()
    return _bill_row_to_dict(row)


@router.patch("/api/finance/recurring-bills/{bill_id}", response_model=RecurringBillOut)
def update_recurring_bill(bill_id: str, body: RecurringBillUpdate):
    fields: dict = {name: getattr(body, name) for name in body.model_fields_set}
    if not fields:
        raise HTTPException(400, detail="Nada a atualizar")
    # bool → int pra coluna SQLite
    if "ativa" in fields:
        fields["ativa"] = 1 if fields["ativa"] else 0
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_recurring_bill WHERE id = ?", (bill_id,)
        ).fetchone():
            raise HTTPException(404, detail="Conta fixa não encontrada")
        if "categoria_id" in fields and fields["categoria_id"] and not conn.execute(
            "SELECT 1 FROM fin_category WHERE id = ?", (fields["categoria_id"],)
        ).fetchone():
            raise HTTPException(422, detail="categoria_id não existe")
        if "conta_pagamento_id" in fields and fields["conta_pagamento_id"] and not conn.execute(
            "SELECT 1 FROM fin_account WHERE id = ?", (fields["conta_pagamento_id"],)
        ).fetchone():
            raise HTTPException(422, detail="conta_pagamento_id não existe")
        fields["updated_at"] = utcnow_iso_z()
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE fin_recurring_bill SET {set_clause} WHERE id = ?",
            [*fields.values(), bill_id],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {RECURRING_BILL_COLUMNS} FROM fin_recurring_bill WHERE id = ?",
            (bill_id,),
        ).fetchone()
    return _bill_row_to_dict(row)


@router.delete("/api/finance/recurring-bills/{bill_id}", status_code=204)
def delete_recurring_bill(bill_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM fin_recurring_bill WHERE id = ?", (bill_id,))
        conn.commit()
    return None


@router.post("/api/finance/recurring-bills/reorder", status_code=204)
def reorder_recurring_bills(body: dict):
    """Reordena contas fixas por sort_order. Body: `{"ids": [...]}`."""
    ids = body.get("ids") or []
    if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
        raise HTTPException(400, detail="body precisa de `ids` (lista de strings)")
    with get_conn() as conn:
        for idx, bill_id in enumerate(ids, start=1):
            conn.execute(
                "UPDATE fin_recurring_bill SET sort_order = ? WHERE id = ?",
                (idx, bill_id),
            )
        conn.commit()
    return None


@router.get("/api/finance/recurring-bills/status", response_model=RecurringBillStatusMonth)
def recurring_bills_status(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
):
    """Status mensal de cada conta fixa ativa: paga/recebida / pendente / atrasada.

    Inferência:
    - Busca transações do mês com `categoria_id = bill.categoria_id` E descrição
      contendo (case-insensitive) qualquer palavra significativa do nome da bill.
    - Filtra por SINAL conforme `bill.tipo`: despesa → valor < 0; receita → valor > 0.
    - Se achou → "paga"/"recebida", anexa transacao_id e valor real.
    - Se não achou e hoje passou de `dia_vencimento` → "atrasada".
    - Caso contrário → "pendente".

    Honra regra de competência: transação com fatura de cartão paga conta no
    mês do pagamento (igual monthly-summary). Receitas não passam por fatura
    (só despesas de cartão), então pra receita é só o filtro direto de data.

    Totais agregados são separados por tipo pra UI de previsão.
    """
    from calendar import monthrange
    from datetime import date as _date
    last_day = monthrange(year, month)[1]
    data_de = f"{year:04d}-{month:02d}-01"
    data_ate = f"{year:04d}-{month:02d}-{last_day:02d}"

    with get_conn() as conn:
        bills = conn.execute(
            f"SELECT {RECURRING_BILL_COLUMNS} FROM fin_recurring_bill "
            "WHERE ativa = 1 ORDER BY sort_order ASC, descricao ASC"
        ).fetchall()
        if not bills:
            return RecurringBillStatusMonth(
                year=year, month=month, items=[],
                total_estimado=0.0, total_pago=0.0, total_pendente=0.0,
                despesa_total_estimado=0.0, despesa_total_pago=0.0, despesa_total_pendente=0.0,
                receita_total_estimado=0.0, receita_total_recebido=0.0, receita_total_pendente=0.0,
            )

        items = []
        total_estimado = 0.0
        total_pago = 0.0
        despesa_estimado = 0.0
        despesa_pago = 0.0
        receita_estimado = 0.0
        receita_recebido = 0.0
        today = _date.today()

        for b in bills:
            bill_dict = _bill_row_to_dict(b)
            tipo = bill_dict.get("tipo") or "despesa"
            valor_est = float(bill_dict["valor_estimado"])
            total_estimado += valor_est
            if tipo == "receita":
                receita_estimado += valor_est
            else:
                despesa_estimado += valor_est

            # Procura transação match. Prioridade:
            # 1) FK explícito `recurring_bill_id` setado via flow de
            #    "vincular lançamento existente" (mais confiável).
            # 2) Match heurístico por descrição (legado / fallback pra bills
            #    que o usuário ainda não vinculou explicitamente).
            tx_match = None
            sign_clause = "t.valor > 0" if tipo == "receita" else "t.valor < 0"
            # Janela do mês conforme regra de competência (despesas pelo
            # pagamento da fatura, receitas pela data da tx)
            if tipo == "receita":
                date_clause = "t.data >= ? AND t.data <= ?"
                date_params: list = [data_de, data_ate]
            else:
                date_clause = (
                    "((t.fatura_id IS NULL AND t.data >= ? AND t.data <= ?) "
                    "OR (t.fatura_id IS NOT NULL AND EXISTS ("
                    "  SELECT 1 FROM fin_invoice f WHERE f.id = t.fatura_id "
                    "    AND f.status = 'paga' "
                    "    AND f.data_pagamento >= ? AND f.data_pagamento <= ?"
                    ")))"
                )
                date_params = [data_de, data_ate, data_de, data_ate]
            # Prioridade 1: vínculo explícito
            tx_match = conn.execute(
                f"""SELECT t.id, t.data, t.valor
                      FROM fin_transaction t
                      WHERE t.recurring_bill_id = ?
                        AND {sign_clause}
                        AND {date_clause}
                      ORDER BY t.data ASC LIMIT 1""",
                (bill_dict["id"], *date_params),
            ).fetchone()
            # Prioridade 2: heurística por descrição (compat com bills antigas)
            words = [w.strip().lower() for w in bill_dict["descricao"].split() if len(w.strip()) >= 4]
            if not tx_match and words:
                like_clauses = " OR ".join(["LOWER(t.descricao) LIKE ?" for _ in words])
                like_params = [f"%{w}%" for w in words]
                cat_clause = ""
                cat_params: list = []
                if bill_dict["categoria_id"]:
                    cat_clause = " AND t.categoria_id = ?"
                    cat_params = [bill_dict["categoria_id"]]
                # Exclui txs já linkadas a OUTRA bill via FK explícito — evita
                # double-attribute quando user já vinculou tx X à bill A e a
                # heurística tentaria pegar a mesma tx pra bill B.
                if tipo == "receita":
                    # Receitas: só transação direta (não passam por fatura).
                    tx_match = conn.execute(
                        f"""SELECT t.id, t.data, t.valor
                              FROM fin_transaction t
                              WHERE t.valor > 0
                                AND t.recurring_bill_id IS NULL
                                AND ({like_clauses})
                                {cat_clause}
                                AND t.data >= ? AND t.data <= ?
                              ORDER BY t.data ASC LIMIT 1""",
                        (*like_params, *cat_params, data_de, data_ate),
                    ).fetchone()
                else:
                    # Despesas: respeita regra de competência via fatura.
                    tx_match = conn.execute(
                        f"""SELECT t.id, t.data, t.valor
                              FROM fin_transaction t
                              LEFT JOIN fin_invoice f ON f.id = t.fatura_id
                              WHERE t.valor < 0
                                AND t.recurring_bill_id IS NULL
                                AND ({like_clauses})
                                {cat_clause}
                                AND (
                                  (t.fatura_id IS NULL AND t.data >= ? AND t.data <= ?)
                                  OR
                                  (t.fatura_id IS NOT NULL AND f.status = 'paga'
                                   AND f.data_pagamento >= ? AND f.data_pagamento <= ?)
                                )
                              ORDER BY t.data ASC LIMIT 1""",
                        (*like_params, *cat_params,
                         data_de, data_ate, data_de, data_ate),
                    ).fetchone()

            if tx_match:
                valor_real = abs(float(tx_match["valor"]))
                total_pago += valor_real
                if tipo == "receita":
                    receita_recebido += valor_real
                else:
                    despesa_pago += valor_real
                items.append({
                    "bill_id": bill_dict["id"],
                    "descricao": bill_dict["descricao"],
                    "valor_estimado": bill_dict["valor_estimado"],
                    "dia_vencimento": bill_dict["dia_vencimento"],
                    "categoria_id": bill_dict["categoria_id"],
                    "tipo": tipo,
                    "status": "recebida" if tipo == "receita" else "paga",
                    "valor_pago": valor_real,
                    "transacao_id": tx_match["id"],
                    "data_pagamento": tx_match["data"],
                })
            else:
                # Pendente ou atrasada (só faz sentido pro mês corrente)
                status = "pendente"
                if year == today.year and month == today.month and bill_dict["dia_vencimento"]:
                    if today.day > bill_dict["dia_vencimento"]:
                        status = "atrasada"
                items.append({
                    "bill_id": bill_dict["id"],
                    "descricao": bill_dict["descricao"],
                    "valor_estimado": bill_dict["valor_estimado"],
                    "dia_vencimento": bill_dict["dia_vencimento"],
                    "categoria_id": bill_dict["categoria_id"],
                    "tipo": tipo,
                    "status": status,
                    "valor_pago": None,
                    "transacao_id": None,
                    "data_pagamento": None,
                })

    return RecurringBillStatusMonth(
        year=year, month=month, items=items,
        total_estimado=round(total_estimado, 2),
        total_pago=round(total_pago, 2),
        total_pendente=round(total_estimado - total_pago, 2),
        despesa_total_estimado=round(despesa_estimado, 2),
        despesa_total_pago=round(despesa_pago, 2),
        despesa_total_pendente=round(despesa_estimado - despesa_pago, 2),
        receita_total_estimado=round(receita_estimado, 2),
        receita_total_recebido=round(receita_recebido, 2),
        receita_total_pendente=round(receita_estimado - receita_recebido, 2),
    )


# ─── Month Commitments (visão consolidada de vencimentos) ─────────────────

@router.get("/api/finance/month-commitments", response_model=MonthCommitmentsResponse)
def month_commitments(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
):
    """Compromissos do mês — agrega recurring bills + debt parcelas + freela
    parcelas com data_prevista no mês, retorna lista ordenada por dia.

    UI consome isso pra montar uma "checklist do mês" — o que vence quando,
    quem ainda devo pagar, quem vai cair na conta. Status é inferido (mesmo
    pattern de recurring-bills/status pras bills; direto da parcela.status
    pras debt e freela parcelas).
    """
    from calendar import monthrange
    from datetime import date as _date

    last_day = monthrange(year, month)[1]
    data_de = f"{year:04d}-{month:02d}-01"
    data_ate = f"{year:04d}-{month:02d}-{last_day:02d}"
    today = _date.today()
    is_current_month = today.year == year and today.month == month

    items: list[dict] = []
    total_a_pagar = 0.0
    total_a_receber = 0.0
    total_pago = 0.0
    total_recebido = 0.0

    with get_conn() as conn:
        # ─── 1) Recurring bills (despesa + receita) ────────────────────────
        bills = conn.execute(
            f"SELECT {RECURRING_BILL_COLUMNS} FROM fin_recurring_bill "
            "WHERE ativa = 1 ORDER BY sort_order ASC, descricao ASC"
        ).fetchall()
        for b in bills:
            bill = _bill_row_to_dict(b)
            tipo = bill.get("tipo") or "despesa"

            # Match de tx que paga essa bill no mês. Prioridade:
            # 1) FK explícito `recurring_bill_id` (vínculo manual confiável).
            # 2) Heurística por descrição (legado).
            tx_match = None
            sign_clause = "t.valor > 0" if tipo == "receita" else "t.valor < 0"
            if tipo == "receita":
                date_clause = "t.data >= ? AND t.data <= ?"
                date_params: list = [data_de, data_ate]
            else:
                date_clause = (
                    "((t.fatura_id IS NULL AND t.data >= ? AND t.data <= ?) "
                    "OR (t.fatura_id IS NOT NULL AND EXISTS ("
                    "  SELECT 1 FROM fin_invoice f WHERE f.id = t.fatura_id "
                    "    AND f.status = 'paga' "
                    "    AND f.data_pagamento >= ? AND f.data_pagamento <= ?"
                    ")))"
                )
                date_params = [data_de, data_ate, data_de, data_ate]
            # Prioridade 1: vínculo explícito
            tx_match = conn.execute(
                f"""SELECT t.id, t.data, t.valor
                      FROM fin_transaction t
                      WHERE t.recurring_bill_id = ?
                        AND {sign_clause}
                        AND {date_clause}
                      ORDER BY t.data ASC LIMIT 1""",
                (bill["id"], *date_params),
            ).fetchone()
            # Prioridade 2: heurística por descrição (compat com bills antigas
            # sem FK explícito). Exclui txs já linkadas a OUTRA bill.
            words = [w.strip().lower() for w in bill["descricao"].split() if len(w.strip()) >= 4]
            if not tx_match and words:
                like_clauses = " OR ".join(["LOWER(t.descricao) LIKE ?" for _ in words])
                like_params = [f"%{w}%" for w in words]
                cat_clause = ""
                cat_params: list = []
                if bill["categoria_id"]:
                    cat_clause = " AND t.categoria_id = ?"
                    cat_params = [bill["categoria_id"]]
                if tipo == "receita":
                    tx_match = conn.execute(
                        f"""SELECT t.id, t.data, t.valor
                              FROM fin_transaction t
                              WHERE t.valor > 0
                                AND t.recurring_bill_id IS NULL
                                AND ({like_clauses}) {cat_clause}
                                AND t.data >= ? AND t.data <= ?
                              ORDER BY t.data ASC LIMIT 1""",
                        (*like_params, *cat_params, data_de, data_ate),
                    ).fetchone()
                else:
                    tx_match = conn.execute(
                        f"""SELECT t.id, t.data, t.valor
                              FROM fin_transaction t
                              LEFT JOIN fin_invoice f ON f.id = t.fatura_id
                              WHERE t.valor < 0
                                AND t.recurring_bill_id IS NULL
                                AND ({like_clauses}) {cat_clause}
                                AND (
                                  (t.fatura_id IS NULL AND t.data >= ? AND t.data <= ?)
                                  OR
                                  (t.fatura_id IS NOT NULL AND f.status = 'paga'
                                   AND f.data_pagamento >= ? AND f.data_pagamento <= ?)
                                )
                              ORDER BY t.data ASC LIMIT 1""",
                        (*like_params, *cat_params,
                         data_de, data_ate, data_de, data_ate),
                    ).fetchone()

            valor_est = float(bill["valor_estimado"])
            if tx_match:
                valor_real = abs(float(tx_match["valor"]))
                status = "recebida" if tipo == "receita" else "paga"
                if tipo == "receita":
                    total_recebido += valor_real
                else:
                    total_pago += valor_real
                items.append({
                    "kind": "bill",
                    "id": bill["id"],
                    "descricao": bill["descricao"],
                    "sub_descricao": "salário/recorrente" if tipo == "receita" else "conta fixa",
                    "tipo": tipo,
                    "dia": bill["dia_vencimento"],
                    "data_prevista": tx_match["data"],  # data real do pagamento pra ordenar
                    "valor": valor_est,
                    "valor_pago": valor_real,
                    "status": status,
                    "transacao_id": tx_match["id"],
                    "data_pagamento": tx_match["data"],
                    "bill_id": bill["id"],
                })
            else:
                status = "pendente"
                if is_current_month and bill["dia_vencimento"]:
                    if today.day > bill["dia_vencimento"]:
                        status = "atrasada"
                if tipo == "receita":
                    total_a_receber += valor_est
                else:
                    total_a_pagar += valor_est
                # Para ordenação: usa dia_vencimento como YYYY-MM-DD
                data_for_sort = (
                    f"{year:04d}-{month:02d}-{min(bill['dia_vencimento'], last_day):02d}"
                    if bill["dia_vencimento"] else None
                )
                items.append({
                    "kind": "bill",
                    "id": bill["id"],
                    "descricao": bill["descricao"],
                    "sub_descricao": "salário/recorrente" if tipo == "receita" else "conta fixa",
                    "tipo": tipo,
                    "dia": bill["dia_vencimento"],
                    "data_prevista": data_for_sort,
                    "valor": valor_est,
                    "valor_pago": None,
                    "status": status,
                    "transacao_id": None,
                    "data_pagamento": None,
                    "bill_id": bill["id"],
                })

        # ─── 2) Debt parcelas com data no mês ──────────────────────────────
        # Pega todas dívidas ativas, depois filtra parcelas no mês.
        debts = conn.execute(
            f"SELECT {DEBT_COLUMNS} FROM fin_debt WHERE status = 'active'"
        ).fetchall()
        for d in debts:
            debt_dict = dict(d)
            # Total parcelas dessa dívida (pra exibir "3/12")
            total_parcelas_row = conn.execute(
                "SELECT COUNT(*) AS n FROM fin_debt_parcela WHERE divida_id = ?",
                (debt_dict["id"],),
            ).fetchone()
            total_parcelas = int(total_parcelas_row["n"] or 0)
            if total_parcelas == 0:
                continue  # dívida sem cronograma, não aparece aqui

            # Carrega enriched parcelas. Inclui:
            # - Parcelas com data NESSE mês (qualquer status)
            # - Atrasadas de meses anteriores (carry-over) — só se mês corrente,
            #   pra não poluir visualizações de meses passados/futuros
            enriched = _enrich_debt_parcelas(conn, debt_dict["id"])
            for p in enriched:
                if not p.get("data_prevista"):
                    continue
                in_month = data_de <= p["data_prevista"] <= data_ate
                is_carryover = (
                    is_current_month
                    and p["data_prevista"] < data_de
                    and p["status"] == "atrasada"
                )
                if not (in_month or is_carryover):
                    continue
                valor_efetivo = float(p["valor_efetivo"])
                status = p["status"]  # 'paga' | 'pendente' | 'atrasada'
                # Despesa sempre pra parcelas de dívida.
                if status == "paga":
                    total_pago += float(p["valor_pago"] or valor_efetivo)
                else:
                    total_a_pagar += valor_efetivo
                # Dia do mês a partir de data_prevista
                try:
                    dia_num = int(p["data_prevista"].split("-")[2])
                except Exception:
                    dia_num = None
                items.append({
                    "kind": "debt_parcela",
                    "id": p["id"],
                    "descricao": debt_dict["descricao"],
                    "sub_descricao": f"parcela {p['numero']}/{total_parcelas}",
                    "tipo": "despesa",
                    "dia": dia_num,
                    "data_prevista": p["data_prevista"],
                    "valor": valor_efetivo,
                    "valor_pago": p.get("valor_pago"),
                    "status": status,
                    "transacao_id": p.get("transacao_pagamento_id"),
                    "data_pagamento": p.get("data_pagamento"),
                    "debt_id": debt_dict["id"],
                    "debt_descricao": debt_dict["descricao"],
                    "parcela_numero": p["numero"],
                    "parcela_total": total_parcelas,
                })

        # ─── 3) Freela parcelas com data no mês ────────────────────────────
        # Status no schema: 'pendente' | 'recebido' | 'atrasado' | 'cancelada'.
        # Mapeia pra padrão do MonthCommitment (recebida/atrasada/pendente);
        # 'cancelada' não aparece (não conta como compromisso ativo).
        # Mesmo carry-over das debt parcelas: atrasadas de meses anteriores
        # aparecem no mês corrente, pra não escapar do radar.
        # `transacao_recebimento_id` NÃO é coluna — é FK reverso de
        # fin_transaction.parcela_id; precisa LEFT JOIN aqui.
        freela_parcelas = conn.execute(
            """SELECT fp.id, fp.projeto_id, fp.numero, fp.valor, fp.data_prevista,
                      fp.status,
                      p.title AS projeto_titulo,
                      (SELECT COUNT(*) FROM fin_parcela WHERE projeto_id = fp.projeto_id) AS total,
                      t.id AS tx_id, t.data AS tx_data, t.valor AS tx_valor
                 FROM fin_parcela fp
                 JOIN projects p ON p.id = fp.projeto_id
                 LEFT JOIN fin_transaction t ON t.parcela_id = fp.id
                WHERE fp.status != 'cancelada'
                  AND fp.data_prevista IS NOT NULL"""
        ).fetchall()
        for fp in freela_parcelas:
            data_prev = fp["data_prevista"]
            in_month = data_de <= data_prev <= data_ate
            is_carryover = (
                is_current_month
                and data_prev < data_de
                and fp["status"] == "atrasado"
            )
            if not (in_month or is_carryover):
                continue
            valor_est = float(fp["valor"])
            # Mapeia status do schema pro padrão do commitment
            raw_status = fp["status"]
            status = (
                "recebida" if raw_status == "recebido"
                else "atrasada" if raw_status == "atrasado"
                else "pendente"
            )
            tx_id = fp["tx_id"]
            data_pag = fp["tx_data"] if tx_id else None
            valor_pago = abs(float(fp["tx_valor"])) if tx_id and fp["tx_valor"] is not None else None
            if status == "recebida":
                total_recebido += valor_pago or valor_est
            else:
                total_a_receber += valor_est
            try:
                dia_num = int(data_prev.split("-")[2])
            except Exception:
                dia_num = None
            total = int(fp["total"] or 0)
            items.append({
                "kind": "freela_parcela",
                "id": fp["id"],
                "descricao": fp["projeto_titulo"] or "freela",
                "sub_descricao": (
                    f"parcela {fp['numero']}/{total}" if total > 0
                    else f"parcela {fp['numero']}"
                ),
                "tipo": "receita",
                "dia": dia_num,
                "data_prevista": data_prev,
                "valor": valor_est,
                "valor_pago": valor_pago,
                "status": status,
                "transacao_id": tx_id,
                "data_pagamento": data_pag,
                "parcela_numero": fp["numero"],
                "parcela_total": total if total > 0 else None,
                "freela_projeto_id": fp["projeto_id"],
            })

        # ─── 4) Faturas de cartão com vencimento (ou pagamento) no mês ─────
        # Critérios de inclusão:
        #  - Status 'paga' com data_pagamento no mês → status final 'paga'
        #  - Status aberta/fechada/atrasada com data_vencimento no mês →
        #    'pendente' (ou 'atrasada' se já passou e é mês corrente)
        #  - Carry-over: aberta/fechada/atrasada com vencimento em mês
        #    anterior + mês corrente → 'atrasada' (não escapar do radar)
        # Total da fatura é a soma das compras vinculadas (mesma fórmula
        # do _invoice_with_total).
        today_str = today.isoformat()
        invoices_rows = conn.execute(
            """SELECT i.id, i.cartao_id, i.mes_referencia,
                      i.data_vencimento, i.data_pagamento, i.status,
                      a.nome AS cartao_nome,
                      COALESCE((SELECT SUM(-valor) FROM fin_transaction
                                  WHERE fatura_id = i.id AND valor < 0), 0) AS total
                 FROM fin_invoice i
                 JOIN fin_account a ON a.id = i.cartao_id"""
        ).fetchall()
        mes_ref_atual = f"{year:04d}-{month:02d}"
        for inv in invoices_rows:
            inv_status = inv["status"]
            data_pag = inv["data_pagamento"]
            data_venc = inv["data_vencimento"]
            mes_ref = inv["mes_referencia"]
            valor_inv = float(inv["total"] or 0)

            paga_no_mes = inv_status == "paga" and data_pag and data_de <= data_pag <= data_ate
            # Pendente: se tem data_vencimento, usa ela. Se NÃO tem, usa
            # mes_referencia como fallback (cobre faturas recém-criadas sem
            # data preenchida — comum no fluxo de import do Nubank).
            if data_venc:
                pendente_no_mes = inv_status in ("aberta", "fechada", "atrasada") and \
                    data_de <= data_venc <= data_ate
                is_carryover = (
                    is_current_month
                    and inv_status in ("aberta", "fechada", "atrasada")
                    and data_venc < data_de
                )
            else:
                pendente_no_mes = inv_status in ("aberta", "fechada", "atrasada") and \
                    mes_ref == mes_ref_atual
                is_carryover = (
                    is_current_month
                    and inv_status in ("aberta", "fechada", "atrasada")
                    and mes_ref < mes_ref_atual
                )
            if not (paga_no_mes or pendente_no_mes or is_carryover):
                continue

            # Fatura sem compras vinculadas (total = 0): não vale a pena
            # poluir Compromissos. Ex: fatura "aberta" recém-criada.
            if valor_inv == 0 and inv_status != "paga":
                continue

            if paga_no_mes:
                status = "paga"
                total_pago += valor_inv
                data_for_sort = data_pag
            else:
                # Pendente / atrasada
                if is_current_month and data_venc and data_venc < today_str:
                    status = "atrasada"
                else:
                    status = "pendente"
                total_a_pagar += valor_inv
                # Pra ordenação: data_vencimento se houver, senão último dia
                # do mes_referencia (visualmente "no fim do mês").
                if data_venc:
                    data_for_sort = data_venc
                else:
                    try:
                        ref_y, ref_m = mes_ref.split("-")
                        ref_last = monthrange(int(ref_y), int(ref_m))[1]
                        data_for_sort = f"{ref_y}-{ref_m}-{ref_last:02d}"
                    except Exception:
                        data_for_sort = None

            try:
                dia_num = int(data_for_sort.split("-")[2]) if data_for_sort else None
            except Exception:
                dia_num = None

            items.append({
                "kind": "invoice",
                "id": inv["id"],
                "descricao": f"Fatura {inv['cartao_nome']}",
                "sub_descricao": f"ref. {inv['mes_referencia']}",
                "tipo": "despesa",
                "dia": dia_num,
                "data_prevista": data_for_sort,
                "valor": valor_inv,
                "valor_pago": valor_inv if status == "paga" else None,
                "status": status,
                "transacao_id": None,
                "data_pagamento": data_pag,
                "invoice_id": inv["id"],
                "cartao_id": inv["cartao_id"],
                "cartao_nome": inv["cartao_nome"],
            })

    # ─── 5) Reservas da Wishlist (compromissos virtuais) ─────────────────
    # Cada linha de cronograma vira um item `kind='wishlist'`. Compromisso
    # do mês usa `valor_planejado` (= meta a guardar) e o `dia` se setado;
    # caso contrário cai pro último dia do mês.
    #
    # Status:
    #  * `paga`     = reserva com transacao_id vinculado (já guardado)
    #  * `pendente` = sem vínculo
    # Entra em `total_a_pagar` (desconta de sobra_projetada) sempre, com ou
    # sem vínculo — é o quanto você se comprometeu a guardar neste mês.
    with get_conn() as conn:
        reservas = conn.execute(
            "SELECT r.id AS reserva_id, r.valor_planejado, r.ano, r.mes, r.dia, "
            "r.transacao_id, i.id AS item_id, i.nome, i.status AS item_status "
            "FROM fin_wishlist_reserva r "
            "JOIN fin_wishlist_item i ON i.id = r.item_id "
            "WHERE r.ano = ? AND r.mes = ? "
            "AND i.status IN ('desejado', 'poupando') "
            "ORDER BY i.nome ASC",
            (year, month),
        ).fetchall()
    for r in reservas:
        valor_res = float(r["valor_planejado"] or 0)
        dia_pref = r["dia"]
        if dia_pref:
            dia_num = min(int(dia_pref), last_day)
            data_prev = f"{year:04d}-{month:02d}-{dia_num:02d}"
        else:
            dia_num = None
            data_prev = data_ate
        has_link = bool(r["transacao_id"])
        items.append({
            "kind": "wishlist",
            "id": r["reserva_id"],
            "descricao": r["nome"],
            "sub_descricao": "wishlist · reserva mensal",
            "tipo": "despesa",
            "dia": dia_num,
            "data_prevista": data_prev,
            "valor": round(valor_res, 2),
            "valor_pago": round(valor_res, 2) if has_link else None,
            "status": "paga" if has_link else "pendente",
            "transacao_id": r["transacao_id"],
            "data_pagamento": None,
            "wishlist_item_id": r["item_id"],
        })
        if has_link:
            total_pago += valor_res
        else:
            total_a_pagar += valor_res

    # Ordena por data_prevista (sem data vai pro fim)
    items.sort(key=lambda i: (i["data_prevista"] or "9999-99-99", i["descricao"]))

    sobra_projetada = (total_a_receber + total_recebido) - (total_a_pagar + total_pago)

    return MonthCommitmentsResponse(
        year=year, month=month,
        items=[MonthCommitment(**i) for i in items],
        total_a_pagar=round(total_a_pagar, 2),
        total_a_receber=round(total_a_receber, 2),
        total_pago=round(total_pago, 2),
        total_recebido=round(total_recebido, 2),
        sobra_projetada=round(sobra_projetada, 2),
    )


# ─── Categorization Rules ─────────────────────────────────────────────────

CATEGORIZATION_RULE_COLUMNS = "id, pattern, categoria_id, times_matched, created_at, link_cartao_id"


def _apply_rules(conn, descricao: str) -> Optional[dict]:
    """Roda regras de categorização contra uma descrição (lower-case substring).
    Primeira que bater ganha. Devolve dict com `categoria_id` e `link_cartao_id`
    da regra (este último opcional, pra auto-link de pagamento de fatura) ou
    None se nada bateu. Incrementa `times_matched` quando bate (uso/debug).
    """
    descricao_lower = (descricao or "").lower()
    if not descricao_lower:
        return None
    rules = conn.execute(
        "SELECT id, pattern, categoria_id, link_cartao_id FROM fin_categorization_rule"
    ).fetchall()
    for r in rules:
        pat = (r["pattern"] or "").lower().strip()
        if pat and pat in descricao_lower:
            conn.execute(
                "UPDATE fin_categorization_rule SET times_matched = times_matched + 1 WHERE id = ?",
                (r["id"],),
            )
            return {
                "categoria_id": r["categoria_id"],
                "link_cartao_id": r["link_cartao_id"],
            }
    return None


def _try_link_invoice_payment(conn, tx_id: str, tx_data: str, tx_valor: float,
                              cartao_id: str) -> Optional[str]:
    """Tenta linkar uma tx como pagamento da fatura aberta/fechada/atrasada do
    cartão informado, com base em match exato de valor (tolerância R$0,01).

    Se exatamente 1 fatura bate o valor → linka (set tx.pagamento_fatura_id +
    update fatura status='paga' + data_pagamento). Retorna o id da fatura.
    Se 0 ou >1 → não faz nada (deixa pro link manual). Retorna None.

    Usado pelo auto-link via regra de categorização (link_cartao_id).
    """
    valor_abs = abs(float(tx_valor))
    if valor_abs <= 0:
        return None
    tol = 0.01
    candidates = conn.execute(
        """SELECT i.id,
                  COALESCE((SELECT SUM(-valor) FROM fin_transaction
                              WHERE fatura_id = i.id AND valor < 0), 0) AS total
             FROM fin_invoice i
            WHERE i.cartao_id = ?
              AND i.status IN ('aberta', 'fechada', 'atrasada')""",
        (cartao_id,),
    ).fetchall()
    matches = [c for c in candidates if abs(float(c["total"]) - valor_abs) <= tol]
    if len(matches) != 1:
        return None
    invoice_id = matches[0]["id"]
    now_iso = utcnow_iso_z()
    conn.execute(
        "UPDATE fin_transaction SET pagamento_fatura_id = ?, updated_at = ? WHERE id = ?",
        (invoice_id, now_iso, tx_id),
    )
    conn.execute(
        "UPDATE fin_invoice SET status = 'paga', data_pagamento = ?, updated_at = ? WHERE id = ?",
        (tx_data, now_iso, invoice_id),
    )
    return invoice_id


@router.get("/api/finance/categorization-rules", response_model=list[CategorizationRuleOut])
def list_categorization_rules():
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT {CATEGORIZATION_RULE_COLUMNS} FROM fin_categorization_rule "
            "ORDER BY times_matched DESC, created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


@router.post(
    "/api/finance/categorization-rules",
    response_model=CategorizationRuleOut,
    status_code=201,
)
def create_categorization_rule(body: CategorizationRuleCreate):
    pattern = body.pattern.strip()
    if not pattern:
        raise HTTPException(400, detail="pattern é obrigatório")
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_category WHERE id = ?", (body.categoria_id,)
        ).fetchone():
            raise HTTPException(422, detail="categoria_id não existe")
        if body.link_cartao_id and not conn.execute(
            "SELECT 1 FROM fin_account WHERE id = ? AND tipo = 'credito'",
            (body.link_cartao_id,),
        ).fetchone():
            raise HTTPException(422, detail="link_cartao_id deve ser cartão de crédito existente")
        rule_id = _new_id()
        conn.execute(
            "INSERT INTO fin_categorization_rule(id, pattern, categoria_id, link_cartao_id) "
            "VALUES(?,?,?,?)",
            (rule_id, pattern, body.categoria_id, body.link_cartao_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {CATEGORIZATION_RULE_COLUMNS} FROM fin_categorization_rule WHERE id = ?",
            (rule_id,),
        ).fetchone()
    return dict(row)


@router.patch(
    "/api/finance/categorization-rules/{rule_id}",
    response_model=CategorizationRuleOut,
)
def update_categorization_rule(rule_id: str, body: CategorizationRuleUpdate):
    fields: dict = {name: getattr(body, name) for name in body.model_fields_set}
    if not fields:
        raise HTTPException(400, detail="Nada a atualizar")
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM fin_categorization_rule WHERE id = ?", (rule_id,)
        ).fetchone():
            raise HTTPException(404, detail="Regra não encontrada")
        if "pattern" in fields:
            patt = (fields["pattern"] or "").strip()
            if not patt:
                raise HTTPException(400, detail="pattern não pode ser vazio")
            fields["pattern"] = patt
        if "categoria_id" in fields and not conn.execute(
            "SELECT 1 FROM fin_category WHERE id = ?", (fields["categoria_id"],)
        ).fetchone():
            raise HTTPException(422, detail="categoria_id não existe")
        if "link_cartao_id" in fields and fields["link_cartao_id"] and not conn.execute(
            "SELECT 1 FROM fin_account WHERE id = ? AND tipo = 'credito'",
            (fields["link_cartao_id"],),
        ).fetchone():
            raise HTTPException(422, detail="link_cartao_id deve ser cartão de crédito existente")
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE fin_categorization_rule SET {set_clause} WHERE id = ?",
            [*fields.values(), rule_id],
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {CATEGORIZATION_RULE_COLUMNS} FROM fin_categorization_rule WHERE id = ?",
            (rule_id,),
        ).fetchone()
    return dict(row)


@router.delete("/api/finance/categorization-rules/{rule_id}", status_code=204)
def delete_categorization_rule(rule_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM fin_categorization_rule WHERE id = ?", (rule_id,))
        conn.commit()
    return None


@router.get("/api/finance/categorization-rules/{rule_id}/preview-backfill")
def preview_backfill_rule(rule_id: str):
    """Conta quantas transações já lançadas batem com o pattern dessa regra.
    Devolve total + quantas estão sem categoria + amostra de descrições, pra
    UI decidir se mostra confirmação ou não.
    """
    with get_conn() as conn:
        rule = conn.execute(
            "SELECT pattern FROM fin_categorization_rule WHERE id = ?",
            (rule_id,),
        ).fetchone()
        if not rule:
            raise HTTPException(404, detail="Regra não encontrada")
        pattern = (rule["pattern"] or "").strip()
        if not pattern:
            return {"matches_total": 0, "matches_uncategorized": 0, "sample": []}
        like = f"%{pattern.lower()}%"
        total = conn.execute(
            "SELECT COUNT(*) AS n FROM fin_transaction WHERE LOWER(descricao) LIKE ?",
            (like,),
        ).fetchone()["n"]
        uncat = conn.execute(
            "SELECT COUNT(*) AS n FROM fin_transaction "
            "WHERE LOWER(descricao) LIKE ? AND categoria_id IS NULL",
            (like,),
        ).fetchone()["n"]
        sample_rows = conn.execute(
            "SELECT descricao FROM fin_transaction "
            "WHERE LOWER(descricao) LIKE ? AND categoria_id IS NULL "
            "ORDER BY data DESC LIMIT 5",
            (like,),
        ).fetchall()
    return {
        "matches_total": total,
        "matches_uncategorized": uncat,
        "sample": [r["descricao"] for r in sample_rows],
    }


@router.post("/api/finance/categorization-rules/{rule_id}/backfill")
def apply_backfill_rule(rule_id: str, overwrite: bool = Query(False)):
    """Aplica a regra retroativamente em transações já lançadas.
    Por padrão (`overwrite=false`) só categoriza transações sem categoria —
    o usuário pode forçar reclassificar todas com `overwrite=true`.
    Devolve `{updated: int}`.
    """
    with get_conn() as conn:
        rule = conn.execute(
            "SELECT pattern, categoria_id, link_cartao_id "
            "FROM fin_categorization_rule WHERE id = ?",
            (rule_id,),
        ).fetchone()
        if not rule:
            raise HTTPException(404, detail="Regra não encontrada")
        pattern = (rule["pattern"] or "").strip()
        if not pattern:
            return {"updated": 0, "linked_invoices": 0}
        if not conn.execute(
            "SELECT 1 FROM fin_category WHERE id = ?", (rule["categoria_id"],)
        ).fetchone():
            raise HTTPException(422, detail="categoria da regra não existe mais")
        like = f"%{pattern.lower()}%"
        if overwrite:
            cur = conn.execute(
                "UPDATE fin_transaction SET categoria_id = ?, "
                "updated_at = CURRENT_TIMESTAMP "
                "WHERE LOWER(descricao) LIKE ?",
                (rule["categoria_id"], like),
            )
        else:
            cur = conn.execute(
                "UPDATE fin_transaction SET categoria_id = ?, "
                "updated_at = CURRENT_TIMESTAMP "
                "WHERE LOWER(descricao) LIKE ? AND categoria_id IS NULL",
                (rule["categoria_id"], like),
            )
        updated = cur.rowcount
        if updated > 0:
            conn.execute(
                "UPDATE fin_categorization_rule "
                "SET times_matched = times_matched + ? WHERE id = ?",
                (updated, rule_id),
            )
        # Auto-link de pagamento de fatura: aplica retroativamente nas tx
        # que bateram a regra e ainda não têm pagamento_fatura_id.
        linked = 0
        if rule["link_cartao_id"]:
            candidates = conn.execute(
                "SELECT id, data, valor FROM fin_transaction "
                "WHERE LOWER(descricao) LIKE ? AND valor < 0 "
                "AND pagamento_fatura_id IS NULL",
                (like,),
            ).fetchall()
            for tx in candidates:
                if _try_link_invoice_payment(
                    conn, tx["id"], tx["data"], tx["valor"], rule["link_cartao_id"]
                ):
                    linked += 1
        conn.commit()
    return {"updated": updated, "linked_invoices": linked}


# ─── CSV Import ────────────────────────────────────────────────────────────

def _parse_brl_decimal(v: str) -> float:
    """Aceita "1.234,56" (PT-BR) ou "1234.56" (numérico). Erro → ValueError."""
    s = v.strip().replace(" ", "")
    if not s:
        raise ValueError("valor vazio")
    # PT-BR: ponto = milhar, vírgula = decimal. Detecta pela vírgula.
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    return float(s)


def _parse_brl_date(v: str) -> str:
    """DD/MM/YYYY → YYYY-MM-DD. Erro → ValueError."""
    s = v.strip()
    parts = s.split("/")
    if len(parts) != 3:
        raise ValueError(f"data inválida: {s!r}")
    d, m, y = parts
    if len(y) == 2:  # tolera YY → 20YY
        y = "20" + y
    return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"


def _normalize_header(h: str) -> str:
    """Casa colunas independente de acento/case/espaço."""
    import unicodedata
    nfkd = unicodedata.normalize("NFKD", h.strip().lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


@router.post("/api/finance/import/nubank-csv", response_model=ImportSummary)
async def import_nubank_csv(
    file: UploadFile = File(...),
    conta_id: str = Form(...),
):
    """Importa CSV de extrato Nubank (Conta Corrente).

    Formato esperado (cabeçalho na primeira linha):
        Data,Valor,Identificador,Descrição

    Comportamento:
    - Deduplicação via (conta_id, nubank_id=Identificador). Re-importar mesmo
      arquivo é seguro — duplicatas são contadas mas não inseridas.
    - Linhas malformadas viram `errors` (não bloqueiam o resto).
    - Categoria fica vazia (usuário categoriza depois).

    Nota: cartão de crédito tem outro formato (Date,Title,Amount) e vai entrar
    quando o modelo de Fatura existir. Por enquanto só CC.
    """
    if not conta_id:
        raise HTTPException(400, detail="conta_id é obrigatório")

    raw = await file.read()
    # Nubank exporta em UTF-8 (com ou sem BOM). Tenta utf-8-sig primeiro.
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = raw.decode("latin-1")
        except UnicodeDecodeError as exc:
            raise HTTPException(400, detail=f"Não foi possível ler o arquivo: {exc}")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(400, detail="CSV vazio ou sem cabeçalho")

    # Mapa header normalizado → header original (pra ler dict).
    headers_map = {_normalize_header(h): h for h in reader.fieldnames}
    expected = ("data", "valor", "identificador", "descricao")
    missing = [k for k in expected if k not in headers_map]
    if missing:
        raise HTTPException(
            400,
            detail=(
                f"Cabeçalho esperado: Data, Valor, Identificador, Descrição. "
                f"Faltando: {missing}. Encontrado: {reader.fieldnames}"
            ),
        )

    h_data = headers_map["data"]
    h_valor = headers_map["valor"]
    h_id = headers_map["identificador"]
    h_desc = headers_map["descricao"]

    imported = 0
    duplicates = 0
    errors = 0
    auto_categorized = 0
    auto_linked_parcelas = 0
    error_samples: list[str] = []

    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM fin_account WHERE id = ?", (conta_id,)).fetchone():
            raise HTTPException(422, detail="conta_id não existe")

        for line_num, row in enumerate(reader, start=2):  # 2 = primeira linha de dado
            try:
                data_iso = _parse_brl_date(row[h_data])
                valor = _parse_brl_decimal(row[h_valor])
                nubank_id = (row[h_id] or "").strip() or None
                descricao = (row[h_desc] or "").strip() or "(sem descrição)"
                if nubank_id is None:
                    # Sem identificador não dá pra deduplicar — importa mas
                    # alerta. Caso raro, geralmente todo extrato Nubank tem id.
                    pass
            except (ValueError, KeyError) as exc:
                errors += 1
                if len(error_samples) < 5:
                    error_samples.append(f"linha {line_num}: {exc}")
                continue

            # Dedupe por (conta + nubank_id). Index único garante atomicidade.
            if nubank_id:
                exists = conn.execute(
                    "SELECT 1 FROM fin_transaction WHERE conta_id = ? AND nubank_id = ?",
                    (conta_id, nubank_id),
                ).fetchone()
                if exists:
                    duplicates += 1
                    continue

            # Auto-categorização via regras existentes (substring case-insens
            # da descrição). None se nenhuma regra bate. `rule_match` é dict
            # com `categoria_id` + `link_cartao_id` opcional.
            rule_match = _apply_rules(conn, descricao)
            categoria_id = rule_match["categoria_id"] if rule_match else None
            if categoria_id:
                auto_categorized += 1

            # Auto-vínculo a parcela esperada (CPF/CNPJ na descrição + valor
            # exato). Só se valor > 0 (entrada de receita).
            parcela_id = _suggest_parcela_by_descricao(conn, descricao, valor)
            if parcela_id:
                auto_linked_parcelas += 1

            tx_id = _new_id()
            try:
                conn.execute(
                    "INSERT INTO fin_transaction"
                    "(id, data, valor, descricao, conta_id, categoria_id, "
                    " origem, notas, nubank_id, parcela_id) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (
                        tx_id, data_iso, valor, descricao, conta_id,
                        categoria_id, "nubank_csv", None, nubank_id, parcela_id,
                    ),
                )
                if parcela_id:
                    _maybe_update_parcela_status(conn, parcela_id)
                # Auto-link de pagamento de fatura: regra com link_cartao_id
                # acionou + tx é saída → tenta achar fatura de valor exato.
                if rule_match and rule_match.get("link_cartao_id") and valor < 0:
                    _try_link_invoice_payment(
                        conn, tx_id, data_iso, valor, rule_match["link_cartao_id"]
                    )
                imported += 1
            except Exception as exc:
                # Index unique pode dar conflict em race extrema (mesmo arquivo
                # subindo 2x simultaneamente) — conta como duplicata pra cobrir.
                if "UNIQUE" in str(exc).upper():
                    duplicates += 1
                else:
                    errors += 1
                    if len(error_samples) < 5:
                        error_samples.append(f"linha {line_num}: {exc}")

        conn.commit()

    return {
        "imported": imported,
        "duplicates": duplicates,
        "errors": errors,
        "error_samples": error_samples,
        "auto_categorized": auto_categorized,
        "auto_linked_parcelas": auto_linked_parcelas,
    }


@router.get("/api/finance/summary")
def summary():
    """Visão consolidada pro dashboard: saldo total + por conta + contagens.

    `saldo_total` é o consolidado em BRL **só de contas líquidas** (corrente,
    wallet, wise) — cartões de crédito (tipo='credito') são EXCLUÍDOS porque
    seu saldo negativo representa dívida da fatura aberta, não dinheiro
    disponível. A dívida de cartão já aparece no card Compromissos do Mês +
    no kind 'invoice' pra ser tratada como compromisso, não como saldo.

    Saldos em outras moedas são convertidos via `fin_account.cotacao_brl`
    (manual). Contas em moeda != BRL sem `cotacao_brl` definido são
    EXCLUÍDAS do total e marcadas em `saldos_nao_convertidos` pra UI
    alertar o usuário.

    `saldos_por_moeda` mantém o agregado por moeda nativa pra mostrar
    separado quando útil (ex: "Wise USD: $ Y") — também só contas líquidas.
    """
    with get_conn() as conn:
        accounts = conn.execute(
            f"SELECT {ACCOUNT_COLUMNS} FROM fin_account ORDER BY sort_order ASC"
        ).fetchall()
        contas_com_saldo = [_account_with_balance(conn, a) for a in accounts]

        saldos_por_moeda: dict[str, float] = {}
        saldos_convertidos_por_moeda: dict[str, float] = {}
        cotacoes_usadas: dict[str, float] = {}
        saldos_nao_convertidos: list[dict] = []
        saldo_total_brl = 0.0

        for c in contas_com_saldo:
            # Cartão de crédito tem "saldo" = -total das compras na fatura
            # aberta. Excluído do saldo geral pra não confundir o usuário.
            if c.get("tipo") == "credito":
                continue
            moeda = c.get("moeda") or "BRL"
            saldo = float(c["saldo"])
            saldos_por_moeda[moeda] = saldos_por_moeda.get(moeda, 0.0) + saldo
            if moeda == "BRL":
                saldo_total_brl += saldo
            else:
                cotacao = c.get("cotacao_brl")
                if cotacao is not None and cotacao > 0:
                    convertido = saldo * float(cotacao)
                    saldo_total_brl += convertido
                    saldos_convertidos_por_moeda[moeda] = (
                        saldos_convertidos_por_moeda.get(moeda, 0.0) + convertido
                    )
                    cotacoes_usadas[moeda] = float(cotacao)
                else:
                    # Sem cotação: não soma. UI mostra alerta.
                    saldos_nao_convertidos.append({
                        "conta_id": c["id"], "nome": c["nome"],
                        "moeda": moeda, "saldo": round(saldo, 2),
                    })

        tx_count = conn.execute(
            "SELECT COUNT(*) AS n FROM fin_transaction"
        ).fetchone()["n"]
    return {
        "saldo_total": round(saldo_total_brl, 2),
        "saldos_por_moeda": {k: round(v, 2) for k, v in saldos_por_moeda.items()},
        "saldos_convertidos_por_moeda": {
            k: round(v, 2) for k, v in saldos_convertidos_por_moeda.items()
        },
        "cotacoes_usadas": cotacoes_usadas,
        "saldos_nao_convertidos": saldos_nao_convertidos,
        "contas": contas_com_saldo,
        "transacoes_total": tx_count,
    }


@router.get("/api/finance/transactions/export")
def export_transactions(
    data_de: Optional[str] = Query(None, description="YYYY-MM-DD inclusive"),
    data_ate: Optional[str] = Query(None, description="YYYY-MM-DD inclusive"),
    conta_id: Optional[str] = Query(None),
    categoria_id: Optional[str] = Query(None),
):
    """Exporta transações em CSV (UTF-8 com BOM pra Excel abrir certo).
    Mesmo filtro do GET /transactions, mas sem limite (export do mês todo,
    do ano, do que pedir).

    Colunas: Data, Descrição, Valor, Conta, Categoria, Tipo, Notas, Origem.
    """
    import csv
    import io
    from fastapi.responses import StreamingResponse

    sql = (
        "SELECT t.data, t.descricao, t.valor, t.notas, t.origem, "
        "       a.nome AS conta_nome, c.nome AS categoria_nome, c.tipo AS categoria_tipo "
        "FROM fin_transaction t "
        "LEFT JOIN fin_account a ON a.id = t.conta_id "
        "LEFT JOIN fin_category c ON c.id = t.categoria_id "
        "WHERE 1=1"
    )
    params: list = []
    if data_de:
        sql += " AND t.data >= ?"
        params.append(data_de)
    if data_ate:
        sql += " AND t.data <= ?"
        params.append(data_ate)
    if conta_id:
        sql += " AND t.conta_id = ?"
        params.append(conta_id)
    if categoria_id:
        sql += " AND t.categoria_id = ?"
        params.append(categoria_id)
    sql += " ORDER BY t.data DESC, t.created_at DESC"

    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()

    buf = io.StringIO()
    buf.write("﻿")  # BOM pra Excel detectar UTF-8
    writer = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    writer.writerow([
        "Data", "Descrição", "Valor", "Conta", "Categoria", "Tipo", "Notas", "Origem",
    ])
    for r in rows:
        writer.writerow([
            r["data"] or "",
            r["descricao"] or "",
            f"{float(r['valor'] or 0):.2f}".replace(".", ","),
            r["conta_nome"] or "",
            r["categoria_nome"] or "",
            r["categoria_tipo"] or "",
            r["notas"] or "",
            r["origem"] or "",
        ])

    filename_parts = ["transacoes"]
    if data_de:
        filename_parts.append(data_de)
    if data_ate:
        filename_parts.append(data_ate)
    filename = "_".join(filename_parts) + ".csv"

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/finance/exchange-rate")
def exchange_rate(
    from_: str = Query(..., alias="from", min_length=3, max_length=3),
    to: str = Query("BRL", min_length=3, max_length=3),
):
    """Busca cotação online via AwesomeAPI (gratuita, sem key, BR-friendly).

    Ex: GET /api/finance/exchange-rate?from=USD&to=BRL
    Retorna `{rate, fetched_at, source, from, to}`.

    Falhas (rede bloqueada, API offline) viram 502 — UI deve permitir entrar
    a cotação manualmente como fallback.
    """
    import json
    import urllib.request
    import urllib.error
    from datetime import datetime, timezone

    pair = f"{from_.upper()}-{to.upper()}"
    url = f"https://economia.awesomeapi.com.br/last/{pair}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "hub.quest/0.1"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        raise HTTPException(502, detail=f"Falha ao consultar AwesomeAPI: {e}")

    key = pair.replace("-", "")
    entry = payload.get(key)
    if not entry or "bid" not in entry:
        raise HTTPException(502, detail=f"Resposta inesperada da AwesomeAPI: {payload}")
    try:
        rate = float(entry["bid"])
    except (TypeError, ValueError):
        raise HTTPException(502, detail=f"Cotação inválida: {entry.get('bid')!r}")

    return {
        "from": from_.upper(),
        "to": to.upper(),
        "rate": round(rate, 4),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source": "AwesomeAPI",
    }


@router.get("/api/finance/freela-projects")
def freela_projects():
    """Lista projetos da área `freelas` (não-arquivados) com tudo computado:
    cliente, horas trabalhadas, valor pago, parcelas, R$/hora real e estimado,
    próxima parcela pendente.

    Usado pela tela `FreelasPage`. Evita N+1 fetches (1 por projeto) que
    seria caro com muitos projetos.

    Retorna lista ordenada por status (ativos primeiro) + título.
    """
    out: list[dict] = []
    with get_conn() as conn:
        projects = conn.execute(
            "SELECT id, title, status, valor_acordado, cliente_id, "
            "       forma_pagamento_template "
            "FROM projects "
            "WHERE area_slug = 'freelas' AND archived_at IS NULL "
            "ORDER BY CASE status WHEN 'doing' THEN 0 WHEN 'pending' THEN 1 "
            "                    WHEN 'done' THEN 2 ELSE 3 END, "
            "         title ASC"
        ).fetchall()

        for p in projects:
            # Horas trabalhadas (sessões fechadas das quests)
            sec = conn.execute(
                "SELECT COALESCE(SUM("
                "  (julianday(qs.ended_at) - julianday(qs.started_at)) * 86400"
                "), 0) AS s "
                "FROM quest_sessions qs JOIN quests q ON q.id = qs.quest_id "
                "WHERE q.project_id = ? AND qs.ended_at IS NOT NULL",
                (p["id"],),
            ).fetchone()["s"] or 0
            horas = float(sec) / 3600

            # Cliente
            cliente_nome = None
            if p["cliente_id"]:
                row = conn.execute(
                    "SELECT nome FROM fin_client WHERE id = ?", (p["cliente_id"],)
                ).fetchone()
                if row:
                    cliente_nome = row["nome"]

            # Parcelas — somatórios + próxima pendente
            parcelas_agg = conn.execute(
                "SELECT COUNT(*) AS total, "
                "       COALESCE(SUM(CASE WHEN status='recebido' THEN valor ELSE 0 END), 0) AS pago, "
                "       SUM(CASE WHEN status='recebido' THEN 1 ELSE 0 END) AS pagas_count "
                "FROM fin_parcela WHERE projeto_id = ?",
                (p["id"],),
            ).fetchone()
            valor_pago = float(parcelas_agg["pago"] or 0)
            parcelas_total = int(parcelas_agg["total"] or 0)
            parcelas_pagas = int(parcelas_agg["pagas_count"] or 0)

            # Próxima parcela pendente (por data ASC nulls last)
            prox = conn.execute(
                "SELECT id, numero, valor, data_prevista FROM fin_parcela "
                "WHERE projeto_id = ? AND status = 'pendente' "
                "ORDER BY data_prevista ASC NULLS LAST, numero ASC LIMIT 1",
                (p["id"],),
            ).fetchone()
            proxima_parcela = dict(prox) if prox else None

            valor_acordado = float(p["valor_acordado"] or 0)
            valor_a_receber = max(0.0, valor_acordado - valor_pago) if valor_acordado > 0 else 0.0

            hourly_estimado = (valor_acordado / horas) if (valor_acordado > 0 and horas > 0) else None
            hourly_real = (valor_pago / horas) if (valor_pago > 0 and horas > 0) else None

            out.append({
                "id": p["id"],
                "title": p["title"],
                "status": p["status"],
                "valor_acordado": valor_acordado if valor_acordado > 0 else None,
                "cliente_id": p["cliente_id"],
                "cliente_nome": cliente_nome,
                "forma_pagamento_template": p["forma_pagamento_template"],
                "horas_trabalhadas": round(horas, 2),
                "valor_pago": round(valor_pago, 2),
                "valor_a_receber": round(valor_a_receber, 2),
                "parcelas_total": parcelas_total,
                "parcelas_pagas": parcelas_pagas,
                "hourly_estimado": round(hourly_estimado, 2) if hourly_estimado is not None else None,
                "hourly_real": round(hourly_real, 2) if hourly_real is not None else None,
                "proxima_parcela": proxima_parcela,
            })

    return out


@router.get("/api/finance/hourly-rate-stats")
def hourly_rate_stats():
    """Média histórica de R$/hora — agregado cross-projeto da área freelas.

    Considera só projetos da área `freelas` não-arquivados que tenham
    horas trabalhadas E (valor recebido OU valor acordado).

    - `media_real`: soma(parcelas recebidas) / soma(horas) — só conta
      projetos que efetivamente receberam algo.
    - `media_estimada`: soma(valor_acordado) / soma(horas) — usa todos
      com valor cadastrado, mesmo sem recebimento ainda.

    Retorna None nos campos de média quando não há dados suficientes.
    """
    with get_conn() as conn:
        freela_projects = conn.execute(
            "SELECT id, valor_acordado FROM projects "
            "WHERE area_slug = 'freelas' AND archived_at IS NULL"
        ).fetchall()

        # Agregados separados pra real e estimado: cada um conta horas só
        # de projetos que entram na sua média (evita diluir).
        total_horas_real_sec = 0.0
        total_horas_estim_sec = 0.0
        total_recebido = 0.0
        total_acordado = 0.0
        projetos_real = 0
        projetos_estim = 0

        for p in freela_projects:
            sec = conn.execute(
                "SELECT COALESCE(SUM("
                "  (julianday(qs.ended_at) - julianday(qs.started_at)) * 86400"
                "), 0) AS s "
                "FROM quest_sessions qs JOIN quests q ON q.id = qs.quest_id "
                "WHERE q.project_id = ? AND qs.ended_at IS NOT NULL",
                (p["id"],),
            ).fetchone()["s"] or 0
            if sec <= 0:
                continue

            recebido = conn.execute(
                "SELECT COALESCE(SUM(valor), 0) AS r FROM fin_parcela "
                "WHERE projeto_id = ? AND status = 'recebido'",
                (p["id"],),
            ).fetchone()["r"] or 0

            if recebido > 0:
                total_horas_real_sec += sec
                total_recebido += recebido
                projetos_real += 1

            if p["valor_acordado"] and p["valor_acordado"] > 0:
                total_horas_estim_sec += sec
                total_acordado += p["valor_acordado"]
                projetos_estim += 1

        horas_real = total_horas_real_sec / 3600
        horas_estim = total_horas_estim_sec / 3600

        return {
            "media_real_brl_h": round(total_recebido / horas_real, 2) if horas_real > 0 else None,
            "media_estimada_brl_h": round(total_acordado / horas_estim, 2) if horas_estim > 0 else None,
            "projetos_considerados_real": projetos_real,
            "projetos_considerados_estim": projetos_estim,
            "horas_totais_real": round(horas_real, 2),
            "horas_totais_estim": round(horas_estim, 2),
            "valor_recebido_total": round(total_recebido, 2),
            "valor_acordado_total": round(total_acordado, 2),
        }


@router.get("/api/finance/monthly-summary")
def monthly_summary(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
):
    """Resumo de um mês civil específico: receita, despesa, sobra + contagem.

    "Receita" = soma de transações com valor > 0 no período.
    "Despesa" = abs(soma de transações com valor < 0) no período.
    "Sobra"   = receita - despesa (pode ser negativa).

    Transações com categoria do tipo `transferencia` (Transferência Interna,
    ex: Wise → Nubank) são EXCLUÍDAS do somatório — afetam saldo da conta
    individual mas não contam como receita/despesa do mês (senão contaria
    o mesmo dinheiro 2x: 1 vez quando entrou na Wise como receita, outra
    quando "saiu" da Wise pra ir pro Nubank).

    Filtro por `data` no formato YYYY-MM-DD (data civil do extrato, não
    created_at). Inclui todas as contas — visão consolidada do mês.
    """
    from calendar import monthrange
    last_day = monthrange(year, month)[1]
    data_de = f"{year:04d}-{month:02d}-01"
    data_ate = f"{year:04d}-{month:02d}-{last_day:02d}"

    with get_conn() as conn:
        # Filtro de data composto pra cobrir regra de competência:
        # - Transação SEM fatura: filtra por t.data (mês civil normal)
        # - Transação COM fatura paga: filtra por f.data_pagamento (entra
        #   no mês em que a fatura foi paga, mantendo categoria original)
        # - Transação COM fatura aberta/fechada: NÃO entra (compromisso futuro,
        #   ainda não virou despesa real)
        # Sempre exclui categorias de transferência (incluindo o pagamento
        # da própria fatura, que é uma transferência interna).
        row = conn.execute(
            """SELECT
                 COALESCE(SUM(CASE WHEN t.valor > 0 THEN t.valor ELSE 0 END), 0) AS receita,
                 COALESCE(SUM(CASE WHEN t.valor < 0 THEN -t.valor ELSE 0 END), 0) AS despesa,
                 COUNT(*) AS total
               FROM fin_transaction t
               LEFT JOIN fin_category c ON c.id = t.categoria_id
               LEFT JOIN fin_invoice f ON f.id = t.fatura_id
               WHERE (c.tipo IS NULL OR c.tipo != 'transferencia')
                 AND (
                   (t.fatura_id IS NULL AND t.data >= ? AND t.data <= ?)
                   OR
                   (t.fatura_id IS NOT NULL AND f.status = 'paga'
                    AND f.data_pagamento >= ? AND f.data_pagamento <= ?)
                 )""",
            (data_de, data_ate, data_de, data_ate),
        ).fetchone()

    receita = float(row["receita"] or 0)
    despesa = float(row["despesa"] or 0)
    sobra = receita - despesa

    # Reservas planejadas da Wishlist pro mês (passivas: planejado = assumido).
    # Só conta itens ativos (desejado | poupando). Decisão registrada em
    # docs/hub-finance/wishlist-PLAN.md seções 2#11 e 8.
    with get_conn() as conn:
        res_row = conn.execute(
            "SELECT COALESCE(SUM(r.valor_planejado), 0) AS total "
            "FROM fin_wishlist_reserva r "
            "JOIN fin_wishlist_item i ON i.id = r.item_id "
            "WHERE r.ano = ? AND r.mes = ? "
            "AND i.status IN ('desejado', 'poupando')",
            (year, month),
        ).fetchone()
    reservas_wishlist = float(res_row["total"] or 0)

    return {
        "year": year,
        "month": month,
        "data_de": data_de,
        "data_ate": data_ate,
        "receita": receita,
        "despesa": despesa,
        "sobra": sobra,
        "reservas_wishlist": round(reservas_wishlist, 2),
        # Sobra real = o que sobra DEPOIS de comprometer com a wishlist do mês.
        # É a métrica que decide se você pode comprar mais coisa (ver PLAN §11).
        "sobra_real": round(sobra - reservas_wishlist, 2),
        "transacoes_total": row["total"] or 0,
    }


