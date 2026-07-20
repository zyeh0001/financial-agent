import { z } from "zod";
import { CurrencyCode, IsoTimestamp, RunId } from "./common.js";

/**
 * Report-type-specific schemas (ARCHITECTURE §10). A stale-data alert does not
 * need a bear case; a valuation does. Validators check the right fields per type.
 */

const reportBase = {
  schemaVersion: z.literal(1),
  generatedAt: IsoTimestamp,
  /** every calculation in the report must be reproducible from this run */
  runId: RunId,
  dataAsOf: IsoTimestamp,
  sources: z.array(z.string().min(1)).min(1),
  disclaimer: z.string().min(1),
} as const;

const scenario = z
  .object({
    assumptions: z.string().min(1),
    impliedValue: z.number().finite(),
    currency: CurrencyCode,
  })
  .strict();

/** The discipline block every stock view ends with — never bare buy/sell/hold. */
export const DisciplineBlock = z
  .object({
    attractiveBelow: z.number().finite().nullable(),
    fairValueRange: z.tuple([z.number().finite(), z.number().finite()]).nullable(),
    tooOptimisticAbove: z.number().finite().nullable(),
    thesisInvalidatedIf: z.array(z.string()).min(1),
    nextDataPointToWatch: z.string().min(1),
  })
  .strict();

export const ValuationReport = z
  .object({
    ...reportBase,
    reportType: z.literal("valuationReport"),
    symbol: z.string().min(1),
    assumptions: z.array(z.string()).min(1),
    bull: scenario,
    base: scenario,
    bear: scenario,
    sensitivity: z.string().min(1),
    risks: z.array(z.string()).min(1),
    discipline: DisciplineBlock,
    unknowns: z.array(z.string()),
  })
  .strict();

export const PortfolioHealthReport = z
  .object({
    ...reportBase,
    reportType: z.literal("portfolioHealthReport"),
    valuationCurrency: CurrencyCode,
    totalValue: z.number().finite(),
    bucketWeights: z.record(z.string(), z.number()),
    concentrationFlags: z.array(z.string()),
    currencyExposure: z.record(z.string(), z.number()),
    staleQuotes: z.array(z.string()),
    policyBreaches: z.array(z.string()),
    suggestedActions: z.array(z.string()),
  })
  .strict();

export const MonitorAlert = z
  .object({
    ...reportBase,
    reportType: z.literal("monitorAlert"),
    ruleId: z.string().min(1),
    symbol: z.string().min(1),
    condition: z.string().min(1),
    observedValue: z.number().finite(),
    threshold: z.number().finite(),
    observedAt: IsoTimestamp,
    stale: z.boolean(),
    severity: z.enum(["informational", "attention", "urgent"]),
    /** "observation, not an instruction to trade" framing is mandatory */
    guidance: z.string().min(1),
  })
  .strict();

export const DailyDigest = z
  .object({
    ...reportBase,
    reportType: z.literal("dailyDigest"),
    events: z.array(
      z
        .object({
          symbol: z.string().nullable(),
          whatChanged: z.string().min(1),
          whyItMatters: z.string().min(1),
          holdingsAffected: z.array(z.string()),
          interpretation: z.string().optional(),
          source: z.string().min(1),
        })
        .strict()
    ),
    noActionNeeded: z.boolean(),
  })
  .strict();

export const Report = z.discriminatedUnion("reportType", [
  ValuationReport,
  PortfolioHealthReport,
  MonitorAlert,
  DailyDigest,
]);
export type Report = z.infer<typeof Report>;
