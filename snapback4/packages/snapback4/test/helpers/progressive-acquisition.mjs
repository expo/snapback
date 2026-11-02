import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after } from "./teardown.mjs";
import { captureStdout } from "./server-output.mjs";
import { waitFor } from "./wait.mjs";
import { createLocalClient } from "../../dist/local.js";
import { processDevice } from "../../dist/native.js";
import { memoryPersistence, webDevice } from "../../dist/web.js";
import { acquisition } from "../../dist/acquisition.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
export const query = name => ({ kind: "query", name });
export const source = `use personas alice, bob
table participants:
  threadId: threads
  personId: principal
  unique threadId, personId
  cap 50 by threadId
  read <- exists participants[.threadId, viewer]
  delete <- .personId = viewer
  sync by .personId
table threads:
  subject: text <=100
  read <- exists participants[.id, viewer]
  sync to participants[.id] by .personId
table messages:
  conversation: threads
  body: text <=100
  at: time
  read <- exists participants[.conversation, viewer]
  insert <- exists participants[.conversation, viewer]
  sync to participants[.conversation] by .personId last 2 by .at, .id
query inbox():
  return participants where .personId = viewer first 50 by .threadId
query thread(c: threads):
  return threads[c]
query history(c: threads, page: cursor ?):
  return messages where .conversation = c last 2 by .at, .id after page
query missing(m: messages):
  return exists messages[m]
query one(m: messages):
  return messages[m]
query total(c: threads):
  return count(messages where .conversation = c)
mutation add(c: threads, body: text <=100):
  insert messages {conversation: c, body, at: now}
mutation leave(m: participants):
  delete participants[m]
`;

export async function fixture(t, tier, { legacy = false, oldDevice = false, retained = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-progressive-acquisition-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), retained ? source.replace("  sync to participants[.conversation]", "  retain delivered-history\n  sync to participants[.conversation]") : source);
  const child = spawn(binary, ["dev", "--port", "0"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(child), exit = once(child, "exit");
  let errors = "";
  child.stderr.on("data", data => { errors += data; });
  const clients = [];
  after(t, async () => {
    await Promise.allSettled(clients.map(c => c.close()));
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    await exit; rmSync(directory, { recursive: true, force: true });
  });
  let url;
  await waitFor(() => { assert.equal(child.exitCode, null, errors); url = readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; return url; }, "progressive fixture server did not listen");
  const headers = { "x-snapback-persona": "alice" };
  const post = (path, body) => fetch(`${url}${path}`, { method: "POST", headers, body: JSON.stringify(body) }).then(r => r.json());
  const backend = await fetch(`${url}/schema`, { headers }).then(r => r.json());
  const groups = ["a", "b", "c", "d", "empty"];
  const rows = groups.flatMap(g => [
    { table: "threads", row: { id: g, subject: g } },
    { table: "participants", row: { id: `p${g}`, threadId: g, personId: "dev:alice" } },
    ...g === "empty" ? [] : [1, 2, 3, 4].map(n => ({ table: "messages", row: { id: `${g}${n}`, conversation: g, body: `${g}${n}`, at: 1 } })),
  ]);
  assert.equal((await post("/seed", rows)).seeded, rows.length);
  // Keep the seed log intact: the first unit's pin, not fixture surgery, must
  // prevent historical join expansion from bypassing the priority walk.
  const persist = memoryPersistence(), deviceDir = join(directory, "device"); mkdirSync(deviceDir);
  let core, online = true, allow = false, intercept, onApply, advertised = !legacy;
  const requests = [], pages = [], applies = [], queries = [], order = [];
  let inflight = 0, maxInflight = 0;
  const open = async () => {
    const opener = tier === "wasm" ? webDevice({ wasm, persist }) : processDevice({ binary, dir: deviceDir,
      spawn: (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }),
      writeFile: async (path, text) => writeFileSync(path, text) });
    const client = await createLocalClient({ url, persona: "alice", waitSeconds: 1,
      device: { open: async (...args) => {
        core = await opener.open(...args);
        const call = core.call.bind(core);
        core.call = async (request, committed) => {
          const reply = await call(request, committed);
          if (request.op === "apply" && !reply.denied) { applies.push({ page: request.page, reply: reply.ok }); await onApply?.(request.page, reply.ok); }
          if (request.op === "sync_state" && oldDevice && reply.ok) {
            for (const key of ["acquisition_cursor", "acquisition_exhausted", "acquired_tables", "floored_groups", "replacement_required"]) delete reply.ok[key];
          }
          return reply;
        };
        return core;
      } },
      fetch: async (input, init) => {
        const path = new URL(input).pathname;
        if (!online) throw new TypeError("offline witness");
        if (path.startsWith("/q/")) queries.push(path);
        if ((path === "/schema" || path === "/") && !advertised) {
          const json = await fetch(input, init).then(r => r.json());
          if (json.device_compatibility) delete json.device_compatibility.advertised;
          return Response.json(json);
        }
        if (path === "/sync") {
          if (!allow) throw new TypeError("pause between acquisition pages");
          const body = JSON.parse(init.body); requests.push(body); order.push(body.acquire ? "acquire" : "stream");
          if (!advertised) assert.equal(Object.hasOwn(body, "acquire"), false, "old server denies unknown fields");
          inflight++; maxInflight = Math.max(maxInflight, inflight);
          try {
            await intercept?.(body);
            const response = await fetch(input, { ...init, body: JSON.stringify({ ...body, limit: 2 }) });
            pages.push(await response.clone().json());
            return response;
          } finally { inflight--; }
        }
        if (path.startsWith("/m/")) order.push("write");
        return fetch(input, init);
      },
    });
    clients.push(client); return client;
  };
  const state = async () => { const r = await core.call({ op: "sync_state", capture: false }); assert.equal(r.denied, undefined); return r.ok; };
  const raw = async (name, args) => (await core.call({ op: "query", name, args, viewer: "dev:alice", now: Date.now() })).ok;
  const through = async (client, predicate) => {
    allow = true;
    onApply = async () => { if (await predicate(await state())) allow = false; };
    // Drive the follow loop and the hook's actual subscription surface. Explicit
    // sync deliberately waits for the entire walk and is tested separately.
    const progress = acquisition(client), unsubscribe = progress.subscribe(() => {});
    try {
      await waitFor(async () => {
        const s = await state(), usable = progress.read().usable;
        return await predicate(s) && usable.tables === s.acquired_tables.length && usable.groups === s.floored_groups;
      }, "background acquisition did not reach the requested publication");
    } finally { unsubscribe(); }
    onApply = undefined;
  };
  return { open, backend, post, state, raw, through, requests, pages, applies, queries, order, groups,
    online: value => { online = value; }, allow: value => { allow = value; }, advertise: value => { advertised = value; },
    intercept: callback => { intercept = callback; }, onApply: callback => { onApply = callback; },
    core: () => core, maxInflight: () => maxInflight };
}
