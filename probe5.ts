import { readBigPrints, readBuckets } from './src/flow/read.js'
import { summarize } from './src/flow/summary.js'
const M = (v:number)=>(v/1e6).toFixed(2)+'M'
for (const coin of ['SOL','BTC','ETH','HYPE','XRP','ZEC','TRUMP']) {
  let b
  try { b = await readBuckets(coin, 60) } catch { continue }
  if (b.length < 20) { console.log(coin,'мало',b.length); continue }
  const s = summarize(coin, b, await readBigPrints(coin, 60), null)
  const sorted = s.cvd.filter(Number.isFinite).sort((a,z)=>a-z)
  const n = sorted.length
  const full = sorted[n-1]! - sorted[0]!
  const maxDrop = Math.floor(n*0.1)
  const marks: string[] = []
  for (let drop=1; drop<=maxDrop; drop++) {
    const keep=n-drop
    let best=sorted[keep-1]!-sorted[0]!, bl=sorted[0]!, bh=sorted[keep-1]!
    for (let i=1;i+keep<=n;i++){const a=sorted[i]!,z=sorted[i+keep-1]!;if(z-a<best){best=z-a;bl=a;bh=z}}
    if (drop % 5 === 0 || drop===maxDrop) marks.push(`d${drop}(${(drop/n*100).toFixed(0)}%):${(best/full).toFixed(2)}`)
  }
  console.log(coin.padEnd(6), 'n', n, 'full', M(full), '| доля высоты после обрезки:', marks.join(' '))
}
