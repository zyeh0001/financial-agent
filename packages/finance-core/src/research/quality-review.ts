import { z } from "zod";

const FindingIds = z.array(z.string().min(1));

export const QualityBenchmark = z
  .object({
    schemaVersion: z.literal(1),
    caseId: z.string().min(1),
    expectedUnsupportedClaimIds: FindingIds,
    expectedRiskIds: FindingIds,
    expectedArithmeticDiscrepancyIds: FindingIds,
    claimIds: FindingIds,
  })
  .strict();
export type QualityBenchmark = z.infer<typeof QualityBenchmark>;

export const QualityReviewFindings = z
  .object({
    schemaVersion: z.literal(1),
    unsupportedClaimIds: FindingIds,
    riskIds: FindingIds,
    arithmeticDiscrepancyIds: FindingIds,
    sourcedClaimIds: FindingIds,
  })
  .strict();
export type QualityReviewFindings = z.infer<typeof QualityReviewFindings>;

const Evidence = z
  .object({
    sourceUrl: z.string().url(),
    sourceType: z.enum(["original", "official", "secondary"]),
    asOf: z.string().min(1),
    verifiedAt: z.string().datetime(),
  })
  .strict();

const ReviewClaim = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    evidence: z.array(Evidence),
  })
  .strict();

const ReviewRisk = z.object({ id: z.string().min(1), text: z.string().min(1) }).strict();

const CalculationCheck = z
  .object({ id: z.string().min(1), status: z.enum(["passed", "discrepancy"]) })
  .strict();

export const ReadOnlyReviewArtifact = z
  .object({
    schemaVersion: z.literal(1),
    reportId: z.string().min(1),
    claims: z.array(ReviewClaim),
    existingRisks: z.array(ReviewRisk),
    schemaValidationIssues: z.array(z.string()),
    calculationChecks: z.array(CalculationCheck),
  })
  .strict();
export type ReadOnlyReviewArtifact = z.infer<typeof ReadOnlyReviewArtifact>;

const RiskManagerResult = z
  .object({
    schemaVersion: z.literal(1),
    risks: z.array(
      z
        .object({
          id: z.string().min(1),
          description: z.string().min(1),
          severity: z.enum(["low", "medium", "high"]),
          relatedClaimIds: FindingIds,
          evidenceUrls: z.array(z.string().url()),
        })
        .strict()
    ),
  })
  .strict();
const SourceFactCheckerResult = z
  .object({
    schemaVersion: z.literal(1),
    unsupportedClaimIds: FindingIds,
    supportedClaims: z.array(
      z
        .object({ claimId: z.string().min(1), evidenceUrls: z.array(z.string().url()).min(1) })
        .strict()
    ),
  })
  .strict();

export interface RiskManager {
  review(input: Pick<ReadOnlyReviewArtifact, "reportId" | "claims" | "existingRisks">): Promise<unknown>;
}

export interface SourceFactChecker {
  review(input: Pick<ReadOnlyReviewArtifact, "reportId" | "claims">): Promise<unknown>;
}

export interface ReadOnlyQualityReviewOptions {
  maxReviewerCalls: 0 | 1 | 2;
  riskManager?: RiskManager;
  sourceFactChecker?: SourceFactChecker;
}

export interface QualityPipelineResult {
  findings: QualityReviewFindings;
  riskFindings: z.infer<typeof RiskManagerResult>["risks"];
  sourceMappings: z.infer<typeof SourceFactCheckerResult>["supportedClaims"];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function immutableProjection<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

/**
 * Run second-pass reviewers over a deliberately narrow, read-only projection.
 * Arithmetic findings are accepted only from the deterministic layer and cannot
 * be changed by either reviewer.
 */
export async function runReadOnlyQualityReview(
  artifactInput: ReadOnlyReviewArtifact,
  options: ReadOnlyQualityReviewOptions
): Promise<QualityPipelineResult> {
  const artifact = ReadOnlyReviewArtifact.parse(artifactInput);
  if (artifact.schemaValidationIssues.length > 0) {
    throw new Error(`prerequisite quality gate failed: schema validation`);
  }
  const reviewerCount = Number(options.riskManager !== undefined) + Number(options.sourceFactChecker !== undefined);
  if (reviewerCount > options.maxReviewerCalls) {
    throw new Error(`reviewer call budget exceeded: ${reviewerCount} requested, ${options.maxReviewerCalls} allowed`);
  }

  const claimIds = new Set(artifact.claims.map((claim) => claim.id));
  const riskInput = immutableProjection({
    reportId: artifact.reportId,
    claims: artifact.claims,
    existingRisks: artifact.existingRisks,
  });
  const sourceInput = immutableProjection({
    reportId: artifact.reportId,
    claims: artifact.claims,
  });

  const [riskOutput, sourceOutput] = await Promise.all([
    options.riskManager?.review(riskInput),
    options.sourceFactChecker?.review(sourceInput),
  ]);
  const riskResult =
    riskOutput === undefined
      ? {
          schemaVersion: 1 as const,
          risks: artifact.existingRisks.map((risk) => ({
            id: risk.id,
            description: risk.text,
            severity: "medium" as const,
            relatedClaimIds: [],
            evidenceUrls: [],
          })),
        }
      : RiskManagerResult.parse(riskOutput);
  const sourceResult =
    sourceOutput === undefined
      ? {
          schemaVersion: 1 as const,
          unsupportedClaimIds: [],
          supportedClaims: artifact.claims
            .filter((claim) => claim.evidence.length > 0)
            .map((claim) => ({
              claimId: claim.id,
              evidenceUrls: claim.evidence.map((evidence) => evidence.sourceUrl),
            })),
        }
      : SourceFactCheckerResult.parse(sourceOutput);

  for (const id of [
    ...sourceResult.unsupportedClaimIds,
    ...sourceResult.supportedClaims.map((finding) => finding.claimId),
  ]) {
    if (!claimIds.has(id)) throw new Error(`source review returned unknown claim ID: ${id}`);
  }
  const claimsById = new Map(artifact.claims.map((claim) => [claim.id, claim]));
  const unsupportedClaimIds = new Set(sourceResult.unsupportedClaimIds);
  for (const mapping of sourceResult.supportedClaims) {
    if (unsupportedClaimIds.has(mapping.claimId)) {
      throw new Error(`claim cannot be both unsupported and sourced: ${mapping.claimId}`);
    }
    const allowedUrls = new Set(claimsById.get(mapping.claimId)?.evidence.map((item) => item.sourceUrl));
    const invalidUrl = mapping.evidenceUrls.find((url) => !allowedUrls.has(url));
    if (invalidUrl !== undefined) throw new Error(`source review returned unverified evidence: ${invalidUrl}`);
  }
  const allEvidenceUrls = new Set(
    artifact.claims.flatMap((claim) => claim.evidence.map((evidence) => evidence.sourceUrl))
  );
  for (const risk of riskResult.risks) {
    const unknownClaim = risk.relatedClaimIds.find((id) => !claimIds.has(id));
    if (unknownClaim !== undefined) throw new Error(`risk review returned unknown claim ID: ${unknownClaim}`);
    const unknownEvidence = risk.evidenceUrls.find((url) => !allEvidenceUrls.has(url));
    if (unknownEvidence !== undefined) {
      throw new Error(`risk review returned unverified evidence: ${unknownEvidence}`);
    }
  }

  return {
    findings: QualityReviewFindings.parse({
      schemaVersion: 1,
      unsupportedClaimIds: sourceResult.unsupportedClaimIds,
      riskIds: riskResult.risks.map((risk) => risk.id),
      arithmeticDiscrepancyIds: artifact.calculationChecks
        .filter((check) => check.status === "discrepancy")
        .map((check) => check.id),
      sourcedClaimIds: sourceResult.supportedClaims.map((mapping) => mapping.claimId),
    }),
    riskFindings: riskResult.risks,
    sourceMappings: sourceResult.supportedClaims,
  };
}

export const QualityMetrics = z
  .object({
    unsupportedClaimRecall: z.number().min(0).max(1),
    riskRecall: z.number().min(0).max(1),
    arithmeticDiscrepancyRecall: z.number().min(0).max(1),
    sourceCoverage: z.number().min(0).max(1),
  })
  .strict();
export type QualityMetrics = z.infer<typeof QualityMetrics>;

export interface QualityEvaluation {
  caseId: string;
  metrics: QualityMetrics;
}

function recall(expected: string[], observed: string[]): number {
  if (expected.length === 0) return 1;
  const found = new Set(observed);
  return expected.filter((id) => found.has(id)).length / expected.length;
}

export function evaluateQualityReview(
  benchmarkInput: QualityBenchmark,
  findingsInput: QualityReviewFindings
): QualityEvaluation {
  const benchmark = QualityBenchmark.parse(benchmarkInput);
  const findings = QualityReviewFindings.parse(findingsInput);
  const unsupported = new Set(findings.unsupportedClaimIds);
  const contradictoryClaim = findings.sourcedClaimIds.find((id) => unsupported.has(id));
  if (contradictoryClaim !== undefined) {
    throw new Error(`claim cannot be both unsupported and sourced: ${contradictoryClaim}`);
  }
  const allowedByField: Array<[string, string[], string[]]> = [
    ["unsupported claim", benchmark.expectedUnsupportedClaimIds, findings.unsupportedClaimIds],
    ["risk", benchmark.expectedRiskIds, findings.riskIds],
    [
      "arithmetic discrepancy",
      benchmark.expectedArithmeticDiscrepancyIds,
      findings.arithmeticDiscrepancyIds,
    ],
    ["sourced claim", benchmark.claimIds, findings.sourcedClaimIds],
  ];
  for (const [field, expected, observed] of allowedByField) {
    const allowed = new Set(expected);
    const falsePositive = observed.find((id) => !allowed.has(id));
    if (falsePositive !== undefined) {
      throw new Error(`false-positive ${field} ID: ${falsePositive}`);
    }
  }
  return {
    caseId: benchmark.caseId,
    metrics: {
      unsupportedClaimRecall: recall(
        benchmark.expectedUnsupportedClaimIds,
        findings.unsupportedClaimIds
      ),
      riskRecall: recall(benchmark.expectedRiskIds, findings.riskIds),
      arithmeticDiscrepancyRecall: recall(
        benchmark.expectedArithmeticDiscrepancyIds,
        findings.arithmeticDiscrepancyIds
      ),
      sourceCoverage: recall(benchmark.claimIds, findings.sourcedClaimIds),
    },
  };
}

export interface QualityComparison {
  improved: boolean;
  regressions: Array<keyof QualityMetrics>;
  deltas: QualityMetricDeltas;
}

export type QualityMetricDeltas = Record<keyof QualityMetrics, number>;

const metricNames: Array<keyof QualityMetrics> = [
  "unsupportedClaimRecall",
  "riskRecall",
  "arithmeticDiscrepancyRecall",
  "sourceCoverage",
];

export function compareQualityReviews(
  baseline: QualityEvaluation,
  candidate: QualityEvaluation
): QualityComparison {
  if (baseline.caseId !== candidate.caseId) {
    throw new Error("quality evaluations must refer to the same benchmark case");
  }
  const deltas = Object.fromEntries(
    metricNames.map((name) => [name, candidate.metrics[name] - baseline.metrics[name]])
  ) as QualityMetricDeltas;
  const regressions = metricNames.filter((name) => deltas[name] < 0);
  return {
    improved: regressions.length === 0 && metricNames.some((name) => deltas[name] > 0),
    regressions,
    deltas,
  };
}
