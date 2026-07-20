import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectories: string[] = [];
afterEach(() => temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe("monitor CLI", () => {
  it("runs quietly without an LLM and appends a complete audit record", () => {
    const investmentDirectory = mkdtempSync(join(tmpdir(), "fa-monitor-cli-"));
    temporaryDirectories.push(investmentDirectory);
    mkdirSync(join(investmentDirectory, "data"));
    writeFileSync(join(investmentDirectory, "data", "rules.yaml"), "[]\n");

    const output = execFileSync(process.execPath, [
      "node_modules/tsx/dist/cli.mjs", "scripts/monitor.ts", "--manual",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, INVESTMENT_DIR: investmentDirectory },
    });

    expect(JSON.parse(output)).toMatchObject({ matched: 0, created: 0, delivered: 0 });
    const run = JSON.parse(readFileSync(join(investmentDirectory, "data", "runs.jsonl"), "utf8"));
    expect(run).toMatchObject({ trigger: "manual", task: "monitor", error: null, model: null });
    expect(run.validationResults).toContainEqual(expect.objectContaining({ check: "rules-schema", ok: true }));
  });
});
