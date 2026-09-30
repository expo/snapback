// @ref LLP 3000.007#20.4 — bounded pages and their directory share strict publication.
import type { Change } from "./web.ts";
import { packedStore, unpack } from "./web-idb-buckets.ts";
import { utf8Size } from "./utf8-size.ts";

const HEADER = ["$format", "row-pages"];
export const PAGE_STORE = "pages";
export const LOCATION_STORE = "page-keys";
type Page = { id: number; rows: Change[]; keys: string[] };
type Header = { next: number; revision: number; tails: Record<string, number> };
type Directory = { header: Header; locations: Map<string, number>; counts: Map<number, number> };
const key = (c: Pick<Change, "s" | "k">) => JSON.stringify([c.s, c.k]);
const page = (id: number, rows: Change[]): Page => ({ id, rows, keys: rows.map(key) });
const size = (c: Change) => utf8Size(c.k) * 2 + utf8Size(c.v ?? "") + 80;
const abort = (tx: IDBTransaction) => { try { tx.abort(); } catch { /* already aborted */ } };
const fresh = (): Header => ({ next: 1, revision: 0, tails: Object.create(null) });

/** The directory is a cache, fenced by a revision read inside every save.
 * It changes only after oncomplete. A stale owner must reload, never guess. */
export class RowPages {
  initialize(store: IDBObjectStore): void {
    store.put({ s: HEADER[0], k: HEADER[1], v: JSON.stringify(fresh()) });
  }
  private readonly directories = new Map<string, Directory>();

  loaded(name: string, header: Header, pages: Page[]): Change[] {
    const locations = new Map<string, number>(), rows: Change[] = [];
    for (const p of pages) for (const row of p.rows) { locations.set(key(row), p.id); rows.push(row); }
    this.directories.set(name, { header, locations, counts: new Map(pages.map(p => [p.id, p.rows.length])) });
    return rows;
  }
  forget(name: string): void { this.directories.delete(name); }

  async load(db: IDBDatabase, done: (tx: IDBTransaction) => Promise<void>): Promise<Change[]> {
    const tx = db.transaction(["changes", PAGE_STORE], "readonly"), complete = done(tx);
    const h = tx.objectStore("changes").get(HEADER), p = tx.objectStore(PAGE_STORE).getAll();
    await complete;
    if (!h.result) throw new Error("the row-page directory is missing");
    return this.loaded(db.name, JSON.parse(h.result.v), p.result);
  }

  point(tx: IDBTransaction, s: string, k: string, ready: (value: string | null) => void): void {
    const h = tx.objectStore("changes").get(HEADER);
    h.onsuccess = () => {
      try {
        const header = JSON.parse(h.result.v) as Header;
        const read = (directory: Directory) => {
          const id = directory.locations.get(key({ s, k }));
          if (id === undefined) { ready(null); return; }
          const row = tx.objectStore(PAGE_STORE).get(id);
          row.onsuccess = () => ready((row.result as Page | undefined)?.rows.find(c => c.s === s && c.k === k)?.v ?? null);
        };
        const cached = this.directories.get(tx.db.name);
        if (cached?.header.revision === header.revision) { read(cached); return; }
        // Opening a standalone point reader loads only page keys, not row
        // payloads. A normal device already built this directory during load.
        const request = tx.objectStore(LOCATION_STORE).getAll();
        request.onsuccess = () => {
          const locations = new Map<string, number>();
          for (const p of request.result as { id: number; keys: string[] }[]) for (const k of p.keys) locations.set(k, p.id);
          const directory = { header, locations, counts: new Map((request.result as {id:number;keys:string[]}[]).map(p => [p.id,p.keys.length])) }; this.directories.set(tx.db.name, directory); read(directory);
        };
      } catch { abort(tx); }
    };
  }

  migrate(db: IDBDatabase, done: (tx: IDBTransaction) => Promise<void>): Promise<void> {
    const tx = db.transaction(["changes", PAGE_STORE, LOCATION_STORE], "readwrite", { durability: "strict" });
    const complete = done(tx), store = tx.objectStore("changes"), pages = tx.objectStore(PAGE_STORE), locations = tx.objectStore(LOCATION_STORE);
    const putPage = (p: Page) => { pages.put({ id: p.id, rows: p.rows }); locations.put({ id: p.id, keys: p.keys }); };
    const marker = store.get(["$format", "row-buckets"]);
    marker.onsuccess = () => {
      if (marker.result?.v !== "3") return;
      const read = store.getAll();
      read.onsuccess = () => {
        try {
          const header = fresh();
          let rows: Change[] = [], bytes = 0;
          const flush = () => { if (rows.length) { putPage(page(header.next++, rows)); rows = []; bytes = 0; } };
          const logical = new Map<string, Change>();
          for (const held of read.result as Change[]) {
            if (held.s !== "$bucket" && !packedStore(held.s)) continue;
            for (const row of unpack(held)) logical.set(key(row), row);
            store.delete([held.s, held.k]);
          }
          for (const row of logical.values()) {
            if (rows.length && (rows.length >= 512 || bytes + size(row) > 256 * 1024)) flush();
            rows.push(row); bytes += size(row);
          }
          flush();
          store.put({ s: HEADER[0], k: HEADER[1], v: JSON.stringify(header) });
          store.put({ s: "$format", k: "row-buckets", v: "4" });
        } catch { abort(tx); }
      };
    };
    return complete;
  }

  async save(db: IDBDatabase, changes: Change[], done: (tx: IDBTransaction) => Promise<void>, current?: () => boolean): Promise<boolean> {
    if (!this.directories.has(db.name)) await this.load(db, done);
    const directory = this.directories.get(db.name)!;
    const tx = db.transaction(["changes", PAGE_STORE, LOCATION_STORE], "readwrite", { durability: "strict" });
    const complete = done(tx), store = tx.objectStore("changes"), pages = tx.objectStore(PAGE_STORE), locations = tx.objectStore(LOCATION_STORE);
    const putPage = (p: Page) => { pages.put({ id: p.id, rows: p.rows }); locations.put({ id: p.id, keys: p.keys }); counts.set(p.id, p.rows.length); };
    let stale = false, failure: unknown;
    const updates = new Map<string, number | null>();
    const counts = new Map<number, number>();
    let nextHeader: Header;
    const read = store.get(HEADER);
    read.onsuccess = () => {
      try {
        const header = JSON.parse(read.result.v) as Header;
        if (header.revision !== directory.header.revision) throw new Error("the row-page directory changed; reload the durable device");
        nextHeader = { next: header.next, revision: header.revision + 1, tails: Object.assign(Object.create(null), header.tails) };
        const groups = new Map<number, Change[]>(), additions = new Map<string, Change>();
        const put = (id: number, c: Change) => { if (!groups.has(id)) groups.set(id, []); groups.get(id)!.push(c); };
        for (const c of changes) {
          if (!packedStore(c.s)) { if (c.v === null) store.delete([c.s, c.k]); else store.put(c); continue; }
          const k = key(c), id = directory.locations.get(k);
          if (id !== undefined) put(id, c); else additions.set(k, c);
        }
        // Reuse only the bounded tail page of each namespace. An insertion
        // never scans existing pages or creates a one-row page on every call.
        for (const c of additions.values()) if (c.v !== null && nextHeader.tails[c.s] !== undefined) {
          put(nextHeader.tails[c.s]!, c); additions.delete(key(c));
        }
        const finish = () => {
          try {
            const freshRows = new Map<string, Change[]>();
            for (const c of additions.values()) if (c.v !== null) {
              if (!freshRows.has(c.s)) freshRows.set(c.s, []); freshRows.get(c.s)!.push(c);
            }
            for (const [s, rows] of freshRows) {
              let held: Change[] = [], bytes = 0;
              const flush = () => {
                if (!held.length) return;
                const id = nextHeader.next++;
                putPage(page(id, held));
                for (const c of held) updates.set(key(c), id);
                nextHeader.tails[s] = id; held = []; bytes = 0;
              };
              for (const c of rows) {
                if (held.length && (held.length >= 512 || bytes + size(c) > 256 * 1024)) flush();
                held.push(c); bytes += size(c);
              }
              flush();
            }
            store.put({ s: HEADER[0], k: HEADER[1], v: JSON.stringify(nextHeader) });
            // All callbacks queued every page and metadata write. No await
            // separates the authority predicate from the explicit commit.
            if (current && !current()) { stale = true; tx.abort(); } else tx.commit();
          } catch (error) { failure = error; abort(tx); }
        };
        let remaining = groups.size;
        if (!remaining) finish();
        for (const [id, delta] of groups) {
          // The revision fences this cached cardinality. A complete page of
          // deletions needs no read of the staged payload it is discarding.
          if (delta.every(c => c.v === null) && new Set(delta.map(key)).size === directory.counts.get(id)) {
            pages.delete(id); locations.delete(id); counts.set(id, 0);
            for (const c of delta) updates.set(key(c), null);
            for (const s of Object.keys(nextHeader.tails)) if (nextHeader.tails[s] === id) delete nextHeader.tails[s];
            if (!--remaining) finish();
            continue;
          }
          const request = pages.get(id);
          request.onsuccess = () => {
            try {
              if (!request.result) throw new Error("a row page named by the directory is missing");
              const rows = new Map<string, Change>((request.result as Page).rows.map(c => [key(c), c]));
              for (const c of delta) {
                const k = key(c);
                if (c.v === null) { rows.delete(k); updates.set(k, null); }
                else rows.set(k, c);
              }
              const kept: Change[] = []; let bytes = 0;
              for (const c of rows.values()) {
                if (kept.length && (kept.length >= 512 || bytes + size(c) > 256 * 1024)) {
                  additions.set(key(c), c); updates.set(key(c), null);
                } else { kept.push(c); bytes += size(c); updates.set(key(c), id); }
              }
              if (kept.length) putPage(page(id, kept)); else {
                pages.delete(id); locations.delete(id); counts.set(id, 0);
                for (const s of Object.keys(nextHeader.tails)) if (nextHeader.tails[s] === id) delete nextHeader.tails[s];
              }
              if (!--remaining) finish();
            } catch (error) { failure = error; abort(tx); }
          };
        }
      } catch (error) { failure = error; abort(tx); }
    };
    try { await complete; } catch (error) {
      if (stale) return false;
      this.forget(db.name); throw failure ?? error;
    }
    directory.header = nextHeader!;
    for (const [id, count] of counts) { if (count) directory.counts.set(id, count); else directory.counts.delete(id); }
    for (const [k, id] of updates) { if (id === null) directory.locations.delete(k); else directory.locations.set(k, id); }
    return true;
  }
}
