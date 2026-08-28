# Graph Report - market-radar  (2026-08-28)

## Corpus Check
- 59 files · ~46,550 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 575 nodes · 1430 edges · 18 communities (17 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 26 edges (avg confidence: 0.68)
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
- hl.ts
- index.ts
- caption.ts
- Market Radar
- push-state.sh
- bot.ts
- chart.ts
- ws.ts
- metrics.ts
- budget.test.ts
- digest.ts
- scorecard.ts
- digest.test.ts
- events.ts

## God Nodes (most connected - your core abstractions)
1. `markup` - 25 edges
2. `scanOnce()` - 23 edges
3. `safe()` - 23 edges
4. `fmtMoney()` - 22 edges
5. `longFlowCaption()` - 22 edges
6. `Candle` - 20 edges
7. `shortCaption()` - 18 edges
8. `dayFile()` - 17 edges
9. `fmtPct()` - 17 edges
10. `shortFlowCaption()` - 17 edges

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

## Communities (18 total, 1 thin omitted)

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

### Community 4 - "hl.ts"
Cohesion: 0.06
Nodes (67): main(), SECONDS, main(), money(), BOT_STATE_PATH, saveBotState(), collectMarket(), MARKET_TICK_MS (+59 more)

### Community 5 - "index.ts"
Cohesion: 0.08
Nodes (49): main(), Analysis, Candle, markup, dailyLevels(), liquidityPools(), nearestUnswept(), POOL_MERGE_ATR (+41 more)

### Community 6 - "caption.ts"
Cohesion: 0.21
Nodes (29): caption(), priceRows(), aligned(), captionPriceDecimals(), containing(), distancePct(), edgeBreak(), fmtPct() (+21 more)

### Community 7 - "Market Radar"
Cohesion: 0.40
Nodes (4): Market Radar, Запуск, Источник данных, Состояние

### Community 9 - "bot.ts"
Cohesion: 0.08
Nodes (48): analyze(), cardKey(), cards, chartPath(), createBot(), HELLO, keyboard(), mark() (+40 more)

### Community 10 - "chart.ts"
Cohesion: 0.10
Nodes (27): main(), ascendingBars(), chartHtml(), ChartInput, escapeHtml(), libSource(), linePayload(), pageStyle() (+19 more)

### Community 11 - "ws.ts"
Cohesion: 0.14
Nodes (13): applyTrade(), BIG_PRINT_USD, BookLevel, Bucket, BUCKET_MS, emptyBucket(), FlowRecorder, RawTrade (+5 more)

### Community 12 - "metrics.ts"
Cohesion: 0.12
Nodes (34): AssetCtx, ArchiveView, loadSeries(), Snapshot, whaleFlow, breakoutMetric(), clamp01(), fmtUsd() (+26 more)

### Community 13 - "budget.test.ts"
Cohesion: 0.14
Nodes (21): AlertState, canAlert(), countLastHour(), EMPTY_ALERT_STATE, isNight(), minutes(), mskHour(), register() (+13 more)

### Community 14 - "digest.ts"
Cohesion: 0.12
Nodes (31): aligned(), buildDigest(), clampHours(), CoinChange, Digest, DigestInput, EMPTY_SERIES, field() (+23 more)

### Community 15 - "scorecard.ts"
Cohesion: 0.11
Nodes (26): buildScorecard(), cell(), fmtMove(), Horizon, HORIZONS, keyOf(), loadBars(), maturedMoves() (+18 more)

### Community 16 - "digest.test.ts"
Cohesion: 0.19
Nodes (9): Coins, edgeCoins(), MOVES, net, NOW_MS, OI_END, snapshot(), writeArchive() (+1 more)

### Community 17 - "events.ts"
Cohesion: 0.60
Nodes (4): alertsOf(), candidatesOf(), readEvents(), ScanEvent

## Knowledge Gaps
- **130 isolated node(s):** `name`, `version`, `private`, `type`, `node` (+125 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AssetCtx` connect `metrics.ts` to `hl.ts`, `index.ts`, `caption.ts`, `bot.ts`, `budget.test.ts`, `digest.ts`, `digest.test.ts`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `Candle` connect `index.ts` to `hl.ts`, `bot.ts`, `chart.ts`, `metrics.ts`, `budget.test.ts`, `scorecard.ts`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `dayFile()` connect `hl.ts` to `ws.ts`, `digest.ts`, `scorecard.ts`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _130 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `flowChart.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0960960960960961 - nodes in this community are weakly interconnected._
- **Should `flowCaption.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._