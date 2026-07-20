import { createHash } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RunRecord, makeRunId, type RunRecord as RunRecordType } from "@financial-agent/finance-core";
import { appendJsonl, atomicCreateFile } from "@financial-agent/storage";

interface CalculationRecord {
  runId: string;
  inputHash: string;
  input: { symbol: string };
}

interface CalculationCliOptions<TRecord extends CalculationRecord> {
  task: string;
  filenamePrefix: string;
  calculate(request: { runId: string; generatedAt: string; input: unknown }): TRecord;
}

function parseArguments(argv: string[]) {
  const values = new Map<string, string>();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (!["--input", "--data-dir"].includes(argument)) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${argument}`);
    if (values.has(argument)) throw new Error(`duplicate argument: ${argument}`);
    values.set(argument, value);
    index += 1;
  }
  const inputPath = values.get("--input");
  if (inputPath === undefined) throw new Error("usage: --input <json-file> [--data-dir <directory>] [--json]");
  const investmentDirectory =
    process.env["INVESTMENT_DIR"] ?? join(homedir(), "Documents/notes/Charles/Investment");
  return {
    inputPath,
    dataDirectory: values.get("--data-dir") ?? join(investmentDirectory, "data"),
    runId: makeRunId(),
    generatedAt: new Date().toISOString(),
    json,
  };
}

export async function runCalculationCli<TRecord extends CalculationRecord>(
  options: CalculationCliOptions<TRecord>
): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const startedAt = arguments_.generatedAt;
  const validationResults: RunRecordType["validationResults"] = [];
  const outputs: string[] = [];
  let error: string | null = null;
  let inputHash = "sha256:unavailable";

  try {
    const rawInput = readFileSync(arguments_.inputPath, "utf8");
    inputHash = `sha256:${createHash("sha256").update(rawInput).digest("hex")}`;
    const candidate = JSON.parse(rawInput) as unknown;
    const record = options.calculate({
      runId: arguments_.runId,
      generatedAt: arguments_.generatedAt,
      input: candidate,
    });
    inputHash = record.inputHash;
    validationResults.push({ check: `${options.task}-schema`, ok: true });

    const safeSymbol = record.input.symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, "-");
    const calculationDirectory = join(arguments_.dataDirectory, "calculations");
    mkdirSync(calculationDirectory, { recursive: true });
    const outputPath = join(
      calculationDirectory,
      `${options.filenamePrefix}-${safeSymbol}-${record.runId}.json`
    );
    await atomicCreateFile(outputPath, JSON.stringify(record, null, 2));
    outputs.push(outputPath);

    if (arguments_.json) console.log(JSON.stringify(record, null, 2));
    else console.log(`${options.task} complete — ${record.runId}\nSaved: ${outputPath}`);
  } catch (caught: unknown) {
    error = (caught as Error).message;
    validationResults.push({ check: `${options.task}-schema`, ok: false, detail: error });
    console.error(`${options.task} failed: ${error}`);
    process.exitCode = 1;
  } finally {
    mkdirSync(arguments_.dataDirectory, { recursive: true });
    const audit = RunRecord.parse({
      schemaVersion: 1,
      runId: arguments_.runId,
      trigger: "manual",
      task: options.task,
      startedAt,
      finishedAt: new Date().toISOString(),
      inputVersions: { calculationInput: inputHash },
      providerCalls: [],
      validationResults,
      outputs,
      error,
      model: null,
    });
    await appendJsonl(join(arguments_.dataDirectory, "runs.jsonl"), audit);
  }
}
