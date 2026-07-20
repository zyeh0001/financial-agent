import { z } from "zod";
import { CurrencyCode, IsoTimestamp, Money, Quantity, TransactionId } from "./common.js";

/**
 * Transactions — the future quantitative source of truth (Phase 2, broker import).
 * In Phase 1 they exist for fixtures, the calculation engine, and manual entry.
 *
 * NOTE the deliberate absence of any order/execution lifecycle: these are records
 * of what ALREADY happened (entered by the user or imported), never instructions.
 */

const base = {
  schemaVersion: z.literal(1),
  id: TransactionId,
  ts: IsoTimestamp,
  note: z.string().optional(),
} as const;

export const BuyTransaction = z
  .object({
    ...base,
    type: z.literal("BUY"),
    symbol: z.string().min(1),
    quantity: Quantity,
    /** price per unit */
    price: Money.nonnegative(),
    currency: CurrencyCode,
    /** brokerage fee, added to cost basis (broker-compatible) */
    fee: Money.nonnegative().default(0),
  })
  .strict();

export const SellTransaction = z
  .object({
    ...base,
    type: z.literal("SELL"),
    symbol: z.string().min(1),
    quantity: Quantity,
    price: Money.nonnegative(),
    currency: CurrencyCode,
    /** brokerage fee, deducted from proceeds (broker-compatible) */
    fee: Money.nonnegative().default(0),
  })
  .strict();

export const DividendTransaction = z
  .object({
    ...base,
    type: z.literal("DIVIDEND"),
    symbol: z.string().min(1),
    amount: Money.nonnegative(),
    currency: CurrencyCode,
  })
  .strict();

export const DepositTransaction = z
  .object({
    ...base,
    type: z.literal("DEPOSIT"),
    amount: Money.nonnegative(),
    currency: CurrencyCode,
  })
  .strict();

export const WithdrawalTransaction = z
  .object({
    ...base,
    type: z.literal("WITHDRAWAL"),
    amount: Money.nonnegative(),
    currency: CurrencyCode,
  })
  .strict();

export const FeeTransaction = z
  .object({
    ...base,
    type: z.literal("FEE"),
    amount: Money.nonnegative(),
    currency: CurrencyCode,
  })
  .strict();

/**
 * Explicit currency conversion. The ONLY way cash changes currency —
 * "zero silent currency conversions" (PRD §7) is enforced structurally.
 */
export const FxConvertTransaction = z
  .object({
    ...base,
    type: z.literal("FX_CONVERT"),
    fromCurrency: CurrencyCode,
    fromAmount: Money.positive(),
    toCurrency: CurrencyCode,
    toAmount: Money.positive(),
  })
  .strict()
  .refine((t) => t.fromCurrency !== t.toCurrency, {
    message: "FX_CONVERT must change currency",
  });

export const Transaction = z.discriminatedUnion("type", [
  BuyTransaction,
  SellTransaction,
  DividendTransaction,
  DepositTransaction,
  WithdrawalTransaction,
  FeeTransaction,
]);
export type Transaction = z.infer<typeof Transaction>;

/** Full input union including FX (discriminatedUnion can't hold .refine'd members). */
export const AnyTransaction = z.union([Transaction, FxConvertTransaction]);
export type AnyTransaction = z.infer<typeof AnyTransaction>;
