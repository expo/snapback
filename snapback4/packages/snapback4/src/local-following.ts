import { bindFollowing, type FollowingWire } from "./following-transport.ts";
import type { Client, FollowingQuery } from "./contract.ts";
import { operationTables, type BackendJson } from "./backend.ts";
import type { Queued } from "./local-types.ts";

// @ref LLP 3000.016#own-edge-publication — intent is not a predicted edge.
// The outbox owns durable custody through observation (including sent writes);
// this set only covers calls that have not yet finished admitting/settling.
export class FollowingIntents {
  private readonly calls = new Map<object, string>();
  private waiting = new Set<string>();
  private queuedCalls = new Set<string>();
  constructor(private readonly backend: () => BackendJson | null,
    private readonly queued: () => Promise<Queued[]>,
    private readonly changed: (tables: string[]) => void,
    private readonly viewer: string) {}

  // Hosts report the committed entries before notifying pending-write readers
  // or starting delivery, including orphan adoption and admission replay.
  recovered(entries: readonly Queued[]): void {
    const tables = [...new Set(entries.filter(entry => this.ownPending(entry)).flatMap(entry => this.feeds(entry.op)))];
    if (tables.length) this.changed(tables);
  }

  private ownPending(entry: Queued): boolean {
    return entry.viewer === this.viewer && entry.observed_seq == null;
  }

  private feeds(op: string): string[] {
    const backend = this.backend();
    if (!backend?.schema.timelines?.length) return [];
    const program = backend.programs.find(p => p.name === op);
    const inputs = program && !program.native ? operationTables(program, backend.schema) : undefined;
    return backend.schema.timelines.filter(t => !inputs || (t.edges && inputs.has(t.edges[0])))
      .flatMap(t => [`${t.name}Feed`, `${t.name}Edges`, `${t.name}Work`]);
  }

  track<T>(op: string, run: () => Promise<T>): Promise<T> {
    const tables = this.feeds(op);
    if (!tables.length) return run();
    const key = {};
    this.calls.set(key, op);
    this.changed(tables); // Retire in-flight reads and mark mounted answers in this call turn.
    const release = () => {
      this.calls.delete(key);
      this.changed(tables);
    };
    try {
      const promise = run();
      void promise.then(release, release);
      return promise; // Preserve synchronous admission refusal markers.
    } catch (error) { release(); throw error; }
  }

  blocked(reads: ReadonlySet<string>): boolean {
    return [...this.calls.values(), ...this.queuedCalls].some(op => this.feeds(op).some(table => reads.has(table)));
  }

  async pending(reads: ReadonlySet<string>): Promise<boolean> {
    const backend = this.backend();
    if (!backend?.schema.timelines?.some(t => reads.has(`${t.name}Feed`) || reads.has(`${t.name}Edges`) || reads.has(`${t.name}Work`))) return false;
    const intersects = (op: string) => this.feeds(op).some(table => reads.has(table));
    const entries = await this.queued();
    this.queuedCalls = new Set(entries.filter(e => this.ownPending(e)).map(e => e.op));
    const pending = [...this.calls.values()].some(intersects)
      || entries.some(entry => this.ownPending(entry) && intersects(entry.op));
    if (pending) for (const timeline of backend.schema.timelines ?? []) {
      for (const suffix of ["Feed", "Edges", "Work"]) {
        const table = `${timeline.name}${suffix}`;
        if (reads.has(table)) this.waiting.add(table);
      }
    }
    return pending;
  }

  // An idempotent edge write can publish its receipt with no row footprint.
  // Re-evaluate waiting reads at that publication even when nothing was copied.
  applied(): Set<string> { const waiting = this.waiting; this.waiting = new Set(); return waiting; }
}

// A history page is server-only, but mutation admission starts synchronously.
// Keep this fence separate from the device inbox's existing prediction path.
export class FollowingHistory {
  private readonly calls = new Set<{ inputs: Set<string> | null }>();
  constructor(private readonly backend: () => BackendJson | null, private readonly notify: () => void) {}
  private inputs(op: { name: string; following: { declaration: string } }): Set<string> | null {
    const backend = this.backend(), program = backend?.programs.find(p => p.name === op.name);
    if (!backend || !program) return null;
    const inputs = operationTables(program, backend.schema);
    const timeline = backend.schema.timelines?.find(t => t.name === op.following.declaration);
    if (timeline) for (const source of [timeline.posts[0], timeline.reposts[0], timeline.edges?.[0]]) if (source) inputs.add(source);
    return inputs;
  }
  private pending(inputs: ReadonlySet<string>): boolean {
    return [...this.calls].some(({ inputs: tables }) => !tables || [...tables].some(t => inputs.has(t)));
  }
  track<T>(operation: string, run: () => Promise<T>): Promise<T> {
    const backend = this.backend(), program = backend?.programs.find(p => p.name === operation);
    const inputs = backend && program ? operationTables(program, backend.schema) : null;
    const ticket = { inputs }; this.calls.add(ticket); this.notify();
    const release = () => { this.calls.delete(ticket); this.notify(); };
    try { const work = run(); void work.then(release, release); return work; }
    catch (error) { release(); throw error; }
  }
  bind(client: Client, env: {
    current(): () => boolean;
    inputsCurrent(): (tables: ReadonlySet<string>) => boolean;
    unavailable(): boolean;
    refreshing(): boolean;
    pending(tables: Set<string>): boolean;
    intents: FollowingIntents;
    send(op: FollowingQuery<unknown, unknown>, args: unknown, body: FollowingWire, signal?: AbortSignal): Promise<{ ok: true; json: FollowingWire; obsoleteAuth: boolean } | { ok: false }>;
  }): void {
    bindFollowing(client, async (op, args, body, signal) => {
      const current = env.current(), inputsCurrent = env.inputsCurrent();
      const program = this.backend()?.programs.find(p => p.name === op.name);
      if (!program || program.native) return;
      const tables = this.inputs(op)!;
      const blocked = async () => env.unavailable() || env.refreshing()
        || this.pending(tables) || env.pending(tables) || await env.intents.pending(tables);
      if (await blocked()) return;
      const result = await env.send(op, args, body, signal);
      if (await blocked() || !current() || !inputsCurrent(tables) || !result.ok || result.obsoleteAuth) return;
      return { ...result.json, __followingCurrent: () => current() && inputsCurrent(tables) && !env.unavailable() && !this.pending(tables) && !env.pending(tables) };
    }, op => {
      const tables = this.inputs(op);
      return !tables || this.pending(tables) || env.unavailable() || env.pending(tables) || env.intents.blocked(tables);
    });
  }
}
