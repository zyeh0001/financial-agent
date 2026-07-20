# Financial Agent — Roadmap

**Status:** Rev 3 (2026-07-20) · Companion to [PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md)

Sequencing principle: **prove trustworthiness before autonomy.** Each milestone is a small,
releasable stage with exit criteria; Phase 1 as a whole ships zero execution capability.

## 1. Phase 1 milestones

### M0 — Contracts, source of truth, fixtures *(before restructuring anything)*

Define: canonical portfolio + transaction schema (incl. reconciliation metadata), snapshot
schema, journal schema, rule schema, report-type schemas, source-of-truth precedence,
provider interfaces, runtime-neutral MCP tool contracts, threat model, golden financial
fixtures (Phase-1 set), calculation tolerances, run/audit ID format.

**Exit:** schemas versioned; fixtures pass against finance-core stubs; conflict resolution
documented; zero execution-shaped fields anywhere; Claude Code stated as the Phase 1 runtime.

### M1 — Portfolio foundation

`investor-profile.md` / `portfolio-policy.md` / `risk-limits.yaml` split out of
`finances.md`; finance-core portfolio math (allocation, concentration, currency exposure,
cost basis, unrealized P&L); validation; audit logs; portfolio health report. No dashboard
refactor in this milestone.

**Exit:** given a known test portfolio — correct total value, weights, currency exposure,
concentration flags, cost basis, unrealized P&L, all within tolerances.

### M2 — Research workbench

Stock-research / valuation / earnings / options-analysis / risk-review reference skills;
calculation scripts (payoff, valuation, allocation); filings access; report templates;
report-type validators; journal (entries + postmortems); skill folder restructured to
router + references.

**Exit:** a complete stock report carries timestamps, sources, assumptions, scenarios,
risks, invalidation conditions, unknowns — and every number reproduces via script run ID.

### M3 — Dashboard integration

Dashboard reads via finance-core (or its outputs); duplicated `yahoo.ts`/`parse.ts`
retired; snapshot history + net-worth trend chart; visible stale/error states.

**Exit:** dashboard never writes, shows snapshot provenance, displays stale/incomplete data
visibly, duplicates no financial calculations.

### M4 — Monitoring engine

launchd-driven scheduler → CLI → deterministic evaluate → notify (ARCHITECTURE §11);
alert-only rules (§6); notification adapter (macOS default); dedup, retries, run logs,
provider-failure handling.

**Exit:** a rule fires within one cycle, exactly once per dedup window, carrying rule ID,
observed value, threshold, timestamp, currency, source, staleness.

### M5 — Digest & proactive research

Deterministic event collector, relevance filter (held/watched only), source ranking,
thesis-change classification, optional LLM summary, daily/weekly digest.

**Exit:** digest covers only relevant assets/macro; separates event from interpretation;
**makes no LLM call when nothing relevant happened**; stays in budget; links claims to
sources.

### M6 — Subagent quality pipeline *(optional)*

`risk-manager` + `source/fact-checker` first (read-only). Others only if a measured quality
metric shows need (ARCHITECTURE §8).

**Exit:** measurable improvement — fewer unsupported claims, more identified risks, fewer
arithmetic discrepancies, better source coverage.

**Phase 1 ends here: a trusted research + monitoring agent, no execution capability present.**

## 2. Phase 2 — portability & broker reads

- **Codex as second runtime.** Path verified (`~/.codex/skills/<name>/SKILL.md`); prose
  already tool-agnostic; add Codex MCP config + AGENTS.md; smoke-test skill triggering.
- **Broker ladder Level 1 — manual CSV import:** broker export → import → reconcile.
  **This is the flip point:** structured transactions become the quantitative source of
  truth; `portfolio.md` becomes a generated projection (ARCHITECTURE §4).
- **Broker ladder Level 2 — read-only API:** positions, cash, transactions, order history;
  auto-sync replaces hand-editing.

## 3. Phase 3+ — the rest of the broker ladder

- **Level 3 — order preview:** draft + cost + risk warnings; nothing submitted. New schema
  (`trade-proposals.jsonl`) with its own design + security review.
- **Level 4 — human-approved drafts:** recorded research finding — IBKR's official MCP is
  draft-only (user submits in IBKR's own "AI Instructions" tab; the broker's UI is the
  permission gate; available in AU). A separately-designed, safety-reviewed project.
  **Stopping at Level 2–3 permanently is an acceptable end state.**

## 4. Open decisions

- **Notification channel default** — decided at M4: macOS Notification Center plus durable
  dashboard-readable `alert-created` events. Slack/email remain deferred until requested.
- **Market-data/news provider for M5** — decided: SEC EDGAR for original filings plus optional
  Finnhub company/general news (free personal tier); Yahoo remains quote/FX only.
- **SQLite graduation** — decided at M4: keep Layer B in locked JSONL/YAML; current monitoring
  read patterns do not justify SQLite.
- **Execution-skill isolation** — moot for Phase 1 (no execution skill exists); re-raise at
  Level 3 design.

## 5. Decision log

| Date | Decision |
|---|---|
| 2026-07-17 | Strategy = user-editable rule engine; inputs = quote + portfolio-derived + fundamentals (no time-series/news ⟹ no trailing stops); flat one-level all/any; snapshots daily at US close |
| 2026-07-17 | ~~Per-rule `mode: alert\|execute`; IBKR draft-only in Phase 1 M5/M6~~ *(superseded)* |
| 2026-07-20 | Rev 2: no order placement in Phase 1; deep-analysis skills added; profile split; hooks + evals mandatory; subagents staged; Layer A stays in `Investment/`; agent core in standalone repo, dashboard UI-only |
| 2026-07-20 | Rev 3 (design review): execution shapes **removed** from Phase 1 schemas entirely (supersedes "inert flag"); domain library separated from MCP; orchestrator-independent scheduler (launchd + CLI); notifications as internal adapter, not MCP; prompt-injection rules; M0 contracts-first; doc split PRD/ARCHITECTURE/SECURITY/ROADMAP; source-of-truth precedence defined, `portfolio.md` canonical until broker import (flip at Phase 2 L1); fixtures staged to actual portfolio contents; Claude Code the explicit Phase 1 runtime |
| 2026-07-20 | M2 filings decision: use SEC EDGAR for original US filings through the official submissions API and archive; keep Yahoo for current quote/FX, defer any news-provider expansion to M5 |
| 2026-07-20 | M3 dashboard decision: consume validated health-report/snapshot outputs through one storage read model; reload is read-only; snapshot v2 records report-run + portfolio-hash provenance; freshness and completeness are independent visible states |
| 2026-07-20 | M4 monitoring decision: 15-minute launchd cycle; 24-hour configurable per-rule dedup; durable JSONL creation/delivery events; macOS + dashboard-event default; bounded notification retries; partial provider failures audited after unaffected work; no SQLite or LLM |
| 2026-07-20 | M5 digest decision: SEC filings plus optional Finnhub news; held/watched and explicit-macro relevance only; original-first ranking; deterministic thesis-impact classification; immutable v2 digest facts separate from nullable interpretation; optional character/event-budgeted summarizer with a hard zero-call empty path |
| — | Claude "finance" plugin rejected (corporate FP&A domain, wrong fit) |
