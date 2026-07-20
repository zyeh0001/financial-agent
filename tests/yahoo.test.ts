import { describe, expect, it } from "vitest";
import {
  normalizeYahooFxRate,
  normalizeYahooHistory,
  normalizeYahooQuote,
} from "@financial-agent/data-providers/yahoo";

describe("Yahoo provider validation", () => {
  it("rejects currencies outside the supported finance-core contract", () => {
    expect(() =>
      normalizeYahooQuote("VOO", {
        regularMarketPrice: 500,
        currency: "EUR",
        regularMarketTime: 1_774_214_400,
      })
    ).toThrow(/currency/);
  });

  it("rejects non-finite or non-positive prices", () => {
    expect(() =>
      normalizeYahooQuote("VOO", {
        regularMarketPrice: Number.NaN,
        currency: "USD",
        regularMarketTime: 1_774_214_400,
      })
    ).toThrow(/price/);
  });

  it("rejects invalid optional quote ranges and prior closes", () => {
    const valid = {
      regularMarketPrice: 500,
      currency: "USD",
      regularMarketTime: 1_774_214_400,
    };
    expect(() => normalizeYahooQuote("VOO", { ...valid, previousClose: -1 })).toThrow(/previous close/i);
    expect(() => normalizeYahooQuote("VOO", { ...valid, fiftyTwoWeekLow: 600, fiftyTwoWeekHigh: 550 })).toThrow(/52-week range/i);
    expect(() => normalizeYahooQuote("VOO", { ...valid, fiftyTwoWeekLow: Number.NaN })).toThrow(/52-week low/i);
  });

  it("rejects an FX response whose currency is not the requested target", () => {
    expect(() =>
      normalizeYahooFxRate("USD", "AUD", {
        regularMarketPrice: 1.5,
        currency: "USD",
        regularMarketTime: 1_774_214_400,
      })
    ).toThrow(/currency mismatch/);
  });

  it("normalizes timestamped OHLC history through the shared provider contract", () => {
    expect(
      normalizeYahooHistory("MSFT", {
        meta: { currency: "USD", regularMarketTime: 1_735_776_000 },
        timestamp: [1_735_689_600, 1_735_776_000],
        indicators: {
          quote: [{ open: [100, 102], high: [103, 105], low: [99, 101], close: [102, 104], volume: [10, 20] }],
        },
      })
    ).toEqual({
      symbol: "MSFT",
      currency: "USD",
      asOf: "2025-01-02T00:00:00.000Z",
      source: "yahoo",
      delayed: true,
      candles: [
        { time: "2025-01-01", open: 100, high: 103, low: 99, close: 102, volume: 10 },
        { time: "2025-01-02", open: 102, high: 105, low: 101, close: 104, volume: 20 },
      ],
    });
  });

  it("rejects internally inconsistent OHLC candles", () => {
    expect(() =>
      normalizeYahooHistory("MSFT", {
        meta: { currency: "USD", regularMarketTime: 1_735_776_000 },
        timestamp: [1_735_689_600],
        indicators: { quote: [{ open: [100], high: [99], low: [98], close: [101], volume: [10] }] },
      })
    ).toThrow(/inconsistent candle/i);
  });
});
