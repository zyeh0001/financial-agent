# Financial Agent — Architecture

**Status:** Rev 3 (2026-07-20) · Companion to [PRD.md](PRD.md), [SECURITY.md](SECURITY.md), [ROADMAP.md](ROADMAP.md)

## 1. System shape

```
Claude Code (Phase 1 runtime)
    │
    ├── project instructions (CLAUDE.md)
    ├── skill router + workflow references (§7)
    └── optional read-only review subagents (§8)
             │
             ▼
        MCP adapters            ← thin: schema validation, permission checks, wrappers
             │
             ▼
       Domain libraries         ← ALL financial logic lives here (finance-core)
  portfolio · performance · valuation · options · rules · validation
             │
      ┌──────┴──────┐
      ▼             ▼
 provider layer   storage layer
 market data      structured state (Layer B)
 filings · FX     narrative records (Layer A)
      │             │
      └──────┬──────┘
             ▼
 orchestrator-independent scheduler (launchd → CLI)
             │
       alerts · snapshots · digest events
             ▼
      read-only dashboard
```

Principles: Claude Code orchestrates workflows; MCP exposes structured capabilities;
domain libraries contain the financial logic; scripts and the scheduler run without the
LLM; storage has explicit ownership and recovery rules; the dashboard only reads; **Phase 1
contains no order or execution domain.**

## 2. Repository boundaries (decided 2026-07-20)

```
financial-agent/                    ← THIS repo: all agent code
  packages/
    finance-core/                   portfolio · performance · valuation · options · rules · validation
    data-providers/                 market-data · filings · fx (adapter interfaces)
    storage/                        markdown · jsonl · yaml (atomic write, locking, versioning)
    mcp-server/                     tools/ · resources/ · permissions/ (thin adapters only)
  scripts/                          CLI entry points, scheduled tasks, imports, maintenance
  skills/                           router SKILL.md + references/ (installed to ~/.claude/skills/)
  templates/                        report skeletons (§10)
  hooks/                            validation hooks
  tests/                            fixtures/ · calculation-tests/ · agent-evals/
  docs/                             this documentation

personal-financial-dashboard/       ← EXISTING repo: UI only. Reads local data via
                                      finance-core (or its output files); never writes;
                                      duplicated yahoo.ts/parse.ts retired at M3.

~/Documents/notes/Charles/Investment/  ← the DATA. Owned by neither repo. Obsidian-synced.
```

Rule: **code lives in repos, data lives in `Investment/`, the dashboard only reads.**

The layering rule that replaces "procedure → MCP": a capability is first a **tested
domain function** (`calculateOptionPayoff()`), then optionally a **script** entry point
(`scripts/option-payoff.ts`), then optionally an **MCP tool** (`options.calculate_payoff`)
if the agent needs to invoke it as a structured tool. Dashboard, scheduler, CLI, tests,
and both runtimes reuse the same domain function. Skills contain judgment/workflow prose
only — never business logic.

## 3. Data ownership — three layers

| Layer | Contents | Storage | Writers |
|---|---|---|---|
| **A — narrative** | goals, horizon, policy, thesis, watchlist notes, journal, postmortems, reports | `Investment/*.md`, `journal/`, `reports/` | user; agent only via explicit workflow, with confirmation where financially material |
| **B — structured state** | positions projection, snapshots, rules, run/audit logs, provider caches | `Investment/data/` (JSONL/YAML; SQLite only when read patterns demand) | trusted application/storage layer only — never hand-edited, never by prose |
| **C — collaboration style** | tone, verbosity, non-financial preferences | runtime-native memory | the runtime |

**Layer C must never contain:** holdings, cost basis, risk limits, goals, thresholds,
theses, or anything that changes a recommendation. Financial substance lives in A/B so an
orchestrator switch loses nothing.

**Layer A additions** (M1): `investor-profile.md` (base currency, horizons, style, themes),
`portfolio-policy.md` (standing discipline rules the agent enforces in analysis),
`risk-limits.yaml` (machine-readable caps: `speculative_allocation_max: 15%`,
`single_stock_max: 10%`, `margin_allowed: false`, `no_undefined_risk_options: true`).

## 4. Portfolio source of truth & reconciliation

Precedence when representations disagree (highest wins):

```
1. Imported broker transactions/positions        (Phase 2+, does not exist yet)
2. Reconciled structured portfolio state          (becomes canonical when 1 exists)
3. portfolio.md                                   (CANONICAL in Phase 1)
4. Historical snapshots                           (history only, never current truth)
5. Dashboard cache                                (disposable)
```

**Phase 1 stance:** `portfolio.md` + chat-CRUD is canonical — single account, no options
positions, hand-maintained workflow; markdown is adequate and human-auditable. **The flip
is scheduled, not hypothetical:** when broker CSV import lands (Phase 2, broker ladder
Level 1), structured transactions become the quantitative source of truth and
`portfolio.md` becomes a generated, annotated projection. Reconciliation metadata is
reserved now so the flip is additive:

```yaml
portfolioVersion: portfolio_20260720_001
asOf: 2026-07-20T20:00:00-04:00
lastReconciledAt: null          # populated from Phase 2
source: manual_chat_crud        # later: broker_csv
status: unreconciled            # later: reconciled | conflict
```

Required around any write: backup before write, atomic replacement, a manual-correction
workflow, and (Phase 2+) a reconciliation command + report.

## 5. Storage integrity

Required of the `storage/` package from M0, because Layer B lives under an
Obsidian/git-synced folder and multiple processes touch it (scheduler, MCP server, user
edits, sync):

- Atomic writes (temp file → rename); file/process locking
- `schemaVersion` on every record type; migration support
- Unique event IDs + idempotency keys; duplicate detection
- Recovery from a malformed final JSONL row (crash mid-append)
- Sync-conflict detection (Obsidian/git conflict copies)
- Backup/restore; audit logs; checksums where useful

**Snapshot schema v2** (daily history — reporting only, the engine reads live data). V1 is
still accepted for migration; new records use real report/hash provenance rather than an
invented portfolio version absent from the Phase-1 Markdown source:

```json
{
  "schemaVersion": 2,
  "eventId": "snap_20260720_manual",
  "capturedAt": "2026-07-20T03:17:36Z",
  "marketSession": "MANUAL",
  "valuationCurrency": "AUD",
  "fxTimestamp": "2026-07-17T20:00:00Z",
  "sourceReportRunId": "run_20260720T031723Z_0c23",
  "sourcePortfolioHash": "sha256:<64 lowercase hex characters>",
  "totalValue": 42310,
  "byBucket": { "crypto": 0.06, "etf": 0.48, "cash": 0.31, "individual": 0.15 },
  "status": "complete"
}
```

`health-report` creates at most one immutable snapshot per day/session. The dashboard reads
the newest validated health report plus sorted snapshot files through the storage package's
single read-model interface. It never writes, never silently falls back from a malformed
newest report, and presents freshness and completeness as separate dimensions. Portfolio
math stays in finance-core; the dashboard server is a thin read/watchlist/OHLC adapter.
History is charted only when its valuation currency matches the current report, and any
sync-conflict artifact blocks selection until a human resolves it.

**Run/audit log** (`runs.jsonl`): every automated run records run ID, trigger, start/finish,
input versions, provider calls, validation results, outputs, error state, and model ID where
an LLM was used.

## 6. Alert rule engine (alert-only — no execution domain)

Rules are user-editable config (`Investment/data/rules.yaml`); the engine is code. Strategy
content is volatile; the engine is not. **There is no `mode`, no `action`, no order schema,
no `orders.jsonl` anywhere in Phase 1** (decided Rev 3, superseding the earlier per-rule
alert/execute flag — the safety property "execution does not exist in this codebase" beats
"execution exists but is disabled"). If execution is ever designed (broker ladder Level 3+),
it arrives as a new schema (`trade-proposals.jsonl`) with its own migration and security
review.

```yaml
- id: avgo-entry-watch
  schemaVersion: 1
  status: active            # active | paused
  symbol: AVGO
  condition:
    all:                    # all (AND) | any (OR) — one level, no nesting (extend later if a real rule demands it)
      - { field: price, operator: lt, value: 300, currency: USD }
      - { field: pe,    operator: lt, value: 40 }
  notification:
    severity: informational # informational | attention | urgent
    messageTemplate: entry-watch
```

**Engine inputs (Phase 1, decided at grilling 2026-07-17):** live quote; portfolio-derived
(position %, bucket weights, unrealized P&L, % from entry); fundamentals (P/E, market cap,
days-to-earnings). **Excluded:** time-series (⟹ no trailing stops; fixed stop/target from
entry still works) and news/sentiment. Adding an input class = a new engine handler, not a
schema rewrite.

Evaluation is deterministic (finance-core `rules/`), runs under the scheduler, and emits
notification events — never trades.

## 7. Skills

One skill, progressive disclosure: a lean router `SKILL.md` (persona, guardrails,
source-of-truth map, routing table) + `references/*.md` loaded only when that task fires.
Shared core lives once; baseline context never grows as capabilities are added.

```
references/
  source-analysis.md      fact-check a pasted article/video (skeptic workflow)
  portfolio-health.md     health check + rebalancing judgment vs. policy
  planning.md             decision waterfall ("I have A$X this month")
  experiment.md           StockWe momentum test rules
  research-digest.md      proactive scan → digest
  monitoring.md           alert rule setup
  valuation.md            DCF/multiples · bull/base/bear · via scripts
  earnings-analysis.md    actual vs. expectation vs. guidance · quality of beat
  options-analysis.md     covered calls / LEAPS payoff math · analysis ONLY
  risk-review.md          red-team a thesis
  journal.md              decision records · postmortems
```

Token discipline (unchanged from Rev 2): distilled tool output over raw files; minimum
files per task; bulky content isolated in subagents. Skill prose stays tool-agnostic
(Phase 2 portability).

## 8. Subagents (staged; not a safety boundary)

Order of trust: **1) deterministic schema validation, 2) claim-to-source mapping,
3) independent calculation, 4) original-filing verification, 5) second-pass model review.**
A fact-checker subagent is layer 5, not a substitute for layers 1–4 — a second pass by the
same model family can repeat the original mistake.

Introduce `risk-manager` (no network writes, no portfolio access) and `source/fact-checker`
first; add `equity-researcher`, `valuation-analyst`, `options-analyst` only if a measured
quality metric (unsupported claims, missed risks, arithmetic discrepancies, source
coverage) shows the need. Proportionality: a covered-call break-even is one script call,
not a pipeline.

## 9. Calculation methodology

- **Portfolio performance:** time-weighted return. **Investor experience:** money-weighted
  (XIRR). **Unrealised P&L:** broker-compatible cost basis. **Benchmark:** same dates, same
  valuation currency. **FX impact:** reported as a separate contribution, never silently
  mixed.
- **Tolerances:** money ±0.01; weights ±0.01pp; IRR ±0.001; FX at provider precision.
- **Golden fixtures** (`tests/fixtures/`), staged to what the portfolio actually contains:
  Phase 1 — simple-buy-hold, partial-sale, dividend, aud-usd-deposit, brokerage-fees,
  stale-price. Added with the features that need them — stock-split, option-expiry,
  option-assignment, multi-account-transfer.
- All arithmetic via finance-core, reproducible by run ID. The model never does mental math
  into a report.

## 10. Report types & validators

Each output type has its own schema and validator (a stale-data alert does not need a bear
case; a valuation does):

`stockResearchReport` · `valuationReport` · `earningsReport` · `optionsReport` ·
`portfolioHealthReport` · `monitorAlert` · `dailyDigest` · `journalEntry` · `postmortem`

Examples — `valuationReport` requires: data date, sources, assumptions, bull/base/bear,
sensitivity, risks, invalidation conditions. `monitorAlert` requires: rule ID, condition,
observed value, threshold, timestamp, source, staleness status, research-only line.
Stock reports end with the discipline block: *attractive below / fair range / too
optimistic above / invalidated if / next data point* — never bare buy/sell/hold.

Validation has two stages: the report-type schema checks shape and structured provenance;
the strict validator resolves each calculation reference against its immutable record and
compares the input hash, assumptions/terms, sensitivity, outputs, and numeric discipline
band. A well-formed but invented run ID or hash is invalid.

## 11. Scheduler & notifications

**Orchestrator-independent.** macOS `launchd` → `financial-agent` CLI → finance-core →
providers → storage. Deterministic flow:

```
fetch data → validate → evaluate rules → persist events → notify
                                   └→ optional LLM summarization (digest) only when
                                      relevant events exist
```

Monitoring works with Claude Code closed and makes zero LLM calls on quiet days.

**Notifications are an internal adapter, not an MCP server:**

```ts
interface NotificationAdapter { send(event: NotificationEvent): Promise<void> }
```

Implementations: macOS notification (default), dashboard event; Slack/email if wanted.
Expose as MCP only if the agent itself ever needs to send as a structured tool.

**M4 implementation.** `npm run monitor` validates `data/rules.yaml`, fetches only the
fields active rules require, derives portfolio observations from the newest validated
health report, evaluates through finance-core, and appends alert creation/delivery records
to `data/alerts.jsonl`. Creation is claimed under a filesystem lock before notification;
pending deliveries are atomically leased so overlapping cycles cannot both send them;
successful deliveries close the durable retry item, while failed or expired leases return
to the next cycle. The default dedup window is 24 hours (`MONITOR_DEDUP_MINUTES` overrides
it), delivery uses three exponential-backoff attempts, and a partial provider failure is
audited without preventing unaffected rules or pending deliveries from running. The alert
log fails closed on corruption because recovering past an unknown tail could duplicate a
notification.

The dashboard event adapter is the durable `alert-created` record itself; macOS Notification
Center is the default human adapter. `npm run monitor:launchd -- --output <path>` renders the
15-minute launchd plist with absolute paths. Rendering does not load or activate the agent.

**M5 digest flow.** `npm run digest` collects SEC filings and, when configured, Finnhub
company/general news for held and watched symbols. The finance-core digest module filters
against that explicit universe and configured macro topics, removes already-reported event
IDs, ranks original/official/secondary sources, and classifies each event as requiring
thesis review or context only without claiming that a routine filing changed the thesis.
Facts, publication timestamps, and source links are immutable deterministic output;
interpretation and summary occupy separate nullable fields.

The optional Anthropic summarizer adapter sits behind a character/event/token budget and
must map every summary claim to supplied event IDs. It is not invoked
when no relevant event exists, and the default scheduled CLI makes no model call at all.
Finnhub credentials come from the trusted process environment or macOS Keychain service
`financial-agent-finnhub`; Anthropic uses the equivalent `financial-agent-anthropic` service.
Keys are never written into plist files, reports, or logs.
Validated digest reports are immutable under `data/digests/` and provide the seen-event set
for subsequent daily/weekly runs.
