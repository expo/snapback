import { hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../dist/app.js";
import { memorySessionStore } from "../dist/auth.js";
import { server, until } from "./helpers/app-server.mjs";
const add = { kind: "mutation", name: "add" }, list = { kind: "query", name: "list" };

for (const refuse of [false, true]) test(`known online ${refuse ? "refusal" : "commit"} survives failed receipt saves and same-id restart recovery`, { timeout: hangBudget(13) }, async t => {
  const { url } = await server(t), memory = memorySessionStore(), sends = [], events = [];
  let failReceipt = true, key, failures = 0;
  const store = { ...memory, async set(k, text) {
    if (k.endsWith(".writes")) {
      key = k;
      if (failReceipt && JSON.parse(text).receipts.length) { failures++; throw Error("receipt disk unavailable"); }
    }
    await memory.set(k, text);
  } };
  const options = { url, sessionStore: store, fetch(input, init) {
    if (new URL(input).pathname === "/m/add") sends.push(JSON.parse(init.body));
    return fetch(input, init);
  } };
  const app = createApp(options); t.after(() => app.close()); await app.ready; await app.auth.guest();
  app.client.onWrite(write => events.push(write));
  const result = await app.mutate(add, { body: refuse ? "x".repeat(201) : "one row" });
  assert.equal(result.state, refuse ? "failed" : "sent");
  assert.equal(events.length, 1); assert.equal(events[0].id, result.id); assert.equal(events[0].state, result.state);
  for (let n = 0; n < 3; n++) {
    const receipt = await app.client.write(result.id);
    assert.equal(receipt.id, result.id); assert.equal(receipt.state, result.state);
    if (refuse) assert.equal(receipt.why.code, result.why.code);
  }
  assert.ok(failures >= 4); assert.equal(sends.length, 1); assert.equal(events.length, 1);
  assert.equal(JSON.parse(await memory.get(key)).pending[0].id, result.id);
  await app.close(); // Only the original durable intent crosses the restart.
  failReceipt = false;
  const reopened = createApp(options); t.after(() => reopened.close()); await reopened.ready;
  await until(async () => (await reopened.client.write(result.id))?.state === result.state);
  assert.ok(sends.length >= 2); assert.ok(sends.every(write => write.id === result.id));
  assert.equal((await reopened.client.query(list, {})).data.length, refuse ? 0 : 1);
  assert.equal(JSON.parse(await memory.get(key)).pending.length, 0);
});
