import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe("digest CLI", () => {
  it("creates an audited no-action report without an LLM when providers are unconfigured", () => {
    const investment = mkdtempSync(join(tmpdir(), "fa-digest-cli-"));
    directories.push(investment);
    mkdirSync(join(investment, "data"));
    writeFileSync(join(investment, "portfolio.md"), "# Portfolio\n\n## Holdings\n\n| Ticker | Shares | Avg Cost | Type | Notes |\n|---|---:|---:|---|---|\n| EXM | 1 | 10 | Stock | Example |\n");
    writeFileSync(join(investment, "watchlist.md"), "# Watchlist\n");
    writeFileSync(join(investment, "data", "digest-config.yaml"), "schemaVersion: 1\nmacroTopics: [rba]\nlookbackDays: { daily: 2, weekly: 8 }\nbudget: { maxEvents: 5, maxInputChars: 5000, maxOutputChars: 1000 }\n");
    const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/digest.ts", "--manual"], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, INVESTMENT_DIR: investment, FINNHUB_API_KEY: "" },
    });
    expect(result.status).toBe(1);
    const digestFile = readdirSync(join(investment, "data", "digests"))[0]!;
    const digest = JSON.parse(readFileSync(join(investment, "data", "digests", digestFile), "utf8"));
    expect(digest).toMatchObject({ events: [], summary: null, noActionNeeded: true });
    const run = JSON.parse(readFileSync(join(investment, "data", "runs.jsonl"), "utf8"));
    expect(run).toMatchObject({ task: "digest-daily", model: null, error: "no digest provider configured" });
    expect(run.validationResults).toContainEqual(expect.objectContaining({ check: "llm-budget", detail: "no LLM call" }));
  });
});
