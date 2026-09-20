// @ref LLP 3000.007.001#7 — milestone-zero HTTP adoption proxy, before implementing maintained columns.
// Run from snapback4 with Node 24; see README.md for the exact command.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir, loadavg, cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import { createLocalClient } from "../../../snapback4/packages/snapback4/dist/local.js";
import { processDevice } from "../../../snapback4/packages/snapback4/dist/native.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const output = process.env.MC1_OUTPUT ? resolve(process.env.MC1_OUTPUT) : join(here, "evidence");
mkdirSync(output, { recursive: true });
const binary = process.env.SNAPBACK4_BIN ?? join(root, "snapback4/target/debug/snapback4");
const dir = mkdtempSync(join(tmpdir(), "sb4-mc1-activation-"));
mkdirSync(join(dir, "snapback"));
const ceiling = 16 << 20, parents = 100000, sources = 1000000, pageRows = 4000;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
const log = value => { console.log(JSON.stringify(value)); appendFileSync(join(output, "counters.jsonl"), JSON.stringify(value) + "\n"); };
let phase = "setup", server, exited, url, serverSerial = 0;
const devices = [], trace = [];
const record = value => { const row = { ordinal: trace.length, phase, ...value }; trace.push(row); appendFileSync(join(output, "requests.jsonl"), JSON.stringify(row) + "\n"); return row; };
const metadata = { base: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  binary, binary_sha256: sha(readFileSync(binary)), node: process.version, platform: process.platform,
  arch: process.arch, cpus: cpus().length, start_load: loadavg(), started: new Date().toISOString(),
  fixture_dir: dir, parents, sources, pageRows, http_ceiling_bytes: ceiling,
  before_sha256: sha(readFileSync(join(here, "before.q"))), after_sha256: sha(readFileSync(join(here, "after.q"))) };
save("metadata.json", metadata);

async function until(check, message) {
  const deadline = Date.now() + 300000;
  do { if (await check()) return; await delay(25); } while (Date.now() < deadline);
  throw new Error(message);
}
async function stop() {
  if (server && server.exitCode == null && server.signalCode == null) server.kill("SIGTERM");
  if (exited) await exited;
  server = null;
}
async function start(schema, label) {
  await stop();
  writeFileSync(join(dir, "snapback/schema.q"), readFileSync(join(here, schema)));
  const begun = performance.now(), resourceFile = `${++serverSerial}-${label}.resources.json`;
  server = spawn("python3", [join(here, "supervise.py"), join(output, resourceFile), binary, "dev", "--no-watch", "--hold-effects", "--hold-schedules", "--port", url ? new URL(url).port : "0"],
    { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  exited = once(server, "exit");
  let text = "", ready = false;
  for (const stream of [server.stdout, server.stderr]) stream.on("data", data => {
    text += data; appendFileSync(join(output, `${serverSerial}-${label}.log`), data);
    const address = text.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (address) { url = address; ready = true; }
  });
  await until(() => { assert.equal(server.exitCode, null, text); return ready; }, "server startup timed out");
  const result = { label, startup_ms: performance.now() - begun, resource_file: resourceFile };
  log(result); return result;
}
async function request(path, body, who = "probe") {
  const started = performance.now();
  const response = await fetch(url + path, { method: body === undefined ? "GET" : "POST",
    headers: { "x-snapback-persona": "alice", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(300000) });
  const text = await response.text(), page = JSON.parse(text);
  record({ who, path, request: path === "/seed" ? { rows: body.length } : body,
    status: response.status, bytes: Buffer.byteLength(text), sha256: sha(text), elapsed_ms: performance.now() - started,
    generation: page.generation, watermark: page.watermark, more: page.more,
    events: page.events?.length, next: page.next ?? null, denied: page.denied });
  assert.equal(response.status, 200, text.slice(0, 1000));
  return { text, page, bytes: Buffer.byteLength(text) };
}
async function seed(rows) { const { page } = await request("/seed", rows); assert.equal(page.seeded, rows.length, JSON.stringify(page)); }
const parent = i => `p${String(i).padStart(6, "0")}`;
const row = (i, width) => ({ table: "posts", row: { id: parent(i), body: "x".repeat(width), at: 1767225600000 + i } });
function parkedChanges(signal) {
  let cleanup;
  return new Response(new ReadableStream({ start(controller) {
    const beat = () => controller.enqueue(new Uint8Array([32, 10]));
    const timer = setInterval(beat, 500);
    const abort = () => { cleanup(); controller.error(signal.reason); };
    cleanup = () => { clearInterval(timer); signal.removeEventListener("abort", abort); };
    if (signal.aborted) abort(); else { signal.addEventListener("abort", abort, { once: true }); beat(); }
  }, cancel() { cleanup(); } }));
}
async function openDevice(name) {
  const f = { name, core: null, client: null, polls: 0, dir: join(dir, name) };
  const opener = processDevice({ binary, dir: f.dir, spawn: (command, args) => spawn("python3",
    [join(here, "supervise.py"), join(output, `${name}.resources.json`), command, ...args]) });
  const started = performance.now();
  f.client = await createLocalClient({ url, persona: "alice", device: { open: async (...args) => {
    f.core = await opener.open(...args);
    return { call: async req => {
      if (req.op === "apply") assert.equal(req.page.denied, undefined, "never apply a refusal");
      const reply = await f.core.call(req);
      if (req.op === "adopt") record({ who: name, device_op: "adopt", reply, state: await f.core.call({ op: "state" }) });
      return reply;
    }, close: () => f.core.close() };
  } }, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    // Same controlled heartbeat transport as MC0: explicit sync alone drives
    // adoption. All /schema and /sync bytes are real, unchanged HTTP responses.
    if (path === "/changes") { f.polls++; return parkedChanges(init.signal); }
    const started = performance.now(), response = await fetch(input, init);
    const text = await response.text(), page = JSON.parse(text);
    record({ who: name, path, request: init?.body ? JSON.parse(init.body) : undefined, status: response.status,
      bytes: Buffer.byteLength(text), sha256: sha(text), elapsed_ms: performance.now() - started,
      generation: page.generation, watermark: page.watermark, more: page.more, next: page.next ?? null,
      events: page.events?.length, denied: page.denied });
    if (page.denied) save(`${name}-${trace.length}-refusal.json`, page);
    return new Response(text, { status: response.status, headers: response.headers });
  } });
  devices.push(f);
  assert.equal(f.client.acquired, true);
  await until(() => f.polls > 0, "device change follower did not start");
  f.initial = { name, elapsed_ms: performance.now() - started, state: (await f.core.call({ op: "state" })).ok };
  log({ initial_device: f.initial });
  return f;
}
function inspect(path, mode = "inspect") {
  return JSON.parse(execFileSync("python3", [join(here, "store.py"), mode, path], { encoding: "utf8", timeout: 300000 }));
}

try {
  await start("before.q", "seed");
  phase = "seed";
  const seedStart = performance.now();
  for (let offset = 0; offset < parents; offset += 1000) {
    await seed(Array.from({ length: 1000 }, (_, n) => row(offset + n, 500)));
    if (offset % 20000 === 0) log({ seeded_parents: offset + 1000 });
  }
  for (let offset = 0; offset < sources; offset += 10000) {
    await seed(Array.from({ length: 10000 }, (_, n) => ({ table: "likes", row: {
      id: `l${String(offset + n).padStart(7, "0")}`, postId: parent((offset + n) % parents) } })));
    if (offset % 100000 === 0) log({ seeded_sources: offset + 10000 });
  }
  log({ seeding_ms: performance.now() - seedStart });
  phase = "initial-acquisition";
  const current = await openDevice("current"), lagging = await openDevice("lagging");
  assert.deepEqual(current.initial.state, lagging.initial.state);
  const from = lagging.initial.state.watermark;
  phase = "pre-activation-large-page";
  async function updatePage(width) {
    for (let offset = 0; offset < pageRows; offset += 1000) await seed(Array.from({ length: 1000 }, (_, n) => row(offset + n, width)));
  }
  await updatePage(4000);
  const syncRequest = { from, limit: pageRows, after: null, stream: true, pending: [] };
  const calibration = await request("/sync", syncRequest);
  assert.equal(calibration.page.denied, undefined);
  assert.equal(calibration.page.events.length, pageRows);
  const width = 4000 + Math.floor((ceiling - 30000 - calibration.bytes) / pageRows);
  assert.ok(width <= 5000 && width >= 500, String(width));
  await updatePage(width);
  const before = await request("/sync", syncRequest);
  assert.equal(before.page.denied, undefined);
  assert.equal(before.page.events.length, pageRows);
  assert.ok(before.bytes <= ceiling && before.bytes + pageRows * ',"likeCount":10'.length > ceiling);
  writeFileSync(join(output, "before-large-page.json.gz"), gzipSync(before.text));
  await current.client.sync();
  assert.equal((await lagging.core.call({ op: "state" })).ok.watermark, from);
  const currentBefore = (await current.core.call({ op: "state" })).ok;
  assert.ok(currentBefore.watermark > from);
  save("pre-activation.json", { width, syncRequest, current: currentBefore, lagging: lagging.initial.state,
    response_bytes: before.bytes, ceiling_margin_bytes: ceiling - before.bytes,
    events: before.page.events.length, response_sha256: sha(before.text) });
  log({ pre_activation_page_bytes: before.bytes, width, old_watermark: from, current_watermark: currentBefore.watermark });
  await stop();
  phase = "activation";
  const database = join(dir, ".snapback4/store.sqlite");
  const backfill = inspect(database, "backfill"); save("backfill.json", backfill); log({ backfill });
  const activation = await start("after.q", "activation-only");
  await stop(); // Exact child peak covers activation/startup alone, before any HTTP acquisition.
  const activated = inspect(database); save("activated-store.json", activated);
  assert.equal(activated.after.generation, "2");
  assert.equal(activated.after.log_rows, backfill.before.log_rows, "activation adds no row events");
  assert.equal(activated.after.parents_with_count, parents);
  const activationResources = JSON.parse(readFileSync(join(output, activation.resource_file)));
  log({ activation, activation_resources: activationResources });
  await start("after.q", "adoption-http");
  phase = "post-activation-large-page";
  const after = await request("/sync", syncRequest);
  save("after-large-page-refusal.json", after.page);
  // Keep two real successful halves, allowing the attempted full body to be
  // reconstructed and compared with the formerly deliverable response.
  const halves = [];
  for (let cursor = from, i = 0; i < 2; i++) {
    const half = await request("/sync", { ...syncRequest, from: cursor, limit: 2000 });
    assert.equal(half.page.denied, undefined); assert.equal(half.page.events.length, 2000);
    writeFileSync(join(output, `after-half-${i}.json.gz`), gzipSync(half.text));
    halves.push(half.page); cursor = half.page.watermark;
  }
  const reconstruction = { ...before.page, generation: after.page.generation, events: halves.flatMap(p => p.events) };
  const normalized = { ...reconstruction, generation: before.page.generation, events: reconstruction.events.map(e => {
    const copy = structuredClone(e); delete copy.data.likeCount; return copy;
  }) };
  assert.deepEqual(normalized, before.page, "only the added field and generation changed in the old page");
  const reconstructedBytes = Buffer.byteLength(JSON.stringify(reconstruction));
  save("page-comparison.json", { before_bytes: before.bytes, after_reconstructed_bytes: reconstructedBytes,
    delta_bytes: reconstructedBytes - before.bytes, ceiling_bytes: ceiling, excess_bytes: reconstructedBytes - ceiling,
    actual_refusal_bytes: after.bytes, denial: after.page.denied, event_count: reconstruction.events.length });
  const results = [];
  for (const f of [current, lagging]) {
    phase = `${f.name}-adoption`;
    const began = performance.now(), beginTrace = trace.length;
    await f.client.sync();
    const elapsed = performance.now() - began, state = (await f.core.call({ op: "state" })).ok;
    assert.equal(state.generation, 2); assert.equal(state.watermark, currentBefore.watermark);
    assert.equal(f.client.acquired, true);
    const reads = [];
    for (const n of [0, 3999, 99999]) {
      const answer = await f.client.query({ kind: "query", name: "one" }, { id: parent(n) });
      assert.equal(answer.data?.likeCount, 10, JSON.stringify(answer).slice(0, 300));
      assert.equal(answer.fresh, true);
      const direct = await f.core.call({ op: "query", name: "one", viewer: "alice", args: { id: parent(n) }, now: Date.now() });
      assert.equal(direct.ok.data.likeCount, 10, JSON.stringify(direct).slice(0, 300));
      reads.push({ id: parent(n), value: answer.data.likeCount, fresh: answer.fresh, local_value: direct.ok.data.likeCount });
    }
    const ownTrace = trace.slice(beginTrace).filter(t => t.who === f.name);
    assert.ok(ownTrace.some(t => t.path === "/schema"));
    assert.equal(ownTrace.filter(t => t.path?.startsWith("/q/")).length, 0, "no server query fallback");
    if (f.name === "lagging") {
      assert.equal(ownTrace[0].path, "/sync"); assert.equal(ownTrace[0].denied?.code, "E_BOUND");
      assert.deepEqual(ownTrace.filter(t => t.path).slice(0, 3).map(t => t.path), ["/sync", "/schema", "/sync"]);
      assert.equal(ownTrace.filter(t => t.path === "/sync")[1].request.from, 0);
      assert.equal(ownTrace.filter(t => t.path === "/sync")[1].request.limit, 4000, "adopts before shrinking");
    }
    await f.client.close();
    const file = readdirSync(f.dir).find(name => name.endsWith(".sqlite"));
    const persisted = inspect(join(f.dir, file));
    assert.equal(persisted.after.rows.posts, parents); assert.equal(persisted.after.parents_with_count, parents);
    const result = { name: f.name, elapsed_ms: elapsed, state, reads, persisted,
      sync_requests: ownTrace.filter(t => t.path === "/sync").length,
      oversized_sync_responses: ownTrace.filter(t => t.denied?.code === "E_BOUND").length,
      resource: JSON.parse(readFileSync(join(output, `${f.name}.resources.json`))) };
    results.push(result); log({ device_adoption: result });
  }
  const passed = !after.page.denied && results.every(r => r.oversized_sync_responses === 0);
  const result = { gate5: passed ? "PASS" : "FAIL", device_adopts: true,
    no_response_exceeds_ceiling_because_of_form: !after.page.denied,
    backfill, activation, activation_resources: activationResources, devices: results,
    end_load: loadavg(), host_process_peak_rss_bytes: process.resourceUsage().maxRSS * 1024 };
  save("result.json", result);
  log({ summary: `gate 5: ${result.gate5}; devices adopted ${results.length}/2; no-oversize clause ${passed ? "PASS" : "FAIL"}` });
} catch (error) {
  save("error.json", { message: error.message, stack: error.stack, phase });
  throw error;
} finally {
  await Promise.allSettled(devices.map(f => f.client?.close()));
  await stop();
  // Fixture databases are left in the recorded temp directory for inspection.
}
