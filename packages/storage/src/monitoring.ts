import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { MonitorAlert, IsoTimestamp } from "@financial-agent/finance-core";
import { z } from "zod";
import { appendJsonl, readJsonl } from "./jsonl.js";

const AlertCreated = z.object({
  recordType: z.literal("alert-created"),
  schemaVersion: z.literal(1),
  eventId: z.string().regex(/^alert_[0-9a-f]{16}$/),
  createdAt: IsoTimestamp,
  alert: MonitorAlert,
}).strict();

const AlertDelivery = z.object({
  recordType: z.literal("alert-delivery"),
  schemaVersion: z.literal(1),
  eventId: z.string().regex(/^alert_[0-9a-f]{16}$/),
  attemptedAt: IsoTimestamp,
  adapter: z.string().min(1),
  ok: z.boolean(),
  error: z.string().min(1).nullable(),
}).strict().superRefine((record, context) => {
  if (record.ok === (record.error !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "successful delivery has no error; failed delivery requires one" });
  }
});

const AlertDeliveryClaim = z.object({
  recordType: z.literal("alert-delivery-claim"),
  schemaVersion: z.literal(1),
  eventId: z.string().regex(/^alert_[0-9a-f]{16}$/),
  claimedAt: IsoTimestamp,
  leaseUntil: IsoTimestamp,
  adapter: z.string().min(1),
}).strict();

const AlertLogRecord = z.union([AlertCreated, AlertDeliveryClaim, AlertDelivery]);
type AlertCreatedType = z.infer<typeof AlertCreated>;
type AlertDeliveryInput = Omit<z.input<typeof AlertDelivery>, "recordType" | "schemaVersion" | "eventId">;

async function withFileLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  const owner = String(process.pid);
  const execFileAsync = promisify(execFile);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await execFileAsync("/usr/bin/shlock", ["-f", lockPath, "-p", owner]);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("monitor storage requires macOS /usr/bin/shlock");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }
    try {
      return await work();
    } finally {
      const current = (await fs.readFile(lockPath, "utf8").catch(() => "")).trim();
      if (current === owner) await fs.unlink(lockPath).catch(() => undefined);
    }
  }
  throw new Error(`timed out acquiring alert log lock: ${lockPath}`);
}

async function readRecords(path: string) {
  const result = await readJsonl<unknown>(path);
  if (result.corruptTail !== null) throw new Error(`alert log has corrupt tail; refusing unsafe dedup: ${path}`);
  return result.records.map((record) => AlertLogRecord.parse(record));
}

export async function claimAlertEvent(
  path: string,
  rawAlert: unknown,
  dedupWindowMs: number,
): Promise<{ created: boolean; event: AlertCreatedType }> {
  if (!Number.isFinite(dedupWindowMs) || dedupWindowMs <= 0) throw new Error("dedup window must be positive");
  const alert = MonitorAlert.parse(rawAlert);
  return withFileLock(path, async () => {
    const records = await readRecords(path);
    const created = records.filter((record): record is AlertCreatedType => record.recordType === "alert-created");
    let duplicate: AlertCreatedType | undefined;
    for (let index = created.length - 1; index >= 0; index -= 1) {
      const record = created[index]!;
      if (
        record.alert.ruleId === alert.ruleId &&
        Math.abs(Date.parse(alert.generatedAt) - Date.parse(record.createdAt)) < dedupWindowMs
      ) {
        duplicate = record;
        break;
      }
    }
    if (duplicate) return { created: false, event: duplicate };

    const event = AlertCreated.parse({
      recordType: "alert-created",
      schemaVersion: 1,
      eventId: `alert_${createHash("sha256").update(`${alert.ruleId}\0${alert.generatedAt}`).digest("hex").slice(0, 16)}`,
      createdAt: alert.generatedAt,
      alert,
    });
    await appendJsonl(path, event);
    return { created: true, event };
  });
}

export async function markAlertDelivery(path: string, eventId: string, input: AlertDeliveryInput): Promise<void> {
  await withFileLock(path, async () => {
    const records = await readRecords(path);
    if (!records.some((record) => record.recordType === "alert-created" && record.eventId === eventId)) {
      throw new Error(`unknown alert event: ${eventId}`);
    }
    await appendJsonl(path, AlertDelivery.parse({
      recordType: "alert-delivery", schemaVersion: 1, eventId, ...input,
    }));
  });
}

export async function readPendingAlertEvents(path: string): Promise<AlertCreatedType[]> {
  const records = await readRecords(path);
  return pendingEvents(records, new Date());
}

function pendingEvents(records: z.infer<typeof AlertLogRecord>[], now: Date): AlertCreatedType[] {
  const delivered = new Set<string>();
  const activeClaims = new Set<string>();
  for (const record of records) {
    if (record.recordType === "alert-delivery-claim") {
      if (Date.parse(record.leaseUntil) > now.getTime()) activeClaims.add(record.eventId);
    } else if (record.recordType === "alert-delivery") {
      activeClaims.delete(record.eventId);
      if (record.ok) delivered.add(record.eventId);
    }
  }
  return records.filter((record): record is AlertCreatedType =>
    record.recordType === "alert-created" && !delivered.has(record.eventId) && !activeClaims.has(record.eventId)
  );
}

/** Atomically lease pending deliveries so overlapping monitor cycles cannot both send them. */
export async function claimPendingAlertDeliveries(path: string, input: {
  claimedAt: string;
  adapter: string;
  leaseMs: number;
}): Promise<AlertCreatedType[]> {
  const claimedAt = IsoTimestamp.parse(input.claimedAt);
  if (!Number.isFinite(input.leaseMs) || input.leaseMs <= 0) throw new Error("delivery lease must be positive");
  return withFileLock(path, async () => {
    const records = await readRecords(path);
    const pending = pendingEvents(records, new Date(claimedAt));
    const leaseUntil = new Date(Date.parse(claimedAt) + input.leaseMs).toISOString();
    for (const event of pending) {
      await appendJsonl(path, AlertDeliveryClaim.parse({
        recordType: "alert-delivery-claim",
        schemaVersion: 1,
        eventId: event.eventId,
        claimedAt,
        leaseUntil,
        adapter: input.adapter,
      }));
    }
    return pending;
  });
}
