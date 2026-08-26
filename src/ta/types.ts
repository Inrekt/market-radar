// Общие типы разметки. Детекторы — чистые функции: свечи на входе, зоны и
// линии на выходе, никакого доступа к сети и диску.

export type ZoneKind = 'FVG' | 'IFVG' | 'OB'
export type LineKind = 'SSL' | 'BSL' | 'PDH' | 'PDL'
/** up — зона работает как поддержка, dn — как сопротивление */
export type Dir = 'up' | 'dn'

export interface Zone {
  readonly kind: ZoneKind
  readonly dir: Dir
  /** индекс бара, с которого зона рисуется */
  readonly from: number
  readonly lo: number
  readonly hi: number
  /**
   * Цена уже возвращалась в зону. Детектор её НЕ выбрасывает: решение, что
   * показывать, принимает отбор, и только он. Иначе «42 зоны → 5» невозможно
   * ни проверить, ни настроить.
   */
  readonly mitigated: boolean
}

export interface Line {
  readonly kind: LineKind
  readonly price: number
  readonly from: number
  /** сколько экстремумов слепилось в этот уровень (для PDH/PDL — 0) */
  readonly touches: number
}
