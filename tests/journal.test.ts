import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createJournalEntryFile,
  createPostmortemFile,
  searchJournal,
} from "@financial-agent/storage";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("investment journal", () => {
  it("retrieves an entry and its postmortem by ticker and date", async () => {
    const directory = mkdtempSync(join(tmpdir(), "financial-agent-journal-"));
    temporaryDirectories.push(directory);

    await createJournalEntryFile(directory, {
      schemaVersion: 1,
      id: "jrnl_20260720_avgo-entry",
      ts: "2026-07-20T10:00:00Z",
      symbol: "AVGO",
      decision: "pass",
      thesis: "AI infrastructure demand may remain durable.",
      horizon: "1-5 years",
      entryReason: "Valuation did not provide enough downside protection.",
      risks: ["Customer concentration"],
      invalidationConditions: ["Data-centre revenue declines for two consecutive quarters"],
    });
    await createPostmortemFile(directory, {
      schemaVersion: 1,
      id: "jrnl_20260721_avgo-postmortem",
      ts: "2026-07-21T10:00:00Z",
      entryId: "jrnl_20260720_avgo-entry",
      outcome: "No position was opened.",
      thesisCorrect: "partially",
      timingCorrect: "yes",
      ruleViolations: [],
      luckVsSkill: "The process followed the recorded valuation discipline.",
      lessons: ["Record the next data point before revisiting."],
    });

    const results = await searchJournal(directory, {
      symbol: "avgo",
      from: "2026-07-20T00:00:00Z",
      to: "2026-07-22T00:00:00Z",
    });

    expect(results.map((result) => result.kind)).toEqual(["entry", "postmortem"]);
    expect(results.map((result) => result.symbol)).toEqual(["AVGO", "AVGO"]);
  });

  it("rejects broken postmortem links and sync-conflicted journal directories", async () => {
    const directory = mkdtempSync(join(tmpdir(), "financial-agent-journal-"));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, "jrnl_20260720_avgo-entry.md"), "not a journal record");

    await expect(
      createPostmortemFile(directory, {
        schemaVersion: 1,
        id: "jrnl_20260721_avgo-postmortem",
        ts: "2026-07-21T10:00:00Z",
        entryId: "jrnl_20260720_avgo-entry",
        outcome: "No position was opened.",
        thesisCorrect: "partially",
        timingCorrect: "yes",
        ruleViolations: [],
        luckVsSkill: "The recorded process was followed.",
        lessons: ["Keep the original decision record valid."],
      })
    ).rejects.toThrow(/frontmatter/);

    writeFileSync(join(directory, "jrnl_20260720_avgo-entry sync-conflict.md"), "conflict");
    await expect(searchJournal(directory)).rejects.toThrow(/sync conflicts present/);
  });
});
