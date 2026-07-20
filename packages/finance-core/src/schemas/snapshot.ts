import { z } from "zod";
import { Bucket, CurrencyCode, IsoTimestamp, Money, PortfolioVersion, SnapshotEventId } from "./common.js";

/**
 * Periodic valuation snapshot — feeds reporting history ONLY (the rule engine
 * reads live data). Captured daily at US market close (config knob).
 */
export const Snapshot = z
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
export type Snapshot = z.infer<typeof Snapshot>;
