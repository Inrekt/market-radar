import { readBigPrints, readBuckets } from './src/flow/read.js'
import { summarize } from './src/flow/summary.js'
import { flowChartHtml } from './src/render/flowChart.js'
import { renderHtml, closeBrowser } from './src/render/png.js'
const [coin, iso, out] = process.argv.slice(2) as [string, string, string]
const at = Date.parse(iso)
const [b, big] = await Promise.all([readBuckets(coin, 60, at), readBigPrints(coin, 60, at)])
const s = summarize(coin, b, big, null)
console.log(out, 'корзин', s.buckets.length, 'CVD', Math.round(s.cvd.at(-1) ?? 0), 'min', Math.round(Math.min(...s.cvd)), 'max', Math.round(Math.max(...s.cvd)))
await renderHtml(flowChartHtml({ summary: s, width: 1440, height: 1800 }), out, '#wrap', `поток ${coin}`)
await closeBrowser()
