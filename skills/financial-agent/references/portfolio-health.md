# Portfolio health

1. Read portfolio.md, finances.md, risk-limits.yaml, investor-profile.md, and portfolio-policy.md from the configured Investment directory.
2. Stop on sync conflicts, malformed positions, missing quotes, or missing FX. Never value a partial portfolio as complete.
3. Run npm run health-report. Use its stored report and run ID as the quantitative source.
4. Explain allocation drift, concentration, currency exposure, staleness, emergency-fund status, and unknown cost bases.
5. Apply policy in order: emergency fund first, then glide path, then concentration. Keep tax consequences explicit and unknown unless supplied.
6. Suggest review actions, never trade instructions.
