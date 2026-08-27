import { describe, expect, it } from 'vitest'
import type { AssetCtx, Candle } from '../hl.js'
import type { ArchiveView, Snapshot, WhaleFlow } from './archive.js'
import {
  breakoutMetric,
  fundingMetric,
  impulseMetric,
  metricsFor,
  oiRegimeMetric,
  rvolMetric,
  squeezeMetric,
  strengthMetric,
  whaleFlowMetric,
  type MetricInput,
} from './metrics.js'

// --- строительные леса -------------------------------------------------------

const BAR_SEC = 900
/** Полуразмах бара на ровном фоне: ATR получается 0.2 и не равен нулю. */
const SPREAD = 0.1

/** Свечи из ряда закрытий. Фон ровный, поэтому видно только то, что задано специально. */
const barsFrom = (closes: readonly number[]): Candle[] =>
  closes.map((c, i) => ({ t: i * BAR_SEC, o: c, h: c + SPREAD, l: c - SPREAD, c, v: 1, n: 1 }))

const flat = (count: number, price = 100): Candle[] => barsFrom(Array<number>(count).fill(price))

const ctxOf = (over: Partial<AssetCtx> = {}): AssetCtx => ({
  coin: 'SOL',
  funding: 0.0000125,
  openInterest: 1000,
  dayNtlVlm: 100_000_000,
  markPx: 100,
  prevDayPx: 100,
  ...over,
})

const snap = (coin: string, row: readonly [number, number, number, number]): Snapshot =>
  ({ t: 0, coins: { [coin]: row } })

/** Архив, в котором ещё ничего нет: 22 часа записи — реальный замер на 27.08.2026. */
const emptyArchive = (coverageHours = 22): ArchiveView => ({
  coverageHours,
  snapshots: [],
  at: () => null,
})

/** Архив, отвечающий только на заранее заданные глубины в минутах. */
const archiveAt = (byMinutes: Record<number, Snapshot>, coverageHours = 100): ArchiveView => ({
  coverageHours,
  snapshots: Object.values(byMinutes),
  at: (minutesAgo: number) => byMinutes[minutesAgo] ?? null,
})

const inputOf = (over: Partial<MetricInput> = {}): MetricInput => ({
  coin: 'SOL',
  bars: flat(200),
  ctx: ctxOf(),
  archive: emptyArchive(),
  btcBars: flat(200, 60_000),
  universeMedian1h: 0,
  whales: null,
  ...over,
})

/** Разворачивает число из метрики: если метрика промолчала, тест должен упасть здесь. */
const num = (value: number | null): number => {
  if (value === null) throw new Error('ожидалось число, а метрика промолчала')
  return value
}

const whales = (over: Partial<WhaleFlow> = {}): WhaleFlow => ({ m15: 0, h1: 0, h4: 0, ...over })

// --- 1. rvol -----------------------------------------------------------------

describe('rvol', () => {
  it('молчит всегда: медианы по бакету «день недели × час» взять неоткуда', () => {
    const metric = rvolMetric(inputOf())
    expect(metric.value).toBeNull()
    expect(metric.score).toBeNull()
  })

  it('называет, сколько архива есть, а не подставляет число вместо него', () => {
    const metric = rvolMetric(inputOf({ archive: emptyArchive(22) }))
    expect(metric.text).toContain('архив')
    expect(metric.text).toContain('22.0 ч')
  })
})

// --- 2. impulse --------------------------------------------------------------

describe('impulse', () => {
  it('видит рывок: ход за час больше трёх ATR', () => {
    const metric = impulseMetric(inputOf({ bars: barsFrom([...Array<number>(199).fill(100), 101]) }))
    expect(num(metric.value)).toBeGreaterThan(3)
    expect(num(metric.score)).toBeGreaterThan(0.8)
  })

  it('на ровном рынке ход нулевой и в скор ничего не даёт', () => {
    const metric = impulseMetric(inputOf({ bars: flat(200) }))
    expect(num(metric.value)).toBe(0)
    expect(num(metric.score)).toBe(0)
  })

  it('ход меньше полутора ATR событием не считает', () => {
    // +0.2 на ATR 0.2 с небольшой поправкой на удлинившийся последний бар — около 1 ATR.
    const metric = impulseMetric(inputOf({ bars: barsFrom([...Array<number>(199).fill(100), 100.2]) }))
    expect(num(metric.value)).toBeLessThan(1.5)
    expect(num(metric.score)).toBe(0)
  })

  it('на коротком ряде молчит, а не считает ATR по трём барам', () => {
    const metric = impulseMetric(inputOf({ bars: flat(6) }))
    expect(metric.value).toBeNull()
    expect(metric.text).toContain('мало баров')
  })
})

// --- 3. breakout -------------------------------------------------------------

describe('breakout', () => {
  it('меряет заход за экстремум сорока баров в ATR', () => {
    const metric = breakoutMetric(inputOf({ bars: barsFrom([...Array<number>(199).fill(100), 101]) }))
    expect(num(metric.value)).toBeGreaterThan(1)
    expect(num(metric.score)).toBe(1)
    expect(metric.text).toContain('пробой вверх')
  })

  it('пробой вниз даёт отрицательное значение и положительный скор', () => {
    const metric = breakoutMetric(inputOf({ bars: barsFrom([...Array<number>(199).fill(100), 99]) }))
    expect(num(metric.value)).toBeLessThan(-1)
    expect(num(metric.score)).toBe(1)
    expect(metric.text).toContain('пробой вниз')
  })

  it('без пробоя это ноль, а не молчание: данные есть, события нет', () => {
    const metric = breakoutMetric(inputOf({ bars: flat(200) }))
    expect(metric.value).toBe(0)
    expect(metric.score).toBe(0)
    expect(metric.text).toContain('пробоя нет')
  })

  it('на сорока барах молчит: диапазон, из которого выходить, ещё не набран', () => {
    const metric = breakoutMetric(inputOf({ bars: flat(40) }))
    expect(metric.value).toBeNull()
    expect(metric.text).toContain('мало баров')
  })
})

// --- 4. squeeze --------------------------------------------------------------

/** Дёрганый участок: доходности ±3% через бар. */
const wild = (count: number, price = 100): number[] =>
  Array.from({ length: count }, (_, i) => (i % 2 === 0 ? price : price * 1.03))

describe('squeeze', () => {
  it('видит сжатие: свежая волатильность на дне распределения', () => {
    const closes = [...wild(150), ...Array<number>(50).fill(100)]
    const metric = squeezeMetric(inputOf({ bars: barsFrom(closes) }))
    expect(num(metric.value)).toBeLessThan(20)
    expect(num(metric.score)).toBeGreaterThan(0)
    expect(metric.text).toContain('сжатие')
  })

  it('на разгоне волатильности сжатия нет и скор нулевой', () => {
    const closes = [...Array<number>(150).fill(100), ...wild(50)]
    const metric = squeezeMetric(inputOf({ bars: barsFrom(closes) }))
    expect(num(metric.value)).toBeGreaterThan(20)
    expect(num(metric.score)).toBe(0)
    expect(metric.text).toContain('сжатия нет')
  })

  it('без распределения молчит: перцентиль по десятку окон ничего не значит', () => {
    const metric = squeezeMetric(inputOf({ bars: flat(30) }))
    expect(metric.value).toBeNull()
    expect(metric.score).toBeNull()
    expect(metric.text).toContain('мало баров')
  })
})

// --- 5. oiRegime -------------------------------------------------------------

describe('oiRegime', () => {
  it('цена вверх и открытый интерес вверх — набор лонгов', () => {
    const metric = oiRegimeMetric(inputOf({
      ctx: ctxOf({ markPx: 105, openInterest: 1150 }),
      archive: archiveAt({ 60: snap('SOL', [100, 0.0000125, 1000, 1e8]) }),
    }))
    expect(num(metric.value)).toBeCloseTo(0.15, 6)
    expect(num(metric.score)).toBe(1)
    expect(metric.text).toContain('набор лонгов')
  })

  it('цена вниз и открытый интерес вверх — набор шортов', () => {
    const metric = oiRegimeMetric(inputOf({
      ctx: ctxOf({ markPx: 95, openInterest: 1150 }),
      archive: archiveAt({ 60: snap('SOL', [100, 0.0000125, 1000, 1e8]) }),
    }))
    expect(metric.text).toContain('набор шортов')
  })

  it('цена вверх и открытый интерес вниз — закрытие шортов', () => {
    const metric = oiRegimeMetric(inputOf({
      ctx: ctxOf({ markPx: 105, openInterest: 850 }),
      archive: archiveAt({ 60: snap('SOL', [100, 0.0000125, 1000, 1e8]) }),
    }))
    expect(metric.text).toContain('закрытие шортов')
  })

  it('шевеление открытого интереса на полпроцента событием не считает', () => {
    const metric = oiRegimeMetric(inputOf({
      ctx: ctxOf({ markPx: 100.1, openInterest: 1005 }),
      archive: archiveAt({ 60: snap('SOL', [100, 0.0000125, 1000, 1e8]) }),
    }))
    expect(num(metric.value)).toBeCloseTo(0.005, 6)
    expect(num(metric.score)).toBe(0)
  })

  it('без часа архива молчит и говорит, сколько архива есть', () => {
    const metric = oiRegimeMetric(inputOf({ archive: emptyArchive(22) }))
    expect(metric.value).toBeNull()
    expect(metric.score).toBeNull()
    expect(metric.text).toContain('архив')
    expect(metric.text).toContain('22.0 ч')
  })

  it('молчит, если монеты не было в снимке часовой давности', () => {
    const metric = oiRegimeMetric(inputOf({
      archive: archiveAt({ 60: snap('BTC', [60000, 0.0000125, 10, 1e9]) }),
    }))
    expect(metric.value).toBeNull()
  })
})

// --- 6. funding --------------------------------------------------------------

describe('funding', () => {
  it('перекос в восемь базовых ставок — событие', () => {
    const metric = fundingMetric(inputOf({ ctx: ctxOf({ funding: 0.0001 }) }))
    expect(num(metric.value)).toBeCloseTo(0.0001, 9)
    expect(num(metric.score)).toBeCloseTo((8 - 3) / (10 - 3), 3)
  })

  it('ставка на уровне базы событием не считается', () => {
    const metric = fundingMetric(inputOf({ ctx: ctxOf({ funding: 0.0000125 }) }))
    expect(num(metric.score)).toBe(0)
  })

  it('честно говорит, что сравнивает с базой биржи, а не с историей монеты', () => {
    const metric = fundingMetric(inputOf({ ctx: ctxOf({ funding: 0.0001 }) }))
    expect(metric.text).toContain('с базой')
    expect(metric.text).toContain('не с историей монеты')
  })

  it('уровень ставки известен всегда, молчит только про изменение за 4 часа', () => {
    const metric = fundingMetric(inputOf({ ctx: ctxOf({ funding: 0.0001 }), archive: emptyArchive(22) }))
    expect(metric.value).not.toBeNull()
    expect(metric.text).toContain('нужен архив')
  })

  it('с архивом за 4 часа показывает ход ставки в пунктах', () => {
    const metric = fundingMetric(inputOf({
      ctx: ctxOf({ funding: 0.0001 }),
      archive: archiveAt({ 240: snap('SOL', [100, 0.00002, 1000, 1e8]) }),
    }))
    expect(metric.text).toContain('за 4 ч')
    expect(metric.text).toContain('+0.0080 п.п.')
  })
})

// --- 7. strength -------------------------------------------------------------

describe('strength', () => {
  it('монета, ушедшая на пять пунктов от BTC за час, — событие', () => {
    const bars = barsFrom([...Array<number>(196).fill(100), 101, 102, 103, 105])
    const metric = strengthMetric(inputOf({ bars }))
    expect(num(metric.value)).toBeCloseTo(5, 6)
    expect(num(metric.score)).toBe(1)
    expect(metric.text).toContain('к BTC')
  })

  it('движение вместе с BTC событием не считает: отрыва нет', () => {
    const bars = barsFrom([...Array<number>(196).fill(100), 101, 102, 103, 105])
    const btcBars = barsFrom([...Array<number>(196).fill(1000), 1010, 1020, 1030, 1050])
    const metric = strengthMetric(inputOf({ bars, btcBars, universeMedian1h: 0.05 }))
    expect(num(metric.value)).toBeCloseTo(0, 6)
    expect(num(metric.score)).toBe(0)
  })

  it('сравнивает и с медианой рынка, а не только с BTC', () => {
    const bars = barsFrom([...Array<number>(196).fill(100), 101, 102, 103, 105])
    const metric = strengthMetric(inputOf({ bars, universeMedian1h: 0.01 }))
    expect(metric.text).toContain('к медиане рынка')
    expect(metric.text).toContain('+4.0 п.п. к медиане рынка')
  })

  it('на коротком ряде молчит', () => {
    const metric = strengthMetric(inputOf({ bars: flat(3) }))
    expect(metric.value).toBeNull()
    expect(metric.score).toBeNull()
  })
})

// --- 8. whaleFlow ------------------------------------------------------------

describe('whaleFlow', () => {
  it('три процента суточного оборота китовыми деньгами за час — событие', () => {
    const metric = whaleFlowMetric(inputOf({ whales: whales({ h1: 3_000_000, m15: 1_000_000 }) }))
    expect(num(metric.value)).toBeCloseTo(0.03, 6)
    expect(num(metric.score)).toBe(1)
  })

  it('отток китов тоже событие: знак сохраняется, скор берётся по модулю', () => {
    const metric = whaleFlowMetric(inputOf({ whales: whales({ h1: -3_000_000 }) }))
    expect(num(metric.value)).toBeLessThan(0)
    expect(num(metric.score)).toBe(1)
  })

  it('поток в десятую процента оборота событием не считает', () => {
    const metric = whaleFlowMetric(inputOf({ whales: whales({ h1: 100_000 }) }))
    expect(num(metric.value)).toBeCloseTo(0.001, 6)
    expect(num(metric.score)).toBe(0)
  })

  it('без китового архива молчит', () => {
    const metric = whaleFlowMetric(inputOf({ whales: null }))
    expect(metric.value).toBeNull()
    expect(metric.score).toBeNull()
    expect(metric.text).toContain('архив')
  })

  it('без суточного оборота молчит: относить приток не к чему', () => {
    const metric = whaleFlowMetric(inputOf({
      ctx: ctxOf({ dayNtlVlm: 0 }),
      whales: whales({ h1: 3_000_000 }),
    }))
    expect(metric.value).toBeNull()
  })
})

// --- сборка ------------------------------------------------------------------

describe('metricsFor', () => {
  it('отдаёт все восемь метрик в стабильном порядке', () => {
    const keys = metricsFor(inputOf()).map((metric) => metric.key)
    expect(keys).toEqual([
      'rvol', 'impulse', 'breakout', 'squeeze', 'oiRegime', 'funding', 'strength', 'whaleFlow',
    ])
  })

  it('молчащая метрика не даёт скор: value и score равны null вместе', () => {
    for (const metric of metricsFor(inputOf({ bars: flat(10), whales: null }))) {
      if (metric.value === null) expect(metric.score).toBeNull()
      else expect(metric.score).not.toBeNull()
    }
  })

  it('в тексте молчащей метрики стоит причина, а не выдуманное число', () => {
    const silent = metricsFor(inputOf({ archive: emptyArchive(22) })).filter((m) => m.value === null)
    expect(silent.length).toBeGreaterThan(0)
    for (const metric of silent) {
      expect(metric.text).toMatch(/архив|мало баров|оборот/)
    }
  })

  it('на пустом архиве молчат ровно rvol, oiRegime и whaleFlow — остальные считаются', () => {
    const silent = metricsFor(inputOf({ archive: emptyArchive(22) }))
      .filter((metric) => metric.value === null)
      .map((metric) => metric.key)
    expect(silent).toEqual(['rvol', 'oiRegime', 'whaleFlow'])
  })
})
