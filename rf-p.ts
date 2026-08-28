import { readBigPrints, readBuckets } from './src/flow/read.js'
import { summarize } from './src/flow/summary.js'
import { fetchBook } from './src/hl.js'
import { flowChartHtml } from './src/render/flowChart.js'
import { renderHtml, closeBrowser } from './src/render/png.js'
const [b, big] = await Promise.all([readBuckets('SOL', 60), readBigPrints('SOL', 60)])
const s = summarize('SOL', b, big, await fetchBook('SOL'))
console.log('корзин', s.buckets.length, 'CVD', Math.round(s.cvd.at(-1) ?? 0))
await renderHtml(flowChartHtml({ summary: s, width: 1440, height: 1800 }), 'out/flow.png', '#wrap', 'поток SOL')
await closeBrowser()
