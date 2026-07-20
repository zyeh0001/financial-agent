import type { RiskLimits } from "../schemas/risk-limits.js";
import type { Valuation } from "./engine.js";

/**
 * Portfolio health assessment: valuation × risk limits → mechanical findings.
 * Pure function — the CLI/MCP layer adds run IDs and persistence.
 */

export interface HealthAssessment {
  policyBreaches: string[];
  dataGaps: string[];
  suggestedActions: string[];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pp = (x: number) => `${(x * 100).toFixed(1)}pp`;

export function assessHealth(
  valuation: Valuation,
  limits: RiskLimits,
  context: { emergencyFund: number }
): HealthAssessment {
  const policyBreaches: string[] = [];
  const dataGaps: string[] = [];
  const suggestedActions: string[] = [];

  // Bucket drift vs target allocation.
  for (const [bucket, target] of Object.entries(limits.targetAllocation)) {
    if (target === undefined) continue;
    const actual = valuation.bucketWeights[bucket] ?? 0;
    const drift = actual - target;
    if (Math.abs(drift) > limits.driftTolerance) {
      const direction = drift > 0 ? "over" : "under";
      policyBreaches.push(
        `${bucket} ${pct(actual)} vs target ${pct(target)} (${pp(Math.abs(drift))} ${direction})`
      );
      suggestedActions.push(
        drift > 0
          ? `trim ${bucket} toward ${pct(target)} (policy: spec/low-conviction first, CGT-aware)`
          : `direct new savings toward ${bucket} (underweight by ${pp(Math.abs(drift))})`
      );
    }
  }

  // Single-stock concentration (engine already applies limits.singleStockMax semantics).
  for (const symbol of valuation.concentrationFlags) {
    const w = valuation.positions.find((p) => p.symbol === symbol)?.weight ?? 0;
    policyBreaches.push(`${symbol} ${pct(w)} exceeds single-stock max ${pct(limits.singleStockMax)}`);
  }

  // Speculative sleeve: named speculative symbols + the whole crypto bucket.
  const specNames = new Set(limits.speculativeSymbols);
  let specWeight = valuation.bucketWeights["crypto"] ?? 0;
  for (const p of valuation.positions) if (specNames.has(p.symbol)) specWeight += p.weight;
  if (specWeight > limits.speculativeAllocationMax) {
    policyBreaches.push(
      `speculative sleeve ${pct(specWeight)} exceeds cap ${pct(limits.speculativeAllocationMax)} — no new spec positions`
    );
  }

  // Emergency fund floor.
  if (context.emergencyFund < limits.emergencyFundFloor) {
    policyBreaches.push(
      `emergency fund ${limits.baseCurrency} ${context.emergencyFund.toLocaleString()} below floor ${limits.baseCurrency} ${limits.emergencyFundFloor.toLocaleString()}`
    );
    suggestedActions.unshift(
      `monthly surplus goes to the emergency fund (HYSA) until it reaches ${limits.baseCurrency} ${limits.emergencyFundFloor.toLocaleString()} — not to stocks`
    );
  }

  // Data gaps.
  for (const p of valuation.positions) {
    if (p.unrealizedPnl === null) dataGaps.push(`${p.symbol}: cost basis unknown — unrealized P&L unavailable`);
  }
  for (const s of valuation.staleQuotes) dataGaps.push(`${s}: quote is stale`);

  return { policyBreaches, dataGaps, suggestedActions };
}
