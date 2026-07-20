import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Storage integrity primitives (ARCHITECTURE §5). Layer B lives under an
 * Obsidian/git-synced folder, so writes must be atomic and reads must survive
 * a crash mid-append and sync-conflict artifacts.
 */

/** Write via temp file + rename — readers never observe a partial file. */
export async function atomicWriteFile(path: string, data: string): Promise<void> {
  const tmp = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`);
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, path);
}

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

/** Obsidian/iCloud/git sync-conflict artifacts near a data file. */
export async function detectSyncConflicts(path: string): Promise<string[]> {
  const dir = dirname(path);
  const base = path.slice(dir.length + 1);
  const stem = base.replace(/\.[^.]+$/, "");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const patterns = [/sync-conflict/i, /conflicted copy/i, /\.orig$/];
  return entries
    .filter((e) => e !== base && e.startsWith(stem))
    .filter((e) => patterns.some((p) => p.test(e)))
    .map((e) => join(dir, e));
}
