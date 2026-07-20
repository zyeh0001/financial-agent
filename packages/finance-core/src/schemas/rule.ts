import { z } from "zod";
import { CurrencyCode } from "./common.js";

/**
 * Alert rules — the ONLY rule shape in Phase 1.
 *
 * There is deliberately no `mode`, no `action`, no order sizing, no side, and
 * `.strict()` rejects any such field at parse time (SECURITY §1: execution is
 * absent, not disabled). If execution is ever designed (broker ladder L3+), it
 * arrives as a NEW schema with its own review — never by widening this one.
 *
 * Engine inputs decided 2026-07-17: live quote, portfolio-derived, fundamentals.
 * No time-series fields (no trailing stops in Phase 1), no news/sentiment.
 */

export const RuleField = z.enum([
  // live quote
  "price",
  // portfolio-derived
  "position_pct",
  "bucket_pct",
  "pnl_pct_from_entry",
  // fundamentals
  "pe",
  "market_cap",
  "days_to_earnings",
]);
export type RuleField = z.infer<typeof RuleField>;

export const RuleOperator = z.enum(["lt", "lte", "gt", "gte"]);
export type RuleOperator = z.infer<typeof RuleOperator>;

export const RuleCondition = z
  .object({
    field: RuleField,
    operator: RuleOperator,
    value: z.number().finite(),
    /** required for `price`; meaningless for ratio/percentage fields */
    currency: CurrencyCode.optional(),
  })
  .strict();
export type RuleCondition = z.infer<typeof RuleCondition>;

/** Flat, one level: all-of (AND) or any-of (OR). No nesting until a real rule needs it. */
const ConditionGroup = z.union([
  z.object({ all: z.array(RuleCondition).min(1) }).strict(),
  z.object({ any: z.array(RuleCondition).min(1) }).strict(),
]);

export const AlertRule = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    schemaVersion: z.literal(1),
    status: z.enum(["active", "paused"]),
    symbol: z.string().min(1),
    condition: ConditionGroup,
    notification: z
      .object({
        severity: z.enum(["informational", "attention", "urgent"]),
        messageTemplate: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export type AlertRule = z.infer<typeof AlertRule>;

export const RulesFile = z.array(AlertRule).superRefine((rules, ctx) => {
  const seen = new Set<string>();
  for (const r of rules) {
    if (seen.has(r.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate rule id: ${r.id}` });
    }
    seen.add(r.id);
  }
});
