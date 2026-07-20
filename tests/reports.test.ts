import { describe, expect, it } from "vitest";
import {
  buildStockResearchReport,
  runDcfValuation,
  runOptionPayoff,
  validateReport,
  validateReportWithCalculations,
} from "@financial-agent/finance-core";

const completeStockReport = {
  schemaVersion: 1,
  reportType: "stockResearchReport",
  generatedAt: "2026-07-20T04:00:00Z",
  runId: "run_20260720T040000Z_a3f1",
  dataAsOf: "2026-07-19T00:00:00Z",
  sources: ["https://www.sec.gov/Archives/example"],
  disclaimer: "Research, not licensed financial advice.",
  symbol: "EXAMPLE",
  facts: [
    {
      claim: "Free cash flow was USD 100m.",
      value: { measurementType: "monetary", value: 100, unit: "millions", currency: "USD" },
      source: "Example annual filing",
      sourceUrl: "https://www.sec.gov/Archives/example",
      asOf: "2026-07-19T00:00:00Z",
    },
  ],
  thesis: "Cash generation can compound if retention remains durable.",
  assumptions: {
    forecastYears: 5,
    bear: { growthRate: 0, terminalGrowthRate: 0.01, discountRate: 0.12 },
    base: { growthRate: 0.05, terminalGrowthRate: 0.02, discountRate: 0.1 },
    bull: { growthRate: 0.08, terminalGrowthRate: 0.03, discountRate: 0.08 },
  },
  scenarios: {
    bear: {
      narrative: "Growth stalls.",
      impliedValue: 80,
      currency: "USD",
      calculationRunId: "run_20260720T040000Z_a3f1",
    },
    base: {
      narrative: "Growth normalises.",
      impliedValue: 100,
      currency: "USD",
      calculationRunId: "run_20260720T040000Z_a3f1",
    },
    bull: {
      narrative: "Margins expand.",
      impliedValue: 125,
      currency: "USD",
      calculationRunId: "run_20260720T040000Z_a3f1",
    },
  },
  calculations: [
    {
      runId: "run_20260720T040000Z_a3f1",
      calculationType: "twoStageDcf",
      inputHash: `sha256:${"a".repeat(64)}`,
    },
  ],
  risks: ["Customer concentration could compress margins."],
  invalidationConditions: ["Free cash flow declines for two consecutive years."],
  unknowns: ["The durability of current pricing is unverified."],
  discipline: {
    attractiveBelow: 80,
    fairValueRange: [90, 110],
    tooOptimisticAbove: 125,
    thesisInvalidatedIf: ["Free cash flow declines for two consecutive years."],
    nextDataPointToWatch: "Next annual filing.",
  },
};

describe("report validators", () => {
  it("accepts a complete stock report with sourced facts and reproducible numbers", () => {
    const validation = validateReport("stockResearchReport", completeStockReport);
    expect(validation).toMatchObject({ valid: true });
    const fact = completeStockReport.facts[0]!;
    expect(
      validateReport("stockResearchReport", {
        ...completeStockReport,
        facts: [{ ...fact, value: { ...fact.value, currency: null } }],
      })
    ).toMatchObject({ valid: false });
  });

  it("accepts an earnings report that separates actuals, expectations, and guidance", () => {
    const report = {
      schemaVersion: 1,
      reportType: "earningsReport",
      generatedAt: "2026-07-20T04:10:00Z",
      runId: "run_20260720T041000Z_b4c2",
      dataAsOf: "2026-07-19T00:00:00Z",
      sources: ["https://www.sec.gov/Archives/example"],
      disclaimer: "Research, not licensed financial advice.",
      symbol: "EXAMPLE",
      period: "FY2026 Q2",
      metrics: [
        {
          name: "Revenue",
          actual: {
            measurementType: "monetary",
            value: 110,
            unit: "millions",
            currency: "USD",
            source: "Example quarterly filing",
            sourceUrl: "https://www.sec.gov/Archives/example",
            asOf: "2026-07-19T00:00:00Z",
          },
          expected: {
            measurementType: "monetary",
            value: 100,
            unit: "millions",
            currency: "USD",
            source: "Example consensus snapshot",
            sourceUrl: "https://example.com/consensus",
            asOf: "2026-07-18T00:00:00Z",
          },
        },
      ],
      guidance: [
        {
          claim: "Management maintained full-year revenue guidance.",
          value: null,
          source: "Example quarterly filing",
          sourceUrl: "https://www.sec.gov/Archives/example",
          asOf: "2026-07-19T00:00:00Z",
        },
      ],
      qualityOfBeat: "Revenue beat without a reduction in future guidance.",
      thesisImpact: "Supports, but does not prove, the retention assumption.",
      risks: ["One quarter may not establish a trend."],
      invalidationConditions: ["Revenue retention falls below 90%."],
      unknowns: ["Consensus methodology was not independently verified."],
      discipline: completeStockReport.discipline,
    };

    expect(validateReport("earningsReport", report)).toMatchObject({ valid: true });
    expect(
      validateReport("earningsReport", {
        ...report,
        metrics: [
          {
            ...report.metrics[0],
            actual: { ...report.metrics[0]!.actual, currency: null },
          },
        ],
      })
    ).toMatchObject({ valid: false });
    expect(
      validateReport("earningsReport", {
        ...report,
        metrics: [
          {
            ...report.metrics[0],
            expected: { ...report.metrics[0]!.expected, currency: null },
          },
        ],
      })
    ).toMatchObject({ valid: false });
  });

  it("accepts an analysis-only options report backed by a payoff run", () => {
    const calculation = runOptionPayoff({
      runId: "run_20260720T042000Z_c5d3",
      generatedAt: "2026-07-20T04:20:00Z",
      input: {
        schemaVersion: 1,
        strategy: "coveredCall",
        symbol: "EXAMPLE",
        currency: "USD",
        dataAsOf: "2026-07-19T00:00:00Z",
        underlyingPrice: {
          value: 100,
          currency: "USD",
          asOf: "2026-07-19T00:00:00Z",
          source: "Example quote",
        },
        strike: 110,
        premiumPerShare: 5,
        contracts: 1,
        contractMultiplier: 100,
        daysToExpiry: 365,
        expiryPrices: [90, 110, 120],
      },
    });
    const report = {
      schemaVersion: 1,
      reportType: "optionsReport",
      generatedAt: "2026-07-20T04:20:00Z",
      runId: "run_20260720T042000Z_c5d3",
      dataAsOf: "2026-07-19T00:00:00Z",
      sources: ["https://example.com/options-chain"],
      disclaimer: "Research, not licensed financial advice.",
      symbol: "EXAMPLE",
      strategy: "coveredCall",
      underlyingPrice: {
        value: 100,
        currency: "USD",
        source: "Example quote",
        sourceUrl: "https://example.com/options-chain",
        asOf: "2026-07-19T00:00:00Z",
      },
      terms: {
        strike: 110,
        premiumPerShare: 5,
        contracts: 1,
        contractMultiplier: 100,
        expiry: "2027-07-19",
        currency: "USD",
      },
      payoff: {
        breakEven: 95,
        maxProfit: 1500,
        maxLoss: 9500,
        annualizedPremiumYield: 0.05,
        calculationRunId: "run_20260720T042000Z_c5d3",
      },
      calculation: {
        runId: "run_20260720T042000Z_c5d3",
        calculationType: "optionPayoff",
        inputHash: calculation.inputHash,
      },
      assumptions: ["The position is held through expiry."],
      risks: ["The shares retain nearly all downside below break-even."],
      assignmentRisk: "Early assignment is possible around distributions.",
      unknowns: ["Live bid/ask depth was not available."],
      guidance: "Observation, not an instruction to trade.",
    };

    expect(validateReport("optionsReport", report)).toMatchObject({ valid: true });
    expect(validateReportWithCalculations("optionsReport", report, [calculation])).toMatchObject({
      valid: true,
    });
    expect(
      validateReportWithCalculations(
        "optionsReport",
        { ...report, payoff: { ...report.payoff, maxLoss: 1 } },
        [calculation]
      )
    ).toMatchObject({ valid: false });
    expect(
      validateReportWithCalculations(
        "optionsReport",
        report,
        [{ ...calculation, result: { ...calculation.result, maxLoss: 1 } }]
      )
    ).toMatchObject({ valid: false });
  });

  it("requires valuation reports to identify the exact calculation inputs", () => {
    const calculation = runDcfValuation({
      runId: "run_20260720T043000Z_d6e4",
      generatedAt: "2026-07-20T04:30:00Z",
      input: {
        schemaVersion: 1,
        symbol: "EXAMPLE",
        currency: "USD",
        dataAsOf: "2026-07-19T00:00:00Z",
        freeCashFlow: {
          value: 100,
          currency: "USD",
          asOf: "2026-07-19T00:00:00Z",
          source: "Example annual filing",
        },
        netDebt: {
          value: 0,
          currency: "USD",
          asOf: "2026-07-19T00:00:00Z",
          source: "Example annual filing",
        },
        sharesOutstanding: {
          value: 10,
          asOf: "2026-07-19T00:00:00Z",
          source: "Example annual filing",
        },
        forecastYears: completeStockReport.assumptions.forecastYears,
        scenarios: {
          bear: completeStockReport.assumptions.bear,
          base: completeStockReport.assumptions.base,
          bull: completeStockReport.assumptions.bull,
        },
        sensitivity: { discountRates: [0.1], terminalGrowthRates: [0.02] },
      },
    });
    const bearValue = calculation.result.scenarios.bear.impliedValuePerShare;
    const bullValue = calculation.result.scenarios.bull.impliedValuePerShare;
    const report = {
      schemaVersion: 2,
      reportType: "valuationReport",
      generatedAt: "2026-07-20T04:30:00Z",
      runId: "run_20260720T043000Z_d6e4",
      dataAsOf: "2026-07-19T00:00:00Z",
      sources: ["Example annual filing"],
      disclaimer: "Research, not licensed financial advice.",
      symbol: "EXAMPLE",
      assumptions: completeStockReport.assumptions,
      bull: { impliedValue: bullValue, currency: "USD" },
      base: { impliedValue: calculation.result.scenarios.base.impliedValuePerShare, currency: "USD" },
      bear: { impliedValue: bearValue, currency: "USD" },
      sensitivity: calculation.result.sensitivity,
      risks: ["Terminal value dominates the estimate."],
      discipline: {
        ...completeStockReport.discipline,
        attractiveBelow: bearValue,
        fairValueRange: [bearValue, bullValue],
        tooOptimisticAbove: bullValue,
      },
      unknowns: ["Long-run reinvestment rate is uncertain."],
      calculation: {
        runId: "run_20260720T043000Z_d6e4",
        calculationType: "twoStageDcf",
        inputHash: calculation.inputHash,
      },
    };

    expect(validateReport("valuationReport", report)).toMatchObject({ valid: true });
    expect(validateReportWithCalculations("valuationReport", report, [calculation])).toMatchObject({
      valid: true,
    });
    expect(
      validateReportWithCalculations(
        "valuationReport",
        {
          ...report,
          calculation: { ...report.calculation, inputHash: `sha256:${"c".repeat(64)}` },
        },
        [calculation]
      )
    ).toMatchObject({ valid: false });
    expect(validateReport("valuationReport", { ...report, schemaVersion: 1 })).toMatchObject({
      valid: false,
    });
  });

  it("builds stock-report values directly from the cited calculation record", () => {
    const calculation = runDcfValuation({
      runId: "run_20260720T044000Z_e7f5",
      generatedAt: "2026-07-20T04:40:00Z",
      input: {
        schemaVersion: 1,
        symbol: "EXAMPLE",
        currency: "USD",
        dataAsOf: "2026-07-19T00:00:00Z",
        freeCashFlow: {
          value: 100,
          currency: "USD",
          asOf: "2026-07-19T00:00:00Z",
          source: "https://www.sec.gov/Archives/example",
        },
        netDebt: {
          value: 0,
          currency: "USD",
          asOf: "2026-07-19T00:00:00Z",
          source: "https://www.sec.gov/Archives/example",
        },
        sharesOutstanding: {
          value: 10,
          asOf: "2026-07-19T00:00:00Z",
          source: "https://www.sec.gov/Archives/example",
        },
        forecastYears: 1,
        scenarios: {
          bear: { growthRate: -0.1, terminalGrowthRate: 0, discountRate: 0.12 },
          base: { growthRate: 0, terminalGrowthRate: 0, discountRate: 0.1 },
          bull: { growthRate: 0.1, terminalGrowthRate: 0.02, discountRate: 0.08 },
        },
        sensitivity: { discountRates: [0.1], terminalGrowthRates: [0] },
      },
    });
    const report = buildStockResearchReport({
      calculation,
      facts: completeStockReport.facts,
      thesis: completeStockReport.thesis,
      scenarioNarratives: {
        bear: "Cash flow contracts.",
        base: "Cash flow is stable.",
        bull: "Growth persists.",
      },
      risks: completeStockReport.risks,
      invalidationConditions: completeStockReport.invalidationConditions,
      unknowns: completeStockReport.unknowns,
      nextDataPointToWatch: "Next annual filing.",
    });

    expect(report.scenarios.base.impliedValue).toBe(
      calculation.result.scenarios.base.impliedValuePerShare
    );
    expect(report.discipline).toMatchObject({
      attractiveBelow: calculation.result.scenarios.bear.impliedValuePerShare,
      fairValueRange: [
        calculation.result.scenarios.bear.impliedValuePerShare,
        calculation.result.scenarios.bull.impliedValuePerShare,
      ],
      tooOptimisticAbove: calculation.result.scenarios.bull.impliedValuePerShare,
    });
    expect(validateReport("stockResearchReport", report)).toMatchObject({ valid: true });
    expect(validateReportWithCalculations("stockResearchReport", report, [calculation])).toMatchObject({
      valid: true,
    });
    expect(
      validateReportWithCalculations(
        "stockResearchReport",
        {
          ...report,
          scenarios: {
            ...report.scenarios,
            base: { ...report.scenarios.base, impliedValue: report.scenarios.base.impliedValue + 1 },
          },
        },
        [calculation]
      )
    ).toMatchObject({ valid: false });
  });
});
