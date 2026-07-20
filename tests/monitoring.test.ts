import { describe, expect, it } from "vitest";
import { evaluateAlertRules } from "@financial-agent/finance-core";

describe("monitoring rule evaluation", () => {
  it("emits a sourced observation when an active price rule matches", () => {
    const alerts = evaluateAlertRules({
      rules: [{
        id: "avgo-entry-watch",
        schemaVersion: 1,
        status: "active",
        symbol: "AVGO",
        condition: { all: [{ field: "price", operator: "lt", value: 300, currency: "USD" }] },
        notification: { severity: "attention", messageTemplate: "entry-watch" },
      }],
      observations: {
        AVGO: {
          price: {
            value: 297.4,
            currency: "USD",
            observedAt: "2026-07-20T20:05:00Z",
            source: "yahoo",
            stale: false,
          },
        },
      },
      runId: "run_20260720T200600Z_a3f1",
      generatedAt: "2026-07-20T20:06:00Z",
    });

    expect(alerts).toEqual([expect.objectContaining({
      reportType: "monitorAlert",
      ruleId: "avgo-entry-watch",
      symbol: "AVGO",
      condition: "price lt 300 USD",
      observedValue: 297.4,
      threshold: 300,
      currency: "USD",
      observedAt: "2026-07-20T20:05:00Z",
      dataAsOf: "2026-07-20T20:05:00Z",
      sources: ["yahoo"],
      stale: false,
      severity: "attention",
      guidance: expect.stringMatching(/observation, not an instruction/i),
    })]);
  });

  it("requires every all-condition, accepts one any-condition, and ignores paused rules", () => {
    const base = {
      schemaVersion: 1 as const,
      symbol: "AVGO",
      notification: { severity: "informational" as const, messageTemplate: "watch" },
    };
    const alerts = evaluateAlertRules({
      rules: [
        { ...base, id: "all-miss", status: "active", condition: { all: [
          { field: "price", operator: "lt", value: 300, currency: "USD" },
          { field: "pe", operator: "lt", value: 30 },
        ] } },
        { ...base, id: "any-hit", status: "active", condition: { any: [
          { field: "price", operator: "lt", value: 300, currency: "USD" },
          { field: "pe", operator: "lt", value: 30 },
        ] } },
        { ...base, id: "paused-hit", status: "paused", condition: { all: [
          { field: "price", operator: "lt", value: 300, currency: "USD" },
        ] } },
      ],
      observations: { AVGO: {
        price: { value: 297, currency: "USD", observedAt: "2026-07-20T20:05:00Z", source: "yahoo", stale: false },
        pe: { value: 35, observedAt: "2026-07-20T20:04:00Z", source: "fundamentals", stale: true },
      } },
      runId: "run_20260720T200600Z_a3f1",
      generatedAt: "2026-07-20T20:06:00Z",
    });

    expect(alerts.map((alert) => alert.ruleId)).toEqual(["any-hit"]);
    expect(alerts[0]).toMatchObject({ dataAsOf: "2026-07-20T20:04:00Z", stale: true });
  });

  it("fails closed on a price currency mismatch", () => {
    expect(() => evaluateAlertRules({
      rules: [{
        id: "currency-guard", schemaVersion: 1, status: "active", symbol: "AVGO",
        condition: { all: [{ field: "price", operator: "lt", value: 300, currency: "USD" }] },
        notification: { severity: "attention", messageTemplate: "watch" },
      }],
      observations: { AVGO: {
        price: { value: 297, currency: "AUD", observedAt: "2026-07-20T20:05:00Z", source: "bad-feed", stale: false },
      } },
      runId: "run_20260720T200600Z_a3f1",
      generatedAt: "2026-07-20T20:06:00Z",
    })).toThrow(/currency mismatch/);
  });

  it("fires an any-rule when an available branch matches and another branch is unavailable", () => {
    const alerts = evaluateAlertRules({
      rules: [{
        id: "mixed-source-watch", schemaVersion: 1, status: "active", symbol: "AVGO",
        condition: { any: [
          { field: "price", operator: "lt", value: 300, currency: "USD" },
          { field: "pe", operator: "lt", value: 40 },
        ] },
        notification: { severity: "attention", messageTemplate: "watch" },
      }],
      observations: { AVGO: {
        price: { value: 297, currency: "USD", observedAt: "2026-07-20T20:05:00Z", source: "yahoo", stale: false },
      } },
      runId: "run_20260720T200600Z_a3f1",
      generatedAt: "2026-07-20T20:06:00Z",
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.condition).toBe("price lt 300 USD OR pe lt 40");
  });
});
