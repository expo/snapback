// @ref LLP 3000.013#6.2 — a browser client that cannot write says so when it is built.
// @ref LLP 3000.013.000#3 — a device-less createApp journals writes only over localStorageSessionStore().
import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../dist/client.js";
import { createApp } from "../dist/app.js";
import { memorySessionStore } from "../dist/auth.js";

test("a bare browser createClient and a device-less createApp warn once at construction; SDK-owned clients do not", async t => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { href: "http://127.0.0.1:5173/" } };
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  const warnings = [], warn = console.warn, info = console.info;
  console.warn = message => warnings.push(String(message)); console.info = () => {};
  t.after(() => { console.warn = warn; console.info = info; });
  const unreachable = async () => { throw Error("offline"); };
  const url = "http://127.0.0.1:9";
  // The app's own tiers (anonymous, online scopes, app.online) are SDK-owned.
  const device = { open: async () => { throw Error("not opened in this test"); } };
  const withDevice = createApp({ url, device, sessionStore: memorySessionStore(), fetch: unreachable });
  assert.deepEqual(warnings, []);
  const bare = createClient({ url, persona: "alice", fetch: unreachable });
  createClient({ url, fetch: unreachable }).close();
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /refuses durable writes with E_ADMISSION/);
  assert.match(warnings[0], /createApp\(\{ url, sessionStore: localStorageSessionStore\(\) \}\) when no table syncs/);
  assert.match(warnings[0], /otherwise createApp\(\{ url, device: webDevice\(\), sessionStore: localStorageSessionStore\(\) \}\)/);
  const write = bare.mutate({ kind: "mutation", name: "add" }, {});
  assert.equal(write.state, "failed"); assert.equal(write.why.code, "E_ADMISSION");
  assert.equal(write.why.rewrite, "createApp({ url, sessionStore: localStorageSessionStore() }) when no table syncs; otherwise createApp({ url, device: webDevice(), sessionStore: localStorageSessionStore() })");
  assert.match(write.why.message, /without a device when no table syncs/);
  assert.throws(() => createApp({ url, sessionStore: memorySessionStore(), fetch: unreachable }), error => error.why?.code === "E_ADMISSION");
  assert.equal(warnings.length, 1);
  await Promise.all([bare.close(), withDevice.close()]);
});
