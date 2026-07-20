import { describe, expect, it, vi } from "vitest";
import { AnthropicDigestSummarizer } from "../scripts/lib/anthropic-digest.js";

describe("Anthropic digest summarizer", () => {
  it("returns structured claim-to-event mappings from the Messages API", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, status: 200, statusText: "OK", json: async () => ({
      model: "approved-model", usage: { input_tokens: 120, output_tokens: 30 }, content: [{ type: "text", text: JSON.stringify({ claims: [{ text: "An 8-K was filed.", eventIds: ["sec:one"] }], interpretations: { "sec:one": "Review the filing." } }) }],
    }) } as Response);
    const adapter = new AnthropicDigestSummarizer({ apiKey: "secret", model: "approved-model", maxTokens: 500, fetchImpl: fetchMock });
    await expect(adapter.summarize([{ eventId: "sec:one", publishedAt: "2026-07-20T10:00:00Z", scope: "asset", symbols: ["NVDA"], macroTopics: [], category: "filing", headline: "NVDA files", facts: "An 8-K was filed.", source: { publisher: "SEC", url: "https://sec.gov/a", rank: "original" } }], { maxInputChars: 5000, maxOutputChars: 1000 }))
      .resolves.toMatchObject({ model: "approved-model", claims: [{ eventIds: ["sec:one"] }], usage: { inputChars: expect.any(Number), inputTokens: 120, outputTokens: 30 } });
    expect(fetchMock).toHaveBeenCalledWith("https://api.anthropic.com/v1/messages", expect.objectContaining({ method: "POST" }));
  });
});
