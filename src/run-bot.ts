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

// Меню по нажатию на «/» в телеграме. Без него команды надо помнить наизусть,
// а список из восьми штук наизусть не держит никто.
await bot.api.setMyCommands([
  { command: 'ta', description: 'разбор структуры: /ta SOL 1h' },
  { command: 'flow', description: 'поток прямо сейчас: /flow SOL' },
  { command: 'digest', description: 'сводка по рынку за последние часы' },
  { command: 'score', description: 'чего стоили мои пинги' },
  { command: 'mute', description: 'молчать по монете: /mute SOL 12' },
  { command: 'unmute', description: 'вернуть монету: /unmute SOL' },
  { command: 'quiet', description: 'кто сейчас заглушён' },
  { command: 'threshold', description: 'порог пинга: /threshold 0.35' },
  { command: 'status', description: 'живой ли я и что видел за сутки' },
  { command: 'help', description: 'что я умею' },
])

const me = await bot.api.getMe()
console.log(`бот @${me.username} запущен, жду сообщений`)
await bot.start()
