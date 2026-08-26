// Регистратор рынка: снимок всех перпов раз в 5 минут.
// Один запрос на весь рынок, поэтому дешёвый и по трафику, и по лимиту.

import { fetchAssetCtxs } from '../hl.js'
import { appendLine, dayFile, writeJson, STATE_DIR } from '../store/ndjson.js'
import { join } from 'node:path'

export const MARKET_TICK_MS = 5 * 60_000

/** Строка снимка: время + компактная карта монета → [цена, фандинг, OI, оборот]. */
export interface MarketSnapshot {
  readonly t: number
  readonly coins: Record<string, [number, number, number, number]>
}

export async function collectMarket(nowMs: number = Date.now()): Promise<MarketSnapshot> {
  const ctxs = await fetchAssetCtxs()
  const coins: Record<string, [number, number, number, number]> = {}
  for (const ctx of ctxs) {
    coins[ctx.coin] = [ctx.markPx, ctx.funding, ctx.openInterest, ctx.dayNtlVlm]
  }
  const snapshot: MarketSnapshot = { t: Math.floor(nowMs / 1000), coins }
  await appendLine(dayFile('series', nowMs), snapshot)
  await writeJson(join(STATE_DIR, 'market-last.json'), snapshot)
  return snapshot
}
