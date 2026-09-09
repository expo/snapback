import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { api, createClient, mutationTarget } from "../dist/client.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { indexedDbRangeStore, SnapbackProvider, useMutation } from "../dist/react.mjs";
import { OutboxLedger } from "../dist/client-observed-test.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { sqliteFactory } from "./sqlite-fixture.ts";
import { engineId, fakeOwner, seededStore } from "./fake-owner.ts";
import type { HeldProgram, OutboxEntry } from "../src/store/range-store.ts";

const bundled = await build({ stdin: { contents: "export * from './src/mutation-targets.ts'; export { wireReplayResponse } from './src/client-outbox.ts';",
  resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
const { admittedMutationTargets, wireReplayResponse } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0]!.contents).toString("base64")}`);
const identity = { planHash: "a".repeat(64), schemaHash: "b".repeat(64) };
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
function program(offset = 1): HeldProgram {
  return { generation: "c".repeat(64), schemaHash: identity.schemaHash, schema: { tables: {} }, programs: {
    "messages.post": { kind: "mutation", planHash: identity.planHash, ir: { args: { messageId: { Ref: { table: "messages" } } } },
      certificate: { mutation_targets: { complete: false, targets: [
        { table: "messages", kind: "create", source: { newId: offset } },
        { table: "deliveries", kind: "create", unresolved: "repeated" },
      ] } } },
    "messages.edit": { kind: "mutation", planHash: identity.planHash, ir: { args: { messageId: { Ref: { table: "messages" } } } },
      certificate: { mutation_targets: { complete: true, targets: [{ table: "messages", kind: "update", source: { argument: "messageId" } }] } } },
  } };
}

test("certified sources resolve without a prediction; ambiguous, missing, and malformed sources never guess", () => {
  const held = program();
  assert.deepEqual(admittedMutationTargets(held, "messages.post", {}, ["audit", "message"])?.rows,
    [{ table: "messages", kind: "create", id: "message" }]);
  assert.deepEqual(admittedMutationTargets(held, "messages.edit", { messageId: "existing" }, [])?.rows,
    [{ table: "messages", kind: "update", id: "existing" }]);
  assert.equal(admittedMutationTargets(undefined, "messages.post", {}, ["guessed"]), undefined);
  assert.deepEqual(admittedMutationTargets(program(99), "messages.post", {}, ["guessed"])?.rows, []);
  const op: any = held.programs["messages.post"];
  op.certificate.mutation_targets.targets[0] = { table: "messages", kind: "create", unresolved: "ambiguous" };
  assert.deepEqual(admittedMutationTargets(held, "messages.post", {}, ["first", "second"])?.rows, []);
  for (const source of [{ newId: -1 }, { newId: 1, argument: "messageId" }, { argument: "unknown" }]) {
    op.certificate.mutation_targets.targets[0] = { table: "messages", kind: "create", source };
    assert.equal(admittedMutationTargets(held, "messages.post", { messageId: "existing" }, ["first", "second"]), undefined);
  }
  const exact = { table: "messages", kind: "create", source: { newId: 1 } };
  for (const invalid of [exact, { table: "deliveries", kind: "create", source: { newId: -1 } },
    { table: "deliveries", kind: "create", unresolved: "unknown" }]) {
    op.certificate.mutation_targets.targets = [exact, invalid];
    assert.equal(admittedMutationTargets(held, "messages.post", {}, ["audit", "message"]), undefined,
      "a later invalid or duplicate descriptor refuses the entire relation, including earlier exact targets");
  }
});

test("a mounted mutation hook captures a changed semantic target of the same operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "snapback-hook-target-")), store = fileRangeStore(root);
  await seededStore(store);
  const client = createClient({ url: "http://hook-target.test", persona: "alice", fetch: fakeOwner().fetch, offline: { store } });
  let hook: ReturnType<typeof useMutation>, rendered: TestRenderer.ReactTestRenderer | undefined;
  function Harness({ reference }: { reference: any }) { hook = useMutation(reference); return null; }
  const show = (reference: any) => React.createElement(SnapbackProvider, { client }, React.createElement(Harness, { reference }));
  try {
    await client.ready; await client.offline();
    const refs = [api.messages.send, mutationTarget(api.messages.send, "messages"), mutationTarget(api.messages.send, "deliveries"), api.messages.send];
    for (const [index, reference] of refs.entries()) {
      await act(async () => { if (rendered) rendered.update(show(reference)); else rendered = TestRenderer.create(show(reference)); });
      await act(async () => { await hook!.run({ conversationId: "conversation-1", body: `send ${index}` }); });
    }
    const entries = await client.outbox.entries();
    assert.deepEqual(entries.map(entry => entry.presentation), [undefined, "messages", "deliveries", undefined]);
    assert(entries.every(entry => entry.targets?.rows.some(row => row.table === "messages" && row.id === entry.ids[0])),
      "each invocation still owns the writer's certified address");
  } finally {
    await act(async () => { rendered?.unmount(); });
    await client.close(); await rm(root, { recursive: true, force: true });
  }
});

for (const carrier of ["file", "indexeddb", "sqlite"]) test(`${carrier}: admission pins targets across program replacement and a cold reopen`, async () => {
  const root = await mkdtemp(join(tmpdir(), "snapback-targets-"));
  const indexed = indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as never, locks: new FakeLocks() as never });
  const factory = carrier === "file" ? fileRangeStore(root) : carrier === "sqlite" ? sqliteFactory(join(root, "store.db")) : indexed;
  let store = factory();
  try {
    await store.open("dev:alice");
    const ledger = new OutboxLedger(store, { now: () => 1_000, fenceMs: 100 });
    await ledger.adopt({ id: "grant", from: engineId(500), count: 20, used: 0, mintedAt: 0, expiresAt: 10_000 });
    const first = program();
    await ledger.recordBounds({ "messages.post": 2 }, { [first.generation]: first });
    const queued = await ledger.enqueue({ op: "messages.post", args: { body: "submitted" }, issuedSeq: 10 });
    assert.equal(queued.predicted, false, "fence skips prediction without suppressing certified addresses");
    assert.equal(queued.targets?.rows[0]?.id, engineId(501));
    const original = structuredClone(queued.targets);
    const replacement = program(0); replacement.generation = "d".repeat(64);
    replacement.programs["messages.post"]!.planHash = "e".repeat(64);
    await ledger.recordBounds({ "messages.post": 2 }, { [replacement.generation]: replacement });
    assert.deepEqual((await ledger.entries())[0]?.targets, original);
    await store.close(); store = factory(); await store.open("dev:alice");
    const reopened: OutboxEntry = (await store.outbox.get(queued.intent))!;
    assert.deepEqual(reopened.targets, original);
    const target = mutationTarget(api.messages.post, "messages");
    assert.equal(target.id(reopened), engineId(501));
    const committed = { ...reopened, state: "committed" as const, response: { seq: 11, program: identity } };
    assert.equal(target.id(committed), engineId(501));
    assert.equal(target.id({ ...committed, response: { seq: 11 } }), undefined);
    assert.equal(target.id({ ...committed, response: { seq: 11, program: { ...identity, planHash: "e".repeat(64) } } }), undefined);
    assert.equal(target.id({ ...committed, op: "other.post" }), undefined);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

test("replay response preserves exact execution identity and refuses malformed identity", () => {
  const response = { state: "committed", seq: 7, data: { id: "message" }, intent: "grant:0", program: identity };
  assert.deepEqual(wireReplayResponse(response), response);
  for (const program of [{ ...identity, planHash: "current" }, { schemaHash: identity.schemaHash }, null])
    assert.throws(() => wireReplayResponse({ ...response, program }));
});
