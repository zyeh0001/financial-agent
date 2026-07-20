# Progress

Running log of build progress against [docs/ROADMAP.md](docs/ROADMAP.md).
Update this file whenever a milestone (or meaningful chunk of one) lands.

## Status board

| Milestone | Status | Date |
|---|---|---|
| M0 — Contracts, source of truth, fixtures | ✅ Done | 2026-07-20 |
| M1 — Portfolio foundation | ✅ Done | 2026-07-20 |
| M2 — Research workbench | ✅ Done | 2026-07-20 |
| M3 — Dashboard integration | ⬜ Not started | |
| M4 — Monitoring engine | ⬜ Not started | |
| M5 — Digest & proactive research | ⬜ Not started | |
| M6 — Subagent quality pipeline (optional) | ⬜ Not started | |
| Phase 2 — Codex + broker read-only | ⬜ Future | |

## Log

### 2026-07-20 — M2 complete

The research workbench is implemented end to end:

- **Reproducible calculations** — versioned two-stage DCF and covered-call/long-call payoff
  records retain exact sourced inputs, canonical SHA-256 input hashes, results, timestamps,
  and run IDs. `npm run valuation` and `npm run options-payoff` create immutable outputs and
  real start/finish audit records. M1's health-report remains the deterministic allocation
  calculator, avoiding a second implementation of portfolio weights and drift.
- **Strict reports** — stock research, valuation v2, earnings, and options schemas join the
  existing report types. Numeric evidence carries structured units and currency; earnings
  actuals and expectations retain independent provenance. The strict validator recomputes
  supplied calculation records, rejects altered hashes/results, and compares report inputs,
  assumptions, sensitivity, scenarios, payoff, and discipline values. The report CLI uses
  this strict path.
- **Complete stock-report path** — `buildStockResearchReport` derives every valuation and
  discipline number from a verified DCF record. Tampered report values, hashes, and stored
  calculation outputs fail release tests.
- **Original filings** — the SEC EDGAR adapter resolves ticker → CIK through the official
  map, searches official submissions metadata, requires a declared contact User-Agent, and
  retrieves content only from allowlisted SEC archive URLs. External content remains
  untrusted data.
- **Journal** — validated Markdown entries and linked postmortems are atomically created and
  searchable by ticker/date. Writes fail on sync conflicts or malformed links and require
  the confirmed, audited CLI boundary; no real journal record was created during M2.
- **Workflow assets** — a lean `financial-agent` skill router uses progressive-disclosure
  references for stock research, valuation, earnings, options, risk review, source analysis,
  portfolio health, planning, journal, experiments, monitoring, and digest work. Report,
  journal, and schema-valid calculation-input templates are included.

Automated status: 55 tests passing across 12 files; TypeScript typecheck passing; skill
frontmatter validated. Independent standards and spec reviews report no unresolved P1/P2
findings. All M2 exit criteria are met. **Next: M3 — Dashboard integration.**

### 2026-07-20 — M1 complete

The repository-side portfolio foundation is implemented and passing its checks:

- Parses the canonical `portfolio.md` holdings table and the `finances.md`
  `cash-snapshot` block; unknown cost bases remain `null` and surface as data gaps.
- Validates machine-readable `risk-limits.yaml`, including target allocations summing to
  100%.
- Fetches timestamped quotes and FX through the Yahoo provider, then calculates portfolio
  value, allocation, currency exposure, concentration, cost basis, and unrealized P&L via
  `finance-core`.
- Produces a schema-validated portfolio health report and audited run record through
  `npm run health-report`; reports are immutable per run and include the exact position,
  quote, FX, currency, timestamp, source, and input-hash provenance needed to reproduce
  their calculations.
- Fails closed when any quote is unavailable or its currency disagrees with the declared
  cost currency, or when a canonical holdings row is malformed; a partial portfolio cannot
  be saved as a complete report.

Automated status: 37 tests passing; TypeScript typecheck passing.

The real Layer A records are split into `investor-profile.md`, `portfolio-policy.md`, and
`risk-limits.yaml`. The first live report completed successfully against all 27 recorded
positions (`run_20260720T015117Z_c6be`): AUD 105,024.44 total value, complete quote/FX
provenance, no stale quotes, and an audited immutable output. The mechanical health check
correctly surfaced cash and individual-stock allocation drift, the emergency-fund floor,
and four unknown cost bases without guessing values.

All M1 exit criteria are met. **Next: M2 — Research workbench.**

### 2026-07-20 — M0 complete

Repo initialized (npm workspaces, strict TS, vitest). Delivered:

- **finance-core** — versioned zod schemas for every record type: portfolio state (with
  Phase-2 reconciliation metadata reserved), transactions (currency changes only via
  explicit `FX_CONVERT`), snapshots, alert-only rules, journal entries/postmortems,
  run/audit records, report-type schemas. Deterministic portfolio engine:
  `processTransactions` (avg-cost basis, buy fees capitalized, sell fees off proceeds)
  → `valuePortfolio` (weights, currency exposure, stale + concentration flags).
- **data-providers** — MarketData / Fx / Filings interfaces; source + timestamp +
  currency mandatory on every result.
- **storage** — atomic writes (tmp+rename), JSONL append/read with crash-tail recovery,
  Obsidian/git sync-conflict detection.
- **tests** — 23 passing: 6 golden fixtures (simple-buy-hold, partial-sale, dividend,
  aud-usd-deposit, brokerage-fees, stale-price) within documented tolerances
  (money ±0.01, weights ±0.01pp); schema guards including the regression test that
  execution-shaped fields (`mode`/`action`/`side`) FAIL validation; storage integrity.
- **docs** — PRD / ARCHITECTURE / SECURITY / ROADMAP (Rev 3) + CONTRACTS.md (ID formats,
  MCP tool table, provider contracts, exit-criteria checklist).

All M0 exit criteria met. Known documented simplifications: average-cost basis (not
lot-level); realized P&L / dividends converted at current fx (both revisit at Phase 2
broker import).

**Next: M1** — split `investor-profile.md` / `portfolio-policy.md` / `risk-limits.yaml`
out of `finances.md`; parse real `portfolio.md` through the schemas; first validated
portfolio health report with live quotes. Touches real data files — do with Charles
reviewing the profile split.
