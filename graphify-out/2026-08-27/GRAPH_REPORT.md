# Graph Report - market-radar  (2026-08-27)

## Corpus Check
- 42 files · ~21,207 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 348 nodes · 838 edges · 12 communities (11 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ad6124b5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- flowCaption.test.ts
- flowCaption.ts
- package.json
- compilerOptions
- whales.ts
- index.ts
- caption.ts
- Market Radar
- push-state.sh
- bot.ts
- chart.ts
- hl.ts

## God Nodes (most connected - your core abstractions)
1. `markup` - 23 edges
2. `safe()` - 23 edges
3. `longFlowCaption()` - 20 edges
4. `shortCaption()` - 18 edges
5. `fmtMoney()` - 17 edges
6. `longCaption()` - 15 edges
7. `shortFlowCaption()` - 15 edges
8. `Candle` - 13 edges
9. `main()` - 13 edges
10. `FlowRecorder` - 12 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `fetchCandles()`  [EXTRACTED]
  scripts/freeze-fixture.ts → src/hl.ts
- `main()` --calls--> `markup`  [EXTRACTED]
  scripts/markup-dump.ts → src/ta/index.ts
- `main()` --calls--> `closeBrowser()`  [EXTRACTED]
  scripts/render-demo.ts → src/render/png.ts
- `main()` --calls--> `renderChart()`  [EXTRACTED]
  scripts/render-demo.ts → src/render/png.ts
- `main()` --calls--> `fetchAssetCtxs()`  [EXTRACTED]
  scripts/smoke.ts → src/hl.ts

## Import Cycles
- None detected.

## Communities (12 total, 1 thin omitted)

### Community 0 - "flowCaption.test.ts"
Cohesion: 0.18
Nodes (14): getDaysBetween(), readBigPrints(), readBuckets(), BigPrint, FlowBucket, FlowSummary, summarize(), Book (+6 more)

### Community 1 - "flowCaption.ts"
Cohesion: 0.20
Nodes (33): fmtMoney(), biggestPrints(), bookText(), bucketsText(), bucketTurnover(), DominantBucket, dominantText(), fmtClock() (+25 more)

### Community 2 - "package.json"
Cohesion: 0.07
Nodes (29): grammy, lightweight-charts, dependencies, grammy, lightweight-charts, puppeteer, devDependencies, tsx (+21 more)

### Community 3 - "compilerOptions"
Cohesion: 0.12
Nodes (15): DOM, ES2023, node, scripts/**/*.ts, src/**/*.ts, compilerOptions, lib, module (+7 more)

### Community 4 - "whales.ts"
Cohesion: 0.08
Nodes (42): collectMarket(), MARKET_TICK_MS, MarketSnapshot, Book, classify(), collectWhales(), diffBooks(), LAST_PATH (+34 more)

### Community 5 - "index.ts"
Cohesion: 0.08
Nodes (49): main(), main(), Candle, ChartInput, markup, dailyLevels(), liquidityPools(), nearestUnswept() (+41 more)

### Community 6 - "caption.ts"
Cohesion: 0.22
Nodes (28): caption(), aligned(), captionPriceDecimals(), containing(), distancePct(), edgeBreak(), fmtPct(), fmtPrice() (+20 more)

### Community 7 - "Market Radar"
Cohesion: 0.40
Nodes (4): Market Radar, Запуск, Источник данных, Состояние

### Community 9 - "bot.ts"
Cohesion: 0.11
Nodes (30): Analysis, cardKey(), cards, chartPath(), createBot(), HELLO, keyboard(), mark() (+22 more)

### Community 10 - "chart.ts"
Cohesion: 0.11
Nodes (23): ascendingBars(), chartHtml(), escapeHtml(), libSource(), linePayload(), pageStyle(), SIGN, ZONE_TITLE (+15 more)

### Community 11 - "hl.ts"
Cohesion: 0.11
Nodes (23): main(), SECONDS, main(), money(), analyze(), AssetCtx, BookLevel, fetchCandles() (+15 more)

## Knowledge Gaps
- **90 isolated node(s):** `name`, `version`, `private`, `type`, `node` (+85 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `markup` connect `index.ts` to `bot.ts`, `chart.ts`, `hl.ts`, `caption.ts`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `fetchAssetCtxs()` connect `whales.ts` to `bot.ts`, `hl.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _90 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
- **Should `whales.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07539450613676213 - nodes in this community are weakly interconnected._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08192090395480225 - nodes in this community are weakly interconnected._