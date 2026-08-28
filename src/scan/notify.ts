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

/**
 * Кому слать. Ищется НА КАЖДУЮ отправку, а не один раз при старте.
 *
 * Первая версия запоминала владельца при запуске смены — и это стоило
 * пропущенных пингов: в облаке владельца в архиве ещё не было, сканер захватил
 * «некому слать» и молчал бы всю шестичасовую смену, даже после того как
 * владелец написал боту и тот его запомнил.
 *
 * Переменная окружения важнее файла: на сервере она задаётся секретом и
 * работает с первой же смены, не дожидаясь, пока кто-то напишет боту.
 */
async function ownerId(): Promise<number | null> {
  const fromEnv = Number(process.env.RADAR_OWNER_ID)
  if (Number.isInteger(fromEnv) && fromEnv !== 0) return fromEnv
  const state = await readJson<BotState>(join(STATE_DIR, 'bot-state.json'), { ownerId: null })
  return state.ownerId
}

export function telegramNotifier(token: string): Notifier {
  return {
    async send(coin: string, photoPath: string, caption: string): Promise<void> {
      const chatId = await ownerId()
      // Владельца ещё нет — никто не писал боту и секрет не задан. Угадывать,
      // кому отправить торговую разметку, нельзя.
      if (chatId === null) throw new Error('владелец неизвестен: никто не писал боту и RADAR_OWNER_ID не задан')

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
