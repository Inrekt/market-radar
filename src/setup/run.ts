// Сканер сетапа владельца: BTC, ETH, SOL. Живёт в процессе регистратора рядом со сканером
// пингов и ходит с той же частотой. Каждый алерт пишется в журнал — для подсчёта исходов.

import { join } from 'node:path'
import { fetchCandles, type Candle, type Position } from '../hl.js'
import { readBigPrints, readBuckets } from '../flow/read.js'
import { appendLine, dayFile, readJson, writeJson, STATE_DIR } from '../store/ndjson.js'
import { WHALE_POSITIONS_PATH } from '../collectors/whales.js'
import { atr } from '../ta/stats.js'
import { approach, buildPlan, findSweep, flowCheck } from './detect.js'
import { P } from './params.js'
import { seal, setupKey, unseal } from './crypt.js'
import { dayLevels, liqClusters, poolLevels } from './levels.js'
import { estimateHeatmap, type OiPoint } from './heatmap.js'
import { readOiSeries } from './series.js'
import { approachText, setupText, skipText } from './text.js'
import type { Level } from './types.js'

export const SETUP_COINS = ['BTC', 'ETH', 'SOL'] as const
const STATE_PATH = join(STATE_DIR, 'setup', 'state.json')
const COOLDOWN_MS = { near: 6 * 3_600_000, setup: 4 * 3_600_000, rejected: 4 * 3_600_000 }
/** Окно модели ликвидаций: старше недели позиции в основном закрыты или ликвидированы. */
export const HEATMAP_DAYS = 7
const TF = [{ name: '15м', interval: '15m', barMs: 900_000 }, { name: '1ч', interval: '1h', barMs: 3_600_000 }] as const

export type TextSender = (text: string) => Promise<void>

export interface Frames { bars15: Candle[], bars1h: Candle[], bars4h: Candle[], prevDay: Candle | undefined }

export async function frames(coin: string, nowMs: number): Promise<Frames> {
  const since = (days: number): number => Math.floor(nowMs / 1000) - days * 86_400
  const [bars15, bars1h, bars4h, days] = await Promise.all([
    fetchCandles(coin, '15m', since(4), nowMs), fetchCandles(coin, '1h', since(12), nowMs),
    fetchCandles(coin, '4h', since(40), nowMs), fetchCandles(coin, '1d', since(3), nowMs),
  ])
  return { bars15, bars1h, bars4h, prevDay: days.at(-1) }
}

export function levelsOf(f: Frames, positions: readonly Position[], coin: string, oi: readonly OiPoint[]): Level[] {
  const price = f.bars15.at(-1)?.c ?? 0
  return [
    ...poolLevels(f.bars15, '15м'), ...poolLevels(f.bars1h, '1ч'), ...poolLevels(f.bars4h, '4ч'),
    ...dayLevels(f.prevDay), ...liqClusters(positions, coin),
    ...(price > 0 ? estimateHeatmap(oi, f.bars1h, price) : []),
  ]
}

interface Ctx { coin: string, now: number, sent: Record<string, number>, send: TextSender | null }
// Ключи «подходов» содержат монету: `near|BTC|long|83400`, чтобы лимит в час считался по всем монетам.

async function emit(ctx: Ctx, kind: keyof typeof COOLDOWN_MS, key: string, text: string | null, record: object): Promise<boolean> {
  const full = `${kind}|${key}`
  if (ctx.now - (ctx.sent[full] ?? 0) < COOLDOWN_MS[kind]) return false
  if (kind === 'near') {
    const lastHour = Object.entries(ctx.sent)
      .filter(([k, t]) => k.startsWith('near|') && ctx.now - t < 3_600_000).length
    if (lastHour >= P().nearPerHour) return false
  }
  // Сначала отправка: если Telegram отказал, алерт не помечается отправленным и уйдёт на следующем проходе.
  if (text !== null && ctx.send !== null) await ctx.send(text)
  else if (text !== null) console.log(`[сетап, без отправки]\n${text}\n`)
  ctx.sent[full] = ctx.now
  await writeJournal(ctx.now, { t: ctx.now, coin: ctx.coin, kind, ...record })
  return text !== null
}

async function scanCoin(ctx: Ctx, positions: readonly Position[], oi: readonly OiPoint[]): Promise<number> {
  const f = await frames(ctx.coin, ctx.now)
  const levels = levelsOf(f, positions, ctx.coin, oi)
  const atr1h = atr(f.bars1h)
  const price = f.bars15.at(-1)?.c
  if (price === undefined || !(atr1h > 0)) return 0
  let alerts = 0
  for (const side of P().sides[ctx.coin] ?? []) {
    for (const tf of TF) {
      const bars = tf.name === '15м' ? f.bars15 : f.bars1h
      const sweep = findSweep(bars, levels, tf.name, atr(bars), side)
      if (sweep === null) continue
      const minutes = Math.ceil((ctx.now - sweep.sweepStartMs) / 60_000) + 1
      const flow = flowCheck(await readBuckets(ctx.coin, minutes, ctx.now), await readBigPrints(ctx.coin, minutes, ctx.now),
        sweep, ctx.coin, tf.barMs, ctx.now)
      const plan = buildPlan(sweep, levels, price, atr1h)
      const key = `${ctx.coin}|${side}|${Math.round(sweep.level.price)}`
      if (plan === null || plan.rr < P().minRr || !flow.confirmed) {
        const reason = plan === null ? 'нет цели или стопа' : plan.rr < P().minRr ? `RR 1:${plan.rr.toFixed(1)} < 1:${P().minRr}`
          : flow.coveredMinutes === 0 ? 'поток не записан' : 'поток не подтвердил'
        await emit(ctx, 'rejected', key, null, { side, tf: tf.name, sweep, flow, plan, reason })
        continue
      }
      const text = plan.balance.ok ? setupText(ctx.coin, sweep, flow, plan) : skipText(ctx.coin, sweep, plan)
      if (await emit(ctx, 'setup', key, text, { side, tf: tf.name, sweep, flow, plan, enter: plan.balance.ok })) alerts += 1
    }
    const near = approach(price, levels, atr1h, side)
    if (near !== null) {
      const s = side === 'long' ? 1 : -1
      const next = levels
        .filter((l) => l !== near && s * (near.price - l.price) > 0 && s * (near.price - l.price) <= P().stopClusterAtr * atr1h)
        .sort((a, b) => (b.source === 'liq' ? b.usd : 0) - (a.source === 'liq' ? a.usd : 0))[0] ?? null
      const text = approachText(ctx.coin, side, price, near, next)
      if (await emit(ctx, 'near', `${ctx.coin}|${side}|${Math.round(near.price)}`, text, { side, price, level: near, next })) alerts += 1
    }
  }
  return alerts
}

let warned = false
/** Без ключа — ни журнала, ни состояния на диске: ветка архива публичная. */
function noKey(): null {
  if (!warned) console.error('SETUP_KEY не задан — журнал сетапа не пишется, чтобы не уехать в публичный архив открытым')
  warned = true
  return null
}

async function writeJournal(nowMs: number, value: object): Promise<void> {
  const key = setupKey() ?? noKey()
  if (key !== null) await appendLine(dayFile('setup', nowMs), { s: seal(value, key) })
}

/** Состояние повторов: зашифровано на диске; без ключа — только в памяти смены. */
let memory: Record<string, number> = {}

async function loadSent(): Promise<Record<string, number>> {
  const key = setupKey() ?? noKey()
  if (key === null) return memory
  const box = await readJson<{ s?: string }>(STATE_PATH, {})
  if (box.s === undefined) return {}
  try {
    return unseal<Record<string, number>>(box.s, key)
  } catch {
    return {}
  }
}

async function saveSent(sent: Record<string, number>): Promise<void> {
  memory = sent
  const key = setupKey()
  if (key !== null) await writeJson(STATE_PATH, { s: seal(sent, key) })
}

/** Один проход по BTC, ETH, SOL. Сбой одной монеты не мешает остальным. */
export async function scanSetups(send: TextSender | null, nowMs: number = Date.now()): Promise<number> {
  const sent = await loadSent()
  const saved = await readJson<{ positions: Position[] }>(WHALE_POSITIONS_PATH, { positions: [] })
  const series = await readOiSeries(SETUP_COINS, HEATMAP_DAYS, nowMs)
  let alerts = 0
  for (const coin of SETUP_COINS) {
    try {
      alerts += await scanCoin({ coin, now: nowMs, sent, send }, saved.positions, series.get(coin) ?? [])
    } catch (error) {
      console.error(`сетап ${coin}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  await saveSent(sent)
  return alerts
}
