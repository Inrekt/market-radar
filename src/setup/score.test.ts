import { describe, expect, it } from 'vitest'
import type { Candle } from '../hl.js'
import { scorePlan } from './score.js'
import { P } from './params.js'
import type { Plan } from './types.js'

const plan: Plan = {
  side: 'long', entry: 100, stop: 99, tp1: 101, limits: [], tp1Label: 'пул',
  target: { price: 103, source: 'liq', weight: 0, usd: 1e6, tf: 'модель', label: 'кластер' }, rr: 3,
  balance: { stopSideUsd: 0, targetSideUsd: 0, ok: true, biggestAgainst: null },
}
const bar = (i: number, l: number, h: number, c = (l + h) / 2): Candle => ({ t: i * 900, o: c, h, l, c, v: 1, n: 1 })
const cost = 0.0012 * 100 / 1

describe('scorePlan', () => {
  it('стоп до тейка — минус 1R', () => {
    expect(scorePlan(plan, [bar(1, 98.9, 100.5)], 900_000, 10_000_000).r).toBeCloseTo(-1 - cost)
  })
  it('тейк 1, потом безубыток — доля тейка от 1R', () => {
    const out = scorePlan(plan, [bar(1, 99.5, 101.2), bar(2, 99.9, 100.8)], 900_000, 10_000_000)
    expect(out.status).toBe('тейк 1 → БУ')
    expect(out.r).toBeCloseTo(P().tp1Share - cost)
  })
  it('тейк 1, потом цель — доля по 1R, остаток по 3R', () => {
    const out = scorePlan(plan, [bar(1, 99.5, 101.2), bar(2, 100.5, 103.1)], 900_000, 10_000_000)
    expect(out.status).toBe('тейк 1 → цель')
    expect(out.r).toBeCloseTo(P().tp1Share * 1 + (1 - P().tp1Share) * 3 - cost)
  })
  it('в одном баре стоп и тейк — считается стоп', () => {
    expect(scorePlan(plan, [bar(1, 98.8, 101.5)], 900_000, 10_000_000).status).toBe('стоп')
  })
})
