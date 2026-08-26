import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Candle } from '../hl.js'
import { atr } from './stats.js'
import { swingHighs, swingLows } from './swings.js'
import { fairValueGaps, findZones, orderBlocks } from './zones.js'
import { liquidityPools } from './liquidity.js'
import { MAX_PER_KIND, NEAR_ATR, selectZones } from './relevance.js'
import { markup } from './index.js'

const bar = (o: number, h: number, l: number, c: number, t = 0): Candle => ({ t, o, h, l, c, v: 1, n: 1 })
/** Ровный фон, на котором видно только то, что мы поставили специально. */
const flat = (count: number, price = 100): Candle[] =>
  Array.from({ length: count }, (_, i) => bar(price, price + 0.1, price - 0.1, price, i))

const FIXTURE: Candle[] = JSON.parse(readFileSync(new URL('./fixtures/sol-15m.json', import.meta.url), 'utf8'))

describe('ATR', () => {
  it('считает средний ход бара, а не разброс цен', () => {
    expect(atr(flat(20))).toBeCloseTo(0.2, 5)
  })

  it('на пустом входе не падает и не выдумывает', () => {
    expect(atr([])).toBe(0)
  })
})

describe('свинги', () => {
  it('находит вершину, которая выше соседей с обеих сторон', () => {
    const bars = flat(11)
    bars[5] = bar(100, 105, 99.9, 100, 5)
    expect(swingHighs(bars, 2)).toEqual([5])
  })

  it('не считает свингом край выборки — справа ещё нет подтверждения', () => {
    const bars = flat(6)
    bars[5] = bar(100, 105, 99.9, 100, 5)
    expect(swingHighs(bars, 2)).toEqual([])
  })

  it('минимум и максимум ищутся независимо', () => {
    const bars = flat(11)
    bars[4] = bar(100, 100.1, 95, 100, 4)
    expect(swingLows(bars, 2)).toEqual([4])
    expect(swingHighs(bars, 2)).not.toContain(4)
  })
})

describe('разрывы', () => {
  it('видит непройденную цену между первым и третьим баром', () => {
    const bars = flat(10)
    bars[4] = bar(100, 100.2, 99.8, 100, 4)
    bars[5] = bar(100, 103, 100.2, 103, 5)
    bars[6] = bar(103, 103.5, 102, 103, 6)
    for (let i = 7; i < 10; i += 1) bars[i] = bar(103, 103.5, 102.5, 103, i)
    // ATR подобран так, чтобы порог отсёк мелкий побочный разрыв и оставил целевой
    const gaps = fairValueGaps(bars, 0.5)
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ kind: 'FVG', dir: 'up', lo: 100.2, hi: 102 })
  })

  it('слишком мелкий разрыв не зона, а щель между барами', () => {
    const bars = flat(10)
    bars[4] = bar(100, 100.2, 99.8, 100, 4)
    bars[5] = bar(100, 100.5, 100.2, 100.4, 5)
    bars[6] = bar(100.4, 100.6, 100.25, 100.5, 6)
    expect(fairValueGaps(bars, 5)).toEqual([])
  })

  it('пробитый насквозь разрыв переворачивается, а не исчезает', () => {
    const bars = flat(12)
    bars[3] = bar(100, 100.2, 99.8, 100, 3)
    bars[4] = bar(100, 103, 100.2, 103, 4)
    bars[5] = bar(103, 103.5, 102, 103, 5)
    for (let i = 6; i < 12; i += 1) bars[i] = bar(99, 99.5, 98.5, 99, i) // ушли ниже и остались там
    const gaps = fairValueGaps(bars, 0.2)
    expect(gaps.map((zone) => zone.kind)).toContain('IFVG')
  })
})

describe('ордер-блоки', () => {
  const impulse = (): Candle[] => {
    const bars = flat(14, 100)
    bars[8] = bar(100, 100.1, 99.5, 99.6, 8)      // последняя медвежья перед рывком
    bars[9] = bar(99.6, 104, 99.5, 103.9, 9)      // импульс
    for (let i = 10; i < 14; i += 1) bars[i] = bar(104, 104.5, 103.5, 104, i)
    return bars
  }

  it('ставится, когда импульс сломал предыдущий максимум', () => {
    const bars = impulse()
    bars[3] = bar(100, 101, 99.9, 100.5, 3) // свинг-максимум, который потом сломают
    const blocks = orderBlocks(bars, 0.3)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'OB', dir: 'up', from: 8 })
  })

  it('без слома структуры блока нет — это просто свеча перед движением', () => {
    const bars = impulse()
    bars[3] = bar(100, 120, 99.9, 100.5, 3) // максимум остался непробитым
    expect(orderBlocks(bars, 0.3)).toEqual([])
  })
})

describe('пулы ликвидности', () => {
  it('слепляет равные минимумы в один уровень', () => {
    const bars = flat(20, 100)
    bars[4] = bar(100, 100.1, 98, 100, 4)
    bars[10] = bar(100, 100.1, 98.02, 100, 10)
    const pools = liquidityPools(bars, 0.2).filter((line) => line.kind === 'SSL')
    expect(pools).toHaveLength(1)
    expect(pools[0]?.touches).toBe(2)
    expect(pools[0]?.price).toBeCloseTo(98.01, 2)
  })

  it('снятый пул не показывается — он уже отработал', () => {
    const bars = flat(20, 100)
    bars[4] = bar(100, 100.1, 98, 100, 4)
    bars[10] = bar(100, 100.1, 98.02, 100, 10)
    bars[15] = bar(100, 100.1, 97, 100, 15) // сходили ниже
    expect(liquidityPools(bars, 0.2).filter((line) => line.kind === 'SSL')).toEqual([])
  })
})

describe('отбор релевантности', () => {
  it('на живом отрезке отсекает подавляющее большинство зон', () => {
    const atrValue = atr(FIXTURE)
    const raw = findZones(FIXTURE, atrValue)
    const price = FIXTURE.at(-1)?.c ?? 0
    const selected = selectZones(raw, price, atrValue)
    // Ровно та причина, по которой отбор вообще написан: сырой прогон нечитаем.
    expect(raw.length).toBeGreaterThan(30)
    expect(selected.length).toBeLessThanOrEqual(6)
  })

  it('не пускает больше двух зон одного типа', () => {
    const atrValue = atr(FIXTURE)
    const selected = selectZones(findZones(FIXTURE, atrValue), FIXTURE.at(-1)?.c ?? 0, atrValue)
    for (const kind of ['FVG', 'IFVG', 'OB'] as const) {
      expect(selected.filter((zone) => zone.kind === kind).length).toBeLessThanOrEqual(MAX_PER_KIND)
    }
  })

  it('не пускает зоны дальше порога от цены', () => {
    const atrValue = atr(FIXTURE)
    const price = FIXTURE.at(-1)?.c ?? 0
    const selected = selectZones(findZones(FIXTURE, atrValue), price, atrValue)
    for (const zone of selected) {
      const distance = Math.min(Math.abs(zone.lo - price), Math.abs(zone.hi - price))
      expect(distance).toBeLessThanOrEqual(NEAR_ATR * atrValue)
    }
  })
})

describe('разметка зафиксированного отрезка SOL 15m', () => {
  // Отрезок заморожен нарочно: тест не должен зависеть от того, что рынок
  // делает прямо сейчас. Числа сверены глазами с графиком 27.08.2026.
  it('даёт ту же разметку, что и при ручной сверке', () => {
    const result = markup(FIXTURE)
    expect(result.price).toBeCloseTo(96.641, 3)
    expect(result.zones.map((zone) => [zone.kind, zone.lo.toFixed(2), zone.hi.toFixed(2)])).toEqual([
      ['FVG', '97.98', '98.27'],
      ['OB', '95.46', '96.03'],
      ['FVG', '96.06', '96.33'],
      ['IFVG', '96.37', '96.91'],
    ])
    expect(result.lines.map((line) => [line.kind, line.price.toFixed(2)])).toEqual([
      ['BSL', '97.53'],
      ['BSL', '97.26'],
      ['BSL', '96.99'],
      ['SSL', '95.44'],
    ])
  })

  it('границы прошлых суток попадают в разметку, когда их передали', () => {
    const previousDay: Candle = { t: 0, o: 97, h: 99.08, l: 93.26, c: 96, v: 1, n: 1 }
    const result = markup(FIXTURE, previousDay)
    expect(result.lines.some((line) => line.kind === 'PDH' && line.price === 99.08)).toBe(false) // дальше порога
    const wide = markup(FIXTURE, { ...previousDay, h: 97.9, l: 95.2 })
    expect(wide.lines.filter((line) => line.kind === 'PDH' || line.kind === 'PDL')).toHaveLength(2)
  })
})
