# Monitoring

Monitoring is alert-only. No rule may contain an action, order, side, or size.

Translate the user’s condition into a rules.validate candidate. State the exact field, operator, threshold, currency where relevant, data source, staleness behavior, severity, and dedup expectation. Creating or changing a rule requires explicit confirmation. The alert must say it is an observation, not an instruction to trade.

The scheduled evaluator is `npm run monitor`. It runs independently through launchd when
the rendered agent is installed and loaded; do not claim continuous monitoring merely
because a rule exists. Check `data/runs.jsonl` for successful cycles and `data/alerts.jsonl`
for creation/delivery state. The default dedup window is 24 hours.
