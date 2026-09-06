import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "../dist/client.mjs";
import { NativeAssetFiles, attachAssetFiles, fileBackend, PersistentRangeStore, SqliteBackend, nodeSqliteDriver } from "../dist/sqlite-test.mjs";

export const photo = { id: "s2id-00000000000000000000000000000008-0000000000000001", width: 8, height: 8 };
export const clip = { id: "s2id-00000000000000000000000000000008-0000000000000002", width: 8, height: 8, duration: 500 };
export const payload = { bytes: new Uint8Array([1, 2, 3]), type: "image/png" };
export const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
export const delivery = (id = "m1", asset = photo) => ({ op: "thread", args: { id }, seq: 1,
  state: "complete" as const, next: null, rows: [{ table: "messages", id, row: { id, photo: asset } }],
  data: [{ $row: { table: "messages", id } }], receipt: { ranges: [], absences: [], verdicts: [] } });

export async function nativeFixture(options: { mediaType?: string; once?: boolean; maxAssetBytes?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "e2-fix1-"));
  const data = new Map<string, Uint8Array>(), writes: string[] = [], requests: RequestInit[] = [];
  const hooks = { write: undefined as undefined | (() => Promise<void>),
    read: undefined as undefined | (() => Promise<void>), network: undefined as undefined | (() => Promise<void>), failCommit: false };
  const files = new NativeAssetFiles({ root: "file:///cache/snapback2",
    async list() { return []; }, async exists(uri) { return data.has(uri); },
    async write(uri, bytes) { await hooks.write?.(); writes.push(uri); data.set(uri, bytes.slice()); },
    async remove(uri) { for (const key of data.keys()) if (key === uri || key.startsWith(uri + "/") || (uri.endsWith("/") && key.startsWith(uri))) data.delete(key); },
  });
  const backend = new SqliteBackend(() => nodeSqliteDriver(join(root, "state.db")), {
    beforeCommit() { if (hooks.failCommit) throw new Error("viewed mark commit failed"); },
  });
  const read = backend.readBytes.bind(backend);
  backend.readBytes = async (key) => { const bytes = await read(key); await hooks.read?.(); return bytes; };
  const store = new PersistentRangeStore(fileBackend(backend, files)); attachAssetFiles(store, files);
  const client = createClient({ url: "http://assets.test", as: "alice",
    offline: { store: () => store, maxAssetBytes: options.maxAssetBytes },
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/manifest") return json({ generation: "native", programGeneration: "program-test", ops: {}, auth: {}, channels: {} });
      if (path === "/api/program") return json({ code: "E_ROUTE", family: "op", message: "absent", guide: "op/reference" }, 404);
      requests.push(init ?? {}); await hooks.network?.();
      return new Response(payload.bytes, { headers: { "Content-Type": options.mediaType ?? payload.type } });
    } });
  await client.ready; await store.commit({ schema: { tables: { messages: { columns: {
    photo: { Image: { max: 5000000, ...(options.once ? { once: true } : {}) } },
  } } } }, deliveries: [delivery()] });
  return { root, files, store, client, backend, data, writes, requests, hooks,
    async close() { await client.close(); await rm(root, { recursive: true, force: true }); } };
}
