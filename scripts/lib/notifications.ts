import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface NotificationEvent {
  eventId: string;
  alert: {
    ruleId: string;
    symbol: string;
    condition: string;
    observedValue: number;
    threshold: number;
    currency: "AUD" | "USD" | null;
    sources: string[];
    observedAt: string;
    severity: "informational" | "attention" | "urgent";
    stale: boolean;
    guidance: string;
  };
}

export interface NotificationAdapter {
  readonly name: string;
  send(event: NotificationEvent): Promise<void>;
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export async function deliverWithRetry(
  adapter: NotificationAdapter,
  event: NotificationEvent,
  options: RetryOptions,
): Promise<{ attempts: number }> {
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer");
  }
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      await adapter.send(event);
      return { attempts: attempt };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < options.maxAttempts) await sleep(options.baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw new Error(`notification delivery failed after ${options.maxAttempts} attempts: ${lastError!.message}`);
}

const execFileAsync = promisify(execFile);

export class MacOsNotificationAdapter implements NotificationAdapter {
  readonly name = "macos";

  async send(event: NotificationEvent): Promise<void> {
    const { title, body } = formatMacOsNotification(event);
    await execFileAsync("/usr/bin/osascript", [
      "-e",
      "on run argv\n display notification (item 2 of argv) with title (item 1 of argv)\nend run",
      "--",
      title,
      body,
    ]);
  }
}

export function formatMacOsNotification(event: NotificationEvent): { title: string; body: string } {
  const title = `Financial Agent · ${event.alert.symbol}`;
  const stale = event.alert.stale ? "STALE" : "current";
  const currency = event.alert.currency ? ` ${event.alert.currency}` : "";
  const body = `${event.alert.ruleId}: ${event.alert.condition}; observed ${event.alert.observedValue}${currency} vs ${event.alert.threshold}; ${event.alert.observedAt}; ${event.alert.sources.join(", ")}; ${stale}. Observation, not an instruction.`;
  return { title, body };
}
