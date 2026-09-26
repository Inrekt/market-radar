// Чтение архива рынка (снимок раз в 5 минут) для модели ликвидаций: цена и OI по монете.
// Прошлые дни не меняются — читаются один раз за смену; сегодняшний перечитывается.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { STATE_DIR, utcDay } from '../store/ndjson.js'
import type { OiPoint } from './heatmap.js'

type DayPoints = ReadonlyMap<string, readonly OiPoint[]>
const cache = new Map<string, DayPoints>()

async function readDay(day: string, coins: readonly string[]): Promise<DayPoints> {
  const out = new Map<string, OiPoint[]>(coins.map((c) => [c, []]))
  let content = ''
  try {
    content = await readFile(join(STATE_DIR, 'series', `${day}.ndjson`), 'utf8')
  } catch {
    return out
  }
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      const row = JSON.parse(line) as { t: number, coins: Record<string, [number, number, number, number]> }
      for (const coin of coins) {
        const v = row.coins[coin]
        if (v && v[0] > 0 && v[2] > 0) out.get(coin)?.push({ t: row.t, px: v[0], oi: v[2] })
      }
    } catch {
      // битую строку пропускаем — одна потерянная точка модель не ломает
    }
  }
  return out
}

/** Точки цены и OI по монетам за последние days суток UTC. */
export async function readOiSeries(coins: readonly string[], days: number, nowMs: number): Promise<Map<string, OiPoint[]>> {
  const today = utcDay(nowMs)
  const out = new Map<string, OiPoint[]>(coins.map((c) => [c, []]))
  for (let d = days; d >= 0; d -= 1) {
    const day = utcDay(nowMs - d * 86_400_000)
    let points = day === today ? undefined : cache.get(day)
    if (points === undefined) {
      points = await readDay(day, coins)
      if (day !== today) cache.set(day, points)
    }
    for (const coin of coins) out.get(coin)?.push(...(points.get(coin) ?? []))
  }
  return out
}
