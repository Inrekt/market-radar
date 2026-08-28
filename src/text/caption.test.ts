import { describe, expect, it } from 'vitest'
import type { AssetCtx } from '../hl.js'
import type { Markup } from '../ta/index.js'
import type { Dir, Line, LineKind, Zone, ZoneKind } from '../ta/types.js'
import { fmtMoney, longCaption, shortCaption, type CaptionInput, type WhaleFlowInput, type WhaleSummary } from './caption.js'

const zone = (kind: ZoneKind, dir: Dir, lo: number, hi: number, mitigated = false): Zone =>
  ({ kind, dir, from: 0, lo, hi, mitigated })
const line = (kind: LineKind, price: number, touches = 0): Line => ({ kind, price, from: 0, touches })

// Разметка собрана руками, а не из фикстуры: проверяем текст, а не детекторы.
// Цена 97.00 стоит между зонами, обе границы дают круглые проценты (-0.7 / +1.1).
const MARKUP: Markup = {
  price: 97,
  atr: 0.42,
  zones: [zone('FVG', 'up', 96.06, 96.33), zone('OB', 'dn', 98.1, 98.4)],
  lines: [line('BSL', 98.8, 3), line('PDH', 99.5), line('SSL', 95.1, 2), line('PDL', 94.6)],
}
// Ставка 0.001% в час — проверяется в уме: ×24×365 даёт 8.76% годовых.
const CTX: AssetCtx = {
  coin: 'SOL', funding: 0.00001, openInterest: 5_200_000,
  dayNtlVlm: 1_240_000_000, markPx: 97, prevDayPx: 95,
}
const WHALES: WhaleSummary = { positions: 12, longUsd: 4_200_000, shortUsd: 1_100_000, avgEntry: 95.8 }
// Поток: свежие 15 минут против четырёхчасового притока — направление берётся
// именно из четырёх часов, и на этих числах видно, что не из пятнадцати минут.
const FLOW: WhaleFlowInput = { m15: -250_000, h1: 1_200_000, h4: 4_800_000 }

const input = (over: Partial<CaptionInput> = {}): CaptionInput =>
  ({ coin: 'SOL', interval: '15m', markup: MARKUP, ctx: CTX, whales: WHALES, ...over })
/** Цена внутри FVG: тот случай, ради которого краткая подпись и заводилась. */
const inside = (): CaptionInput => input({ markup: { ...MARKUP, price: 96.2 } })
const bare = (): CaptionInput => input({ ctx: null, whales: null })
/** Поток есть: поставщик появился и отдал три окна. */
const withFlow = (over: Partial<CaptionInput> = {}): CaptionInput => input({ whaleFlow: FLOW, ...over })

describe('денежный формат', () => {
  it('от миллиона переходит на сокращение', () => {
    expect(fmtMoney(1_500_000)).toBe('$1.5M')
    expect(fmtMoney(501_000_000)).toBe('$501M')
    expect(fmtMoney(1_240_000_000)).toBe('$1.24B')
  })

  it('до миллиона показывает сумму целиком, разряды разделены пробелом', () => {
    expect(fmtMoney(12_500)).toBe('$12 500')
    expect(fmtMoney(850)).toBe('$850')
  })

  it('вместо мусора отдаёт прочерк, а не NaN', () => {
    expect(fmtMoney(Number.NaN)).not.toContain('NaN')
  })
})

describe('краткая подпись', () => {
  it('умещается в восемь строк — дальше её пролистывают', () => {
    expect(shortCaption(input()).split('\n').length).toBeLessThanOrEqual(8)
    expect(shortCaption(input()).split('\n').length).toBeGreaterThanOrEqual(5)
  })

  it('начинается с монеты, таймфрейма и цены', () => {
    const caption = shortCaption(input())
    expect(caption.split('\n')[0]).toMatch(/^SOL · 15m · 97\./)
  })

  it('первым делом сообщает, что цена стоит внутри незакрытой зоны', () => {
    expect(shortCaption(inside()).split('\n')[1]).toContain('Цена внутри FVG + 96.06 — 96.33')
  })

  it('даёт ближайшую зону сверху и снизу с границами', () => {
    const text = shortCaption(input())
    expect(text).toContain('сверху OB − 98.10 — 98.40 (+1.1%)')
    expect(text).toContain('снизу FVG + 96.06 — 96.33 (-0.7%)')
  })

  it('разводит ликвидность на верхнюю и нижнюю', () => {
    expect(shortCaption(input())).toContain('Ликвидность: сверху 98.80 / 99.50 · снизу 95.10 / 94.60')
  })

  it('считает фандинг за час и в год, оборот и открытый интерес в долларах', () => {
    const text = shortCaption(input())
    expect(text).toContain('Фандинг +0.0010%/час (+8.8% годовых)')
    expect(text).toContain('OI $504M · оборот за сутки $1.24B')
  })

  it('по китам называет перевес и средний вход', () => {
    expect(shortCaption(input())).toContain('перевес в лонг $3.1M')
    expect(shortCaption(input())).toContain('средний вход 95.80')
  })

  it('без ctx и whales не падает и не выдумывает эти строки', () => {
    const text = shortCaption(bare())
    expect(text).toContain('97.00')
    expect(text).not.toContain('Фандинг')
    expect(text).not.toContain('OI ')
    expect(text).not.toContain('Киты')
  })

  it('поток китов печатает отдельной строкой: три окна деньгами и направление', () => {
    const text = shortCaption(withFlow())
    expect(text).toContain('Поток китов: 15м -$250 000 · 1ч +$1.2M · 4ч +$4.8M — за 4 часа в лонг')
  })

  it('направление потока берёт из четырёх часов, а не из последних пятнадцати минут', () => {
    const out = shortCaption(withFlow({ whaleFlow: { m15: 900_000, h1: 400_000, h4: -3_000_000 } }))
    expect(out).toContain('4ч -$3M — за 4 часа в шорт')
  })

  it('нулевой поток за четыре часа называет отсутствием китов, а не нейтралитетом', () => {
    expect(shortCaption(withFlow({ whaleFlow: { m15: 0, h1: 0, h4: 0 } }))).toContain('за 4 часа потока нет')
  })

  it('без потока строки о нём нет — ни при отсутствии поля, ни при null', () => {
    expect(shortCaption(input())).not.toContain('Поток китов')
    expect(shortCaption(input({ whaleFlow: null }))).not.toContain('Поток китов')
  })

  it('со всеми данными разом всё равно умещается в восемь строк', () => {
    expect(shortCaption(withFlow({ markup: { ...MARKUP, price: 96.2 } })).split('\n').length).toBeLessThanOrEqual(8)
  })

  it('не оставляет NaN и undefined ни с данными, ни без них', () => {
    for (const text of [shortCaption(input()), shortCaption(bare()), shortCaption(inside()), shortCaption(withFlow())]) {
      expect(text).not.toContain('NaN')
      expect(text).not.toContain('undefined')
    }
  })

  it('все цены имеют одинаковое число знаков после точки', () => {
    const text = shortCaption(input())
    // Разбиваем по строкам и ищем цены (числа с точкой, но не проценты и не комиссии)
    const lines = text.split('\n')
    const pricePattern = /\b\d{2,}\.\d+\b/g // цены обычно 2+ цифры перед точкой
    const allPrices: number[] = []
    for (const line of lines) {
      // Пропускаем строки с денежными суммами и процентами
      if (line.includes('%') || line.includes('$')) continue
      const matches = line.match(pricePattern) || []
      allPrices.push(...matches.map(m => m.split('.')[1]?.length || 0))
    }
    // Если есть цены, проверяем что все имеют одинаковое количество знаков
    if (allPrices.length > 0) {
      const firstDecimals = allPrices[0]
      for (const decimals of allPrices) {
        expect(decimals).toBe(firstDecimals)
      }
    }
  })

  it('не содержит типа зоны IFVG без дефиса и не использует обычный дефис как знак направления', () => {
    const text = shortCaption(input())
    // Проверяем, что нет 'IFVG' без дефиса
    expect(text).not.toContain('IFVG ')
    expect(text).not.toContain('IFVG−')
    expect(text).not.toContain('IFVG+')
    // Проверяем, что используется U+2212 (−) для отрицательного направления, а не дефис (-)
    // Если есть OB с минусом, он должен быть U+2212, а не обычный дефис
    const lines = text.split('\n')
    for (const line of lines) {
      // Если в строке есть ' OB' и '-' на одном из расстояний, проверяем что это U+2212
      if (line.includes(' OB ')) {
        // Ищем знак перед процентом
        const match = line.match(/ (−|−)(-\d+\.\d+%)/g) // U+2212 в качестве знака
        // Не должно быть обычного дефиса как знака направления
        expect(line).not.toMatch(/ OB - /)
      }
    }
  })
})

describe('подробная подпись', () => {
  it('в шапке цена и ATR бара', () => {
    const header = longCaption(input()).split('\n')[0]
    expect(header).toMatch(/^SOL · 15m · 97\.\d+ · ATR бара 0\.\d+$/)
  })

  it('строит таблицу зон: границы, тип со знаком, расстояние', () => {
    const text = longCaption(input())
    expect(text).toContain('FVG +')
    expect(text).toContain('OB −')
    expect(text).toContain('-0.7%')
    expect(text).toContain('+1.1%')
  })

  it('расстояние считается от цены: зона выше — плюс, ниже — минус', () => {
    const text = longCaption(input({ markup: { ...MARKUP, zones: [zone('OB', 'dn', 98.1, 98.4)] } }))
    expect(text).toContain('+1.1%')
    expect(text).not.toContain('-1.1%')
  })

  it('в таблице ликвидности показывает касания только там, где они есть', () => {
    const text = longCaption(input())
    expect(text).toMatch(/98\.80\s+BSL\s+3 касан\.\s+\+1\.9%/)
    expect(text).toMatch(/99\.50\s+PDH\s+\+2\.6%/)
  })

  it('выносит деривативы и китов в отдельные разделы', () => {
    const text = longCaption(input())
    expect(text).toContain('ДЕРИВАТИВЫ')
    expect(text).toContain('КИТЫ')
    expect(text).toContain('перевес в лонг $3.1M')
  })

  it('условия отмены — конкретные цены границ, а не рассуждения', () => {
    const text = longCaption(input())
    expect(text).toContain('ЧТО ОТМЕНЯЕТ КАРТИНУ')
    expect(text).toContain('закрытие бара под 96.06')
    expect(text).toContain('закрытие бара над 98.40')
  })

  it('внутри зоны отменой считает выход за любую её границу', () => {
    expect(longCaption(inside())).toContain('закрытие бара под 96.06 или над 96.33')
  })

  it('без ctx и whales просто не показывает эти разделы', () => {
    const text = longCaption(bare())
    expect(text).toContain('97.00')
    expect(text).toContain('СТРУКТУРА')
    expect(text).not.toContain('ДЕРИВАТИВЫ')
    expect(text).not.toContain('КИТЫ')
  })

  it('на пустой разметке не падает и не печатает пустых таблиц', () => {
    const empty = input({ markup: { price: 97, atr: 0, zones: [], lines: [] }, ctx: null, whales: null })
    const text = longCaption(empty)
    expect(text).toContain('Незакрытых зон рядом с ценой нет')
    expect(text).not.toContain('ЗОНЫ')
    expect(text).not.toContain('ЛИКВИДНОСТЬ')
  })

  it('поток китов идёт отдельным разделом: три окна деньгами и что значит знак', () => {
    const text = longCaption(withFlow())
    expect(text).toContain('ПОТОК КИТОВ')
    expect(text).toMatch(/за 15 минут\s+-\$250 000/)
    expect(text).toMatch(/за час\s+\+\$1\.2M/)
    expect(text).toMatch(/за 4 часа\s+\+\$4\.8M/)
    expect(text).toContain('за 4 часа деньги идут в лонг — набирают лонг или закрывают шорт')
  })

  it('отток за четыре часа объясняет обеими трактовками знака', () => {
    const text = longCaption(withFlow({ whaleFlow: { m15: -100_000, h1: -900_000, h4: -3_000_000 } }))
    expect(text).toContain('за 4 часа деньги идут в шорт — набирают шорт или закрывают лонг')
  })

  it('раздел про поток не выдумывается ни при отсутствии поля, ни при null', () => {
    expect(longCaption(input())).not.toContain('ПОТОК КИТОВ')
    expect(longCaption(input({ whaleFlow: null }))).not.toContain('ПОТОК КИТОВ')
  })

  it('поток печатается и без позиций китов: это разные поставщики', () => {
    const text = longCaption(withFlow({ whales: null }))
    expect(text).not.toContain('\nКИТЫ')
    expect(text).toContain('ПОТОК КИТОВ')
  })

  it('не оставляет NaN и undefined ни с данными, ни без них', () => {
    for (const text of [longCaption(input()), longCaption(bare()), longCaption(inside()), longCaption(withFlow())]) {
      expect(text).not.toContain('NaN')
      expect(text).not.toContain('undefined')
    }
  })
})
