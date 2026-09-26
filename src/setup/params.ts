// Числа сетапа. Репозиторий публичный, поэтому в коде — нейтральные заглушки, а настоящие
// значения владельца живут в секрете SETUP_PARAMS (JSON) и в локальном .env.
// Читаются лениво: к первому вызову main() уже подгрузил .env.

import type { Side } from './types.js'

export interface SetupParams {
  /** шаг 1: до уровня меньше стольких часовых ATR */
  readonly approachAtr: number
  /** шаг 1 будит только ради кластера от этой суммы, $ */
  readonly majorLiqUsd: number
  /** прокол дальше этой доли ATR таймфрейма */
  readonly sweepTolAtr: number
  /** прокол среди стольких последних баров */
  readonly sweepLookback: number
  /** прошлый прокол в этом окне делает свип двойным */
  readonly doubleWindow: number
  /** «вся ликвидность» за экстремумом — не дальше стольких часовых ATR */
  readonly stopClusterAtr: number
  /** запас за последней ликвидностью, часовых ATR */
  readonly stopMarginAtr: number
  /** цель не дальше стольких часовых ATR */
  readonly maxTargetAtr: number
  readonly minRr: number
  /** за стопом ликвидности больше в столько раз, чем у цели, — не входить */
  readonly balanceMax: number
  /** поглощение: продажи на проколе в столько раз больше покупок */
  readonly absorptionRatio: number
  /** порог крупных сделок по монетам, $ */
  readonly bigMinUsd: Readonly<Record<string, number>>
  readonly bigMinDefaultUsd: number
  /** плечи модели ликвидаций и их доли */
  readonly tiers: readonly { readonly lev: number, readonly w: number }[]
  readonly mmr: number
  /** доля позиции на первом тейке */
  readonly tp1Share: number
  readonly nearPerHour: number
  /** бюджет риска на идею, $ — для перевода R в деньги */
  readonly budgetUsd: number
  /** какие стороны торгуются по монете */
  readonly sides: Readonly<Record<string, readonly Side[]>>
}

export const DEFAULT_PARAMS: SetupParams = {
  approachAtr: 0.5, majorLiqUsd: 10_000_000, sweepTolAtr: 0.1, sweepLookback: 2, doubleWindow: 8,
  stopClusterAtr: 0.5, stopMarginAtr: 0.2, maxTargetAtr: 10, minRr: 1.5, balanceMax: 2, absorptionRatio: 2,
  bigMinUsd: {}, bigMinDefaultUsd: 100_000, tiers: [{ lev: 20, w: 0.5 }, { lev: 50, w: 0.5 }], mmr: 0.005,
  tp1Share: 0.33, nearPerHour: 2, budgetUsd: 50,
  sides: { BTC: ['long', 'short'], ETH: ['long', 'short'], SOL: ['long', 'short'] },
}

const NUMBERS = ['approachAtr', 'majorLiqUsd', 'sweepTolAtr', 'sweepLookback', 'doubleWindow', 'stopClusterAtr',
  'stopMarginAtr', 'maxTargetAtr', 'minRr', 'balanceMax', 'absorptionRatio', 'bigMinDefaultUsd', 'mmr', 'tp1Share',
  'nearPerHour', 'budgetUsd'] as const

function valid(p: SetupParams): boolean {
  const positive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0
  const tiersOk = p.tiers.length > 0 && p.tiers.every((t) => positive(t.lev) && positive(t.w))
    && Math.abs(p.tiers.reduce((a, t) => a + t.w, 0) - 1) < 1e-6
  const sidesOk = Object.values(p.sides).every((list) => list.every((s) => s === 'long' || s === 'short'))
  return NUMBERS.every((k) => positive(p[k])) && p.tp1Share < 1
    && Object.values(p.bigMinUsd).every(positive) && tiersOk && sidesOk
}

/** Настоящие числа из JSON поверх заглушек. Ошибка — заглушки; значения в лог не пишутся. */
export function parseParams(raw: string | undefined): SetupParams {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PARAMS
  try {
    const merged = { ...DEFAULT_PARAMS, ...(JSON.parse(raw) as Partial<SetupParams>) }
    if (valid(merged)) return merged
  } catch {
    // ниже — общий ответ
  }
  console.error('SETUP_PARAMS не разобран — сетап работает на заглушках')
  return DEFAULT_PARAMS
}

let cached: SetupParams | null = null

export function P(): SetupParams {
  cached ??= parseParams(process.env.SETUP_PARAMS)
  return cached
}
