# Graph Report - market-radar  (2026-08-28)

## Corpus Check
- 61 files · ~47,583 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 589 nodes · 1486 edges · 20 communities (19 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 28 edges (avg confidence: 0.67)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `cdbafd4e`
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
- digest.ts
- scorecard.ts
- digest.test.ts
- events.ts
- hl.ts
- botFlow.ts

## God Nodes (most connected - your core abstractions)
1. `markup` - 25 edges
2. `scanOnce()` - 23 edges
3. `safe()` - 23 edges
4. `fmtMoney()` - 22 edges
5. `longFlowCaption()` - 22 edges
6. `Candle` - 20 edges
7. `buildDigest()` - 20 edges
8. `main()` - 18 edges
9. `shortCaption()` - 18 edges
10. `dayFile()` - 17 edges

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

## Communities (20 total, 1 thin omitted)

### Community 0 - "flowChart.ts"
Cohesion: 0.09
Nodes (37): Axis, bookPlates(), captions(), clamp(), coverage(), cvdScale(), decimals(), deltaBars() (+29 more)

### Community 1 - "flowCaption.ts"
Cohesion: 0.13
Nodes (41): BigPrint, FlowBucket, FlowSummary, summarize(), Book, fmtMoney(), biggestPrints(), bookText() (+33 more)

### Community 2 - "package.json"
Cohesion: 0.07
Nodes (29): grammy, lightweight-charts, dependencies, grammy, lightweight-charts, puppeteer, devDependencies, tsx (+21 more)

### Community 3 - "compilerOptions"
Cohesion: 0.12
Nodes (15): DOM, ES2023, node, scripts/**/*.ts, src/**/*.ts, compilerOptions, lib, module (+7 more)

### Community 4 - "run.ts"
Cohesion: 0.07
Nodes (54): BOT_STATE_PATH, saveBotState(), collectMarket(), MARKET_TICK_MS, MarketSnapshot, Book, classify(), collectWhales() (+46 more)

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
Nodes (31): Analysis, analyze(), cardKey(), cards, chartPath(), createBot(), HELLO, keyboard() (+23 more)

### Community 10 - "chart.ts"
Cohesion: 0.11
Nodes (25): ascendingBars(), chartHtml(), escapeHtml(), libSource(), linePayload(), pageStyle(), SIGN, ZONE_TITLE (+17 more)

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
Cohesion: 0.11
Nodes (33): aligned(), buildDigest(), clampHours(), CoinChange, Digest, DigestInput, EMPTY_SERIES, field() (+25 more)

### Community 15 - "scorecard.ts"
Cohesion: 0.11
Nodes (26): writeDailyNote(), buildScorecard(), cell(), fmtMove(), Horizon, HORIZONS, keyOf(), maturedMoves() (+18 more)

### Community 16 - "digest.test.ts"
Cohesion: 0.19
Nodes (9): Coins, edgeCoins(), MOVES, net, NOW_MS, OI_END, snapshot(), writeArchive() (+1 more)

### Community 17 - "events.ts"
Cohesion: 0.60
Nodes (4): alertsOf(), candidatesOf(), readEvents(), ScanEvent

### Community 18 - "hl.ts"
Cohesion: 0.13
Nodes (21): main(), SECONDS, main(), money(), BookLevel, fetchCandles(), fetchLeaderboard(), fetchPositions() (+13 more)

### Community 19 - "botFlow.ts"
Cohesion: 0.17
Nodes (23): build(), caption(), cards, keyboard(), label(), mark(), Mode, onCallback() (+15 more)

## Knowledge Gaps
- **133 isolated node(s):** `name`, `version`, `private`, `type`, `node` (+128 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AssetCtx` connect `metrics.ts` to `run.ts`, `index.ts`, `caption.ts`, `bot.ts`, `budget.test.ts`, `digest.ts`, `digest.test.ts`, `hl.ts`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `Candle` connect `index.ts` to `run.ts`, `bot.ts`, `chart.ts`, `metrics.ts`, `budget.test.ts`, `scorecard.ts`, `hl.ts`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `dayFile()` connect `run.ts` to `botFlow.ts`, `ws.ts`, `digest.ts`, `scorecard.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _133 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `flowChart.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09246088193456614 - nodes in this community are weakly interconnected._
- **Should `flowCaption.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13135985198889916 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._