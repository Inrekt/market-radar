// Сводка потока: типы и расчёты по корзинам и крупным принтам.

import type { Book, BookLevel } from '../hl.js'

/** Корзина 10 секунд: накопленные объёмы покупок и продаж, цена, стакан. */
export interface FlowBucket {
  /**
   * Начало корзины в МИЛЛИСЕКУНДАХ. В самом архиве лежат секунды — читатель
   * приводит их к миллисекундам, чтобы время корзины и время принта считались
   * в одних единицах. Расхождение здесь стоило бы ошибки в тысячу раз в
   * покрытии, а тест на выдуманных данных её бы не поймал.
   */
  readonly t: number // миллисекунды
  readonly buyUsd: number
  readonly sellUsd: number
  readonly trades: number
  readonly px: number // последняя цена
  readonly whaleBuyUsd: number
  readonly whaleSellUsd: number
  readonly bidUsd: number
  readonly askUsd: number
  readonly bestBid: number
  readonly bestAsk: number
}

/** Сделка крупнее BIG_PRINT_USD с определённой стороной. */
export interface BigPrint {
  readonly t: number // миллисекунды
  readonly px: number
  readonly usd: number
  readonly side: 'A' | 'B' // 'A' = агрессивная продажа, 'B' = агрессивная покупка
  readonly whale: boolean
}

/** Сводка потока за запросенный период. */
export interface FlowSummary {
  readonly coin: string
  /** Сколько минут записи реально есть (по размаху первой и последней корзины). */
  readonly coveredMinutes: number
  readonly buckets: FlowBucket[]
  readonly big: BigPrint[]
  readonly book: Book | null // свежий снимок стакана на момент запроса
  readonly buyUsd: number
  readonly sellUsd: number
  readonly deltaUsd: number // buyUsd - sellUsd
  readonly trades: number
  readonly tradesPerMinute: number // по coveredMinutes, не по запрошенному окну
  readonly whaleBuyUsd: number
  readonly whaleSellUsd: number
  /** Накопленная дельта по корзинам: массив той же длины, последний элемент = deltaUsd. */
  readonly cvd: number[]
  readonly bidUsd: number // из переданного стакана
  readonly askUsd: number // из переданного стакана
  /** bidUsd / askUsd, или null если стакана нет либо askUsd = 0. */
  readonly bookRatio: number | null
  readonly firstPx: number
  readonly lastPx: number
}

/**
 * Рассчитывает сводку по корзинам, крупным принтам и стакану.
 *
 * coveredMinutes считается по реальному размаху времени корзин, а не по запрошенному окну.
 * Это честно отражает, что в записи бывают дыры от переподключений.
 * Пустой вход даёт coveredMinutes = 0, NaN нигде не появляется.
 */
export function summarize(
  coin: string,
  buckets: FlowBucket[],
  big: BigPrint[],
  book: Book | null,
): FlowSummary {
  // Реальное покрытие по размаху
  const coveredMinutes = buckets.length === 0
    ? 0
    : Math.round((buckets[buckets.length - 1]!.t - buckets[0]!.t) / 60_000)

  // Суммы
  let buyUsd = 0
  let sellUsd = 0
  let trades = 0
  let whaleBuyUsd = 0
  let whaleSellUsd = 0
  for (const b of buckets) {
    buyUsd += b.buyUsd
    sellUsd += b.sellUsd
    trades += b.trades
    whaleBuyUsd += b.whaleBuyUsd
    whaleSellUsd += b.whaleSellUsd
  }

  const deltaUsd = buyUsd - sellUsd
  const tradesPerMinute = coveredMinutes > 0 ? trades / coveredMinutes : 0

  // CVD: накопленная сумма (buyUsd - sellUsd) по корзинам
  const cvd: number[] = []
  let cumulative = 0
  for (const b of buckets) {
    cumulative += b.buyUsd - b.sellUsd
    cvd.push(cumulative)
  }

  // Стакан
  // Сумма ВСЕХ уровней, а не только лучшего. По лучшему выходит одна заявка:
  // на SOL это ~$79K против ~$4.9M по всей стороне, и перекос из одного уровня
  // переворачивается каждую секунду — это шум, а не состояние стакана.
  const sideUsd = (levels: readonly BookLevel[] | undefined): number =>
    (levels ?? []).reduce((total, level) => total + level.usd, 0)
  const bidUsd = sideUsd(book?.bids)
  const askUsd = sideUsd(book?.asks)
  const bookRatio = askUsd === 0 ? null : bidUsd / askUsd

  // Цены
  const firstPx = buckets[0]?.px ?? 0
  const lastPx = buckets[buckets.length - 1]?.px ?? 0

  return {
    coin,
    coveredMinutes,
    buckets,
    big,
    book,
    buyUsd,
    sellUsd,
    deltaUsd,
    trades,
    tradesPerMinute,
    whaleBuyUsd,
    whaleSellUsd,
    cvd,
    bidUsd,
    askUsd,
    bookRatio,
    firstPx,
    lastPx,
  }
}
