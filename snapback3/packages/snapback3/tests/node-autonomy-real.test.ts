import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { startProject } from "../src/node/project.js";
import { readOperatorCredential } from "../src/node/operator.js";
import { findWorker, OwnerError } from "../src/node/worker.js";

let built = true;
try {
  const worker = findWorker();
  built = process.env.SNAPBACK3_WORKER !== undefined
    || (await stat(worker)).mtimeMs >= (await stat(resolve("crates/snapback3-worker/src/capabilities.rs"))).mtimeMs;
} catch { built = false; }

const schema = `use identity

table items:
  value: int
  expiresAt: time ?
  public
  insert <- allow
  update <- allow
  delete <- allow

table profiles:
  score: int
  public
  insert <- allow
  update <- allow
  delete <- deny

table digestClocks:
  nextAt: time ?
  cutoff: time
  runs: int
  read <- allow
  insert <- deny
  update <- deny
  delete <- deny

table digestReceipts:
  profile: profiles
  cutoff: time
  score: int
  unique byProfileCutoff: profile, cutoff
  public
  insert <- deny
  update <- deny
  delete <- deny

table foreground:
  value: int
  public
  insert <- allow
  update <- deny
  delete <- deny
`;

const operations = `mutation putItem(id: id, value: int, expiresAt: time ?):
  insert items { id, value, expiresAt }
  return null

query item(id: items):
  return items[id]

query profile(id: profiles):
  return profiles[id]

query digest(profile: profiles, cutoff: time):
  return digestReceipts[profile, cutoff]

query digestClock(id: digestClocks):
  return digestClocks[id]

mutation foregroundWrite(id: id, value: int):
  insert foreground { id, value }
  return null

mutation purgeItem(id: items):
  delete items[id]
  return null

schedule expireItem on items at .expiresAt: purgeItem(.id)

mutation armDigest(id: id, at: time, cutoff: time):
  insert digestClocks { id, nextAt: at, cutoff, runs: 0 }
  return null

mutation rearmDigest(id: digestClocks, at: time):
  update digestClocks[id] { nextAt: at }
  return null

job digestSweep(cutoff: time):
  chunk p in profiles first 100 by byId:
    prior = digestReceipts[p.id, cutoff]
    if prior = null:
      insert digestReceipts { profile: p.id, cutoff, score: p.score }
  chunk clock in digestClocks first 1 by byId:
    update digestClocks[clock.id] { runs: clock.runs + 1 }

schedule digest on digestClocks at .nextAt: digestSweep(.cutoff)

job incrementSlow():
  chunk p in profiles first 1 by byId:
    update profiles[p.id] { score: p.score + 1 }
`;

async function eventually<T>(read: () => Promise<T | undefined>, label: string, timeout = 15_000): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) assert.fail(`Timed out: ${label}`);
    await new Promise(done => setTimeout(done, 20));
  }
}

test("real worker and HTTP autonomously recover timers, jobs, replies, and foreground fairness", { skip: !built, timeout: 30_000 }, async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-autonomy-real-"));
  const authored = join(root, "snapback");
  await mkdir(authored);
  await writeFile(join(authored, "schema.q"), schema);
  await writeFile(join(authored, "autonomy.q"), operations);
  const profileCount = 3_000;
  await writeFile(join(authored, "seed.ts"), `export default ${JSON.stringify({
    personas: ["alice"],
    rows: { profiles: Array.from({ length: profileCount }, (_, index) => ({ id: `profile-${String(index).padStart(4, "0")}`, score: 0 })) },
  })};`);
  const logs: string[] = [];
  let app = await startProject({ root, dev: true, port: 0, log: line => logs.push(line) });
  context.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });

  const api = async (path: string, body?: unknown, token?: string) => {
    const response = await fetch(app.url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() as any };
  };
  let operatorToken = await readOperatorCredential(root);
  const operator = (path: string, body?: unknown, token = operatorToken) => api(path, body, token);
  const alice = (await api("/api/auth/persona", { name: "alice" })).value.token as string;
  const manifest = (await api("/api/manifest")).value;
  const mutate = (op: string, args: Record<string, unknown>, intent: string) => api("/api/mutation", {
    op, args, intent, planHash: manifest.programs[op].planHash, schemaHash: manifest.schemaHash,
  }, alice);
  const query = (op: string, args: Record<string, unknown>) => api("/api/query", { op, args }, alice);
  const row = (envelope: any) => envelope.rows?.[0]?.row ?? null;

  // A user session is never an operator credential, and no private method path exists.
  assert.equal((await operator("/control/jobs/plan", { op: "autonomy.incrementSlow", args: {} }, alice)).status, 401);
  assert.equal((await operator("/control/background.turn", {})).status, 404);

  // The owner has no live resource connection. Its timer still expires the row.
  const expiresAt = Date.now() + 100;
  assert.equal((await mutate("autonomy.putItem", { id: "expiring", value: 1, expiresAt }, "put-expiring")).status, 200);
  await new Promise(done => setTimeout(done, 250));
  await eventually(async () => (await query("autonomy.item", { id: "expiring" })).value.data === null ? true : undefined,
    "expiry with every client closed");

  // Hide the first operator reply after the worker commits it. The owner must
  // neither replay it nor lose the autonomous timer/job it armed.
  const originalExecute = app.operator.execute.bind(app.operator);
  let lose = "operator.run";
  app.operator.execute = async (command, body) => {
    const result = await originalExecute(command, body);
    if (command.kind === lose) { lose = ""; throw new OwnerError("S3_WORKER_IO", "simulated lost operator reply"); }
    return result;
  };
  const cutoff = Date.now(), digestAt = Date.now() + 100;
  assert.equal((await operator("/control/operator/run", { op: "autonomy.armDigest", args: { id: "daily", at: digestAt, cutoff } })).status, 503);
  await eventually(async () => {
    const status = await query("autonomy.digestClock", { id: "daily" });
    return row(status.value)?.runs === 1 ? true : undefined;
  }, "autonomous digest job after a lost operator reply");
  assert.equal(row((await query("autonomy.digest", { profile: "profile-0000", cutoff })).value).score, 0);

  // A second occurrence for the same logical cutoff runs safely without a
  // duplicate receipt. This is application idempotence, not provider exactly-once.
  assert.equal((await operator("/control/operator/run", { op: "autonomy.rearmDigest", args: { id: "daily", at: Date.now() + 50 } })).status, 200);
  await eventually(async () => row((await query("autonomy.digestClock", { id: "daily" })).value)?.runs === 2 ? true : undefined,
    "idempotent digest replay completion");
  assert.equal(row((await query("autonomy.digest", { profile: "profile-2999", cutoff })).value).score, 0);

  // Lose the enqueue reply after the durable ID is logged. The authenticated
  // log is the recovery path; the owner never submits another enqueue.
  lose = "job.enqueue";
  assert.equal((await operator("/control/jobs/enqueue", { op: "autonomy.incrementSlow", args: {} })).status, 503);
  const jobId = await eventually(async () => {
    const events = (await operator("/control/operator/logs")).value.events as Array<{ kind: string; id?: string }>;
    return events.findLast(event => event.kind === "job.enqueue")?.id;
  }, "lost enqueue durable ID");

  const foregroundStarted = Date.now();
  const foreground = await mutate("autonomy.foregroundWrite", { id: "foreground-1", value: 7 }, "foreground-progress");
  assert.equal(foreground.value.state, "committed");
  assert(Date.now() - foregroundStarted < 2_000, "foreground request waited behind an unbounded background drain");
  const during = (await operator(`/control/jobs/${jobId}`)).value.job;
  assert.notEqual(during.state, "done", "the background job should still be yielding between its 3,000 chunks");

  // Kill only the worker child. The next child runs recovery/presence init,
  // returns the running chunk to its durable cursor, and the job completes.
  const pid = (await app.worker.request<{ pid: number }>("health")).pid;
  process.kill(pid, "SIGKILL");
  await eventually(async () => {
    const response = await operator(`/control/jobs/${jobId}`);
    return response.status === 200 && response.value.job.state === "done" ? response.value : undefined;
  }, "job completion after worker restart");
  assert.equal(row((await query("autonomy.profile", { id: "profile-2999" })).value).score, 1);

  // A queued job also survives complete Node-owner shutdown/reopen.
  const queued = (await operator("/control/jobs/enqueue", { op: "autonomy.incrementSlow", args: {} })).value.id as string;
  await app.close();
  app = await startProject({ root, dev: true, port: 0, log: line => logs.push(line) });
  operatorToken = await readOperatorCredential(root);
  await eventually(async () => {
    const response = await operator(`/control/jobs/${queued}`);
    return response.status === 200 && response.value.job.state === "done" ? response.value : undefined;
  }, "queued job completion after Node owner restart");
  const restoredAlice = (await api("/api/auth/persona", { name: "alice" })).value.token;
  const restored = await api("/api/query", { op: "autonomy.profile", args: { id: "profile-2999" } }, restoredAlice);
  assert.equal(row(restored.value).score, 2);
  assert.equal(logs.filter(line => line.includes(`job.enqueue ${jobId}`)).length, 1, "lost enqueue was never replayed");
});
