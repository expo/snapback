import { hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";

const binary = fileURLToPath(new URL("../../../target/debug/snapback4", import.meta.url));
const backend = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
const url = "http://offline.invalid";
const storeName = `snapback4-${encodeURIComponent(`${url}:dev:alice`)}`;

function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-native-opening-"));
  const attempts = [];
  const device = processDevice({ dir, binary, ...options, spawn: (...args) => {
    const child = spawn(...args);
    const attempt = { child, closed: once(child, "close"), stdout: "", stderr: "" };
    child.stdout.on("data", chunk => { attempt.stdout += chunk; });
    child.stderr.on("data", chunk => { attempt.stderr += chunk; });
    attempts.push(attempt);
    return child;
  } });
  t.after(async () => {
    for (const { child } of attempts) if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.all(attempts.map(attempt => attempt.closed));
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, attempts, device };
}

function denial(output, code, family) {
  const lines = output.trim().split("\n");
  assert.equal(lines.length, 1, "one denial and no ready line");
  const reply = JSON.parse(lines[0]);
  assert.equal(reply.ok, undefined);
  assert.equal(reply.denied.code, code);
  assert.equal(reply.denied.family, family);
  assert.ok(reply.denied.message);
  return reply.denied;
}

async function holdExclusively(t, path) {
  writeFileSync(path, "");
  const holder = spawn("python3", ["-c", `import fcntl, sys
with open(sys.argv[1], "a+b") as store:
    fcntl.flock(store, fcntl.LOCK_EX)
    print("locked", flush=True)
    sys.stdin.read()
`, `${path}-owner`]);
  const exited = once(holder, "close");
  t.after(async () => { holder.stdin.end(); await exited; });
  const output = createInterface({ input: holder.stdout });
  let ready;
  try { [ready] = await once(output, "line", { signal: AbortSignal.timeout(hangBudget()) }); }
  finally { output.close(); }
  assert.equal(String(ready).trim(), "locked");
}

test("createLocalClient receives E_STORE_BUSY from a process device with an exclusively held ownership sidecar", async t => {
  const { dir, attempts, device } = fixture(t);
  const path = join(dir, `${storeName}.sqlite`);
  await holdExclusively(t, path);
  let rejected;
  await assert.rejects(createLocalClient({ url, persona: "alice", device,
    fetch: async () => Response.json(backend) }), error => { rejected = error; return /E_STORE_BUSY/.test(error.message); });
  assert.equal(attempts.length, 1, "busy ownership must not attempt backend installation");
  const reply = denial(attempts[0].stdout, "E_STORE_BUSY", "store");
  assert.equal(rejected.message, `${reply.code}: ${reply.message}`);
  assert.match(attempts[0].stderr, /E_STORE_BUSY/);
  assert.ok(reply.message.includes(path));
  assert.match(reply.message, /no work was admitted/);
  assert.equal(readFileSync(path).length, 0, "the locked database was not initialized");
});

test("a process device names a live server's published address in E_STORE_BUSY", async t => {
  const { dir, attempts, device } = fixture(t);
  const path = join(dir, `${storeName}.sqlite`);
  // The record `snapback4 dev` and `serve` publish beside the store once listening.
  writeFileSync(join(dir, "serve.lock"), "4400\nhttp://127.0.0.1:4400\n");
  await holdExclusively(t, path);
  await assert.rejects(createLocalClient({ url, persona: "alice", device,
    fetch: async () => Response.json(backend) }), /E_STORE_BUSY/);
  assert.equal(attempts.length, 1);
  const reply = denial(attempts[0].stdout, "E_STORE_BUSY", "store");
  assert.ok(reply.message.includes("owned by http://127.0.0.1:4400"), reply.message);
});

for (const kind of ["malformed JSON", "missing file", "unsupported capability"]) {
  test(`createLocalClient preserves a process device's bad backend code: ${kind}`, async t => {
    const code = kind === "unsupported capability" ? "E_SCHEMA_CAPABILITY" : "E_INPUT";
    const family = kind === "unsupported capability" ? "schema" : "input";
    const { attempts, device } = fixture(t, { writeFile: async (path, text) => {
      if (kind === "missing file") return;
      if (kind === "malformed JSON") { writeFileSync(path, "{"); return; }
      const opening = JSON.parse(text);
      opening.initial_backend.schema.tables.messages.constraints.push({ Capabilities: ["future-opening-test"] });
      writeFileSync(path, JSON.stringify(opening));
    } });
    let rejected;
    await assert.rejects(createLocalClient({ url, persona: "alice", device,
      fetch: async () => Response.json(backend) }), error => { rejected = error; return error.message.startsWith(`${code}:`); });
    assert.equal(attempts.length, 2, "an empty store first requests backend installation");
    denial(attempts[0].stdout, "E_AUTH", "auth");
    const reply = denial(attempts[1].stdout, code, family);
    assert.equal(rejected.message, `${reply.code}: ${reply.message}`);
    assert.match(attempts[1].stderr, /device: .*\.backend\.json:/);
    if (kind !== "missing file") assert.ok(attempts[1].stderr.includes(code));
  });
}

test("device usage and invalid store failures each emit a denial before exiting 2", t => {
  const { dir } = fixture(t);
  for (const [args, code, family, message] of [
    [[], "E_INPUT", "input", /usage: snapback4 device/],
    [[dir], "E_STORE", "store", /E_STORE/],
  ]) {
    const result = spawnSync(binary, ["device", ...args], { encoding: "utf8", timeout: hangBudget() });
    assert.equal(result.status, 2, result.stderr);
    assert.match(denial(result.stdout, code, family).message, message);
    assert.match(result.stderr, message);
  }
});
