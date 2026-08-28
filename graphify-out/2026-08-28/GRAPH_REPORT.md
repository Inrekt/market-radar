# Graph Report - market-radar  (2026-08-28)

## Corpus Check
- 53 files · ~37,162 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 489 nodes · 1240 edges · 14 communities (13 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0d4ff527`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- flowChart.ts
- flowCaption.ts
- package.json
- compilerOptions
- run.ts
- index.ts
- caption.ts
- Market Radar
- push-state.sh
- bot.ts
- chart.ts
- ws.ts
- metrics.ts
- budget.test.ts

## God Nodes (most connected - your core abstractions)
1. `markup` - 25 edges
2. `scanOnce()` - 24 edges
3. `safe()` - 23 edges
4. `longFlowCaption()` - 22 edges
5. `Candle` - 18 edges
6. `shortCaption()` - 18 edges
7. `fmtMoney()` - 17 edges
8. `shortFlowCaption()` - 17 edges
9. `main()` - 15 edges
10. `longCaption()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `fetchCandles()`  [EXTRACTED]
  scripts/freeze-fixture.ts → src/hl.ts
- `main()` --calls--> `markup`  [EXTRACTED]
  scripts/markup-dump.ts → src/ta/index.ts
- `main()` --calls--> `markup`  [EXTRACTED]
  scripts/render-demo.ts → src/ta/index.ts
- `main()` --indirect_call--> `fetchPositions()`  [INFERRED]
  scripts/smoke.ts → src/hl.ts
- `main()` --calls--> `closeBrowser()`  [EXTRACTED]
  scripts/render-demo.ts → src/render/png.ts

## Import Cycles
- None detected.

## Communities (14 total, 1 thin omitted)

### Community 0 - "flowChart.ts"
Cohesion: 0.10
Nodes (36): Axis, bookPlates(), captions(), clamp(), coverage(), cvdScale(), decimals(), deltaBars() (+28 more)

### Community 1 - "flowCaption.ts"
Cohesion: 0.12
Nodes (44): caption(), BigPrint, FlowBucket, FlowSummary, summarize(), Book, BookLevel, FlowChartInput (+36 more)

### Community 2 - "package.json"
Cohesion: 0.07
Nodes (29): grammy, lightweight-charts, dependencies, grammy, lightweight-charts, puppeteer, devDependencies, tsx (+21 more)

### Community 3 - "compilerOptions"
Cohesion: 0.12
Nodes (15): DOM, ES2023, node, scripts/**/*.ts, src/**/*.ts, compilerOptions, lib, module (+7 more)

### Community 4 - "run.ts"
Cohesion: 0.06
Nodes (65): main(), SECONDS, main(), money(), collectMarket(), MARKET_TICK_MS, MarketSnapshot, Book (+57 more)

### Community 5 - "index.ts"
Cohesion: 0.09
Nodes (45): main(), markup, dailyLevels(), liquidityPools(), nearestUnswept(), POOL_MERGE_ATR, POOL_TOLERANCE_ATR, PoolInput (+37 more)

### Community 6 - "caption.ts"
Cohesion: 0.22
Nodes (28): caption(), aligned(), captionPriceDecimals(), containing(), distancePct(), edgeBreak(), fmtPct(), fmtPrice() (+20 more)

### Community 7 - "Market Radar"
Cohesion: 0.40
Nodes (4): Market Radar, Запуск, Источник данных, Состояние

### Community 9 - "bot.ts"
Cohesion: 0.07
Nodes (52): Analysis, analyze(), cardKey(), cards, chartPath(), createBot(), HELLO, keyboard() (+44 more)

### Community 10 - "chart.ts"
Cohesion: 0.10
Nodes (27): main(), ascendingBars(), chartHtml(), ChartInput, escapeHtml(), libSource(), linePayload(), pageStyle() (+19 more)

### Community 11 - "ws.ts"
Cohesion: 0.14
Nodes (13): applyTrade(), BIG_PRINT_USD, BookLevel, Bucket, BUCKET_MS, emptyBucket(), FlowRecorder, RawTrade (+5 more)

### Community 12 - "metrics.ts"
Cohesion: 0.12
Nodes (35): Candle, ArchiveView, loadSeries(), Snapshot, whaleFlow, breakoutMetric(), clamp01(), fmtUsd() (+27 more)

### Community 13 - "budget.test.ts"
Cohesion: 0.14
Nodes (21): AlertState, canAlert(), countLastHour(), EMPTY_ALERT_STATE, isNight(), minutes(), mskHour(), register() (+13 more)

## Knowledge Gaps
- **110 isolated node(s):** `name`, `version`, `private`, `type`, `node` (+105 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `markup` connect `index.ts` to `run.ts`, `caption.ts`, `bot.ts`, `chart.ts`, `metrics.ts`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `scanOnce()` connect `run.ts` to `index.ts`, `bot.ts`, `chart.ts`, `metrics.ts`, `budget.test.ts`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `Candle` connect `metrics.ts` to `run.ts`, `index.ts`, `bot.ts`, `chart.ts`, `budget.test.ts`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _110 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `flowChart.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0960960960960961 - nodes in this community are weakly interconnected._
- **Should `flowCaption.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._