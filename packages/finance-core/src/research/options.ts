import { z } from "zod";
import { CurrencyCode, IsoTimestamp, RunId } from "../schemas/common.js";
import { hashCalculationInput, roundCalculation } from "./reproducibility.js";

const PayoffInput = z
  .object({
    schemaVersion: z.literal(1),
    strategy: z.enum(["coveredCall", "longCall"]),
    symbol: z.string().trim().min(1),
    currency: CurrencyCode,
    dataAsOf: IsoTimestamp,
    underlyingPrice: z
      .object({
        value: z.number().finite().positive(),
        currency: CurrencyCode,
        asOf: IsoTimestamp,
        source: z.string().min(1),
      })
      .strict(),
    strike: z.number().finite().positive(),
    premiumPerShare: z.number().finite().nonnegative(),
    contracts: z.number().int().positive(),
    contractMultiplier: z.number().int().positive(),
    daysToExpiry: z.number().int().positive(),
    expiryPrices: z.array(z.number().finite().nonnegative()).min(1).max(100),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.currency !== input.underlyingPrice.currency) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["underlyingPrice", "currency"],
        message: "underlying price currency must equal payoff currency",
      });
    }
    if (input.strategy === "coveredCall" && input.premiumPerShare > input.underlyingPrice.value) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["premiumPerShare"],
        message: "covered-call premium cannot exceed the underlying price",
      });
    }
  });

export const OptionPayoffInput = PayoffInput;
export type OptionPayoffInput = z.infer<typeof OptionPayoffInput>;

export const OptionPayoffRecord = z
  .object({
    schemaVersion: z.literal(1),
    calculationType: z.literal("optionPayoff"),
    runId: RunId,
    generatedAt: IsoTimestamp,
    inputHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    input: OptionPayoffInput,
    result: z
      .object({
        netPremium: z.number().finite(),
        breakEven: z.number().finite(),
        maxProfit: z.number().finite().nullable(),
        maxLoss: z.number().finite(),
        annualizedPremiumYield: z.number().finite().nullable(),
        payoffAtExpiry: z.array(
          z.object({ underlyingPrice: z.number().finite(), profit: z.number().finite() }).strict()
        ),
      })
      .strict(),
  })
  .strict();
export type OptionPayoffRecord = z.infer<typeof OptionPayoffRecord>;

export function runOptionPayoff(request: {
  runId: string;
  generatedAt: string;
  input: unknown;
}): OptionPayoffRecord {
  const input = OptionPayoffInput.parse(request.input);
  const shares = input.contracts * input.contractMultiplier;
  const coveredCall = input.strategy === "coveredCall";
  const netPremium = input.premiumPerShare * shares * (coveredCall ? 1 : -1);
  const breakEven = coveredCall
    ? input.underlyingPrice.value - input.premiumPerShare
    : input.strike + input.premiumPerShare;
  const maxProfit = coveredCall
    ? (input.strike - input.underlyingPrice.value + input.premiumPerShare) * shares
    : null;
  const maxLoss = coveredCall ? breakEven * shares : input.premiumPerShare * shares;
  const annualizedPremiumYield = coveredCall
    ? (input.premiumPerShare / input.underlyingPrice.value) * (365 / input.daysToExpiry)
    : null;
  const payoffAtExpiry = input.expiryPrices.map((underlyingPrice) => {
    const profitPerShare = coveredCall
      ? Math.min(underlyingPrice, input.strike) - input.underlyingPrice.value + input.premiumPerShare
      : Math.max(underlyingPrice - input.strike, 0) - input.premiumPerShare;
    return { underlyingPrice, profit: roundCalculation(profitPerShare * shares) };
  });
  const inputHash = hashCalculationInput(input);

  return OptionPayoffRecord.parse({
    schemaVersion: 1,
    calculationType: "optionPayoff",
    runId: request.runId,
    generatedAt: request.generatedAt,
    inputHash,
    input,
    result: {
      netPremium: roundCalculation(netPremium),
      breakEven: roundCalculation(breakEven),
      maxProfit: maxProfit === null ? null : roundCalculation(maxProfit),
      maxLoss: roundCalculation(maxLoss),
      annualizedPremiumYield:
        annualizedPremiumYield === null ? null : roundCalculation(annualizedPremiumYield),
      payoffAtExpiry,
    },
  });
}
