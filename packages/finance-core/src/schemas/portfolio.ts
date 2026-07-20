import { z } from "zod";
import {
  AssetType,
  Bucket,
  CurrencyCode,
  IsoTimestamp,
  Money,
  PortfolioVersion,
  Quantity,
} from "./common.js";

/**
 * Canonical portfolio state.
 *
 * Phase 1: `portfolio.md` (chat-CRUD) is canonical and this structure is the
 * parsed/validated form of it (`source: manual_chat_crud`, `status: unreconciled`).
 * The reconciliation fields are reserved NOW so the Phase-2 flip to broker-imported
 * structured truth (ARCHITECTURE §4) is additive, not a schema rewrite.
 */

export const Position = z
  .object({
    symbol: z.string().min(1),
    assetType: AssetType,
    bucket: Bucket,
    quantity: Quantity,
    /** Weighted average cost per unit, inclusive of buy-side fees. */
    averageCost: Money.nonnegative(),
    costCurrency: CurrencyCode,
    notes: z.string().optional(),
  })
  .strict();
export type Position = z.infer<typeof Position>;

export const CashBalance = z
  .object({
    currency: CurrencyCode,
    amount: Money,
  })
  .strict();
export type CashBalance = z.infer<typeof CashBalance>;

export const PortfolioState = z
  .object({
    schemaVersion: z.literal(1),
    portfolioVersion: PortfolioVersion,
    asOf: IsoTimestamp,
    baseCurrency: CurrencyCode,
    source: z.enum(["manual_chat_crud", "broker_csv"]),
    status: z.enum(["unreconciled", "reconciled", "conflict"]),
    lastReconciledAt: IsoTimestamp.nullable(),
    sourceFileHash: z.string().nullable(),
    positions: z.array(Position),
    cash: z.array(CashBalance),
  })
  .strict();
export type PortfolioState = z.infer<typeof PortfolioState>;
