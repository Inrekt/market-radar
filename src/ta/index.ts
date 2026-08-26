// Полная разметка одного таймфрейма: детекторы плюс отбор.

import type { Candle } from '../hl.js'
import { atr } from './stats.js'
import { findZones } from './zones.js'
import { dailyLevels, liquidityPools, nearestUnswept } from './liquidity.js'
import { selectLines, selectZones } from './relevance.js'
import type { Line, Zone } from './types.js'

export interface Markup {
  readonly price: number
  readonly atr: number
  readonly zones: Zone[]
  readonly lines: Line[]
}

export function markup(bars: readonly Candle[], previousDay?: Candle): Markup {
  const price = bars.at(-1)?.c ?? 0
  const atrValue = atr(bars)
  const pools = liquidityPools(bars, atrValue)

  // Если все пулы сняты, график остался бы без единого ориентира — тогда
  // показываем ближайший нетронутый экстремум. Один честный уровень лучше пустоты.
  const fallback: Line[] = []
  if (!pools.some((line) => line.kind === 'SSL')) {
    const line = nearestUnswept(bars, atrValue, true)
    if (line) fallback.push(line)
  }
  if (!pools.some((line) => line.kind === 'BSL')) {
    const line = nearestUnswept(bars, atrValue, false)
    if (line) fallback.push(line)
  }

  const all = [...pools, ...fallback, ...(previousDay ? dailyLevels(previousDay) : [])]
  return {
    price,
    atr: atrValue,
    zones: selectZones(findZones(bars, atrValue), price, atrValue),
    lines: selectLines(all, price, atrValue),
  }
}

export * from './types.js'
