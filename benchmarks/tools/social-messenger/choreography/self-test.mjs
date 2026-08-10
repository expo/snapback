#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { aggregateChoreography } from "./choreography.mjs";

// @ref LLP 0201#d2--quantitative-instrument — calibrate the fail-closed
// suite-plus-choreography green contract with two isolated browser contexts.
const profiles = new Map([
  ["alice", { displayName: "Alice Adams", bio: "Initial Alice bio" }],
  ["bob", { displayName: "Bob Brown", bio: "Initial Bob bio" }],
]);

const passed = { implemented: true, required: true, status: "passed" };
const optionalSkip = { implemented: false, required: false, status: "skipped" };
const requiredSkip = { implemented: false, required: true, status: "skipped" };
const implementedFailure = { implemented: true, required: true, status: "failed" };
if (!aggregateChoreography([passed, optionalSkip]).browserPass) {
  throw new Error("optional explicit skip incorrectly blocked choreography green");
}
const requiredSkipAggregate = aggregateChoreography([passed, requiredSkip]);
if (
  requiredSkipAggregate.browserPass ||
  requiredSkipAggregate.counts.requiredUnimplemented !== 1 ||
  !requiredSkipAggregate.reason
) {
  throw new Error("required unimplemented assertion incorrectly allowed choreography green");
}
if (aggregateChoreography([passed, implementedFailure]).browserPass) {
  throw new Error("implemented failed assertion incorrectly allowed choreography green");
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function body(request) {
  let value = "";
  for await (const chunk of request) value += chunk;
  return JSON.parse(value || "{}");
}

const appHtml = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><title>Choreography calibration</title></head>
<body><main id="app"></main><script>
const root = document.querySelector('#app');
let poll = null;
const tid = (name) => 'data-testid="' + name + '"';

function stopPoll() { if (poll) clearInterval(poll); poll = null; }
function session() { return localStorage.getItem('persona'); }
function go(path) { history.pushState({}, '', path); render(); }

function auth() {
  stopPoll();
  root.innerHTML = '<input ' + tid('sm-auth-email') + '><input type="password" ' +
    tid('sm-auth-password') + '><button ' + tid('sm-auth-submit') + '>Sign in</button>';
  root.querySelector('[data-testid=sm-auth-submit]').onclick = () => {
    const email = root.querySelector('[data-testid=sm-auth-email]').value;
    localStorage.setItem('persona', email.split('@')[0]);
    go('/');
  };
}

function home() {
  stopPoll();
  root.innerHTML = '<button ' + tid('sm-feed-tab-following') + '>Following</button>' +
    '<button ' + tid('sm-chats-item') + '>Chats</button>';
}

async function profile(handle) {
  stopPoll();
  const update = async () => {
    const response = await fetch('/api/profile?handle=' + encodeURIComponent(handle));
    const value = await response.json();
    root.innerHTML = '<section ' + tid('sm-profile') + '><h1>' + value.displayName +
      '</h1><p>' + value.bio + '</p></section>';
  };
  await update();
  poll = setInterval(update, 50);
}

async function editProfile() {
  stopPoll();
  const handle = session();
  const response = await fetch('/api/profile?handle=' + encodeURIComponent(handle));
  const value = await response.json();
  root.innerHTML = '<input ' + tid('sm-profile-field-displayname') + ' value="' +
    value.displayName + '"><textarea ' + tid('sm-profile-field-bio') + '>' +
    value.bio + '</textarea><button ' + tid('sm-profile-save') + '>Save</button>';
  root.querySelector('[data-testid=sm-profile-save]').onclick = async () => {
    await fetch('/api/profile?handle=' + encodeURIComponent(handle), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: root.querySelector('[data-testid=sm-profile-field-displayname]').value,
        bio: root.querySelector('[data-testid=sm-profile-field-bio]').value,
      }),
    });
    go('/profile/' + handle);
  };
}

function settings() {
  stopPoll();
  root.innerHTML = '<button ' + tid('sm-settings-logout') + '>Log out</button>';
  root.querySelector('[data-testid=sm-settings-logout]').onclick = () => {
    localStorage.removeItem('persona');
    auth();
  };
}

function render() {
  if (!session()) return auth();
  const path = location.pathname;
  if (path === '/profile/edit') return editProfile();
  if (path === '/settings') return settings();
  if (path.startsWith('/profile/')) return profile(path.slice('/profile/'.length));
  return home();
}
addEventListener('popstate', render);
render();
</script></body></html>`;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/api/profile") {
    const handle = url.searchParams.get("handle") ?? "";
    if (!profiles.has(handle)) return json(response, 404, { error: "missing profile" });
    if (request.method === "POST") {
      profiles.set(handle, { ...profiles.get(handle), ...(await body(request)) });
    }
    return json(response, 200, profiles.get(handle));
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(appHtml);
});

function run(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectPromise);
    child.on("close", (status, signal) => resolvePromise({ status, signal, stdout, stderr }));
  });
}

const scratch = await mkdtemp(join(tmpdir(), "social-messenger-choreo-"));
try {
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("self-test server has no port");
  const suiteReceipt = join(scratch, "m1-calibration-suite.json");
  const suiteStatus = join(scratch, "suite-status.json");
  const receipts = join(scratch, "receipts.jsonl");
  await writeFile(
    suiteReceipt,
    `${JSON.stringify({ kind: "choreography-calibration-suite", segment: "m1", pass: true })}\n`,
  );
  await writeFile(
    suiteStatus,
    `${JSON.stringify({ m1: { pass: true, receipt: suiteReceipt } })}\n`,
  );

  const chrome = process.env.CHOREO_BROWSER_EXECUTABLE ?? null;
  const result = await run(
    process.execPath,
    [
      new URL("./choreography.mjs", import.meta.url).pathname,
      "m1",
      "--suite-status",
      suiteStatus,
      "--receipts",
      receipts,
      "--timeout",
      "5000",
    ],
    {
      cwd: new URL(".", import.meta.url).pathname,
      env: {
        ...process.env,
        CHOREO_BASE_URL: `http://127.0.0.1:${address.port}`,
        CHOREO_PASSWORD: "calibration-password",
        ...(chrome && existsSync(chrome) ? { CHOREO_BROWSER_EXECUTABLE: chrome } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `choreography self-test failed (${result.status ?? result.signal})\n${result.stdout}\n${result.stderr}`,
    );
  }
  const records = (await readFile(receipts, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const schema = JSON.parse(
    await readFile(new URL("./receipts.schema.json", import.meta.url), "utf8"),
  );
  const validate = new Ajv2020({
    allErrors: true,
    strict: false,
    formats: { "date-time": true, uuid: true },
  }).compile(schema);
  const skippedSample = {
    version: "0.2.0-p2",
    runId: "00000000-0000-4000-8000-000000000000",
    recordedAt: "2026-08-10T00:00:00.000Z",
    type: "assertion",
    segment: "m2",
    assertion: "unsupported-calibration-sample",
    implemented: false,
    required: true,
    status: "skipped",
    pass: null,
    timings: [],
    bestOf: 1,
    details: {
      selection: "only attempt",
      selectedAttempt: null,
      reason: "calibration sample for explicit unsupported-state receipts",
    },
  };
  for (const record of [...records, skippedSample]) {
    if (!validate(record)) {
      throw new Error(`receipt schema failure: ${JSON.stringify(validate.errors)}`);
    }
  }
  const summary = records.find((record) => record.type === "segment-summary");
  if (
    !summary?.green ||
    summary.status !== "passed" ||
    summary.assertions.failed !== 0 ||
    summary.assertions.requiredUnimplemented !== 0
  ) {
    throw new Error(`self-test did not produce an honest segment green: ${JSON.stringify(summary)}`);
  }
  process.stdout.write(
    `social-messenger choreography self-test: PASS (${records.length - 1} assertions, m1 green)\n`,
  );
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
  await rm(scratch, { recursive: true, force: true });
}
