import { describe, expect, it } from "vitest";
import { collectResearchEvents } from "../scripts/lib/digest-collector.js";

describe("digest collection", () => {
  it("bounds macro events to the requested cadence window", async () => {
    const event = (id: string, publishedAt: string) => ({ id, publishedAt, headline: "RBA interest rate update", summary: "RBA statement.", publisher: "Wire", url: `https://news.example/${id}`, symbols: [], category: "general" as const });
    const result = await collectResearchEvents({ symbols: [], from: "2026-07-19", to: "2026-07-20", macroTopics: ["rba"],
      newsProvider: { name: "test", async getCompanyNews() { return []; }, async getGeneralNews() { return [event("old", "2026-07-01T00:00:00Z"), event("new", "2026-07-20T00:00:00Z")]; } } });
    expect(result.events.map((item) => item.eventId)).toEqual(["new"]);
  });
});
