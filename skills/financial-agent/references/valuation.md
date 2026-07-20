# Valuation

Use a two-stage DCF only when current free cash flow is positive and the inputs are meaningful. If it is unsuitable, explain why and use sourced multiples qualitatively until another deterministic method exists.

1. Source free cash flow, net debt, and diluted shares from original filings. Record currency and as-of timestamps for each input.
2. Define forecast years plus bear/base/bull growth, discount, and terminal-growth assumptions. Require discount rate to exceed terminal growth.
3. Build an input from templates/valuation-input.json. Never convert currencies silently; convert upstream with an explicit sourced FX rate or keep the valuation in the source currency.
4. Run npm run valuation -- --input <file>. The command saves an immutable calculation under Investment/data/calculations and appends its audit record to runs.jsonl.
5. Inspect terminal-value dependence and the generated sensitivity grid. Do not hide implausible outputs.
6. Cross-check directionally against sourced multiples, but label the cross-check separately from the DCF.
7. Populate templates/valuation-report.md and a valuationReport v2 JSON payload. Its run ID and input hash must match the stored calculation. Run npm run reports:validate -- --type valuationReport --input <file> --calculation <stored-calculation-file>.
8. State risks, unknowns, invalidation conditions, fair range, and next evidence to watch.
