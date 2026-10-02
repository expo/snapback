// @ref LLP 3000.017#33-change-notification — revisions retire incarnations before inspecting delayed replies.
export interface EphemeralVersion { epoch: number; incarnation: string }
export interface EphemeralRequest { revision: number; signal: AbortSignal }
interface Interest {
  tables: Set<string>;
  answer?: EphemeralVersion;
  floor?: EphemeralVersion;
  invalidate(reset: boolean, changed: boolean, preserved?: unknown): (() => void) | void;
  incomplete?: ReturnType<typeof setInterval>;
}
export function ephemeralVersion(value: unknown): EphemeralVersion | undefined {
  if (!value || typeof value !== "object") return;
  const version = value as EphemeralVersion;
  if (typeof version.incarnation === "string" && Number.isSafeInteger(version.epoch) && version.epoch >= 0) return version;
}

export class EphemeralReads {
  revision = 0;
  private incarnation = "";
  private epoch = 0;
  private queries = new AbortController();
  private poll = new AbortController();
  private interests = new Map<object, Interest>();
  constructor(lifetime: AbortSignal) {
    lifetime.addEventListener("abort", () => {
      this.queries.abort(); this.poll.abort();
      for (const interest of this.interests.values()) clearInterval(interest.incomplete);
      this.interests.clear();
    }, { once: true });
  }
  request(): EphemeralRequest { return { revision: this.revision, signal: this.queries.signal }; }
  pollRequest(): EphemeralRequest { return { revision: this.revision, signal: this.poll.signal }; }
  current(request: EphemeralRequest): boolean { return request.revision === this.revision && !request.signal.aborted; }
  reissuePoll() { this.poll.abort(); this.poll = new AbortController(); }
  add(owner: object, tables: readonly string[], invalidate: Interest["invalidate"]) {
    const before = new Set([...this.interests.values()].flatMap(interest => [...interest.tables]));
    const existing = this.interests.get(owner);
    if (existing) { existing.tables = new Set(tables); existing.invalidate = invalidate; }
    else this.interests.set(owner, { tables: new Set(tables), invalidate });
    if (tables.some(table => !before.has(table))) this.reissuePoll();
  }
  remove(owner: object) {
    clearInterval(this.interests.get(owner)?.incomplete);
    this.interests.delete(owner); // Shrinking interest never restarts a held poll.
  }
  parameters() {
    const interests = [...this.interests.values()].filter(interest => interest.tables.size);
    return { epoch: (interests.length ? Math.min(...interests.map(interest => interest.answer?.incarnation === this.incarnation ? interest.answer.epoch : this.epoch)) : this.epoch),
      incarnation: this.incarnation, tables: [...new Set(interests.flatMap(interest => [...interest.tables]))].sort() };
  }
  private adopt(request: EphemeralRequest, version: EphemeralVersion): boolean {
    if (!this.current(request)) return false;
    if (version.incarnation === this.incarnation) return true;
    this.incarnation = version.incarnation;
    this.epoch = version.epoch;
    this.revision++;
    this.queries.abort(); this.queries = new AbortController();
    this.reissuePoll();
    // The accepting response belongs to the new revision. All other request
    // tags keep the retired revision, even if their transport ignores abort.
    request.revision = this.revision; request.signal = this.queries.signal;
    // @ref LLP 3000.019#3.3 — reset all affected observations, including the accepting owner,
    // before any subscriber can close or remount another observation.
    const delivery: (() => void)[] = [];
    for (const interest of this.interests.values()) {
      delete interest.answer;
      interest.floor = version;
      if (interest.tables.size) {
        const notify = interest.invalidate(true, true);
        if (notify) delivery.push(notify);
      }
    }
    for (const notify of delivery) notify();
    return true;
  }
  accept(request: EphemeralRequest, value: unknown, owner?: object): boolean {
    if (!this.current(request)) return false;
    const version = ephemeralVersion(value);
    if (!version) return true; // Ordinary refusals need not carry an epoch.
    if (!this.adopt(request, version)) return false;
    const interest = owner && this.interests.get(owner);
    if (interest?.floor?.incarnation === version.incarnation && version.epoch < interest.floor.epoch) return false;
    if (interest) { interest.floor = version; interest.answer = version; }
    return true;
  }
  changed(request: EphemeralRequest, value: unknown): boolean {
    if (!this.current(request)) return false;
    const version = ephemeralVersion(value);
    if (!version) return true; // Compatibility with a server without this feature.
    const replaced = version.incarnation !== this.incarnation;
    if (!this.adopt(request, version)) return false;
    if (version.epoch < this.epoch) return false;
    this.epoch = version.epoch;
    if (!replaced) {
      const tables = new Set((value as EphemeralVersion & { tables?: string[] }).tables ?? []);
      for (const interest of this.interests.values()) if ([...interest.tables].some(table => tables.has(table))) {
        if (interest.floor?.incarnation !== version.incarnation || interest.floor.epoch < version.epoch) interest.floor = version;
        interest.invalidate(false, true, (value as { preserved?: unknown }).preserved)?.();
      }
    }
    return true;
  }
  incomplete(owner: object, incomplete: boolean) {
    const interest = this.interests.get(owner);
    if (!interest?.tables.size) return;
    if (!incomplete) { clearInterval(interest.incomplete); delete interest.incomplete; }
    else if (!interest.incomplete) {
      // Fixed cadence, independent of response contents or their hidden expiry.
      interest.incomplete = setInterval(() => interest.invalidate(false, false)?.(), 1000);
      (interest.incomplete as { unref?: () => void }).unref?.();
    }
  }
}
