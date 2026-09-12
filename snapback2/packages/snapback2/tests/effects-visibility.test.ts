import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { receiptVerdict } from "../../../scripts/consumer-smoke.mjs";

const workspace = fileURLToPath(new URL("../../../", import.meta.url));
const binary = resolve(workspace, "target/debug/snapback2");
const packageRoot = resolve(workspace, "packages/snapback2");
const env = { ...process.env,
  SNAPBACK2_NODE: process.execPath, SNAPBACK2_COMPILER: join(packageRoot, "dist/compiler.mjs"),
  SNAPBACK2_TEMPLATES: join(packageRoot, "templates"),
  SNAPBACK2_TEST_RUNNER: join(packageRoot, "dist/test-runner.mjs"),
};
let root = "";
const cli = (args: string[], timeout = 30_000) => {
  const result = spawnSync(binary, args, { env, cwd: root, encoding: "utf8", timeout });
  assert.equal(result.error, undefined);
  return result;
};

test("receiptVerdict uses coverage verdicts with notWitnessed evidence", () => {
  const rows = [
    { state: "sent", lastError: null, provider: { requests: 0, refused: {} } },
    { state: "sent", lastError: null, provider: { requests: 1, refused: { E_EFFECT_UNBOUND: 1 } } },
    { state: "failed", lastError: "E_EFFECT_UNBOUND", provider: { requests: 0, refused: { E_EFFECT_UNBOUND: 1 } } },
  ];
  for (const witnessed of [false, true]) {
    const verdict = witnessed ? "pass" : "blocked";
    const receipt = { verdict, checks: [{ name: "effects", kind: "derived", verdict, detail: {
      reason: witnessed ? undefined : "effects:no-witness",
      witnesses: witnessed ? { "delivery.notify": { state: "sent", provider: { requests: 1, refused: {} } } } : {},
      notWitnessed: { "delivery.notify": { rows, dropped: 0 } },
    } }] };
    for (const allowNoEngine of [false, true]) {
      assert.deepEqual(receiptVerdict({ status: witnessed ? 0 : 1, stdout: JSON.stringify(receipt) }, allowNoEngine),
        { accepted: witnessed, verdict });
    }
  }
});

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

// LLP 1021 §3: provider bindings are journeys-only. A dev owner refuses the epoch and bind routes with the rewrite.
test("a dev owner refuses provider bindings, and E_EFFECT_UNBOUND is a registered effect-family card", { timeout: 30_000 }, async () => {
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
    const post = async (path: string, body: any) => {
      const response = await fetch(info.url + path, { method: "POST", headers: { "x-snapback-control": info.secret, "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    for (const [path, body] of [
      ["/control/effects/epoch", { epoch: 1 }],
      ["/control/effects/bind", { origin: "https://api.example.com" }],
    ] as const) {
      const refused = await post(path, body);
      assert.equal(refused.status, 400, JSON.stringify(refused));
      assert.equal(refused.body.code, "E_INPUT");
      assert.equal(refused.body.family, "input");
      assert.equal(refused.body.site, path);
      assert.equal(typeof refused.body.rewrite, "string");
      assert.equal(typeof refused.body.guide, "string");
    }
    for (const [path, body] of [
      ["/control/effects/epoch", { epoch: "j1" }],
      ["/control/effects/bind", { origin: "https://api.example.com", to: "http://127.0.0.1:1", epoch: "j1" }],
    ] as const) {
      const refused = await post(path, body);
      assert.equal(refused.status, 400, JSON.stringify(refused));
      assert.equal(refused.body.code, "E_INPUT");
      assert.equal(refused.body.site, path);
      assert.match(refused.body.message, /journey epoch; this owner serves dev/);
      assert.match(refused.body.rewrite, /effects\.provider\(origin, handler\) in a journey and run snapback2 test/);
    }
    await post("/control/stop", {});
    await new Promise<void>(resolve => owner.exitCode !== null ? resolve() : owner.once("exit", () => resolve()));
  } finally {
    if (owner.exitCode === null) {
      owner.kill("SIGKILL");
      await new Promise(resolve => owner.once("exit", resolve));
    }
  }
  const card = cli(["guide", "E_EFFECT_UNBOUND", "--json"]);
  assert.equal(card.status, 0, card.stdout + card.stderr);
  const content = String(JSON.parse(card.stdout).content);
  assert.match(content, /# E_EFFECT_UNBOUND/);
  assert.match(content, /Family: `effect`/);
  const ioCard = cli(["guide", "E_OWNER_TEST_IO", "--json"]);
  assert.equal(ioCard.status, 0, ioCard.stdout + ioCard.stderr);
  const ioContent = String(JSON.parse(ioCard.stdout).content);
  assert.match(ioContent, /Family: `owner`/);
  assert.match(ioContent, /snapback2 test/);
  assert.match(content, /effects\.provider\("https:\/\/api\.example\.com", async \(\) => Response\.json/);
});

// LLP 1021 §4: without an engine the effects check blocks with `detail.build`, the template's provider
// journey is `blocked: effects:no-engine` (its binding was accepted by the test owner), and nothing fails.
test("the engine-less receipt blocks exactly on engine absence: the effects check names the build and the provider journey is blocked, not failed", { timeout: 120_000 }, async () => {
  const receiptRun = cli(["test", "--json"], 120_000);
  const receipt = JSON.parse(receiptRun.stdout);
  assert.equal(receipt.verdict, "blocked", receiptRun.stdout + receiptRun.stderr);
  const effects = receipt.checks.find((check: any) => check.name === "effects");
  assert.equal(effects?.verdict, "blocked", JSON.stringify(effects));
  assert.equal(effects?.detail.reason, "no engine in this build");
  assert.equal(effects?.detail.build, "scripts/hermes build -p snapback2");
  assert.deepEqual(effects?.detail.declarations, ["delivery.notify"]);
  const provider = receipt.checks.find((check: any) => check.name === "a sent message notifies the recipient");
  assert.equal(provider?.verdict, "blocked", JSON.stringify(provider));
  assert.equal(provider?.detail.reason, "effects:no-engine");
  assert.match(provider?.detail.journey.error, /^unsettled: \[\{"id":"[^"]+","reason":"engine:none"\}/, JSON.stringify(provider));
  // Witnesses come from the journeys: the check is recorded after them.
  const names = receipt.checks.map((check: any) => check.name);
  assert.ok(names.indexOf("effects") > names.indexOf("a sent message notifies the recipient"), names.join(", "));
  assert.equal(receipt.checks.some((check: any) => check.verdict === "fail"), false, receiptRun.stdout);
  // The scaffold also carries this file's "effect engine absence" journey, blocked for the same reason.
  assert.deepEqual(
    receipt.checks.filter((check: any) => check.verdict === "blocked").map((check: any) => check.name),
    ["a sent message notifies the recipient", "effect engine absence", "effects"],
  );
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


test("provider capture bounds UTF-8 bytes at scalar boundaries and reports dropped requests", { timeout: 30_000 }, async () => {
  await writeFile(join(root, "snapback/tests/provider-capture.test.ts"), `
import { journey } from "snapback2/test";
journey("capture bounds", async ({ effects }) => {
  const provider = await effects.provider("https://api.example.com", request => Response.json({ host: request.headers.get("host"), url: request.url }));
  for (const body of ["界".repeat(16384), "a" + "界".repeat(5461), "界".repeat(5461) + "ab"]) {
    const response = await fetch(provider.to + "/capture", { method: "POST", body });
    const data = await response.json();
    const record = provider.requests[provider.requests.length - 1];
    const retained = new TextEncoder().encode(record.body).length;
    const bytes = new TextEncoder().encode(body).length;
    if (retained > 16384 || record.body.includes("�")) throw new Error("capture retained " + retained + " bytes, limit 16384");
    if (record.bodyBytes !== bytes) throw new Error("missing original byte count: " + record.bodyBytes);
    if (bytes > 16384 && (record.bodyCapped?.bytes !== bytes || record.bodyCapped?.limit !== 16384)) throw new Error("capture omitted its cap");
    if (bytes === 16384 && (record.body !== body || record.bodyCapped)) throw new Error("exact boundary was truncated");
    if (data.host !== "api.example.com" || data.url !== "https://api.example.com/capture" || record.headers.host !== "api.example.com") throw new Error("logical host lost: " + JSON.stringify(data));
  }
  for (let i = 3; i < 201; i++) await (await fetch(provider.to + "/capture")).text();
  if (provider.requests.length !== 200 || provider.dropped !== 1) throw new Error("request cap not reported");
});
`);
  try {
    const result = cli(["test", "--journey", "capture bounds", "--json"]);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.verdict, "pass", result.stdout + result.stderr);
  } finally { await rm(join(root, "snapback/tests/provider-capture.test.ts")); }
});

test("derived-only states its scope and skips the effects witness check", { timeout: 30_000 }, () => {
  const result = cli(["test", "--derived-only", "--json"]);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt.scope, { changed: [], derivedOnly: true });
  assert.equal(receipt.checks.some((check: any) => check.name === "effects" || check.kind === "journey"), false, result.stdout);
  assert.equal(receipt.verdict, "pass", result.stdout + result.stderr);
});

test("manual dev cannot opt into test-owner bindings", () => {
  const result = cli(["dev", "--test-owner", "--status", "--json"]);
  const refused = JSON.parse(result.stdout || result.stderr);
  assert.equal(refused.code, "E_INPUT", result.stdout + result.stderr);
  assert.match(refused.message, /snapback2 test/);
});

test("a completed journey with no provider exits without an epoch acknowledgment", async () => {
  const file = join(root, "no-provider.mjs");
  for (const [body, status] of [
    ["", 0],
    ["process.exitCode = 7;", 7],
    ["process.once('beforeExit', () => { process.exitCode = 9; });", 9],
  ] as const) {
    await writeFile(file, `import { journey } from ${JSON.stringify(join(packageRoot, "dist/test.mjs"))};
journey("no provider", async () => { ${body} });`);
    // Hold stdin open without sending an acknowledgment. A provider-free
    // body must exit naturally without the supervisor's grace cleanup.
    const child = spawn(process.execPath, [env.SNAPBACK2_TEST_RUNNER,
      "--url", "http://127.0.0.1:1", "--secret", "unused", "--epoch", "no-provider",
      "--journey-index", "0", "--", file], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 1500);
    const code = await new Promise<number | null>(resolve => child.once("close", resolve));
    clearTimeout(timeout);
    assert.equal(code, status, stdout + stderr);
    assert.equal(JSON.parse(stdout.trim().split("\n").at(-1)!).verdict, "pass");
  }
});
