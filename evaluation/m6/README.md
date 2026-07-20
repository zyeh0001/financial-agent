# M6 quality benchmark

This fixed worked case proves the M6 measurement path. `baseline.json` represents
the unreviewed result; `candidate.json` represents the deterministic calculation
check plus the two read-only reviewers. Run:

```sh
npm run quality:evaluate -- \
  --benchmark evaluation/m6/benchmark.json \
  --baseline evaluation/m6/baseline.json \
  --candidate evaluation/m6/candidate.json \
  --output evaluation/m6/result.json
```

The evaluator reports recall for unsupported claims, identified risks, and
arithmetic discrepancies, plus claim source coverage. Candidate adoption requires
at least one strict improvement and no regression. `result.json` is generated and
need not be committed.

The fixture is intentionally small and synthetic. The matching integration test runs the
worked artifact through `runReadOnlyQualityReview`, including both reviewer contracts and
the deterministic prerequisite gates, before evaluating its output. This validates the
pipeline and scoring gate, not live-model accuracy. Add representative gold-labelled cases
before using a new specialist reviewer. No additional M6 reviewer is justified by this
benchmark.
