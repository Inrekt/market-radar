import { describe, expect, it } from 'vitest'
import { ALERT_THRESHOLD, MIN_RELIABLE_METRICS, scoreOf } from './score.js'
import { EMPTY_ALERT_STATE, canAlert, register, type AlertState } from './budget.js'
import type { Metric } from './metrics.js'

// Время в тестах задаём в UTC и переводим в голове: владелец в Москве, UTC+3.
// 09:00 UTC = 12:00 МСК — день. 00:00 UTC = 03:00 МСК — ночь.
const DAY_NOON = Date.UTC(2026, 7, 27, 9, 0, 0)
const DAY_BEFORE_HOUR_EDGE = Date.UTC(2026, 7, 27, 9, 55, 0)
const NIGHT_DEEP = Date.UTC(2026, 7, 27, 0, 0, 0)
const MINUTE = 60_000
const HOUR = 3_600_000

/** Заполняет состояние n отправками по разным монетам, чтобы не мешал кулдаун. */
function fill(from: AlertState, count: number, startMs: number, stepMs: number): AlertState {
  let state = from
  for (let i = 0; i < count; i += 1) state = register(state, `COIN${i}`, startMs + i * stepMs)
  return state
}

describe('кулдаун по монете', () => {
  it('держит повтор внутри окна и называет причину числом', () => {
    const state = register(EMPTY_ALERT_STATE, 'SOL', DAY_NOON)

    const verdict = canAlert(state, 'SOL', DAY_NOON + 3 * HOUR)

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('SOL')
    expect(verdict.reason).toContain('180')
  })

  it('отпускает ту же монету, когда окно метрик полностью обновилось', () => {
    const state = register(EMPTY_ALERT_STATE, 'SOL', DAY_NOON)

    expect(canAlert(state, 'SOL', DAY_NOON + 4 * HOUR).ok).toBe(true)
  })

  it('не распространяется на другие монеты', () => {
    const state = register(EMPTY_ALERT_STATE, 'SOL', DAY_NOON)

    expect(canAlert(state, 'ETH', DAY_NOON + MINUTE).ok).toBe(true)
  })

  it('молчит, если часы ушли назад: шкала сломана, доверять ей нельзя', () => {
    const state = register(EMPTY_ALERT_STATE, 'SOL', DAY_NOON)

    const verdict = canAlert(state, 'SOL', DAY_NOON - HOUR)

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('назад')
  })
})

describe('часовая норма', () => {
  it('днём пропускает шесть пингов и закрывает седьмой', () => {
    const state = fill(EMPTY_ALERT_STATE, 6, DAY_NOON, MINUTE)

    const verdict = canAlert(state, 'NEW', DAY_NOON + 10 * MINUTE)

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('6 из 6')
    expect(verdict.reason).toContain('дневная')
  })

  it('считается скользящим окном, а не календарным часом', () => {
    // Шесть отправок в 12:55–13:00 МСК: календарный час меняется прямо посреди
    // пачки. Если бы норма считалась по календарю, в 13:05 она была бы пустой.
    const state = fill(EMPTY_ALERT_STATE, 6, DAY_BEFORE_HOUR_EDGE, MINUTE)

    const justAfterCalendarHour = canAlert(state, 'NEW', DAY_BEFORE_HOUR_EDGE + 10 * MINUTE)
    expect(justAfterCalendarHour.ok).toBe(false)

    // А отпускает норму не смена часа, а выпадение самой старой отправки из окна.
    const afterOldestFellOut = canAlert(state, 'NEW', DAY_BEFORE_HOUR_EDGE + HOUR)
    expect(afterOldestFellOut.ok).toBe(true)
    expect(afterOldestFellOut.reason).toContain('5 из 6')
  })

  it('ночью норма строже: два пинга вместо шести', () => {
    const state = fill(EMPTY_ALERT_STATE, 2, NIGHT_DEEP, MINUTE)

    const verdict = canAlert(state, 'NEW', NIGHT_DEEP + 10 * MINUTE)

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('ночная')
    expect(verdict.reason).toContain('2 из 2')

    // Ровно те же три отправки днём проходят без вопросов.
    const dayState = fill(EMPTY_ALERT_STATE, 2, DAY_NOON, MINUTE)
    expect(canAlert(dayState, 'NEW', DAY_NOON + 10 * MINUTE).ok).toBe(true)
  })

  it('граница ночи проходит по московским 08:00, а не по UTC', () => {
    const at0759msk = Date.UTC(2026, 7, 27, 4, 59, 0)
    const at0800msk = Date.UTC(2026, 7, 27, 5, 0, 0)
    const at0000msk = Date.UTC(2026, 7, 27, 21, 0, 0)

    const two = (nowMs: number): AlertState => fill(EMPTY_ALERT_STATE, 2, nowMs - 5 * MINUTE, MINUTE)

    expect(canAlert(two(at0759msk), 'NEW', at0759msk).ok).toBe(false)
    expect(canAlert(two(at0800msk), 'NEW', at0800msk).ok).toBe(true)
    expect(canAlert(two(at0000msk), 'NEW', at0000msk).ok).toBe(false)
  })
})

describe('состояние не растёт бесконечно', () => {
  it('после суток непрерывных отправок хранит только то, что ещё на что-то влияет', () => {
    // 144 отправки по разным монетам, раз в 10 минут — ровно сутки работы.
    const state = fill(EMPTY_ALERT_STATE, 144, DAY_NOON, 10 * MINUTE)

    // В часовом окне помещается шесть отметок (сейчас и пять по 10 минут назад).
    expect(state.sentAt).toHaveLength(6)
    // В четырёхчасовом кулдауне — 24 монеты; остальные 120 уже никого не блокируют.
    expect(Object.keys(state.lastAlertAt)).toHaveLength(24)
  })

  it('обрезка старого не меняет ни одного ответа canAlert', () => {
    const stale = register(EMPTY_ALERT_STATE, 'SOL', DAY_NOON)
    const later = register(stale, 'ETH', DAY_NOON + 5 * HOUR)

    // Запись про SOL выброшена — и правильно: её кулдаун всё равно истёк.
    expect(later.lastAlertAt).not.toHaveProperty('SOL')
    expect(canAlert(later, 'SOL', DAY_NOON + 5 * HOUR).ok).toBe(true)
  })

  it('не мутирует переданное состояние', () => {
    const before = register(EMPTY_ALERT_STATE, 'SOL', DAY_NOON)

    register(before, 'ETH', DAY_NOON + MINUTE)

    expect(Object.keys(before.lastAlertAt)).toEqual(['SOL'])
    expect(before.sentAt).toHaveLength(1)
    expect(EMPTY_ALERT_STATE.sentAt).toHaveLength(0)
  })
})

/** Метрика с показанием; score === null означает «архива не хватило». */
function metric(key: string, score: number | null): Metric {
  return { key, value: score, score, text: `${key}: ${score === null ? 'нет данных' : String(score)}` }
}

describe('скор считается по измеренным метрикам', () => {
  it('молчащие метрики не занижают скор', () => {
    const measured = [metric('oi_1h', 0.8), metric('whales_4h', 0.6)]
    const withSilent = [...measured, metric('rvol', null), metric('funding_z', null)]

    const scored = scoreOf(withSilent)

    // Знаменатель фиксирован тремя сильнейшими, поэтому молчащие метрики не
    // могут утянуть скор вниз просто своим присутствием: (0.8 + 0.6) / 3.
    expect(scored.score).toBeCloseTo(0.4667, 3)
    expect(scored.score).toBeCloseTo(scoreOf(measured).score)
    expect(scored.available).toBe(2)
    expect(scored.total).toBe(4)
    // Наивное деление на total дало бы 0.35 — короткий архив сам по себе
    // опустил бы монету, и мы решили бы, что там пусто.
    expect(scored.score).toBeGreaterThan(1.4 / 4)
    expect(scored.score).toBeGreaterThan(ALERT_THRESHOLD)
  })

  it('монета без единого измерения даёт ноль и честный available', () => {
    const scored = scoreOf([metric('rvol', null), metric('funding_z', null)])

    expect(scored.score).toBe(0)
    expect(scored.available).toBe(0)
    expect(scored.total).toBe(2)
    expect(scored.top).toEqual([])
    // Ноль здесь читается как «не знаем», и это видно только по available:
    // ниже кворума вызывающий обязан решать сам.
    expect(scored.available).toBeLessThan(MIN_RELIABLE_METRICS)
  })

  it('сломанная метрика (NaN) считается молчащей, а не нулевой', () => {
    const scored = scoreOf([metric('oi_1h', 0.8), metric('broken', Number.NaN)])

    expect(scored.available).toBe(1)
    // Одна метрика делится на три: сломанная не добавляет и не отнимает.
    expect(scored.score).toBeCloseTo(0.2667, 3)
    expect(scored.score).toBeCloseTo(scoreOf([metric('oi_1h', 0.8)]).score)
  })

  it('в top не больше трёх метрик и они идут по убыванию вклада', () => {
    const scored = scoreOf([
      metric('a', 0.1),
      metric('b', 0.9),
      metric('c', 0.5),
      metric('d', 0.7),
      metric('silent', null),
    ])

    expect(scored.top.map((m) => m.key)).toEqual(['b', 'd', 'c'])
  })

  it('ошибка нормировки в метрике не выносит скор за пределы 0..1', () => {
    // Метрика зажимается в 0..1 до деления, поэтому одиночная «сломанная»
    // даёт ровно треть, а не пять третей.
    expect(scoreOf([metric('broken_hi', 5)]).score).toBeCloseTo(1 / 3, 5)
    expect(scoreOf([metric('broken_lo', -3)]).score).toBe(0)
  })

  it('три умеренные метрики вместе проходят порог — это совпадение признаков', () => {
    const lukewarm = [metric('a', 0.5), metric('b', 0.5), metric('c', 0.5)]
    expect(scoreOf(lukewarm).score).toBeCloseTo(0.5, 5)
    expect(scoreOf(lukewarm).score).toBeGreaterThan(ALERT_THRESHOLD)

    // А две умеренные без третьей — уже нет: (0.5 + 0.5) / 3 = 0.333 против
    // порога 0.30 проходит впритык, поэтому берём заведомо слабее.
    const two = [metric('a', 0.4), metric('b', 0.4)]
    expect(scoreOf(two).score).toBeLessThan(ALERT_THRESHOLD)

    // Нулевые метрики в причины пинга не попадают: «пробоя нет» — не повод.
    const withZero = [metric('a', 0.9), metric('quiet', 0)]
    expect(scoreOf(withZero).top.map((m) => m.key)).toEqual(['a'])
  })
})
