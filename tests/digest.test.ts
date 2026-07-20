import { describe, expect, it, vi } from "vitest";
import { buildDigestCandidate, runDigestCycle } from "@financial-agent/finance-core";

describe("research digest candidate", () => {
  it("keeps only unseen held/watched events and ranks original sources first", () => {
    const result = buildDigestCandidate({
      events: [
        { eventId: "news-1", publishedAt: "2026-07-20T10:00:00Z", scope: "asset", symbols: ["NVDA"], macroTopics: [], category: "other", headline: "NVDA commentary", facts: "Secondary commentary.", source: { publisher: "News Wire", url: "https://news.example/nvda", rank: "secondary" } },
        { eventId: "filing-1", publishedAt: "2026-07-20T11:00:00Z", scope: "asset", symbols: ["NVDA"], macroTopics: [], category: "filing", headline: "NVDA files 8-K", facts: "The company filed an 8-K.", source: { publisher: "SEC EDGAR", url: "https://www.sec.gov/Archives/edgar/data/1/2/a.htm", rank: "original" } },
        { eventId: "other-1", publishedAt: "2026-07-20T12:00:00Z", scope: "asset", symbols: ["TSLA"], macroTopics: [], category: "earnings", headline: "TSLA reports", facts: "Quarterly results.", source: { publisher: "TSLA", url: "https://example.com/tsla", rank: "original" } },
      ],
      heldSymbols: ["NVDA"],
      watchedSymbols: ["MSFT"],
      macroTopics: ["rba", "aud"],
      seenEventIds: [],
    });

    expect(result.events.map((event) => event.eventId)).toEqual(["filing-1", "news-1"]);
    expect(result.events[0]).toMatchObject({ thesisImpact: "review-required", holdingsAffected: ["NVDA"] });
    expect(result.excluded).toEqual([{ eventId: "other-1", reason: "outside-universe" }]);
  });

  it("produces a no-action digest without calling the optional summarizer when nothing is relevant", async () => {
    const summarize = vi.fn();
    const result = await runDigestCycle({
      events: [{ eventId: "other-1", publishedAt: "2026-07-20T12:00:00Z", scope: "asset", symbols: ["TSLA"], macroTopics: [], category: "earnings", headline: "TSLA reports", facts: "Quarterly results.", source: { publisher: "TSLA", url: "https://example.com/tsla", rank: "original" } }],
      heldSymbols: ["NVDA"], watchedSymbols: [], macroTopics: ["rba"], seenEventIds: [],
      runId: "run_20260720T200600Z_a3f1", generatedAt: "2026-07-20T20:06:00Z", cadence: "daily",
      budget: { maxEvents: 5, maxInputChars: 5_000, maxOutputChars: 1_000 },
      summarizer: { summarize },
    });

    expect(summarize).not.toHaveBeenCalled();
    expect(result).toMatchObject({ llmCalled: false, model: null });
    expect(result.report).toMatchObject({ schemaVersion: 2, events: [], summary: null, noActionNeeded: true });
  });

  it("keeps sourced facts separate from budgeted interpretation", async () => {
    const summarize = vi.fn().mockResolvedValue({ claims: [{ text: "NVDA filed an 8-K.", eventIds: ["filing-1"] }], interpretations: { "filing-1": "Review whether guidance changed." }, model: "test-model", usage: { inputChars: 450, inputTokens: 100, outputTokens: 20 } });
    const result = await runDigestCycle({
      events: [{ eventId: "filing-1", publishedAt: "2026-07-20T11:00:00Z", scope: "asset", symbols: ["NVDA"], macroTopics: [], category: "filing", headline: "NVDA files 8-K", facts: "The company filed an 8-K.", source: { publisher: "SEC EDGAR", url: "https://www.sec.gov/Archives/edgar/data/1/2/a.htm", rank: "original" } }],
      heldSymbols: ["NVDA"], watchedSymbols: [], macroTopics: ["rba"], seenEventIds: [],
      runId: "run_20260720T200600Z_a3f1", generatedAt: "2026-07-20T20:06:00Z", cadence: "daily",
      budget: { maxEvents: 1, maxInputChars: 5_000, maxOutputChars: 200 }, maxTokens: 100, summarizer: { summarize },
    });
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(result.report.events[0]).toMatchObject({ facts: "The company filed an 8-K.", interpretation: "Review whether guidance changed." });
    expect(result.report).toMatchObject({ summary: "NVDA filed an 8-K.", summaryClaims: [{ eventIds: ["filing-1"] }], noActionNeeded: false });
    expect(result.model).toBe("test-model");
    expect(result.report.budget).toMatchObject({ inputChars: 450, maxTokens: 100, inputTokens: 100, outputTokens: 20 });
  });

  it("includes only explicitly configured macro topics and deduplicates seen events", () => {
    const macro = (eventId: string, topic: string) => ({ eventId, publishedAt: "2026-07-20T10:00:00Z", scope: "macro", symbols: [], macroTopics: [topic], category: "macro", headline: `${topic} update`, facts: "Official update.", source: { publisher: "Official", url: `https://official.example/${eventId}`, rank: "official" } });
    const result = buildDigestCandidate({ events: [macro("rba-new", "rba"), macro("fed-new", "fed"), macro("rba-seen", "rba")],
      heldSymbols: [], watchedSymbols: [], macroTopics: ["rba"], seenEventIds: ["rba-seen"] });
    expect(result.events.map((event) => event.eventId)).toEqual(["rba-new"]);
    expect(result.excluded).toEqual(expect.arrayContaining([{ eventId: "fed-new", reason: "outside-universe" }, { eventId: "rba-seen", reason: "already-seen" }]));
  });

  it("marks a context-only digest as no action needed", async () => {
    const result = await runDigestCycle({ events: [{ eventId: "macro-1", publishedAt: "2026-07-20T10:00:00Z", scope: "macro", symbols: [], macroTopics: ["rba"], category: "macro", headline: "RBA speech", facts: "A speech was published.", source: { publisher: "RBA", url: "https://rba.gov.au/speech", rank: "official" } }],
      heldSymbols: [], watchedSymbols: [], macroTopics: ["rba"], seenEventIds: [], runId: "run_20260720T200600Z_a3f1", generatedAt: "2026-07-20T20:06:00Z", cadence: "daily", budget: { maxEvents: 5, maxInputChars: 5000, maxOutputChars: 1000 } });
    expect(result.report).toMatchObject({ noActionNeeded: true, events: [expect.objectContaining({ publishedAt: "2026-07-20T10:00:00Z", thesisImpact: "context-only" })] });
  });
});
