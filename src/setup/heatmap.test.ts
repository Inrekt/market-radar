import { describe, expect, it } from 'vitest'
import type { Candle } from '../hl.js'
import { estimateHeatmap } from './heatmap.js'
import { P } from './params.js'

const hourBar = (t: number, l: number, h: number): Candle => ({ t, o: 100, h, l, c: 100, v: 1, n: 1 })

describe('estimateHeatmap', () => {
  it('рост OI на 100 даёт кластеры лонгов ниже и шортов выше по плечам', () => {
    const points = [{ t: 0, px: 100, oi: 1000 }, { t: 300, px: 100, oi: 2000 }]
    const levels = estimateHeatmap(points, [], 100)
    const tier = P().tiers[0]
    if (!tier) throw new Error('нет плеч')
    const long = levels.find((l) => l.label.includes('лонгов') && Math.abs(l.price - 100 * (1 - 1 / tier.lev + P().mmr)) < 0.2)
    const short = levels.find((l) => l.label.includes('шортов') && Math.abs(l.price - 100 * (1 + 1 / tier.lev - P().mmr)) < 0.2)
    expect(long?.usd).toBeCloseTo(1000 * 100 * tier.w, -2)
    expect(short).toBeDefined()
  })

  it('цена прошла уровень — лонги за ним ликвидированы', () => {
    const points = [{ t: 0, px: 100, oi: 1000 }, { t: 300, px: 100, oi: 2000 }, { t: 7300, px: 100, oi: 2000 }]
    const levels = estimateHeatmap(points, [hourBar(3600, 96, 101)], 100)
    expect(levels.some((l) => l.label.includes('лонгов') && l.price > 96)).toBe(false)
    expect(levels.some((l) => l.label.includes('лонгов') && l.price < 96)).toBe(true)
  })

  it('падение OI вдвое закрывает половину позиций', () => {
    const up = [{ t: 0, px: 100, oi: 1000 }, { t: 300, px: 100, oi: 2000 }]
    const before = estimateHeatmap(up, [], 100).reduce((a, l) => a + l.usd, 0)
    const after = estimateHeatmap([...up, { t: 600, px: 100, oi: 1000 }], [], 100).reduce((a, l) => a + l.usd, 0)
    expect(after).toBeCloseTo(before / 2, -2)
  })
})
