import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const source = `use personas alice
table posts:
  at: time
  public 'posts'
  insert <- allow
table reposts:
  at: time
  public 'reposts'
  insert <- allow
view activity:
  posts { at, kind: 'post' }
  reposts { at, kind: 'repost' }
query global(c: cursor ?):
  return activity last 20 by .at after c
mutation post(id: id):
  return insert posts { id, at: 1 }
mutation repost(id: id):
  return insert reposts { id, at: 2 }
`;

test("a planned union subscription reruns for either source table", { timeout: hangBudget(9) }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "sb4-intent-live-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(server, "exit");
  let log = "", url, client, watch;
  for (const stream of [server.stdout, server.stderr]) stream.on("data", bytes => { log += bytes; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; });
  t.after(async () => { watch?.close(); await client?.close(); if (server.exitCode == null && server.signalCode == null) server.kill(); await exited; rmSync(directory, { recursive: true, force: true }); });
  const until = async predicate => {
    return awaitState(() => { assert.equal(server.exitCode, null, log); return predicate(); }, 'subscription update', { diagnostics: () => `${JSON.stringify(watch?.getSnapshot())}; ${log}` });
  };
  await until(() => url);
  client = await createLocalClient({ url, persona: "alice", waitSeconds: 1, device: processDevice({ binary, dir: join(directory, "device") }) });
  watch = client.observe({ kind: "query", name: "global" }, { c: null });
  const publications = [];
  watch.subscribe(() => { const data = watch.getSnapshot().data; if (data) publications.push(structuredClone(data)); });
  await until(() => watch.getSnapshot().data?.length === 0);
  for (const [operation, count] of [["post", 1], ["repost", 2]]) {
    const response = await fetch(`${url}/m/${operation}`, { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify({ id: operation, args: { id: "same" } }) });
    const write = await response.json();
    assert.equal(write.state, "sent", JSON.stringify(write));
    await until(() => watch.getSnapshot().data?.length === count);
  }
  assert.deepEqual(watch.getSnapshot().data.map(row => row.kind), ["repost", "post"]);
  assert.ok(publications.some(rows => rows.length === 1));
  assert.ok(publications.some(rows => rows.length === 2));
});
