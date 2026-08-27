// Отправка пинга владельцу напрямую через API бота.
//
// Сканер живёт в процессе регистратора, а не бота: там уже есть срез рынка
// каждые пять минут. Тянуть ради отправки весь фреймворк бота незачем —
// достаточно одного запроса. Двух опросов обновлений при этом не возникает:
// сканер только отправляет и никогда не читает.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson, STATE_DIR } from '../store/ndjson.js'
import { redact } from '../redact.js'
import type { Notifier } from './run.js'

interface BotState { ownerId: number | null }

export async function telegramNotifier(token: string): Promise<Notifier | null> {
  const state = await readJson<BotState>(join(STATE_DIR, 'bot-state.json'), { ownerId: null })
  const chatId = state.ownerId
  // Владельца ещё нет — значит никто не писал боту. Молча ничего не шлём:
  // угадывать, кому отправить торговую разметку, нельзя.
  if (chatId === null) return null

  return {
    async send(coin: string, photoPath: string, caption: string): Promise<void> {
      const form = new FormData()
      form.append('chat_id', String(chatId))
      form.append('caption', caption)
      form.append('photo', new Blob([await readFile(photoPath)]), `${coin}.png`)
      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form })
      const body = (await res.json()) as { ok: boolean, description?: string }
      // Текст ошибки чистим: при сетевом сбое в него попадает URL с токеном.
      if (!body.ok) throw new Error(redact(body.description ?? 'Telegram отказал без объяснения'))
    },
  }
}
