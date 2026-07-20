import { z } from "zod";
import {
  CurrencyCode,
  IsoTimestamp,
  MonitorAlert,
  RulesFile,
  RunId,
  type AlertRule,
  type RuleCondition,
  type RuleField,
} from "../schemas/index.js";

const Observation = z.object({
  value: z.number().finite(),
  currency: CurrencyCode.nullable().default(null),
  observedAt: IsoTimestamp,
  source: z.string().min(1),
  stale: z.boolean(),
}).strict();

export type RuleObservation = z.input<typeof Observation>;
export type SymbolObservations = Partial<Record<RuleField, RuleObservation>>;

export interface EvaluateAlertRulesInput {
  rules: unknown;
  observations: Record<string, SymbolObservations>;
  runId: string;
  generatedAt: string;
}

function compare(observed: number, operator: RuleCondition["operator"], threshold: number): boolean {
  switch (operator) {
    case "lt": return observed < threshold;
    case "lte": return observed <= threshold;
    case "gt": return observed > threshold;
    case "gte": return observed >= threshold;
  }
}

function conditionsFor(rule: AlertRule): RuleCondition[] {
  return "all" in rule.condition ? rule.condition.all : rule.condition.any;
}

function formatCondition(condition: RuleCondition): string {
  return `${condition.field} ${condition.operator} ${condition.value}${condition.currency ? ` ${condition.currency}` : ""}`;
}

/** Deterministically evaluate validated alert-only rules. No I/O and no execution concepts. */
export function evaluateAlertRules(input: EvaluateAlertRulesInput) {
  const rules = RulesFile.parse(input.rules);
  const runId = RunId.parse(input.runId);
  const generatedAt = IsoTimestamp.parse(input.generatedAt);

  return rules.flatMap((rule) => {
    if (rule.status === "paused") return [];
    const available = conditionsFor(rule).map((condition) => {
      const raw = input.observations[rule.symbol]?.[condition.field];
      if (!raw) return null;
      const observation = Observation.parse(raw);
      if (condition.currency && observation.currency !== condition.currency) {
        throw new Error(
          `${rule.id}: ${condition.field} currency mismatch; expected ${condition.currency}, received ${observation.currency ?? "none"}`
        );
      }
      return { condition, observation, matched: compare(observation.value, condition.operator, condition.value) };
    });
    const evaluated = available.filter((item): item is NonNullable<typeof item> => item !== null);
    const isAll = "all" in rule.condition;
    if (isAll && evaluated.length !== available.length) return [];
    const matched = isAll
      ? evaluated.every((item) => item.matched)
      : evaluated.some((item) => item.matched);
    if (!matched) return [];

    const headline = evaluated.find((item) => item.matched)!;
    const dataAsOf = evaluated.reduce((oldest, item) =>
      Date.parse(item.observation.observedAt) < Date.parse(oldest)
        ? item.observation.observedAt
        : oldest,
      evaluated[0]!.observation.observedAt
    );
    return [MonitorAlert.parse({
      schemaVersion: 1,
      reportType: "monitorAlert",
      generatedAt,
      runId,
      dataAsOf,
      sources: [...new Set(evaluated.map(({ observation }) => observation.source))],
      disclaimer: "Research, not licensed financial advice.",
      ruleId: rule.id,
      symbol: rule.symbol,
      condition: conditionsFor(rule).map(formatCondition).join(isAll ? " AND " : " OR "),
      observedValue: headline.observation.value,
      threshold: headline.condition.value,
      currency: headline.condition.currency ?? null,
      observedAt: headline.observation.observedAt,
      stale: evaluated.some(({ observation }) => observation.stale),
      severity: rule.notification.severity,
      guidance: "Observation, not an instruction to trade. Review the thesis and portfolio policy first.",
    })];
  });
}
