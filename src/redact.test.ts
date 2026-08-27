import { describe, expect, it } from 'vitest'
import { redact, safeError } from './redact.js'

// Форма настоящего токена, но выдуманное значение. Класть сюда живой токен
// нельзя: файл уезжает в репозиторий, а репозиторий публичный ради бесплатных
// минут Actions — тест защищал бы от утечки и сам был бы утечкой.
const TOKEN = '1234567890:AAFsyntheticTOKENvalue0000000000000'

describe('вырезание секретов', () => {
  it('убирает токен из URL, каким его печатает сетевая ошибка', () => {
    const text = `request to https://api.telegram.org/bot${TOKEN}/getMe failed`
    const clean = redact(text)
    expect(clean).not.toContain('AAFsynthetic')
    expect(clean).toContain('/bot***/getMe')
  })

  it('не трогает обычный текст с двоеточиями и числами', () => {
    expect(redact('карточка SOL 15m: цена 96.64, OI 501000000')).toBe('карточка SOL 15m: цена 96.64, OI 501000000')
  })

  it('разворачивает вложенную причину и чистит её тоже', () => {
    const inner = new Error(`connect failed for https://api.telegram.org/bot${TOKEN}/sendPhoto`)
    const outer = new Error('Network request failed', { cause: inner })
    const text = safeError(outer)
    expect(text).toContain('Network request failed')
    expect(text).toContain('connect failed')
    expect(text).not.toContain('AAFsynthetic')
  })

  it('на пустом входе не выдаёт пустую строку', () => {
    expect(safeError(null)).toBe('неизвестная ошибка')
  })
})
