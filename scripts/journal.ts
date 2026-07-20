import { createHash } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RunRecord, makeRunId, type RunRecord as RunRecordType } from "@financial-agent/finance-core";
import {
  appendJsonl,
  createJournalEntryFile,
  createPostmortemFile,
  searchJournal,
} from "@financial-agent/storage";

const command = process.argv[2];
const values = new Map<string, string>();
const flags = new Set<string>();
for (let index = 3; index < process.argv.length; index += 1) {
  const argument = process.argv[index]!;
  if (["--confirmed", "--json"].includes(argument)) {
    flags.add(argument);
    continue;
  }
  if (!["--input", "--investment-dir", "--symbol", "--from", "--to"].includes(argument)) {
    throw new Error(`unknown argument: ${argument}`);
  }
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${argument}`);
  values.set(argument, value);
  index += 1;
}
const investmentDirectory =
  values.get("--investment-dir") ??
  process.env["INVESTMENT_DIR"] ??
  join(homedir(), "Documents/notes/Charles/Investment");
const journalDirectory = join(investmentDirectory, "journal");
const dataDirectory = join(investmentDirectory, "data");

if (command === "search") {
  const results = await searchJournal(journalDirectory, {
    ...(values.has("--symbol") ? { symbol: values.get("--symbol")! } : {}),
    ...(values.has("--from") ? { from: values.get("--from")! } : {}),
    ...(values.has("--to") ? { to: values.get("--to")! } : {}),
  });
  if (flags.has("--json")) console.log(JSON.stringify(results, null, 2));
  else {
    for (const result of results) console.log(`${result.record.ts}\t${result.symbol}\t${result.kind}\t${result.path}`);
  }
} else if (command === "create-entry" || command === "create-postmortem") {
  const runId = makeRunId();
  const startedAt = new Date().toISOString();
  const validationResults: RunRecordType["validationResults"] = [];
  const outputs: string[] = [];
  let error: string | null = null;
  let inputHash = "sha256:unavailable";
  try {
    if (!flags.has("--confirmed")) {
      validationResults.push({ check: "explicit-chat-confirmation", ok: false });
      throw new Error("journal writes require explicit user confirmation in chat and --confirmed");
    }
    validationResults.push({ check: "explicit-chat-confirmation", ok: true });
    const inputPath = values.get("--input");
    if (inputPath === undefined) throw new Error("journal create requires --input <json-file>");
    const rawInput = readFileSync(inputPath, "utf8");
    inputHash = `sha256:${createHash("sha256").update(rawInput).digest("hex")}`;
    const candidate = JSON.parse(rawInput) as unknown;
    const path =
      command === "create-entry"
        ? await createJournalEntryFile(journalDirectory, candidate)
        : await createPostmortemFile(journalDirectory, candidate);
    outputs.push(path);
    validationResults.push({ check: `${command}-schema-and-links`, ok: true });
    console.log(`${command} complete — ${path}`);
  } catch (caught: unknown) {
    error = (caught as Error).message;
    if (!validationResults.some((result) => !result.ok)) {
      validationResults.push({ check: `${command}-schema-and-links`, ok: false, detail: error });
    }
    console.error(`${command} failed: ${error}`);
    process.exitCode = 1;
  } finally {
    mkdirSync(dataDirectory, { recursive: true });
    await appendJsonl(
      join(dataDirectory, "runs.jsonl"),
      RunRecord.parse({
        schemaVersion: 1,
        runId,
        trigger: "manual",
        task: `journal-${command}`,
        startedAt,
        finishedAt: new Date().toISOString(),
        inputVersions: { journalInput: inputHash },
        providerCalls: [],
        validationResults,
        outputs,
        error,
        model: null,
      })
    );
  }
} else {
  throw new Error(
    "usage: journal <create-entry|create-postmortem|search> [--input file] [--confirmed]"
  );
}
