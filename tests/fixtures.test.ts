import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  AnyTransaction,
  TOLERANCES,
  processTransactions,
  valuePortfolio,
  type Quote,
  type Valuation,
} from "@financial-agent/finance-core";
import { z } from "zod";

/**
 * Golden fixtures (ROADMAP M0): known inputs → hand-computed expected outputs,
 * compared within the documented tolerances (money ±0.01, weights ±0.0001).
 */

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

const Fixture = z.object({
  name: z.string(),
  description: z.string(),
  valuationCurrency: z.enum(["AUD", "USD"]),
  now: z.string(),
  fx: z.record(z.string(), z.number()),
  fxTimestamp: z.string(),
  buckets: z.record(z.string(), z.enum(["individual", "etf", "crypto"])),
  transactions: z.array(z.unknown()),
  quotes: z.record(z.string(), z.unknown()),
  expected: z.object({
    totalValue: z.number(),
    cash: z.record(z.string(), z.number()),
    positions: z.array(
      z.object({
        symbol: z.string(),
        quantity: z.number(),
        value: z.number(),
        weight: z.number(),
        unrealizedPnl: z.number(),
        stale: z.boolean(),
      })
    ),
    bucketWeights: z.record(z.string(), z.number()),
    currencyExposure: z.record(z.string(), z.number()),
    realizedPnl: z.number(),
    dividends: z.number(),
    staleQuotes: z.array(z.string()),
    concentrationFlags: z.array(z.string()),
  }),
});

function loadFixtures() {
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, e.name, "fixture.json"), "utf8"));
      return Fixture.parse(raw);
    });
}

function expectClose(actual: number, expected: number, tolerance: number, label: string) {
  expect(Math.abs(actual - expected), `${label}: got ${actual}, expected ${expected}`).toBeLessThanOrEqual(
    tolerance
  );
}

describe("golden fixtures", () => {
  for (const fixture of loadFixtures()) {
    it(fixture.name, () => {
      // Inputs are validated through the real schemas — a fixture with a bad
      // transaction shape fails here, not deep inside the engine.
      const transactions = fixture.transactions.map((t) => AnyTransaction.parse(t));
      const ledger = processTransactions(transactions);
      const valuation: Valuation = valuePortfolio({
        ledger,
        quotes: fixture.quotes as Record<string, Quote>,
        fx: fixture.fx,
        fxTimestamp: fixture.fxTimestamp,
        valuationCurrency: fixture.valuationCurrency,
        buckets: fixture.buckets,
        now: fixture.now,
      });

      const exp = fixture.expected;
      expectClose(valuation.totalValue, exp.totalValue, TOLERANCES.money, "totalValue");
      expectClose(valuation.realizedPnl, exp.realizedPnl, TOLERANCES.money, "realizedPnl");
      expectClose(valuation.dividends, exp.dividends, TOLERANCES.money, "dividends");

      expect(Object.keys(valuation.cash).sort()).toEqual(Object.keys(exp.cash).sort());
      for (const [currency, amount] of Object.entries(exp.cash)) {
        expectClose(valuation.cash[currency]!, amount, TOLERANCES.money, `cash.${currency}`);
      }

      expect(valuation.positions.map((p) => p.symbol).sort()).toEqual(
        exp.positions.map((p) => p.symbol).sort()
      );
      for (const expectedPos of exp.positions) {
        const actual = valuation.positions.find((p) => p.symbol === expectedPos.symbol)!;
        expect(actual.quantity).toBe(expectedPos.quantity);
        expect(actual.stale, `${expectedPos.symbol}.stale`).toBe(expectedPos.stale);
        expectClose(actual.value, expectedPos.value, TOLERANCES.money, `${expectedPos.symbol}.value`);
        expectClose(actual.weight, expectedPos.weight, TOLERANCES.weight, `${expectedPos.symbol}.weight`);
        expectClose(
          actual.unrealizedPnl,
          expectedPos.unrealizedPnl,
          TOLERANCES.money,
          `${expectedPos.symbol}.unrealizedPnl`
        );
      }

      for (const [bucket, weight] of Object.entries(exp.bucketWeights)) {
        expectClose(valuation.bucketWeights[bucket] ?? 0, weight, TOLERANCES.weight, `bucket.${bucket}`);
      }
      for (const [currency, weight] of Object.entries(exp.currencyExposure)) {
        expectClose(
          valuation.currencyExposure[currency] ?? 0,
          weight,
          TOLERANCES.weight,
          `exposure.${currency}`
        );
      }

      expect(valuation.staleQuotes).toEqual(exp.staleQuotes);
      expect(valuation.concentrationFlags).toEqual(exp.concentrationFlags);

      // Internal consistency: weights must sum to 1.
      const bucketSum = Object.values(valuation.bucketWeights).reduce((a, b) => a + b, 0);
      expectClose(bucketSum, 1, TOLERANCES.weight, "bucketWeights sum");
      const exposureSum = Object.values(valuation.currencyExposure).reduce((a, b) => a + b, 0);
      expectClose(exposureSum, 1, TOLERANCES.weight, "currencyExposure sum");
    });
  }
});
