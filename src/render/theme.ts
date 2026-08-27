// Палитра Sapphire. Оттенки и их непрозрачность задал владелец, менять нельзя.
// Здесь они разложены на базовый цвет и альфу и собираются в rgba(): один и тот
// же оттенок должен ложиться и в заливку зоны, и в текст подписи, а hex+opacity
// умеет только заливку — прозрачность элемента утащила бы за собой и подпись.

export interface Theme {
  readonly bg: string
  readonly grid: string
  readonly bull: string
  readonly bear: string
  readonly zoneFvg: string
  readonly zoneMuted: string
  readonly zoneBorderFvg: string
  readonly zoneBorderMuted: string
  readonly line: string
  readonly label: string
  readonly axis: string
  readonly priceTagBg: string
  readonly priceTagText: string
  readonly arrowUp: string
  readonly arrowDn: string
}

type Rgb = readonly [number, number, number]

/** #080808 — фон, он же текст на плашке цены. */
const VOID: Rgb = [8, 8, 8]
/** #d3ddf4 — бычья свеча. */
const ICE: Rgb = [211, 221, 244]
/** #787b86 — медвежья свеча, подписи, линии, приглушённые зоны. */
const ASH: Rgb = [120, 123, 134]
/** #96a8e6 — единственный акцент темы, отдан разрывам (FVG). */
const AZURE: Rgb = [150, 168, 230]

/** Непрозрачность свечей из темы. */
const CANDLE_ALPHA = 0.71
/** Непрозрачность заливки зон из темы. */
const ZONE_ALPHA = 0.19
/**
 * Рамка вдвое плотнее заливки: на фоне #080808 край 19-процентного пятна не
 * читается, и две соседние зоны сливаются в одну.
 */
const ZONE_BORDER_ALPHA = 0.38
/** Сетка задаёт масштаб, но спорить со свечами не должна — почти невидима. */
const GRID_ALPHA = 0.07
/** Рамки шкал: заметнее сетки, тише свечей. */
const AXIS_ALPHA = 0.22
/** Плашка цены — единственное плотное пятно в кадре, иначе цену не найти взглядом. */
const PRICE_TAG_ALPHA = 0.92

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`
}

export const SAPPHIRE: Theme = {
  bg: rgba(VOID, 1),
  grid: rgba(ASH, GRID_ALPHA),
  bull: rgba(ICE, CANDLE_ALPHA),
  bear: rgba(ASH, CANDLE_ALPHA),
  zoneFvg: rgba(AZURE, ZONE_ALPHA),
  zoneMuted: rgba(ASH, ZONE_ALPHA),
  zoneBorderFvg: rgba(AZURE, ZONE_BORDER_ALPHA),
  zoneBorderMuted: rgba(ASH, ZONE_BORDER_ALPHA),
  // Линия ликвидности весит столько же, сколько медвежья свеча: это ориентир,
  // а не разметка поверх графика.
  line: rgba(ASH, CANDLE_ALPHA),
  label: rgba(ASH, 1),
  axis: rgba(ASH, AXIS_ALPHA),
  priceTagBg: rgba(ICE, PRICE_TAG_ALPHA),
  priceTagText: rgba(VOID, 1),
  arrowUp: rgba(AZURE, 1),
  arrowDn: rgba(ASH, 1),
}
