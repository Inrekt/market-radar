import { readdir } from 'node:fs/promises'
import { readBuckets } from './src/flow/read.js'
import { summarize } from './src/flow/summary.js'
const TRIM = 0.1, BULK = 0.65, SLACK = 1.1

function decide(sorted: number[]) {
  const n = sorted.length
  const full = sorted[n-1]! - sorted[0]!
  const maxDrop = Math.floor(n*TRIM)
  if (!(full > 0) || maxDrop < 1) return { clip: false, drop: 0, ratio: 1 }
  const span: number[] = [full]
  for (let drop = 1; drop <= maxDrop; drop++) {
    const keep = n-drop
    if (keep < 2) break
    let best = Infinity
    for (let i=0;i+keep<=n;i++){const d=sorted[i+keep-1]!-sorted[i]!;if(d<best)best=d}
    span.push(best)
  }
  const bestSpan = span[span.length-1]!
  if (bestSpan / full >= BULK) return { clip: false, drop: 0, ratio: full/full }
  const cap = bestSpan * SLACK
  let drop = span.length-1
  for (let k = 1; k < span.length; k++) if (span[k]! <= cap) { drop = k; break }
  return { clip: true, drop, ratio: span[drop]!/full }
}

const coins = await readdir('state/flow')
const now = Date.now()
let clip=0,total=0
const drops:number[]=[], ratios:number[]=[]
for (const coin of coins) {
  if (coin==='big') continue
  for (let back=0; back<=40*60; back+=20) {
    const b = await readBuckets(coin, 60, now-back*60_000)
    if (b.length < 100) continue
    const s = summarize(coin, b, [], null)
    const sorted = s.cvd.filter(Number.isFinite).sort((a,z)=>a-z)
    if (sorted.length < 20) continue
    total++
    const d = decide(sorted)
    if (d.clip) { clip++; drops.push(d.drop/sorted.length); ratios.push(d.ratio) }
  }
}
const pc=(a:number[],p:number)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(p*(s.length-1))]!}
console.log(`обрезаем ${clip}/${total} (${(clip/total*100).toFixed(1)}%)`)
console.log('обрезка, % точек: медиана', (pc(drops,0.5)*100).toFixed(1), 'p90', (pc(drops,0.9)*100).toFixed(1), 'max', (pc(drops,1)*100).toFixed(1))
console.log('доля высоты после: медиана', pc(ratios,0.5).toFixed(2), 'p10', pc(ratios,0.1).toFixed(2), 'p90', pc(ratios,0.9).toFixed(2))
