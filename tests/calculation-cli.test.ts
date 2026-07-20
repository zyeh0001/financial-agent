import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DcfCalculationRecord, RunRecord } from "@financial-agent/finance-core";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("calculation CLI", () => {
  it("persists a valuation calculation and its audit record", () => {
    const directory = mkdtempSync(join(tmpdir(), "financial-agent-calculation-"));
    temporaryDirectories.push(directory);
    const inputPath = join(directory, "input.json");
    writeFileSync(
      inputPath,
      JSON.stringify({
        schemaVersion: 1,
        symbol: "EXAMPLE",
        currency: "USD",
        dataAsOf: "2026-07-19T00:00:00Z",
        freeCashFlow: {
          value: 100,
          currency: "USD",
          asOf: "2026-07-19T00:00:00Z",
          source: "worked example",
        },
        netDebt: {
          value: 0,
          currency: "USD",
          asOf: "2026-07-19T00:00:00Z",
          source: "worked example",
        },
        sharesOutstanding: {
          value: 10,
          asOf: "2026-07-19T00:00:00Z",
          source: "worked example",
        },
        forecastYears: 1,
        scenarios: {
          bear: { growthRate: 0, terminalGrowthRate: 0, discountRate: 0.1 },
          base: { growthRate: 0, terminalGrowthRate: 0, discountRate: 0.1 },
          bull: { growthRate: 0, terminalGrowthRate: 0, discountRate: 0.1 },
        },
        sensitivity: { discountRates: [0.1], terminalGrowthRates: [0] },
      })
    );

    execFileSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/valuation.ts",
        "--input",
        inputPath,
        "--data-dir",
        directory,
        "--json",
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    const calculationFiles = readdirSync(join(directory, "calculations"));
    expect(calculationFiles).toHaveLength(1);
    const calculation = DcfCalculationRecord.parse(
      JSON.parse(
        readFileSync(join(directory, "calculations", calculationFiles[0]!), "utf8")
      )
    );
    expect(calculation.result.scenarios.base.impliedValuePerShare).toBe(100);
    const audit = RunRecord.parse(JSON.parse(readFileSync(join(directory, "runs.jsonl"), "utf8")));
    expect(audit).toMatchObject({
      runId: calculation.runId,
      task: "valuation-calculation",
      inputVersions: { calculationInput: calculation.inputHash },
      error: null,
      model: null,
    });
  });
});
