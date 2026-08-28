// Чтение событий сканирования (кандидаты и алерты) из архива по суткам.
// Окно может пересекать полночь UTC — читаются оба суточных файла.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { STATE_DIR, utcDay } from '../store/ndjson.js'

export interface ScanEvent {
  readonly t: number
  readonly kind: 'candidate' | 'alert'
  readonly coin: string
  readonly px: number
  readonly score: number
  readonly top: readonly string[]
}

/**
 * Загружает события за последние N часов.
 * Собирает из суточных файлов; окно может пересекать полночь.
 * Отбрасывает записи без обязательных полей (t, coin, px).
 * Пропускает битые JSON-строки молча.
 * Результат отсортирован по времени.
 */
export async function readEvents(hours: number, nowMs?: number): Promise<ScanEvent[]> {
  const now = nowMs ?? Date.now()
  const nowSec = Math.floor(now / 1000)
  const minSec = nowSec - hours * 3600

  const events: ScanEvent[] = []

  // Определяем диапазон дат в UTC
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

  // Читаем файлы (STATE_DIR читается в момент вызова, поддерживает переопределение в тестах)
  const stateDir = path.join(process.env.STATE_DIR ?? STATE_DIR, 'events')
  for (const dateStr of dates) {
    const filePath = path.join(stateDir, `${dateStr}.ndjson`)
    try {
      const content = await readFile(filePath, 'utf-8')
      const lines = content.split('\n').filter((line) => line.trim() !== '')

      for (const line of lines) {
        try {
          const raw = JSON.parse(line)
          // Валидируем обязательные поля
          if (typeof raw.t !== 'number' || typeof raw.coin !== 'string' || typeof raw.px !== 'number') {
            // Отбрасываем запись без обязательных полей
            continue
          }

          // Проверяем диапазон времени
          if (raw.t < minSec || raw.t > nowSec) {
            continue
          }

          // Проверяем kind
          if (raw.kind !== 'candidate' && raw.kind !== 'alert') {
            continue
          }

          // Конструируем событие
          const event: ScanEvent = {
            t: raw.t,
            kind: raw.kind,
            coin: raw.coin,
            px: raw.px,
            score: typeof raw.score === 'number' ? raw.score : 0,
            top: Array.isArray(raw.top) ? (raw.top as string[]) : [],
          }

          events.push(event)
        } catch {
          // Пропускаем битые JSON-строки молча
        }
      }
    } catch {
      // Отсутствующий файл не ошибка
    }
  }

  // Сортируем по времени
  events.sort((a, b) => a.t - b.t)

  return events
}

/**
 * Фильтрует события только типа 'alert'.
 */
export function alertsOf(events: readonly ScanEvent[]): ScanEvent[] {
  return events.filter((e) => e.kind === 'alert')
}

/**
 * Фильтрует события только типа 'candidate'.
 */
export function candidatesOf(events: readonly ScanEvent[]): ScanEvent[] {
  return events.filter((e) => e.kind === 'candidate')
}
