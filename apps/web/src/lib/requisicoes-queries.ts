/**
 * Requisições — hooks TanStack Query (padrão da casa: key factory + hooks
 * + invalidator). Lista de compras pessoal; ver routers/requisicoes.py.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  comprarRequisicao,
  createRequisicaoItem,
  deleteRequisicaoItem,
  desfazerCompraRequisicao,
  fetchRequisicaoCategorias,
  fetchRequisicaoCompras,
  fetchRequisicaoItens,
  reorderRequisicaoItens,
  updateRequisicaoItem,
} from '../api'
import type {
  RequisicaoComprarBody,
  RequisicaoItemCreate,
  RequisicaoItemUpdate,
  RequisicaoReorderItem,
} from '../types'

export const reqKeys = {
  all: ['requisicoes'] as const,
  itens: () => [...reqKeys.all, 'itens'] as const,
  compras: (mes: string) => [...reqKeys.all, 'compras', mes] as const,
  categorias: () => [...reqKeys.all, 'categorias'] as const,
}

export function useRequisicaoItens() {
  return useQuery({ queryKey: reqKeys.itens(), queryFn: () => fetchRequisicaoItens() })
}

export function useRequisicaoCompras(mes: string) {
  return useQuery({ queryKey: reqKeys.compras(mes), queryFn: () => fetchRequisicaoCompras(mes) })
}

export function useRequisicaoCategorias() {
  return useQuery({ queryKey: reqKeys.categorias(), queryFn: fetchRequisicaoCategorias })
}

function useReqInvalidator() {
  const qc = useQueryClient()
  // Comprar/desfazer mexe em itens E compras E categorias — invalida o ramo.
  return () => qc.invalidateQueries({ queryKey: reqKeys.all })
}

export function useCreateRequisicao() {
  const inv = useReqInvalidator()
  return useMutation({ mutationFn: (b: RequisicaoItemCreate) => createRequisicaoItem(b), onSuccess: inv })
}

export function useUpdateRequisicao() {
  const inv = useReqInvalidator()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: RequisicaoItemUpdate }) =>
      updateRequisicaoItem(id, patch),
    onSuccess: inv,
  })
}

export function useDeleteRequisicao() {
  const inv = useReqInvalidator()
  return useMutation({ mutationFn: (id: number) => deleteRequisicaoItem(id), onSuccess: inv })
}

export function useComprarRequisicao() {
  const inv = useReqInvalidator()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: RequisicaoComprarBody }) =>
      comprarRequisicao(id, body),
    onSuccess: inv,
  })
}

export function useDesfazerCompra() {
  const inv = useReqInvalidator()
  return useMutation({ mutationFn: (purchaseId: number) => desfazerCompraRequisicao(purchaseId), onSuccess: inv })
}

export function useReorderRequisicao() {
  const qc = useQueryClient()
  // Optimista: a pagina ja aplica a nova ordem no cache (setQueryData). Aqui
  // so persiste; em erro, invalida pra reverter ao estado do servidor.
  return useMutation({
    mutationFn: (payload: RequisicaoReorderItem[]) => reorderRequisicaoItens(payload),
    onError: () => qc.invalidateQueries({ queryKey: reqKeys.all }),
  })
}
