import { hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { promiseHooks } from "node:v8";
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

async function fixture(t, tier, respond, refresh = async () => {}, store = async () => {}, forget = async () => {}) {
  const requests = [], facts = [];
  const persist = memoryPersistence();
  const device = webDevice({ wasm, persist });
  let storeName;
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
      if (path === "/auth/refresh") return await refresh() ?? Response.json({ session: session("new") });
      if (path === "/auth/logout" || path === "/probe") return Response.json({ ok: true });
      assert.equal(path, "/assets");
      requests.push(new Headers(init.headers).get("authorization"));
      return respond(requests.length);
    },
    device: { open: async (...args) => {
      storeName = args[0];
      const core = await device.open(...args);
      return { ...core, call: async request => {
        if (request.op === "forget_upload_facts") {
          const injected = await forget();
          if (injected) return injected;
        }
        const result = await core.call(request);
        if (request.op === "upload_facts") { facts.push(request.asset); await store(); }
        return result;
      } };
    } },
  };
  const client = tier === "online" ? createClient(options) : await createLocalClient(options);
  t.after(() => client.close());
  const receipt = () => persist.read(storeName, "m", `device:upload:${JSON.stringify(["user:alice", asset.id])}`);
  return { client, requests, facts, receipt };
}

for (const tier of ["online", "web"]) {
  test(`${tier} upload started during refresh waits for the replacement bearer`, { timeout: hangBudget(6) }, async t => {
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
      test(`${tier} upload refuses a late ${reply} after ${ending}`, { timeout: hangBudget(8) }, async t => {
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
    test(`${tier} upload stops before retry when ${ending} occurs during backoff`, { timeout: hangBudget(5) }, async t => {
      const backoff = deferred();
      t.mock.method(Math, "random", () => 0.5);
      let resume;
      const { client, requests, facts } = await fixture(t, tier, async attempt => attempt === 1
        ? Response.json({ denied: rateLimit }, { status: 429 }) : Response.json({ asset }));
      const originalTimer = globalThis.setTimeout;
      t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
        if (delay !== 281.25) return originalTimer(callback, delay, ...args);
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

for (const ending of ["rotation", "failed refresh", "sign-out", "close"]) {
  test(`web upload receipt cleanup after ${ending} overlaps persistence`, { timeout: hangBudget(9) }, async t => {
    const entered = deferred(), stored = deferred();
    const { client, requests, receipt } = await fixture(t, "web", async () => Response.json({ asset }),
      ending === "failed refresh" ? async () => { throw new TypeError("refresh unavailable"); } : undefined,
      async () => { entered.resolve(); await stored.promise; });
    const uploading = client.upload(bytes);
    await entered.promise;
    assert.deepEqual(JSON.parse(await receipt()), asset, "the delayed device call already persisted the receipt");
    let closing;
    if (ending === "close") closing = client.close();
    else if (ending === "sign-out") closing = client.signOut();
    else assert.equal((await client.refreshSession()).ok, ending === "rotation");
    stored.resolve();
    const result = await uploading;
    await closing;
    assert.deepEqual(requests, ["Bearer old"]);
    if (ending === "failed refresh") {
      assert.deepEqual(result, { ok: true, asset });
      assert.deepEqual(JSON.parse(await receipt()), asset, "a valid receipt survives an unchanged bearer");
    } else {
      assert.equal(result.ok, false);
      if (ending === "sign-out") assert.ok(["E_AUTH", "E_CLOSED"].includes(result.why.code));
      else assert.equal(result.why.code, ending === "rotation" ? "E_AUTH" : "E_CLOSED");
      assert.equal(await receipt(), null, "a refused upload must leave no prediction receipt");
    }
  });
}


const failedRefreshes = {
  transport: async () => { throw new TypeError("refresh unavailable"); },
  admission: async () => Response.json({ denied: rateLimit }, { status: 429 }),
};
for (const tier of ["online", "web"]) for (const [failure, refresh] of Object.entries(failedRefreshes)) {
  test(`${tier} upload E_AUTH ends the session after a completed ${failure} refresh failure`, { timeout: hangBudget(5) }, async t => {
    const entered = deferred(), response = deferred();
    const denied = { code: "E_AUTH", family: "auth", message: "this bearer was revoked" };
    const { client, requests, facts } = await fixture(t, tier, async () => {
      entered.resolve(); await response.promise;
      return Response.json({ denied }, { status: 401 });
    }, refresh);
    const uploading = client.upload(bytes);
    await entered.promise;
    assert.equal((await client.refreshSession()).ok, false);
    assert.equal(client.session().token, "old");
    response.resolve();
    const result = await uploading;
    assert.equal(result.ok, false);
    assert.equal(result.why.code, "E_AUTH");
    assert.equal(client.session(), null, "the unchanged bearer is still subject to a later authorization refusal");
    assert.deepEqual(requests, ["Bearer old"]);
    assert.deepEqual(facts, []);
  });
}

test("web close waits until interrupted upload receipt deletion finishes", { timeout: hangBudget(9) }, async t => {
  const entered = deferred(), stored = deferred(), forgetting = deferred(), removed = deferred();
  const { client, receipt } = await fixture(t, "web", async () => Response.json({ asset }), undefined,
    async () => { entered.resolve(); await stored.promise; },
    async () => { forgetting.resolve(); await removed.promise; });
  const uploading = client.upload(bytes);
  await entered.promise;
  const closing = client.close();
  stored.resolve();
  await forgetting.promise;
  assert.deepEqual(JSON.parse(await receipt()), asset, "deletion is held before the device call");
  // Let the existing one-second change-feed backoff finish too: it must not
  // accidentally keep the core alive for an untracked upload cleanup.
  let timer;
  const closedEarly = await Promise.race([closing.then(() => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), 1250); })]);
  clearTimeout(timer);
  removed.resolve();
  const results = await Promise.allSettled([uploading, closing]);
  assert.equal(closedEarly, false, "close must wait for receipt deletion");
  assert.deepEqual(results[0], { status: "fulfilled", value: { ok: false,
    why: { code: "E_CLOSED", family: "client", message: "this client is closed" } } });
  assert.equal(results[1].status, "fulfilled");
  assert.equal(await receipt(), null);
});

for (const ending of ["rotation", "close"]) test(`web upload keeps the session refusal when receipt deletion is denied after ${ending}`, { timeout: hangBudget(10) }, async t => {
  const entered = deferred(), stored = deferred(), forgetting = deferred(), removed = deferred();
  let deletions = 0;
  const storageRefusal = { code: "E_STORE", family: "store", message: "injected receipt deletion refusal" };
  const { client, requests, receipt } = await fixture(t, "web", async () => Response.json({ asset }), undefined,
    async () => { entered.resolve(); await stored.promise; },
    async () => { deletions++; forgetting.resolve(); await removed.promise; return { denied: storageRefusal }; });
  t.after(() => { stored.resolve(); removed.resolve(); });
  const uploading = client.upload(bytes);
  const settled = Promise.allSettled([uploading]);
  await entered.promise;
  assert.deepEqual(JSON.parse(await receipt()), asset);
  let closing;
  if (ending === "close") closing = client.close();
  else assert.equal((await client.refreshSession()).ok, true);
  stored.resolve();
  await forgetting.promise;
  // Also close the rotated owner while the refused cleanup is pending.
  closing ??= client.close();
  removed.resolve();
  const [result] = await settled;
  await closing;
  assert.deepEqual(result, { status: "fulfilled", value: { ok: false, why: ending === "close"
    ? { code: "E_CLOSED", family: "client", message: "this client is closed" }
    : { code: "E_AUTH", family: "auth", message: "the session changed during upload; start the upload again" } } });
  assert.equal(deletions, 1);
  assert.deepEqual(requests, ["Bearer old"]);
  assert.deepEqual(JSON.parse(await receipt()), asset, "the injection really refused deletion; it did not silently clean up");
});

test("web upload fences close in every microtask between receipt persistence and upload settlement", { timeout: hangBudget(6) }, async t => {
  let fenced = 0, completed = 0;
  for (let offset = 0; offset <= 8; offset++) {
    let uploading, closing, settled = false, closedBeforeSettlement;
    const closed = deferred();
    // Observe actual promise settlement, not a consumer's later .then callback:
    // closing after settlement is allowed, but closing before it must refuse.
    const stop = promiseHooks.onSettled(promise => { if (promise === uploading) settled = true; });
    try {
      const { client, receipt } = await fixture(t, "web", async () => Response.json({ asset }), undefined, async () => {
        const closeAfter = remaining => {
          if (remaining) queueMicrotask(() => closeAfter(remaining - 1));
          else { closedBeforeSettlement = !settled; closing = client.close(); closed.resolve(); }
        };
        queueMicrotask(() => closeAfter(offset));
      });
      uploading = client.upload(bytes);
      const result = await uploading;
      await closed.promise;
      await closing;
      if (closedBeforeSettlement) {
        fenced++;
        assert.equal(result.ok, false, `close at microtask ${offset} preceded upload settlement`);
        assert.equal(result.why.code, "E_CLOSED");
        assert.equal(await receipt(), null, `microtask ${offset} must not leave a prediction receipt`);
      } else {
        completed++;
        assert.deepEqual(result, { ok: true, asset });
        assert.deepEqual(JSON.parse(await receipt()), asset);
      }
    } finally { stop(); }
  }
  assert.ok(fenced > 0 && completed > 0, "the interleavings must cross the upload settlement boundary");
});

for (const tier of ["online", "web"]) for (const [failure, refresh] of Object.entries(failedRefreshes)) {
  for (const reply of ["success", "admission refusal"]) {
    test(`${tier} upload preserves ${reply} after a completed ${failure} refresh failure`, { timeout: hangBudget(6) }, async t => {
      const entered = deferred(), response = deferred();
      const { client, requests, receipt } = await fixture(t, tier, async () => {
        entered.resolve(); await response.promise;
        return reply === "success" ? Response.json({ asset }) : Response.json({ denied: rateLimit }, { status: 429 });
      }, refresh);
      const uploading = client.upload(bytes);
      await entered.promise;
      assert.equal((await client.refreshSession()).ok, false);
      assert.equal(client.session().token, "old");
      response.resolve();
      assert.deepEqual(await uploading, reply === "success" ? { ok: true, asset } : { ok: false, why: rateLimit });
      assert.deepEqual(requests, Array(reply === "success" ? 1 : 4).fill("Bearer old"));
      if (tier === "web" && reply === "success") assert.deepEqual(JSON.parse(await receipt()), asset);
    });
  }
  test(`${tier} upload continues backoff after a completed ${failure} refresh failure`, { timeout: hangBudget(4) }, async t => {
    const backoff = deferred();
    t.mock.method(Math, "random", () => 0.5);
    let resume;
    const { client, requests } = await fixture(t, tier, async attempt => attempt === 1
      ? Response.json({ denied: rateLimit }, { status: 429 }) : Response.json({ asset }), refresh);
    const originalTimer = globalThis.setTimeout;
    t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
      if (delay !== 281.25) return originalTimer(callback, delay, ...args);
      resume = () => callback(...args); backoff.resolve(); return 0;
    });
    const uploading = client.upload(bytes);
    await backoff.promise;
    assert.equal((await client.refreshSession()).ok, false);
    resume();
    assert.deepEqual(await uploading, { ok: true, asset });
    assert.deepEqual(requests, ["Bearer old", "Bearer old"]);
  });
}
