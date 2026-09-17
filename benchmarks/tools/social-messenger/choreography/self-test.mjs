#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  aggregateChoreography,
  classifyNonGreenCause,
  classifyOutcome,
  DEFAULT_ADDED_MEMBER_HANDLE,
  UNIMPLEMENTED_ASSERTIONS,
} from "./choreography.mjs";
import { parseObservationJsonLines } from "./metering/observations.mjs";

const REQUIRE = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = REQUIRE("playwright/package.json").version;

// @ref LLP 0317#benchmark-harness-and-ordinary-test-mistakes — N7 must fail before a lane
// starts if the frozen starter already contains the member M3 intends to add.
const STARTER_M3_PATH = new URL(
  "../../../fixtures/social-messenger/starter-m3.log",
  import.meta.url,
);
const starterM3 = await readFile(STARTER_M3_PATH, "utf8");
const starterGroupCreate = starterM3
  .split("\n")
  .find((line) => line.includes(' group-create g-starter ') && line.includes(' "Weekend Plans" '));
const starterGroupCreateMatch = starterGroupCreate?.match(
  /^\S+ (\S+) group-create g-starter (\S+) /u,
);
assert.ok(starterGroupCreateMatch, "starter M3 must create the Weekend Plans group");
const starterAddedMembers = new Set(
  starterM3
    .split("\n")
    .filter((line) => line.includes(" member-add "))
    .map((line) => line.match(/ member-add \S+ (\S+) /u)?.[1])
    .filter(Boolean),
);
const starterGroupMembers = new Set([
  starterGroupCreateMatch[1],
  starterGroupCreateMatch[2],
  ...starterM3
    .split("\n")
    .map((line) => line.match(/ member-add g-starter (\S+) /u)?.[1])
    .filter(Boolean),
]);
assert.deepEqual(
  [...starterGroupMembers].sort(),
  ["alice", "bob", "carol"],
  "Weekend Plans membership must match the clients driven by the aggregate-receipt assertion",
);
const nonMemberGroupSenders = starterM3
  .split("\n")
  .map((line) => line.match(/^\S+ (\S+) send \S+ g-starter /u)?.[1])
  .filter((actor) => actor && !starterGroupMembers.has(actor));
assert.deepEqual(
  nonMemberGroupSenders,
  [],
  "Weekend Plans starter messages must be authored by group members",
);
assert.equal(
  starterAddedMembers.has(DEFAULT_ADDED_MEMBER_HANDLE),
  false,
  `starter M3 already contains choreography add-member target ${DEFAULT_ADDED_MEMBER_HANDLE}`,
);

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
const pollOptionIds = ["m7-option-a", "m7-option-b"];
const pollVotes = new Map();

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
if (UNIMPLEMENTED_ASSERTIONS.length !== 0) {
  throw new Error("the observability bump must not retain structural skips");
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
];
for (const [input, expected] of causeCases) {
  const actual = classifyNonGreenCause(input);
  if (actual !== expected) {
    throw new Error(
      `classifyNonGreenCause(${JSON.stringify(input)}) === ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    );
  }
}
assert.throws(
  () => classifyNonGreenCause({
    green: false,
    suitePass: null,
    browserPass: true,
    requiredUnimplemented: 0,
  }),
  /suitePass must be boolean/u,
);
for (const [input, expected] of [
  [{ green: true, suitePass: true, suiteOutcomeClass: null, assertionReceipts: [] }, null],
  [{ green: false, suitePass: false, suiteOutcomeClass: "platform", assertionReceipts: [] }, "platform"],
  [{ green: false, suitePass: true, suiteOutcomeClass: null, assertionReceipts: [{ status: "failed", outcomeClass: "application" }] }, "application"],
  [{ green: false, suitePass: true, suiteOutcomeClass: null, assertionReceipts: [{ status: "failed", outcomeClass: "instrument" }] }, "instrument"],
]) {
  assert.equal(classifyOutcome(input), expected);
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
    '<button ' + tid('sm-chats-item') + ' aria-valuetext="dm:' + counterpart().toLowerCase() + '"><span>' + counterpart() + '</span>' +
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
      '<article ' + tid('sm-feed-item') + '><span ' + tid('sm-feed-author-avatar') +
      ' aria-valuetext="' + esc(post.author) + '"></span><strong>' + esc(post.authorName) + '</strong>' +
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
    root.innerHTML = '<section ' + tid('sm-profile') + '><h1 ' + tid('sm-profile-heading') + '>' + value.displayName +
      '</h1><p>' + value.bio + '</p><button ' + tid('sm-profile-nav-feed') + '>Feed</button></section>';
    root.querySelector('[data-testid=sm-profile-nav-feed]').onclick = () => go('/');
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

function pendingVoteKey() { return 'pending-poll-vote-' + session(); }
function pendingVote() { return localStorage.getItem(pendingVoteKey()); }

async function syncPoll() {
  if (syncing || !location.pathname.startsWith('/conversation/group/')) return;
  syncing = true;
  try {
    const queued = pendingVote();
    if (queued) {
      const response = await fetch('/api/poll', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: session(), optionId: queued }),
      });
      if (response.ok) localStorage.removeItem(pendingVoteKey());
    }
    const response = await fetch('/api/poll?actor=' + encodeURIComponent(session()));
    const value = await response.json();
    const options = document.querySelector('#poll-options');
    if (!options) return;
    options.innerHTML = value.options.map((option) => {
      const isPending = pendingVote() === option.id;
      return '<button ' + tid('sm-poll-option') + ' aria-valuetext="' + esc(option.id) +
        '" aria-selected="' + option.selected + '" aria-busy="' + isPending +
        '" data-pending="' + isPending + '">' +
        esc(option.id) + ' <span ' + tid('sm-poll-tally') + ' aria-valuetext="' +
        option.tally + '">' + option.tally + '</span></button>';
    }).join('');
    document.querySelector('#poll-total').setAttribute('aria-valuetext', String(value.total));
    document.querySelector('#poll-total').textContent = String(value.total);
    for (const button of options.querySelectorAll('[data-testid=sm-poll-option]')) {
      button.onclick = async () => {
        localStorage.setItem(pendingVoteKey(), button.getAttribute('aria-valuetext'));
        await syncPoll();
      };
    }
  } catch {
    const queued = pendingVote();
    if (queued) {
      const option = [...document.querySelectorAll('[data-testid=sm-poll-option]')]
        .find((candidate) => candidate.getAttribute('aria-valuetext') === queued);
      if (option) {
        option.setAttribute('aria-busy', 'true');
        option.setAttribute('data-pending', 'true');
      }
    }
  } finally {
    syncing = false;
  }
}

function groupConversation() {
  stopPoll();
  root.innerHTML = '<section id="poll-options"></section><span id="poll-total" ' +
    tid('sm-poll-total') + ' aria-valuetext="0">0</span><input ' + tid('sm-convo-input') + '>';
  syncPoll();
  poll = setInterval(syncPoll, 30);
}

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
    '<span ' + tid('sm-convo-sender-avatar') + ' aria-valuetext="' + esc(message.sender) + '"></span>' +
    '<span>' + esc(message.sender) + ': ' + esc(message.text) + '</span> ' +
    '<span ' + tid('sm-convo-receipt') + ' aria-valuetext="' + esc(message.state) + '">' +
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
  if (path.startsWith('/conversation/group/')) return groupConversation();
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
  if (url.pathname === "/api/poll" && request.method === "POST") {
    const value = await body(request);
    if (!pollOptionIds.includes(value.optionId) || !["alice", "bob"].includes(value.actor)) {
      return json(response, 400, { error: "invalid vote" });
    }
    pollVotes.set(value.actor, value.optionId);
    return json(response, 200, { accepted: true });
  }
  if (url.pathname === "/api/poll") {
    const actor = url.searchParams.get("actor") ?? "";
    const options = pollOptionIds.map((id) => ({
      id,
      tally: [...pollVotes.values()].filter((optionId) => optionId === id).length,
      selected: pollVotes.get(actor) === id,
    }));
    return json(response, 200, { options, total: pollVotes.size });
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
  const m7SuiteReceipt = join(scratch, "m7-calibration-suite.json");
  const m8SuiteReceipt = join(scratch, "m8-calibration-suite.json");
  const suiteStatus = join(scratch, "suite-status.json");
  const receipts = join(scratch, "receipts.jsonl");
  const m7Receipts = join(scratch, "m7-receipts.jsonl");
  const simulatorStatus = join(scratch, "simulator-status.json");
  const setupIdentity = join(scratch, "setup-identity.json");
  await writeFile(
    m1SuiteReceipt,
    `${JSON.stringify({ kind: "choreography-calibration-suite", segment: "m1", pass: true })}\n`,
  );
  await writeFile(
    m7SuiteReceipt,
    `${JSON.stringify({ kind: "choreography-calibration-suite", segment: "m7", pass: true })}\n`,
  );
  await writeFile(
    m8SuiteReceipt,
    `${JSON.stringify({ kind: "choreography-calibration-suite", segment: "m8", pass: true })}\n`,
  );
  await writeFile(
    suiteStatus,
    `${JSON.stringify({
      m1: { pass: true, receipt: "m1-calibration-suite.json" },
      m7: { pass: true, receipt: "m7-calibration-suite.json" },
      m8: { pass: true, receipt: "m8-calibration-suite.json" },
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
  await writeFile(
    setupIdentity,
    `${JSON.stringify({
      schemaVersion: "social-messenger.setup-identity.v1",
      instrumentPin: "social-messenger@0.3.8-m8",
      backend: { kind: "external", version: "choreography-calibration.v1" },
      runtime: {
        qualifiedBinary: { claimed: false, reason: "calibration HTTP app has no Snapback binary" },
        wrapper: { claimed: false, reason: "calibration launches the app in-process" },
      },
      packageClosure: {
        mode: "workspace",
        prepack: "not-applicable",
        artifacts: [{ name: "choreography-calibration", version: "0.3.8-m8", sha256: null }],
      },
      toolchain: {
        node: { path: process.execPath, version: process.version },
        bun: "not-used",
        npm: "not-used",
        playwright: PLAYWRIGHT_VERSION,
        browser: "chromium",
      },
      host: { id: "local-calibration", platform: process.platform, arch: process.arch },
    }, null, 2)}\n`,
  );

  const chrome = process.env.CHOREO_BROWSER_EXECUTABLE ?? null;
  const runEnvironment = {
    ...process.env,
    CHOREO_BASE_URL: `http://127.0.0.1:${address.port}`,
    CHOREO_PASSWORD: "calibration-password",
    CHOREO_LANE_RUN_ID: "choreography-self-test-lane",
    ...(chrome && existsSync(chrome) ? { CHOREO_BROWSER_EXECUTABLE: chrome } : {}),
  };
  const refusedReceipts = join(scratch, "startup-refused-receipts.jsonl");
  const missingLinkage = await run(
    process.execPath,
    [
      new URL("./choreography.mjs", import.meta.url).pathname,
      "m1",
      "--receipts",
      refusedReceipts,
    ],
    {
      cwd: new URL(".", import.meta.url).pathname,
      env: runEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (
    missingLinkage.status !== 2
    || !missingLinkage.stderr.includes("suite-status startup refusal")
    || existsSync(refusedReceipts)
  ) {
    throw new Error(
      `missing suite linkage did not refuse before receipt startup: ${JSON.stringify(missingLinkage)}`,
    );
  }
  const partialSuiteStatus = join(scratch, "partial-suite-status.json");
  await writeFile(
    partialSuiteStatus,
    `${JSON.stringify({ m1: { pass: true, receipt: "m1-calibration-suite.json" } })}\n`,
  );
  const partialLinkage = await run(
    process.execPath,
    [
      new URL("./choreography.mjs", import.meta.url).pathname,
      "m1,m8",
      "--suite-status",
      partialSuiteStatus,
      "--receipts",
      refusedReceipts,
    ],
    {
      cwd: new URL(".", import.meta.url).pathname,
      env: runEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (
    partialLinkage.status !== 2
    || !partialLinkage.stderr.includes("missing selected segment: m8")
    || existsSync(refusedReceipts)
  ) {
    throw new Error(
      `partial suite linkage did not refuse before receipt startup: ${JSON.stringify(partialLinkage)}`,
    );
  }
  const missingSetup = await run(
    process.execPath,
    [
      new URL("./choreography.mjs", import.meta.url).pathname,
      "m1",
      "--suite-status",
      suiteStatus,
      "--receipts",
      refusedReceipts,
    ],
    {
      cwd: new URL(".", import.meta.url).pathname,
      env: runEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (
    missingSetup.status !== 2
    || !missingSetup.stderr.startsWith('CHOREOGRAPHY OUTCOME {"schemaVersion":"social-messenger.choreography-outcome.v1","outcomeClass":"setup"')
    || !missingSetup.stderr.includes("setup-identity startup refusal")
    || existsSync(refusedReceipts)
  ) {
    throw new Error(`missing setup identity did not refuse before receipt startup: ${JSON.stringify(missingSetup)}`);
  }
  const danglingSuiteStatus = join(scratch, "dangling-suite-status.json");
  await writeFile(
    danglingSuiteStatus,
    `${JSON.stringify({ m1: { pass: true, receipt: "missing-suite-receipt.json" } })}\n`,
  );
  const danglingLinkage = await run(
    process.execPath,
    [
      new URL("./choreography.mjs", import.meta.url).pathname,
      "m1",
      "--suite-status",
      danglingSuiteStatus,
      "--receipts",
      refusedReceipts,
    ],
    {
      cwd: new URL(".", import.meta.url).pathname,
      env: runEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (
    danglingLinkage.status !== 2
    || !danglingLinkage.stderr.includes("suite-status startup refusal")
    || existsSync(refusedReceipts)
  ) {
    throw new Error(
      `dangling suite receipt did not refuse before receipt startup: ${JSON.stringify(danglingLinkage)}`,
    );
  }
  const result = await run(
    process.execPath,
    [
      new URL("./choreography.mjs", import.meta.url).pathname,
      "m1,m8",
      "--suite-status",
      suiteStatus,
      "--setup-identity",
      setupIdentity,
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
  const m7Result = await run(
    process.execPath,
    [
      new URL("./choreography.mjs", import.meta.url).pathname,
      "m7",
      "--suite-status",
      suiteStatus,
      "--setup-identity",
      setupIdentity,
      "--receipts",
      m7Receipts,
      "--timeout",
      "5000",
    ],
    {
      cwd: new URL(".", import.meta.url).pathname,
      env: runEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (m7Result.status !== 0) {
    throw new Error(
      `M7 idempotent-vote calibration failed (${m7Result.status ?? m7Result.signal})\n${m7Result.stdout}\n${m7Result.stderr}`,
    );
  }
  const records = (await Promise.all([receipts, m7Receipts].map(async (path) =>
    (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  ))).flat();
  const observationRecords = (await Promise.all(
    [receipts, m7Receipts].map(async (path) => parseObservationJsonLines(
      await readFile(`${path}.observations.jsonl`, "utf8"),
      "choreography self-test observations",
    )),
  )).flat();
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
  const contractSource = await readFile(
    new URL("../CONTRACT.md", import.meta.url),
    "utf8",
  );
  const contractIds = new Set(contractSource.match(/\bsm-[a-z0-9-]+\b/gu) ?? []);
  const sourceIds = new Set(
    [...choreographySource.matchAll(/["'`](sm-[a-z0-9-]+)["'`]/gu)]
      .map((match) => match[1]),
  );
  const unregisteredIds = [...sourceIds].filter((id) => !contractIds.has(id));
  if (unregisteredIds.length > 0) {
    throw new Error(
      `choreography uses test IDs absent from CONTRACT.md: ${unregisteredIds.join(", ")}`,
    );
  }
  if (choreographySource.includes("emitUnimplemented(")) {
    throw new Error("observability bump retained an unimplemented-emission path");
  }
  if (/new RegExp|filter\(\{\s*hasText:\s*\//u.test(choreographySource)) {
    throw new Error("choreography retained a broad regex selector where structural identity is required");
  }
  if (
    !choreographySource.includes('const CONTINUOUS_SEGMENTS = ["m1", "m2", "m3", "m4", "m5", "m6", "m8"]')
    || !choreographySource.includes('const SEGMENTS = [...CONTINUOUS_SEGMENTS, "m7"]')
    || !choreographySource.includes("m7 is a fresh-session segment")
  ) {
    throw new Error("M7 fresh-session isolation is not explicit in the runner");
  }
  if (
    !choreographySource.includes('"dm-live-messages"')
    || !choreographySource.includes('"sender-avatar-identity-when-rendered"')
    || !choreographySource.includes("implemented: avatarRendered")
  ) {
    throw new Error("required live DM delivery and conditional avatar identity were merged again");
  }

  const skippedSample = {
    version: "0.3.3-m8",
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
  const currentTypingReceipt = {
    version: "0.3.8-m8",
    runId: "00000000-0000-4000-8000-000000000010",
    recordedAt: "2026-08-25T00:00:00.000Z",
    type: "assertion",
    segment: "m3",
    assertion: "typing-indicator-within-2s-expires-within-5s",
    implemented: true,
    required: true,
    status: "passed",
    pass: true,
    timings: [1, 2, 3].map((attempt) => ({
      attempt,
      pass: true,
      startedAt: "2026-08-25T00:00:00.000Z",
      durationMs: 1,
      settlementWaitMs: 1,
      metrics: {
        visibleAfterLastKeystrokeMs: 1,
        expiresAfterLastKeystrokeMs: 1,
      },
    })),
    bestOf: 3,
    details: {
      selection: "fastest passing attempt; all three retained",
      selectedAttempt: 1,
      reason: null,
      typingObservationBoundaryVersion: "v2",
    },
    typingObservationBoundaryVersion: "v2",
  };
  if (!validate(currentTypingReceipt)) {
    throw new Error(`current v2 typing receipt was rejected: ${JSON.stringify(validate.errors)}`);
  }
  const missingTypingBoundary = structuredClone(currentTypingReceipt);
  delete missingTypingBoundary.typingObservationBoundaryVersion;
  delete missingTypingBoundary.details.typingObservationBoundaryVersion;
  if (validate(missingTypingBoundary)) {
    throw new Error("current typing receipt omitted its observation-boundary version");
  }
  const mismatchedTypingBoundary = structuredClone(currentTypingReceipt);
  mismatchedTypingBoundary.details.typingObservationBoundaryVersion = "v1";
  if (validate(mismatchedTypingBoundary)) {
    throw new Error("current typing receipt accepted mismatched assertion metadata");
  }
  const retainedV1TypingReceipt = structuredClone(missingTypingBoundary);
  retainedV1TypingReceipt.version = "0.3.3-m8";
  if (!validate(retainedV1TypingReceipt)) {
    throw new Error(`retained implicit-v1 typing receipt was rejected: ${JSON.stringify(validate.errors)}`);
  }
  retainedV1TypingReceipt.typingObservationBoundaryVersion = "v2";
  if (validate(retainedV1TypingReceipt)) {
    throw new Error("retained pre-bump typing receipt accepted a v2 boundary stamp");
  }
  const legacySummaryWithoutCause = {
    version: "0.3.3-m8",
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
        settlementWaitMs: 0,
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
    suite: {
      pass: true,
      receipt: "acceptance/m1.json",
      receiptSha256: `sha256:${"1".repeat(64)}`,
    },
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
        settlementWaitMs: 0,
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
    suite: {
      pass: true,
      receipt: "acceptance/m1.json",
      receiptSha256: `sha256:${"1".repeat(64)}`,
    },
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
  const m7Summary = records.find(
    (record) => record.type === "segment-summary" && record.segment === "m7",
  );
  if (
    !m1Summary?.green ||
    m1Summary.status !== "passed" ||
    m1Summary.assertions.failed !== 0 ||
    m1Summary.assertions.requiredUnimplemented !== 0 ||
    m1Summary.nonGreenCause !== null ||
    !m7Summary?.green ||
    m7Summary.assertions.total !== 2 ||
    m7Summary.assertions.failed !== 0 ||
    !m8Summary?.green ||
    m8Summary.status !== "passed" ||
    m8Summary.assertions.total !== 5 ||
    m8Summary.assertions.failed !== 0 ||
    m8Summary.assertions.requiredUnimplemented !== 0 ||
    m8Summary.nonGreenCause !== null
  ) {
    throw new Error(
      `self-test did not produce honest M1/M7/M8 green: ${JSON.stringify({ m1Summary, m7Summary, m8Summary })}`,
    );
  }
  if (
    pollVotes.get("alice") !== "m7-option-b"
    || pollVotes.get("bob") !== "m7-option-b"
    || pollVotes.size !== 2
  ) {
    throw new Error(`M7 calibration did not preserve idempotent one-vote-per-user state: ${JSON.stringify([...pollVotes])}`);
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
  const m1SuiteDigest = `sha256:${createHash("sha256")
    .update(await readFile(m1SuiteReceipt))
    .digest("hex")}`;
  if (
    m1Summary.suite.pass !== true
    || m1Summary.suite.receiptSha256 !== m1SuiteDigest
    || records.some((record) => record.type === "segment-summary" && record.suite?.pass === null)
  ) {
    throw new Error(`suite receipt digest was not bound at refusal time: ${JSON.stringify(m1Summary.suite)}`);
  }
  for (const milestone of ["M1", "M7", "M8"]) {
    const events = observationRecords.filter((event) => event.milestone === milestone);
    if (
      !events.some((event) => (
        event.type === "block-claim"
        && event.block === "browserAssertionWait"
        && event.owner === "choreography"
        && event.claimed === true
      ))
      || !events.some((event) => event.type === "assertion-wait")
    ) {
      throw new Error(`${milestone} did not retain claimed typed assertion-wait observations`);
    }
    const waits = events.filter((event) => event.type === "assertion-wait");
    const assertionReceipts = records.filter(
      (record) => record.type === "assertion" && record.segment.toUpperCase() === milestone,
    );
    if (
      waits.some((event) => event.owner !== "choreography")
      || assertionReceipts.some((record) => record.timings.some(
        (timing) => timing.settlementWaitMs > timing.durationMs,
      ))
      || waits.reduce((sum, event) => sum + event.durationMs, 0)
        !== assertionReceipts.reduce(
          (sum, record) => sum + record.timings.reduce(
            (attemptSum, timing) => attemptSum + timing.settlementWaitMs,
            0,
          ),
          0,
        )
    ) {
      throw new Error(`${milestone} assertion waits are not exact settlement projections`);
    }
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
      "--setup-identity",
      setupIdentity,
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
  const missLines = failingResult.stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("STRUCTURED CHOREOGRAPHY MISS "));
  if (
    missLines.length !== 1
    || missLines[0].length > 1_200
    || failingResult.stdout.includes("STRUCTURED RECEIPT ")
    || !missLines[0].includes('"outcomeClass":"application"')
  ) {
    throw new Error(`deliberate failure did not emit one bounded classified miss: ${failingResult.stdout}`);
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
    `social-messenger choreography self-test: PASS (${records.filter((record) => record.type === "assertion").length} assertions, suite/setup startup refusals, m1+m7+m8 green with idempotent retained vote state; DM/avatar split guarded; one compact deliberate-failure miss)\n`,
  );
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
  await rm(scratch, { recursive: true, force: true });
}
