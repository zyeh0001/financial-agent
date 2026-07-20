import { DcfCalculationRecord } from "./valuation.js";
import { StockResearchReport } from "../schemas/reports.js";

export interface StockResearchReportRequest {
  calculation: unknown;
  facts: unknown[];
  thesis: string;
  scenarioNarratives: { bear: string; base: string; bull: string };
  risks: string[];
  invalidationConditions: string[];
  unknowns: string[];
  nextDataPointToWatch: string;
  disclaimer?: string;
}

/** Build a complete stock report whose valuation numbers are copied only from a parsed calculation. */
export function buildStockResearchReport(request: StockResearchReportRequest) {
  const calculation = DcfCalculationRecord.parse(request.calculation);
  const { input, result } = calculation;
  const bearValue = result.scenarios.bear.impliedValuePerShare;
  const baseValue = result.scenarios.base.impliedValuePerShare;
  const bullValue = result.scenarios.bull.impliedValuePerShare;
  if (!(bearValue <= baseValue && baseValue <= bullValue)) {
    throw new Error("DCF scenario values must be ordered bear <= base <= bull for a stock report");
  }
  const facts = request.facts as Array<{ sourceUrl?: string }>;
  const sources = [
    ...facts.flatMap((fact) => (fact.sourceUrl === undefined ? [] : [fact.sourceUrl])),
    input.freeCashFlow.source,
    input.netDebt.source,
    input.sharesOutstanding.source,
  ].filter((source, index, all) => all.indexOf(source) === index);

  return StockResearchReport.parse({
    schemaVersion: 1,
    reportType: "stockResearchReport",
    generatedAt: calculation.generatedAt,
    runId: calculation.runId,
    dataAsOf: input.dataAsOf,
    sources,
    disclaimer: request.disclaimer ?? "Research, not licensed financial advice.",
    symbol: input.symbol,
    facts: request.facts,
    thesis: request.thesis,
    assumptions: {
      forecastYears: input.forecastYears,
      bear: input.scenarios.bear,
      base: input.scenarios.base,
      bull: input.scenarios.bull,
    },
    scenarios: {
      bear: {
        narrative: request.scenarioNarratives.bear,
        impliedValue: bearValue,
        currency: input.currency,
        calculationRunId: calculation.runId,
      },
      base: {
        narrative: request.scenarioNarratives.base,
        impliedValue: baseValue,
        currency: input.currency,
        calculationRunId: calculation.runId,
      },
      bull: {
        narrative: request.scenarioNarratives.bull,
        impliedValue: bullValue,
        currency: input.currency,
        calculationRunId: calculation.runId,
      },
    },
    calculations: [
      {
        runId: calculation.runId,
        calculationType: calculation.calculationType,
        inputHash: calculation.inputHash,
      },
    ],
    risks: request.risks,
    invalidationConditions: request.invalidationConditions,
    unknowns: request.unknowns,
    discipline: {
      attractiveBelow: bearValue,
      fairValueRange: [bearValue, bullValue],
      tooOptimisticAbove: bullValue,
      thesisInvalidatedIf: request.invalidationConditions,
      nextDataPointToWatch: request.nextDataPointToWatch,
    },
  });
}
