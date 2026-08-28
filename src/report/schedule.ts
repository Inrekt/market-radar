// Расписание сводок. Утро и вечер по Москве — владелец в этом часовом поясе,
// а сервер может крутиться в UTC, поэтому смещение зашито, а не берётся из
// часов машины.

import { join } from 'node:path'
import { readJson, writeJson, STATE_DIR } from '../store/ndjson.js'
import { buildDigest } from './digest.js'
import { writeDailyNote } from './journal.js'

const MSK_OFFSET_HOURS = 3
const MORNING_HOUR_MSK = 9
const EVENING_HOUR_MSK = 21
/** Утренняя сводка про ночь, вечерняя про день. */
const MORNING_WINDOW_HOURS = 12
const EVENING_WINDOW_HOURS = 12
const STATE_PATH = join(STATE_DIR, 'digest-state.json')

interface DigestState {
  /** «ГГГГ-ММ-ДД:слот» последней отправленной сводки */
  readonly lastSent: string
  readonly lastNote: string
}

const EMPTY: DigestState = { lastSent: '', lastNote: '' }

function mskParts(nowMs: number): { day: string, hour: number } {
  const shifted = new Date(nowMs + MSK_OFFSET_HOURS * 3_600_000)
  return { day: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() }
}

export interface DigestSender {
  send(text: string): Promise<void>
}

/**
 * Отправляет сводку, если подошёл её час и сегодня её ещё не слали.
 * Пропущенный из-за простоя час НЕ догоняется: сводка про ночь, присланная в
 * три часа дня, только сбивает.
 */
export async function maybeSendDigest(sender: DigestSender | null, nowMs: number = Date.now()): Promise<string | null> {
  const { day, hour } = mskParts(nowMs)
  const slot = hour === MORNING_HOUR_MSK ? 'утро' : hour === EVENING_HOUR_MSK ? 'вечер' : null
  if (slot === null) return null

  const state = await readJson<DigestState>(STATE_PATH, EMPTY)
  const key = `${day}:${slot}`
  if (state.lastSent === key) return null

  const digest = await buildDigest({
    hours: slot === 'утро' ? MORNING_WINDOW_HOURS : EVENING_WINDOW_HOURS,
    title: slot === 'утро' ? 'Что было ночью' : 'Итог дня',
    nowMs,
  })
  if (sender !== null) await sender.send(digest.text)
  await writeJson(STATE_PATH, { ...state, lastSent: key })
  return slot
}

/** Заметка за сутки пишется раз в день, вечером — когда день уже состоялся. */
export async function maybeWriteNote(nowMs: number = Date.now()): Promise<string | null> {
  const { day, hour } = mskParts(nowMs)
  if (hour !== EVENING_HOUR_MSK) return null
  const state = await readJson<DigestState>(STATE_PATH, EMPTY)
  if (state.lastNote === day) return null
  const path = await writeDailyNote(nowMs)
  await writeJson(STATE_PATH, { ...state, lastNote: day })
  return path
}
