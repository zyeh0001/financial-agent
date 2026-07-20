/**
 * Portfolio health report (M1) — deterministic CLI, no LLM involved.
 *
 *   node scripts/health-report.ts [--json]
 *
 * Reads Layer A (portfolio.md, finances.md cash-snapshot, risk-limits.yaml),
 * fetches live quotes + FX (Yahoo), values the portfolio via finance-core,
 * assesses it against risk limits, validates the report against its schema,
 * appends an audit record to Investment/data/runs.jsonl, and saves the JSON
 * report under Investment/data/reports/.
 */
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import {
  PortfolioHealthReport,
  RiskLimits,
  RunRecord,
  assessHealth,
  ledgerFromState,
  makeRunId,
  parseCashSnapshot,
  parsePortfolioMd,
  valuePortfolio,
  type Quote,
  type RunRecord as RunRecordType,
} from "@financial-agent/finance-core";
import { YahooProvider } from "@financial-agent/data-providers/yahoo";
import type { ProviderFxRate } from "@financial-agent/data-providers";
import { appendJsonl, atomicWriteFile, detectSyncConflicts } from "@financial-agent/storage";

const INVESTMENT_DIR =
  process.env["INVESTMENT_DIR"] ?? join(homedir(), "Documents/notes/Charles/Investment");
const DATA_DIR = join(INVESTMENT_DIR, "data");

async function main() {
  const runId = makeRunId();
  const startedAt = new Date().toISOString();
  const providerCalls: RunRecordType["providerCalls"] = [];
  const validationResults: RunRecordType["validationResults"] = [];
  const outputs: string[] = [];
  let error: string | null = null;
  let portfolioMarkdown = "";
  let financesMarkdown = "";
  let limitsYaml = "";

  try {
    // ---- Layer A reads -----------------------------------------------------
    const portfolioPath = join(INVESTMENT_DIR, "portfolio.md");
    const conflicts = await detectSyncConflicts(portfolioPath);
    if (conflicts.length > 0) throw new Error(`sync conflicts present, resolve first: ${conflicts.join(", ")}`);

    const financesPath = join(INVESTMENT_DIR, "finances.md");
    const limitsPath = join(INVESTMENT_DIR, "risk-limits.yaml");
    portfolioMarkdown = readFileSync(portfolioPath, "utf8");
    financesMarkdown = readFileSync(financesPath, "utf8");
    limitsYaml = readFileSync(limitsPath, "utf8");
    const { positions, warnings } = parsePortfolioMd(portfolioMarkdown);
    const cashSnapshot = parseCashSnapshot(financesMarkdown);
    const limits = RiskLimits.parse(
      parseYaml(limitsYaml)
    );
    validationResults.push({ check: "layer-a-parse", ok: true, detail: `${positions.length} positions` });

    // ---- Live data ---------------------------------------------------------
    const yahoo = new YahooProvider();
    const quotes: Record<string, Quote> = {};
    const quoteFailures: string[] = [];
    for (const p of positions) {
      try {
        const [q] = await yahoo.getQuotes([p.symbol]);
        quotes[p.symbol] = q!;
        providerCalls.push({ provider: "yahoo", endpoint: `quote/${p.symbol}`, ok: true, cached: false });
      } catch (e) {
        providerCalls.push({ provider: "yahoo", endpoint: `quote/${p.symbol}`, ok: false, cached: false });
        quoteFailures.push(`${p.symbol}: ${(e as Error).message}`);
      }
    }
    if (quoteFailures.length > 0) {
      validationResults.push({
        check: "complete-quote-set",
        ok: false,
        detail: quoteFailures.join("; "),
      });
      throw new Error(
        `quote set incomplete; refusing partial portfolio valuation: ${quoteFailures.join("; ")}`
      );
    }
    validationResults.push({ check: "complete-quote-set", ok: true });
    let fx: ProviderFxRate;
    const fxEndpoint = `fx/USD${limits.baseCurrency}`;
    try {
      fx = await yahoo.getRate("USD", limits.baseCurrency);
      providerCalls.push({ provider: "yahoo", endpoint: fxEndpoint, ok: true, cached: false });
    } catch (e) {
      providerCalls.push({ provider: "yahoo", endpoint: fxEndpoint, ok: false, cached: false });
      validationResults.push({ check: "fx-rate", ok: false, detail: (e as Error).message });
      throw e;
    }
    validationResults.push({ check: "fx-rate", ok: true });

    // ---- Valuation ---------------------------------------------------------
    const ledger = ledgerFromState({
      positions,
      cash: [
        {
          currency: cashSnapshot.currency,
          amount:
            cashSnapshot.emergencyFund +
            cashSnapshot.dryPowder +
            cashSnapshot.brokerageCash +
            cashSnapshot.exchangeCash,
        },
      ],
    });
    const buckets = Object.fromEntries(positions.map((p) => [p.symbol, p.bucket])) as Record<
      string,
      "individual" | "etf" | "crypto"
    >;
    const now = new Date().toISOString();
    const valuation = valuePortfolio({
      ledger,
      quotes,
      fx: { [`USD${limits.baseCurrency}`]: fx.rate },
      fxTimestamp: fx.asOf,
      valuationCurrency: limits.baseCurrency,
      buckets,
      now,
      riskLimits: { singleStockMax: limits.singleStockMax },
    });

    const health = assessHealth(valuation, limits, { emergencyFund: cashSnapshot.emergencyFund });
    const dataGaps = [...new Set([...health.dataGaps, ...warnings])];

    const quoteTimes = Object.values(quotes).map((quote) => Date.parse(quote.asOf));
    const dataAsOf = new Date(Math.min(Date.parse(fx.asOf), ...quoteTimes)).toISOString();
    const sources = [...new Set([...Object.values(quotes).map((quote) => quote.source), fx.source])];
    const valuedBySymbol = new Map(valuation.positions.map((position) => [position.symbol, position]));

    // ---- Schema-validated report -------------------------------------------
    const report = PortfolioHealthReport.parse({
      schemaVersion: 1,
      reportType: "portfolioHealthReport",
      generatedAt: now,
      runId,
      dataAsOf,
      sources,
      disclaimer: "Research, not licensed financial advice.",
      valuationCurrency: limits.baseCurrency,
      totalValue: valuation.totalValue,
      positions: positions.map((position) => {
        const valued = valuedBySymbol.get(position.symbol)!;
        const quote = quotes[position.symbol]!;
        return {
          symbol: position.symbol,
          bucket: position.bucket,
          quantity: position.quantity,
          averageCost: position.averageCost,
          costCurrency: position.costCurrency,
          price: quote.price,
          quoteCurrency: quote.currency,
          quoteAsOf: quote.asOf,
          source: quote.source,
          value: valued.value,
          weight: valued.weight,
          unrealizedPnl: valued.unrealizedPnl,
        };
      }),
      cash: valuation.cash,
      fxRates: [fx],
      riskLimits: limits,
      healthContext: { emergencyFund: cashSnapshot.emergencyFund },
      bucketWeights: valuation.bucketWeights,
      concentrationFlags: valuation.concentrationFlags,
      currencyExposure: valuation.currencyExposure,
      staleQuotes: valuation.staleQuotes,
      dataGaps,
      policyBreaches: health.policyBreaches,
      suggestedActions: health.suggestedActions,
    });
    validationResults.push({ check: "portfolioHealthReport-schema", ok: true });

    // ---- Persist -------------------------------------------------------------
    mkdirSync(join(DATA_DIR, "reports"), { recursive: true });
    const reportPath = join(DATA_DIR, "reports", `health-${now.slice(0, 10)}-${runId}.json`);
    await atomicWriteFile(reportPath, JSON.stringify(report, null, 2));
    outputs.push(reportPath);

    // ---- Human summary -------------------------------------------------------
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const fmt = (n: number) => n.toLocaleString("en-AU", { maximumFractionDigits: 0 });
      console.log(`\nPortfolio health — ${now.slice(0, 10)} (run ${runId})`);
      console.log(`Total value: ${limits.baseCurrency} ${fmt(valuation.totalValue)}  (fx USD→AUD ${fx.rate.toFixed(4)}, ${fx.source})`);
      console.log(`\nBuckets vs target:`);
      for (const [bucket, target] of Object.entries(limits.targetAllocation)) {
        const actual = valuation.bucketWeights[bucket] ?? 0;
        console.log(`  ${bucket.padEnd(10)} ${(actual * 100).toFixed(1).padStart(5)}%  (target ${((target ?? 0) * 100).toFixed(0)}%)`);
      }
      console.log(`\nTop positions:`);
      for (const p of valuation.positions.slice(0, 5)) {
        const pnl = p.unrealizedPnl === null ? "P&L unknown" : `P&L ${p.unrealizedPnl >= 0 ? "+" : ""}${fmt(p.unrealizedPnl)}`;
        console.log(`  ${p.symbol.padEnd(8)} ${(p.weight * 100).toFixed(1).padStart(5)}%  ${limits.baseCurrency} ${fmt(p.value).padStart(8)}  ${pnl}${p.stale ? "  [STALE]" : ""}`);
      }
      if (report.policyBreaches.length) {
        console.log(`\nPolicy breaches:`);
        for (const b of report.policyBreaches) console.log(`  ⚠ ${b}`);
      }
      if (report.suggestedActions.length) {
        console.log(`\nSuggested actions:`);
        for (const a of report.suggestedActions) console.log(`  → ${a}`);
      }
      if (report.dataGaps.length) {
        console.log(`\nData gaps:`);
        for (const g of report.dataGaps) console.log(`  ? ${g}`);
      }
      console.log(`\nSaved: ${reportPath}`);
      console.log(`${report.disclaimer}\n`);
    }
  } catch (e) {
    error = (e as Error).message;
    console.error(`health-report failed: ${error}`);
    process.exitCode = 1;
  } finally {
    mkdirSync(DATA_DIR, { recursive: true });
    const record = RunRecord.parse({
      schemaVersion: 1,
      runId,
      trigger: "manual",
      task: "health-report",
      startedAt,
      finishedAt: new Date().toISOString(),
      inputVersions: {
        portfolio: `sha256:${createHash("sha256").update(portfolioMarkdown).digest("hex")}`,
        finances: `sha256:${createHash("sha256").update(financesMarkdown).digest("hex")}`,
        limits: `sha256:${createHash("sha256").update(limitsYaml).digest("hex")}`,
      },
      providerCalls,
      validationResults,
      outputs,
      error,
      model: null,
    });
    await appendJsonl(join(DATA_DIR, "runs.jsonl"), record);
  }
}

await main();
