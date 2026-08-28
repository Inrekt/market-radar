import { readBigPrints, readBuckets } from './src/flow/read.js'
import { summarize } from './src/flow/summary.js'
const [b, big] = await Promise.all([readBuckets('SOL', 60), readBigPrints('SOL', 60)])
const s = summarize('SOL', b, big, null)
const c = s.cvd
const n = c.length
for (let i = 0; i < n; i += Math.ceil(n/40)) {
  const t = new Date(s.buckets[i]!.t).toISOString().slice(11,16)
  console.log(i, t, Math.round(c[i]!/1000)+'K')
}
console.log('last', new Date(s.buckets[n-1]!.t).toISOString().slice(11,16), Math.round(c[n-1]!/1000)+'K')
