import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendJsonl,
  atomicWriteFile,
  detectSyncConflicts,
  readJsonl,
} from "@financial-agent/storage";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "fa-storage-"));
}

describe("storage integrity", () => {
  it("atomic write produces the full file", async () => {
    const dir = tmp();
    const file = join(dir, "state.json");
    await atomicWriteFile(file, JSON.stringify({ ok: true }));
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ok: true });
  });

  it("append + read round-trips JSONL", async () => {
    const dir = tmp();
    const file = join(dir, "snapshots.jsonl");
    await appendJsonl(file, { eventId: "snap_1" });
    await appendJsonl(file, { eventId: "snap_2" });
    const result = await readJsonl<{ eventId: string }>(file);
    expect(result.records.map((r) => r.eventId)).toEqual(["snap_1", "snap_2"]);
    expect(result.corruptTail).toBeNull();
  });

  it("recovers from a malformed FINAL line (crash mid-append)", async () => {
    const dir = tmp();
    const file = join(dir, "runs.jsonl");
    await appendJsonl(file, { runId: "run_1" });
    writeFileSync(file, readFileSync(file, "utf8") + '{"runId":"run_2","tru', "utf8");
    const result = await readJsonl<{ runId: string }>(file);
    expect(result.records.map((r) => r.runId)).toEqual(["run_1"]);
    expect(result.corruptTail).toContain("run_2");
  });

  it("throws on corruption in the MIDDLE of the file", async () => {
    const dir = tmp();
    const file = join(dir, "runs.jsonl");
    writeFileSync(file, '{"a":1}\nnot-json\n{"a":2}\n', "utf8");
    await expect(readJsonl(file)).rejects.toThrow(/corrupt JSONL record at line 2/);
  });

  it("missing file reads as empty, not an error", async () => {
    const result = await readJsonl(join(tmp(), "nope.jsonl"));
    expect(result.records).toEqual([]);
  });

  it("detects sync-conflict artifacts", async () => {
    const dir = tmp();
    const file = join(dir, "snapshots.jsonl");
    writeFileSync(file, "{}\n", "utf8");
    writeFileSync(join(dir, "snapshots.sync-conflict-20260720-1.jsonl"), "{}\n", "utf8");
    const conflicts = await detectSyncConflicts(file);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain("sync-conflict");
  });
});
