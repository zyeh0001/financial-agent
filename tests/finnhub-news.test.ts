import { describe, expect, it, vi } from "vitest";
import { FinnhubNewsProvider } from "@financial-agent/data-providers/finnhub-news";

describe("Finnhub news provider", () => {
  it("returns validated company news with timestamps and source links", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      json: async () => [{ id: 123, datetime: 1784556000, headline: "Example reports results", summary: "Revenue increased.", source: "Reuters", url: "https://news.example/123", related: "EXM" }],
    } as Response);
    const provider = new FinnhubNewsProvider({ apiKey: "secret-token", fetchImpl: fetchMock });

    await expect(provider.getCompanyNews("EXM", "2026-07-19", "2026-07-20")).resolves.toEqual([{
      id: "finnhub:123", publishedAt: "2026-07-20T14:00:00.000Z", headline: "Example reports results",
      summary: "Revenue increased.", publisher: "Reuters", url: "https://news.example/123", symbols: ["EXM"], category: "company",
    }]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/company-news?symbol=EXM&from=2026-07-19&to=2026-07-20&token=secret-token"), expect.any(Object));
  });
});
