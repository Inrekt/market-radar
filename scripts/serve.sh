#!/bin/zsh
# Надзиратель: держит бота и регистратор живыми. Запускать ИЗ ТЕРМИНАЛА.
#
# Почему не launchd: на macOS фоновому заданию не выдаётся доступ к Рабочему
# столу без отдельного разрешения, и процесс молча не увидит ни state/, ни .env.
# На этом уже спотыкались в соседнем проекте. Из терминала доступ наследуется.
#
# Оба процесса перезапускаются при падении с паузой, чтобы циклическая ошибка
# не крутилась в полную скорость и не съела квоту биржи.
set -u
cd "$(dirname "$0")/.."
mkdir -p logs

RESTART_PAUSE=10

run_forever() {
  local name="$1" cmd="$2"
  while true; do
    echo "$(date -u +%FT%TZ) запускаю $name" >> "logs/$name.log"
    eval "$cmd" >> "logs/$name.log" 2>&1
    echo "$(date -u +%FT%TZ) $name упал, перезапуск через ${RESTART_PAUSE}с" >> "logs/$name.log"
    sleep "$RESTART_PAUSE"
  done
}

# Один опрос обновлений на весь мир: два бота молча поделили бы сообщения
# между собой, и половина команд пропала бы без всякой ошибки.
if pgrep -f "tsx src/run-bot.ts" > /dev/null; then
  echo "бот уже запущен — второй экземпляр не поднимаю"
else
  run_forever bot "npx tsx src/run-bot.ts" &
fi

if pgrep -f "tsx src/main.ts" > /dev/null; then
  echo "регистратор уже запущен — второй экземпляр не поднимаю"
else
  run_forever record "npx tsx src/main.ts" &
fi

echo "надзиратель поднят. Логи: logs/bot.log и logs/record.log"
echo "остановить всё: pkill -f 'tsx src/run-bot.ts'; pkill -f 'tsx src/main.ts'; pkill -f serve.sh"
wait
