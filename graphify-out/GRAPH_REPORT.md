# Graph Report - market-radar  (2026-08-28)

## Corpus Check
- 64 files · ~52,712 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 624 nodes · 1589 edges · 18 communities (16 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 33 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d165804f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- flowChart.ts
- flowCaption.ts
- package.json
- compilerOptions
- main.ts
- caption.test.ts
- caption.ts
- Market Radar
- push-state.sh
- bot.ts
- chart.ts
- serve.sh
- metrics.ts
- run.ts
- digest.ts
- scorecard.ts
- hl.ts
- botFlow.ts

## God Nodes (most connected - your core abstractions)
1. `scanOnce()` - 25 edges
2. `markup` - 25 edges
3. `fmtMoney()` - 23 edges
4. `safe()` - 23 edges
5. `longFlowCaption()` - 22 edges
6. `Candle` - 20 edges
7. `buildDigest()` - 20 edges
8. `shortCaption()` - 20 edges
9. `main()` - 18 edges
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

## Communities (18 total, 2 thin omitted)

### Community 0 - "flowChart.ts"
Cohesion: 0.09
Nodes (40): Axis, bookPlates(), captions(), clamp(), coverage(), CvdDomain, cvdOffScale(), CvdScale (+32 more)

### Community 1 - "flowCaption.ts"
Cohesion: 0.20
Nodes (33): fmtMoney(), biggestPrints(), bookText(), bucketsText(), bucketTurnover(), DominantBucket, dominantText(), fmtClock() (+25 more)

### Community 2 - "package.json"
Cohesion: 0.07
Nodes (29): grammy, lightweight-charts, dependencies, grammy, lightweight-charts, puppeteer, devDependencies, tsx (+21 more)

### Community 3 - "compilerOptions"
Cohesion: 0.12
Nodes (15): DOM, ES2023, node, scripts/**/*.ts, src/**/*.ts, compilerOptions, lib, module (+7 more)

### Community 4 - "main.ts"
Cohesion: 0.06
Nodes (57): collectMarket(), MARKET_TICK_MS, MarketSnapshot, Book, classify(), collectWhales(), diffBooks(), LAST_PATH (+49 more)

### Community 5 - "caption.test.ts"
Cohesion: 0.07
Nodes (54): main(), main(), Analysis, Candle, ChartInput, markup, dailyLevels(), liquidityPools() (+46 more)

### Community 6 - "caption.ts"
Cohesion: 0.18
Nodes (33): caption(), aligned(), captionPriceDecimals(), containing(), distancePct(), edgeBreak(), FLOW_MEANING, FLOW_TAIL (+25 more)

### Community 7 - "Market Radar"
Cohesion: 0.33
Nodes (5): Market Radar, Запуск, Из чего состоит, Что измерено, а не предположено, Что он делает

### Community 9 - "bot.ts"
Cohesion: 0.07
Nodes (51): analyze(), cardKey(), cards, chartPath(), createBot(), HELLO, HELP, keyboard() (+43 more)

### Community 10 - "chart.ts"
Cohesion: 0.10
Nodes (26): ascendingBars(), chartHtml(), CUT_MARK, escapeHtml(), libSource(), linePayload(), pageStyle(), SIGN (+18 more)

### Community 12 - "metrics.ts"
Cohesion: 0.13
Nodes (32): ArchiveView, loadSeries(), Snapshot, whaleFlow, breakoutMetric(), clamp01(), fmtUsd(), fromArchive() (+24 more)

### Community 13 - "run.ts"
Cohesion: 0.11
Nodes (29): valueAt(), AlertState, canAlert(), countLastHour(), EMPTY_ALERT_STATE, isNight(), minutes(), mskHour() (+21 more)

### Community 14 - "digest.ts"
Cohesion: 0.11
Nodes (33): aligned(), buildDigest(), clampHours(), CoinChange, Digest, DigestInput, EMPTY_SERIES, field() (+25 more)

### Community 15 - "scorecard.ts"
Cohesion: 0.10
Nodes (29): onScore(), writeDailyNote(), buildScorecard(), cell(), fmtMove(), Horizon, HORIZONS, keyOf() (+21 more)

### Community 18 - "hl.ts"
Cohesion: 0.08
Nodes (31): main(), SECONDS, main(), money(), AssetCtx, BookLevel, fetchCandles(), fetchLeaderboard() (+23 more)

### Community 19 - "botFlow.ts"
Cohesion: 0.11
Nodes (30): build(), caption(), cards, keyboard(), label(), mark(), Mode, onCallback() (+22 more)

## Knowledge Gaps
- **143 isolated node(s):** `name`, `version`, `private`, `type`, `node` (+138 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AssetCtx` connect `hl.ts` to `caption.test.ts`, `caption.ts`, `bot.ts`, `metrics.ts`, `run.ts`, `digest.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `Candle` connect `caption.test.ts` to `bot.ts`, `chart.ts`, `metrics.ts`, `run.ts`, `scorecard.ts`, `hl.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `dayFile()` connect `main.ts` to `run.ts`, `digest.ts`, `scorecard.ts`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _143 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `flowChart.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08658536585365853 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._