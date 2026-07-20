import { describe, expect, it } from "vitest";
import {
  AlertRule,
  FxConvertTransaction,
  JournalEntry,
  MonitorAlert,
  PortfolioHealthReport,
  PortfolioState,
  RulesFile,
  RunRecord,
  Snapshot,
  makeRunId,
  RunId,
} from "@financial-agent/finance-core";

describe("alert rule schema", () => {
  const validRule = {
    id: "avgo-entry-watch",
    schemaVersion: 1,
    status: "active",
    symbol: "AVGO",
    condition: {
      all: [
        { field: "price", operator: "lt", value: 300, currency: "USD" },
        { field: "pe", operator: "lt", value: 40 },
      ],
    },
    notification: { severity: "informational", messageTemplate: "entry-watch" },
  };

  it("accepts a valid alert-only rule", () => {
    expect(AlertRule.parse(validRule)).toBeTruthy();
  });

  it("REJECTS execution-shaped fields (SECURITY §1: absent, not disabled)", () => {
    expect(() => AlertRule.parse({ ...validRule, mode: "execute" })).toThrow();
    expect(() =>
      AlertRule.parse({ ...validRule, action: { side: "buy", size: { cashAUD: 500 } } })
    ).toThrow();
    expect(() => AlertRule.parse({ ...validRule, side: "buy" })).toThrow();
  });

  it("rejects nested condition groups (flat one-level only in Phase 1)", () => {
    expect(() =>
      AlertRule.parse({
        ...validRule,
        condition: { all: [{ any: [{ field: "price", operator: "lt", value: 1 }] }] },
      })
    ).toThrow();
  });

  it("rejects unknown rule fields (no time-series inputs in Phase 1)", () => {
    expect(() =>
      AlertRule.parse({
        ...validRule,
        condition: { all: [{ field: "trailing_high_pct", operator: "lt", value: -18 }] },
      })
    ).toThrow();
  });

  it("rejects duplicate rule ids in a rules file", () => {
    expect(() => RulesFile.parse([validRule, validRule])).toThrow();
  });
});

describe("transaction schema", () => {
  it("rejects same-currency FX_CONVERT", () => {
    expect(() =>
      FxConvertTransaction.parse({
        schemaVersion: 1,
        id: "txn_20260720_0001",
        ts: "2026-07-20T10:00:00Z",
        type: "FX_CONVERT",
        fromCurrency: "AUD",
        fromAmount: 100,
        toCurrency: "AUD",
        toAmount: 100,
      })
    ).toThrow();
  });
});

describe("record schemas parse their documented examples", () => {
  it("portfolio health reports use their independently versioned v2 schema", () => {
    const parsed = PortfolioHealthReport.safeParse({ schemaVersion: 1 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ path: ["schemaVersion"], code: "invalid_literal" })
      );
    }
  });

  it("snapshot", () => {
    expect(
      Snapshot.parse({
        schemaVersion: 1,
        eventId: "snap_20260720_us_close",
        capturedAt: "2026-07-20T20:05:00-04:00",
        marketSession: "US_CLOSE",
        valuationCurrency: "AUD",
        fxTimestamp: "2026-07-20T20:00:00-04:00",
        sourcePortfolioVersion: "portfolio_20260720_001",
        totalValue: 42310,
        byBucket: { crypto: 0.06, etf: 0.48, cash: 0.31, individual: 0.15 },
        status: "complete",
      })
    ).toBeTruthy();
  });

  it("portfolio state with reconciliation metadata", () => {
    expect(
      PortfolioState.parse({
        schemaVersion: 1,
        portfolioVersion: "portfolio_20260720_001",
        asOf: "2026-07-20T20:00:00Z",
        baseCurrency: "AUD",
        source: "manual_chat_crud",
        status: "unreconciled",
        lastReconciledAt: null,
        sourceFileHash: null,
        positions: [
          {
            symbol: "VOO",
            assetType: "etf",
            bucket: "etf",
            quantity: 10,
            averageCost: 500.2,
            costCurrency: "USD",
          },
        ],
        cash: [{ currency: "AUD", amount: 6900 }],
      })
    ).toBeTruthy();
  });

  it("journal entry requires risks and invalidation conditions", () => {
    const entry = {
      schemaVersion: 1,
      id: "jrnl_20260720_avgo-entry",
      ts: "2026-07-20T10:00:00Z",
      symbol: "AVGO",
      decision: "buy",
      thesis: "AI infra capex durable",
      horizon: "1-5y",
      entryReason: "pullback to fair range",
      risks: ["customer concentration"],
      invalidationConditions: ["data-centre revenue declines two consecutive quarters"],
    };
    expect(JournalEntry.parse(entry)).toBeTruthy();
    expect(() => JournalEntry.parse({ ...entry, risks: [] })).toThrow();
    expect(() => JournalEntry.parse({ ...entry, invalidationConditions: [] })).toThrow();
  });

  it("monitor alert requires observation framing fields", () => {
    expect(
      MonitorAlert.parse({
        schemaVersion: 1,
        reportType: "monitorAlert",
        generatedAt: "2026-07-20T20:06:00Z",
        runId: "run_20260720T200600Z_a3f1",
        dataAsOf: "2026-07-20T20:05:00Z",
        sources: ["yahoo"],
        disclaimer: "Research, not licensed financial advice.",
        ruleId: "avgo-entry-watch",
        symbol: "AVGO",
        condition: "price lt 300 USD",
        observedValue: 297.4,
        threshold: 300,
        observedAt: "2026-07-20T20:05:00Z",
        stale: false,
        severity: "informational",
        guidance: "Observation, not an instruction to trade. Review thesis and policy first.",
      })
    ).toBeTruthy();
  });

  it("run record and run id format", () => {
    const runId = makeRunId(new Date("2026-07-20T20:06:00Z"));
    expect(RunId.parse(runId)).toBe(runId);
    expect(
      RunRecord.parse({
        schemaVersion: 1,
        runId,
        trigger: "scheduled",
        task: "snapshot-capture",
        startedAt: "2026-07-20T20:06:00Z",
        finishedAt: "2026-07-20T20:06:04Z",
        inputVersions: { portfolio: "portfolio_20260720_001" },
        providerCalls: [{ provider: "yahoo", endpoint: "quote", ok: true, cached: false }],
        validationResults: [{ check: "quote-timestamps", ok: true }],
        outputs: ["data/snapshots.jsonl"],
        error: null,
        model: null,
      })
    ).toBeTruthy();
  });
});
