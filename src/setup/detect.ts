// Детектор сетапа — чистые функции: свечи, уровни и поток на входе, решение на выходе.

import type { Candle } from '../hl.js'
import type { BigPrint, FlowBucket } from '../flow/summary.js'
import { P } from './params.js'
import type { Balance, FlowCheck, Level, Plan, Side, Sweep } from './types.js'

/** Комиссия и проскальзывание за сделку туда-обратно, доля цены. */
export const COST_ROUND_TRIP = 0.0012

const sign = (side: Side): number => (side === 'long' ? 1 : -1)
const PRIORITY: Readonly<Record<Level['source'], number>> = { liq: 3, pool: 2, day: 1 }

function significance(level: Level): number {
  return PRIORITY[level.source] * 1e12 + (level.source === 'liq' ? level.usd : level.weight)
}

function through(bar: Candle, level: Level, tol: number, side: Side): boolean {
  return side === 'long' ? bar.l < level.price - tol : bar.h > level.price + tol
}

/**
 * Заметная ликвидность — ради неё стоит будить владельца: крупный кластер ликвидаций,
 * граница суток, пул на 1ч/4ч от двух касаний или 15-минутный пул от четырёх.
 */
export function isMajor(level: Level): boolean {
  if (level.source === 'liq') return level.usd >= P().majorLiqUsd
  if (level.source === 'day') return true
  return level.tf === '15м' ? level.weight >= 4 : level.weight >= 2
}

/** Заметный уровень рядом с ценой — время ставить лимитки и ждать свип. */
export function approach(price: number, levels: readonly Level[], atr1h: number, side: Side): Level | null {
  const s = sign(side)
  const near = levels
    .filter((level) => s * (price - level.price) > 0 && s * (price - level.price) <= P().approachAtr * atr1h)
    .filter(isMajor)
  return near.sort((a, b) => s * (b.price - a.price))[0] ?? null
}

/**
 * Свип с возвратом на последнем закрытом баре: уровень прокололи в одном из последних
 * последних баров (бар перед проколом был ещё по эту сторону), а последний бар закрылся
 * обратно. Если тот же уровень недавно уже прокалывали и возвращали — свип двойной.
 */
export function findSweep(bars: readonly Candle[], levels: readonly Level[], tf: string, atrValue: number,
  side: Side): Sweep | null {
  const n = bars.length
  const last = bars[n - 1]
  if (!last || !(atrValue > 0)) return null
  const s = sign(side)
  const tol = P().sweepTolAtr * atrValue
  let best: Sweep | null = null
  for (const level of levels) {
    if (!(s * (last.c - level.price) > 0)) continue
    for (let k = Math.max(1, n - P().sweepLookback); k < n; k += 1) {
      const bar = bars[k]
      const prev = bars[k - 1]
      if (!bar || !prev || !through(bar, level, tol, side) || through(prev, level, tol, side)) continue
      const tail = bars.slice(k)
      const extreme = s > 0 ? Math.min(...tail.map((b) => b.l)) : Math.max(...tail.map((b) => b.h))
      const earlier = bars.slice(Math.max(0, k - P().doubleWindow), k)
      const double = earlier.some((b, i) => through(b, level, tol, side)
        && earlier.slice(i).some((c) => s * (c.c - level.price) > 0))
      const sweep: Sweep = {
        side, tf, level, extreme, reclaim: last.c, double,
        sweepStartMs: bar.t * 1000, reclaimStartMs: last.t * 1000,
      }
      if (best === null || significance(level) > significance(best.level)) best = sweep
      break
    }
  }
  return best
}

/** Поток после свипа: дельта, крупные сделки, поглощение на проколе, киты. */
export function flowCheck(buckets: readonly FlowBucket[], prints: readonly BigPrint[], sweep: Sweep,
  coin: string, barMs: number, nowMs: number): FlowCheck {
  const s = sign(sweep.side)
  const pierceEnd = sweep.reclaimStartMs > sweep.sweepStartMs ? sweep.reclaimStartMs : sweep.sweepStartMs + barMs
  const inWindow = buckets.filter((b) => b.t >= sweep.sweepStartMs && b.t < nowMs)
  const pierce = inWindow.filter((b) => b.t < pierceEnd)
  const after = inWindow.filter((b) => b.t >= sweep.reclaimStartMs)
  const sum = (list: readonly FlowBucket[], f: (b: FlowBucket) => number): number => list.reduce((a, b) => a + f(b), 0)

  const deltaUsd = s * sum(after, (b) => b.buyUsd - b.sellUsd)
  const pierceBuy = sum(pierce, (b) => (s > 0 ? b.buyUsd : b.sellUsd))
  const pierceSell = sum(pierce, (b) => (s > 0 ? b.sellUsd : b.buyUsd))
  const whaleNetUsd = s * sum(inWindow, (b) => b.whaleBuyUsd - b.whaleSellUsd)
  const big = prints.filter((p) => p.t >= sweep.sweepStartMs && p.t < nowMs)
  const forSide = s > 0 ? 'B' : 'A'
  const bigForUsd = big.filter((p) => p.side === forSide).reduce((a, p) => a + p.usd, 0)
  const bigAgainstUsd = big.filter((p) => p.side !== forSide).reduce((a, p) => a + p.usd, 0)
  const first = inWindow[0]
  const lastBucket = inWindow.at(-1)
  const coveredMinutes = first && lastBucket ? (lastBucket.t - first.t) / 60_000 : 0

  const delta = after.length > 0 && deltaUsd > 0
  const bigOk = bigForUsd >= (P().bigMinUsd[coin] ?? P().bigMinDefaultUsd) && bigForUsd > bigAgainstUsd
  const absorption = pierce.length > 0 && pierceSell >= P().absorptionRatio * Math.max(pierceBuy, 1)
  return {
    deltaUsd, bigForUsd, bigAgainstUsd, pierceDeltaUsd: pierceSell - pierceBuy, whaleNetUsd,
    delta, big: bigOk, absorption, whales: whaleNetUsd > 0,
    confirmed: coveredMinutes > 0 && (delta || bigOk || absorption),
    coveredMinutes,
  }
}

/** Баланс ликвидности: за стопом и у цели на одинаковом расстоянии от входа. */
export function balance(levels: readonly Level[], entry: number, distance: number, side: Side): Balance {
  const s = sign(side)
  const liq = levels.filter((level) => level.source === 'liq')
  const against = liq.filter((l) => s * (entry - l.price) > 0 && s * (entry - l.price) <= distance)
  const forward = liq.filter((l) => s * (l.price - entry) > 0 && s * (l.price - entry) <= distance)
  const stopSideUsd = against.reduce((a, l) => a + l.usd, 0)
  const targetSideUsd = forward.reduce((a, l) => a + l.usd, 0)
  const biggestAgainst = [...against].sort((a, b) => b.usd - a.usd)[0] ?? null
  return {
    stopSideUsd, targetSideUsd, biggestAgainst,
    ok: !(stopSideUsd > 0 && stopSideUsd >= P().balanceMax * Math.max(targetSideUsd, 1)),
  }
}

/**
 * План: стоп за всей ликвидностью у экстремума плюс запас; цель — самый крупный кластер
 * ликвидаций впереди (иначе самый весомый пул); тейк 1 — ближняя ликвидность по дороге
 * (иначе 1R); лимитки — на ликвидности между входом и стопом.
 */
export function buildPlan(sweep: Sweep, levels: readonly Level[], entry: number, atr1h: number): Plan | null {
  const side = sweep.side
  const s = sign(side)
  const beyond = levels.filter((l) => s * (sweep.extreme - l.price) >= 0
    && s * (sweep.extreme - l.price) <= P().stopClusterAtr * atr1h)
  const farthest = beyond.reduce((acc, l) => (s > 0 ? Math.min(acc, l.price) : Math.max(acc, l.price)), sweep.extreme)
  const stop = farthest - s * P().stopMarginAtr * atr1h
  const risk = s * (entry - stop)
  if (!(risk > 0)) return null

  const ahead = levels.filter((l) => s * (l.price - entry) > 0 && s * (l.price - entry) <= P().maxTargetAtr * atr1h)
  const liq = ahead.filter((l) => l.source === 'liq')
  const pool = [...(liq.length > 0 ? liq : ahead)]
  const target = pool.sort((a, b) => significance(b) - significance(a))[0]
  if (!target) return null

  const onTheWay = ahead
    .filter((l) => l !== target && s * (l.price - entry) >= 0.5 * risk && s * (target.price - l.price) > 0)
    .sort((a, b) => s * (a.price - b.price))
  const tp1Level = onTheWay[0]
  const limits = levels
    .filter((l) => s * (entry - l.price) > 0.2 * risk && s * (l.price - stop) > 0.1 * risk)
    .sort((a, b) => s * (b.price - a.price))
    .slice(0, 2)
    .map((l) => l.price)
  const fallbackLimit = (entry + sweep.extreme) / 2
  return {
    side, entry, stop,
    limits: limits.length > 0 ? limits : [fallbackLimit],
    tp1: tp1Level?.price ?? entry + s * risk,
    tp1Label: tp1Level?.label ?? '1R — ближней ликвидности по дороге нет',
    target,
    rr: s * (target.price - entry) / risk,
    balance: balance(levels, entry, s * (target.price - entry), side),
  }
}
