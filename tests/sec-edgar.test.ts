import { describe, expect, it, vi } from "vitest";
import { SecEdgarProvider } from "@financial-agent/data-providers/sec-edgar";

function jsonResponse(payload: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => payload } as Response;
}

describe("SEC EDGAR filings provider", () => {
  it("finds original filings by ticker and retrieves only SEC archive content", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          0: { cik_str: 123456, ticker: "EXM", title: "Example Corp" },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          filings: {
            recent: {
              accessionNumber: ["0000123456-26-000001", "0000123456-26-000002"],
              filingDate: ["2026-07-18", "2026-07-19"],
              form: ["10-K", "8-K"],
              primaryDocument: ["exm-2026.htm", "exm-event.htm"],
            },
          },
        })
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "<html>Original filing text</html>",
      } as Response);
    const provider = new SecEdgarProvider({
      userAgent: "Financial Agent research@example.com",
      fetchImpl: fetchMock,
    });

    const filings = await provider.searchFilings("exm", ["10-K"]);
    expect(filings).toEqual([
      {
        symbol: "EXM",
        formType: "10-K",
        filedAt: "2026-07-18T00:00:00Z",
        url: "https://www.sec.gov/Archives/edgar/data/123456/000012345626000001/exm-2026.htm",
        source: "sec-edgar",
      },
    ]);
    await expect(provider.getFiling(filings[0]!)).resolves.toContain("Original filing text");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://www.sec.gov/files/company_tickers.json",
      expect.objectContaining({
        headers: expect.objectContaining({ "User-Agent": "Financial Agent research@example.com" }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://data.sec.gov/submissions/CIK0000123456.json",
      expect.any(Object)
    );
  });

  it("rejects a non-SEC filing URL before making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new SecEdgarProvider({
      userAgent: "Financial Agent research@example.com",
      fetchImpl: fetchMock,
    });

    await expect(
      provider.getFiling({
        symbol: "EXM",
        formType: "10-K",
        filedAt: "2026-07-18T00:00:00Z",
        url: "https://evil.example/steal",
        source: "sec-edgar",
      })
    ).rejects.toThrow(/SEC archive URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
