// Печатает разметку по зафиксированному отрезку — глазами проверить, что
// детекторы видят то же, что человек.
import { readFile } from 'node:fs/promises'
import { markup } from '../src/ta/index.js'
import type { Candle } from '../src/hl.js'

async function main(): Promise<void> {
  const path = process.argv[2] ?? 'src/ta/fixtures/sol-15m.json'
  const bars = JSON.parse(await readFile(path, 'utf8')) as Candle[]
  const result = markup(bars)
  console.log(`баров ${bars.length} · цена ${result.price} · ATR ${result.atr.toFixed(3)}`)
  console.log(`зоны (${result.zones.length}):`)
  for (const zone of result.zones) {
    console.log(`  ${zone.kind.padEnd(5)} ${zone.dir === 'up' ? '+' : '−'}  ${zone.lo.toFixed(2)} — ${zone.hi.toFixed(2)}  бар ${zone.from}`)
  }
  console.log(`линии (${result.lines.length}):`)
  for (const line of result.lines) {
    console.log(`  ${line.kind.padEnd(4)} ${line.price.toFixed(2)}  касаний ${line.touches}`)
  }
}
void main()
