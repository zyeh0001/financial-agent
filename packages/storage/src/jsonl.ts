import { promises as fs } from "node:fs";

/** Append one JSONL record (single write syscall for the whole line). */
export async function appendJsonl(path: string, record: unknown): Promise<void> {
  await fs.appendFile(path, JSON.stringify(record) + "\n", "utf8");
}

export interface JsonlReadResult<T> {
  records: T[];
  /** non-null iff the final line was malformed (crash mid-append) — recoverable, not fatal */
  corruptTail: string | null;
}

/** Read JSONL, tolerating and reporting only a malformed final crash-tail line. */
export async function readJsonl<T>(path: string): Promise<JsonlReadResult<T>> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [], corruptTail: null };
    throw error;
  }
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const records: T[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    try {
      records.push(JSON.parse(line) as T);
    } catch {
      if (index === lines.length - 1) return { records, corruptTail: line };
      throw new Error(`corrupt JSONL record at line ${index + 1} of ${path}`);
    }
  }
  return { records, corruptTail: null };
}
