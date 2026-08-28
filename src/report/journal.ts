// Заметка за сутки в Obsidian.
//
// Пишем прямо в vault, а не через промежуточную папку с переносом по
// расписанию, как в ChartLab. Там демон запускается через launchd и не видит
// Рабочий стол из-за прав macOS; наш регистратор запущен из терминала, доступ
// у него есть. Коммит и отправку делает собственная автосинхронизация vault —
// два процесса, дерущихся за git, нам не нужны.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildDigest } from './digest.js'
import { buildScorecard, renderScorecard } from './scorecard.js'
import { utcDay, STATE_DIR } from '../store/ndjson.js'

/**
 * Куда класть заметку. По умолчанию — в архив рядом с остальными данными:
 * на сервере никакого Obsidian нет, а личный путь в публичном репозитории
 * незачем. На машине владельца путь задаётся переменной RADAR_VAULT_DIR, и
 * заметка ложится прямо в vault.
 */
const VAULT_DIR = process.env.RADAR_VAULT_DIR ?? join(STATE_DIR, 'journal')

/** Сутки назад: заметка за день описывает именно прошедший день. */
const DAY_HOURS = 24
/** Табель считаем по двум суткам: за сутки часть горизонтов ещё не дозреет. */
const SCORECARD_HOURS = 48

export async function writeDailyNote(nowMs: number = Date.now()): Promise<string> {
  const day = utcDay(nowMs)
  const digest = await buildDigest({ hours: DAY_HOURS, title: 'Итог суток', nowMs })
  const card = await buildScorecard(SCORECARD_HOURS, nowMs)

  const body = [
    '---',
    'tags: [radar, журнал]',
    `updated: ${day}`,
    '---',
    '',
    `# Рынок ${day}`,
    '',
    digest.text,
    '',
    '## Табель триггеров',
    '',
    renderScorecard(card),
    '',
    '> Заметка собрана радаром автоматически. Числа — из собственного архива,',
    '> ничего не досчитано и не сглажено.',
    '',
  ].join('\n')

  await mkdir(VAULT_DIR, { recursive: true })
  const path = join(VAULT_DIR, `${day}.md`)
  await writeFile(path, body, 'utf8')
  return path
}
