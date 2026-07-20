import { z } from "zod";
import { IsoTimestamp } from "../schemas/common.js";
import { DailyDigest, DigestBudgetLimits } from "../schemas/reports.js";

export const ResearchEvent = z.object({
  eventId: z.string().min(1),
  publishedAt: IsoTimestamp,
  scope: z.enum(["asset", "macro"]),
  symbols: z.array(z.string().regex(/^[A-Z0-9.-]{1,20}$/)),
  macroTopics: z.array(z.string().trim().min(1)),
  category: z.enum(["filing", "earnings", "guidance", "capital-allocation", "regulatory", "macro", "other"]),
  headline: z.string().min(1),
  facts: z.string().min(1),
  source: z.object({
    publisher: z.string().min(1),
    url: z.string().url(),
    rank: z.enum(["original", "official", "secondary"]),
  }).strict(),
}).strict().superRefine((event, context) => {
  if (event.scope === "asset" && event.symbols.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["symbols"], message: "asset events require a symbol" });
  }
  if (event.scope === "macro" && event.macroTopics.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["macroTopics"], message: "macro events require a topic" });
  }
});
export type ResearchEvent = z.infer<typeof ResearchEvent>;

export const DigestConfig = z.object({
  schemaVersion: z.literal(1),
  secUserAgent: z.string().min(5).regex(/@/).optional(),
  summarizer: z.object({ provider: z.literal("anthropic"), model: z.string().min(1), maxTokens: z.number().int().positive().max(4096) }).strict().optional(),
  macroTopics: z.array(z.string().trim().min(1)).min(1),
  lookbackDays: z.object({ daily: z.number().int().positive(), weekly: z.number().int().positive() }).strict(),
  budget: DigestBudgetLimits,
}).strict();

const SOURCE_ORDER = { original: 0, official: 1, secondary: 2 } as const;
const THESIS_CHANGING = new Set(["filing", "earnings", "guidance", "capital-allocation", "regulatory"]);

export function buildDigestCandidate(input: {
  events: unknown[];
  heldSymbols: string[];
  watchedSymbols: string[];
  macroTopics: string[];
  seenEventIds: string[];
}) {
  const universe = new Set([...input.heldSymbols, ...input.watchedSymbols].map((symbol) => symbol.toUpperCase()));
  const held = new Set(input.heldSymbols.map((symbol) => symbol.toUpperCase()));
  const topics = new Set(input.macroTopics.map((topic) => topic.toLowerCase()));
  const seen = new Set(input.seenEventIds);
  const excluded: Array<{ eventId: string; reason: "already-seen" | "outside-universe" }> = [];
  const relevant: Array<ResearchEvent & { thesisImpact: "review-required" | "context-only"; classificationReason: string; holdingsAffected: string[] }> = [];

  for (const raw of input.events) {
    const event = ResearchEvent.parse(raw);
    if (seen.has(event.eventId)) {
      excluded.push({ eventId: event.eventId, reason: "already-seen" });
      continue;
    }
    const assetRelevant = event.scope === "asset" && event.symbols.some((symbol) => universe.has(symbol));
    const macroRelevant = event.scope === "macro" && event.macroTopics.some((topic) => topics.has(topic.toLowerCase()));
    if (!assetRelevant && !macroRelevant) {
      excluded.push({ eventId: event.eventId, reason: "outside-universe" });
      continue;
    }
    relevant.push({
      ...event,
      thesisImpact: THESIS_CHANGING.has(event.category) ? "review-required" : "context-only",
      classificationReason: THESIS_CHANGING.has(event.category)
        ? `${event.category} events require content review before judging thesis impact.`
        : "No deterministic thesis-changing signal was identified.",
      holdingsAffected: event.symbols.filter((symbol) => held.has(symbol)),
    });
  }
  relevant.sort((left, right) =>
    SOURCE_ORDER[left.source.rank] - SOURCE_ORDER[right.source.rank] ||
    Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
    left.eventId.localeCompare(right.eventId)
  );
  return { events: relevant, excluded };
}

export interface DigestSummarizer {
  summarize(events: ResearchEvent[], budget: { maxInputChars: number; maxOutputChars: number }): Promise<{
    claims: Array<{ text: string; eventIds: string[] }>;
    interpretations: Record<string, string>;
    model: string;
    usage: { inputChars: number; inputTokens: number; outputTokens: number };
  }>;
}

export async function runDigestCycle(input: {
  events: unknown[];
  heldSymbols: string[];
  watchedSymbols: string[];
  macroTopics: string[];
  seenEventIds: string[];
  runId: string;
  generatedAt: string;
  cadence: "daily" | "weekly";
  budget: { maxEvents: number; maxInputChars: number; maxOutputChars: number };
  maxTokens?: number;
  summarizer?: DigestSummarizer;
}) {
  const candidate = buildDigestCandidate(input);
  const budget = DigestBudgetLimits.parse(input.budget);
  const summaryEvents: ResearchEvent[] = [];
  let selectionChars = 0;
  if (input.summarizer) {
    for (const event of candidate.events.slice(0, budget.maxEvents)) {
      const length = JSON.stringify(event).length;
      if (selectionChars + length > budget.maxInputChars) break;
      summaryEvents.push(event);
      selectionChars += length;
    }
  }
  let summary: string | null = null;
  let summaryClaims: Array<{ text: string; eventIds: string[] }> = [];
  let interpretations: Record<string, string> = {};
  let model: string | null = null;
  let usage: { inputChars: number; inputTokens: number; outputTokens: number } | null = null;
  if (summaryEvents.length > 0 && input.summarizer) {
    const result = await input.summarizer.summarize(summaryEvents, budget);
    const allowedIds = new Set(summaryEvents.map((event) => event.eventId));
    const unknownId = Object.keys(result.interpretations).find((eventId) => !allowedIds.has(eventId));
    if (unknownId) throw new Error(`digest summarizer returned interpretation for unprovided event: ${unknownId}`);
    const unknownClaimId = result.claims.flatMap((claim) => claim.eventIds).find((eventId) => !allowedIds.has(eventId));
    if (unknownClaimId) throw new Error(`digest summarizer cited an unprovided event: ${unknownClaimId}`);
    const outputChars = result.claims.reduce((total, claim) => total + claim.text.length, 0) + Object.values(result.interpretations).reduce((total, value) => total + value.length, 0);
    if (outputChars > budget.maxOutputChars) throw new Error(`digest summarizer exceeded output budget: ${outputChars} > ${budget.maxOutputChars}`);
    summaryClaims = result.claims;
    summary = summaryClaims.map((claim) => claim.text).join(" ");
    interpretations = result.interpretations;
    model = result.model;
    usage = result.usage;
  }
  const outputChars = (summary?.length ?? 0) + summaryClaims.reduce((total, claim) => total + claim.text.length, 0) + Object.values(interpretations).reduce((total, value) => total + value.length, 0);
  const report = DailyDigest.parse({
    schemaVersion: 2,
    reportType: "dailyDigest",
    cadence: input.cadence,
    generatedAt: input.generatedAt,
    runId: input.runId,
    dataAsOf: candidate.events[0]?.publishedAt ?? input.generatedAt,
    sources: candidate.events.length > 0 ? [...new Set(candidate.events.map((event) => event.source.url))] : ["deterministic-collector:no-relevant-events"],
    disclaimer: "Research, not licensed financial advice.",
    events: candidate.events.map((event) => ({
      eventId: event.eventId,
      publishedAt: event.publishedAt,
      scope: event.scope,
      symbols: event.symbols,
      headline: event.headline,
      facts: event.facts,
      thesisImpact: event.thesisImpact,
      classificationReason: event.classificationReason,
      holdingsAffected: event.holdingsAffected,
      interpretation: interpretations[event.eventId] ?? null,
      source: event.source,
    })),
    summary,
    summaryClaims,
    budget: { ...budget, eventsUsed: summaryEvents.length, inputChars: usage?.inputChars ?? 0, outputChars,
      maxTokens: input.maxTokens ?? null, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null },
    noActionNeeded: !candidate.events.some((event) => event.thesisImpact === "review-required"),
  });
  return { report, llmCalled: model !== null, model, excluded: candidate.excluded };
}
