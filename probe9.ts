import { readBuckets } from './src/flow/read.js'
import { summarize } from './src/flow/summary.js'
const at = Date.parse('2026-08-27T23:13:00Z')
const b = await readBuckets('SOL', 60, at)
const s = summarize('SOL', b, [], null)
const sorted = s.cvd.filter(Number.isFinite).sort((a,z)=>a-z)
const n = sorted.length
const full = sorted[n-1]!-sorted[0]!
console.log('n', n, 'full', (full/1e6).toFixed(2)+'M', 'средний шаг', Math.round(full/n))
for (let drop = 0; drop <= Math.floor(n*0.1); drop++) {
  const keep = n-drop
  let best = Infinity, bi = 0
  for (let i=0;i+keep<=n;i++){const d=sorted[i+keep-1]!-sorted[i]!;if(d<best){best=d;bi=i}}
  if (drop % 3 === 0) console.log('drop', drop, 'span', (best/1e6).toFixed(2)+'M', 'доля', (best/full).toFixed(3), 'окно от', bi, '[', (sorted[bi]!/1e6).toFixed(2), ',', (sorted[bi+keep-1]!/1e6).toFixed(2), ']')
}
