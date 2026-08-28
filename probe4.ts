import { readBigPrints, readBuckets } from './src/flow/read.js'
import { summarize } from './src/flow/summary.js'

function window(sorted: number[], cover: number) {
  const n = sorted.length
  const keep = Math.max(2, Math.ceil(n * cover))
  if (keep >= n) return { lo: sorted[0]!, hi: sorted[n-1]! }
  let lo = sorted[0]!, hi = sorted[keep-1]!, span = hi - lo
  for (let i = 1; i + keep <= n; i++) {
    const a = sorted[i]!, b = sorted[i+keep-1]!
    if (b - a < span) { span = b - a; lo = a; hi = b }
  }
  return { lo, hi }
}
const M = (v: number) => (v/1e6).toFixed(2)+'M'

for (const coin of ['SOL','BTC','ETH','HYPE','XRP']) {
  try {
    const b = await readBuckets(coin, 60)
    if (b.length < 10) { console.log(coin, 'мало', b.length); continue }
    const s = summarize(coin, b, await readBigPrints(coin, 60), null)
    const c = s.cvd
    const sorted = [...c].filter(Number.isFinite).sort((a,z)=>a-z)
    const full = sorted[sorted.length-1]! - sorted[0]!
    const row = [coin.padEnd(5), 'full '+M(full)]
    for (const cov of [0.99,0.96,0.92,0.88,0.84]) {
      const w = window(sorted, cov)
      const span = w.hi - w.lo
      const off = c.filter(v=>v<w.lo||v>w.hi).length
      row.push(`${cov}: gain ${(full/(span||1)).toFixed(2)} вне ${off}/${c.length} [${M(w.lo)},${M(w.hi)}]`)
    }
    console.log(row.join('\n      '))
    // Тьюки для сравнения
    const q=(p:number)=>sorted[Math.round(p*(sorted.length-1))]!
    const iqr=q(0.75)-q(0.25)
    console.log('      Тьюки 1.5·IQR ->', M(q(0.25)-1.5*iqr), M(q(0.75)+1.5*iqr), 'span', M(iqr*4))
  } catch (e) { console.log(coin, 'нет', (e as Error).message.slice(0,40)) }
}
