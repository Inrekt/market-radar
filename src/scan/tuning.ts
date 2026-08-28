// Настройки, которыми владелец управляет из чата: заглушённые монеты и порог.
//
// Бот и сканер — разные процессы, поэтому связь через файл состояния, который
// сканер перечитывает на каждом тике. Держать в памяти нельзя: команда из чата
// не дошла бы до сканера вовсе.

import { join } from 'node:path'
import { readJson, writeJson, STATE_DIR } from '../store/ndjson.js'

const PATH = join(STATE_DIR, 'tuning.json')
/** По умолчанию глушим на сутки: столько живёт большинство новостных всплесков. */
export const DEFAULT_MUTE_HOURS = 24

export interface Tuning {
  /** монета → до какого времени молчать, мс */
  readonly mutedUntil: Record<string, number>
  /** ручной порог; null — используется откалиброванный по умолчанию */
  readonly threshold: number | null
}

export const EMPTY_TUNING: Tuning = { mutedUntil: {}, threshold: null }

export async function loadTuning(): Promise<Tuning> {
  return readJson<Tuning>(PATH, EMPTY_TUNING)
}

export async function saveTuning(tuning: Tuning): Promise<void> {
  await writeJson(PATH, tuning)
}

export function isMuted(tuning: Tuning, coin: string, nowMs: number): boolean {
  const until = tuning.mutedUntil[coin.toUpperCase()]
  return until !== undefined && until > nowMs
}

export function mute(tuning: Tuning, coin: string, hours: number, nowMs: number): Tuning {
  return {
    ...tuning,
    mutedUntil: { ...tuning.mutedUntil, [coin.toUpperCase()]: nowMs + hours * 3_600_000 },
  }
}

export function unmute(tuning: Tuning, coin: string): Tuning {
  const next = { ...tuning.mutedUntil }
  delete next[coin.toUpperCase()]
  return { ...tuning, mutedUntil: next }
}

/** Просроченные записи выбрасываем при чтении, чтобы файл не рос вечно. */
export function activeMutes(tuning: Tuning, nowMs: number): { coin: string, hoursLeft: number }[] {
  return Object.entries(tuning.mutedUntil)
    .filter(([, until]) => until > nowMs)
    .map(([coin, until]) => ({ coin, hoursLeft: (until - nowMs) / 3_600_000 }))
    .sort((a, b) => b.hoursLeft - a.hoursLeft)
}
