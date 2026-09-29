import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const require = createRequire(import.meta.url);
const compiler = dirname(require.resolve("typescript/package.json"));
const nodeTypes = dirname(require.resolve("@types/node/package.json"));
export const KEY = "a3-fixture-HMAC-secret-not-a-provider-credential";
const safe = text => String(text).replaceAll(KEY, "[REDACTED]").replace(/token \(printed once\): \S+/g, "token (printed once): [REDACTED]");
export const sign = body => createHmac("sha256", KEY).update(body).digest("hex");
export const lines = path => { try { return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch { return []; } };

export async function until(check, description, diagnostics = () => "", milliseconds = 10_000) {
  const end = Date.now() + milliseconds;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= end) throw Error(`timed out: ${description}\n${safe(diagnostics())}`);
    await delay(20);
  }
}

const journal = `use server
use personas alice, bob
use identity
table journal:
  owner: principal
  body: text <=200
  by byOwner: owner, id
  read <- .owner = viewer
  insert <- .owner = viewer
mutation record(body: text <=200):
  return insert journal { owner: viewer, body }
query mine():
  return journal[viewer] first 50 by byOwner
`;

export function entry(routes, { setup = "", lease = 10, wait = 1, actions } = {}) {
  return `import { server } from "./generated/server.ts";
import { api } from "./generated/api.ts";
import { type RouteRequest, type VerificationContext, type ServerContext, ParkStep, ServerError } from "snapback4/server";
import { GiveUp, Retry } from "snapback4/worker";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
const stop = new AbortController();
process.once("SIGTERM", () => stop.abort()); process.once("SIGINT", () => stop.abort());
function record(name: string, value: unknown) { appendFileSync(process.cwd() + "/" + name + ".jsonl", JSON.stringify(value) + "\\n", {flush:true}); }
async function verify(req: RouteRequest, ctx: VerificationContext<"HOOK_KEY">): Promise<boolean> {
  const bytes = await req.rawBody();
  const expected = createHmac("sha256", ctx.secrets.HOOK_KEY).update(bytes).digest();
  const supplied = req.headers.get("x-signature") ?? "";
  const ok = /^[0-9a-f]{64}$/.test(supplied) && timingSafeEqual(expected, Buffer.from(supplied, "hex"));
  record("verified", {ok, hex:Buffer.from(bytes).toString("hex"), keys:Object.keys(ctx).sort(), secrets:Object.keys(ctx.secrets)});
  bytes.fill(0); // This copy must not change the admitted envelope or a later rawBody().
  return ok;
}
async function save<S extends string>(ctx: ServerContext<S>, body: string) {
  const result = await ctx.mutate(api.record, {body}, {id:ctx.writeIdFor("record")});
  if (result.state !== "sent") throw new Retry("the fixture write did not settle");
  return result;
}
${setup}
const worker = server({${actions === undefined ? "" : `actions:${actions},`}routes:${routes}}, {signal:stop.signal, lease:${lease}, wait:${wait}, batch:1, statusIntervalMs:50});
export default worker;
record("ready", {pid:process.pid});
await worker.done;
`;
}

export function fixture(t, schema, source) {
  assert.match(process.versions.node, /^24\./, "run route HTTP witnesses with pinned Node 24");
  const directory = mkdtempSync(join(tmpdir(), "sb4-a3-routes-"));
  const database = join(directory, ".snapback4/store.sqlite");
  mkdirSync(join(directory, "snapback")); mkdirSync(join(directory, "node_modules/@types"), {recursive:true});
  symlinkSync(join(root, "packages/snapback4"), join(directory, "node_modules/snapback4"));
  symlinkSync(compiler, join(directory, "node_modules/typescript")); symlinkSync(nodeTypes, join(directory, "node_modules/@types/node"));
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name:"a3-route-fixture", private:true, type:"module" }));
  writeFileSync(join(directory, "snapback/schema.q"), journal + "\n" + schema);
  writeFileSync(join(directory, "snapback/server.ts"), source);
  const hosts = [];
  t.after(async () => { await Promise.all(hosts.map(host => host.stop())); rmSync(directory, {recursive:true, force:true}); });
  const command = (args, env = {}) => spawnSync(binary, args, {cwd:directory, encoding:"utf8", timeout:20_000, env:{...process.env, SNAPBACK_NODE:process.execPath, ...env}});
  const inspect = (sql, ...args) => {
    const db = new DatabaseSync(database, {readOnly:true});
    try { db.exec("PRAGMA busy_timeout=3000"); return db.prepare(sql).all(...args); } finally { db.close(); }
  };
  // Logical data/work/audit snapshots, excluding unrelated supervisor metadata.
  // A read transaction gives every compared table the same SQLite snapshot.
  const snapshot = () => {
    const db = new DatabaseSync(database, {readOnly:true});
    try {
      db.exec("PRAGMA busy_timeout=3000; BEGIN");
      const tables = ["r", "_commits", "_log", "_ops", "_requests", "_action_steps", "_principals", "_principal_generations"];
      return JSON.stringify(tables.map(name => [name, db.prepare(`SELECT * FROM ${name}`).all().map(row => JSON.stringify(row)).sort()])
        .concat([["delegated_sessions", db.prepare("SELECT * FROM _sessions WHERE kind = 'action'").all().map(row => JSON.stringify(row)).sort()]]));
    } finally { db.close(); }
  };
  async function start({ env = {}, bind = "127.0.0.1", port: requestedPort = 0 } = {}) {
    const readyBefore = lines(join(directory, "ready.jsonl")).length;
    const initialized = command(["test", "--residency"]);
    assert.equal(initialized.status, 0, safe(initialized.stderr));
    const minted = command(["token", "--service", "route-test-driver"]);
    assert.equal(minted.status, 0, safe(minted.stderr));
    const token = minted.stdout.trim();
    const args = ["dev", "--port", String(requestedPort), "--no-watch", ...(bind === "127.0.0.1" ? [] : ["--bind", bind, "--i-understand-cleartext"])];
    const child = spawn(binary, args, {cwd:directory, stdio:["ignore", "pipe", "pipe"], env:{...process.env, SNAPBACK_NODE:process.execPath, HOOK_KEY:KEY, ...env}});
    let log = "", port, exited = false, error;
    const done = new Promise(resolve => { child.once("exit", () => { exited = true; resolve(); }); child.once("error", value => { error = value; exited = true; resolve(); }); });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => { log += bytes; port ??= log.match(/http:\/\/(?:127\.0\.0\.1|0\.0\.0\.0):(\d+)/)?.[1]; });
    let stopping;
    const host = { child, log:() => safe(log), leakedSecret:() => log.includes(KEY),
      workerPids:() => [...log.matchAll(/snapback4 worker: .* \(pid (\d+)\)/g)].map(match => Number(match[1])),
      stop() { return stopping ??= (async () => {
        if (exited) return;
        child.kill("SIGTERM");
        let timer; await Promise.race([done, new Promise(resolve => { timer = setTimeout(resolve, 4000); })]); clearTimeout(timer);
        if (!exited) { child.kill("SIGKILL"); await done; }
      })(); },
    };
    hosts.push(host);
    await until(() => { if (error) throw error; if (exited) throw Error(host.log() || "host exited before listening"); return port; }, "route host listening", host.log);
    await until(() => lines(join(directory, "ready.jsonl")).length > readyBefore, "generated server entry ready", host.log);
    const url = `http://127.0.0.1:${port}`;
    const send = async (path, body = Buffer.alloc(0), { headers = {}, method = "POST", origin = url, signal, timeoutMs = 15_000 } = {}) => {
      const response = await fetch(origin + path, {method, headers, ...(method === "POST" ? {body} : {}), signal:signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)});
      const bytes = Buffer.from(await response.arrayBuffer()); let json;
      try { json = JSON.parse(bytes.toString("utf8")); } catch {}
      return {status:response.status, headers:response.headers, bytes, text:bytes.toString("utf8"), json};
    };
    const signed = (path, body, configuration = {}) => send(path, body, {...configuration, headers:{"content-type":"application/octet-stream", "x-signature":sign(body), ...configuration.headers}});
    const post = async (path, body = {}, credential = token) => {
      const response = await send(path, Buffer.from(JSON.stringify(body)), {headers:{"content-type":"application/json", authorization:`Bearer ${credential}`}});
      return {status:response.status, ...response.json};
    };
    return Object.assign(host, {url, port:Number(port), token, send, signed, post});
  }
  return {directory, command, inspect, snapshot, start, records:name => lines(join(directory, `${name}.jsonl`)), release:name => writeFileSync(join(directory, name), "released")};
}

export async function provider(t, directory) {
  const receipts = join(directory, "provider-receipts.jsonl"), requests = join(directory, "provider-requests.jsonl");
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://provider.test");
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const key = request.method === "GET" ? url.searchParams.get("key") : input.key;
      assert.equal(typeof key, "string");
      appendFileSync(requests, JSON.stringify({method:request.method, key}) + "\n", {flush:true});
      let receipt = lines(receipts).find(record => record.key === key);
      if (!receipt && request.method === "POST") {
        receipt = {key, value:`receipt-${lines(receipts).length + 1}`};
        appendFileSync(receipts, JSON.stringify(receipt) + "\n", {flush:true});
      }
      response.writeHead(receipt ? 200 : 404, {"content-type":"application/json"}); response.end(JSON.stringify(receipt ?? {missing:true}));
    } catch { response.writeHead(500); response.end("provider fixture failed"); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return {url:`http://127.0.0.1:${server.address().port}`, receipts:() => lines(receipts), requests:() => lines(requests)};
}
