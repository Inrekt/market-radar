// Рендер зафиксированного отрезка в картинку — без сети и без телеграма. Именно
// этим PNG владелец глазами проверяет разметку до того, как её увидит бот.
//
// Использование: npx tsx scripts/render-demo.ts

import { readFile, stat } from 'node:fs/promises'
import type { Candle } from '../src/hl.js'
import { markup } from '../src/ta/index.js'
import { closeBrowser, renderChart } from '../src/render/png.js'

const FIXTURE = 'src/ta/fixtures/sol-15m.json'
const OUT = 'out/ta-sol-15m.png'

/** Тот же кадр, что уходит в карточку бота: проверять надо ровно то, что увидят. */
const WIDTH = 1080
const HEIGHT = 1350

async function main(): Promise<void> {
  const bars = JSON.parse(await readFile(FIXTURE, 'utf8')) as Candle[]
  try {
    // Без previousDay: в отрезке одного таймфрейма дневных границ взять неоткуда,
    // поэтому PDH/PDL на демо-картинке не будет — это не поломка разметки.
    const path = await renderChart(
      { coin: 'SOL', interval: '15m', bars, markup: markup(bars), width: WIDTH, height: HEIGHT },
      OUT,
    )
    const { size } = await stat(path)
    console.log(`${path}: ${size} байт`)
  } finally {
    await closeBrowser()
  }
}

void main()
