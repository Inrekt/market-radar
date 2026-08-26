# Graph Report - market-radar  (2026-08-27)

## Corpus Check
- 15 files · ~4,542 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 129 nodes · 232 edges · 9 communities (8 shown, 1 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `27c792dc`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- hl.ts
- ws.ts
- package.json
- compilerOptions
- whales.ts
- main.ts
- market.ts
- Market Radar
- push-state.sh

## God Nodes (most connected - your core abstractions)
1. `main()` - 13 edges
2. `FlowRecorder` - 12 edges
3. `collectWhales()` - 10 edges
4. `dayFile()` - 9 edges
5. `compilerOptions` - 9 edges
6. `main()` - 8 edges
7. `appendLine()` - 8 edges
8. `writeJson()` - 8 edges
9. `collectMarket()` - 7 edges
10. `fetchAssetCtxs()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `main()` --indirect_call--> `fetchPositions()`  [INFERRED]
  scripts/smoke.ts → src/hl.ts
- `main()` --calls--> `fetchAssetCtxs()`  [EXTRACTED]
  scripts/smoke.ts → src/hl.ts
- `main()` --calls--> `fetchCandles()`  [EXTRACTED]
  scripts/smoke.ts → src/hl.ts
- `main()` --calls--> `fetchLeaderboard()`  [EXTRACTED]
  scripts/smoke.ts → src/hl.ts
- `main()` --calls--> `mapWithConcurrency()`  [EXTRACTED]
  scripts/smoke.ts → src/hl.ts

## Import Cycles
- None detected.

## Communities (9 total, 1 thin omitted)

### Community 0 - "hl.ts"
Cohesion: 0.14
Nodes (21): main(), money(), AssetCtx, Candle, fetchAssetCtxs(), fetchCandles(), fetchLeaderboard(), fetchPositions() (+13 more)

### Community 1 - "ws.ts"
Cohesion: 0.14
Nodes (12): applyTrade(), BIG_PRINT_USD, BookLevel, Bucket, BUCKET_MS, emptyBucket(), FlowRecorder, RawTrade (+4 more)

### Community 2 - "package.json"
Cohesion: 0.10
Nodes (20): devDependencies, tsx, @types/node, typescript, vitest, engines, node, name (+12 more)

### Community 3 - "compilerOptions"
Cohesion: 0.12
Nodes (15): DOM, ES2023, node, scripts/**/*.ts, src/**/*.ts, compilerOptions, lib, module (+7 more)

### Community 4 - "whales.ts"
Cohesion: 0.20
Nodes (12): Book, classify(), collectWhales(), diffBooks(), LAST_PATH, MAX_WALLETS, MIN_ACCOUNT_USD, signedUsd() (+4 more)

### Community 5 - "main.ts"
Cohesion: 0.31
Nodes (10): loadUniverse(), refreshUniverse(), UNIVERSE_TICK_MS, WHALE_TICK_MS, argNumber(), log(), main(), WATCHLIST_PATH (+2 more)

### Community 6 - "market.ts"
Cohesion: 0.39
Nodes (7): collectMarket(), MARKET_TICK_MS, MarketSnapshot, appendLine(), dayFile(), STATE_DIR, utcDay()

### Community 7 - "Market Radar"
Cohesion: 0.40
Nodes (4): Market Radar, Запуск, Источник данных, Состояние

## Knowledge Gaps
- **52 isolated node(s):** `name`, `version`, `private`, `type`, `node` (+47 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FlowRecorder` connect `ws.ts` to `main.ts`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `main()` connect `main.ts` to `hl.ts`, `ws.ts`, `whales.ts`, `market.ts`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `dayFile()` connect `market.ts` to `ws.ts`, `whales.ts`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `main()` (e.g. with `.setCoins()` and `.start()`) actually correct?**
  _`main()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _52 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `hl.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13675213675213677 - nodes in this community are weakly interconnected._
- **Should `ws.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14130434782608695 - nodes in this community are weakly interconnected._