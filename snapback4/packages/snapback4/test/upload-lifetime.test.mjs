import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { memorySessionStore } from "../dist/auth.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const wasm = readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url));
const bytes = new Uint8Array([1, 2, 3]);
const asset = { id: "uploaded", type: "image/png", bytes: 3, width: 1, height: 1, duration: null };
const rateLimit = { code: "E_RATE_LIMIT", family: "auth", message: "all upload slots are full", retryable: true };
const session = token => ({ token, principal: "user:alice", kind: "user", expiresAt: Date.now() + 7 * 86_400_000 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, tier, respond, refresh = async () => {}, store = async () => {}) {
  const requests = [], facts = [];
  const device = webDevice({ wasm, persist: memoryPersistence() });
  const options = {
    url: "http://upload-lifetime.invalid", session: session("old"), sessionStore: memorySessionStore(),
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/schema") return Response.json({ generation: 1, schema: { tables: {} }, programs: [] });
      if (path === "/sync") return Response.json({ snapshot: false, events: [], watermark: 0, more: false, generation: 1, acknowledged: [] });
      if (path === "/changes") return new Promise((_, reject) => {
        if (init.signal.aborted) reject(init.signal.reason);
        else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
      if (path === "/auth/refresh") { await refresh(); return Response.json({ session: session("new") }); }
      if (path === "/auth/logout" || path === "/probe") return Response.json({ ok: true });
      assert.equal(path, "/assets");
      requests.push(new Headers(init.headers).get("authorization"));
      return respond(requests.length);
    },
    device: { open: async (...args) => {
      const core = await device.open(...args);
      return { ...core, call: async request => {
        if (request.op === "upload_facts") { facts.push(request.asset); await store(); }
        return core.call(request);
      } };
    } },
  };
  const client = tier === "online" ? createClient(options) : await createLocalClient(options);
  t.after(() => client.close());
  return { client, requests, facts };
}

for (const tier of ["online", "web"]) {
  test(`${tier} upload started during refresh waits for the replacement bearer`, { timeout: 10_000 }, async t => {
    const entered = deferred(), refreshed = deferred();
    const { client, requests } = await fixture(t, tier, async () => Response.json({ asset }),
      async () => { entered.resolve(); await refreshed.promise; });
    const rotating = client.refreshSession();
    await entered.promise;
    const uploading = client.upload(bytes);
    await Promise.resolve();
    const beforeRefresh = [...requests];
    refreshed.resolve();
    assert.equal((await rotating).ok, true);
    assert.deepEqual(await uploading, { ok: true, asset });
    assert.deepEqual(beforeRefresh, [], "no request uses the bearer being rotated");
    assert.deepEqual(requests, ["Bearer new"]);
  });

  for (const ending of ["sign-out", "close", "rotation", "refresh in progress"]) {
    for (const reply of ["success", "admission refusal"]) {
      test(`${tier} upload refuses a late ${reply} after ${ending}`, { timeout: 10_000 }, async t => {
        const entered = deferred(), response = deferred(), refreshed = deferred();
        const { client, requests, facts } = await fixture(t, tier, async () => {
          entered.resolve(); await response.promise;
          return reply === "success" ? Response.json({ asset }) : Response.json({ denied: rateLimit }, { status: 429 });
        }, () => refreshed.promise);
        const uploading = client.upload(bytes);
        await entered.promise;
        let rotating;
        if (ending === "sign-out") await client.signOut();
        else if (ending === "close") await client.close();
        else {
          rotating = client.refreshSession();
          if (ending === "rotation") { refreshed.resolve(); assert.equal((await rotating).ok, true); }
        }
        response.resolve();
        const result = await uploading;
        // Finish the held refresh before assertions/cleanup, even on a regression.
        refreshed.resolve();
        if (rotating) assert.equal((await rotating).ok, true);
        assert.equal(result.ok, false, "an old reply cannot publish success to a changed session");
        assert.equal(result.why.code, ending === "sign-out" || ending === "close" ? "E_CLOSED" : "E_AUTH");
        assert.deepEqual(requests, ["Bearer old"], "an interrupted upload never replays under either bearer");
        assert.deepEqual(facts, [], "the device never adopts an obsolete upload receipt");
        if (rotating) assert.equal(client.session().token, "new", "refusing an obsolete upload does not sign out the replacement");
      });
    }
  }

  for (const ending of ["sign-out", "rotation"]) {
    test(`${tier} upload stops before retry when ${ending} occurs during backoff`, { timeout: 10_000 }, async t => {
      const backoff = deferred();
      let resume;
      const { client, requests, facts } = await fixture(t, tier, async attempt => attempt === 1
        ? Response.json({ denied: rateLimit }, { status: 429 }) : Response.json({ asset }));
      const originalTimer = globalThis.setTimeout;
      t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
        if (delay !== 250) return originalTimer(callback, delay, ...args);
        resume = () => callback(...args); backoff.resolve(); return 0;
      });
      const uploading = client.upload(bytes);
      await backoff.promise;
      if (ending === "rotation") assert.equal((await client.refreshSession()).ok, true);
      else await client.signOut();
      resume();
      const result = await uploading;
      assert.deepEqual(requests, ["Bearer old"], "the retry itself must be fenced, even if the final reply would be discarded");
      assert.equal(result.ok, false);
      assert.equal(result.why.code, ending === "rotation" ? "E_AUTH" : "E_CLOSED");
      assert.deepEqual(facts, []);
    });
  }
}

test("web upload refuses a result when rotation overlaps device receipt persistence", { timeout: 10_000 }, async t => {
  const entered = deferred(), stored = deferred();
  const { client, requests } = await fixture(t, "web", async () => Response.json({ asset }), undefined,
    async () => { entered.resolve(); await stored.promise; });
  const uploading = client.upload(bytes);
  await entered.promise;
  assert.equal((await client.refreshSession()).ok, true);
  stored.resolve();
  const result = await uploading;
  assert.equal(result.ok, false);
  assert.equal(result.why.code, "E_AUTH");
  assert.deepEqual(requests, ["Bearer old"]);
});
