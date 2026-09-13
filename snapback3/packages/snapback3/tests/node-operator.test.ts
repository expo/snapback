import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createOwnerServer } from "../src/node/http.js";
import { OperatorSurface, readOperatorCredential } from "../src/node/operator.js";
import { OwnerError, type WorkerTransport } from "../src/node/worker.js";

class FakeWorker implements WorkerTransport {
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  seq = 10;
  loseEnqueue = false;
  recoveredJobs: Array<Record<string, unknown>> = [];
  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    if (method === "health") return { ok: true, seq: this.seq } as T;
    if (method === "operator.run") return { state: "committed", seq: ++this.seq } as T;
    if (method === "job.enqueue") {
      this.seq++;
      const row = { id: "job_123", name: params.op, state: "queued", createdAt: 1, updatedAt: 1, finishedAt: null };
      this.recoveredJobs = [row];
      if (this.loseEnqueue) throw new OwnerError("S3_WORKER_IO", "reply lost after commit");
      return row as T;
    }
    if (method === "job.recover") return { jobs: this.recoveredJobs, next: null, limit: params.limit ?? 32 } as T;
    if (method === "job.plan") return { chunks: 4 } as T;
    if (method === "job.status") return { job: { id: params.id, state: "running" }, summary: {} } as T;
    if (["job.resume", "job.cancel"].includes(method)) { this.seq++; return { id: params.id, state: method.endsWith("cancel") ? "cancelled" : "queued" } as T; }
    if (method === "effect.requeue") { this.seq++; return { requeued: true } as T; }
    if (method === "effect.list") return { items: [], next: null } as T;
    return { ok: true } as T;
  }
}

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "snapback3-operator-"));
  const worker = new FakeWorker(), commits: unknown[] = [];
  let pokes = 0;
  const operator = await OperatorSurface.open({ root, worker, onCommit: details => commits.push(details), poke: () => { pokes++; } });
  const owner = createOwnerServer({ root, worker, operator, dev: true });
  await new Promise<void>(done => owner.server.listen(0, "127.0.0.1", done));
  const address = owner.server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`, token = await readOperatorCredential(root);
  context.after(async () => { await owner.close(); await rm(root, { recursive: true, force: true }); });
  const request = (path: string, body: unknown | undefined, credential = token) => fetch(url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), Authorization: `Bearer ${credential}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { root, worker, operator, commits, get pokes() { return pokes; }, request, token };
}

test("operator credential is stable, private, and independent from user sessions", async context => {
  const { root, token } = await fixture(context);
  assert.match(token, /^s3op_/);
  assert.equal((await stat(join(root, ".snapback3", "operator.json"))).mode & 0o777, 0o600);
  assert.equal(await readOperatorCredential(root), token);
  assert.notEqual(token, "valid-user-session");
});

test("operator authentication precedes exact route dispatch and body parsing", async context => {
  const state = await fixture(context);
  assert.equal((await state.request("/control/operator/run", { op: "admin.arm", args: {} }, "valid-user-session")).status, 401);
  assert.equal(state.worker.calls.length, 0);
  assert.equal((await state.request("/control/private-worker", {}, state.token)).status, 404);
  assert.equal(state.worker.calls.length, 0);
  const response = await state.request("/control/operator/run", { op: "admin.arm", args: {} });
  assert.equal(response.status, 200);
  assert.equal(state.worker.calls[0].method, "operator.run");
  assert.deepEqual(Object.keys(state.worker.calls[0].params).sort(), ["args", "by", "op"]);
  assert.match(String(state.worker.calls[0].params.by), /^operator_[0-9a-f]{24}$/);
  assert(!JSON.stringify(state.worker.calls).includes(state.token));
});

test("job and effect routes are enumerated, observed, and wake autonomous work", async context => {
  const state = await fixture(context);
  assert.equal((await state.request("/control/jobs/plan", { op: "admin.fill", args: {} })).status, 200);
  assert.equal((await state.request("/control/jobs/enqueue", { op: "admin.fill", args: {} })).status, 200);
  assert.equal((await state.request("/control/jobs/recover", { limit: 16 })).status, 200);
  assert.equal((await state.request("/control/jobs/job_123", undefined)).status, 200);
  assert.equal((await state.request("/control/jobs/job_123/resume", {})).status, 200);
  assert.equal((await state.request("/control/jobs/job_123/cancel", {})).status, 200);
  assert.equal((await state.request("/control/effects/outbox-1/requeue", {})).status, 200);
  assert.equal((await state.request("/control/effects/list", { state: "sent_unknown", limit: 32 })).status, 200);
  assert.equal(state.pokes, 4);
  assert(state.commits.length >= 4);
  assert.deepEqual(state.worker.calls.filter(call => call.method.startsWith("job.")).map(call => call.method),
    ["job.plan", "job.enqueue", "job.recover", "job.status", "job.resume", "job.cancel"]);
});

test("a job committed before Node receives its ID is recovered durably without a second enqueue", async context => {
  const state = await fixture(context);
  state.worker.loseEnqueue = true;
  const lost = await state.request("/control/jobs/enqueue", { op: "admin.fill", args: {} });
  assert.equal(lost.status, 503);
  assert.equal(state.operator.inspect().some(event => event.kind === "job.enqueue"), false);
  const recovered = await state.request("/control/jobs/recover", { limit: 32 });
  assert.equal(recovered.status, 200);
  assert.deepEqual((await recovered.json() as any).jobs, [{
    id: "job_123", name: "admin.fill", state: "queued", createdAt: 1, updatedAt: 1, finishedAt: null,
  }]);
  assert.equal(state.worker.calls.filter(call => call.method === "job.enqueue").length, 1);
});

test("effect inspection redacts credentials and remains operator-authenticated", async context => {
  const state = await fixture(context);
  state.operator.recordEffect({ id: "outbox-1", effect: "push.send", state: "sent", attempt: 1,
    capture: { title: "hello", authorization: "Bearer secret", message: "used Bearer stray-token", nested: { refreshToken: "private" } } });
  assert.equal((await state.request("/control/effects/logs", undefined, "valid-user-session")).status, 401);
  const response = await state.request("/control/effects/logs", undefined);
  const body = await response.json() as any;
  assert.equal(body.events[0].capture.title, "hello");
  assert.equal(body.events[0].capture.authorization, "[redacted]");
  assert.equal(body.events[0].capture.message, "used Bearer [redacted]");
  assert.equal(body.events[0].capture.nested.refreshToken, "[redacted]");
  assert(!JSON.stringify(body).includes("Bearer secret"));
});
