import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";

const workspace = fileURLToPath(new URL("../../../", import.meta.url));
const binary = resolve(workspace, "target/debug/snapback2");
const packageRoot = resolve(workspace, "packages/snapback2");
const env = { ...process.env,
  SNAPBACK2_COMPILER: join(packageRoot, "dist/compiler.mjs"),
  SNAPBACK2_TEMPLATES: join(packageRoot, "templates"),
  SNAPBACK2_TEST_RUNNER: join(packageRoot, "dist/test-runner.mjs"),
};
let root = "";
const cli = (args: string[], timeout = 30_000) => {
  const result = spawnSync(binary, args, { env, cwd: root, encoding: "utf8", timeout });
  assert.equal(result.error, undefined);
  return result;
};

// One scaffolded chat app serves both tests so each keeps its own ten-second budget.
before(async () => {
  root = await mkdtemp("/tmp/snapback2-effects-visibility-");
  const initialized = cli(["init", root, "--template", "chat", "--client", "react"]);
  assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
  await writeFile(join(root, "snapback/tests/effects-visibility.test.ts"), `
import { journey } from "snapback2/test";
import { api } from "snapback2/client";
journey("effect engine absence", async ({ as, effects }) => {
  const sent = await as("alice").mutation(api.messages.send, { conversationId: "conversation-1", body: "effect visibility" });
  if (sent.state !== "committed") throw new Error(JSON.stringify(sent));
  const page = await effects.rows({ state: "queued", limit: 1 });
  if (page.rows.length !== 1 || page.rows[0].effect !== "delivery.notify") throw new Error(JSON.stringify(page));
  const result = await effects.settle({ upTo: sent.seq, budgetMs: 100 });
  if (result.rows[0].seq !== sent.seq || result.rows[0].effect !== "delivery.notify") throw new Error(JSON.stringify(result));
  // The RFC's journey shape: an unsettled outbox is thrown, and the supervisor still records blocked.
  if (!result.settled) throw new Error("unsettled: " + JSON.stringify(result.remaining));
});
`);
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

// Booting an owner compiles the project first; under a loaded package phase that alone can pass 5 s.
test("a scaffolded chat exposes queued effects, transition logs, and trace history without an engine", { timeout: 30_000 }, async () => {
  const owner = spawn(binary, ["dev", "--foreground", "--port", "0", "--json"], { env, cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  try {
    let stdout = "", stderr = "";
    owner.stdout!.on("data", chunk => { stdout += chunk; });
    owner.stderr!.on("data", chunk => { stderr += chunk; });
    let info: any;
    for (let i = 0; i < 2000; i++) {
      if (stdout.includes("\n")) { info = JSON.parse(await readFile(join(root, ".snapback/owner.json"), "utf8")); break; }
      if (owner.exitCode !== null) throw new Error(stdout + stderr);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(info, stderr);
    const startup = JSON.parse(stdout.trim());
    assert.equal(startup.effects.engine, "none");
    assert.equal(startup.effects.queued, 0);
    const control = async (path: string, body?: any) => {
      const response = await fetch(info.url + path, { method: body ? "POST" : "GET",
        headers: { "x-snapback-control": info.secret, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      assert.equal(response.status, 200, JSON.stringify(value));
      return value;
    };
    const sent = await control("/control/execute", { op: "messages.send", as: "alice", args: { conversationId: "conversation-1", body: "visible" } });
    assert.equal(sent.state, "committed");
    const settled = await control("/control/effects/settle", { upTo: sent.seq, budgetMs: 100 });
    assert.equal(settled.settled, false);
    assert.deepEqual(settled.remaining, [{ id: settled.rows[0].id, reason: "engine:none" }]);
    const trace = await control(`/control/trace?seq=${sent.seq}`);
    assert.deepEqual(trace.outbox.history.map((line: any) => line.outbox.to), ["queued"]);
    assert.equal(trace.outbox.history[0].outbox.by, "messages.send");
    const traced = cli(["trace", String(sent.seq), "--json"]);
    assert.equal(traced.status, 0, traced.stdout + traced.stderr);
    assert.deepEqual(JSON.parse(traced.stdout).outboxHistory, trace.outbox.history);
    for (let i = 0; i < 3; i++) await control("/control/effects/settle", {});
    const logs = JSON.parse(cli(["logs", "--effects", "--json"]).stdout);
    assert.equal(logs.commits.length, 0);
    assert.ok(logs.lines.every((line: any) => line.outbox));
    assert.deepEqual(logs.lines.filter((line: any) => line.outbox.engine === "none").map((line: any) => line.outbox.queued), [0, 1]);
    assert.equal(logs.lines.filter((line: any) => line.outbox.to === "queued").length, 1);
    await control("/control/stop", {});
    await new Promise<void>(resolve => owner.exitCode !== null ? resolve() : owner.once("exit", () => resolve()));
  } finally {
    if (owner.exitCode === null) {
      owner.kill("SIGKILL");
      await new Promise(resolve => owner.once("exit", resolve));
    }
  }
});

// A full `snapback2 test` compiles and boots its own owner: its budget is its own, not the package phase's.
test("a journey that throws on an engine:none settle is recorded blocked: effects:no-engine, not fail", { timeout: 60_000 }, async () => {
  const receiptRun = cli(["test", "--journey", "effect engine absence", "--json"], 60_000);
  const receipt = JSON.parse(receiptRun.stdout);
  const journey = receipt.checks.find((check: any) => check.name === "effect engine absence");
  assert.equal(journey?.verdict, "blocked", receiptRun.stdout + receiptRun.stderr);
  assert.equal(journey?.detail.reason, "effects:no-engine");
  assert.equal(journey?.detail.journey.file.endsWith("effects-visibility.mjs"), true, JSON.stringify(journey));
  assert.match(journey?.detail.journey.error, /^unsettled: \[\{"id":"[^"]+","reason":"engine:none"\}\]$/, JSON.stringify(journey));
  assert.equal(receipt.checks.some((check: any) => check.verdict === "fail"), false, receiptRun.stdout);
});
