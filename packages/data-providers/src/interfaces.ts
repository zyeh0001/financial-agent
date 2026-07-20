import type { CurrencyCode } from "@financial-agent/finance-core";

/**
 * Provider interfaces (M0 contract — implementations arrive at their milestones:
 * market data M1/M4, filings M2, news M5).
 *
 * Contract requirements (ARCHITECTURE, PRD §7):
 * - Every result carries source, timestamp, currency/timezone context, and
 *   delayed/real-time status. Missing metadata is a hard fail upstream.
 * - Providers are stateless adapters; caching lives in the storage layer.
 * - Provider outputs are UNTRUSTED input (SECURITY §3) — validated before use.
 */

export interface ProviderQuote {
  symbol: string;
  price: number;
  currency: CurrencyCode;
  asOf: string; // ISO-8601 with offset
  source: string; // e.g. "yahoo", "finnhub"
  delayed: boolean;
  name?: string;
  changePct?: number | null;
  week52Low?: number | null;
  week52High?: number | null;
}

export interface ProviderCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ProviderHistory {
  symbol: string;
  currency: CurrencyCode;
  asOf: string;
  source: string;
  delayed: boolean;
  candles: ProviderCandle[];
}

export interface HistoryProvider {
  readonly name: string;
  getHistory(symbol: string, range: "1mo" | "3mo" | "6mo" | "1y"): Promise<ProviderHistory>;
}

export interface ProviderFundamentals {
  symbol: string;
  peTrailing: number | null;
  marketCap: number | null;
  marketCapCurrency: CurrencyCode | null;
  nextEarningsDate: string | null; // ISO date
  asOf: string;
  source: string;
}

export interface ProviderFxRate {
  pair: string; // e.g. "USDAUD"
  rate: number;
  asOf: string;
  source: string;
}

export interface MarketDataProvider {
  readonly name: string;
  getQuotes(symbols: string[]): Promise<ProviderQuote[]>;
  getFundamentals(symbols: string[]): Promise<ProviderFundamentals[]>;
}

export interface FxProvider {
  readonly name: string;
  getRate(from: CurrencyCode, to: CurrencyCode): Promise<ProviderFxRate>;
}

export interface FilingsProvider {
  readonly name: string;
  searchFilings(symbol: string, formTypes?: string[]): Promise<FilingRef[]>;
  getFiling(ref: FilingRef): Promise<string>;
}

export interface FilingRef {
  symbol: string;
  formType: string; // "10-K" | "10-Q" | "8-K" | ...
  filedAt: string;
  url: string;
  source: string;
}
