# Financial Agent — Contracts (M0)

**Status:** M0 deliverable (2026-07-20) · Schemas are code: [`packages/finance-core/src/schemas/`](../packages/finance-core/src/schemas/) is normative; this doc is the map.

## 1. Record schemas (zod, versioned)

| Record | Schema | Notes |
|---|---|---|
| Portfolio state | `PortfolioState` | reconciliation metadata reserved now; Phase 1 `source: manual_chat_crud`, `status: unreconciled` (flip at Phase 2 broker import — ARCHITECTURE §4) |
| Transactions | `AnyTransaction` | BUY / SELL / DIVIDEND / DEPOSIT / WITHDRAWAL / FEE / FX_CONVERT. Records of what happened — **no order/lifecycle states exist** |
| Snapshot | `Snapshot` | daily US close; feeds reporting only |
| Alert rule | `AlertRule`, `RulesFile` | alert-only; `.strict()` rejects `mode`/`action`/any execution shape at parse time (tested) |
| Journal | `JournalEntry`, `Postmortem` | risks + invalidation conditions are required, not optional |
| Run/audit | `RunRecord` | every automated run; model ID recorded iff an LLM ran |
| Reports | `ValuationReport`, `PortfolioHealthReport`, `MonitorAlert`, `DailyDigest` | per-type validators (ARCHITECTURE §10); `DisciplineBlock` on stock views |

All records carry `schemaVersion` (per-type, independent bumps). Currency changes happen
**only** via explicit `FX_CONVERT` — silent conversion is structurally impossible.

## 2. Calculation engine (finance-core)

- `processTransactions(txns) → LedgerState` — holdings (weighted-average cost, buy fees
  capitalized, sell fees off proceeds), cash by currency, realized P&L, dividends.
- `valuePortfolio(input) → Valuation` — total value, per-position value/weight/unrealized
  P&L, bucket weights, currency exposure, stale-quote flags (>30h configurable),
  concentration flags (individual stock > `singleStockMax`, default 0.10).
- Documented Phase-1 simplifications: average-cost basis (not lot-level); realized P&L and
  dividends converted at current fx, not transaction-time fx. Both revisit at Phase 2
  broker import.
- Tolerances (`TOLERANCES`): money ±0.01 · weights ±0.0001 (0.01pp) · IRR ±0.001.

## 3. Golden fixtures (`tests/fixtures/`)

`simple-buy-hold` · `partial-sale` · `dividend` · `aud-usd-deposit` · `brokerage-fees` ·
`stale-price` — inputs validated through the real schemas, outputs compared within
tolerances, weight-sum invariants checked. Add with their features: stock-split,
option-expiry, option-assignment, multi-account-transfer.

## 4. ID formats

```
run_20260720T093012Z_a3f1     RunId          (makeRunId())
snap_20260720_us_close        SnapshotEventId
txn_20260720_0001             TransactionId
jrnl_20260720_avgo-entry      JournalId
portfolio_20260720_001        PortfolioVersion
```

## 5. MCP tool contracts (runtime-neutral)

Thin adapters over finance-core (ARCHITECTURE §2). Inputs/outputs are the schemas above.
Read tools are freely callable; **write tools require explicit user confirmation in chat**
(SECURITY §5); no trade/order tool exists.

| Tool | In → Out | Access |
|---|---|---|
| `portfolio.get_state` | – → `PortfolioState` | read |
| `portfolio.get_valuation` | – → `Valuation` (live quotes + fx) | read |
| `portfolio.get_health` | – → `PortfolioHealthReport` | read |
| `market.get_quotes` | `symbols[]` → `ProviderQuote[]` | read |
| `market.get_fundamentals` | `symbols[]` → `ProviderFundamentals[]` | read |
| `market.get_fx` | `from,to` → `ProviderFxRate` | read |
| `filings.search` / `filings.get` | symbol/formTypes → `FilingRef[]` / text | read (M2) |
| `rules.list` / `rules.validate` | – / candidate → rules / issues | read |
| `rules.upsert` | `AlertRule` → ok | **confirm** |
| `portfolio.record_transaction` | `AnyTransaction` → new `PortfolioState` | **confirm** |
| `journal.create_entry` / `journal.create_postmortem` | entry → id | **confirm** |
| `journal.search` | query → entries | read |
| `reports.validate` | reportType + payload → issues | read |
| `snapshots.capture` | – → `Snapshot` | scheduler/CLI only |

## 6. Provider interfaces

`MarketDataProvider` · `FxProvider` · `FilingsProvider`
([`packages/data-providers/src/interfaces.ts`](../packages/data-providers/src/interfaces.ts)).
Every result carries source + timestamp + currency + delayed status; missing metadata is a
hard fail; provider output is untrusted input (SECURITY §3).

## 7. Storage integrity primitives

`atomicWriteFile` (tmp+rename) · `appendJsonl` · `readJsonl` (recovers a malformed final
line, throws on mid-file corruption) · `detectSyncConflicts` (Obsidian/git artifacts)
([`packages/storage/src/index.ts`](../packages/storage/src/index.ts)). Conflict resolution
path: ARCHITECTURE §4–5.

## 8. M0 exit criteria — status

- [x] Schemas versioned (`schemaVersion` on every record)
- [x] Golden fixtures pass against finance-core (23 tests: fixtures + schema guards + storage)
- [x] Conflict resolution documented (ARCHITECTURE §4–5; `detectSyncConflicts` implemented)
- [x] Zero execution-shaped fields — enforced by `.strict()` schemas **and** a regression test
- [x] Claude Code stated as the only Phase 1 runtime (PRD §3)
