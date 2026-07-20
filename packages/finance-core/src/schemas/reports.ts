import { z } from "zod";
import { CurrencyCode, IsoTimestamp, RunId } from "./common.js";
import { RiskLimits } from "./risk-limits.js";

/**
 * Report-type-specific schemas (ARCHITECTURE §10). A stale-data alert does not
 * need a bear case; a valuation does. Validators check the right fields per type.
 */

const reportBase = {
  generatedAt: IsoTimestamp,
  /** every calculation in the report must be reproducible from this run */
  runId: RunId,
  dataAsOf: IsoTimestamp,
  sources: z.array(z.string().min(1)).min(1),
  disclaimer: z.string().min(1),
} as const;

const scenario = z
  .object({
    impliedValue: z.number().finite(),
    currency: CurrencyCode,
  })
  .strict();

const DcfReportAssumption = z
  .object({
    growthRate: z.number().finite(),
    terminalGrowthRate: z.number().finite(),
    discountRate: z.number().finite(),
  })
  .strict();

const DcfReportAssumptions = z
  .object({
    forecastYears: z.number().int().positive(),
    bear: DcfReportAssumption,
    base: DcfReportAssumption,
    bull: DcfReportAssumption,
  })
  .strict();

const DcfSensitivityPoint = z
  .object({
    discountRate: z.number().finite(),
    terminalGrowthRate: z.number().finite(),
    impliedValuePerShare: z.number().finite(),
  })
  .strict();

const EvidenceValue = z.discriminatedUnion("measurementType", [
  z
    .object({
      measurementType: z.enum(["monetary", "perShare"]),
      value: z.number().finite(),
      unit: z.string().min(1),
      currency: CurrencyCode,
    })
    .strict(),
  z
    .object({
      measurementType: z.enum(["percentage", "count", "other"]),
      value: z.number().finite(),
      unit: z.string().min(1),
      currency: z.null(),
    })
    .strict(),
]);

export const SourceEvidence = z
  .object({
    claim: z.string().min(1),
    /** null for genuinely non-numeric claims; numeric claims carry unit/currency structurally */
    value: EvidenceValue.nullable(),
    source: z.string().min(1),
    sourceUrl: z.string().url(),
    asOf: IsoTimestamp,
  })
  .strict();

export const CalculationReference = z
  .object({
    runId: RunId,
    calculationType: z.enum(["twoStageDcf", "optionPayoff"]),
    inputHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .strict();

const researchScenario = z
  .object({
    narrative: z.string().min(1),
    impliedValue: z.number().finite(),
    currency: CurrencyCode,
    calculationRunId: RunId,
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
  .strict()
  .superRefine((discipline, context) => {
    if (discipline.fairValueRange !== null && discipline.fairValueRange[0] > discipline.fairValueRange[1]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fairValueRange"],
        message: "fair value range must be ordered low to high",
      });
    }
    if (
      discipline.attractiveBelow !== null &&
      discipline.fairValueRange !== null &&
      discipline.attractiveBelow > discipline.fairValueRange[0]
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attractiveBelow"],
        message: "attractive threshold must not exceed the fair-value range floor",
      });
    }
    if (
      discipline.tooOptimisticAbove !== null &&
      discipline.fairValueRange !== null &&
      discipline.tooOptimisticAbove < discipline.fairValueRange[1]
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tooOptimisticAbove"],
        message: "too-optimistic threshold must not be below the fair-value range ceiling",
      });
    }
  });

export const ValuationReport = z
  .object({
    ...reportBase,
    schemaVersion: z.literal(2),
    reportType: z.literal("valuationReport"),
    symbol: z.string().min(1),
    assumptions: DcfReportAssumptions,
    bull: scenario,
    base: scenario,
    bear: scenario,
    sensitivity: z.array(DcfSensitivityPoint).min(1),
    risks: z.array(z.string()).min(1),
    discipline: DisciplineBlock,
    unknowns: z.array(z.string()),
    calculation: CalculationReference,
  })
  .strict()
  .superRefine((report, context) => {
    if (
      report.calculation.calculationType !== "twoStageDcf" ||
      report.calculation.runId !== report.runId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["calculation"],
        message: "valuation must map to its twoStageDcf calculation run",
      });
    }
  });

export const StockResearchReport = z
  .object({
    ...reportBase,
    schemaVersion: z.literal(1),
    reportType: z.literal("stockResearchReport"),
    symbol: z.string().trim().min(1),
    facts: z.array(SourceEvidence).min(1),
    thesis: z.string().min(1),
    assumptions: DcfReportAssumptions,
    scenarios: z
      .object({ bear: researchScenario, base: researchScenario, bull: researchScenario })
      .strict(),
    calculations: z.tuple([CalculationReference]),
    risks: z.array(z.string().min(1)).min(1),
    invalidationConditions: z.array(z.string().min(1)).min(1),
    unknowns: z.array(z.string().min(1)),
    discipline: DisciplineBlock,
  })
  .strict()
  .superRefine((report, context) => {
    const calculationRunIds = new Set(report.calculations.map((calculation) => calculation.runId));
    for (const name of ["bear", "base", "bull"] as const) {
      if (!calculationRunIds.has(report.scenarios[name].calculationRunId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenarios", name, "calculationRunId"],
          message: "scenario calculationRunId must have a matching calculation reference",
        });
      }
    }
  });

const EarningsMetric = z
  .object({
    name: z.string().min(1),
    actual: z
      .object({
        measurementType: z.enum(["monetary", "perShare", "percentage", "count", "other"]),
        value: z.number().finite(),
        unit: z.string().min(1),
        currency: CurrencyCode.nullable(),
        source: z.string().min(1),
        sourceUrl: z.string().url(),
        asOf: IsoTimestamp,
      })
      .strict(),
    expected: z
      .object({
        measurementType: z.enum(["monetary", "perShare", "percentage", "count", "other"]),
        value: z.number().finite(),
        unit: z.string().min(1),
        currency: CurrencyCode.nullable(),
        source: z.string().min(1),
        sourceUrl: z.string().url(),
        asOf: IsoTimestamp,
      })
      .strict(),
  })
  .strict()
  .superRefine((metric, context) => {
    for (const name of ["actual", "expected"] as const) {
      const observation = metric[name];
      const currencyRequired = ["monetary", "perShare"].includes(observation.measurementType);
      if (currencyRequired !== (observation.currency !== null)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name, "currency"],
          message: currencyRequired
            ? "monetary and per-share observations require currency"
            : "non-monetary observations must use null currency",
        });
      }
    }
  });

export const EarningsReport = z
  .object({
    ...reportBase,
    schemaVersion: z.literal(1),
    reportType: z.literal("earningsReport"),
    symbol: z.string().trim().min(1),
    period: z.string().min(1),
    metrics: z.array(EarningsMetric).min(1),
    guidance: z.array(SourceEvidence).min(1),
    qualityOfBeat: z.string().min(1),
    thesisImpact: z.string().min(1),
    risks: z.array(z.string().min(1)).min(1),
    invalidationConditions: z.array(z.string().min(1)).min(1),
    unknowns: z.array(z.string().min(1)),
    discipline: DisciplineBlock,
  })
  .strict();

const SourcedPrice = z
  .object({
    value: z.number().finite().positive(),
    currency: CurrencyCode,
    source: z.string().min(1),
    sourceUrl: z.string().url(),
    asOf: IsoTimestamp,
  })
  .strict();

export const OptionsReport = z
  .object({
    ...reportBase,
    schemaVersion: z.literal(1),
    reportType: z.literal("optionsReport"),
    symbol: z.string().trim().min(1),
    strategy: z.enum(["coveredCall", "longCall"]),
    underlyingPrice: SourcedPrice,
    terms: z
      .object({
        strike: z.number().finite().positive(),
        premiumPerShare: z.number().finite().nonnegative(),
        contracts: z.number().int().positive(),
        contractMultiplier: z.number().int().positive(),
        expiry: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine(
            (value) =>
              !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
              new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
            "invalid expiry date"
          ),
        currency: CurrencyCode,
      })
      .strict(),
    payoff: z
      .object({
        breakEven: z.number().finite(),
        maxProfit: z.number().finite().nullable(),
        maxLoss: z.number().finite().nonnegative(),
        annualizedPremiumYield: z.number().finite().nullable(),
        calculationRunId: RunId,
      })
      .strict(),
    calculation: CalculationReference,
    assumptions: z.array(z.string().min(1)).min(1),
    risks: z.array(z.string().min(1)).min(1),
    assignmentRisk: z.string().min(1),
    unknowns: z.array(z.string().min(1)),
    guidance: z.string().regex(/observation, not an instruction/i),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.underlyingPrice.currency !== report.terms.currency) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["terms", "currency"],
        message: "option terms currency must equal underlying price currency",
      });
    }
    if (
      report.calculation.calculationType !== "optionPayoff" ||
      report.calculation.runId !== report.payoff.calculationRunId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["calculation"],
        message: "payoff must map to the referenced optionPayoff calculation run",
      });
    }
  });

export const PortfolioHealthReport = z
  .object({
    ...reportBase,
    schemaVersion: z.literal(2),
    reportType: z.literal("portfolioHealthReport"),
    valuationCurrency: CurrencyCode,
    totalValue: z.number().finite(),
    positions: z.array(
      z
        .object({
          symbol: z.string().min(1),
          bucket: z.enum(["individual", "etf", "crypto"]),
          quantity: z.number().finite().nonnegative(),
          averageCost: z.number().finite().nonnegative().nullable(),
          costCurrency: CurrencyCode,
          price: z.number().finite().positive(),
          quoteCurrency: CurrencyCode,
          quoteAsOf: IsoTimestamp,
          source: z.string().min(1),
          value: z.number().finite(),
          weight: z.number().finite(),
          unrealizedPnl: z.number().finite().nullable(),
        })
        .strict()
    ),
    cash: z.record(CurrencyCode, z.number().finite()),
    fxRates: z.array(
      z
        .object({
          pair: z.string().regex(/^[A-Z]{6}$/),
          rate: z.number().finite().positive(),
          asOf: IsoTimestamp,
          source: z.string().min(1),
        })
        .strict()
    ),
    riskLimits: RiskLimits,
    healthContext: z.object({ emergencyFund: z.number().finite().nonnegative() }).strict(),
    bucketWeights: z.record(z.string(), z.number()),
    concentrationFlags: z.array(z.string()),
    currencyExposure: z.record(z.string(), z.number()),
    staleQuotes: z.array(z.string()),
    /** missing quotes, unknown cost bases — stated, never silently skipped */
    dataGaps: z.array(z.string()),
    policyBreaches: z.array(z.string()),
    suggestedActions: z.array(z.string()),
  })
  .strict();

export const MonitorAlert = z
  .object({
    ...reportBase,
    schemaVersion: z.literal(1),
    reportType: z.literal("monitorAlert"),
    ruleId: z.string().min(1),
    symbol: z.string().min(1),
    condition: z.string().min(1),
    observedValue: z.number().finite(),
    threshold: z.number().finite(),
    /** null for ratios/counts; structured currency for monetary observations */
    currency: CurrencyCode.nullable(),
    observedAt: IsoTimestamp,
    stale: z.boolean(),
    severity: z.enum(["informational", "attention", "urgent"]),
    /** "observation, not an instruction to trade" framing is mandatory */
    guidance: z.string().min(1),
  })
  .strict();

export const DigestBudgetLimits = z.object({
  maxEvents: z.number().int().positive(), maxInputChars: z.number().int().positive(), maxOutputChars: z.number().int().positive(),
}).strict();

export const DailyDigestV1 = z.object({
  ...reportBase, schemaVersion: z.literal(1), reportType: z.literal("dailyDigest"),
  events: z.array(z.object({ symbol: z.string().nullable(), whatChanged: z.string().min(1), whyItMatters: z.string().min(1), holdingsAffected: z.array(z.string()), interpretation: z.string().optional(), source: z.string().min(1) }).strict()),
  noActionNeeded: z.boolean(),
}).strict();

export const DailyDigest = z
  .object({
    ...reportBase,
    schemaVersion: z.literal(2),
    reportType: z.literal("dailyDigest"),
    cadence: z.enum(["daily", "weekly"]),
    events: z.array(
      z
        .object({
          eventId: z.string().min(1),
          publishedAt: IsoTimestamp,
          scope: z.enum(["asset", "macro"]),
          symbols: z.array(z.string().min(1)),
          headline: z.string().min(1),
          facts: z.string().min(1),
          thesisImpact: z.enum(["review-required", "context-only"]),
          classificationReason: z.string().min(1),
          holdingsAffected: z.array(z.string()),
          interpretation: z.string().min(1).nullable(),
          source: z.object({ publisher: z.string().min(1), url: z.string().url(), rank: z.enum(["original", "official", "secondary"]) }).strict(),
        })
        .strict()
    ),
    summary: z.string().min(1).nullable(),
    summaryClaims: z.array(z.object({ text: z.string().min(1), eventIds: z.array(z.string().min(1)).min(1) }).strict()),
    budget: z.object({
      ...DigestBudgetLimits.shape,
      eventsUsed: z.number().int().nonnegative(),
      inputChars: z.number().int().nonnegative(),
      outputChars: z.number().int().nonnegative(),
      maxTokens: z.number().int().positive().nullable(),
      inputTokens: z.number().int().nonnegative().nullable(),
      outputTokens: z.number().int().nonnegative().nullable(),
    }).strict(),
    noActionNeeded: z.boolean(),
  })
  .strict()
  .superRefine((digest, context) => {
    if ((!digest.events.some((event) => event.thesisImpact === "review-required")) !== digest.noActionNeeded) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["noActionNeeded"], message: "noActionNeeded must reflect whether thesis review is required" });
    }
    if (digest.budget.outputChars > digest.budget.maxOutputChars || digest.budget.inputChars > digest.budget.maxInputChars) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["budget"], message: "digest exceeded configured budget" });
    }
    if (digest.budget.maxTokens !== null && digest.budget.outputTokens !== null && digest.budget.outputTokens > digest.budget.maxTokens) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["budget", "outputTokens"], message: "digest exceeded configured token budget" });
    }
    const eventIds = new Set(digest.events.map((event) => event.eventId));
    for (const claim of digest.summaryClaims) if (claim.eventIds.some((eventId) => !eventIds.has(eventId))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["summaryClaims"], message: "summary claim references an unknown event" });
    }
    if ((digest.summary === null) !== (digest.summaryClaims.length === 0)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["summaryClaims"], message: "summaries require claim-to-event mappings" });
    }
  });

export const Report = z.union([
  StockResearchReport,
  EarningsReport,
  OptionsReport,
  ValuationReport,
  PortfolioHealthReport,
  MonitorAlert,
  DailyDigest,
  DailyDigestV1,
]);
export type Report = z.infer<typeof Report>;

export const ReportType = z.enum([
  "stockResearchReport",
  "earningsReport",
  "optionsReport",
  "valuationReport",
  "portfolioHealthReport",
  "monitorAlert",
  "dailyDigest",
]);
export type ReportType = z.infer<typeof ReportType>;

const reportSchemas: Record<ReportType, z.ZodTypeAny> = {
  stockResearchReport: StockResearchReport,
  earningsReport: EarningsReport,
  optionsReport: OptionsReport,
  valuationReport: ValuationReport,
  portfolioHealthReport: PortfolioHealthReport,
  monitorAlert: MonitorAlert,
  dailyDigest: z.union([DailyDigest, DailyDigestV1]),
};

export type ReportValidationResult =
  | { valid: true; report: Report }
  | { valid: false; issues: z.ZodIssue[] };

/** Runtime-neutral implementation of the reports.validate contract. */
export function validateReport(reportType: ReportType, payload: unknown): ReportValidationResult {
  const schema = reportSchemas[ReportType.parse(reportType)];
  const result = schema.safeParse(payload);
  return result.success
    ? { valid: true, report: result.data as Report }
    : { valid: false, issues: result.error.issues };
}
