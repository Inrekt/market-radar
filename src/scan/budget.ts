// Бюджет пингов: сколько сигналов владелец готов прочитать и когда.
//
// Ограничитель здесь важнее детектора. Промах стоит одного пропущенного
// движения, а поток пингов стоит всего инструмента: уведомления, которые
// приходят слишком часто, сначала перестают читать, потом выключают. Поэтому
// нормы держатся жёстко, а каждый отказ объясняется словами — по журналу потом
// видно, что именно нас заткнуло: своя же осторожность или реально пустой рынок.

export interface AlertState {
  /** монета → время последнего пинга, мс */
  readonly lastAlertAt: Record<string, number>
  /** времена последних отправок, мс, для подсчёта часовой нормы */
  readonly sentAt: readonly number[]
}

export const EMPTY_ALERT_STATE: AlertState = { lastAlertAt: {}, sentAt: [] }

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

/**
 * Кулдаун по монете — 4 часа, ровно по самому длинному окну метрик (дельта
 * открытого интереса за 4ч). Два пинга ближе друг к другу опираются на
 * пересекающиеся окна, то есть частично на одни и те же данные: второй сообщает
 * то же самое другими словами. Через 4 часа окно полностью новое, и повтор
 * означает новое событие, а не эхо старого.
 */
const COOLDOWN_MS = 4 * HOUR_MS

/**
 * Часовые нормы. Днём 6 — это пинг раз в десять минут в худшем случае, ещё
 * терпимо. Ночью 2 — будильник должен стоить очень дорого.
 */
const MAX_ALERTS_PER_HOUR_DAY = 6
const MAX_ALERTS_PER_HOUR_NIGHT = 2

/**
 * Владелец в Москве. Смещение зашито числом, а не взято у машины: сканер может
 * крутиться на сервере в UTC, и «ночь» должна считаться по человеку, а не по
 * хосту. Москва не переводит часы с 2014 года, поэтому +3 постоянны.
 */
const MSK_UTC_OFFSET_HOURS = 3
const NIGHT_START_HOUR_MSK = 0
const NIGHT_END_HOUR_MSK = 8

function mskHour(nowMs: number): number {
  return (new Date(nowMs).getUTCHours() + MSK_UTC_OFFSET_HOURS) % 24
}

function isNight(nowMs: number): boolean {
  const hour = mskHour(nowMs)
  return hour >= NIGHT_START_HOUR_MSK && hour < NIGHT_END_HOUR_MSK
}

/**
 * Скользящее окно, а не календарный час: иначе в 10:59 можно отправить норму
 * целиком, а в 11:01 ещё столько же — и человек получает двойную порцию за две
 * минуты, формально не нарушив лимит.
 */
function countLastHour(sentAt: readonly number[], nowMs: number): number {
  let count = 0
  for (const t of sentAt) if (nowMs - t < HOUR_MS) count += 1
  return count
}

function minutes(ms: number): number {
  return Math.round(ms / MINUTE_MS)
}

export function canAlert(state: AlertState, coin: string, nowMs: number): { ok: boolean, reason: string } {
  const last = state.lastAlertAt[coin]
  if (last !== undefined) {
    const elapsed = nowMs - last
    // Часы ушли назад (перезапуск с восстановленным состоянием, правка времени).
    // Молчим: в такой ситуации любое «прошло достаточно» посчитано по сломанной
    // шкале, а лишний пинг дороже пропущенного.
    if (elapsed < 0) {
      return { ok: false, reason: `часы идут назад: последний пинг по ${coin} помечен будущим временем` }
    }
    if (elapsed < COOLDOWN_MS) {
      return {
        ok: false,
        reason: `кулдаун по ${coin}: с прошлого пинга ${minutes(elapsed)} мин из ${minutes(COOLDOWN_MS)}`,
      }
    }
  }

  const night = isNight(nowMs)
  const limit = night ? MAX_ALERTS_PER_HOUR_NIGHT : MAX_ALERTS_PER_HOUR_DAY
  const sentLastHour = countLastHour(state.sentAt, nowMs)
  const clock = `в Москве ${String(mskHour(nowMs)).padStart(2, '0')} ч`

  if (sentLastHour >= limit) {
    return {
      ok: false,
      reason: `${night ? 'ночная' : 'дневная'} норма исчерпана: ${sentLastHour} из ${limit} за последний час (${clock})`,
    }
  }

  return {
    ok: true,
    reason: `можно: ${sentLastHour} из ${limit} за последний час (${clock})`,
  }
}

export function register(state: AlertState, coin: string, nowMs: number): AlertState {
  const lastAlertAt: Record<string, number> = {}
  for (const [name, t] of Object.entries(state.lastAlertAt)) {
    // Запись старше кулдауна уже никого не блокирует, значит её выбрасывание
    // не меняет ни одного будущего ответа canAlert — только не даёт состоянию
    // расти вместе с историей. Записи «из будущего» (часы ушли назад) остаются:
    // они как раз блокируют.
    if (nowMs - t < COOLDOWN_MS) lastAlertAt[name] = t
  }
  lastAlertAt[coin] = nowMs

  // По той же причине чистим и отметки отправок: всё, что старше часа, в норму
  // уже не входит и хранится впустую.
  const sentAt = [...state.sentAt.filter((t) => nowMs - t < HOUR_MS), nowMs]

  return { lastAlertAt, sentAt }
}
