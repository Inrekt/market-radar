// Телеграм-бот: карточка разбора монеты по запросу — картинка плюс подпись.
// Запуском управляет вызывающий код, здесь бот только собирается.

import { Bot, InlineKeyboard, InputFile } from 'grammy'
import type { CallbackQueryContext, CommandContext, Context, MiddlewareFn } from 'grammy'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchAssetCtxs, fetchCandles, type AssetCtx, type Candle } from './hl.js'
import { markup, type Markup } from './ta/index.js'
import { renderChart } from './render/png.js'
import { longCaption, shortCaption, type WhaleSummary } from './text/caption.js'
import { loadBotState, saveBotState, type BotState } from './botState.js'
import { safeError } from './redact.js'
import { registerFlow } from './botFlow.js'
import { buildScorecard, renderScorecard } from './report/scorecard.js'
import { buildDigest } from './report/digest.js'
import { activeMutes, DEFAULT_MUTE_HOURS, loadTuning, mute, saveTuning, unmute } from './scan/tuning.js'
import { ALERT_THRESHOLD } from './scan/score.js'
import { loadSeries, valueAt, whaleFlow } from './scan/archive.js'
import { readEvents } from './report/events.js'

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'] as const
type Timeframe = (typeof TIMEFRAMES)[number]
type Mode = 'short' | 'long'

const DEFAULT_TF: Timeframe = '15m'

/** Двое суток: за сутки дальние горизонты табеля ещё не дозревают. */
const SCORE_HOURS = 48
const DIGEST_HOURS = 12

/** В клавиатуре три из пяти: на 5m шум, а 1d за сеанс всё равно не поменяется. */
const QUICK_TFS: readonly Timeframe[] = ['15m', '1h', '4h']

/** 200 баров — предел, на котором свеча ещё различима в ширину картинки. */
const BARS = 200

/** Запас: биржа не рисует бары без сделок, а незакрытую fetchCandles выбрасывает. */
const BARS_MARGIN = 40

/**
 * Вертикальный кадр 4:5 — максимум высоты, который Телеграм показывает в ленте
 * без обрезки. Горизонтальный 16:9 на телефоне занимает полоску в треть экрана,
 * и свечи в ней уже не разглядеть.
 *
 * 1440 по ширине, а не 1080: телеграм всё равно пережимает фото, и запас
 * исходного разрешения — единственное, что остаётся после его сжатия. Предел
 * сервиса — сумма сторон до 10000, здесь с удвоением плотности выходит 6480.
 */
const CHART_WIDTH = 1440
const CHART_HEIGHT = 1800

const TF_SECONDS: Record<Timeframe, number> = {
  '5m': 300, '15m': 900, '1h': 3_600, '4h': 14_400, '1d': 86_400,
}

/** Трое суток: нужен один закрытый дневной бар для PDH/PDL, с запасом на дыры. */
const DAILY_LOOKBACK_SEC = 3 * 86_400

/**
 * Разборы уже отправленных карточек. Подпись обязана описывать ту картинку,
 * что висит в чате, поэтому при смене режима данные берём отсюда, а не свежие.
 */
const CARD_LIMIT = 40
const cards = new Map<string, Analysis>()

/** Один пакет на обе стороны карточки: и в ChartInput, и в CaptionInput. */
interface Analysis {
  readonly coin: string
  readonly interval: Timeframe
  readonly bars: Candle[]
  readonly markup: Markup
  readonly ctx: AssetCtx
  /** Позиции китов: другой смысл, чем поток, поставщик появится позже. */
  readonly whales: WhaleSummary | null
  /** Приток денег китов в монету за 15 минут, час и четыре часа. */
  readonly whaleFlow: { m15: number, h1: number, h4: number } | null
  readonly width: number
  readonly height: number
}

const HELLO = [
  'Радар рынка на связи.',
  'Присылаю карточку разбора: свечи с зонами и уровнями ликвидности картинкой, вывод — текстом.',
  `Пример: /ta SOL 1h. Таймфреймы: ${TIMEFRAMES.join(', ')}, по умолчанию ${DEFAULT_TF}.`,
  'Что происходит с потоком прямо сейчас — /flow SOL: лента, дельта, ближний стакан.',
  'Чего стоили мои пинги — /score. Сводка за окно — /digest.',
].join('\n')

const TA_USAGE = `Нужен тикер: /ta SOL или /ta BTC 4h. Таймфреймы: ${TIMEFRAMES.join(', ')}, по умолчанию ${DEFAULT_TF}.`

const STRANGER = 'Это личный инструмент, он отвечает только владельцу.'

export function createBot(token: string): Bot {
  const bot = new Bot(token)
  bot.use(ownerGuard())
  bot.command('start', async (ctx) => { await ctx.reply(HELLO) })
  bot.command('ta', onTa)
  bot.command('score', onScore)
  bot.command('digest', onDigest)
  bot.command('help', async (ctx) => { await ctx.reply(HELP) })
  bot.command('status', onStatus)
  bot.command('mute', onMute)
  bot.command('unmute', onUnmute)
  bot.command('quiet', onQuiet)
  bot.command('threshold', onThreshold)
  bot.callbackQuery(/^ta:/, onCallback)
  registerFlow(bot)
  // Последняя сеть: апдейт теряется, процесс живёт.
  //
  // Ошибка печатается ТОЛЬКО через safeError. Проверено 27.08.2026: при сетевом
  // сбое (не отказе API) grammy кладёт во вложенную ошибку полный URL запроса
  // вместе с токеном — «request to https://api.telegram.org/bot<ТОКЕН>/getMe
  // failed». Логи Actions в публичном репозитории читает кто угодно, и стереть
  // напечатанное оттуда нельзя — только перевыпускать токен.
  bot.catch((error) => { console.error('сбой обработчика:', safeError(error)) })
  return bot
}

/**
 * Пропускает только владельца, им становится первый написавший. Состояние
 * держим в памяти: диск читается раз за процесс, а не на каждый апдейт.
 */
function ownerGuard(): MiddlewareFn<Context> {
  let state: BotState | null = null
  return async (ctx, next) => {
    const userId = ctx.from?.id
    if (userId === undefined) return
    const known: BotState = state ?? (state = await loadBotState())
    if (known.ownerId !== null && known.ownerId !== userId) {
      await refuse(ctx)
      return
    }
    const chatId = ctx.chat?.id ?? known.lastChatId
    if (known.ownerId === null || known.lastChatId !== chatId) {
      state = { ownerId: userId, lastChatId: chatId }
      await saveBotState(state)
    }
    await next()
  }
}

/** Отказ посторонним: одна строка, без подсказок, что бот вообще умеет. */
async function refuse(ctx: Context): Promise<void> {
  if (ctx.callbackQuery !== undefined) await ctx.answerCallbackQuery(STRANGER)
  else await ctx.reply(STRANGER).catch(() => undefined)
}

async function onTa(ctx: CommandContext<Context>): Promise<void> {
  const [rawCoin, rawTf] = ctx.match.trim().split(/\s+/)
  // Без тикера показываем, что сейчас движется, кнопками. Требовать, чтобы
  // владелец заранее знал, на что смотреть, — это перекладывать на него ровно
  // ту работу, ради которой радар и заведён.
  if (rawCoin === undefined || rawCoin === '') {
    await suggestMovers(ctx)
    return
  }
  const tf = parseTimeframe(rawTf)
  if (tf === null) {
    await ctx.reply(`Не знаю таймфрейм «${rawTf ?? ''}». Есть: ${TIMEFRAMES.join(', ')}.`)
    return
  }
  await sendCard(ctx, rawCoin.toUpperCase(), tf, 'short')
}


const HELP = [
  'Что я умею.',
  '',
  '/ta SOL 1h — разбор структуры: зоны, ликвидность, границы суток. Кнопками меняются таймфрейм и подробность.',
  '/flow SOL — что с потоком прямо сейчас: лента, дельта, ближний стакан.',
  '/digest — сводка за последние часы. Утром и вечером присылаю сам.',
  '/score — чего стоили мои пинги: движение после них против контрольной группы.',
  '/status — живой ли я и что видел за сутки.',
  '',
  'Управление шумом:',
  `/mute SOL 12 — молчать по монете 12 часов (по умолчанию ${DEFAULT_MUTE_HOURS}).`,
  '/unmute SOL — вернуть монету.',
  '/quiet — кто сейчас заглушён.',
  '/threshold 0.35 — поднять или опустить порог пинга; без числа покажу текущий.',
  '',
  'Я не торгую и не советую. Всё, что присылаю, — факты с цифрами.',
].join('\n')

/**
 * Живой ли радар. Главный вопрос владельца утром: он вообще смотрел, пока я
 * спал, или процесс упал и молчание означает не спокойный рынок, а поломку.
 */
async function onStatus(ctx: CommandContext<Context>): Promise<void> {
  try {
    const now = Date.now()
    const series = await loadSeries(48, now)
    const events = await readEvents(24, now)
    const alerts = events.filter((event) => event.kind === 'alert')
    const last = series.snapshots.at(-1)
    const ageMin = last === undefined ? null : (now / 1000 - last.t) / 60
    const tuning = await loadTuning()
    const muted = activeMutes(tuning, now)
    const lines = [
      'Состояние радара',
      '',
      ageMin === null
        ? 'Записи рынка нет — регистратор не работает.'
        : `Последний снимок рынка ${ageMin.toFixed(0)} мин назад.` +
          (ageMin > 15 ? ' Это много: похоже, регистратор встал.' : ' Смотрю.'),
      `Архив рынка: ${series.coverageHours.toFixed(1)} ч, снимков ${series.snapshots.length}.`,
      `За сутки: рассмотрено ${events.length - alerts.length} кандидатов, отправлено ${alerts.length} пингов.`,
      `Порог пинга ${(tuning.threshold ?? ALERT_THRESHOLD).toFixed(2)}.`,
      muted.length === 0 ? 'Никто не заглушён.' : `Заглушено монет: ${muted.length} (/quiet — список).`,
    ]
    await ctx.reply(lines.join('\n'))
  } catch (error) {
    console.error(`статус: ${safeError(error)}`)
    await ctx.reply('Не смог собрать состояние: ' + (error instanceof Error ? error.message : 'неизвестно'))
  }
}

async function onMute(ctx: CommandContext<Context>): Promise<void> {
  const [coin, rawHours] = ctx.match.trim().split(/\s+/)
  if (coin === undefined || coin === '') {
    await ctx.reply(`Нужен тикер: /mute SOL или /mute SOL 6. По умолчанию ${DEFAULT_MUTE_HOURS} ч.`)
    return
  }
  const hours = Number(rawHours) > 0 ? Number(rawHours) : DEFAULT_MUTE_HOURS
  await saveTuning(mute(await loadTuning(), coin, hours, Date.now()))
  await ctx.reply(`Молчу по ${coin.toUpperCase()} ${hours} ч. Разбор по запросу это не отключает.`)
}

async function onUnmute(ctx: CommandContext<Context>): Promise<void> {
  const coin = ctx.match.trim().split(/\s+/)[0]
  if (coin === undefined || coin === '') {
    await ctx.reply('Нужен тикер: /unmute SOL')
    return
  }
  await saveTuning(unmute(await loadTuning(), coin))
  await ctx.reply(`${coin.toUpperCase()} снова в работе.`)
}

async function onQuiet(ctx: CommandContext<Context>): Promise<void> {
  const list = activeMutes(await loadTuning(), Date.now())
  if (list.length === 0) {
    await ctx.reply('Никто не заглушён.')
    return
  }
  const lines = list.map((item) => `  ${item.coin} — ещё ${item.hoursLeft.toFixed(1)} ч`)
  await ctx.reply(['Заглушены:', ...lines].join('\n'))
}

async function onThreshold(ctx: CommandContext<Context>): Promise<void> {
  const tuning = await loadTuning()
  const raw = ctx.match.trim()
  if (raw === '') {
    const current = tuning.threshold ?? ALERT_THRESHOLD
    const origin = tuning.threshold === null ? 'по умолчанию, откалиброван по распределению' : 'выставлен вручную'
    await ctx.reply(`Порог пинга ${current.toFixed(2)} (${origin}).\nВыше — реже и увереннее, ниже — чаще и шумнее.`)
    return
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    await ctx.reply('Порог — число между 0 и 1, например 0.35.')
    return
  }
  await saveTuning({ ...tuning, threshold: value })
  await ctx.reply(`Порог ${value.toFixed(2)}. Вернуть к расчётному: /threshold 0.30`)
}

/** Табель триггеров: чего стоили пинги. Считает по собственному архиву. */
async function onScore(ctx: CommandContext<Context>): Promise<void> {
  const hours = Number(ctx.match.trim()) || SCORE_HOURS
  await ctx.reply('Считаю по архиву, это несколько секунд…')
  try {
    const card = await buildScorecard(hours)
    await ctx.reply(renderScorecard(card))
  } catch (error) {
    console.error(`табель: ${safeError(error)}`)
    await ctx.reply('Не смог собрать табель: ' + (error instanceof Error ? error.message : 'неизвестно'))
  }
}

/** Сводка за окно по запросу; по расписанию её же шлёт регистратор. */
async function onDigest(ctx: CommandContext<Context>): Promise<void> {
  const hours = Number(ctx.match.trim()) || DIGEST_HOURS
  await ctx.reply('Собираю сводку…')
  try {
    const digest = await buildDigest({ hours, title: `Сводка за ${hours} ч` })
    await ctx.reply(digest.text)
  } catch (error) {
    console.error(`сводка: ${safeError(error)}`)
    await ctx.reply('Не смог собрать сводку: ' + (error instanceof Error ? error.message : 'неизвестно'))
  }
}

/** Сколько монет предлагать кнопками: больше ряда в три кнопки уже мельтешит. */
const MOVER_BUTTONS = 6

/** Что сейчас движется — по архиву за час, с оборотом от порога ликвидности. */
async function suggestMovers(ctx: Context): Promise<void> {
  try {
    const now = Date.now()
    const [ctxs, series] = await Promise.all([fetchAssetCtxs(), loadSeries(3, now)])
    const past = series.at(60)
    const moves = ctxs
      .filter((item) => item.dayNtlVlm >= MOVER_MIN_VOLUME_USD)
      .map((item) => {
        const before = valueAt(past, item.coin, 0)
        return { coin: item.coin, move: before !== null && before > 0 ? item.markPx / before - 1 : 0 }
      })
      .filter((item) => item.move !== 0)
      .sort((a, b) => Math.abs(b.move) - Math.abs(a.move))
      .slice(0, MOVER_BUTTONS)

    if (moves.length === 0) {
      await ctx.reply(`${TA_USAGE}\n\nЧто движется — пока не скажу: архива за час ещё нет.`)
      return
    }
    const kb = new InlineKeyboard()
    moves.forEach((item, index) => {
      kb.text(`${item.coin} ${(item.move * 100).toFixed(1)}%`, `ta:${item.coin}:${DEFAULT_TF}:short`)
      if (index % 3 === 2) kb.row()
    })
    await ctx.reply('За последний час сильнее всего сдвинулись эти. Нажми — разберу.', { reply_markup: kb })
  } catch (error) {
    console.error(`подсказка движения: ${safeError(error)}`)
    await ctx.reply(TA_USAGE)
  }
}

/** Тот же порог, что у сканера: ниже него проценты рисует неликвид. */
const MOVER_MIN_VOLUME_USD = 5_000_000

/** Пропущенный аргумент — не ошибка, а «как обычно»; чужой — ошибка. */
function parseTimeframe(value: string | undefined): Timeframe | null {
  if (value === undefined || value === '') return DEFAULT_TF
  const lower = value.toLowerCase()
  return TIMEFRAMES.find((item) => item === lower) ?? null
}

async function onCallback(ctx: CallbackQueryContext<Context>): Promise<void> {
  // Отвечаем сразу: Телеграм крутит часы на кнопке и ждёт заметно меньше, чем идёт сборка.
  await ctx.answerCallbackQuery().catch(() => undefined)
  const parsed = parseCallbackData(ctx.callbackQuery.data)
  if (parsed === null) return
  const message = ctx.callbackQuery.message
  const key = message === undefined ? null : cardKey(message.chat.id, message.message_id)
  const cached = key === null ? undefined : cards.get(key)
  if (cached !== undefined && cached.interval === parsed.tf) {
    await switchMode(ctx, cached, parsed.mode)
    return
  }
  // Другой таймфрейм или разбор, потерянный перезапуском: подписать старую картинку нечем.
  await sendCard(ctx, parsed.coin, parsed.tf, parsed.mode)
}

/**
 * 'ta:SOL:1h:long'. Бюджет callback_data — 64 байта: 'ta:' плюс тикер (у
 * Hyperliquid это короткая латиница) плюс ':4h:long' — вдвое короче предела.
 */
function parseCallbackData(data: string): { coin: string, tf: Timeframe, mode: Mode } | null {
  const [prefix, coin, rawTf, rawMode] = data.split(':')
  if (prefix !== 'ta' || coin === undefined || coin === '' || rawTf === undefined) return null
  if (rawMode !== 'short' && rawMode !== 'long') return null
  const tf = parseTimeframe(rawTf)
  return tf === null ? null : { coin: coin.toUpperCase(), tf, mode: rawMode }
}

async function sendCard(ctx: Context, coin: string, tf: Timeframe, mode: Mode): Promise<void> {
  try {
    const input = await analyze(coin, tf)
    const photo = await renderChart(input, await chartPath())
    const sent = await ctx.replyWithPhoto(new InputFile(photo), {
      caption: caption(input, mode),
      reply_markup: keyboard(input.coin, tf, mode),
    })
    remember(cardKey(sent.chat.id, sent.message_id), input)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`карточка ${coin} ${tf}: ${safeError(error)}`)
    // Отказ тоже может не уйти (чат удалён) — тогда молча, иначе упадёт сам обработчик.
    await ctx.reply(`Не смог собрать карточку по ${coin}: ${reason}`).catch(() => undefined)
  }
}

/** Только подпись: перерисовка ради текста — лишние три секунды и лишний файл. */
async function switchMode(ctx: CallbackQueryContext<Context>, input: Analysis, mode: Mode): Promise<void> {
  try {
    await ctx.editMessageCaption({
      caption: caption(input, mode),
      reply_markup: keyboard(input.coin, input.interval, mode),
    })
  } catch (error) {
    // Повторное нажатие того же режима — Телеграм отвечает «message is not modified».
    console.error(`смена режима ${input.coin}: ${safeError(error)}`)
  }
}

function caption(input: Analysis, mode: Mode): string {
  return mode === 'long' ? longCaption(input) : shortCaption(input)
}

/** Ряд таймфреймов и ряд режимов; точка помечает то, что показано сейчас. */
function keyboard(coin: string, tf: Timeframe, mode: Mode): InlineKeyboard {
  const kb = new InlineKeyboard()
  for (const item of QUICK_TFS) kb.text(mark(item, item === tf), `ta:${coin}:${item}:${mode}`)
  kb.row()
  kb.text(mark('Кратко', mode === 'short'), `ta:${coin}:${tf}:short`)
  kb.text(mark('Подробно', mode === 'long'), `ta:${coin}:${tf}:long`)
  return kb
}

function mark(label: string, active: boolean): string {
  return active ? `• ${label}` : label
}

function cardKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`
}

/** Map хранит порядок вставки, поэтому первый ключ — самая старая карточка. */
function remember(key: string, input: Analysis): void {
  cards.set(key, input)
  if (cards.size <= CARD_LIMIT) return
  const oldest = cards.keys().next()
  if (oldest.done !== true) cards.delete(oldest.value)
}

async function analyze(coin: string, tf: Timeframe): Promise<Analysis> {
  // Тикер сверяем со списком биржи, а не с регистром ввода: у Hyperliquid есть
  // символы вида kPEPE, и «KPEPE» она не знает.
  const ctx = (await fetchAssetCtxs()).find((item) => item.coin.toUpperCase() === coin)
  if (ctx === undefined) {
    // Подсказываем близкие тикеры: промах в одну букву иначе выглядит как
    // «монеты нет», и владелец решает, что бот не умеет её смотреть.
    const near = (await fetchAssetCtxs())
      .map((item) => item.coin)
      .filter((name) => name.toUpperCase().includes(coin) || coin.includes(name.toUpperCase()))
      .slice(0, 5)
    throw new Error(
      near.length === 0
        ? 'такой монеты на Hyperliquid нет'
        : `такой монеты нет. Может быть: ${near.join(', ')}`,
    )
  }
  const nowMs = Date.now()
  const nowSec = Math.floor(nowMs / 1000)
  const [recent, daily, flow] = await Promise.all([
    fetchCandles(ctx.coin, tf, nowSec - TF_SECONDS[tf] * (BARS + BARS_MARGIN), nowMs),
    fetchCandles(ctx.coin, '1d', nowSec - DAILY_LOOKBACK_SEC, nowMs),
    // Поток китов — из собственного архива. Его отсутствие не повод ронять
    // карточку: подпись просто не покажет раздел.
    whaleFlow(ctx.coin, nowMs).catch(() => null),
  ])
  const bars = recent.slice(-BARS)
  if (bars.length === 0) throw new Error('биржа не отдала ни одного закрытого бара')
  return {
    coin: ctx.coin, interval: tf, bars, markup: markup(bars, daily.at(-1)),
    ctx, whales: null, whaleFlow: flow, width: CHART_WIDTH, height: CHART_HEIGHT,
  }
}

/**
 * Кольцо имён во временном каталоге: пока Телеграм дочитывает картинку, её имя
 * не переиспользуется, и на диске никогда не больше CHART_SLOTS файлов.
 */
const CHART_SLOTS = 8
let chartDir: string | null = null
let chartSlot = 0

async function chartPath(): Promise<string> {
  const dir = chartDir ?? (chartDir = await mkdtemp(join(tmpdir(), 'market-radar-')))
  chartSlot = (chartSlot + 1) % CHART_SLOTS
  return join(dir, `card-${chartSlot}.png`)
}
