// Исходы алертов сетапа: что было бы при входе по плану — рынком, доля на тейке 1,
// потом стоп в безубыток, остаток до цели. Лимитки не учитываем: считаем худший случай,
// когда они не исполнились. Через месяц здесь видно, чего стоят алерты.

import { readFile } from 'node:fs/promises'
import { fetchCandles, type Candle } from '../hl.js'
import { dayFile } from '../store/ndjson.js'
import { COST_ROUND_TRIP } from './detect.js'
import { P } from './params.js'
import { setupKey, unseal } from './crypt.js'
import type { Plan } from './types.js'

export const SCORE_HOURS = 120
export const REPORT_DAYS = 30

export type Status = 'цель' | 'тейк 1 → цель' | 'тейк 1 → БУ' | 'стоп' | 'по времени' | 'идёт'
export interface Outcome { readonly status: Status, readonly r: number }

/** Исход по свечам после алерта. Внутри бара — худший порядок: стоп раньше тейка. */
export function scorePlan(plan: Plan, bars: readonly Candle[], alertMs: number, nowMs: number): Outcome {
  const s = plan.side === 'long' ? 1 : -1
  const risk = s * (plan.entry - plan.stop)
  if (!(risk > 0)) return { status: 'стоп', r: 0 }
  const cost = COST_ROUND_TRIP * plan.entry / risk
  const at = (price: number): number => (s * (price - plan.entry)) / risk
  const hit = (bar: Candle, price: number, favorable: boolean): boolean =>
    (s > 0) === favorable ? bar.h >= price : bar.l <= price
  const deadline = alertMs + SCORE_HOURS * 3_600_000
  const share = P().tp1Share
  let half: number | null = null
  let last: Candle | undefined
  for (const bar of bars) {
    if (bar.t * 1000 < alertMs) continue
    if (bar.t * 1000 >= deadline) break
    last = bar
    if (half === null) {
      if (hit(bar, plan.stop, false)) return { status: 'стоп', r: -1 - cost }
      if (hit(bar, plan.target.price, true)) return { status: 'тейк 1 → цель', r: share * at(plan.tp1) + (1 - share) * at(plan.target.price) - cost }
      if (hit(bar, plan.tp1, true)) half = share * at(plan.tp1)
      continue
    }
    if (hit(bar, plan.entry, false)) return { status: 'тейк 1 → БУ', r: half - cost }
    if (hit(bar, plan.target.price, true)) return { status: 'тейк 1 → цель', r: half + (1 - share) * at(plan.target.price) - cost }
  }
  if (last === undefined) return { status: 'идёт', r: 0 }
  const open = half === null ? at(last.c) : half + (1 - share) * at(last.c)
  return nowMs >= deadline ? { status: 'по времени', r: open - cost } : { status: 'идёт', r: open - cost }
}

interface Logged { t: number, coin: string, kind: string, enter?: boolean, plan?: Plan, reason?: string }

async function readJournal(nowMs: number): Promise<Logged[]> {
  const out: Logged[] = []
  const key = setupKey()
  if (key === null) return out
  for (let d = REPORT_DAYS; d >= 0; d -= 1) {
    try {
      const content = await readFile(dayFile('setup', nowMs - d * 86_400_000), 'utf8')
      for (const line of content.split('\n')) {
        if (line.trim().length === 0) continue
        try {
          const box = JSON.parse(line) as { s?: string }
          if (box.s !== undefined) out.push(unseal<Logged>(box.s, key))
        } catch { /* битая или чужая строка — пропускаем */ }
      }
    } catch {
      // дня нет — ничего не было
    }
  }
  return out
}

/** Текст для /setups: сколько было алертов и чем кончились бы готовые сетапы. */
export async function setupReport(nowMs: number = Date.now()): Promise<string> {
  const journal = await readJournal(nowMs)
  const ready = journal.filter((x) => x.kind === 'setup' && x.enter === true && x.plan)
  const outcomes: Outcome[] = []
  const bars = new Map<string, Candle[]>()
  for (const entry of ready) {
    if (!entry.plan) continue
    const start = Math.floor(Math.min(...ready.filter((x) => x.coin === entry.coin).map((x) => x.t)) / 1000)
    if (!bars.has(entry.coin)) bars.set(entry.coin, await fetchCandles(entry.coin, '15m', start, nowMs))
    outcomes.push(scorePlan(entry.plan, bars.get(entry.coin) ?? [], entry.t, nowMs))
  }
  const closed = outcomes.filter((o) => o.status !== 'идёт')
  const total = closed.reduce((a, o) => a + o.r, 0)
  const count = (status: Status): number => outcomes.filter((o) => o.status === status).length
  const rejected = journal.filter((x) => x.kind === 'rejected')
  const reasons = new Map<string, number>()
  for (const x of rejected) {
    const key = (x.reason ?? 'другое').startsWith('RR') ? 'RR ниже порога' : (x.reason ?? 'другое')
    reasons.set(key, (reasons.get(key) ?? 0) + 1)
  }
  const sign = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`
  return [
    `Сетапы BTC/ETH/SOL за ${REPORT_DAYS} дней — вход по плану рынком, ${Math.round(P().tp1Share * 100)}% на тейке 1, потом БУ.`,
    '',
    `Готовых сетапов: ${ready.length} · закрыто ${closed.length}: цель ${count('тейк 1 → цель') + count('цель')} · `
      + `тейк→БУ ${count('тейк 1 → БУ')} · стоп ${count('стоп')} · по времени ${count('по времени')} · идёт ${count('идёт')}`,
    closed.length > 0
      ? `Итог ${sign(total)}R = ${sign(total * P().budgetUsd)}$ при риске $${P().budgetUsd} · в среднем ${sign(total / closed.length)}R на сетап`
      : 'Закрытых пока нет.',
    '',
    `⛔ «Не входить» по балансу ликвидности: ${journal.filter((x) => x.kind === 'setup' && x.enter === false).length}`,
    `🟡 Подходов к ликвидности: ${journal.filter((x) => x.kind === 'near').length}`,
    `Отклонено свипов: ${rejected.length}${rejected.length > 0 ? ` (${[...reasons].map(([k, v]) => `${k} — ${v}`).join(', ')})` : ''}`,
    '',
    'Лимитки не учтены — это худший случай. Меньше 30 закрытых — выводы рано.',
  ].join('\n')
}
