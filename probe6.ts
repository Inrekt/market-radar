import { readdir } from 'node:fs/promises'
import { readBuckets } from './src/flow/read.js'
import { summarize } from './src/flow/summary.js'

function ratioAt(sorted: number[], dropFrac: number): { r: number; drop: number } {
  const n = sorted.length
  const full = sorted[n-1]! - sorted[0]!
  if (!(full > 0)) return { r: 1, drop: 0 }
  const maxDrop = Math.floor(n * dropFrac)
  let bestR = 1, bestD = 0
  for (let drop = 1; drop <= maxDrop; drop++) {
    const keep = n - drop
    if (keep < 2) break
    let best = sorted[keep-1]! - sorted[0]!
    for (let i = 1; i + keep <= n; i++) { const d = sorted[i+keep-1]! - sorted[i]!; if (d < best) best = d }
    const r = best / full
    if (r < bestR) { bestR = r; bestD = drop }
  }
  return { r: bestR, drop: bestD }
}

const coins = await readdir('state/flow')
const now = Date.now()
const hist: number[] = new Array(11).fill(0)
let total = 0
const worst: Array<{coin:string;at:number;r:number;drop:number}> = []
for (const coin of coins) {
  if (coin === 'big') continue
  // окна по 60 мин со сдвигом 20 мин назад на двое суток
  for (let back = 0; back <= 40 * 60; back += 20) {
    const at = now - back * 60_000
    let b
    try { b = await readBuckets(coin, 60, at) } catch { continue }
    if (b.length < 100) continue
    const s = summarize(coin, b, [], null)
    const sorted = s.cvd.filter(Number.isFinite).sort((a, z) => a - z)
    if (sorted.length < 20) continue
    const { r, drop } = ratioAt(sorted, 0.1)
    total++
    hist[Math.min(10, Math.floor(r * 10))]!++
    if (r < 0.65) worst.push({ coin, at, r, drop })
  }
}
console.log('окон', total)
for (let i = 0; i <= 10; i++) console.log(` доля высоты ${(i/10).toFixed(1)}–${((i+1)/10).toFixed(1)}: ${hist[i]}`)
console.log('ниже 0.65:', worst.length, `(${(worst.length/total*100).toFixed(1)}%)`)
worst.sort((a,z)=>a.r-z.r)
for (const w of worst.slice(0,12)) console.log('  ', w.coin, new Date(w.at).toISOString().slice(5,16), 'r', w.r.toFixed(2), 'drop', w.drop)
