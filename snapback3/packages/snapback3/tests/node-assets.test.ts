import assert from "node:assert/strict";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { AssetRuntime } from "../src/node/assets.js";
import { createOwnerServer } from "../src/node/http.js";
import type { AssetKind, MediaFacts, MediaValidator } from "../src/node/media.js";
import { OwnerError, type WorkerTransport } from "../src/node/worker.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const imageFixture = join(repository, "benchmarks/fixtures/social-messenger/media/avatar-alice.png");
const videoFixture = join(repository, "benchmarks/fixtures/social-messenger/media/vid-01.mp4");

interface LedgerRow {
  id: string;
  kind: AssetKind;
  bytes: number;
  creator: string;
  state: "receiving" | "ready" | "discarded";
  facts?: MediaFacts;
  attached: boolean;
  reclaimable: boolean;
  reclaiming: boolean;
  once: boolean;
  readers: Set<string>;
  consumed: Set<string>;
  public: boolean;
  reserved?: number;
}

class AssetWorker implements WorkerTransport {
  readonly rows = new Map<string, LedgerRow>();
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  private sequence = 0;
  loseFinalizeReply = false;
  loseReserveReply = false;
  loseFinishReply = false;
  reclaimRequestFailures = 0;
  finishCalls = 0;
  reserveSawPublished = false;
  finalizeSawPublished = false;
  finalizeSawRawStage = false;
  openGate?: Promise<void>;
  onOpen?: () => void;
  readonly revokedTokens = new Set<string>();

  constructor(readonly root?: string) {}

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    if (method === "asset.reclaim") {
      if (this.reclaimRequestFailures > 0) {
        this.reclaimRequestFailures--;
        throw new OwnerError("S3_WORKER_IO", "Injected reclaim transport failure.");
      }
      const after = typeof params.after === "string" ? params.after : "";
      const limit = params.limit as number;
      const candidates = [...this.rows.values()]
        .filter(row => (row.reclaimable || row.reclaiming) && row.id > after)
        .sort((left, right) => left.id.localeCompare(right.id));
      const ids = candidates.slice(0, limit).map(row => {
        row.reclaiming = true;
        return row.id;
      });
      return { ids, next: candidates.length > limit ? ids[ids.length - 1] : null } as T;
    }
    if (method === "asset.reclaim.finish") {
      const ids = params.ids as string[];
      let finished = 0;
      this.finishCalls++;
      for (const id of new Set(ids)) {
        const row = this.rows.get(id);
        if (row?.reclaiming && !row.attached) {
          this.rows.delete(id);
          finished++;
        }
      }
      if (this.loseFinishReply) {
        this.loseFinishReply = false;
        throw new OwnerError("S3_WORKER_IO", "Injected lost finish reply.");
      }
      return { finished } as T;
    }
    if (method === "asset.delivery.public") {
      const row = this.rows.get(params.id as string);
      if (!row || row.state !== "ready" || !row.attached || !row.public || row.once || !row.facts) {
        throw new OwnerError("S3_ASSET_UNAVAILABLE", "Asset is unavailable.");
      }
      return { kind: row.kind, ...row.facts, duration: row.facts.duration ?? null, public: true, once: false } as T;
    }
    const principal = this.principal(params.token);
    if (method === "authenticate") return {
      principal: { id: principal }, authEpoch: params.token === "alice-token-2" ? 2 : 1,
      expiresAt: Date.now() + 60 * 60_000,
    } as T;
    if (method === "asset.begin") {
      const kind = params.kind as AssetKind;
      const bytes = params.bytes as number;
      const maxBytes = kind === "image" ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > maxBytes) throw new OwnerError("S3_ASSET_TOO_LARGE", "Upload is outside its bound.");
      if (this.rows.size >= 20) throw new OwnerError("S3_ASSET_TOO_LARGE", "Pending asset object limit reached.");
      const id = `asset_${++this.sequence}`;
      this.rows.set(id, {
        id, kind, bytes, creator: principal, state: "receiving", attached: false,
        reclaimable: false, reclaiming: false, once: false, public: false,
        readers: new Set(), consumed: new Set(),
      });
      return { id, maxBytes } as T;
    }
    const id = params.id as string;
    const row = this.rows.get(id);
    if (method === "asset.status") {
      if (!row || row.creator !== principal || row.state === "discarded" || row.attached) return null as T;
      return { id, state: row.state, kind: row.kind, bytes: row.bytes } as T;
    }
    if (method === "asset.discard") {
      if (!row || row.creator !== principal || row.state === "discarded" || row.attached) return { discarded: false } as T;
      row.state = "discarded";
      row.reclaimable = true;
      return { discarded: true } as T;
    }
    if (method === "asset.reserve") {
      if (!row || row.creator !== principal || row.state !== "receiving" || row.reclaiming) {
        throw new OwnerError("S3_ASSET_UNAVAILABLE", "Asset is unavailable.");
      }
      const bytes = params.bytes as number;
      if (this.root) this.reserveSawPublished ||= await fileExists(join(this.root, ".snapback3/media/blobs", id));
      if (row.reserved !== undefined && row.reserved !== bytes) throw new OwnerError("S3_ASSET_FINALIZED", "Asset growth differs.");
      row.reserved = bytes;
      if (this.loseReserveReply) {
        this.loseReserveReply = false;
        throw new OwnerError("S3_WORKER_IO", "Injected lost reserve reply.");
      }
      return { id, bytes } as T;
    }
    if (method === "asset.finalize") {
      if (!row || row.creator !== principal || row.state === "discarded" || row.attached) throw new OwnerError("S3_ASSET_NOT_READY", "Asset is unavailable.");
      row.facts = params.facts as MediaFacts;
      if (this.root) {
        this.finalizeSawPublished ||= await fileExists(join(this.root, ".snapback3/media/blobs", id));
        this.finalizeSawRawStage ||= await fileExists(join(this.root, ".snapback3/media/staging", `asset-${id}.stage`));
      }
      if (row.reserved !== row.facts.bytes) throw new OwnerError("S3_ASSET_TOO_LARGE", "Finalized growth was not reserved.");
      row.bytes = row.facts.bytes;
      row.state = "ready";
      if (this.loseFinalizeReply) {
        this.loseFinalizeReply = false;
        throw new OwnerError("S3_WORKER_IO", "Lost finalized reply.");
      }
      return record(row) as T;
    }
    if (method === "asset.delivery" || method === "asset.open") {
      if (method === "asset.open") { this.onOpen?.(); await this.openGate; }
      if (!row || row.state !== "ready" || !row.attached || !row.readers.has(principal) || !row.facts) {
        throw new OwnerError("S3_ASSET_NOT_READY", "Asset is unavailable.");
      }
      if (row.once && row.consumed.has(principal)) throw new OwnerError("S3_ASSET_VIEWED", "Asset was already viewed.");
      if (method === "asset.open" && row.once) row.consumed.add(principal);
      return {
        kind: row.kind, ...row.facts, duration: row.facts.duration ?? null, public: row.public, once: row.once,
        ...(method === "asset.open" ? { seq: this.sequence } : {}),
      } as T;
    }
    throw new Error(`Unexpected worker method ${method}`);
  }

  attach(id: string, readers: string[], once = false, publicAsset = false): void {
    const row = this.rows.get(id)!;
    row.attached = true;
    row.once = once;
    row.public = publicAsset;
    row.readers = new Set(readers);
  }

  revoke(id: string): void { this.rows.get(id)!.attached = false; }

  release(id: string): void {
    const row = this.rows.get(id)!;
    row.attached = false;
    row.reclaimable = true;
  }

  private principal(token: unknown): string {
    if (typeof token === "string" && this.revokedTokens.has(token)) throw new OwnerError("S3_AUTH", "Sign in again.");
    if (token === "alice-token" || token === "alice-token-2") return "alice";
    if (token === "bob-token") return "bob";
    if (token === "carol-token") return "carol";
    throw new OwnerError("S3_AUTH", "Sign in again.");
  }
}

class FixtureValidator implements MediaValidator {
  async validate(kind: AssetKind, source: string, destination: string): Promise<MediaFacts> {
    const bytes = await readFile(source);
    const png = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    const mp4 = bytes.subarray(4, 8).toString("ascii") === "ftyp";
    if ((kind === "image" && !png) || (kind === "video" && !mp4)) throw new OwnerError("S3_ASSET_TYPE", "Fixture media is corrupt or mismatched.");
    await copyFile(source, destination);
    return kind === "image"
      ? { type: "image/png", bytes: bytes.length, width: 256, height: 256 }
      : { type: "video/mp4", bytes: bytes.length, width: 320, height: 240, duration: 1_000 };
  }
  async close(): Promise<void> {}
}

class TrackingValidator extends FixtureValidator {
  closed = false;
  override async close(): Promise<void> { this.closed = true; }
}

class ClosingValidator implements MediaValidator {
  private rejectValidation?: (error: Error) => void;
  private markStarted!: () => void;
  readonly started = new Promise<void>(done => { this.markStarted = done; });

  async validate(): Promise<MediaFacts> {
    this.markStarted();
    return new Promise<MediaFacts>((_done, reject) => { this.rejectValidation = reject; });
  }

  async close(): Promise<void> {
    this.rejectValidation?.(new OwnerError("S3_OWNER_CLOSED", "Injected validator shutdown."));
  }
}

function record(row: LedgerRow): Record<string, unknown> {
  return { id: row.id, width: row.facts!.width, height: row.facts!.height, ...(row.kind === "video" ? { duration: row.facts!.duration } : {}) };
}

async function fixture(context: TestContext, overrides: {
  reclaimDirectorySync?: (path: string) => Promise<void>;
  stageUnlink?: (path: string) => Promise<void>;
  stageDirectorySync?: (path: string) => Promise<void>;
  validator?: MediaValidator;
  now?: () => number;
  carrierLimit?: number;
  carrierPrincipalLimit?: number;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "snapback3-node-assets-"));
  const worker = new AssetWorker(root);
  const invalidations: number[] = [];
  const options = {
    root, worker, validator: overrides.validator ?? new FixtureValidator(),
    onCommit: ({ seq }: { seq: number }) => invalidations.push(seq),
    reclaimIntervalMs: 10, reclaimRetryMs: 10,
    ...overrides,
  };
  let assets = await AssetRuntime.open(options);
  let owner = createOwnerServer({ root, worker, assets, dev: false, shutdownMs: 50 });
  await new Promise<void>(done => owner.server.listen(0, "127.0.0.1", done));
  let address = owner.server.address();
  assert(address && typeof address !== "string");
  let url = `http://127.0.0.1:${address.port}`;
  context.after(async () => { await owner.close(); await assets.close(); await rm(root, { recursive: true, force: true }); });
  const restart = async () => {
    await owner.close();
    await assets.close();
    assets = await AssetRuntime.open(options);
    owner = createOwnerServer({ root, worker, assets, dev: false, shutdownMs: 50 });
    await new Promise<void>(done => owner.server.listen(0, "127.0.0.1", done));
    address = owner.server.address();
    assert(address && typeof address !== "string");
    url = `http://127.0.0.1:${address.port}`;
  };
  return {
    root, worker, invalidations, restart,
    get assets() { return assets; },
    get owner() { return owner; },
    get url() { return url; },
    upload: async (path: string, kind: AssetKind, token = "alice-token", type?: string) => {
      const bytes = await readFile(path);
      return await fetch(`${url}/api/assets?kind=${kind}`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": type ?? (kind === "image" ? "image/png" : "video/mp4") }, body: bytes,
      });
    },
  };
}

test("authenticated upload survives restart and row authorization precedes bytes and 304", async context => {
  const app = await fixture(context);
  const uploaded = await app.upload(imageFixture, "image");
  assert.equal(uploaded.status, 200);
  const asset = await uploaded.json() as { id: string; width: number; height: number };
  assert.deepEqual(asset, { id: "asset_1", width: 256, height: 256 });

  const status = await fetch(`${app.url}/api/assets/${asset.id}/status`, { headers: { Authorization: "Bearer alice-token" } });
  assert.equal(status.status, 200);
  assert.equal((await status.json() as any).state, "ready");
  assert.equal(await (await fetch(`${app.url}/api/assets/${asset.id}/status`, { headers: { Authorization: "Bearer bob-token" } })).json(), null);
  assert.equal((await fetch(`${app.url}/api/assets/${asset.id}`, { headers: { Authorization: "Bearer alice-token" } })).status, 404);

  app.worker.attach(asset.id, ["bob"]);
  const expected = await readFile(imageFixture);
  let response = await fetch(`${app.url}/api/assets/${asset.id}`, {
    headers: { Authorization: "Bearer bob-token", Origin: app.url },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
  const etag = response.headers.get("etag")!;
  assert.equal(response.headers.get("cache-control"), "private, no-cache");
  assert(response.headers.get("access-control-expose-headers")?.includes("Content-Range"));

  await app.restart();
  response = await fetch(`${app.url}/api/assets/${asset.id}`, { headers: { Authorization: "Bearer bob-token", "If-None-Match": etag } });
  assert.equal(response.status, 304);
  assert(app.worker.calls.some(call => call.method === "asset.open"), "304 still reauthorizes through asset.open");
  app.worker.revoke(asset.id);
  response = await fetch(`${app.url}/api/assets/${asset.id}`, { headers: { Authorization: "Bearer bob-token", "If-None-Match": etag } });
  assert.equal(response.status, 404, "revocation wins over a matching conditional");
  assert.equal((await fetch(`${app.url}/api/assets/${asset.id}`, { headers: { Authorization: "Bearer invalid" } })).status, 401);
});

test("upload mismatch, corruption, foreign lifecycle, and interruption clean admitted custody", async context => {
  const app = await fixture(context);
  assert.equal((await app.upload(imageFixture, "image", "invalid")).status, 401);
  assert.equal((await app.upload(imageFixture, "image", "alice-token", "image/jpeg")).status, 422);
  const corrupt = join(app.root, "corrupt.png");
  await writeFile(corrupt, Buffer.from("89504e470d0a1a0a626164", "hex"));
  assert.equal((await app.upload(corrupt, "video", "alice-token", "video/mp4")).status, 422);
  assert([...app.worker.rows.values()].filter(row => row.state !== "discarded").length === 0);

  const socket = createConnection(Number(new URL(app.url).port), "127.0.0.1");
  socket.write("POST /api/assets?kind=image HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer alice-token\r\nContent-Type: image/png\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n");
  socket.write((await readFile(imageFixture)).subarray(0, 32));
  await waitFor(() => [...app.worker.rows.values()].some(row => row.state === "receiving"));
  socket.destroy();
  await waitFor(() => [...app.worker.rows.values()].every(row => row.state !== "receiving"));
  assert.deepEqual(await readdir(join(app.root, ".snapback3/media/staging")), []);

  const uploaded = await app.upload(imageFixture, "image");
  const asset = await uploaded.json() as { id: string };
  assert.equal(await (await fetch(`${app.url}/api/assets/${asset.id}/status`, { headers: { Authorization: "Bearer bob-token" } })).json(), null);
  assert.deepEqual(await (await fetch(`${app.url}/api/assets/${asset.id}/discard`, {
    method: "POST", headers: { Authorization: "Bearer bob-token", "Content-Type": "application/json" }, body: "{}",
  })).json(), { discarded: false });
  assert.deepEqual(await (await fetch(`${app.url}/api/assets/${asset.id}/discard`, {
    method: "POST", headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" }, body: "{}",
  })).json(), { discarded: true });
  assert.equal((await fetch(`${app.url}/api/assets/${asset.id}`, { headers: { Authorization: "Bearer alice-token" } })).status, 404);
});

test("missing once bytes do not consume and concurrent conditional/range opens yield one body", async context => {
  const app = await fixture(context);
  const uploaded = await app.upload(imageFixture, "image");
  const asset = await uploaded.json() as { id: string };
  app.worker.attach(asset.id, ["bob"], true);
  const path = join(app.root, ".snapback3/media/blobs", asset.id);
  const bytes = await readFile(path);

  const head = await fetch(`${app.url}/api/assets/${asset.id}`, { method: "HEAD", headers: { Authorization: "Bearer bob-token" } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("cache-control"), "private, no-store");
  assert.equal(head.headers.get("etag"), null);
  assert.equal(app.worker.rows.get(asset.id)!.consumed.size, 0);

  await rm(path);
  assert.equal((await fetch(`${app.url}/api/assets/${asset.id}`, { headers: { Authorization: "Bearer bob-token" } })).status, 503);
  assert.equal(app.worker.rows.get(asset.id)!.consumed.size, 0, "missing file descriptor does not burn a view");
  await writeFile(path, bytes, { mode: 0o600 });

  const opens = await Promise.all([
    fetch(`${app.url}/api/assets/${asset.id}`, { headers: { Authorization: "Bearer bob-token", Range: "bytes=1-3" } }),
    fetch(`${app.url}/api/assets/${asset.id}`, { headers: { Authorization: "Bearer bob-token", "If-None-Match": `"${asset.id}"` } }),
  ]);
  assert.deepEqual(opens.map(response => response.status).sort((a, b) => a - b), [200, 410]);
  const winner = opens.find(response => response.status === 200)!;
  assert.deepEqual(Buffer.from(await winner.arrayBuffer()), bytes, "once selectors never produce a partial or 304 body");
  assert.deepEqual(app.invalidations, [1], "the once consumption commit invalidates live resources before completion");
  assert.equal((await fetch(`${app.url}/api/assets/${asset.id}`, { method: "HEAD", headers: { Authorization: "Bearer bob-token" } })).status, 410);
  app.worker.revoke(asset.id);
  assert.equal((await fetch(`${app.url}/api/assets/${asset.id}`, { method: "HEAD", headers: { Authorization: "Bearer bob-token" } })).status, 404,
    "current row authorization hides spent state after access is revoked");
});

test("video HEAD and one bounded Range use current row authority", async context => {
  const app = await fixture(context);
  const source = await readFile(videoFixture);
  const uploaded = await app.upload(videoFixture, "video");
  assert.equal(uploaded.status, 200);
  const asset = await uploaded.json() as { id: string; duration: number };
  assert.equal(asset.duration, 1_000);
  app.worker.attach(asset.id, ["bob"]);

  let response = await fetch(`${app.url}/api/assets/${asset.id}`, { method: "HEAD", headers: { Authorization: "Bearer bob-token", Range: "bytes=4-11" } });
  assert.equal(response.status, 200);
  assert.equal(Number(response.headers.get("content-length")), source.length);
  assert.equal(app.worker.rows.get(asset.id)!.consumed.size, 0);
  response = await fetch(`${app.url}/api/assets/${asset.id}`, { headers: { Authorization: "Bearer bob-token", Range: "bytes=4-11" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), `bytes 4-11/${source.length}`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), source.subarray(4, 12));
  assert.equal((await fetch(`${app.url}/api/assets/${asset.id}`, { headers: { Authorization: "Bearer bob-token", Range: "bytes=0-1,4-5" } })).status, 416);
  app.worker.revoke(asset.id);
  assert.equal((await fetch(`${app.url}/api/assets/${asset.id}`, { headers: { Authorization: "Bearer bob-token", Range: "bytes=4-11" } })).status, 404);
});

test("a lost finalize reply recovers the ready asset without a duplicate upload", async context => {
  const app = await fixture(context);
  app.worker.loseFinalizeReply = true;
  const response = await app.upload(imageFixture, "image");
  assert.equal(response.status, 200);
  const asset = await response.json() as { id: string };
  assert.equal(asset.id, "asset_1");
  assert.equal(app.worker.calls.filter(call => call.method === "asset.begin").length, 1);
  assert.equal(app.worker.calls.filter(call => call.method === "asset.finalize").length, 2);
  assert.equal(app.worker.calls.filter(call => call.method === "asset.status").length, 1);
  assert.equal(app.worker.rows.get(asset.id)!.state, "ready");
});

test("chunked upload is bounded and begins the ledger with the exact received size", async context => {
  const app = await fixture(context);
  const bytes = await readFile(imageFixture);
  const result = await new Promise<{ status: number; body: string }>((resolveRequest, reject) => {
    const target = new URL(`${app.url}/api/assets?kind=image`);
    const request = httpRequest({
      host: target.hostname, port: Number(target.port), path: target.pathname + target.search, method: "POST",
      headers: { Authorization: "Bearer alice-token", "Content-Type": "image/png", "Transfer-Encoding": "chunked" },
    }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolveRequest({ status: response.statusCode!, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("error", reject);
    request.write(bytes.subarray(0, 101));
    request.end(bytes.subarray(101));
  });
  assert.equal(result.status, 200);
  const asset = JSON.parse(result.body) as { id: string };
  const begin = app.worker.calls.find(call => call.method === "asset.begin")!;
  assert.equal(begin.params.bytes, bytes.length);
  assert.equal(app.worker.rows.get(asset.id)!.bytes, bytes.length);
});

test("rejected ongoing chunked uploads close ingress before releasing their slot", async context => {
  let started = 0;
  let allStarted!: () => void;
  let release!: () => void;
  const startedEight = new Promise<void>(done => { allStarted = done; });
  const gate = new Promise<void>(done => { release = done; });
  const validator: MediaValidator = {
    async validate(kind, source, destination) {
      started++;
      if (started === 8) allStarted();
      await gate;
      return new FixtureValidator().validate(kind, source, destination);
    },
    async close() { release(); },
  };
  const app = await fixture(context, { validator });
  const bytes = await readFile(imageFixture);
  const uploads = Array.from({ length: 8 }, () => fetch(`${app.url}/api/assets?kind=image`, {
    method: "POST", headers: { Authorization: "Bearer alice-token", "Content-Type": "image/png" }, body: bytes,
  }));
  await startedEight;

  const early = await ongoingChunkedRefusal(app.url, "/api/assets?kind=image", {
    "Content-Type": "image/png",
  });
  assert.match(early, /^HTTP\/1\.1 401 /);
  assert.match(early.toLowerCase(), /connection: close/);

  const saturated = await Promise.all(Array.from({ length: 12 }, () => ongoingChunkedRefusal(app.url, "/api/assets?kind=image", {
    Authorization: "Bearer alice-token", "Content-Type": "image/png",
  })));
  assert(saturated.every(value => /^HTTP\/1\.1 429 /.test(value)));
  assert(saturated.every(value => /connection: close/.test(value.toLowerCase())));

  release();
  const completed = await Promise.all(uploads);
  assert(completed.every(response => response.status === 200));
  await Promise.all(completed.map(response => response.arrayBuffer()));
});

test("finalized growth is reserved before publication and raw stage removal precedes ready", async context => {
  const app = await fixture(context);
  app.worker.loseReserveReply = true;
  const response = await app.upload(imageFixture, "image");
  assert.equal(response.status, 200);
  const asset = await response.json() as { id: string };
  const methods = app.worker.calls.map(call => call.method);
  assert.equal(methods.filter(method => method === "asset.reserve").length, 2, "lost reserve reply retries the same idempotent admission");
  assert(methods.indexOf("asset.reserve") < methods.indexOf("asset.finalize"));
  assert.equal(app.worker.reserveSawPublished, false, "physical publication cannot lead durable growth admission");
  assert.equal(app.worker.finalizeSawPublished, true, "ready observes durable published bytes");
  assert.equal(app.worker.finalizeSawRawStage, false, "ready cannot attach while the original stage remains");
  assert.equal(app.worker.rows.get(asset.id)?.reserved, app.worker.rows.get(asset.id)?.facts?.bytes);
});

for (const failure of ["unlink", "fsync"] as const) {
  test(`raw stage ${failure} failure cannot publish ready and is reclaimed after reopen`, async context => {
    let injected = false;
    const app = await fixture(context, failure === "unlink" ? {
      stageUnlink: async path => {
        if (!injected) { injected = true; throw Object.assign(new Error("injected unlink"), { code: "EIO" }); }
        await rm(path);
      },
    } : {
      stageDirectorySync: async path => {
        if (!injected) { injected = true; throw Object.assign(new Error("injected fsync"), { code: "EIO" }); }
        await syncDirectoryForTest(path);
      },
    });
    app.worker.reclaimRequestFailures = 1_000;
    const response = await app.upload(imageFixture, "image");
    assert.equal(response.status, 500);
    const failed = [...app.worker.rows.values()].find(row => row.state === "discarded");
    assert(failed, "failure becomes durable discard custody, never ready/attachable");
    assert.equal(failed.facts, undefined);
    await app.restart();
    app.worker.reclaimRequestFailures = 0;
    await waitFor(() => !app.worker.rows.has(failed.id));
    assert.equal(await fileExists(join(app.root, ".snapback3/media/staging", `asset-${failed.id}.stage`)), false);
    assert.equal(await fileExists(join(app.root, ".snapback3/media/blobs", failed.id)), false);

    const replacement = await app.upload(imageFixture, "image");
    assert.equal(replacement.status, 200);
    const asset = await replacement.json() as { id: string };
    app.worker.attach(asset.id, ["alice"]);
    assert.equal((await fetch(`${app.url}/api/assets/${asset.id}`, { headers: { Authorization: "Bearer alice-token" } })).status, 200);
  });
}

test("collector never deletes an actively held delivery id and retries after release", async context => {
  const app = await fixture(context);
  const uploaded = await app.upload(imageFixture, "image");
  const asset = await uploaded.json() as { id: string };
  app.worker.attach(asset.id, ["alice"]);
  let reachedOpen!: () => void;
  let continueOpen!: () => void;
  const opening = new Promise<void>(done => { reachedOpen = done; });
  app.worker.openGate = new Promise<void>(done => { continueOpen = done; });
  app.worker.onOpen = reachedOpen;

  const delivery = fetch(`${app.url}/api/assets/${asset.id}`, { headers: { Authorization: "Bearer alice-token" } });
  await opening;
  app.worker.release(asset.id);
  await waitFor(() => app.worker.rows.get(asset.id)?.reclaiming === true);
  assert.equal(await fileExists(join(app.root, ".snapback3/media/blobs", asset.id)), true);
  assert.equal(app.worker.finishCalls, 0, "an active delivery id is not physically settled");
  continueOpen();
  assert.equal((await delivery).status, 404);
  await waitFor(() => !app.worker.rows.has(asset.id));
  assert.equal(await fileExists(join(app.root, ".snapback3/media/blobs", asset.id)), false);
});

test("startup recovers only precisely owned scratch without sweeping blob collateral", async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-node-scratch-recovery-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const scratch = join(root, ".snapback3/media/scratch");
  const blobs = join(root, ".snapback3/media/blobs");
  const stale = join(scratch, "request-999-00000000-0000-4000-8000-000000000000");
  const unrelated = join(scratch, "keep-unrelated");
  await Promise.all([mkdir(stale, { recursive: true }), mkdir(unrelated, { recursive: true }), mkdir(blobs, { recursive: true })]);
  await Promise.all([writeFile(join(stale, "helper.tmp"), "remove"), writeFile(join(unrelated, "keep"), "keep"), writeFile(join(blobs, "not-a-ledger-id"), "keep")]);
  const worker: WorkerTransport = {
    request: async <T>(method: string) => {
      assert.equal(method, "asset.reclaim");
      return { ids: [], next: null } as T;
    },
  };
  const runtime = await AssetRuntime.open({ root, worker, validator: new TrackingValidator(), reclaimIntervalMs: 10 });
  context.after(() => runtime.close());
  const deadline = Date.now() + 2_000;
  while (await pathExists(stale) && Date.now() < deadline) await new Promise(done => setTimeout(done, 5));
  assert.equal(await pathExists(stale), false);
  assert.equal(await readFile(join(unrelated, "keep"), "utf8"), "keep");
  assert.equal(await readFile(join(blobs, "not-a-ledger-id"), "utf8"), "keep");
});

test("certified public delivery and media-only carriers preserve current authority", async context => {
  const app = await fixture(context);
  const publicUpload = await app.upload(imageFixture, "image");
  const publicAsset = await publicUpload.json() as { id: string };
  app.worker.attach(publicAsset.id, [], false, true);
  let response = await fetch(`${app.url}/api/assets/${publicAsset.id}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, immutable");
  const publicEtag = response.headers.get("etag")!;
  await response.arrayBuffer();
  response = await fetch(`${app.url}/api/assets/${publicAsset.id}`, { method: "HEAD", headers: { "If-None-Match": publicEtag } });
  assert.equal(response.status, 304, "certified public authority is checked before a public 304");

  const privateUpload = await app.upload(videoFixture, "video");
  const privateAsset = await privateUpload.json() as { id: string };
  app.worker.attach(privateAsset.id, ["alice"]);
  assert.equal((await fetch(`${app.url}/api/assets/${privateAsset.id}`)).status, 404);
  assert.equal((await fetch(`${app.url}/api/assets/missing`)).status, 404);
  const onceUpload = await app.upload(imageFixture, "image");
  const onceAsset = await onceUpload.json() as { id: string };
  app.worker.attach(onceAsset.id, ["alice"], true, true);
  assert.equal((await fetch(`${app.url}/api/assets/${onceAsset.id}`)).status, 404, "anonymous once is indistinguishable from missing/private");

  const minted = await fetch(`${app.url}/api/assets/session`, { method: "POST", headers: { Authorization: "Bearer alice-token" } });
  assert.equal(minted.status, 200);
  const session = await minted.json() as { token: string; expiresAt: number };
  assert.notEqual(session.token, "alice-token");
  assert(session.expiresAt > Date.now() && session.expiresAt <= Date.now() + 10 * 60_000);
  const reused = await (await fetch(`${app.url}/api/assets/session`, { method: "POST", headers: { Authorization: "Bearer alice-token" } })).json();
  assert.deepEqual(reused, session);

  response = await fetch(`${app.url}/api/assets/${privateAsset.id}?s=${session.token}`, { headers: { Range: "bytes=4-11" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const carrierEtag = response.headers.get("etag")!;
  await response.arrayBuffer();
  const authBefore304 = app.worker.calls.filter(call => call.method === "authenticate").length;
  response = await fetch(`${app.url}/api/assets/${privateAsset.id}?s=${session.token}`, { headers: { "If-None-Match": carrierEtag } });
  assert.equal(response.status, 304);
  assert(app.worker.calls.filter(call => call.method === "authenticate").length > authBefore304, "carrier conditional reauthenticates its exact session");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await fetch(`${app.url}/api/assets/${privateAsset.id}?s=${session.token}`, { headers: { Authorization: "Bearer alice-token" } })).status, 400);
  assert.equal((await fetch(`${app.url}/api/assets/${privateAsset.id}?s=${session.token}&s=x`)).status, 400);
  assert.equal((await fetch(`${app.url}/api/assets/${privateAsset.id}?unknown=x`)).status, 400);
  assert.equal((await fetch(`${app.url}/api/query?s=${session.token}`, { method: "POST" })).status, 401, "carrier is never general API auth");

  await app.restart();
  assert.equal((await fetch(`${app.url}/api/assets/${privateAsset.id}?s=${session.token}`)).status, 404, "owner restart drops nondurable carriers");
  const revoked = await (await fetch(`${app.url}/api/assets/session`, { method: "POST", headers: { Authorization: "Bearer alice-token" } })).json() as { token: string };
  app.worker.revokedTokens.add("alice-token");
  assert.equal((await fetch(`${app.url}/api/assets/${privateAsset.id}?s=${revoked.token}`)).status, 404, "logout/revocation refuses a carrier without revealing the row");
});

test("media carriers expire at their bounded owner deadline", async context => {
  let now = Date.now();
  const app = await fixture(context, { now: () => now });
  const uploaded = await app.upload(videoFixture, "video");
  const asset = await uploaded.json() as { id: string };
  app.worker.attach(asset.id, ["alice"]);
  const session = await (await fetch(`${app.url}/api/assets/session`, {
    method: "POST", headers: { Authorization: "Bearer alice-token" },
  })).json() as { token: string; expiresAt: number };
  assert(session.expiresAt <= now + 10 * 60_000);
  now = session.expiresAt;
  assert.equal((await fetch(`${app.url}/api/assets/${asset.id}?s=${session.token}`)).status, 404);
});

test("media carrier capacity is bounded globally and per principal", async context => {
  const app = await fixture(context, { carrierLimit: 2, carrierPrincipalLimit: 1 });
  const mint = (token: string) => fetch(`${app.url}/api/assets/session`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  const first = await mint("alice-token");
  assert.equal(first.status, 200);
  const firstValue = await first.json();
  assert.deepEqual(await (await mint("alice-token")).json(), firstValue, "the same sufficiently fresh exact session is reused");
  assert.equal((await mint("alice-token-2")).status, 429, "a second session for one principal cannot exceed its cap");
  assert.equal((await mint("bob-token")).status, 200);
  assert.equal((await mint("carol-token")).status, 429, "global capacity refuses instead of evicting mounted players");
});

test("asset close stops active body and validation work and joins discard/scratch cleanup", async context => {
  const app = await fixture(context);
  app.worker.reclaimRequestFailures = 1_000;
  const socket = createConnection(Number(new URL(app.url).port), "127.0.0.1");
  socket.write("POST /api/assets?kind=image HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer alice-token\r\nContent-Type: image/png\r\nContent-Length: 1000\r\n\r\n");
  socket.write((await readFile(imageFixture)).subarray(0, 32));
  await waitFor(() => [...app.worker.rows.values()].some(row => row.state === "receiving"));
  await app.assets.close();
  assert([...app.worker.rows.values()].every(row => row.state !== "receiving"), "close waits for admitted body catch/discard");
  assert.equal(socket.destroyed, true);

  const validationRoot = await mkdtemp(join(tmpdir(), "snapback3-node-assets-validation-close-"));
  context.after(() => rm(validationRoot, { recursive: true, force: true }));
  const worker = new AssetWorker(validationRoot);
  worker.reclaimRequestFailures = 1_000;
  const validator = new ClosingValidator();
  const assets = await AssetRuntime.open({ root: validationRoot, worker, validator, reclaimIntervalMs: 10, reclaimRetryMs: 10 });
  const owner = createOwnerServer({ root: validationRoot, worker, assets, dev: false, shutdownMs: 50 });
  await new Promise<void>(done => owner.server.listen(0, "127.0.0.1", done));
  context.after(async () => { await owner.close(); await assets.close(); });
  const address = owner.server.address();
  assert(address && typeof address !== "string");
  const upload = fetch(`http://127.0.0.1:${address.port}/api/assets?kind=image`, {
    method: "POST", headers: { Authorization: "Bearer alice-token", "Content-Type": "image/png" }, body: await readFile(imageFixture),
  }).catch(() => undefined);
  await validator.started;
  await assets.close();
  assert([...worker.rows.values()].every(row => row.state !== "receiving"), "helper termination is followed by discard while the worker remains available");
  assert.deepEqual(await readdir(join(validationRoot, ".snapback3/media/scratch")), []);
  await upload;
});

test("twenty discarded uploads release object and byte custody for the next upload", async context => {
  const app = await fixture(context);
  app.worker.reclaimRequestFailures = 1_000;
  for (let index = 0; index < 20; index++) {
    const uploaded = await app.upload(imageFixture, "image");
    assert.equal(uploaded.status, 200);
    const asset = await uploaded.json() as { id: string };
    const discarded = await fetch(`${app.url}/api/assets/${asset.id}/discard`, {
      method: "POST", headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(discarded.status, 200);
    assert.deepEqual(await discarded.json(), { discarded: true });
  }
  assert.equal(app.worker.rows.size, 20);
  assert.equal((await app.upload(imageFixture, "image")).status, 413, "charge remains before physical confirmation");

  app.worker.reclaimRequestFailures = 0;
  await waitFor(() => app.worker.rows.size === 0);
  const accepted = await app.upload(imageFixture, "image");
  assert.equal(accepted.status, 200);
  assert.equal(app.worker.rows.size, 1, "confirmed cleanup restores the bounded slot and byte ledger");
});

test("periodic turns reclaim expired, deleted, and replaced finalized assets without clients or collateral deletion", async context => {
  const app = await fixture(context);
  const ids: string[] = [];
  for (let index = 0; index < 3; index++) {
    const uploaded = await app.upload(imageFixture, "image");
    assert.equal(uploaded.status, 200);
    const asset = await uploaded.json() as { id: string };
    ids.push(asset.id);
    app.worker.attach(asset.id, ["alice"]);
  }
  const blobDirectory = join(app.root, ".snapback3/media/blobs");
  const stageDirectory = join(app.root, ".snapback3/media/staging");
  await writeFile(join(blobDirectory, "asset_collateral"), "keep", { mode: 0o600 });
  await writeFile(join(stageDirectory, "asset-collateral.stage"), "keep", { mode: 0o600 });

  // These model the ledger transitions made by expiry, row deletion, and
  // same-cell replacement. No HTTP/client call wakes the Node reclamation loop.
  for (const id of ids) app.worker.release(id);
  await waitFor(() => ids.every(id => !app.worker.rows.has(id)));
  assert.equal(await readFile(join(blobDirectory, "asset_collateral"), "utf8"), "keep");
  assert.equal(await readFile(join(stageDirectory, "asset-collateral.stage"), "utf8"), "keep");
  assert(ids.every(id => !app.worker.rows.has(id)));
});

test("a lost finish reply is recovered idempotently across owner restart", async context => {
  const app = await fixture(context);
  const uploaded = await app.upload(imageFixture, "image");
  const asset = await uploaded.json() as { id: string };
  app.worker.loseFinishReply = true;
  assert.deepEqual(await (await fetch(`${app.url}/api/assets/${asset.id}/discard`, {
    method: "POST", headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" }, body: "{}",
  })).json(), { discarded: true });
  await waitFor(() => app.worker.finishCalls >= 1 && !app.worker.rows.has(asset.id));
  await app.restart();
  await waitFor(() => app.worker.calls.some(call => call.method === "asset.reclaim"));
  assert.equal(app.worker.rows.has(asset.id), false);
  assert.equal((await app.upload(imageFixture, "image")).status, 200);
});

test("interrupted physical deletion retains charge and retries only the ledger path", async context => {
  const app = await fixture(context);
  const uploaded = await app.upload(imageFixture, "image");
  const asset = await uploaded.json() as { id: string };
  const blob = join(app.root, ".snapback3/media/blobs", asset.id);
  const collateral = join(app.root, ".snapback3/media/blobs", "asset_not_in_ledger");
  await rm(blob);
  await mkdir(blob);
  await writeFile(collateral, "keep", { mode: 0o600 });
  assert.deepEqual(await (await fetch(`${app.url}/api/assets/${asset.id}/discard`, {
    method: "POST", headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" }, body: "{}",
  })).json(), { discarded: true });
  await new Promise(done => setTimeout(done, 50));
  assert(app.worker.rows.has(asset.id), "EISDIR/IO leaves the durable charge in place");
  assert.equal(app.worker.finishCalls, 0, "unconfirmed deletion is never acknowledged");
  assert.equal(await readFile(collateral, "utf8"), "keep");

  await rm(blob, { recursive: true });
  await waitFor(() => !app.worker.rows.has(asset.id));
  assert.equal(await readFile(collateral, "utf8"), "keep", "retries never sweep nearby non-ledger files");
});

test("missing-file retry needs a successful directory sync before releasing charge", async context => {
  let expectedBlob = "";
  let blobSyncAttempts = 0;
  let reachedMissingRetry!: () => void;
  let allowMissingRetry!: () => void;
  const missingRetry = new Promise<void>(done => { reachedMissingRetry = done; });
  const allowSync = new Promise<void>(done => { allowMissingRetry = done; });
  const app = await fixture(context, {
    reclaimDirectorySync: async directory => {
      if (directory !== dirname(expectedBlob)) return syncDirectoryForTest(directory);
      blobSyncAttempts++;
      assert.equal(await fileExists(expectedBlob), false, "the exact blob is absent before its parent sync");
      if (blobSyncAttempts === 1) {
        throw Object.assign(new Error("Injected directory sync failure."), { code: "EIO" });
      }
      reachedMissingRetry();
      await allowSync;
      await syncDirectoryForTest(directory);
    },
  });
  const uploaded = await app.upload(imageFixture, "image");
  const asset = await uploaded.json() as { id: string };
  expectedBlob = join(app.root, ".snapback3/media/blobs", asset.id);
  assert.deepEqual(await (await fetch(`${app.url}/api/assets/${asset.id}/discard`, {
    method: "POST", headers: { Authorization: "Bearer alice-token", "Content-Type": "application/json" }, body: "{}",
  })).json(), { discarded: true });

  await missingRetry;
  assert.equal(blobSyncAttempts, 2, "retry syncs the directory even though unlink now returns ENOENT");
  assert(app.worker.rows.has(asset.id), "the durable charge remains while retry-time directory sync is pending");
  assert.equal(app.worker.finishCalls, 0, "physical deletion is not confirmed before a successful directory sync");

  allowMissingRetry();
  await waitFor(() => !app.worker.rows.has(asset.id));
  assert.equal(app.worker.finishCalls, 1);
});

test("close fences helpers immediately and drains the owned reclaim turn before returning", async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-node-assets-close-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  let started!: () => void;
  let finish!: (value: unknown) => void;
  const requested = new Promise<void>(resolveRequest => { started = resolveRequest; });
  const result = new Promise<unknown>(resolveResult => { finish = resolveResult; });
  const worker: WorkerTransport = {
    request: async <T>(method: string) => {
      assert.equal(method, "asset.reclaim");
      started();
      return await result as T;
    },
  };
  const validator = new TrackingValidator();
  const runtime = await AssetRuntime.open({ root, worker, validator, reclaimIntervalMs: 10, reclaimRetryMs: 10 });
  await requested;
  const closing = runtime.close();
  let settled = false;
  void closing.then(() => { settled = true; });
  await new Promise(resolveTurn => setImmediate(resolveTurn));
  assert.equal(validator.closed, true, "validator admission is fenced while the worker remains available");
  assert.equal(settled, false, "close still owns the in-flight ledger turn");
  finish({ ids: [], next: null });
  await closing;
  assert.equal(validator.closed, true);
});

test("asset close preserves a validator close rejection", async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-node-assets-close-error-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const worker: WorkerTransport = {
    request: async <T>(method: string) => {
      assert.equal(method, "asset.reclaim");
      return { ids: [], next: null } as T;
    },
  };
  const failure = new OwnerError("S3_MEDIA_SHUTDOWN_TIMEOUT", "Injected validator close failure.");
  const validator: MediaValidator = {
    async validate() { throw new Error("not used"); },
    async close() { throw failure; },
  };
  const runtime = await AssetRuntime.open({ root, worker, validator });
  await assert.rejects(runtime.close(), error => error === failure);
  await assert.rejects(runtime.close(), error => error === failure, "memoized close retains the same observable rejection");
});

test("rejected in-flight reclamation still permits complete owner shutdown", async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-node-assets-close-reject-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  let started!: () => void;
  let rejectReclaim!: (error: Error) => void;
  const requested = new Promise<void>(done => { started = done; });
  const result = new Promise<unknown>((_done, reject) => { rejectReclaim = reject; });
  const worker = {
    closed: false,
    request: async <T>(method: string) => {
      assert.equal(method, "asset.reclaim");
      started();
      return await result as T;
    },
    async close(): Promise<void> { this.closed = true; },
  } satisfies WorkerTransport & { closed: boolean; close(): Promise<void> };
  const validator = new TrackingValidator();
  const assets = await AssetRuntime.open({ root, worker, validator, reclaimIntervalMs: 10, reclaimRetryMs: 10 });
  const owner = createOwnerServer({ root, worker, assets, dev: false });
  await new Promise<void>(done => owner.server.listen(0, "127.0.0.1", done));
  await requested;

  await owner.close();
  const closing = (async () => {
    await assets.close();
    await worker.close();
  })();
  await new Promise(resolveTurn => setImmediate(resolveTurn));
  rejectReclaim(new OwnerError("S3_WORKER_IO", "Injected reclaim transport failure."));
  await closing;

  assert.equal(validator.closed, true, "asset cleanup continues after the rejected durable-ledger turn");
  assert.equal(worker.closed, true, "the following owner cleanup step is not skipped");
});

async function syncDirectoryForTest(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); }
  finally { await handle.close(); }
}

async function fileExists(path: string): Promise<boolean> {
  try { await readFile(path); return true; }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") return false;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") return false;
    throw error;
  }
}

async function ongoingChunkedRefusal(base: string, path: string, headers: Record<string, string>): Promise<string> {
  const target = new URL(base);
  return new Promise<string>((resolveRequest, rejectRequest) => {
    const socket = createConnection(Number(target.port), target.hostname);
    let response = "";
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectRequest(new Error("Rejected chunked upload kept accepting ingress."));
    }, 2_000);
    const finish = () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
      if (response) resolveRequest(response);
      else rejectRequest(new Error("Rejected chunked upload closed without its refusal response."));
    };
    socket.once("connect", () => {
      const lines = [
        `POST ${path} HTTP/1.1`, `Host: ${target.host}`,
        "Transfer-Encoding: chunked", "Connection: keep-alive",
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`), "", "",
      ];
      socket.write(lines.join("\r\n"));
      interval = setInterval(() => { if (!socket.destroyed) socket.write("4\r\nmore\r\n"); }, 5);
    });
    socket.on("data", chunk => { response += chunk.toString("utf8"); });
    socket.once("error", error => { if (!response) rejectRequest(error); });
    socket.once("close", finish);
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate() && Date.now() < deadline) await new Promise(done => setTimeout(done, 5));
  assert(predicate(), "Timed out waiting for media state.");
}
