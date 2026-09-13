import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { WorkerClient } from "../src/node/worker.js";

async function fixture(context: TestContext, overrides: Partial<ConstructorParameters<typeof WorkerClient>[0]> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "snapback3-node-worker-"));
  const source = join(directory, "worker.mjs"), records = join(directory, "calls.jsonl");
  await writeFile(source, `
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
for await (const line of createInterface({input:process.stdin})) {
  const request = JSON.parse(line);
  appendFileSync(${JSON.stringify(records)}, JSON.stringify({...request,pid:process.pid,args:process.argv.slice(2)}) + '\\n');
  const send = result => process.stdout.write(JSON.stringify({id:request.id,result}) + '\\n');
  if (request.method === 'crash') process.exit(23);
  if (request.method === 'wait') continue;
  if (request.method === 'malformed') { process.stdout.write('broken\\n'); continue; }
  if (request.method === 'large') { send('x'.repeat(1024)); continue; }
  if (request.method === 'refuse') { process.stdout.write(JSON.stringify({id:request.id,error:{code:'S3_AUTH',message:'Sign in.'}}) + '\\n'); continue; }
  if (request.method === 'slow') { setTimeout(() => send('done'), 50); continue; }
  send(request.params);
}
`);
  const configured = { ...overrides };
  if (configured.args?.[0] === "$fixture") configured.args = [source, ...configured.args.slice(1)];
  if (configured.restartArgs?.[0] === "$fixture") configured.restartArgs = [source, ...configured.restartArgs.slice(1)];
  const worker = new WorkerClient({ command: process.execPath, args: [source], ...configured });
  context.after(async () => { await worker.close(); await rm(directory, { recursive: true, force: true }); });
  return { worker, records };
}

test("worker correlates concurrent replies and preserves coded refusals", async context => {
  const { worker } = await fixture(context);
  assert.deepEqual(await Promise.all([worker.request("echo", { n: 1 }), worker.request("echo", { n: 2 })]), [{ n: 1 }, { n: 2 }]);
  await assert.rejects(worker.request("refuse"), { code: "S3_AUTH", message: "Sign in." });
  assert.deepEqual(await worker.request("echo", { healthy: true }), { healthy: true });
});

test("worker bounds outstanding requests without dropping admitted work", async context => {
  const { worker } = await fixture(context, { maxPending: 1 });
  const slow = worker.request("slow");
  await assert.rejects(worker.request("echo"), { code: "S3_OWNER_BUSY" });
  assert.equal(await slow, "done");
});

test("a timed-out operation is never replayed when the child restarts", { timeout: 15_000 }, async context => {
  // Give a real child time to start on a loaded development machine. The
  // fixture deliberately never answers wait, so timeout itself is deterministic.
  const { worker, records } = await fixture(context, { timeoutMs: 2_000, restarts: 1 });
  await assert.rejects(worker.request("wait", { intent: "stable-operation" }), { code: "S3_WORKER_TIMEOUT" });
  const deadline = Date.now() + 4_000;
  for (;;) {
    try { assert.deepEqual(await worker.request("echo", { restarted: true }), { restarted: true }); break; }
    catch (error) {
      if ((error as {code?:string}).code !== "S3_WORKER_TIMEOUT" || Date.now() >= deadline) throw error;
      await new Promise(done => setTimeout(done, 20));
    }
  }
  const calls = (await readFile(records, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(calls.map(call => call.method), ["wait", "echo"]);
  assert.equal(calls[0].params.intent, "stable-operation");
  await assert.rejects(worker.request("wait"), { code: "S3_WORKER_TIMEOUT" });
  await assert.rejects(worker.request("echo"), { code: "S3_WORKER_TIMEOUT" });
});

test("malformed and excessive worker output fail boundedly", async context => {
  const { worker } = await fixture(context, { maxFrameBytes: 128 });
  await assert.rejects(worker.request("large"), { code: "S3_WORKER_PROTOCOL" });
  await new Promise(done => setTimeout(done, 40));
  await assert.rejects(worker.request("malformed"), { code: "S3_WORKER_PROTOCOL" });
});

test("each fresh child completes recovery and presence restoration before ordinary work", async context => {
  const replacements: boolean[] = [];
  const { worker, records } = await fixture(context, {
    args: ["$fixture", "initial"],
    restartArgs: ["$fixture", "recovery"],
    restarts: 1,
    initialize: async (fresh, child) => {
      replacements.push(child.replacement);
      await fresh.request("effect.recover", {});
      await fresh.request("presence.replace", { counts: { "dev:alice": 1 } });
    },
  });
  assert.deepEqual(await worker.request("echo", { first: true }), { first: true });
  await assert.rejects(worker.request("crash"), { code: "S3_WORKER_EXIT" });
  assert.deepEqual(await worker.request("echo", { second: true }), { second: true });
  const calls = (await readFile(records, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const groups = new Map<number, typeof calls>();
  for (const call of calls) groups.set(call.pid, [...(groups.get(call.pid) ?? []), call]);
  assert.equal(groups.size, 2);
  for (const child of groups.values()) {
    assert.deepEqual(child.slice(0, 2).map(call => call.method), ["effect.recover", "presence.replace"]);
  }
  assert.deepEqual([...groups.values()].map(child => child[0].args), [["initial"], ["recovery"]]);
  assert.deepEqual(replacements, [false, true]);
  assert.deepEqual(calls.filter(call => call.method === "echo").map(call => call.params), [{ first: true }, { second: true }]);
  assert.equal(calls.filter(call => call.method === "crash").length, 1, "the ambiguous original request was not replayed");
});

test("graceful close drains an active request before closing worker stdin", async context => {
  const { worker } = await fixture(context, { closeDrainMs: 500, closeExitMs: 500 });
  const slow = worker.request("slow");
  const closing = worker.close();
  assert.equal(await slow, "done");
  await closing;
  await assert.rejects(worker.request("echo"), { code: "S3_OWNER_CLOSED" });
});
