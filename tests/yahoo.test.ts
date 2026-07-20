import { describe, expect, it } from "vitest";
import { normalizeYahooFxRate, normalizeYahooQuote } from "@financial-agent/data-providers/yahoo";

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

  it("rejects an FX response whose currency is not the requested target", () => {
    expect(() =>
      normalizeYahooFxRate("USD", "AUD", {
        regularMarketPrice: 1.5,
        currency: "USD",
        regularMarketTime: 1_774_214_400,
      })
    ).toThrow(/currency mismatch/);
  });
});
