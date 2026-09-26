// Тексты алертов сетапа. Коротко и по делу — читаются с телефона.

import { P } from './params.js'
import type { FlowCheck, Level, Plan, Side, Sweep } from './types.js'

export const COINGLASS_URL = 'https://www.coinglass.com/pro/futures/LiquidationHeatMap'

export function px(price: number): string {
  const digits = price >= 1000 ? 0 : price >= 100 ? 2 : price >= 1 ? 3 : 5
  return price.toLocaleString('ru-RU', { maximumFractionDigits: digits })
}

export function usd(value: number): string {
  const abs = Math.abs(value)
  const body = abs >= 1e9 ? `${(abs / 1e9).toFixed(1)}B` : abs >= 1e6 ? `${(abs / 1e6).toFixed(1)}M`
    : `${Math.round(abs / 1e3)}k`
  return `${value < 0 ? '−' : ''}$${body}`
}

const pct = (a: number, b: number): string => `${(Math.abs(a / b - 1) * 100).toFixed(1)}%`
const mark = (ok: boolean): string => (ok ? '✅' : '—')
const word = (side: Side): string => (side === 'long' ? 'лонг' : 'шорт')

export function approachText(coin: string, side: Side, price: number, level: Level, next: Level | null): string {
  const limits = [level.price, ...(next ? [next.price] : [])].map(px).join(' · ')
  return [
    `🟡 ${coin} · подход к ликвидности ${side === 'long' ? 'снизу' : 'сверху'} — готовь ${word(side)}`,
    `Цена ${px(price)} · уровень ${px(level.price)} — ${level.label}, ${pct(level.price, price)} от цены`,
    ...(next ? [`За ним: ${px(next.price)} — ${next.label}`] : []),
    `Лимитки: ${limits}. Дальше ждать свип и подтверждение потоком`,
    `Карта: ${COINGLASS_URL}`,
  ].join('\n')
}

function sweepLine(sweep: Sweep): string {
  return `Свип: ${px(sweep.level.price)} (${sweep.level.label}) → прокол до ${px(sweep.extreme)}, `
    + `возврат ${px(sweep.reclaim)}${sweep.double ? ' · двойной' : ''}`
}

export function setupText(coin: string, sweep: Sweep, flow: FlowCheck, plan: Plan): string {
  const b = plan.balance
  const balanceLine = b.stopSideUsd === 0 && b.targetSideUsd === 0
    ? 'Баланс ликвидности: по китам HL данных нет — сверь по карте'
    : `Баланс: за стопом ${usd(b.stopSideUsd)} / у цели ${usd(b.targetSideUsd)} ✅`
  return [
    `🟢 ${coin} · СЕТАП ГОТОВ · ${word(plan.side).toUpperCase()} · ${sweep.tf}`,
    sweepLine(sweep),
    `Поток: дельта ${usd(flow.deltaUsd)} ${mark(flow.delta)} · крупные ${usd(flow.bigForUsd)} ${mark(flow.big)} · `
      + `поглощение ${mark(flow.absorption)} · киты ${usd(flow.whaleNetUsd)} ${mark(flow.whales)}`,
    `Вход: рынок ~${px(plan.entry)} + лимитки ${plan.limits.map(px).join(' · ')}`,
    `Стоп: ${px(plan.stop)} — за всей ликвидностью + запас`,
    `Тейк 1 — ${Math.round(P().tp1Share * 100)}%, потом стоп в БУ: ${px(plan.tp1)} (${plan.tp1Label})`,
    `Цель: ${px(plan.target.price)} — ${plan.target.label}`,
    `RR 1:${plan.rr.toFixed(1)} · риск — бюджет идеи из журнала`,
    balanceLine,
    `Сверь карту: ${COINGLASS_URL}`,
  ].join('\n')
}

export function skipText(coin: string, sweep: Sweep, plan: Plan): string {
  const b = plan.balance
  const target = b.biggestAgainst
  return [
    `⛔ ${coin} · свип есть, но НЕ входить (${word(plan.side)}, ${sweep.tf})`,
    sweepLine(sweep),
    `За стопом ${usd(b.stopSideUsd)} ликвидаций против ${usd(b.targetSideUsd)} у цели на том же расстоянии — `
      + 'рынок скорее сходит туда.',
    ...(target ? [`Лимитки к кластеру: ${px(target.price)} (${target.label}) — вход после его сноса.`] : []),
    `Карта: ${COINGLASS_URL}`,
  ].join('\n')
}
