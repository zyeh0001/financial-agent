# Financial Agent — PRD

**Owner:** Charles · **Status:** Rev 3 (2026-07-20, post design review) · **Runtime:** Claude Code (Phase 1)
**Companion docs:** [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY.md](SECURITY.md) · [ROADMAP.md](ROADMAP.md)

## 1. Problem

Charles manages his own AUD-based portfolio of US stocks/ETFs (+ small crypto) toward a
~A$250k house deposit on a 2–3 year horizon. Today's tooling is a reactive chat skill +
read-only dashboard: analysis happens only when he asks, portfolio records are hand-edited
markdown, discipline rules live partly in prose, and nothing watches the market for him.

## 2. Product definition

A **personal investment research agent** for exactly one user. Phase 1's promise:

> Trusted personal portfolio analysis and investment research, with reproducible
> calculations, explicit data provenance, durable decision records, and **no execution
> capability**.

The agent researches, calculates, challenges, and records. The human decides and places
every trade. Trust is proven before any autonomy is considered.

## 3. Runtime commitment

**Claude Code is the only supported Phase 1 runtime.** Core domain logic, data schemas,
scripts, MCP tool contracts, and skill prose must remain runtime-neutral so Codex support
can be added in Phase 2 without redesign — but nothing in Phase 1 is tested or promised on
Codex. (Codex skill path already verified: `~/.codex/skills/<name>/SKILL.md`, same format.)

## 4. Goals (Phase 1)

1. **Discovery & profiling** — structured investor profile: `investor-profile.md`,
   `portfolio-policy.md`, `risk-limits.yaml`. The agent reasons from files, never from
   chat memory.
2. **Planning** — budget, savings, debt-payoff, goal-based planning via the decision
   waterfall (EF floor first, sinking funds, glide path).
3. **Investment management** — allocation & drift vs. target, single-name concentration,
   ETF look-through overlap, currency exposure, rebalancing *suggestions*.
4. **Market awareness & research** — proactive daily/weekly digest scoped to held/watched
   tickers + relevant macro; source fact-checking with the skeptic workflow.
5. **Deep analysis toolkit** (all analysis-only):
   - **Valuation** — explicit assumptions, bull/base/bear + sensitivity, script-computed.
   - **Earnings** — actual vs. expectation vs. guidance; *quality* of beat.
   - **Options** — covered calls / LEAPS payoff, break-even, annualised yield, assignment
     risk. Analysis only; no option execution ever in this phase.
   - **Risk review** — red-team a thesis: what's priced in, correlated bets, what breaks it.
6. **Monitoring & alerts** — alert-only rule engine on a scheduler; notification-shaped
   rules (see ARCHITECTURE §6). No trade actions exist in the schema.
7. **Reporting & journal** — net worth over time, performance vs. benchmark, realized
   gains/losses log (data, not tax advice), investment journal (decision record at entry,
   postmortem at exit).
8. **Behavioral coaching** — encoded as *principles* applied per surface, not verbatim
   text: default to no action on weak evidence; separate price movement from thesis change;
   challenge FOMO/urgency; restate the user's own policy; downside before upside; never
   imply certainty; say when no decision is required.

## 5. Non-goals (Phase 1)

- **Order placement, order drafting to a broker, or any execution-shaped schema, file, or
  code path.** Not disabled — absent. (Broker ladder lives in ROADMAP; Level 4 may never
  be built.)
- Options execution (analysis in scope; placing/rolling orders is not).
- Insurance; tax planning/advice (realized-gains *log* is in scope).
- Multi-user support; any account other than the owner's; advice framed for third parties.
- Estate planning.
- Vector databases, or any infrastructure the current corpus doesn't justify.

## 6. Functional requirements

| # | Capability | Key requirement | Acceptance criteria |
|---|---|---|---|
| 1 | Profiling | Profile/policy/limits as files; agent answers "my goal/risk/EF status" from file alone | No guessed numbers; every figure traceable to a file |
| 2 | Planning | Decision waterfall applied to "I have A$X" | Concrete action + reasoning; honest "top up EF / no action" when that's the answer |
| 3 | Portfolio management | Allocation, concentration, overlap, currency exposure vs. `risk-limits.yaml` | Computed by finance-core within tolerances (ARCHITECTURE §9); breaches flagged unprompted |
| 4 | Research digest | Scheduled, deterministic collection; LLM only summarizes | Covers only held/watched + relevant macro; no LLM call when nothing changed; claims link to sources |
| 5 | Deep analysis | Valuation/earnings/options/risk-review skills + scripts | Every report passes its type-specific validator; all arithmetic reproducible by re-running a script |
| 6 | Monitoring | Alert-only rules; deterministic evaluation | Rule fires within one cycle, exactly once per dedup window, carrying rule ID, observed value, threshold, timestamp, source, staleness |
| 7 | Reporting & journal | Snapshot history + journal | Net-worth trend renders; every material decision retrievable by ticker + date |
| 8 | Coaching | Principles enforced via templates + validators | Alerts state "observation, not instruction"; reports end with the discipline block |

## 7. Success metrics (release gates, not aspirations)

**Accuracy** — 100% of market-sensitive figures carry source + timestamp + currency; 100%
of report calculations map to a script run ID; zero silent currency conversions; zero
unlabelled stale quotes in release evals; golden fixtures pass within defined tolerances.

**Reliability** — scheduled tasks idempotent; storage writes atomic; a failed provider
cannot partially overwrite state; retries cannot duplicate snapshots or journal entries;
every automated run has an auditable run ID.

**Usefulness** — portfolio health report on demand in minutes, not a manual spreadsheet
session; every alert names the exact condition that fired; every report separates facts /
assumptions / interpretation / unknowns.

**Cost** — monitoring makes no LLM call when no relevant event occurred; digest runs under
a configurable budget; provider responses cached where safe; subagent review reserved for
material research.

## 8. Regulatory constraint (not a solved feature)

This project is designed exclusively as a **private, owner-operated investment research
tool**. It is not designed, marketed, or operated as a financial-advice service. Any future
multi-user, commercial, sharing, or third-party-advice capability requires a separate legal
review before development. The agent refuses to generate advice framed for third parties.
Disclaimers and naming are hygiene, not regulatory controls; the legal position is a
project constraint, and outputs still carry the "research, not licensed advice" line.
