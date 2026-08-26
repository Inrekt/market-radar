import { describe, expect, it } from 'vitest'
import { applyTrade, emptyBucket, serialize, type RawTrade } from './ws.js'

const WHALE = '0xabc'
const whales = new Set([WHALE])
const trade = (side: 'A' | 'B', px: number, sz: number, users?: string[]): RawTrade =>
  ({ coin: 'SOL', side, px: String(px), sz: String(sz), time: 0, users })

describe('корзина потока', () => {
  // Сверено записью живой ленты 27.08.2026: продажа на $48.3K за одну корзину
  // увела цену 96.51 → 96.47. Знак дельты нельзя брать на веру, он проверен.
  it('A — это агрессивная продажа, B — покупка', () => {
    const bucket = emptyBucket()
    applyTrade(bucket, trade('A', 100, 10), whales)
    applyTrade(bucket, trade('B', 100, 4), whales)
    expect(bucket.sellUsd).toBe(1000)
    expect(bucket.buyUsd).toBe(400)
    expect(bucket.trades).toBe(2)
  })

  it('помечает сделку кита по любой из двух сторон', () => {
    const bucket = emptyBucket()
    applyTrade(bucket, trade('B', 100, 1, ['0xother', WHALE.toUpperCase()]), whales)
    expect(bucket.whaleBuyUsd).toBe(100)
  })

  it('чужая сделка не попадает в китовый объём', () => {
    const bucket = emptyBucket()
    applyTrade(bucket, trade('B', 100, 1, ['0xother']), whales)
    expect(bucket.whaleBuyUsd).toBe(0)
    expect(bucket.buyUsd).toBe(100)
  })

  it('строка архива — плоский массив в известном порядке', () => {
    const bucket = emptyBucket()
    applyTrade(bucket, trade('A', 96.5, 2), whales)
    bucket.bidUsd = 314_434
    bucket.askUsd = 901_066
    bucket.bestBid = 96.496
    bucket.bestAsk = 96.497
    expect(serialize(1700, bucket)).toEqual([1700, 0, 193, 1, 96.5, 0, 0, 314_434, 901_066, 96.496, 96.497])
  })
})

describe('уникальность строк архива', () => {
  // Дефект, пойманный первым же прогоном: сделка с отставшей биржевой меткой
  // попадала в уже сброшенную корзину и рождала вторую строку на ту же секунду,
  // причём без стакана. Разбор через месяц принял бы это за пропажу стакана.
  it('поздняя сделка не открывает вторую корзину на ту же секунду', async () => {
    const { FlowRecorder } = await import('./ws.js')
    let clock = 1_000_000
    const recorder = new FlowRecorder([], new Set(), () => clock)
    const keyOf = (r: unknown): string[] =>
      [...(r as { buckets: Map<string, unknown> }).buckets.keys()]
    const handle = (r: unknown, msg: unknown): void =>
      (r as { handle: (m: unknown) => void }).handle(msg)

    handle(recorder, { channel: 'trades', data: [{ coin: 'SOL', side: 'B', px: '1', sz: '1', time: clock }] })
    clock += 25_000
    // метка биржи из прошлого — корзина всё равно должна быть текущей
    handle(recorder, { channel: 'trades', data: [{ coin: 'SOL', side: 'B', px: '1', sz: '1', time: clock - 25_000 }] })

    const keys = keyOf(recorder)
    expect(keys).toEqual(['SOL|100', 'SOL|102'])
  })
})
