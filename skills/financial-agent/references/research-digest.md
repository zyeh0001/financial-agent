# Research digest

Limit collection to held or explicitly watched symbols and relevant macro events. Separate event facts from interpretation, rank original sources first, and link every claim. If nothing relevant changed, produce no LLM summary and say no action is required.

The scheduled collector is `npm run digest` (`--weekly` for the weekly cadence). It reads
held and watched symbols plus explicit macro topics, records immutable reports under
`data/digests/`, and audits every run. A configured launchd agent makes it proactive; merely
having the command or config file does not. The default CLI performs deterministic collection
only. Optional summarization must stay inside the recorded budget and is never called when
there are no unseen relevant events.
