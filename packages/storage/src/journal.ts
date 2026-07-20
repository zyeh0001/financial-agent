import { promises as fs } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  IsoTimestamp,
  JournalEntry,
  Postmortem,
  type JournalEntry as JournalEntryRecord,
  type Postmortem as PostmortemRecord,
} from "@financial-agent/finance-core";
import { atomicCreateFile } from "./files.js";

type StoredJournalRecord =
  | { kind: "entry"; record: JournalEntryRecord; path: string }
  | { kind: "postmortem"; record: PostmortemRecord; path: string };

export type JournalSearchResult =
  | { kind: "entry"; symbol: string; path: string; record: JournalEntryRecord }
  | { kind: "postmortem"; symbol: string; path: string; record: PostmortemRecord };

export interface JournalSearchQuery {
  symbol?: string;
  from?: string;
  to?: string;
}

function markdownDocument(recordType: "journalEntry" | "postmortem", record: object): string {
  const frontmatter = stringifyYaml({ recordType, ...record }, { lineWidth: 0 }).trimEnd();
  if (recordType === "journalEntry") {
    const entry = record as JournalEntryRecord;
    return `---\n${frontmatter}\n---\n\n# ${entry.symbol} — ${entry.decision}\n\n## Thesis\n\n${entry.thesis}\n\n## Entry reason\n\n${entry.entryReason}\n\n## Risks\n\n${entry.risks.map((risk) => `- ${risk}`).join("\n")}\n\n## Invalidation conditions\n\n${entry.invalidationConditions.map((condition) => `- ${condition}`).join("\n")}\n`;
  }
  const postmortem = record as PostmortemRecord;
  return `---\n${frontmatter}\n---\n\n# Postmortem — ${postmortem.entryId}\n\n## Outcome\n\n${postmortem.outcome}\n\n## Luck vs skill\n\n${postmortem.luckVsSkill}\n\n## Lessons\n\n${postmortem.lessons.map((lesson) => `- ${lesson}`).join("\n")}\n`;
}

async function readCleanDirectory(directory: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const conflicts = entries.filter((name) =>
    [/sync-conflict/i, /conflicted copy/i, /\.orig$/].some((pattern) => pattern.test(name))
  );
  if (conflicts.length > 0) {
    throw new Error(`journal sync conflicts present, resolve first: ${conflicts.join(", ")}`);
  }
  return entries;
}

export async function createJournalEntryFile(
  directory: string,
  candidate: unknown
): Promise<string> {
  const record = JournalEntry.parse(candidate);
  await fs.mkdir(directory, { recursive: true });
  await readCleanDirectory(directory);
  const path = join(directory, `${record.id}.md`);
  await atomicCreateFile(path, markdownDocument("journalEntry", record));
  return path;
}

export async function createPostmortemFile(
  directory: string,
  candidate: unknown
): Promise<string> {
  const record = Postmortem.parse(candidate);
  await fs.mkdir(directory, { recursive: true });
  await readCleanDirectory(directory);
  const entryPath = join(directory, `${record.entryId}.md`);
  try {
    const linked = parseJournalDocument(entryPath, await fs.readFile(entryPath, "utf8"));
    if (linked.kind !== "entry" || linked.record.id !== record.entryId) {
      throw new Error(`postmortem target is not the referenced journal entry: ${record.entryId}`);
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error(`postmortem entry does not exist: ${record.entryId}`);
  }
  const path = join(directory, `${record.id}.md`);
  await atomicCreateFile(path, markdownDocument("postmortem", record));
  return path;
}

function parseJournalDocument(path: string, markdown: string): StoredJournalRecord {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match?.[1]) throw new Error(`journal file has no valid frontmatter: ${path}`);
  const parsed = parseYaml(match[1]) as Record<string, unknown>;
  const { recordType, ...candidate } = parsed;
  if (recordType === "journalEntry") {
    return { kind: "entry", record: JournalEntry.parse(candidate), path };
  }
  if (recordType === "postmortem") {
    return { kind: "postmortem", record: Postmortem.parse(candidate), path };
  }
  throw new Error(`unknown journal recordType in ${path}`);
}

export async function searchJournal(
  directory: string,
  query: JournalSearchQuery = {}
): Promise<JournalSearchResult[]> {
  const from = query.from === undefined ? Number.NEGATIVE_INFINITY : Date.parse(IsoTimestamp.parse(query.from));
  const to = query.to === undefined ? Number.POSITIVE_INFINITY : Date.parse(IsoTimestamp.parse(query.to));
  const symbol = query.symbol?.trim().toUpperCase();
  let names: string[];
  try {
    names = (await readCleanDirectory(directory)).filter((name) => name.endsWith(".md"));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records = await Promise.all(
    names.map(async (name) => {
      const path = join(directory, name);
      return parseJournalDocument(path, await fs.readFile(path, "utf8"));
    })
  );
  const entries = new Map(
    records
      .filter((item): item is Extract<StoredJournalRecord, { kind: "entry" }> => item.kind === "entry")
      .map((item) => [item.record.id, item.record])
  );
  const results = records.flatMap((item): JournalSearchResult[] => {
    let itemSymbol: string;
    if (item.kind === "entry") {
      itemSymbol = item.record.symbol;
    } else {
      const entry = entries.get(item.record.entryId);
      if (entry === undefined) {
        throw new Error(`postmortem references missing journal entry: ${item.record.entryId}`);
      }
      itemSymbol = entry.symbol;
    }
    const timestamp = Date.parse(item.record.ts);
    if ((symbol !== undefined && itemSymbol.toUpperCase() !== symbol) || timestamp < from || timestamp > to) {
      return [];
    }
    return [{ kind: item.kind, symbol: itemSymbol, path: item.path, record: item.record } as JournalSearchResult];
  });
  return results.sort((left, right) => {
    const byTimestamp = Date.parse(left.record.ts) - Date.parse(right.record.ts);
    return byTimestamp === 0 ? left.kind.localeCompare(right.kind) : byTimestamp;
  });
}
