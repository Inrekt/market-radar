import type { Candle } from '../hl.js'
import type { Line } from './types.js'
import { swingHighs, swingLows, SWING_WIDTH } from './swings.js'

/** Насколько экстремумы могут разойтись, чтобы всё ещё считаться «равными». */
export const POOL_TOLERANCE_ATR = 0.18
/** Запас, после которого уровень считается снятым, а не задетым. */
export const SWEEP_TOLERANCE_ATR = 0.05
/** Ближе этого два пула — один и тот же пул. */
export const POOL_MERGE_ATR = 0.4

interface PoolInput {
  readonly indices: readonly number[]
  readonly priceOf: (index: number) => number
  readonly kind: 'SSL' | 'BSL'
}

/**
 * Пулы ликвидности: равные минимумы или максимумы, которые ещё не снимали.
 * Именно за ними стоят чужие стопы, поэтому снятый пул радару не интересен —
 * он уже отработал.
 */
function pools(bars: readonly Candle[], atrValue: number, input: PoolInput): Line[] {
  const tolerance = POOL_TOLERANCE_ATR * atrValue
  const sweep = SWEEP_TOLERANCE_ATR * atrValue
  const merge = POOL_MERGE_ATR * atrValue
  const out: Line[] = []

  for (let a = 0; a < input.indices.length; a += 1) {
    const anchor = input.indices[a]
    if (anchor === undefined) continue
    const group = input.indices.filter((index) => Math.abs(input.priceOf(index) - input.priceOf(anchor)) <= tolerance)
    if (group.length < 2) continue

    const price = group.reduce((sum, index) => sum + input.priceOf(index), 0) / group.length
    const last = Math.max(...group)
    const swept = bars.slice(last + 1).some((bar) =>
      input.kind === 'SSL' ? bar.l < price - sweep : bar.h > price + sweep)
    if (swept) continue
    if (out.some((line) => Math.abs(line.price - price) < merge)) continue

    out.push({ kind: input.kind, price, from: Math.min(...group), touches: group.length })
  }
  return out
}

export function liquidityPools(bars: readonly Candle[], atrValue: number): Line[] {
  const lows = swingLows(bars, SWING_WIDTH)
  const highs = swingHighs(bars, SWING_WIDTH)
  return [
    ...pools(bars, atrValue, { indices: lows, priceOf: (i) => bars[i]?.l ?? 0, kind: 'SSL' }),
    ...pools(bars, atrValue, { indices: highs, priceOf: (i) => bars[i]?.h ?? 0, kind: 'BSL' }),
  ]
}

/**
 * Запасной уровень, когда все пулы сняты: ближайший экстремум, который ещё
 * никто не трогал. Лучше один честный уровень, чем пустой график.
 */
export function nearestUnswept(bars: readonly Candle[], atrValue: number, low: boolean): Line | null {
  const sweep = SWEEP_TOLERANCE_ATR * atrValue
  const indices = low ? swingLows(bars, SWING_WIDTH) : swingHighs(bars, SWING_WIDTH)
  for (let i = indices.length - 1; i >= 0; i -= 1) {
    const index = indices[i]
    if (index === undefined) continue
    const bar = bars[index]
    if (!bar) continue
    const price = low ? bar.l : bar.h
    const touched = bars.slice(index + 1).some((candle) =>
      low ? candle.l < price - sweep : candle.h > price + sweep)
    if (!touched) return { kind: low ? 'SSL' : 'BSL', price, from: index, touches: 1 }
  }
  return null
}

/** Границы прошлых суток. Берутся из дневной свечи, а не считаются по минуткам. */
export function dailyLevels(previousDay: Candle): Line[] {
  return [
    { kind: 'PDH', price: previousDay.h, from: 0, touches: 0 },
    { kind: 'PDL', price: previousDay.l, from: 0, touches: 0 },
  ]
}
