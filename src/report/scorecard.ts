// Табель триггеров: чем обернулись пинги сканера.
//
// Стороны мы НЕ меряем. У половины метрик направления нет вовсе (у сжатия его не
// существует), у фандинга оно двусмысленно. Радар нужен для другого вопроса:
// после пинга рынок ПОШЁЛ или простоял. Отсюда основная величина — абсолютное
// движение цены на горизонте, в процентах, без знака.
//
// И только против контрольной группы. Кандидаты, не прошедшие порог, пишутся в тот
// же журнал: это готовая контрольная выборка того же окна и того же универсума.
// Без неё «после пинга цена прошла 1.2%» — не факт, а число без масштаба: рынок
// в тот час мог проходить столько же вообще везде.

import { readFile } from 'node:fs/promises'
import { fetchCandles, mapWithConcurrency, type Candle } from '../hl.js'
import { dayFile } from '../store/ndjson.js'
import { fmtPct } from '../text/caption.js'

const MS_PER_SECOND = 1000
const MS_PER_DAY = 86_400_000
const SECONDS_PER_HOUR = 3600

/**
 * Свечи 15m. Самый короткий горизонт табеля — те же 15 минут, и мерить его надо
 * ровно одним баром: на часовых он бы не существовал, на минутных сутки истории
 * стоили бы 1440 баров на монету вместо 96.
 */
const BAR_INTERVAL = '15m'
const BAR_SEC = 15 * 60

/**
 * Больше пяти параллельных запросов свечей к Hyperliquid не идём: лимит — 1200
 * единиц веса в минуту на IP, и табель не имеет права мешать живой записи рынка,
 * которая крутится в том же процессе.
 */
const MAX_CANDLE_CONCURRENCY = 5

/**
 * Порог доверия к табелю: ниже него отчёт обязан прямо сказать, что выводов
 * делать нельзя.
 *
 * Двадцать взято не из таблицы значимости — до значимости здесь в любом случае
 * далеко. Это граница влияния одного выброса: любое единичное наблюдение сдвигает
 * среднее ровно на 1/n своей величины. При пяти пингах один шальной памп тянет
 * средний ход на пятую часть себя и в одиночку определяет вывод; при двадцати —
 * на двадцатую, и картину задаёт уже масса наблюдений, а не самое яркое из них.
 * Двадцать — первое n, при котором вклад одного случая падает ниже 5%.
 */
export const MIN_OBSERVATIONS = 20

/** Строка журнала сканера. Пинг — то, что прошло порог; кандидат — то, что мерили. */
export interface ScanEvent {
  /** секунды UTC */
  readonly t: number
  readonly kind: 'alert' | 'candidate'
  readonly coin: string
  /** цена в момент события — точка отсчёта движения */
  readonly px: number
  readonly score: number
  readonly top: readonly string[]
}

export interface Outcome {
  readonly event: ScanEvent
  /** абсолютное движение от цены пинга, в процентах; null если горизонт ещё не наступил */
  readonly m15: number | null
  readonly m1h: number | null
  readonly m4h: number | null
  readonly m24h: number | null
}

export interface Horizon {
  readonly key: '15м' | '1ч' | '4ч' | '24ч'
  /** сколько пингов дозрело до этого горизонта */
  readonly matured: number
  /** среднее абсолютное движение пингов, % */
  readonly alertMove: number | null
  /** то же по контрольной группе */
  readonly controlMove: number | null
  /** сколько кандидатов в контрольной группе дозрело */
  readonly controlMatured: number
}

export interface MetricTally {
  readonly key: string
  readonly alerts: number
  readonly avg1h: number | null
}

export interface Scorecard {
  readonly alerts: number
  /** размер контрольной группы: кандидаты окна, НЕ ставшие пингами */
  readonly candidates: number
  readonly horizons: readonly Horizon[]
  readonly byMetric: readonly MetricTally[]
  /** true, если наблюдений слишком мало, чтобы вообще что-то утверждать */
  readonly tooFew: boolean
}

/** Горизонты и способ достать их из Outcome — один список, чтобы порядок не разъезжался. */
const HORIZONS: readonly { readonly key: Horizon['key'], readonly pick: (outcome: Outcome) => number | null }[] = [
  { key: '15м', pick: (outcome) => outcome.m15 },
  { key: '1ч', pick: (outcome) => outcome.m1h },
  { key: '4ч', pick: (outcome) => outcome.m4h },
  { key: '24ч', pick: (outcome) => outcome.m24h },
]

// ─── чтение журнала ──────────────────────────────────────────────────────────

/** Строка журнала, которой нельзя доверять, просто выбрасывается: файл пишется live. */
function parseEvent(line: string): ScanEvent | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const { t, kind, coin, px, score } = record
  if (kind !== 'alert' && kind !== 'candidate') return null
  if (typeof t !== 'number' || !Number.isFinite(t)) return null
  if (typeof coin !== 'string' || coin === '') return null
  if (typeof px !== 'number' || !Number.isFinite(px)) return null
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  // Поля available/total есть только у кандидатов — на них тут ничего не строится.
  const top = Array.isArray(record.top) ? record.top.filter((key): key is string => typeof key === 'string') : []
  return { t, kind, coin, px, score, top }
}

/**
 * События окна [fromSec, toSec]. Файлы журнала режутся по суткам UTC, а окно почти
 * всегда пересекает полночь — читаем все задетые дни, иначе тихо теряется начало.
 */
async function readEvents(fromSec: number, toSec: number): Promise<ScanEvent[]> {
  const toMs = toSec * MS_PER_SECOND
  const paths = new Set<string>()
  for (let ms = fromSec * MS_PER_SECOND; ms <= toMs; ms += MS_PER_DAY) paths.add(dayFile('events', ms))
  paths.add(dayFile('events', toMs))

  const perFile = await Promise.all([...paths].map(async (path) => {
    // Файла за этот день может не быть — регистратор мог не работать. Это не ошибка.
    const text = await readFile(path, 'utf8').catch(() => '')
    return text.split('\n')
      .flatMap((line) => {
        if (line.trim() === '') return []
        const event = parseEvent(line)
        return event === null || event.t < fromSec || event.t > toSec ? [] : [event]
      })
  }))
  return perFile.flat()
}

// ─── движение цены ───────────────────────────────────────────────────────────

/**
 * Абсолютное движение цены от события до горизонта, в процентах.
 *
 * null — если горизонт ещё не наступил. Ноль сказал бы «цена простояла», а это
 * совсем другое утверждение, чем «мы пока не знаем»; смешивать их — значит
 * разбавлять средний ход нулями и занижать его тем сильнее, чем свежее события.
 */
function moveAfter(event: ScanEvent, bars: readonly Candle[], horizonSec: number): number | null {
  if (event.px <= 0) return null
  const horizonAt = event.t + horizonSec
  // Нужен бар, ВНУТРЬ которого попадает момент горизонта: он открылся раньше и
  // закрылся не раньше. Просто «первый закрывшийся после» подобрал бы через дыру
  // в свечах бар на шесть часов позже и выдал бы его ход за ход «за 15 минут».
  const bar = bars.find((candle) => candle.t < horizonAt && candle.t + BAR_SEC >= horizonAt)
  if (bar === undefined || !Number.isFinite(bar.c)) return null
  return Math.abs(bar.c / event.px - 1) * 100
}

function outcomeFor(event: ScanEvent, bars: readonly Candle[]): Outcome {
  return {
    event,
    m15: moveAfter(event, bars, BAR_SEC),
    m1h: moveAfter(event, bars, SECONDS_PER_HOUR),
    m4h: moveAfter(event, bars, 4 * SECONDS_PER_HOUR),
    m24h: moveAfter(event, bars, 24 * SECONDS_PER_HOUR),
  }
}

/**
 * Свечи по каждой монете — ОДИН раз на монету, дальше переиспользуются для всех её
 * событий и всех горизонтов. Иначе 340 событий превратились бы в 340 запросов.
 * Монета, чьи свечи не пришли, остаётся с пустым рядом: её события дадут null по
 * всем горизонтам и просто не попадут ни в одно среднее.
 */
async function loadBars(events: readonly ScanEvent[], nowMs: number): Promise<Map<string, readonly Candle[]>> {
  const coins = [...new Set(events.map((event) => event.coin))]
  const loaded = await mapWithConcurrency(coins, MAX_CANDLE_CONCURRENCY, async (coin) => {
    const earliest = Math.min(...events.filter((event) => event.coin === coin).map((event) => event.t))
    // На бар раньше самого раннего события: бар, в котором событие случилось, нужен целиком.
    const bars = await fetchCandles(coin, BAR_INTERVAL, earliest - BAR_SEC, nowMs).catch((): Candle[] => [])
    return [coin, [...bars].sort((a, b) => a.t - b.t)] as const
  })
  return new Map<string, readonly Candle[]>(loaded)
}

// ─── свод ────────────────────────────────────────────────────────────────────

/** Среднее без NaN: пустой список — это «не измерено», а не ноль. */
function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function maturedMoves(outcomes: readonly Outcome[], pick: (outcome: Outcome) => number | null): number[] {
  return outcomes.flatMap((outcome) => {
    const move = pick(outcome)
    return move === null ? [] : [move]
  })
}

/** Ключ события: пинг и его строка-кандидат совпадают и по монете, и по секунде. */
function keyOf(event: ScanEvent): string {
  return `${event.coin}@${event.t}`
}

function tallyByMetric(outcomes: readonly Outcome[]): MetricTally[] {
  const keys = [...new Set(outcomes.flatMap((outcome) => outcome.event.top))]
  return keys
    .map((key) => {
      const hits = outcomes.filter((outcome) => outcome.event.top.includes(key))
      return { key, alerts: hits.length, avg1h: mean(maturedMoves(hits, (outcome) => outcome.m1h)) }
    })
    .sort((a, b) => b.alerts - a.alerts || a.key.localeCompare(b.key))
}

export async function buildScorecard(hours: number, nowMs: number = Date.now()): Promise<Scorecard> {
  const nowSec = Math.floor(nowMs / MS_PER_SECOND)
  const fromSec = nowSec - Math.max(0, hours) * SECONDS_PER_HOUR
  const events = await readEvents(fromSec, nowSec)

  const alerts = events.filter((event) => event.kind === 'alert')
  // Кандидат пишется в журнал ДО решения об отправке, поэтому у каждого пинга есть
  // строка-двойник с той же монетой и той же секундой. Оставить её в контроле —
  // значит сравнить пинги с выборкой, в которую они сами входят, и заранее
  // подтянуть контроль к результату пингов.
  const alertKeys = new Set(alerts.map(keyOf))
  const control = events.filter((event) => event.kind === 'candidate' && !alertKeys.has(keyOf(event)))

  const bars = await loadBars([...alerts, ...control], nowMs)
  const outcomeOf = (event: ScanEvent): Outcome => outcomeFor(event, bars.get(event.coin) ?? [])
  const alertOutcomes = alerts.map(outcomeOf)
  const controlOutcomes = control.map(outcomeOf)

  const horizons = HORIZONS.map(({ key, pick }): Horizon => {
    const alertMoves = maturedMoves(alertOutcomes, pick)
    const controlMoves = maturedMoves(controlOutcomes, pick)
    return {
      key,
      matured: alertMoves.length,
      alertMove: mean(alertMoves),
      controlMove: mean(controlMoves),
      controlMatured: controlMoves.length,
    }
  })

  return {
    alerts: alerts.length,
    candidates: control.length,
    horizons,
    byMetric: tallyByMetric(alertOutcomes),
    tooFew: alerts.length < MIN_OBSERVATIONS,
  }
}

// ─── печать ──────────────────────────────────────────────────────────────────

const NO_DATA = '—'
const COL_GAP = '   '

/**
 * У абсолютного движения нет знака, а fmtPct всегда ставит «+» — здесь плюс намекал
 * бы на сторону, которую табель принципиально не меряет. Формат тот же, единственный
 * в проекте; снимается только ведущий знак.
 */
function fmtMove(value: number | null): string {
  return value === null ? NO_DATA : fmtPct(value).replace(/^\+/u, '')
}

/** «1.2% (6)» — процент бессмыслен без числа наблюдений за ним, поэтому они в одной ячейке. */
function cell(move: number | null, matured: number): string {
  return `${fmtMove(move)} (${matured})`
}

function table(rows: readonly (readonly string[])[]): string[] {
  const width = (index: number): number => Math.max(...rows.map((row) => (row[index] ?? '').length))
  return rows.map((row) => `  ${row.map((text, index) => text.padEnd(width(index))).join(COL_GAP)}`.trimEnd())
}

export function renderScorecard(card: Scorecard): string {
  // Пингов не было — таблица горизонтов из одних прочерков создавала бы впечатление
  // проделанной работы там, где не измерено ничего. Её тут нет.
  if (card.alerts === 0) {
    return [
      'Пингов за окно не было — мерить нечего, выводов делать не из чего.',
      `Кандидатов в журнале ${card.candidates}, порог не прошёл ни один.`,
    ].join('\n')
  }

  const blocks: string[] = []
  if (card.tooFew) {
    blocks.push(`Наблюдений мало: пингов ${card.alerts}, а нужно хотя бы ${MIN_OBSERVATIONS}.`
      + ' Выводов по такой выборке делать нельзя — проценты ниже это иллюстрация, а не измерение.')
  }
  blocks.push(`Пингов ${card.alerts} · кандидатов мимо порога ${card.candidates}`)

  blocks.push(['ХОД ЦЕНЫ ПОСЛЕ СОБЫТИЯ — среднее по модулю, в любую сторону',
    ...table([
      ['горизонт', 'пинги', 'контроль'],
      ...card.horizons.map((horizon) => [
        horizon.key,
        cell(horizon.alertMove, horizon.matured),
        cell(horizon.controlMove, horizon.controlMatured),
      ]),
    ])].join('\n'))

  blocks.push('  В скобках — сколько наблюдений дозрело до горизонта.\n'
    + '  Контроль — кандидаты того же окна и того же универсума, не прошедшие порог.\n'
    + '  Без сравнения с ними «после пинга цена прошла столько-то» не значит ничего.')

  if (card.byMetric.length > 0) {
    blocks.push(['ЧТО СТОЯЛО В ПИНГЕ — метрики из top, ход за 1ч',
      ...table([
        ['метрика', 'пингов', 'ход за 1ч'],
        ...card.byMetric.map((metric) => [metric.key, String(metric.alerts), fmtMove(metric.avg1h)]),
      ])].join('\n'))
  }

  return blocks.join('\n\n')
}
