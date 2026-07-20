import { readFileSync } from "node:fs";
import { ReportType, validateReportWithCalculations } from "@financial-agent/finance-core";

function argumentValue(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || value === undefined || value.startsWith("--")) {
    throw new Error(`usage: --type <report-type> --input <json-file>`);
  }
  return value;
}

function argumentValues(name: string): string[] {
  return process.argv.flatMap((argument, index) =>
    argument === name && process.argv[index + 1] !== undefined ? [process.argv[index + 1]!] : []
  );
}

try {
  const reportType = ReportType.parse(argumentValue("--type"));
  const inputPath = argumentValue("--input");
  const payload = JSON.parse(readFileSync(inputPath, "utf8")) as unknown;
  const calculations = argumentValues("--calculation").map(
    (path) => JSON.parse(readFileSync(path, "utf8")) as unknown
  );
  const validation = validateReportWithCalculations(reportType, payload, calculations);
  if (!validation.valid) {
    console.error(JSON.stringify(validation.issues, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`valid ${reportType}: ${inputPath}`);
  }
} catch (error: unknown) {
  console.error(`report validation failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
