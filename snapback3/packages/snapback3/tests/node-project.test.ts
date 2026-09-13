import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkProject, startProject } from "../src/node/project.js";
import { findWorker } from "../src/node/worker.js";

let built = true;
try {
  const worker = findWorker();
  built = process.env.SNAPBACK3_WORKER !== undefined
    || (await stat(worker)).mtimeMs >= (await stat(resolve("crates/snapback3-worker/src/capabilities.rs"))).mtimeMs;
} catch { built = false; }

const schema = `use identity

table notes:
  owner: principal
  body: text <=200
  by byOwner: owner, id
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- deny
`;
const operations = `query list():
  return notes[viewer] first 50 by byOwner

mutation add(body: text <=200):
  note = insert notes { owner: viewer, body }
  return { id: note.id }
`;

async function until(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(done => setTimeout(done, 20));
  }
  assert.fail(`Timed out: ${label}`);
}

test("a refused second owner cannot change the first owner's crash recovery generation", { skip: !built, timeout: 30_000 }, async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-owner-isolation-"));
  const authored = join(root, "snapback");
  await mkdir(authored);
  await writeFile(join(authored, "schema.q"), schema);
  await writeFile(join(authored, "notes.q"), operations);
  const app = await startProject({ root, dev: false, port: 0, log: () => {} });
  context.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  const before = await app.worker.request<{generation:string}>("manifest");
  const health = await app.worker.request<{pid:number}>("health");
  await writeFile(join(authored, "schema.q"), schema.replace("text <=200", "text <=300"));
  await assert.rejects(startProject({ root, dev: false, port: 0, log: () => {} }));
  // Kill only this test's child, then allow WorkerClient's bounded restart.
  process.kill(health.pid, "SIGKILL");
  await until(async () => {
    try {
      const current = await app.worker.request<{generation:string}>("manifest");
      return current.generation === before.generation;
    } catch { return false; }
  }, "the first owner recovers its original accepted generation");
});

test("real owner preserves authorization, durable operation identity, and last good generation", { skip: !built, timeout: 30_000 }, async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-node-project-"));
  const authored = join(root, "snapback");
  await mkdir(authored);
  await writeFile(join(authored, "schema.q"), schema);
  await writeFile(join(authored, "notes.q"), operations);
  await writeFile(join(authored, "seed.ts"), `export default {personas:['alice','bob'],rows:{notes:[{id:'seed-note',owner:'dev:alice',body:'original'}]}};`);
  const logs: string[] = [];
  let app: Awaited<ReturnType<typeof startProject>> | undefined;
  context.after(async () => { await app?.close(); await rm(root, { recursive: true, force: true }); });
  assert.equal((await checkProject(root)).ok, true);
  app = await startProject({ root, dev: true, port: 0, log: line => logs.push(line) });
  const call = async (path: string, body?: unknown, token?: string) => {
    const response = await fetch(app!.url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() as any };
  };
  const alice = (await call("/api/auth/persona", { name: "alice" })).value;
  const bob = (await call("/api/auth/persona", { name: "bob" })).value;
  assert.equal(alice.principal.id, "dev:alice");
  assert.equal((await call("/api/query", { op: "notes.list", args: {} }, bob.token)).value.rows.length, 0);
  assert.equal((await call("/api/query", { op: "notes.list", args: {} }, alice.token)).value.rows.length, 1);
  const subscribe = async (token: string) => {
    const response = await fetch(app!.url + "/api/events", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ queries: [{ key: "notes", op: "notes.list", args: {} }] }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    let buffered = "";
    const next = async () => {
      for (;;) {
        let boundary: number;
        while ((boundary = buffered.indexOf("\n\n")) !== -1) {
          const frame = buffered.slice(0, boundary); buffered = buffered.slice(boundary + 2);
          if (frame.startsWith("event: resources\n")) return JSON.parse(frame.slice("event: resources\ndata: ".length));
        }
        const item = await reader.read();
        assert(!item.done, "Resource stream ended early.");
        buffered += decoder.decode(item.value, { stream: true });
      }
    };
    context.after(() => reader.cancel());
    return { next, close: () => reader.cancel() };
  };
  const aliceLive = await subscribe(alice.token), bobLive = await subscribe(bob.token);
  assert.equal((await aliceLive.next()).resources[0].envelope.rows.length, 1);
  assert.equal((await bobLive.next()).resources[0].envelope.rows.length, 0);
  const manifest = (await call("/api/manifest")).value;
  const request = { op: "notes.add", args: { body: "durable" }, intent: "lost-response", planHash: manifest.programs["notes.add"].planHash, schemaHash: manifest.schemaHash };
  const committed = await call("/api/mutation", request, alice.token);
  assert.equal(committed.status, 200);
  assert.equal(committed.value.state, "committed");
  const aliceFrame = await aliceLive.next(), bobFrame = await bobLive.next();
  assert.equal(aliceFrame.seq, committed.value.seq);
  assert.equal(aliceFrame.resources[0].envelope.rows.length, 2);
  assert.equal(bobFrame.resources[0].envelope.rows.length, 0);
  assert.equal("trace" in aliceFrame.resources[0].envelope, false);
  assert(!JSON.stringify(bobFrame).includes("durable"));
  await aliceLive.close(); await bobLive.close();
  assert.deepEqual((await call("/api/mutation", request, alice.token)).value, committed.value);
  assert.equal((await call("/api/query", { op: "notes.list", args: {} }, alice.token)).value.rows.length, 2);
  assert.equal((await call("/api/operation/lost-response", undefined, bob.token)).value, null);

  await writeFile(join(authored, "notes.q"), "query broken(:\n");
  await until(() => logs.some(line => line.includes("previous generation")), "compile refusal keeps current generation");
  assert.equal((await call("/api/query", { op: "notes.list", args: {} }, alice.token)).value.rows.length, 2);
  await writeFile(join(authored, "notes.q"), operations);
  await writeFile(join(authored, "schema.q"), schema.replace("  body: text <=200", "  body: text <=200\n  editedAt: time ?"));
  await until(async () => (await call("/api/manifest")).value.schemaHash !== manifest.schemaHash, "additive successor installs");
  assert.equal((await call("/api/query", { op: "notes.list", args: {} }, alice.token)).value.rows.length, 2);
  // Identical terminal recovery precedes current schema admission.
  assert.deepEqual((await call("/api/mutation", request, alice.token)).value, committed.value);
  await app.close();
  app = await startProject({ root, dev: true, port: 0, log: line => logs.push(line) });
  const restored = (await call("/api/auth/persona", { name: "alice" })).value;
  assert.deepEqual((await call("/api/mutation", request, restored.token)).value, committed.value);
  assert.equal((await call("/api/query", { op: "notes.list", args: {} }, restored.token)).value.rows.length, 2);
  await call("/api/auth/logout", {}, restored.token);
  assert.equal((await call("/api/query", { op: "notes.list", args: {} }, restored.token)).status, 401);
});
