# {{symbol}} — stock research

**Data as of:** {{dataAsOf}}<br>
**Report run:** {{reportRunId}}<br>
**Calculation:** {{calculationRunId}} · {{inputHash}}<br>
**Currency:** {{currency}}

## Decision question

{{question}}

## Sourced facts

| Fact | Structured value | Source | As of | Currency/unit |
|---|---:|---|---|---|
| {{fact}} | {{factValueOrNonNumeric}} | [{{sourceTitle}}]({{sourceUrl}}) | {{sourceAsOf}} | {{currency}} / {{unit}} |

## Thesis

{{thesis}}

## Assumptions

- {{assumption}}

## Scenarios

| Case | What must be true | Implied value | Calculation run |
|---|---|---:|---|
| Bear | {{bearNarrative}} | {{bearValue}} {{currency}} | {{calculationRunId}} |
| Base | {{baseNarrative}} | {{baseValue}} {{currency}} | {{calculationRunId}} |
| Bull | {{bullNarrative}} | {{bullValue}} {{currency}} | {{calculationRunId}} |

## Risks and invalidation

- Risk: {{risk}}
- Invalidated if: {{invalidationCondition}}

## Unknowns

- {{unknown}}

## Discipline

- Attractive below: {{attractiveBelow}}
- Fair value range: {{fairValueLow}}–{{fairValueHigh}}
- Too optimistic above: {{tooOptimisticAbove}}
- Invalidated if: {{invalidationCondition}}
- Next data point: {{nextDataPoint}}

Research, not licensed financial advice.
