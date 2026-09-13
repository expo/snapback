import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { promisify } from "node:util";
import { compileProject } from "../src/compiler.js";
import { createOwnerServer } from "../src/node/http.js";
import { OperatorSurface, readOperatorCredential } from "../src/node/operator.js";
import { certifyArtifact, startProject } from "../src/node/project.js";
import { findWorker, WorkerClient } from "../src/node/worker.js";

let built = true;
try {
  const worker = findWorker();
  built = process.env.SNAPBACK3_WORKER !== undefined
    || (await stat(worker)).mtimeMs >= (await stat(resolve("crates/snapback3-worker/src/main.rs"))).mtimeMs;
} catch { built = false; }

const capabilities = ["jobs", "schedules", "clock"];
const executeFile = promisify(execFile);
const schemaA = `use identity

table notes:
  body: text <=200
  public
  insert <- allow
  update <- allow
  delete <- deny
`;

const schemaB = schemaA.replace("  body: text <=200", "  body: text <=200\n  editedAt: time ?");

const timerSchema = `use identity

table items:
  expiresAt: time ?
  public
  insert <- allow
  update <- allow
  delete <- allow
`;

const timerOperations = `mutation put(id: id, expiresAt: time ?):
  insert items { id, expiresAt }
  return null

mutation purge(id: items):
  delete items[id]
  return null

schedule expiry on items at .expiresAt: purge(.id)
`;

const clockOperations = `query current():
  return now

query constant():
  return 7
`;

const seedOperations = `query note(id: notes):
  return notes[id]

mutation revise(id: notes, body: text <=200):
  update notes[id] { body }
  return null
`;

function operations(version: number): string {
  return `query version():
  return ${version}

mutation add(body: text <=200):
  note = insert notes { body }
  return { id: note.id }

job touch():
  chunk note in notes first 1 by byId:
    update notes[note.id] { body: note.body }
`;
}

async function compileArtifact(root: string, label: string, schema: string, source: string) {
  const authored = join(root, "snapback");
  await writeFile(join(authored, "schema.q"), schema);
  await writeFile(join(authored, "notes.q"), source);
  const compiled = await compileProject(root);
  assert.equal(compiled.ok, true, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics));
  if (!compiled.ok) throw new Error("fixture did not compile");
  const project = {
    version: 1,
    ...compiled.project,
    auth: compiled.project.schema.auth ?? { password: false, guests: false },
  };
  const path = join(root, `.snapback3/${label}.json`);
  await writeFile(path, JSON.stringify(project));
  return { path, project };
}

function args(project: string | undefined, database: string, accept = false, adopt = false): string[] {
  return [
    ...(project ? ["--project", project] : []), "--database", database,
    "--runtime-capabilities", capabilities.join(","),
    ...(accept ? ["--accept-project"] : []),
    ...(adopt ? ["--adopt-legacy-project"] : []),
  ];
}

async function eventually<T>(read: () => Promise<T>, label: string): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try { return await read(); }
    catch (error) {
      if (Date.now() >= deadline) throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise(done => setTimeout(done, 20));
    }
  }
}

function resourceEvents(response: Response) {
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  return {
    async next(): Promise<any> {
      for (;;) {
        let boundary: number;
        while ((boundary = buffered.indexOf("\n\n")) !== -1) {
          const frame = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          if (frame.startsWith("event: resources\n")) {
            return JSON.parse(frame.slice("event: resources\ndata: ".length));
          }
        }
        const item = await reader.read();
        if (item.done) throw new Error("resource stream ended before its next frame");
        buffered += decoder.decode(item.value, { stream: true });
      }
    },
    async close(): Promise<void> {
      try { await reader.cancel(); } catch { /* already closed */ }
    },
  };
}

test("compiled owner recovers committed project and job custody across reply loss and restart", { skip: !built, timeout: 30_000 }, async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-owner-recovery-"));
  await mkdir(join(root, "snapback"));
  await mkdir(join(root, ".snapback3"));
  const executable = findWorker(root);
  const a = await compileArtifact(root, "project-a", schemaA, operations(1));
  const b = await compileArtifact(root, "project-b", schemaB, operations(2));
  const expectedA = await certifyArtifact(executable, a.path, capabilities);
  const expectedB = await certifyArtifact(executable, b.path, capabilities);
  const database = join(root, ".snapback3/store.sqlite");
  const published: string[] = [];
  let http: ReturnType<typeof createOwnerServer> | undefined;
  let worker = new WorkerClient({
    command: executable,
    args: args(a.path, database, true),
    restartArgs: args(undefined, database),
    restarts: 4,
    env: { ...process.env, SNAPBACK3_TEST_EXIT_AFTER_COMMIT: "project" },
    initialize: async fresh => {
      const manifest = await fresh.request<{ generation: string }>("manifest", {});
      published.push(manifest.generation);
    },
  });
  context.after(async () => { await http?.close(); await worker.close(); await rm(root, { recursive: true, force: true }); });

  assert.equal((await worker.request<{ generation: string }>("manifest")).generation, expectedA.generation);
  const artifactA = await readFile(a.path, "utf8");
  await assert.rejects(worker.request("project", { project: b.project }), { code: "S3_WORKER_EXIT" });
  const recovered = await eventually(
    () => worker.request<{ generation: string; programs: Record<string, { ir: unknown }> }>("manifest"),
    "replacement child did not recover committed B",
  );
  assert.equal(recovered.generation, expectedB.generation);
  assert.equal(published.at(-1), expectedB.generation, "fresh-child barrier did not publish recovered B");
  assert.equal(await readFile(a.path, "utf8"), artifactA, "lost Node artifact write unexpectedly replaced A");

  await assert.rejects(worker.request("project", { project: a.project }), { code: "S3_SUCCESSOR" });
  assert.equal((await worker.request<{ generation: string }>("manifest")).generation, expectedB.generation,
    "rejected reverse successor rolled back or resurrected A");

  const recoverAfterArtifactDamage = async (source: string | undefined, label: string) => {
    if (source === undefined) await rm(a.path);
    else await writeFile(a.path, source);
    const pid = (await worker.request<{ pid: number }>("health")).pid;
    process.kill(pid, "SIGKILL");
    const manifest = await eventually(
      () => worker.request<{ generation: string }>("manifest"),
      `replacement child did not ignore the ${label} source artifact`,
    );
    assert.equal(manifest.generation, expectedB.generation);
  };
  await recoverAfterArtifactDamage(undefined, "missing");
  await recoverAfterArtifactDamage("{", "invalid JSON");
  await recoverAfterArtifactDamage(JSON.stringify({
    ...a.project,
    programs: [...a.project.programs, a.project.programs[0]],
  }), "uncertifiable");
  await worker.close();

  worker = new WorkerClient({ command: executable, args: args(a.path, database), restarts: 0 });
  assert.equal((await worker.request<{ generation: string }>("manifest")).generation, expectedB.generation,
    "main read or certified an unused recovery candidate");
  await worker.close();
  await writeFile(a.path, "{");
  worker = new WorkerClient({ command: executable, args: args(a.path, database), restarts: 0 });
  assert.equal((await worker.request<{ generation: string }>("manifest")).generation, expectedB.generation,
    "main parsed an unused recovery candidate");
  await worker.close();

  worker = new WorkerClient({ command: executable, args: args(undefined, database), restarts: 0 });
  assert.equal((await worker.request<{ generation: string }>("manifest")).generation, expectedB.generation,
    "whole recovery-only owner reopen did not recover B from SQLite custody");
  await worker.close();

  worker = new WorkerClient({
    command: executable,
    args: args(b.path, database, true),
    restartArgs: args(undefined, database),
    env: { ...process.env, SNAPBACK3_TEST_EXIT_AFTER_COMMIT: "job.enqueue" },
  });
  const operator = await OperatorSurface.open({ root, worker, onCommit: () => {}, poke: () => {} });
  http = createOwnerServer({ root, worker, operator, dev: true });
  await new Promise<void>(done => http.server.listen(0, "127.0.0.1", done));
  const address = http.server.address();
  assert(address && typeof address !== "string");
  let url = `http://127.0.0.1:${address.port}`;
  const token = await readOperatorCredential(root);
  const request = (path: string, body: unknown) => fetch(url + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  assert.equal((await request("/control/jobs/enqueue", { op: "notes.touch", args: {} })).status, 503);
  assert.equal(operator.inspect().some(event => event.kind === "job.enqueue"), false,
    "Node logged an ID it never received");
  const recoveryResponse = await request("/control/jobs/recover", { limit: 32 });
  assert.equal(recoveryResponse.status, 200);
  const recovery = await recoveryResponse.json() as any;
  assert.equal(recovery.jobs.length, 1);
  assert.equal(recovery.jobs[0].name, "notes.touch");
  assert.deepEqual(Object.keys(recovery.jobs[0]).sort(), ["createdAt", "finishedAt", "id", "name", "state", "updatedAt"]);
  const jobId = recovery.jobs[0].id as string;
  const cli = await executeFile(process.execPath, [
    resolve("packages/snapback3/dist/cli.mjs"), "job", "recover", JSON.stringify({ limit: 32 }),
    "--as", "system", "--project", root, "--url", url,
  ], { cwd: resolve("."), timeout: 5_000, maxBuffer: 1024 * 1024 });
  assert.deepEqual(JSON.parse(cli.stdout).jobs.map((job: any) => job.id), [jobId]);
  const status = await fetch(`${url}/control/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(status.status, 200);
  assert.notEqual((await status.json() as any).summary.commitRange.from, null,
    "enqueue audit did not durably link its job ID");
  await http.close();
  await worker.close();

  worker = new WorkerClient({ command: executable, args: args(undefined, database), restarts: 0 });
  const reopenedOperator = await OperatorSurface.open({ root, worker, onCommit: () => {}, poke: () => {} });
  http = createOwnerServer({ root, worker, operator: reopenedOperator, dev: true });
  await new Promise<void>(done => http.server.listen(0, "127.0.0.1", done));
  const reopenedAddress = http.server.address();
  assert(reopenedAddress && typeof reopenedAddress !== "string");
  url = `http://127.0.0.1:${reopenedAddress.port}`;
  const wholeOwnerRecovery = await request("/control/jobs/recover", { limit: 32 });
  assert.equal(wholeOwnerRecovery.status, 200);
  assert.deepEqual((await wholeOwnerRecovery.json() as any).jobs.map((job: any) => job.id), [jobId]);
  await http.close();
  await worker.close();
});

test("lost project commit reply reports uncertainty then the recovered generation", { skip: !built, timeout: 20_000 }, async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-project-reply-log-"));
  const authored = join(root, "snapback");
  await mkdir(authored);
  await writeFile(join(authored, "schema.q"), schemaA);
  await writeFile(join(authored, "notes.q"), operations(1));
  const prior = process.env.SNAPBACK3_TEST_EXIT_AFTER_COMMIT;
  process.env.SNAPBACK3_TEST_EXIT_AFTER_COMMIT = "project";
  const logs: string[] = [];
  let app: Awaited<ReturnType<typeof startProject>> | undefined;
  context.after(async () => { await app?.close(); await rm(root, { recursive: true, force: true }); });
  try {
    app = await startProject({ root, dev: true, port: 0, log: line => logs.push(line) });
    const initial = await app.worker.request<{ generation: string }>("manifest");
    await writeFile(join(authored, "schema.q"), schemaB);
    await writeFile(join(authored, "notes.q"), operations(2));
    const uncertainty = await eventually(async () => {
      const line = logs.find(entry => entry.includes("project update was submitted, but its commit is unconfirmed"));
      if (!line) throw new Error("uncertain update log not present yet");
      return line;
    }, "reload did not report the lost project reply as uncertain");
    assert(!uncertainty.includes("previous generation"));
    const recoveryLog = await eventually(async () => {
      const line = logs.find(entry => entry.includes("S3_WORKER_RECOVERED:"));
      if (!line) throw new Error("recovered generation log not present yet");
      return line;
    }, "fresh child did not report its recovered generation");
    const recovered = await eventually(async () => {
      try {
        const manifest = await app!.worker.request<{ generation: string }>("manifest");
        return manifest.generation !== initial.generation ? manifest : undefined;
      } catch { return undefined; }
    }, "fresh child did not serve committed successor");
    assert(recoveryLog.includes(`generation=${recovered.generation}`));
  } finally {
    if (prior === undefined) delete process.env.SNAPBACK3_TEST_EXIT_AFTER_COMMIT;
    else process.env.SNAPBACK3_TEST_EXIT_AFTER_COMMIT = prior;
  }
});

test("post-commit job record failure preserves identity and CLI recovery guidance", { skip: !built, timeout: 20_000 }, async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-job-response-fault-"));
  await mkdir(join(root, "snapback"));
  await mkdir(join(root, ".snapback3"));
  const executable = findWorker(root);
  const project = await compileArtifact(root, "project", schemaA, operations(1));
  const database = join(root, ".snapback3/store.sqlite");
  let worker = new WorkerClient({ command: executable, args: args(project.path, database, true), restarts: 0 });
  let http: ReturnType<typeof createOwnerServer> | undefined;
  context.after(async () => { await http?.close(); await worker.close(); await rm(root, { recursive: true, force: true }); });
  await worker.request("health");
  await worker.close();

  const sqlite = new DatabaseSync(database);
  sqlite.exec(`CREATE TRIGGER corrupt_enqueued_job_args AFTER INSERT ON _jobs
    BEGIN UPDATE _jobs SET args='opaque-not-json' WHERE id=NEW.id; END;`);
  sqlite.close();

  worker = new WorkerClient({ command: executable, args: args(undefined, database), restarts: 0 });
  const operator = await OperatorSurface.open({ root, worker, onCommit: () => {}, poke: () => {} });
  http = createOwnerServer({ root, worker, operator, dev: true });
  await new Promise<void>(done => http!.server.listen(0, "127.0.0.1", done));
  const address = http.server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const cli = resolve("packages/snapback3/dist/cli.mjs");
  let stderr = "";
  try {
    await executeFile(process.execPath, [
      cli, "job", "enqueue", "notes.touch", "{}", "--as", "system", "--project", root, "--url", url,
    ], { cwd: resolve("."), timeout: 5_000, maxBuffer: 1024 * 1024 });
    assert.fail("post-commit record failure unexpectedly returned success");
  } catch (error) {
    stderr = String((error as { stderr?: string }).stderr ?? "");
  }
  assert.match(stderr, /S3_WORKER_JOB_COMMITTED_RESPONSE/);
  assert.match(stderr, /job_[A-Za-z0-9_-]+ committed/);
  assert.match(stderr, /Do not enqueue it again; run job recover/);

  const token = await readOperatorCredential(root);
  const status = await fetch(`${url}/control/jobs/${stderr.match(/job_[A-Za-z0-9_-]+/)![0]}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(status.status, 400, "the injected full-record read fault must remain real");
  assert.equal((await status.json() as any).error.code, "S3_RUNTIME");

  const recovered = await executeFile(process.execPath, [
    cli, "job", "recover", JSON.stringify({ limit: 32 }),
    "--as", "system", "--project", root, "--url", url,
  ], { cwd: resolve("."), timeout: 5_000, maxBuffer: 1024 * 1024 });
  const jobs = JSON.parse(recovered.stdout).jobs as Array<Record<string, unknown>>;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, stderr.match(/job_[A-Za-z0-9_-]+/)![0]);
  assert.deepEqual(Object.keys(jobs[0]).sort(), ["createdAt", "finishedAt", "id", "name", "state", "updatedAt"]);

  await http.close();
  http = undefined;
  await worker.close();
  const audit = new DatabaseSync(database);
  assert.equal((audit.prepare("SELECT COUNT(*) AS count FROM _jobs").get() as { count: number }).count, 1,
    "CLI guidance must not create a duplicate job");
  assert.equal((audit.prepare("SELECT args FROM _jobs").get() as { args: string }).args, "opaque-not-json");
  audit.close();
});

test("a seq-zero seed obligation survives child replacement and expires after commit", { skip: !built, timeout: 20_000 }, async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-seed-recovery-"));
  await mkdir(join(root, "snapback"));
  await writeFile(join(root, "snapback/schema.q"), schemaA);
  await writeFile(join(root, "snapback/seed.q"), seedOperations);
  await writeFile(join(root, "snapback/seed.ts"), `export default {personas:['alice'],rows:{notes:[{id:'seeded',body:'seed value'}]}};`);
  const marker = join(root, "interrupted-before-seed-commit");
  const prior = process.env.SNAPBACK3_TEST_EXIT_BEFORE_SEED_COMMIT_ONCE;
  process.env.SNAPBACK3_TEST_EXIT_BEFORE_SEED_COMMIT_ONCE = marker;
  const logs: string[] = [];
  let app: Awaited<ReturnType<typeof startProject>> | undefined;
  context.after(async () => { await app?.close(); await rm(root, { recursive: true, force: true }); });
  try {
    app = await startProject({ root, dev: true, port: 0, log: line => logs.push(line) });
  } finally {
    if (prior === undefined) delete process.env.SNAPBACK3_TEST_EXIT_BEFORE_SEED_COMMIT_ONCE;
    else process.env.SNAPBACK3_TEST_EXIT_BEFORE_SEED_COMMIT_ONCE = prior;
  }
  assert.equal((await stat(marker)).isFile(), true, "the first child did not reach the pre-seed interruption");

  const call = async (path: string, body: unknown, token?: string) => {
    const response = await fetch(app!.url + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() as any };
  };
  const alice = (await call("/api/auth/persona", { name: "alice" })).value.token as string;
  const manifest = await (await fetch(app.url + "/api/manifest")).json() as any;
  const readNote = async () => {
    const result = await call("/api/query", { op: "seed.note", args: { id: "seeded" } }, alice);
    assert.equal(result.status, 200);
    return result.value.rows[0]?.row?.body;
  };
  assert.equal(await readNote(), "seed value", "replacement did not complete the required first seed");
  const revised = await call("/api/mutation", {
    op: "seed.revise", args: { id: "seeded", body: "user value" }, intent: "seed-recovery-user-write",
    planHash: manifest.programs["seed.revise"].planHash, schemaHash: manifest.schemaHash,
  }, alice);
  assert.equal(revised.value.state, "committed");
  assert.equal(await readNote(), "user value");

  const build = join(root, ".snapback3/build");
  const seedArtifact = (await readdir(build)).find(name => name.startsWith("seed-"));
  assert(seedArtifact, "owner did not retain its bootstrap seed artifact");
  await rm(join(build, seedArtifact));
  const pid = (await app.worker.request<{ pid: number }>("health")).pid;
  process.kill(pid, "SIGKILL");
  await eventually(async () => {
    try { return await readNote() === "user value" ? true : undefined; }
    catch { return undefined; }
  }, "initialized store did not recover independently of its obsolete seed file");
  assert(logs.some(line => line.includes("S3_WORKER_RECOVERED:")), "replacement did not report recovered custody");
});

test("a missing still-required seq-zero seed fails closed with a concrete diagnostic", { skip: !built, timeout: 15_000 }, async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-seed-required-"));
  await mkdir(join(root, "snapback"));
  await mkdir(join(root, ".snapback3"));
  const executable = findWorker(root);
  const project = await compileArtifact(root, "project", schemaA, seedOperations);
  const database = join(root, ".snapback3/store.sqlite");
  const seedPath = join(root, ".snapback3/required-seed.json");
  const seed = JSON.stringify({ personas: ["alice"], rows: { notes: [{ id: "seeded", body: "seed value" }] } });
  await writeFile(seedPath, seed);
  const marker = join(root, "interrupted-before-seed-commit");
  let worker = new WorkerClient({
    command: executable,
    args: [...args(project.path, database, true), "--seed", seedPath],
    restarts: 0,
    env: { ...process.env, SNAPBACK3_TEST_EXIT_BEFORE_SEED_COMMIT_ONCE: marker },
  });
  context.after(async () => { await worker.close(); await rm(root, { recursive: true, force: true }); });
  await assert.rejects(worker.request("health"), { code: "S3_WORKER_EXIT" });
  await worker.close();
  await rm(seedPath);

  let stderr = "";
  worker = new WorkerClient({
    command: executable,
    args: [...args(undefined, database), "--seed", seedPath],
    restarts: 0,
    onStderr: text => { stderr += text; },
  });
  await assert.rejects(worker.request("health"));
  assert.match(stderr, /S3_SEED_RECOVERY_REQUIRED/);
  await worker.close();

  await writeFile(seedPath, seed);
  worker = new WorkerClient({ command: executable, args: [...args(undefined, database), "--seed", seedPath], restarts: 0 });
  assert((await worker.request<{ seq: number }>("health")).seq > 0, "restored bootstrap input did not complete the seed");
});

test("an empty recovery-only store cannot invent a project", { skip: !built, timeout: 10_000 }, async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-empty-recovery-"));
  await mkdir(join(root, ".snapback3"));
  let stderr = "";
  const worker = new WorkerClient({
    command: findWorker(root),
    args: args(undefined, join(root, ".snapback3/store.sqlite")),
    restarts: 0,
    onStderr: text => { stderr += text; },
  });
  context.after(async () => { await worker.close(); await rm(root, { recursive: true, force: true }); });
  await assert.rejects(worker.request("health"));
  assert.match(stderr, /S3_PROJECT_SOURCE_REQUIRED/);
});

test("legacy project custody needs explicit one-time adoption", { skip: !built, timeout: 20_000 }, async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-owner-legacy-"));
  await mkdir(join(root, "snapback"));
  await mkdir(join(root, ".snapback3"));
  const executable = findWorker(root);
  const a = await compileArtifact(root, "project-a", schemaA, operations(1));
  const b = await compileArtifact(root, "project-b", schemaB, operations(2));
  const database = join(root, ".snapback3/store.sqlite");
  let worker = new WorkerClient({ command: executable, args: args(a.path, database, true), restarts: 0 });
  context.after(async () => { await worker.close(); await rm(root, { recursive: true, force: true }); });
  await worker.request("health");
  await worker.close();

  const sqlite = new DatabaseSync(database);
  sqlite.exec("DELETE FROM _meta WHERE key='project_json'");
  sqlite.close();
  let stderr = "";
  worker = new WorkerClient({
    command: executable, args: args(undefined, database), restarts: 0,
    onStderr: text => { stderr += text; },
  });
  await assert.rejects(worker.request("health"));
  assert.match(stderr, /S3_PROJECT_RECOVERY_REQUIRED/);
  await worker.close();

  worker = new WorkerClient({ command: executable, args: args(a.path, database, true, true), restarts: 0 });
  assert.equal((await worker.request<{ generation: string }>("manifest")).generation,
    (await certifyArtifact(executable, a.path, capabilities)).generation);
  await worker.close();
  worker = new WorkerClient({ command: executable, args: args(undefined, database), restarts: 0 });
  assert.equal((await worker.request<{ generation: string }>("manifest")).generation,
    (await certifyArtifact(executable, a.path, capabilities)).generation);
  await worker.close();

  const tampered = new DatabaseSync(database);
  tampered.prepare("UPDATE _meta SET value=? WHERE key='project_json'").run(JSON.stringify(b.project));
  tampered.close();
  stderr = "";
  worker = new WorkerClient({
    command: executable, args: args(undefined, database), restarts: 0,
    onStderr: text => { stderr += text; },
  });
  await assert.rejects(worker.request("health"));
  assert.match(stderr, /S3_PROJECT_CUSTODY/);
});

test("a real timer SQLite fault makes the Node owner unavailable without spinning", { skip: !built, timeout: 20_000 }, async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-owner-store-fault-"));
  await mkdir(join(root, "snapback"));
  await writeFile(join(root, "snapback/schema.q"), timerSchema);
  await writeFile(join(root, "snapback/timers.q"), timerOperations);
  const logs: string[] = [];
  let app = await startProject({ root, dev: true, port: 0, log: line => logs.push(line) });
  context.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  const call = async (path: string, body: unknown, token?: string) => fetch(app.url + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const token = (await (await call("/api/auth/persona", { name: "alice" })).json() as any).token as string;
  const manifest = await (await fetch(app.url + "/api/manifest")).json() as any;
  const expiresAt = Date.now() + 1_500;
  const inserted = await call("/api/mutation", {
    op: "timers.put", args: { id: "doomed", expiresAt }, intent: "timer-store-fault",
    planHash: manifest.programs["timers.put"].planHash, schemaHash: manifest.schemaHash,
  }, token);
  assert.equal(inserted.status, 200);
  await app.close();

  const database = new DatabaseSync(join(root, ".snapback3/store.sqlite"));
  database.exec("CREATE TRIGGER fail_timer_settlement BEFORE DELETE ON _timers BEGIN SELECT RAISE(ABORT, 'injected timer settlement storage fault'); END;");
  database.close();
  app = await startProject({ root, dev: true, port: 0, log: line => logs.push(line) });
  const events = await fetch(app.url + "/api/events", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(events.status, 200);
  const reader = events.body!.getReader();
  await reader.read();
  await eventually(async () => {
    if (!logs.some(line => line.includes("S3_OWNER_UNAVAILABLE: S3_RUNTIME"))) throw new Error("owner still admitted");
    return true;
  }, "timer store fault did not fail owner");
  assert.equal((await reader.read()).done, true, "terminal owner failure did not close live invalidation streams");
  await assert.rejects(call("/api/mutation", {
    op: "timers.put", args: { id: "late", expiresAt: null }, intent: "must-not-admit",
    planHash: manifest.programs["timers.put"].planHash, schemaHash: manifest.schemaHash,
  }, token));
  const failures = logs.filter(line => line.startsWith("S3_BACKGROUND:"));
  await new Promise(done => setTimeout(done, 50));
  assert.equal(logs.filter(line => line.startsWith("S3_BACKGROUND:")).length, failures.length);
  assert.equal(failures.length, 1, "store fault entered a retry loop");
});

test("a real compiled clock query refreshes through SSE without commits or unrelated query work", { skip: !built, timeout: 20_000 }, async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-owner-clock-"));
  await mkdir(join(root, "snapback"));
  await writeFile(join(root, "snapback/schema.q"), schemaA);
  await writeFile(join(root, "snapback/clock.q"), clockOperations);
  const app = await startProject({ root, dev: true, port: 0, log: () => {} });
  context.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });

  const auth = await fetch(app.url + "/api/auth/persona", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "alice" }),
  });
  assert.equal(auth.status, 200);
  const token = (await auth.json() as any).token as string;
  const manifest = await app.worker.request<any>("manifest");
  assert.deepEqual(manifest.clockQueries, { "clock.current": { granularityMs: 1 } },
    "the compiler must declare its supported clock granularity only for the timed query");

  const subscribe = async (key: string, op: string) => resourceEvents(await fetch(app.url + "/api/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ queries: [{ key, op, args: {} }] }),
    signal: AbortSignal.timeout(10_000),
  }));
  const before = await app.worker.request<{ seq: number }>("health");
  // From here through the final health read the test performs no write. The
  // owner clock and SSE resource reads are the only causes of activity.
  const clock = await subscribe("clock", "clock.current");
  const stable = await subscribe("stable", "clock.constant");
  context.after(async () => { await clock.close(); await stable.close(); });
  const firstClock = await clock.next();
  const firstStable = await stable.next();
  assert.equal(firstStable.resources[0].envelope.data, 7);

  const stablePending = stable.next().then(
    frame => ({ kind: "frame" as const, frame }),
    error => ({ kind: "closed" as const, error }),
  );
  let nextClock: any;
  for (let attempt = 0; attempt < 10; attempt++) {
    nextClock = await clock.next();
    if (nextClock.resources[0].envelope.data !== firstClock.resources[0].envelope.data) break;
  }
  const firstEnvelope = firstClock.resources[0].envelope;
  const nextEnvelope = nextClock.resources[0].envelope;
  assert.equal(firstEnvelope.data, firstEnvelope.readTime);
  assert.equal(nextEnvelope.data, nextEnvelope.readTime);
  assert(nextEnvelope.data > firstEnvelope.data, "real wall-clock passage did not change the timed query result");

  const unrelated = await Promise.race([
    stablePending,
    new Promise<undefined>(done => setTimeout(() => done(undefined), 150)),
  ]);
  assert.equal(unrelated, undefined, "the simultaneously subscribed non-clock query refreshed");
  const after = await app.worker.request<{ seq: number }>("health");
  for (const frame of [firstClock, nextClock, firstStable]) {
    assert.equal(frame.seq, before.seq, "an SSE refresh observed commit-sequence drift");
    assert.equal(frame.resources[0].envelope.seq, before.seq, "a query envelope observed commit-sequence drift");
  }
  assert.equal(after.seq, before.seq, "the clock-only observation committed a write");
  await stable.close();
  assert.equal((await stablePending).kind, "closed");
});
