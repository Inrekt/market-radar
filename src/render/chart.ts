// Самодостаточная HTML-страница с графиком. Библиотека вшивается в файл, а не
// подгружается: страницу открывают через page.setContent() в headless-браузере
// без выхода наружу, поэтому любой внешний <script src> или веб-шрифт означал бы
// пустой кадр. Georgia берётся из системы и в сеть не ходит.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Candle } from '../hl.js'
import type { Markup } from '../ta/index.js'
import type { Line, Zone, ZoneKind } from '../ta/types.js'
import { SAPPHIRE, type Theme } from './theme.js'

/** Зона ниже этого — подпись внутрь не влезает и ставится над зоной. */
const MIN_LABEL_HEIGHT_PX = 12
/** Кегль подписей: мельче не переживает сжатие картинки телеграмом. */
const LABEL_FONT_PX = 11
/** Отступ подписи от края зоны и от начала линии. */
const LABEL_PAD_PX = 4
/** Ширина кармана слева от линии под подпись — под три знака Georgia italic 11px. */
const LINE_LABEL_ROOM_PX = 30
/**
 * Минимальный зазор между подписями, стоящими друг над другом в одной колонке.
 * Меньше кегля — строки касаются засечками; 14 при кегле 11 оставляет заметный
 * просвет, по которому глаз делит их на две подписи, а не на одну кашу.
 */
const LABEL_MIN_GAP_PX = 14

/**
 * Сколько последних баров показывать. На двух сотнях вся свежая структура —
 * зоны, у которых цена прямо сейчас, — сжимается в правую десятую кадра и
 * читается как полоска; девяносто баров держат её в различимом масштабе.
 */
const VISIBLE_BARS = 120
/**
 * Пустых мест справа. Не для красоты: подписи зон растут вправо от левого края
 * зоны, а зоны тянутся до правого края кадра — без этого поля им некуда встать,
 * и они лезут под плашку цены.
 */
const RIGHT_PAD_BARS = 12

/**
 * Поля ценовой шкалы. Штатные (0.2 сверху) отдают пустоте пятую часть кадра;
 * 0.08 поджимает свечи, но оставляет разметке воздух — подписи верхней и нижней
 * зоны не упираются в край.
 */
const PRICE_MARGIN_TOP = 0.08
const PRICE_MARGIN_BOTTOM = 0.08

const ZONE_TITLE: Record<ZoneKind, string> = { FVG: 'FVG', IFVG: 'I-FVG', OB: 'OB' }
/** Минус — типографский U+2212: дефис в курсиве с засечками читается как перенос. */
const SIGN = { up: ' +', dn: ' −' } as const

/**
 * Признак того, что зона продолжается за краем кадра. Стрелка стоит ПЕРЕД типом,
 * а не после знака направления: «FVG − ↑» читалось бы как спор знака со стрелкой,
 * а «↑ FVG −» — как указание, куда уходит сама зона. Набор тот же WGL4, что и
 * типографский минус выше, поэтому стрелка переживает подмену Georgia на любой
 * системный шрифт с засечками.
 */
const CUT_MARK = { up: '↑', dn: '↓', both: '↕' } as const

/**
 * Насколько заливка растворяется у среза. Прямоугольник с жёсткой кромкой ровно
 * по границе кадра читается как декоративная плашка поверх графика, а не как
 * уровень; 24 пикселя растушёвки хватает, чтобы глаз прочёл «полоса уходит за
 * кадр», и мало, чтобы зона потеряла собственные границы.
 */
const ZONE_FADE_PX = 24
/**
 * Растушёвка включается только там, где видимая часть зоны вдвое выше самой
 * растушёвки: у узкой полосы она съела бы всю заливку и оставила призрак.
 */
const ZONE_FADE_MIN_PX = ZONE_FADE_PX * 2

export interface ChartInput {
  readonly coin: string
  readonly interval: string
  readonly bars: readonly Candle[]
  readonly markup: Markup
  readonly width: number
  readonly height: number
  /** Сколько последних баров в кадре; по умолчанию VISIBLE_BARS. */
  readonly visibleBars?: number
  /** Пустых баров справа под подписи; по умолчанию RIGHT_PAD_BARS. */
  readonly rightPadBars?: number
}

let libCache: string | null = null

/**
 * Исходник библиотеки читается один раз на процесс: страниц за прогон десятки,
 * файл — 200 КБ. Глубокий путь внутрь пакета закрыт полем exports, поэтому
 * опираемся на package.json — единственный разрешённый вход.
 */
function libSource(): string {
  if (libCache === null) {
    const root = dirname(createRequire(import.meta.url).resolve('lightweight-charts/package.json'))
    libCache = readFileSync(join(root, 'dist', 'lightweight-charts.standalone.production.js'), 'utf8')
  }
  return libCache
}

/**
 * Библиотека требует строго возрастающего времени и бросает на повторе. Упавший
 * скрипт не выставит флаг готовности, и снимок будет ждать до таймаута вместо
 * того, чтобы просто получиться, — дешевле отбросить дубль здесь.
 */
function ascendingBars(bars: readonly Candle[]): object[] {
  const out: { time: number; open: number; high: number; low: number; close: number }[] = []
  for (const bar of bars) {
    const last = out.at(-1)
    if (last && bar.t <= last.time) continue
    out.push({ time: bar.t, open: bar.o, high: bar.h, low: bar.l, close: bar.c })
  }
  return out
}

function zonePayload(zone: Zone, theme: Theme): object {
  const fvg = zone.kind === 'FVG'
  return {
    from: zone.from,
    lo: zone.lo,
    hi: zone.hi,
    fill: fvg ? theme.zoneFvg : theme.zoneMuted,
    border: fvg ? theme.zoneBorderFvg : theme.zoneBorderMuted,
    label: ZONE_TITLE[zone.kind] + SIGN[zone.dir],
  }
}

function linePayload(line: Line): object {
  // Пунктир только у границ прошлых суток: они заданы календарём, а не рынком,
  // и должны отличаться от пулов ликвидности с одного взгляда.
  return { from: line.from, price: line.price, label: line.kind, dashed: line.kind === 'PDH' || line.kind === 'PDL' }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

function pageStyle(theme: Theme, width: number, height: number): string {
  const serif = `italic ${LABEL_FONT_PX}px/1.2 Georgia, 'Times New Roman', serif`
  return `
html,body{margin:0;padding:0;background:${theme.bg}}
/* Снимок делается один раз: любое движение к этому моменту только смажет кадр. */
*,*::before,*::after{animation:none!important;transition:none!important}
#wrap{position:relative;width:${width}px;height:${height}px;overflow:hidden}
/* z-index обязателен: библиотека вешает на свои холсты z-index до 50, и без
   собственного контекста наложения они всплывают выше слоя разметки — свечи
   рисуются, зоны и линии молча исчезают. */
#chart{position:absolute;left:0;top:0;width:${width}px;height:${height}px;z-index:0}
/* Слой разметки размером ровно в область графика: overflow режет всё, что
   вылезло бы за кадр, даже если координата пришла неожиданная. */
#overlay{position:absolute;left:0;top:0;overflow:hidden;pointer-events:none;z-index:1}
#overlay div{position:absolute}
.label{font:${serif};color:${theme.label};white-space:nowrap}
#caption{left:8px;bottom:6px}`
}

/**
 * Скрипт страницы. Всё, что можно решить заранее, решено в Node и лежит в
 * __DATA: цвета, подписи, знаки. Браузеру остаётся только перевести цены и время
 * в пиксели — правила разметки не должны существовать в двух местах.
 */
const BROWSER_SCRIPT = `
const D = window.__DATA
const box = document.getElementById('chart')
const layer = document.getElementById('overlay')

const chart = LightweightCharts.createChart(box, {
  width: D.width,
  height: D.height,
  layout: { background: { color: D.theme.bg }, textColor: D.theme.label, fontSize: 10, attributionLogo: false },
  grid: { vertLines: { color: D.theme.grid }, horzLines: { color: D.theme.grid } },
  rightPriceScale: { visible: true, borderColor: D.theme.axis, scaleMargins: { top: D.marginTop, bottom: D.marginBottom } },
  timeScale: { borderColor: D.theme.axis, timeVisible: true, secondsVisible: false },
  crosshair: { vertLine: { visible: false, labelVisible: false }, horzLine: { visible: false, labelVisible: false } },
  handleScroll: false,
  handleScale: false,
})

// В пятой версии addCandlestickSeries больше нет: серия заводится описанием.
// Старый вызов не бросает заметно — страница просто остаётся пустой.
const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
  upColor: D.theme.bull, borderUpColor: D.theme.bull, wickUpColor: D.theme.bull,
  downColor: D.theme.bear, borderDownColor: D.theme.bear, wickDownColor: D.theme.bear,
  lastValueVisible: false, priceLineVisible: false,
})
series.setData(D.bars)

// Своя плашка вместо штатной: у штатной цвет берётся от свечи, а тема требует
// одну и ту же плашку независимо от того, красный сейчас бар или зелёный.
if (D.bars.length) {
  series.createPriceLine({
    price: D.price, title: '', lineVisible: false, axisLabelVisible: true,
    color: D.theme.priceTagBg, axisLabelColor: D.theme.priceTagBg, axisLabelTextColor: D.theme.priceTagText,
  })
}
// Не fitContent: он вжимает все двести баров в ширину кадра, и свежая структура
// становится нечитаемой полоской у правого края. Показываем хвост, а данные
// оставляем целиком — индексы зон и линий считаются от полного массива, и любой
// срез сдвинул бы всю разметку.
if (D.bars.length) {
  chart.timeScale().setVisibleLogicalRange({
    // Клампим слева: на коротком отрезке (баров меньше окна) отрицательный край
    // отдал бы полкадра пустоте вместо того, чтобы просто показать всё, что есть.
    from: Math.max(0, D.bars.length - D.visibleBars),
    to: D.bars.length - 1 + D.rightPadBars,
  })
}

function px(value) { return Math.round(value) + 'px' }

function put(css, text, cls) {
  const el = document.createElement('div')
  el.style.cssText = css
  if (cls) el.className = cls
  if (text) el.textContent = text
  layer.appendChild(el)
  return el
}

// Подписи не ставятся сразу: их позиции зависят друг от друга, а зоны и линии
// приходят в двух отдельных проходах. Копим заявки, разводим одним разом.
const queued = []

function label(x, y, text, room) {
  queued.push({ x: Math.max(0, x), y: Math.max(0, y), text: text, room: room || 0 })
}

/**
 * Разведение подписей по вертикали. Три зоны рядом по цене дают три подписи в
 * одной точке — у правого края они слипаются друг с другом и с плашкой цены в
 * нечитаемый ком. Сдвигается ТОЛЬКО подпись: границы прямоугольника зоны
 * остаются на месте, иначе картинка соврёт про цену.
 */
function placeLabels(h) {
  const items = []
  for (const req of queued) {
    const el = put('left:' + px(req.x), req.text, 'label')
    if (req.room) {
      el.style.width = px(req.room)
      el.style.textAlign = 'right'
    }
    // Ширину меряем у живого элемента: кегль курсивной Georgia по строке заранее
    // не посчитать, а без ширины непонятно, какие подписи вообще стоят в колонку.
    items.push({ el: el, y: req.y, x0: req.x, x1: req.x + el.offsetWidth, h: el.offsetHeight || D.labelPx })
  }
  items.sort(function (a, b) { return a.y - b.y })
  const placed = []
  for (const item of items) {
    let y = item.y
    for (const done of placed) {
      // Разводим только те, что реально стоят друг над другом: подпись у левого
      // края кадра и подпись у правого друг другу не мешают.
      const sameColumn = done.x1 > item.x0 && item.x1 > done.x0
      if (sameColumn && y - done.y < D.labelGap) y = done.y + D.labelGap
    }
    // Уехавшую за нижний край не рисуем вовсе: потерять одну подпись дешевле,
    // чем получить обрезок, налезающий на шкалу времени.
    if (y + item.h > h) {
      item.el.remove()
      continue
    }
    item.el.style.top = px(y)
    item.y = y
    placed.push(item)
  }
}

/**
 * Заливка зоны. У стороны, срезанной краем кадра, заливка растворяется: зона там
 * не кончается, и ровная кромка по границе кадра соврала бы про уровень — а
 * заодно превратила бы разметку в плашку поверх графика. Срез с обеих сторон
 * растушёвывать нечем: такая зона накрывает весь кадр, и растворять пришлось бы
 * её целиком.
 */
function zoneFill(zone, cutTop, cutBottom, height) {
  if (cutTop === cutBottom || height < D.fadeMinPx) return 'background:' + zone.fill
  return 'background:linear-gradient(' + (cutTop ? 'to top' : 'to bottom') + ','
    + zone.fill + ' calc(100% - ' + D.fadePx + 'px),transparent)'
}

/**
 * Рамка. По срезанной стороне её нет: линия ровно по краю кадра — ложная
 * граница, глаз читает её как уровень, которого на этой цене не существует.
 */
function zoneBorder(zone, cutTop, cutBottom, cutLeft) {
  return 'border:1px solid ' + zone.border
    + (cutTop ? ';border-top:none' : '') + (cutBottom ? ';border-bottom:none' : '')
    + (cutLeft ? ';border-left:none' : '')
}

function drawZone(zone, w, h) {
  const bar = D.bars[zone.from]
  if (!bar) return
  const x = chart.timeScale().timeToCoordinate(bar.time)
  const yHi = series.priceToCoordinate(zone.hi)
  const yLo = series.priceToCoordinate(zone.lo)
  // null означает, что цена или время вне видимого диапазона. Растянуть под
  // зону шкалу — значит поменять картинку ради разметки, поэтому просто молчим.
  if (x === null || yHi === null || yLo === null) return
  const rawTop = Math.min(yHi, yLo)
  const rawBottom = Math.max(yHi, yLo)
  const top = Math.max(0, rawTop)
  const bottom = Math.min(h, rawBottom)
  const left = Math.max(0, x)
  if (bottom <= top || left >= w) return
  // Зона реальна и тогда, когда в кадр влезла не целиком: её рисуем как есть, а
  // про обрезку говорим разметкой — шкалу под неё не трогаем, кадр строится по
  // цене, а не по разметке.
  const cutTop = rawTop < 0
  const cutBottom = rawBottom > h
  const height = bottom - top
  put('left:' + px(left) + ';top:' + px(top) + ';width:' + px(w - left) + ';height:' + px(height) +
      ';' + zoneFill(zone, cutTop, cutBottom, height) +
      ';' + zoneBorder(zone, cutTop, cutBottom, x < 0) + ';box-sizing:border-box')
  const mark = cutTop && cutBottom ? D.cut.both : cutTop ? D.cut.up : cutBottom ? D.cut.dn : ''
  const fits = height >= D.minLabelPx
  // Подпись держится за НАСТОЯЩУЮ границу зоны. У срезанной сверху она одна —
  // нижняя: подпись у неё читается как уровень, тогда как та же надпись в верхнем
  // углу кадра читается шапкой картинки и к зоне не относится вовсе.
  const atBottom = cutTop && !cutBottom
  const y = atBottom
    ? (fits ? bottom - D.labelPx - D.pad : bottom + D.pad)
    : (fits ? top + D.pad : top - D.labelPx - D.pad)
  label(left + D.pad, y, mark ? mark + ' ' + zone.label : zone.label)
}

function drawLine(line, w, h) {
  const bar = D.bars[line.from]
  if (!bar) return
  const x = chart.timeScale().timeToCoordinate(bar.time)
  const y = series.priceToCoordinate(line.price)
  if (x === null || y === null || y < 0 || y > h) return
  const left = Math.max(0, x)
  if (left >= w) return
  put('left:' + px(left) + ';top:' + px(y) + ';width:' + px(w - left) +
      ';height:0;border-top:1px ' + (line.dashed ? 'dashed ' : 'solid ') + D.theme.line)
  // Подпись слева от начала линии; если кармана нет, уводим вправо — за кадр
  // разметка не уезжает ни при каких координатах.
  const roomy = left >= D.lineLabelRoom
  label(roomy ? left - D.lineLabelRoom : left + D.pad, y - D.labelPx / 2, line.label,
        roomy ? D.lineLabelRoom - D.pad : 0)
}

function draw() {
  const scale = chart.timeScale()
  const w = scale.width()
  const h = box.clientHeight - scale.height()
  layer.style.width = px(w)
  layer.style.height = px(h)
  for (const zone of D.zones) drawZone(zone, w, h)
  for (const line of D.lines) drawLine(line, w, h)
  placeLabels(h)
}

// Отрисовка не мгновенная: библиотека рисует холст в своём кадре анимации, и до
// него timeToCoordinate возвращает координаты предыдущего состояния или null.
// Два кадра подряд после смены видимого диапазона — момент, когда холст уже нарисован.
// Третий кадр отдан оверлеям: снимок делается по флагу, и всё, что не успело
// лечь до него, на картинку не попадёт.
requestAnimationFrame(() => requestAnimationFrame(() => {
  draw()
  requestAnimationFrame(() => { window.__chartReady = true })
}))`

export function chartHtml(input: ChartInput, theme: Theme = SAPPHIRE): string {
  const data = {
    coin: input.coin,
    width: input.width,
    height: input.height,
    price: input.markup.price,
    bars: ascendingBars(input.bars),
    zones: input.markup.zones.map((zone) => zonePayload(zone, theme)),
    lines: input.markup.lines.map(linePayload),
    theme,
    minLabelPx: MIN_LABEL_HEIGHT_PX,
    labelPx: LABEL_FONT_PX,
    pad: LABEL_PAD_PX,
    cut: CUT_MARK,
    fadePx: ZONE_FADE_PX,
    fadeMinPx: ZONE_FADE_MIN_PX,
    lineLabelRoom: LINE_LABEL_ROOM_PX,
    labelGap: LABEL_MIN_GAP_PX,
    visibleBars: input.visibleBars ?? VISIBLE_BARS,
    rightPadBars: input.rightPadBars ?? RIGHT_PAD_BARS,
    marginTop: PRICE_MARGIN_TOP,
    marginBottom: PRICE_MARGIN_BOTTOM,
  }
  // Экранируем '<' в данных: без этого цена или тикер с угловой скобкой закрыли
  // бы <script> и страница молча развалилась бы.
  const payload = JSON.stringify(data).replace(/</g, '\\u003c')
  const caption = `${escapeHtml(input.coin)} · ${escapeHtml(input.interval)}`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${caption}</title>
<style>${pageStyle(theme, input.width, input.height)}</style>
</head><body>
<div id="wrap"><div id="chart"></div><div id="overlay"><div id="caption" class="label">${caption}</div></div></div>
<script>${libSource()}</script>
<script>window.__DATA=${payload}</script>
<script>${BROWSER_SCRIPT}</script>
</body></html>`
}
