// Запуск бота. Отдельно от createBot нарочно: тесты и разовые прогоны должны
// уметь собрать бота, не поднимая опрос обновлений.
//
// ВАЖНО: getUpdates у Telegram однопотребительский. Два запущенных экземпляра
// молча делят сообщения между собой, а проверка «живой ли бот» через getUpdates
// сама создаёт тот конфликт, который ищет. Живость проверять только getMe.

import { createBot } from './bot.js'
import { closeBrowser } from './render/png.js'

try {
  process.loadEnvFile('.env')
} catch {
  // .env нет — значит токен пришёл из окружения (так будет в CI)
}

const token = process.env.BOT_TOKEN
if (!token) {
  console.error('BOT_TOKEN не задан: положи его в .env или в переменные окружения')
  process.exit(1)
}

const bot = createBot(token)

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}: останавливаюсь`)
  await bot.stop()
  await closeBrowser()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

const me = await bot.api.getMe()
console.log(`бот @${me.username} запущен, жду сообщений`)
await bot.start()
