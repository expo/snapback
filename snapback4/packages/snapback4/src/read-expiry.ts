import { decorationDue, type ValueDeadlines } from "./read-decoration.ts";
import type { ServerClock } from "./clock.ts";

export interface ReadDeadlines extends ValueDeadlines {
  valueRetry?: number | undefined;
  device: number | null;
  server: number | null;
  /** A remembered server answer can have a local reobservation wakeup. */
  localWakeup: boolean;
}
export type ExpiryClock = Pick<ServerClock, "deviceDelay" | "serverDelay" | "estimatedServerNow">;
interface ExpiringRead {
  valueRetries?: number;
  expireValues?(): () => void;
  deadlines: ReadDeadlines | undefined;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  expiredServerDeadline?: number | undefined;
}
// @ref LLP 3000.023#10 — a queued recovery cannot renew a withdrawn deadline
// after server-time rollback, even with a new request ticket or retention policy.
export function readDeadlineWithdrawn(watches: Iterable<Pick<ExpiringRead, "expiredServerDeadline">>, deadline: number | null | undefined): boolean {
  if (deadline == null) return false;
  for (const watch of watches) if (watch.expiredServerDeadline !== undefined && deadline <= watch.expiredServerDeadline) return true;
  return false;
}
function rememberDeadline(watch: ExpiringRead, deadline: number | null): void {
  if (deadline !== null) watch.expiredServerDeadline = Math.max(watch.expiredServerDeadline ?? 0, deadline);
}
interface HeldExpiry extends ExpiringRead { withdraw(): () => void }
const heldExpiries = new WeakMap<ExpiringRead, Set<HeldExpiry>>();
const expiryOwners = new WeakMap<ExpiringRead, {
  clock: ExpiryClock; current(): boolean; expired(serverDue: boolean): void;
  withdrawHeld: ((serverDue: boolean, serverNow: number) => void) | undefined;
}>();

// @ref LLP 3000.019#3.3 — a facade's approved answer participates in its raw watch's expiry sweep.
export function holdReadExpiry(owner: ExpiringRead, withdraw: () => () => void, expireValues?: () => () => void): { check(): void; release(): void } {
  const context = expiryOwners.get(owner), original = owner.deadlines;
  if (!context || !original) return { check() {}, release() {} };
  // A local wakeup reobserves remembered server data; it does not expire that data.
  const deadlines = { ...original, device: original.localWakeup ? null : original.device, valueRetry: undefined };
  const held: HeldExpiry = { deadlines, expiryTimer: null, withdraw, ...(expireValues ? { expireValues } : {}) };
  let group = heldExpiries.get(owner);
  if (!group) heldExpiries.set(owner, group = new Set());
  group.add(held);
  armReadExpiry(held, deadlines, context.clock, context.current, context.expired, undefined, false);
  return { check() {
    const d = held.deadlines;
    if (!d || !context.current()) return;
    const serverDue = d.server !== null && context.clock.serverDelay(d.server) === 0;
    if (serverDue || (d.device !== null && context.clock.deviceDelay(d.device) === 0)
      || (d.valueDevice != null && context.clock.deviceDelay(d.valueDevice) === 0)
      || decorationDue(d.valueServer, context.clock.estimatedServerNow())) context.expired(serverDue);
  }, release() {
    if (held.expiryTimer) clearTimeout(held.expiryTimer);
    held.expiryTimer = null;
    group.delete(held);
  } };
}

/** Accessors enforce row expiry even when the host has not delivered timers. */
export function checkReadExpiry(watch: ExpiringRead & { expire(): () => void }): void {
  const context = expiryOwners.get(watch), d = watch.deadlines;
  if (!context || !d) return;
  const serverDue = d.server !== null && context.clock.serverDelay(d.server) === 0;
  if (serverDue || (d.device !== null && context.clock.deviceDelay(d.device) === 0)
    || (d.valueDevice != null && context.clock.deviceDelay(d.valueDevice) === 0)
    || (d.valueServer != null && context.clock.serverDelay(d.valueServer) === 0)) {
    if (context.current()) context.expired(serverDue);
    // A closed local handle has left the live sweep, but can still be read.
    else if (serverDue || !d.localWakeup && d.device !== null && context.clock.deviceDelay(d.device) === 0) {
      if (serverDue) rememberDeadline(watch, d.server);
      context.withdrawHeld?.(serverDue, context.clock.estimatedServerNow());
      watch.deadlines = undefined;
      watch.expire()();
    } else watch.expireValues?.()();
  }
}

// @ref LLP 3000.019#3.3 — timers and clock corrections withdraw every due answer before any subscriber can roll time back.
export function correctReadExpiries<W extends ExpiringRead>(watches: Iterable<W>, clock: ServerClock,
  withdraw: (watch: W, deadlines: ReadDeadlines, serverDue: boolean, serverNow: number) => () => void,
  rearm: (watch: W, deadlines: ReadDeadlines) => void, refresh: (watch: W) => void): void {
  const deviceNow = clock.issuedDeviceNow(), serverNow = clock.estimatedServerNow();
  const current = [...watches], deliveries: (() => void)[] = [], due = new Set<W>();
  // Capture and withdraw ALL held answers before any raw notification can roll
  // the server clock back. These deadlines outlive replacement of the raw answer.
  for (const watch of current) for (const held of heldExpiries.get(watch) ?? []) {
    const d = held.deadlines;
    if (!d) continue;
    if ((d.server !== null && d.server <= serverNow) || (d.device !== null && d.device <= deviceNow)) {
      if (d.server !== null && d.server <= serverNow) rememberDeadline(watch, d.server);
      if (held.expiryTimer) clearTimeout(held.expiryTimer);
      held.expiryTimer = null;
      held.deadlines = undefined;
      expiryOwners.get(watch)?.withdrawHeld?.(d.server !== null && d.server <= serverNow, serverNow);
      deliveries.push(held.withdraw()); due.add(watch);
    } else {
      const context = expiryOwners.get(watch)!;
      if (decorationDue(d.valueDevice, deviceNow) || decorationDue(d.valueServer, serverNow)) deliveries.push(held.expireValues?.() ?? (() => {}));
      armReadExpiry(held, d, clock, context.current, context.expired, undefined, false);
    }
  }
  for (const watch of current) {
    const d = watch.deadlines;
    if (!d) continue;
    const serverDue = d.server !== null && d.server <= serverNow;
    if (serverDue || (d.device !== null && d.device <= deviceNow)) {
      if (serverDue) rememberDeadline(watch, d.server);
      if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
      watch.expiryTimer = null;
      watch.deadlines = undefined;
      deliveries.push(withdraw(watch, d, serverDue, serverNow)); due.add(watch);
    } else if (decorationDue(d.valueDevice, deviceNow) || decorationDue(d.valueServer, serverNow)
      || d.valueRetry !== undefined && d.valueRetry <= Date.now()) {
      // @ref LLP 3000.028#3.3.1 — null values synchronously, then keep trying.
      deliveries.push(watch.expireValues?.() ?? (() => {}));
      rearm(watch, d);
      due.add(watch);
    } else rearm(watch, d);
  }
  for (const deliver of deliveries) deliver();
  // A clock sample re-arms future deadlines; only due owners need evaluation.
  // @ref LLP 3000.023#10 — ordinary response timing must not refetch every row.
  for (const watch of due) refresh(watch);
}

// @ref LLP 3000.019#3.3 — deadlines belong to the displayed answer, including while its replacement loads.
export function armReadExpiry(watch: ExpiringRead, deadlines: ReadDeadlines | undefined, clock: ExpiryClock,
  current: () => boolean, expired: (serverDue: boolean) => void,
  withdrawHeld?: (serverDue: boolean, serverNow: number) => void, retryValues = true): void {
  expiryOwners.set(watch, { clock, current, expired, withdrawHeld });
  if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
  watch.expiryTimer = null;
  if (deadlines) {
    const deviceDue = deadlines.valueDevice != null && (!Number.isFinite(deadlines.valueDevice) || clock.deviceDelay(deadlines.valueDevice) === 0);
    const serverDue = deadlines.valueServer != null && (!Number.isFinite(deadlines.valueServer) || clock.serverDelay(deadlines.valueServer) === 0);
    if (deviceDue || serverDue || deadlines.valueRetry !== undefined && deadlines.valueRetry <= Date.now()) {
      watch.valueRetries = Math.min((watch.valueRetries ?? 0) + 1, 7);
      deadlines = { ...deadlines, valueDevice: deviceDue ? null : deadlines.valueDevice, valueServer: serverDue ? null : deadlines.valueServer,
        valueRetry: retryValues ? Date.now() + Math.min(25 * 2 ** (watch.valueRetries - 1), 1000) : undefined };
    } else if (deadlines.valueRetry === undefined) watch.valueRetries = 0;
    if (!retryValues && deadlines.valueRetry !== undefined) deadlines = { ...deadlines, valueRetry: undefined };
  }
  watch.deadlines = deadlines;
  if (!deadlines || !current()) return;
  const { device, server, valueDevice, valueServer, valueRetry } = deadlines;
  if (device === null && server === null && valueDevice == null && valueServer == null && valueRetry === undefined) return;
  const delay = Math.min(device === null ? Infinity : clock.deviceDelay(device), server === null ? Infinity : clock.serverDelay(server), valueDevice == null ? Infinity : clock.deviceDelay(valueDevice), valueServer == null ? Infinity : clock.serverDelay(valueServer), valueRetry === undefined ? Infinity : Math.max(0, valueRetry - Date.now()), 2_147_483_647);
  watch.expiryTimer = setTimeout(() => {
    watch.expiryTimer = null;
    if (!current()) return;
    const deviceDue = device !== null && clock.deviceDelay(device) === 0;
    const serverDue = server !== null && clock.serverDelay(server) === 0;
    const valueDue = valueDevice != null && clock.deviceDelay(valueDevice) === 0 || valueServer != null && clock.serverDelay(valueServer) === 0;
    if (!deviceDue && !serverDue && !valueDue && !(valueRetry !== undefined && valueRetry <= Date.now())) { armReadExpiry(watch, deadlines, clock, current, expired, withdrawHeld, retryValues); return; }
    // The sweep must still see this deadline when it captures all due watches.
    expired(serverDue);
  }, delay);
  (watch.expiryTimer as { unref?: () => void }).unref?.();
}
