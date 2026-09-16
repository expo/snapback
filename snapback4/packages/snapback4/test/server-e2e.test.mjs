// Real CLI, HTTP, supervised Node children and an on-disk provider double.
// This proves the provider protocol under crashes, not a third-party adapter.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const require = createRequire(import.meta.url);
const compiler = dirname(require.resolve("typescript/package.json"));
const nodeTypes = dirname(require.resolve("@types/node/package.json"));
const NODE = process.execPath;
const safe = text => String(text).replace(/token \(printed once\): \S+/g, "token (printed once): [REDACTED]");
const jsonFile = file => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; } };
const lines = file => { try { return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch { return []; } };

async function until(check, description, timeout = 10_000, diagnostics) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() >= deadline) throw Error(`timed out: ${description}${diagnostics ? "\n" + safe(diagnostics()) : ""}`);
    await delay(20);
  }
}

function project(t, source, entry) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-a2-e2e-"));
  mkdirSync(join(directory, "snapback"));
  mkdirSync(join(directory, "node_modules/@types"), { recursive: true });
  symlinkSync(join(root, "packages/snapback4"), join(directory, "node_modules/snapback4"));
  symlinkSync(compiler, join(directory, "node_modules/typescript"));
  symlinkSync(nodeTypes, join(directory, "node_modules/@types/node"));
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "a2-fixture", private: true, type: "module" }));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  if (entry !== undefined) writeFileSync(join(directory, "snapback/server.ts"), entry);
  const hosts = [];
  t.after(async () => {
    await Promise.all(hosts.map(host => host.stop()));
    rmSync(directory, { recursive: true, force: true });
  });
  const command = (args, env = {}) => spawnSync(binary, args, { cwd: directory, encoding: "utf8", timeout: 20_000, env: { ...process.env, SNAPBACK_NODE: NODE, ...env } });
  const checked = () => {
    const result = command(["check", "--json"]);
    assert.equal(result.status, 0, safe(result.stdout + result.stderr));
    assert.equal(JSON.parse(result.stdout).ok, true);
  };
  async function start({ serve = false, watch = false, env = {}, entryPath = join(directory, "snapback/server.ts") } = {}) {
    const release = join(directory, "release");
    if (serve) {
      checked();
      const deployed = command(["deploy", release]);
      assert.equal(deployed.status, 0, safe(deployed.stdout + deployed.stderr));
    }
    const args = serve ? ["serve", release, "--port", "0", "--worker", entryPath] : ["dev", "--port", "0", ...(watch ? [] : ["--no-watch"])];
    const child = spawn(binary, args, { cwd: directory, env: { ...process.env, SNAPBACK_NODE: NODE, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let log = "", url, exited = false, spawnError;
    const done = new Promise(resolve => { child.once("exit", () => { exited = true; resolve(); }); child.once("error", error => { spawnError = error; exited = true; resolve(); }); });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => { log += bytes; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
    let stopping;
    const host = {
      child, release, log: () => safe(log),
      stop() {
        return stopping ??= (async () => {
          if (exited) return;
          child.kill("SIGTERM");
          let timer;
          await Promise.race([done, new Promise(resolve => { timer = setTimeout(resolve, 4000); })]);
          clearTimeout(timer);
          if (!exited) { child.kill("SIGKILL"); await done; }
        })();
      },
      workerPids() { return [...log.matchAll(/snapback4 worker: .* \(pid (\d+)\)/g)].map(match => Number(match[1])); },
    };
    hosts.push(host);
    await until(() => {
      if (spawnError) throw spawnError;
      if (exited) throw Error(safe(log) || "server exited before listening");
      return url;
    }, "server listening");
    const minted = command(["token", ...(serve ? ["--release", release] : []), "--service", "test-driver"]);
    assert.equal(minted.status, 0, safe(minted.stderr));
    const token = minted.stdout.trim();
    const post = async (path, body = {}, credential, lease) => {
      const response = await fetch(url + path, { method: "POST", signal: AbortSignal.timeout(10_000), headers: {
        "content-type": "application/json", ...(credential ? { authorization: `Bearer ${credential}` } : { "x-snapback-persona": "alice" }),
        ...(lease ? { "x-snapback-action-lease": lease } : {}),
      }, body: JSON.stringify(body) });
      return { status: response.status, ...await response.json() };
    };
    const call = (name, id, args = {}, credential) => post(`/a/${name}?wait=0`, { id, args }, credential);
    const collect = (name, id, args = {}, credential) => until(async () => {
      const value = await call(name, id, args, credential);
      if (value.denied) throw Error(JSON.stringify(value));
      return value.state === "pending" ? undefined : value;
    }, `action ${name}/${id} settling`, 15_000, host.log);
    return Object.assign(host, { url, token, post, call, collect, command });
  }
  return { directory, command, checked, start, writeEntry(text) { writeFileSync(join(directory, "snapback/server.ts"), text); } };
}

const shutdown = `
const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());
`;
const imports = `import { server } from "./generated/server.ts";
import { api } from "./generated/api.ts";
import { appendFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
${shutdown}`;
const options = `{ signal: stop.signal, lease: 1, wait: 1, batch: 1, statusIntervalMs: 50 }`;

test("check validates generated handler returns, arguments and declared secrets without executing the entry", { timeout: 30_000 }, t => {
  const source = "action echo(message: text <=80) returns { value: text <=80 } secrets [MAIL_KEY]\n";
  const p = project(t, source);
  const entry = body => `import { server } from "./generated/server.ts";\nthrow Error("typechecking must not execute the entry");\nexport default server({actions:{echo:${body}}});\n`;
  for (const [name, handler] of [
    ["return", "async ({message}, ctx) => ({value: 42})"],
    ["arguments", "async ({missing}, ctx) => ({value: missing})"],
    ["secret", "async ({message}, ctx) => ({value: ctx.secrets.UNDECLARED})"],
  ]) {
    p.writeEntry(entry(handler));
    const checked = p.command(["check", "--json"]);
    assert.equal(checked.status, 1, `${name}: ${safe(checked.stdout + checked.stderr)}`);
    const result = JSON.parse(checked.stdout);
    assert.equal(result.problems[0].code, "E_SERVER_TYPECHECK", JSON.stringify(result));
    assert.doesNotMatch(checked.stderr, /typechecking must not execute the entry\n\s+at/);
  }
  writeFileSync(join(p.directory, "tsconfig.json"), JSON.stringify({ compilerOptions: { noCheck: true, strict: false, strictNullChecks: false, noImplicitAny: false } }));
  p.writeEntry(entry("async ({message}, ctx) => ({value: null})"));
  const bypass = p.command(["check", "--json"]);
  assert.equal(bypass.status, 1, safe(bypass.stdout + bypass.stderr));
  assert.equal(JSON.parse(bypass.stdout).problems[0].code, "E_SERVER_TYPECHECK");
  p.writeEntry(entry("async ({message}, ctx) => ({value: message + ctx.secrets.MAIL_KEY})"));
  p.checked();
  assert.equal(existsSync(join(p.directory, "snapback/generated/server.ts")), true);
  assert.equal(existsSync(join(p.directory, "snapback/generated/api.ts")), true);
});

const notes = `use personas alice, bob
use identity
table notes:
  owner: principal
  body: text <=200
  by byOwner: owner, id
  read <- .owner = viewer
  insert <- .owner = viewer
mutation save(body: text <=200):
  return insert notes { owner: viewer, body }
query mine():
  return notes[viewer] first 20 by byOwner
`;

test("dev watches checked imports and configs outside snapback and keeps the last good worker through failed checks", { timeout: 70_000 }, async t => {
  const p = project(t, "use personas alice\naction inspect() returns { value: text <=80 }\n", `${imports}
import { value } from "../src/provider.ts";
const worker = server({actions:{async inspect() { return {value:value()}; }}}, ${options});
export default worker; await worker.done;
`);
  const provider = join(p.directory, "src/provider.ts");
  const baseConfig = join(p.directory, "config/server-base.json");
  mkdirSync(dirname(provider)); mkdirSync(dirname(baseConfig));
  writeFileSync(provider, 'export function value(): string { return "first"; }\n');
  writeFileSync(baseConfig, "{}\n");
  writeFileSync(join(p.directory, "tsconfig.json"), '{"extends":"./config/server-base.json"}\n');
  p.checked();
  const f = await p.start({ watch: true });
  let invocation = 0;
  const read = () => f.collect("inspect", `watch-${++invocation}`);
  const expectValue = async expected => {
    const result = await read();
    assert.equal(result.state, "done", JSON.stringify(result) + "\n" + f.log());
    assert.equal(result.result.value, expected, f.log());
  };
  await expectValue("first");
  const initialWorkers = f.workerPids().length;
  writeFileSync(join(p.directory, "src/unrelated-ui.ts"), "this is deliberately not TypeScript!\n");
  await delay(900);
  assert.equal(f.workerPids().length, initialWorkers, "unimported UI must not restart the server\n" + f.log());
  assert.doesNotMatch(f.log(), /E_SERVER_TYPECHECK/);

  async function accepted(edit, expected) {
    const workers = f.workerPids().length;
    edit();
    await until(() => f.workerPids().length > workers, `checked worker restarts for ${expected}`, 12_000, f.log);
    // A changed graph can require another observation pass. Fresh invocation
    // ids avoid mistaking an old durable action result for the new handler.
    await until(async () => {
      const result = await read();
      return result.state === "done" && result.result.value === expected;
    }, `new handler returns ${expected}`, 12_000, f.log);
  }
  async function refused(edit, expected, diagnostic) {
    const workers = f.workerPids().length, offset = f.log().length;
    edit();
    await until(() => {
      const log = f.log().slice(offset);
      return log.includes("E_SERVER_TYPECHECK") && log.includes("serving the previous generation") && diagnostic.test(log);
    }, "invalid dependency is diagnosed before restart", 12_000, f.log);
    assert.equal(f.workerPids().length, workers, "invalid source must retain the previous worker\n" + f.log());
    await expectValue(expected);
  }
  await accepted(() => writeFileSync(provider, 'export function value(): string { return "second"; }\n'), "second");
  await refused(() => writeFileSync(provider, "export function value(): string { return 42; }\n"), "second", /provider\.ts/);
  await refused(() => unlinkSync(provider), "second", /Cannot find module/);
  await accepted(() => writeFileSync(provider, 'export function value(): string { return "restored"; }\n'), "restored");
  await refused(() => writeFileSync(provider, 'import { receipt } from "./missing/receipt.ts";\nexport function value(): string { return receipt; }\n'), "restored", /missing\/receipt/);
  await accepted(() => {
    mkdirSync(join(p.directory, "src/missing"));
    writeFileSync(join(p.directory, "src/missing/receipt.ts"), 'export const receipt = "resolved";\n');
  }, "resolved");
  await refused(() => writeFileSync(baseConfig, '{"compilerOptions":{"types":["a2-missing-types"]}}\n'), "resolved", /a2-missing-types/);
  await accepted(() => writeFileSync(baseConfig, "{}\n"), "resolved");
});

test("dev discovers generated server handlers, preserves read/write receipts and scopes and redacts secrets", { timeout: 25_000 }, async t => {
  const secret = "a2-test-secret-crosses-the-pipe-boundary";
  const p = project(t, `${notes}
action inspect(body: text <=200) returns { detail: json <=12000 } secrets [MAIL_KEY]
action other() returns {} secrets [OTHER_KEY]
`, `${imports}
async function splitLog(stream: NodeJS.WriteStream, prefix: string) {
  const value = process.env.MAIL_KEY!;
  stream.write(prefix + value.slice(0, 11)); await delay(20);
  stream.write(value.slice(11, 24)); await delay(20);
  stream.write(value.slice(24) + ":end\\n");
}
await splitLog(process.stdout, "stdout-secret:");
await splitLog(process.stderr, "stderr-secret:");
const worker = server({actions:{
  async inspect({body}, ctx) {
    const id = ctx.writeIdFor("save");
    const first = await ctx.mutate(api.save, {body}, {id});
    const replay = await ctx.mutate(api.save, {body}, {id});
    const read = await ctx.query(api.mine, {});
    return {detail:{principal:ctx.principal, first, replay, read, secrets:Object.keys(ctx.secrets), frozen:Object.isFrozen(ctx.secrets), own:Object.getPrototypeOf(ctx.secrets) === null, unrelated:process.env.A2_PARENT_ONLY ?? null}};
  },
  async other() { return {}; },
}}, ${options});
export default worker;
await worker.done;
`);
  const f = await p.start({ env: { MAIL_KEY: secret, OTHER_KEY: "other-declared-secret", A2_PARENT_ONLY: "must-not-reach-child" } });
  const result = await f.collect("inspect", "inspect-1", { body: "one private row" });
  assert.equal(result.state, "done", JSON.stringify(result));
  const detail = result.result.detail;
  assert.equal(detail.principal, "dev:alice");
  assert.deepEqual(detail.secrets, ["MAIL_KEY"]);
  assert.equal(detail.frozen, true); assert.equal(detail.own, true); assert.equal(detail.unrelated, null);
  assert.equal(detail.first.state, "sent"); assert.equal(detail.first.result.body, "one private row");
  assert.equal(detail.replay.state, "sent"); assert.equal(detail.replay.replayed, true); assert.equal(Object.hasOwn(detail.replay, "result"), false);
  assert.equal(detail.read.fresh, true); assert.equal(typeof detail.read.complete, "boolean"); assert.equal(Object.hasOwn(detail.read, "cut"), true);
  assert.equal(detail.read.data.length, 1); assert.equal(detail.read.data[0].owner, "dev:alice");
  assert.deepEqual((await f.post("/q/mine", { args: {} }, f.token)).data, []);
  await until(() => f.log().includes("stdout-secret:[REDACTED]:end") && f.log().includes("stderr-secret:[REDACTED]:end"), "both split log streams redacted");
  assert.equal(f.log().includes(secret), false); assert.equal(f.log().includes("must-not-reach-child"), false);
  assert.doesNotMatch(f.log(), /token \(printed once\)/);
});

test("scheduled generated action runs under its declared service seat", { timeout: 20_000 }, async t => {
  const p = project(t, `${notes}
action tick(periodStart: time, periodEnd: time) returns {} <- viewer = 'service:clock'
schedule pulse every 1m as service:clock: tick
`, `${imports}
const worker = server({actions:{async tick(args, ctx) {
  const written = await ctx.mutate(api.save, {body:"scheduled"}, {id:ctx.writeIdFor("scheduled")});
  const read = await ctx.query(api.mine, {});
  appendFileSync(new URL("../scheduled.jsonl", import.meta.url), JSON.stringify({principal:ctx.principal, args, written, read}) + "\\n", {flush:true});
  return {};
}}}, ${options});
export default worker; await worker.done;
`);
  const f = await p.start();
  assert.equal((await f.post("/dev/clock/advance", { duration: "61s" })).advancedMs, 61_000);
  const records = await until(() => lines(join(p.directory, "scheduled.jsonl")).length ? lines(join(p.directory, "scheduled.jsonl")) : undefined, "scheduled action executes");
  assert.equal(records[0].principal, "service:clock");
  assert.equal(records[0].args.periodEnd - records[0].args.periodStart, 60_000);
  assert.equal(records[0].written.state, "sent"); assert.equal(records[0].written.result.owner, "service:clock");
  assert.equal(records[0].read.data.length, 1); assert.equal(records[0].read.data[0].body, "scheduled");
});

test("raw HTTP settlement validates declared results terminally and never reclaims them", { timeout: 15_000 }, async t => {
  const p = project(t, "use personas alice\naction shape() returns { ok: bool, text: text <=5 } retry 3 backoff 1s\n");
  const f = await p.start();
  for (const [index, result] of [{ ok: "wrong", text: "ok" }, { ok: true, text: "too long" }, { ok: true, text: "fine", extra: true }].entries()) {
    const id = `invalid-result-${index}`;
    assert.equal((await f.call("shape", id)).state, "pending");
    const claims = await f.post("/actions/claim", { action: "shape", wait: 0, lease: 5, limit: 1 }, f.token);
    assert.equal(claims.requests.length, 1);
    const claim = claims.requests[0];
    assert.equal(typeof claim.contract, "string"); assert.equal(claim.deadline, null);
    const step = `/actions/${id}/steps/explicit-null`;
    assert.equal((await f.post(step + "/begin", {}, f.token, claim.session.token)).status, 400);
    assert.equal((await f.post(step + "/begin", { input: null }, f.token, claim.session.token)).step.state, "run");
    assert.equal((await f.post(step + "/done", {}, f.token, claim.session.token)).status, 400);
    assert.equal((await f.post(step + "/done", { result: null }, f.token, claim.session.token)).ok, true);
    const settled = await f.post(`/actions/${id}/done`, { result }, f.token, claim.session.token);
    assert.equal(settled.ok, true, JSON.stringify(settled));
    assert.equal(settled.request.why.code, "E_ACTION_RESULT");
    assert.equal((await f.collect("shape", id)).why.code, "E_ACTION_RESULT");
    assert.deepEqual((await f.post("/actions/claim", { action: "shape", wait: 0 }, f.token)).requests, []);
  }
});

test("cancellation and admitting-session revocation abort an in-flight context before later writes", { timeout: 25_000 }, async t => {
  const p = project(t, `${notes}
action wait() returns {} cancellation allow
`, `${imports}
const worker = server({actions:{async wait(_, ctx) {
  writeFileSync(new URL("../started-" + ctx.invocation.id + ".json", import.meta.url), JSON.stringify({id:ctx.invocation.id, pid:process.pid}));
  if (!ctx.invocation.signal.aborted) await new Promise<void>(resolve => ctx.invocation.signal.addEventListener("abort", () => resolve(), {once:true}));
  const attempted = await ctx.mutate(api.save, {body:"must not land"});
  writeFileSync(new URL("../ended-" + ctx.invocation.id + ".json", import.meta.url), JSON.stringify({cancelled:ctx.invocation.cancelled, attempted}));
  return {};
}}}, {...${options}, lease:10});
export default worker; await worker.done;
`);
  const f = await p.start();
  assert.equal((await f.call("wait", "cancelled")).state, "pending");
  await until(() => jsonFile(join(p.directory, "started-cancelled.json")), "cancellable handler enters", 10_000, f.log);
  assert.equal((await f.post("/actions/cancelled/cancel")).request.why.code, "E_ACTION_CANCELLED");
  const cancelled = await until(() => jsonFile(join(p.directory, "ended-cancelled.json")), "cancellation abort delivered", 10_000, f.log);
  assert.equal(cancelled.cancelled, true); assert.equal(cancelled.attempted.why.code, "E_ACTION_CANCELLED");
  assert.equal((await f.post("/q/mine", { args: {} })).data.length, 0);
  const minted = await f.post("/auth/session", { principal: "member:revoked" }, f.token);
  const session = minted.session;
  assert.ok(session?.token, JSON.stringify(minted));
  assert.equal((await f.call("wait", "revoked", {}, session.token)).state, "pending");
  await until(() => jsonFile(join(p.directory, "started-revoked.json")), "revocable handler enters", 10_000, f.log);
  assert.equal((await f.post("/auth/logout", {}, session.token)).status, 200);
  const revoked = await until(() => jsonFile(join(p.directory, "ended-revoked.json")), "authority revocation abort delivered", 10_000, f.log);
  assert.equal(revoked.cancelled, false); assert.equal(revoked.attempted.why.code, "E_ACTION_AUTHORITY");
  const replacement = (await f.post("/auth/session", { principal: "member:revoked" }, f.token)).session;
  assert.equal((await f.post("/q/mine", { args: {} }, replacement.token)).data.length, 0);
});

async function provider(t, directory) {
  const journal = join(directory, "provider-receipts.jsonl"), requests = join(directory, "provider-requests.jsonl");
  const host = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://provider.test");
      const body = []; for await (const chunk of request) body.push(chunk);
      const payload = body.length ? JSON.parse(Buffer.concat(body).toString()) : {};
      const key = request.method === "GET" ? url.searchParams.get("key") : payload.key;
      assert.equal(typeof key, "string");
      appendFileSync(requests, JSON.stringify({ method: request.method, key }) + "\n", { flush: true });
      let receipt = lines(journal).find(value => value.key === key);
      if (!receipt && request.method === "POST") {
        receipt = { key, value: `accepted-${lines(journal).length + 1}` };
        appendFileSync(journal, JSON.stringify(receipt) + "\n", { flush: true });
      }
      response.writeHead(receipt ? 200 : 404, { "content-type": "application/json" });
      response.end(JSON.stringify(receipt ? { value: receipt.value } : { missing: true }));
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  await new Promise((resolve, reject) => { host.once("error", reject); host.listen(0, "127.0.0.1", resolve); });
  t.after(async () => { host.closeAllConnections(); await new Promise(resolve => host.close(resolve)); });
  return { url: `http://127.0.0.1:${host.address().port}`, receipts: () => lines(journal), requests: () => lines(requests) };
}

test("actual worker crashes replay completed steps, reconcile uncertainty, park unknown outcomes and reject changed input", { timeout: 45_000 }, async t => {
  const p = project(t, `${notes}
action work(mode: enum('done', 'reconcile', 'park', 'changed')) returns { value: text <=80, attempt: int, writeId: text <=26 } secrets [TEST_PROVIDER_URL] retry 4 backoff 1s
`, `${imports}
appendFileSync(new URL("../worker-starts.jsonl", import.meta.url), JSON.stringify({pid:process.pid}) + "\\n", {flush:true});
const worker = server({actions:{async work({mode}, ctx) {
  const writeId = ctx.writeIdFor("save");
  const write = await ctx.mutate(api.save, {body:mode}, {id:writeId});
  appendFileSync(new URL("../attempts.jsonl", import.meta.url), JSON.stringify({mode, id:ctx.invocation.id, attempt:ctx.invocation.attempt, writeId, write, pid:process.pid}) + "\\n", {flush:true});
  async function contact(key:string, lookup=false):Promise<{value:string}> {
    const response = await fetch(ctx.secrets.TEST_PROVIDER_URL + (lookup ? "/lookup?key=" + encodeURIComponent(key) : "/accept"), lookup ? {} : {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({key})});
    if (!response.ok) throw Error("provider did not establish an outcome");
    return response.json() as Promise<{value:string}>;
  }
  async function crash(stage:string):Promise<never> {
    appendFileSync(new URL("../crashes.jsonl", import.meta.url), JSON.stringify({stage, mode, id:ctx.invocation.id, pid:process.pid}) + "\\n", {flush:true});
    process.kill(process.pid, "SIGKILL");
    return new Promise<never>(() => {});
  }
  const input = {mode, revision:mode === "changed" && ctx.invocation.attempt > 1 ? 2 : 1};
  const result = await ctx.step("provider/__proto__", input, async key => {
    const result = await contact(key);
    if (ctx.invocation.attempt === 1 && mode !== "done") return crash("accepted-before-recording");
    return result;
  }, mode === "reconcile" ? {reconcile:key => contact(key,true)} : undefined);
  if (ctx.invocation.attempt === 1 && mode === "done") return crash("recorded-before-action-settlement");
  return {value:result.value, attempt:ctx.invocation.attempt, writeId};
}}}, ${options});
export default worker; await worker.done;
`);
  const remote = await provider(t, p.directory);
  const f = await p.start({ env: { TEST_PROVIDER_URL: remote.url } });
  for (const mode of ["done", "reconcile", "park", "changed"]) {
    const id = `crash-${mode}`;
    const result = await f.collect("work", id, { mode });
    if (mode === "done" || mode === "reconcile") {
      assert.equal(result.state, "done", JSON.stringify(result));
      assert.equal(result.result.attempt, 2);
      assert.match(result.result.writeId, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    } else {
      assert.equal(result.state, "failed", JSON.stringify(result));
      assert.equal(result.why.code, mode === "park" ? "E_STEP_PARKED" : "E_STEP_INPUT");
    }
    const attempts = lines(join(p.directory, "attempts.jsonl")).filter(record => record.id === id);
    assert.deepEqual(attempts.map(record => record.attempt), [1, 2]);
    assert.equal(attempts[0].writeId, attempts[1].writeId);
    assert.equal(attempts[0].write.state, "sent");
    assert.equal(attempts[1].write.replayed, true);
    assert.equal(Object.hasOwn(attempts[1].write, "result"), false, "HTTP replay after process death withholds historical mutation results");
    assert.notEqual(attempts[0].pid, attempts[1].pid, "recovery ran in a new actual worker process");
    const crash = lines(join(p.directory, "crashes.jsonl")).find(record => record.id === id);
    assert.equal(crash.pid, attempts[0].pid);
    assert.ok(f.workerPids().includes(crash.pid), "the crashed PID was this fixture's supervised child");
    const key = remote.receipts()[["done", "reconcile", "park", "changed"].indexOf(mode)].key;
    const calls = remote.requests().filter(request => request.key === key);
    assert.deepEqual(calls.map(call => call.method), mode === "reconcile" ? ["POST", "GET"] : ["POST"]);
    assert.equal((await f.call("work", id, { mode })).state, result.state);
  }
  assert.equal(remote.receipts().length, 4);
  assert.equal(lines(join(p.directory, "crashes.jsonl")).length, 4);
  assert.equal((await f.post("/q/mine", { args: {} })).data.length, 4, "one database write per invocation across worker crashes");
});

test("serve uses the same generated contract and declared environment across a supervised restart", { timeout: 25_000 }, async t => {
  const secret = "serve-a2-secret-value";
  const p = project(t, "use identity\naction echo(message: text <=80) returns { value: text <=80, principal: principal } secrets [MAIL_KEY]\n", `${imports}
appendFileSync(new URL("../serve-starts.jsonl", import.meta.url), JSON.stringify({pid:process.pid, declared:process.env.MAIL_KEY === ${JSON.stringify(secret)}, unrelated:process.env.A2_PARENT_ONLY ?? null, keys:Object.keys(process.env).sort()}) + "\\n", {flush:true});
const worker = server({actions:{async echo({message},ctx) { return {value:message,principal:ctx.principal}; }}}, ${options});
export default worker; await worker.done;
`);
  const f = await p.start({ serve: true, env: { MAIL_KEY: secret, A2_PARENT_ONLY: "must-not-reach-serve-child" } });
  const starts = () => lines(join(p.directory, "serve-starts.jsonl"));
  await until(() => starts().length === 1, "serve worker starts");
  assert.deepEqual((await f.collect("echo", "serve-first", { message: "first" }, f.token)).result, { value: "first", principal: "service:test-driver" });
  const owned = starts()[0].pid;
  assert.ok(f.workerPids().includes(owned));
  process.kill(owned, "SIGKILL");
  await until(() => starts().length === 2, "serve restarts its killed child");
  assert.notEqual(starts()[1].pid, owned);
  assert.deepEqual((await f.collect("echo", "serve-second", { message: "second" }, f.token)).result, { value: "second", principal: "service:test-driver" });
  const allowed = new Set(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "NODE_OPTIONS", "SNAPBACK_URL", "SNAPBACK_SERVICE_TOKEN", "MAIL_KEY"]);
  if (process.platform === "darwin") allowed.add("__CF_USER_TEXT_ENCODING");
  for (const start of starts()) { assert.equal(start.declared, true); assert.equal(start.unrelated, null); assert.ok(start.keys.every(key => allowed.has(key)), JSON.stringify(start.keys)); }
  assert.equal(f.log().includes(secret), false); assert.doesNotMatch(f.log(), /token \(printed once\)/);
  await f.stop();
  assert.throws(() => process.kill(starts()[1].pid, 0), { code: "ESRCH" });
});
