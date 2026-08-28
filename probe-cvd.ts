import { readBigPrints, readBuckets } from './src/flow/read.js'
import { summarize } from './src/flow/summary.js'
const [b, big] = await Promise.all([readBuckets('SOL', 60), readBigPrints('SOL', 60)])
const s = summarize('SOL', b, big, null)
const c = s.cvd
console.log('корзин', c.length)
const sorted = [...c].sort((a, z) => a - z)
const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]!
console.log('min', Math.round(q(0)), 'p1', Math.round(q(0.01)), 'p5', Math.round(q(0.05)), 'q1', Math.round(q(0.25)), 'med', Math.round(q(0.5)), 'q3', Math.round(q(0.75)), 'p95', Math.round(q(0.95)), 'p99', Math.round(q(0.99)), 'max', Math.round(q(1)))
console.log('last', Math.round(c[c.length-1] ?? 0))
// сколько точек за пределами p5..p95
const lo = q(0.05), hi = q(0.95)
console.log('вне p5..p95:', c.filter(v => v < lo || v > hi).length)
const iqr = q(0.75) - q(0.25)
console.log('IQR', Math.round(iqr), 'размах', Math.round(q(1)-q(0)), 'отношение', ((q(1)-q(0))/(iqr||1)).toFixed(1))
