// Хранилище: NDJSON по суткам в state/. Код никогда не трогает git —
// это делает scripts/push-state.sh (в CI state/ это worktree ветки `state`).

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const STATE_DIR = process.env.STATE_DIR ?? 'state'

/** Сутки по UTC: архив режется по UTC, чтобы не спорить с переводом часов. */
export function utcDay(atMs: number = Date.now()): string {
  return new Date(atMs).toISOString().slice(0, 10)
}

export function dayFile(kind: string, atMs: number = Date.now()): string {
  return join(STATE_DIR, kind, `${utcDay(atMs)}.ndjson`)
}

/** Дописывает одну строку. Каталог создаётся сам — регистратор не должен падать на этом. */
export async function appendLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8')
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
