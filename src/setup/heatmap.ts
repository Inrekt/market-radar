// Оценка карты ликвидаций по открытому интересу — тем же способом, что у Coinglass:
// прирост OI раскладывается на лонги и шорты с типичными плечами, у каждой части своя
// цена ликвидации; уменьшение OI закрывает позиции пропорционально; когда цена проходит
// уровень — позиции за ним считаются ликвидированными. Это ОЦЕНКА: настоящих плеч толпы
// не видит никто, ни Coinglass, ни мы. Киты HL — отдельно, их позиции настоящие.

import type { Candle } from '../hl.js'
import { money } from './levels.js'
import { P } from './params.js'
import type { Level } from './types.js'

export interface OiPoint {
  /** секунды */
  readonly t: number
  readonly px: number
  /** открытый интерес в монетах */
  readonly oi: number
}

/** Корзина накопления, доля цены. */
const BUCKET = 0.001
/** Соседние корзины ближе этого — один кластер. */
const MERGE = 0.0025
/** Кластеры дальше этого от цены не показываем: для сделки они не нужны. */
const RANGE = 0.15
/** Кластер меньше этой доли от крупнейшего — шум. */
const MIN_SHARE = 0.15

const key = (price: number): number => Math.round(Math.log(price) / Math.log(1 + BUCKET))
const priceOf = (bucket: number): number => (1 + BUCKET) ** bucket

/**
 * Карта на момент последней точки: для лонгов — уровни ниже цены, для шортов — выше.
 * bars — часовые свечи того же окна: по их хаям и лоу списываются ликвидированные уровни.
 */
export function estimateHeatmap(points: readonly OiPoint[], bars: readonly Candle[], price: number): Level[] {
  const longs = new Map<number, number>()
  const shorts = new Map<number, number>()
  const sorted = [...points].sort((a, b) => a.t - b.t)
  let barIndex = 0
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (!prev || !cur || !(prev.oi > 0) || !(cur.px > 0)) continue
    // Сначала — ликвидации по свечам, закрытым до этой точки: позиции, открытые раньше.
    while (barIndex < bars.length && (bars[barIndex]?.t ?? Infinity) + 3600 <= cur.t) {
      const bar = bars[barIndex]
      if (bar) {
        for (const b of [...longs.keys()]) if (priceOf(b) >= bar.l) longs.delete(b)
        for (const b of [...shorts.keys()]) if (priceOf(b) <= bar.h) shorts.delete(b)
      }
      barIndex += 1
    }
    const delta = cur.oi - prev.oi
    if (delta > 0) {
      const notional = delta * cur.px
      const { tiers, mmr } = P()
      for (const tier of tiers) {
        const lk = key(cur.px * (1 - 1 / tier.lev + mmr))
        const sk = key(cur.px * (1 + 1 / tier.lev - mmr))
        longs.set(lk, (longs.get(lk) ?? 0) + notional * tier.w)
        shorts.set(sk, (shorts.get(sk) ?? 0) + notional * tier.w)
      }
    } else if (delta < 0) {
      const keep = cur.oi / prev.oi
      for (const map of [longs, shorts]) for (const [b, usd] of map) map.set(b, usd * keep)
    }
  }
  return [...clusters(longs, price, true), ...clusters(shorts, price, false)]
}

function clusters(map: ReadonlyMap<number, number>, price: number, isLong: boolean): Level[] {
  const rows = [...map.entries()]
    .map(([b, usd]) => ({ px: priceOf(b), usd }))
    .filter((r) => (isLong ? r.px < price : r.px > price) && Math.abs(r.px / price - 1) <= RANGE)
    .sort((a, b) => a.px - b.px)
  const merged: { px: number, usd: number }[] = []
  for (const row of rows) {
    const last = merged.at(-1)
    if (last && row.px <= (last.px / last.usd) * (1 + MERGE)) {
      last.px += row.px * row.usd
      last.usd += row.usd
    } else {
      merged.push({ px: row.px * row.usd, usd: row.usd })
    }
  }
  const out = merged.map((m) => ({ price: m.px / m.usd, usd: m.usd }))
  const max = Math.max(0, ...out.map((c) => c.usd))
  return out
    .filter((c) => c.usd >= MIN_SHARE * max)
    .map((c) => ({
      price: c.price, source: 'liq' as const, weight: 0, usd: c.usd, tf: 'модель',
      label: `ликвидации ${isLong ? 'лонгов' : 'шортов'} ~${money(c.usd)} (оценка по OI)`,
    }))
}
