import type { Candle } from '../hl.js'

export const ATR_PERIOD = 14

/**
 * Средний истинный диапазон. Мера «сколько эта монета обычно проходит за бар» —
 * без неё любой порог в процентах врёт: 2% на BTC и 2% на мелочи это разные
 * события.
 */
export function atr(bars: readonly Candle[], period: number = ATR_PERIOD): number {
  if (bars.length < 2) return 0
  const ranges: number[] = []
  for (let i = 1; i < bars.length; i += 1) {
    const bar = bars[i]
    const previous = bars[i - 1]
    if (!bar || !previous) continue
    ranges.push(Math.max(bar.h - bar.l, Math.abs(bar.h - previous.c), Math.abs(bar.l - previous.c)))
  }
  const tail = ranges.slice(-period)
  if (tail.length === 0) return 0
  return tail.reduce((sum, value) => sum + value, 0) / tail.length
}
