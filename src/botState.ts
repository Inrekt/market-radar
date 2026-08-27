// Кто хозяин бота. Бот отдаёт торговую разметку и данные владельца, поэтому
// говорит ровно с одним человеком: владельцем становится первый написавший и
// дальше не меняется — сменить можно только правкой файла руками.

import { join } from 'node:path'
import { readJson, writeJson, STATE_DIR } from './store/ndjson.js'

const BOT_STATE_PATH = join(STATE_DIR, 'bot-state.json')

export interface BotState {
  /** Telegram id владельца; null — бота ещё никто не занял. */
  ownerId: number | null
  /** Последний чат владельца: адрес для того, о чём бота не просили. */
  lastChatId: number | null
}

/**
 * Файл лежит в state/ рядом с архивом и правится руками, поэтому поля
 * проверяются по одному: опечатка не должна стать ownerId вида "" или {}.
 */
export async function loadBotState(): Promise<BotState> {
  const stored = await readJson<Record<string, unknown>>(BOT_STATE_PATH, {})
  return { ownerId: asId(stored.ownerId), lastChatId: asId(stored.lastChatId) }
}

export async function saveBotState(state: BotState): Promise<void> {
  await writeJson(BOT_STATE_PATH, state)
}

/** Telegram id — целое и ненулевое, поэтому 0 здесь такой же мусор, как строка. */
function asId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value !== 0 ? value : null
}
