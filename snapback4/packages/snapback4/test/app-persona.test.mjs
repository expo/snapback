// @ref LLP 3000.013#6.1 — createApp({ persona }) keeps the App shape for dev UIs, with no session.
import { withHangGuard, hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { defaultFetch as fetch } from "../dist/node-fetch.js";
import { createApp } from "../dist/app.js";
import { loopbackUrl } from "../dist/app-persona.js";
import { processDevice } from "../dist/native.js";
import { binary, until, server } from "./helpers/app-server.mjs";

const source = `use personas alice, bob
use identity
table notes:
  owner: principal
  body: text <=200
  by byOwner: owner, id
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation add(body: text <=200):
  insert notes { owner: viewer, body }
query list():
  return notes[viewer] first 100 by byOwner
`;
const add = { kind: "mutation", name: "add" }, list = { kind: "query", name: "list" };

for (const tier of ["online", "local"]) test(`persona app ${tier}: acts as dev:<persona>, refuses sign-in, logout stops it`, { timeout: hangBudget(10) }, async t => {
  const { url, dir } = await server(t, undefined, source);
  const device = tier === "local" ? { device: processDevice({ dir: join(dir, "device"), binary }) } : {};
  const app = createApp({ url, persona: "bob", fetch, ...device }); t.after(() => app.close());
  const changes = [];
  app.auth.onChange(() => changes.push(app.auth.state));
  assert.equal(app.auth.state, "restoring");
  assert.deepEqual(await app.ready, { ok: true });
  assert.equal(app.auth.state, "signed-in"); assert.equal(app.auth.viewer, "dev:bob");
  assert.equal(app.client.viewer(), "dev:bob");
  assert.equal(app.client.session(), null, "a persona has no session");
  const write = await app.mutate(add, { body: "from bob" });
  assert.equal(write.state, "sent", JSON.stringify(write));
  const rows = await until(async () => { const read = await app.client.query(list, {}); return read.data?.length === 1 && read.data; });
  assert.equal(rows[0].owner, "dev:bob");
  const online = await app.online.query(list, {});
  assert.equal(online.data.length, 1, "app.online reads as the persona too");
  for (const signIn of [app.auth.login("a@example.com", "password-a"), app.auth.signup("a@example.com", "password-a"), app.auth.guest()]) {
    const refused = await signIn;
    assert.equal(refused.ok, false); assert.equal(refused.why.code, "E_AUTH"); assert.match(refused.why.message, /persona dev:bob/);
  }
  assert.equal((await app.auth.logoutEverywhere()).ok, false);
  assert.deepEqual(await app.auth.logout(), { ok: true });
  assert.equal(app.auth.state, "signed-out"); assert.equal(app.auth.viewer, null);
  const after = await app.mutate(add, { body: "after logout" });
  assert.equal(after.state, "failed"); assert.equal(after.why.code, "E_AUTH");
  assert.deepEqual(changes, ["signed-in", "signed-out"]);
});

test("persona app refuses a non-loopback url without a request, and a server that refuses personas", { timeout: hangBudget(1) }, async () => {
  await withHangGuard(async () => {
    for (const url of ["http://127.0.0.1:4400", "http://localhost:4400/", "http://[::1]:4400", "http://127.1.2.3:9"]) assert.equal(loopbackUrl(url), true, url);
    for (const url of ["http://example.com", "http://10.0.0.2:4400", "http://localhost.example.com", "http://127.0.0.1.nip.io", "https://app.example", "not a url"]) assert.equal(loopbackUrl(url), false, url);
    const requests = [];
    const recording = async (input, init) => { requests.push(String(input)); return fetch(input, init); };
    const remote = createApp({ url: "http://10.0.0.2:4400", persona: "alice", fetch: recording });
    const result = await remote.ready;
    assert.equal(result.ok, false); assert.equal(result.why.code, "E_AUTH"); assert.match(result.why.message, /development door/);
    assert.equal(remote.auth.state, "signed-out"); assert.equal(remote.auth.why.code, "E_AUTH");
    const refused = await remote.mutate(add, { body: "x" });
    assert.equal(refused.state, "failed"); assert.equal(refused.why.code, "E_AUTH");
    assert.deepEqual(requests, [], "no request carries a persona off loopback");
    await remote.close();
    const bad = createApp({ url: "http://127.0.0.1:4400", persona: "not a name", fetch: recording });
    assert.equal((await bad.ready).why.code, "E_AUTH"); await bad.close();
    // A deployed server (serve) refuses the header: the app reports it instead of signing in.
    const serve = async (input) => new URL(input).pathname === "/probe"
      ? Response.json({ denied: { code: "E_AUTH", family: "auth", message: "personas are a development door; a deployed server takes bearer tokens (snapback4/auth)" } }, { status: 401 })
      : Response.json({ denied: { code: "E_AUTH", family: "auth", message: "refused" } }, { status: 401 });
    const deployed = createApp({ url: "http://127.0.0.1:4400", persona: "alice", fetch: serve });
    const denied = await deployed.ready;
    assert.equal(denied.ok, false); assert.equal(denied.why.code, "E_AUTH"); assert.match(denied.why.message, /deployed server/);
    assert.equal(deployed.auth.state, "signed-out");
    await deployed.close();
  }, "persona refusals");
});

test("a browser persona app without a device names the device fix for writes; reads still work", { timeout: hangBudget(5) }, async t => {
  const { url } = await server(t, undefined, source);
  const previousWindow = globalThis.window;
  globalThis.window = { location: { href: url } };
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  const info = console.info; console.info = () => {}; t.after(() => { console.info = info; });
  const app = createApp({ url, persona: "alice", fetch }); t.after(() => app.close());
  assert.deepEqual(await app.ready, { ok: true });
  const write = app.mutate(add, { body: "x" });
  assert.equal(write.state, "failed", "the refusal is in the calling stack");
  assert.equal(write.why.code, "E_ADMISSION");
  assert.match(write.why.rewrite, /createApp\(\{ url, persona, device: webDevice\(\) \}\)/);
  assert.equal((await write).state, "failed");
  assert.deepEqual((await app.client.query(list, {})).data, []);
});
