// Подписи под карточкой /flow. Отдельно от caption.ts намеренно: там структура,
// которая живёт часами, здесь — лента и стакан, которые переставляют за секунды.
// Главное требование к этому файлу — честность про длину записи: пустой график,
// принятый за правду, хуже строчки «записи 4 минуты».

import type { Book, BookLevel } from '../hl.js'
import type { BigPrint, FlowBucket, FlowSummary } from '../flow/summary.js'
import { fmtMoney, fmtPct, fmtPrice } from './caption.js'

const BUCKET_SECONDS = 10 // формат архива фиксирован: одна строка ndjson = 10 секунд
// Ниже этого порога окно короче типичной серии сделок: одна крупная заявка
// перекашивает всю дельту, и средние по окну описывают её, а не рынок.
const SHORT_COVERAGE_MINUTES = 10
const MAX_SHORT_LINES = 8 // столько же, сколько у /ta: длиннее подпись пролистывают
// Больше половины дельты в одной десятисекундной корзине — это один вынос, а не поток.
const ONE_BUCKET_DELTA_SHARE = 0.5
const MAX_BIG_PRINTS = 5 // шестой принт уже не меняет впечатления от ленты
const MAX_WALLS_PER_SIDE = 3 // дальше третьей плиты на стороне читатель не смотрит
// Столько уровней на сторону отдаёт публичный источник — рамка карточки, не наш выбор.
const PUBLIC_BOOK_LEVELS = 20
const RATE_DECIMALS_CUTOFF = 10 // от десяти сделок в минуту дробная часть — шум
const RATIO_DECIMALS = 2
const PCT_PER_UNIT = 100
// Дальше этой отметки Date.toISOString бросает RangeError — мусорный t не должен ронять подпись.
const MAX_TIME_MS = 8.64e15
const NO_DATA = '—'
const COL_GAP = '   '

/** Сводку собирает другой модуль; NaN оттуда не должен просочиться в текст подписи. */
function safe(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Счётчики (сделки, заявки) — не деньги, но разряды режем так же, как fmtMoney. */
function fmtCount(value: number): string {
  const rounded = Math.round(safe(value))
  return `${rounded < 0 ? '-' : ''}${groupThousands(Math.abs(rounded).toFixed(0))}`
}

/** Без плюса «$820K» не говорит, в чью сторону; знак у дельты обязателен. */
function fmtSignedMoney(value: number): string {
  const v = safe(value)
  return v > 0 ? `+${fmtMoney(v)}` : fmtMoney(v)
}

function fmtRate(value: number): string {
  const v = safe(value)
  if (v === 0) return '0'
  return v >= RATE_DECIMALS_CUTOFF ? v.toFixed(0) : v.toFixed(1)
}

/** Русский счёт: 1 минута, 2 минуты, 5 минут. Дробное число берёт форму «минуты». */
function plural(n: number, one: string, few: string, many: string): string {
  if (!Number.isInteger(n)) return few
  const mod100 = Math.abs(n) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

/** Минуты записи читатель проверяет глазами первыми — печатаем их всегда числом. */
function fmtMinutes(value: number): string {
  const v = Math.max(0, safe(value))
  // Короткое окно округляем до десятых: разница между 2 и 7 минутами здесь решает всё.
  const rounded = v < SHORT_COVERAGE_MINUTES ? Math.round(v * 10) / 10 : Math.round(v)
  const digits = Number.isInteger(rounded) ? fmtCount(rounded) : String(rounded)
  return `${digits} ${plural(rounded, 'минута', 'минуты', 'минут')}`
}

/** Сутки в архиве нарезаны по UTC — время принтов показываем в нём же. */
/**
 * Время корзины и время принта приходят уже в МИЛЛИСЕКУНДАХ: в архиве лежат
 * секунды, но читатель приводит их к одним единицам. Умножение на тысячу здесь
 * уже стоило подписи вида «в 12T14:20» — дата улетала в далёкое будущее, где у
 * ISO-строки другой формат, и обрезка давала мусор.
 */
function fmtClock(ms: number): string {
  const v = safe(ms)
  if (v <= 0 || v > MAX_TIME_MS) return NO_DATA
  return new Date(v).toISOString().slice(11, 19)
}

/** 'A' — агрессивная ПРОДАЖА, 'B' — агрессивная ПОКУПКА. Сверено записью живой ленты. */
function sideWord(side: BigPrint['side']): string {
  return side === 'B' ? 'покупка' : 'продажа'
}

function pressureWord(delta: number): string {
  const d = safe(delta)
  if (d > 0) return 'давит покупатель'
  if (d < 0) return 'давит продавец'
  return 'стороны в равновесии'
}

/** Перекос читается как «во столько-то раз в такую-то сторону», а не долей. */
function fmtRatio(ratio: number): string {
  if (ratio > 1) return `${ratio.toFixed(RATIO_DECIMALS)}× в бид`
  if (ratio < 1) return `${(1 / ratio).toFixed(RATIO_DECIMALS)}× в аск`
  return 'ровно поровну'
}

function fmtShare(share: number): string {
  return `${Math.round(safe(share) * PCT_PER_UNIT)}%`
}

/** Столбцы влево, перечисленные — вправо: суммы так сравниваются взглядом по столбцу. */
function table(rows: readonly (readonly string[])[], rightAlign: readonly number[]): string[] {
  if (rows.length === 0) return []
  const cols = Math.max(...rows.map((row) => row.length))
  const width = (i: number): number => Math.max(...rows.map((row) => (row[i] ?? '').length))
  return rows.map((row) => {
    const cells = Array.from({ length: cols }, (_, i) => {
      const cell = row[i] ?? ''
      return rightAlign.includes(i) ? cell.padStart(width(i)) : cell.padEnd(width(i))
    })
    return `  ${cells.join(COL_GAP)}`.trimEnd()
  })
}

function labelled(pairs: readonly (readonly [string, string])[]): string[] {
  if (pairs.length === 0) return []
  const width = Math.max(...pairs.map(([label]) => label.length))
  return pairs.map(([label, value]) => `  ${label.padEnd(width)}${COL_GAP}${value}`)
}

function section(title: string, body: readonly string[]): string[] {
  return body.length > 0 ? [`${title}\n${body.join('\n')}`] : []
}

interface DominantBucket {
  readonly bucket: FlowBucket
  readonly share: number
}

/**
 * Одна корзина, давшая больше половины дельты, — это не поток, а один вынос:
 * все средние по окну после неё описывают эту корзину, а не рынок.
 */
function dominantBucket(summary: FlowSummary): DominantBucket | null {
  const total = safe(summary.deltaUsd)
  if (total === 0) return null
  let best: FlowBucket | null = null
  let bestShare = 0
  for (const bucket of summary.buckets) {
    // Доля со знаком: корзина против общей дельты её не объясняет, она её гасит.
    const share = (safe(bucket.buyUsd) - safe(bucket.sellUsd)) / total
    if (share > bestShare) {
      bestShare = share
      best = bucket
    }
  }
  if (best === null || bestShare <= ONE_BUCKET_DELTA_SHARE) return null
  return { bucket: best, share: bestShare }
}

function biggestPrints(big: readonly BigPrint[]): BigPrint[] {
  return [...big].sort((a, b) => safe(b.usd) - safe(a.usd)).slice(0, MAX_BIG_PRINTS)
}

function largestBucket(buckets: readonly FlowBucket[]): FlowBucket | null {
  let best: FlowBucket | null = null
  let bestTurnover = -1
  for (const bucket of buckets) {
    const turnover = safe(bucket.buyUsd) + safe(bucket.sellUsd)
    if (turnover > bestTurnover) {
      bestTurnover = turnover
      best = bucket
    }
  }
  return best
}

function bucketTurnover(bucket: FlowBucket): number {
  return safe(bucket.buyUsd) + safe(bucket.sellUsd)
}

function printText(print: BigPrint): string {
  const whale = print.whale ? ' (кит)' : ''
  return `${sideWord(print.side)} ${fmtMoney(safe(print.usd))} по ${fmtPrice(safe(print.px))}${whale}`
}

function dominantText(dom: DominantBucket): string {
  const at = fmtClock(safe(dom.bucket.t))
  const when = at === NO_DATA ? '' : ` в ${at}`
  return `${fmtShare(dom.share)} дельты дала одна корзина ${BUCKET_SECONDS} с${when}`
    + ' — это не поток, а один вынос'
}

function bookText(summary: FlowSummary): string {
  const bid = safe(summary.bidUsd)
  const ask = safe(summary.askUsd)
  if (bid === 0 && ask === 0) return 'снимков стакана в окне нет'
  const ratio = summary.bookRatio
  const skew = ratio !== null && Number.isFinite(ratio) && ratio > 0 ? ` — перекос ${fmtRatio(ratio)}` : ''
  return `бид ${fmtMoney(bid)} против аска ${fmtMoney(ask)}${skew}`
}

function whaleText(summary: FlowSummary): string | null {
  const buy = safe(summary.whaleBuyUsd)
  const sell = safe(summary.whaleSellUsd)
  if (buy === 0 && sell === 0) return null
  return `купили ${fmtMoney(buy)} / продали ${fmtMoney(sell)} · перевес ${fmtSignedMoney(buy - sell)}`
}

function priceRangeText(summary: FlowSummary): string {
  const first = safe(summary.firstPx)
  const last = safe(summary.lastPx)
  if (first === 0 && last === 0) return NO_DATA
  if (first === 0) return fmtPrice(last)
  return `${fmtPrice(first)} → ${fmtPrice(last)} (${fmtPct(((last - first) / first) * PCT_PER_UNIT)})`
}

function bucketsText(summary: FlowSummary): string {
  const count = summary.buckets.length
  if (count === 0) return 'ни одной'
  const top = largestBucket(summary.buckets)
  const head = `${fmtCount(count)} по ${BUCKET_SECONDS} с`
  if (top === null) return head
  const at = fmtClock(safe(top.t))
  const when = at === NO_DATA ? '' : ` в ${at}`
  return `${head}, крупнейшая ${fmtMoney(bucketTurnover(top))} оборота${when}`
}

/**
 * Монета и длина записи — первой строкой: это главное ограничение карточки.
 * На коротком окне та же строка несёт предупреждение, чтобы не дублировать минуты
 * двумя строками подряд — предупреждение всё равно оказывается первым, что видит читатель.
 */
function headLine(summary: FlowSummary): string {
  const coin = summary.coin || NO_DATA
  const minutes = fmtMinutes(summary.coveredMinutes)
  if (safe(summary.coveredMinutes) < SHORT_COVERAGE_MINUTES) {
    return `${coin} · записи всего ${minutes} — этого мало, выводы ниже предварительные`
  }
  return `${coin} · записи ${minutes}`
}

export function shortFlowCaption(summary: FlowSummary): string {
  const out: string[] = [headLine(summary)]

  out.push(`Сделок ${fmtCount(summary.trades)} · ${fmtRate(summary.tradesPerMinute)} в минуту`)
  out.push(`Купили ${fmtMoney(safe(summary.buyUsd))} · продали ${fmtMoney(safe(summary.sellUsd))}`
    + ` · дельта ${fmtSignedMoney(summary.deltaUsd)} — ${pressureWord(summary.deltaUsd)}`)

  const dom = dominantBucket(summary)
  if (dom !== null) out.push(dominantText(dom))

  const top = biggestPrints(summary.big)[0]
  if (top !== undefined) out.push(`Крупнейший принт: ${printText(top)}`)

  out.push(`Ближний стакан: ${bookText(summary)}`)

  const whales = whaleText(summary)
  if (whales !== null) out.push(`Киты в ленте: ${whales}`)

  return out.slice(0, MAX_SHORT_LINES).join('\n')
}

function printRows(big: readonly BigPrint[]): string[] {
  const rows = biggestPrints(big).map((print) => [
    fmtClock(safe(print.t)),
    fmtPrice(safe(print.px)),
    fmtMoney(safe(print.usd)),
    sideWord(print.side),
    print.whale ? 'кит' : '',
  ])
  return table(rows, [1, 2])
}

function wallRows(book: Book | null): string[] {
  if (book === null) return []
  const side = (levels: readonly BookLevel[], label: string): string[][] =>
    [...levels]
      .sort((a, b) => safe(b.usd) - safe(a.usd))
      .slice(0, MAX_WALLS_PER_SIDE)
      .map((level) => {
        const orders = Math.round(safe(level.orders))
        return [
          label,
          fmtPrice(safe(level.px)),
          fmtMoney(safe(level.usd)),
          `${fmtCount(orders)} ${plural(orders, 'заявка', 'заявки', 'заявок')}`,
        ]
      })
  return table([...side(book.bids, 'бид'), ...side(book.asks, 'аск')], [1, 2])
}

/**
 * Рамка источника, а не оправдание: владелец должен видеть её на самой карточке,
 * иначе он будет искать глубину стакана там, где её не отдают вообще никому.
 */
function limitsBullets(summary: FlowSummary): string[] {
  const bullets = [
    `публично отдаётся только ${PUBLIC_BOOK_LEVELS} уровней стакана на сторону —`
      + ' глубокой карты стакана не будет ни у нас, ни у платного сервиса на том же источнике',
    `в окне видно только записанное: ${fmtMinutes(summary.coveredMinutes)} ленты;`
      + ' то, что было до запуска регистратора, не восстановить',
  ]
  if (summary.book === null) bullets.push('снимка стакана на конец окна нет — плиты показать не из чего')
  return bullets.map((text) => `  · ${text}`)
}

export function longFlowCaption(summary: FlowSummary): string {
  const dom = dominantBucket(summary)
  const flow: (readonly [string, string])[] = [
    ['купили', fmtMoney(safe(summary.buyUsd))],
    ['продали', fmtMoney(safe(summary.sellUsd))],
    ['дельта', `${fmtSignedMoney(summary.deltaUsd)} — ${pressureWord(summary.deltaUsd)}`],
    ['сделок', `${fmtCount(summary.trades)} (${fmtRate(summary.tradesPerMinute)} в минуту)`],
    ['цена за окно', priceRangeText(summary)],
    ['корзин', bucketsText(summary)],
  ]
  if (dom !== null) flow.push(['внимание', dominantText(dom)])

  const bookBody = [`  ${bookText(summary)}`, ...wallRows(summary.book)]
  const whales = whaleText(summary)

  const blocks: string[] = [
    headLine(summary),
    ...section('ПОТОК', labelled(flow)),
    ...section('КРУПНЫЕ ПРИНТЫ', printRows(summary.big)),
    ...section('СТАКАН', bookBody),
  ]
  if (whales !== null) blocks.push(...section('КИТЫ', [`  ${whales}`]))
  blocks.push(...section('ЧЕГО ЗДЕСЬ НЕТ', limitsBullets(summary)))
  return blocks.join('\n\n')
}
