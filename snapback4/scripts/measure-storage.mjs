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
if (process.argv.includes("--private-catalog-init")) {
  initPrivateCatalog();
  process.exit(0);
}
if (process.argv.includes("--catalog-init")) {
  initCatalog();
  process.exit(0);
}
if (process.argv.includes("--private-catalog")) {
  await measurePrivateCatalog();
  process.exit(0);
}
if (process.argv.includes("--catalog")) {
  await measureCatalog();
  process.exit(0);
}

// --workloads adds HTTP measurements to the same seed.
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
  const client = workloads ? Buffer.concat(["local", "web", "backend"].map((name) => readFileSync(join(root, `packages/snapback4/dist/${name}.js`)))) : undefined;
  out = { at: new Date().toISOString(), binary, binarySha256: digest(readFileSync(binary)), clientSha256: client && digest(client), workloadSha256: digest(readFileSync(new URL(import.meta.url))), seedSha256: digest(JSON.stringify(seed)), sha: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), dirty: !!spawnSync("git", ["status", "--porcelain", "--untracked-files=no", "--", "snapback4"], { cwd: join(root, ".."), encoding: "utf8" }).stdout.trim(), node: process.version, host: `${platform()}-${arch()} ${cpus()[0].model}`, transport: "loopback HTTP; dev personas; file-backed server SQLite WAL/NORMAL", replicas: undefined, groups, messages, members, seeded: seeded.seeded, seedMs, rowsBytes: s.rows, rowCount: s.row_count, indexBytes: s.indexes, logBytes: s.log, logEvents: s.log_events, fileBytes: s.file, logPerRows: +(s.log / s.rows).toFixed(2), filePerRows: +(s.file / s.rows).toFixed(2), measurements };
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

  // The device's own timings are the witnesses' (metrics/witness.jsonl):
  // one implementation, measured where it runs.
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


// The private fixture uses ordinary backend identities. Setup maps logical
// owner slots to those identities; credentials never enter generated sources.
function initPrivateCatalog() {
  const dir = resolve(option("--private-catalog-init"));
  mkdirSync(dir);
  mkdirSync(join(dir, "snapback"));
  mkdirSync(join(dir, "convex"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "snapback4-private-catalog-measurement", private: true, type: "module", dependencies: { convex: "1.45.0", supabase: "2.117.0" } }, null, 2) + "\n");
  writeFileSync(join(dir, "snapback/schema.q"), `use identity guests

table privateProducts:
  ownerId: principal
  sku: text 1..40
  category: text 1..20
  price: int
  title: text <=200
  revision: int
  unique byOwnerSku: ownerId, sku
  unique byOwnerCategoryPrice: ownerId, category, price, sku
  immutable ownerId, sku, category, price, title
  read <- .ownerId = viewer
  insert <- deny
  update <- .ownerId = viewer
  delete <- deny

query point(sku: text 1..40):
  return privateProducts[viewer, sku] by byOwnerSku { sku, category, price, title, revision }

query category(category: text 1..20, c: cursor ?):
  return privateProducts[viewer, category] after c first 50 by byOwnerCategoryPrice
    { sku, category, price, title, revision }

query all(c: cursor ?):
  return privateProducts[viewer] after c first 1000 by byOwnerSku
    { sku, category, price, title, revision }

mutation bump(sku: text 1..40):
  row = privateProducts[viewer, sku] by byOwnerSku ! else NOT_FOUND
  update privateProducts[row] { revision: row.revision + 1 }
  return { sku: row.sku, revision: row.revision + 1 }
`);
  writeFileSync(join(dir, "convex/schema.js"), `import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  // Preserve the earlier public fixture while adding separate private tables.
  products: defineTable({ sku: v.string(), category: v.string(), price: v.number(), title: v.string() })
    .index("by_sku", ["sku"]).index("by_category_price", ["category", "price"]),
  privateProducts: defineTable({ ownerId: v.string(), sku: v.string(), category: v.string(), price: v.number(), title: v.string(), revision: v.number() })
    .index("by_owner_sku", ["ownerId", "sku"])
    .index("by_owner_category_price", ["ownerId", "category", "price", "sku"]),
  privateOps: defineTable({ ownerId: v.string(), opId: v.string(), outcome: v.any() })
    .index("by_owner_op", ["ownerId", "opId"]),
});
`);
  writeFileSync(join(dir, "convex/privateCatalog.js"), `import { queryGeneric as query, mutationGeneric as mutation } from "convex/server";
import { v } from "convex/values";
const owner = async (ctx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("AUTH_REQUIRED");
  return identity.subject;
};
const fields = r => r && ({ sku: r.sku, category: r.category, price: r.price, title: r.title, revision: r.revision });
const find = (ctx, ownerId, sku) => ctx.db.query("privateProducts").withIndex("by_owner_sku", q => q.eq("ownerId", ownerId).eq("sku", sku)).unique();
export const point = query({ args: { sku: v.string() }, handler: async (ctx, a) => fields(await find(ctx, await owner(ctx), a.sku)) });
export const category = query({ args: { category: v.string(), c: v.union(v.string(), v.null()) }, handler: async (ctx, a) => {
  const ownerId = await owner(ctx);
  const p = await ctx.db.query("privateProducts").withIndex("by_owner_category_price", q => q.eq("ownerId", ownerId).eq("category", a.category))
    .order("asc").paginate({ cursor: a.c, numItems: 50 });
  return { data: p.page.map(fields), next: p.isDone ? null : p.continueCursor };
} });
export const all = query({ args: { c: v.union(v.string(), v.null()) }, handler: async (ctx, a) => {
  const ownerId = await owner(ctx);
  const p = await ctx.db.query("privateProducts").withIndex("by_owner_sku", q => q.eq("ownerId", ownerId))
    .order("asc").paginate({ cursor: a.c, numItems: 1000 });
  return { data: p.page.map(fields), next: p.isDone ? null : p.continueCursor };
} });
export const bump = mutation({ args: { sku: v.string(), opId: v.string() }, handler: async (ctx, a) => {
  const ownerId = await owner(ctx);
  const prior = await ctx.db.query("privateOps").withIndex("by_owner_op", q => q.eq("ownerId", ownerId).eq("opId", a.opId)).unique();
  if (prior) return prior.outcome;
  const row = await find(ctx, ownerId, a.sku);
  let outcome;
  if (!row) outcome = { state: "failed", code: "NOT_FOUND" };
  else {
    const revision = row.revision + 1;
    if (!Number.isSafeInteger(revision)) throw new Error("REVISION_OVERFLOW");
    await ctx.db.patch(row._id, { revision });
    outcome = { state: "sent", result: { sku: row.sku, revision } };
  }
  // The indexed absence read, row update and receipt insertion share this
  // mutation transaction, including retries after concurrent conflicts.
  await ctx.db.insert("privateOps", { ownerId, opId: a.opId, outcome });
  return outcome;
} });
`);
  writeFileSync(join(dir, "schema.sql"), `create table public.private_products (
  owner_id uuid not null, sku text not null check (length(sku) between 1 and 40),
  category text not null, price bigint not null, title text not null, revision bigint not null default 0,
  primary key (owner_id, sku));
create index private_products_by_category on public.private_products (owner_id, category, price, sku);
alter table public.private_products enable row level security;
create policy private_catalog_read on public.private_products for select to authenticated using ((select auth.uid()) = owner_id);
create policy private_catalog_update on public.private_products for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
-- Supabase installations can grant broad table privileges by default. A
-- column grant alone would leave those privileges in place.
revoke all on public.private_products from public, anon, authenticated;
grant select, update (revision) on public.private_products to authenticated;
grant all on public.private_products to service_role;

-- This schema is not exposed through PostgREST. The invoker needs table
-- privileges inside the RPC, but clients get no direct receipt-write API.
create schema sb4_catalog_private;
create table sb4_catalog_private.receipts (
  owner_id uuid not null, op_id text not null, outcome jsonb,
  primary key (owner_id, op_id));
alter table sb4_catalog_private.receipts enable row level security;
create policy own_receipt on sb4_catalog_private.receipts to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
revoke all on schema sb4_catalog_private from public, anon, authenticated;
revoke all on sb4_catalog_private.receipts from public, anon, authenticated;
grant usage on schema sb4_catalog_private to authenticated, service_role;
grant select, insert (owner_id, op_id), update (outcome) on sb4_catalog_private.receipts to authenticated;
grant all on sb4_catalog_private.receipts to service_role;

create function public.private_catalog_bump(p_sku text, p_op_id text) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  who uuid := auth.uid();
  claimed boolean;
  result jsonb;
  next_revision bigint;
begin
  if who is null then raise exception 'AUTH_REQUIRED'; end if;
  insert into sb4_catalog_private.receipts (owner_id, op_id) values (who, p_op_id)
    on conflict do nothing returning true into claimed;
  if not coalesce(claimed, false) then
    select outcome into result from sb4_catalog_private.receipts where owner_id = who and op_id = p_op_id;
    if result is null then raise exception 'INCOMPLETE_RECEIPT'; end if;
    return result;
  end if;
  update public.private_products set revision = revision + 1
    where owner_id = who and sku = p_sku returning revision into next_revision;
  if not found then result := jsonb_build_object('state', 'failed', 'code', 'NOT_FOUND');
  else result := jsonb_build_object('state', 'sent', 'result', jsonb_build_object('sku', p_sku, 'revision', next_revision)); end if;
  update sb4_catalog_private.receipts set outcome = result where owner_id = who and op_id = p_op_id;
  return result;
end;
$$;
revoke all on function public.private_catalog_bump(text, text) from public, anon, authenticated;
grant execute on function public.private_catalog_bump(text, text) to authenticated;
`);
  const rows = Array.from({ length: catalogSize() }, (_, n) => ({ ...catalogRow(n), ownerSlot: Math.floor(n / 100) % 2, revision: 0 }));
  const body = rows.map(r => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(join(dir, "private-products.jsonl"), body);
  console.log(JSON.stringify({ directory: dir, rows: rows.length, logicalSeedSha256: createHash("sha256").update(body).digest("hex"), identity: "setup must map owner slots to real principals; Convex auth.config contains only a public JWKS" }));
}


async function measurePrivateCatalog() {
  const backend = option("--private-catalog");
  assert.ok(["snapback4", "convex", "supabase"].includes(backend));
  const count = catalogSize(), samples = Number(option("--samples", 500)), trial = Number(option("--trial", 0));
  assert.ok(count >= 20000 && count % 200 === 0, "private pagination needs equally sized owners and at least two category pages");
  assert.ok(Number.isSafeInteger(samples) && samples >= 50 && samples <= 10000 && 2 * (samples + 30) <= count / 2 - 200);
  assert.ok(Number.isSafeInteger(trial) && trial >= 0 && trial <= 1000);
  const endpoint = new URL(process.env.SB4_CATALOG_URL);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname), "private measurements use an isolated loopback backend");
  const credentials = JSON.parse(readFileSync(process.env.SB4_PRIVATE_SESSIONS, "utf8"));
  assert.equal(credentials.backend, backend);
  assert.equal(credentials.sessions.length, 3, "two owners plus one authenticated outsider");
  for (const actor of credentials.sessions) assert.ok(typeof actor.token === "string" && actor.token.length > 10 && typeof actor.principal === "string");
  assert.equal(new Set(credentials.sessions.map(a => a.principal)).size, 3);
  if (backend === "supabase") {
    assert.ok(credentials.apiKey);
    for (const actor of credentials.sessions) {
      const payload = JSON.parse(Buffer.from(actor.token.split(".")[1], "base64url"));
      assert.equal(payload.role, "authenticated");
      assert.equal(payload.sub, actor.principal);
      assert.ok(payload.exp * 1000 > Date.now() + 120000, "ordinary user tokens must cover the run");
    }
  }
  const http = async (path, body, actor = 0, token = credentials.sessions[actor].token, method = body === undefined ? "GET" : "POST") => {
    const headers = { "content-type": "application/json", ...(backend === "supabase" ? { apikey: credentials.apiKey } : {}), ...(token == null ? {} : { authorization: "Bearer " + token }) };
    if (method === "PATCH") headers.prefer = "return=representation";
    const response = await fetch(new URL(path, endpoint), { headers, method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    let value;
    try { value = await response.json(); } catch { throw new Error("private backend returned non-JSON status " + response.status); }
    assert.ok(response.status < 500, "private backend returned a server error");
    return { status: response.status, value, ok: response.ok && !value?.denied && value?.status !== "error" };
  };
  const fields = row => row == null ? null : ({ sku: row.sku, category: row.category, price: Number(row.price), title: row.title, revision: Number(row.revision) });
  const queryRaw = async (name, args, actor = 0, token = credentials.sessions[actor].token, ownerOverride) => {
    if (backend === "snapback4") return http("/q/" + name, { args }, actor, token);
    if (backend === "convex") return http("/api/query", { path: "privateCatalog:" + name, args, format: "json" }, actor, token);
    const params = new URLSearchParams({ select: "sku,category,price,title,revision", owner_id: "eq." + (ownerOverride ?? credentials.sessions[actor].principal) });
    if (name === "point") params.set("sku", "eq." + args.sku);
    else if (name === "all") {
      params.set("order", "sku.asc"); params.set("limit", "1000");
      if (args.c != null) params.set("sku", "gt." + args.c);
    } else {
      params.set("category", "eq." + args.category); params.set("order", "price.asc,sku.asc"); params.set("limit", "51");
      if (args.c != null) params.set("price", "gt." + args.c);
    }
    return http("/rest/v1/private_products?" + params, undefined, actor, token);
  };
  const query = async (name, args, actor = 0) => {
    const r = await queryRaw(name, args, actor);
    assert.ok(r.ok, "private query was refused");
    if (backend === "snapback4") {
      assert.equal(r.value.complete, true, "capped private reads are not successful samples");
      assert.equal(r.value.viewer, credentials.sessions[actor].principal);
      return { data: Array.isArray(r.value.data) ? r.value.data.map(fields) : fields(r.value.data), next: r.value.next };
    }
    if (backend === "convex") {
      assert.equal(r.value.status, "success");
      return name === "point" ? { data: fields(r.value.value) } : { data: r.value.value.data.map(fields), next: r.value.value.next };
    }
    assert.ok(Array.isArray(r.value));
    if (name === "point") { assert.ok(r.value.length <= 1); return { data: fields(r.value[0]) }; }
    if (name === "all") return { data: r.value.map(fields), next: r.value.length === 1000 ? r.value.at(-1).sku : null };
    return { data: r.value.slice(0, 50).map(fields), next: r.value.length > 50 ? String(r.value[49].price) : null };
  };
  const bump = async (sku, id, actor = 0, extra = {}) => {
    let r;
    if (backend === "snapback4") r = await http("/m/bump", { id, args: { sku, ...extra } }, actor);
    else if (backend === "convex") r = await http("/api/mutation", { path: "privateCatalog:bump", args: { sku, opId: id, ...extra }, format: "json" }, actor);
    else r = await http("/rest/v1/rpc/private_catalog_bump", { p_sku: sku, p_op_id: id, ...extra }, actor);
    if (!r.ok) return { state: "refused", status: r.status };
    const value = backend === "convex" ? r.value.value : r.value;
    assert.ok(["sent", "failed"].includes(value.state), "unexpected private mutation state");
    return value.state === "sent" ? { state: "sent", result: { sku: value.result.sku, revision: Number(value.result.revision) } } : { state: "failed", code: backend === "snapback4" ? value.why?.code : value.code };
  };
  const expectedRevisions = new Map();
  const expected = n => ({ ...catalogRow(n), revision: expectedRevisions.get(catalogRow(n).sku) ?? 0 });
  const ownerNumber = (actor, position) => Math.floor(position / 100) * 200 + actor * 100 + position % 100;
  const categoryPage = (actor, category, start = 0) => Array.from({ length: Math.min(50, count / 200 - start) }, (_, n) => expected(category + actor * 100 + (start + n) * 200));
  const shuffle = size => {
    const values = Uint32Array.from({ length: size }, (_, n) => n); let state = 42;
    for (let n = size - 1; n > 0; n--) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; const j = state % (n + 1); [values[n], values[j]] = [values[j], values[n]]; }
    return values;
  };
  const order = shuffle(count / 2);
  const random = n => order[(n + trial * 3 * (samples + 30)) % order.length];
  const verify = async () => {
    const rows = new Array(count); let total = 0;
    for (const actor of [0, 1]) {
      let cursor = null, position = 0;
      do {
        const answer = await query("all", { c: cursor }, actor);
        assert.ok(answer.data.length > 0 || answer.next == null);
        for (const row of answer.data) {
          const n = ownerNumber(actor, position++);
          assert.ok(n < count && rows[n] === undefined, "private traversal duplicated or crossed an owner");
          assert.deepEqual(row, expected(n), "private stored fixture differs from expected state");
          rows[n] = { ...catalogRow(n), ownerSlot: actor, revision: row.revision }; total++;
        }
        cursor = answer.next;
      } while (cursor != null);
      assert.equal(position, count / 2);
    }
    assert.equal(total, count);
    assert.deepEqual((await query("all", { c: null }, 2)).data, []);
    return { rows: total, sha256: createHash("sha256").update(rows.map(r => JSON.stringify(r)).join("\n") + "\n").digest("hex") };
  };
  const measurements = {};
  const run = async (name, concurrency, call, warmups = 30) => {
    for (let n = 0; n < warmups; n++) await call(n);
    const times = []; let next = warmups;
    const started = performance.now();
    await Promise.all(Array.from({ length: concurrency }, async () => {
      for (;;) { const n = next++; if (n >= samples + warmups) return; times.push(await call(n)); }
    }));
    const elapsedMs = performance.now() - started;
    times.sort((a, b) => a - b);
    const p = x => +times[Math.ceil(times.length * x) - 1].toFixed(3);
    measurements[name] = { samples, concurrency, warmups, p50Ms: p(.5), p95Ms: p(.95), p99Ms: p(.99), maxMs: p(1), elapsedMs: +elapsedMs.toFixed(1), requestsPerSecond: +(samples * 1000 / elapsedMs).toFixed(1), errors: 0 };
    console.error(backend + " " + name + ": " + JSON.stringify(measurements[name]));
  };
  const timedRead = spec => async n => {
    const [name, args, actor, wanted] = spec(n), started = performance.now();
    const answer = await query(name, args, actor), elapsed = performance.now() - started;
    assert.deepEqual(answer.data, wanted, "private timed read returned the wrong rows");
    return elapsed;
  };
  // An anonymous query can return hidden rows or refuse the request. Neither
  // permits private data; record the native envelope without conflating them.
  const anonymous = await queryRaw("point", { sku: catalogRow(0).sku }, 0, null);
  if (anonymous.ok) {
    const data = backend === "snapback4" ? anonymous.value.data : backend === "convex" ? anonymous.value.value : anonymous.value;
    assert.ok(data === null || (Array.isArray(data) && data.length === 0), "an unauthenticated request exposed private data");
  }
  const authChecks = { anonymous: { status: anonymous.status, outcome: anonymous.ok ? "hidden" : "refused" } };
  for (const token of ["invalid-token", credentials.sessions[0].token.slice(0, -8) + "tampered"]) {
    assert.equal((await queryRaw("point", { sku: catalogRow(0).sku }, 0, token)).ok, false, "invalid authentication was accepted");
  }
  if (credentials.expiredToken) assert.equal((await queryRaw("point", { sku: catalogRow(0).sku }, 0, credentials.expiredToken)).ok, false, "expired authentication was accepted");
  for (const actor of [0, 1, 2, 0, 1, 2]) {
    assert.deepEqual((await query("point", { sku: catalogRow(0).sku }, actor)).data, actor === 0 ? expected(0) : null);
  }
  if (backend === "supabase") {
    const forged = await queryRaw("point", { sku: catalogRow(0).sku }, 1, credentials.sessions[1].token, credentials.sessions[0].principal);
    assert.ok(forged.ok); assert.deepEqual(forged.value, [], "explicit owner filters must not bypass RLS");
    const immutable = await http("/rest/v1/private_products?sku=eq." + catalogRow(0).sku,
      { title: "forbidden immutable change" }, 0, credentials.sessions[0].token, "PATCH");
    assert.equal(immutable.ok, false, "column privileges must refuse immutable-field updates through the real API");
  } else assert.equal((await queryRaw("point", { sku: catalogRow(0).sku, ownerId: credentials.sessions[0].principal }, 1)).ok, false);
  const initial = await verify();
  for (const actor of [0, 1]) {
    let cursor = null; const seen = [];
    do { const page = await query("category", { category: "c007", c: cursor }, actor); seen.push(...page.data); cursor = page.next; } while (cursor != null);
    assert.deepEqual(seen, Array.from({ length: count / 200 }, (_, n) => expected(7 + actor * 100 + n * 200)));
  }
  const ownerPage = await query("category", { category: "c007", c: null }, 0);
  assert.ok(ownerPage.next != null);
  const crossed = await queryRaw("category", { category: "c007", c: ownerPage.next }, 1);
  if (crossed.ok) {
    const raw = backend === "snapback4" ? crossed.value.data : backend === "convex" ? crossed.value.value.data : crossed.value;
    assert.ok(Array.isArray(raw) && raw.every(r => Math.floor(Number(r.sku.slice(1)) / 100) % 2 === 1), "a foreign cursor exposed another owner's rows");
  }
  await run("privatePointHot", 1, timedRead(() => ["point", { sku: catalogRow(0).sku }, 0, expected(0)]));
  for (const [caseIndex, concurrency] of [1, 8, 32].entries()) await run("privatePointRandomC" + concurrency, concurrency, timedRead(n => {
    const actor = n % 2, row = ownerNumber(actor, random(n + caseIndex * (samples + 30)));
    return ["point", { sku: catalogRow(row).sku }, actor, expected(row)];
  }));
  await run("privateMissingDistinct", 1, timedRead(n => ["point", { sku: catalogRow(count + trial * (samples + 30) + n).sku }, n % 2, null]));
  for (const concurrency of [1, 8]) await run("privateCategoryHotC" + concurrency, concurrency, timedRead(n => {
    const actor = Math.floor(n / 100) % 2, category = n % 100;
    return ["category", { category: catalogRow(category).category, c: null }, actor, categoryPage(actor, category)];
  }), 200);
  await run("privateNextHot", 1, timedRead(() => ["category", { category: "c007", c: ownerPage.next }, 0, categoryPage(0, 7, 50)]));

  const prefix = "private-catalog-" + trial, ownSku = catalogRow(count - 200).sku, otherSku = catalogRow(count - 100).sku;
  const sent = (sku, revision) => ({ state: "sent", result: { sku, revision } });
  assert.deepEqual(await bump(ownSku, prefix + "-first"), sent(ownSku, 1)); expectedRevisions.set(ownSku, 1);
  assert.deepEqual(await bump(ownSku, prefix + "-second"), sent(ownSku, 2)); expectedRevisions.set(ownSku, 2);
  assert.deepEqual(await bump(otherSku, prefix + "-first"), sent(ownSku, 1), "same-ID changed payload must replay its first outcome");
  assert.deepEqual(await bump(otherSku, prefix + "-first", 1), sent(otherSku, 1)); expectedRevisions.set(otherSku, 1);
  const notFound = { state: "failed", code: "NOT_FOUND" };
  assert.deepEqual(await bump(ownSku, prefix + "-foreign", 2), notFound);
  assert.deepEqual(await bump(otherSku, prefix + "-failed"), notFound);
  assert.deepEqual(await bump(ownSku, prefix + "-failed"), notFound, "failed operation IDs must replay their original failure");
  assert.notEqual((await bump(ownSku, prefix + "-forge", 1, { ownerId: credentials.sessions[0].principal })).state, "sent");
  const contended = await Promise.all(Array.from({ length: 8 }, (_, n) => bump(ownSku, prefix + "-contended-" + n)));
  assert.deepEqual(contended.map(r => { assert.equal(r.state, "sent"); assert.equal(r.result.sku, ownSku); return r.result.revision; }).sort((a, b) => a - b), [3, 4, 5, 6, 7, 8, 9, 10]); expectedRevisions.set(ownSku, 10);
  const retries = await Promise.all(Array.from({ length: 8 }, () => bump(ownSku, prefix + "-same")));
  for (const r of retries) assert.deepEqual(r, sent(ownSku, 11)); expectedRevisions.set(ownSku, 11);
  await run("privateReplayHot", 1, async () => {
    const start = performance.now(), r = await bump(ownSku, prefix + "-first"), ms = performance.now() - start;
    assert.deepEqual(r, sent(ownSku, 1)); return ms;
  });
  const writeOrder = shuffle(count / 2 - 200);
  for (const [caseIndex, concurrency] of [1, 8].entries()) await run("privateFreshBumpC" + concurrency, concurrency, async n => {
    const actor = n % 2, row = ownerNumber(actor, writeOrder[caseIndex * (samples + 30) + n]), sku = catalogRow(row).sku;
    const started = performance.now(), r = await bump(sku, prefix + "-fresh-" + caseIndex + "-" + n, actor), ms = performance.now() - started;
    assert.deepEqual(r, sent(sku, 1), "a timed fresh write must update a distinct owned row exactly once"); expectedRevisions.set(sku, 1); return ms;
  });
  const final = await verify();
  const metadata = process.env.SB4_CATALOG_METADATA ? JSON.parse(readFileSync(process.env.SB4_CATALOG_METADATA, "utf8")) : {};
  const out = { at: new Date().toISOString(), workload: "private-catalog", backend, trial, rows: count, initial, final, measurements, workloadSha256: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"), node: process.version, host: `${platform()}-${arch()} ${cpus()[0].model}`, transport: "loopback HTTP; real owner credentials; two owners plus authenticated outsider; no SDK retry wrapper", durability: "default-mode acknowledgement latency; no matched power-loss-durable write claim", auth: { identities: 3, timedIdentities: 2, ...authChecks, expiredTokenChecked: !!credentials.expiredToken, public: credentials.publicMetadata ?? {} }, correctness: { fullPartitionsBeforeAndAfter: true, foreignRowsHidden: true, foreignCursorNoLeak: true, unauthenticatedPrivateDataHidden: true, malformedTamperedAuthRefused: true, immutablePatchRefused: backend === "supabase" ? true : null, ownerArgumentForgeryRefused: true, freshAndFailedReplay: true, contendedDistinctIds: 8, concurrentSameId: 8, processRestartTested: false }, metadata };
  console.log(JSON.stringify(out));
}
