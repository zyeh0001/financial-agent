import { CurrencyCode, type CurrencyCode as CurrencyCodeType } from "@financial-agent/finance-core";
import type {
  FxProvider,
  HistoryProvider,
  MarketDataProvider,
  ProviderFundamentals,
  ProviderFxRate,
  ProviderHistory,
  ProviderQuote,
} from "./interfaces.js";

/**
 * Yahoo Finance provider (free chart endpoint — same source the dashboard and
 * skill already use). Every result carries source + timestamp + currency;
 * a response missing any of these is a hard fail, not a silent default.
 * Fundamentals are not served by this endpoint → explicit nulls (M2 adds Finnhub).
 */

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const HEADERS = { "User-Agent": "Mozilla/5.0 (personal portfolio tool)" };

interface ChartMeta {
  regularMarketPrice?: number;
  currency?: string;
  regularMarketTime?: number; // epoch seconds
  longName?: string;
  shortName?: string;
  chartPreviousClose?: number;
  previousClose?: number;
  fiftyTwoWeekLow?: number;
  fiftyTwoWeekHigh?: number;
}

interface YahooChartResult {
  meta?: ChartMeta;
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
}

async function fetchChart(symbol: string, range: string): Promise<YahooChartResult> {
  const res = await fetch(`${BASE}/${encodeURIComponent(symbol)}?interval=1d&range=${range}`, {
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`yahoo ${symbol}: HTTP ${res.status}`);
  const body = (await res.json()) as {
    chart?: { result?: YahooChartResult[]; error?: { description?: string } | null };
  };
  const result = body.chart?.result?.[0];
  if (!result?.meta) throw new Error(`yahoo ${symbol}: ${body.chart?.error?.description ?? "no result"}`);
  return result;
}

async function fetchMeta(symbol: string): Promise<ChartMeta> {
  return (await fetchChart(symbol, "1d")).meta!;
}

export function normalizeYahooQuote(symbol: string, meta: ChartMeta): ProviderQuote {
  if (meta.regularMarketPrice === undefined || !meta.currency || meta.regularMarketTime === undefined) {
    throw new Error(`yahoo ${symbol}: response missing price/currency/timestamp — refusing partial data`);
  }
  if (!Number.isFinite(meta.regularMarketPrice) || meta.regularMarketPrice <= 0) {
    throw new Error(`yahoo ${symbol}: invalid price`);
  }
  if (!Number.isFinite(meta.regularMarketTime) || meta.regularMarketTime <= 0) {
    throw new Error(`yahoo ${symbol}: invalid timestamp`);
  }
  const currency = CurrencyCode.safeParse(meta.currency);
  if (!currency.success) throw new Error(`yahoo ${symbol}: unsupported currency "${meta.currency}"`);
  const previousClose = meta.chartPreviousClose ?? meta.previousClose;
  if (previousClose !== undefined && (!Number.isFinite(previousClose) || previousClose <= 0)) {
    throw new Error(`yahoo ${symbol}: invalid previous close`);
  }
  if (meta.fiftyTwoWeekLow !== undefined && (!Number.isFinite(meta.fiftyTwoWeekLow) || meta.fiftyTwoWeekLow <= 0)) {
    throw new Error(`yahoo ${symbol}: invalid 52-week low`);
  }
  if (meta.fiftyTwoWeekHigh !== undefined && (!Number.isFinite(meta.fiftyTwoWeekHigh) || meta.fiftyTwoWeekHigh <= 0)) {
    throw new Error(`yahoo ${symbol}: invalid 52-week high`);
  }
  if (
    meta.fiftyTwoWeekLow !== undefined &&
    meta.fiftyTwoWeekHigh !== undefined &&
    meta.fiftyTwoWeekLow > meta.fiftyTwoWeekHigh
  ) {
    throw new Error(`yahoo ${symbol}: invalid 52-week range`);
  }
  return {
    symbol,
    price: meta.regularMarketPrice,
    currency: currency.data,
    asOf: new Date(meta.regularMarketTime * 1000).toISOString(),
    source: "yahoo",
    delayed: true,
    ...(meta.longName || meta.shortName ? { name: meta.longName ?? meta.shortName } : {}),
    changePct: previousClose === undefined ? null : ((meta.regularMarketPrice - previousClose) / previousClose) * 100,
    week52Low: meta.fiftyTwoWeekLow ?? null,
    week52High: meta.fiftyTwoWeekHigh ?? null,
  };
}

export function normalizeYahooHistory(symbol: string, result: YahooChartResult): ProviderHistory {
  const meta = result.meta;
  if (!meta?.currency || meta.regularMarketTime === undefined) {
    throw new Error(`yahoo ${symbol}: history missing currency/timestamp`);
  }
  const currency = CurrencyCode.safeParse(meta.currency);
  if (!currency.success) throw new Error(`yahoo ${symbol}: unsupported currency "${meta.currency}"`);
  if (!Number.isFinite(meta.regularMarketTime) || meta.regularMarketTime <= 0) {
    throw new Error(`yahoo ${symbol}: history has invalid timestamp`);
  }
  const quote = result.indicators?.quote?.[0];
  const timestamps = result.timestamp ?? [];
  if (!quote || timestamps.length === 0) throw new Error(`yahoo ${symbol}: history has no candles`);
  const candles = timestamps.flatMap((timestamp, index) => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    if ([open, high, low, close].some((value) => value === null || value === undefined)) return [];
    if (![open, high, low, close].every((value) => Number.isFinite(value) && value! > 0)) {
      throw new Error(`yahoo ${symbol}: invalid candle at index ${index}`);
    }
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      throw new Error(`yahoo ${symbol}: invalid candle timestamp at index ${index}`);
    }
    if (low! > Math.min(open!, close!) || high! < Math.max(open!, close!) || low! > high!) {
      throw new Error(`yahoo ${symbol}: inconsistent candle at index ${index}`);
    }
    const volume = quote.volume?.[index] ?? 0;
    if (!Number.isFinite(volume) || volume < 0) throw new Error(`yahoo ${symbol}: invalid volume at index ${index}`);
    return [{
      time: new Date(timestamp * 1_000).toISOString().slice(0, 10),
      open: open!,
      high: high!,
      low: low!,
      close: close!,
      volume,
    }];
  });
  if (candles.length === 0) throw new Error(`yahoo ${symbol}: history has no complete candles`);
  return {
    symbol,
    currency: currency.data,
    asOf: new Date(meta.regularMarketTime * 1_000).toISOString(),
    source: "yahoo",
    delayed: true,
    candles,
  };
}

export function normalizeYahooFxRate(
  from: CurrencyCodeType,
  to: CurrencyCodeType,
  meta: ChartMeta
): ProviderFxRate {
  const symbol = `${from}${to}=X`;
  const quote = normalizeYahooQuote(symbol, meta);
  if (quote.currency !== to) {
    throw new Error(
      `yahoo ${symbol}: currency mismatch; requested target ${to}, received ${quote.currency}`
    );
  }
  return { pair: `${from}${to}`, rate: quote.price, asOf: quote.asOf, source: "yahoo" };
}

export class YahooProvider implements MarketDataProvider, FxProvider, HistoryProvider {
  readonly name = "yahoo";

  async getQuotes(symbols: string[]): Promise<ProviderQuote[]> {
    const results: ProviderQuote[] = [];
    for (const symbol of symbols) {
      results.push(normalizeYahooQuote(symbol, await fetchMeta(symbol)));
      await new Promise((r) => setTimeout(r, 150)); // stay polite, avoid 429s
    }
    return results;
  }

  async getFundamentals(symbols: string[]): Promise<ProviderFundamentals[]> {
    // Chart endpoint has no fundamentals; explicit nulls, never invented values.
    const now = new Date().toISOString();
    return symbols.map((symbol) => ({
      symbol,
      peTrailing: null,
      marketCap: null,
      marketCapCurrency: null,
      nextEarningsDate: null,
      asOf: now,
      source: "yahoo(none)",
    }));
  }

  async getRate(from: CurrencyCodeType, to: CurrencyCodeType): Promise<ProviderFxRate> {
    const symbol = `${from}${to}=X`;
    const meta = await fetchMeta(symbol);
    return normalizeYahooFxRate(from, to, meta);
  }

  async getHistory(symbol: string, range: "1mo" | "3mo" | "6mo" | "1y"): Promise<ProviderHistory> {
    return normalizeYahooHistory(symbol, await fetchChart(symbol, range));
  }
}
