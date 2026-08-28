import { readBigPrints, readBuckets } from './src/flow/read.js'
import { summarize } from './src/flow/summary.js'

function robust(cvd: number[], cover: number) {
  const s = [...cvd].filter(Number.isFinite).sort((a, b) => a - b)
  const n = s.length
  const keep = Math.max(2, Math.ceil(n * cover))
  if (keep >= n) return { lo: s[0]!, hi: s[n-1]!, drop: 0 }
  let lo = s[0]!, hi = s[keep-1]!, span = hi - lo
  for (let i = 1; i + keep <= n; i++) {
    const a = s[i]!, b = s[i+keep-1]!
    if (b - a < span) { span = b - a; lo = a; hi = b }
  }
  return { lo, hi, drop: n - keep }
}

for (const coin of ['SOL','BTC','ETH']) {
  try {
    const b = await readBuckets(coin, 60)
    const s = summarize(coin, b, await readBigPrints(coin, 60), null)
    const c = s.cvd
    if (c.length < 2) { console.log(coin, 'мало данных', c.length); continue }
    const full = Math.max(...c) - Math.min(...c)
    for (const cover of [0.96, 0.98]) {
      const r = robust(c, cover)
      const gain = full / (r.hi - r.lo || 1)
      const off = c.filter(v => v < r.lo || v > r.hi).length
      console.log(coin, 'cover', cover, 'full', Math.round(full/1000)+'K', 'rob', Math.round((r.hi-r.lo)/1000)+'K', 'gain', gain.toFixed(2), 'вне', off, 'lo', Math.round(r.lo/1000)+'K', 'hi', Math.round(r.hi/1000)+'K')
    }
  } catch (e) { console.log(coin, 'нет архива', (e as Error).message.slice(0,60)) }
}
