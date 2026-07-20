import { promises as fs } from "node:fs";

export * from "./files.js";
export * from "./journal.js";

/**
 * Storage integrity primitives (ARCHITECTURE §5). Layer B lives under an
 * Obsidian/git-synced folder, so writes must be atomic and reads must survive
 * a crash mid-append and sync-conflict artifacts.
 */

/** Append one JSONL record (single write syscall for the whole line). */
export async function appendJsonl(path: string, record: unknown): Promise<void> {
  await fs.appendFile(path, JSON.stringify(record) + "\n", "utf8");
}

export interface JsonlReadResult<T> {
  records: T[];
  /** non-null iff the final line was malformed (crash mid-append) — recoverable, not fatal */
  corruptTail: string | null;
}

/**
 * Read a JSONL file, tolerating a malformed FINAL line (recovered, reported).
 * A malformed line anywhere else is real corruption and throws.
 */
export async function readJsonl<T>(path: string): Promise<JsonlReadResult<T>> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { records: [], corruptTail: null };
    throw err;
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const records: T[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    try {
      records.push(JSON.parse(line) as T);
    } catch {
      if (i === lines.length - 1) return { records, corruptTail: line };
      throw new Error(`corrupt JSONL record at line ${i + 1} of ${path}`);
    }
  }
  return { records, corruptTail: null };
}
