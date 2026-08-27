import { readFile } from 'fs/promises'
import path from 'path'

/**
 * Снимок рынка в момент времени: все 232 монеты с ценой, фандингом, OI, оборотом.
 * coins[coin] = [цена, фандинг за час, открытый интерес в монетах, оборот за сутки USD]
 */
export interface Snapshot {
  readonly t: number
  readonly coins: Record<string, readonly [number, number, number, number]>
}

/**
 * Представление архива: снимки + метаданные, плюс метод для навигации по времени.
 */
export interface ArchiveView {
  readonly coverageHours: number
  readonly snapshots: readonly Snapshot[]
  /**
   * Ближайший снимок к моменту "сейчас минус minutesAgo".
   * Если разброс больше половины интервала, возвращает null: лучше молчать,
   * чем выдать далекий снимок за свежий.
   */
  at(minutesAgo: number): Snapshot | null
}

/**
 * Поток денег китов в монету за несколько периодов.
 */
export interface WhaleFlow {
  readonly m15: number
  readonly h1: number
  readonly h4: number
}

/**
 * Загружает снимки рынка за последние N часов.
 * Собирает из двух суточных файлов, если окно пересекает полночь.
 * Пропускает битые NDJSON-строки, но не теряет остальной файл.
 */
export async function loadSeries(hours: number, nowMs?: number): Promise<ArchiveView> {
  const now = nowMs ?? Date.now()
  const nowSec = Math.floor(now / 1000)
  const minSec = nowSec - hours * 3600

  const snapshots: Snapshot[] = []

  // Определяем, какие дни нужно прочитать
  const nowDate = new Date(now)
  const minDate = new Date(now - hours * 3600 * 1000)

  const dates = new Set<string>()
  let d = new Date(minDate)
  while (d <= nowDate) {
    const year = d.getUTCFullYear()
    const month = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    dates.add(`${year}-${month}-${day}`)
    d = new Date(d.getTime() + 86400000) // добавляем сутки
  }

  // Читаем файлы
  const stateDir = path.join(process.cwd(), 'state', 'series')
  for (const dateStr of dates) {
    const filePath = path.join(stateDir, `${dateStr}.ndjson`)
    try {
      const content = await readFile(filePath, 'utf-8')
      const lines = content.split('\n').filter((line) => line.trim() !== '')

      for (const line of lines) {
        try {
          const snapshot = JSON.parse(line) as Snapshot
          // Принимаем только снимки в нужном окне
          if (snapshot.t >= minSec && snapshot.t <= nowSec) {
            snapshots.push(snapshot)
          }
        } catch {
          // Пропускаем битую строку, не роняем весь файл
        }
      }
    } catch {
      // Файл отсутствует или не читается — продолжаем
    }
  }

  // Сортируем по времени
  snapshots.sort((a, b) => a.t - b.t)

  // Считаем реальное покрытие по размаху
  let coverageHours = 0
  if (snapshots.length >= 2) {
    const firstT = snapshots[0]!.t
    const lastT = snapshots[snapshots.length - 1]!.t
    coverageHours = (lastT - firstT) / 3600
  }

  return {
    coverageHours,
    snapshots: snapshots as readonly Snapshot[],
    at(minutesAgo: number): Snapshot | null {
      const targetSec = nowSec - minutesAgo * 60
      const toleranceSec = (minutesAgo * 60) / 2 // половина интервала в секундах

      // Двоичный поиск ближайшего снимка
      let best: Snapshot | null = null
      let bestDistance = Infinity

      for (const snapshot of snapshots) {
        const distance = Math.abs(snapshot.t - targetSec)
        if (distance < bestDistance) {
          bestDistance = distance
          best = snapshot
        }
      }

      // Если ближайший снимок отстоит больше допуска, молчим
      if (best !== null && bestDistance <= toleranceSec) {
        return best
      }
      return null
    },
  }
}

/**
 * Поток денег китов в одну монету за последние 15м, 1ч, 4ч.
 * Сумма (toUsd - fromUsd) по записям монеты в каждом периоде.
 * Если монеты нет в архиве, возвращает нули (не бросает).
 */
export async function whaleFlow(coin: string, nowMs?: number): Promise<WhaleFlow> {
  const now = nowMs ?? Date.now()
  const nowSec = Math.floor(now / 1000)

  // Определяем периоды: -15м, -1ч, -4ч от now
  const periods = {
    m15: { startSec: nowSec - 15 * 60, endSec: nowSec },
    h1: { startSec: nowSec - 3600, endSec: nowSec },
    h4: { startSec: nowSec - 4 * 3600, endSec: nowSec },
  }

  // Определяем, какие дни нужно прочитать (для самого большого периода)
  const minDate = new Date(now - 4 * 3600 * 1000)
  const nowDate = new Date(now)

  const dates = new Set<string>()
  let d = new Date(minDate)
  while (d <= nowDate) {
    const year = d.getUTCFullYear()
    const month = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    dates.add(`${year}-${month}-${day}`)
    d = new Date(d.getTime() + 86400000)
  }

  // Читаем все записи о китах в периодах
  type WhaleRecord = {
    t: number
    coin: string
    fromUsd: number
    toUsd: number
  }
  const records: WhaleRecord[] = []

  const stateDir = path.join(process.cwd(), 'state', 'whales')
  for (const dateStr of dates) {
    const filePath = path.join(stateDir, `${dateStr}.ndjson`)
    try {
      const content = await readFile(filePath, 'utf-8')
      const lines = content.split('\n').filter((line) => line.trim() !== '')

      for (const line of lines) {
        try {
          const record = JSON.parse(line) as {
            t: number
            coin: string
            fromUsd: number
            toUsd: number
          }
          if (record.coin === coin && record.t >= periods.h4.startSec && record.t <= periods.h4.endSec) {
            records.push(record)
          }
        } catch {
          // Пропускаем битую строку
        }
      }
    } catch {
      // Файл отсутствует
    }
  }

  // Складываем поток по периодам
  const flows = {
    m15: 0,
    h1: 0,
    h4: 0,
  }

  for (const record of records) {
    const delta = record.toUsd - record.fromUsd

    if (record.t >= periods.m15.startSec && record.t <= periods.m15.endSec) {
      flows.m15 += delta
    }
    if (record.t >= periods.h1.startSec && record.t <= periods.h1.endSec) {
      flows.h1 += delta
    }
    if (record.t >= periods.h4.startSec && record.t <= periods.h4.endSec) {
      flows.h4 += delta
    }
  }

  return flows
}

/**
 * Извлекает одно поле из снимка: 0=цена, 1=фандинг, 2=OI, 3=оборот.
 * Возвращает null, если снимка нет или монеты в нем нет.
 */
export function valueAt(
  snapshot: Snapshot | null,
  coin: string,
  field: 0 | 1 | 2 | 3,
): number | null {
  if (snapshot === null) return null
  const values = snapshot.coins[coin]
  if (values === undefined) return null
  return values[field] ?? null
}
