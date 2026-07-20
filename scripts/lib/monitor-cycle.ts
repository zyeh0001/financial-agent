import {
  RulesFile,
  evaluateAlertRules,
  marketAgeHours,
  type AlertRule,
  type Report,
  type RuleField,
  type SymbolObservations,
} from "@financial-agent/finance-core";
import type { MarketDataProvider } from "@financial-agent/data-providers";
import { claimAlertEvent, claimPendingAlertDeliveries, markAlertDelivery } from "@financial-agent/storage";
import { deliverWithRetry, type NotificationAdapter } from "./notifications.js";

type HealthReport = Extract<Report, { reportType: "portfolioHealthReport" }>;
type ProviderCall = { provider: string; endpoint: string; ok: boolean; cached: boolean };

export const RULE_FIELD_SOURCE: Record<RuleField, "quote" | "fundamentals" | "portfolio"> = {
  price: "quote",
  pe: "fundamentals",
  market_cap: "fundamentals",
  days_to_earnings: "fundamentals",
  position_pct: "portfolio",
  bucket_pct: "portfolio",
  pnl_pct_from_entry: "portfolio",
};

function fields(rule: AlertRule): RuleField[] {
  const conditions = "all" in rule.condition ? rule.condition.all : rule.condition.any;
  return conditions.map((condition) => condition.field);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function collectRuleObservations(input: {
  rules: unknown;
  provider: MarketDataProvider;
  now?: Date;
  portfolioReport?: HealthReport;
  staleAfterMarketHours?: number;
}): Promise<{
  observations: Record<string, SymbolObservations>;
  providerCalls: ProviderCall[];
  failures: string[];
}> {
  const rules = RulesFile.parse(input.rules).filter((rule) => rule.status === "active");
  const now = input.now ?? new Date();
  const staleAfter = input.staleAfterMarketHours ?? 30;
  const observations: Record<string, SymbolObservations> = {};
  const providerCalls: ProviderCall[] = [];
  const failures: string[] = [];
  const rulesBySymbol = new Map<string, Set<RuleField>>();
  for (const rule of rules) {
    const existing = rulesBySymbol.get(rule.symbol) ?? new Set<RuleField>();
    fields(rule).forEach((field) => existing.add(field));
    rulesBySymbol.set(rule.symbol, existing);
  }

  for (const [symbol, requested] of rulesBySymbol) {
    const symbolObservations: SymbolObservations = {};
    if (requested.has("price")) {
      const endpoint = `quote/${symbol}`;
      try {
        const quotes = await input.provider.getQuotes([symbol]);
        const quote = quotes.find((candidate) => candidate.symbol === symbol);
        if (!quote) throw new Error("provider returned no matching quote");
        symbolObservations.price = {
          value: quote.price,
          currency: quote.currency,
          observedAt: quote.asOf,
          source: quote.source,
          stale: marketAgeHours(Date.parse(quote.asOf), now.getTime()) > staleAfter,
        };
        providerCalls.push({ provider: input.provider.name, endpoint, ok: true, cached: false });
      } catch (error: unknown) {
        providerCalls.push({ provider: input.provider.name, endpoint, ok: false, cached: false });
        failures.push(`${symbol} quote: ${errorMessage(error)}`);
      }
    }

    if ([...requested].some((field) => RULE_FIELD_SOURCE[field] === "fundamentals")) {
      const endpoint = `fundamentals/${symbol}`;
      try {
        const fundamentals = await input.provider.getFundamentals([symbol]);
        const value = fundamentals.find((candidate) => candidate.symbol === symbol);
        if (!value) throw new Error("provider returned no matching fundamentals");
        const stale = marketAgeHours(Date.parse(value.asOf), now.getTime()) > staleAfter;
        if (value.peTrailing !== null) symbolObservations.pe = { value: value.peTrailing, observedAt: value.asOf, source: value.source, stale };
        if (value.marketCap !== null) symbolObservations.market_cap = { value: value.marketCap, currency: value.marketCapCurrency, observedAt: value.asOf, source: value.source, stale };
        if (value.nextEarningsDate !== null) {
          const earningsAt = Date.parse(`${value.nextEarningsDate}T00:00:00Z`);
          symbolObservations.days_to_earnings = { value: Math.ceil((earningsAt - now.getTime()) / 86_400_000), observedAt: value.asOf, source: value.source, stale };
        }
        providerCalls.push({ provider: input.provider.name, endpoint, ok: true, cached: false });
      } catch (error: unknown) {
        providerCalls.push({ provider: input.provider.name, endpoint, ok: false, cached: false });
        failures.push(`${symbol} fundamentals: ${errorMessage(error)}`);
      }
    }

    const report = input.portfolioReport;
    const position = report?.positions.find((candidate) => candidate.symbol === symbol);
    if (report && position) {
      const stale = marketAgeHours(Date.parse(report.dataAsOf), now.getTime()) > staleAfter;
      const shared = { observedAt: report.dataAsOf, source: `portfolio-health:${report.runId}`, stale };
      if (requested.has("position_pct")) symbolObservations.position_pct = { value: position.weight * 100, ...shared };
      if (requested.has("bucket_pct")) symbolObservations.bucket_pct = { value: (report.bucketWeights[position.bucket] ?? 0) * 100, ...shared };
      if (requested.has("pnl_pct_from_entry") && position.unrealizedPnl !== null) {
        const cost = position.value - position.unrealizedPnl;
        if (cost > 0) symbolObservations.pnl_pct_from_entry = { value: position.unrealizedPnl / cost * 100, ...shared };
      }
    }
    if (Object.keys(symbolObservations).length > 0) observations[symbol] = symbolObservations;
    for (const field of requested) {
      const providerKind = RULE_FIELD_SOURCE[field] === "portfolio" ? null : RULE_FIELD_SOURCE[field];
      const providerAlreadyFailed = providerKind !== null && failures.some((failure) => failure.startsWith(`${symbol} ${providerKind}:`));
      if (symbolObservations[field] === undefined && !providerAlreadyFailed) failures.push(`${symbol} ${field}: observation unavailable`);
    }
  }

  return { observations, providerCalls, failures };
}

export async function runMonitoringCycle(input: {
  rules: unknown;
  provider: MarketDataProvider;
  adapter: NotificationAdapter;
  alertLogPath: string;
  runId: string;
  now?: Date;
  portfolioReport?: HealthReport;
  staleAfterMarketHours?: number;
  dedupWindowMs: number;
  retry?: { maxAttempts: number; baseDelayMs: number };
}) {
  const now = input.now ?? new Date();
  const collected = await collectRuleObservations(input);
  const alerts = evaluateAlertRules({
    rules: input.rules,
    observations: collected.observations,
    runId: input.runId,
    generatedAt: now.toISOString(),
  });
  let created = 0;
  for (const alert of alerts) {
    const claim = await claimAlertEvent(input.alertLogPath, alert, input.dedupWindowMs);
    if (claim.created) created += 1;
  }

  let delivered = 0;
  const deliveryFailures: string[] = [];
  const deliveries = await claimPendingAlertDeliveries(input.alertLogPath, {
    claimedAt: now.toISOString(),
    adapter: input.adapter.name,
    leaseMs: 5 * 60_000,
  });
  for (const event of deliveries) {
    try {
      await deliverWithRetry(input.adapter, event, input.retry ?? { maxAttempts: 3, baseDelayMs: 500 });
      await markAlertDelivery(input.alertLogPath, event.eventId, {
        attemptedAt: now.toISOString(), adapter: input.adapter.name, ok: true, error: null,
      });
      delivered += 1;
    } catch (error: unknown) {
      const message = errorMessage(error);
      await markAlertDelivery(input.alertLogPath, event.eventId, {
        attemptedAt: now.toISOString(), adapter: input.adapter.name, ok: false, error: message,
      });
      deliveryFailures.push(`${event.eventId}: ${message}`);
    }
  }
  return {
    matched: alerts.length,
    created,
    delivered,
    deliveryFailures,
    providerCalls: collected.providerCalls,
    providerFailures: collected.failures,
  };
}
