// Замораживает отрезок истории в файл — тесты детекторов не должны зависеть
// от того, что рынок делает прямо сейчас.
//
// Использование: npx tsx scripts/freeze-fixture.ts SOL 15m 200

import { fetchCandles } from '../src/hl.js'
import { writeFile, mkdir } from 'node:fs/promises'

const SECONDS: Record<string, number> = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14_400, '1d': 86_400 }

async function main(): Promise<void> {
  const [coin = 'SOL', interval = '15m', countText = '200'] = process.argv.slice(2)
  const step = SECONDS[interval]
  if (!step) throw new Error(`неизвестный таймфрейм: ${interval}`)
  const count = Number(countText)
  const bars = await fetchCandles(coin, interval, Math.floor(Date.now() / 1000) - count * step)
  await mkdir('src/ta/fixtures', { recursive: true })
  const path = `src/ta/fixtures/${coin.toLowerCase()}-${interval}.json`
  await writeFile(path, JSON.stringify(bars), 'utf8')
  const lows = bars.map((bar) => bar.l)
  const highs = bars.map((bar) => bar.h)
  console.log(`${path}: ${bars.length} баров, ${new Date((bars[0]?.t ?? 0) * 1000).toISOString()} → ` +
    `${new Date((bars.at(-1)?.t ?? 0) * 1000).toISOString()}, диапазон ${Math.min(...lows)} — ${Math.max(...highs)}`)
}

void main()
