import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { api, createClient } from "../dist/client.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { fakeOwner, seededStore } from "./fake-owner.ts";
import { sqliteFactory } from "./sqlite-fixture.ts";

async function carriers() {
  const fileRoot = await mkdtemp(join(tmpdir(), "s2-http400-file-"));
  const sqliteRoot = await mkdtemp(join(tmpdir(), "s2-http400-sqlite-"));
  const indexed = indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as any, locks: new FakeLocks() as any });
  return [
    { name: "file", factory: fileRangeStore(fileRoot), cleanup: () => rm(fileRoot, { recursive: true, force: true }) },
    { name: "IndexedDB", factory: indexed, cleanup: async () => undefined },
    { name: "SQLite", factory: sqliteFactory(join(sqliteRoot, "state.db")), cleanup: () => rm(sqliteRoot, { recursive: true, force: true }) },
  ];
}

const post = (body: string) => ({ conversationId: "conversation-1", body });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// @ref LLP 1020#a2-enum-case-removal-is-checked-narrowing — a validated input
// refusal remains queued, blocked, and dismissible. Malformed HTTP 400 bodies
// are ambiguous and retain the same bytes without inventing dismissal evidence.
test("HTTP 400 outbox custody survives validated refusal, malformed retry, and restart byte-identically on all carriers", async () => {
  for (const carrier of await carriers()) {
    const refusal = { code: "E_INPUT", family: "input", message: "removed enum case",
      rewrite: "dismiss this refused intent", guide: "input/runtime" };
    const owner = fakeOwner();
    const mutationBodies: string[] = [];
    let mode: "validated" | "malformed" = "validated";
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (new URL(String(input)).pathname !== "/api/mutation") return owner.fetch(input, init);
      mutationBodies.push(String(init?.body));
      return mode === "validated"
        ? new Response(JSON.stringify(refusal), { status: 400, headers: { "content-type": "application/json" } })
        : new Response("{", { status: 400, headers: { "content-type": "application/json" } });
    };
    await seededStore(carrier.factory);
    let client = createClient({ url: "http://http400.test", persona: "alice", fetch, offline: { store: carrier.factory } });
    try {
      await client.ready;
      await client.offline();
      await client.mutation(api.messages.send as any, post("removed"));
      let error: any = await client.online().then(() => undefined, value => value);
      assert.equal(error?.code, "E_INPUT", carrier.name);
      await sleep(450);
      assert.equal(mutationBodies.length, 1, `${carrier.name}: validated refusal did not retry itself`);
      let entry = (await client.outbox.entries())[0]!;
      const identity = entry.intent;
      assert.equal(entry.state, "queued");
      assert.equal(entry.refusal?.code, "E_INPUT");
      assert.deepEqual((await client.outbox.status()).blocked, { intent: identity, code: "E_INPUT" });

      await client.close();
      client = createClient({ url: "http://http400.test", persona: "alice", fetch,
        startOffline: true, offline: { store: carrier.factory } } as any);
      await client.ready;
      entry = (await client.outbox.entries())[0]!;
      assert.equal(entry.intent, identity, `${carrier.name}: restart retained identity`);
      assert.equal(entry.refusal?.code, "E_INPUT", `${carrier.name}: restart retained dismissal evidence`);

      mode = "malformed";
      error = await client.online().then(() => undefined, value => value);
      assert.equal(error?.code, "E_WIRE_SHAPE", `${carrier.name}: malformed body is not a validated refusal`);
      entry = (await client.outbox.entries())[0]!;
      assert.equal(entry.intent, identity);
      assert.equal(entry.state, "queued");
      assert.equal(entry.refusal, undefined, `${carrier.name}: an ambiguous response is not dismissible`);
      assert.equal((await client.outbox.status()).blocked, undefined);

      mode = "validated";
      error = await client.online().then(() => undefined, value => value);
      assert.equal(error?.code, "E_INPUT");
      assert.equal((await client.outbox.entries())[0]!.intent, identity);
      assert.ok(mutationBodies.every(body => body === mutationBodies[0]), `${carrier.name}: every retry used identical bytes`);
      const dismissed = await client.outbox.dismiss(identity);
      assert.equal(dismissed?.intent, identity);
      assert.deepEqual(dismissed?.args, post("removed"));
    } finally {
      await client.close();
      await carrier.cleanup();
    }
  }
});
