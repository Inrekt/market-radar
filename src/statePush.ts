// Сохранение архива между сменами.
//
// На сервере state/ — это рабочая копия ветки `state`, и всё, что не отправлено
// в неё, исчезает вместе со сменой. Локально это обычная папка, и скрипт молча
// ничего не делает. Отметка «жив» нужна сторожу: без неё оборванная смена
// выглядит как спокойный рынок.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { readJson, writeJson, STATE_DIR } from './store/ndjson.js'

const run = promisify(execFile)
const HEARTBEAT_PATH = join(STATE_DIR, 'heartbeat.json')

/** Реже, чем тик: каждая отправка — коммит в репозиторий. */
export const PUSH_INTERVAL_MS = 20 * 60_000

export async function beatAndPush(nowMs: number = Date.now()): Promise<boolean> {
  const previous = await readJson<Record<string, unknown>>(HEARTBEAT_PATH, {})
  await writeJson(HEARTBEAT_PATH, { ...previous, heartbeat: new Date(nowMs).toISOString() })
  try {
    await run('bash', ['scripts/push-state.sh'], { timeout: 120_000 })
    return true
  } catch {
    // Локально скрипт выходит сразу: state/ не рабочая копия. Это не ошибка.
    return false
  }
}
