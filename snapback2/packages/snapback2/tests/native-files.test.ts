import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { NativeAssetFiles, ByteCache, PersistentRangeStore, SqliteBackend, nodeSqliteDriver, fileBackend, partitionDirectory } from "../dist/sqlite-test.mjs";

const asset = { id: "s2id-00000000000000000000000000000007-0000000000000001", width: 8, height: 8 };
const key = asset.id + ".w8";
const payload = { bytes: new Uint8Array([1, 2, 3]), type: "image/png" };
function filesystem() {
  const data = new Map<string, Uint8Array>();
  const writes: string[] = [];
  let beforeWrite: (() => Promise<void>) | undefined;
  return { root: "file:///cache/snapback2", data, writes,
    before(fn?: () => Promise<void>) { beforeWrite = fn; },
    async list(dir: string) { return [...data.keys()].filter((key) => key.startsWith(dir)).map((key) => key.slice(dir.length)); },
    async write(uri: string, bytes: Uint8Array) { await beforeWrite?.(); writes.push(uri); data.set(uri, bytes.slice()); },
    async remove(uri: string) { for (const key of data.keys()) if (key === uri || (uri.endsWith("/") && key.startsWith(uri))) data.delete(key); },
  };
}
async function fixture(once = false) {
  const root = await mkdtemp(join(tmpdir(), "e2-native-files-"));
  const fs = filesystem();
  const files = new NativeAssetFiles(fs);
  let reject = false;
  const backend = new SqliteBackend(() => nodeSqliteDriver(join(root, "native.db")), { beforeCommit() { if (reject) throw new Error("rollback"); } });
  const store = new PersistentRangeStore(fileBackend(backend, files));
  const cache = new ByteCache(store, { maxAssetBytes: 100 });
  await store.open("dev:alice"); cache.bind("dev:alice");
  await store.commit({ schema: { tables: { messages: { columns: { photo: { Image: { max: 5000000, ...(once ? { once: true } : {}) } } } } } }, deliveries: [{ op: "thread", args: {}, seq: 1, state: "complete", next: null,
    data: [{ $row: { table: "messages", id: "m1" } }], rows: [{ table: "messages", id: "m1", row: { id: "m1", photo: asset } }],
    receipt: { ranges: [], absences: [], verdicts: [] } }] });
  return { fs, files, store, cache, backend, root, fail(value: boolean) { reject = value; }, async close() { await store.close(); await rm(root, { recursive: true, force: true }); } };
}

test("native file bridge writes bytes without Blob; eviction deletes only after SQLite commit", async () => {
  const f = await fixture();
  try {
    const Original = globalThis.Blob;
    globalThis.Blob = class { constructor() { throw new Error("native Blob path"); } } as any;
    try {
      assert.equal(await f.cache.putBytes(asset.id, 8, payload), "cached");
      const uri = await f.files.get(f.cache, asset.id, 8);
      assert.equal(uri, "file:///cache/snapback2/dev%3Aalice/" + key);
      assert.deepEqual(f.fs.data.get(uri!), payload.bytes);
      f.fail(true);
      await assert.rejects(f.store.commit({ tombstones: [{ table: "messages", id: "m1", seq: 2 }] }), /rollback/);
      assert.ok(f.fs.data.has(uri!));
      f.fail(false);
      await f.store.commit({ tombstones: [{ table: "messages", id: "m1", seq: 2 }] });
      assert.equal(f.fs.data.has(uri!), false);
      assert.equal(await f.files.get(f.cache, asset.id, 8), undefined);
    } finally { globalThis.Blob = Original; }
  } finally { await f.close(); }
});

test("native file wipe drops either partition and the open partition closes its backend", async () => {
  const f = await fixture();
  try {
    await f.cache.putBytes(asset.id, 8, payload);
    const uri = await f.files.get(f.cache, asset.id, 8);
    const other = partitionDirectory(f.fs.root, "dev:bob") + key;
    f.fs.data.set(other, payload.bytes);
    await f.store.wipe("dev:bob");
    assert.equal(f.fs.data.has(other), false); assert.ok(f.fs.data.has(uri!));
    await f.store.wipe("dev:alice");
    assert.equal(f.fs.data.size, 0);
    assert.equal(await f.backend.readBytes(key), undefined);
    assert.equal(await f.files.get(f.cache, asset.id, 8), undefined);
  } finally { await f.close(); }
});

test("native startup sweeps orphans and a missing carrier payload is deleted instead of served", async () => {
  const f = await fixture();
  try {
    await f.cache.putBytes(asset.id, 8, payload);
    const uri = (await f.files.get(f.cache, asset.id, 8))!;
    const orphan = partitionDirectory(f.fs.root, "dev:alice") + "orphan";
    f.fs.data.set(orphan, payload.bytes);
    await f.store.close(); await f.store.open("dev:alice");
    assert.equal(f.fs.data.has(orphan), false); assert.ok(f.fs.data.has(uri));
    // Simulate a carrier missing its byte payload while the derivative survives.
    const missing = { ...f.cache, getBytes: async () => undefined, viewOnce: async () => false, viewed: async () => false };
    assert.equal(await f.files.get(missing as any, asset.id, 8), undefined);
    assert.equal(f.fs.data.has(uri), false);
  } finally { await f.close(); }
});

test("native in-flight file write is fenced on seal and consumers receive custody invalidation", async () => {
  const f = await fixture();
  try {
    await f.cache.putBytes(asset.id, 8, payload);
    let release!: () => void, reached!: () => void;
    const hit = new Promise<void>((resolve) => { reached = resolve; });
    f.fs.before(async () => { reached(); await new Promise<void>((resolve) => { release = resolve; }); });
    let changed = 0;
    f.files.subscribe(() => { changed++; });
    const write = f.files.get(f.cache, asset.id, 8);
    await hit;
    const seal = f.store.seal();
    // The backend commits before queued derivative work finishes.
    while (changed === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    release();
    assert.equal(await write, undefined);
    await seal;
    assert.equal(f.fs.data.size, 0);
    assert.equal(await f.files.get(f.cache, asset.id, 8), undefined);
    assert.ok(f.files.getCustody() > 1);
  } finally { await f.close(); }
});

test("view-once native bytes stay in memory, are never written, and disappear on custody change", async () => {
  const f = await fixture(true);
  try {
    const viewing = {};
    assert.equal(await f.cache.putBytes(asset.id, 8, payload, viewing), "viewed");
    assert.deepEqual(await f.cache.getBytes(asset.id, 8, viewing), payload);
    assert.equal(await f.cache.getBytes(asset.id, 8), undefined);
    assert.equal(await f.cache.getBytes(asset.id, 8, {}), undefined);
    assert.equal(await f.files.get(f.cache, asset.id, 8), undefined);
    assert.deepEqual(f.fs.writes, []);
    f.cache.forget();
    assert.equal(await f.cache.getBytes(asset.id, 8), undefined);
    assert.equal((await f.store.bytes()).entries.length, 0);
  } finally { await f.close(); }
});

test("native once image lists consume per asset and keep the original across width changes", async () => {
  const f = await fixture(true);
  const second = { ...asset, id: asset.id.slice(0, -1) + "2" };
  const clip = { ...asset, id: asset.id.slice(0, -1) + "3", duration: 1000 };
  try {
    await f.store.commit({ schema: { tables: { messages: { columns: { photos: { List: { of: { Image: { max: 5000000, once: true } }, max: 2 } } } } } },
      deliveries: [{ op: "thread", args: {}, seq: 2, state: "complete", next: null,
        data: [{ $row: { table: "messages", id: "m1" } }],
        rows: [{ table: "messages", id: "m1", row: { id: "m1", photos: [asset, second], clip } }],
        receipt: { ranges: [], absences: [], verdicts: [] } }] });
    assert.equal(await f.cache.viewOnce(clip.id), false, "the modifier belongs to the image column");
    assert.equal(await f.cache.putBytes(clip.id, 8, payload), "refused", "the whole once row is excluded from the byte cache");
    const viewing = {};
    assert.equal(await f.cache.putBytes(asset.id, 8, payload, viewing), "viewed");
    assert.equal(await f.cache.viewed(asset.id), true);
    assert.equal(await f.cache.viewed(second.id), false);
    assert.equal(await f.cache.viewOnce(second.id), true);
    assert.deepEqual((await f.cache.getBytes(asset.id, 240, viewing))?.bytes, payload.bytes);
    assert.equal(await f.cache.putBytes(second.id, 8, payload, {}), "viewed");
    assert.equal(await f.cache.viewed(second.id), true);
    assert.deepEqual(f.fs.writes, []);
    assert.deepEqual((await f.cache.status()).entries, []);
  } finally { await f.close(); }
});
