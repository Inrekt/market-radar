import { describe, expect, it } from 'vitest'
import { pickTop, refreshWatchlist, STICKY_DAYS, type WatchEntry } from './universe.js'
import type { AssetCtx } from './hl.js'

const ctx = (coin: string, vlm: number): AssetCtx =>
  ({ coin, funding: 0, openInterest: 0, dayNtlVlm: vlm, markPx: 1, prevDayPx: 1 })

const DAY = 86_400_000

describe('список наблюдения', () => {
  it('берёт топ по обороту, а не по алфавиту', () => {
    const top = pickTop([ctx('A', 10), ctx('B', 300), ctx('C', 50)], 2)
    expect(top).toEqual(['B', 'C'])
  })

  it('держит выпавшую монету три дня — иначе архив рвётся на самом движении', () => {
    const now = 10 * DAY
    const previous: WatchEntry[] = [{ coin: 'OLD', lastInTop: now - 2 * DAY }]
    const { coins } = refreshWatchlist(previous, [ctx('NEW', 100)], now)
    expect(coins).toContain('OLD')
    expect(coins).toContain('NEW')
  })

  it('отпускает монету, когда липкость истекла', () => {
    const now = 10 * DAY
    const previous: WatchEntry[] = [{ coin: 'OLD', lastInTop: now - (STICKY_DAYS + 1) * DAY }]
    const { coins } = refreshWatchlist(previous, [ctx('NEW', 100)], now)
    expect(coins).toEqual(['NEW'])
  })

  it('монета, вернувшаяся в топ, обновляет отметку и не выпадает по старому сроку', () => {
    const now = 10 * DAY
    const previous: WatchEntry[] = [{ coin: 'X', lastInTop: now - 2 * DAY }]
    const { entries } = refreshWatchlist(previous, [ctx('X', 100)], now)
    expect(entries[0]).toEqual({ coin: 'X', lastInTop: now })
  })
})
