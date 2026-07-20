import { describe, expect, it, vi } from "vitest";
import { deliverWithRetry, formatMacOsNotification, type NotificationAdapter } from "../scripts/lib/notifications.js";

const event = {
  eventId: "alert_0123456789abcdef",
  alert: {
    ruleId: "avgo-entry-watch",
    symbol: "AVGO",
    observedValue: 297.4,
    threshold: 300,
    currency: "USD" as const,
    sources: ["yahoo"],
    condition: "price lt 300 USD",
    severity: "attention" as const,
    stale: false,
    observedAt: "2026-07-20T20:05:00Z",
    guidance: "Observation, not an instruction to trade.",
  },
};

describe("notification delivery", () => {
  it("formats the exact condition and required provenance for the human notification", () => {
    expect(formatMacOsNotification(event).body).toContain("price lt 300 USD; observed 297.4 USD vs 300");
    expect(formatMacOsNotification(event).body).toContain("2026-07-20T20:05:00Z; yahoo; current");
  });

  it("retries transient failures and returns the successful attempt count", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("notification centre busy"))
      .mockResolvedValueOnce(undefined);
    const adapter: NotificationAdapter = { name: "test", send };
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(deliverWithRetry(adapter, event, { maxAttempts: 3, baseDelayMs: 10, sleep }))
      .resolves.toEqual({ attempts: 2 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("reports the final error after the configured attempt limit", async () => {
    const adapter: NotificationAdapter = { name: "test", send: vi.fn().mockRejectedValue(new Error("offline")) };
    await expect(deliverWithRetry(adapter, event, { maxAttempts: 2, baseDelayMs: 0, sleep: async () => undefined }))
      .rejects.toThrow(/after 2 attempts: offline/);
  });
});
