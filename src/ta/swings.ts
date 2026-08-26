import type { Candle } from '../hl.js'

/** Ширина фрактала: экстремум должен быть крайним среди стольких баров с каждой стороны. */
export const SWING_WIDTH = 2

/**
 * Экстремум: СТРОГО за пределами соседей слева и не хуже соседей справа.
 *
 * Нестрогое сравнение с обеих сторон выглядит безобиднее, но на ровном участке
 * объявляет свингом каждый бар — и тогда серия одинаковых максимумов (в крипте
 * обычное дело) сама себя превращает в «пул равных максимумов», которого нет.
 * Строгость слева убирает это; мягкость справа сохраняет настоящий экстремум,
 * у которого сосед повторил ту же цену.
 */
function isExtreme(bars: readonly Candle[], index: number, width: number, high: boolean): boolean {
  const bar = bars[index]
  if (!bar) return false
  for (let offset = 1; offset <= width; offset += 1) {
    const left = bars[index - offset]
    const right = bars[index + offset]
    if (!left || !right) return false
    if (high ? left.h >= bar.h : left.l <= bar.l) return false
    if (high ? right.h > bar.h : right.l < bar.l) return false
  }
  return true
}

export function swingHighs(bars: readonly Candle[], width: number = SWING_WIDTH): number[] {
  const out: number[] = []
  for (let i = width; i < bars.length - width; i += 1) if (isExtreme(bars, i, width, true)) out.push(i)
  return out
}

export function swingLows(bars: readonly Candle[], width: number = SWING_WIDTH): number[] {
  const out: number[] = []
  for (let i = width; i < bars.length - width; i += 1) if (isExtreme(bars, i, width, false)) out.push(i)
  return out
}

/**
 * Слом структуры: бар ЗАКРЫЛСЯ за последним свингом, случившимся до начала
 * импульса. Закрытие, а не прокол — прокол хвостом это снятие ликвидности,
 * а не слом, и путать их нельзя.
 */
export function brokeStructure(
  bars: readonly Candle[],
  index: number,
  impulseStart: number,
  swings: readonly number[],
  up: boolean,
): boolean {
  const bar = bars[index]
  if (!bar) return false
  const previous = swings.filter((swing) => swing < impulseStart)
  const last = previous.at(-1)
  if (last === undefined) return false
  const level = bars[last]
  if (!level) return false
  return up ? bar.c > level.h : bar.c < level.l
}
