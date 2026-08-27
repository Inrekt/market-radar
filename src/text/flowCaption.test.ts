import { describe, expect, it } from 'vitest'
import type { Book } from '../hl.js'
import type { BigPrint, FlowBucket, FlowSummary } from '../flow/summary.js'
import { longFlowCaption, shortFlowCaption } from './flowCaption.js'
import { summarize } from '../flow/summary.js'

// Сводки собраны руками, а не из архива: проверяем текст подписи, а не читалку ndjson.
// Все суммы круглые, чтобы доли («половина дельты») сходились в уме.

const bucket = (t: number, buyUsd: number, sellUsd: number, over: Partial<FlowBucket> = {}): FlowBucket => ({
  t, buyUsd, sellUsd, trades: 20, px: 97, whaleBuyUsd: 0, whaleSellUsd: 0,
  bidUsd: 40_000, askUsd: 30_000, bestBid: 96.99, bestAsk: 97.01, ...over,
})

const print = (usd: number, side: BigPrint['side'], over: Partial<BigPrint> = {}): BigPrint =>
  ({ t: 1_756_300_000_000, px: 97.05, usd, side, whale: false, ...over })

const BOOK: Book = {
  t: 1_756_300_000_000,
  bids: [
    { px: 96.99, usd: 210_000, orders: 4 },
    { px: 96.98, usd: 90_000, orders: 1 },
    { px: 96.97, usd: 40_000, orders: 7 },
  ],
  asks: [
    { px: 97.01, usd: 120_000, orders: 2 },
    { px: 97.02, usd: 60_000, orders: 3 },
  ],
}

// Дельта +$800K складывается из четырёх ровных корзин, ни одна не тянет больше четверти.
const BUCKETS: FlowBucket[] = [
  bucket(1_756_300_000, 800_000, 600_000),
  bucket(1_756_300_010, 700_000, 500_000),
  bucket(1_756_300_020, 900_000, 700_000),
  bucket(1_756_300_030, 700_000, 500_000),
]

const summary = (over: Partial<FlowSummary> = {}): FlowSummary => ({
  coin: 'SOL',
  coveredMinutes: 42,
  buckets: BUCKETS,
  big: [print(180_000, 'B', { whale: true }), print(120_000, 'A', { px: 96.9 }), print(90_000, 'B')],
  book: BOOK,
  buyUsd: 3_100_000, sellUsd: 2_300_000, deltaUsd: 800_000,
  trades: 1240, tradesPerMinute: 29.5,
  whaleBuyUsd: 1_200_000, whaleSellUsd: 300_000,
  cvd: [200_000, 400_000, 600_000, 800_000],
  bidUsd: 410_000, askUsd: 260_000, bookRatio: 410_000 / 260_000,
  firstPx: 96.2, lastPx: 97.1,
  ...over,
})

/** Регистратор подняли только что: всё по нулям, стакан ещё не снят. */
const EMPTY: FlowSummary = {
  coin: 'SOL', coveredMinutes: 0, buckets: [], big: [], book: null,
  buyUsd: 0, sellUsd: 0, deltaUsd: 0, trades: 0, tradesPerMinute: 0,
  whaleBuyUsd: 0, whaleSellUsd: 0, cvd: [], bidUsd: 0, askUsd: 0, bookRatio: null,
  firstPx: 0, lastPx: 0,
}

const both = (input: FlowSummary): string[] => [shortFlowCaption(input), longFlowCaption(input)]

describe('пустая и битая сводка', () => {
  it('не печатает NaN, undefined и Infinity', () => {
    for (const caption of both(EMPTY)) {
      expect(caption).not.toMatch(/NaN|undefined|Infinity|null/)
      expect(caption.length).toBeGreaterThan(0)
    }
  })

  it('на нулях всё равно печатает числа, а не прячет их', () => {
    expect(shortFlowCaption(EMPTY)).toContain('Сделок 0')
    expect(shortFlowCaption(EMPTY)).toContain('$0')
  })

  it('гасит нечисла, пришедшие из сводки', () => {
    const broken = summary({
      deltaUsd: Number.NaN, tradesPerMinute: Number.POSITIVE_INFINITY,
      buyUsd: Number.NaN, firstPx: 0, lastPx: Number.NaN, bookRatio: Number.NaN,
    })
    for (const caption of both(broken)) {
      expect(caption).not.toMatch(/NaN|undefined|Infinity/)
    }
  })

  it('мусорная метка времени не роняет подпись', () => {
    const broken = summary({ big: [print(50_000, 'B', { t: 1e18 })] })
    expect(() => longFlowCaption(broken)).not.toThrow()
    expect(longFlowCaption(broken)).not.toMatch(/NaN|Invalid/)
  })
})

describe('покрытие записи', () => {
  it('первой строкой даёт монету и минуты записи', () => {
    for (const caption of both(summary())) {
      expect(caption.split('\n')[0]).toBe('SOL · записи 42 минуты')
    }
  })

  it('при короткой записи обе подписи начинаются с предупреждения и всё равно печатают минуты', () => {
    for (const caption of both(summary({ coveredMinutes: 4 }))) {
      const first = caption.split('\n')[0] ?? ''
      expect(first).toContain('предварительные')
      expect(first).toContain('4 минуты')
    }
  })

  it('на длинной записи предупреждения нет', () => {
    for (const caption of both(summary({ coveredMinutes: 42 }))) {
      expect(caption.split('\n')[0]).not.toContain('предварительные')
    }
    // Ровно на пороге запись считается достаточной.
    expect(shortFlowCaption(summary({ coveredMinutes: 10 }))).not.toContain('предварительные')
    expect(shortFlowCaption(summary({ coveredMinutes: 9.9 }))).toContain('предварительные')
  })

  it('склоняет минуты по-русски', () => {
    expect(shortFlowCaption(summary({ coveredMinutes: 21 }))).toContain('записи 21 минута')
    expect(shortFlowCaption(summary({ coveredMinutes: 42 }))).toContain('записи 42 минуты')
    expect(shortFlowCaption(summary({ coveredMinutes: 11 }))).toContain('записи 11 минут')
    expect(shortFlowCaption(summary({ coveredMinutes: 1 }))).toContain('всего 1 минута')
  })
})

describe('дельта словами', () => {
  it('положительная дельта — давит покупатель', () => {
    const caption = shortFlowCaption(summary({ buyUsd: 3_100_000, sellUsd: 2_300_000, deltaUsd: 800_000 }))
    expect(caption).toContain('дельта +$800 000 — давит покупатель')
    expect(caption).not.toContain('давит продавец')
  })

  it('отрицательная дельта — давит продавец', () => {
    const caption = shortFlowCaption(summary({ buyUsd: 2_300_000, sellUsd: 3_100_000, deltaUsd: -800_000 }))
    expect(caption).toContain('дельта -$800 000 — давит продавец')
    expect(caption).not.toContain('давит покупатель')
  })

  it('нулевая дельта не приписывает никому давления', () => {
    const caption = shortFlowCaption(summary({ buyUsd: 1_000_000, sellUsd: 1_000_000, deltaUsd: 0 }))
    expect(caption).toContain('стороны в равновесии')
    expect(caption).not.toMatch(/давит/)
  })
})

describe('одна корзина вместо потока', () => {
  it('молчит, пока дельта размазана по корзинам', () => {
    expect(shortFlowCaption(summary())).not.toContain('один вынос')
  })

  it('называет долю, когда больше половины дельты пришло одной корзиной', () => {
    // 700K из 800K общей дельты — одна корзина, остальные три её слегка гасят.
    const spike: FlowBucket[] = [
      bucket(1_756_300_000, 750_000, 50_000),
      bucket(1_756_300_010, 500_000, 550_000),
      bucket(1_756_300_020, 500_000, 500_000),
      bucket(1_756_300_030, 500_000, 450_000),
    ]
    const caption = shortFlowCaption(summary({ buckets: spike }))
    expect(caption).toContain('один вынос')
    expect(caption).toMatch(/8[0-9]% дельты дала одна корзина 10 с/)
  })

  it('не делит на ноль при нулевой дельте', () => {
    const caption = shortFlowCaption(summary({ deltaUsd: 0 }))
    expect(caption).not.toContain('один вынос')
    expect(caption).not.toContain('NaN')
  })
})

describe('крупные принты', () => {
  it("сторону 'B' называет покупкой, 'A' — продажей", () => {
    expect(shortFlowCaption(summary({ big: [print(180_000, 'B')] })))
      .toContain('Крупнейший принт: покупка $180 000 по 97.05')
    expect(shortFlowCaption(summary({ big: [print(180_000, 'A')] })))
      .toContain('Крупнейший принт: продажа $180 000 по 97.05')
  })

  it('в краткой подписи берёт самый крупный, а не первый по времени', () => {
    const big = [print(20_000, 'A'), print(500_000, 'B'), print(90_000, 'A')]
    expect(shortFlowCaption(summary({ big }))).toContain('$500 000')
  })

  it('в подробной показывает не больше пяти принтов и помечает китов', () => {
    const big = Array.from({ length: 9 }, (_, i) => print(10_000 * (i + 1), 'B', { whale: i === 8 }))
    const block = longFlowCaption(summary({ big })).split('\n\n').find((b) => b.startsWith('КРУПНЫЕ ПРИНТЫ')) ?? ''
    expect(block.split('\n').length - 1).toBe(5)
    expect(block).toContain('кит')
  })

  it('без принтов раздел просто не появляется', () => {
    expect(longFlowCaption(summary({ big: [] }))).not.toContain('КРУПНЫЕ ПРИНТЫ')
  })
})

describe('стакан', () => {
  it('показывает бид против аска и сторону перекоса', () => {
    const caption = shortFlowCaption(summary())
    expect(caption).toContain('бид $410 000 против аска $260 000')
    expect(caption).toContain('1.58× в бид')
  })

  it('перекос в аск называет аском, а не долей меньше единицы', () => {
    const caption = shortFlowCaption(summary({ bidUsd: 200_000, askUsd: 400_000, bookRatio: 0.5 }))
    expect(caption).toContain('2.00× в аск')
  })

  it('без снимков стакана говорит это прямо', () => {
    expect(shortFlowCaption(EMPTY)).toContain('снимков стакана в окне нет')
  })

  it('в подробной перечисляет плиты с ценой, суммой и числом заявок', () => {
    const block = longFlowCaption(summary()).split('\n\n').find((b) => b.startsWith('СТАКАН')) ?? ''
    expect(block).toContain('96.99')
    expect(block).toContain('$210 000')
    expect(block).toContain('4 заявки')
    expect(block).toContain('1 заявка')
    expect(block).toContain('аск')
  })
})

describe('киты', () => {
  it('печатает деньги с обеих сторон и перевес', () => {
    expect(shortFlowCaption(summary())).toContain('Киты в ленте: купили $1.2M / продали $300 000 · перевес +$900 000')
  })

  it('без китов строки нет', () => {
    expect(shortFlowCaption(summary({ whaleBuyUsd: 0, whaleSellUsd: 0 }))).not.toContain('Киты')
  })
})

describe('форма подписей', () => {
  it('краткая укладывается в 5–8 строк', () => {
    const lines = shortFlowCaption(summary()).split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(5)
    expect(lines.length).toBeLessThanOrEqual(8)
  })

  it('подробная разбирает корзины и диапазон цены за окно', () => {
    const caption = longFlowCaption(summary())
    expect(caption).toContain('4 по 10 с')
    expect(caption).toContain('крупнейшая $1.6M оборота')
    expect(caption).toContain('96.20 → 97.10')
    expect(caption).toContain('+0.9%')
  })

  it('подробная всегда честно очерчивает рамку источника', () => {
    const caption = longFlowCaption(summary())
    expect(caption).toContain('ЧЕГО ЗДЕСЬ НЕТ')
    expect(caption).toContain('20 уровней стакана на сторону')
    expect(caption).toContain('до запуска регистратора')
  })

  it('раздел рамки есть и на пустой сводке', () => {
    expect(longFlowCaption(EMPTY)).toContain('ЧЕГО ЗДЕСЬ НЕТ')
  })
})

describe('время в подписи', () => {
  // Дефект, пойманный на живых данных: время корзины умножалось на тысячу,
  // потому что контракт обещал секунды, а читатель отдаёт миллисекунды. Дата
  // улетала в далёкое будущее, где у ISO-строки другой формат, и в подпись
  // протекал обрывок вида «12T14:20».
  it('время корзины печатается как часы, а не как обрывок даты', () => {
    const at = Date.UTC(2026, 7, 27, 7, 24, 50)
    const bucket = {
      t: at, buyUsd: 0, sellUsd: 500_000, trades: 40, px: 101.3,
      whaleBuyUsd: 0, whaleSellUsd: 0, bidUsd: 0, askUsd: 0, bestBid: 101.29, bestAsk: 101.31,
    }
    const quiet = { ...bucket, t: at - 10_000, sellUsd: 1_000, trades: 2 }
    const text = longFlowCaption(summarize('SOL', [quiet, bucket], [], null))
    expect(text).toContain('07:24:50')
    expect(text).not.toMatch(/\d{2}T\d{2}:\d{2}/)
  })
})
