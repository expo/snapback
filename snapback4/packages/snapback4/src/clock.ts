// Device time is an estimate, never an input to server authorization or settlement.
import type { DeviceCore } from "./local.ts";

const WINDOW_MS = 60_000;
const MAX_SAMPLES = 32;
const clocks = new WeakMap<typeof fetch, ServerClock>();
const readers = new WeakMap<() => number, ServerClock>();
const responses = new WeakMap<Response, { clock: ServerClock; sent: number; order: number }>();
interface Sample { offset: number; roundTrip: number; received: number }

/** One bounded, minimum-round-trip window, reset on a server clock revision.
 * A clock advance must not compete with faster samples from before the jump. */
export class ServerClock {
  private offset = 0;
  private last = 0;
  private samples: Sample[] = [];
  private revision: string | undefined;
  private order = 0;
  private revisionOrder = 0;
  private listeners = new Set<(shift: number, revisionChanged: boolean) => void>();
  private save: ((value: string) => Promise<void>) | undefined;
  private saving: Promise<void> = Promise.resolve();
  constructor(private wall: () => number = Date.now) { readers.set(this.now, this); }
  fork(): ServerClock {
    const copy = new ServerClock(this.wall);
    copy.offset = this.offset; copy.last = this.last;
    copy.samples = this.samples.slice(); copy.revision = this.revision;
    return copy;
  }
  estimate = (): number => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(this.wall() + this.offset)));
  now = (): number => this.last = Math.max(this.last, this.estimate());
  subscribe = (listener: (shift: number, revisionChanged: boolean) => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  sample(serverNow: number, sent: number, received: number, revision?: string, order = ++this.order) {
    if (!Number.isSafeInteger(serverNow) || serverNow < 0 || !Number.isFinite(sent) || !Number.isFinite(received) || received < sent) return;
    const revisionChanged = revision !== undefined && revision !== this.revision;
    if (revisionChanged) {
      // A delayed reply from before an advance cannot restore the old window.
      const split = (value: string) => value.split(":");
      const [epoch, version] = split(revision), [priorEpoch, priorVersion] = split(this.revision ?? "");
      if (epoch === priorEpoch ? Number(version) < Number(priorVersion) : order < this.revisionOrder) return;
      this.samples = [];
      this.revision = revision;
      this.revisionOrder = order;
    }
    const before = this.offset;
    this.samples = this.samples.filter(s => received >= s.received && received - s.received <= WINDOW_MS).slice(-(MAX_SAMPLES - 1));
    this.samples.push({ offset: serverNow - (sent + received) / 2, roundTrip: received - sent, received });
    // Equal round trips prefer the newest sample.
    this.offset = this.samples.reduce((best, s) => s.roundTrip <= best.roundTrip ? s : best).offset;
    if (before !== this.offset) {
      void this.persist().catch(() => {}); // Device calls/close await the same durable save.
      for (const listener of this.listeners) listener(this.offset - before, revisionChanged);
    }
  }
  wrap(fetcher: typeof fetch): typeof fetch {
    if (clocks.get(fetcher) === this) return fetcher;
    const wrapped: typeof fetch = async (input, init) => {
      const sent = this.wall(), order = ++this.order;
      const response = await fetcher(input, init);
      const received = this.wall();
      responses.set(response, { clock: this, sent, order });
      const stamp = response.headers.get("x-snapback-time");
      if (stamp !== null) this.sample(Number(stamp), sent, received, response.headers.get("x-snapback-clock") ?? undefined, order);
      return response;
    };
    clocks.set(wrapped, this);
    return wrapped;
  }
  delay(deadline: number): number {
    return this.now() >= deadline ? 0 : Math.max(0, deadline - this.estimate());
  }
  async attach(core: DeviceCore) {
    const kept = await core.call({ op: "meta", key: "server-clock" });
    if (kept.denied) throw new Error(JSON.stringify(kept.denied));
    try {
      const state = JSON.parse(String(kept.ok)) as { offset: number; last: number } | null;
      if (state && Number.isFinite(state.offset) && Math.abs(state.offset) <= Number.MAX_SAFE_INTEGER && Number.isSafeInteger(state.last) && state.last >= 0) {
        if (!this.samples.length) this.offset = state.offset;
        this.last = Math.max(this.last, state.last);
      }
    } catch { /* Missing or malformed clock metadata starts at offset zero. */ }
    this.save = async value => {
      const reply = await core.call({ op: "set_meta", key: "server-clock", value });
      if (reply.denied) throw new Error(JSON.stringify(reply.denied));
    };
    await this.persist();
  }
  persist(): Promise<void> {
    if (!this.save) return Promise.resolve();
    const save = this.save, value = JSON.stringify({ offset: this.offset, last: this.last });
    this.saving = this.saving.catch(() => {}).then(() => save(value));
    return this.saving;
  }
  async detach() { const pending = this.persist(); this.save = undefined; await pending; }
}

export const serverClock = (fetcher: typeof fetch): ServerClock => clocks.get(fetcher) ?? new ServerClock();

/** Streaming polls publish a final stamp because their headers can be old.
 * Its full request round trip competes with short responses in the same window. */
export function sampleChanges(response: Response, body: { serverNow?: number; clockRevision?: string }) {
  const sample = responses.get(response);
  if (sample && body.serverNow !== undefined) sample.clock.sample(body.serverNow, sample.sent, Date.now(), body.clockRevision, sample.order);
}

export function onClock(now: () => number, listener: () => void): () => void {
  return readers.get(now)?.subscribe(listener) ?? (() => {});
}

export function clockDelay(now: () => number, deadline: number): number {
  return readers.get(now)?.delay(deadline) ?? Math.max(0, deadline - now());
}
