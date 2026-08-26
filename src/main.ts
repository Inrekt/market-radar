// Точка входа фазы 1: три записи, которые нельзя добэкфиллить ничем.
// Бот и сканер появятся позже — архив должен начать копиться раньше их.
//
// --max-runtime-minutes N: процесс сам завершается, чтобы цепочка заданий
// GitHub Actions могла подхватить следующую смену (приём из hl-whale-bot).

import { fetchAssetCtxs } from './hl.js'
import { collectMarket, MARKET_TICK_MS } from './collectors/market.js'
import {
  collectWhales, loadUniverse, refreshUniverse, UNIVERSE_TICK_MS, WHALE_TICK_MS,
} from './collectors/whales.js'
import { FlowRecorder } from './flow/ws.js'
import { refreshWatchlist, type WatchEntry } from './universe.js'
import { readJson, writeJson, STATE_DIR } from './store/ndjson.js'
import { join } from 'node:path'

const WATCHLIST_PATH = join(STATE_DIR, 'watchlist.json')
const WATCHLIST_TICK_MS = 24 * 3_600_000

function argNumber(name: string): number | null {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) ? value : null
}

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`)
}

async function main(): Promise<void> {
  const maxRuntimeMinutes = argNumber('--max-runtime-minutes')
  const deadline = maxRuntimeMinutes === null ? Infinity : Date.now() + maxRuntimeMinutes * 60_000

  let universe = await loadUniverse()
  if (Date.now() - universe.refreshedAt > UNIVERSE_TICK_MS) {
    log('обновляю список китов (таблица счетов ~33 МБ)')
    universe = await refreshUniverse()
    log(`китов: ${universe.addresses.length} опрашиваемых, ${universe.tagged.length} для пометки ленты`)
  }

  const ctxs = await fetchAssetCtxs()
  const stored = await readJson<WatchEntry[]>(WATCHLIST_PATH, [])
  let watch = refreshWatchlist(stored, ctxs)
  await writeJson(WATCHLIST_PATH, watch.entries)
  log(`список наблюдения: ${watch.coins.join(', ')}`)

  const flow = new FlowRecorder(watch.coins, new Set(universe.tagged))
  flow.start()
  log('поток пишется')

  let nextMarket = 0
  let nextWhales = 0
  let nextWatchlist = Date.now() + WATCHLIST_TICK_MS
  let nextUniverse = universe.refreshedAt + UNIVERSE_TICK_MS

  const shutdown = async (): Promise<void> => {
    log('останавливаюсь, дописываю хвосты')
    await flow.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  while (Date.now() < deadline) {
    const now = Date.now()
    try {
      if (now >= nextMarket) {
        const snapshot = await collectMarket(now)
        nextMarket = now + MARKET_TICK_MS
        log(`рынок: ${Object.keys(snapshot.coins).length} перпов`)
      }
      if (now >= nextWhales && universe.addresses.length > 0) {
        const diffs = await collectWhales(universe.addresses, now)
        nextWhales = now + WHALE_TICK_MS
        log(`киты: ${diffs.length} изменений`)
      }
      if (now >= nextUniverse) {
        universe = await refreshUniverse(now)
        nextUniverse = now + UNIVERSE_TICK_MS
        log(`список китов обновлён: ${universe.addresses.length}`)
      }
      if (now >= nextWatchlist) {
        watch = refreshWatchlist(watch.entries, await fetchAssetCtxs(), now)
        await writeJson(WATCHLIST_PATH, watch.entries)
        flow.setCoins(watch.coins)
        nextWatchlist = now + WATCHLIST_TICK_MS
        log(`список наблюдения: ${watch.coins.join(', ')}`)
      }
    } catch (error) {
      // Сбой одного тика не должен ронять смену: пропущенный снимок дешевле
      // оборванной записи потока, которая не восстанавливается вообще.
      console.error(`тик пропущен: ${error instanceof Error ? error.message : String(error)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }

  log('смена окончена по расписанию')
  await flow.stop()
}

void main()
