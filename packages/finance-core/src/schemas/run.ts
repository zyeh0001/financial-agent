import { z } from "zod";
import { IsoTimestamp, RunId } from "./common.js";

/**
 * Audit record for every automated run (SECURITY §7).
 * Appended to runs.jsonl by the scheduler/CLI — never by prose.
 */
export const RunRecord = z
  .object({
    schemaVersion: z.literal(1),
    runId: RunId,
    trigger: z.enum(["scheduled", "manual", "agent"]),
    task: z.string().min(1),
    startedAt: IsoTimestamp,
    finishedAt: IsoTimestamp.nullable(),
    /** e.g. { portfolio: "portfolio_20260720_001", rules: "sha256:..." } */
    inputVersions: z.record(z.string(), z.string()),
    providerCalls: z.array(
      z
        .object({
          provider: z.string(),
          endpoint: z.string(),
          ok: z.boolean(),
          cached: z.boolean().default(false),
        })
        .strict()
    ),
    validationResults: z.array(
      z.object({ check: z.string(), ok: z.boolean(), detail: z.string().optional() }).strict()
    ),
    outputs: z.array(z.string()),
    error: z.string().nullable(),
    /** model identifier iff an LLM was used in this run */
    model: z.string().nullable(),
  })
  .strict();
export type RunRecord = z.infer<typeof RunRecord>;
