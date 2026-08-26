// Регистратор потока: лента сделок и стакан по списку наблюдения.
//
// Только websocket: REST-запрос `recentTrades` отдаёт 10 последних сделок за
// ~10 секунд (замерено 27.08.2026) — для ленты он бесполезен.
//
// Сырые сделки не храним: SOL в спокойный час даёт ~75 тысяч сделок в сутки,
// пятнадцать монет — десятки мегабайт в день, ветка state этого не переживёт.
// Храним корзины по 10 секунд плюс крупные принты поимённо.

import { appendLine, dayFile } from '../store/ndjson.js'
import { join } from 'node:path'

const WS_URL = 'wss://api.hyperliquid.xyz/ws'
export const BUCKET_MS = 10_000
/** Принт крупнее этого пишется отдельной строкой — их немного, и они говорящие. */
export const BIG_PRINT_USD = 10_000
const RECONNECT_MS = 2_000
/** Тишина дольше этого — соединение считается мёртвым, даже если сокет «открыт». */
const SILENCE_MS = 60_000

/** Сторона сделки. Сверено записью: A = агрессивная продажа, B = агрессивная покупка. */
export type Side = 'A' | 'B'

export interface RawTrade {
  readonly coin: string
  readonly side: Side
  readonly px: string
  readonly sz: string
  readonly time: number
  readonly users?: readonly string[]
}

export interface Bucket {
  buyUsd: number
  sellUsd: number
  trades: number
  lastPx: number
  whaleBuyUsd: number
  whaleSellUsd: number
  bidUsd: number
  askUsd: number
  bestBid: number
  bestAsk: number
}

export function emptyBucket(): Bucket {
  return {
    buyUsd: 0, sellUsd: 0, trades: 0, lastPx: 0,
    whaleBuyUsd: 0, whaleSellUsd: 0,
    bidUsd: 0, askUsd: 0, bestBid: 0, bestAsk: 0,
  }
}

export function applyTrade(bucket: Bucket, trade: RawTrade, whales: ReadonlySet<string>): void {
  const usd = Number(trade.px) * Number(trade.sz)
  const isWhale = (trade.users ?? []).some((user) => whales.has(user.toLowerCase()))
  if (trade.side === 'B') {
    bucket.buyUsd += usd
    if (isWhale) bucket.whaleBuyUsd += usd
  } else {
    bucket.sellUsd += usd
    if (isWhale) bucket.whaleSellUsd += usd
  }
  bucket.trades += 1
  bucket.lastPx = Number(trade.px)
}

/** Строка архива — массив, а не объект: короче в четыре раза при том же смысле. */
export function serialize(tSec: number, b: Bucket): readonly number[] {
  const r = (value: number): number => Math.round(value)
  return [tSec, r(b.buyUsd), r(b.sellUsd), b.trades, b.lastPx,
    r(b.whaleBuyUsd), r(b.whaleSellUsd), r(b.bidUsd), r(b.askUsd), b.bestBid, b.bestAsk]
}

interface BookLevel { readonly px: string; readonly sz: string }

export class FlowRecorder {
  private socket: WebSocket | null = null
  private buckets = new Map<string, Bucket>()
  private lastMessageAt = 0
  private stopped = false
  private timer: NodeJS.Timeout | null = null

  constructor(
    private coins: readonly string[],
    private whales: ReadonlySet<string>,
    private now: () => number = Date.now,
  ) {}

  start(): void {
    this.stopped = false
    this.connect()
    this.timer = setInterval(() => {
      void this.flushClosed()
      if (this.now() - this.lastMessageAt > SILENCE_MS) this.reconnect('тишина в сокете')
    }, BUCKET_MS)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.socket?.close()
    await this.flushClosed(true)
  }

  /** Монеты меняются раз в сутки — переподписка проще, чем точечная правка. */
  setCoins(coins: readonly string[]): void {
    const same = coins.length === this.coins.length && coins.every((c, i) => c === this.coins[i])
    if (same) return
    this.coins = coins
    this.reconnect('обновлён список наблюдения')
  }

  private connect(): void {
    if (this.stopped) return
    const socket = new WebSocket(WS_URL)
    this.socket = socket
    this.lastMessageAt = this.now()
    socket.onopen = (): void => {
      for (const coin of this.coins) {
        for (const type of ['trades', 'l2Book']) {
          socket.send(JSON.stringify({ method: 'subscribe', subscription: { type, coin } }))
        }
      }
    }
    socket.onmessage = (event: MessageEvent): void => {
      this.lastMessageAt = this.now()
      try {
        this.handle(JSON.parse(String(event.data)) as Record<string, unknown>)
      } catch (error) {
        console.error(`поток: битое сообщение — ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    socket.onclose = (): void => { if (!this.stopped) setTimeout(() => this.connect(), RECONNECT_MS) }
    socket.onerror = (): void => { socket.close() }
  }

  private reconnect(reason: string): void {
    console.error(`поток: переподключение — ${reason}`)
    this.socket?.close()
  }

  private handle(message: Record<string, unknown>): void {
    if (message.channel === 'trades') {
      for (const trade of message.data as RawTrade[]) {
        applyTrade(this.bucketFor(trade.coin), trade, this.whales)
        const usd = Number(trade.px) * Number(trade.sz)
        if (usd >= BIG_PRINT_USD) void this.writeBigPrint(trade, usd)
      }
      return
    }
    if (message.channel === 'l2Book') {
      const data = message.data as { coin: string; levels: [BookLevel[], BookLevel[]] }
      const bucket = this.bucketFor(data.coin)
      const [bids = [], asks = []] = data.levels
      const sum = (levels: BookLevel[]): number =>
        levels.reduce((total, level) => total + Number(level.px) * Number(level.sz), 0)
      bucket.bidUsd = sum(bids)
      bucket.askUsd = sum(asks)
      bucket.bestBid = Number(bids[0]?.px ?? 0)
      bucket.bestAsk = Number(asks[0]?.px ?? 0)
    }
  }

  /**
   * Корзина выбирается по времени ПРИЁМА, а не по метке биржи.
   *
   * Метка биржи иногда отстаёт и попадает в корзину, уже сброшенную на диск —
   * тогда в архиве появляются две строки на одну секунду, причём вторая без
   * стакана. При разборе через месяц это читается как «стакан пропадал».
   * Размазывание на задержку сети (десятки миллисекунд) на десятисекундной
   * корзине не значит ничего, а уникальность строки значит.
   */
  private bucketFor(coin: string): Bucket {
    const key = `${coin}|${Math.floor(this.now() / BUCKET_MS)}`
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = emptyBucket()
      this.buckets.set(key, bucket)
    }
    return bucket
  }

  private async writeBigPrint(trade: RawTrade, usd: number): Promise<void> {
    const isWhale = (trade.users ?? []).some((user) => this.whales.has(user.toLowerCase()))
    const path = join('flow', trade.coin, 'big')
    await appendLine(dayFile(path, trade.time), [trade.time, Number(trade.px), Math.round(usd), trade.side, isWhale ? 1 : 0])
  }

  /** Сбрасывает на диск корзины, время которых уже прошло. Открытую не трогаем. */
  private async flushClosed(all = false): Promise<void> {
    const currentIndex = Math.floor(this.now() / BUCKET_MS)
    for (const [key, bucket] of [...this.buckets]) {
      const [coin = '', indexText = '0'] = key.split('|')
      const index = Number(indexText)
      if (!all && index >= currentIndex) continue
      this.buckets.delete(key)
      const atMs = index * BUCKET_MS
      await appendLine(dayFile(join('flow', coin), atMs), serialize(Math.floor(atMs / 1000), bucket))
    }
  }
}
