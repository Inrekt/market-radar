import { readBuckets } from './src/flow/read.js'
import { summarize } from './src/flow/summary.js'
function ratio(sorted: number[]) {
  const n = sorted.length
  const full = sorted[n-1]! - sorted[0]!
  if (!(full > 0)) return { r: 1, drop: 0 }
  const maxDrop = Math.floor(n * 0.1)
  for (let drop = 1; drop <= maxDrop; drop++) {
    const keep = n - drop
    let best = sorted[keep-1]! - sorted[0]!
    for (let i = 1; i + keep <= n; i++) { const d = sorted[i+keep-1]! - sorted[i]!; if (d < best) best = d }
    if (best / full < 0.65) return { r: best/full, drop }
  }
  return { r: 1, drop: 0 }
}
const now = Date.now()
for (let back = 0; back <= 40*60; back += 10) {
  const at = now - back*60_000
  const b = await readBuckets('SOL', 60, at)
  if (b.length < 200) continue
  const s = summarize('SOL', b, [], null)
  const sorted = s.cvd.filter(Number.isFinite).sort((a,z)=>a-z)
  const { r, drop } = ratio(sorted)
  if (r < 0.65) console.log(new Date(at).toISOString().slice(5,16), 'r', r.toFixed(2), 'обрезаем', drop, 'из', sorted.length, 'корзин', b.length)
}
