import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DailyDigest, DailyDigestV1 } from "@financial-agent/finance-core";
import { atomicCreateFile, detectSyncConflicts } from "./files.js";

export async function loadSeenDigestEventIds(dataDirectory: string): Promise<string[]> {
  const directory = join(dataDirectory, "digests");
  const conflicts = await detectSyncConflicts(join(directory, "digest.json"));
  if (conflicts.length > 0) throw new Error(`sync conflicts present in digest storage: ${conflicts.join(", ")}`);
  let files: string[];
  try { files = (await fs.readdir(directory)).filter((file) => file.endsWith(".json")).sort(); }
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const ids = new Set<string>();
  for (const file of files) {
    const raw = JSON.parse(await fs.readFile(join(directory, file), "utf8"));
    const current = DailyDigest.safeParse(raw);
    if (current.success) current.data.events.forEach((event) => ids.add(event.eventId));
    else {
      const legacy = DailyDigestV1.parse(raw);
      legacy.events.forEach((event) => ids.add(`legacy:${createHash("sha256").update(`${event.source}\0${event.whatChanged}`).digest("hex").slice(0, 20)}`));
    }
  }
  return [...ids];
}

export async function saveDigestReport(dataDirectory: string, rawReport: unknown): Promise<string> {
  const report = DailyDigest.parse(rawReport);
  const directory = join(dataDirectory, "digests");
  await fs.mkdir(directory, { recursive: true });
  const path = join(directory, `digest-${report.cadence}-${report.generatedAt.slice(0, 10)}-${report.runId}.json`);
  await atomicCreateFile(path, JSON.stringify(report, null, 2));
  return path;
}
