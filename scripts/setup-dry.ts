// Что видит сканер сетапа прямо сейчас — без отправки в Telegram.
//   STATE_DIR=/tmp/radar-dry npm run setup:dry
// Запускать с отдельным STATE_DIR: прогон пишет состояние и журнал сетапа.
// Числа и ключ берутся из .env (SETUP_PARAMS, SETUP_KEY), как у main().

import { collectWhales, loadUniverse, WHALE_POSITIONS_PATH } from '../src/collectors/whales.js'
import type { Position } from '../src/hl.js'
import { readJson } from '../src/store/ndjson.js'
import { atr } from '../src/ta/stats.js'
import { approach, findSweep } from '../src/setup/detect.js'
import { frames, HEATMAP_DAYS, levelsOf, scanSetups, SETUP_COINS } from '../src/setup/run.js'
import { readOiSeries } from '../src/setup/series.js'
import { px, usd } from '../src/setup/text.js'

try {
  process.loadEnvFile('.env')
} catch {
  // без .env — на заглушках
}
const now = Date.now()
const universe = await loadUniverse()
if (universe.addresses.length > 0) {
  const diffs = await collectWhales(universe.addresses, now)
  console.log(`киты: ${universe.addresses.length} кошельков, изменений ${diffs.length}`)
}
const { positions } = await readJson<{ positions: Position[] }>(WHALE_POSITIONS_PATH, { positions: [] })

const series = await readOiSeries(SETUP_COINS, HEATMAP_DAYS, now)
for (const coin of SETUP_COINS) {
  const f = await frames(coin, now)
  const levels = levelsOf(f, positions, coin, series.get(coin) ?? [])
  const price = f.bars15.at(-1)?.c ?? 0
  const atr1h = atr(f.bars1h)
  const below = levels.filter((l) => l.price < price).sort((a, b) => b.price - a.price).slice(0, 4)
  const above = levels.filter((l) => l.price > price).sort((a, b) => a.price - b.price).slice(0, 4)
  const bySource = ['pool', 'day', 'liq'].map((s) => `${s} ${levels.filter((l) => l.source === s).length}`).join(', ')
  console.log(`\n${coin} · цена ${px(price)} · ATR 1ч ${px(atr1h)} · уровней: ${bySource}`)
  console.log('  сверху:', above.map((l) => `${px(l.price)} ${l.label}${l.usd ? ` ${usd(l.usd)}` : ''}`).join(' | ') || '—')
  console.log('  снизу: ', below.map((l) => `${px(l.price)} ${l.label}`).join(' | ') || '—')
  console.log(`  точек OI за ${HEATMAP_DAYS} дн.: ${series.get(coin)?.length ?? 0}`)
  const model = levels.filter((l) => l.tf === 'модель').sort((a, b) => b.usd - a.usd).slice(0, 6)
  console.log('  модель, крупнейшие:', model.map((l) => `${px(l.price)} ${l.label}`).join(' | ') || '—')
  const liq = levels.filter((l) => l.tf === 'HL').sort((a, b) => b.usd - a.usd).slice(0, 4)
  console.log('  крупнейшие кластеры китов:', liq.map((l) => `${px(l.price)} ${l.label}`).join(' | ') || '—')
  for (const side of ['long', 'short'] as const) {
    const near = approach(price, levels, atr1h, side)
    const sweeps = [['15м', f.bars15], ['1ч', f.bars1h]] as const
    const found = sweeps.map(([tf, bars]) => findSweep(bars, levels, tf, atr(bars), side)).filter((x) => x !== null)
    console.log(`  ${side}: подход ${near ? `${px(near.price)} (${near.label})` : 'нет'} · свип ${found.length > 0 ? found.map((x) => `${x.tf} ${px(x.level.price)}`).join(', ') : 'нет'}`)
  }
}

console.log('\nпрогон сканера без отправки:')
const alerts = await scanSetups(null, now)
console.log(`алертов: ${alerts}`)
