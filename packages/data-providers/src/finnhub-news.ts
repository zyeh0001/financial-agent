import { z } from "zod";
import type { NewsProvider, ProviderNewsEvent } from "./interfaces.js";

const NewsItem = z.object({
  id: z.union([z.number().int(), z.string().min(1)]),
  datetime: z.number().int().positive(),
  headline: z.string().min(1),
  summary: z.string().default(""),
  source: z.string().min(1),
  url: z.string().url(),
  related: z.string().default(""),
}).passthrough();

export class FinnhubNewsProvider implements NewsProvider {
  readonly name = "finnhub";
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { apiKey: string; fetchImpl?: typeof fetch }) {
    if (!options.apiKey.trim() || /[\r\n]/.test(options.apiKey)) throw new Error("Finnhub API key is required");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async request(path: string, params: URLSearchParams, category: "company" | "general"): Promise<ProviderNewsEvent[]> {
    params.set("token", this.apiKey);
    const response = await this.fetchImpl(`https://finnhub.io/api/v1${path}?${params}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Finnhub news request failed (${response.status} ${response.statusText})`);
    return z.array(NewsItem).parse(await response.json()).map((item) => ({
      id: `finnhub:${item.id}`,
      publishedAt: new Date(item.datetime * 1_000).toISOString(),
      headline: item.headline,
      summary: item.summary || item.headline,
      publisher: item.source,
      url: item.url,
      symbols: item.related.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
      category,
    }));
  }

  async getCompanyNews(symbol: string, from: string, to: string) {
    const normalized = symbol.trim().toUpperCase();
    const events = await this.request("/company-news", new URLSearchParams({ symbol: normalized, from, to }), "company");
    return events.map((event) => ({ ...event, symbols: event.symbols.includes(normalized) ? event.symbols : [normalized, ...event.symbols] }));
  }

  getGeneralNews() {
    return this.request("/news", new URLSearchParams({ category: "general" }), "general");
  }
}
