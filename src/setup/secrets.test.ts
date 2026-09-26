import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { parseKey, seal, unseal } from './crypt.js'
import { DEFAULT_PARAMS, parseParams } from './params.js'

describe('шифрование журнала', () => {
  it('туда и обратно своим ключом', () => {
    const key = randomBytes(32)
    expect(unseal(seal({ coin: 'BTC', stop: 83000 }, key), key)).toEqual({ coin: 'BTC', stop: 83000 })
  })
  it('чужим ключом не читается', () => {
    const box = seal({ a: 1 }, randomBytes(32))
    expect(() => unseal(box, randomBytes(32))).toThrow()
  })
  it('ключ — ровно 32 байта в base64', () => {
    expect(parseKey(randomBytes(32).toString('base64'))?.length).toBe(32)
    expect(parseKey('короткий')).toBeNull()
    expect(parseKey(undefined)).toBeNull()
  })
})

describe('параметры сетапа', () => {
  it('без секрета — заглушки', () => {
    expect(parseParams(undefined)).toBe(DEFAULT_PARAMS)
  })
  it('секрет накладывается поверх заглушек', () => {
    expect(parseParams('{"minRr": 3}').minRr).toBe(3)
    expect(parseParams('{"minRr": 3}').balanceMax).toBe(DEFAULT_PARAMS.balanceMax)
  })
  it('битый или невалидный секрет — заглушки', () => {
    expect(parseParams('{не json')).toBe(DEFAULT_PARAMS)
    expect(parseParams('{"minRr": -1}')).toBe(DEFAULT_PARAMS)
    expect(parseParams('{"tiers": [{"lev": 10, "w": 0.4}]}')).toBe(DEFAULT_PARAMS)
  })
})
