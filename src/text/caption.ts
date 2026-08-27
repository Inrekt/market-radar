// Подписи под карточкой /ta: краткая идёт в ленту, подробная — по запросу.
// Числа форматирует код, а не модель: «сильный уровень» не проверяется ничем,
// а «97.80, три касания, +1.9% от цены» сверяется глазом по той же картинке.

import type { AssetCtx } from '../hl.js'
import type { Markup } from '../ta/index.js'
import type { Line, Zone } from '../ta/types.js'

export interface WhaleSummary {
  readonly positions: number
  readonly longUsd: number
  readonly shortUsd: number
  /** средневзвешенная цена входа; 0 — если позиций нет */
  readonly avgEntry: number
}

export interface CaptionInput {
  readonly coin: string
  readonly interval: string
  readonly markup: Markup
  readonly ctx: AssetCtx | null
  readonly whales: WhaleSummary | null
}

const MAX_SHORT_LINES = 8 // больше восьми строк под картинкой не читают — пролистывают
const MAX_SHORT_LEVELS = 3 // столько цен влезает в строку до переноса на телефоне
const MAX_INVALIDATIONS = 4 // дальше это уже не план, а перечисление всех цен подряд
const HOURS_PER_YEAR = 24 * 365 // фандинг у Hyperliquid начисляется каждый час, отсюда годовые
const FUNDING_DECIMALS = 4 // часовая ставка живёт в тысячных процента, трёх знаков не хватит
const PCT_DECIMALS = 1
const MIN_PRICE_DECIMALS = 2 // иначе «100» и «96.06» в одном столбце читаются как разные величины
const INVALIDATION_ATR = 2 // дальше двух ATR от цены разметка описывает уже не этот рынок
const MILLION = 1e6
const BILLION = 1e9
const NO_DATA = '—'
const COL_GAP = '   '

function trimZeros(fixed: string, minDecimals: number): string {
  const dot = fixed.indexOf('.')
  if (dot < 0) return fixed
  const frac = fixed.slice(dot + 1)
  let end = frac.length
  while (end > minDecimals && frac[end - 1] === '0') end -= 1
  return end === 0 ? fixed.slice(0, dot) : `${fixed.slice(0, dot)}.${frac.slice(0, end)}`
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Единственный денежный формат в проекте: $1.2M, $501M, $1.24B, $12 500. */
export function fmtMoney(value: number): string {
  if (!Number.isFinite(value)) return NO_DATA
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs < MILLION) return `${sign}$${groupThousands(abs.toFixed(0))}`
  const scaled = abs >= BILLION ? abs / BILLION : abs / MILLION
  // Три значащие цифры: $1.24B и $501M одинаково информативны, длиннее — шум.
  const digits = trimZeros(scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2), 0)
  return `${sign}$${digits}${abs >= BILLION ? 'B' : 'M'}`
}

export function fmtPct(value: number, decimals = PCT_DECIMALS): string {
  if (!Number.isFinite(value)) return NO_DATA
  const fixed = value.toFixed(decimals)
  // «-0.0%» — след округления, а не направление: минус тут врал бы про сторону.
  if (Number(fixed) === 0) return `+${(0).toFixed(decimals)}%`
  return fixed.startsWith('-') ? `${fixed}%` : `+${fixed}%`
}

/** Шаг цены у монет разный: у SOL значащие знаки в сотых, у PEPE — в восьмых. */
function priceDecimals(abs: number): number {
  if (abs >= 1000) return 2
  if (abs >= 1) return 4
  if (abs >= 0.01) return 6
  return 8
}

export function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return NO_DATA
  const abs = Math.abs(value)
  const trimmed = trimZeros(abs.toFixed(priceDecimals(abs)), MIN_PRICE_DECIMALS)
  const dot = trimmed.indexOf('.')
  const body = dot < 0 ? groupThousands(trimmed) : `${groupThousands(trimmed.slice(0, dot))}${trimmed.slice(dot)}`
  return value < 0 ? `-${body}` : body
}

/** Для подписей: одно количество знаков для всех цен в одной подписи. */
function captionPriceDecimals(abs: number): number {
  if (abs >= 1000) return 1
  if (abs >= 100) return 2
  if (abs >= 1) return 2
  if (abs >= 0.01) return 4
  return 6
}

/** Форматирует цену для подписей с единым количеством знаков. */
function formatCaptionPrice(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return NO_DATA
  const abs = Math.abs(value)
  const trimmed = trimZeros(abs.toFixed(decimals), decimals)
  const dot = trimmed.indexOf('.')
  const body = dot < 0 ? groupThousands(trimmed) : `${groupThousands(trimmed.slice(0, dot))}${trimmed.slice(dot)}`
  return value < 0 ? `-${body}` : body
}

/** Столбцы влево, последний вправо: проценты так читаются по знаку, а не по длине. */
function aligned(rows: readonly (readonly string[])[]): string[] {
  const width = (i: number): number => Math.max(...rows.map((row) => (row[i] ?? '').length))
  const cells = (row: readonly string[]): string[] =>
    row.map((c, i) => (i === row.length - 1 ? c.padStart(width(i)) : c.padEnd(width(i))))
  return rows.map((row) => `  ${cells(row).join(COL_GAP)}`.trimEnd())
}

function distancePct(from: number, to: number): number {
  return from === 0 ? 0 : ((to - from) / from) * 100
}

/** Расстояние до ближней границы: зона выше цены даёт плюс, ниже — минус. */
function zoneDistance(zone: Zone, price: number): number {
  if (price >= zone.lo && price <= zone.hi) return 0
  return distancePct(price, price < zone.lo ? zone.lo : zone.hi)
}

/** Знак у типа — направление зоны: up работает как опора, dn как сопротивление. */
function zoneLabel(zone: Zone): string {
  const sign = zone.dir === 'up' ? '+' : '−' // U+2212 минус вместо дефиса
  const kind = zone.kind === 'IFVG' ? 'I-FVG' : zone.kind
  return `${kind} ${sign}`
}
function containing(zones: readonly Zone[], price: number): Zone | undefined {
  return zones.find((zone) => !zone.mitigated && price >= zone.lo && price <= zone.hi)
}
function nearestAbove(zones: readonly Zone[], price: number): Zone | undefined {
  return zones.filter((zone) => zone.lo > price).sort((a, b) => a.lo - b.lo)[0]
}
function nearestBelow(zones: readonly Zone[], price: number): Zone | undefined {
  return zones.filter((zone) => zone.hi < price).sort((a, b) => b.hi - a.hi)[0]
}

// Сверху/снизу считаем по цене, а не по типу: снятый BSL остаётся BSL, но висит
// уже под ценой — читателю важно, где он на картинке, а не как он назван.
function linesAbove(lines: readonly Line[], price: number): Line[] {
  return lines.filter((line) => line.price > price).sort((a, b) => a.price - b.price)
}
function linesBelow(lines: readonly Line[], price: number): Line[] {
  return lines.filter((line) => line.price <= price).sort((a, b) => b.price - a.price)
}

function fundingText(ctx: AssetCtx): string {
  return `${fmtPct(ctx.funding * 100, FUNDING_DECIMALS)}/час (${fmtPct(ctx.funding * HOURS_PER_YEAR * 100)} годовых)`
}
/** OI приходит в монетах — в доллары его переводит только цена марки. */
function oiUsd(ctx: AssetCtx): number {
  return ctx.openInterest * ctx.markPx
}
/** Факты о китах одни и те же в обеих подписях — расходится только обёртка. */
function whaleFacts(whales: WhaleSummary, price: number, decimals?: number): string[] {
  const net = whales.longUsd - whales.shortUsd
  const facts = [
    `позиций ${whales.positions}`,
    `лонг ${fmtMoney(whales.longUsd)} / шорт ${fmtMoney(whales.shortUsd)}`,
    `перевес ${net >= 0 ? 'в лонг' : 'в шорт'} ${fmtMoney(Math.abs(net))}`,
  ]
  if (whales.avgEntry === 0) return facts
  const drift = fmtPct(distancePct(whales.avgEntry, price))
  const fmtEntry = decimals !== undefined ? formatCaptionPrice(whales.avgEntry, decimals) : fmtPrice(whales.avgEntry)
  return [...facts, `средний вход ${fmtEntry} (${drift} к цене)`]
}

export function shortCaption(input: CaptionInput): string {
  const { markup: mk, ctx, whales } = input
  const price = mk.price

  // Собираем все цены из подписи для определения единого количества знаков
  const allPrices: number[] = [price]
  for (const zone of mk.zones) {
    allPrices.push(zone.lo, zone.hi)
  }
  for (const line of mk.lines) {
    allPrices.push(line.price)
  }
  if (whales?.avgEntry) {
    allPrices.push(whales.avgEntry)
  }

  const maxPrice = Math.max(...allPrices)
  const decimals = captionPriceDecimals(maxPrice)
  const fmt = (p: number) => formatCaptionPrice(p, decimals)

  const out: string[] = [`${input.coin} · ${input.interval} · ${fmt(price)}`]

  const inside = containing(mk.zones, price)
  if (inside) out.push(`Цена внутри ${zoneLabel(inside)} ${fmt(inside.lo)} — ${fmt(inside.hi)} — движение упирается в неё`)

  const above = nearestAbove(mk.zones, price)
  const below = nearestBelow(mk.zones, price)
  const zones: string[] = []
  if (above) zones.push(`сверху ${zoneLabel(above)} ${fmt(above.lo)} — ${fmt(above.hi)} (${fmtPct(zoneDistance(above, price))})`)
  if (below) zones.push(`снизу ${zoneLabel(below)} ${fmt(below.lo)} — ${fmt(below.hi)} (${fmtPct(zoneDistance(below, price))})`)
  if (zones.length > 0) out.push(`Зоны: ${zones.join(' · ')}`)

  const shown = (list: readonly Line[]): string[] => list.slice(0, MAX_SHORT_LEVELS).map((line) => fmt(line.price))
  const up = shown(linesAbove(mk.lines, price))
  const down = shown(linesBelow(mk.lines, price))
  const liq: string[] = []
  if (up.length > 0) liq.push(`сверху ${up.join(' / ')}`)
  if (down.length > 0) liq.push(`снизу ${down.join(' / ')}`)
  if (liq.length > 0) out.push(`Ликвидность: ${liq.join(' · ')}`)

  if (ctx) {
    out.push(`Фандинг ${fundingText(ctx)}`)
    out.push(`OI ${fmtMoney(oiUsd(ctx))} · оборот за сутки ${fmtMoney(ctx.dayNtlVlm)}`)
  }
  if (whales) {
    const whaleFacts_ = whales.positions > 0
      ? whaleFacts(whales, price, decimals).join(' · ')
      : 'открытых позиций нет'
    out.push(`Киты: ${whaleFacts_}`)
  }
  return out.slice(0, MAX_SHORT_LINES).join('\n')
}

function structureText(mk: Markup, decimals: number): string {
  const fmt = (p: number) => formatCaptionPrice(p, decimals)
  const price = mk.price
  const up = mk.zones.filter((zone) => zone.lo > price).length
  const down = mk.zones.filter((zone) => zone.hi < price).length
  const counts = `Выше цены зон: ${up}, ниже: ${down}, уровней ликвидности: ${mk.lines.length}.`
  const inside = containing(mk.zones, price)
  if (inside) return `Цена стоит внутри ${zoneLabel(inside)} ${fmt(inside.lo)} — ${fmt(inside.hi)}:`
    + ` пока она не вышла за границы, направления нет. ${counts}`
  const side = (zone: Zone): string => `${zoneLabel(zone)} ${fmt(zone.lo)} — ${fmt(zone.hi)}`
    + ` ${zone.lo > price ? 'сверху' : 'снизу'} (${fmtPct(zoneDistance(zone, price))})`
  const near = [nearestBelow(mk.zones, price), nearestAbove(mk.zones, price)].filter((zone): zone is Zone => zone !== undefined)
  if (near.length === 0) return `Незакрытых зон рядом с ценой нет. ${counts}`
  const head = near.length === 2 ? 'Цена между' : 'Единственная незакрытая зона рядом —'
  return `${head} ${near.map(side).join(' и ')}. ${counts}`
}

function zoneRows(mk: Markup, decimals: number): string[] {
  const fmt = (p: number) => formatCaptionPrice(p, decimals)
  const rows = [...mk.zones].sort((a, b) => b.hi - a.hi)
    .map((zone) => [fmt(zone.lo) + ' — ' + fmt(zone.hi), zoneLabel(zone), fmtPct(zoneDistance(zone, mk.price))])
  return rows.length > 0 ? aligned(rows) : []
}

function lineRows(mk: Markup, decimals: number): string[] {
  const fmt = (p: number) => formatCaptionPrice(p, decimals)
  const rows = [...mk.lines].sort((a, b) => b.price - a.price)
    .map((line) => [fmt(line.price), line.kind, line.touches > 0 ? `${line.touches} касан.` : '',
      fmtPct(distancePct(mk.price, line.price))])
  return rows.length > 0 ? aligned(rows) : []
}

/** Пробой дальней границы зоны — единственное, что проверяется закрытием бара. */
function edgeBreak(zone: Zone, price: number, low: boolean, fmt: (p: number) => string): string {
  const edge = low ? zone.lo : zone.hi
  const role = low ? 'опоры снизу больше нет' : 'сопротивления сверху больше нет'
  const where = `${low ? 'под' : 'над'} ${fmt(edge)}`
  const kind = zone.kind === 'IFVG' ? 'I-FVG' : zone.kind
  return `закрытие бара ${where} — граница ${kind} (${fmtPct(distancePct(price, edge))}) — ${role}`
}

// Условия отмены — только цены из самой разметки. То, что нельзя проверить
// закрытием бара, сюда не попадает: иначе это прогноз, а не условие.
function invalidations(mk: Markup, whales: WhaleSummary | null, decimals: number): string[] {
  const fmt = (p: number) => formatCaptionPrice(p, decimals)
  const price = mk.price
  const out: string[] = []
  const inside = containing(mk.zones, price)
  const below = nearestBelow(mk.zones, price)
  const above = nearestAbove(mk.zones, price)
  if (inside) {
    const kind = inside.kind === 'IFVG' ? 'I-FVG' : inside.kind
    out.push(`закрытие бара под ${fmt(inside.lo)} или над ${fmt(inside.hi)}`
      + ` — цена вышла из ${kind}, в котором стоит сейчас`)
  }
  if (below) out.push(edgeBreak(below, price, true, fmt))
  if (above) out.push(edgeBreak(above, price, false, fmt))
  const down = linesBelow(mk.lines, price)[0]
  if (down) out.push(`прокол ${fmt(down.price)} (${down.kind}) — ликвидность снизу снята`)
  const up = linesAbove(mk.lines, price)[0]
  if (up) out.push(`прокол ${fmt(up.price)} (${up.kind}) — ликвидность сверху снята`)
  if (whales && whales.avgEntry > 0) {
    const wall = whales.longUsd >= whales.shortUsd ? 'под' : 'над'
    out.push(`закрепление ${wall} ${fmt(whales.avgEntry)} — средним входом китов`
      + ' — уводит их перевес в убыток')
  }
  const span = INVALIDATION_ATR * mk.atr
  if (span > 0) out.push(`ход за ${fmt(price - span)} или ${fmt(price + span)}`
    + ` (${INVALIDATION_ATR} ATR) — разметка пересчитывается целиком`)
  return out.slice(0, MAX_INVALIDATIONS)
}

function section(title: string, body: readonly string[]): string[] {
  return body.length > 0 ? [`${title}\n${body.join('\n')}`] : []
}

export function longCaption(input: CaptionInput): string {
  const { markup: mk, ctx, whales } = input

  // Собираем все цены из подписи для определения единого количества знаков
  const allPrices: number[] = [mk.price, mk.atr]
  for (const zone of mk.zones) {
    allPrices.push(zone.lo, zone.hi)
  }
  for (const line of mk.lines) {
    allPrices.push(line.price)
  }
  if (whales?.avgEntry) {
    allPrices.push(whales.avgEntry)
  }

  const maxPrice = Math.max(...allPrices)
  const decimals = captionPriceDecimals(maxPrice)
  const fmt = (p: number) => formatCaptionPrice(p, decimals)

  const blocks: string[] = [
    `${input.coin} · ${input.interval} · ${fmt(mk.price)} · ATR бара ${fmt(mk.atr)}`,
    `СТРУКТУРА\n${structureText(mk, decimals)}`,
    ...section('ЗОНЫ', zoneRows(mk, decimals)),
    ...section('ЛИКВИДНОСТЬ', lineRows(mk, decimals)),
  ]
  if (ctx) {
    blocks.push(...section('ДЕРИВАТИВЫ', [
      `  фандинг            ${fundingText(ctx)}`,
      `  открытый интерес   ${fmtMoney(oiUsd(ctx))}`,
      `  оборот за сутки    ${fmtMoney(ctx.dayNtlVlm)}`,
    ]))
  }
  if (whales) {
    const facts = whales.positions > 0 ? whaleFacts(whales, mk.price, decimals) : ['открытых позиций нет']
    blocks.push(...section('КИТЫ', facts.map((fact) => `  ${fact}`)))
  }
  blocks.push(...section('ЧТО ОТМЕНЯЕТ КАРТИНУ', invalidations(mk, whales, decimals).map((text) => `  · ${text}`)))
  return blocks.join('\n\n')
}
