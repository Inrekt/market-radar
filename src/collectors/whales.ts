// Регистратор китов: кто держит и как это меняется.
//
// Пишем ТОЛЬКО изменения. Полный снимок 120 кошельков каждые 15 минут — это
// 11 520 строк в сутки почти без новой информации; диффы дают на два порядка
// меньше и отвечают ровно на тот вопрос, ради которого всё затевалось:
// «что киты делали вокруг движения».

import { fetchLeaderboard, fetchPositions, mapWithConcurrency, type Position } from '../hl.js'
import { appendLine, dayFile, readJson, writeJson, STATE_DIR } from '../store/ndjson.js'
import { join } from 'node:path'

export const WHALE_TICK_MS = 15 * 60_000
export const UNIVERSE_TICK_MS = 24 * 3_600_000
/** Порог счёта: калибровка из hl-whale-bot — ниже выборка размывается. */
export const MIN_ACCOUNT_USD = 5_000_000
export const MAX_WALLETS = 120
/** Лимит 1200 веса в минуту, запрос позиций весит 2 — десять параллельных безопасно. */
const CONCURRENCY = 10
/** Мельче этого позиция не считается китовой и только шумит в диффах. */
const MIN_POSITION_USD = 300_000
/** Изменение меньше этого — округление, а не действие кита. */
const MIN_CHANGE_USD = 25_000

const UNIVERSE_PATH = join(STATE_DIR, 'whale-universe.json')
const TAGSET_PATH = join(STATE_DIR, 'whale-tagset.json')
const LAST_PATH = join(STATE_DIR, 'whale-last.json')

export interface WhaleUniverse {
  readonly refreshedAt: number
  /** кошельки, чьи позиции опрашиваются каждые 15 минут — это стоит запросов */
  readonly addresses: string[]
  /**
   * Кошельки для пометки сделок в ленте. Их на порядок больше, чем опрашиваемых,
   * и это ничего не стоит: пометка — это проверка вхождения в множество.
   */
  readonly tagged: string[]
}

/** ключ «адрес|монета» → размер в долларах со знаком (лонг +, шорт −) */
type Book = Record<string, number>

export interface WhaleDiff {
  readonly t: number
  readonly address: string
  readonly coin: string
  /** open | add | trim | close | flip */
  readonly kind: 'open' | 'add' | 'trim' | 'close' | 'flip'
  readonly fromUsd: number
  readonly toUsd: number
  readonly entryPx: number
}

export async function refreshUniverse(nowMs: number = Date.now()): Promise<WhaleUniverse> {
  const rows = await fetchLeaderboard()
  const addresses = rows
    .filter((row) => row.accountValue >= MIN_ACCOUNT_USD)
    .sort((a, b) => b.accountValue - a.accountValue)
    .slice(0, MAX_WALLETS)
    .map((row) => row.address)
  const tagged = rows
    .filter((row) => row.accountValue >= MIN_ACCOUNT_USD)
    .map((row) => row.address.toLowerCase())
  const universe: WhaleUniverse = { refreshedAt: nowMs, addresses, tagged }
  await writeJson(UNIVERSE_PATH, universe)
  await writeJson(TAGSET_PATH, tagged)
  return universe
}

export async function loadUniverse(): Promise<WhaleUniverse> {
  return readJson<WhaleUniverse>(UNIVERSE_PATH, { refreshedAt: 0, addresses: [], tagged: [] })
}

function signedUsd(position: Position): number {
  return position.isLong ? position.sizeUsd : -position.sizeUsd
}

export function classify(from: number, to: number): WhaleDiff['kind'] {
  if (from === 0) return 'open'
  if (to === 0) return 'close'
  if (Math.sign(from) !== Math.sign(to)) return 'flip'
  return Math.abs(to) > Math.abs(from) ? 'add' : 'trim'
}

/** Сравнивает две книги и отдаёт только значимые изменения. */
export function diffBooks(previous: Book, current: Book, nowSec: number, entries: Record<string, number>): WhaleDiff[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)])
  const out: WhaleDiff[] = []
  for (const key of keys) {
    const from = previous[key] ?? 0
    const to = current[key] ?? 0
    if (Math.abs(to - from) < MIN_CHANGE_USD) continue
    const [address = '', coin = ''] = key.split('|')
    out.push({
      t: nowSec,
      address,
      coin,
      kind: classify(from, to),
      fromUsd: Math.round(from),
      toUsd: Math.round(to),
      entryPx: entries[key] ?? 0,
    })
  }
  return out
}

export async function collectWhales(addresses: readonly string[], nowMs: number = Date.now()): Promise<WhaleDiff[]> {
  const lists = await mapWithConcurrency(addresses, CONCURRENCY, fetchPositions)
  const current: Book = {}
  const entries: Record<string, number> = {}
  for (const positions of lists) {
    for (const position of positions) {
      if (position.sizeUsd < MIN_POSITION_USD) continue
      const key = `${position.address}|${position.coin}`
      current[key] = signedUsd(position)
      entries[key] = position.entryPx
    }
  }
  const previous = await readJson<Book>(LAST_PATH, {})
  const diffs = diffBooks(previous, current, Math.floor(nowMs / 1000), entries)
  for (const diff of diffs) await appendLine(dayFile('whales', nowMs), diff)
  await writeJson(LAST_PATH, current)
  return diffs
}
