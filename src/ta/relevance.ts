import type { Line, Zone } from './types.js'

/**
 * Отбор того, что попадёт на картинку.
 *
 * Это правило важнее самих детекторов. Сырой прогон на обычном графике SOL
 * 15m дал 42 зоны — нечитаемо, и ровно так выглядят чужие «автоматические»
 * индикаторы. После отбора остаётся пять зон и пять линий: плотность, с
 * которой человек размечает график руками.
 */
export const NEAR_ATR = 3.5
export const LINE_NEAR_ATR = 4.5
export const MAX_PER_KIND = 2
/** Две зоны ближе этого друг к другу — одна и та же зона. */
export const DEDUPE_ATR = 0.3

function nearPrice(lo: number, hi: number, price: number, limit: number): boolean {
  return Math.min(Math.abs(lo - price), Math.abs(hi - price)) <= limit
}

export function selectZones(zones: readonly Zone[], price: number, atrValue: number): Zone[] {
  const limit = NEAR_ATR * atrValue
  const dedupe = DEDUPE_ATR * atrValue
  const kept: Zone[] = []

  // Свежие важнее старых: зона, поставленная час назад, описывает текущий
  // рынок, а такая же трёхдневной давности — уже историю.
  for (const zone of [...zones].sort((a, b) => b.from - a.from)) {
    if (zone.mitigated) continue
    if (!nearPrice(zone.lo, zone.hi, price, limit)) continue
    if (kept.some((other) => Math.abs(other.lo - zone.lo) < dedupe && Math.abs(other.hi - zone.hi) < dedupe)) continue
    if (kept.filter((other) => other.kind === zone.kind).length >= MAX_PER_KIND) continue
    kept.push(zone)
  }
  return kept.sort((a, b) => a.from - b.from)
}

export function selectLines(lines: readonly Line[], price: number, atrValue: number): Line[] {
  const limit = LINE_NEAR_ATR * atrValue
  return lines
    .filter((line) => Math.abs(line.price - price) <= limit)
    .sort((a, b) => b.price - a.price)
}
