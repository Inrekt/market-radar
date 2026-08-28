// Дайджест за период: утренний «что было ночью» и вечерний «итог дня» — это один
// и тот же расчёт, разными у них остаются только окно и заголовок. Считается всё
// по архиву в state/; в сеть модуль ходит ровно один раз — за текущим срезом
// рынка, потому что фандинг «сейчас» из вчерашних снимков не достаётся.
//
// Правило файла — честность про объём данных. Раздел, которому не хватило записей,
// исчезает целиком вместе с заголовком: строка с прочерками выглядит как измерение
// и им не является. Каждый напечатанный раздел говорит, сколько наблюдений за ним
// стоит, потому что проценты, посчитанные по трём случаям, — худший вид вранья
// в таком инструменте: они неотличимы от знания.

import { readFile } from 'node:fs/promises'

import { fetchAssetCtxs, type AssetCtx } from '../hl.js'
import { dayFile, utcDay } from '../store/ndjson.js'
import { fmtMoney, fmtPct, fmtPrice } from '../text/caption.js'

export interface DigestInput {
  readonly hours: number
  /** «Что было ночью» / «Итог дня» — печатается первой строкой как есть. */
  readonly title: string
  readonly nowMs?: number
}

export interface Digest {
  readonly title: string
  /** Реальный размах записи рынка в часах, а не запрошенное окно. */
  readonly coveredHours: number
  readonly text: string
}

const SEC_PER_HOUR = 3600
const MS_PER_SEC = 1000
const MS_PER_DAY = 86_400_000
const MIN_PER_HOUR = 60
const PCT_PER_UNIT = 100
const HOURS_PER_YEAR = 24 * 365 // фандинг у Hyperliquid часовой — годовые считаются отсюда
const TOP_N = 3 // четвёртая строка в списке уже не меняет впечатления от раздела

// Ниже этого суточного оборота свечи пустые: одна сделка рисует «+40% за ночь»,
// и неликвид вытесняет из лидеров весь настоящий рынок. Порог общий для всех
// рейтингов дайджеста — монету, которую нельзя купить, незачем ставить в топ.
const MIN_TURNOVER_USD = 5_000_000

// Базовая часовая ставка Hyperliquid: от неё читатель отсчитывает, дорого ли
// сейчас держать позицию. Без этой опоры «+0.045%/час» не значит ничего.
const HL_BASE_FUNDING = 0.0000125
const FUNDING_DECIMALS = 4 // часовая ставка живёт в тысячных процента, трёх знаков мало

const SNAPSHOT_PERIOD_MIN = 5 // формат архива фиксирован: снимок рынка раз в 5 минут
// Края окна почти никогда не попадают ровно в снимок, поэтому размах всегда чуть
// короче запрошенного. Три шага записи — это сетка, а не пробел в архиве.
const COVERAGE_SLACK_HOURS = (SNAPSHOT_PERIOD_MIN * 3) / MIN_PER_HOUR
// Если снимков меньше этой доли от ожидаемых, размах врёт: внутри окна дыры,
// и «архив 8 ч» означает две точки на краях, а не восемь часов наблюдения.
const MIN_SNAPSHOT_SHARE = 0.8

// Меньше десяти наблюдений — не выборка: один случай двигает любую долю на
// десятки процентов. Такой раздел печатает счёт и прямо говорит, что выводов нет.
const SMALL_SAMPLE = 10

// Движение мельче половины процента за часы — это спред и округление, а не
// направление. Называть его «набирают лонги» значило бы читать подброшенную монету.
const FLAT_PRICE_PCT = 0.5

// Дальше недели дайджест никто не читает, а цикл по суткам перестаёт быть дешёвым:
// ограничение защищает и от опечатки в часах, и от тысячи чтений несуществующих файлов.
const MAX_WINDOW_HOURS = 24 * 7

// Дальше этой отметки Date.toISOString бросает RangeError — мусорный t из архива
// не должен ронять весь дайджест.
const MAX_TIME_MS = 8.64e15

// Порядок полей в снимке фиксирован форматом записи: [цена, фандинг, OI, оборот].
const PX = 0
const FUNDING = 1
const OI = 2
const TURNOVER = 3

const COL_GAP = '   '
const ROW_INDENT = '  '
const SUB_INDENT = '    '
// Числа равняем по правому краю, слова — по левому: столбец процентов тогда
// читается по знаку и порядку величины, а не по длине строки.
const NUMERIC_START = /^[+\-−$0-9]/

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function fmtHours(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0
  const rounded = Math.round(safe * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} ч`
}

/** Сутки архива нарезаны по UTC — время в шапке показываем в нём же. */
function fmtUtc(sec: number): string {
  const ms = sec * MS_PER_SEC
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_TIME_MS) return '—'
  const iso = new Date(ms).toISOString()
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)} ${iso.slice(11, 16)} UTC`
}

/** Единственный денежный формат берём из caption.ts, здесь только знак к нему. */
function fmtSignedMoney(value: number): string {
  return value > 0 ? `+${fmtMoney(value)}` : fmtMoney(value)
}

function aligned(rows: readonly (readonly string[])[], indent: string): string[] {
  if (rows.length === 0) return []
  const width = (i: number): number => Math.max(...rows.map((row) => (row[i] ?? '').length))
  return rows.map((row) => {
    const cells = row.map((cell, i) => (NUMERIC_START.test(cell) ? cell.padStart(width(i)) : cell.padEnd(width(i))))
    return `${indent}${cells.join(COL_GAP)}`.trimEnd()
  })
}

// ——— чтение архива ———

/**
 * Свёртка по строкам суточных NDJSON-файлов за окно. Свёртка, а не массив:
 * снимок рынка — это 232 монеты, и держать сутки таких снимков в памяти незачем,
 * когда каждому разделу нужны только края окна и счётчики.
 */
async function reduceRecords<A>(
  kind: string,
  fromMs: number,
  toMs: number,
  seed: A,
  step: (acc: A, record: Record<string, unknown>, t: number) => A,
): Promise<A> {
  const fromSec = Math.floor(fromMs / MS_PER_SEC)
  const toSec = Math.ceil(toMs / MS_PER_SEC)
  let acc = seed
  for (const path of windowDayFiles(kind, fromMs, toMs)) {
    let content: string
    try {
      content = await readFile(path, 'utf8')
    } catch {
      continue // файла за эти сутки нет — сборщик тогда не работал, это не ошибка
    }
    for (const line of content.split('\n')) {
      if (line.trim() === '') continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        continue // одна битая строка не должна стоить нам всего дня архива
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue
      const record = parsed as Record<string, unknown>
      const t = num(record.t)
      if (t === null || t < fromSec || t > toSec) continue
      acc = step(acc, record, t)
    }
  }
  return acc
}

/**
 * Файлы, которых касается окно. Имена суток по UTC, окно почти всегда пересекает
 * полночь — поэтому дней всегда может быть больше одного. Хвостовой день добавляем
 * отдельно: в шаг цикла он не попадает, когда окно короче суток.
 */
function windowDayFiles(kind: string, fromMs: number, toMs: number): string[] {
  const files = new Map<string, string>()
  for (let ms = fromMs; ms <= toMs; ms += MS_PER_DAY) files.set(utcDay(ms), dayFile(kind, ms))
  files.set(utcDay(toMs), dayFile(kind, toMs))
  return [...files.values()]
}

interface SnapshotRow {
  readonly t: number
  readonly coins: Record<string, unknown>
}

interface SeriesWindow {
  readonly first: SnapshotRow | null
  readonly last: SnapshotRow | null
  readonly count: number
}

const EMPTY_SERIES: SeriesWindow = { first: null, last: null, count: 0 }

function stepSeries(acc: SeriesWindow, record: Record<string, unknown>, t: number): SeriesWindow {
  const coins = record.coins
  if (typeof coins !== 'object' || coins === null || Array.isArray(coins)) return acc
  const row: SnapshotRow = { t, coins: coins as Record<string, unknown> }
  // Края ищем сравнением времени, а не позицией в файле: окно склеивается из двух
  // суток, и порядок чтения не обязан совпадать с порядком записи.
  return {
    first: acc.first === null || t < acc.first.t ? row : acc.first,
    last: acc.last === null || t > acc.last.t ? row : acc.last,
    count: acc.count + 1,
  }
}

function spanHours(series: SeriesWindow): number {
  const { first, last } = series
  if (first === null || last === null) return 0
  return (last.t - first.t) / SEC_PER_HOUR
}

/** Поле снимка по монете: null, если монеты в снимке нет или число битое. */
function field(snapshot: SnapshotRow, coin: string, index: number): number | null {
  const row = snapshot.coins[coin]
  if (!Array.isArray(row)) return null
  return num(row[index])
}

interface WhaleWindow {
  /** монета → суммарный приток денег кита за окно, в долларах */
  readonly flow: Map<string, number>
  readonly records: number
}

function stepWhale(acc: WhaleWindow, record: Record<string, unknown>, _t: number): WhaleWindow {
  const coin = str(record.coin)
  const from = num(record.fromUsd)
  const to = num(record.toUsd)
  if (coin === null || from === null || to === null) return acc
  // Копилка строится один раз и не покидает функцию: пересобирать Map на каждой
  // из сотен записей дороже без всякой пользы для читателя.
  acc.flow.set(coin, (acc.flow.get(coin) ?? 0) + (to - from))
  return { flow: acc.flow, records: acc.records + 1 }
}

interface RadarWindow {
  readonly candidates: number
  readonly candidateCoins: Set<string>
  /** Set держит порядок появления — пинги перечисляем так, как они шли. */
  readonly alertCoins: Set<string>
  readonly alerts: number
}

function stepRadar(acc: RadarWindow, record: Record<string, unknown>, _t: number): RadarWindow {
  const kind = str(record.kind)
  const coin = str(record.coin)
  if (kind === 'candidate') {
    if (coin !== null) acc.candidateCoins.add(coin)
    return { ...acc, candidates: acc.candidates + 1 }
  }
  if (kind === 'alert') {
    if (coin !== null) acc.alertCoins.add(coin)
    return { ...acc, alerts: acc.alerts + 1 }
  }
  return acc
}

/** Единственный поход в сеть. Сорвался — раздел про фандинг просто не печатается. */
async function loadCtxs(): Promise<readonly AssetCtx[] | null> {
  try {
    return await fetchAssetCtxs()
  } catch {
    return null
  }
}

// ——— разделы ———

interface CoinChange {
  readonly coin: string
  readonly changePct: number
  readonly lastPx: number
}

/**
 * Изменение цены по монетам между краями окна. Порог ликвидности берём по свежему
 * снимку: он про сегодняшнюю торгуемость, а не про вчерашнюю.
 */
function priceChanges(first: SnapshotRow, last: SnapshotRow): CoinChange[] {
  const out: CoinChange[] = []
  for (const coin of Object.keys(last.coins)) {
    const turnover = field(last, coin, TURNOVER)
    if (turnover === null || turnover < MIN_TURNOVER_USD) continue
    const from = field(first, coin, PX)
    const to = field(last, coin, PX)
    if (from === null || to === null || from <= 0 || to <= 0) continue
    out.push({ coin, changePct: ((to - from) / from) * PCT_PER_UNIT, lastPx: to })
  }
  return out
}

function priceRows(changes: readonly CoinChange[]): string[][] {
  return changes.map((c) => [c.coin, fmtPrice(c.lastPx), fmtPct(c.changePct)])
}

function priceSection(series: SeriesWindow): string | null {
  const { first, last } = series
  if (first === null || last === null || first.t === last.t) return null
  const changes = priceChanges(first, last)
  if (changes.length === 0) return null

  const leaders = changes.toSorted((a, b) => b.changePct - a.changePct).slice(0, TOP_N)
  const laggards = changes
    .toSorted((a, b) => a.changePct - b.changePct)
    .filter((c) => !leaders.some((l) => l.coin === c.coin))
    .slice(0, TOP_N)

  const lines = ['Цены за окно', `${ROW_INDENT}Впереди:`, ...aligned(priceRows(leaders), SUB_INDENT)]
  // Монет мало — «позади» совпало бы с «впереди»: печатать одно и то же дважды хуже,
  // чем не печатать блок вовсе.
  if (laggards.length > 0) lines.push(`${ROW_INDENT}Позади:`, ...aligned(priceRows(laggards), SUB_INDENT))
  lines.push(
    `${ROW_INDENT}Сравнение двух снимков: ${fmtUtc(first.t)} → ${fmtUtc(last.t)}.`,
    `${ROW_INDENT}Монет с оборотом от ${fmtMoney(MIN_TURNOVER_USD)}: ${changes.length}.`,
  )
  return lines.join('\n')
}

function fundingRows(ctxs: readonly AssetCtx[]): string[][] {
  return ctxs.map((c) => [
    c.coin,
    `${fmtPct(c.funding * PCT_PER_UNIT, FUNDING_DECIMALS)}/час`,
    `${fmtPct(c.funding * HOURS_PER_YEAR * PCT_PER_UNIT)} годовых`,
  ])
}

function fundingSection(ctxs: readonly AssetCtx[] | null): string | null {
  if (ctxs === null) return null
  const liquid = ctxs.filter((c) => num(c.funding) !== null && (num(c.dayNtlVlm) ?? 0) >= MIN_TURNOVER_USD)
  if (liquid.length === 0) return null

  const byRate = liquid.toSorted((a, b) => b.funding - a.funding)
  const dearest = byRate.slice(0, TOP_N)
  const cheapest = byRate
    .toReversed()
    .filter((c) => !dearest.some((d) => d.coin === c.coin))
    .slice(0, TOP_N)

  const lines = ['Фандинг сейчас', `${ROW_INDENT}Дороже всего лонгу:`, ...aligned(fundingRows(dearest), SUB_INDENT)]
  if (cheapest.length > 0) lines.push(`${ROW_INDENT}Платят лонгу:`, ...aligned(fundingRows(cheapest), SUB_INDENT))
  lines.push(
    `${ROW_INDENT}База Hyperliquid — ${HL_BASE_FUNDING} в час, то есть ${fmtPct(HL_BASE_FUNDING * PCT_PER_UNIT, FUNDING_DECIMALS)}/час.`,
    `${ROW_INDENT}Это срез на сейчас, не среднее за окно. Монет с оборотом от ${fmtMoney(MIN_TURNOVER_USD)}: ${liquid.length}.`,
  )
  return lines.join('\n')
}

/**
 * Связка «OI вырос + цена выросла» читается как набор лонгов, «OI вырос + цена
 * упала» — как набор шортов. Это чтение, а не данные о сторонах: биржа не говорит,
 * кто именно встал в позицию, — поэтому оговорка печатается прямо в разделе.
 */
function oiReading(pricePct: number): string {
  if (Math.abs(pricePct) < FLAT_PRICE_PCT) return 'цена на месте — набирают обе стороны'
  return pricePct > 0 ? 'набирают лонги' : 'набирают шорты'
}

function oiSection(series: SeriesWindow): string | null {
  const { first, last } = series
  if (first === null || last === null || first.t === last.t) return null

  const grown: { coin: string; oiPct: number; pricePct: number }[] = []
  for (const coin of Object.keys(last.coins)) {
    const turnover = field(last, coin, TURNOVER)
    if (turnover === null || turnover < MIN_TURNOVER_USD) continue
    const oiFrom = field(first, coin, OI)
    const oiTo = field(last, coin, OI)
    const pxFrom = field(first, coin, PX)
    const pxTo = field(last, coin, PX)
    if (oiFrom === null || oiTo === null || oiFrom <= 0) continue
    if (pxFrom === null || pxTo === null || pxFrom <= 0) continue
    const oiPct = ((oiTo - oiFrom) / oiFrom) * PCT_PER_UNIT
    if (oiPct <= 0) continue // раздел про набор позиций; падение OI — другой сюжет
    grown.push({ coin, oiPct, pricePct: ((pxTo - pxFrom) / pxFrom) * PCT_PER_UNIT })
  }
  if (grown.length === 0) return null

  const top = grown.toSorted((a, b) => b.oiPct - a.oiPct).slice(0, TOP_N)
  const rows = top.map((r) => [r.coin, `OI ${fmtPct(r.oiPct)}`, `цена ${fmtPct(r.pricePct)}`, oiReading(r.pricePct)])
  return [
    'Открытый интерес: где набрали позиции',
    ...aligned(rows, ROW_INDENT),
    `${ROW_INDENT}OI считаем в монетах, а не в долларах: в долларах он растёт и от одной переоценки старых позиций.`,
    `${ROW_INDENT}Кто именно встал в позицию, биржа не сообщает — «лонги/шорты» здесь чтение связки OI и цены.`,
    `${ROW_INDENT}Монет с растущим OI и оборотом от ${fmtMoney(MIN_TURNOVER_USD)}: ${grown.length}.`,
  ].join('\n')
}

function whaleSection(whales: WhaleWindow): string | null {
  const entries = [...whales.flow.entries()].filter(([, usd]) => usd !== 0)
  if (entries.length === 0) return null

  const inflow = entries.filter(([, usd]) => usd > 0).toSorted((a, b) => b[1] - a[1]).slice(0, TOP_N)
  const outflow = entries.filter(([, usd]) => usd < 0).toSorted((a, b) => a[1] - b[1]).slice(0, TOP_N)
  if (inflow.length === 0 && outflow.length === 0) return null

  const rows = (list: readonly (readonly [string, number])[]): string[][] =>
    list.map(([coin, usd]) => [coin, fmtSignedMoney(usd)])

  const lines = ['Киты за окно']
  if (inflow.length > 0) lines.push(`${ROW_INDENT}Приток:`, ...aligned(rows(inflow), SUB_INDENT))
  if (outflow.length > 0) lines.push(`${ROW_INDENT}Отток:`, ...aligned(rows(outflow), SUB_INDENT))
  lines.push(
    `${ROW_INDENT}Приток — сумма изменений позиций по монете; знак стороны: лонг +, шорт −.`,
    `${ROW_INDENT}Записей о китах: ${whales.records}, монет среди них: ${whales.flow.size}.`,
  )
  if (whales.records < SMALL_SAMPLE) {
    lines.push(`${ROW_INDENT}Записей мало — это отдельные сделки, а не поток; говорить о тенденции по ним нельзя.`)
  }
  return lines.join('\n')
}

function radarSection(radar: RadarWindow): string | null {
  // Ни кандидатов, ни пингов — радар за это окно вообще не работал. Это не
  // «спокойный рынок», а отсутствие наблюдений: разделу нечего сказать.
  if (radar.candidates === 0 && radar.alerts === 0) return null

  const lines = [
    'Что делал радар',
    `${ROW_INDENT}Кандидатов рассмотрено: ${radar.candidates}, монет среди них: ${radar.candidateCoins.size}.`,
  ]
  if (radar.alerts === 0) {
    lines.push(`${ROW_INDENT}Пингов не было — рынок был спокойный. Это нормальное состояние радара, а не сбой.`)
    return lines.join('\n')
  }
  lines.push(`${ROW_INDENT}Пингов отправлено: ${radar.alerts} — ${[...radar.alertCoins].join(', ')}.`)
  if (radar.alerts < SMALL_SAMPLE) {
    lines.push(
      `${ROW_INDENT}Столько пингов — это не выборка: доли, проценты и «точность» по такому числу случаев ничего не значат.`,
    )
  }
  return lines.join('\n')
}

function header(title: string, hours: number, fromMs: number, toMs: number, series: SeriesWindow): string {
  const lines = [title, `Окно ${fmtHours(hours)}: ${fmtUtc(fromMs / MS_PER_SEC)} → ${fmtUtc(toMs / MS_PER_SEC)}`]
  // Меньше ДВУХ снимков, а не меньше одного: изменение цены и открытого
  // интереса — это разность между двумя точками. С одним снимком считать нечего,
  // и промолчать об этом хуже, чем сказать: иначе дайджест выглядит так, будто
  // за окно ничего не происходило, хотя мы просто не смотрели.
  if (series.count < 2) {
    lines.push('Записи рынка за это окно нет — разделы про цены и открытый интерес пропущены.')
    return lines.join('\n')
  }

  const span = spanHours(series)
  lines.push(
    span < hours - COVERAGE_SLACK_HOURS
      ? `Архив рынка: ${fmtHours(span)} из запрошенных ${fmtHours(hours)} — записано меньше окна, всё ниже только про этот отрезок. Снимков: ${series.count}.`
      : `Архив рынка: ${fmtHours(span)}, снимков: ${series.count}.`,
  )

  // Размах считается по краям и молчит про дыры внутри. Если снимков заметно
  // меньше, чем должно быть при записи раз в 5 минут, читатель обязан это знать.
  const expected = Math.floor((span * MIN_PER_HOUR) / SNAPSHOT_PERIOD_MIN) + 1
  if (expected >= 2 && series.count < expected * MIN_SNAPSHOT_SHARE) {
    lines.push(
      `В записи пропуски: снимков ${series.count}, а при шаге ${SNAPSHOT_PERIOD_MIN} минут ожидалось около ${expected} — размах окна шире, чем реально покрыто.`,
    )
  }
  return lines.join('\n')
}

function clampHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0
  return Math.min(hours, MAX_WINDOW_HOURS)
}

export async function buildDigest(input: DigestInput): Promise<Digest> {
  const requestedNow = input.nowMs ?? Date.now()
  const nowMs = Number.isFinite(requestedNow) ? requestedNow : Date.now()
  const hours = clampHours(input.hours)
  const fromMs = nowMs - hours * SEC_PER_HOUR * MS_PER_SEC

  const series = await reduceRecords('series', fromMs, nowMs, EMPTY_SERIES, stepSeries)
  const whales = await reduceRecords<WhaleWindow>('whales', fromMs, nowMs, { flow: new Map(), records: 0 }, stepWhale)
  const radar = await reduceRecords<RadarWindow>(
    'events',
    fromMs,
    nowMs,
    { candidates: 0, candidateCoins: new Set(), alertCoins: new Set(), alerts: 0 },
    stepRadar,
  )
  const ctxs = await loadCtxs()

  const sections = [
    header(input.title, hours, fromMs, nowMs, series),
    priceSection(series),
    fundingSection(ctxs),
    oiSection(series),
    whaleSection(whales),
    radarSection(radar),
  ].filter((section): section is string => section !== null)

  return { title: input.title, coveredHours: spanHours(series), text: sections.join('\n\n') }
}
