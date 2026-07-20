# Journal

Journal files live in Investment/journal as validated Markdown records.

- Search is read-only and may filter by symbol and timestamp range.
- Search with npm run journal -- search --symbol <ticker> --from <ISO timestamp> --to <ISO timestamp> --json. Filters are optional.
- Creating an entry or postmortem records user intent and always requires explicit confirmation in chat. Only after that confirmation, run npm run journal -- create-entry --input <json-file> --confirmed or npm run journal -- create-postmortem --input <json-file> --confirmed. Never infer or add the flag yourself without the chat confirmation.
- An entry must include thesis, horizon, entry reason, risks, and observable invalidation conditions.
- A postmortem must link an existing entry and separate thesis quality, timing, rule violations, luck versus skill, and lessons.
- Use templates/journal-entry.md and templates/postmortem.md for review before creation.
- Never infer a buy/sell decision from research output. Record only the decision the user explicitly confirms.
