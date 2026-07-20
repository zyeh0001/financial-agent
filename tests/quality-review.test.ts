import { describe, expect, it } from "vitest";
import {
  compareQualityReviews,
  evaluateQualityReview,
  runReadOnlyQualityReview,
} from "@financial-agent/finance-core";

const benchmark = {
  schemaVersion: 1 as const,
  caseId: "example-stock-review",
  expectedUnsupportedClaimIds: ["claim-growth"],
  expectedRiskIds: ["risk-concentration", "risk-refinancing"],
  expectedArithmeticDiscrepancyIds: ["calc-share-count"],
  claimIds: ["claim-fcf", "claim-growth", "claim-margin", "claim-debt"],
};

describe("quality review evaluation", () => {
  it("measures improvement from the read-only pipeline against fixed expected findings", async () => {
    const baseline = evaluateQualityReview(benchmark, {
      schemaVersion: 1,
      unsupportedClaimIds: [],
      riskIds: ["risk-concentration"],
      arithmeticDiscrepancyIds: [],
      sourcedClaimIds: ["claim-fcf", "claim-debt"],
    });
    const candidateResult = await runReadOnlyQualityReview(
      {
        schemaVersion: 1,
        reportId: "example-stock-review",
        claims: benchmark.claimIds.map((id) => ({
          id,
          text: `Worked claim ${id}.`,
          evidence:
            id === "claim-growth"
              ? []
              : [
                  {
                    sourceUrl: `https://example.com/filing#${id}`,
                    sourceType: "original" as const,
                    asOf: "2026-07-19T00:00:00Z",
                    verifiedAt: "2026-07-20T00:00:00Z",
                  },
                ],
        })),
        existingRisks: [{ id: "risk-concentration", text: "Customer concentration." }],
        schemaValidationIssues: [],
        calculationChecks: [{ id: "calc-share-count", status: "discrepancy" }],
      },
      {
        maxReviewerCalls: 2,
        riskManager: {
          review: async () => ({
            schemaVersion: 1,
            risks: [
              {
                id: "risk-concentration",
                description: "Customer concentration.",
                severity: "high",
                relatedClaimIds: [],
                evidenceUrls: [],
              },
              {
                id: "risk-refinancing",
                description: "Debt may need refinancing.",
                severity: "medium",
                relatedClaimIds: [],
                evidenceUrls: [],
              },
            ],
          }),
        },
        sourceFactChecker: {
          review: async () => ({
            schemaVersion: 1,
            unsupportedClaimIds: ["claim-growth"],
            supportedClaims: ["claim-fcf", "claim-margin", "claim-debt"].map((claimId) => ({
              claimId,
              evidenceUrls: [`https://example.com/filing#${claimId}`],
            })),
          }),
        },
      }
    );
    const candidate = evaluateQualityReview(benchmark, candidateResult.findings);

    expect(baseline.metrics).toEqual({
      unsupportedClaimRecall: 0,
      riskRecall: 0.5,
      arithmeticDiscrepancyRecall: 0,
      sourceCoverage: 0.5,
    });
    expect(compareQualityReviews(baseline, candidate)).toMatchObject({
      improved: true,
      regressions: [],
      deltas: {
        unsupportedClaimRecall: 1,
        riskRecall: 0.5,
        arithmeticDiscrepancyRecall: 1,
        sourceCoverage: 0.25,
      },
    });
  });

  it("runs only the two scoped reviewers over a portfolio-free artifact", async () => {
    const seenInputs: unknown[] = [];
    const findings = await runReadOnlyQualityReview(
      {
        schemaVersion: 1,
        reportId: "report-example",
        claims: [
          {
            id: "claim-growth",
            text: "Growth will accelerate.",
            evidence: [],
          },
        ],
        existingRisks: [{ id: "risk-concentration", text: "Customer concentration." }],
        schemaValidationIssues: [],
        calculationChecks: [{ id: "calc-share-count", status: "discrepancy" }],
      },
      {
        maxReviewerCalls: 2,
        riskManager: {
          review: async (input) => {
            seenInputs.push(input);
            return {
              schemaVersion: 1,
              risks: [
                {
                  id: "risk-concentration",
                  description: "Customer concentration.",
                  severity: "high",
                  relatedClaimIds: [],
                  evidenceUrls: [],
                },
                {
                  id: "risk-refinancing",
                  description: "Debt may need refinancing.",
                  severity: "medium",
                  relatedClaimIds: [],
                  evidenceUrls: [],
                },
              ],
            };
          },
        },
        sourceFactChecker: {
          review: async (input) => {
            seenInputs.push(input);
            return {
              schemaVersion: 1,
              unsupportedClaimIds: ["claim-growth"],
              supportedClaims: [],
            };
          },
        },
      }
    );

    expect(findings.findings).toEqual({
      schemaVersion: 1,
      unsupportedClaimIds: ["claim-growth"],
      riskIds: ["risk-concentration", "risk-refinancing"],
      arithmeticDiscrepancyIds: ["calc-share-count"],
      sourcedClaimIds: [],
    });
    expect(seenInputs).toHaveLength(2);
    expect(JSON.stringify(seenInputs)).not.toContain("portfolio");
  });

  it("enforces the reviewer-call budget before invoking either reviewer", async () => {
    let calls = 0;
    const reviewer = { review: async () => (calls += 1) };
    await expect(
      runReadOnlyQualityReview(
        {
          schemaVersion: 1,
          reportId: "report-example",
          claims: [],
          existingRisks: [],
          schemaValidationIssues: [],
          calculationChecks: [],
        },
        {
          maxReviewerCalls: 1,
          riskManager: reviewer,
          sourceFactChecker: reviewer,
        }
      )
    ).rejects.toThrow("reviewer call budget exceeded");
    expect(calls).toBe(0);
  });

  it("refuses second-pass review until every higher-trust gate has passed", async () => {
    await expect(
      runReadOnlyQualityReview(
        {
          schemaVersion: 1,
          reportId: "report-example",
          claims: [],
          existingRisks: [],
          schemaValidationIssues: ["report shape invalid"],
          calculationChecks: [],
        },
        { maxReviewerCalls: 0 }
      )
    ).rejects.toThrow("prerequisite quality gate failed");
  });

  it("rejects contradictory or false-positive benchmark findings", () => {
    expect(() =>
      evaluateQualityReview(benchmark, {
        schemaVersion: 1,
        unsupportedClaimIds: ["claim-growth"],
        riskIds: ["risk-invented"],
        arithmeticDiscrepancyIds: [],
        sourcedClaimIds: ["claim-growth"],
      })
    ).toThrow(/both unsupported and sourced|false-positive/);
  });

  it("represents metric regressions as negative deltas", () => {
    const strong = evaluateQualityReview(benchmark, {
      schemaVersion: 1,
      unsupportedClaimIds: ["claim-growth"],
      riskIds: ["risk-concentration", "risk-refinancing"],
      arithmeticDiscrepancyIds: ["calc-share-count"],
      sourcedClaimIds: ["claim-fcf", "claim-margin", "claim-debt"],
    });
    const weak = evaluateQualityReview(benchmark, {
      schemaVersion: 1,
      unsupportedClaimIds: [],
      riskIds: [],
      arithmeticDiscrepancyIds: [],
      sourcedClaimIds: [],
    });

    expect(compareQualityReviews(strong, weak)).toMatchObject({
      improved: false,
      deltas: { unsupportedClaimRecall: -1, riskRecall: -1 },
    });
  });

  it("does not let an untrusted reviewer mutate the review projection", async () => {
    await expect(
      runReadOnlyQualityReview(
        {
          schemaVersion: 1,
          reportId: "report-example",
          claims: [{ id: "claim-1", text: "Reported fact.", evidence: [] }],
          existingRisks: [],
          schemaValidationIssues: [],
          calculationChecks: [],
        },
        {
          maxReviewerCalls: 1,
          sourceFactChecker: {
            review: async (input) => {
              input.claims.push({ id: "claim-injected", text: "Injected.", evidence: [] });
              return {
                schemaVersion: 1,
                unsupportedClaimIds: [],
                supportedClaims: [{ claimId: "claim-injected", evidenceUrls: ["https://example.com"] }],
              };
            },
          },
        }
      )
    ).rejects.toThrow();
  });
});
