import { z } from "zod";
import { Bucket, CurrencyCode, IsoTimestamp, Money, PortfolioVersion, RunId, SnapshotEventId } from "./common.js";

/**
 * Periodic valuation snapshot — feeds reporting history ONLY (the rule engine
 * reads live data). Captured daily at US market close (config knob).
 */
const SnapshotV1 = z
  .object({
    schemaVersion: z.literal(1),
    eventId: SnapshotEventId,
    capturedAt: IsoTimestamp,
    marketSession: z.enum(["US_CLOSE", "MANUAL"]),
    valuationCurrency: CurrencyCode,
    fxTimestamp: IsoTimestamp,
    sourcePortfolioVersion: PortfolioVersion,
    totalValue: Money,
    byBucket: z.record(Bucket, z.number().min(0).max(1)),
    status: z.enum(["complete", "partial", "failed"]),
    /** present when status != complete */
    issues: z.array(z.string()).optional(),
  })
  .strict();

export const SnapshotV2 = z
  .object({
    schemaVersion: z.literal(2),
    eventId: SnapshotEventId,
    capturedAt: IsoTimestamp,
    marketSession: z.enum(["US_CLOSE", "MANUAL"]),
    valuationCurrency: CurrencyCode,
    fxTimestamp: IsoTimestamp,
    sourceReportRunId: RunId,
    sourcePortfolioHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    totalValue: Money,
    byBucket: z.record(Bucket, z.number().min(0).max(1)),
    status: z.enum(["complete", "partial", "failed"]),
    /** present when status != complete */
    issues: z.array(z.string()).optional(),
  })
  .strict();

/** Reads retain v1 compatibility; all new captures use provenance-complete v2. */
export const Snapshot = z.discriminatedUnion("schemaVersion", [SnapshotV1, SnapshotV2]);
export type Snapshot = z.infer<typeof Snapshot>;
