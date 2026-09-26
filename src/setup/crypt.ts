// Шифрование журнала сетапа: ветка архива публичная, а в журнале — уровни и планы владельца.
// AES-256-GCM, ключ — секрет SETUP_KEY (32 байта в base64). Без ключа журнал не пишется вовсе,
// чтобы по ошибке не уехать в публичный архив открытым текстом.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const IV = 12
const TAG = 16

export function parseKey(raw: string | undefined): Buffer | null {
  if (raw === undefined) return null
  const key = Buffer.from(raw.trim(), 'base64')
  return key.length === 32 ? key : null
}

let cached: Buffer | null | undefined

export function setupKey(): Buffer | null {
  if (cached === undefined) cached = parseKey(process.env.SETUP_KEY)
  return cached
}

export function seal(value: unknown, key: Buffer): string {
  const iv = randomBytes(IV)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
}

export function unseal<T>(box: string, key: Buffer): T {
  const raw = Buffer.from(box, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV))
  decipher.setAuthTag(raw.subarray(IV, IV + TAG))
  const text = Buffer.concat([decipher.update(raw.subarray(IV + TAG)), decipher.final()]).toString('utf8')
  return JSON.parse(text) as T
}
