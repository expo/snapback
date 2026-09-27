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
interface HeldExpiry extends ExpiringRead { withdraw(): () => void }
const heldExpiries = new WeakMap<ExpiringRead, Set<HeldExpiry>>();
const expiryOwners = new WeakMap<ExpiringRead, {
  clock: ExpiryClock; current(): boolean; expired(serverDue: boolean): void;
  withdrawHeld: ((serverDue: boolean, serverNow: number) => void) | undefined;
}>();

// @ref LLP 3000.019#3.3 — a facade's approved answer participates in its raw watch's expiry sweep.
export function holdReadExpiry(owner: ExpiringRead, withdraw: () => () => void): { check(): void; release(): void } {
  const context = expiryOwners.get(owner), original = owner.deadlines;
  if (!context || !original) return { check() {}, release() {} };
  // A local wakeup reobserves remembered server data; it does not expire that data.
  const deadlines = { ...original, device: original.localWakeup ? null : original.device };
  const held: HeldExpiry = { deadlines, expiryTimer: null, withdraw };
  let group = heldExpiries.get(owner);
  if (!group) heldExpiries.set(owner, group = new Set());
  group.add(held);
  armReadExpiry(held, deadlines, context.clock, context.current, context.expired);
  return { check() {
    const d = held.deadlines;
    if (!d || !context.current()) return;
    const serverDue = d.server !== null && context.clock.serverDelay(d.server) === 0;
    if (serverDue || (d.device !== null && context.clock.deviceDelay(d.device) === 0)) context.expired(serverDue);
  }, release() {
    if (held.expiryTimer) clearTimeout(held.expiryTimer);
    held.expiryTimer = null;
    group.delete(held);
  } };
}

// @ref LLP 3000.019#3.3 — timers and clock corrections withdraw every due answer before any subscriber can roll time back.
export function correctReadExpiries<W extends ExpiringRead>(watches: Iterable<W>, clock: ServerClock,
  withdraw: (watch: W, deadlines: ReadDeadlines, serverDue: boolean, serverNow: number) => () => void,
  rearm: (watch: W, deadlines: ReadDeadlines) => void, refresh: (watch: W) => void): void {
  const deviceNow = clock.issuedDeviceNow(), serverNow = clock.estimatedServerNow();
  const current = [...watches], deliveries: (() => void)[] = [];
  // Capture and withdraw ALL held answers before any raw notification can roll
  // the server clock back. These deadlines outlive replacement of the raw answer.
  for (const watch of current) for (const held of heldExpiries.get(watch) ?? []) {
    const d = held.deadlines;
    if (!d) continue;
    if ((d.server !== null && d.server <= serverNow) || (d.device !== null && d.device <= deviceNow)) {
      if (held.expiryTimer) clearTimeout(held.expiryTimer);
      held.expiryTimer = null;
      held.deadlines = undefined;
      expiryOwners.get(watch)?.withdrawHeld?.(d.server !== null && d.server <= serverNow, serverNow);
      deliveries.push(held.withdraw());
    } else {
      const context = expiryOwners.get(watch)!;
      armReadExpiry(held, d, clock, context.current, context.expired);
    }
  }
  for (const watch of current) {
    const d = watch.deadlines;
    if (!d) continue;
    const serverDue = d.server !== null && d.server <= serverNow;
    if (serverDue || (d.device !== null && d.device <= deviceNow)) {
      if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
      watch.expiryTimer = null;
      watch.deadlines = undefined;
      deliveries.push(withdraw(watch, d, serverDue, serverNow));
    } else rearm(watch, d);
  }
  for (const deliver of deliveries) deliver();
  for (const watch of current) refresh(watch);
}

// @ref LLP 3000.019#3.3 — deadlines belong to the displayed answer, including while its replacement loads.
export function armReadExpiry(watch: ExpiringRead, deadlines: ReadDeadlines | undefined, clock: ExpiryClock,
  current: () => boolean, expired: (serverDue: boolean) => void,
  withdrawHeld?: (serverDue: boolean, serverNow: number) => void): void {
  expiryOwners.set(watch, { clock, current, expired, withdrawHeld });
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
    if (!deviceDue && !serverDue) { armReadExpiry(watch, deadlines, clock, current, expired, withdrawHeld); return; }
    // The sweep must still see this deadline when it captures all due watches.
    expired(serverDue);
  }, delay);
  (watch.expiryTimer as { unref?: () => void }).unref?.();
}
