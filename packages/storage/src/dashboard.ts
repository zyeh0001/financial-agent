import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PortfolioHealthReport, Snapshot, marketAgeHours } from "@financial-agent/finance-core";
import { atomicCreateFile, detectSyncConflicts } from "./files.js";

type PortfolioHealthReportRecord = z.infer<typeof PortfolioHealthReport>;
type SnapshotRecord = z.infer<typeof Snapshot>;

export type DashboardDataStatus = "current" | "stale" | "incomplete" | "unavailable" | "error";

export interface DashboardReadModel {
  schemaVersion: 1;
  loadedAt: string;
  status: DashboardDataStatus;
  freshness: "current" | "stale" | "unknown";
  completeness: "complete" | "incomplete" | "unknown";
  current: PortfolioHealthReportRecord | null;
  history: SnapshotRecord[];
  provenance: {
    reportFile: string;
    reportRunId: string;
    generatedAt: string;
    dataAsOf: string;
    sources: string[];
  } | null;
  issues: string[];
}

export async function createDailySnapshotFile(
  dataDirectory: string,
  candidate: unknown
): Promise<{ path: string; created: boolean }> {
  const snapshot = Snapshot.parse(candidate);
  const directory = join(dataDirectory, "snapshots");
  const path = join(directory, `${snapshot.eventId}.json`);
  await fs.mkdir(directory, { recursive: true });
  const conflicts = await detectSyncConflicts(path);
  if (conflicts.length > 0) {
    throw new Error(`sync conflict blocks snapshot creation: ${conflicts.join(", ")}`);
  }
  try {
    await atomicCreateFile(path, JSON.stringify(snapshot, null, 2));
    return { path, created: true };
  } catch (error: unknown) {
    if ((error as Error).message === `immutable file already exists: ${path}`) {
      return { path, created: false };
    }
    throw error;
  }
}

async function jsonFiles(directory: string, prefix = ""): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory);
    const conflicts = entries.filter((name) =>
      [/sync-conflict/i, /conflicted copy/i, /\.orig$/].some((pattern) => pattern.test(name))
    );
    if (conflicts.length > 0) {
      throw new Error(`sync conflict artifacts in ${directory}: ${conflicts.join(", ")}`);
    }
    return entries
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
      .sort();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadDashboardReadModel(options: {
  dataDirectory: string;
  now?: Date;
  staleAfterMs?: number;
}): Promise<DashboardReadModel> {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? 30 * 60 * 60 * 1_000;
  const reportDirectory = join(options.dataDirectory, "reports");
  const snapshotDirectory = join(options.dataDirectory, "snapshots");
  let reportFiles: string[];
  let snapshotFiles: string[];
  try {
    [reportFiles, snapshotFiles] = await Promise.all([
      jsonFiles(reportDirectory, "health-"),
      jsonFiles(snapshotDirectory, "snap_"),
    ]);
  } catch (error: unknown) {
    return {
      schemaVersion: 1,
      loadedAt: now.toISOString(),
      status: "error",
      freshness: "unknown",
      completeness: "unknown",
      current: null,
      history: [],
      provenance: null,
      issues: [(error as Error).message],
    };
  }
  const newestReportFile = reportFiles.at(-1);

  const history: SnapshotRecord[] = [];
  const historyIssues: string[] = [];
  for (const file of snapshotFiles) {
    try {
      history.push(Snapshot.parse(JSON.parse(await fs.readFile(join(snapshotDirectory, file), "utf8"))));
    } catch (error: unknown) {
      historyIssues.push(`Invalid snapshot ${file}: ${(error as Error).message}`);
    }
  }
  history.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));

  const base = {
    schemaVersion: 1 as const,
    loadedAt: now.toISOString(),
    history,
  };
  if (newestReportFile === undefined) {
    return {
      ...base,
      status: historyIssues.length > 0 ? "error" : "unavailable",
      freshness: "unknown",
      completeness: "unknown",
      current: null,
      provenance: null,
      issues: historyIssues.length > 0 ? historyIssues : ["No portfolio health report is available."],
    };
  }

  let current: PortfolioHealthReportRecord;
  try {
    current = PortfolioHealthReport.parse(
      JSON.parse(await fs.readFile(join(reportDirectory, newestReportFile), "utf8"))
    );
  } catch (error: unknown) {
    return {
      ...base,
      status: "error",
      freshness: "unknown",
      completeness: "unknown",
      current: null,
      provenance: null,
      issues: [`Latest portfolio health report ${newestReportFile} is invalid: ${(error as Error).message}`, ...historyIssues],
    };
  }

  const compatibleHistory = history.filter((point) => {
    if (point.valuationCurrency === current.valuationCurrency) return true;
    historyIssues.push(
      `Snapshot ${point.eventId} currency mismatch: ${point.valuationCurrency} cannot be charted with ${current.valuationCurrency}.`
    );
    return false;
  });

  const reportIssues = [...new Set([...current.dataGaps, ...current.staleQuotes])];
  const staleAfterHours = staleAfterMs / 3_600_000;
  const tooOld = marketAgeHours(Date.parse(current.dataAsOf), now.getTime()) > staleAfterHours;
  if (tooOld) reportIssues.push(`Portfolio data is older than ${Math.round(staleAfterMs / 3_600_000)} hours.`);
  const issues = [...new Set([...reportIssues, ...historyIssues])];
  const status: DashboardDataStatus =
    historyIssues.length > 0
      ? "error"
      : current.dataGaps.length > 0
        ? "incomplete"
        : current.staleQuotes.length > 0 || tooOld
          ? "stale"
          : "current";

  return {
    ...base,
    history: compatibleHistory,
    status,
    freshness: current.staleQuotes.length > 0 || tooOld ? "stale" : "current",
    completeness: current.dataGaps.length > 0 ? "incomplete" : "complete",
    current,
    provenance: {
      reportFile: newestReportFile,
      reportRunId: current.runId,
      generatedAt: current.generatedAt,
      dataAsOf: current.dataAsOf,
      sources: current.sources,
    },
    issues,
  };
}
