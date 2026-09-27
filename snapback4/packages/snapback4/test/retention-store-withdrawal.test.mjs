// @ref LLP 3000.023#3.4 — discovery, store boundaries and link loss end every retained answer.
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "../dist/client.js";

const q = { kind: "query", name: "read" };
const parked = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});
import { guardClient } from "../dist/app-client.js";
import { createApp } from "../dist/app.js";
import { keepSession, memorySessionStore } from "../dist/auth.js";

const peerPolicies = [[undefined, undefined], [false, false], [true, true],
  [false, undefined], [undefined, false], [false, true], [true, false]];
for (const mode of ["guard", "app", "lingering guard"]) for (const replacement of [true, false]) {
  for (const [keep, peerKeep] of mode === "lingering guard" ? [[true, undefined], [true, false], [true, true]] : peerPolicies) {
    test(`${mode}: ${replacement ? "replacement" : "restore"} withdraws every peer before callbacks, keep=${keep}, peerKeep=${peerKeep}`, async t => {
      const options = keep === undefined ? undefined : { keep };
      const peerOptions = peerKeep === undefined ? undefined : { keep: peerKeep };
      const url = "http://store-boundary.test", code = replacement ? "E_STORE_REPLACED" : "E_STORE_RESTORE";
      let changed = false, blockAuthority = false;
      const authority = Promise.withResolvers();
      const fetcher = async (input, init) => {
        const path = new URL(input).pathname;
        if (path === "/changes" || path === "/probe") return parked(init.signal);
        assert.equal(path, "/q/read");
        return Response.json({ data: ["private A"], complete: true, tables: ["private"],
          store_id: changed && replacement ? "B" : "A", seq: changed ? 1 : 100 });
      };
      let client, raw, app, facade;
      if (mode === "app") {
        const sessionStore = memorySessionStore();
        await keepSession(url, { token: "alice", principal: "alice", kind: "guest", expiresAt: Date.now() + 30 * 86400_000 }, sessionStore);
        app = createApp({ url, sessionStore, fetch: fetcher }); await app.ready;
        raw = client = app.client;
      } else {
        raw = createClient({ url, persona: "alice", fetch: fetcher });
        facade = guardClient(raw, async () => { if (blockAuthority) await authority.promise; return true; },
          () => true, () => ({ code: "E_AUTH", family: "auth", message: "closed" }));
        client = facade.client;
      }
      t.after(async () => { authority.resolve(); facade?.fence()(); await (app ? app.close() : raw.close()); });
      let first = client.observe(q, { first: true }, options);
      await until(() => first.getSnapshot().data);
      const peer = client.observe(q, { peer: true }, peerOptions);
      await until(() => peer.getSnapshot().data);
      if (mode === "lingering guard") {
        first.close(); blockAuthority = true;
        first = client.observe(q, { first: true }, options);
        assert.equal(first.getSnapshot().data[0], "private A");
      }
      const seen = [];
      first.subscribe(() => seen.push({ first: first.getSnapshot(), peer: peer.getSnapshot() }));
      changed = true;
      assert.equal((await raw.query(q, { discover: true })).denied?.code, code);
      assert.ok(seen.length > 0, "the store withdrawal notifies synchronously");
      for (const event of seen) {
        assert.ok(!("data" in event.first));
        assert.equal(event.peer.denied?.code, code, "the peer's old-store approval is gone before the first callback");
      }
      assert.equal(peer.getSnapshot().denied?.code, code);
    });
  }
}
async function until(check) {
  for (let n = 0; n < 500; n++) { if (check()) return; await delay(2); }
  assert.fail("online boundary did not settle");
}
