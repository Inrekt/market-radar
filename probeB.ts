import { readdir } from 'node:fs/promises'
import { readBuckets } from './src/flow/read.js'
import { summarize } from './src/flow/summary.js'
const SLACK = 1.1
function decide(sorted: number[], TRIM: number, BULK: number) {
  const n = sorted.length
  const full = sorted[n-1]! - sorted[0]!
  const maxDrop = Math.floor(n*TRIM)
  if (!(full > 0) || maxDrop < 1) return null
  const span: number[] = [full]
  for (let drop = 1; drop <= maxDrop; drop++) {
    const keep = n-drop
    if (keep < 2) break
    let best = Infinity
    for (let i=0;i+keep<=n;i++){const d=sorted[i+keep-1]!-sorted[i]!;if(d<best)best=d}
    span.push(best)
  }
  const bestSpan = span[span.length-1]!
  if (bestSpan / full >= BULK) return null
  const cap = bestSpan * SLACK
  let drop = span.length-1
  for (let k=1;k<span.length;k++) if (span[k]! <= cap) { drop=k; break }
  return { drop, ratio: span[drop]!/full }
}
const coins = await readdir('state/flow')
const now = Date.now()
// собираем данные один раз
const all: number[][] = []
for (const coin of coins) {
  if (coin==='big') continue
  for (let back=0; back<=40*60; back+=20) {
    const b = await readBuckets(coin, 60, now-back*60_000)
    if (b.length < 100) continue
    const s = summarize(coin, b, [], null)
    const sorted = s.cvd.filter(Number.isFinite).sort((a,z)=>a-z)
    if (sorted.length >= 20) all.push(sorted)
  }
}
const pc=(a:number[],p:number)=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return s[Math.floor(p*(s.length-1))]!}
console.log('окон', all.length)
for (const TRIM of [0.05, 0.08, 0.1]) for (const BULK of [0.35, 0.45, 0.5, 0.55, 0.65]) {
  const drops:number[]=[], gains:number[]=[]
  for (const sorted of all) { const d = decide(sorted, TRIM, BULK); if (d) { drops.push(d.drop/sorted.length); gains.push(1/d.ratio) } }
  console.log(`trim≤${(TRIM*100).toFixed(0)}% порог ${BULK}: срабатывает ${(drops.length/all.length*100).toFixed(0).padStart(2)}% | обрезка мед ${(pc(drops,0.5)*100).toFixed(1)}% p90 ${(pc(drops,0.9)*100).toFixed(1)}% | выигрыш мед ${pc(gains,0.5).toFixed(1)}× p10 ${pc(gains,0.1).toFixed(1)}× max ${pc(gains,1).toFixed(1)}×`)
}
