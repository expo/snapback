#!/usr/bin/env node
// What the store weighs at scale (after the Snapback 2 Clique 0.0.29 run:
// 5.2 GB, 70% indexes, recipient delivery records). The chat backend
// seeded with many groups of many messages and members; `snapback4 doctor
// --json` weighs the rows, the index entries and the partition log. One
// line to metrics/storage.jsonl.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir, platform, arch, cpus } from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { binary as binaryPath, root, scaleSeed } from "../witness/lib.mjs";

// A separate public-catalog workload uses the same records and result checks
// on each actual backend. This is runtime measurement, not a Clique score.
if (process.argv.includes("--catalog-init")) {
  initCatalog();
  process.exit(0);
}
if (process.argv.includes("--catalog")) {
  await measureCatalog();
  process.exit(0);
}

// --workloads adds HTTP and local replica measurements to the same seed.
// These are within-Snapback measurements, not competitor wins: the transport,
// hardware, durability and dataset must also match in a comparison run.
const workloads = process.argv.includes("--workloads");
const sizes = process.argv.slice(2).filter((s) => s !== "--workloads");
const groups = Number(sizes[0] ?? 40);
const messages = Number(sizes[1] ?? 500);
const members = Number(sizes[2] ?? 10);
assert.ok([groups, messages, members].every((n) => Number.isSafeInteger(n) && n > 0));
assert.ok(members >= 2 && members <= 50 && groups <= 1000);
const binary = binaryPath();
const app = mkdtempSync(join(tmpdir(), "sb4-storage-"));
cpSync(join(root, "apps/chat/snapback"), join(app, "snapback"), { recursive: true });
rmSync(join(app, "snapback/generated"), { recursive: true, force: true });
if (workloads) appendFileSync(join(app, "snapback/schema.q"), `
query point(messageId: messages):
  return messages[messageId]

query feed(c: cursor ?):
  return merge messages after c last 20 by byConvTime:
    [m.conversationId] for m in memberships[viewer] first 1000 by byPrincipalConversation
`);
const server = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: app, stdio: ["ignore", "pipe", "inherit"] });
const exited = new Promise((resolve) => { server.once("exit", resolve); server.once("error", resolve); });
const ready = new Promise((resolve, reject) => {
  let output = "";
  const timer = setTimeout(() => reject(new Error("server did not become ready")), 30_000);
  server.on("error", reject);
  server.stdout.on("data", (data) => {
    output += data;
    const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
    if (match) { clearTimeout(timer); resolve(match[0]); }
  });
  exited.then((code) => { clearTimeout(timer); reject(new Error(`server exited ${code} before readiness`)); });
});
let out;
try {
  const api = await ready;
  const request = async (path, body) => {
    if (path.startsWith("/q/")) body = { args: body };
    const response = await fetch(`${api}${path}`, { headers: { "x-snapback-persona": "bob", "content-type": "application/json" }, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), signal: AbortSignal.timeout(120_000) });
    const value = await response.json();
    assert.ok(response.ok && !value.denied && value.state !== "failed", JSON.stringify(value));
    return value;
  };
  const seed = scaleSeed({ groups, messages, members });
  const t0 = performance.now();
  const seeded = await request("/seed", seed);
  assert.equal(seeded.seeded, seed.length);
  const seedMs = +(performance.now() - t0).toFixed(0);
  const measurements = workloads ? await measureWorkloads(request, seed) : undefined;
  server.kill();
  await exited;
  const doctor = spawnSync(binary, ["doctor", "--json"], { cwd: app, encoding: "utf8" });
  const report = JSON.parse(doctor.stdout.trim().split("\n").pop());
  const s = report.storage;
  assert.equal(doctor.status, 0, doctor.stderr);
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const client = workloads ? Buffer.concat(["store", "sqlite", "interpreter", "replica", "key", "cursor"].map((name) => readFileSync(join(root, `packages/snapback4/dist/replica/${name}.js`)))) : undefined;
  out = { at: new Date().toISOString(), binary, binarySha256: digest(readFileSync(binary)), clientSha256: client && digest(client), workloadSha256: digest(readFileSync(new URL(import.meta.url))), seedSha256: digest(JSON.stringify(seed)), sha: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), dirty: !!spawnSync("git", ["status", "--porcelain", "--untracked-files=no", "--", "snapback4"], { cwd: join(root, ".."), encoding: "utf8" }).stdout.trim(), node: process.version, host: `${platform()}-${arch()} ${cpus()[0].model}`, transport: "loopback HTTP; dev personas; file-backed server SQLite WAL/NORMAL", replicas: workloads ? "MemoryStore; node:sqlite :memory: (not Expo or durable device storage)" : undefined, groups, messages, members, seeded: seeded.seeded, seedMs, rowsBytes: s.rows, rowCount: s.row_count, indexBytes: s.indexes, logBytes: s.log, logEvents: s.log_events, fileBytes: s.file, logPerRows: +(s.log / s.rows).toFixed(2), filePerRows: +(s.file / s.rows).toFixed(2), measurements };
} finally {
  server.kill();
  await exited;
  rmSync(app, { recursive: true, force: true });
}
console.log(JSON.stringify(out));
const path = join(root, "metrics/storage.jsonl");
let existing = "";
try { existing = readFileSync(path, "utf8"); } catch { /* first line */ }
writeFileSync(path, `${existing}${JSON.stringify(out)}\n`);

async function measureWorkloads(request, seed) {
  const results = {};
  const timed = async (name, body, check) => {
    const times = [];
    let value;
    for (let n = 0; n < 23; n++) {
      const start = performance.now();
      value = await body(n);
      const elapsed = performance.now() - start;
      check(value);
      if (n >= 3) times.push(elapsed);
    }
    times.sort((a, b) => a - b);
    results[name] = { samples: times.length, p50Ms: +times[9].toFixed(3), p95Ms: +times[18].toFixed(3), maxMs: +times[19].toFixed(3), ...(value.complete === undefined ? {} : { complete: value.complete }), ...(Array.isArray(value.data) ? { rows: value.data.length } : {}) };
    return value;
  };
  const threadArgs = { conversationId: "c000", c: null };
  const pointArgs = { messageId: `c000-msg${String(messages - 1).padStart(5, "0")}` };
  const checkPoint = (r) => assert.equal(r.data.id, pointArgs.messageId);
  const checkThread = (r) => { assert.equal(r.data.length, Math.min(50, messages)); assert.equal(r.data[0].id, `c000-msg${String(messages - 1).padStart(5, "0")}`); };
  const feedExpected = seed.filter((x) => x.table === "messages").map((x) => x.row).sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)).slice(0, 20).map((r) => r.id);
  const checkFeed = (r) => {
    assert.ok(r.data.length <= 20);
    if (r.complete) assert.deepEqual(r.data.map((r) => r.id), feedExpected);
  };
  await timed("httpPoint", () => request("/q/point", pointArgs), checkPoint);
  const first = await timed("httpThread", () => request("/q/thread", threadArgs), checkThread);
  if (first.next) await timed("httpNextPage", () => request("/q/thread", { ...threadArgs, c: first.next }), (r) => { assert.equal(r.data.length, Math.min(50, messages - 50)); assert.ok(!r.data.some((x) => first.data.some((y) => x.id === y.id))); });
  const inbox = await timed("httpInbox", () => request("/q/inbox", {}), (r) => assert.equal(r.data.length, Math.min(50, groups)));
  await timed("httpFeed", () => request("/q/feed", { c: null }), checkFeed);

  const { MemoryStore } = await import("../packages/snapback4/dist/replica/store.js");
  const { openSqlite, nodeSqliteDriver } = await import("../packages/snapback4/dist/replica/sqlite.js");
  const { Interpreter } = await import("../packages/snapback4/dist/replica/interpreter.js");
  const { Replica } = await import("../packages/snapback4/dist/replica/replica.js");
  const { DatabaseSync } = await import("node:sqlite");
  const backend = await request("/schema");
  const programs = Object.fromEntries(backend.programs.map((p) => [p.name, p]));
  for (const kind of ["memory", "sqlite"]) {
    const store = kind === "memory" ? new MemoryStore(backend.schema) : await openSqlite(nodeSqliteDriver(new DatabaseSync(":memory:")), backend.schema);
    let pages = 0, events = 0;
    const replica = new Replica(store, backend.schema, { async sync(from, limit, after) {
      const p = await request(`/sync?from=${from}&limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`);
      pages++; events += p.events.length;
      return p;
    } }, backend.generation);
    try {
      const start = performance.now();
      assert.equal((await replica.syncOnce()).ok, true);
      results[`${kind}ColdSync`] = { ms: +(performance.now() - start).toFixed(1), pages, events };
      const run = (op, args) => store.read((tx) => new Interpreter(tx, backend.schema, { viewer: "dev:bob", args, now: Date.now(), newIds: [], mint: () => { throw new Error("query minted an id"); } }, "query").run(programs[op]));
      await timed(`${kind}Point`, () => run("point", pointArgs), checkPoint);
      await timed(`${kind}Thread`, () => run("thread", threadArgs), checkThread);
      await timed(`${kind}Inbox`, () => run("inbox", {}), (r) => assert.deepEqual(r.data, inbox.data));
      await timed(`${kind}Feed`, () => run("feed", { c: null }), checkFeed);
      assert.equal(await store.read((tx) => tx.count("messages", "byId", [], Number.MAX_SAFE_INTEGER)), groups * Math.min(messages, 500));
    } finally { await replica.close(); }
  }
  const sent = await timed("httpSend", (n) => request("/m/send", { id: `perf-send-${n}`, args: { conversationId: "c000", body: "measured send" } }), (r) => assert.equal(r.state, "sent"));
  await timed("httpEdit", () => request("/m/edit", { args: { messageId: sent.result.id, body: "measured edit" } }), (r) => assert.equal(r.state, "sent"));
  return results;
}

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1];
}

function catalogRow(n) {
  const sku = "p" + String(n).padStart(7, "0");
  const category = "c" + String(n % 100).padStart(3, "0");
  return { sku, category, price: Math.floor(n / 100) * 10, title: "Product " + sku + " in " + category };
}

function catalogSize() {
  const rows = Number(option("--rows", 100_000));
  assert.ok(Number.isSafeInteger(rows) && rows >= 10_000 && rows <= 1_000_000);
  return rows;
}

// Generated into a new scratch directory, never over an existing project.
// Seed/import is an administrative setup step and is not a write benchmark.
function initCatalog() {
  const target = option("--catalog-init");
  assert.ok(target, "--catalog-init requires a new directory");
  const dir = resolve(target);
  mkdirSync(dir);
  mkdirSync(join(dir, "snapback"));
  mkdirSync(join(dir, "convex"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: "snapback4-catalog-measurement", private: true, type: "module",
    dependencies: { convex: "1.45.0", supabase: "2.117.0", "@supabase/supabase-js": "2.116.0" },
  }, null, 2) + "\n");
  writeFileSync(join(dir, "snapback/schema.q"), [
    "use identity guests", "",
    "table products:",
    "  sku: text 1..40", "  category: text 1..20", "  price: int", "  title: text <=200",
    "  unique bySku: sku", "  by byCategoryPrice: category, price, id",
    "  public 'public catalog fixture'", "  insert <- deny", "  update <- deny", "  delete <- deny", "",
    "query point(sku: text 1..40):", "  return products[sku] by bySku { sku, category, price, title }", "",
    "query category(category: text 1..20, c: cursor ?):",
    "  return products[category] after c first 50 by byCategoryPrice",
    "    { sku, category, price, title }", "",
    "query all(c: cursor ?):",
    "  return products[] after c first 1000 by bySku",
    "    { sku, category, price, title }", "",
  ].join("\n"));
  writeFileSync(join(dir, "convex/schema.js"), [
    'import { defineSchema, defineTable } from "convex/server";',
    'import { v } from "convex/values";',
    'export default defineSchema({ products: defineTable({ sku: v.string(), category: v.string(), price: v.number(), title: v.string() })',
    '  .index("by_sku", ["sku"]).index("by_category_price", ["category", "price"]) });', "",
  ].join("\n"));
  writeFileSync(join(dir, "convex/catalog.js"), [
    'import { queryGeneric as query } from "convex/server";',
    'import { v } from "convex/values";',
    'const fields = (r) => r && ({ sku: r.sku, category: r.category, price: r.price, title: r.title });',
    'export const point = query({ args: { sku: v.string() }, handler: async (ctx, a) =>',
    '  fields(await ctx.db.query("products").withIndex("by_sku", q => q.eq("sku", a.sku)).unique()) });',
    'export const category = query({ args: { category: v.string(), c: v.union(v.string(), v.null()) }, handler: async (ctx, a) => {',
    '  const page = await ctx.db.query("products").withIndex("by_category_price", q => q.eq("category", a.category)).order("asc")',
    '    .paginate({ cursor: a.c, numItems: 50 });',
    '  return { data: page.page.map(fields), next: page.isDone ? null : page.continueCursor };',
    '} });', "",
    'export const all = query({ args: { c: v.union(v.string(), v.null()) }, handler: async (ctx, a) => {',
    '  const page = await ctx.db.query("products").withIndex("by_sku").order("asc").paginate({ cursor: a.c, numItems: 1000 });',
    '  return { data: page.page.map(fields), next: page.isDone ? null : page.continueCursor };',
    '} });', "",
  ].join("\n"));
  writeFileSync(join(dir, "schema.sql"), [
    "create table public.products (id bigint generated always as identity primary key,",
    "  sku text not null unique, category text not null, price bigint not null, title text not null);",
    "create index products_by_category_price on public.products (category, price, sku);",
    "alter table public.products enable row level security;",
    "create policy public_catalog_read on public.products for select using (true);",
    "grant select on public.products to anon, authenticated;",
    "grant all on public.products to service_role;",
    "grant usage, select on sequence public.products_id_seq to service_role;", "",
  ].join("\n"));
  const rows = Array.from({ length: catalogSize() }, (_, n) => catalogRow(n));
  const body = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(join(dir, "products.jsonl"), body);
  console.log(JSON.stringify({ directory: dir, rows: rows.length, seedSha256: createHash("sha256").update(body).digest("hex") }));
}

async function measureCatalog() {
  const backend = option("--catalog");
  assert.ok(["snapback4", "convex", "supabase"].includes(backend), "--catalog snapback4|convex|supabase");
  const count = catalogSize();
  const samples = Number(option("--samples", 500));
  assert.ok(Number.isSafeInteger(samples) && samples >= 50 && samples <= 10_000);
  const trial = Number(option("--trial", 0));
  assert.ok(Number.isSafeInteger(trial) && trial >= 0 && trial <= 1000);
  const endpoint = new URL(process.env.SB4_CATALOG_URL);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname), "catalog runs target an isolated loopback backend");
  const headers = { "content-type": "application/json" };
  const http = async (path, body) => {
    const response = await fetch(new URL(path, endpoint), {
      headers, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const value = await response.json();
    assert.ok(response.ok && !value.denied && value.status !== "error", "backend refused the catalog request");
    return value;
  };
  if (backend === "snapback4") {
    const auth = await http("/auth/guest", {});
    assert.ok(auth.session?.token);
    headers.authorization = "Bearer " + auth.session.token;
  } else if (backend === "supabase") {
    const keys = JSON.parse(readFileSync(process.env.SB4_CATALOG_KEYS, "utf8"));
    assert.ok(keys.ANON_KEY, "Supabase's local status JSON must include ANON_KEY");
    headers.apikey = keys.ANON_KEY;
    headers.authorization = "Bearer " + keys.ANON_KEY;
  }
  const fields = (r) => r == null ? null : ({ sku: r.sku, category: r.category, price: Number(r.price), title: r.title });
  const query = async (name, args) => {
    if (backend === "snapback4") {
      const r = await http("/q/" + name, { args });
      assert.equal(r.complete, true, "a capped result is not a successful catalog read");
      return { data: Array.isArray(r.data) ? r.data.map(fields) : fields(r.data), next: r.next };
    }
    if (backend === "convex") {
      const r = await http("/api/query", { path: "catalog:" + name, args, format: "json" });
      assert.equal(r.status, "success");
      return name === "point" ? { data: fields(r.value) } : { data: r.value.data.map(fields), next: r.value.next };
    }
    const params = new URLSearchParams({ select: "sku,category,price,title" });
    if (name === "point") {
      params.set("sku", "eq." + args.sku);
      const r = await http("/rest/v1/products?" + params);
      assert.ok(Array.isArray(r) && r.length <= 1);
      return { data: fields(r[0]) };
    }
    if (name === "all") {
      params.set("order", "sku.asc");
      params.set("limit", "1000");
      if (args.c != null) params.set("sku", "gt." + args.c);
      const r = await http("/rest/v1/products?" + params);
      assert.ok(Array.isArray(r));
      return { data: r.map(fields), next: r.length === 1000 ? r.at(-1).sku : null };
    }
    params.set("category", "eq." + args.category);
    params.set("order", "price.asc,sku.asc");
    params.set("limit", "51");
    // Prices are unique within every fixture category, on all three backends.
    if (args.c != null) params.set("price", "gt." + args.c);
    const r = await http("/rest/v1/products?" + params);
    assert.ok(Array.isArray(r));
    return { data: r.slice(0, 50).map(fields), next: r.length > 50 ? String(r[49].price) : null };
  };
  // A seeded permutation gives different keys to the concurrency cases and
  // trials while their slices fit the dataset. Backend caches stay enabled.
  const order = Uint32Array.from({ length: count }, (_, n) => n);
  let state = 42;
  for (let n = count - 1; n > 0; n--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (n + 1);
    [order[n], order[j]] = [order[j], order[n]];
  }
  const random = (n) => order[(n + trial * 3 * (samples + 30)) % count];
  const page = (category, start = 0) => Array.from({ length: Math.min(50, Math.ceil((count - category) / 100) - start) }, (_, n) => catalogRow(category + (start + n) * 100));
  const measurements = {};
  const run = async (name, concurrency, spec, warmups = 30) => {
    const invoke = async (n) => {
      const [op, args, expected] = spec(n);
      const started = performance.now();
      const answer = await query(op, args);
      const ms = performance.now() - started;
      assert.deepEqual(answer.data, expected, name + " returned different catalog records");
      return ms;
    };
    for (let n = 0; n < warmups; n++) await invoke(n);
    let next = 0;
    const times = [];
    const started = performance.now();
    await Promise.all(Array.from({ length: concurrency }, async () => {
      for (;;) {
        const n = next++;
        if (n >= samples) return;
        times.push(await invoke(n + warmups));
      }
    }));
    const elapsed = performance.now() - started;
    times.sort((a, b) => a - b);
    const p = (fraction) => +times[Math.ceil(times.length * fraction) - 1].toFixed(3);
    measurements[name] = { samples, concurrency, warmups, p50Ms: p(.5), p95Ms: p(.95), p99Ms: p(.99), maxMs: p(1), elapsedMs: +elapsed.toFixed(1), requestsPerSecond: +(samples * 1000 / elapsed).toFixed(1), errors: 0 };
    console.error(backend + " " + name + ": " + JSON.stringify(measurements[name]));
  };
  try {
    const verified = createHash("sha256");
    let cursor = null, verifiedRows = 0;
    do {
      const answer = await query("all", { c: cursor });
      assert.ok(answer.data.length > 0 || answer.next == null, "an empty verification page must finish");
      for (const row of answer.data) {
        assert.deepEqual(row, catalogRow(verifiedRows++), "the complete stored fixture must match before timings");
        verified.update(JSON.stringify(row) + "\n");
      }
      assert.ok(verifiedRows <= count);
      cursor = answer.next;
    } while (cursor != null);
    assert.equal(verifiedRows, count);
    const verifiedSeedSha256 = verified.digest("hex");
    await run("pointHot", 1, () => ["point", { sku: catalogRow(123).sku }, catalogRow(123)]);
    for (const [caseIndex, concurrency] of [1, 8, 32].entries()) await run("pointRandomC" + concurrency, concurrency, (n) => {
      const row = catalogRow(random(n + caseIndex * (samples + 30)));
      return ["point", { sku: row.sku }, row];
    });
    await run("pointMissingDistinct", 1, (n) => ["point", { sku: catalogRow(count + trial * (samples + 30) + n).sku }, null]);
    for (const concurrency of [1, 8]) await run("categoryFirstHotC" + concurrency, concurrency, (n) => {
      const category = n % 100;
      return ["category", { category: catalogRow(category).category, c: null }, page(category)];
    }, 100);
    const first = await query("category", { category: "c007", c: null });
    assert.ok(first.next != null);
    await run("categoryNextHot", 1, () => ["category", { category: "c007", c: first.next }, page(7, 50)]);
    const seed = Array.from({ length: count }, (_, n) => JSON.stringify(catalogRow(n))).join("\n") + "\n";
    const metadata = process.env.SB4_CATALOG_METADATA ? JSON.parse(readFileSync(process.env.SB4_CATALOG_METADATA, "utf8")) : {};
    const out = {
      at: new Date().toISOString(), workload: "public-catalog", backend, trial, rows: count,
      seedSha256: createHash("sha256").update(seed).digest("hex"),
      verifiedRows, verifiedSeedSha256,
      workloadSha256: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),
      node: process.version, host: platform() + "-" + arch() + " " + cpus()[0].model,
      transport: "loopback HTTP; public reads; Snapback guest session, Supabase anonymous role, Convex public queries",
      cache: "entire fixture verified first; warm database; 30 warmups per point/continuation case, all 100 category keys warmed per category case; hot keys named; shuffled present and distinct missing point keys vary by case/trial; backend result caches enabled",
      metadata, measurements,
    };
    assert.equal(out.seedSha256, verifiedSeedSha256);
    appendFileSync(join(root, "metrics/storage.jsonl"), JSON.stringify(out) + "\n");
    console.log(JSON.stringify(out));
  } finally {
    if (backend === "snapback4") await http("/auth/logout", {});
  }
}
