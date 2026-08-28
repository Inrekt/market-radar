import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssetCtx } from '../hl.js'

// fetchAssetCtxs — единственный поход дайджеста в сеть. Подменяем его целиком:
// раздел про фандинг должен считаться по срезу, а не по наличию интернета,
// и падение сети обязано гасить раздел, а не весь отчёт.
const net = vi.hoisted(() => ({ ctxs: [] as AssetCtx[], fails: false }))
vi.mock('../hl.js', () => ({
  fetchAssetCtxs: async (): Promise<AssetCtx[]> => {
    if (net.fails) throw new Error('сеть недоступна')
    return net.ctxs
  },
}))

type Coins = Record<string, readonly [number, number, number, number]>

const HOUR_MS = 3_600_000
const NOW_MS = Date.UTC(2026, 7, 28, 6, 0, 0) // 2026-08-28T06:00:00Z
const HOURS = 8 // окно 27-го 22:00 → 28-го 06:00: специально пересекает полночь UTC
const FROM_MS = NOW_MS - HOURS * HOUR_MS
const DAY_FROM = '2026-08-27'
const DAY_NOW = '2026-08-28'
const TITLE = 'Что было ночью'

const LIQUID_VLM = 50_000_000 // выше порога $5M
const THIN_VLM = 1_000_000 // ниже порога: такую монету дайджест ранжировать не должен
const BASE_FUNDING = 0.0000125

// Восемь ликвидных монет, чтобы «впереди» и «позади» не пересекались,
// плюс JUNK — неликвид с самым красивым процентом в файле.
const MOVES: readonly (readonly [string, number])[] = [
  ['AAA', 12],
  ['BBB', 8],
  ['CCC', 5],
  ['DDD', 2],
  ['EEE', -1],
  ['FFF', -4],
  ['GGG', -7],
  ['HHH', -11],
]
const OI_END: Record<string, number> = { AAA: 1340, HHH: 1200 } // +34% и +20%, у остальных без изменений

let dir = ''
let buildDigest: typeof import('./digest.js').buildDigest

async function writeArchive(kind: string, day: string, records: readonly unknown[]): Promise<void> {
  await mkdir(join(dir, kind), { recursive: true })
  await writeFile(join(dir, kind, `${day}.ndjson`), `${records.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8')
}

function snapshot(atMs: number, coins: Coins): unknown {
  return { t: Math.floor(atMs / 1000), coins }
}

function edgeCoins(edge: 'first' | 'last'): Coins {
  const coins: Record<string, readonly [number, number, number, number]> = {}
  for (const [coin, pct] of MOVES) {
    const px = edge === 'first' ? 100 : 100 * (1 + pct / 100)
    const oi = edge === 'first' ? 1000 : (OI_END[coin] ?? 1000)
    coins[coin] = [px, BASE_FUNDING, oi, LIQUID_VLM]
  }
  coins.JUNK = edge === 'first' ? [1, BASE_FUNDING, 1000, THIN_VLM] : [2, BASE_FUNDING, 5000, THIN_VLM]
  return coins
}

/** Базовый архив: снимок до окна (не должен учитываться) + края окна в разных сутках. */
async function writeBaseSeries(): Promise<void> {
  const beforeWindow = snapshot(FROM_MS - HOUR_MS, { AAA: [1000, BASE_FUNDING, 1000, LIQUID_VLM] })
  await writeArchive('series', DAY_FROM, [beforeWindow, snapshot(FROM_MS, edgeCoins('first'))])
  await writeArchive('series', DAY_NOW, [snapshot(NOW_MS, edgeCoins('last'))])
}

function ctx(coin: string, funding: number, dayNtlVlm: number): AssetCtx {
  return { coin, funding, openInterest: 1000, dayNtlVlm, markPx: 100, prevDayPx: 100 }
}

/** Блок отчёта по его заголовку: разделы разделены пустой строкой. */
function sectionOf(text: string, heading: string): string | null {
  return text.split('\n\n').find((block) => block.startsWith(heading)) ?? null
}

function digest(overrides: Partial<{ hours: number; title: string }> = {}) {
  return buildDigest({ hours: overrides.hours ?? HOURS, title: overrides.title ?? TITLE, nowMs: NOW_MS })
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'digest-'))
  process.env.STATE_DIR = dir
  // STATE_DIR читается один раз при импорте store/ndjson.js, поэтому модуль
  // поднимаем только после подмены переменной — иначе тест писал бы в живой архив.
  ;({ buildDigest } = await import('./digest.js'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.STATE_DIR
})

beforeEach(async () => {
  for (const kind of ['series', 'whales', 'events']) {
    await rm(join(dir, kind), { recursive: true, force: true })
  }
  net.ctxs = []
  net.fails = false
})

describe('buildDigest', () => {
  describe('шапка', () => {
    it('печатает заголовок, окно и реальное покрытие архива', async () => {
      await writeBaseSeries()

      const result = await digest()

      expect(result.title).toBe(TITLE)
      expect(result.text.startsWith(`${TITLE}\n`)).toBe(true)
      expect(result.text).toContain('Окно 8 ч: 27.08 22:00 UTC → 28.08 06:00 UTC')
      expect(result.text).toContain('Архив рынка: 8 ч')
    })

    it('говорит прямо, когда архива меньше запрошенного окна', async () => {
      await writeArchive('series', DAY_NOW, [
        snapshot(NOW_MS - 4 * HOUR_MS, edgeCoins('first')),
        snapshot(NOW_MS, edgeCoins('last')),
      ])

      const result = await digest()

      expect(result.coveredHours).toBe(4)
      expect(result.text).toContain('из запрошенных 8 ч')
      expect(result.text).toContain('записано меньше окна')
    })

    it('считает coveredHours по реальному размаху, а не по запрошенным часам', async () => {
      await writeBaseSeries()

      const result = await digest({ hours: 48 })

      // Размах — от края до края ВСЕЙ попавшей в окно записи. При окне в 48 ч
      // в него законно входит и снимок, сделанный до восьмичасового отрезка,
      // поэтому охват на час больше самого отрезка. Это не ошибка счёта, а
      // разница между «запрошено» и «что реально записано».
      expect(result.coveredHours).toBe(HOURS + 1)
    })

    it('признаётся в пропусках: два снимка на восемь часов — это не восемь часов наблюдения', async () => {
      await writeBaseSeries()

      const result = await digest()

      expect(result.text).toContain('В записи пропуски')
      expect(result.text).toContain('снимков 2')
    })

    it('сообщает об отсутствии записи рынка вместо пустых разделов', async () => {
      const result = await digest()

      expect(result.coveredHours).toBe(0)
      expect(result.text).toContain('Записи рынка за это окно нет')
    })
  })

  describe('лидеры и аутсайдеры', () => {
    it('считает движение по краям окна, игнорируя снимки до его начала', async () => {
      await writeBaseSeries()

      const block = sectionOf((await digest()).text, 'Цены за окно')

      expect(block).not.toBeNull()
      // Снимок до окна ставил AAA цену 1000: попади он в расчёт, AAA была бы худшей.
      expect(block).toMatch(/Впереди:[\s\S]*AAA[^\n]*\+12\.0%/)
      expect(block).toMatch(/Позади:[\s\S]*HHH[^\n]*-11\.0%/)
      expect(block).toContain('Сравнение двух снимков: 27.08 22:00 UTC → 28.08 06:00 UTC')
    })

    it('берёт края из разных суточных файлов, когда окно пересекает полночь', async () => {
      await writeBaseSeries()

      const result = await digest()

      // Первый край лежит в файле 27-го, второй — в файле 28-го.
      expect(result.text).toContain('27.08 22:00 UTC → 28.08 06:00 UTC')
      expect(result.coveredHours).toBe(HOURS)
    })

    it('не пускает в рейтинги неликвид с самым красивым процентом', async () => {
      await writeBaseSeries()
      net.ctxs = [ctx('JUNKF', 0.9, THIN_VLM), ctx('HOT', 0.00045, LIQUID_VLM)]

      const result = await digest()

      // JUNK вырос вдвое, JUNKF имеет дикий фандинг — обоих нет во всём отчёте.
      expect(result.text).not.toContain('JUNK')
      expect(result.text).toContain('AAA')
    })

    it('не печатает «позади» дважды, когда ликвидных монет всего три', async () => {
      const three = (edge: 'first' | 'last'): Coins => ({
        AAA: [edge === 'first' ? 100 : 110, BASE_FUNDING, 1000, LIQUID_VLM],
        BBB: [edge === 'first' ? 100 : 105, BASE_FUNDING, 1000, LIQUID_VLM],
        CCC: [edge === 'first' ? 100 : 90, BASE_FUNDING, 1000, LIQUID_VLM],
      })
      await writeArchive('series', DAY_NOW, [snapshot(NOW_MS - HOUR_MS, three('first')), snapshot(NOW_MS, three('last'))])

      const block = sectionOf((await digest()).text, 'Цены за окно')

      expect(block).toContain('Впереди:')
      expect(block).not.toContain('Позади:')
    })
  })

  describe('фандинг', () => {
    it('показывает экстремумы в часах и годовых и называет базовую ставку', async () => {
      await writeBaseSeries()
      net.ctxs = [
        ctx('HOT', 0.00045, LIQUID_VLM),
        ctx('WARM', 0.0002, LIQUID_VLM),
        ctx('MID', BASE_FUNDING, LIQUID_VLM),
        ctx('COOL', -0.00005, LIQUID_VLM),
        ctx('COLD', -0.00012, LIQUID_VLM),
      ]

      const block = sectionOf((await digest()).text, 'Фандинг сейчас')

      expect(block).not.toBeNull()
      expect(block).toMatch(/Дороже всего лонгу:[\s\S]*HOT[^\n]*\+0\.0450%\/час/)
      expect(block).toMatch(/Платят лонгу:[\s\S]*COLD[^\n]*-0\.0120%\/час/)
      expect(block).toContain('годовых')
      expect(block).toContain('0.0000125')
    })

    it('пропускает раздел целиком, когда срез не удалось получить', async () => {
      await writeBaseSeries()
      net.fails = true

      const result = await digest()

      expect(result.text).not.toContain('Фандинг сейчас')
      expect(result.text).toContain('Цены за окно') // остальной отчёт при этом жив
    })
  })

  describe('открытый интерес', () => {
    it('читает рост OI вместе с ценой: вверх — лонги, вниз — шорты', async () => {
      await writeBaseSeries()

      const block = sectionOf((await digest()).text, 'Открытый интерес')

      expect(block).not.toBeNull()
      expect(block).toMatch(/AAA[^\n]*OI \+34\.0%[^\n]*цена \+12\.0%[^\n]*набирают лонги/)
      expect(block).toMatch(/HHH[^\n]*OI \+20\.0%[^\n]*цена -11\.0%[^\n]*набирают шорты/)
    })

    it('пропускает раздел, когда OI нигде не вырос', async () => {
      const flat = (px: number): Coins => ({ AAA: [px, BASE_FUNDING, 1000, LIQUID_VLM] })
      await writeArchive('series', DAY_NOW, [snapshot(NOW_MS - HOUR_MS, flat(100)), snapshot(NOW_MS, flat(110))])

      const result = await digest()

      expect(result.text).not.toContain('Открытый интерес')
      expect(result.text).toContain('Цены за окно')
    })
  })

  describe('киты', () => {
    it('складывает приток по монетам и разводит его на топ притока и топ оттока', async () => {
      await writeArchive('whales', DAY_FROM, [
        // Запись до окна: попади она в расчёт, BTC ушёл бы в отток на миллиард.
        { t: Math.floor((FROM_MS - HOUR_MS) / 1000), address: '0xa', coin: 'BTC', kind: 'close', fromUsd: 1e9, toUsd: 0 },
        { t: Math.floor((FROM_MS + HOUR_MS) / 1000), address: '0xa', coin: 'BTC', kind: 'add', fromUsd: 1e6, toUsd: 13e6 },
      ])
      await writeArchive('whales', DAY_NOW, [
        { t: Math.floor((NOW_MS - 2 * HOUR_MS) / 1000), address: '0xb', coin: 'ETH', kind: 'open', fromUsd: 0, toUsd: -8e6 },
        { t: Math.floor((NOW_MS - HOUR_MS) / 1000), address: '0xb', coin: 'SOL', kind: 'add', fromUsd: 5e6, toUsd: 6e6 },
      ])

      const block = sectionOf((await digest()).text, 'Киты за окно')

      expect(block).not.toBeNull()
      expect(block).toMatch(/Приток:[\s\S]*BTC[^\n]*\+\$12M/)
      expect(block).toMatch(/Отток:[\s\S]*ETH[^\n]*-\$8M/)
      expect(block).toContain('Записей о китах: 3')
      expect(block).toContain('говорить о тенденции по ним нельзя') // три записи — не поток
    })

    it('пропускает раздел, когда движений китов за окно не было', async () => {
      await writeBaseSeries()

      const result = await digest()

      expect(result.text).not.toContain('Киты за окно')
    })
  })

  describe('что делал радар', () => {
    it('считает кандидатов и пинги и не даёт считать по ним проценты', async () => {
      await writeArchive('events', DAY_FROM, [
        { t: Math.floor((FROM_MS - HOUR_MS) / 1000), kind: 'candidate', coin: 'OLD', px: 1, score: 0.01, top: [] },
        { t: Math.floor((FROM_MS + 60) / 1000), kind: 'candidate', coin: 'JUP', px: 0.23, score: 0.05, top: ['strength'] },
        { t: Math.floor((FROM_MS + 120) / 1000), kind: 'candidate', coin: 'AVAX', px: 7.4, score: 0.04, top: ['impulse'] },
        // У пинга полей available и total нет — дайджест на них не рассчитывает.
        { t: Math.floor((FROM_MS + 180) / 1000), kind: 'alert', coin: 'CHIP', px: 0.039, score: 0.47, top: ['funding'] },
      ])
      await writeArchive('events', DAY_NOW, [
        { t: Math.floor((NOW_MS - HOUR_MS) / 1000), kind: 'candidate', coin: 'JUP', px: 0.24, score: 0.06, top: [] },
        { t: Math.floor((NOW_MS - 60_000) / 1000), kind: 'alert', coin: 'MON', px: 1.2, score: 0.5, top: ['oiRegime'] },
      ])

      const block = sectionOf((await digest()).text, 'Что делал радар')

      expect(block).not.toBeNull()
      expect(block).toContain('Кандидатов рассмотрено: 3, монет среди них: 2') // кандидат до окна не в счёт
      expect(block).toContain('Пингов отправлено: 2 — CHIP, MON')
      expect(block).toContain('это не выборка')
    })

    it('называет отсутствие пингов спокойным рынком, а не сбоем', async () => {
      await writeArchive('events', DAY_NOW, [
        { t: Math.floor((NOW_MS - HOUR_MS) / 1000), kind: 'candidate', coin: 'JUP', px: 0.23, score: 0.05, top: [] },
      ])

      const block = sectionOf((await digest()).text, 'Что делал радар')

      expect(block).toContain('Пингов не было')
      expect(block).toContain('не сбой')
    })

    it('пропускает раздел, когда радар за окно вообще не работал', async () => {
      await writeBaseSeries()

      const result = await digest()

      expect(result.text).not.toContain('Что делал радар')
    })
  })

  describe('устойчивость', () => {
    it('не печатает ни одного раздела с прочерками, когда архива нет совсем', async () => {
      net.fails = true

      const result = await digest()

      for (const heading of ['Цены за окно', 'Фандинг сейчас', 'Открытый интерес', 'Киты за окно', 'Что делал радар']) {
        expect(result.text).not.toContain(heading)
      }
      // Прочерк недопустим как ЗНАЧЕНИЕ в строке раздела: пустая таблица
      // читается как проделанная работа. В обычном предложении тире законно,
      // поэтому проверяем строки-заготовки, а не наличие символа в тексте.
      for (const line of result.text.split('\n')) {
        expect(line.trim()).not.toMatch(/^\S+\s+—$/)
      }
      expect(result.text.split('\n\n')).toHaveLength(1) // только шапка
    })

    it('переживает битые строки и мусор в архиве, не теряя остальной день', async () => {
      await mkdir(join(dir, 'series'), { recursive: true })
      const good = [snapshot(FROM_MS, edgeCoins('first')), snapshot(NOW_MS, edgeCoins('last'))]
      await writeFile(
        join(dir, 'series', `${DAY_NOW}.ndjson`),
        [JSON.stringify(good[0]), '{ это не json', '[1,2,3]', 'null', '{"t":"вчера"}', JSON.stringify(good[1]), ''].join('\n'),
        'utf8',
      )

      const result = await digest()

      expect(result.coveredHours).toBe(HOURS)
      expect(result.text).toContain('AAA')
    })

    it('не падает и не зовёт архив в будущее при бессмысленном окне', async () => {
      await writeBaseSeries()

      const result = await digest({ hours: 0 })

      expect(result.coveredHours).toBe(0)
      expect(result.text).toContain('Записи рынка за это окно нет')
    })
  })
})
