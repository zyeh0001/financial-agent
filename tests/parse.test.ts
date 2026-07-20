import { describe, expect, it } from "vitest";
import {
  RiskLimits,
  assessHealth,
  ledgerFromState,
  parseCashSnapshot,
  parsePortfolioMd,
  parseWatchlistMd,
  valuePortfolio,
  TOLERANCES,
  type Quote,
} from "@financial-agent/finance-core";
import { parse as parseYaml } from "yaml";

/**
 * M1 exit criteria: given a known test portfolio (same shape as the real
 * portfolio.md, including unknown cost bases), the system produces correct
 * total value, weights, currency exposure, concentration flags, cost basis,
 * and unrealized P&L within tolerances.
 */

const SAMPLE_PORTFOLIO_MD = `---
title: "My Portfolio"
---

# My Portfolio

## Snapshot
- prose the parser must ignore | with | pipes

## Holdings (machine-readable)
Columns: **Ticker | Shares | Avg Cost | Type | Notes**.

| Ticker | Shares   | Avg Cost | Type  | Notes |
|--------|----------|----------|-------|-------|
| VOO    | 10       | 452.68   | ETF   | core S&P 500 |
| TSLA   | 9        | 241.28   | Stock | trimmed position |
| NOW    | 2        | —        | Stock | avg cost TBD |
| BTC-USD | 0.05    | —        | Crypto | cost basis TBD |

## Change log
- 2026-07-01 — something
`;

const SAMPLE_FINANCES_MD = `---
title: "Financial Plan"
---

## cash-snapshot
updated: 2026-07-01
emergency_fund: 10500
dry_powder: 0
brokerage_cash: 3637
exchange_cash: 588
currency: AUD
note: machine-readable block.

## Goal
- prose
`;

const SAMPLE_LIMITS_YAML = `
schemaVersion: 1
baseCurrency: AUD
targetAllocation: { etf: 0.50, cash: 0.30, individual: 0.15, crypto: 0.05 }
driftTolerance: 0.05
singleStockMax: 0.10
speculativeAllocationMax: 0.15
speculativeSymbols: [COIN, CRCL]
emergencyFundFloor: 15000
marginAllowed: false
noUndefinedRiskOptions: true
glidePathMonthsBeforePurchase: 12
`;

describe("portfolio.md parser", () => {
  it("parses the real table shape, including unknown cost bases", () => {
    const { positions, warnings } = parsePortfolioMd(SAMPLE_PORTFOLIO_MD);
    expect(positions).toHaveLength(4);

    const voo = positions.find((p) => p.symbol === "VOO")!;
    expect(voo).toMatchObject({ assetType: "etf", bucket: "etf", quantity: 10, averageCost: 452.68 });

    const now = positions.find((p) => p.symbol === "NOW")!;
    expect(now.averageCost).toBeNull();

    const btc = positions.find((p) => p.symbol === "BTC-USD")!;
    expect(btc).toMatchObject({ assetType: "crypto", bucket: "crypto", averageCost: null });

    expect(warnings.filter((w) => w.includes("cost basis unknown"))).toHaveLength(2);
  });

  it("throws on a file with no holdings section", () => {
    expect(() => parsePortfolioMd("# nothing here")).toThrow(/no `## Holdings`/);
  });

  it("rejects a malformed holding instead of producing a partial portfolio", () => {
    const malformed = SAMPLE_PORTFOLIO_MD.replace(
      "| TSLA   | 9        | 241.28   | Stock | trimmed position |",
      "| TSLA   | nine     | 241.28   | Stock | trimmed position |"
    );
    expect(() => parsePortfolioMd(malformed)).toThrow(/bad Shares.*TSLA/);
  });

  it("rejects a truncated holdings row instead of silently omitting it", () => {
    const malformed = SAMPLE_PORTFOLIO_MD.replace(
      "| VOO    | 10       | 452.68   | ETF   | core S&P 500 |",
      "| VOO | 10 | 452.68 |"
    );
    expect(() => parsePortfolioMd(malformed)).toThrow(/malformed holdings row/);
  });

  it("parses the cash-snapshot block", () => {
    const cash = parseCashSnapshot(SAMPLE_FINANCES_MD);
    expect(cash).toEqual({
      emergencyFund: 10500,
      dryPowder: 0,
      brokerageCash: 3637,
      exchangeCash: 588,
      currency: "AUD",
      updated: "2026-07-01",
    });
  });

  it("rejects an unsupported cash currency", () => {
    expect(() => parseCashSnapshot(SAMPLE_FINANCES_MD.replace("currency: AUD", "currency: EUR"))).toThrow(
      /currency/
    );
  });
});

describe("watchlist.md parser", () => {
  it("parses grouped watchlist tables into the shared domain shape", () => {
    const markdown = `# Watchlist

## Large Tech

| 代号 | 公司 | 板块 | 加入日期 | 关注理由 | 参考价(加入时) | 现价(上次查) | 合理买入价 | 来源 |
|---|---|---|---|---|---:|---:|---|---|
| MSFT | Microsoft | Software | 2026-07-01 | Durable cash flow | $500 | — | Below 450 | filing |
`;

    expect(parseWatchlistMd(markdown)).toEqual([
      {
        name: "Large Tech",
        items: [
          {
            symbol: "MSFT",
            name: "Microsoft",
            sector: "Software",
            dateAdded: "2026-07-01",
            reason: "Durable cash flow",
            referencePrice: 500,
            reasonableBuy: "Below 450",
            source: "filing",
          },
        ],
      },
    ]);
  });
});

describe("M1 known-test-portfolio valuation + health", () => {
  it("values parsed positions and flags policy breaches correctly", () => {
    const { positions } = parsePortfolioMd(SAMPLE_PORTFOLIO_MD);
    const cash = parseCashSnapshot(SAMPLE_FINANCES_MD);
    const limits = RiskLimits.parse(parseYaml(SAMPLE_LIMITS_YAML));

    const quotes: Record<string, Quote> = {
      VOO: { symbol: "VOO", price: 520, currency: "USD", asOf: "2026-07-20T20:00:00Z", source: "test" },
      TSLA: { symbol: "TSLA", price: 300, currency: "USD", asOf: "2026-07-20T20:00:00Z", source: "test" },
      NOW: { symbol: "NOW", price: 900, currency: "USD", asOf: "2026-07-20T20:00:00Z", source: "test" },
      "BTC-USD": { symbol: "BTC-USD", price: 60000, currency: "USD", asOf: "2026-07-20T20:00:00Z", source: "test" },
    };

    const totalCash = cash.emergencyFund + cash.dryPowder + cash.brokerageCash + cash.exchangeCash; // 14725 AUD
    const ledger = ledgerFromState({
      positions,
      cash: [{ currency: cash.currency, amount: totalCash }],
    });
    const valuation = valuePortfolio({
      ledger,
      quotes,
      fx: { USDAUD: 1.5 },
      fxTimestamp: "2026-07-20T20:00:00Z",
      valuationCurrency: "AUD",
      buckets: Object.fromEntries(positions.map((p) => [p.symbol, p.bucket])) as Record<
        string,
        "individual" | "etf" | "crypto"
      >,
      now: "2026-07-20T20:00:00Z",
      riskLimits: { singleStockMax: limits.singleStockMax },
    });

    // Hand-computed: VOO 10×520=5200 USD → 7800 AUD; TSLA 9×300=2700 → 4050;
    // NOW 2×900=1800 → 2700; BTC 0.05×60000=3000 → 4500; cash 14725.
    // Total = 7800+4050+2700+4500+14725 = 33775 AUD.
    expect(Math.abs(valuation.totalValue - 33775)).toBeLessThanOrEqual(TOLERANCES.money);

    const tsla = valuation.positions.find((p) => p.symbol === "TSLA")!;
    // weight 4050/33775 = 0.119911; unrealized 9×(300−241.28)=528.48 USD → 792.72 AUD
    expect(Math.abs(tsla.weight - 0.119911)).toBeLessThanOrEqual(TOLERANCES.weight);
    expect(Math.abs((tsla.unrealizedPnl ?? NaN) - 792.72)).toBeLessThanOrEqual(TOLERANCES.money);

    const now = valuation.positions.find((p) => p.symbol === "NOW")!;
    expect(now.unrealizedPnl).toBeNull(); // unknown basis → null, never guessed

    // TSLA 11.99% and NOW 7.99%: only TSLA breaches the 10% single-stock max.
    expect(valuation.concentrationFlags).toEqual(["TSLA"]);

    // currency exposure: USD = (7800+4050+2700+4500)/33775 = 19050/33775 = 0.563997
    expect(Math.abs((valuation.currencyExposure["USD"] ?? 0) - 0.563997)).toBeLessThanOrEqual(
      TOLERANCES.weight
    );
    expect(Math.abs((valuation.currencyExposure["AUD"] ?? 0) - 0.436003)).toBeLessThanOrEqual(
      TOLERANCES.weight
    );

    const health = assessHealth(valuation, limits, { emergencyFund: cash.emergencyFund });
    // EF 10500 < floor 15000 → breach + EF-first action.
    expect(health.policyBreaches.some((b) => b.includes("emergency fund"))).toBe(true);
    expect(health.suggestedActions[0]).toContain("emergency fund");
    // crypto bucket 4500/33775 ≈ 13.3% vs target 5% (drift 8.3pp > 5pp) → breach.
    expect(health.policyBreaches.some((b) => b.startsWith("crypto"))).toBe(true);
    // TSLA concentration surfaces in breaches.
    expect(health.policyBreaches.some((b) => b.includes("TSLA"))).toBe(true);
    // Unknown cost bases surface as data gaps.
    expect(health.dataGaps.filter((g) => g.includes("cost basis unknown"))).toHaveLength(2);
  });
});

describe("risk-limits.yaml", () => {
  it("parses and validates", () => {
    const limits = RiskLimits.parse(parseYaml(SAMPLE_LIMITS_YAML));
    expect(limits.emergencyFundFloor).toBe(15000);
  });

  it("rejects a target allocation that doesn't sum to 1", () => {
    const bad = parseYaml(SAMPLE_LIMITS_YAML.replace("etf: 0.50", "etf: 0.60"));
    expect(() => RiskLimits.parse(bad)).toThrow(/sum to 1/);
  });
});
