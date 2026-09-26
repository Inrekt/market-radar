import { describe, expect, it } from 'vitest'
import type { Candle, Position } from '../hl.js'
import type { BigPrint, FlowBucket } from '../flow/summary.js'
import { approach, balance, buildPlan, findSweep, flowCheck } from './detect.js'
import { P } from './params.js'
import { liqClusters } from './levels.js'
import type { Level, Sweep } from './types.js'

const H = 900 // 15 минут, секунды
const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({ t: i * H, o, h, l, c, v: 1, n: 1 })
const flat = (count: number): Candle[] => Array.from({ length: count }, (_, i) => bar(i, 101, 101.5, 100.5, 101))
const pool = (price: number, weight = 3): Level => ({ price, source: 'pool', weight, usd: 0, tf: '1ч', label: 'пул' })
const liq = (price: number, usd: number): Level => ({ price, source: 'liq', weight: 5, usd, tf: 'HL', label: 'кластер' })
const bucket = (t: number, buyUsd: number, sellUsd: number, whaleBuyUsd = 0, whaleSellUsd = 0): FlowBucket => ({
  t, buyUsd, sellUsd, trades: 1, px: 100, whaleBuyUsd, whaleSellUsd, bidUsd: 0, askUsd: 0, bestBid: 0, bestAsk: 0,
})

describe('findSweep', () => {
  it('ловит прокол уровня и возврат на последнем баре', () => {
    const bars = [...flat(20), bar(20, 100.8, 101, 99.5, 99.8), bar(21, 99.8, 100.6, 99.7, 100.4)]
    const sweep = findSweep(bars, [pool(100)], '15м', 1, 'long')
    expect(sweep?.extreme).toBe(99.5)
    expect(sweep?.reclaim).toBe(100.4)
    expect(sweep?.double).toBe(false)
    expect(sweep?.sweepStartMs).toBe(20 * H * 1000)
  })

  it('без возврата свипа нет', () => {
    const bars = [...flat(20), bar(20, 100.8, 101, 99.5, 99.8), bar(21, 99.8, 99.9, 99.6, 99.7)]
    expect(findSweep(bars, [pool(100)], '15м', 1, 'long')).toBeNull()
  })

  it('прокол, возврат, повторный прокол — двойной свип', () => {
    const bars = [...flat(12), bar(12, 100.8, 101, 99.6, 100.3), ...flat(4).map((b, i) => ({ ...b, t: (13 + i) * H })),
      bar(17, 100.8, 101, 99.4, 99.7), bar(18, 99.7, 100.7, 99.6, 100.5)]
    expect(findSweep(bars, [pool(100)], '15м', 1, 'long')?.double).toBe(true)
  })

  it('шорт — зеркально: прокол хая и закрытие обратно ниже', () => {
    const bars = [...flat(20), bar(20, 101.2, 102.6, 101.1, 102.3), bar(21, 102.3, 102.4, 101.4, 101.6)]
    const sweep = findSweep(bars, [pool(102)], '15м', 1, 'short')
    expect(sweep?.extreme).toBe(102.6)
  })
})

const sweep: Sweep = {
  side: 'long', tf: '15м', level: pool(100), extreme: 99.5, reclaim: 100.4, double: false,
  sweepStartMs: 0, reclaimStartMs: 900_000,
}

describe('flowCheck', () => {
  it('видит дельту, крупные покупки, поглощение и китов', () => {
    const buckets = [bucket(0, 100_000, 400_000), bucket(900_000, 500_000, 200_000, 50_000, 0)]
    const prints: BigPrint[] = [{ t: 950_000, px: 100.3, usd: 250_000, side: 'B', whale: true }]
    const flow = flowCheck(buckets, prints, sweep, 'BTC', 900_000, 1_800_000)
    expect(flow).toMatchObject({ delta: true, big: true, absorption: true, whales: true, confirmed: true })
  })

  it('без записи потока подтверждения нет', () => {
    expect(flowCheck([], [], sweep, 'BTC', 900_000, 1_800_000).confirmed).toBe(false)
  })
})

describe('buildPlan', () => {
  it('стоп за всей ликвидностью у экстремума плюс запас, цель — крупнейший кластер', () => {
    const levels = [pool(100), liq(99.2, 30e6), pool(102, 2), liq(104, 50e6), liq(103, 10e6)]
    const plan = buildPlan(sweep, levels, 100.4, 1)
    expect(plan?.stop).toBeCloseTo(99.2 - P().stopMarginAtr)
    expect(plan?.target.price).toBe(104)
    expect(plan?.tp1).toBe(102)
    expect(plan?.rr).toBeCloseTo((104 - 100.4) / (100.4 - (99.2 - P().stopMarginAtr)))
  })
})

describe('approach', () => {
  it('будит только ради заметной ликвидности', () => {
    const minor: Level = { price: 99.8, source: 'pool', weight: 2, usd: 0, tf: '15м', label: 'мелкий пул' }
    expect(approach(100, [minor], 1, 'long')).toBeNull()
    expect(approach(100, [minor, liq(99.7, 20e6)], 1, 'long')?.price).toBe(99.7)
  })
})

describe('balance', () => {
  it('шорт: $400M у цели против $3.5B за стопом на том же расстоянии — не входить', () => {
    const levels = [liq(98, 400e6), liq(102, 3.5e9)]
    const result = balance(levels, 100, 2, 'short')
    expect(result.ok).toBe(false)
    expect(result.biggestAgainst?.price).toBe(102)
  })

  it('больше ликвидности у цели — можно', () => {
    expect(balance([liq(98, 400e6), liq(102, 100e6)], 100, 2, 'short').ok).toBe(true)
  })
})

describe('liqClusters', () => {
  it('склеивает близкие цены ликвидации и отбрасывает мелочь', () => {
    const p = (liquidationPx: number, sizeUsd: number, isLong = true): Position => ({
      address: '0x', coin: 'BTC', isLong, sizeUsd, leverage: 10, entryPx: 100, liquidationPx, unrealizedPnl: 0,
    })
    const levels = liqClusters([p(90, 1.5e6), p(90.1, 1e6), p(80, 1e6), p(120, 3e6, false)], 'BTC')
    expect(levels).toHaveLength(2)
    expect(levels.find((l) => l.price < 100)?.usd).toBe(2.5e6)
  })
})
