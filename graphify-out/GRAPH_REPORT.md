# Graph Report - market-radar  (2026-08-27)

## Corpus Check
- 45 files · ~26,359 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 400 nodes · 977 edges · 12 communities (11 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.7)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ad6124b5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- flowChart.ts
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
3. `longFlowCaption()` - 22 edges
4. `shortCaption()` - 18 edges
5. `fmtMoney()` - 17 edges
6. `shortFlowCaption()` - 17 edges
7. `longCaption()` - 15 edges
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

### Community 0 - "flowChart.ts"
Cohesion: 0.12
Nodes (27): bookPlates(), captions(), coverage(), cvdScale(), deltaBars(), escapeHtml(), flowChartHtml(), flowLines() (+19 more)

### Community 1 - "flowCaption.ts"
Cohesion: 0.12
Nodes (43): BigPrint, FlowBucket, FlowSummary, summarize(), Book, BookLevel, FlowChartInput, fmtMoney() (+35 more)

### Community 2 - "package.json"
Cohesion: 0.07
Nodes (29): grammy, lightweight-charts, dependencies, grammy, lightweight-charts, puppeteer, devDependencies, tsx (+21 more)

### Community 3 - "compilerOptions"
Cohesion: 0.12
Nodes (15): DOM, ES2023, node, scripts/**/*.ts, src/**/*.ts, compilerOptions, lib, module (+7 more)

### Community 4 - "whales.ts"
Cohesion: 0.06
Nodes (50): BOT_STATE_PATH, saveBotState(), collectMarket(), MARKET_TICK_MS, MarketSnapshot, Book, classify(), collectWhales() (+42 more)

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
Cohesion: 0.08
Nodes (47): Analysis, cardKey(), cards, chartPath(), createBot(), HELLO, keyboard(), mark() (+39 more)

### Community 10 - "chart.ts"
Cohesion: 0.10
Nodes (26): s, ascendingBars(), chartHtml(), escapeHtml(), libSource(), linePayload(), pageStyle(), SIGN (+18 more)

### Community 11 - "hl.ts"
Cohesion: 0.12
Nodes (22): main(), SECONDS, main(), money(), analyze(), AssetCtx, fetchCandles(), fetchLeaderboard() (+14 more)

## Knowledge Gaps
- **103 isolated node(s):** `name`, `version`, `private`, `type`, `node` (+98 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `markup` connect `index.ts` to `bot.ts`, `chart.ts`, `hl.ts`, `caption.ts`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `fetchAssetCtxs()` connect `whales.ts` to `bot.ts`, `hl.ts`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _103 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `flowChart.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12169312169312169 - nodes in this community are weakly interconnected._
- **Should `flowCaption.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12329931972789115 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._