// Чтение архива: корзины и крупные принты по заданному окну.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { STATE_DIR, utcDay } from '../store/ndjson.js'
import type { FlowBucket, BigPrint } from './summary.js'

/**
 * Читает корзины за последние minutes минут.
 * nowMs — время запроса (по умолчанию текущее).
 *
 * - Окно может пересекать полночь UTC — читаются оба дня.
 * - Файла может не быть вовсе — вернуть пустой массив.
 * - Битую строку пропускать молча.
 * - Результат отсортирован по времени.
 */
export async function readBuckets(coin: string, minutes: number, nowMs?: number): Promise<FlowBucket[]> {
  const now = nowMs ?? Date.now()
  const startMs = now - minutes * 60_000

  // Дни UTC, которые может пересекать окно
  const startDay = utcDay(startMs)
  const endDay = utcDay(now)

  const days = getDaysBetween(startDay, endDay)
  const buckets: FlowBucket[] = []

  for (const day of days) {
    const filePath = join(STATE_DIR, 'flow', coin, `${day}.ndjson`)
    try {
      const content = await readFile(filePath, 'utf8')
      const lines = content.split('\n').filter((line) => line.trim().length > 0)

      for (const line of lines) {
        try {
          const arr = JSON.parse(line) as unknown
          if (!Array.isArray(arr) || arr.length < 11) continue

          // Архив: [tСек, buyUsd, sellUsd, сделок, цена, whaleBuyUsd, whaleSellUsd, bidUsd, askUsd, bestBid, bestAsk]
          const tSec = Number(arr[0])
          const tMs = tSec * 1000
          if (tMs < startMs || tMs >= now) continue

          const bucket: FlowBucket = {
            t: tMs,
            buyUsd: Number(arr[1]) || 0,
            sellUsd: Number(arr[2]) || 0,
            trades: Number(arr[3]) || 0,
            px: Number(arr[4]) || 0,
            whaleBuyUsd: Number(arr[5]) || 0,
            whaleSellUsd: Number(arr[6]) || 0,
            bidUsd: Number(arr[7]) || 0,
            askUsd: Number(arr[8]) || 0,
            bestBid: Number(arr[9]) || 0,
            bestAsk: Number(arr[10]) || 0,
          }
          buckets.push(bucket)
        } catch {
          // Биту строку пропускаем молча — одна повреждённая запись не должна стоить всей истории
        }
      }
    } catch {
      // Файла может не быть вовсе — это не ошибка
    }
  }

  // Сортируем по времени
  buckets.sort((a, b) => a.t - b.t)
  return buckets
}

/**
 * Читает крупные принты за последние minutes минут.
 * nowMs — время запроса (по умолчанию текущее).
 */
export async function readBigPrints(coin: string, minutes: number, nowMs?: number): Promise<BigPrint[]> {
  const now = nowMs ?? Date.now()
  const startMs = now - minutes * 60_000

  const startDay = utcDay(startMs)
  const endDay = utcDay(now)

  const days = getDaysBetween(startDay, endDay)
  const prints: BigPrint[] = []

  for (const day of days) {
    const filePath = join(STATE_DIR, 'flow', coin, 'big', `${day}.ndjson`)
    try {
      const content = await readFile(filePath, 'utf8')
      const lines = content.split('\n').filter((line) => line.trim().length > 0)

      for (const line of lines) {
        try {
          const arr = JSON.parse(line) as unknown
          if (!Array.isArray(arr) || arr.length < 5) continue

          // Архив: [tМиллисекунд, цена, usd, сторона ('A'|'B'), whale (0|1)]
          const t = Number(arr[0])
          if (t < startMs || t >= now) continue

          const side = arr[3] === 'A' || arr[3] === 'B' ? arr[3] : 'A'
          const whale = (arr[4] as number) !== 0

          const print: BigPrint = {
            t,
            px: Number(arr[1]) || 0,
            usd: Number(arr[2]) || 0,
            side,
            whale,
          }
          prints.push(print)
        } catch {
          // Пропускаем
        }
      }
    } catch {
      // Файла может не быть
    }
  }

  prints.sort((a, b) => a.t - b.t)
  return prints
}

/** Генерирует список дней UTC между start и end включительно. */
function getDaysBetween(start: string, end: string): string[] {
  const days: string[] = []
  let current = start
  while (current <= end) {
    days.push(current)
    const date = new Date(`${current}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + 1)
    current = date.toISOString().slice(0, 10)
  }
  return days
}
