import { z } from "zod";
import {
  OptionsReport,
  StockResearchReport,
  ValuationReport,
  validateReport,
  type ReportType,
  type ReportValidationResult,
} from "../schemas/reports.js";
import { DcfCalculationRecord, runDcfValuation } from "./valuation.js";
import { OptionPayoffRecord, runOptionPayoff } from "./options.js";

export const ResearchCalculationRecord = z.union([DcfCalculationRecord, OptionPayoffRecord]);
export type ResearchCalculationRecord = z.infer<typeof ResearchCalculationRecord>;

function issue(path: Array<string | number>, message: string): z.ZodIssue {
  return { code: z.ZodIssueCode.custom, path, message };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expiryDate(dataAsOf: string, daysToExpiry: number): string {
  return new Date(Date.parse(dataAsOf) + daysToExpiry * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Strict report validation: validates shape, then resolves every calculation reference
 * against the immutable record supplied by the storage/CLI adapter.
 */
export function validateReportWithCalculations(
  reportType: ReportType,
  payload: unknown,
  calculationCandidates: unknown[]
): ReportValidationResult {
  const shape = validateReport(reportType, payload);
  if (!shape.valid) return shape;
  if (!["stockResearchReport", "valuationReport", "optionsReport"].includes(reportType)) {
    return shape;
  }

  const parsedCalculations: ResearchCalculationRecord[] = [];
  const issues: z.ZodIssue[] = [];
  calculationCandidates.forEach((candidate, index) => {
    const parsed = ResearchCalculationRecord.safeParse(candidate);
    if (!parsed.success) {
      issues.push(issue(["calculations", index], "referenced calculation record is invalid"));
      return;
    }
    const recomputed =
      parsed.data.calculationType === "twoStageDcf"
        ? runDcfValuation({
            runId: parsed.data.runId,
            generatedAt: parsed.data.generatedAt,
            input: parsed.data.input,
          })
        : runOptionPayoff({
            runId: parsed.data.runId,
            generatedAt: parsed.data.generatedAt,
            input: parsed.data.input,
          });
    if (!same(parsed.data, recomputed)) {
      issues.push(
        issue(
          ["calculations", index],
          "calculation record hash or outputs do not reproduce from its stored inputs"
        )
      );
      return;
    }
    parsedCalculations.push(parsed.data);
  });
  if (issues.length > 0) return { valid: false, issues };

  if (reportType === "stockResearchReport") {
    const report = StockResearchReport.parse(shape.report);
    const reference = report.calculations.find(
      (calculation) => calculation.calculationType === "twoStageDcf"
    );
    const calculation = parsedCalculations.find(
      (candidate): candidate is z.infer<typeof DcfCalculationRecord> =>
        candidate.calculationType === "twoStageDcf" && candidate.runId === reference?.runId
    );
    if (reference === undefined || calculation === undefined) {
      return { valid: false, issues: [issue(["calculations"], "referenced DCF record was not supplied")] };
    }
    const expectedAssumptions = {
      forecastYears: calculation.input.forecastYears,
      bear: calculation.input.scenarios.bear,
      base: calculation.input.scenarios.base,
      bull: calculation.input.scenarios.bull,
    };
    if (reference.inputHash !== calculation.inputHash) issues.push(issue(["calculations", "inputHash"], "input hash does not match calculation record"));
    if (report.runId !== calculation.runId) issues.push(issue(["runId"], "report run ID does not match calculation record"));
    if (report.symbol !== calculation.input.symbol) issues.push(issue(["symbol"], "symbol does not match calculation input"));
    if (report.dataAsOf !== calculation.input.dataAsOf) issues.push(issue(["dataAsOf"], "data timestamp does not match calculation input"));
    if (!same(report.assumptions, expectedAssumptions)) issues.push(issue(["assumptions"], "DCF assumptions do not match calculation input"));
    for (const name of ["bear", "base", "bull"] as const) {
      const reportScenario = report.scenarios[name];
      const calculationScenario = calculation.result.scenarios[name];
      if (
        reportScenario.calculationRunId !== calculation.runId ||
        reportScenario.currency !== calculation.input.currency ||
        reportScenario.impliedValue !== calculationScenario.impliedValuePerShare
      ) {
        issues.push(issue(["scenarios", name], "scenario value does not match calculation record"));
      }
    }
    const expectedDiscipline = {
      attractiveBelow: calculation.result.scenarios.bear.impliedValuePerShare,
      fairValueRange: [
        calculation.result.scenarios.bear.impliedValuePerShare,
        calculation.result.scenarios.bull.impliedValuePerShare,
      ],
      tooOptimisticAbove: calculation.result.scenarios.bull.impliedValuePerShare,
    };
    if (
      report.discipline.attractiveBelow !== expectedDiscipline.attractiveBelow ||
      !same(report.discipline.fairValueRange, expectedDiscipline.fairValueRange) ||
      report.discipline.tooOptimisticAbove !== expectedDiscipline.tooOptimisticAbove
    ) {
      issues.push(issue(["discipline"], "numeric discipline thresholds do not match calculation record"));
    }
  }

  if (reportType === "valuationReport") {
    const report = ValuationReport.parse(shape.report);
    const calculation = parsedCalculations.find(
      (candidate): candidate is z.infer<typeof DcfCalculationRecord> =>
        candidate.calculationType === "twoStageDcf" && candidate.runId === report.calculation.runId
    );
    if (calculation === undefined) {
      return { valid: false, issues: [issue(["calculation"], "referenced DCF record was not supplied")] };
    }
    const expectedAssumptions = {
      forecastYears: calculation.input.forecastYears,
      bear: calculation.input.scenarios.bear,
      base: calculation.input.scenarios.base,
      bull: calculation.input.scenarios.bull,
    };
    if (report.calculation.inputHash !== calculation.inputHash) issues.push(issue(["calculation", "inputHash"], "input hash does not match calculation record"));
    if (report.symbol !== calculation.input.symbol || report.dataAsOf !== calculation.input.dataAsOf) issues.push(issue(["symbol"], "report identity does not match calculation input"));
    if (!same(report.assumptions, expectedAssumptions)) issues.push(issue(["assumptions"], "DCF assumptions do not match calculation input"));
    if (!same(report.sensitivity, calculation.result.sensitivity)) issues.push(issue(["sensitivity"], "sensitivity values do not match calculation record"));
    for (const name of ["bear", "base", "bull"] as const) {
      if (
        report[name].impliedValue !== calculation.result.scenarios[name].impliedValuePerShare ||
        report[name].currency !== calculation.input.currency
      ) {
        issues.push(issue([name], "valuation scenario does not match calculation record"));
      }
    }
    const expectedBand = [
      calculation.result.scenarios.bear.impliedValuePerShare,
      calculation.result.scenarios.bull.impliedValuePerShare,
    ];
    if (
      report.discipline.attractiveBelow !== expectedBand[0] ||
      !same(report.discipline.fairValueRange, expectedBand) ||
      report.discipline.tooOptimisticAbove !== expectedBand[1]
    ) {
      issues.push(issue(["discipline"], "numeric discipline thresholds do not match calculation record"));
    }
  }

  if (reportType === "optionsReport") {
    const report = OptionsReport.parse(shape.report);
    const calculation = parsedCalculations.find(
      (candidate): candidate is z.infer<typeof OptionPayoffRecord> =>
        candidate.calculationType === "optionPayoff" && candidate.runId === report.calculation.runId
    );
    if (calculation === undefined) {
      return { valid: false, issues: [issue(["calculation"], "referenced option payoff record was not supplied")] };
    }
    const input = calculation.input;
    const expectedTerms = {
      strike: input.strike,
      premiumPerShare: input.premiumPerShare,
      contracts: input.contracts,
      contractMultiplier: input.contractMultiplier,
      expiry: expiryDate(input.dataAsOf, input.daysToExpiry),
      currency: input.currency,
    };
    const expectedPayoff = {
      breakEven: calculation.result.breakEven,
      maxProfit: calculation.result.maxProfit,
      maxLoss: calculation.result.maxLoss,
      annualizedPremiumYield: calculation.result.annualizedPremiumYield,
      calculationRunId: calculation.runId,
    };
    if (report.calculation.inputHash !== calculation.inputHash) issues.push(issue(["calculation", "inputHash"], "input hash does not match calculation record"));
    if (report.runId !== calculation.runId || report.symbol !== input.symbol || report.strategy !== input.strategy || report.dataAsOf !== input.dataAsOf) issues.push(issue(["runId"], "report identity does not match calculation input"));
    if (
      report.underlyingPrice.value !== input.underlyingPrice.value ||
      report.underlyingPrice.currency !== input.underlyingPrice.currency ||
      report.underlyingPrice.asOf !== input.underlyingPrice.asOf ||
      report.underlyingPrice.source !== input.underlyingPrice.source
    ) {
      issues.push(issue(["underlyingPrice"], "underlying observation does not match calculation input"));
    }
    if (!same(report.terms, expectedTerms)) issues.push(issue(["terms"], "option terms do not match calculation input"));
    if (!same(report.payoff, expectedPayoff)) issues.push(issue(["payoff"], "payoff values do not match calculation record"));
  }

  return issues.length === 0 ? shape : { valid: false, issues };
}
