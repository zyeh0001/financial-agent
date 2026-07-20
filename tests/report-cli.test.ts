import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildStockResearchReport, runDcfValuation } from "@financial-agent/finance-core";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("report validation CLI", () => {
  it("validates one report type through the runtime-neutral contract", () => {
    const directory = mkdtempSync(join(tmpdir(), "financial-agent-report-"));
    temporaryDirectories.push(directory);
    const reportPath = join(directory, "alert.json");
    writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 1,
        reportType: "monitorAlert",
        generatedAt: "2026-07-20T20:06:00Z",
        runId: "run_20260720T200600Z_a3f1",
        dataAsOf: "2026-07-20T20:05:00Z",
        sources: ["worked example"],
        disclaimer: "Research, not licensed financial advice.",
        ruleId: "example-watch",
        symbol: "EXAMPLE",
        condition: "price lt 100 USD",
        observedValue: 99,
        threshold: 100,
        currency: "USD",
        observedAt: "2026-07-20T20:05:00Z",
        stale: false,
        severity: "informational",
        guidance: "Observation, not an instruction to trade.",
      })
    );

    const output = execFileSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/validate-report.ts",
        "--type",
        "monitorAlert",
        "--input",
        reportPath,
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    expect(output).toContain("valid monitorAlert");
  });

  it("resolves calculation-bearing reports against the stored calculation file", () => {
    const directory = mkdtempSync(join(tmpdir(), "financial-agent-report-"));
    temporaryDirectories.push(directory);
    const calculation = runDcfValuation({
      runId: "run_20260720T201000Z_b4c2",
      generatedAt: "2026-07-20T20:10:00Z",
      input: {
        schemaVersion: 1,
        symbol: "EXAMPLE",
        currency: "USD",
        dataAsOf: "2026-07-19T00:00:00Z",
        freeCashFlow: { value: 100, currency: "USD", asOf: "2026-07-19T00:00:00Z", source: "filing" },
        netDebt: { value: 0, currency: "USD", asOf: "2026-07-19T00:00:00Z", source: "filing" },
        sharesOutstanding: { value: 10, asOf: "2026-07-19T00:00:00Z", source: "filing" },
        forecastYears: 1,
        scenarios: {
          bear: { growthRate: -0.1, terminalGrowthRate: 0, discountRate: 0.12 },
          base: { growthRate: 0, terminalGrowthRate: 0, discountRate: 0.1 },
          bull: { growthRate: 0.1, terminalGrowthRate: 0.02, discountRate: 0.08 },
        },
        sensitivity: { discountRates: [0.1], terminalGrowthRates: [0] },
      },
    });
    const report = buildStockResearchReport({
      calculation,
      facts: [
        {
          claim: "Free cash flow was USD 100m.",
          value: { measurementType: "monetary", value: 100, unit: "millions", currency: "USD" },
          source: "Example filing",
          sourceUrl: "https://www.sec.gov/Archives/example",
          asOf: "2026-07-19T00:00:00Z",
        },
      ],
      thesis: "Cash generation may persist.",
      scenarioNarratives: { bear: "Contracts.", base: "Stable.", bull: "Grows." },
      risks: ["Cash flow may fall."],
      invalidationConditions: ["Cash flow falls twice."],
      unknowns: ["Pricing durability."],
      nextDataPointToWatch: "Next filing.",
    });
    const reportPath = join(directory, "stock.json");
    const calculationPath = join(directory, "calculation.json");
    writeFileSync(reportPath, JSON.stringify(report));
    writeFileSync(calculationPath, JSON.stringify(calculation));

    const output = execFileSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/validate-report.ts",
        "--type",
        "stockResearchReport",
        "--input",
        reportPath,
        "--calculation",
        calculationPath,
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );
    expect(output).toContain("valid stockResearchReport");
  });
});
