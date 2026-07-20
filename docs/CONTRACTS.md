# Financial Agent — Contracts

**Status:** Current through M2 (2026-07-20) · Schemas are code: [`packages/finance-core/src/schemas/`](../packages/finance-core/src/schemas/) is normative; this doc is the map.

## 1. Record schemas (zod, versioned)

| Record | Schema | Notes |
|---|---|---|
| Portfolio state | `PortfolioState` | reconciliation metadata reserved now; Phase 1 `source: manual_chat_crud`, `status: unreconciled` (flip at Phase 2 broker import — ARCHITECTURE §4) |
| Transactions | `AnyTransaction` | BUY / SELL / DIVIDEND / DEPOSIT / WITHDRAWAL / FEE / FX_CONVERT. Records of what happened — **no order/lifecycle states exist** |
| Snapshot | `Snapshot` | daily US close; feeds reporting only |
| Alert rule | `AlertRule`, `RulesFile` | alert-only; `.strict()` rejects `mode`/`action`/any execution shape at parse time (tested) |
| Journal | `JournalEntry`, `Postmortem` | risks + invalidation conditions are required, not optional |
| Run/audit | `RunRecord` | every automated run; model ID recorded iff an LLM ran |
| Reports | `StockResearchReport`, `ValuationReport`, `EarningsReport`, `OptionsReport`, `PortfolioHealthReport`, `MonitorAlert`, `DailyDigest` | per-type validators (ARCHITECTURE §10); `DisciplineBlock` on stock views |
| Calculations | `DcfCalculationRecord`, `OptionPayoffRecord` | exact input + canonical SHA-256 hash + run ID; immutable CLI outputs |

All records carry `schemaVersion` (per-type, independent bumps). Currency changes happen
**only** via explicit `FX_CONVERT` — silent conversion is structurally impossible.

## 2. Calculation engine (finance-core)

- `processTransactions(txns) → LedgerState` — holdings (weighted-average cost, buy fees
  capitalized, sell fees off proceeds), cash by currency, realized P&L, dividends.
- `valuePortfolio(input) → Valuation` — total value, per-position value/weight/unrealized
  P&L, bucket weights, currency exposure, stale-quote flags (>30h configurable),
  concentration flags (individual stock > `singleStockMax`, default 0.10).
- `runDcfValuation(request) → DcfCalculationRecord` — sourced free cash flow, net debt,
  diluted shares, bull/base/bear DCF, and sensitivity grid. Rejects silent currency
  mismatch and discount rates at or below terminal growth.
- `runOptionPayoff(request) → OptionPayoffRecord` — covered-call and long-call break-even,
  maximum profit/loss, premium yield where applicable, and expiry payoff grid with an
  explicit contract multiplier.
- `buildStockResearchReport(request) → StockResearchReport` — derives report scenario and
  discipline numbers from a parsed DCF record; rejects misordered bear/base/bull outputs.
- `health-report` remains the allocation calculation entry point: it computes current
  weights/drift via finance-core and records the run rather than duplicating allocation math.
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

M2 adds `SecEdgarProvider`: ticker → CIK through the official SEC map, recent submission
metadata through `data.sec.gov`, and allowlisted original filing content under
`www.sec.gov/Archives/edgar/data/`. A declared contact-bearing User-Agent is mandatory;
callers must remain below the SEC's 10 requests/second ceiling.

## 7. Storage integrity primitives

`atomicWriteFile` (tmp+rename) · `atomicCreateFile` (immutable create) · `appendJsonl` ·
`readJsonl` (recovers a malformed final line, throws on mid-file corruption) ·
`detectSyncConflicts` (Obsidian/git artifacts) · validated Markdown journal
create/search with linked postmortems
([`packages/storage/src/index.ts`](../packages/storage/src/index.ts)). Conflict resolution
path: ARCHITECTURE §4–5.

## 8. Research CLI and workflow assets (M2)

- `npm run valuation -- --input <json>` and `npm run options-payoff -- --input <json>`
  validate inputs, create immutable calculation records, and append `RunRecord` audit rows.
- `templates/` contains report, journal, and schema-valid calculation-input skeletons.
- `skills/financial-agent/SKILL.md` is the lean router; task procedures live one level down
  in `references/` and keep arithmetic in finance-core.
- `validateReport(reportType, payload)` checks report shape;
  `validateReportWithCalculations(reportType, payload, records)` additionally resolves
  DCF/options references and rejects any mismatched input hash, assumptions, terms,
  sensitivity point, scenario, payoff, or discipline number. `reports:validate` uses the
  strict form and requires `--calculation` for calculation-bearing reports.
- `npm run journal` exposes read-only search plus confirmed/audited entry and postmortem
  creation. Write subcommands fail unless the orchestration layer supplies `--confirmed`
  after explicit confirmation in chat; storage then validates links and sync-conflict state.

## 9. M0 exit criteria — status

- [x] Schemas versioned (`schemaVersion` on every record)
- [x] Golden fixtures pass against finance-core (23 tests: fixtures + schema guards + storage)
- [x] Conflict resolution documented (ARCHITECTURE §4–5; `detectSyncConflicts` implemented)
- [x] Zero execution-shaped fields — enforced by `.strict()` schemas **and** a regression test
- [x] Claude Code stated as the only Phase 1 runtime (PRD §3)
