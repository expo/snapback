#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  aggregateChoreography,
  classifyNonGreenCause,
  UNIMPLEMENTED_ASSERTIONS,
} from "./choreography.mjs";

// @ref LLP 0201#d2--quantitative-instrument — calibrate the fail-closed
// suite-plus-choreography green contract with two isolated browser contexts.
const profiles = new Map([
  ["alice", { displayName: "Alice Adams", bio: "Initial Alice bio" }],
  ["bob", { displayName: "Bob Brown", bio: "Initial Bob bio" }],
]);
const posts = [
  { id: "alice-post-1", author: "alice", authorName: "Alice Adams", text: "Alice calibration one" },
  { id: "alice-post-2", author: "alice", authorName: "Alice Adams", text: "Alice calibration two" },
];
let likes = new Map();
let messages = [];
let messageOrder = 0;

function resetM8State() {
  likes = new Map();
  messages = [];
  messageOrder = 0;
}

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
if (
  UNIMPLEMENTED_ASSERTIONS.some((item) => item.required) ||
  UNIMPLEMENTED_ASSERTIONS.some((item) => !["m2", "m3"].includes(item.segment))
) {
  throw new Error("unimplemented catalog must stay optional and confined to m2/m3");
}
const causeCases = [
  [{ green: true, suitePass: true, browserPass: true, requiredUnimplemented: 0 }, null],
  [
    { green: false, suitePass: true, browserPass: false, requiredUnimplemented: 1 },
    "required-unimplemented",
  ],
  [
    { green: false, suitePass: true, browserPass: false, requiredUnimplemented: 0 },
    "choreography-failed",
  ],
  [
    { green: false, suitePass: false, browserPass: true, requiredUnimplemented: 0 },
    "suite-failed",
  ],
  [
    { green: false, suitePass: null, browserPass: true, requiredUnimplemented: 0 },
    "instrument",
  ],
];
for (const [input, expected] of causeCases) {
  const actual = classifyNonGreenCause(input);
  if (actual !== expected) {
    throw new Error(
      `classifyNonGreenCause(${JSON.stringify(input)}) === ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    );
  }
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
let knownMessages = [];
let syncing = false;
const tid = (name) => 'data-testid="' + name + '"';
const esc = (value) => String(value).replace(/[&<>"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
})[character]);

function stopPoll() { if (poll) clearInterval(poll); poll = null; syncing = false; }
function session() { return localStorage.getItem('persona'); }
function counterpart() { return session() === 'bob' ? 'Alice' : 'Bob'; }
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
    '<button ' + tid('sm-feed-tab-global') + '>Global</button>' +
    '<button ' + tid('sm-chats-item') + '><span>' + counterpart() + '</span>' +
    '<span id="unread"></span></button>';
  root.querySelector('[data-testid=sm-feed-tab-global]').onclick = () => go('/global');
  root.querySelector('[data-testid=sm-chats-item]').onclick = () => go('/conversation/dm');
  const updateUnread = async () => {
    try {
      const response = await fetch('/api/unread?persona=' + encodeURIComponent(session()));
      const value = await response.json();
      const target = document.querySelector('#unread');
      if (!target) return;
      target.innerHTML = value.count > 0
        ? '<span ' + tid('sm-chats-unread') + '>' + value.count + '</span>'
        : '';
    } catch {}
  };
  updateUnread();
  poll = setInterval(updateUnread, 30);
}

async function globalFeed() {
  stopPoll();
  root.innerHTML = '<button ' + tid('sm-feed-tab-following') + '>Following</button>' +
    '<button ' + tid('sm-feed-tab-global') + '>Global</button><section id="feed"></section>';
  root.querySelector('[data-testid=sm-feed-tab-global]').onclick = () => globalFeed();
  const update = async () => {
    const response = await fetch('/api/posts?viewer=' + encodeURIComponent(session()));
    const values = await response.json();
    const feed = document.querySelector('#feed');
    if (!feed) return;
    feed.innerHTML = values.map((post) =>
      '<article ' + tid('sm-feed-item') + '><strong>' + esc(post.authorName) + '</strong>' +
      '<p>' + esc(post.text) + '</p><button ' + tid('sm-post-like') +
      ' data-post-id="' + esc(post.id) + '" aria-pressed="' + post.liked + '"' +
      ' aria-label="' + (post.liked ? 'Unlike' : 'Like') + ' post, ' + post.likeCount +
      ' likes">Like ' + post.likeCount + '</button></article>'
    ).join('');
    for (const button of feed.querySelectorAll('[data-testid=sm-post-like]')) {
      button.onclick = async () => {
        await fetch('/api/like', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ postId: button.dataset.postId, actor: session() }),
        });
        await update();
      };
    }
  };
  await update();
}

async function insights(stale) {
  stopPoll();
  const response = await fetch('/api/insights?persona=' + encodeURIComponent(session()));
  const values = await response.json();
  if (stale) values.likesReceived = 0;
  const stats = [
    ['posts', values.posts, 'sm-insights-total-posts'],
    ['likes-received', values.likesReceived, 'sm-insights-total-likes-received'],
    ['reposts-received', values.repostsReceived, 'sm-insights-total-reposts-received'],
    ['replies-received', values.repliesReceived, 'sm-insights-total-replies-received'],
    ['followers', values.followers, 'sm-insights-total-followers'],
    ['following', values.following, 'sm-insights-total-following'],
  ];
  root.innerHTML = stats.map(([name, value, testID]) =>
    '<section ' + tid(testID) + ' data-value="' + name + '" data-count="' +
    value + '">' + name.replaceAll('-', ' ') + ': ' + value + '</section>'
  ).join('');
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

function pendingKey() { return 'pending-messages-' + session(); }
function pendingMessages() { return JSON.parse(localStorage.getItem(pendingKey()) || '[]'); }
function storePending(values) { localStorage.setItem(pendingKey(), JSON.stringify(values)); }

function renderConversationMessages() {
  const target = document.querySelector('#messages');
  if (!target) return;
  const serverIds = new Set(knownMessages.map((message) => message.id));
  const combined = knownMessages.concat(
    pendingMessages().filter((message) => !serverIds.has(message.id)).map((message) => ({
      ...message, state: 'pending', order: Number.MAX_SAFE_INTEGER,
    })),
  );
  target.innerHTML = combined.map((message) =>
    '<article ' + tid('sm-convo-bubble') + ' data-message-id="' + esc(message.id) + '">' +
    '<span>' + esc(message.sender) + ': ' + esc(message.text) + '</span> ' +
    '<span ' + tid('sm-convo-receipt') + ' aria-label="' + esc(message.state) + '">' +
    esc(message.state) + '</span></article>'
  ).join('');
}

async function flushPending() {
  const queued = pendingMessages();
  const remaining = [];
  for (const message of queued) {
    try {
      const response = await fetch('/api/messages', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
      });
      if (!response.ok) remaining.push(message);
    } catch {
      remaining.push(message);
    }
  }
  storePending(remaining);
  renderConversationMessages();
}

async function syncConversation() {
  if (syncing || !location.pathname.startsWith('/conversation/')) return;
  syncing = true;
  try {
    await flushPending();
    const response = await fetch('/api/messages?viewer=' + encodeURIComponent(session()));
    knownMessages = await response.json();
    renderConversationMessages();
  } catch {
    renderConversationMessages();
  } finally {
    syncing = false;
  }
}

function conversation() {
  stopPoll();
  knownMessages = [];
  root.innerHTML = '<section id="messages"></section><input ' + tid('sm-convo-input') +
    '><button ' + tid('sm-convo-send') + '>Send</button>';
  root.querySelector('[data-testid=sm-convo-send]').onclick = async () => {
    const input = root.querySelector('[data-testid=sm-convo-input]');
    const text = input.value;
    if (!text) return;
    const queued = pendingMessages();
    queued.push({ id: crypto.randomUUID(), sender: session(), text });
    storePending(queued);
    input.value = '';
    renderConversationMessages();
    await syncConversation();
  };
  renderConversationMessages();
  syncConversation();
  poll = setInterval(syncConversation, 30);
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
  if (path === '/global') return globalFeed();
  if (path === '/insights') return insights(false);
  if (path === '/insights-stale') return insights(true);
  if (path.startsWith('/conversation/')) return conversation();
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
  if (url.pathname === "/api/posts") {
    const viewer = url.searchParams.get("viewer") ?? "";
    return json(response, 200, posts.map((post) => ({
      ...post,
      liked: likes.get(post.id)?.has(viewer) ?? false,
      likeCount: likes.get(post.id)?.size ?? 0,
    })));
  }
  if (url.pathname === "/api/like" && request.method === "POST") {
    const value = await body(request);
    if (!posts.some((post) => post.id === value.postId)) {
      return json(response, 404, { error: "missing post" });
    }
    const actors = likes.get(value.postId) ?? new Set();
    if (actors.has(value.actor)) actors.delete(value.actor);
    else actors.add(value.actor);
    likes.set(value.postId, actors);
    return json(response, 200, { liked: actors.has(value.actor), likeCount: actors.size });
  }
  if (url.pathname === "/api/insights") {
    const handle = url.searchParams.get("persona") ?? "";
    const authored = posts.filter((post) => post.author === handle);
    return json(response, 200, {
      posts: authored.length,
      likesReceived: authored.reduce((sum, post) => sum + (likes.get(post.id)?.size ?? 0), 0),
      repostsReceived: 0,
      repliesReceived: 0,
      followers: 1,
      following: 1,
    });
  }
  if (url.pathname === "/api/messages" && request.method === "POST") {
    const value = await body(request);
    if (!messages.some((message) => message.id === value.id)) {
      messages.push({
        id: value.id,
        sender: value.sender,
        text: value.text,
        order: ++messageOrder,
        readBy: new Set(),
      });
    }
    return json(response, 200, { accepted: true });
  }
  if (url.pathname === "/api/messages") {
    const viewer = url.searchParams.get("viewer") ?? "";
    for (const message of messages) {
      if (message.sender !== viewer) message.readBy.add(viewer);
    }
    return json(response, 200, messages.map((message) => {
      const recipient = message.sender === "bob" ? "alice" : "bob";
      return {
        id: message.id,
        sender: message.sender,
        text: message.text,
        order: message.order,
        state: message.readBy.has(recipient) ? "read" : "sent",
      };
    }));
  }
  if (url.pathname === "/api/unread") {
    const persona = url.searchParams.get("persona") ?? "";
    const count = messages.filter(
      (message) => message.sender !== persona && !message.readBy.has(persona),
    ).length;
    return json(response, 200, { count });
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
  const m1SuiteReceipt = join(scratch, "m1-calibration-suite.json");
  const m8SuiteReceipt = join(scratch, "m8-calibration-suite.json");
  const suiteStatus = join(scratch, "suite-status.json");
  const receipts = join(scratch, "receipts.jsonl");
  const simulatorStatus = join(scratch, "simulator-status.json");
  await writeFile(
    m1SuiteReceipt,
    `${JSON.stringify({ kind: "choreography-calibration-suite", segment: "m1", pass: true })}\n`,
  );
  await writeFile(
    m8SuiteReceipt,
    `${JSON.stringify({ kind: "choreography-calibration-suite", segment: "m8", pass: true })}\n`,
  );
  await writeFile(
    suiteStatus,
    `${JSON.stringify({
      m1: { pass: true, receipt: m1SuiteReceipt },
      m8: { pass: true, receipt: m8SuiteReceipt },
    })}\n`,
  );
  await writeFile(
    simulatorStatus,
    `${JSON.stringify({
      m8: {
        id: "ios-simulator-m8",
        pass: false,
        receipt: null,
        reason: "calibration deliberately records absent native evidence",
      },
    })}\n`,
  );

  const chrome = process.env.CHOREO_BROWSER_EXECUTABLE ?? null;
  const runEnvironment = {
    ...process.env,
    CHOREO_BASE_URL: `http://127.0.0.1:${address.port}`,
    CHOREO_PASSWORD: "calibration-password",
    ...(chrome && existsSync(chrome) ? { CHOREO_BROWSER_EXECUTABLE: chrome } : {}),
  };
  const result = await run(
    process.execPath,
    [
      new URL("./choreography.mjs", import.meta.url).pathname,
      "m1,m8",
      "--suite-status",
      suiteStatus,
      "--receipts",
      receipts,
      "--simulator-status",
      simulatorStatus,
      "--timeout",
      "5000",
    ],
    {
      cwd: new URL(".", import.meta.url).pathname,
      env: runEnvironment,
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
  const choreographySource = await readFile(
    new URL("./choreography.mjs", import.meta.url),
    "utf8",
  );
  const implementedFalseCount = [...choreographySource.matchAll(/implemented:\s*false/g)].length;
  if (implementedFalseCount !== 1) {
    throw new Error(
      `expected a single implemented:false assignment (emitUnimplemented), found ${implementedFalseCount}`,
    );
  }
  for (const spec of UNIMPLEMENTED_ASSERTIONS) {
    const call = `emitUnimplemented(ctx, "${spec.segment}", "${spec.assertion}")`;
    if (!choreographySource.includes(call)) {
      throw new Error(`unimplemented ${spec.segment}/${spec.assertion} is not emitted`);
    }
  }

  const skippedSample = {
    version: "0.3.1-m8",
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
  const legacySummaryWithoutCause = {
    version: "0.3.1-m8",
    runId: "00000000-0000-4000-8000-000000000001",
    recordedAt: "2026-08-10T00:00:00.000Z",
    type: "segment-summary",
    segment: "m1",
    assertion: "__segment__",
    implemented: true,
    required: true,
    status: "passed",
    pass: true,
    timings: [
      {
        attempt: 1,
        pass: true,
        startedAt: null,
        durationMs: 1,
        metrics: {},
      },
    ],
    bestOf: 1,
    details: {
      selection: "segment aggregate",
      selectedAttempt: 1,
      reason: null,
    },
    assertions: {
      total: 1,
      required: 1,
      implemented: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      notImplemented: 0,
      requiredUnimplemented: 0,
    },
    suite: { pass: true, receipt: "acceptance/m1.json" },
    choreography: {
      browserPass: true,
      requiredExternal: [],
      externalPass: true,
      supplementalExternal: [],
      pass: true,
    },
    green: true,
  };
  const inventedLabel = {
    ...legacySummaryWithoutCause,
    runId: "00000000-0000-4000-8000-000000000002",
    status: "failed",
    pass: false,
    green: false,
    timings: [
      {
        attempt: 1,
        pass: false,
        startedAt: null,
        durationMs: 1,
        metrics: {},
      },
    ],
    details: {
      selection: "segment aggregate",
      selectedAttempt: null,
      reason: "required unimplemented",
    },
    assertions: {
      ...legacySummaryWithoutCause.assertions,
      implemented: 0,
      passed: 0,
      skipped: 1,
      notImplemented: 1,
      requiredUnimplemented: 1,
    },
    choreography: {
      ...legacySummaryWithoutCause.choreography,
      browserPass: false,
      pass: false,
    },
    suite: { pass: true, receipt: "acceptance/m1.json" },
    nonGreenCause: "functionally-green",
  };
  for (const record of [...records, skippedSample, legacySummaryWithoutCause]) {
    if (!validate(record)) {
      throw new Error(`receipt schema failure: ${JSON.stringify(validate.errors)}`);
    }
  }
  if (validate(inventedLabel)) {
    throw new Error("schema accepted an invented nonGreenCause label");
  }
  const m1Summary = records.find(
    (record) => record.type === "segment-summary" && record.segment === "m1",
  );
  const m8Summary = records.find(
    (record) => record.type === "segment-summary" && record.segment === "m8",
  );
  if (
    !m1Summary?.green ||
    m1Summary.status !== "passed" ||
    m1Summary.assertions.failed !== 0 ||
    m1Summary.assertions.requiredUnimplemented !== 0 ||
    m1Summary.nonGreenCause !== null ||
    !m8Summary?.green ||
    m8Summary.status !== "passed" ||
    m8Summary.assertions.total !== 5 ||
    m8Summary.assertions.failed !== 0 ||
    m8Summary.assertions.requiredUnimplemented !== 0 ||
    m8Summary.nonGreenCause !== null
  ) {
    throw new Error(
      `self-test did not produce honest M1/M8 green: ${JSON.stringify({ m1Summary, m8Summary })}`,
    );
  }
  const m8Supplemental = m8Summary.choreography.supplementalExternal;
  if (
    m8Supplemental.length !== 1 ||
    m8Supplemental[0].id !== "ios-simulator-m8" ||
    m8Supplemental[0].pass !== false ||
    m8Supplemental[0].requiredForGreen !== false
  ) {
    throw new Error(`M8 simulator status was not retained as non-gating: ${JSON.stringify(m8Supplemental)}`);
  }

  resetM8State();
  const failingAdapter = join(scratch, "m8-failing-adapter.json");
  const failingReceipts = join(scratch, "m8-failing-receipts.jsonl");
  await writeFile(
    failingAdapter,
    `${JSON.stringify({
      schemaVersion: "social-messenger.choreography-adapter.v1",
      routes: { insights: "/insights-stale" },
    })}\n`,
  );
  const failingResult = await run(
    process.execPath,
    [
      new URL("./choreography.mjs", import.meta.url).pathname,
      "m8",
      "--suite-status",
      suiteStatus,
      "--adapter",
      failingAdapter,
      "--receipts",
      failingReceipts,
      "--timeout",
      "5000",
    ],
    {
      cwd: new URL(".", import.meta.url).pathname,
      env: runEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (failingResult.status !== 1) {
    throw new Error(
      `deliberately stale M8 Insights did not fail closed (${failingResult.status ?? failingResult.signal})\n${failingResult.stdout}\n${failingResult.stderr}`,
    );
  }
  const failingRecords = (await readFile(failingReceipts, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const record of failingRecords) {
    if (!validate(record)) {
      throw new Error(`failing-path receipt schema failure: ${JSON.stringify(validate.errors)}`);
    }
  }
  const failedInsights = failingRecords.find(
    (record) => record.type === "assertion" && record.assertion === "m8-a02-insights-like-refresh",
  );
  const failingSummary = failingRecords.find((record) => record.type === "segment-summary");
  if (
    failedInsights?.status !== "failed" ||
    failingSummary?.green !== false ||
    failingSummary?.choreography.browserPass !== false ||
    failingSummary?.assertions.failed < 1 ||
    failingSummary?.nonGreenCause !== "choreography-failed"
  ) {
    throw new Error(
      `deliberate M8 failure was not represented fail-closed: ${JSON.stringify({ failedInsights, failingSummary })}`,
    );
  }

  process.stdout.write(
    `social-messenger choreography self-test: PASS (${records.filter((record) => record.type === "assertion").length} assertions, m1+m8 green; deliberate m8 failure rejected)\n`,
  );
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
  await rm(scratch, { recursive: true, force: true });
}
