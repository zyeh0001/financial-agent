import { describe, expect, it } from "vitest";
import type { MarketDataProvider } from "@financial-agent/data-providers";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRuleObservations, runMonitoringCycle } from "../scripts/lib/monitor-cycle.js";

describe("monitor provider collection", () => {
  it("isolates a provider failure to the affected symbol", async () => {
    const provider: MarketDataProvider = {
      name: "test-feed",
      async getQuotes(symbols) {
        const symbol = symbols[0]!;
        if (symbol === "BROKEN") throw new Error("feed unavailable");
        return [{ symbol, price: 42, currency: "USD", asOf: "2026-07-20T20:05:00Z", source: "test-feed", delayed: true }];
      },
      async getFundamentals() { return []; },
    };
    const rules = ["GOOD", "BROKEN"].map((symbol) => ({
      id: `${symbol.toLowerCase()}-watch`, schemaVersion: 1 as const, status: "active" as const, symbol,
      condition: { all: [{ field: "price" as const, operator: "lt" as const, value: 50, currency: "USD" as const }] },
      notification: { severity: "attention" as const, messageTemplate: "watch" },
    }));

    const result = await collectRuleObservations({ rules, provider, now: new Date("2026-07-20T20:06:00Z") });

    expect(result.observations.GOOD?.price).toMatchObject({ value: 42, source: "test-feed", stale: false });
    expect(result.observations.BROKEN).toBeUndefined();
    expect(result.providerCalls).toEqual([
      { provider: "test-feed", endpoint: "quote/GOOD", ok: true, cached: false },
      { provider: "test-feed", endpoint: "quote/BROKEN", ok: false, cached: false },
    ]);
    expect(result.failures).toEqual(["BROKEN quote: feed unavailable"]);
  });

  it("persists and notifies a matching rule only once per dedup window", async () => {
    const provider: MarketDataProvider = {
      name: "test-feed",
      async getQuotes([symbol]) { return [{ symbol: symbol!, price: 42, currency: "USD", asOf: "2026-07-20T20:05:00Z", source: "test-feed", delayed: true }]; },
      async getFundamentals() { return []; },
    };
    const rules = [{
      id: "good-watch", schemaVersion: 1 as const, status: "active" as const, symbol: "GOOD",
      condition: { all: [{ field: "price" as const, operator: "lt" as const, value: 50, currency: "USD" as const }] },
      notification: { severity: "attention" as const, messageTemplate: "watch" },
    }];
    const sent: string[] = [];
    const adapter = { name: "test", async send(event: { eventId: string }) { sent.push(event.eventId); } };
    const alertLogPath = join(mkdtempSync(join(tmpdir(), "fa-cycle-")), "alerts.jsonl");

    const first = await runMonitoringCycle({ rules, provider, adapter, alertLogPath,
      runId: "run_20260720T200600Z_a3f1", now: new Date("2026-07-20T20:06:00Z"), dedupWindowMs: 3_600_000 });
    const second = await runMonitoringCycle({ rules, provider, adapter, alertLogPath,
      runId: "run_20260720T203000Z_b4c2", now: new Date("2026-07-20T20:30:00Z"), dedupWindowMs: 3_600_000 });

    expect(first).toMatchObject({ matched: 1, created: 1, delivered: 1, deliveryFailures: [] });
    expect(second).toMatchObject({ matched: 1, created: 0, delivered: 0, deliveryFailures: [] });
    expect(sent).toHaveLength(1);
  });
});
