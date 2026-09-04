import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SnapbackRefusal, api, createClient } from "../dist/client.mjs";
import { closureFromCoverage, decodeDeliveryEnvelope, schemaDigest } from "../dist/index.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { engineId } from "./fake-owner.ts";

// @ref LLP 1012#6-reads-offline — the twin is the client: hydration from
// `coverage()` byte-identical to the Rust `ClientStore`, local evaluation with
// `partial` reasons, the stored answer as the covered case, program custody
// under the successor and auth-epoch fences.
// @ref LLP 1012#7-writes-offline — prediction: the overlay keyed by the intent,
// the trace of point digests and verdicts, discarded when the rows arrive.

const here = dirname(fileURLToPath(import.meta.url));
const corpusRoot = resolve(here, "../../../corpus");
const goldens = resolve(corpusRoot, "offline");

type Tagged = "Null" | { Bool: boolean } | { Int: number } | { String: string } | { Id: string } | { Bytes: string }
  | { Row: Record<string, Tagged> } | { Array: Tagged[] } | { Map: Record<string, Tagged> };

/** Sorted-key, whitespace-free JSON: the canonical form both digests hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** The wire encoding of a tagged IR value (`value_to_wire_json`). */
function wire(value: Tagged): unknown {
  if (value === "Null") return null;
  if ("Bool" in value) return value.Bool;
  if ("Int" in value) return value.Int;
  if ("String" in value) return value.String;
  if ("Id" in value) return value.Id;
  if ("Bytes" in value) return { Bytes: value.Bytes };
  if ("Array" in value) return value.Array.map(wire);
  const entries = "Row" in value ? value.Row : value.Map;
  return Object.fromEntries(Object.keys(entries).sort().map((key) => [key, wire(entries[key]!)]));
}

/** A typed argument descriptor for a corpus value (the corpus IR says `Scalar`; the compiler types them). */
function descriptorFor(value: Tagged): unknown {
  if (value === "Null") return { Optional: "Id" };
  if ("Bool" in value) return "Bool";
  if ("Int" in value) return "Int";
  if ("String" in value) return { Text: { max: 65_536 } };
  if ("Id" in value) return "Id";
  if ("Bytes" in value) return { Bytes: { max: 65_536 } };
  if ("Array" in value) return { List: { of: value.Array[0] === undefined ? "Id" : descriptorFor(value.Array[0]), max: Math.max(1, value.Array.length) } };
  return { Json: { max_bytes: 1_000_000 } };
}

function typedProgram(testCase: any): any {
  const args: Record<string, unknown> = {};
  for (const name of Object.keys(testCase.program.args ?? {})) {
    const value = testCase.context.args[name] as Tagged | undefined;
    args[name] = value === undefined ? { Optional: "Id" } : descriptorFor(value);
  }
  return { ...testCase.program, args };
}

/** The corpus receipt as the wire delivers it: pooled rows, camelCase ranges, primary absences, public verdicts. */
function wireReceipt(receipt: any): { rows: any[]; receipt: any } {
  const rows: any[] = receipt.rows.map((row: any) => ({ table: row.table, id: row.id, row: wire(row.row) }));
  for (const range of receipt.ranges) {
    if (range.halo && !rows.some((row) => row.table === range.halo.table && row.id === range.halo.id)) {
      rows.push({ table: range.halo.table, id: range.halo.id, row: wire(range.halo.row) });
    }
  }
  return {
    rows,
    receipt: {
      ranges: receipt.ranges.map((range: any) => ({
        site: range.site, table: range.table, index: range.index,
        prefix: range.prefix.map(wire), order: range.order, take: range.take,
        after: range.after === null ? null : wire(range.after), before: range.before === null ? null : wire(range.before),
        gt: range.gt === null ? null : wire(range.gt), gte: range.gte === null ? null : wire(range.gte),
        lt: range.lt === null ? null : wire(range.lt), lte: range.lte === null ? null : wire(range.lte),
        ruleHash: range.rule_hash, rowIds: [...range.row_ids], stop: range.stop, absence: range.absence,
        ...(range.halo === null ? {} : { haloId: range.halo.id }),
      })),
      absences: receipt.absences.map(([table, index, key]: any) => [table, index, key.map(wire)]),
      verdicts: receipt.verdicts.map((verdict: any) => ({
        ruleHash: verdict.rule_hash, pinnedInputsDigest: verdict.pinned_inputs_digest,
        principal: verdict.principal, authEpoch: verdict.auth_epoch, result: verdict.result,
      })),
    },
  };
}

/** The corpus receipt as the store can hold it: `n2_key` never crosses the wire, an absence a held row disproves is dropped. */
function holdableReceipt(receipt: any, schemaHash: string): unknown {
  const held = new Set(receipt.rows.map((row: any) => `${row.table}\u0000${row.id}`));
  return {
    schema_hash: schemaHash,
    rows: receipt.rows,
    ranges: receipt.ranges.map((range: any) => ({ ...range, n2_key: null })),
    absences: receipt.absences.filter(([table, index, key]: any) =>
      !(index === "byId" && key.length === 1 && key[0] !== "Null" && "Id" in key[0] && held.has(`${table}\u0000${key[0].Id}`))),
    verdicts: receipt.verdicts,
  };
}

function deliveryFromEnvelope(op: string, args: unknown, value: any) {
  const decoded = decodeDeliveryEnvelope(value);
  return {
    op, args, state: decoded.state, data: decoded.data, next: decoded.next, seq: decoded.seq,
    validator: decoded.validator, rows: decoded.rows, receipt: decoded.receipt,
    ...(decoded.reason === undefined ? {} : { reason: decoded.reason }),
    ...(decoded.rule === undefined ? {} : { rule: decoded.rule }),
  };
}

const tempRoot = () => mkdtemp(join(tmpdir(), "snapback2-twin-"));
const hex = (digit: string) => digit.repeat(64);

let corpusCases: any[] | undefined;
async function corpus(): Promise<any[]> {
  return corpusCases ??= JSON.parse(await readFile(resolve(corpusRoot, "manifest.json"), "utf8"));
}

interface CorpusOwnerOptions {
  viewer: string;
  generation: string;
  schemaHash: string;
  schema: unknown;
  programs: Record<string, { kind: "query" | "mutation"; ir: unknown; certificate: any }>;
  /** A second generation the owner moves to: the first resume answers `E_OFFLINE_RESET`, then serves it. */
  successor?: { generation: string; programs: Record<string, { kind: "query" | "mutation"; ir: unknown; certificate: any }> };
  dead?: () => boolean;
}

/** An owner double over a corpus schema: manifest, program custody, login/me, resume, replayed mutations. */
function corpusOwner(options: CorpusOwnerOptions) {
  const requests: string[] = [];
  const executions: Array<{ op: string; args: unknown; intent: string; ids: string[] }> = [];
  const stored = new Map<string, unknown>();
  let allocated = 1_000;
  let current = { generation: options.generation, programs: options.programs };
  let resetPending = options.successor !== undefined;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const payload = (generation: string, programs: CorpusOwnerOptions["programs"]) => ({
    generation, schemaHash: options.schemaHash, schema: options.schema,
    programs: Object.fromEntries(Object.entries(programs).map(([name, entry]) => [name, {
      kind: entry.kind, planHash: entry.certificate.plan_hash, ir: entry.ir, certificate: entry.certificate,
    }])),
  });
  const mint = () => {
    const from = engineId(allocated);
    allocated += 8_192;
    const mintedAt = Date.now();
    return { id: from, from, count: 8_192, mintedAt, expiresAt: mintedAt + 30 * 24 * 60 * 60 * 1_000 };
  };
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    requests.push(url.pathname + url.search);
    if (options.dead?.()) throw new TypeError("fetch failed");
    if (url.pathname === "/api/manifest") {
      return json({
        generation: "schema-generation", programGeneration: current.generation, channels: {}, auth: {}, tables: {},
        ops: Object.fromEntries(Object.entries(current.programs).map(([name, entry]) => [name, {
          kind: entry.kind, args: (entry.ir as { args?: unknown }).args ?? {}, planHash: entry.certificate.plan_hash,
        }])),
      });
    }
    if (url.pathname === "/api/program") {
      const generation = url.searchParams.get("generation");
      if (generation !== current.generation) return json({ code: "E_OP_UNKNOWN", family: "op", message: "not active", guide: "op/manifest" }, 404);
      return json(payload(current.generation, current.programs));
    }
    if (url.pathname === "/api/auth/me") return json({ viewer: options.viewer, kind: "user" });
    if (url.pathname === "/api/auth/login") return json({ token: `token-${options.viewer}`, viewer: options.viewer, grant: mint() });
    if (url.pathname === "/api/resume") {
      if (resetPending && options.successor) {
        resetPending = false;
        current = options.successor;
        return json({
          code: "E_OFFLINE_RESET", family: "offline", message: "the program generation changed",
          rewrite: "drop coverage and cold-drain", guide: "offline", generation: current.generation, schemaHash: options.schemaHash,
        }, 409);
      }
      return json({
        seq: 9, generation: current.generation, schemaHash: options.schemaHash,
        authority: { principal: options.viewer, authEpoch: 1 }, log: { unchanged: true }, mounted: [], grant: mint(),
      });
    }
    if (url.pathname === "/api/mutation") {
      const body = JSON.parse(String(init?.body));
      if (!body.replay) return json({ state: "committed", seq: 10, data: { id: engineId(allocated++) } });
      const intent = body.replay.intent as string;
      if (stored.has(intent)) return json(stored.get(intent));
      const ids = Array.from({ length: body.replay.count as number }, (_, index) =>
        engineId(Number.parseInt(body.replay.grant.slice(-16), 16) + body.replay.offset + index));
      executions.push({ op: body.op, args: body.args, intent, ids });
      const response = { state: "committed", seq: 11 + executions.length, data: { id: ids[0] }, intent };
      stored.set(intent, response);
      return json(response);
    }
    if (url.pathname === "/api/query") return json({ state: "complete", data: [], next: null, seq: 12 });
    return new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return { fetch, requests, executions };
}

/** Seeds a partition with a corpus receipt as coverage (op `coverage`), its facts, and optionally a held answer. */
async function seedCoverage(
  factory: ReturnType<typeof fileRangeStore>,
  viewer: string,
  testCase: any,
  facts: { generation: string; schemaHash: string; authEpoch: number },
  held?: { op: string; args: unknown; data: unknown; next: string | null },
  extra: Record<string, unknown> = {},
): Promise<void> {
  const store = factory();
  await store.open(viewer);
  const { rows, receipt } = wireReceipt(testCase.receipt);
  await store.commit({
    deliveries: [
      { op: "coverage", args: {}, state: "complete", data: null, next: null, seq: 1, validator: hex("1"), rows, receipt },
      ...(held ? [{ op: held.op, args: held.args, state: "complete" as const, data: held.data, next: held.next, seq: 1, validator: hex("2") }] : []),
    ],
    facts,
    ...extra,
  });
  await store.close?.();
}

test("hydration from coverage rebuilds every envelope golden's ClosureReceipt byte-identically", async () => {
  const files = (await readdir(goldens)).filter((name) => name.startsWith("envelope-")).sort();
  assert.ok(files.length >= 15);
  for (const file of files) {
    const envelope = decodeDeliveryEnvelope(JSON.parse(await readFile(resolve(goldens, file), "utf8")));
    const companion = JSON.parse(await readFile(resolve(goldens, file.replace("envelope-", "closure-")), "utf8"));
    const root = await tempRoot();
    try {
      const store = fileRangeStore(root)();
      await store.open(envelope.authority.principal);
      await store.commit({ deliveries: [deliveryFromEnvelope("golden", {}, envelope)] });
      const coverage = await store.coverage();
      assert.equal(
        JSON.stringify(closureFromCoverage(coverage, companion.schema, envelope.schemaHash)),
        companion.receiptBytes,
        `${file}: the twin's hydration from the store is the Rust ClosureReceipt`,
      );
      assert.equal(coverage.rows.length, envelope.rows.length, `${file}: every pooled row survives the swap`);
      await store.close?.();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("a json column shaped like the byte variant rebuilds as application data, never as bytes", async () => {
  const companion = JSON.parse(await readFile(resolve(goldens, "closure-every-column-kind.json"), "utf8"));
  const root = await tempRoot();
  try {
    const store = fileRangeStore(root)();
    await store.open("dev:alice");
    await store.commit({ deliveries: [{
      op: "shape", args: {}, state: "complete", data: { $row: { table: "allTypes", id: "j1" } }, next: null, seq: 1,
      rows: [{ table: "allTypes", id: "j1", row: {
        id: "j1", bytes: { Bytes: "00" }, decimal: 1, enum: "one", image: { id: "i", width: 1, height: 1 }, json: { Bytes: "00ff" },
        list: [], money: 1, optional: null, video: { id: "v", width: 1, height: 1, duration: 1 },
      } }],
      receipt: { ranges: [], absences: [], verdicts: [] },
    }] });
    const closure = closureFromCoverage(await store.coverage(), companion.schema);
    const row = (closure.rows[0]!.row as { Row: Record<string, unknown> }).Row;
    assert.deepEqual(row.json, { Map: { Bytes: { String: "00ff" } } }, "a json value is tagged by its declared type only");
    assert.deepEqual(row.bytes, { Bytes: "00" }, "a bytes column still tags as bytes");
    await store.close?.();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every corpus query round-trips through the store byte-identically and replays to the corpus expectation; a held answer is the covered case", async () => {
  const cases = (await corpus()).filter((item: any) =>
    item.certificate !== null && item.program.kind === "Query" && item.prelude.length === 0 && item.replacementReceipt === null);
  assert.ok(cases.length >= 80, `corpus queries: ${cases.length}`);
  const generation = hex("3");
  let checked = 0;
  let byteIdentical = 0;
  for (const testCase of cases) {
    const schemaHash = testCase.certificate.schema_hash as string;
    const args = Object.fromEntries(Object.entries(testCase.context.args as Record<string, Tagged>).map(([name, value]) => [name, wire(value)]));
    const fresh = testCase.expected.localState === "fresh";
    const root = await tempRoot();
    try {
      const facts = { generation, schemaHash, authEpoch: testCase.context.auth_epoch as number };
      await seedCoverage(fileRangeStore(root), testCase.context.viewer, testCase, facts,
        fresh ? { op: testCase.name, args, data: wire(testCase.expected.localResult), next: testCase.expected.next ?? null } : undefined);
      // Hydration: the coverage the store holds is the corpus receipt, byte for byte.
      const store = fileRangeStore(root)();
      await store.open(testCase.context.viewer);
      const rebuilt = closureFromCoverage(await store.coverage(), testCase.schema, schemaHash);
      assert.equal(canonical(rebuilt), canonical(holdableReceipt(testCase.receipt, schemaHash)), `${testCase.name}: hydration bytes`);
      const heldAnswer = fresh ? await store.answer(testCase.name, args) : undefined;
      await store.close?.();
      // Local evaluation through the client, offline, against the corpus expectation.
      const owner = corpusOwner({
        viewer: testCase.context.viewer, generation, schemaHash, schema: testCase.schema,
        programs: { [testCase.name]: { kind: "query", ir: typedProgram(testCase), certificate: testCase.certificate } },
      });
      const client = createClient({ url: "http://corpus.test", token: "bearer", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
      await client.ready;
      await client.offline();
      const local: any = await client.query((api as any)[testCase.name], args);
      const expected = testCase.expected;
      if (expected.localState === "fresh") {
        assert.ok(local.state === "complete" || local.state === "capped", `${testCase.name}: ${local.state} ${local.reason ?? ""}`);
        assert.equal(canonical(local.data), canonical(wire(expected.localResult)), `${testCase.name}: data`);
        if (Object.hasOwn(expected, "next")) assert.equal(local.next, expected.next, `${testCase.name}: next`);
        assert.equal(canonical(local.data), canonical(heldAnswer!.data), `${testCase.name}: the twin's replay is the held answer's bytes`);
        assert.equal(local.seq, heldAnswer!.seq, `${testCase.name}: the held answer's facts stay with the twin's data`);
        byteIdentical += 1;
      } else if (expected.localState === "partial") {
        assert.equal(local.state, "partial", `${testCase.name}: ${local.state}`);
        assert.deepEqual(local.sites.map((site: { site: string }) => site.site).sort(), [...expected.partialSites].sort(), `${testCase.name}: partial sites`);
        assert.ok(["never-held", "evicted", "computed-key"].includes(local.reason), `${testCase.name}: reason ${local.reason}`);
      } else if (expected.localState === "denied") {
        assert.equal(local.state, "denied", `${testCase.name}: ${local.state}`);
        assert.equal(local.rule, expected.errorCode, `${testCase.name}: rule`);
      } else if (!testCase.name.startsWith("asset-") && Object.values(testCase.context.args as Record<string, Tagged>).every((value) =>
        value === "Null" || "Bool" in value || "Int" in value || "String" in value || "Id" in value)) {
        // A refusal the corpus pins on its untyped `Scalar` arguments is not reproducible under typed descriptors;
        // a refusal from the run itself (an overflow, a bad cursor) leaves the read hydrating.
        assert.equal(local.state, "hydrating", `${testCase.name}: a locally refused program leaves the read hydrating`);
      }
      checked += 1;
      await client.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  assert.equal(checked, cases.length);
  assert.ok(byteIdentical >= 60, `covered replays proven byte-identical: ${byteIdentical}`);
});

/** The messenger corpus: `named-thread` (query), `named-send` and `named-delete-message` (mutations) share one schema. */
async function messenger() {
  const cases = await corpus();
  const byName = (name: string) => cases.find((item: any) => item.name === name);
  const thread = byName("named-thread");
  const send = byName("named-send");
  const remove = byName("named-delete-message");
  const hiddenRule = byName("named-hidden-rule");
  const schemaHash = thread.certificate.schema_hash as string;
  assert.equal(send.certificate.schema_hash, schemaHash);
  return {
    thread, send, remove, hiddenRule, schemaHash, schema: thread.schema,
    programs: {
      "named-thread": { kind: "query" as const, ir: typedProgram(thread), certificate: thread.certificate },
      "named-hidden-rule": { kind: "query" as const, ir: typedProgram(hiddenRule), certificate: hiddenRule.certificate },
      "named-send": { kind: "mutation" as const, ir: typedProgram(send), certificate: send.certificate },
      "named-delete-message": { kind: "mutation" as const, ir: typedProgram(remove), certificate: remove.certificate },
    },
  };
}

const threadArgs = { conversationId: "c1" };
const threadIds = (local: any) => (local.data as Array<{ message: { id: string } }>).map((row) => row.message.id);

test("program custody is fetched, held per generation on both carriers, serves a cold start with the owner cut, and is fenced by generation and auth epoch", async () => {
  const messengerCorpus = await messenger();
  const generation = hex("4");
  const root = await tempRoot();
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  const carriers = [
    { name: "file", factory: () => fileRangeStore(root) },
    { name: "IndexedDB", factory: () => indexedDbRangeStore({ indexedDB: database as any, locks: locks as any }) },
  ];
  try {
    for (const carrier of carriers) {
      let dead = false;
      const owner = corpusOwner({ viewer: "u1", generation, schemaHash: messengerCorpus.schemaHash, schema: messengerCorpus.schema, programs: messengerCorpus.programs, dead: () => dead });
      await seedCoverage(carrier.factory() as any, "u1", messengerCorpus.thread, { generation, schemaHash: messengerCorpus.schemaHash, authEpoch: 1 });
      const client = createClient({ url: "http://custody.test", token: "bearer", fetch: owner.fetch, offline: { store: carrier.factory() as any } });
      await client.ready;
      assert.equal(owner.requests.filter((path) => path.startsWith("/api/program")).length, 1, `${carrier.name}: the program was fetched once on open`);
      // A cold start with the network cut evaluates from custody.
      dead = true;
      const cold = await client.restart();
      await cold.offline();
      const local: any = await cold.query((api as any)["named-thread"], threadArgs);
      // A `Limit` range with no result page site is `capped` with `next: null`, as the engine's `query_state` says.
      assert.equal(local.state, "capped", `${carrier.name}: cold start ${local.state} ${local.reason ?? ""}`);
      assert.equal(local.next, null);
      assert.deepEqual(threadIds(local), ["message-00004", "message-00003", "message-00002"]);
      assert.equal(local.connection, "offline");
      await cold.close();
      dead = false;
      // The carrier holds the program keyed by its generation (read after the client released the partition's lock).
      const store = carrier.factory()();
      await store.open("u1");
      const held = await store.outbox.programs();
      assert.deepEqual(Object.keys(held), [generation], `${carrier.name}: held per generation`);
      assert.deepEqual(Object.keys(held[generation]!.programs).sort(), Object.keys(messengerCorpus.programs).sort());
      await store.wipe("u1");
      await store.close?.();
    }
    // The successor fence: coverage delivered under another generation is `hydrating` under this program.
    const owner = corpusOwner({ viewer: "u1", generation, schemaHash: messengerCorpus.schemaHash, schema: messengerCorpus.schema, programs: messengerCorpus.programs });
    await seedCoverage(fileRangeStore(root), "u1", messengerCorpus.thread, { generation: hex("5"), schemaHash: messengerCorpus.schemaHash, authEpoch: 1 });
    const fenced = createClient({ url: "http://custody.test", token: "bearer", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
    await fenced.ready;
    await fenced.offline();
    const stale: any = await fenced.query((api as any)["named-thread"], threadArgs);
    assert.equal(stale.state, "hydrating", "a predecessor generation's coverage never evaluates under the held program");
    await fenced.close();
    // The auth-epoch fence: a verdict minted under epoch 1 cannot vouch under epoch 2.
    for (const [authEpoch, expected] of [[1, "complete"], [2, "partial"]] as const) {
      const wipe = fileRangeStore(root)();
      await wipe.open("u1");
      await wipe.wipe("u1");
      await wipe.close?.();
      await seedCoverage(fileRangeStore(root), "u1", messengerCorpus.hiddenRule, { generation, schemaHash: messengerCorpus.schemaHash, authEpoch });
      const client = createClient({ url: "http://custody.test", token: "bearer", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
      await client.ready;
      await client.offline();
      const local: any = await client.query((api as any)["named-hidden-rule"], { id: "doc1" });
      assert.equal(local.state, expected, `epoch ${authEpoch}: ${local.state}`);
      if (expected === "partial") assert.equal(local.site, "missing-authority");
      else assert.deepEqual(local.data, { id: "doc1", title: "Private" });
      await client.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("partial reads name their reason: never-held, computed-key, and evicted", async () => {
  const messengerCorpus = await messenger();
  const generation = hex("6");
  const owner = corpusOwner({ viewer: "u1", generation, schemaHash: messengerCorpus.schemaHash, schema: messengerCorpus.schema, programs: messengerCorpus.programs });
  const facts = { generation, schemaHash: messengerCorpus.schemaHash, authEpoch: 1 };
  const root = await tempRoot();
  try {
    // never-held: a point the arguments name that no page ever delivered.
    await seedCoverage(fileRangeStore(root), "u1", messengerCorpus.hiddenRule, facts);
    let client = createClient({ url: "http://reasons.test", token: "bearer", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
    await client.ready;
    await client.offline();
    let local: any = await client.query((api as any)["named-hidden-rule"], { id: "doc-never" });
    assert.equal(local.state, "partial");
    assert.deepEqual(local.sites, [{ site: local.site, reason: "never-held" }]);
    await client.close();
    // computed-key: the thread's author read keys off a row field, and the users row is not held.
    const withoutUsers = { ...messengerCorpus.thread, receipt: { ...messengerCorpus.thread.receipt, rows: messengerCorpus.thread.receipt.rows.filter((row: any) => row.table !== "users") } };
    let wipe = fileRangeStore(root)();
    await wipe.open("u1"); await wipe.wipe("u1"); await wipe.close?.();
    await seedCoverage(fileRangeStore(root), "u1", withoutUsers, facts);
    client = createClient({ url: "http://reasons.test", token: "bearer", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
    await client.ready;
    await client.offline();
    local = await client.query((api as any)["named-thread"], threadArgs);
    assert.equal(local.state, "partial");
    assert.equal(local.reason, "computed-key");
    assert.equal(local.site, "programs.thread.1");
    await client.close();
    // evicted: the document was held and a tombstone took it out of the store (a primary-key read names its row).
    wipe = fileRangeStore(root)();
    await wipe.open("u1"); await wipe.wipe("u1"); await wipe.close?.();
    await seedCoverage(fileRangeStore(root), "u1", messengerCorpus.hiddenRule, facts, undefined, { tombstones: [{ table: "secretDocs", id: "doc1", seq: 2 }] });
    client = createClient({ url: "http://reasons.test", token: "bearer", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
    await client.ready;
    await client.offline();
    local = await client.query((api as any)["named-hidden-rule"], { id: "doc1" });
    assert.equal(local.state, "partial");
    assert.deepEqual(local.sites, [{ site: local.site, reason: "evicted" }]);
    await client.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an offline send is predicted into the thread in order with its trace, a delete is predicted out, an uncovered read queues without a trace, and the overlay leaves when the rows arrive", async () => {
  const messengerCorpus = await messenger();
  const generation = hex("7");
  const owner = corpusOwner({ viewer: "u1", generation, schemaHash: messengerCorpus.schemaHash, schema: messengerCorpus.schema, programs: messengerCorpus.programs });
  const facts = { generation, schemaHash: messengerCorpus.schemaHash, authEpoch: 1 };
  const root = await tempRoot();
  try {
    await seedCoverage(fileRangeStore(root), "u1", messengerCorpus.thread, facts);
    const client = createClient({ url: "http://predict.test", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
    await client.ready;
    // The login mints the grant and lands the program in the same custody (LLP 1012 §7).
    await client.auth.login({ email: "u1@example.com", password: "pw" });
    await client.offline();
    const sent = await client.mutation((api as any)["named-send"], { conversationId: "c1", body: "hello", at: 20 });
    assert.equal(sent.state, "queued");
    if (sent.state !== "queued") throw new Error("unreachable");
    const [entry] = await client.outbox.entries();
    assert.equal(entry!.predicted, true, "every point read and rule input was covered");
    assert.equal(entry!.omitted, undefined, "no maintained target on messages: nothing is omitted");
    const membership = messengerCorpus.thread.receipt.rows.find((row: any) => row.table === "memberships");
    assert.deepEqual(entry!.trace.points, [{
      table: "memberships", index: "byConvUser", key: ["c1", "u1"], digest: sha256(canonical(wire(membership.row))),
    }], "the trace carries the point read with the digest of the wire row it saw");
    assert.ok(entry!.trace.verdicts.some((verdict) =>
      verdict.inputsDigest === sha256(canonical(["memberships", "byConvUser", ["c1", "u1"]])) && verdict.result === true),
      "the insert rule's verdict is traced with the wire inputs digest");
    const local: any = await client.query((api as any)["named-thread"], threadArgs);
    assert.equal(local.state, "capped");
    assert.deepEqual(threadIds(local), [sent.ids[0], "message-00004", "message-00003"], "the queued send is inside the thread, in order");
    assert.deepEqual(local.predicted, [entry!.intent]);
    assert.equal(local.data[0].message.body, "hello");
    // A delete is predicted out of the thread.
    const removed = await client.mutation((api as any)["named-delete-message"], { id: "message-00004" });
    assert.equal(removed.state, "queued");
    const afterDelete: any = await client.query((api as any)["named-thread"], threadArgs);
    assert.deepEqual(threadIds(afterDelete), [sent.ids[0], "message-00003", "message-00002"]);
    // An uncovered point read (a membership never held) queues without a prediction or a trace.
    const uncovered = await client.mutation((api as any)["named-send"], { conversationId: "c9", body: "elsewhere", at: 21 });
    assert.equal(uncovered.state, "queued");
    const entries = await client.outbox.entries();
    assert.equal(entries[2]!.predicted, undefined);
    assert.deepEqual(entries[2]!.trace, { points: [], verdicts: [] }, "an uncovered read leaves the server to judge");
    // Online: the intents replay under their envelopes; a commit with no tail to fetch keeps its overlay until the rows arrive.
    await client.online();
    await client.outbox.settled();
    const settled = await client.outbox.entries();
    assert.deepEqual(settled.map((item) => item.state), ["committed", "committed", "committed"]);
    assert.equal(owner.executions[0]!.ids[0], sent.ids[0], "the server minted the pinned id the prediction used");
    assert.deepEqual(JSON.parse(JSON.stringify(entry!.trace)), (await client.outbox.entries())[0]!.trace, "the trace rode the envelope unchanged");
    await client.close();
    const store = fileRangeStore(root)();
    await store.open("u1");
    let held = await store.outbox.overlay();
    assert.ok(held[entry!.intent], "a committed intent with no rows in its swap keeps its overlay");
    await store.commit({ deliveries: [{
      op: "tail", args: {}, state: "complete", data: { $row: { table: "messages", id: sent.ids[0]! } }, next: null, seq: 30,
      rows: [{ table: "messages", id: sent.ids[0]!, row: { id: sent.ids[0], conversationId: "c1", authorId: "u1", body: "hello", at: 20 } }],
      receipt: { ranges: [], absences: [], verdicts: [] },
    }] });
    held = await store.outbox.overlay();
    assert.equal(held[entry!.intent], undefined, "the server's row replaced the prediction");
    await store.close?.();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// @ref LLP 1012#7-writes-offline — the overlay drops only on authoritative
// arrival or after two successful resumes at or after the commit seq.
test("a committed intent's overlay survives unrelated answers and an empty current-tail page; leaves with its predicted row; and two resumes retire a stranded prediction", async () => {
  const base = { grant: "g", offset: 0, count: 3, ids: ["m", "d", "x"], op: "deliveries.post", args: { conversationId: "c1" }, issuedSeq: 0, createdAt: 1, updatedAt: 1 };
  const overlay = [{ table: "messages", id: "m", row: { id: "m", body: "predicted" } }, { table: "deliveries", id: "d", row: { id: "d", messageId: "m" } }];
  const committed = { ...base, intent: "g:0", state: "committed" as const, predicted: true, response: { state: "committed", seq: 30, data: { id: "m" } } };
  const page = (op: string, args: unknown, seq: number, rows: Array<{ table: string; id: string; row: Record<string, unknown> }>) => ({
    op, args, state: "complete" as const, data: rows.map((row) => ({ $row: { table: row.table, id: row.id } })), next: null, seq, rows,
    receipt: { ranges: [], absences: [], verdicts: [] },
  });
  const cases: Array<[string, ReturnType<typeof page>, boolean]> = [
    ["another conversation's thread page", page("deliveries.thread", { conversationId: "c2" }, 32, [
      { table: "deliveries", id: "d-c2", row: { id: "d-c2", messageId: "m-c2" } }, { table: "messages", id: "m-c2", row: { id: "m-c2", body: "elsewhere" } },
    ]), false],
    ["an unrelated row of the predicted table", page("deliveries.thread", { conversationId: "c1" }, 32, [
      { table: "deliveries", id: "d-other", row: { id: "d-other", messageId: "m-other" } },
    ]), false],
    ["an empty page at the held tail position", page("deliveries.inbox", { c: "cursor-9" }, 32, []), false],
    ["a delivery holding the predicted message row", page("deliveries.thread", { conversationId: "c1" }, 32, [
      { table: "messages", id: "m", row: { id: "m", body: "predicted" } },
    ]), true],
  ];
  for (const [label, arrival, leaves] of cases) {
    const root = await tempRoot();
    try {
      const store = fileRangeStore(root)();
      await store.open("viewer");
      await store.commit({
        watermark: { op: "deliveries.inbox", args: { c: null }, watermark: "cursor-9", updatedAt: 1 },
        outbox: { put: [{ ...base, intent: "g:0", state: "queued", predicted: true }] }, overlay: { put: { "g:0": overlay } },
      });
      await store.commit({ outbox: { put: [committed] } });
      assert.ok((await store.outbox.overlay())["g:0"], `${label}: a commit with no rows in its swap keeps its overlay`);
      await store.commit({ deliveries: [arrival] });
      assert.equal((await store.outbox.overlay())["g:0"] !== undefined, !leaves, `${label}: the overlay ${leaves ? "did not leave" : "left"}`);
      assert.equal((await store.outbox.get("g:0"))!.predicted, leaves ? undefined : true, `${label}: prediction follows overlay custody`);
      await store.close?.();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  // The bound also runs when the selected log is stationary.
  const root = await tempRoot();
  try {
    const store = fileRangeStore(root)();
    await store.open("viewer");
    await store.commit({
      watermark: { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "cursor-9", updatedAt: 1 },
      outbox: { put: [{ ...base, intent: "g:0", state: "queued", predicted: true }] }, overlay: { put: { "g:0": overlay } },
    });
    await store.commit({ outbox: { put: [committed] } });
    await store.commit({ resumeSeq: 31 });
    assert.ok((await store.outbox.overlay())["g:0"], "one resume keeps the overlay");
    await store.commit({ resumeSeq: 31 });
    assert.equal((await store.outbox.overlay())["g:0"], undefined, "the stranded overlay did not leave at the bound");
    const retired = (await store.outbox.get("g:0"))!;
    assert.equal(retired.state, "committed", "the entry itself stays until its rows arrive or the app dismisses it");
    assert.equal(retired.predicted, undefined, "the entry is retired from prediction: the app renders it from its args");
    await store.close?.();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// `hydrating` is a typed refusal, never a catch-all: a bug in the hydrate path surfaces.
test("a bug in the hydrate path surfaces as a refusal, never as hydrating", async () => {
  const messengerCorpus = await messenger();
  const generation = hex("d");
  const owner = corpusOwner({ viewer: "u1", generation, schemaHash: messengerCorpus.schemaHash, schema: messengerCorpus.schema, programs: messengerCorpus.programs });
  const root = await tempRoot();
  try {
    await seedCoverage(fileRangeStore(root), "u1", messengerCorpus.thread, { generation, schemaHash: messengerCorpus.schemaHash, authEpoch: 1 });
    // Custody read back from the carrier with a schema that throws a ReferenceError the moment the hasher walks it.
    const schema = structuredClone(messengerCorpus.schema);
    Object.defineProperty(schema.tables.messages, "columns", { enumerable: true, configurable: true, get() { throw new ReferenceError("hydrate path bug"); } });
    const held = {
      generation, schemaHash: messengerCorpus.schemaHash, schema,
      programs: Object.fromEntries(Object.entries(messengerCorpus.programs).map(([name, entry]) => [name, {
        kind: entry.kind, planHash: entry.certificate.plan_hash, ir: entry.ir, certificate: entry.certificate,
      }])),
    };
    const factory = fileRangeStore(root);
    const store = () => {
      const inner = factory();
      inner.outbox.programs = async () => ({ [generation]: held }) as any;
      return inner;
    };
    const client = createClient({ url: "http://bug.test", token: "bearer", fetch: owner.fetch, offline: { store } });
    await client.ready;
    await client.offline();
    await assert.rejects(client.query((api as any)["named-thread"], threadArgs), (error: unknown) =>
      error instanceof SnapbackRefusal && /hydrate path bug/.test(error.message), "the ReferenceError was swallowed as hydrating");
    await client.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — a rotation
// under the client's feet: held coverage is superseded, never stale-exact, until
// the reset path rebuilds it under the live generation.
test("a delivery under a new generation supersedes held coverage: offline reads are hydrating, not stale-exact, until the reset path lands the live program and fresh coverage", async () => {
  const messengerCorpus = await messenger();
  const before = hex("e");
  const after = hex("f");
  const owner = corpusOwner({ viewer: "u1", generation: before, schemaHash: messengerCorpus.schemaHash, schema: messengerCorpus.schema, programs: messengerCorpus.programs });
  const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const { rows, receipt } = wireReceipt(messengerCorpus.thread.receipt);
  const requests: string[] = [];
  let rotated = false;
  let seq = 20;
  // The owner after a deploy: the live generation everywhere, and a resume under the old facts refused.
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (!rotated) return owner.fetch(input, init);
    requests.push(url.pathname + url.search);
    if (url.pathname === "/api/manifest") {
      return respond({ ...(await (await owner.fetch(input, init)).json()), programGeneration: after });
    }
    if (url.pathname === "/api/program") {
      if (url.searchParams.get("generation") !== after) return respond({ code: "E_OP_UNKNOWN", family: "op", message: "not active", guide: "op/manifest" }, 404);
      return respond({ ...(await (await owner.fetch(`http://rotation.test/api/program?generation=${before}`, init)).json()), generation: after });
    }
    if (url.pathname === "/api/query") {
      seq += 1;
      return respond({
        protocol: 1, generation: after, schemaHash: messengerCorpus.schemaHash, planHash: hex("5"), authority: { principal: "u1", authEpoch: 1 },
        state: "complete", data: [], next: null, seq, rows, receipt, validator: hex("6"),
      });
    }
    if (url.pathname === "/api/resume") {
      if (JSON.parse(String(init?.body)).generation !== after) {
        return respond({
          code: "E_OFFLINE_RESET", family: "offline", message: "the program generation changed", rewrite: "drop coverage and cold-drain",
          guide: "offline", generation: after, schemaHash: messengerCorpus.schemaHash,
        }, 409);
      }
      return respond({ seq, generation: after, schemaHash: messengerCorpus.schemaHash, authority: { principal: "u1", authEpoch: 1 }, log: { unchanged: true }, mounted: [] });
    }
    return owner.fetch(input, init);
  };
  const root = await tempRoot();
  try {
    await seedCoverage(fileRangeStore(root), "u1", messengerCorpus.thread, { generation: before, schemaHash: messengerCorpus.schemaHash, authEpoch: 1 }, undefined, {
      watermark: { op: "coverage", args: {}, watermark: null, validator: hex("1"), generation: before, schemaHash: messengerCorpus.schemaHash, authEpoch: 1, updatedAt: 1 },
    });
    const client = createClient({ url: "http://rotation.test", token: "bearer", fetch, offline: { store: fileRangeStore(root) } });
    await client.ready;
    await client.offline();
    const exact: any = await client.query((api as any)["named-thread"], threadArgs);
    assert.equal(exact.state, "capped", "the seeded coverage evaluates under the held program");
    await client.online();
    rotated = true;
    // The server deployed: an online read carries the successor generation's envelope.
    const live: any = await client.query((api as any)["named-thread"], threadArgs);
    assert.equal(live.state, "complete", "the live answer reaches the caller; a rotation is not a refusal");
    await client.offline();
    const stale: any = await client.query((api as any)["named-thread"], threadArgs);
    assert.deepEqual(stale, { state: "hydrating", live: false, connection: "offline" }, "superseded coverage is neither exact nor partial");
    // The reset path: the resume under the old facts is refused, coverage dropped, the live program fetched, then fresh coverage held.
    await client.online();
    assert.ok(requests.includes(`/api/program?generation=${after}`), `the reset path did not fetch the live generation's program: ${requests.join(" ")}`);
    const rebuilt: any = await client.query((api as any)["named-thread"], threadArgs);
    assert.equal(rebuilt.state, "complete");
    await client.offline();
    const fresh: any = await client.query((api as any)["named-thread"], threadArgs);
    assert.equal(fresh.state, "capped", `after the reset path the twin evaluates under the live generation: ${JSON.stringify(fresh)}`);
    await client.close();
    const store = fileRangeStore(root)();
    await store.open("u1");
    const coverage = await store.coverage();
    assert.equal(coverage.facts?.generation, after, "the rebuilt coverage carries the live generation");
    assert.equal(coverage.superseded, undefined, "the supersession cleared with the reset");
    assert.deepEqual(Object.keys(await store.outbox.programs()), [after], "one generation is held: the live one");
    await store.close?.();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a settlement swap that also carries a prediction never resurrects what it settled", async () => {
  const root = await tempRoot();
  try {
    const store = fileRangeStore(root)();
    await store.open("dev:alice");
    const base = { grant: "g", offset: 0, count: 2, ids: ["a", "b"], op: "x", args: {}, issuedSeq: 0, createdAt: 1, updatedAt: 1 };
    await store.commit({ outbox: { put: [{ ...base, intent: "g:0", state: "queued" }] }, overlay: { put: { "g:0": [{ table: "t", id: "a", row: { id: "a" } }] } } });
    await store.commit({
      outbox: { put: [{ ...base, intent: "g:0", state: "rejected" }] },
      overlay: { put: { "g:0": [{ table: "t", id: "a", row: { id: "a", late: true } }] } },
    });
    assert.deepEqual(await store.outbox.overlay(), {}, "the rejected intent's overlay is gone whatever the swap's order");
    await store.close?.();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("E_OFFLINE_RESET re-fetches the live generation's program, replaces the bounds whole, and drains the queue", async () => {
  const messengerCorpus = await messenger();
  const successorSend = structuredClone(messengerCorpus.programs["named-send"]);
  successorSend.certificate.write_sites = [{ table: "messages", kind: "Insert", max_rows: 3 }];
  const owner = corpusOwner({
    viewer: "u1", generation: hex("8"), schemaHash: messengerCorpus.schemaHash, schema: messengerCorpus.schema,
    programs: messengerCorpus.programs,
    successor: { generation: hex("9"), programs: { ...messengerCorpus.programs, "named-send": successorSend } },
  });
  const root = await tempRoot();
  try {
    await seedCoverage(fileRangeStore(root), "u1", messengerCorpus.thread, { generation: hex("8"), schemaHash: messengerCorpus.schemaHash, authEpoch: 1 }, undefined, {
      watermark: { op: "coverage", args: {}, watermark: null, validator: hex("1"), generation: hex("8"), schemaHash: messengerCorpus.schemaHash, authEpoch: 1, updatedAt: 1 },
    });
    const client = createClient({ url: "http://reset.test", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
    await client.ready;
    await client.auth.login({ email: "u1@example.com", password: "pw" });
    await client.offline();
    const queued = await client.mutation((api as any)["named-send"], { conversationId: "c1", body: "before the reset", at: 22 });
    assert.equal(queued.state, "queued");
    assert.equal(queued.state === "queued" && queued.ids.length, 2, "priced from the first generation's bound");
    await client.online();
    await client.outbox.settled();
    assert.ok(owner.requests.includes(`/api/program?generation=${hex("9")}`), "the reset re-fetched the live generation's program");
    const store = fileRangeStore(root)();
    await store.open("u1");
    assert.equal((await store.outbox.bounds())["named-send"], 3, "the bounds were replaced whole");
    assert.deepEqual(Object.keys(await store.outbox.programs()), [hex("9")], "one generation is held: the live one");
    await store.close?.();
    assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["committed"], "the queue drained after the reset");
    await client.offline();
    const repriced = await client.mutation((api as any)["named-send"], { conversationId: "c1", body: "after the reset", at: 23 });
    assert.equal(repriced.state === "queued" && repriced.ids.length, 4, "the next enqueue prices from the new bound");
    await client.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — one hasher,
// recomputed on the hydrate path: an unseen schema shape is refused, never
// hashed equal to a known one, and the twin is hydrating under it.
test("an unseen schema shape is hydrating: a novel index field or column payload is refused, never hashes as the known shape, and a write queues without a prediction", async () => {
  const messengerCorpus = await messenger();
  const generation = hex("b");
  const facts = { generation, schemaHash: messengerCorpus.schemaHash, authEpoch: 1 };
  const shapes: Array<[string, (schema: any) => void, RegExp]> = [
    ["a novel index field", (schema) => { schema.tables.memberships.indexes.byConvUser.shard = 3; }, /index field shard/],
    ["a novel column payload", (schema) => { schema.tables.messages.columns.body = { Text: { max: 4000, collation: "und" } }; }, /column\.Text field collation/],
    ["a novel channel-argument List field", (schema) => {
      schema.channels = { typing: { args: { ids: { List: { of: "Id", max: 4, shard: 1 } } }, publish: "Allow", subscribe: "Allow", ttl_ms: 1_000 } };
    }, /arg\.List field shard/],
  ];
  for (const [label, mutate, refusal] of shapes) {
    const novel = structuredClone(messengerCorpus.schema);
    mutate(novel);
    assert.throws(() => schemaDigest(novel), refusal, `${label}: the hasher dropped bytes instead of refusing`);
    assert.equal(schemaDigest(messengerCorpus.schema), messengerCorpus.schemaHash, "the known shape still hashes as Rust does");
    const root = await tempRoot();
    try {
      await seedCoverage(fileRangeStore(root), "u1", messengerCorpus.thread, facts);
      const owner = corpusOwner({ viewer: "u1", generation, schemaHash: messengerCorpus.schemaHash, schema: novel, programs: messengerCorpus.programs });
      const client = createClient({ url: "http://novel.test", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
      await client.ready;
      await client.auth.login({ email: "u1@example.com", password: "pw" });
      await client.offline();
      const local: any = await client.query((api as any)["named-thread"], threadArgs);
      assert.equal(local.state, "hydrating", `${label}: the twin evaluated under a schema it cannot hash`);
      const sent = await client.mutation((api as any)["named-send"], { conversationId: "c1", body: "under a novel schema", at: 30 });
      assert.equal(sent.state, "queued", `${label}: the write still queues (the server judges)`);
      const [entry] = await client.outbox.entries();
      assert.equal(entry!.predicted, undefined, `${label}: no prediction was committed`);
      assert.deepEqual(entry!.trace, { points: [], verdicts: [] }, `${label}: no trace was minted`);
      await client.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  // An unknown rule variant hashes deterministically and never as the known schema.
  const novelRule = structuredClone(messengerCorpus.schema);
  novelRule.tables.messages.rules.read = { Within: { until: 5, since: 1 } };
  const reordered = structuredClone(messengerCorpus.schema);
  reordered.tables.messages.rules.read = { Within: { since: 1, until: 5 } };
  assert.equal(schemaDigest(novelRule), schemaDigest(reordered));
  assert.notEqual(schemaDigest(novelRule), messengerCorpus.schemaHash);
  // The hydrate path recomputes the hash: coverage under a schema whose hash disagrees with the caller's is refused, not rebuilt.
  const root = await tempRoot();
  try {
    await seedCoverage(fileRangeStore(root), "u1", messengerCorpus.thread, facts);
    const store = fileRangeStore(root)();
    await store.open("u1");
    const coverage = await store.coverage();
    assert.throws(() => closureFromCoverage(coverage, messengerCorpus.schema, hex("f")), /does not match the held program/);
    assert.equal(closureFromCoverage(coverage, messengerCorpus.schema).schema_hash, messengerCorpus.schemaHash, "the rebuilt receipt carries the recomputed hash");
    await store.close?.();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** A hand-built messenger log: the chat template's shape, small enough to seed a drained inbox by hand. */
function logProgram() {
  const schema = {
    tables: {
      deliveries: {
        columns: { id: "Id", recipient: "Principal", conversationId: "Id", messageId: "Id", at: "Time" },
        indexes: {
          byId: { columns: ["id"], unique: true },
          byRecipientAt: { columns: ["recipient", "at", "id"], unique: false },
          byRecipientConversationAt: { columns: ["recipient", "conversationId", "at", "id"], unique: false },
        },
        rules: { read: { Eq: [{ Field: "recipient" }, "Viewer"] }, insert: "Deny", update: "Deny", delete: "Deny" },
        constraints: [], retain: "until-revoked",
      },
      messages: {
        columns: { id: "Id", conversationId: "Id", body: { Text: { max: 100 } } },
        indexes: { byId: { columns: ["id"], unique: true } },
        rules: { read: { Exists: { table: "memberships", index: "byConversationPrincipal", key: [{ Field: "conversationId" }, "Viewer"], provenance: "Shape" } }, insert: "Deny", update: "Deny", delete: "Deny" },
        constraints: [], retain: "until-revoked",
      },
      memberships: {
        columns: { id: "Id", conversationId: "Id", principal: "Principal" },
        indexes: { byId: { columns: ["id"], unique: true }, byConversationPrincipal: { columns: ["conversationId", "principal"], unique: true } },
        rules: { read: { Exists: { table: "memberships", index: "byConversationPrincipal", key: [{ Field: "conversationId" }, "Viewer"], provenance: "Shape" } }, insert: "Deny", update: "Deny", delete: "Deny" },
        constraints: [], retain: "until-revoked",
      },
    },
    maintains: [],
  };
  const thread = {
    name: "thread", kind: "Query", args: { conversationId: "Id" }, read_time_granularity_ms: null,
    body: [
      { Require: { code: "MEMBERSHIP_REQUIRED", condition: { Exists: { site: "thread.0", table: "memberships", index: "byConversationPrincipal", key: [{ Variable: "conversationId" }, { Input: "Viewer" }], provenance: "Shape" } } } },
      { Const: { name: "page", value: { Scan: { site: "thread.1", table: "deliveries", index: "byRecipientConversationAt", prefix: [{ Input: "Viewer" }, { Variable: "conversationId" }], order: "Desc", take: { Literal: 50 }, after: null, before: null, range: null, merge_site: null, opaque_cursor: false, provenance: "Shape" } } } },
      { Const: { name: "rows", value: { Array: [] } } },
      { For: { binding: "row", domain: { DerivedArray: { value: { Variable: "page" }, max: 50 } }, body: [
        { Push: { target: "rows", value: { Object: { id: { Field: { base: { Variable: "row" }, name: "id" } }, message: { Get: { site: "thread.2", table: "messages", index: "byId", key: [{ Field: { base: { Variable: "row" }, name: "messageId" } }], provenance: "Shape" } } } } } },
      ] } },
      { Return: { Variable: "rows" } },
    ],
  };
  const schemaHash = schemaDigest(schema);
  const certificate = { plan_hash: sha256(JSON.stringify(thread)), schema_hash: schemaHash, completeness: "Complete", read_sites: [{ site: "thread.1", hoist: true }], merge_sites: [], write_sites: [] };
  const ruleHash = sha256(`[${JSON.stringify(schemaHash)},${JSON.stringify(schema.tables.deliveries.rules.read)}]`);
  const delivery = (id: string, conversationId: string, messageId: string, at: number) => ({ table: "deliveries", id, row: { id, recipient: "viewer", conversationId, messageId, at } });
  const page = (after: unknown, rowIds: string[], stop: "Limit" | "Exhausted") => ({
    site: "inbox.0", table: "deliveries", index: "byRecipientAt", prefix: ["viewer"], order: "Asc", take: 3,
    after, before: null, gt: null, gte: null, lt: null, lte: null, ruleHash, rowIds, stop, absence: false,
  });
  return { schema, schemaHash, thread, certificate, delivery, page };
}

// @ref LLP 1012#6-reads-offline — the drained-prefix rule through the store: a
// swap that evicts a middle row of a drained page leaves a hole the page
// remembers, and the never-opened thread over that prefix is partial/evicted.
test("evicting a middle row of a drained page makes the never-opened thread partial with reason evicted, not fresh", async () => {
  const log = logProgram();
  const generation = hex("c");
  const facts = { generation, schemaHash: log.schemaHash, authEpoch: 1 };
  const rows = [
    log.delivery("d1", "c1", "m1", 1), log.delivery("d2", "c1", "m2", 2), log.delivery("d3", "c1", "m3", 3), log.delivery("d4", "c1", "m4", 4),
    { table: "messages", id: "m1", row: { id: "m1", conversationId: "c1", body: "one" } },
    { table: "messages", id: "m2", row: { id: "m2", conversationId: "c1", body: "two" } },
    { table: "messages", id: "m3", row: { id: "m3", conversationId: "c1", body: "three" } },
    { table: "messages", id: "m4", row: { id: "m4", conversationId: "c1", body: "four" } },
    { table: "memberships", id: "mem1", row: { id: "mem1", conversationId: "c1", principal: "viewer" } },
  ];
  const owner = corpusOwner({ viewer: "viewer", generation, schemaHash: log.schemaHash, schema: log.schema, programs: { thread: { kind: "query", ir: log.thread, certificate: log.certificate } } });
  const root = await tempRoot();
  try {
    const store = fileRangeStore(root)();
    await store.open("viewer");
    // The drained inbox: two chained pages (the second's `after` is the first's last suffix) to Exhausted, filed under the cursor keys.
    await store.commit({
      deliveries: [
        { op: "inbox", args: { c: null }, state: "capped", data: [], next: "cursor-1", seq: 1, validator: hex("1"), rows, receipt: { ranges: [log.page(null, ["d1", "d2", "d3"], "Limit")], absences: [], verdicts: [] } },
        { op: "inbox", args: { c: "cursor-1" }, state: "complete", data: [], next: null, seq: 1, validator: hex("2"), rows: [rows[3]!], receipt: { ranges: [log.page([3, "d3"], ["d4"], "Exhausted")], absences: [], verdicts: [] } },
      ],
      facts,
    });
    await store.close?.();
    const client = createClient({ url: "http://holes.test", token: "bearer", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
    await client.ready;
    await client.offline();
    const fresh: any = await client.query((api as any).thread, { conversationId: "c1" });
    assert.equal(fresh.state, "complete", `the drained log did not cover the never-opened thread: ${fresh.reason ?? ""} ${fresh.site ?? ""}`);
    assert.deepEqual(fresh.data.map((row: any) => row.message.body), ["four", "three", "two", "one"]);
    await client.close();
    // A tombstone evicts d2, the middle of the first page: the page records the hole and the thread is partial/evicted.
    const evicting = fileRangeStore(root)();
    await evicting.open("viewer");
    await evicting.commit({ tombstones: [{ table: "deliveries", id: "d2", seq: 2 }] });
    const coverage = await evicting.coverage();
    assert.deepEqual(coverage.ranges.map((range) => [range.rowIds, range.evictedIds]), [[["d1", "d3"], ["d2"]], [["d4"], undefined]], "the page remembers what it lost");
    await evicting.close?.();
    const reopened = createClient({ url: "http://holes.test", token: "bearer", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
    await reopened.ready;
    await reopened.offline();
    const holed: any = await reopened.query((api as any).thread, { conversationId: "c1" });
    assert.equal(holed.state, "partial", "a drained page with an interior eviction still covered the thread");
    assert.deepEqual(holed.sites, [{ site: "thread.1", reason: "evicted" }]);
    await reopened.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a delivery whose generation has no held program is hydrating until the program lands", async () => {
  const messengerCorpus = await messenger();
  const generation = hex("a");
  let served = false;
  const owner = corpusOwner({ viewer: "u1", generation, schemaHash: messengerCorpus.schemaHash, schema: messengerCorpus.schema, programs: messengerCorpus.programs });
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes("/api/program") && !served) throw new TypeError("fetch failed");
    return owner.fetch(input, init);
  };
  const root = await tempRoot();
  try {
    await seedCoverage(fileRangeStore(root), "u1", messengerCorpus.thread, { generation, schemaHash: messengerCorpus.schemaHash, authEpoch: 1 });
    const client = createClient({ url: "http://hydrating.test", token: "bearer", fetch, offline: { store: fileRangeStore(root) } });
    await client.ready;
    await client.offline();
    const before: any = await client.query((api as any)["named-thread"], threadArgs);
    assert.equal(before.state, "hydrating", "coverage without its program cannot be evaluated");
    served = true;
    await client.online();
    await client.query((api as any)["named-thread"], threadArgs);
    await client.offline();
    const after: any = await client.query((api as any)["named-thread"], threadArgs);
    assert.equal(after.state, "capped");
    await client.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
