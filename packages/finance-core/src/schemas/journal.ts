import { z } from "zod";
import { IsoTimestamp, JournalId } from "./common.js";

/**
 * Investment journal — decision record at entry, postmortem at exit.
 * Generalizes experiment-log.md to every material decision (PRD §4.7).
 */

export const JournalEntry = z
  .object({
    schemaVersion: z.literal(1),
    id: JournalId,
    ts: IsoTimestamp,
    symbol: z.string().min(1),
    decision: z.enum(["buy", "sell", "trim", "add", "hold", "pass"]),
    thesis: z.string().min(1),
    horizon: z.string().min(1),
    entryReason: z.string().min(1),
    valuationAssumptions: z.string().optional(),
    risks: z.array(z.string()).min(1),
    invalidationConditions: z.array(z.string()).min(1),
    exitPlan: z.string().optional(),
    marketContext: z.string().optional(),
  })
  .strict();
export type JournalEntry = z.infer<typeof JournalEntry>;

export const Postmortem = z
  .object({
    schemaVersion: z.literal(1),
    id: JournalId,
    ts: IsoTimestamp,
    /** the JournalEntry this closes out */
    entryId: JournalId,
    outcome: z.string().min(1),
    thesisCorrect: z.enum(["yes", "partially", "no"]),
    timingCorrect: z.enum(["yes", "partially", "no"]),
    ruleViolations: z.array(z.string()),
    luckVsSkill: z.string().min(1),
    lessons: z.array(z.string()).min(1),
  })
  .strict();
export type Postmortem = z.infer<typeof Postmortem>;
