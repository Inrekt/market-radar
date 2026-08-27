# Graph Report - market-radar  (2026-08-27)

## Corpus Check
- 31 files · ~12,869 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 270 nodes · 592 edges · 11 communities (10 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.7)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d9a120a9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- hl.ts
- ws.ts
- package.json
- compilerOptions
- whales.ts
- index.ts
- caption.ts
- Market Radar
- push-state.sh
- bot.ts
- chart.ts

## God Nodes (most connected - your core abstractions)
1. `markup` - 20 edges
2. `shortCaption()` - 17 edges
3. `main()` - 13 edges
4. `longCaption()` - 13 edges
5. `FlowRecorder` - 12 edges
6. `Candle` - 12 edges
7. `fmtPrice()` - 11 edges
8. `collectWhales()` - 10 edges
9. `writeJson()` - 10 edges
10. `invalidations()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `fetchCandles()`  [EXTRACTED]
  scripts/freeze-fixture.ts → src/hl.ts
- `main()` --calls--> `markup`  [EXTRACTED]
  scripts/markup-dump.ts → src/ta/index.ts
- `main()` --calls--> `fetchAssetCtxs()`  [EXTRACTED]
  scripts/smoke.ts → src/hl.ts
- `main()` --indirect_call--> `fetchPositions()`  [INFERRED]
  scripts/smoke.ts → src/hl.ts
- `main()` --calls--> `fetchCandles()`  [EXTRACTED]
  scripts/smoke.ts → src/hl.ts

## Import Cycles
- None detected.

## Communities (11 total, 1 thin omitted)

### Community 0 - "hl.ts"
Cohesion: 0.12
Nodes (23): main(), SECONDS, main(), money(), analyze(), AssetCtx, fetchCandles(), fetchLeaderboard() (+15 more)

### Community 1 - "ws.ts"
Cohesion: 0.15
Nodes (12): applyTrade(), BIG_PRINT_USD, BookLevel, Bucket, BUCKET_MS, emptyBucket(), FlowRecorder, RawTrade (+4 more)

### Community 2 - "package.json"
Cohesion: 0.07
Nodes (27): grammy, lightweight-charts, dependencies, grammy, lightweight-charts, puppeteer, devDependencies, tsx (+19 more)

### Community 3 - "compilerOptions"
Cohesion: 0.12
Nodes (15): DOM, ES2023, node, scripts/**/*.ts, src/**/*.ts, compilerOptions, lib, module (+7 more)

### Community 4 - "whales.ts"
Cohesion: 0.13
Nodes (30): collectMarket(), MARKET_TICK_MS, MarketSnapshot, Book, classify(), collectWhales(), diffBooks(), LAST_PATH (+22 more)

### Community 5 - "index.ts"
Cohesion: 0.10
Nodes (42): main(), Analysis, Candle, ChartInput, markup, dailyLevels(), liquidityPools(), nearestUnswept() (+34 more)

### Community 6 - "caption.ts"
Cohesion: 0.20
Nodes (31): caption(), aligned(), compact(), containing(), distancePct(), fmtMoney(), fmtPct(), fmtPrice() (+23 more)

### Community 7 - "Market Radar"
Cohesion: 0.40
Nodes (4): Market Radar, Запуск, Источник данных, Состояние

### Community 9 - "bot.ts"
Cohesion: 0.13
Nodes (26): cardKey(), cards, chartPath(), createBot(), HELLO, keyboard(), mark(), Mode (+18 more)

### Community 10 - "chart.ts"
Cohesion: 0.15
Nodes (16): ascendingBars(), chartHtml(), escapeHtml(), libSource(), linePayload(), pageStyle(), SIGN, ZONE_TITLE (+8 more)

## Knowledge Gaps
- **84 isolated node(s):** `name`, `version`, `private`, `type`, `node` (+79 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FlowRecorder` connect `ws.ts` to `whales.ts`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `markup` connect `index.ts` to `hl.ts`, `bot.ts`, `chart.ts`, `caption.ts`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `fetchAssetCtxs()` connect `whales.ts` to `hl.ts`, `bot.ts`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `main()` (e.g. with `.setCoins()` and `.start()`) actually correct?**
  _`main()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _84 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `hl.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11724137931034483 - nodes in this community are weakly interconnected._
- **Should `ws.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14624505928853754 - nodes in this community are weakly interconnected._