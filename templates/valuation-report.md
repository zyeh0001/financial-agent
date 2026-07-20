# {{symbol}} — valuation

**Data as of:** {{dataAsOf}}<br>
**Calculation run:** {{runId}}<br>
**Input hash:** {{inputHash}}<br>
**Method/currency:** two-stage DCF · {{currency}}

## Sourced inputs

| Input | Value | Source | As of |
|---|---:|---|---|
| Free cash flow | {{freeCashFlow}} | {{freeCashFlowSource}} | {{freeCashFlowAsOf}} |
| Net debt | {{netDebt}} | {{netDebtSource}} | {{netDebtAsOf}} |
| Diluted shares | {{shares}} | {{sharesSource}} | {{sharesAsOf}} |

## Assumptions and results

| Case | Growth | Discount | Terminal growth | Implied value/share |
|---|---:|---:|---:|---:|
| Bear | {{bearGrowth}} | {{bearDiscount}} | {{bearTerminalGrowth}} | {{bearValue}} |
| Base | {{baseGrowth}} | {{baseDiscount}} | {{baseTerminalGrowth}} | {{baseValue}} |
| Bull | {{bullGrowth}} | {{bullDiscount}} | {{bullTerminalGrowth}} | {{bullValue}} |

## Sensitivity, risks, and unknowns

{{sensitivitySummary}}

- Risk: {{risk}}
- Unknown: {{unknown}}
- Invalidated if: {{invalidationCondition}}

Research, not licensed financial advice.
