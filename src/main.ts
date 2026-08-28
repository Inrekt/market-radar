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
import { scanOnce } from './scan/run.js'
import { telegramNotifier } from './scan/notify.js'
import { maybeSendDigest, maybeWriteNote } from './report/schedule.js'
import { join } from 'node:path'

const WATCHLIST_PATH = join(STATE_DIR, 'watchlist.json')
const WATCHLIST_TICK_MS = 24 * 3_600_000
/** Сканер идёт следом за снимком рынка: свежее данных всё равно не будет. */
const SCAN_TICK_MS = 5 * 60_000
/** Расписание сводок проверяем раз в минуту — час наступает ровно один раз. */
const DIGEST_TICK_MS = 60_000

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

  try {
    process.loadEnvFile('.env')
  } catch {
    // токен может прийти из окружения — это нормально
  }
  const token = process.env.BOT_TOKEN
  const notifier = token === undefined ? null : await telegramNotifier(token)
  if (notifier === null) log('сканер: пинги выключены (нет токена или владельца) — считаю и пишу в журнал')

  let nextDigestCheck = 0
  let nextScan = Date.now() + SCAN_TICK_MS
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
      if (now >= nextScan) {
        const outcome = await scanOnce(notifier, now)
        nextScan = now + SCAN_TICK_MS
        log(`сканер: ${outcome.shortlisted} кандидатов, прошли порог ${outcome.passed}, отправлено ${outcome.sent}`)
      }
      if (now >= nextDigestCheck) {
        nextDigestCheck = now + DIGEST_TICK_MS
        const slot = await maybeSendDigest(
          notifier === null ? null : { send: async (text) => { await sendText(token, text) } },
          now,
        )
        if (slot !== null) log(`сводка отправлена: ${slot}`)
        const note = await maybeWriteNote(now)
        if (note !== null) log(`заметка за сутки записана: ${note}`)
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

/** Текстовое сообщение владельцу. Отдельно от карточек: тут нет картинки. */
async function sendText(token: string | undefined, text: string): Promise<void> {
  if (token === undefined) return
  const state = await readJson<{ ownerId: number | null }>(join(STATE_DIR, 'bot-state.json'), { ownerId: null })
  if (state.ownerId === null) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: state.ownerId, text }),
  })
}

void main()
