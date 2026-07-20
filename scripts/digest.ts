/** Scheduled M5 research digest. Collection/filtering is deterministic; summarization is optional. */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import { DigestConfig, RunRecord, makeRunId, parsePortfolioMd, parseWatchlistMd, runDigestCycle, type RunRecord as RunRecordType } from "@financial-agent/finance-core";
import { SecEdgarProvider } from "@financial-agent/data-providers/sec-edgar";
import { FinnhubNewsProvider } from "@financial-agent/data-providers/finnhub-news";
import { appendJsonl, loadSeenDigestEventIds, saveDigestReport } from "@financial-agent/storage";
import { collectResearchEvents } from "./lib/digest-collector.js";
import { AnthropicDigestSummarizer } from "./lib/anthropic-digest.js";

const INVESTMENT_DIR = process.env["INVESTMENT_DIR"] ?? join(homedir(), "Documents/notes/Charles/Investment");
const DATA_DIR = join(INVESTMENT_DIR, "data");

async function loadFinnhubKey(): Promise<string | undefined> {
  if (process.env["FINNHUB_API_KEY"]) return process.env["FINNHUB_API_KEY"];
  try {
    const { stdout } = await promisify(execFile)("/usr/bin/security", ["find-generic-password", "-s", "financial-agent-finnhub", "-w"]);
    return stdout.trim() || undefined;
  } catch { return undefined; }
}

async function loadAnthropicKey(): Promise<string | undefined> {
  if (process.env["ANTHROPIC_API_KEY"]) return process.env["ANTHROPIC_API_KEY"];
  try {
    const { stdout } = await promisify(execFile)("/usr/bin/security", ["find-generic-password", "-s", "financial-agent-anthropic", "-w"]);
    return stdout.trim() || undefined;
  } catch { return undefined; }
}

async function main() {
  const now = new Date();
  const runId = makeRunId(now);
  const cadence = process.argv.includes("--weekly") ? "weekly" as const : "daily" as const;
  const startedAt = now.toISOString();
  const providerCalls: RunRecordType["providerCalls"] = [];
  const validationResults: RunRecordType["validationResults"] = [];
  const outputs: string[] = [];
  const inputVersions: Record<string, string> = {};
  let error: string | null = null;
  let model: string | null = null;
  try {
    const paths = {
      portfolio: join(INVESTMENT_DIR, "portfolio.md"),
      watchlist: join(INVESTMENT_DIR, "watchlist.md"),
      config: join(DATA_DIR, "digest-config.yaml"),
    };
    const [portfolioRaw, watchlistRaw, configRaw] = await Promise.all([
      fs.readFile(paths.portfolio, "utf8"), fs.readFile(paths.watchlist, "utf8"), fs.readFile(paths.config, "utf8"),
    ]);
    inputVersions.portfolio = `sha256:${createHash("sha256").update(portfolioRaw).digest("hex")}`;
    inputVersions.watchlist = `sha256:${createHash("sha256").update(watchlistRaw).digest("hex")}`;
    inputVersions.config = `sha256:${createHash("sha256").update(configRaw).digest("hex")}`;
    const heldSymbols = parsePortfolioMd(portfolioRaw).positions.map((position) => position.symbol);
    const watchedSymbols = parseWatchlistMd(watchlistRaw).flatMap((group) => group.items.map((item) => item.symbol));
    const config = DigestConfig.parse(parseYaml(configRaw));
    validationResults.push({ check: "digest-inputs", ok: true, detail: `${heldSymbols.length} held; ${watchedSymbols.length} watched` });

    const secUserAgent = process.env["SEC_USER_AGENT"] ?? config.secUserAgent;
    const finnhubKey = await loadFinnhubKey();
    const filingsProvider = secUserAgent ? new SecEdgarProvider({ userAgent: secUserAgent }) : undefined;
    const newsProvider = finnhubKey ? new FinnhubNewsProvider({ apiKey: finnhubKey }) : undefined;
    const anthropicKey = config.summarizer ? await loadAnthropicKey() : undefined;
    const summarizer = config.summarizer && anthropicKey
      ? new AnthropicDigestSummarizer({ apiKey: anthropicKey, model: config.summarizer.model, maxTokens: config.summarizer.maxTokens,
        onAudit: (audit) => { model = audit.model;
          providerCalls.push({ provider: "anthropic", endpoint: "messages", ok: audit.ok, cached: false }); } })
      : undefined;
    const providerConfigured = Boolean(filingsProvider || newsProvider);
    validationResults.push({ check: "provider-configuration", ok: providerConfigured,
      detail: `${filingsProvider ? "SEC" : "no SEC"}; ${newsProvider ? "Finnhub" : "no Finnhub"}` });

    const lookback = config.lookbackDays[cadence];
    const fromDate = new Date(now.getTime() - lookback * 86_400_000).toISOString().slice(0, 10);
    const toDate = now.toISOString().slice(0, 10);
    const collected = await collectResearchEvents({
      symbols: [...new Set([...heldSymbols, ...watchedSymbols])], from: fromDate, to: toDate,
      macroTopics: config.macroTopics,
      ...(filingsProvider ? { filingsProvider } : {}), ...(newsProvider ? { newsProvider } : {}),
    });
    providerCalls.push(...collected.providerCalls);
    const seenEventIds = await loadSeenDigestEventIds(DATA_DIR);
    const result = await runDigestCycle({ events: collected.events, heldSymbols, watchedSymbols,
      macroTopics: config.macroTopics, seenEventIds, runId, generatedAt: now.toISOString(), cadence,
      budget: config.budget, ...(config.summarizer ? { maxTokens: config.summarizer.maxTokens } : {}), ...(summarizer ? { summarizer } : {}) });
    model = result.model ?? model;
    const output = await saveDigestReport(DATA_DIR, result.report);
    outputs.push(output);
    validationResults.push({ check: "relevance-filter", ok: true, detail: `${result.report.events.length} relevant; ${result.excluded.length} excluded` });
    validationResults.push({ check: "llm-budget", ok: true, detail: result.llmCalled
      ? `${result.report.budget.inputChars}/${result.report.budget.maxInputChars} chars; ${result.report.budget.inputTokens ?? 0} input and ${result.report.budget.outputTokens ?? 0}/${result.report.budget.maxTokens} output tokens`
      : "no LLM call" });
    const collectionFailures = [...(!providerConfigured ? ["no digest provider configured"] : []),
      ...(config.summarizer && !anthropicKey && result.report.events.length > 0 ? ["digest summarizer configured but Anthropic key unavailable"] : []),
      ...collected.failures];
    if (collectionFailures.length > 0) {
      error = collectionFailures.join("; ");
      validationResults.push({ check: "provider-collection", ok: false, detail: error });
      process.exitCode = 1;
    } else validationResults.push({ check: "provider-collection", ok: true });
    console.log(JSON.stringify({ runId, report: output, relevantEvents: result.report.events.length, llmCalled: result.llmCalled }, null, 2));
  } catch (caught: unknown) {
    error = caught instanceof Error ? caught.message : String(caught);
    validationResults.push({ check: "digest-run", ok: false, detail: error });
    console.error(`digest failed: ${error}`);
    process.exitCode = 1;
  } finally {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await appendJsonl(join(DATA_DIR, "runs.jsonl"), RunRecord.parse({ schemaVersion: 1, runId,
      trigger: process.argv.includes("--manual") ? "manual" : "scheduled", task: `digest-${cadence}`,
      startedAt, finishedAt: new Date().toISOString(), inputVersions, providerCalls, validationResults,
      outputs, error, model }));
  }
}

await main();
