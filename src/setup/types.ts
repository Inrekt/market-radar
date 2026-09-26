// Сетап владельца: свип ликвидности + подтверждение потоком + цель в кластер.
// Правила записаны в «Моя стратегия.md» (prop-journal); здесь только их перевод в код.

export type Side = 'long' | 'short'

/** Откуда уровень: пул равных экстремумов, граница суток или кластер ликвидаций китов HL. */
export type LevelSource = 'pool' | 'day' | 'liq'

export interface Level {
  readonly price: number
  readonly source: LevelSource
  /** касаний у пула; у кластера — число позиций */
  readonly weight: number
  /** долларов ликвидаций в кластере; у пулов и границ суток — 0 */
  readonly usd: number
  /** таймфрейм, на котором найден уровень: 15м, 1ч, 4ч, сутки, HL */
  readonly tf: string
  readonly label: string
}

export interface Sweep {
  readonly side: Side
  readonly tf: string
  readonly level: Level
  /** экстремум прокола — самая дальняя цена за уровнем */
  readonly extreme: number
  /** закрытие бара возврата */
  readonly reclaim: number
  /** начало бара, на котором уровень прокололи впервые, мс */
  readonly sweepStartMs: number
  /** начало бара возврата, мс */
  readonly reclaimStartMs: number
  readonly double: boolean
}

export interface FlowCheck {
  /** рыночные покупки минус продажи после возврата, $ (для шорта знак развёрнут) */
  readonly deltaUsd: number
  readonly bigForUsd: number
  readonly bigAgainstUsd: number
  /** рыночные продажи минус покупки на проколе, $ (для шорта знак развёрнут) */
  readonly pierceDeltaUsd: number
  readonly whaleNetUsd: number
  readonly delta: boolean
  readonly big: boolean
  readonly absorption: boolean
  readonly whales: boolean
  /** хотя бы одно движение потока в сторону сделки */
  readonly confirmed: boolean
  /** сколько минут окна реально покрыто записью потока */
  readonly coveredMinutes: number
}

export interface Balance {
  readonly stopSideUsd: number
  readonly targetSideUsd: number
  /** за стопом ликвидности не сильно больше, чем у цели */
  readonly ok: boolean
  /** самый крупный кластер за стопом — туда лимитки, если баланс плохой */
  readonly biggestAgainst: Level | null
}

export interface Plan {
  readonly side: Side
  readonly entry: number
  readonly limits: readonly number[]
  readonly stop: number
  readonly tp1: number
  readonly tp1Label: string
  readonly target: Level
  readonly rr: number
  readonly balance: Balance
}
