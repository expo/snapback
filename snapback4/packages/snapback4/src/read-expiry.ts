import type { ServerClock } from "./clock.ts";

export interface ReadDeadlines {
  device: number | null;
  server: number | null;
  /** A remembered server answer can have a local reobservation wakeup. */
  localWakeup: boolean;
}
export type ExpiryClock = Pick<ServerClock, "deviceDelay" | "serverDelay">;
interface ExpiringRead {
  deadlines: ReadDeadlines | undefined;
  expiryTimer: ReturnType<typeof setTimeout> | null;
}

// @ref LLP 3000.019#3.3 — deadlines belong to the displayed answer, including while its replacement loads.
export function armReadExpiry(watch: ExpiringRead, deadlines: ReadDeadlines | undefined, clock: ExpiryClock,
  current: () => boolean, expired: (serverDue: boolean) => void): void {
  if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
  watch.expiryTimer = null;
  watch.deadlines = deadlines;
  if (!deadlines || !current()) return;
  const { device, server } = deadlines;
  if (device === null && server === null) return;
  const delay = Math.min(device === null ? Infinity : clock.deviceDelay(device), server === null ? Infinity : clock.serverDelay(server), 2_147_483_647);
  watch.expiryTimer = setTimeout(() => {
    watch.expiryTimer = null;
    if (!current()) return;
    const deviceDue = device !== null && clock.deviceDelay(device) === 0;
    const serverDue = server !== null && clock.serverDelay(server) === 0;
    if (!deviceDue && !serverDue) { armReadExpiry(watch, deadlines, clock, current, expired); return; }
    watch.deadlines = undefined;
    expired(serverDue);
  }, delay);
  (watch.expiryTimer as { unref?: () => void }).unref?.();
}
