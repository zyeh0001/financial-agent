import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("quality review CLI", () => {
  it("persists a reproducible baseline-to-candidate comparison", () => {
    const directory = mkdtempSync(join(tmpdir(), "financial-agent-quality-"));
    directories.push(directory);
    const benchmarkPath = join(directory, "benchmark.json");
    const baselinePath = join(directory, "baseline.json");
    const candidatePath = join(directory, "candidate.json");
    const outputPath = join(directory, "comparison.json");
    writeFileSync(
      benchmarkPath,
      JSON.stringify({
        schemaVersion: 1,
        caseId: "case-one",
        expectedUnsupportedClaimIds: ["claim-2"],
        expectedRiskIds: ["risk-1"],
        expectedArithmeticDiscrepancyIds: ["calc-1"],
        claimIds: ["claim-1", "claim-2", "claim-3", "claim-4"],
      })
    );
    writeFileSync(
      baselinePath,
      JSON.stringify({
        schemaVersion: 1,
        unsupportedClaimIds: [],
        riskIds: [],
        arithmeticDiscrepancyIds: [],
        sourcedClaimIds: ["claim-1", "claim-4"],
      })
    );
    writeFileSync(
      candidatePath,
      JSON.stringify({
        schemaVersion: 1,
        unsupportedClaimIds: ["claim-2"],
        riskIds: ["risk-1"],
        arithmeticDiscrepancyIds: ["calc-1"],
        sourcedClaimIds: ["claim-1", "claim-3", "claim-4"],
      })
    );

    const stdout = execFileSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/evaluate-quality.ts",
        "--benchmark",
        benchmarkPath,
        "--baseline",
        baselinePath,
        "--candidate",
        candidatePath,
        "--output",
        outputPath,
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    expect(stdout).toContain("quality improved: yes");
    expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({
      schemaVersion: 1,
      caseId: "case-one",
      comparison: { improved: true, regressions: [] },
    });
  });
});
