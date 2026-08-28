// Прогон сканера: грубый проход по всему рынку, метрики по кандидатам, скор,
// бюджет пингов, отправка карточки.
//
// В журнал пишется КАЖДЫЙ кандидат — и отправленный, и отвергнутый, с причиной.
// Без этого табель триггеров построить не на чем: узнать, чего стоил сигнал,
// можно только сравнив то, что отправили, с тем, что промолчали.

import { fetchAssetCtxs, fetchCandles, type AssetCtx, type Candle } from '../hl.js'
import { markup } from '../ta/index.js'
import { chartHtml } from '../render/chart.js'
import { renderHtml } from '../render/png.js'
import { loadSeries, valueAt, whaleFlow, type ArchiveView } from './archive.js'
import { metricsFor } from './metrics.js'
import { scoreOf, ALERT_THRESHOLD, type Scored } from './score.js'
import { canAlert, register, EMPTY_ALERT_STATE, type AlertState } from './budget.js'
import { isMuted, loadTuning } from './tuning.js'
import { appendLine, dayFile, readJson, writeJson, STATE_DIR } from '../store/ndjson.js'
import { redact } from '../redact.js'
import { join } from 'node:path'

/** Монеты тоньше этого дают громкие проценты на пустом месте. */
const MIN_DAY_VOLUME_USD = 5_000_000
/** Сколько монет отбирается по движению — быстрая реакция на события. */
const SHORTLIST_BY_MOVE = 12
/**
 * Сколько монет добирается круговым обходом.
 *
 * Без этого канала метрика сжатия мертва по построению: список по движению
 * ищет тех, кто ходит, а сжатие загорается ровно наоборот — когда монета
 * стоит. Замер 28.08.2026: лучший скор рынка был у монеты, которая в список по
 * движению не попала вовсе. Круг гарантирует, что каждая монета получает
 * полный набор метрик примерно раз в полчаса.
 */
const SHORTLIST_BY_ROTATION = 8
/** Меньше трёх измеренных метрик — скор недостоверен, что бы он ни показывал. */
const MIN_AVAILABLE_METRICS = 3
const BARS = 200
const TF = '15m'
const TF_SECONDS = 900
const CHART_WIDTH = 1440
const CHART_HEIGHT = 1800

const ALERT_STATE_PATH = join(STATE_DIR, 'alert-state.json')
const CURSOR_PATH = join(STATE_DIR, 'scan-cursor.json')

export interface Candidate {
  readonly coin: string
  readonly scored: Scored
  readonly ctx: AssetCtx
  readonly bars: readonly Candle[]
}

export interface ScanOutcome {
  readonly checked: number
  readonly shortlisted: number
  readonly passed: number
  readonly sent: number
  /** монета → почему не отправили; пусто, если отправили */
  readonly skipped: Record<string, string>
}

/** Изменение цены за час по архиву, долей. null — архива не хватает. */
function change1h(archive: ArchiveView, coin: string, now: AssetCtx): number | null {
  const past = valueAt(archive.at(60), coin, 0)
  if (past === null || past <= 0) return null
  return now.markPx / past - 1
}

/**
 * Грубый проход. Свечи стоят запросов, поэтому сперва отбираем по тому, что уже
 * есть в одном срезе рынка и в архиве: ход цены за час и дельта открытого
 * интереса. Дальше платим за свечи только по коротком списку.
 */
function shortlist(ctxs: readonly AssetCtx[], archive: ArchiveView, cursor: number): {
  picks: AssetCtx[]
  nextCursor: number
} {
  const liquid = ctxs
    .filter((ctx) => ctx.dayNtlVlm >= MIN_DAY_VOLUME_USD)
    .sort((a, b) => a.coin.localeCompare(b.coin))

  const byMove = [...liquid]
    .map((ctx) => {
      const move = Math.abs(change1h(archive, ctx.coin, ctx) ?? 0)
      const oiPast = valueAt(archive.at(60), ctx.coin, 2)
      const oiMove = oiPast !== null && oiPast > 0 ? Math.abs(ctx.openInterest / oiPast - 1) : 0
      return { ctx, rank: move + oiMove }
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, SHORTLIST_BY_MOVE)
    .map((item) => item.ctx)

  const chosen = new Map(byMove.map((ctx) => [ctx.coin, ctx]))
  let position = liquid.length === 0 ? 0 : cursor % liquid.length
  for (let step = 0; step < SHORTLIST_BY_ROTATION && liquid.length > 0; step += 1) {
    const ctx = liquid[position % liquid.length]
    if (ctx !== undefined) chosen.set(ctx.coin, ctx)
    position += 1
  }
  return { picks: [...chosen.values()], nextCursor: position }
}

/** Медианное часовое изменение по универсуму — на его фоне и видно силу монеты. */
function universeMedian1h(ctxs: readonly AssetCtx[], archive: ArchiveView): number {
  const moves: number[] = []
  for (const ctx of ctxs) {
    const move = change1h(archive, ctx.coin, ctx)
    if (move !== null) moves.push(move)
  }
  if (moves.length === 0) return 0
  moves.sort((a, b) => a - b)
  const middle = Math.floor(moves.length / 2)
  return moves.length % 2 === 0
    ? ((moves[middle - 1] ?? 0) + (moves[middle] ?? 0)) / 2
    : moves[middle] ?? 0
}

export async function loadAlertState(): Promise<AlertState> {
  return readJson<AlertState>(ALERT_STATE_PATH, EMPTY_ALERT_STATE)
}

export interface Notifier {
  send(coin: string, photoPath: string, caption: string): Promise<void>
}

export async function scanOnce(notify: Notifier | null, nowMs: number = Date.now()): Promise<ScanOutcome> {
  const ctxs = await fetchAssetCtxs()
  const archive = await loadSeries(6, nowMs)
  const cursorState = await readJson<{ position: number }>(CURSOR_PATH, { position: 0 })
  const { picks, nextCursor } = shortlist(ctxs, archive, cursorState.position)
  await writeJson(CURSOR_PATH, { position: nextCursor })
  const median = universeMedian1h(ctxs, archive)
  const nowSec = Math.floor(nowMs / 1000)
  const btcBars = await fetchCandles('BTC', TF, nowSec - TF_SECONDS * BARS, nowMs)

  let state = await loadAlertState()
  // Настройки перечитываются на каждом тике: команда из чата приходит в другой
  // процесс, и держать их в памяти значило бы не услышать владельца вовсе.
  const tuning = await loadTuning()
  const threshold = tuning.threshold ?? ALERT_THRESHOLD
  const skipped: Record<string, string> = {}
  let passed = 0
  let sent = 0

  for (const ctx of picks) {
    const bars = await fetchCandles(ctx.coin, TF, nowSec - TF_SECONDS * BARS, nowMs).catch(() => [])
    if (bars.length < 50) {
      skipped[ctx.coin] = 'мало закрытых баров'
      continue
    }
    const whales = await whaleFlow(ctx.coin, nowMs).catch(() => null)
    const metrics = metricsFor({
      coin: ctx.coin, bars, ctx, archive, btcBars, universeMedian1h: median, whales,
    })
    const scored = scoreOf(metrics)

    // Журнал пишется ДО решения об отправке: отвергнутый кандидат нужен табелю
    // ровно так же, как отправленный.
    await appendLine(dayFile('events', nowMs), {
      t: nowSec, kind: 'candidate', coin: ctx.coin, px: ctx.markPx,
      score: Number(scored.score.toFixed(3)), available: scored.available, total: scored.total,
      top: scored.top.map((metric) => metric.key),
    })

    if (scored.available < MIN_AVAILABLE_METRICS) {
      skipped[ctx.coin] = `измерено метрик ${scored.available}, скор недостоверен`
      continue
    }
    if (scored.score < threshold) {
      skipped[ctx.coin] = `скор ${scored.score.toFixed(2)} ниже порога ${threshold.toFixed(2)}`
      continue
    }
    if (isMuted(tuning, ctx.coin, nowMs)) {
      skipped[ctx.coin] = 'монета заглушена владельцем'
      continue
    }
    passed += 1

    const permission = canAlert(state, ctx.coin, nowMs)
    if (!permission.ok) {
      skipped[ctx.coin] = permission.reason
      continue
    }
    if (notify === null) {
      skipped[ctx.coin] = 'отправка выключена (сухой прогон)'
      continue
    }

    try {
      const daily = await fetchCandles(ctx.coin, '1d', nowSec - 3 * 86_400, nowMs).catch(() => [])
      const html = chartHtml({
        coin: ctx.coin, interval: TF, bars, markup: markup(bars, daily.at(-1)),
        width: CHART_WIDTH, height: CHART_HEIGHT,
      })
      const photo = await renderHtml(html, join(STATE_DIR, `alert-${ctx.coin}.png`), '#wrap', `${ctx.coin} ${TF}`)
      await notify.send(ctx.coin, photo, alertCaption(ctx, scored))
      state = register(state, ctx.coin, nowMs)
      await writeJson(ALERT_STATE_PATH, state)
      await appendLine(dayFile('events', nowMs), {
        t: nowSec, kind: 'alert', coin: ctx.coin, px: ctx.markPx,
        score: Number(scored.score.toFixed(3)), top: scored.top.map((metric) => metric.key),
      })
      sent += 1
    } catch (error) {
      skipped[ctx.coin] = `не отправил: ${redact(error instanceof Error ? error.message : String(error))}`
    }
  }

  return { checked: ctxs.length, shortlisted: picks.length, passed, sent, skipped }
}

/** Подпись пинга: что сработало, цифрами. Никаких «покупай» и «сильный сигнал». */
export function alertCaption(ctx: AssetCtx, scored: Scored): string {
  const lines = [`${ctx.coin} · ${ctx.markPx}`, '']
  for (const metric of scored.top) lines.push(`· ${metric.text}`)
  lines.push('')
  lines.push(`Скор ${scored.score.toFixed(2)} по ${scored.available} измеренным метрикам из ${scored.total}.`)
  if (scored.available < scored.total) {
    const silent = scored.total - scored.available
    lines.push(`Молчат ${silent}: архива пока не хватает, они в скор не входят.`)
  }
  lines.push('Это факт с цифрами, а не рекомендация.')
  return lines.join('\n')
}
