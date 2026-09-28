// Device time is an estimate, never an input to server authorization or settlement.
import type { DeviceCore } from "./local.ts";

const WINDOW_MS = 60_000;
const MAX_SAMPLES = 32;
const SHORT_RTT_MS = 1000;
const clocks = new WeakMap<typeof fetch, ServerClock>();
const readers = new WeakMap<() => number, ServerClock>();
const responses = new WeakMap<Response, { clock: ServerClock; order: number }>();
interface Sample { offset: number; roundTrip: number; received: number; provisional: boolean }

/** One bounded, minimum-round-trip window, reset on a server clock revision.
 * A clock advance must not compete with faster samples from before the jump. */
export class ServerClock {
  private offset = 0;
  private issuedOffset: number | undefined;
  private last = 0;
  private samples: Sample[] = [];
  private revision: string | undefined;
  private order = 0;
  private epochBarrier = 0;
  private listeners = new Set<(shift: number, reschedule: boolean) => void>();
  private save: ((value: string) => Promise<void>) | undefined;
  private saving: Promise<void> = Promise.resolve();
  private lastSave: { owner: (value: string) => Promise<void>; value: string; result: Promise<void> } | undefined;
  constructor(private wall: () => number = Date.now) { readers.set(this.issuedDeviceNow, this); }
  fork(): ServerClock {
    const copy = new ServerClock(this.wall);
    copy.offset = this.offset; copy.issuedOffset = this.issuedOffset; copy.last = this.last;
    copy.samples = this.samples.slice(); copy.revision = this.revision;
    copy.order = this.order; copy.epochBarrier = this.epochBarrier;
    return copy;
  }
  /** Unfloored estimated server time: samples and server-answer refetches. */
  estimatedServerNow = (): number => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(this.wall() + this.offset)));
  private deviceCandidate = (): number => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(this.wall() + (this.issuedOffset ?? 0))));
  /** Monotonic issued device time: execution, prediction, expiry and rendering. */
  issuedDeviceNow = (): number => this.last = Math.max(this.last, this.deviceCandidate());
  /** Adopt a committed admission without changing the server-time estimate. */
  raiseIssued(time: number): void {
    if (!Number.isSafeInteger(time) || time < 0 || time <= this.last) return;
    const shift = time - Math.max(this.last, this.deviceCandidate());
    this.last = time;
    // Even a one-millisecond floor increase may cross a frozen deadline.
    if (shift > 0) for (const listener of this.listeners) listener(shift, true);
  }
  subscribe = (listener: (shift: number, reschedule: boolean) => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  sample(serverNow: number, sent: number, received: number, revision?: string, order = ++this.order, provisional = false) {
    if (!Number.isSafeInteger(serverNow) || serverNow < 0 || !Number.isFinite(sent) || !Number.isFinite(received) || received < sent) return;
    this.order = Math.max(this.order, order);
    const revisionChanged = revision !== undefined && revision !== this.revision;
    if (revisionChanged) {
      // A delayed reply from before an advance cannot restore the old window.
      const split = (value: string) => value.split(":");
      const [epoch, version] = split(revision), [priorEpoch, priorVersion] = split(this.revision ?? "");
      if (epoch === priorEpoch ? Number(version) < Number(priorVersion) : this.revision !== undefined && order <= this.epochBarrier) return;
      this.samples = [];
      this.revision = revision;
      // Every request already issued may still have reached the old process.
      if (epoch !== priorEpoch) this.epochBarrier = this.order;
    }
    const before = this.offset, issuedBefore = this.issuedOffset;
    const roundTrip = received - sent;
    // Long responses use a conservative receipt date, never a midpoint that
    // could latch half a server wait into the monotonic floor.
    provisional ||= roundTrip > SHORT_RTT_MS;
    this.samples = this.samples.filter(s => received >= s.received && received - s.received <= WINDOW_MS).slice(-(MAX_SAMPLES - 1));
    this.samples.push({ offset: serverNow - (provisional ? received : (sent + received) / 2), roundTrip, received, provisional });
    // Every short measured sample outranks provisional receipt stamps.
    const best = this.samples.reduce((best, s) => s.provisional !== best.provisional ? (best.provisional ? s : best) : s.roundTrip <= best.roundTrip ? s : best);
    this.offset = best.offset;
    this.issuedOffset = best.offset;
    if (before !== this.offset || issuedBefore !== this.issuedOffset) {
      void this.persist().catch(() => {}); // Device calls/close await the same durable save.
      // Watchers ignore sub-frame noise. A newly eligible issued offset can
      // move even when a short sample merely confirms the server estimate.
      const estimateShift = this.offset - before, issuedShift = (this.issuedOffset ?? 0) - (issuedBefore ?? 0);
      const shift = Math.abs(issuedShift) > Math.abs(estimateShift) ? issuedShift : estimateShift;
      for (const listener of this.listeners) listener(shift, revisionChanged);
    }
  }
  wrap(fetcher: typeof fetch): typeof fetch {
    if (clocks.get(fetcher) === this) return fetcher;
    const wrapped: typeof fetch = async (input, init) => {
      const sent = this.wall(), order = ++this.order;
      const response = await fetcher(input, init);
      const received = this.wall();
      responses.set(response, { clock: this, order });
      const stamp = response.headers.get("x-snapback-time");
      if (stamp !== null) this.sample(Number(stamp), sent, received, response.headers.get("x-snapback-clock") ?? undefined, order);
      return response;
    };
    clocks.set(wrapped, this);
    return wrapped;
  }
  serverDelay(deadline: number): number { return Math.max(0, deadline - this.estimatedServerNow()); }
  deviceDelay(deadline: number): number {
    return this.issuedDeviceNow() >= deadline ? 0 : Math.max(0, deadline - this.deviceCandidate());
  }
  sampleStream(serverNow: number, revision: string | undefined, order: number) {
    const received = this.wall();
    // The server writes this stamp at the end of its hold, not at request send.
    this.sample(serverNow, received, received, revision, order, true);
  }
  async attach(core: DeviceCore) {
    const kept = await core.call({ op: "meta", key: "server-clock" });
    if (kept.denied) throw new Error(JSON.stringify(kept.denied));
    try {
      const state = JSON.parse(String(kept.ok)) as { offset: number; issuedOffset?: number } | null;
      const issuedOffset = state?.issuedOffset ?? state?.offset;
      if (state && Number.isFinite(state.offset) && Math.abs(state.offset) <= Number.MAX_SAFE_INTEGER && typeof issuedOffset === "number" && Number.isFinite(issuedOffset) && Math.abs(issuedOffset) <= Number.MAX_SAFE_INTEGER) {
        if (!this.samples.length) this.offset = state.offset;
        this.issuedOffset ??= issuedOffset;
      }
    } catch { /* Missing or malformed clock metadata starts at offset zero. */ }
    // Only admissions restore a durable floor. Old offset metadata's `last`
    // may be a wall-time now() call and must not override a startup correction.
    // The device commits this floor atomically with admission, and retains it
    // after settlement. Pending entries also recover older stores/journals.
    // Backfill legacy admission times transactionally before replay can retire
    // the queue; offset persistence deliberately cannot retain an issued floor.
    const pending = await core.call({ op: "queued", restore_clock_floor: true });
    if (pending.denied) throw new Error(JSON.stringify(pending.denied));
    const floor = await core.call({ op: "meta", key: "server-clock-floor" });
    if (floor.denied) throw new Error(JSON.stringify(floor.denied));
    const issued = Number(floor.ok);
    if (Number.isSafeInteger(issued) && issued >= 0) this.last = Math.max(this.last, issued);
    for (const entry of (pending.ok ?? []) as { now?: number }[]) {
      if (Number.isSafeInteger(entry.now) && entry.now! >= 0) this.last = Math.max(this.last, entry.now!);
    }
    this.save = async value => {
      const reply = await core.call({ op: "set_meta", key: "server-clock", value });
      if (reply.denied) throw new Error(JSON.stringify(reply.denied));
    };
    await this.persist();
  }
  // @ref LLP 3000.019#3.3 — share unchanged offset persistence, never admission floors.
  persist(): Promise<void> {
    if (!this.save) return Promise.resolve();
    const save = this.save, value = JSON.stringify({ offset: this.offset, issuedOffset: this.issuedOffset ?? 0 });
    if (this.lastSave?.owner === save && this.lastSave.value === value) return this.lastSave.result;
    this.saving = this.saving.catch(() => {}).then(() => save(value));
    const saved = this.lastSave = { owner: save, value, result: this.saving };
    // A failed save remains a failure to its callers, and is retried by the
    // next caller. Attaching another device always supplies a new owner.
    void this.saving.catch(() => { if (this.lastSave === saved) this.lastSave = undefined; });
    return this.saving;
  }
  async detach() { const pending = this.persist(); this.save = undefined; await pending; }
}

export const serverClock = (fetcher: typeof fetch): ServerClock => clocks.get(fetcher) ?? new ServerClock();

/** Streaming final stamps are provisional receipt-time samples, never poll midpoints. */
export function sampleChanges(response: Response, body: { serverNow?: number; clockRevision?: string }) {
  const sample = responses.get(response);
  if (sample && body.serverNow !== undefined) sample.clock.sampleStream(body.serverNow, body.clockRevision, sample.order);
}

export function onClock(now: () => number, listener: () => void): () => void {
  return readers.get(now)?.subscribe(listener) ?? (() => {});
}

export function clockDelay(now: () => number, deadline: number): number {
  return readers.get(now)?.deviceDelay(deadline) ?? Math.max(0, deadline - now());
}
