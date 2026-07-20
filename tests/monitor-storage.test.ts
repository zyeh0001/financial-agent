import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { claimAlertEvent, claimPendingAlertDeliveries, markAlertDelivery, readPendingAlertEvents } from "@financial-agent/storage";

const alert = {
  schemaVersion: 1 as const,
  reportType: "monitorAlert" as const,
  generatedAt: "2026-07-20T20:06:00Z",
  runId: "run_20260720T200600Z_a3f1",
  dataAsOf: "2026-07-20T20:05:00Z",
  sources: ["yahoo"],
  disclaimer: "Research, not licensed financial advice.",
  ruleId: "avgo-entry-watch",
  symbol: "AVGO",
  condition: "price lt 300 USD",
  observedValue: 297.4,
  threshold: 300,
  currency: "USD",
  observedAt: "2026-07-20T20:05:00Z",
  stale: false,
  severity: "attention" as const,
  guidance: "Observation, not an instruction to trade.",
};

describe("monitor alert storage", () => {
  it("claims a matching rule exactly once inside its dedup window", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "fa-monitor-")), "alerts.jsonl");
    const first = await claimAlertEvent(path, alert, 60 * 60_000);
    const duplicate = await claimAlertEvent(path, { ...alert, generatedAt: "2026-07-20T20:45:00Z" }, 60 * 60_000);

    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ created: false, event: first.event });
    expect(await readPendingAlertEvents(path)).toEqual([first.event]);
  });

  it("keeps failed delivery pending and removes successful delivery from the retry queue", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "fa-monitor-")), "alerts.jsonl");
    const claimed = await claimAlertEvent(path, alert, 60 * 60_000);
    await markAlertDelivery(path, claimed.event.eventId, {
      attemptedAt: "2026-07-20T20:06:01Z", adapter: "test", ok: false, error: "offline",
    });
    expect(await readPendingAlertEvents(path)).toHaveLength(1);

    await markAlertDelivery(path, claimed.event.eventId, {
      attemptedAt: "2026-07-20T20:06:02Z", adapter: "test", ok: true, error: null,
    });
    expect(await readPendingAlertEvents(path)).toEqual([]);
  });

  it("serializes concurrent claims so only one caller creates the event", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "fa-monitor-")), "alerts.jsonl");
    const claims = await Promise.all([
      claimAlertEvent(path, alert, 60 * 60_000),
      claimAlertEvent(path, alert, 60 * 60_000),
    ]);
    expect(claims.filter((claim) => claim.created)).toHaveLength(1);
    expect(await readPendingAlertEvents(path)).toHaveLength(1);
  });

  it("leases a pending delivery to only one overlapping cycle", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "fa-monitor-")), "alerts.jsonl");
    await claimAlertEvent(path, alert, 60 * 60_000);
    const leases = await Promise.all([
      claimPendingAlertDeliveries(path, { claimedAt: "2026-07-20T20:06:01Z", adapter: "test", leaseMs: 60_000 }),
      claimPendingAlertDeliveries(path, { claimedAt: "2026-07-20T20:06:01Z", adapter: "test", leaseMs: 60_000 }),
    ]);
    expect(leases.map((events) => events.length).sort()).toEqual([0, 1]);
  });

  it("recovers an ownership lock left by a dead process", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "fa-monitor-")), "alerts.jsonl");
    const deadOwner = spawnSync("/usr/bin/true").pid;
    writeFileSync(`${path}.lock`, `${deadOwner}\n`);
    await expect(claimAlertEvent(path, alert, 60 * 60_000)).resolves.toMatchObject({ created: true });
  });
});
