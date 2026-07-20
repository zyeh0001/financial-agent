import { CurrencyCode, type CurrencyCode as CurrencyCodeType } from "@financial-agent/finance-core";
import type { FxProvider, MarketDataProvider, ProviderFundamentals, ProviderFxRate, ProviderQuote } from "./interfaces.js";

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
}

async function fetchMeta(symbol: string): Promise<ChartMeta> {
  const res = await fetch(`${BASE}/${encodeURIComponent(symbol)}?interval=1d&range=1d`, {
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`yahoo ${symbol}: HTTP ${res.status}`);
  const body = (await res.json()) as {
    chart?: { result?: Array<{ meta?: ChartMeta }>; error?: { description?: string } | null };
  };
  const meta = body.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`yahoo ${symbol}: ${body.chart?.error?.description ?? "no result"}`);
  return meta;
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
  return {
    symbol,
    price: meta.regularMarketPrice,
    currency: currency.data,
    asOf: new Date(meta.regularMarketTime * 1000).toISOString(),
    source: "yahoo",
      delayed: true,
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

export class YahooProvider implements MarketDataProvider, FxProvider {
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
}
