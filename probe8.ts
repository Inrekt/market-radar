import { readdir } from 'node:fs/promises'
import { readBuckets } from './src/flow/read.js'
import { summarize } from './src/flow/summary.js'

const TRIM = 0.1, BULK = 0.65

function spans(sorted: number[]): number[] {
  // spans[k] = самый узкий размах, вмещающий n-k значений
  const n = sorted.length
  const maxDrop = Math.floor(n * TRIM)
  const out: number[] = [sorted[n-1]! - sorted[0]!]
  for (let drop = 1; drop <= maxDrop; drop++) {
    const keep = n - drop
    if (keep < 2) break
    let best = Infinity, bl = 0, bh = 0
    for (let i = 0; i + keep <= n; i++) { const d = sorted[i+keep-1]! - sorted[i]!; if (d < best) { best = d; bl = i; bh = i+keep-1 } }
    out.push(best)
  }
  return out
}

function pick(sorted: number[], C: number): { drop: number; ratio: number } {
  const n = sorted.length
  const s = spans(sorted)
  const full = s[0]!
  if (!(full > 0)) return { drop: 0, ratio: 1 }
  const average = full / n
  let drop = 0
  for (let k = 1; k < s.length; k++) {
    if (s[k-1]! - s[k]! < C * average) break
    drop = k
  }
  return { drop, ratio: s[drop]! / full }
}

const coins = await readdir('state/flow')
const now = Date.now()
for (const C of [2, 3, 5]) {
  let clipped = 0, total = 0, drops: number[] = [], ratios: number[] = []
  let falsePos = 0
  for (const coin of coins) {
    if (coin === 'big') continue
    for (let back = 0; back <= 40*60; back += 20) {
      const b = await readBuckets(coin, 60, now - back*60_000)
      if (b.length < 100) continue
      const s = summarize(coin, b, [], null)
      const sorted = s.cvd.filter(Number.isFinite).sort((a,z)=>a-z)
      if (sorted.length < 20) continue
      total++
      const full = sorted[sorted.length-1]! - sorted[0]!
      const { drop, ratio } = pick(sorted, C)
      if (drop > 0 && ratio < BULK) { clipped++; drops.push(drop/sorted.length); ratios.push(ratio) }
      else if (drop > 0 && ratio >= BULK) falsePos++
    }
  }
  const avg = (a: number[]) => a.length ? (a.reduce((x,y)=>x+y,0)/a.length) : 0
  console.log(`C=${C}: обрезаем ${clipped}/${total} (${(clipped/total*100).toFixed(0)}%), сред. обрезка ${(avg(drops)*100).toFixed(1)}% точек, сред. доля высоты после ${avg(ratios).toFixed(2)}, «посчитали но не сработало» ${falsePos}`)
}
