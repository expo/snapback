import { explicitSync } from "./local-sync.ts";

// @ref LLP 3000.023#11 — observe an earlier receipt even while a POST is held.
// Mutations keep FIFO; syncs coalesce with each other. Device capture/store/
// generation/send-revision fences adjudicate overlapping sends and observation.
export class LocalNetwork {
  private tail: Promise<unknown> = Promise.resolve();
  private work = 0;
  private scheduled: Promise<boolean> | null = null;
  active: Promise<boolean> | null = null;
  constructor(private readonly round: () => Promise<boolean>, private readonly refused: () => boolean,
    private readonly available: () => void) {}
  get current(): Promise<boolean> | null { return this.scheduled ?? this.active; }
  get busy(): boolean { return this.work > 0 || this.active !== null; }
  run<T>(body: () => Promise<T>): Promise<T> {
    this.work++;
    const result = this.tail.then(body);
    const release = () => { this.work--; this.available(); };
    void result.then(release, release);
    this.tail = result.catch(() => {});
    return result;
  }
  acquire = (): Promise<boolean> => {
    if (this.refused()) return Promise.resolve(false);
    if (this.active) return this.active;
    const result = this.round(); this.active = result;
    const release = () => { if (this.active === result) this.active = null; this.available(); };
    void result.then(release, release);
    return result;
  };
  once = (reserve = false): Promise<boolean> => {
    if (this.refused()) return Promise.resolve(false);
    if (this.current && !reserve) return this.current;
    const result = this.run(async () => {
      this.scheduled = result;
      // An explicit call reserves a round newer than any overlapping priority
      // observation; joining that earlier round would break sync-after-call.
      if (reserve && this.active) await this.active.catch(() => {});
      return this.acquire();
    });
    if (!reserve) this.scheduled = result;
    const release = () => { if (this.scheduled === result) this.scheduled = null; };
    void result.then(release, release);
    return result;
  };
  afterCall = explicitSync(() => this.current, () => this.once(), () => this.once(true));
}
