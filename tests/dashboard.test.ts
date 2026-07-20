import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { calculatePercentChange, createPortfolioSnapshot, PortfolioHealthReport } from "@financial-agent/finance-core";
import { createDailySnapshotFile, loadDashboardReadModel } from "@financial-agent/storage";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const report = PortfolioHealthReport.parse({
  schemaVersion: 2,
  reportType: "portfolioHealthReport",
  generatedAt: "2026-07-20T20:10:00Z",
  runId: "run_20260720T201000Z_b4c2",
  dataAsOf: "2026-07-20T20:05:00Z",
  sources: ["worked example"],
  disclaimer: "Research, not licensed financial advice.",
  valuationCurrency: "AUD",
  totalValue: 1_000,
  positions: [],
  cash: { AUD: 100 },
  fxRates: [{ pair: "USDAUD", rate: 1.5, asOf: "2026-07-20T20:04:00Z", source: "worked example" }],
  riskLimits: {
    schemaVersion: 1,
    baseCurrency: "AUD",
    singleStockMax: 0.1,
    speculativeAllocationMax: 0.15,
    driftTolerance: 0.05,
    emergencyFundFloor: 10_000,
    marginAllowed: false,
    noUndefinedRiskOptions: true,
    glidePathMonthsBeforePurchase: 24,
    targetAllocation: { individual: 0.4, etf: 0.4, crypto: 0.1, cash: 0.1 },
    speculativeSymbols: [],
  },
  healthContext: { emergencyFund: 100 },
  bucketWeights: { individual: 0.4, etf: 0.4, crypto: 0.1, cash: 0.1 },
  concentrationFlags: [],
  currencyExposure: { AUD: 1 },
  staleQuotes: [],
  dataGaps: [],
  policyBreaches: [],
  suggestedActions: [],
});

describe("dashboard snapshot", () => {
  it("links a daily history point to the exact report run and portfolio input", () => {
    expect(
      createPortfolioSnapshot({
        report,
        sourcePortfolioHash: `sha256:${"a".repeat(64)}`,
        marketSession: "MANUAL",
      })
    ).toEqual({
      schemaVersion: 2,
      eventId: "snap_20260720_manual",
      capturedAt: "2026-07-20T20:10:00Z",
      marketSession: "MANUAL",
      valuationCurrency: "AUD",
      fxTimestamp: "2026-07-20T20:04:00Z",
      sourceReportRunId: "run_20260720T201000Z_b4c2",
      sourcePortfolioHash: `sha256:${"a".repeat(64)}`,
      totalValue: 1_000,
      byBucket: { individual: 0.4, etf: 0.4, crypto: 0.1, cash: 0.1 },
      status: "complete",
    });
  });

  it("keeps the first daily snapshot immutable when a health check is repeated", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "financial-agent-dashboard-"));
    temporaryDirectories.push(dataDirectory);
    const first = createPortfolioSnapshot({
      report,
      sourcePortfolioHash: `sha256:${"a".repeat(64)}`,
      marketSession: "MANUAL",
    });
    const replacement = { ...first, totalValue: 2_000 };

    expect(await createDailySnapshotFile(dataDirectory, first)).toMatchObject({ created: true });
    expect(await createDailySnapshotFile(dataDirectory, replacement)).toMatchObject({ created: false });
    expect(
      JSON.parse(readFileSync(join(dataDirectory, "snapshots", `${first.eventId}.json`), "utf8"))
    ).toMatchObject({ totalValue: 1_000, sourceReportRunId: report.runId });
  });

  it("refuses to create a snapshot beside a sync-conflict artifact", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "financial-agent-dashboard-"));
    temporaryDirectories.push(dataDirectory);
    mkdirSync(join(dataDirectory, "snapshots"));
    const snapshot = createPortfolioSnapshot({
      report,
      sourcePortfolioHash: `sha256:${"a".repeat(64)}`,
      marketSession: "MANUAL",
    });
    writeFileSync(join(dataDirectory, "snapshots", `${snapshot.eventId} sync-conflict.json`), "{}");

    await expect(createDailySnapshotFile(dataDirectory, snapshot)).rejects.toThrow(/sync conflict/i);
  });
});

describe("dashboard-derived values", () => {
  it("calculates watchlist change in finance-core", () => {
    expect(calculatePercentChange(500, 510)).toBe(2);
    expect(calculatePercentChange(null, 510)).toBeNull();
  });
});

describe("dashboard read model", () => {
  it("loads the newest validated report with sorted history and provenance", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "financial-agent-dashboard-"));
    temporaryDirectories.push(dataDirectory);
    mkdirSync(join(dataDirectory, "reports"));
    mkdirSync(join(dataDirectory, "snapshots"));
    const older = { ...report, generatedAt: "2026-07-19T20:10:00Z", dataAsOf: "2026-07-19T20:05:00Z" };
    const latest = { ...report, dataGaps: ["ABC: cost basis unknown"] };
    writeFileSync(join(dataDirectory, "reports", "health-2026-07-19-old.json"), JSON.stringify(older));
    writeFileSync(join(dataDirectory, "reports", "health-2026-07-20-latest.json"), JSON.stringify(latest));
    const latestSnapshot = createPortfolioSnapshot({
      report: latest,
      sourcePortfolioHash: `sha256:${"b".repeat(64)}`,
      marketSession: "MANUAL",
    });
    const olderSnapshot = createPortfolioSnapshot({
      report: older,
      sourcePortfolioHash: `sha256:${"a".repeat(64)}`,
      marketSession: "MANUAL",
    });
    writeFileSync(join(dataDirectory, "snapshots", `${latestSnapshot.eventId}.json`), JSON.stringify(latestSnapshot));
    writeFileSync(join(dataDirectory, "snapshots", `${olderSnapshot.eventId}.json`), JSON.stringify(olderSnapshot));

    const model = await loadDashboardReadModel({
      dataDirectory,
      now: new Date("2026-07-20T21:00:00Z"),
    });

    expect(model.status).toBe("incomplete");
    expect(model.freshness).toBe("current");
    expect(model.completeness).toBe("incomplete");
    expect(model.current?.generatedAt).toBe("2026-07-20T20:10:00Z");
    expect(model.history.map((point) => point.capturedAt)).toEqual([
      "2026-07-19T20:10:00Z",
      "2026-07-20T20:10:00Z",
    ]);
    expect(model.provenance).toEqual({
      reportFile: "health-2026-07-20-latest.json",
      reportRunId: "run_20260720T201000Z_b4c2",
      generatedAt: "2026-07-20T20:10:00Z",
      dataAsOf: "2026-07-20T20:05:00Z",
      sources: ["worked example"],
    });
    expect(model.issues).toContain("ABC: cost basis unknown");
  });

  it("reports stale but otherwise complete data as two independent dimensions", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "financial-agent-dashboard-"));
    temporaryDirectories.push(dataDirectory);
    mkdirSync(join(dataDirectory, "reports"));
    writeFileSync(join(dataDirectory, "reports", "health-2026-07-20.json"), JSON.stringify(report));

    const model = await loadDashboardReadModel({
      dataDirectory,
      now: new Date("2026-07-22T20:05:00Z"),
    });

    expect(model.status).toBe("stale");
    expect(model.freshness).toBe("stale");
    expect(model.completeness).toBe("complete");
  });

  it("surfaces a malformed newest report instead of silently using an older value", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "financial-agent-dashboard-"));
    temporaryDirectories.push(dataDirectory);
    mkdirSync(join(dataDirectory, "reports"));
    writeFileSync(join(dataDirectory, "reports", "health-2026-07-19-valid.json"), JSON.stringify(report));
    writeFileSync(join(dataDirectory, "reports", "health-2026-07-20-broken.json"), "{not-json");

    const model = await loadDashboardReadModel({ dataDirectory });

    expect(model.status).toBe("error");
    expect(model.current).toBeNull();
    expect(model.issues[0]).toContain("health-2026-07-20-broken.json is invalid");
  });

  it("rejects history points in a different valuation currency", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "financial-agent-dashboard-"));
    temporaryDirectories.push(dataDirectory);
    mkdirSync(join(dataDirectory, "reports"));
    mkdirSync(join(dataDirectory, "snapshots"));
    writeFileSync(join(dataDirectory, "reports", "health-2026-07-20.json"), JSON.stringify(report));
    const snapshot = {
      ...createPortfolioSnapshot({
        report,
        sourcePortfolioHash: `sha256:${"a".repeat(64)}`,
        marketSession: "MANUAL",
      }),
      valuationCurrency: "USD",
    };
    writeFileSync(join(dataDirectory, "snapshots", `${snapshot.eventId}.json`), JSON.stringify(snapshot));

    const model = await loadDashboardReadModel({ dataDirectory });

    expect(model.status).toBe("error");
    expect(model.history).toEqual([]);
    expect(model.issues.join(" ")).toMatch(/currency mismatch.*USD.*AUD/i);
  });

  it("surfaces sync-conflict artifacts instead of selecting a winner", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "financial-agent-dashboard-"));
    temporaryDirectories.push(dataDirectory);
    mkdirSync(join(dataDirectory, "reports"));
    writeFileSync(join(dataDirectory, "reports", "health-2026-07-20.json"), JSON.stringify(report));
    writeFileSync(join(dataDirectory, "reports", "health-2026-07-20 sync-conflict.json"), JSON.stringify(report));

    const model = await loadDashboardReadModel({ dataDirectory });

    expect(model.status).toBe("error");
    expect(model.current).toBeNull();
    expect(model.issues.join(" ")).toMatch(/sync conflict/i);
  });
});
