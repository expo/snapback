import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateJsonSchema } from "../../lib/json-schema.mjs";
import { createCheckRunner } from "./choreography.mjs";
import { loadSetupIdentity, verifySetupToolchain } from "./setup-identity.mjs";

const PLAYWRIGHT_VERSION = "1.62.1";

function run(args, env = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [new URL("./choreography.mjs", import.meta.url).pathname, ...args], {
      env: { ...process.env, CHOREO_LANE_RUN_ID: "startup-calibration", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectPromise);
    child.once("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
}

function setupValue(overrides = {}) {
  return {
    schemaVersion: "social-messenger.setup-identity.v1",
    instrumentPin: "social-messenger@0.3.4-m8",
    backend: { kind: "snapback", version: "test" },
    runtime: {
      qualifiedBinary: { claimed: false, reason: "unit test does not launch a backend" },
      wrapper: { claimed: false, reason: "unit test does not launch a wrapper" },
    },
    packageClosure: {
      mode: "workspace",
      prepack: "not-applicable",
      artifacts: [{ name: "fixture", version: "1", sha256: null }],
    },
    toolchain: {
      node: { path: process.execPath, version: process.version },
      bun: "not-used",
      npm: "not-used",
      playwright: PLAYWRIGHT_VERSION,
      browser: "chromium",
    },
    host: { id: "unit-test", platform: process.platform, arch: process.arch },
    ...overrides,
  };
}

test("missing suite status is a first-line setup refusal without receipt creation", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "choreo-startup-"));
  try {
    const receipts = join(scratch, "receipts.jsonl");
    const result = await run(["m1", "--receipts", receipts]);
    assert.equal(result.status, 2);
    assert.match(result.stderr.split(/\r?\n/u)[0], /"outcomeClass":"setup"/u);
    assert.match(result.stderr, /suite-status startup refusal/u);
    await assert.rejects(readFile(receipts), /ENOENT/u);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("missing setup identity refuses after valid suite custody and before receipts", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "choreo-startup-"));
  try {
    const evidence = join(scratch, "suite.json");
    const statuses = join(scratch, "suite-status.json");
    const receipts = join(scratch, "receipts.jsonl");
    await writeFile(evidence, "{}\n");
    await writeFile(statuses, `${JSON.stringify({ m1: { pass: true, receipt: "suite.json" } })}\n`);
    const result = await run(["m1", "--suite-status", statuses, "--receipts", receipts]);
    assert.equal(result.status, 2);
    assert.match(result.stderr.split(/\r?\n/u)[0], /"outcomeClass":"setup"/u);
    assert.match(result.stderr, /setup-identity startup refusal/u);
    await assert.rejects(readFile(receipts), /ENOENT/u);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("M7 cannot share the continuous M1-M6/M8 invocation", async () => {
  const result = await run(["m1,m7"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr.split(/\r?\n/u)[0], /"outcomeClass":"setup"/u);
  assert.match(result.stderr, /m7 is a fresh-session segment/u);
});

test("setup identity verifies a claimed binary separately from wrapper nonclaim", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "choreo-setup-"));
  try {
    const binary = join(scratch, "qualified.bin");
    const setupPath = join(scratch, "setup.json");
    await writeFile(binary, "qualified bytes\n");
    const { createHash } = await import("node:crypto");
    const sha256 = `sha256:${createHash("sha256").update(await readFile(binary)).digest("hex")}`;
    const value = setupValue({
      runtime: {
        qualifiedBinary: { claimed: true, path: "qualified.bin", sha256 },
        wrapper: { claimed: false, reason: "no wrapper in unit test" },
      },
    });
    await writeFile(setupPath, `${JSON.stringify(value)}\n`);
    const loaded = await loadSetupIdentity(setupPath, { browser: "chromium" });
    assert.equal(loaded.value.runtime.qualifiedBinary.sha256, sha256);
    assert.equal(loaded.value.runtime.wrapper.claimed, false);
    assert.match(loaded.descriptor.sha256, /^sha256:[a-f0-9]{64}$/u);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("setup identity refuses a Playwright version different from the loaded toolchain", () => {
  assert.throws(
    () => verifySetupToolchain(setupValue(), {
      browser: "chromium",
      playwrightVersion: "0.0.0",
    }),
    /Playwright version differs/u,
  );
});

test("packed setup refuses an undigested package closure", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "choreo-setup-"));
  try {
    const setupPath = join(scratch, "setup.json");
    const value = setupValue({
      packageClosure: {
        mode: "packed",
        prepack: "verified",
        artifacts: [{ name: "fixture", version: "1", sha256: null }],
      },
    });
    await writeFile(setupPath, `${JSON.stringify(value)}\n`);
    await assert.rejects(
      loadSetupIdentity(setupPath, { browser: "chromium" }),
      /packageClosure\/artifacts\/0\/sha256: expected type string/u,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("a failed best-of-three attempt resets only its assertion", async () => {
  let unrelatedCalls = 0;
  let retriedCalls = 0;
  let resets = 0;
  const runner = createCheckRunner(
    async (payload) => payload,
    { assertionWait: async () => {} },
    { receiptPath: "/retained/receipts.jsonl", observationsPath: "/retained/observations.jsonl" },
  );
  runner.setResetAttempt(async () => { resets += 1; });
  await runner.check("m3", "unaffected", {}, async () => {
    unrelatedCalls += 1;
    return {};
  });
  const result = await runner.check("m3", "retry-target", { bestOf: 3 }, async (attempt) => {
    retriedCalls += 1;
    if (attempt === 1) throw new Error("deliberate first-attempt miss");
    return {};
  });
  assert.equal(result.status, "passed");
  assert.equal(unrelatedCalls, 1);
  assert.equal(retriedCalls, 3);
  assert.equal(resets, 1);
});

test("receipt schema accepts fresh M7 and rejects an unverified packed setup", async () => {
  const schema = JSON.parse(await readFile(new URL("./receipts.schema.json", import.meta.url)));
  const record = {
    version: "0.3.4-m8",
    runId: "00000000-0000-4000-8000-000000000007",
    recordedAt: "2026-08-25T12:00:00.000Z",
    type: "segment-summary",
    segment: "m7",
    assertion: "__segment__",
    implemented: true,
    required: true,
    status: "passed",
    pass: true,
    outcomeClass: null,
    timings: [{ attempt: 1, pass: true, startedAt: null, durationMs: 1, settlementWaitMs: 1, metrics: {} }],
    bestOf: 1,
    details: { selection: "segment aggregate", selectedAttempt: 1, reason: null },
    assertions: { total: 2, required: 2, implemented: 2, passed: 2, failed: 0, skipped: 0, notImplemented: 0, requiredUnimplemented: 0 },
    suite: { pass: true, receipt: "m7-suite.json", receiptSha256: `sha256:${"7".repeat(64)}`, outcomeClass: null },
    choreography: { browserPass: true, requiredExternal: [], externalPass: true, supplementalExternal: [], pass: true },
    green: true,
    nonGreenCause: null,
    setupIdentity: { path: "/retained/setup.json", sha256: `sha256:${"8".repeat(64)}` },
    setup: setupValue(),
  };
  assert.deepEqual(validateJsonSchema(schema, record), []);
  const invalidPacked = structuredClone(record);
  invalidPacked.setup.packageClosure = {
    mode: "packed",
    prepack: "verified",
    artifacts: [{ name: "fixture", version: "1", sha256: null }],
  };
  assert.notDeepEqual(validateJsonSchema(schema, invalidPacked), []);
});
