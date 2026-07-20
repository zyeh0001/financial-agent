import { z } from "zod";
import { PortfolioHealthReport, SnapshotV2 } from "../schemas/index.js";

type PortfolioHealthReportRecord = z.infer<typeof PortfolioHealthReport>;

export function createPortfolioSnapshot(input: {
  report: PortfolioHealthReportRecord;
  sourcePortfolioHash: string;
  marketSession: "US_CLOSE" | "MANUAL";
}) {
  const { report, marketSession } = input;
  const issues = [...new Set([...report.dataGaps, ...report.staleQuotes])];
  const fxTimestamp = report.fxRates.length === 0
    ? report.dataAsOf
    : report.fxRates.reduce((oldest, rate) =>
        Date.parse(rate.asOf) < Date.parse(oldest.asOf) ? rate : oldest
      ).asOf;
  return SnapshotV2.parse({
    schemaVersion: 2,
    eventId: `snap_${report.generatedAt.slice(0, 10).replaceAll("-", "")}_${marketSession.toLowerCase()}`,
    capturedAt: report.generatedAt,
    marketSession,
    valuationCurrency: report.valuationCurrency,
    fxTimestamp,
    sourceReportRunId: report.runId,
    sourcePortfolioHash: input.sourcePortfolioHash,
    totalValue: report.totalValue,
    byBucket: report.bucketWeights,
    status: issues.length === 0 ? "complete" : "partial",
    ...(issues.length === 0 ? {} : { issues }),
  });
}
