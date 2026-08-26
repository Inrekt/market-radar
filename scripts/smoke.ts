// Прогон против живого API без бота и без записи в архив.
// Проверяет, что все три источника отвечают и цифры осмысленные.

import { fetchAssetCtxs, fetchCandles, fetchLeaderboard, fetchPositions, mapWithConcurrency } from '../src/hl.js'
import { pickTop } from '../src/universe.js'

const money = (value: number): string =>
  value >= 1e9 ? `$${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `$${(value / 1e6).toFixed(1)}M` : `$${Math.round(value)}`

async function main(): Promise<void> {
  const ctxs = await fetchAssetCtxs()
  console.log(`перпов: ${ctxs.length}`)
  console.log(`топ-15 по обороту: ${pickTop(ctxs).join(', ')}`)

  const sol = ctxs.find((ctx) => ctx.coin === 'SOL')
  if (sol) {
    const annual = sol.funding * 24 * 365 * 100
    console.log(`SOL: ${sol.markPx} · фандинг ${(sol.funding * 100).toFixed(4)}%/ч (${annual.toFixed(1)}% год.) · ` +
      `OI ${money(sol.openInterest * sol.markPx)} · оборот ${money(sol.dayNtlVlm)}`)
  }

  const candles = await fetchCandles('SOL', '15m', Math.floor(Date.now() / 1000) - 40 * 900)
  const last = candles.at(-1)
  console.log(`закрытых баров 15m: ${candles.length}, последний ${last ? new Date(last.t * 1000).toISOString() : '—'} ` +
    `close ${last?.c} сделок ${last?.n}`)

  const rows = await fetchLeaderboard()
  const whales = rows.filter((row) => row.accountValue >= 5_000_000).sort((a, b) => b.accountValue - a.accountValue)
  console.log(`счетов ≥ $5M: ${whales.length}, крупнейший ${money(whales[0]?.accountValue ?? 0)}`)

  const sample = whales.slice(0, 20).map((row) => row.address)
  const lists = await mapWithConcurrency(sample, 10, fetchPositions)
  const positions = lists.flat().filter((position) => position.sizeUsd >= 300_000)
  console.log(`позиций ≥ $300K у первых 20 счетов: ${positions.length}`)
  const bySize = [...positions].sort((a, b) => b.sizeUsd - a.sizeUsd).slice(0, 3)
  for (const position of bySize) {
    console.log(`  ${position.coin} ${position.isLong ? 'ЛОНГ' : 'ШОРТ'} ${money(position.sizeUsd)} ` +
      `от ${position.entryPx} плечо ${position.leverage}`)
  }
}

void main()
