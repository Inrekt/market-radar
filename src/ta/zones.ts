import type { Candle } from '../hl.js'
import type { Zone } from './types.js'
import { brokeStructure, swingHighs, swingLows, SWING_WIDTH } from './swings.js'

/** Разрыв мельче этого — щель между барами, а не след за спросом. */
export const FVG_MIN_ATR = 0.3
/** Импульс слабее этого не считается смещением: обычное движение, а не набор. */
export const OB_IMPULSE_ATR = 1.8
/** За сколько баров ищем импульс перед ордер-блоком. */
export const OB_LOOKBACK = 4

/**
 * Разрывы (FVG) и перевёрнутые разрывы (I-FVG).
 *
 * Разрыв — три бара, между первым и третьим осталась непройденная цена.
 * Пока в него не вернулись, он работает по направлению движения. Как только
 * его прошли насквозь и цена закрепилась с другой стороны — он переворачивается
 * и работает в обратную сторону. Отслеживается по факту, а не по мнению.
 */
export function fairValueGaps(bars: readonly Candle[], atrValue: number): Zone[] {
  const out: Zone[] = []
  const minSize = FVG_MIN_ATR * atrValue
  for (let i = 2; i < bars.length; i += 1) {
    const first = bars[i - 2]
    const third = bars[i]
    if (!first || !third) continue

    if (third.l - first.h >= minSize) {
      const [lo, hi] = [first.h, third.l]
      const filledAt = bars.findIndex((bar, index) => index > i && bar.l <= lo)
      if (filledAt === -1) out.push({ kind: 'FVG', dir: 'up', from: i - 2, lo, hi, mitigated: false })
      else {
        // Разрыв прошли насквозь — дальше он работает в обратную сторону,
        // пока цена не закрепится обратно поверх него.
        const broken = bars.slice(filledAt).some((bar) => bar.c > hi)
        out.push({ kind: 'IFVG', dir: 'dn', from: i - 2, lo, hi, mitigated: broken })
      }
    }

    if (first.l - third.h >= minSize) {
      const [lo, hi] = [third.h, first.l]
      const filledAt = bars.findIndex((bar, index) => index > i && bar.h >= hi)
      if (filledAt === -1) out.push({ kind: 'FVG', dir: 'dn', from: i - 2, lo, hi, mitigated: false })
      else {
        const broken = bars.slice(filledAt).some((bar) => bar.c < lo)
        out.push({ kind: 'IFVG', dir: 'up', from: i - 2, lo, hi, mitigated: broken })
      }
    }
  }
  return out
}

/**
 * Ордер-блоки: последняя противоположная свеча перед импульсом, сломавшим
 * структуру. Оба условия обязательны. Без слома это просто свеча перед
 * движением — таких на графике десятки, и рисовать их бессмысленно.
 *
 * Блок, в который цена уже возвращалась, помечается отработанным — но не
 * выбрасывается: что показать, решает отбор.
 */
export function orderBlocks(bars: readonly Candle[], atrValue: number): Zone[] {
  const highs = swingHighs(bars, SWING_WIDTH)
  const lows = swingLows(bars, SWING_WIDTH)
  const minImpulse = OB_IMPULSE_ATR * atrValue
  const out: Zone[] = []

  for (let i = OB_LOOKBACK; i < bars.length; i += 1) {
    const bar = bars[i]
    if (!bar) continue
    const start = Math.max(0, i - OB_LOOKBACK)
    const window = bars.slice(start, i + 1)
    const lowest = Math.min(...window.map((candle) => candle.l))
    const highest = Math.max(...window.map((candle) => candle.h))

    if (bar.c - lowest >= minImpulse && bar.c > bar.o && brokeStructure(bars, i, start, highs, true)) {
      const source = lastIndexWhere(bars, start, i - 1, (candle) => candle.c < candle.o)
      const block = source === null ? null : bars[source]
      if (source !== null && block) {
        const touched = bars.slice(i + 1).some((candle) => candle.l <= block.h)
        out.push({ kind: 'OB', dir: 'up', from: source, lo: block.l, hi: block.h, mitigated: touched })
      }
    }

    if (highest - bar.c >= minImpulse && bar.c < bar.o && brokeStructure(bars, i, start, lows, false)) {
      const source = lastIndexWhere(bars, start, i - 1, (candle) => candle.c > candle.o)
      const block = source === null ? null : bars[source]
      if (source !== null && block) {
        const touched = bars.slice(i + 1).some((candle) => candle.h >= block.l)
        out.push({ kind: 'OB', dir: 'dn', from: source, lo: block.l, hi: block.h, mitigated: touched })
      }
    }
  }
  return out
}

function lastIndexWhere(
  bars: readonly Candle[],
  from: number,
  to: number,
  predicate: (bar: Candle) => boolean,
): number | null {
  for (let i = to; i >= from; i -= 1) {
    const bar = bars[i]
    if (bar && predicate(bar)) return i
  }
  return null
}

export function findZones(bars: readonly Candle[], atrValue: number): Zone[] {
  return [...fairValueGaps(bars, atrValue), ...orderBlocks(bars, atrValue)]
}
