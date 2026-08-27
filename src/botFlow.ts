// Команда /flow — что происходит с потоком прямо сейчас.
//
// Отдельно от /ta намеренно: структура держится часами, стакан переставляют за
// секунды. На одной картинке они мешают друг другу, и карточка протухает в
// момент отправки.

import { InlineKeyboard, InputFile } from 'grammy'
import type { Bot, CallbackQueryContext, CommandContext, Context } from 'grammy'
import { fetchBook } from './hl.js'
import { readBigPrints, readBuckets } from './flow/read.js'
import { summarize, type FlowSummary } from './flow/summary.js'
import { flowChartHtml } from './render/flowChart.js'
import { renderHtml } from './render/png.js'
import { longFlowCaption, shortFlowCaption } from './text/flowCaption.js'
import { safeError } from './redact.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Mode = 'short' | 'long'

/** Окна в минутах. Больше суток нет смысла: запись столько ещё не живёт. */
const WINDOWS = [15, 60, 240] as const
type Window = (typeof WINDOWS)[number]
const DEFAULT_WINDOW: Window = 60

const WIDTH = 1440
const HEIGHT = 1800

const USAGE = 'Нужен тикер: /flow SOL. Окно переключается кнопками под карточкой.'
const CARD_LIMIT = 20
const cards = new Map<string, FlowSummary>()

export function registerFlow(bot: Bot): void {
  bot.command('flow', onFlow)
  bot.callbackQuery(/^fl:/, onCallback)
}

async function onFlow(ctx: CommandContext<Context>): Promise<void> {
  const coin = ctx.match.trim().split(/\s+/)[0]
  if (coin === undefined || coin === '') {
    await ctx.reply(USAGE)
    return
  }
  await send(ctx, coin.toUpperCase(), DEFAULT_WINDOW, 'short')
}

async function onCallback(ctx: CallbackQueryContext<Context>): Promise<void> {
  // Отвечаем сразу: часы на кнопке крутятся заметно меньше, чем идёт сборка.
  await ctx.answerCallbackQuery().catch(() => undefined)
  const parsed = parse(ctx.callbackQuery.data)
  if (parsed === null) return
  const message = ctx.callbackQuery.message
  const key = message === undefined ? null : `${message.chat.id}:${message.message_id}`
  const cached = key === null ? undefined : cards.get(key)
  // Смена только режима на той же сводке — правим подпись, картинку не трогаем.
  if (cached !== undefined && cached.coveredMinutes >= 0 && parsed.window === windowOf(cached)) {
    await switchMode(ctx, cached, parsed.mode)
    return
  }
  await send(ctx, parsed.coin, parsed.window, parsed.mode)
}

/** Окно сводки не хранится в ней самой — выводим из покрытия по ближайшему. */
function windowOf(summary: FlowSummary): Window {
  let best: Window = WINDOWS[0]
  for (const item of WINDOWS) {
    if (Math.abs(item - summary.coveredMinutes) < Math.abs(best - summary.coveredMinutes)) best = item
  }
  return best
}

async function send(ctx: Context, coin: string, window: Window, mode: Mode): Promise<void> {
  try {
    const summary = await build(coin, window)
    const html = flowChartHtml({ summary, width: WIDTH, height: HEIGHT })
    const photo = await renderHtml(html, await slotPath(), '#wrap', `поток ${coin}`)
    const sent = await ctx.replyWithPhoto(new InputFile(photo), {
      caption: caption(summary, mode),
      reply_markup: keyboard(coin, window, mode),
    })
    remember(`${sent.chat.id}:${sent.message_id}`, summary)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`поток ${coin}: ${safeError(error)}`)
    await ctx.reply(`Не смог собрать поток по ${coin}: ${reason}`).catch(() => undefined)
  }
}

async function build(coin: string, window: Window): Promise<FlowSummary> {
  const [buckets, big] = await Promise.all([readBuckets(coin, window), readBigPrints(coin, window)])
  // Стакан берём живой, а не из архива: в корзинах лежат суммы по сторонам,
  // а на лестнице нужны сами уровни, и именно на момент отправки.
  const book = await fetchBook(coin).catch(() => null)
  return summarize(coin, buckets, big, book)
}

async function switchMode(ctx: CallbackQueryContext<Context>, summary: FlowSummary, mode: Mode): Promise<void> {
  try {
    await ctx.editMessageCaption({
      caption: caption(summary, mode),
      reply_markup: keyboard(summary.coin, windowOf(summary), mode),
    })
  } catch (error) {
    // Повторное нажатие того же режима — Телеграм отвечает «message is not modified».
    console.error(`поток, смена режима ${summary.coin}: ${safeError(error)}`)
  }
}

function caption(summary: FlowSummary, mode: Mode): string {
  return mode === 'long' ? longFlowCaption(summary) : shortFlowCaption(summary)
}

function keyboard(coin: string, window: Window, mode: Mode): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const item of WINDOWS) kb.text(mark(label(item), item === window), `fl:${coin}:${item}:${mode}`)
  kb.row()
  kb.text(mark('Кратко', mode === 'short'), `fl:${coin}:${window}:short`)
  kb.text(mark('Подробно', mode === 'long'), `fl:${coin}:${window}:long`)
  return kb
}

function label(minutes: Window): string {
  return minutes < 60 ? `${minutes}м` : `${minutes / 60}ч`
}

function mark(text: string, active: boolean): string {
  return active ? `• ${text}` : text
}

function parse(data: string): { coin: string, window: Window, mode: Mode } | null {
  const [prefix, coin, rawWindow, rawMode] = data.split(':')
  if (prefix !== 'fl' || coin === undefined || coin === '') return null
  if (rawMode !== 'short' && rawMode !== 'long') return null
  const window = WINDOWS.find((item) => String(item) === rawWindow)
  return window === undefined ? null : { coin: coin.toUpperCase(), window, mode: rawMode }
}

function remember(key: string, summary: FlowSummary): void {
  cards.set(key, summary)
  if (cards.size <= CARD_LIMIT) return
  const oldest = cards.keys().next()
  if (oldest.done !== true) cards.delete(oldest.value)
}

/** Кольцо имён: пока Телеграм дочитывает файл, его имя не переиспользуется. */
const SLOTS = 6
let dir: string | null = null
let slot = 0

async function slotPath(): Promise<string> {
  const base = dir ?? (dir = await mkdtemp(join(tmpdir(), 'market-radar-flow-')))
  slot = (slot + 1) % SLOTS
  return join(base, `flow-${slot}.png`)
}
