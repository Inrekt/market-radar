import { describe, expect, it } from 'vitest'
import { classify, diffBooks } from './whales.js'

describe('изменения китовых позиций', () => {
  it('различает открытие, набор, сокращение, закрытие и переворот', () => {
    expect(classify(0, 100)).toBe('open')
    expect(classify(100, 200)).toBe('add')
    expect(classify(200, 100)).toBe('trim')
    expect(classify(100, 0)).toBe('close')
    expect(classify(100, -100)).toBe('flip')
  })

  it('переворот в шорт не путается с сокращением', () => {
    expect(classify(-500, -900)).toBe('add')
    expect(classify(-900, -500)).toBe('trim')
  })

  it('молчит про мелочь: движение ниже порога — округление, а не действие', () => {
    const diffs = diffBooks({ 'a|BTC': 1_000_000 }, { 'a|BTC': 1_010_000 }, 0, {})
    expect(diffs).toEqual([])
  })

  it('видит закрытие позиции, которой не стало в новой книге', () => {
    const diffs = diffBooks({ 'a|SOL': 900_000 }, {}, 42, {})
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({ coin: 'SOL', kind: 'close', fromUsd: 900_000, toUsd: 0, t: 42 })
  })
})
