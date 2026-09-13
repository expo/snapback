// The replica: the viewer's partitions on the device as one store with one
// watermark (LLP 2000.000 §7.2). A fresh device takes a snapshot, then
// follows the merged stream; every batch applies in one transaction with
// its watermark; a scope tombstone applies the table's leave policy; a
// generation change re-bootstraps. Predictions live beside the rows and are
// replaced by the server's images as they arrive.

import type { Row, SchemaJson, Store, StoreTx } from "./store.ts";

export interface StreamEvent {
  seq?: number;
  table: string;
  kind: "put" | "del" | "scope";
  id: string;
  data?: unknown;
}

export interface StreamPage {
  snapshot: boolean;
  events: StreamEvent[];
  watermark: number;
  more: boolean;
  /** A snapshot's next page, when `more`. */
  next?: string | null;
  generation?: number;
  /** Pending write IDs already represented by this page's watermark. */
  acknowledged?: Record<string, number>;
}

export interface Transport {
  /** `GET /sync?from=W`; `from: 0` is a snapshot, paged by `after`. */
  sync(from: number, limit: number, after?: string): Promise<StreamPage | { denied: unknown }>;
}

export interface ReplicaState {
  watermark: number;
  generation: number;
}

/** The meta keys the replica keeps. */
const WATERMARK = "watermark";
const GENERATION = "generation";
const PAGE = 4000;

export class Replica {
  private listeners = new Set<(touched: Set<string>) => void>();
  private caughtUp = false;
  private following: Promise<void> | null = null;
  private closed = false;
  private syncing: Promise<{ touched: Set<string>; ok: boolean }> | null = null;
  private revision = 0;
  // A reopened or competing replica must begin a fresh staged replacement.
  private readonly snapshotOwner = `${Date.now()}:${Math.random()}:${Math.random()}`;
  /** Keep confirmed rows and predictions in the same commit as stream application. */
  reconcile: (tx: StoreTx, apply: () => Promise<void>, acknowledged?: Record<string, number>) => Promise<void> = (_tx, apply) => apply();

  constructor(readonly store: Store, public schema: SchemaJson, private transport: Transport, public generation: number) {}

  /** A new generation from the server: the next sync re-derives the partition. */
  adopt(schema: SchemaJson, generation: number) {
    this.schema = schema;
    this.generation = generation;
    this.revision++;
    this.caughtUp = false;
  }

  /** Whether the device has applied everything the server had at the last sync. */
  get isCaughtUp(): boolean {
    return this.caughtUp;
  }

  onChange(listener: (touched: Set<string>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async state(): Promise<ReplicaState> {
    return this.store.read(async (tx) => ({ watermark: Number((await tx.getMeta(WATERMARK)) ?? 0), generation: Number((await tx.getMeta(GENERATION)) ?? 0) }));
  }

  /** One round with the server: a snapshot when the device has none or the
   * generation changed, else the stream from the watermark; every page
   * applies as one transaction. Returns the tables that changed. */
  syncOnce(): Promise<{ touched: Set<string>; ok: boolean }> {
    if (this.syncing) return this.syncing;
    const result = this.syncRound();
    this.syncing = result;
    void result.finally(() => { if (this.syncing === result) this.syncing = null; }).catch(() => {});
    return result;
  }

  private async syncRound(): Promise<{ touched: Set<string>; ok: boolean }> {
    const touched = new Set<string>();
    const revision = this.revision;
    const generation = this.generation;
    this.caughtUp = false;
    if (this.closed) return { touched, ok: false };
    const state = await this.state();
    let watermark = state.generation === generation ? state.watermark : 0;
    let after: string | undefined;
    const fetchPage = (cursor?: string) => {
      const promise = this.transport.sync(watermark, PAGE, cursor);
      // A prefetched page may fail while this page's transaction is still
      // running. Its rejection is observed even if application aborts.
      void promise.catch(() => {});
      return promise;
    };
    let inFlight = fetchPage();
    try {
      for (let pages = 0; pages < 100_000; pages++) {
        const page = await inFlight;
        if (this.closed || revision !== this.revision || "denied" in page) return { touched, ok: false };
        if (page.generation !== undefined && page.generation !== generation) return { touched, ok: false };
        if (page.watermark < watermark) return { touched, ok: false };
        if (page.snapshot && page.more && !page.next) return { touched, ok: false };
        const continues = page.snapshot && page.more ? page.next! : undefined;
        if (continues) inFlight = fetchPage(continues);
        await this.apply(page, touched, after === undefined, revision);
        if (continues) { after = continues; continue; }
        after = undefined;
        watermark = page.watermark;
        if (!page.more) {
          this.caughtUp = true;
          return { touched, ok: true };
        }
        inFlight = fetchPage();
      }
      return { touched, ok: false };
    } finally {
      // Stream pages commit independently. Even if a later page fails,
      // observers must see the pages already applied, marked stale. An
      // empty successful round also advances freshness after reconnect.
      if (!this.closed && (touched.size > 0 || this.caughtUp)) for (const listener of this.listeners) listener(touched);
    }
  }

  /** Stage snapshot pages durably without exposing half a replacement.
   * The last page publishes rows, indexes, generation and watermark in one
   * transaction. A failed or interrupted replacement leaves the old view. */
  async apply(page: StreamPage, touched: Set<string>, first = true, revision = this.revision): Promise<void> {
    const generation = this.generation;
    const changed = new Set<string>();
    await this.store.write(async (tx) => {
      const check = () => {
        if (revision !== this.revision || (page.generation !== undefined && page.generation !== generation)) throw new Error("replica generation changed during sync");
      };
      check();
      const storedGeneration = Number((await tx.getMeta(GENERATION)) ?? 0);
      const storedWatermark = Number((await tx.getMeta(WATERMARK)) ?? 0);
      if (storedGeneration === generation && page.watermark < storedWatermark) throw new Error("stale replica page");
      if (page.snapshot) {
        const staged = tx.side("snapshot");
        if (first) {
          await staged.clear();
          await tx.setMeta("snapshot:watermark", page.watermark);
          await tx.setMeta("snapshot:owner", this.snapshotOwner);
        }
        if (await tx.getMeta("snapshot:owner") !== this.snapshotOwner) throw new Error("snapshot owner changed or its replacement already finished; restart from the first page");
        if (await tx.getMeta("snapshot:watermark") !== page.watermark) throw new Error("snapshot watermark changed between pages");
        for (const event of page.events) {
          if (event.kind !== "put") throw new Error("a snapshot contains only row images");
          await staged.put(JSON.stringify([event.table, event.id]), event);
        }
        if (page.more) { check(); return; }
      }
      await this.reconcile(tx, async () => {
        if (page.snapshot) {
          await tx.clearRows();
          for (const table of Object.keys(this.schema.tables)) changed.add(table);
          let after: string | undefined;
          for (;;) {
            const batch = await tx.side("snapshot").page(after, 500);
            for (const { value } of batch) {
              const event = value as StreamEvent;
              await tx.put(event.table, event.data as Row);
            }
            if (batch.length < 500) break;
            after = batch[batch.length - 1]!.key;
          }
          await tx.side("snapshot").clear();
          await tx.setMeta("snapshot:owner", null);
          await tx.setMeta("snapshot:watermark", null);
        } else {
          for (const event of page.events) {
            changed.add(event.table);
            switch (event.kind) {
              case "put": await tx.put(event.table, event.data as Row); break;
              case "del": await tx.delete(event.table, event.id); break;
              case "scope": await this.leave(tx, event.table, event.data as unknown[]); break;
            }
          }
        }
        await tx.setMeta(WATERMARK, page.watermark);
        await tx.setMeta(GENERATION, generation);
        if (!page.more) await tx.setMeta("syncedAt", Date.now());
      }, page.acknowledged);
      check();
    });
    for (const table of changed) touched.add(table);
  }

  /** A group the device left: drop its rows (`until-revoked`) or keep what
   * was delivered (`delivered-history`). */
  private async leave(tx: StoreTx, table: string, group: unknown[]) {
    const definition = this.schema.tables[table];
    if (!definition || definition.leave === "delivered-history") return;
    const audience = definition.sync?.audience as Record<string, unknown> | undefined;
    const prefix: string[] = audience && typeof audience === "object" && "Target" in audience ? (audience.Target as { prefix: string[] }).prefix : audience && "Column" in audience ? [audience.Column as string] : [];
    // The group's rows are the prefix range of any index leading with the
    // audience columns; the horizon index does when there is one.
    const index = definition.sync?.horizon?.by ?? Object.entries(definition.indexes).find(([, i]) => prefix.every((c, n) => (i.components[n] as { Column?: string })?.Column === c))?.[0];
    if (!index) return;
    for (;;) {
      const rows = await tx.scan(table, index, group, {}, "asc", 500);
      if (rows.length === 0) break;
      for (const { row } of rows) await tx.delete(table, row.id);
      if (rows.length < 500) break;
    }
  }

  /** Follow the stream until closed: sync, wait for the transport's next
   * change signal, sync again. */
  follow(wait: () => Promise<void>): void {
    if (this.following) return;
    this.following = (async () => {
      if (this.caughtUp && !this.closed) await wait();
      while (!this.closed) {
        let ok = false;
        try {
          ({ ok } = await this.syncOnce());
        } catch {
          // A store that closed under a sync, or a transport that threw:
          // nothing escapes the loop; the next round decides.
          if (this.closed) break;
        }
        if (this.closed) break;
        if (!ok) await new Promise((r) => setTimeout(r, 1000));
        else await wait();
      }
    })();
  }

  /** Stop following, let a sync in flight finish on the open store, then
   * close it: nothing touches the store after this returns. */
  async close() {
    this.closed = true;
    await this.following?.catch(() => {});
    await this.syncing?.catch(() => {});
    await this.store.close();
  }
}
