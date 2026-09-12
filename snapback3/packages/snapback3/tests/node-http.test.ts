import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createOwnerServer, type HttpOptions } from "../src/node/http.js";
import { OwnerError, type WorkerTransport } from "../src/node/worker.js";
import { PasswordAttempts } from "../src/node/auth-limit.js";

class FakeWorker implements WorkerTransport {
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  revoked = false;
  rejectPassword = false;
  seq = 3;
  readHandler?: (params: Record<string, unknown>) => Promise<unknown>;
  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    if (method === "auth" && params.action === "login" && this.rejectPassword) throw new OwnerError("S3_AUTH", "Invalid credentials.");
    if (["query", "read", "mutation", "status", "authenticate"].includes(method) && (!["valid", "valid-bob"].includes(params.token as string) || this.revoked)) {
      throw new OwnerError("S3_AUTH", "Sign in again.");
    }
    if (method === "mutation") this.seq++;
    if (method === "read") {
      if (this.readHandler) return await this.readHandler(params) as T;
      return {
        seq: this.seq, generation: "g",
        resources: (params.queries as Array<{ key: string }>).map(query => ({
          key: query.key, envelope: { state: "complete", data: { owner: params.token === "valid" ? "alice" : "bob" }, seq: this.seq },
        })),
      } as T;
    }
    const values: Record<string, unknown> = {
      manifest: { generation: "g", schemaHash: "s", programs: {} }, health: { ok: true },
      authenticate: { principal: { id: "dev:alice" }, authEpoch: 1 },
      query: { state: "complete", data: ["readable"], seq: 3 },
      read: { seq: 3, generation: "g", resources: [] },
      mutation: { state: "committed", seq: 4, intent: params.intent, data: "private-result" },
      status: null, auth: { token: "valid", principal: { id: "dev:alice" }, authEpoch: 1, expiresAt: 1000 },
    };
    return values[method] as T;
  }
}

async function fixture(context: TestContext, dev = true, settings: Pick<HttpOptions, "heartbeatMs" | "maxStreams"> = {}) {
  const root = await mkdtemp(join(tmpdir(), "snapback3-node-http-"));
  const worker = new FakeWorker();
  const owner = createOwnerServer({ worker, root, dev, heartbeatMs: 20, ...settings });
  await new Promise<void>(done => owner.server.listen(0, "127.0.0.1", done));
  const address = owner.server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  context.after(async () => { await owner.close(); await rm(root, { recursive: true, force: true }); });
  const post = (path: string, body: unknown, token = "valid", headers: Record<string, string> = {}) => fetch(url + path, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body),
  });
  return { root, worker, owner, url, post };
}

function eventReader(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next(event: string): Promise<any> {
      for (;;) {
        let end: number;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (frame.split("\n").includes(`event: ${event}`)) {
            return JSON.parse(frame.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n"));
          }
        }
        const next = await reader.read();
        if (next.done) throw new Error(`Stream ended before ${event}.`);
        buffer += decoder.decode(next.value, { stream: true });
      }
    },
    close: () => reader.cancel(),
  };
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1_000;
  while (!predicate() && Date.now() < deadline) await new Promise(done => setTimeout(done, 2));
  assert(predicate(), "Expected asynchronous work to complete.");
}

test("HTTP authenticates named routes and never forwards owner methods", async context => {
  const { worker, url, post } = await fixture(context);
  assert.equal((await fetch(url + "/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await post("/api/query", { op: "messages.list", args: {} }, "expired")).status, 401);
  const good = await post("/api/query", { op: "messages.list", args: { c: null } });
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), { state: "complete", data: ["readable"], seq: 3 });
  const count = worker.calls.length;
  assert.equal((await post("/api/project", { project: {} })).status, 404);
  assert.equal((await post("/api/query", { op: "messages.list", args: {}, method: "project" })).status, 400);
  assert.equal((await post("/api/query", { op: "messages.list", args: {}, token: "other-account" })).status, 400);
  assert.equal(worker.calls.length, count);
});

test("mutations require stable identity and both program fences", async context => {
  const { worker, post } = await fixture(context);
  const body = { op: "messages.edit", args: { body: "hello" }, intent: "stable", planHash: "plan", schemaHash: "schema" };
  assert.equal((await post("/api/mutation", { ...body, schemaHash: undefined })).status, 400);
  assert.equal((await post("/api/mutation", { ...body, intent: "forbidden:colon" })).status, 400);
  const response = await post("/api/mutation", body);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).intent, "stable");
  assert.deepEqual(worker.calls.at(-1), { method: "mutation", params: { token: "valid", ...body } });
});

test("password attempts have bounded concurrency and recover after the rolling window", () => {
  let now = 1_000;
  const attempts = new PasswordAttempts(() => now);
  const first = attempts.acquire("peer", "alice@example.test"), second = attempts.acquire("peer", "bob@example.test");
  assert.throws(() => attempts.acquire("peer", "third@example.test"), { code: "S3_AUTH_RATE_LIMIT" });
  first(); first(); second();
  for (let at = 0; at < 7; at++) attempts.acquire("peer", "ALICE@example.test")();
  assert.throws(() => attempts.acquire("different-peer", "alice@example.test"), { code: "S3_AUTH_RATE_LIMIT" });
  now += 60_001;
  attempts.acquire("peer", "alice@example.test")();
});

test("failed passwords consume the rolling budget without queuing more worker work", async context => {
  const { worker, post } = await fixture(context);
  worker.rejectPassword = true;
  for (let at = 0; at < 8; at++) {
    assert.equal((await post("/api/auth/login", { email: "alice@example.test", password: "incorrect" })).status, 401);
  }
  assert.equal((await post("/api/auth/login", { email: "alice@example.test", password: "incorrect" }, "valid", { "X-Forwarded-For": "new-address" })).status, 429);
  assert.equal(worker.calls.length, 8);
});

test("serve refuses personas and development rejects foreign browser origins", async context => {
  const production = await fixture(context, false);
  assert.equal((await production.post("/api/auth/persona", { name: "alice" })).status, 403);
  assert.equal(production.worker.calls.length, 0);
  const development = await fixture(context);
  assert.equal((await development.post("/api/auth/persona", { name: "alice" }, "valid", { Origin: "https://unrelated.example" })).status, 403);
  const response = await development.post("/api/auth/persona", { name: "alice" }, "valid", { Origin: "http://localhost:5173" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
});

test("body and resource limits reject before worker execution", async context => {
  const { worker, post } = await fixture(context);
  assert.equal((await post("/api/query", { op: "q", args: { large: "x".repeat(1024 * 1024) } })).status, 413);
  assert.equal((await post("/api/read", { queries: [{ key: "same", op: "q" }, { key: "same", op: "q" }] })).status, 400);
  assert.equal((await post("/api/read", { queries: Array.from({ length: 65 }, (_, n) => ({ key: String(n), op: "q" })) })).status, 400);
  assert.equal((await post("/api/events", { queries: [{ key: "same", op: "q" }, { key: "same", op: "q" }] })).status, 400);
  assert.equal((await post("/api/events", { queries: [], token: "body-token" })).status, 400);
  assert.equal(worker.calls.length, 0);
});

test("static serving contains traversal and symlinks and supports the built app", async context => {
  const { root, url } = await fixture(context);
  const publicRoot = join(root, "dist", "public");
  await mkdir(publicRoot, { recursive: true });
  await writeFile(join(publicRoot, "index.html"), "<h1>Chat</h1>");
  await writeFile(join(root, "secret.json"), "private");
  await symlink(join(root, "secret.json"), join(publicRoot, "leak.json"));
  assert.equal(await (await fetch(url + "/")).text(), "<h1>Chat</h1>");
  assert.equal((await fetch(url + "/.snapback3/store.sqlite")).status, 404);
  assert.equal((await fetch(url + "/%2e%2e%2fsecret.json")).status, 403);
  assert.equal((await fetch(url + "/leak.json")).status, 403);
  const page = await fetch(url + "/conversation/one", { headers: { Accept: "text/html" } });
  assert.equal(page.status, 200);
  assert.equal(await page.text(), "<h1>Chat</h1>");
});

test("SSE invalidates without private data and closes on session revocation", async context => {
  const { worker, url, post } = await fixture(context);
  const response = await fetch(url + "/api/events", { headers: { Authorization: "Bearer valid" }, signal: AbortSignal.timeout(2_000) });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let events = decoder.decode((await reader.read()).value);
  assert.match(events, /event: ready/);
  await post("/api/mutation", { op: "edit", args: {}, intent: "one", planHash: "p", schemaHash: "s" });
  while (!events.includes("event: invalidate")) events += decoder.decode((await reader.read()).value);
  assert.match(events, /"seq":4/);
  assert(!events.includes("private-result"));
  worker.revoked = true;
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    events += decoder.decode(item.value);
  }
  assert.match(events, /event: auth/);
  assert.match(events, /"code":"S3_AUTH"/);
});

test("resource streams renew each principal's projected resources without mutation data", async context => {
  const { worker, url, post } = await fixture(context);
  const subscribe = (token: string) => fetch(url + "/api/events", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ queries: [{ key: "page:one", op: "messages.page", args: { conversationId: "studio" } }] }),
    signal: AbortSignal.timeout(2_000),
  });
  const alice = eventReader(await subscribe("valid")), bob = eventReader(await subscribe("valid-bob"));
  context.after(async () => { await alice.close(); await bob.close(); });
  const firstAlice = await alice.next("resources"), firstBob = await bob.next("resources");
  assert.equal(firstAlice.resources[0].envelope.data.owner, "alice");
  assert.equal(firstBob.resources[0].envelope.data.owner, "bob");
  await post("/api/mutation", { op: "edit", args: {}, intent: "one", planHash: "p", schemaHash: "s" });
  const nextAlice = await alice.next("resources"), nextBob = await bob.next("resources");
  assert.equal(nextAlice.seq, 4); assert.equal(nextBob.seq, 4);
  assert.equal(nextAlice.resources[0].key, "page:one");
  assert.equal(nextAlice.resources[0].envelope.data.owner, "alice");
  assert.equal(nextBob.resources[0].envelope.data.owner, "bob");
  assert(!JSON.stringify(nextAlice).includes("private-result"));
  const reads = worker.calls.filter(call => call.method === "read");
  assert.equal(reads.length, 4);
  assert.deepEqual(reads[0].params.queries, [{ key: "page:one", op: "messages.page", args: { conversationId: "studio" } }]);
  worker.revoked = true;
  assert.equal((await alice.next("auth")).code, "S3_AUTH");
});

test("resource demand coalesces writes while a read is in flight and enforces connection bounds", async context => {
  const { worker, owner, url, post } = await fixture(context, true, { heartbeatMs: 10_000, maxStreams: 1 });
  let finishFirst!: (value: unknown) => void;
  let calls = 0, active = 0, peak = 0;
  worker.readHandler = async () => {
    calls++; active++; peak = Math.max(peak, active);
    const frame = calls === 1
      ? await new Promise(done => { finishFirst = done; })
      : { seq: 9, generation: "new", resources: [] };
    active--; return frame;
  };
  const response = await fetch(url + "/api/events", {
    method: "POST", headers: { Authorization: "Bearer valid", "Content-Type": "application/json" },
    body: JSON.stringify({ queries: [{ key: "one", op: "q" }] }), signal: AbortSignal.timeout(2_000),
  });
  const events = eventReader(response);
  context.after(() => events.close());
  await waitFor(() => calls === 1);
  assert.equal((await post("/api/events", { queries: [] })).status, 429);
  for (let index = 0; index < 20; index++) owner.invalidate({ seq: index });
  await new Promise(done => setTimeout(done, 10));
  assert.equal(calls, 1);
  finishFirst({ seq: 3, generation: "old", resources: [] });
  assert.equal((await events.next("resources")).seq, 3);
  assert.equal((await events.next("resources")).seq, 9);
  assert.equal(calls, 2); assert.equal(peak, 1);
  await events.close();
});
