import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DcfValuationInput,
  OptionPayoffInput,
  runDcfValuation,
  runOptionPayoff,
} from "@financial-agent/finance-core";

describe("research calculations", () => {
  it("records a reproducible two-stage DCF valuation", () => {
    const record = runDcfValuation({
      runId: "run_20260720T030000Z_a3f1",
      generatedAt: "2026-07-20T03:00:00Z",
      input: {
        schemaVersion: 1,
        symbol: "EXAMPLE",
        currency: "USD",
        dataAsOf: "2026-07-19T00:00:00Z",
        freeCashFlow: {
          value: 100,
          currency: "USD",
          asOf: "2026-07-19T00:00:00Z",
          source: "worked example",
        },
        netDebt: {
          value: 0,
          currency: "USD",
          asOf: "2026-07-19T00:00:00Z",
          source: "worked example",
        },
        sharesOutstanding: {
          value: 10,
          asOf: "2026-07-19T00:00:00Z",
          source: "worked example",
        },
        forecastYears: 1,
        scenarios: {
          bear: { growthRate: 0, terminalGrowthRate: 0, discountRate: 0.1 },
          base: { growthRate: 0, terminalGrowthRate: 0, discountRate: 0.1 },
          bull: { growthRate: 0, terminalGrowthRate: 0, discountRate: 0.1 },
        },
        sensitivity: { discountRates: [0.1], terminalGrowthRates: [0] },
      },
    });

    expect(record.result.scenarios.base.impliedValuePerShare).toBeCloseTo(100, 10);
    expect(record.result.sensitivity).toEqual([
      { discountRate: 0.1, terminalGrowthRate: 0, impliedValuePerShare: 100 },
    ]);
    expect(record.runId).toBe("run_20260720T030000Z_a3f1");
    expect(record.inputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("calculates a covered-call payoff using the contract multiplier", () => {
    const record = runOptionPayoff({
      runId: "run_20260720T031000Z_b4c2",
      generatedAt: "2026-07-20T03:10:00Z",
      input: {
        schemaVersion: 1,
        strategy: "coveredCall",
        symbol: "EXAMPLE",
        currency: "USD",
        dataAsOf: "2026-07-19T00:00:00Z",
        underlyingPrice: {
          value: 100,
          currency: "USD",
          asOf: "2026-07-19T00:00:00Z",
          source: "worked example",
        },
        strike: 110,
        premiumPerShare: 5,
        contracts: 1,
        contractMultiplier: 100,
        daysToExpiry: 365,
        expiryPrices: [90, 110, 120],
      },
    });

    expect(record.result).toMatchObject({
      netPremium: 500,
      breakEven: 95,
      maxProfit: 1500,
      maxLoss: 9500,
      annualizedPremiumYield: 0.05,
      payoffAtExpiry: [
        { underlyingPrice: 90, profit: -500 },
        { underlyingPrice: 110, profit: 1500 },
        { underlyingPrice: 120, profit: 1500 },
      ],
    });
  });

  it("calculates a long-call payoff without inventing capped upside", () => {
    const record = runOptionPayoff({
      runId: "run_20260720T032000Z_c5d3",
      generatedAt: "2026-07-20T03:20:00Z",
      input: {
        schemaVersion: 1,
        strategy: "longCall",
        symbol: "EXAMPLE",
        currency: "USD",
        dataAsOf: "2026-07-19T00:00:00Z",
        underlyingPrice: {
          value: 100,
          currency: "USD",
          asOf: "2026-07-19T00:00:00Z",
          source: "worked example",
        },
        strike: 110,
        premiumPerShare: 5,
        contracts: 1,
        contractMultiplier: 100,
        daysToExpiry: 365,
        expiryPrices: [90, 115, 130],
      },
    });

    expect(record.result).toMatchObject({
      netPremium: -500,
      breakEven: 115,
      maxProfit: null,
      maxLoss: 500,
      annualizedPremiumYield: null,
      payoffAtExpiry: [
        { underlyingPrice: 90, profit: -500 },
        { underlyingPrice: 115, profit: 0 },
        { underlyingPrice: 130, profit: 1500 },
      ],
    });
  });

  it("keeps the reusable calculation input templates schema-valid", () => {
    const valuation = JSON.parse(readFileSync("templates/valuation-input.json", "utf8"));
    const options = JSON.parse(readFileSync("templates/options-payoff-input.json", "utf8"));

    expect(DcfValuationInput.parse(valuation).symbol).toBe("EXAMPLE");
    expect(OptionPayoffInput.parse(options).strategy).toBe("coveredCall");
  });

  it("rejects a covered-call premium that would produce a nonsensical negative max loss", () => {
    const options = JSON.parse(readFileSync("templates/options-payoff-input.json", "utf8"));
    options.premiumPerShare = 101;
    expect(OptionPayoffInput.safeParse(options).success).toBe(false);
  });
});
