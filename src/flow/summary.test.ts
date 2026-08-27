// Тесты для сводки потока.

import { describe, it, expect } from 'vitest'
import { summarize } from './summary.js'
import type { FlowBucket, BigPrint } from './summary.js'

describe('summarize', () => {
  it('пустой вход не даёт NaN ни в одном поле', () => {
    const summary = summarize('SOL', [], [], null)
    expect(summary.coveredMinutes).toBe(0)
    expect(summary.buyUsd).toBe(0)
    expect(summary.sellUsd).toBe(0)
    expect(summary.deltaUsd).toBe(0)
    expect(summary.trades).toBe(0)
    expect(summary.tradesPerMinute).toBe(0)
    expect(summary.whaleBuyUsd).toBe(0)
    expect(summary.whaleSellUsd).toBe(0)
    expect(summary.cvd).toEqual([])
    expect(summary.bidUsd).toBe(0)
    expect(summary.askUsd).toBe(0)
    expect(summary.bookRatio).toBeNull()
    expect(summary.firstPx).toBe(0)
    expect(summary.lastPx).toBe(0)
  })

  it('знак дельты: продажа даёт отрицательную дельту', () => {
    const buckets: FlowBucket[] = [
      {
        t: 1000,
        buyUsd: 0,
        sellUsd: 100,
        trades: 1,
        px: 200,
        whaleBuyUsd: 0,
        whaleSellUsd: 0,
        bidUsd: 0,
        askUsd: 0,
        bestBid: 0,
        bestAsk: 0,
      },
    ]
    const summary = summarize('SOL', buckets, [], null)
    expect(summary.buyUsd).toBe(0)
    expect(summary.sellUsd).toBe(100)
    expect(summary.deltaUsd).toBe(-100)
  })

  it('знак дельты: покупка даёт положительную дельту', () => {
    const buckets: FlowBucket[] = [
      {
        t: 1000,
        buyUsd: 150,
        sellUsd: 0,
        trades: 1,
        px: 200,
        whaleBuyUsd: 0,
        whaleSellUsd: 0,
        bidUsd: 0,
        askUsd: 0,
        bestBid: 0,
        bestAsk: 0,
      },
    ]
    const summary = summarize('SOL', buckets, [], null)
    expect(summary.buyUsd).toBe(150)
    expect(summary.sellUsd).toBe(0)
    expect(summary.deltaUsd).toBe(150)
  })

  it('coveredMinutes считается по размаху, не по числу корзин', () => {
    // 10 корзин от 0 до 90 000 ms = 90 секунд ≈ 1.5 минуты
    const buckets: FlowBucket[] = Array.from({ length: 10 }, (_, i) => ({
      t: i * 10_000,
      buyUsd: 0,
      sellUsd: 0,
      trades: 0,
      px: 0,
      whaleBuyUsd: 0,
      whaleSellUsd: 0,
      bidUsd: 0,
      askUsd: 0,
      bestBid: 0,
      bestAsk: 0,
    }))
    const summary = summarize('SOL', buckets, [], null)
    // (90_000 - 0) / 60_000 = 1.5, округляем до 2
    expect(summary.coveredMinutes).toBe(2)
  })

  it('дыра в записи не превращается в выдуманное покрытие', () => {
    // Две корзины с дырой посередине: 0 и 600_000 ms = 10 минут реального размаха
    const buckets: FlowBucket[] = [
      {
        t: 0,
        buyUsd: 0,
        sellUsd: 0,
        trades: 0,
        px: 0,
        whaleBuyUsd: 0,
        whaleSellUsd: 0,
        bidUsd: 0,
        askUsd: 0,
        bestBid: 0,
        bestAsk: 0,
      },
      {
        t: 600_000,
        buyUsd: 0,
        sellUsd: 0,
        trades: 0,
        px: 0,
        whaleBuyUsd: 0,
        whaleSellUsd: 0,
        bidUsd: 0,
        askUsd: 0,
        bestBid: 0,
        bestAsk: 0,
      },
    ]
    const summary = summarize('SOL', buckets, [], null)
    expect(summary.coveredMinutes).toBe(10)
  })

  it('tradesPerMinute считается по coveredMinutes, не по запрошенному окну', () => {
    // 1 минута покрытия, 60 сделок → 60 в минуту
    const buckets: FlowBucket[] = [
      {
        t: 0,
        buyUsd: 0,
        sellUsd: 0,
        trades: 60,
        px: 0,
        whaleBuyUsd: 0,
        whaleSellUsd: 0,
        bidUsd: 0,
        askUsd: 0,
        bestBid: 0,
        bestAsk: 0,
      },
    ]
    const summary = summarize('SOL', buckets, [], null)
    // Одна корзина: размах = 0 ms → coveredMinutes = 0 → tradesPerMinute = 0
    expect(summary.tradesPerMinute).toBe(0)

    // Две корзины с размахом 60 секунд, 60 сделок → 60 сделок за 1 минуту
    const buckets2: FlowBucket[] = [
      {
        t: 0,
        buyUsd: 0,
        sellUsd: 0,
        trades: 60,
        px: 0,
        whaleBuyUsd: 0,
        whaleSellUsd: 0,
        bidUsd: 0,
        askUsd: 0,
        bestBid: 0,
        bestAsk: 0,
      },
      {
        t: 60_000,
        buyUsd: 0,
        sellUsd: 0,
        trades: 0,
        px: 0,
        whaleBuyUsd: 0,
        whaleSellUsd: 0,
        bidUsd: 0,
        askUsd: 0,
        bestBid: 0,
        bestAsk: 0,
      },
    ]
    const summary2 = summarize('SOL', buckets2, [], null)
    expect(summary2.tradesPerMinute).toBe(60)
  })

  it('cvd того же размера, что buckets, и последний элемент = deltaUsd', () => {
    const buckets: FlowBucket[] = [
      {
        t: 0,
        buyUsd: 100,
        sellUsd: 0,
        trades: 0,
        px: 0,
        whaleBuyUsd: 0,
        whaleSellUsd: 0,
        bidUsd: 0,
        askUsd: 0,
        bestBid: 0,
        bestAsk: 0,
      },
      {
        t: 10_000,
        buyUsd: 0,
        sellUsd: 50,
        trades: 0,
        px: 0,
        whaleBuyUsd: 0,
        whaleSellUsd: 0,
        bidUsd: 0,
        askUsd: 0,
        bestBid: 0,
        bestAsk: 0,
      },
      {
        t: 20_000,
        buyUsd: 40,
        sellUsd: 0,
        trades: 0,
        px: 0,
        whaleBuyUsd: 0,
        whaleSellUsd: 0,
        bidUsd: 0,
        askUsd: 0,
        bestBid: 0,
        bestAsk: 0,
      },
    ]
    const summary = summarize('SOL', buckets, [], null)
    expect(summary.cvd).toHaveLength(3)
    // Накопленная дельта: 100, 100-50=50, 50+40=90
    expect(summary.cvd).toEqual([100, 50, 90])
    expect(summary.deltaUsd).toBe(90)
    expect(summary.cvd[summary.cvd.length - 1]).toBe(summary.deltaUsd)
  })

  it('bookRatio = bidUsd / askUsd когда оба ненулевые', () => {
    const book = {
      t: 1000,
      bids: [{ px: 200, usd: 50, orders: 1 }],
      asks: [{ px: 201, usd: 100, orders: 2 }],
    }
    const summary = summarize('SOL', [], [], book)
    expect(summary.bidUsd).toBe(50)
    expect(summary.askUsd).toBe(100)
    expect(summary.bookRatio).toBe(0.5)
  })

  it('bookRatio = null когда askUsd = 0', () => {
    const book = {
      t: 1000,
      bids: [{ px: 200, usd: 50, orders: 1 }],
      asks: [],
    }
    const summary = summarize('SOL', [], [], book)
    expect(summary.askUsd).toBe(0)
    expect(summary.bookRatio).toBeNull()
  })

  it('bookRatio = null когда нет стакана', () => {
    const summary = summarize('SOL', [], [], null)
    expect(summary.bookRatio).toBeNull()
  })

  it('whale суммы считаются отдельно', () => {
    const buckets: FlowBucket[] = [
      {
        t: 0,
        buyUsd: 100,
        sellUsd: 50,
        trades: 0,
        px: 0,
        whaleBuyUsd: 30,
        whaleSellUsd: 20,
        bidUsd: 0,
        askUsd: 0,
        bestBid: 0,
        bestAsk: 0,
      },
    ]
    const summary = summarize('SOL', buckets, [], null)
    expect(summary.whaleBuyUsd).toBe(30)
    expect(summary.whaleSellUsd).toBe(20)
    expect(summary.buyUsd).toBe(100)
    expect(summary.sellUsd).toBe(50)
  })

  it('firstPx и lastPx из крайних корзин', () => {
    const buckets: FlowBucket[] = [
      { t: 0, buyUsd: 0, sellUsd: 0, trades: 0, px: 150, whaleBuyUsd: 0, whaleSellUsd: 0, bidUsd: 0, askUsd: 0, bestBid: 0, bestAsk: 0 },
      { t: 10_000, buyUsd: 0, sellUsd: 0, trades: 0, px: 155, whaleBuyUsd: 0, whaleSellUsd: 0, bidUsd: 0, askUsd: 0, bestBid: 0, bestAsk: 0 },
      { t: 20_000, buyUsd: 0, sellUsd: 0, trades: 0, px: 152, whaleBuyUsd: 0, whaleSellUsd: 0, bidUsd: 0, askUsd: 0, bestBid: 0, bestAsk: 0 },
    ]
    const summary = summarize('SOL', buckets, [], null)
    expect(summary.firstPx).toBe(150)
    expect(summary.lastPx).toBe(152)
  })
})

describe('стакан в сводке', () => {
  const level = (px: number, usd: number) => ({ px, usd, orders: 1 })

  // Дефект, пойманный на живых данных: бралась только лучшая заявка. По SOL это
  // ~$79K против ~$4.9M по всей стороне, а перекос из одного уровня переворачивается
  // каждую секунду — карточка называла шум состоянием стакана.
  it('складывает все уровни стороны, а не только лучший', () => {
    const book = {
      t: 0,
      bids: [level(100, 10_000), level(99.9, 20_000), level(99.8, 30_000)],
      asks: [level(100.1, 5_000), level(100.2, 5_000)],
    }
    const s = summarize('SOL', [], [], book)
    expect(s.bidUsd).toBe(60_000)
    expect(s.askUsd).toBe(10_000)
    expect(s.bookRatio).toBe(6)
  })

  it('без стакана перекос не выдумывается', () => {
    const s = summarize('SOL', [], [], null)
    expect(s.bidUsd).toBe(0)
    expect(s.askUsd).toBe(0)
    expect(s.bookRatio).toBeNull()
  })
})
