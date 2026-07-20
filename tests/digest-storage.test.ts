import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSeenDigestEventIds, saveDigestReport } from "@financial-agent/storage";

describe("digest storage", () => {
  it("persists validated immutable reports and exposes their event ids for dedup", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "fa-digest-"));
    await saveDigestReport(dataDirectory, {
      schemaVersion: 2, reportType: "dailyDigest", cadence: "daily", generatedAt: "2026-07-20T20:06:00Z",
      runId: "run_20260720T200600Z_a3f1", dataAsOf: "2026-07-20T11:00:00Z", sources: ["https://www.sec.gov/a"],
      disclaimer: "Research, not licensed financial advice.", summary: null, noActionNeeded: false,
      summaryClaims: [],
      budget: { maxEvents: 5, maxInputChars: 5000, maxOutputChars: 1000, eventsUsed: 0, inputChars: 0, outputChars: 0, maxTokens: null, inputTokens: null, outputTokens: null },
      events: [{ eventId: "sec:one", publishedAt: "2026-07-20T11:00:00Z", scope: "asset", symbols: ["NVDA"], headline: "NVDA files", facts: "An 8-K was filed.",
        thesisImpact: "review-required", classificationReason: "Original filing requires review.", holdingsAffected: ["NVDA"], interpretation: null,
        source: { publisher: "SEC EDGAR", url: "https://www.sec.gov/a", rank: "original" } }],
    });
    expect(await loadSeenDigestEventIds(dataDirectory)).toEqual(["sec:one"]);
  });

  it("reads legacy v1 reports through a stable migration id", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "fa-digest-"));
    mkdirSync(join(dataDirectory, "digests"));
    writeFileSync(join(dataDirectory, "digests", "legacy.json"), JSON.stringify({
      schemaVersion: 1, reportType: "dailyDigest", generatedAt: "2026-07-19T20:00:00Z", runId: "run_20260719T200000Z_a3f1",
      dataAsOf: "2026-07-19T10:00:00Z", sources: ["legacy"], disclaimer: "Research only.", noActionNeeded: false,
      events: [{ symbol: "NVDA", whatChanged: "Filed 8-K", whyItMatters: "Review needed", holdingsAffected: ["NVDA"], source: "https://www.sec.gov/a" }],
    }));
    expect(await loadSeenDigestEventIds(dataDirectory)).toEqual([expect.stringMatching(/^legacy:/)]);
  });
});
