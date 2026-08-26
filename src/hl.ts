// Клиент Hyperliquid. Публичный API, без ключей и без денег.
// Лимит — 1200 единиц веса в минуту на IP; clearinghouseState весит 2.

const INFO_URL = 'https://api.hyperliquid.xyz/info'
const LEADERBOARD_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard'
const TIMEOUT_MS = 20_000
const LEADERBOARD_TIMEOUT_MS = 120_000

export interface AssetCtx {
  readonly coin: string
  /** ставка фандинга за ЧАС (у Hyperliquid она часовая, не восьмичасовая) */
  readonly funding: number
  /** открытый интерес в монетах */
  readonly openInterest: number
  /** оборот за сутки в долларах */
  readonly dayNtlVlm: number
  readonly markPx: number
  readonly prevDayPx: number
}

export interface Candle {
  readonly t: number
  readonly o: number
  readonly h: number
  readonly l: number
  readonly c: number
  readonly v: number
  /** число сделок в баре — своя мера активности, отдельная от объёма */
  readonly n: number
}

export interface LeaderboardRow {
  readonly address: string
  readonly accountValue: number
}

export interface Position {
  readonly address: string
  readonly coin: string
  readonly isLong: boolean
  readonly sizeUsd: number
  readonly leverage: number
  readonly entryPx: number
  readonly liquidationPx: number | null
  readonly unrealizedPnl: number
}

async function postInfo<T>(body: Record<string, unknown>, timeoutMs = TIMEOUT_MS): Promise<T> {
  const res = await fetch(INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Hyperliquid ${String(body.type)}: HTTP ${res.status}`)
  return (await res.json()) as T
}

interface RawUniverse {
  readonly universe: readonly { readonly name: string }[]
}
interface RawCtx {
  readonly funding: string
  readonly openInterest: string
  readonly dayNtlVlm: string
  readonly markPx: string
  readonly prevDayPx: string
}

/** Один запрос — весь рынок: 232 перпа с фандингом, OI и оборотом. ~71 КБ. */
export async function fetchAssetCtxs(): Promise<AssetCtx[]> {
  const [meta, ctxs] = await postInfo<[RawUniverse, RawCtx[]]>({ type: 'metaAndAssetCtxs' })
  return meta.universe.flatMap((asset, index) => {
    const ctx = ctxs[index]
    if (!ctx) return []
    return [{
      coin: asset.name,
      funding: Number(ctx.funding),
      openInterest: Number(ctx.openInterest),
      dayNtlVlm: Number(ctx.dayNtlVlm),
      markPx: Number(ctx.markPx),
      prevDayPx: Number(ctx.prevDayPx),
    }]
  })
}

interface RawCandle {
  readonly t: number
  readonly T: number
  readonly o: string
  readonly h: string
  readonly l: string
  readonly c: string
  readonly v: string
  readonly n: number
}

/**
 * Свечи. Отдаёт ТОЛЬКО закрытые бары: незакрытая свеча — ещё не факт, решать по
 * ней нельзя, и в бэктесте её не существует. Правило общее для всего проекта.
 */
export async function fetchCandles(
  coin: string,
  interval: string,
  startTimeSec: number,
  nowMs: number = Date.now(),
): Promise<Candle[]> {
  const raw = await postInfo<RawCandle[]>({
    type: 'candleSnapshot',
    req: { coin, interval, startTime: startTimeSec * 1000, endTime: nowMs },
  })
  return raw
    .filter((bar) => bar.T < nowMs)
    .map((bar) => ({
      t: Math.floor(bar.t / 1000),
      o: Number(bar.o),
      h: Number(bar.h),
      l: Number(bar.l),
      c: Number(bar.c),
      v: Number(bar.v),
      n: bar.n,
    }))
}

interface RawLeaderboardRow {
  readonly ethAddress: string
  readonly accountValue: string
}

/** Таблица счетов, ~33 МБ. Дёргается раз в сутки, не чаще. */
export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  const res = await fetch(LEADERBOARD_URL, { signal: AbortSignal.timeout(LEADERBOARD_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Leaderboard: HTTP ${res.status}`)
  const raw = (await res.json()) as { leaderboardRows: RawLeaderboardRow[] }
  return raw.leaderboardRows.map((row) => ({
    address: row.ethAddress,
    accountValue: Number(row.accountValue),
  }))
}

interface RawAssetPosition {
  readonly position: {
    readonly coin: string
    readonly szi: string
    readonly entryPx: string | null
    readonly liquidationPx: string | null
    readonly positionValue: string
    readonly unrealizedPnl: string
    readonly leverage: { readonly value: number }
  }
}

/** Открытые позиции одного кошелька. */
export async function fetchPositions(address: string): Promise<Position[]> {
  const state = await postInfo<{ assetPositions: RawAssetPosition[] }>({
    type: 'clearinghouseState',
    user: address,
  })
  return state.assetPositions.map(({ position }) => ({
    address,
    coin: position.coin,
    isLong: Number(position.szi) > 0,
    sizeUsd: Number(position.positionValue),
    leverage: position.leverage.value,
    entryPx: position.entryPx === null ? 0 : Number(position.entryPx),
    liquidationPx: position.liquidationPx === null ? null : Number(position.liquidationPx),
    unrealizedPnl: Number(position.unrealizedPnl),
  }))
}

/** Прогон fn по списку с ограниченной параллельностью; упавшие элементы пропускаются. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index]
      if (item === undefined) continue
      try {
        results.push(await fn(item))
      } catch (error) {
        console.error(`пропуск ${index}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
