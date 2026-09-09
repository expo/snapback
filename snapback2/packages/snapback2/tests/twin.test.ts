import { assertRefused } from "./live-fixture.ts";
import { isRefusalError } from "../dist/client-observed-test.mjs";
import { subscribe } from "../src/internal.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { api, createClient } from "../dist/client.mjs";
import { RefusalError } from "../dist/client-observed-test.mjs";
import { decodeDeliveryEnvelope, schemaDigest, toClosureReceipt } from "../dist/index.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { tagReceipt, tagWireRow, canonicalProgramJson, CURRENT_EVALUATOR, CURRENT_VALUE_MODEL_VERSION, Twin, ClientStore, OfflineRuntime, PersistentRangeStore } from "../dist/sqlite-test.mjs";
import { sqliteFactory } from "./sqlite-fixture.ts";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { engineId } from "./fake-owner.ts";
import { fixtureClient } from "./live-fixture.ts";

// @ref LLP 1012#6-reads-offline — atomic snapshots retain issuing receipts, pooled rows,
// partial reasons, covered answers and program custody under successor/auth-epoch fences.
// @ref LLP 1012#7-writes-offline — prediction: the overlay keyed by the intent,
// the trace of point digests and verdicts, discarded when the rows arrive.

const here = dirname(fileURLToPath(import.meta.url));
const corpusRoot = process.env.SNAPBACK2_CORPUS ?? resolve(here, "../../../corpus");
const goldens = resolve(corpusRoot, "offline");
// Explicit issued metadata for the native search fixtures with a returned page.
const corpusPageCursors: Record<string, string> = Object.fromEntries([
  "search-held-global-first-page", "search-held-global-first-page-next", "search-chat-optional-field-union",
].map(name => [name, "c"]));

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
    args[name] = testCase.program.args[name] !== "Scalar" ? testCase.program.args[name]
      : value === undefined ? { Optional: "Id" } : descriptorFor(value);
  }
  return { ...testCase.program, args };
}

/** The corpus receipt as the wire delivers it: pooled rows, camelCase ranges, primary absences, public verdicts. */
function wireReceipt(receipt: any): { rows: any[]; receipt: any } {
  return { rows: receipt.rows.map((row: any) => ({ table: row.table, id: row.id, row: wire(row.row) })), receipt: {
    ranges: receipt.ranges.map((range: any) => ({
      site: range.site, table: range.table, index: range.index,
      prefix: range.prefix.map((atom: any) => 'Scalar' in atom ? { Scalar: wire(atom.Scalar) } : atom), order: range.order, take: range.take,
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
  } };
}

/** The corpus receipt as the store can hold it: `n2_suffix` never crosses the wire, an absence a held row disproves is dropped. */
function holdableReceipt(receipt: any, schemaHash: string): unknown {
  const held = new Set(receipt.rows.map((row: any) => `${row.table}\u0000${row.id}`));
  return {
    schema_hash: schemaHash, rows: receipt.rows,
    ranges: receipt.ranges.map((range: any) => ({ ...range, n2_suffix: null })),
    absences: receipt.absences.filter(([table, index, key]: any) =>
      !(index === "byId" && key.length === 1 && key[0] !== "Null" && "Id" in key[0] && held.has(`${table}\u0000${key[0].Id}`))),
    verdicts: receipt.verdicts,
  };
}

/** Admit one issuing answer from an atomic carrier snapshot; cold and warm paths use the same receipt pool. */
function receiptFromSnapshot(snapshot: any, schema: any, schemaHash: string, ir?: any): any {
  assert.equal(schemaDigest(schema), schemaHash, 'snapshot schema identity matches its issuing program');
  const answer: any = Object.values(snapshot.answers).find((a: any) => a.op === 'coverage') ?? Object.values(snapshot.answers)[0];
  const rows = answer.refs.flatMap((ref: any) => {
    const body = snapshot.rows[`${ref.table}\0${ref.id}`];
    return body ? [{ ...ref,row: tagWireRow(schema,ref.table,body.row) }] : [];
  });
  const receipt = { schema_hash: schemaHash,rows,...tagReceipt(schema,answer.receipt,ir) };
  for (const range of receipt.ranges) if (range.halo && !rows.some((r: any) => r.table === range.halo.table && r.id === range.halo.id)) range.halo = null;
  return { ...receipt, ranges: receipt.ranges.map(({ held_suffix: _local, ...range }: any) => range) };
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
  programs: Record<string, { kind: "query" | "mutation"; ir: unknown; certificate: any; cursor?: string }>;
  /** A second generation the owner moves to: the first resume answers `E_OFFLINE_RESET`, then serves it. */
  successor?: { generation: string; programs: Record<string, { kind: "query" | "mutation"; ir: unknown; certificate: any; cursor?: string }> };
  dead?: () => boolean;
}

/** A synthetic owner double (typed argument narrowing rebinds its certificate, not native proof) over a corpus schema: manifest, program custody, login/me, resume, replayed mutations. */
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
      kind: entry.kind, cursor: entry.cursor, planHash: sha256(canonicalProgramJson(entry.ir)), ir: entry.ir,
      certificate: { ...entry.certificate, plan_hash: sha256(canonicalProgramJson(entry.ir)),
        value_model_version: CURRENT_VALUE_MODEL_VERSION, evaluator_version: CURRENT_EVALUATOR },
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
    if (url.pathname === "/api/manifest") return json({
      generation: "schema-generation", programGeneration: current.generation, channels: {}, auth: {}, tables: {},
      ops: Object.fromEntries(Object.entries(current.programs).map(([name, entry]) => [name, {
        kind: entry.kind, cursor: entry.cursor, args: (entry.ir as { args?: unknown }).args ?? {}, planHash: entry.certificate.plan_hash,
      }])),
    });
    if (url.pathname === "/api/program") {
      const generation = url.searchParams.get("generation");
      if (generation !== current.generation) return json({ code: "E_OP_UNKNOWN", family: "op", message: "not active", guide: "op/manifest" }, 404);
      return json(payload(current.generation, current.programs));
    }
    if (url.pathname === "/api/auth/me") return json({ viewer: options.viewer, kind: "user" });
    if (url.pathname === "/api/auth/login") return json({ token: `token-${options.viewer}`, viewer: options.viewer, kind: "user", grant: mint() });
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
  factory: ReturnType<typeof fileRangeStore>, viewer: string, testCase: any,
  facts: { generation: string; schemaHash: string; authEpoch: number },
  held?: { op: string; args: unknown; data: unknown; next: string | null }, extra: Record<string, unknown> = {},
): Promise<void> {
  const store = factory();
  await store.open(viewer);
  const { rows, receipt } = wireReceipt(testCase.receipt);
  const derived = receipt.ranges.some((r: any) => r.prefix.some((p: any) => "WordPrefix" in p));
  // Synthetic public filing of this native execution retains its actual pinned input, never reception time.
  const clock = testCase.context?.read_time != null ? { readTime: testCase.context.read_time, clockPlanHash: testCase.certificate.plan_hash } : {};
  try { await store.commit({
    deliveries: derived ? [{ op: testCase.name, args: held?.args ?? {}, state: "complete", data: held?.data ?? null,
      next: held?.next ?? null, seq: 1, validator: hex("1"), rows, receipt, ...clock }] : [
      { op: "coverage", args: {}, state: "complete", data: null, next: null, seq: 1, validator: hex("1"), rows, receipt },
      ...(held ? [{ op: held.op, args: held.args, state: "complete" as const, data: held.data, next: held.next, seq: 1, validator: hex("2"), ...clock }] : []),
    ],
    // Derived descriptors must retain their actual issuing IR/Q even in a direct carrier fixture.
    ...(derived ? { programs: { [facts.generation]: { generation: facts.generation, schemaHash: facts.schemaHash, schema: testCase.schema,
      programs: { [testCase.name]: { kind: "query", cursor: corpusPageCursors[testCase.name], ir: testCase.program, planHash: testCase.certificate.plan_hash, certificate: testCase.certificate } } } } } : {}),
    facts, schema: testCase.schema,
    ...extra,
  }); } finally { await store.close?.(); }
}

test("atomic carrier snapshots retain every envelope golden's issuing ClosureReceipt byte-identically", async () => {
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
        JSON.stringify(receiptFromSnapshot((await store.changes()).snapshot, companion.schema, envelope.schemaHash, companion.program)),
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
        id: "j1", bytes: { Bytes: "00" }, decimal: 1, enum: "one", image: { id: engineId(1), width: 1, height: 1 }, json: { Bytes: "00ff" },
        list: [], money: 1, optional: null, video: { id: engineId(2), width: 1, height: 1, duration: 1 },
      } }],
      receipt: { ranges: [], absences: [], verdicts: [] },
    }] });
    const closure = receiptFromSnapshot((await store.changes()).snapshot, companion.schema, schemaDigest(companion.schema));
    const row = (closure.rows[0]!.row as { Row: Record<string, unknown> }).Row;
    assert.deepEqual(row.json, { Map: { Bytes: { String: "00ff" } } }, "a json value is tagged by its declared type only");
    assert.deepEqual(row.bytes, { Bytes: "00" }, "a bytes column still tags as bytes");
    await store.close?.();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const roundTripCases = (await corpus()).filter((item: any) =>
  item.certificate !== null && item.program.kind === "Query" && item.prelude.length === 0 && item.replacementReceipt === null);
test("corpus round-trip inventory includes at least 80 queries and 60 byte-identical fresh answers", () => {
  assert.ok(roundTripCases.length >= 80, `corpus queries: ${roundTripCases.length}`);
  assert.ok(roundTripCases.filter((item: any) => item.expected.localState === "fresh"
    && item.category !== "connected" && item.context.read_time === null
    && item.receipt.absences.every(([, index]: any) => index === "byId")).length >= 60);
});
for (const testCase of roundTripCases) test(`atomic carrier round-trip with pinned inputs: ${testCase.name}`, async () => {
  const generation = hex("3");
  const schemaHash = testCase.certificate.schema_hash as string;
  const args = Object.fromEntries(Object.entries(testCase.context.args as Record<string, Tagged>).map(([name, value]) => [name, wire(value)]));
  const fresh = testCase.expected.localState === "fresh";
  const root = await tempRoot();
  try {
    const facts = { generation, schemaHash, authEpoch: testCase.context.auth_epoch as number };
    // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — primary-index absence projection.
    // Native grouping-index absences must refuse on the public byId-only wire.
    if (testCase.receipt.absences.some(([, index]: any) => index !== "byId")) {
      await assert.rejects(() => seedCoverage(fileRangeStore(root), testCase.context.viewer, testCase, facts,
        { op: testCase.name, args, data: wire(testCase.expected.localResult), next: null }),
      /store receipts may evict only a primary byId absence/, testCase.name);
      return;
    }
    await seedCoverage(fileRangeStore(root), testCase.context.viewer, testCase, facts,
      fresh ? { op: testCase.name, args, data: wire(testCase.expected.localResult), next: testCase.expected.next ?? null } : undefined);
    // Hydration: the coverage the store holds is the corpus receipt, byte for byte.
    const store = fileRangeStore(root)();
    await store.open(testCase.context.viewer);
    const rebuilt = receiptFromSnapshot((await store.changes()).snapshot, testCase.schema, schemaHash, testCase.program);
    assert.equal(canonical(rebuilt), canonical(holdableReceipt(testCase.receipt, schemaHash)), `${testCase.name}: hydration bytes`);
    const heldAnswer = fresh ? await store.answer(testCase.name, args) : undefined;
    await store.close?.();
    // Local evaluation through the client, offline, against the corpus expectation.
    const owner = corpusOwner({
      viewer: testCase.context.viewer, generation, schemaHash, schema: testCase.schema,
      programs: { [testCase.name]: { kind: "query", cursor: corpusPageCursors[testCase.name], ir: typedProgram(testCase), certificate: testCase.certificate } },
    });
    const client = createClient({ url: "http://corpus.test", token: "bearer", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
    await client.ready;
    await client.offline();
    // The public query clock samples local time; native corpus values pin a different clock.
    if (testCase.category === "connected") {
      const answer: any = await client.query((api as any)[testCase.name], args);
      assert.deepEqual(answer, { state: "hydrating", live: false, connection: "offline" });
      await client.close();
      return;
    }
    if (testCase.context.read_time !== null) {
      const clockStore = fileRangeStore(root)(); await clockStore.open(testCase.context.viewer);
      const held = (await clockStore.outbox.programs())[generation];
      const pinned = new Twin({ program: () => held, changes: (since: any) => clockStore.changes(since), principal: () => testCase.context.viewer,
        now: () => testCase.context.read_time, seq: () => 1 });
      const answer = await pinned.evaluate(testCase.name, args);
      assert.equal(canonical(answer?.data), canonical(wire(testCase.expected.localResult)), `${testCase.name}: explicit local clock parity`);
      await clockStore.close?.(); await client.close(); return;
    }
    const local: any = await client.query((api as any)[testCase.name], args).catch((error: unknown) => {
      assert.equal(testCase.expected.localState, "refused", `${testCase.name}: unexpected refusal`);
      assert.ok(isRefusalError(error) && error.message.includes(testCase.expected.errorCode), `${testCase.name}: ${error}`);
      return { state: "refused" };
    });
    const expected = testCase.expected;
    if (expected.localState === "fresh") {
      assert.ok(local.state === "complete" || local.state === "capped", `${testCase.name}: ${local.state} ${local.reason ?? ""}`);
      assert.equal(canonical(local.data), canonical(wire(expected.localResult)), `${testCase.name}: data`);
      if (Object.hasOwn(expected, "next")) {
        // The public search cursor adds local fences around the engine's exact ordinary suffix token.
        const next = typeof local.next === "string" && local.next.startsWith("h1.") ? JSON.parse(local.next.slice(3))[4] : local.next;
        assert.equal(next, expected.next, `${testCase.name}: next`);
      }
      assert.equal(canonical(local.data), canonical(heldAnswer!.data), `${testCase.name}: the twin's replay is the held answer's bytes`);
      assert.equal(local.seq, heldAnswer!.seq, `${testCase.name}: the held answer's facts stay with the twin's data`);
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
      // tagging can still be unavailable, but a covered execution refusal is reported.
      assert.ok(local.state === "hydrating" || local.state === "refused", `${testCase.name}: ${local.state}`);
    }

    await client.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test("program custody is fetched, held per generation on all three carriers, serves a cold start with the owner cut, and is fenced by generation and auth epoch", async () => {
  const messengerCorpus = await messenger();
  const generation = hex("4");
  const root = await tempRoot();
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  const carriers = [
    { name: "file", factory: () => fileRangeStore(root) },
    { name: "SQLite", factory: () => sqliteFactory(join(root, "custody.db")) },
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
    const fenced = createClient({ url: "http://custody.test", token: "bearer", fetch: async (input, init) => {
      // The program loaded but reconnect cannot yet reset the old coverage.
      if (new URL(String(input)).pathname === "/api/resume") throw new TypeError("reset transport cut");
      return owner.fetch(input, init);
    }, offline: { store: fileRangeStore(root) } });
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

test("partial reads name missing coverage; an explicit tombstone establishes known absence", async () => {
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
    assert.equal(local.state, "complete");
    assert.equal(local.data, null, "an authoritative tombstone dominates stale held rows as known absence");
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
    assert.deepEqual(local.predicted, [{ table: "messages", id: entry!.ids[0], intent: entry!.intent }]);
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

// @ref LLP 1012#7-writes-offline — exact ordinary-row arrival retires its
// atomic write group; maintained siblings retain independent authority.
test("a committed intent's ordinary overlay retires as one group and two resumes retire a stranded prediction", async () => {
  const base = { grant: "g", offset: 0, count: 3, ids: ["m", "d", "x"], op: "messages.send", args: { conversationId: "c1" }, issuedSeq: 0, createdAt: 1, updatedAt: 1 };
  const overlay = [{ table: "messages", id: "m", row: { id: "m", body: "predicted" } }, { table: "deliveries", id: "d", row: { id: "d", messageId: "m" } }];
  const committed = { ...base, intent: "g:0", state: "committed" as const, predicted: true, response: { state: "committed", seq: 30, data: { id: "m" } } };
  const page = (op: string, args: unknown, seq: number, rows: Array<{ table: string; id: string; row: Record<string, unknown> }>) => ({
    op, args, state: "complete" as const, data: rows.map((row) => ({ $row: { table: row.table, id: row.id } })), next: null, seq, rows,
    receipt: { ranges: [], absences: [], verdicts: [] },
  });
  const cases: Array<[string, ReturnType<typeof page>, boolean]> = [
    ["another conversation's thread page", page("messages.thread", { conversationId: "c2" }, 32, [
      { table: "deliveries", id: "d-c2", row: { id: "d-c2", messageId: "m-c2" } }, { table: "messages", id: "m-c2", row: { id: "m-c2", body: "elsewhere" } },
    ]), false],
    ["an unrelated row of the predicted table", page("messages.thread", { conversationId: "c1" }, 32, [
      { table: "deliveries", id: "d-other", row: { id: "d-other", messageId: "m-other" } },
    ]), false],
    ["an empty page at the held tail position", page("messages.inbox", { c: "cursor-9" }, 32, []), false],
    ["a delivery holding only the predicted message row", page("messages.thread", { conversationId: "c1" }, 32, [
      { table: "messages", id: "m", row: { id: "m", body: "predicted" } },
    ]), true],
    ["a delivery holding both predicted rows", page("messages.thread", { conversationId: "c1" }, 32, [
      { table: "messages", id: "m", row: { id: "m", body: "predicted" } },
      { table: "deliveries", id: "d", row: { id: "d", messageId: "m" } },
    ]), true],
  ];
  for (const [label, arrival, leaves] of cases) {
    const root = await tempRoot();
    try {
      const store = fileRangeStore(root)();
      await store.open("viewer");
      await store.commit({
        watermark: { op: "messages.inbox", args: { c: null }, watermark: "cursor-9", updatedAt: 1 },
        outbox: { put: [{ ...base, intent: "g:0", state: "queued", predicted: true }] }, overlay: { put: { "g:0": overlay } },
      });
      await store.commit({ outbox: { put: [committed] } });
      assert.ok((await store.outbox.overlay())["g:0"], `${label}: a commit with no rows in its swap keeps its overlay`);
      await store.commit({ deliveries: [arrival] });
      const remaining = (await store.outbox.overlay())["g:0"];
      assert.equal(remaining !== undefined, !leaves, `${label}: the overlay ${leaves ? "did not leave" : "left"}`);
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
      watermark: { op: "messages.inbox", args: { c: null }, cursorArg: "c", watermark: "cursor-9", updatedAt: 1 },
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

// `hydrating` and an empty trace are typed verdicts, never catch-alls: a bug in
// `tagArguments` surfaces from both query evaluation and mutation prediction.
test("a ReferenceError from tagArguments surfaces on query and mutation, never as hydrating or an empty trace", async () => {
  const messengerCorpus = await messenger();
  const generation = hex("d");
  const owner = corpusOwner({ viewer: "u1", generation, schemaHash: messengerCorpus.schemaHash, schema: messengerCorpus.schema, programs: messengerCorpus.programs });
  const root = await tempRoot();
  try {
    const grant = { id: engineId(500), from: engineId(500), count: 256, mintedAt: Date.now(), expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1_000, used: 0 };
    await seedCoverage(fileRangeStore(root), "u1", messengerCorpus.thread, { generation, schemaHash: messengerCorpus.schemaHash, authEpoch: 1 }, undefined, {
      grants: { put: [grant], current: grant.id }, bounds: { "named-send": 10 },
    });
    const throwingArgs = new Proxy({}, { ownKeys() { throw new ReferenceError("tagArguments bug"); } });
    const client = createClient({ url: "http://bug.test", token: "bearer", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
    await client.ready;
    await client.offline();
    // Inject after custody admission, at the actual query/mutation argument boundary.
    const runtime = (client as any).offlineRuntime;
    for (const entry of Object.values<any>(runtime.held.programs)) entry.ir.args = throwingArgs;
    await assertRefused(client.query((api as any)["named-thread"], threadArgs), (error: unknown) =>
      (error.state === "rejected" || error.state === "refused") && /tagArguments bug/.test(error.message), "the ReferenceError was swallowed as hydrating");
    await assertRefused(client.mutation((api as any)["named-send"], { conversationId: "c1", body: "bug", at: 30 }), (error: unknown) =>
      (error.state === "rejected" || error.state === "refused") && /tagArguments bug/.test(error.message), "the ReferenceError was swallowed as an unpredicted empty trace");
    assert.deepEqual(await client.outbox.entries(), [], "a tagger bug did not enqueue an intent with an empty trace");
    await client.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — a rotation
// under an open transport schedules its old-facts reset immediately; the app
// need not call online() or wait for another reconnect to rebuild coverage.
test("an online query under a new generation immediately resets and rebuilds fresh coverage without an explicit online()", async () => {
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
        protocol: 1, generation: after, schemaHash: messengerCorpus.schemaHash, planHash: sha256(canonicalProgramJson(messengerCorpus.programs["named-thread"].ir)), authority: { principal: "u1", authEpoch: 1 },
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
    // Reset is independent of the live read; observe its completion without online().
    for (let n = 0; n < 200 && (client as any).resumeFlight; n++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(requests.filter((path) => path === "/api/resume").length, 1, "the online delivery did not schedule exactly one old-facts resume");
    assert.ok(requests.includes(`/api/program?generation=${after}`), `the reset path did not fetch the live generation's program: ${requests.join(" ")}`);
    await client.offline();
    const fresh: any = await client.query((api as any)["named-thread"], threadArgs);
    assert.equal(fresh.state, "capped", `the immediate reset left the offline read hydrating: ${JSON.stringify(fresh)}`);
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
      schema.channels = { typing: { args: { ids: { List: { of: "Id", max: 4, shard: 1 } } }, value: { typing: "Bool" }, publish: "Allow", subscribe: "Allow", ttl_ms: 1_000 } };
    }, /arg\.List field shard/],
  ];
  for (const [label, mutate, refusal] of shapes) {
    const novel = structuredClone(messengerCorpus.schema);
    mutate(novel);
    assert.throws(() => schemaDigest(novel), refusal, `${label}: the hasher dropped bytes instead of refusing`);
    assert.equal(schemaDigest(messengerCorpus.schema), messengerCorpus.schemaHash, "the known shape still hashes as Rust does");
    const root = await tempRoot();
    try {
      await seedCoverage(fileRangeStore(root), "u1", messengerCorpus.thread, facts, undefined, { bounds: { "named-send": 10 } });
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
    await seedCoverage(fileRangeStore(root), "u1", messengerCorpus.thread, facts, undefined, { bounds: { "named-send": 10 } });
    const store = fileRangeStore(root)();
    await store.open("u1");
    const snapshot = (await store.changes()).snapshot;
    assert.throws(() => receiptFromSnapshot(snapshot, messengerCorpus.schema, hex("f")), /snapshot schema identity/);
    assert.equal(receiptFromSnapshot(snapshot, messengerCorpus.schema, messengerCorpus.schemaHash, messengerCorpus.thread.program).schema_hash,
      messengerCorpus.schemaHash, "one issuing receipt carries the recomputed schema hash");
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
          byId: { components: [{ Column: "id" }], unique: true },
          byRecipientAt: { components: [{ Column: "recipient" }, { Column: "at" }, { Column: "id" }], unique: false },
          byRecipientConversationAt: { components: [{ Column: "recipient" }, { Column: "conversationId" }, { Column: "at" }, { Column: "id" }], unique: false },
        },
        rules: { read: { Eq: [{ Field: "recipient" }, "Viewer"] }, insert: "Deny", update: "Deny", delete: "Deny" },
        constraints: [], retain: "until-revoked",
      },
      messages: {
        columns: { id: "Id", conversationId: "Id", body: { Text: { max: 100 } } },
        indexes: { byId: { components: [{ Column: "id" }], unique: true } },
        rules: { read: { Exists: { table: "memberships", index: "byConversationPrincipal", key: [{ Field: "conversationId" }, "Viewer"], provenance: "Shape" } }, insert: "Deny", update: "Deny", delete: "Deny" },
        constraints: [], retain: "until-revoked",
      },
      memberships: {
        columns: { id: "Id", conversationId: "Id", principal: "Principal" },
        indexes: { byId: { components: [{ Column: "id" }], unique: true }, byConversationPrincipal: { components: [{ Column: "conversationId" }, { Column: "principal" }], unique: true } },
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
      { Const: { name: "page", value: { Scan: { site: "thread.1", table: "deliveries", index: "byRecipientConversationAt", prefix: [{ Scalar: { Input: "Viewer" } }, { Scalar: { Variable: "conversationId" } }], order: "Desc", take: { Literal: 50 }, after: null, before: null, range: null, merge_site: null, opaque_cursor: false, provenance: "Shape" } } } },
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
    site: "inbox.0", table: "deliveries", index: "byRecipientAt", prefix: [{ Scalar: "viewer" }], order: "Asc", take: 3,
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

test("a connected subscription without a local store becomes hydrating on transport loss", async () => {
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let dead = false;
  const client = fixtureClient({ url: "http://connected-live.test", persona: "alice", fetch: async input => {
    if (dead) throw new TypeError("offline");
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return new Response(JSON.stringify({ ops: { online: { kind: "query", args: {} } }, auth: {}, channels: {} }));
    return new Response(new ReadableStream({ start(controller) {
      stream = controller;
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ state: "complete", data: 0, seq: 1, next: null, connected: true })}\n\n`));
    } }), { headers: { "content-type": "text/event-stream" } });
  } });
  const events: any[] = [];
  const subscription = subscribe(client, (api as any).online, {}, event => events.push(event));
  try {
    await subscription.until(event => event.state === "complete", 2_000);
    const offline = subscription.until(event => event.state === "hydrating", 2_000);
    dead = true; stream!.error(new TypeError("offline"));
    assert.deepEqual(await offline, { state: "hydrating", live: false, connection: "offline" });
    assert.ok(!events.some(event => event.state === "stale"));
  } finally { subscription.close(); await client.close(); }
});

test("a no-store subscription clears connected on its next ordinary frame before transport loss", async () => {
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let dead = false;
  const frame = (value: object) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
  const client = fixtureClient({ url: "http://connected-frame.test", persona: "alice", fetch: async input => {
    if (dead) throw new TypeError("offline");
    if (new URL(String(input)).pathname === "/api/manifest") return new Response(JSON.stringify({ ops: { online: { kind: "query", args: {} } }, auth: {}, channels: {} }));
    return new Response(new ReadableStream({ start(controller) {
      stream = controller;
      controller.enqueue(frame({ state: "complete", data: 1, seq: 1, next: null, connected: true }));
    } }), { headers: { "content-type": "text/event-stream" } });
  } });
  const subscription = subscribe(client, (api as any).online, {}, () => {});
  try {
    await subscription.until(event => event.state === "complete", 2_000);
    const ordinary = subscription.until((event: any) => event.state === "complete" && event.seq === 2, 2_000);
    stream!.enqueue(frame({ state: "complete", data: "durable", seq: 2, next: null }));
    await ordinary;
    const lost = subscription.until(event => event.state === "stale" || event.state === "hydrating", 2_000);
    dead = true; stream!.error(new TypeError("offline"));
    const result: any = await lost;
    assert.equal(result.state, "stale");
    assert.equal(result.data, "durable");
    assert.equal(result.seq, 2);
  } finally { subscription.close(); await client.close(); }
});

test("connected envelopes never enter coverage, including with missing program custody and repeated durable seq", async () => {
  const fixture = (await corpus()).find(item => item.name === "connected-live-registry");
  const generation = hex("c"), schemaHash = fixture.certificate.schema_hash;
  const root = await tempRoot();
  try {
    for (const missingProgram of [false, true]) {
      const factory = fileRangeStore(join(root, String(missingProgram)));
      let count = 0;
      const owner = corpusOwner({ viewer: "alice", generation, schemaHash, schema: fixture.schema,
        programs: { online: { kind: "query", ir: fixture.program, certificate: fixture.certificate } } });
      const fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/program" && missingProgram) throw new TypeError("program fetch failed");
        if (path === "/api/query") return new Response(JSON.stringify({
          protocol: 1, generation, schemaHash, planHash: fixture.certificate.plan_hash,
          authority: { principal: "alice", authEpoch: 1 }, state: "complete", data: count,
          next: null, seq: 12, rows: [], receipt: { ranges: [], absences: [], verdicts: [] },
          validator: hex(String(count + 1)), connected: true,
        }), { headers: { "content-type": "application/json" } });
        return owner.fetch(input, init);
      };
      const client = createClient({ url: "http://connected-envelope.test", token: "bearer", fetch, offline: { store: factory } });
      await client.ready;
      for (count of [0, 2]) {
        let answer: any;
        if (missingProgram) {
          // A streamed envelope can precede program custody; exercise that admission boundary.
          const runtime = (client as any).offlineRuntime;
          const accepted = await runtime.accept("online", {}, await (await fetch("http://connected-envelope.test/api/query")).json());
          await runtime.commit("online", {}, accepted);
          answer = accepted.result;
        } else answer = await client.query((api as any).online, {});
        assert.equal(answer.state, "complete");
        assert.equal(answer.data, count);
        assert.equal(answer.seq, 12);
      }
      await client.offline();
      assert.deepEqual(await client.query((api as any).online, {}), { state: "hydrating", live: false, connection: "offline" });
      await client.close();
      const store = factory(); await store.open("alice");
      assert.equal(await store.answer("online", {}), undefined);
      await store.close?.();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
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

test("connected stays hydrating despite a cached zero or count, cold reopen, and never predicts a gated mutation", async () => {
  const fixture = (await corpus()).find(item => item.name === "connected-live-registry");
  assert.ok(fixture);
  const generation = hex("a");
  const schemaHash = fixture.certificate.schema_hash;
  const mutation = { ...fixture.program, kind: "Mutation", name: "gate" };
  const programs = {
    online: { kind: "query" as const, ir: fixture.program, certificate: fixture.certificate },
    gate: { kind: "mutation" as const, ir: mutation, certificate: fixture.certificate },
  };
  let dead = false;
  const owner = corpusOwner({ viewer: "alice", generation, schemaHash, schema: fixture.schema, programs, dead: () => dead });
  const root = await tempRoot();
  try {
    for (const cached of [0, 2, false, true]) {
      const factory = fileRangeStore(join(root, String(cached)));
      await seedCoverage(factory, "alice", fixture, { generation, schemaHash, authEpoch: 1 }, { op: "online", args: {}, data: cached, next: null });
      dead = false;
      let client = createClient({ url: "http://connected.test", token: "bearer", fetch: owner.fetch, offline: { store: factory } });
      await client.ready;
      await client.auth.login("alice@example.com", "password123");
      await client.offline();
      assert.deepEqual(await client.query((api as any).online, {}), { state: "hydrating", live: false, connection: "offline" });
      const queued: any = await client.mutation((api as any).gate, {});
      assert.equal(queued.state, "queued");
      const entries = await client.outbox.entries();
      assert.equal(entries.at(-1)?.predicted, undefined);
      assert.deepEqual(entries.at(-1)?.trace, { points: [], verdicts: [] });
      await client.close();
      dead = true;
      client = createClient({ url: "http://connected.test", token: "bearer", fetch: owner.fetch, offline: { store: factory } });
      await client.ready;
      assert.deepEqual(await client.query((api as any).online, {}), { state: "hydrating", live: false, connection: "offline" });
      await client.close();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("covered evaluation errors surface; typed local mutation refusals omit prediction and JS bugs propagate", async () => {
  const m = await messenger();
  const generation = hex("a");
  const root = await tempRoot();
  const owner = corpusOwner({ viewer: "u1", generation, schemaHash: m.schemaHash, schema: m.schema, programs: m.programs });
  let client: any;
  try {
    await seedCoverage(fileRangeStore(root), "u1", m.thread, { generation, schemaHash: m.schemaHash, authEpoch: 1 });
    client = createClient({ url: "http://eval-errors.test", token: "bearer", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
    await client.ready;
    await client.offline();
    const twin = client.offlineRuntime.twin;
    const hydrated = await twin.hydrate();
    assert.ok(hydrated);
    // Real separately built client + file carrier share the nominal image/error module.
    const { RowImage, ImageKeys, EvalError: SharedError } = await import('../dist/image-runtime.mjs');
    const current = Object.values<any>(client.offlineRuntime.store.state.rows)[0];
    assert(RowImage.is(current.row)); assert.equal(hydrated.store.byId(current.table,current.id),current.row);
    const keys = RowImage.keys(current.row); assert(ImageKeys.is(keys));
    const rowRevision = hydrated.rowsRevision;
    // Direct synthetic carrier delivery across real built client/file arms, not native emission.
    await client.offlineRuntime.store.commit({ deliveries: [{ op: 'ownership',args: {},state: 'partial',data: null,next: null,
      seq: 2,rows: [{ table: current.table,id: current.id,row: RowImage.wire(current.row) }],receipt: { ranges: [],absences: [],verdicts: [] } }] });
    const refreshed = await twin.hydrate(), adopted = client.offlineRuntime.store.state.rows[`${current.table}\0${current.id}`].row;
    assert.notEqual(adopted,current.row); assert.equal(refreshed.store.byId(current.table,current.id),adopted);
    assert.equal(refreshed.rowsRevision,rowRevision); assert.equal(RowImage.keys(adopted),keys);
    const fake = Object.freeze({ ...current.row }); assert(!RowImage.is(fake));
    const external = structuredClone(current.row); const owned = RowImage.prepare(m.schema,current.table,external);
    assert.notEqual(owned,external); assert.equal(RowImage.keys(owned) === keys,false);
    external.Row.id.Id = 'changed'; assert.equal(owned.Row.id.Id,current.id);
    assert.throws(() => RowImage.prepare(m.schema,current.table,{ Row: { id: { Int: 1 } } }),SharedError);
    // Obtain the actual evaluator's error constructor, without adding a public test export.
    let sample: any;
    try { hydrated.store.reexecute({ args: {}, body: [{ Return: { Variable: "unknown" } }] }, { args: {} }); }
    catch (error) { sample = error; }
    assert.equal(sample.code, "E_INPUT");
    const EvalError = sample.constructor; assert.equal(EvalError,SharedError);
    twin.hydrate = async () => hydrated;
    hydrated.store.reexecute = () => { throw new EvalError("E_OVERFLOW", "covered overflow"); };
    await assertRefused(client.query((api as any)["named-thread"], threadArgs), /E_OVERFLOW/);
    for (const code of ["E_REQUIRE", "E_RULE", "E_CONSTRAINT", "E_INPUT", "E_TYPE", "E_FIELD", "E_DIV_ZERO", "E_OVERFLOW", "E_SCHEMA", "E_OPAQUE"]) {
      hydrated.store.applyMutation = () => { throw new EvalError(code, "modeled refusal"); };
      const result = await twin.predict("named-send", { conversationId: "c1", body: "test", at: 30 }, [engineId(1)]);
      assert.equal(result.predicted, false, code);
      assert.deepEqual(result.trace, { points: [], verdicts: [] }, code);
    }
    hydrated.store.applyMutation = () => { throw new ReferenceError("mutation evaluator bug"); };
    await assert.rejects(twin.predict("named-send", { conversationId: "c1", body: "test", at: 30 }, [engineId(1)]), /mutation evaluator bug/);
  } finally { await client?.close(); await rm(root, { recursive: true, force: true }); }
});

for (const carrier of ["file", "SQLite", "IndexedDB"] as const) {
  test(`${carrier}: a G1 prediction overlay fails closed after a schema reset until it is retired`, async () => {
    const m = await messenger();
    const generation = hex("1"), successor = hex("2");
    const root = await tempRoot();
    // Every carrier loop runs SQLite too (lane E1); the database lives under `root` and leaves with it.
    const factory = carrier === "file" ? fileRangeStore(root)
      : carrier === "SQLite" ? sqliteFactory(join(root, "overlay-reset.db"))
      : indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as any, locks: new FakeLocks() as any });
    let client: any;
    try {
      await seedCoverage(factory as any, "u1", m.thread, { generation, schemaHash: m.schemaHash, authEpoch: 1 });
      const owner = corpusOwner({ viewer: "u1", generation, schemaHash: m.schemaHash, schema: m.schema, programs: m.programs });
      client = createClient({ url: "http://overlay-reset.test", fetch: owner.fetch, offline: { store: factory } });
      await client.ready;
      await client.auth.login({ email: "u1", password: "pw" });
      await client.offline();
      const sent = await client.mutation((api as any)["named-send"], { conversationId: "c1", body: "old prediction", at: 20 });
      const runtime = client.offlineRuntime;
      const entry = (await client.outbox.entries())[0];
      assert.equal(entry.predicted, true);
      assert.deepEqual((await client.query((api as any)["named-thread"], threadArgs)).predicted, [{ table: "messages", id: entry.ids[0], intent: entry.intent }]);
      const schema = structuredClone(m.schema);
      schema.tables.messages.columns.body = "Int";
      const schemaHash = schemaDigest(schema);
      await runtime.program({ generation: successor, schemaHash, schema,
        programs: Object.fromEntries(Object.entries(m.programs).map(([name, p]) => [name, { ...p, planHash: p.certificate.plan_hash }])) });
      await runtime.resetCoverage(1);
      const { rows, receipt } = wireReceipt(m.thread.receipt);
      for (const row of rows) if (row.table === "messages") row.row.body = 1;
      await runtime.store.commit({ deliveries: [{ op: "coverage", args: {}, state: "complete", seq: 1, data: null, rows, receipt }] });
      assert.equal(await runtime.completeReset(runtime.coverageRevision), true);
      assert.ok((await runtime.store.outbox.overlay())[entry.intent], "reset preserves queued intent custody");
      assert.equal((await client.query((api as any)["named-thread"], threadArgs)).state, "hydrating");
      assert.equal((await runtime.store.outbox.get(entry.intent)).state, "queued");
      assert.equal((await runtime.store.outbox.get(entry.intent)).ids[0], sent.ids[0]);
      await runtime.store.commit({ overlay: { remove: [entry.intent] } });
      assert.ok(await runtime.twin.hydrate(), "successor coverage hydrates once the incompatible overlay is retired");
    } finally { await client?.close(); await rm(root, { recursive: true, force: true }); }
  });
}

test("overlay put and remove bugs escape the hydrate catch boundary", async () => {
  const m = await messenger(), generation = hex("3");
  const root = await tempRoot();
  let client: any;
  try {
    await seedCoverage(fileRangeStore(root), "u1", m.thread, { generation, schemaHash: m.schemaHash, authEpoch: 1 });
    const owner = corpusOwner({ viewer: "u1", generation, schemaHash: m.schemaHash, schema: m.schema, programs: m.programs });
    client = createClient({ url: "http://hydrate-bug.test", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
    await client.ready;
    await client.auth.login({ email: "u1", password: "pw" });
    await client.offline();
    await client.mutation((api as any)["named-send"], { conversationId: "c1", body: "predicted", at: 20 });
    const runtime = client.offlineRuntime;
    const entry = (await client.outbox.entries())[0];
    const prototype = Object.getPrototypeOf((await runtime.twin.hydrate()).store);
    for (const method of ["put", "remove"]) {
      const original = prototype[method];
      try {
        prototype[method] = () => { throw new TypeError(`overlay ${method} bug`); };
        // A warm hydrate applies only changed rows: inject a real durable contribution delta.
        await runtime.store.commit({ overlay: { put: { [entry.intent]: [{ table: "messages", id: "message-00004",
          row: method === "put" ? { body: "changed prediction" } : {},
          ...(method === "put" ? { fields: ["body"] } : { removed: true }) }] } } });
        await assert.rejects(runtime.twin.hydrate(), new RegExp(`overlay ${method} bug`));
      } finally { prototype[method] = original; }
    }

  } finally { await client?.close(); await rm(root, { recursive: true, force: true }); }
});

// Transport double using actual final26c9 native v5 certificate and public recipe IR.
test('h1 stays local across query transport, subscription reconnect and cold reopen', async context => {
  const fixture = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  const op = 'search.findPeople', original = fixture.operations[op];
  const schemaHash = schemaDigest(fixture.schema), planHash = original.certificate.plan_hash, generation = hex('9');
  const certificate = original.certificate;
  const packet = { generation, schemaHash, schema: fixture.schema, programs: { [op]: { kind: 'query', cursor: 'c', planHash, ir: original.program, certificate } } };
  const root = await tempRoot(); context.after(() => rm(root, { recursive: true, force: true }));
  const store = fileRangeStore(root)(); await store.open('viewer');
  await store.commit({ programs: { [generation]: packet }, schema: fixture.schema, facts: { generation, schemaHash, authEpoch: 0 }, deliveries: [{
    op: 'pool', args: {}, state: 'complete', data: [], seq: 1, next: null, rows: Array.from({ length: 25 }, (_, i) => ({
      table: 'people', id: `person${String(i).padStart(2, '0')}`, row: { id: `person${String(i).padStart(2, '0')}`, name: 'Café', handle: null },
    })), receipt: { ranges: [], absences: [], verdicts: [] },
  }] }); await store.close();
  const requests: { path: string; args: any }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/auth/me') return Response.json({ viewer: 'viewer', kind: 'user', authEpoch: 0 });
    if (url.pathname === '/api/manifest') return Response.json({ generation: 'schema', programGeneration: generation, ops: { [op]: { kind: 'query', cursor: 'c', args: original.program.args, planHash } }, channels: {}, tables: {}, auth: {} });
    if (url.pathname === '/api/program') return Response.json(packet);
    if (url.pathname === '/api/resume') return Response.json({ seq: 1, generation, schemaHash, authority: { principal: 'viewer', authEpoch: 0 }, log: { unchanged: true }, mounted: [] });
    const args = url.pathname === '/api/subscribe' ? JSON.parse(url.searchParams.get('args')!) : JSON.parse(String(init?.body)).args;
    requests.push({ path: url.pathname, args });
    const value = { protocol: 1, generation, schemaHash, planHash, authority: { principal: 'viewer', authEpoch: 0 },
      state: 'complete', data: [], seq: 1, next: null, rows: [], receipt: { ranges: [], absences: [], verdicts: [] }, validator: hex('1') };
    return url.pathname === '/api/subscribe' ? new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
    } }), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(value);
  };
  const client = fixtureClient({ url: 'http://local-page.test', token: 'bearer', fetch, offline: { store: fileRangeStore(root) } });
  context.after(() => client.close()); await client.ready; await client.offline();
  const first: any = await client.query((api as any)[op], { term: 'Café', c: null });
  assert.equal(first.state, 'capped'); assert(first.next.startsWith('h1.'));
  const second: any = await client.query((api as any)[op], { term: 'CAFE\u0301', c: first.next });
  assert.equal(second.state, 'held'); assert.equal(second.data.length, 5);
  const sub = subscribe(client, (api as any)[op], { term: 'Café', c: first.next }, () => {}); context.after(() => sub.close());
  await client.online(); await sub.until(value => value.state === 'complete', 1000);
  await client.query((api as any)[op], { term: 'Café', c: first.next });
  assert(requests.some(r => r.path === '/api/subscribe')); assert(requests.some(r => r.path === '/api/query'));
  assert(requests.every(r => r.args.c === null && r.args.term === 'Café'), 'only the declared h1 cursor resets for server transport');
  sub.close(); await client.close();
  const cold = fixtureClient({ url: 'http://local-page.test', token: 'bearer', fetch, offline: { store: fileRangeStore(root) } });
  context.after(() => cold.close()); await cold.ready; await cold.offline();
  const restarted: any = await cold.query((api as any)[op], { term: 'Café', c: first.next });
  assert.equal(restarted.state, 'capped'); assert.equal(restarted.data[0].id, first.data[0].id, 'a prior-incarnation page restarts at null');
});

test('enrolled ordinary conditionals fetch one authenticated full reply without a validator across query and SSE', async context => {
  const { clock: packet } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  for (const mode of ['query', 'subscription', 'failed-full']) await context.test(mode, async () => {
    const root = await tempRoot();
    const factory = fileRangeStore(root), store = factory(); await store.open('viewer');
    const rows = [{ table: 'events', id: 'one', row: { id: 'one', at: 1 } }], receipt = { ranges: [], absences: [], verdicts: [] };
    const ordinary = { op: 'ordinary', args: { text: 'h1.application-data' }, seq: 1, state: 'complete', next: null,
      rows, receipt, data: [{ $row: { table: 'events', id: 'one' } }], validator: hex('a') };
    await store.commit({ programs: { [packet.generation]: packet }, facts: { generation: packet.generation, schemaHash: packet.schemaHash, authEpoch: 0 },
      deliveries: [ordinary] });
    await store.commit({ deliveries: [{ ...ordinary, op: 'clock.read', args: {}, readTime: 1, clockPlanHash: packet.programs['clock.read'].planHash }] });
    await store.close();
    const requests: any[] = [];
    const full = { protocol: 1, generation: packet.generation, schemaHash: packet.schemaHash, planHash: hex('b'),
      authority: { principal: 'viewer', authEpoch: 0 }, state: 'complete', next: null, seq: 2, validator: hex('c'), receipt,
      rows: [{ ...rows[0], row: { id: 'one', at: 2 } }], data: ordinary.data };
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/auth/me') return Response.json({ viewer: 'viewer', kind: 'user', authEpoch: 0 });
      if (url.pathname === '/api/manifest') return Response.json({ generation: 'schema', programGeneration: packet.generation,
        ops: { ordinary: { kind: 'query', args: { text: { Text: { max: 30 } } }, planHash: hex('b') } }, channels: {}, tables: {}, auth: {} });
      if (url.pathname === '/api/program') return Response.json(packet);
      const request = url.pathname === '/api/subscribe' ? { op: url.searchParams.get('op'), args: JSON.parse(url.searchParams.get('args')!), validator: url.searchParams.get('validator') }
        : JSON.parse(String(init?.body));
      requests.push(request);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer bearer');
      const unchanged = { state: 'unchanged', seq: 2, validator: ordinary.validator };
      if (url.pathname === '/api/subscribe') return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(unchanged)}\n\n`));
      } }), { headers: { 'content-type': 'text/event-stream' } });
      if (request.validator) return Response.json(unchanged);
      if (mode === 'failed-full') throw new TypeError('network unavailable during full revalidation');
      return Response.json(full);
    };
    const client = fixtureClient({ url: 'http://proofs.test', token: 'bearer', fetch, offline: { store: factory } });
    try {
      await client.ready;
      if (mode === 'subscription') {
        const sub = subscribe(client, (api as any).ordinary, ordinary.args, () => {});
        try { const next: any = await sub.until(value => value.state === 'complete' && value.data?.[0]?.at === 2, 1000); assert.equal(next.data[0].at, 2); }
        finally { sub.close(); }
      } else if (mode === 'failed-full') {
        await assertRefused(client.query((api as any).ordinary, ordinary.args), (error: any) => error.code === 'E_OFFLINE_DELIVERY');
        await client.offline(); const held: any = await client.query((api as any).ordinary, ordinary.args); assert.equal(held.data[0].at, 1);
      } else assert.equal((await client.query((api as any).ordinary, ordinary.args)).data[0].at, 2);
      assert.equal(requests.length, 2, 'one conditional followed by exactly one full revalidation');
      assert.equal(requests[0].validator, ordinary.validator); assert.equal(requests[1].validator, undefined);
      assert.deepEqual(requests[1].args, ordinary.args, 'exact noncursor application data survives the full read');
    } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
  });
});

test('native-certified derived page keeps its public local cursor after halo replacement', async () => {
  const fixtures = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json',import.meta.url),'utf8'));
  const operation = fixtures.operations['search.findPeople'], op = 'search.findPeople', args = { term: 'É',c: null };
  const program = { generation: 'c'.repeat(64),schemaHash: operation.certificate.schema_hash,schema: fixtures.schema,
    programs: { [op]: { kind: 'query',cursor: 'c',ir: operation.program,certificate: operation.certificate,planHash: operation.certificate.plan_hash } } };
  const rows = Array.from({ length: 21 },(_,i) => ({ table: 'people',id: `p${String(i).padStart(2,'0')}`,
    row: { id: `p${String(i).padStart(2,'0')}`,name: 'e\u0301 shared',handle: i % 2 ? 'é' : null } }));
  // Actual native26c9 Q2000 certificate; synthetic authenticated pool and queued overlay, not native emission or Client grant admission.
  const frame = { protocol: 1,state: 'capped',generation: program.generation,schemaHash: program.schemaHash,
    planHash: operation.certificate.plan_hash,authority: { principal: 'dev:alice',authEpoch: 0 },seq: 1,validator: 'd'.repeat(64),next: null,
    data: rows.slice(0,20).map(r => ({ $row: { table: r.table,id: r.id } })),rows,
    receipt: { ranges: [{ site: 'search.findPeople.0',table: 'people',index: 'byNameWords',
      prefix: [{ WordPrefix: { contract: 'u17-nfc-scf-nfc-wsp-p',source: 'É' } }],order: 'Asc',take: 20,
      after: null,before: null,gt: null,gte: null,lt: null,lte: null,ruleHash: operation.certificate.rule_hashes['people.read'],
      rowIds: rows.slice(0,20).map(r => r.id),stop: 'Limit',absence: false,haloId: 'p20' }],absences: [],verdicts: [] } };
  let saved: any; const factory = () => new PersistentRangeStore({ carrier: 'json',open: async () => saved,
    replace: async state => { saved = JSON.parse(JSON.stringify(state)); },close() {},wipe: async () => {} });
  let runtime = new OfflineRuntime({ store: factory }); await runtime.open('dev:alice',true); await runtime.program(program);
  await runtime.commit(op,args,await runtime.accept(op,args,frame));
  await runtime.store.commit({ outbox: { put: [{ intent: 'local',grant: 'synthetic',offset: 0,count: 0,ids: [],op: 'synthetic',args: {},issuedSeq: 1,
    state: 'queued',predicted: true,createdAt: 1,updatedAt: 1 }] },overlay: { put: { local: [{ table: 'people',id: 'p00',row: {},removed: true }] } } });
  for (const cold of [false,true]) {
    if (cold) { await runtime.close(); runtime = new OfflineRuntime({ store: factory }); await runtime.open('dev:alice',true); }
    const page = await runtime.twin.evaluate(op,args);
    assert.equal(page.state,'capped'); assert.deepEqual(page.data.map(r => r.id),rows.slice(1).map(r => r.id));
    assert(page.next?.startsWith('h1.'),'the last returned p20 remains a local page anchor');
    const tail = await runtime.twin.evaluate(op,{ term: 'e\u0301',c: page.next });
    assert.equal(tail.state,'held','held iterator exhaustion never proves the unheld server tail'); assert.deepEqual(tail.data,[]);
    assert.equal(saved.answers[op+'\0'+canonical({ term: args.term })].next,null,'local cursor never becomes stored server progress');
  }
  await runtime.close();
});


test('public offline movement propagates detected partial coverage and the known halo through cold, retry and subscription', async context => {
  const { nativeR8: { halo } } = JSON.parse(await readFile(new URL('../../evaluator/src/test-search-v5-fixtures.json', import.meta.url), 'utf8'));
  const converted = toClosureReceipt(halo.first,halo.program.schema,halo.program.programs['clock.fixed'].ir);
  const original = structuredClone(converted), leaf = converted.rows[0].row.Row;
  leaf.at.Int = 999;
  assert.deepEqual(toClosureReceipt(halo.first,halo.program.schema,halo.program.programs['clock.fixed'].ir),original,
    'public converter returns recursively mutable copies without changing input or prepared custody');
  const now = Date.now; Date.now = () => halo.first.readTime + 1000; context.after(() => { Date.now = now; });
  let saved: any; const factory = () => new PersistentRangeStore({ carrier: 'json',open: async () => saved,
    replace: async state => { saved = JSON.parse(JSON.stringify(state)); },close() {},wipe: async () => {} });
  const runtime = new OfflineRuntime({ store: factory }); await runtime.open(halo.first.authority.principal,true); await runtime.program(halo.program);
  await runtime.commit('clock.fixed',{},await runtime.accept('clock.fixed',{},halo.first)); await runtime.twin.evaluate('clock.fixed',{});
  // Unchanged native first page; later movement is a synthetic checked public-runtime frame, not native emission.
  const moved = structuredClone(halo.first); moved.seq++; moved.readTime++; moved.validator = 'd'.repeat(64);
  moved.planHash = halo.program.programs['clock.read'].planHash; moved.receipt = { ranges: [],absences: [],verdicts: [] };
  moved.rows = moved.rows.filter((r: any) => ['r8','r9'].includes(r.id)).map((r: any,i: number) => ({ ...r,row: { ...r.row,at: 100 + i } }));
  moved.data = { now: moved.readTime,rows: moved.rows.map((r: any) => ({ $row: { table: r.table,id: r.id } })) };
  await runtime.commit('clock.read',{},await runtime.accept('clock.read',{},moved));
  assert.equal((await runtime.twin.evaluate('clock.fixed',{})).state,'partial'); await runtime.close();
  for (const mode of ['forced','retry']) {
    let requests = 0;
    const fetch = async (input: any) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/auth/me') return Response.json({ viewer: halo.first.authority.principal,kind: 'user',authEpoch: halo.first.authority.authEpoch });
      if (path === '/api/manifest') return Response.json({ generation: 'schema',programGeneration: halo.program.generation,
        ops: Object.fromEntries(Object.entries<any>(halo.program.programs).map(([name,op]) => [name,{ kind: op.kind,args: op.ir.args,planHash: op.planHash }])),channels: {},tables: {},auth: {} });
      if (path === '/api/program') return Response.json(halo.program);
      if (path === '/api/resume') return Response.json({ seq: moved.seq,generation: moved.generation,schemaHash: moved.schemaHash,authority: moved.authority,log: { unchanged: true },mounted: [] });
      requests++; throw new TypeError('synthetic offline transport');
    };
    const client = createClient({ url: 'http://movement.test',persona: halo.first.authority.principal,startOffline: mode === 'forced',offline: { store: factory },fetch });
    try {
      await client.ready;
      const check = (answer: any) => { assert.equal(answer.state,'partial'); assert(!Object.hasOwn(answer,'next'));
        assert.equal(answer.connection,'offline'); assert.deepEqual(answer.data.rows.map((r: any) => r.at),[0,1,2,3,4,5,6,7,10,100]); };
      check(await client.query(api.clock.fixed as any,{})); assert.equal(requests,mode === 'forced' ? 0 : 3);
      if (mode === 'forced') {
        const sub = subscribe(client, api.clock.fixed as any,{},() => {});
        try { check(await sub.until((r: any) => r.state === 'partial',2000)); } finally { sub.close(); }
        check(await client.query(api.clock.fixed as any,{}));
      }
    } finally { await client.close(); }
  }
});
