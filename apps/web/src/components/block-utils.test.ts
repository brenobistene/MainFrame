/**
 * Testes do detector de doc vazio do BlockNote — usado em todo save flow
 * de descrição/notas pra gravar `null` em vez de JSON vazio no DB.
 *
 * Casos críticos: JSON com paragraph vazio, JSON com whitespace,
 * texto legado (não-JSON), null/undefined.
 */
import { describe, it, expect } from 'vitest'
import { isBlockDocEmpty } from './block-utils'

describe('isBlockDocEmpty', () => {
  it('null/undefined/string vazia = vazio', () => {
    expect(isBlockDocEmpty(null)).toBe(true)
    expect(isBlockDocEmpty(undefined)).toBe(true)
    expect(isBlockDocEmpty('')).toBe(true)
    expect(isBlockDocEmpty('   ')).toBe(true)
    expect(isBlockDocEmpty('\n\t  ')).toBe(true)
  })

  it('array JSON vazio = vazio', () => {
    expect(isBlockDocEmpty('[]')).toBe(true)
  })

  it('único paragraph sem content = vazio', () => {
    const doc = JSON.stringify([{ type: 'paragraph' }])
    expect(isBlockDocEmpty(doc)).toBe(true)
  })

  it('único paragraph com content vazio = vazio', () => {
    const doc = JSON.stringify([{ type: 'paragraph', content: [] }])
    expect(isBlockDocEmpty(doc)).toBe(true)
  })

  it('único paragraph com só whitespace = vazio', () => {
    const doc = JSON.stringify([
      { type: 'paragraph', content: [{ type: 'text', text: '   ' }] },
    ])
    expect(isBlockDocEmpty(doc)).toBe(true)
  })

  it('paragraph com texto real = não vazio', () => {
    const doc = JSON.stringify([
      { type: 'paragraph', content: [{ type: 'text', text: 'oi' }] },
    ])
    expect(isBlockDocEmpty(doc)).toBe(false)
  })

  it('múltiplos blocos = não vazio', () => {
    const doc = JSON.stringify([
      { type: 'paragraph', content: [{ type: 'text', text: '' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '' }] },
    ])
    // Função só checa caso "1 paragraph vazio" — 2+ blocos é considerado não-vazio
    expect(isBlockDocEmpty(doc)).toBe(false)
  })

  it('bloco com tipo diferente de paragraph = não vazio', () => {
    const doc = JSON.stringify([{ type: 'heading', content: [] }])
    expect(isBlockDocEmpty(doc)).toBe(false)
  })

  it('texto legado (não-JSON) com conteúdo = não vazio', () => {
    expect(isBlockDocEmpty('hello world')).toBe(false)
    expect(isBlockDocEmpty('texto antigo do DB')).toBe(false)
  })

  it('texto legado só com whitespace = vazio', () => {
    expect(isBlockDocEmpty('   \n  ')).toBe(true)
  })

  it('JSON inválido fallback pra texto legado', () => {
    // String com `{` mas malformada — JSON.parse falha, trata como texto
    expect(isBlockDocEmpty('{not json')).toBe(false)
  })
})
