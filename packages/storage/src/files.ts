import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

/** Write via temp file + rename — readers never observe a partial file. */
export async function atomicWriteFile(path: string, data: string): Promise<void> {
  const tmp = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`);
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, path);
}

/** Atomically create an immutable file; fail rather than replace an existing path. */
export async function atomicCreateFile(path: string, data: string): Promise<void> {
  const tmp = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`);
  await fs.writeFile(tmp, data, "utf8");
  try {
    await fs.link(tmp, path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`immutable file already exists: ${path}`);
    }
    throw error;
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

/** Obsidian/iCloud/git sync-conflict artifacts near a data file. */
export async function detectSyncConflicts(path: string): Promise<string[]> {
  const directory = dirname(path);
  const base = path.slice(directory.length + 1);
  const stem = base.replace(/\.[^.]+$/, "");
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch {
    return [];
  }
  const patterns = [/sync-conflict/i, /conflicted copy/i, /\.orig$/];
  return entries
    .filter((entry) => entry !== base && entry.startsWith(stem))
    .filter((entry) => patterns.some((pattern) => pattern.test(entry)))
    .map((entry) => join(directory, entry));
}
