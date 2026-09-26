// Уровни ликвидности для сетапа: пулы с графика, границы суток, кластеры ликвидаций.

import type { Candle, Position } from '../hl.js'
import { atr } from '../ta/stats.js'
import { liquidityPools } from '../ta/liquidity.js'
import type { Level } from './types.js'

/** Ширина корзины кластера ликвидаций, доля цены. */
export const LIQ_BUCKET = 0.0025
/** Кластер меньше этого — шум, а не ликвидность. */
export const MIN_CLUSTER_USD = 2_000_000

function money(usd: number): string {
  return usd >= 1e9 ? `$${(usd / 1e9).toFixed(1)}B` : `$${Math.round(usd / 1e6)}M`
}

export function poolLevels(bars: readonly Candle[], tf: string): Level[] {
  const atrValue = atr(bars)
  if (!(atrValue > 0)) return []
  return liquidityPools(bars, atrValue).map((line) => ({
    price: line.price,
    source: 'pool' as const,
    weight: line.touches,
    usd: 0,
    tf,
    label: `равные ${line.kind === 'SSL' ? 'лоу' : 'хаи'} ×${line.touches} (${tf})`,
  }))
}

export function dayLevels(previousDay: Candle | undefined): Level[] {
  if (!previousDay) return []
  return [
    { price: previousDay.l, source: 'day', weight: 1, usd: 0, tf: 'сутки', label: 'лоу прошлых суток' },
    { price: previousDay.h, source: 'day', weight: 1, usd: 0, tf: 'сутки', label: 'хай прошлых суток' },
  ]
}

/**
 * Кластеры ликвидаций китов Hyperliquid: позиции монеты, склеенные по цене ликвидации.
 * Соседние цены ближе LIQ_BUCKET сливаются в один кластер — без сетки, которая резала бы
 * кластер на границе корзин. Лонги ликвидируются ниже рынка (ликвидность снизу),
 * шорты — выше (ликвидность сверху).
 */
export function liqClusters(positions: readonly Position[], coin: string): Level[] {
  const out: Level[] = []
  for (const isLong of [true, false]) {
    const sorted = positions
      .filter((p) => p.coin === coin && p.isLong === isLong && p.liquidationPx !== null && p.liquidationPx > 0)
      .map((p) => ({ px: p.liquidationPx ?? 0, usd: p.sizeUsd }))
      .sort((a, b) => a.px - b.px)
    let cluster: { usd: number, n: number, pxUsd: number } | null = null
    const flush = (): void => {
      if (cluster && cluster.usd >= MIN_CLUSTER_USD) {
        out.push({
          price: cluster.pxUsd / cluster.usd, source: 'liq', weight: cluster.n, usd: cluster.usd, tf: 'HL',
          label: `ликвидации ${isLong ? 'лонгов' : 'шортов'} ${money(cluster.usd)} (киты HL)`,
        })
      }
    }
    for (const item of sorted) {
      const center = cluster ? cluster.pxUsd / cluster.usd : 0
      if (cluster && item.px <= center * (1 + LIQ_BUCKET)) {
        cluster = { usd: cluster.usd + item.usd, n: cluster.n + 1, pxUsd: cluster.pxUsd + item.px * item.usd }
      } else {
        flush()
        cluster = { usd: item.usd, n: 1, pxUsd: item.px * item.usd }
      }
    }
    flush()
  }
  return out
}

export { money }
