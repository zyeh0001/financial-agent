# Options analysis

Analysis only. Never produce an order, executable action, or broker instruction.

Supported payoff models are coveredCall and longCall. A long-dated long call may be discussed as a LEAPS-style exposure, but the calculation remains a long call.

1. Source underlying price, strike, premium, expiry, contract multiplier, and timestamp from the same chain snapshot where possible.
2. Record bid/ask context and liquidity as unknown when unavailable; do not substitute last trade for an executable price without labeling it.
3. Build an input from templates/options-payoff-input.json and run npm run options-payoff -- --input <file>.
4. Report premium cash flow, break-even, maximum profit, maximum loss, annualised premium yield when applicable, and the expiry payoff grid from the stored run.
5. For covered calls, discuss retained share downside, capped upside, tax consequences as unknown unless supplied, dividend/early-assignment risk, and opportunity cost.
6. For long calls, discuss total premium loss, time decay, implied-volatility sensitivity as qualitative until a deterministic Greeks model exists, and the need for both direction and timing.
7. Populate templates/options-report.md and an optionsReport JSON payload. Run npm run reports:validate -- --type optionsReport --input <file> --calculation <stored-calculation-file>. Guidance must say it is an observation, not an instruction to trade.
8. A date-only hypothetical is not a quote timestamp. Ask for the observed time or label the input as a hypothetical cutoff; never imply midnight was the actual observation time.
