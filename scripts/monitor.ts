/** Deterministic M4 monitoring CLI. Intended entry point for launchd. */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { RulesFile, RunRecord, makeRunId, type RunRecord as RunRecordType } from "@financial-agent/finance-core";
import { YahooProvider } from "@financial-agent/data-providers/yahoo";
import { appendJsonl, detectSyncConflicts, loadDashboardReadModel } from "@financial-agent/storage";
import { RULE_FIELD_SOURCE, runMonitoringCycle } from "./lib/monitor-cycle.js";
import { MacOsNotificationAdapter } from "./lib/notifications.js";

const INVESTMENT_DIR = process.env["INVESTMENT_DIR"] ?? join(homedir(), "Documents/notes/Charles/Investment");
const DATA_DIR = join(INVESTMENT_DIR, "data");
const RULES_PATH = join(DATA_DIR, "rules.yaml");
const ALERTS_PATH = join(DATA_DIR, "alerts.jsonl");
const RUNS_PATH = join(DATA_DIR, "runs.jsonl");
const DEDUP_WINDOW_MS = Number(process.env["MONITOR_DEDUP_MINUTES"] ?? "1440") * 60_000;

async function main() {
  const now = new Date();
  const runId = makeRunId(now);
  const startedAt = now.toISOString();
  let rulesRaw = "";
  let error: string | null = null;
  const providerCalls: RunRecordType["providerCalls"] = [];
  const validationResults: RunRecordType["validationResults"] = [];
  const outputs: string[] = [];
  const inputVersions: Record<string, string> = {};

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const conflicts = await detectSyncConflicts(RULES_PATH);
    if (conflicts.length > 0) throw new Error(`sync conflicts present, resolve first: ${conflicts.join(", ")}`);
    rulesRaw = await fs.readFile(RULES_PATH, "utf8");
    inputVersions.rules = `sha256:${createHash("sha256").update(rulesRaw).digest("hex")}`;
    const rules = RulesFile.parse(parseYaml(rulesRaw));
    validationResults.push({ check: "rules-schema", ok: true, detail: `${rules.length} rules` });

    const needsPortfolio = rules.some((rule) => {
      const conditions = "all" in rule.condition ? rule.condition.all : rule.condition.any;
      return conditions.some((condition) => RULE_FIELD_SOURCE[condition.field] === "portfolio");
    });
    let portfolioReport;
    if (needsPortfolio) {
      const dashboard = await loadDashboardReadModel({ dataDirectory: DATA_DIR, now });
      if (dashboard.status === "error" || dashboard.current === null) {
        validationResults.push({ check: "portfolio-read-model", ok: false, detail: dashboard.issues.join("; ") || "no health report" });
      } else {
        portfolioReport = dashboard.current;
        inputVersions.healthReport = dashboard.provenance!.reportRunId;
        validationResults.push({ check: "portfolio-read-model", ok: true, detail: dashboard.provenance?.reportRunId });
      }
    }

    const result = await runMonitoringCycle({
      rules,
      provider: new YahooProvider(),
      adapter: new MacOsNotificationAdapter(),
      alertLogPath: ALERTS_PATH,
      runId,
      now,
      ...(portfolioReport ? { portfolioReport } : {}),
      dedupWindowMs: DEDUP_WINDOW_MS,
    });
    providerCalls.push(...result.providerCalls);
    validationResults.push({ check: "rule-evaluation", ok: true, detail: `${result.matched} matched; ${result.created} new` });
    validationResults.push({
      check: "provider-observations",
      ok: result.providerFailures.length === 0,
      ...(result.providerFailures.length ? { detail: result.providerFailures.join("; ") } : {}),
    });
    validationResults.push({
      check: "notification-delivery",
      ok: result.deliveryFailures.length === 0,
      detail: `${result.delivered} delivered${result.deliveryFailures.length ? `; ${result.deliveryFailures.join("; ")}` : ""}`,
    });
    if (result.created > 0 || result.delivered > 0) outputs.push(ALERTS_PATH);
    const failures = [...result.providerFailures, ...result.deliveryFailures];
    if (failures.length > 0) {
      error = failures.join("; ");
      process.exitCode = 1;
    }
    console.log(JSON.stringify({ runId, ...result }, null, 2));
  } catch (caught: unknown) {
    error = caught instanceof Error ? caught.message : String(caught);
    validationResults.push({ check: "monitor-run", ok: false, detail: error });
    console.error(`monitor failed: ${error}`);
    process.exitCode = 1;
  } finally {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const record = RunRecord.parse({
      schemaVersion: 1,
      runId,
      trigger: process.argv.includes("--manual") ? "manual" : "scheduled",
      task: "monitor",
      startedAt,
      finishedAt: new Date().toISOString(),
      inputVersions: Object.keys(inputVersions).length > 0
        ? inputVersions
        : { rules: `sha256:${createHash("sha256").update(rulesRaw).digest("hex")}` },
      providerCalls,
      validationResults,
      outputs,
      error,
      model: null,
    });
    await appendJsonl(RUNS_PATH, record);
  }
}

await main();
