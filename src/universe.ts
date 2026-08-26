// Список наблюдения для ордерфлоу: топ по обороту, но с «липкостью».
//
// Почему липкость: монета вылетает из топа ровно после того, как отторговала
// своё движение. Если выкинуть её сразу, архив оборвётся на самом интересном
// месте — а восстановить ленту задним числом нельзя ничем.

import type { AssetCtx } from './hl.js'

export const WATCH_SIZE = 15
export const STICKY_DAYS = 3
const STICKY_MS = STICKY_DAYS * 86_400_000

export interface WatchEntry {
  readonly coin: string
  /** когда монета в последний раз была в топе, мс */
  readonly lastInTop: number
}

export function pickTop(ctxs: readonly AssetCtx[], size: number = WATCH_SIZE): string[] {
  return [...ctxs]
    .sort((a, b) => b.dayNtlVlm - a.dayNtlVlm)
    .slice(0, size)
    .map((ctx) => ctx.coin)
}

/**
 * Новый список = сегодняшний топ + те, кто выпал меньше STICKY_DAYS назад.
 * Возвращает и записи (для хранения), и плоский список монет.
 */
export function refreshWatchlist(
  previous: readonly WatchEntry[],
  ctxs: readonly AssetCtx[],
  nowMs: number = Date.now(),
): { entries: WatchEntry[]; coins: string[] } {
  const top = new Set(pickTop(ctxs))
  const byCoin = new Map<string, WatchEntry>()

  for (const entry of previous) {
    if (nowMs - entry.lastInTop <= STICKY_MS) byCoin.set(entry.coin, entry)
  }
  for (const coin of top) byCoin.set(coin, { coin, lastInTop: nowMs })

  const entries = [...byCoin.values()].sort((a, b) => b.lastInTop - a.lastInTop)
  return { entries, coins: entries.map((entry) => entry.coin) }
}
