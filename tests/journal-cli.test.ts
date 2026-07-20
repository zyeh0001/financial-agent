import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("journal CLI confirmation boundary", () => {
  it("refuses unconfirmed writes, then creates and searches confirmed linked records", () => {
    const investmentDirectory = mkdtempSync(join(tmpdir(), "financial-agent-investment-"));
    temporaryDirectories.push(investmentDirectory);
    const entryPath = join(investmentDirectory, "entry.json");
    const postmortemPath = join(investmentDirectory, "postmortem.json");
    writeFileSync(
      entryPath,
      JSON.stringify({
        schemaVersion: 1,
        id: "jrnl_20260720_avgo-entry",
        ts: "2026-07-20T10:00:00Z",
        symbol: "AVGO",
        decision: "pass",
        thesis: "Demand may remain durable.",
        horizon: "1-5 years",
        entryReason: "Valuation did not provide downside protection.",
        risks: ["Customer concentration"],
        invalidationConditions: ["Revenue falls twice"],
      })
    );
    const baseArguments = [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/journal.ts",
      "create-entry",
      "--input",
      entryPath,
      "--investment-dir",
      investmentDirectory,
    ];

    const denied = spawnSync(process.execPath, baseArguments, {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(denied.status).toBe(1);
    expect(denied.stderr).toContain("explicit user confirmation");
    expect(existsSync(join(investmentDirectory, "journal", "jrnl_20260720_avgo-entry.md"))).toBe(false);

    execFileSync(process.execPath, [...baseArguments, "--confirmed"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    writeFileSync(
      postmortemPath,
      JSON.stringify({
        schemaVersion: 1,
        id: "jrnl_20260721_avgo-postmortem",
        ts: "2026-07-21T10:00:00Z",
        entryId: "jrnl_20260720_avgo-entry",
        outcome: "No position was opened.",
        thesisCorrect: "partially",
        timingCorrect: "yes",
        ruleViolations: [],
        luckVsSkill: "The recorded process was followed.",
        lessons: ["Retain the next-data-point trigger."],
      })
    );
    execFileSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/journal.ts",
        "create-postmortem",
        "--input",
        postmortemPath,
        "--investment-dir",
        investmentDirectory,
        "--confirmed",
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );
    const searchOutput = execFileSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/journal.ts",
        "search",
        "--symbol",
        "AVGO",
        "--investment-dir",
        investmentDirectory,
        "--json",
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );
    const results = JSON.parse(searchOutput) as Array<{ kind: string; symbol: string }>;
    expect(results.map((result) => [result.kind, result.symbol])).toEqual([
      ["entry", "AVGO"],
      ["postmortem", "AVGO"],
    ]);
  });
});
