// @ref LLP 3000.017#33-change-notification — revisions retire incarnations before inspecting delayed replies.
export interface EphemeralVersion { epoch: number; incarnation: string }
export interface EphemeralRequest { revision: number; signal: AbortSignal; tables?: readonly string[] }
interface Interest {
  tables: Set<string>;
  answer?: EphemeralVersion;
  floor?: EphemeralVersion;
  invalidate(reset: boolean): (() => void) | void;
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
  private readonly byTable = new Map<string, Set<object>>();
  private readonly floors = new Map<string, number>();
  private incarnationFloor = 0;
  constructor(lifetime: AbortSignal) {
    lifetime.addEventListener("abort", () => {
      this.queries.abort(); this.poll.abort();
      for (const interest of this.interests.values()) clearInterval(interest.incomplete);
      this.interests.clear();
      this.byTable.clear(); this.floors.clear();
    }, { once: true });
  }
  request(tables?: readonly string[]): EphemeralRequest { return { revision: this.revision, signal: this.queries.signal, ...(tables ? { tables } : {}) }; }
  pollRequest(): EphemeralRequest { return { revision: this.revision, signal: this.poll.signal }; }
  current(request: EphemeralRequest): boolean { return request.revision === this.revision && !request.signal.aborted; }
  reissuePoll() { this.poll.abort(); this.poll = new AbortController(); }
  add(owner: object, tables: readonly string[], invalidate: Interest["invalidate"]) {
    const grows = tables.some(table => !this.byTable.has(table));
    const existing = this.interests.get(owner);
    if (existing) this.unindex(owner, existing);
    if (existing) { existing.tables = new Set(tables); existing.invalidate = invalidate; }
    else this.interests.set(owner, { tables: new Set(tables), invalidate });
    for (const table of tables) {
      let owners = this.byTable.get(table);
      if (!owners) this.byTable.set(table, owners = new Set());
      owners.add(owner);
    }
    if (grows) this.reissuePoll();
  }
  private unindex(owner: object, interest: Interest) {
    for (const table of interest.tables) {
      const owners = this.byTable.get(table); owners?.delete(owner);
      if (!owners?.size) this.byTable.delete(table);
    }
  }
  remove(owner: object) {
    const interest = this.interests.get(owner);
    clearInterval(interest?.incomplete);
    if (interest) this.unindex(owner, interest);
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
    this.incarnationFloor = version.epoch; this.floors.clear();
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
        const notify = interest.invalidate(true);
        if (notify) delivery.push(notify);
      }
    }
    for (const notify of delivery) notify();
    return true;
  }
  // @ref LLP 3000.029#10 — the final synchronous publication check includes
  // ownerless reads and cannot be bypassed by an equal durable sequence.
  valid(request: EphemeralRequest, value: unknown, tables?: Iterable<string>): boolean {
    if (!this.current(request)) return false;
    const version = ephemeralVersion(value);
    if (!version) return true;
    if (version.incarnation !== this.incarnation) return false;
    let floor = Math.max(this.incarnationFloor, this.floors.get("*") ?? 0);
    for (const table of tables ?? request.tables ?? this.floors.keys()) {
      if (table === "*") for (const epoch of this.floors.values()) floor = Math.max(floor, epoch);
      else floor = Math.max(floor, this.floors.get(table) ?? 0);
    }
    return version.epoch >= floor;
  }
  private advance(version: EphemeralVersion, tables?: Iterable<string>) {
    const affected = new Set<object>();
    for (const table of tables ?? ["*"]) if (version.epoch > (this.floors.get(table) ?? -1)) {
      this.floors.set(table, version.epoch);
      for (const owner of table === "*" ? this.interests.keys() : this.byTable.get(table) ?? []) affected.add(owner);
      for (const owner of this.byTable.get("*") ?? []) affected.add(owner);
    }
    const deliveries: (() => void)[] = [];
    for (const owner of affected) {
      const interest = this.interests.get(owner)!;
      if (interest.answer?.incarnation === version.incarnation && interest.answer.epoch >= version.epoch) continue;
      interest.floor = version;
      const deliver = interest.invalidate(true);
      if (deliver) deliveries.push(deliver);
    }
    // Withdraw every overlapping owner before any subscriber can observe a peer.
    for (const deliver of deliveries) deliver();
  }
  accept(request: EphemeralRequest, value: unknown, owner?: object, tables?: Iterable<string>, authoritative = true): boolean {
    if (!this.current(request)) return false;
    const version = ephemeralVersion(value);
    if (!version) return true; // Ordinary refusals need not carry an epoch.
    if (!this.adopt(request, version)) return false;
    const interest = owner && this.interests.get(owner);
    tables ??= request.tables ?? (interest ? interest.tables : undefined);
    if (!this.valid(request, version, tables)) return false;
    if (interest?.floor?.incarnation === version.incarnation && version.epoch < interest.floor.epoch) return false;
    if (authoritative) {
      this.advance(version, tables);
      if (!this.valid(request, version, tables)) return false;
      if (interest) { interest.floor = version; interest.answer = version; }
    }
    return this.valid(request, version, tables); // Subscriber reentrancy may have advanced evidence.
  }
  changed(request: EphemeralRequest, value: unknown): boolean {
    if (!this.current(request)) return false;
    const version = ephemeralVersion(value);
    if (!version) return true; // Compatibility with a server without this feature.
    const replaced = version.incarnation !== this.incarnation;
    if (!this.adopt(request, version)) return false;
    if (version.epoch < this.epoch) return false;
    this.epoch = version.epoch;
    if (!replaced) this.advance(version, (value as EphemeralVersion & { tables?: string[] }).tables ?? []);
    return true;
  }
  incomplete(owner: object, incomplete: boolean) {
    const interest = this.interests.get(owner);
    if (!interest?.tables.size) return;
    if (!incomplete) { clearInterval(interest.incomplete); delete interest.incomplete; }
    else if (!interest.incomplete) {
      // Fixed cadence, independent of response contents or their hidden expiry.
      interest.incomplete = setInterval(() => interest.invalidate(false)?.(), 1000);
      (interest.incomplete as { unref?: () => void }).unref?.();
    }
  }
}
