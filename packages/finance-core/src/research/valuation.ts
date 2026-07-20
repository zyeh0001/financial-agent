import { z } from "zod";
import { CurrencyCode, IsoTimestamp, RunId } from "../schemas/common.js";
import { hashCalculationInput, roundCalculation } from "./reproducibility.js";

const SourcedMoney = z
  .object({
    value: z.number().finite(),
    currency: CurrencyCode,
    asOf: IsoTimestamp,
    source: z.string().min(1),
  })
  .strict();

const SourcedShareCount = z
  .object({
    value: z.number().finite().positive(),
    asOf: IsoTimestamp,
    source: z.string().min(1),
  })
  .strict();

export const DcfScenarioAssumptions = z
  .object({
    growthRate: z.number().finite().gt(-1).lte(1),
    terminalGrowthRate: z.number().finite().gt(-1).lte(0.15),
    discountRate: z.number().finite().positive().lte(1),
  })
  .strict()
  .refine((scenario) => scenario.discountRate > scenario.terminalGrowthRate, {
    message: "discountRate must be greater than terminalGrowthRate",
  });

export const DcfValuationInput = z
  .object({
    schemaVersion: z.literal(1),
    symbol: z.string().trim().min(1),
    currency: CurrencyCode,
    dataAsOf: IsoTimestamp,
    freeCashFlow: SourcedMoney.refine((metric) => metric.value > 0, {
      message: "two-stage DCF requires positive free cash flow",
    }),
    /** Debt less cash; a negative value represents net cash. */
    netDebt: SourcedMoney,
    sharesOutstanding: SourcedShareCount,
    forecastYears: z.number().int().min(1).max(20),
    scenarios: z
      .object({
        bear: DcfScenarioAssumptions,
        base: DcfScenarioAssumptions,
        bull: DcfScenarioAssumptions,
      })
      .strict(),
    sensitivity: z
      .object({
        discountRates: z.array(z.number().finite().positive().lte(1)).min(1).max(10),
        terminalGrowthRates: z.array(z.number().finite().gt(-1).lte(0.15)).min(1).max(10),
      })
      .strict(),
  })
  .strict()
  .superRefine((input, context) => {
    for (const field of ["freeCashFlow", "netDebt"] as const) {
      if (input[field].currency !== input.currency) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field, "currency"],
          message: `${field} currency must equal valuation currency`,
        });
      }
    }
    for (const discountRate of input.sensitivity.discountRates) {
      for (const terminalGrowthRate of input.sensitivity.terminalGrowthRates) {
        if (discountRate <= terminalGrowthRate) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sensitivity"],
            message: "every sensitivity discount rate must exceed every terminal growth rate",
          });
          return;
        }
      }
    }
  });
export type DcfValuationInput = z.infer<typeof DcfValuationInput>;

const ProjectedCashFlow = z
  .object({
    year: z.number().int().positive(),
    freeCashFlow: z.number().finite(),
    presentValue: z.number().finite(),
  })
  .strict();

const DcfScenarioResult = z
  .object({
    assumptions: DcfScenarioAssumptions,
    projectedCashFlows: z.array(ProjectedCashFlow).min(1),
    presentValueOfForecast: z.number().finite(),
    terminalValue: z.number().finite(),
    presentValueOfTerminal: z.number().finite(),
    enterpriseValue: z.number().finite(),
    equityValue: z.number().finite(),
    impliedValuePerShare: z.number().finite(),
  })
  .strict();

const SensitivityPoint = z
  .object({
    discountRate: z.number().finite(),
    terminalGrowthRate: z.number().finite(),
    impliedValuePerShare: z.number().finite(),
  })
  .strict();

export const DcfCalculationRecord = z
  .object({
    schemaVersion: z.literal(1),
    calculationType: z.literal("twoStageDcf"),
    runId: RunId,
    generatedAt: IsoTimestamp,
    inputHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    input: DcfValuationInput,
    result: z
      .object({
        scenarios: z
          .object({ bear: DcfScenarioResult, base: DcfScenarioResult, bull: DcfScenarioResult })
          .strict(),
        sensitivity: z.array(SensitivityPoint).min(1),
      })
      .strict(),
  })
  .strict();
export type DcfCalculationRecord = z.infer<typeof DcfCalculationRecord>;

function calculateScenario(
  input: DcfValuationInput,
  assumptions: z.infer<typeof DcfScenarioAssumptions>
) {
  const projectedCashFlows = [];
  let latestFreeCashFlow = input.freeCashFlow.value;
  let presentValueOfForecast = 0;
  for (let year = 1; year <= input.forecastYears; year += 1) {
    latestFreeCashFlow *= 1 + assumptions.growthRate;
    const presentValue = latestFreeCashFlow / (1 + assumptions.discountRate) ** year;
    projectedCashFlows.push({
      year,
      freeCashFlow: roundCalculation(latestFreeCashFlow),
      presentValue: roundCalculation(presentValue),
    });
    presentValueOfForecast += presentValue;
  }
  const terminalValue =
    (latestFreeCashFlow * (1 + assumptions.terminalGrowthRate)) /
    (assumptions.discountRate - assumptions.terminalGrowthRate);
  const presentValueOfTerminal = terminalValue / (1 + assumptions.discountRate) ** input.forecastYears;
  const enterpriseValue = presentValueOfForecast + presentValueOfTerminal;
  const equityValue = enterpriseValue - input.netDebt.value;

  return {
    assumptions,
    projectedCashFlows,
    presentValueOfForecast: roundCalculation(presentValueOfForecast),
    terminalValue: roundCalculation(terminalValue),
    presentValueOfTerminal: roundCalculation(presentValueOfTerminal),
    enterpriseValue: roundCalculation(enterpriseValue),
    equityValue: roundCalculation(equityValue),
    impliedValuePerShare: roundCalculation(equityValue / input.sharesOutstanding.value),
  };
}

export function runDcfValuation(request: {
  runId: string;
  generatedAt: string;
  input: unknown;
}): DcfCalculationRecord {
  const input = DcfValuationInput.parse(request.input);
  const base = calculateScenario(input, input.scenarios.base);
  const sensitivity = input.sensitivity.discountRates.flatMap((discountRate) =>
    input.sensitivity.terminalGrowthRates.map((terminalGrowthRate) => ({
      discountRate,
      terminalGrowthRate,
      impliedValuePerShare: calculateScenario(input, {
        ...input.scenarios.base,
        discountRate,
        terminalGrowthRate,
      }).impliedValuePerShare,
    }))
  );
  const inputHash = hashCalculationInput(input);

  return DcfCalculationRecord.parse({
    schemaVersion: 1,
    calculationType: "twoStageDcf",
    runId: request.runId,
    generatedAt: request.generatedAt,
    inputHash,
    input,
    result: {
      scenarios: {
        bear: calculateScenario(input, input.scenarios.bear),
        base,
        bull: calculateScenario(input, input.scenarios.bull),
      },
      sensitivity,
    },
  });
}
