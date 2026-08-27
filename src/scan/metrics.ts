// Метрики пробуждения монеты: восемь независимых замеров, каждый — чистая функция.
//
// Главное правило файла: метрика, под которую НЕТ данных, возвращает null и не
// участвует в скоре. Подставить ноль или среднее — значит выдать выдумку за
// измерение: скор получится «полным», человек поверит цифре, а под ней пусто.
// Молчание честнее. Поэтому null здесь — нормальный результат, а не ошибка.

import type { AssetCtx, Candle } from '../hl.js'
import { ATR_PERIOD, atr } from '../ta/stats.js'
import type { ArchiveView, WhaleFlow } from './archive.js'

export interface Metric {
  readonly key: string
  /** null = архива не хватает. Метрика молчит, а не выдумывает. */
  readonly value: number | null
  /** нормированный вклад 0..1, null если value null */
  readonly score: number | null
  /** строка для человека с числом внутри, например «открытый интерес +12% за час» */
  readonly text: string
}

export interface MetricInput {
  readonly coin: string
  /** закрытые бары 15m, до 200 */
  readonly bars: readonly Candle[]
  readonly ctx: AssetCtx
  readonly archive: ArchiveView
  readonly btcBars: readonly Candle[]
  /** медианное изменение цены по всему универсуму за час, доля (0.01 = +1%) */
  readonly universeMedian1h: number
  readonly whales: WhaleFlow | null
}

// ---------------------------------------------------------------------------
// Константы. Каждая — решение о том, что считать событием, а что фоном.
// ---------------------------------------------------------------------------

/** Бары 15-минутные, значит час = 4 бара. Всё «за час» ниже считается через это. */
const BARS_PER_HOUR = 4
/** ATR по 14 барам требует 15 баров: 14 истинных диапазонов + опорный. */
const MIN_BARS_FOR_ATR = ATR_PERIOD + 1

/** RVOL нужна медиана по бакету «день недели × час» за 4 недели. */
const RVOL_REQUIRED_HOURS = 4 * 7 * 24

/** Импульс меряется по последнему часу: 4 бара. */
const IMPULSE_BARS = BARS_PER_HOUR
/** Меньше полутора ATR за час монета ходит и в спячке — это не событие. */
const IMPULSE_MIN_ATR = 1.5
/** Четыре ATR за час — уже полноценный вынос, выше не различаем. */
const IMPULSE_FULL_ATR = 4

/** Десять часов истории: диапазон, который трейдер видит на экране целиком. */
const BREAKOUT_WINDOW = 40
/** Заход на ATR за экстремум — пробой состоялся, а не «ткнули уровень». */
const BREAKOUT_FULL_ATR = 1

/** Пять часов — окно, на котором сжатие уже видно, но ещё не размазано. */
const SQUEEZE_WINDOW = 20
/** Двое суток истории для перцентиля: столько бары нам и отдают. */
const SQUEEZE_LOOKBACK = 200
/** Ниже 20-го перцентиля волатильность считается взведённой пружиной. */
const SQUEEZE_LOW_PCT = 20
/** Меньше 40 окон — перцентиль считать не по чему, распределения ещё нет. */
const SQUEEZE_MIN_WINDOWS = 40

/** Открытый интерес сравниваем с состоянием часовой давности. */
const OI_LOOKBACK_MIN = 60
/** Открытый интерес гуляет на пару процентов в час сам по себе — это шум. */
const OI_MIN_CHANGE = 0.02
/** Десять процентов за час — приток или бегство, сильнее не различаем. */
const OI_FULL_CHANGE = 0.10

/** Базовая ставка фандинга Hyperliquid: 0.00125% в час при нейтральном рынке. */
const HL_BASE_FUNDING_HOURLY = 0.0000125
/** Втрое выше базы — за позицию уже реально платят, перекос заметен. */
const FUNDING_HOT_RATIO = 3
/** Десятикратная база (~11% годовых стоимости позиции) — предел шкалы. */
const FUNDING_FULL_RATIO = 10
/** Изменение ставки смотрим за 4 часа: короче — шум смены эпох фандинга. */
const FUNDING_LOOKBACK_MIN = 240

const STRENGTH_1H_BARS = BARS_PER_HOUR
const STRENGTH_4H_BARS = BARS_PER_HOUR * 4
/** Полтора процентных пункта к BTC за час монеты набегают и на общем движении. */
const STRENGTH_MIN_PP = 1.5
/** Пять пунктов за час — монета явно живёт своей жизнью. */
const STRENGTH_FULL_PP = 5

/** Полпроцента суточного оборота за час китовыми деньгами — уже заметный след. */
const WHALE_MIN_SHARE = 0.005
/** Три процента суточного оборота за час — крупный заход, выше не различаем. */
const WHALE_FULL_SHARE = 0.03

// Индексы полей снимка архива: [цена, фандинг за час, OI в монетах, оборот за сутки].
const SNAP_PX = 0
const SNAP_FUNDING = 1
const SNAP_OI = 2

// ---------------------------------------------------------------------------
// Мелкие помощники
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Линейная шкала: ниже from — ноль, выше full — единица. */
function ramp(value: number, from: number, full: number): number {
  if (full <= from) return value >= full ? 1 : 0
  return clamp01((value - from) / (full - from))
}

/** Знак пишем всегда: «+0.4» и «0.4» читаются по-разному. */
function signed(value: number, digits: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
}

function signedPct(fraction: number, digits: number): string {
  return `${signed(fraction * 100, digits)}%`
}

function fmtUsd(usd: number): string {
  const sign = usd >= 0 ? '+' : '-'
  const abs = Math.abs(usd)
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)} млн $`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)} тыс $`
  return `${sign}${abs.toFixed(0)} $`
}

function hours(coverageHours: number): string {
  return `${coverageHours.toFixed(1)} ч`
}

/** Метрика молчит: значения нет, в скор не входит, текст объясняет почему. */
function silent(key: string, text: string): Metric {
  return { key, value: null, score: null, text }
}

/** Доходность за n баров долей; null, если баров меньше, чем нужно. */
function returnOver(bars: readonly Candle[], n: number): number | null {
  const last = bars[bars.length - 1]
  const base = bars[bars.length - 1 - n]
  if (!last || !base || base.c <= 0) return null
  return (last.c - base.c) / base.c
}

/** Значение поля монеты из снимка N минут назад; null — снимка или монеты в нём нет. */
function fromArchive(input: MetricInput, minutesAgo: number, field: number): number | null {
  const snapshot = input.archive.at(minutesAgo)
  if (!snapshot) return null
  const row = snapshot.coins[input.coin]
  if (!row) return null
  return row[field] ?? null
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

// ---------------------------------------------------------------------------
// 1. rvol — честный отказ измерять
// ---------------------------------------------------------------------------

/**
 * Объём против медианы своего бакета «день недели × час» за 4 недели.
 *
 * Такого архива ещё нет и не будет ближайший месяц. Считать RVOL от медианы за
 * сутки — не та метрика: у крипты суточный и недельный профиль объёма, и «выше
 * обычного» без учёта часа недели означает всего лишь «сейчас не ночь».
 * Поэтому метрика молчит и прямо говорит, чего ей не хватает.
 */
export function rvolMetric(input: MetricInput): Metric {
  const covered = input.archive.coverageHours
  return silent(
    'rvol',
    `объём против обычного: нужен архив 4 недели (${RVOL_REQUIRED_HOURS} ч), есть ${hours(covered)}`,
  )
}

// ---------------------------------------------------------------------------
// 2. impulse
// ---------------------------------------------------------------------------

/** Ход цены за последний час в единицах ATR: «быстро для этой монеты», а не «много процентов». */
export function impulseMetric(input: MetricInput): Metric {
  const { bars } = input
  if (bars.length < Math.max(MIN_BARS_FOR_ATR, IMPULSE_BARS + 1)) {
    return silent('impulse', `импульс: мало баров (${bars.length}), нужно ${MIN_BARS_FOR_ATR}`)
  }
  const atrValue = atr(bars)
  const last = bars[bars.length - 1]
  const base = bars[bars.length - 1 - IMPULSE_BARS]
  if (!last || !base || atrValue <= 0) {
    return silent('impulse', 'импульс: нет хода баров, ATR нулевой')
  }
  const moveAtr = (last.c - base.c) / atrValue
  return {
    key: 'impulse',
    value: moveAtr,
    score: ramp(Math.abs(moveAtr), IMPULSE_MIN_ATR, IMPULSE_FULL_ATR),
    text: `ход цены ${signed(moveAtr, 2)} ATR за час`,
  }
}

// ---------------------------------------------------------------------------
// 3. breakout
// ---------------------------------------------------------------------------

/**
 * Закрытие за экстремумом последних 40 баров. Экстремум считается по барам ДО
 * последнего: иначе закрытие всегда внутри собственного бара и пробоя не бывает.
 * Пробоя нет — это измерение (value 0), а не отказ: данные есть, события нет.
 */
export function breakoutMetric(input: MetricInput): Metric {
  const { bars } = input
  if (bars.length < BREAKOUT_WINDOW + 1 || bars.length < MIN_BARS_FOR_ATR) {
    return silent('breakout', `пробой: мало баров (${bars.length}), нужно ${BREAKOUT_WINDOW + 1}`)
  }
  const atrValue = atr(bars)
  const last = bars[bars.length - 1]
  const window = bars.slice(-1 - BREAKOUT_WINDOW, -1)
  if (!last || atrValue <= 0) return silent('breakout', 'пробой: ATR нулевой, мерить нечем')

  const high = Math.max(...window.map((bar) => bar.h))
  const low = Math.min(...window.map((bar) => bar.l))
  let distanceAtr = 0
  if (last.c > high) distanceAtr = (last.c - high) / atrValue
  else if (last.c < low) distanceAtr = (last.c - low) / atrValue

  const text = distanceAtr === 0
    ? `пробоя нет: цена внутри диапазона ${BREAKOUT_WINDOW} баров`
    : `${distanceAtr > 0 ? 'пробой вверх' : 'пробой вниз'} на ${Math.abs(distanceAtr).toFixed(2)} ATR за экстремум ${BREAKOUT_WINDOW} баров`
  return {
    key: 'breakout',
    value: distanceAtr,
    score: clamp01(Math.abs(distanceAtr) / BREAKOUT_FULL_ATR),
    text,
  }
}

// ---------------------------------------------------------------------------
// 4. squeeze
// ---------------------------------------------------------------------------

/** Реализованная волатильность окна — разброс логарифмических доходностей. */
function realizedVol(returns: readonly number[], end: number, window: number): number {
  return stdev(returns.slice(end - window, end))
}

/**
 * Перцентиль текущей волатильности среди всех окон истории. Низкий перцентиль =
 * пружина взведена: движение из сжатия обычно и есть то, ради чего сканер живёт.
 */
export function squeezeMetric(input: MetricInput): Metric {
  const bars = input.bars.slice(-SQUEEZE_LOOKBACK)
  const returns: number[] = []
  for (let i = 1; i < bars.length; i += 1) {
    const bar = bars[i]
    const previous = bars[i - 1]
    if (!bar || !previous || bar.c <= 0 || previous.c <= 0) continue
    returns.push(Math.log(bar.c / previous.c))
  }
  const windowsCount = returns.length - SQUEEZE_WINDOW + 1
  if (windowsCount < SQUEEZE_MIN_WINDOWS) {
    return silent(
      'squeeze',
      `сжатие: мало баров (${input.bars.length}), нужно ${SQUEEZE_WINDOW + SQUEEZE_MIN_WINDOWS}`,
    )
  }

  const vols: number[] = []
  for (let end = SQUEEZE_WINDOW; end <= returns.length; end += 1) {
    vols.push(realizedVol(returns, end, SQUEEZE_WINDOW))
  }
  const current = vols[vols.length - 1]
  if (current === undefined) return silent('squeeze', 'сжатие: не из чего считать волатильность')

  const below = vols.filter((v) => v < current).length
  const percentile = (below / (vols.length - 1)) * 100
  const score = clamp01((SQUEEZE_LOW_PCT - percentile) / SQUEEZE_LOW_PCT)
  const verdict = percentile < SQUEEZE_LOW_PCT ? 'сжатие' : 'сжатия нет'
  return {
    key: 'squeeze',
    value: percentile,
    score,
    text: `волатильность ${SQUEEZE_WINDOW} баров в ${percentile.toFixed(0)}-м перцентиле за ${bars.length} баров — ${verdict}`,
  }
}

// ---------------------------------------------------------------------------
// 5. oiRegime
// ---------------------------------------------------------------------------

/** Что означает пара «куда пошла цена» × «куда пошёл открытый интерес». */
function regimeName(priceUp: boolean, oiUp: boolean): string {
  if (priceUp) return oiUp ? 'набор лонгов' : 'закрытие шортов'
  return oiUp ? 'набор шортов' : 'вынос лонгов'
}

/**
 * Открытый интерес против часовой давности вместе с ходом цены. Один только рост
 * OI ничего не говорит: те же +10% означают заход новых денег на росте и набор
 * шортов на падении. Смысл появляется только в паре с ценой.
 */
export function oiRegimeMetric(input: MetricInput): Metric {
  const pastOi = fromArchive(input, OI_LOOKBACK_MIN, SNAP_OI)
  const pastPx = fromArchive(input, OI_LOOKBACK_MIN, SNAP_PX)
  if (pastOi === null || pastPx === null || pastOi <= 0 || pastPx <= 0) {
    return silent(
      'oiRegime',
      `открытый интерес: нужен архив за час, есть ${hours(input.archive.coverageHours)}`,
    )
  }
  const oiChange = (input.ctx.openInterest - pastOi) / pastOi
  const priceChange = (input.ctx.markPx - pastPx) / pastPx
  const regime = regimeName(priceChange >= 0, oiChange >= 0)
  return {
    key: 'oiRegime',
    value: oiChange,
    score: ramp(Math.abs(oiChange), OI_MIN_CHANGE, OI_FULL_CHANGE),
    text: `открытый интерес ${signedPct(oiChange, 1)} за час, цена ${signedPct(priceChange, 1)} — ${regime}`,
  }
}

// ---------------------------------------------------------------------------
// 6. funding
// ---------------------------------------------------------------------------

/**
 * Уровень ставки и её ход за 4 часа.
 *
 * Правильное сравнение — с собственным 30-дневным распределением монеты: у одних
 * перпов перекос это норма, у других событие. Такого архива нет, поэтому сравниваем
 * с базовой ставкой Hyperliquid и говорим об этом в тексте прямо. Уровень ставки
 * при этом известен точно — молчать тут не о чем, врать нельзя только о базе сравнения.
 */
export function fundingMetric(input: MetricInput): Metric {
  const funding = input.ctx.funding
  const ratio = Math.abs(funding) / HL_BASE_FUNDING_HOURLY
  const past = fromArchive(input, FUNDING_LOOKBACK_MIN, SNAP_FUNDING)
  const drift = past === null
    ? `изменение за 4 ч: нужен архив, есть ${hours(input.archive.coverageHours)}`
    : `за 4 ч ${signed((funding - past) * 100, 4)} п.п.`
  return {
    key: 'funding',
    value: funding,
    score: ramp(ratio, FUNDING_HOT_RATIO, FUNDING_FULL_RATIO),
    text: `фандинг ${signed(funding * 100, 4)}% в час = ${ratio.toFixed(1)}× базы Hyperliquid (сравнение с базой, а не с историей монеты), ${drift}`,
  }
}

// ---------------------------------------------------------------------------
// 7. strength
// ---------------------------------------------------------------------------

/**
 * Отрыв монеты от BTC и от медианы рынка. Рост на 3% ничего не значит, если весь
 * рынок вырос на 3%: событие — это когда монета идёт своей дорогой.
 */
export function strengthMetric(input: MetricInput): Metric {
  const coin1h = returnOver(input.bars, STRENGTH_1H_BARS)
  const btc1h = returnOver(input.btcBars, STRENGTH_1H_BARS)
  if (coin1h === null || btc1h === null) {
    return silent('strength', `относительная сила: мало баров (монета ${input.bars.length}, BTC ${input.btcBars.length})`)
  }
  const vsBtcPp = (coin1h - btc1h) * 100
  const vsMedianPp = (coin1h - input.universeMedian1h) * 100

  const coin4h = returnOver(input.bars, STRENGTH_4H_BARS)
  const btc4h = returnOver(input.btcBars, STRENGTH_4H_BARS)
  const tail = coin4h === null || btc4h === null
    ? 'за 4 ч: мало баров'
    : `за 4 ч ${signed((coin4h - btc4h) * 100, 1)} п.п. к BTC`
  return {
    key: 'strength',
    value: vsBtcPp,
    score: ramp(Math.abs(vsBtcPp), STRENGTH_MIN_PP, STRENGTH_FULL_PP),
    text: `за час ${signed(vsBtcPp, 1)} п.п. к BTC, ${signed(vsMedianPp, 1)} п.п. к медиане рынка; ${tail}`,
  }
}

// ---------------------------------------------------------------------------
// 8. whaleFlow
// ---------------------------------------------------------------------------

/**
 * Приток китовых денег за час относительно суточного оборота. Абсолютные доллары
 * несравнимы между монетами: миллион в BTC незаметен, в мелком перпе — это весь
 * рынок. Оборот приводит разные монеты к одной шкале.
 */
export function whaleFlowMetric(input: MetricInput): Metric {
  const { whales, ctx } = input
  if (!whales) {
    return silent('whaleFlow', 'поток китов: нет архива китовых позиций за это окно')
  }
  if (!(ctx.dayNtlVlm > 0)) {
    return silent('whaleFlow', 'поток китов: суточный оборот неизвестен, не с чем сравнивать')
  }
  const share = whales.h1 / ctx.dayNtlVlm
  return {
    key: 'whaleFlow',
    value: share,
    score: ramp(Math.abs(share), WHALE_MIN_SHARE, WHALE_FULL_SHARE),
    text: `киты ${fmtUsd(whales.h1)} за час = ${signedPct(share, 2)} суточного оборота (за 15 мин ${fmtUsd(whales.m15)})`,
  }
}

// ---------------------------------------------------------------------------

/** Все восемь метрик в стабильном порядке. Молчащие остаются в списке — тому,
 * кто читает пинг, важно видеть, что метрику не забыли, а не смогли посчитать. */
export function metricsFor(input: MetricInput): Metric[] {
  return [
    rvolMetric(input),
    impulseMetric(input),
    breakoutMetric(input),
    squeezeMetric(input),
    oiRegimeMetric(input),
    fundingMetric(input),
    strengthMetric(input),
    whaleFlowMetric(input),
  ]
}
