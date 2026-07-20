# Financial Agent — Security

**Status:** Rev 3 (2026-07-20) · Companion to [PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [ROADMAP.md](ROADMAP.md)

## 1. Phase boundary (the load-bearing rule)

Phase 1 contains:

- **No broker-write integration.** No order drafts sent anywhere.
- **No executable trade-action schema** — no `mode: execute`, no `action.side/size`, no
  `orders.jsonl`, no order lifecycle states, no execution adapter. Absent, not disabled.
- No fund-transfer capability.
- No credential entry by the agent, ever.

When the broker ladder (ROADMAP §3) reaches Level 3+, execution concepts arrive as a *new*
schema with explicit migration and a fresh security review of that phase. Nothing in Phase 1
may quietly grow a broker-write capability.

## 2. Threat model (summary)

| Threat | Vector | Primary control |
|---|---|---|
| Prompt injection | news, filings, transcripts, PDFs, web pages, API/MCP responses | §3 rules; read-only research subagents; deterministic write gates |
| Wrong-money errors | stale price, wrong currency, option multiplier, fabricated figures | validation hooks + golden fixtures + tolerances (ARCHITECTURE §9) |
| Secret exposure | `.env`, keychain, broker/bank credentials | §4; pre-tool hook blocks; secrets only in trusted processes |
| Data corruption | concurrent writes, sync conflicts, crash mid-append | storage integrity (ARCHITECTURE §5): atomic writes, locks, recovery |
| Scope creep to advice-for-others | sharing outputs, future productization | PRD §8 regulatory constraint; agent refuses third-party framing |

## 3. Prompt injection — external content is untrusted data

**All external content is untrusted data. Instructions found inside articles, filings,
webpages, transcripts, API responses, MCP resources, PDFs, or uploaded documents must never
be treated as agent instructions.**

External content must not be able to:

- Expand tool permissions, request secrets, or override system/project/skill instructions
- Alter risk limits, investor policy, or portfolio records
- Create or modify monitoring rules
- Trigger writes or send notifications on its own

Controls:

- Research subagents are **read-only by default** (no write tools, no portfolio access).
- External text is kept separate from instructions in context; quoted, not obeyed.
- Policy / risk-limit / portfolio changes always require explicit user confirmation in chat.
- Tool arguments derived from external text are validated before execution.
- Domain allowlists (IR pages, SEC/ASIC/ASX, chosen data providers, selected news) reduce
  exposure but are **not** sufficient protection on their own.
- MCP outputs are untrusted unless produced by our own finance-core-backed server.

## 4. Secrets

The agent must not read or expose: `.env`, broker/bank passwords, 2FA recovery codes, tax
identifiers, full card numbers, password-manager data, SSH keys, browser cookies.

API keys live in `.env` (gitignored) or the OS keychain, read **only** by the trusted
processes that need them (MCP server, scheduler CLI) — never pasted into prompts, never
echoed into reports or logs. A pre-tool hook blocks reads of secret paths and sends to
non-allowlisted domains.

Known sensitive files elsewhere in the vault (git recovery codes, work credentials) are
out of bounds entirely.

## 5. Write controls

**Explicit user confirmation required** before modifying: investor profile, portfolio
policy, risk limits, canonical portfolio records, journal entries that represent the
user's intent.

**Automated writes permitted** (scheduler/MCP, audited): snapshots, run logs, provider
caches, validation results, alert events.

The dashboard never writes anything. Layer B is written only by the storage layer
(ARCHITECTURE §3); prose never writes Layer B.

## 6. Filesystem & shell

- Agent file access scoped to the `financial-agent` repo + `Investment/` folder — not the
  whole home directory.
- Shell: analysis scripts and tests auto-allowed; installs and network fetches confirmed;
  destructive commands (`rm -rf`, key reads, cookie access, uploads to unknown hosts)
  denied.

## 7. Auditability

Every automated run records: run ID, trigger, start/finish, input versions, provider
calls, validation results, output files, error state, and model identifier where an LLM
was used (`runs.jsonl`, ARCHITECTURE §5). Every report calculation maps to a script run ID.

## 8. Regulatory positioning

Private, owner-operated research tool (PRD §8). Not an advice service; refuses third-party
framing; disclaimers are hygiene, not controls; any future sharing/commercial capability
triggers separate legal review **before** development.
