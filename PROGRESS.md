# Progress

Running log of build progress against [docs/ROADMAP.md](docs/ROADMAP.md).
Update this file whenever a milestone (or meaningful chunk of one) lands.

## Status board

| Milestone | Status | Date |
|---|---|---|
| M0 — Contracts, source of truth, fixtures | ✅ Done | 2026-07-20 |
| M1 — Portfolio foundation | ⬜ Not started | |
| M2 — Research workbench | ⬜ Not started | |
| M3 — Dashboard integration | ⬜ Not started | |
| M4 — Monitoring engine | ⬜ Not started | |
| M5 — Digest & proactive research | ⬜ Not started | |
| M6 — Subagent quality pipeline (optional) | ⬜ Not started | |
| Phase 2 — Codex + broker read-only | ⬜ Future | |

## Log

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
