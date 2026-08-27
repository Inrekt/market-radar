// Вырезание секретов из текста перед выводом в лог.
//
// Повод не теоретический: при СЕТЕВОЙ ошибке (не отказе API) grammy кладёт в
// объект ошибки полный URL запроса — а он содержит токен бота целиком.
// Проверено 27.08.2026: `bot.catch`, печатающий сырой объект, выводит
// «request to https://api.telegram.org/bot<ТОКЕН>/getMe failed».
// Логи GitHub Actions в публичном репозитории читает кто угодно, и удалить
// оттуда уже напечатанное нельзя — только перевыпускать токен.
//
// Вырезаем по форме, а не по значению: подставлять сюда сам токен значило бы
// таскать секрет ещё по одному модулю, и это не спасло бы от чужих ключей.

/**
 * Токен телеграм-бота: цифры, двоеточие, тело из букв, цифр, дефиса и подчёркивания.
 * Без \b в начале намеренно: в URL токен идёт сразу за «bot», и между «t» и «8»
 * границы слова нет — с \b выражение молча не находило ровно тот случай, ради
 * которого написано.
 */
const TELEGRAM_TOKEN = /\d{6,}:[A-Za-z0-9_-]{20,}/g

export function redact(value: string): string {
  return value.replace(TELEGRAM_TOKEN, '***')
}

/**
 * Готовая строка об ошибке без секретов. Разворачивает вложенные причины:
 * у сетевых сбоев интересное лежит не в message, а на уровень глубже.
 */
export function safeError(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.message)
      current = (current as { cause?: unknown; error?: unknown }).cause
        ?? (current as { error?: unknown }).error
    } else if (typeof current === 'object') {
      const inner = current as { message?: unknown; error?: unknown; cause?: unknown }
      if (typeof inner.message === 'string') parts.push(inner.message)
      current = inner.cause ?? inner.error
    } else {
      parts.push(String(current))
      break
    }
  }
  return redact(parts.filter(Boolean).join(' ← ')) || 'неизвестная ошибка'
}
