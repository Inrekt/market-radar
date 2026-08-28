import { describe, expect, it } from 'vitest'
import { activeMutes, EMPTY_TUNING, isMuted, mute, unmute } from './tuning.js'

const NOW = 1_700_000_000_000

describe('настройки из чата', () => {
  it('заглушённая монета молчит, пока не вышел срок', () => {
    const t = mute(EMPTY_TUNING, 'sol', 2, NOW)
    expect(isMuted(t, 'SOL', NOW + 3_600_000)).toBe(true)
    expect(isMuted(t, 'SOL', NOW + 3 * 3_600_000)).toBe(false)
  })

  it('регистр монеты не имеет значения — из чата пишут как придётся', () => {
    const t = mute(EMPTY_TUNING, 'SoL', 1, NOW)
    expect(isMuted(t, 'sol', NOW)).toBe(true)
  })

  it('снятие заглушки не задевает соседей', () => {
    const t = unmute(mute(mute(EMPTY_TUNING, 'SOL', 5, NOW), 'BTC', 5, NOW), 'SOL')
    expect(isMuted(t, 'SOL', NOW)).toBe(false)
    expect(isMuted(t, 'BTC', NOW)).toBe(true)
  })

  it('в списке показываются только незакончившиеся заглушки', () => {
    const t = mute(mute(EMPTY_TUNING, 'SOL', 5, NOW), 'BTC', 1, NOW)
    const list = activeMutes(t, NOW + 2 * 3_600_000)
    expect(list.map((item) => item.coin)).toEqual(['SOL'])
    expect(list[0]?.hoursLeft).toBeCloseTo(3, 5)
  })

  it('исходный объект не мутируется — состояние читают два процесса', () => {
    const before = mute(EMPTY_TUNING, 'SOL', 1, NOW)
    const after = unmute(before, 'SOL')
    expect(isMuted(before, 'SOL', NOW)).toBe(true)
    expect(isMuted(after, 'SOL', NOW)).toBe(false)
  })
})
