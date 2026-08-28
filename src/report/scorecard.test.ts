import { rm } from 'node:fs/promises'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// STATE_DIR читается один раз при загрузке store/ndjson.js, поэтому подменять его
// надо ДО импортов — иначе тест полез бы в живой журнал проекта и зависел бы от
// того, что сканер записал минуту назад. В сеть не ходим совсем: fetchCandles
// подменён, остальное в hl.js берётся настоящее.
const { STATE_TMP, fetchCandlesMock } = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/market-radar-scorecard-${process.pid}`
  process.env.STATE_DIR = dir
  return { STATE_TMP: dir, fetchCandlesMock: vi.fn() }
})

vi.mock('../hl.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hl.js')>()),
  fetchCandles: fetchCandlesMock,
}))

import type { Candle } from '../hl.js'
import { appendLine, dayFile } from '../store/ndjson.js'
import { buildScorecard, MIN_OBSERVATIONS, renderScorecard, type Horizon, type Scorecard } from './scorecard.js'

const BAR_SEC = 900
const HOUR = 3600

// Полдень UTC: окно в 24 часа заведомо пересекает полночь, как и в жизни.
const NOW_MS = Date.UTC(2026, 7, 27, 12, 0, 0)
const NOW_SEC = NOW_MS / 1000

/** Событие на границе бара — тогда бар нужного горизонта считается в уме. */
function ago(seconds: number): number {
  return Math.floor((NOW_SEC - seconds) / BAR_SEC) * BAR_SEC
}

interface JournalLine {
  readonly t: number
  readonly kind: 'alert' | 'candidate'
  readonly coin: string
  readonly px: number
  readonly top?: readonly string[]
}

async function writeJournal(lines: readonly JournalLine[]): Promise<void> {
  for (const line of lines) {
    await appendLine(dayFile('events', line.t * 1000), { score: 0.4, top: [], ...line })
  }
}

/**
 * Ряд 15m-свечей от firstOpenSec. Бар с индексом i закрывается в
 * firstOpenSec + (i+1)*BAR_SEC, поэтому для события в firstOpenSec горизонту 15м
 * отвечает индекс 0, часу — 3, четырём часам — 15, суткам — 95.
 */
function series(firstOpenSec: number, closes: readonly number[]): Candle[] {
  return closes.map((close, index) => ({
    t: firstOpenSec + index * BAR_SEC, o: close, h: close, l: close, c: close, v: 0, n: 0,
  }))
}

/** Ряд, в котором все бары закрылись по одной цене — когда важен только факт хода. */
function flat(firstOpenSec: number, close: number, bars: number): Candle[] {
  return series(firstOpenSec, Array.from({ length: bars }, () => close))
}

function candles(byCoin: Readonly<Record<string, readonly Candle[]>>): void {
  fetchCandlesMock.mockImplementation(async (coin: string) => byCoin[coin] ?? [])
}

function horizon(card: Scorecard, key: Horizon['key']): Horizon {
  const found = card.horizons.find((item) => item.key === key)
  if (found === undefined) throw new Error(`в табеле нет горизонта ${key}`)
  return found
}

beforeEach(async () => {
  await rm(STATE_TMP, { recursive: true, force: true })
  fetchCandlesMock.mockReset()
  candles({})
})

afterAll(async () => {
  await rm(STATE_TMP, { recursive: true, force: true })
})

describe('горизонт, который ещё не наступил', () => {
  it('даёт null, а не ноль: «не знаем» и «цена простояла» — разные утверждения', async () => {
    const at = ago(30 * 60)
    await writeJournal([{ t: at, kind: 'alert', coin: 'SOL', px: 100 }])
    // Два закрытых бара — до пятнадцати минут дозрело, до часа нет.
    candles({ SOL: series(at, [101, 102]) })

    const card = await buildScorecard(24, NOW_MS)

    expect(horizon(card, '15м').matured).toBe(1)
    expect(horizon(card, '15м').alertMove).toBeCloseTo(1, 6)
    expect(horizon(card, '1ч').matured).toBe(0)
    expect(horizon(card, '1ч').alertMove).toBeNull()
    expect(horizon(card, '1ч').alertMove).not.toBe(0)
    expect(horizon(card, '24ч').alertMove).toBeNull()
  })

  it('не считает баром горизонта свечу за дырой в ряду', async () => {
    const at = ago(2 * HOUR)
    await writeJournal([{ t: at, kind: 'alert', coin: 'SOL', px: 100 }])
    // Бар часа (индекс 3) пропущен, следом сразу бар четвёртого часа: выдать его
    // ход за «час после пинга» было бы враньём.
    candles({ SOL: [...series(at, [101, 102, 103]), ...series(at + 15 * BAR_SEC, [150])] })

    const card = await buildScorecard(24, NOW_MS)

    expect(horizon(card, '15м').matured).toBe(1)
    expect(horizon(card, '1ч').matured).toBe(0)
    expect(horizon(card, '1ч').alertMove).toBeNull()
  })
})

describe('движение считается по модулю', () => {
  it('падение на 5% и рост на 5% дают средний ход 5%, а не ноль', async () => {
    const at = ago(HOUR)
    await writeJournal([
      { t: at, kind: 'alert', coin: 'DOWN', px: 100 },
      { t: at, kind: 'alert', coin: 'UP', px: 100 },
    ])
    candles({ DOWN: flat(at, 95, 4), UP: flat(at, 105, 4) })

    const card = await buildScorecard(24, NOW_MS)

    expect(horizon(card, '15м').matured).toBe(2)
    expect(horizon(card, '15м').alertMove).toBeCloseTo(5, 6)
  })
})

describe('контрольная группа', () => {
  it('считается отдельно от пингов и без их строк-двойников', async () => {
    const at = ago(HOUR)
    await writeJournal([
      // Сканер пишет кандидата ДО решения об отправке — у пинга всегда есть двойник.
      { t: at, kind: 'candidate', coin: 'CHIP', px: 100 },
      { t: at, kind: 'alert', coin: 'CHIP', px: 100 },
      { t: at, kind: 'candidate', coin: 'JUP', px: 100 },
    ])
    candles({ CHIP: flat(at, 110, 4), JUP: flat(at, 102, 4) })

    const card = await buildScorecard(24, NOW_MS)

    expect(card.alerts).toBe(1)
    // Двойник CHIP в контроль не попал: иначе пинг сравнивался бы сам с собой.
    expect(card.candidates).toBe(1)
    expect(horizon(card, '15м').alertMove).toBeCloseTo(10, 6)
    expect(horizon(card, '15м').controlMove).toBeCloseTo(2, 6)
    expect(horizon(card, '15м').controlMatured).toBe(1)
  })

  it('дозревает независимо от пингов', async () => {
    await writeJournal([
      { t: ago(30 * 60), kind: 'alert', coin: 'SOL', px: 100 },
      { t: ago(5 * HOUR), kind: 'candidate', coin: 'JUP', px: 100 },
    ])
    candles({ SOL: flat(ago(30 * 60), 101, 2), JUP: flat(ago(5 * HOUR), 103, 20) })

    const card = await buildScorecard(24, NOW_MS)

    expect(horizon(card, '4ч').matured).toBe(0)
    expect(horizon(card, '4ч').alertMove).toBeNull()
    expect(horizon(card, '4ч').controlMatured).toBe(1)
    expect(horizon(card, '4ч').controlMove).toBeCloseTo(3, 6)
  })
})

describe('окно', () => {
  it('читает оба суточных файла и выбрасывает то, что старше окна', async () => {
    const inside = ago(20 * HOUR) // вчерашний файл по UTC, но внутри окна
    const outside = ago(30 * HOUR)
    await writeJournal([
      { t: inside, kind: 'alert', coin: 'SOL', px: 100 },
      { t: outside, kind: 'alert', coin: 'OLD', px: 100 },
    ])
    candles({ SOL: flat(inside, 104, 8), OLD: flat(outside, 999, 8) })

    const card = await buildScorecard(24, NOW_MS)

    expect(card.alerts).toBe(1)
    expect(horizon(card, '15м').alertMove).toBeCloseTo(4, 6)
  })
})

describe('порог доверия', () => {
  it('признаёт выборку негодной, пока пингов меньше двадцати', async () => {
    const at = ago(HOUR)
    await writeJournal([{ t: at, kind: 'alert', coin: 'SOL', px: 100 }])
    candles({ SOL: flat(at, 101, 4) })

    const card = await buildScorecard(24, NOW_MS)

    expect(card.alerts).toBe(1)
    expect(card.tooFew).toBe(true)
  })

  it('снимает оговорку ровно на MIN_OBSERVATIONS пингах', async () => {
    const at = ago(HOUR)
    const coins = Array.from({ length: MIN_OBSERVATIONS }, (_, index) => `C${index}`)
    await writeJournal(coins.map((coin) => ({ t: at, kind: 'alert' as const, coin, px: 100 })))
    fetchCandlesMock.mockImplementation(async () => flat(at, 101, 4))

    const card = await buildScorecard(24, NOW_MS)

    expect(card.alerts).toBe(MIN_OBSERVATIONS)
    expect(card.tooFew).toBe(false)
  })
})

describe('пустые выборки', () => {
  it('не дают NaN ни в одном среднем', async () => {
    const at = ago(5 * 60)
    await writeJournal([
      { t: at, kind: 'alert', coin: 'SOL', px: 100 },
      { t: at, kind: 'candidate', coin: 'JUP', px: 100 },
    ])
    candles({}) // ни одной свечи: ни один горизонт не дозрел

    const card = await buildScorecard(24, NOW_MS)

    for (const item of card.horizons) {
      expect(item.alertMove).toBeNull()
      expect(item.controlMove).toBeNull()
      expect(item.matured).toBe(0)
      expect(item.controlMatured).toBe(0)
    }
    expect(renderScorecard(card)).not.toContain('NaN')
  })

  it('переживает пустой журнал', async () => {
    const card = await buildScorecard(24, NOW_MS)

    expect(card.alerts).toBe(0)
    expect(card.candidates).toBe(0)
    expect(card.byMetric).toEqual([])
    expect(renderScorecard(card)).not.toContain('NaN')
  })
})

describe('печать', () => {
  it('при нуле пингов не рисует таблицу горизонтов', async () => {
    const at = ago(HOUR)
    await writeJournal([{ t: at, kind: 'candidate', coin: 'JUP', px: 100 }])
    candles({ JUP: flat(at, 102, 4) })

    const card = await buildScorecard(24, NOW_MS)
    const text = renderScorecard(card)

    expect(card.alerts).toBe(0)
    expect(text).toContain('Пингов за окно не было')
    // Таблица из одних прочерков выглядела бы как проделанная работа.
    expect(text).not.toContain('15м')
    expect(text).not.toContain('горизонт')
    expect(text).not.toContain('контроль')
  })

  it('при малой выборке начинается с оговорки, но числа всё равно показывает', async () => {
    const at = ago(HOUR)
    await writeJournal([
      { t: at, kind: 'alert', coin: 'SOL', px: 100, top: ['funding', 'squeeze'] },
      { t: at, kind: 'candidate', coin: 'JUP', px: 100 },
    ])
    candles({ SOL: flat(at, 103, 8), JUP: flat(at, 101, 8) })

    const card = await buildScorecard(24, NOW_MS)
    const text = renderScorecard(card)
    const firstLine = text.split('\n')[0] ?? ''

    expect(card.tooFew).toBe(true)
    expect(firstLine).toContain('мало')
    expect(firstLine).toContain('нельзя')
    expect(firstLine).toContain(String(MIN_OBSERVATIONS))
    // Прятать числа тоже нечестно: и ход пингов, и контроль, и метрики на месте.
    expect(text).toContain('3.0% (1)')
    expect(text).toContain('1.0% (1)')
    expect(text).toContain('funding')
    expect(text).toContain('squeeze')
  })

  it('печатает абсолютный ход без знака направления', async () => {
    const at = ago(HOUR)
    await writeJournal([{ t: at, kind: 'alert', coin: 'SOL', px: 100 }])
    candles({ SOL: flat(at, 95, 8) })

    const card = await buildScorecard(24, NOW_MS)
    const text = renderScorecard(card)

    // «+5.0%» намекало бы на сторону, которой табель не меряет.
    expect(text).toContain('5.0% (1)')
    expect(text).not.toContain('+5.0%')
    expect(text).not.toContain('-5.0%')
  })
})

describe('разбор по метрикам', () => {
  it('считает каждую метрику из top и её ход за час', async () => {
    const at = ago(2 * HOUR)
    await writeJournal([
      { t: at, kind: 'alert', coin: 'A', px: 100, top: ['funding', 'squeeze'] },
      { t: at, kind: 'alert', coin: 'B', px: 100, top: ['funding'] },
    ])
    candles({ A: flat(at, 104, 8), B: flat(at, 102, 8) })

    const card = await buildScorecard(24, NOW_MS)
    const funding = card.byMetric.find((metric) => metric.key === 'funding')
    const squeeze = card.byMetric.find((metric) => metric.key === 'squeeze')

    expect(funding?.alerts).toBe(2)
    expect(funding?.avg1h).toBeCloseTo(3, 6)
    expect(squeeze?.alerts).toBe(1)
    expect(squeeze?.avg1h).toBeCloseTo(4, 6)
  })

  it('не даёт NaN метрике, у которой ни один пинг не дозрел до часа', async () => {
    const at = ago(20 * 60)
    await writeJournal([{ t: at, kind: 'alert', coin: 'SOL', px: 100, top: ['squeeze'] }])
    candles({ SOL: flat(at, 101, 1) })

    const card = await buildScorecard(24, NOW_MS)

    expect(card.byMetric[0]?.key).toBe('squeeze')
    expect(card.byMetric[0]?.alerts).toBe(1)
    expect(card.byMetric[0]?.avg1h).toBeNull()
  })
})

describe('битые строки журнала', () => {
  it('пропускаются, не роняя весь табель', async () => {
    const at = ago(HOUR)
    await writeJournal([{ t: at, kind: 'alert', coin: 'SOL', px: 100 }])
    await appendLine(dayFile('events', at * 1000), { t: at, kind: 'alert', coin: 'BAD' }) // нет px
    candles({ SOL: flat(at, 101, 4) })

    const card = await buildScorecard(24, NOW_MS)

    expect(card.alerts).toBe(1)
  })
})
