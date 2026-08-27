// Карточка потока: что происходит на ленте прямо сейчас — кто давит, какие
// принты прошли, что стоит в ближнем стакане. От карточки структуры она отделена
// намеренно: структура живёт часами, стакан переставляют за секунды, и на одной
// картинке они мешают друг другу.
//
// Библиотека графиков здесь не нужна вовсе: данных мало и они простые. Вся
// геометрия считается в Node, а браузеру остаётся залить готовые прямоугольники,
// ломаные и треугольники на холст — правила раскладки не должны существовать в
// двух местах. Страница самодостаточна и в сеть не ходит: Georgia берётся из
// системы, снимок делается по элементу #wrap.

import type { BigPrint, FlowBucket, FlowSummary } from '../flow/summary.js'
import { SAPPHIRE, type Theme } from './theme.js'

/** Шаг архива: одна корзина — 10 секунд. Отсюда же ширина столбика дельты и подпись. */
const BUCKET_MS = 10_000

/**
 * Меньше двух корзин — рисовать нечего. Пустой график принимают за правду и
 * потом ищут причину в рынке, а не в том, что регистратор подняли минуту назад.
 */
const MIN_BUCKETS = 2

/**
 * Разрыв в записи. Корзины пишутся только там, где были сделки, поэтому тихие
 * полминуты на неликвиде — норма, а вот целая минута без единой корзины
 * означает, что в этот момент никто ничего не видел. Такой участок линия
 * перепрыгивает разрывом: прямая через него соврала бы про движение.
 */
const GAP_MS = 60_000

/** Кегль подписей: мельче не переживает сжатие картинки телеграмом. */
const LABEL_FONT_PX = 11
/** Курсив с засечками — тот же голос, что у карточки структуры. */
const FONT = `italic ${LABEL_FONT_PX}px Georgia, 'Times New Roman', serif`

/** Поля кадра. Сверху и снизу — ровно под строку подписи, по бокам — воздух. */
const PAD_X = 10
const PAD_TOP = 20
const PAD_BOTTOM = 18
/** Зазор между панелями: меньше — и столбики дельты читаются как часть графика цены. */
const PANEL_GAP = 12

/**
 * Колонка ценовых подписей у левого края. Отдана обеим панелям сразу, а не одной
 * верхней: сдвинь только график цены — и столбик дельты перестанет стоять под
 * своей минутой. Ширины хватает на пятизначную цену с плашкой; на кадре в 1440
 * это четыре процента, а без неё по линии не прочитать ни одного числа.
 */
const PRICE_AXIS_PX = 58
/**
 * Строка времени под нижней панелью: кегль, засечка и воздух с обеих сторон.
 * Тесно прижатая к нижней подписи, она читается как её продолжение.
 */
const TIME_AXIS_PX = 20
/** Длина засечки у отметки шкалы. */
const TICK_PX = 4
/** Отступ подписи от засечки: вплотную она читается как часть числа. */
const TICK_GAP_PX = 3
/**
 * Потолок числа отметок. Шкала подбирает «круглый» шаг и берёт первый, который
 * укладывается в этот потолок: пять цен и четыре времени читаются одним взглядом,
 * а десять превращают край кадра в лестницу.
 */
const PRICE_TICK_MAX = 5
const TIME_TICK_MAX = 4
/**
 * Круглые шаги времени. Отметки стоят на них, а не через равные доли окна: «14:35»
 * находится на часах мгновенно, а «14:37:12» приходится вычитать.
 */
const TIME_STEPS_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440]
/**
 * Оценка ширины символа в курсивной Georgia 11px. Настоящую ширину знает только
 * браузер, а плашка последней цены и края строки времени нужны уже здесь, в Node.
 * Оценка сверху: лишний пиксель воздуха безобиднее обрезанной цифры.
 */
const CHAR_W_PX = 6
/** Половина «ЧЧ:ММ» в этой оценке — на неё отметка отходит от края кадра. */
const TIME_LABEL_HALF_PX = (5 * CHAR_W_PX) / 2
/** Поля плашки последней цены и её высота. */
const TAG_PAD_PX = 4
const TAG_H_PX = LABEL_FONT_PX + 5

/** Доля высоты под цену: цена — главное на карточке, дельте хватает остатка. */
const TOP_PANEL_FRAC = 0.55

/** Ширина полосы стакана. Плита в 100px различима, а кадр цены ещё не обкрадывает. */
const BOOK_STRIP_PX = 100
/** Зазор между графиком цены и полосой стакана — по нему проходит граница шкалы. */
const STRIP_GAP_PX = 8
/**
 * Шаг строки лестницы и толщина плитки. Уровни стакана стоят плотнее, чем
 * различает шкала (20 уровней на сторону укладываются в считанные пиксели),
 * поэтому попавшие в одну строку суммируются. 3 и 2 дают между плитками
 * пиксельный зазор — без него лестница слипается в сплошное пятно.
 */
const BOOK_ROW_PX = 3
const BOOK_BAR_PX = 2
/** Самый тонкий уровень всё равно видно: иначе мелочь у цены исчезает совсем. */
const PLATE_MIN_PX = 2
/** Плитка не упирается в край кадра. */
const PLATE_EDGE_PX = 4
/** На сколько подпись крупнейшей плиты отходит от неё, чтобы не лечь поверх. */
const PLATE_LABEL_LIFT_PX = 9
/**
 * Что считается ближним стаканом. Источник отдаёт 20 уровней на сторону, но на
 * неликвиде двадцатый может стоять в паре процентов от цены — на общей ценовой
 * шкале он растянул бы панель и сплющил линию цены в нитку.
 */
const BOOK_BAND_FRAC = 0.02

/** Размер треугольника принта: минимум — чтобы заметить, максимум — чтобы один
 * гигантский принт не закрыл собой панель. */
/**
 * Сколько принтов рисуем максимум. За час их бывает под тысячу — рисовать все
 * значит потерять сам график. Тридцать крупнейших дают понять, где кто входил,
 * и оставляют линию цены видимой.
 */
const MAX_VISIBLE_PRINTS = 30

const PRINT_MIN_PX = 3
const PRINT_MAX_PX = 9

/** Поля ценовой шкалы: без них верхний принт и лучшая плита режутся краем панели. */
const PRICE_PAD_FRAC = 0.1
/**
 * Минимальный размах шкалы. На спокойном рынке за десять минут цена может не
 * сдвинуться вовсе; без этого пола шкала выродилась бы и любой шорох выглядел
 * как обвал.
 */
const MIN_RANGE_FRAC = 0.002

/** Толщина линий: полупрозрачные цвета темы при 1px просто исчезают. */
const LINE_PX = 1.5
/** Отступ линии CVD от краёв панели — иначе она липнет к столбикам дельты. */
const CVD_INSET_PX = 3
/** Ненулевая дельта обязана быть видна, даже когда она в тысячу раз меньше пиковой. */
const MIN_BAR_PX = 1

export interface FlowChartInput {
  readonly summary: FlowSummary
  readonly width: number
  readonly height: number
}

/** Прямоугольник: столбик дельты, плитка стакана или волосяная линия оси. */
interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly c: string
}

/** Треугольник крупного принта. o — цвет обводки кита, иначе null. */
interface Print {
  readonly x: number
  readonly y: number
  readonly s: number
  readonly up: boolean
  readonly c: string
  readonly o: string | null
}

interface Label {
  readonly x: number
  readonly y: number
  readonly s: string
  readonly a: 'left' | 'center' | 'right'
  /** Свой цвет вместо общих чернил — нужен тексту на плашке последней цены. */
  readonly c?: string
}

/** Ломаная плоским списком [x0,y0,x1,y1,…]: от массива объектов JSON вдвое толще. */
type Polyline = number[]

interface Line {
  readonly pts: Polyline
  readonly c: string
  readonly w: number
}

/** Готовая к отрисовке сцена: браузер только раскладывает её по холсту. */
interface Scene {
  readonly width: number
  readonly height: number
  readonly bg: string
  readonly font: string
  readonly ink: string
  readonly rects: Rect[]
  readonly lines: Line[]
  readonly prints: Print[]
  readonly labels: Label[]
}

/** Уровень ближнего стакана со стороной: цвет плитки зависит от неё. */
interface NearLevel {
  readonly px: number
  readonly usd: number
  readonly bid: boolean
}

/** «1.2» вместо «1.20» и «12» вместо «12.0»: в кадре важен порядок, не копейки. */
function short(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}

function money(usd: number): string {
  const abs = Math.abs(usd)
  if (abs >= 1e9) return `$${short(abs / 1e9)}B`
  if (abs >= 1e6) return `$${short(abs / 1e6)}M`
  if (abs >= 1e3) return `$${short(abs / 1e3)}K`
  return `$${Math.round(abs)}`
}

/** Минус типографский U+2212: дефис в курсиве с засечками читается как перенос. */
function signedMoney(usd: number): string {
  return (usd < 0 ? '−' : '+') + money(usd)
}

/** Неразрывный пробел между разрядами: число сделок не должно разъезжаться. */
function grouped(count: number): string {
  return Math.round(count).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')
}

/**
 * Главная строчка честности. coveredMinutes округлён до минут, и на свежей
 * записи это ноль: «записи 0 мин» рядом с нарисованной лентой читается как
 * сломанный счётчик, поэтому короткое покрытие называется словами.
 */
function coverage(minutes: number): string {
  return minutes < 1 ? 'записи меньше минуты' : `записи ${minutes} мин`
}

function nearLevels(summary: FlowSummary): NearLevel[] {
  const book = summary.book
  if (book === null || !(summary.lastPx > 0)) return []
  const band = summary.lastPx * BOOK_BAND_FRAC
  const near = (levels: readonly { readonly px: number; readonly usd: number }[], bid: boolean): NearLevel[] =>
    levels
      .filter((level) => level.usd > 0 && Math.abs(level.px - summary.lastPx) <= band)
      .map((level) => ({ px: level.px, usd: level.usd, bid }))
  return [...near(book.bids, true), ...near(book.asks, false)]
}

/**
 * Границы ценовой шкалы. В неё входят только цены корзин и цены видимых крупных
 * принтов — то есть сам ход цены. Уровни стакана шкалу НЕ растягивают, хотя и
 * рисуются по ней: ближний стакан шире получаса хода цены (на замере SOL — $0.39
 * против $0.20), и от общей шкалы линия цены сплющивалась в полоску посреди
 * пустого кадра. Предмет карточки — поток и цена, стакан рядом с ними контекст;
 * то из стакана, что не поместилось, лестница сама подписывает суммой у края.
 */
function priceDomain(prices: readonly number[]): { readonly lo: number; readonly hi: number } {
  let lo = Infinity
  let hi = -Infinity
  for (const price of prices) {
    if (!Number.isFinite(price) || price <= 0) continue
    lo = Math.min(lo, price)
    hi = Math.max(hi, price)
  }
  // Испорченная строка архива не должна унести масштаб в NaN и стереть карточку.
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1 }

  const mid = (lo + hi) / 2
  const floor = Math.max(mid * MIN_RANGE_FRAC, Number.EPSILON)
  let span = hi - lo
  if (span < floor) {
    lo = mid - floor / 2
    hi = mid + floor / 2
    span = floor
  }
  const pad = span * PRICE_PAD_FRAC
  return { lo: lo - pad, hi: hi + pad }
}

/**
 * Своя шкала для накопленной дельты, не общая со столбиками: дельта за десять
 * секунд и накопленная за час — разные порядки, на одной шкале одна из них
 * превращается в плоскую нитку. Читают у CVD форму, а число вынесено в подпись.
 */
function cvdScale(cvd: readonly number[], y0: number, y1: number): (value: number) => number {
  const top = y0 + CVD_INSET_PX
  const bottom = y1 - CVD_INSET_PX
  let min = Infinity
  let max = -Infinity
  for (const value of cvd) {
    if (!Number.isFinite(value)) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  if (!Number.isFinite(min) || max - min <= 0) return () => (top + bottom) / 2
  return (value) => bottom - ((value - min) / (max - min)) * (bottom - top)
}

/** Рамка кадра: где какая панель и сколько места осталось графику цены. */
interface Frame {
  readonly plotX0: number
  readonly plotX1: number
  readonly stripX0: number
  readonly stripW: number
  readonly topY0: number
  readonly topY1: number
  readonly lowY0: number
  readonly lowY1: number
}

function frameOf(width: number, height: number, ladder: boolean): Frame {
  // Полоса стакана уступает место графику на узком кадре и исчезает вовсе, если
  // стакана нет: лестница без графика цены бессмысленна, а график без лестницы —
  // нет, и отдавать ему пустые сто пикселей незачем.
  const stripW = ladder ? Math.min(BOOK_STRIP_PX, Math.max(0, Math.floor((width - 2 * PAD_X) / 3))) : 0
  const topY0 = PAD_TOP
  // Строка времени отрезается от кадра до дележа на панели: иначе она съела бы
  // низ панели дельты, и крайний столбик оказался бы под своей же подписью.
  const plotY1 = height - PAD_BOTTOM - TIME_AXIS_PX
  const topY1 = topY0 + Math.round((plotY1 - PAD_TOP) * TOP_PANEL_FRAC)
  return {
    plotX0: PAD_X + PRICE_AXIS_PX,
    plotX1: width - PAD_X - (stripW > 0 ? stripW + STRIP_GAP_PX : 0),
    stripX0: width - PAD_X - stripW,
    stripW,
    topY0,
    topY1,
    lowY0: topY1 + PANEL_GAP,
    lowY1: plotY1,
  }
}

/** «Круглый» шаг шкалы: единица, двойка или пятёрка в своём порядке величины. */
function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 0
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
}

/**
 * Знаков после запятой ровно столько, сколько различает шаг. У SOL шаг 0.05 —
 * нужны два знака, у BTC шаг 50 — ни одного: лишние нули занимают место и
 * заставляют вчитываться в число, у которого важен только порядок.
 */
function decimals(step: number): number {
  if (!(step > 0)) return 2
  return Math.min(8, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)))
}

/** Круглые цены внутри шкалы. Счёт по индексу, а не сложением: шаг дробный. */
function priceTickValues(lo: number, hi: number): number[] {
  const step = niceStep((hi - lo) / PRICE_TICK_MAX)
  if (step === 0) return []
  const out: number[] = []
  // Хвост в 1e-6 шага: верхняя отметка не должна пропасть из-за двоичной дроби.
  for (let i = Math.ceil(lo / step); i * step <= hi + step * 1e-6; i++) out.push(i * step)
  return out
}

/**
 * Круглые моменты времени внутри окна. Шаг — первый из ладдера, который
 * укладывается в потолок отметок. Окно короче минуты круглых моментов не
 * содержит вовсе: там отметки ставятся по краям и середине, лишь бы читатель
 * видел, какой это час.
 */
function timeTickValues(t0: number, t1: number): number[] {
  const span = t1 - t0
  if (!(span > 0)) return []
  let best: number[] = []
  for (const minutes of TIME_STEPS_MIN) {
    const step = minutes * 60_000
    const out: number[] = []
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) out.push(t)
    // Шаг перерос окно — дальше по ладдеру будет только хуже.
    if (out.length < 2) break
    best = out
    if (out.length <= TIME_TICK_MAX) return out
  }
  return best.length >= 2 ? best : [t0, t0 + span / 2, t1]
}

/** Время отметки в UTC. Часовой пояс машины к рынку отношения не имеет. */
function utcHhMm(ms: number): string {
  const at = new Date(ms)
  return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Отметки и подписи одной шкалы — их всегда собирают и отдают вместе. */
interface Axis {
  readonly rects: Rect[]
  readonly labels: Label[]
}

/**
 * Ценовая шкала в левой колонке. Отдельной строкой — последняя цена: в ровном
 * ряду круглых отметок она ничем не выделена, а смотрят на карточку обычно ради
 * неё. Плашка — тот же приём, что на карточке структуры, и она же служит себе
 * засечкой, дотягиваясь до самого графика.
 */
function priceAxis(
  lo: number,
  hi: number,
  lastPx: number,
  frame: Frame,
  priceY: (px: number) => number,
  theme: Theme,
): Axis {
  const step = niceStep((hi - lo) / PRICE_TICK_MAX)
  const digits = decimals(step)
  const tickX = frame.plotX0 - TICK_PX
  const rects: Rect[] = []
  const labels: Label[] = []

  const lastY = Math.round(priceY(lastPx))
  const tagged = lastPx > 0 && lastY >= frame.topY0 && lastY <= frame.topY1

  for (const px of priceTickValues(lo, hi)) {
    const y = Math.round(priceY(px))
    if (y < frame.topY0 || y > frame.topY1) continue
    // Под плашкой последней цены круглая отметка не читается, а поверх плашки
    // её бы и нарисовало: подписи ложатся на холст после прямоугольников.
    if (tagged && Math.abs(y - lastY) < (TAG_H_PX + LABEL_FONT_PX) / 2) continue
    rects.push({ x: tickX, y, w: TICK_PX, h: 1, c: theme.axis })
    labels.push({ x: tickX - TICK_GAP_PX, y, s: px.toFixed(digits), a: 'right' })
  }

  if (tagged) {
    // На знак точнее круглых отметок. Шаг шкалы округлил бы 101.36 до «101.4» —
    // ровно до той отметки, что стоит рядом, и плашка сообщала бы не цену, а
    // ближайшее деление. Знак, не сказавший ничего нового, тут же снимается:
    // «99.900» и «68177.0» — это точность напоказ, а места в колонке мало.
    const text = lastPx.toFixed(Math.min(8, digits + 1)).replace(/\.?0$/, '')
    const x1 = frame.plotX0
    const x0 = Math.max(PAD_X, x1 - (text.length * CHAR_W_PX + 2 * TAG_PAD_PX))
    rects.push({ x: x0, y: lastY - TAG_H_PX / 2, w: x1 - x0, h: TAG_H_PX, c: theme.priceTagBg })
    labels.push({ x: x1 - TAG_PAD_PX, y: lastY, s: text, a: 'right', c: theme.priceTagText })
  }
  return { rects, labels }
}

/**
 * Шкала времени под нижней панелью. Без неё видно, что всплеск был, но не видно
 * когда, а «когда» — половина смысла ленты. Подпись у самого края кадра отходит
 * внутрь: засечка остаётся на своём месте, обрезанное время не читается вовсе.
 */
function timeAxis(t0: number, t1: number, frame: Frame, timeX: (t: number) => number, theme: Theme): Axis {
  const rects: Rect[] = []
  const labels: Label[] = []
  const seen = new Set<string>()
  for (const t of timeTickValues(t0, t1)) {
    const x = Math.round(timeX(t))
    if (x < frame.plotX0 || x > frame.plotX1) continue
    // Окно короче минуты умещается в одну минуту на часах. Три отметки «07:00»
    // подряд выглядят поломкой шкалы, хотя врать они не врут: минута и правда одна.
    const text = utcHhMm(t)
    if (seen.has(text)) continue
    seen.add(text)
    rects.push({ x, y: frame.lowY1, w: 1, h: TICK_PX, c: theme.axis })
    labels.push({
      x: clamp(x, frame.plotX0 + TIME_LABEL_HALF_PX, frame.plotX1 - TIME_LABEL_HALF_PX),
      y: frame.lowY1 + TIME_AXIS_PX / 2 + 1,
      s: text,
      a: 'center',
    })
  }
  return { rects, labels }
}

/**
 * Лестница ближнего стакана. Уровни собираются в строки по пикселям ценовой
 * шкалы: раз шкала общая с графиком, плита обязана стоять на высоте своей цены,
 * а всё, что шкала не различает, честнее сложить, чем рисовать друг поверх
 * друга. Подпись получает самая длинная строка — она же самая крупная плита.
 *
 * Шкалу теперь держит цена, а не стакан, поэтому заметная часть ближних уровней
 * оказывается выше или ниже панели. Выбросить её молча нельзя: пропавшая без
 * следа ликвидность — это ложь о стакане ровно того же сорта, что сплющенная
 * линия — ложь о движении. Ушедшее за кадр складывается в две суммы и стоит
 * подписями у краёв полосы.
 */
function bookPlates(
  levels: readonly NearLevel[],
  frame: Frame,
  priceY: (px: number) => number,
  theme: Theme,
): Axis {
  if (levels.length === 0 || frame.stripW <= 0) return { rects: [], labels: [] }

  const rows = new Map<string, { readonly y: number; readonly usd: number; readonly bid: boolean }>()
  let aboveUsd = 0
  let belowUsd = 0
  for (const level of levels) {
    const y = priceY(level.px)
    // Шкала перевёрнута: меньший y — цена выше. Дотягивать шкалу до уровня
    // нельзя, а потерять его — тем более.
    if (y < frame.topY0) {
      aboveUsd += level.usd
      continue
    }
    if (y > frame.topY1) {
      belowUsd += level.usd
      continue
    }
    const row = Math.round(y / BOOK_ROW_PX)
    const key = `${level.bid ? 'b' : 'a'}${row}`
    const seen = rows.get(key)
    rows.set(key, {
      y: row * BOOK_ROW_PX,
      usd: (seen?.usd ?? 0) + level.usd,
      bid: level.bid,
    })
  }

  const rects: Rect[] = [
    // Граница ценовой шкалы: волосок в зазоре показывает, где кончается время и
    // начинается глубина.
    {
      x: Math.round(frame.plotX1 + STRIP_GAP_PX / 2),
      y: frame.topY0,
      w: 1,
      h: frame.topY1 - frame.topY0,
      c: theme.axis,
    },
  ]
  const labels: Label[] = []
  const edgeX = frame.stripX0 + frame.stripW
  // Метки стоят ЗА панелью, а не у её краёв изнутри: внутри они ложатся прямо на
  // крайние плиты, и плита под текстом читается как подчёркивание. Снаружи же
  // место для них уже есть — строка заголовка сверху (заголовок прижат к левому
  // краю, полоса стакана к правому) и зазор между панелями снизу. Заодно
  // положение совпадает со смыслом: то, что выше кадра, подписано выше кадра.
  const aboveY = PAD_TOP / 2
  const belowY = frame.topY1 + PANEL_GAP / 2
  if (aboveUsd > 0) labels.push({ x: edgeX, y: aboveY, s: `выше кадра ${money(aboveUsd)}`, a: 'right' })
  if (belowUsd > 0) labels.push({ x: edgeX, y: belowY, s: `ниже кадра ${money(belowUsd)}`, a: 'right' })
  if (rows.size === 0) return { rects, labels }

  const plates = [...rows.values()]
  let widest = plates[0]!
  for (const plate of plates) if (plate.usd > widest.usd) widest = plate
  // Ширина плиты меряется по крупнейшей ВИДИМОЙ: за кадром может стоять сумма
  // много больше, и от неё вся лестница выродилась бы в ряд волосков.
  const room = Math.max(PLATE_MIN_PX, frame.stripW - PLATE_EDGE_PX)
  rects.push(
    ...plates.map((plate) => ({
      x: frame.stripX0,
      y: plate.y - BOOK_BAR_PX / 2,
      w: Math.max(PLATE_MIN_PX, (plate.usd / widest.usd) * room),
      h: BOOK_BAR_PX,
      c: plate.bid ? theme.bull : theme.bear,
    })),
  )

  // Подпись уходит над плитой, а у самого верха панели — под неё: поверх плиты
  // она закрыла бы то, ради чего нарисована.
  const lifted = widest.y - PLATE_LABEL_LIFT_PX
  const y = lifted < frame.topY0 + LABEL_FONT_PX ? widest.y + PLATE_LABEL_LIFT_PX : lifted
  // Метки ушедшей ликвидности стоят в той же колонке и важнее: без них стакан
  // врёт, без размера крупнейшей плиты — только беднее.
  const clear = labels.every((label) => Math.abs(label.y - y) >= LABEL_FONT_PX + 2)
  if (clear) labels.push({ x: edgeX, y, s: money(widest.usd), a: 'right' })
  return { rects, labels }
}

/**
 * Ломаные цены и накопленной дельты. Строятся одним проходом: у них общая ось
 * времени и общие разрывы записи — линия, перепрыгнувшая дыру, и CVD, склеенный
 * через ту же дыру, противоречили бы друг другу.
 */
function flowLines(
  buckets: readonly FlowBucket[],
  cvd: readonly number[],
  timeX: (t: number) => number,
  priceY: (px: number) => number,
  cvdY: (value: number) => number,
  theme: Theme,
): Line[] {
  const lines: Line[] = []
  let price: Polyline = []
  let delta: Polyline = []
  let prevT = Number.NaN
  const cut = (): void => {
    if (price.length >= 2) lines.push({ pts: price, c: theme.bull, w: LINE_PX })
    if (delta.length >= 2) lines.push({ pts: delta, c: theme.zoneBorderFvg, w: LINE_PX })
    price = []
    delta = []
  }
  buckets.forEach((bucket, index) => {
    if (Number.isFinite(prevT) && bucket.t - prevT > GAP_MS) cut()
    // Цена корзины — последняя в ней, поэтому точка стоит на правом краю корзины.
    const x = timeX(bucket.t + BUCKET_MS)
    price.push(x, priceY(bucket.px))
    delta.push(x, cvdY(cvd[index] ?? 0))
    prevT = bucket.t
  })
  cut()
  return lines
}

/**
 * Треугольники крупных принтов. Размер растёт от корня объёма: на линейной шкале
 * весь диапазон забирает один рекордсмен, а на глаз всё равно читается площадь
 * пятна, а не сторона треугольника.
 */
function printMarks(
  visible: readonly BigPrint[],
  timeX: (t: number) => number,
  priceY: (px: number) => number,
  theme: Theme,
): Print[] {
  let refUsd = 0
  for (const print of visible) refUsd = Math.max(refUsd, print.usd)
  return visible.map((print) => {
    const ratio = refUsd > 0 ? Math.min(1, Math.sqrt(print.usd / refUsd)) : 0
    const buy = print.side === 'B'
    return {
      x: timeX(print.t),
      y: priceY(print.px),
      s: PRINT_MIN_PX + ratio * (PRINT_MAX_PX - PRINT_MIN_PX),
      up: buy,
      c: buy ? theme.arrowUp : theme.arrowDn,
      // Обводка плашкой цены — самое плотное пятно темы. Она отдана единственному
      // на карточке событию, которое того стоит: принту кита.
      o: print.whale ? theme.priceTagBg : null,
    }
  })
}

/**
 * Столбики дельты от нуля. Шкала симметрична: перекос вверх и такой же перекос
 * вниз обязаны выглядеть одинаково по силе, иначе картинка подыгрывает той
 * стороне, которой в окне повезло больше.
 */
function deltaBars(
  buckets: readonly FlowBucket[],
  frame: Frame,
  timeX: (t: number) => number,
  barW: number,
  zeroY: number,
  theme: Theme,
): Rect[] {
  const half = (frame.lowY1 - frame.lowY0) / 2
  let peak = 0
  for (const bucket of buckets) peak = Math.max(peak, Math.abs(bucket.buyUsd - bucket.sellUsd))
  if (peak === 0) return []

  const bars: Rect[] = []
  for (const bucket of buckets) {
    const delta = bucket.buyUsd - bucket.sellUsd
    if (delta === 0) continue
    const h = Math.max(MIN_BAR_PX, (Math.abs(delta) / peak) * half)
    bars.push({
      x: timeX(bucket.t),
      y: delta > 0 ? zeroY - h : zeroY,
      w: barW,
      h,
      c: delta > 0 ? theme.bull : theme.bear,
    })
  }
  return bars
}

/**
 * Нижняя строка карточки. Справа — сколько записи есть на самом деле: без неё
 * четыре минуты ленты выглядят так же убедительно, как сутки, и картинку читают
 * как полную. Слева — цена деления дельты и её накопленный итог: у линии CVD на
 * своей шкале читается только форма, само число живёт здесь.
 */
function captions(summary: FlowSummary, width: number, height: number): Label[] {
  const y = height - PAD_BOTTOM / 2
  const cvdLast = summary.cvd[summary.cvd.length - 1] ?? summary.deltaUsd
  const volume = money(summary.buyUsd + summary.sellUsd)
  return [
    { x: PAD_X, y, s: `дельта по ${BUCKET_MS / 1000} сек · CVD ${signedMoney(cvdLast)}`, a: 'left' },
    {
      x: width - PAD_X,
      y,
      s: `${coverage(summary.coveredMinutes)} · ${grouped(summary.trades)} сделок · ${volume}`,
      a: 'right',
    },
  ]
}

function pack(input: FlowChartInput, theme: Theme, parts: Partial<Scene>): Scene {
  return {
    width: input.width,
    height: input.height,
    bg: theme.bg,
    font: FONT,
    ink: theme.label,
    rects: parts.rects ?? [],
    lines: parts.lines ?? [],
    prints: parts.prints ?? [],
    labels: parts.labels ?? [],
  }
}

function scene(input: FlowChartInput, theme: Theme): Scene {
  const { summary, width, height } = input
  const title: Label = { x: PAD_X, y: PAD_TOP / 2, s: `${summary.coin} · поток`, a: 'left' }

  const buckets = summary.buckets
  if (buckets.length < MIN_BUCKETS) {
    // Ни осей, ни рамок: пустая разметка выглядит как настоящий график, на
    // котором ничего не происходит, и её принимают за правду.
    const excuse: Label = {
      x: width / 2,
      y: height / 2,
      s: `записи слишком мало: ${buckets.length} корзин`,
      a: 'center',
    }
    return pack(input, theme, { labels: [title, excuse] })
  }

  // Уровни считаются до рамки: от того, есть ли стакан, зависит ширина кадра цены.
  const levels = nearLevels(summary)
  const frame = frameOf(width, height, levels.length > 0)
  const first = buckets[0]!
  const last = buckets[buckets.length - 1]!
  const t0 = first.t
  // Правая граница — конец последней корзины: она уже закрыта, и её цена — цена
  // на этот момент, а не на его начало.
  const t1 = last.t + BUCKET_MS
  const timeX = (t: number): number =>
    frame.plotX0 + ((t - t0) / (t1 - t0)) * (frame.plotX1 - frame.plotX0)

  const inWindow = summary.big.filter((print) => print.t >= t0 && print.t <= t1 && print.px > 0)
  // Порог крупного принта постоянный ($10K), а окно — нет: за час их набирается
  // несколько сотен, и треугольники залепляют линию цены до полной нечитаемости.
  // Показываем только самые крупные; сколько всего было, говорит подпись.
  const visible = [...inWindow]
    .sort((a, b) => b.usd - a.usd)
    .slice(0, MAX_VISIBLE_PRINTS)
    .sort((a, b) => a.t - b.t)
  const { lo, hi } = priceDomain([
    ...buckets.map((bucket) => bucket.px),
    ...visible.map((print) => print.px),
  ])
  const priceY = (px: number): number =>
    frame.topY1 - ((px - lo) / (hi - lo)) * (frame.topY1 - frame.topY0)

  const rects: Rect[] = []
  const labels: Label[] = [title]

  const ladder = bookPlates(levels, frame, priceY, theme)
  rects.push(...ladder.rects)
  labels.push(...ladder.labels)

  // Цена корзины — последняя в ней, поэтому плашку получает цена последней корзины.
  const price = priceAxis(lo, hi, last.px, frame, priceY, theme)
  rects.push(...price.rects)
  labels.push(...price.labels)

  const time = timeAxis(t0, t1, frame, timeX, theme)
  rects.push(...time.rects)
  labels.push(...time.labels)

  const cvdY = cvdScale(summary.cvd, frame.lowY0, frame.lowY1)
  const lines = flowLines(buckets, summary.cvd, timeX, priceY, cvdY, theme)
  const prints = printMarks(visible, timeX, priceY, theme)

  // Ноль дельты — единственная ось на карточке: без неё непонятно, вверх столбик
  // или вниз. Рисуется до столбиков, чтобы они росли из него, а не поверх.
  const zeroY = Math.round((frame.lowY0 + frame.lowY1) / 2)
  rects.push({ x: frame.plotX0, y: zeroY, w: frame.plotX1 - frame.plotX0, h: 1, c: theme.axis })
  // Столбик занимает свою корзину целиком, минус пиксель на просвет между соседями.
  const barW = Math.max(1, ((frame.plotX1 - frame.plotX0) * BUCKET_MS) / (t1 - t0) - 1)
  rects.push(...deltaBars(buckets, frame, timeX, barW, zeroY, theme))

  labels.push(...captions(summary, width, height))
  return pack(input, theme, { rects, lines, prints, labels })
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

function pageStyle(theme: Theme, width: number, height: number): string {
  return `
html,body{margin:0;padding:0;background:${theme.bg}}
/* Снимок делается один раз: любое движение к этому моменту только смажет кадр. */
*,*::before,*::after{animation:none!important;transition:none!important}
#wrap{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${theme.bg}}
/* Холст — заменяемый элемент: без явных CSS-размеров он растянулся бы по своему
   буферу в физических пикселях, и кадр уехал бы вдвое. */
#flow{display:block;width:${width}px;height:${height}px}`
}

/**
 * Скрипт страницы. Никаких решений: вся сцена посчитана в Node и лежит в __DATA,
 * браузеру остаётся залить её на холст.
 */
const BROWSER_SCRIPT = `
const D = window.__DATA
const canvas = document.getElementById('flow')
const ctx = canvas.getContext('2d')

// Холст в физических пикселях: карточка снимается в двойном масштабе, и растянутый
// из логического размера холст выглядит мылом — первыми размазываются треугольники
// принтов и курсив подписей.
const dpr = window.devicePixelRatio || 1
canvas.width = Math.round(D.width * dpr)
canvas.height = Math.round(D.height * dpr)
ctx.scale(dpr, dpr)

ctx.fillStyle = D.bg
ctx.fillRect(0, 0, D.width, D.height)

for (const r of D.rects) {
  ctx.fillStyle = r.c
  ctx.fillRect(r.x, r.y, r.w, r.h)
}

ctx.lineJoin = 'round'
ctx.lineCap = 'round'
for (const line of D.lines) {
  const pts = line.pts
  ctx.strokeStyle = line.c
  ctx.lineWidth = line.w
  ctx.beginPath()
  ctx.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
  // Путь нулевой длины холст не рисует вовсе, даже со скруглёнными концами.
  // Одинокая корзина между двумя разрывами записи иначе молча исчезла бы.
  if (pts.length === 2) ctx.lineTo(pts[0] + 0.01, pts[1])
  ctx.stroke()
}

for (const p of D.prints) {
  // Вершина вверх — агрессивная покупка, вниз — агрессивная продажа. Сторона
  // сверена записью живой ленты, переворачивать нельзя.
  const dy = p.up ? -p.s : p.s
  ctx.beginPath()
  ctx.moveTo(p.x, p.y + dy)
  ctx.lineTo(p.x - p.s, p.y - dy)
  ctx.lineTo(p.x + p.s, p.y - dy)
  ctx.closePath()
  ctx.fillStyle = p.c
  ctx.fill()
  if (p.o) {
    ctx.strokeStyle = p.o
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

ctx.font = D.font
ctx.textBaseline = 'middle'
for (const l of D.labels) {
  ctx.textAlign = l.a
  // Свой цвет есть только у текста на плашке цены: на светлой заливке общие
  // чернила читались бы как пятно.
  ctx.fillStyle = l.c || D.ink
  ctx.fillText(l.s, l.x, l.y)
}

// Холст залит синхронно, но снимок делается по флагу: до первой композиции кадр
// может уйти пустым. Два кадра подряд — момент, когда нарисованное уже на экране.
requestAnimationFrame(function () {
  requestAnimationFrame(function () { window.__chartReady = true })
})`

export function flowChartHtml(input: FlowChartInput, theme: Theme = SAPPHIRE): string {
  // Экранируем '<' в данных: без этого тикер с угловой скобкой закрыл бы <script>
  // и страница молча развалилась бы.
  const payload = JSON.stringify(scene(input, theme)).replace(/</g, '\\u003c')
  const title = escapeHtml(`${input.summary.coin} · поток`)

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>${title}</title>
<style>${pageStyle(theme, input.width, input.height)}</style>
</head><body>
<div id="wrap"><canvas id="flow" width="${input.width}" height="${input.height}"></canvas></div>
<script>window.__DATA=${payload}</script>
<script>${BROWSER_SCRIPT}</script>
</body></html>`
}
