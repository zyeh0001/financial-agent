import { z } from "zod";

/**
 * Shared primitives for every record type.
 *
 * Every persisted record carries `schemaVersion` so migrations are possible
 * (ARCHITECTURE §5). Bump per-record-type versions independently.
 */

export const SCHEMA_VERSION = 1 as const;

export const CurrencyCode = z.enum(["AUD", "USD"]);
export type CurrencyCode = z.infer<typeof CurrencyCode>;

/** ISO-8601 with explicit offset — naive timestamps are a currency-grade bug. */
export const IsoTimestamp = z.string().datetime({ offset: true });

export const AssetType = z.enum(["stock", "etf", "crypto", "cash"]);
export type AssetType = z.infer<typeof AssetType>;

/** Allocation buckets from finances.md target structure. */
export const Bucket = z.enum(["individual", "etf", "crypto", "cash"]);
export type Bucket = z.infer<typeof Bucket>;

export const Money = z.number().finite();
export const Quantity = z.number().finite().nonnegative();

/**
 * ID formats (CONTRACTS.md §4):
 *   run_20260720T093012Z_a3f1   snap_20260720_us_close   txn_20260720_0001
 *   jrnl_20260720_avgo-entry    portfolio_20260720_001
 */
export const RunId = z.string().regex(/^run_\d{8}T\d{6}Z_[0-9a-f]{4}$/);
export const SnapshotEventId = z.string().regex(/^snap_\d{8}_[a-z_]+$/);
export const TransactionId = z.string().regex(/^txn_\d{8}_[0-9a-z]{4,}$/);
export const JournalId = z.string().regex(/^jrnl_\d{8}_[a-z0-9-]+$/);
export const PortfolioVersion = z.string().regex(/^portfolio_\d{8}_\d{3}$/);

export function makeRunId(now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const suffix = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0");
  return `run_${stamp}_${suffix}`;
}

/** Calculation tolerances (ARCHITECTURE §9) — used by tests and validators. */
export const TOLERANCES = {
  money: 0.01,
  /** portfolio weights, absolute (0.0001 = 0.01 percentage points) */
  weight: 0.0001,
  irr: 0.001,
} as const;
