import { z } from "zod";
import { Bucket, CurrencyCode } from "./common.js";

/**
 * Machine-readable risk limits (Layer A: Investment/risk-limits.yaml).
 * Checked mechanically by the health report and (M4) the rule engine —
 * discipline as data, not chat memory. Values extracted from finances.md
 * (target allocation confirmed 2026-05-31).
 */
export const RiskLimits = z
  .object({
    schemaVersion: z.literal(1),
    baseCurrency: CurrencyCode,
    /** must sum to 1 (validated) */
    targetAllocation: z.record(Bucket, z.number().min(0).max(1)),
    /** flag a bucket when |actual − target| exceeds this (absolute, e.g. 0.05 = 5pp) */
    driftTolerance: z.number().positive().max(0.5),
    singleStockMax: z.number().positive().max(1),
    speculativeAllocationMax: z.number().positive().max(1),
    /** individual names counted as speculative (crypto bucket is always included) */
    speculativeSymbols: z.array(z.string()),
    emergencyFundFloor: z.number().nonnegative(),
    marginAllowed: z.boolean(),
    noUndefinedRiskOptions: z.boolean(),
    glidePathMonthsBeforePurchase: z.number().positive(),
  })
  .strict()
  .superRefine((limits, ctx) => {
    const sum = Object.values(limits.targetAllocation).reduce((a, b) => a + (b ?? 0), 0);
    if (Math.abs(sum - 1) > 1e-6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `targetAllocation must sum to 1, got ${sum}`,
      });
    }
  });
export type RiskLimits = z.infer<typeof RiskLimits>;
