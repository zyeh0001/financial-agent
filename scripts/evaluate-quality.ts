import { readFileSync, writeFileSync } from "node:fs";
import {
  QualityBenchmark,
  QualityReviewFindings,
  compareQualityReviews,
  evaluateQualityReview,
} from "@financial-agent/finance-core";

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = process.argv[index + 1];
  if (index < 0 || value === undefined) throw new Error(`missing --${name}`);
  return value;
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const benchmark = QualityBenchmark.parse(json(argument("benchmark")));
const baseline = evaluateQualityReview(
  benchmark,
  QualityReviewFindings.parse(json(argument("baseline")))
);
const candidate = evaluateQualityReview(
  benchmark,
  QualityReviewFindings.parse(json(argument("candidate")))
);
const comparison = compareQualityReviews(baseline, candidate);
const result = {
  schemaVersion: 1,
  caseId: benchmark.caseId,
  baseline: baseline.metrics,
  candidate: candidate.metrics,
  comparison,
};

writeFileSync(argument("output"), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`quality improved: ${comparison.improved ? "yes" : "no"}\n`);
if (!comparison.improved) process.exitCode = 1;
