import { createHash } from "node:crypto";
import type { FilingsProvider, NewsProvider, ProviderNewsEvent } from "@financial-agent/data-providers";
import type { ResearchEvent } from "@financial-agent/finance-core";

const FILING_FORMS = ["10-K", "10-Q", "8-K", "6-K"];

function classifyNewsCategory(text: string): ResearchEvent["category"] {
  const value = text.toLowerCase();
  if (/earnings|results|quarter|annual report/.test(value)) return "earnings";
  if (/guidance|outlook|forecast/.test(value)) return "guidance";
  if (/buyback|dividend|capital allocation|acquisition|merger/.test(value)) return "capital-allocation";
  if (/regulat|lawsuit|investigation|antitrust/.test(value)) return "regulatory";
  return "other";
}

function newsEvent(item: ProviderNewsEvent, macroTopics: string[], from: string, to: string): ResearchEvent | null {
  if (item.publishedAt.slice(0, 10) < from || item.publishedAt.slice(0, 10) > to) return null;
  const text = `${item.headline} ${item.summary}`.toLowerCase();
  if (item.category === "general") {
    const matched = macroTopics.filter((topic) => text.includes(topic.toLowerCase()));
    if (matched.length === 0) return null;
    return { eventId: item.id, publishedAt: item.publishedAt, scope: "macro", symbols: [], macroTopics: matched,
      category: "macro", headline: item.headline, facts: item.summary, source: { publisher: item.publisher, url: item.url, rank: "secondary" } };
  }
  return { eventId: item.id, publishedAt: item.publishedAt, scope: "asset", symbols: item.symbols, macroTopics: [],
    category: classifyNewsCategory(`${item.headline} ${item.summary}`), headline: item.headline, facts: item.summary,
    source: { publisher: item.publisher, url: item.url, rank: "secondary" } };
}

export async function collectResearchEvents(input: {
  symbols: string[];
  from: string;
  to: string;
  macroTopics: string[];
  filingsProvider?: FilingsProvider;
  newsProvider?: NewsProvider;
}) {
  const events: ResearchEvent[] = [];
  const failures: string[] = [];
  const providerCalls: Array<{ provider: string; endpoint: string; ok: boolean; cached: boolean }> = [];
  for (const symbol of [...new Set(input.symbols)]) {
    if (input.filingsProvider && !symbol.includes("-") && !symbol.includes("=")) {
      try {
        const filings = await input.filingsProvider.searchFilings(symbol, FILING_FORMS);
        for (const filing of filings.filter((item) => item.filedAt.slice(0, 10) >= input.from && item.filedAt.slice(0, 10) <= input.to)) {
          events.push({ eventId: `sec:${createHash("sha256").update(filing.url).digest("hex").slice(0, 20)}`, publishedAt: filing.filedAt,
            scope: "asset", symbols: [symbol], macroTopics: [], category: "filing", headline: `${symbol} filed ${filing.formType}`,
            facts: `${symbol} filed form ${filing.formType} with the SEC.`, source: { publisher: "SEC EDGAR", url: filing.url, rank: "original" } });
        }
        providerCalls.push({ provider: input.filingsProvider.name, endpoint: `filings/${symbol}`, ok: true, cached: false });
      } catch (error: unknown) {
        providerCalls.push({ provider: input.filingsProvider.name, endpoint: `filings/${symbol}`, ok: false, cached: false });
        failures.push(`${symbol} filings: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (input.newsProvider) {
      try {
        const news = await input.newsProvider.getCompanyNews(symbol, input.from, input.to);
        events.push(...news.map((item) => newsEvent(item, input.macroTopics, input.from, input.to)).filter((item): item is ResearchEvent => item !== null));
        providerCalls.push({ provider: input.newsProvider.name, endpoint: `company-news/${symbol}`, ok: true, cached: false });
      } catch (error: unknown) {
        providerCalls.push({ provider: input.newsProvider.name, endpoint: `company-news/${symbol}`, ok: false, cached: false });
        failures.push(`${symbol} news: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (input.newsProvider) {
    try {
      const general = await input.newsProvider.getGeneralNews();
      events.push(...general.map((item) => newsEvent(item, input.macroTopics, input.from, input.to)).filter((item): item is ResearchEvent => item !== null));
      providerCalls.push({ provider: input.newsProvider.name, endpoint: "general-news", ok: true, cached: false });
    } catch (error: unknown) {
      providerCalls.push({ provider: input.newsProvider.name, endpoint: "general-news", ok: false, cached: false });
      failures.push(`general news: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { events, failures, providerCalls };
}
