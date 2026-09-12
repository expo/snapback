#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const REQUIRE = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = REQUIRE("playwright/package.json").version;
const CHOREOGRAPHY = new URL("./choreography.mjs", import.meta.url).pathname;
const RECEIPT_SCHEMA = JSON.parse(
  readFileSync(new URL("./receipts.schema.json", import.meta.url), "utf8"),
);
const VALIDATE_RECEIPT = new Ajv2020({
  allErrors: true,
  strict: false,
  formats: { "date-time": true, uuid: true },
}).compile(RECEIPT_SCHEMA);

// @ref LLP 0281#w9-coterie-owed-real-host-proofs — this fixture proves the
// instrument mechanics only; the real Coterie browser/native legs are separate.
const CONTROL_SCHEMA = "social-messenger.control-lane.v1";
const OUTCOME_CASES = [
  { id: "green", milestoneStatus: "green", suitePass: true, outcomeClass: null },
  { id: "failure", milestoneStatus: "failure", suitePass: true, outcomeClass: "application", failPoll: true },
  { id: "capability-failure", milestoneStatus: "capability-failure", suitePass: false, outcomeClass: "platform" },
  {
    id: "aborted",
    milestoneStatus: "aborted",
    suitePass: false,
    outcomeClass: "instrument",
    failPoll: true,
    competingAssertionOutcomeClass: "application",
  },
];

function usage() {
  return `Usage: node control-lane.mjs --browser <chromium|firefox> --out <directory> [--timeout <ms>]

Runs the clean M2+M3 journey, fresh M7, a deterministic timing retry, and the
green/failure/capability-failure/aborted forced-outcome matrix. Artifacts are
retained under --out.`;
}

function parseArgs(argv) {
  const options = { browser: "chromium", out: null, timeoutMs: 3_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--browser") options.browser = argv[++index];
    else if (arg === "--out") options.out = argv[++index];
    else if (arg === "--timeout") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--help") return { help: true };
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!new Set(["chromium", "firefox"]).has(options.browser)) {
    throw new Error("--browser must be chromium or firefox");
  }
  if (typeof options.out !== "string" || options.out.length === 0) {
    throw new Error("--out is required so proof receipts are retained");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000) {
    throw new Error("--timeout must be an integer >= 1000");
  }
  return options;
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function requestBody(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return JSON.parse(text || "{}");
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

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

function createFixtureState() {
  return {
    knobs: { failPoll: false, timingRetry: true },
    posts: [
      {
        id: "seed-post",
        author: "alice",
        authorName: "Alice Adams",
        text: "Control lane seed post",
        mediaKind: null,
        mediaUrl: null,
        parentId: null,
      },
    ],
    likes: new Map(),
    follows: new Set(),
    reposts: new Set(),
    messages: [],
    messageOrder: 0,
    groupMembers: new Map([["alice", "admin"], ["bob", "member"], ["carol", "member"]]),
    groupHistoryCutoff: new Map(),
    pollVotes: new Map(),
    typingSequence: 0,
    typingLastAt: 0,
    typing: { actor: null, showAt: 0, expiresAt: 0 },
  };
}

let fixture = createFixtureState();

function resetFixture(knobs = {}) {
  fixture = createFixtureState();
  fixture.knobs = { ...fixture.knobs, ...knobs };
}

function receiptState(message) {
  if (message.kind === "group") {
    const recipients = [...fixture.groupMembers.keys()].filter((actor) => actor !== message.sender);
    return recipients.every((actor) => message.readBy.has(actor)) ? "read" : "delivered";
  }
  return message.readBy.has(message.recipient)
    ? "read"
    : message.delivered
      ? "delivered"
      : "sent";
}

function visibleMessages(kind, viewer, other = null) {
  return fixture.messages
    .filter((message) => {
      if (message.kind !== kind) return false;
      if (kind === "dm") {
        return new Set([message.sender, message.recipient]).has(viewer)
          && new Set([message.sender, message.recipient]).has(other);
      }
      const cutoff = fixture.groupHistoryCutoff.get(viewer);
      return fixture.groupMembers.has(viewer) || (cutoff !== undefined && message.order <= cutoff);
    })
    .map((message) => ({ ...message, state: receiptState(message), readBy: undefined }));
}

function markDelivered(actor) {
  for (const message of fixture.messages) {
    if (message.kind === "dm" && message.recipient === actor) message.delivered = true;
  }
}

const appHtml = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><title>0.3.7-m8 control lane</title></head>
<body><main id="app"></main><script>
const root = document.querySelector('#app');
let timer = null;
let draftMedia = null;
let quoteId = null;
const tid = (value) => 'data-testid="' + value + '"';
const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function persona() { return localStorage.getItem('persona'); }
function stop() { if (timer) clearInterval(timer); timer = null; }
function go(path) { history.pushState({}, '', path); render(); }
async function api(path, options) { const response = await fetch(path, options); return response.json(); }
function auth() {
  stop();
  root.innerHTML = '<input ' + tid('sm-auth-email') + '><input type="password" ' + tid('sm-auth-password') +
    '><button ' + tid('sm-auth-submit') + '>Sign in</button>';
  root.querySelector('[data-testid=sm-auth-submit]').onclick = () => {
    localStorage.setItem('persona', root.querySelector('[data-testid=sm-auth-email]').value.split('@')[0]);
    go('/');
  };
}
function shell() {
  stop();
  const other = persona() === 'alice' ? 'bob' : 'alice';
  root.innerHTML = '<button ' + tid('sm-feed-tab-following') + '>Following</button>' +
    '<button ' + tid('sm-feed-tab-global') + '>Global</button>' +
    '<button ' + tid('sm-chats-item') + ' aria-valuetext="dm:' + other + '">DM</button>' +
    '<button ' + tid('sm-chats-item') + ' aria-valuetext="group:weekend-plans">Group</button>';
  root.querySelector('[data-testid=sm-feed-tab-following]').onclick = () => go('/following');
  root.querySelector('[data-testid=sm-feed-tab-global]').onclick = () => go('/global');
  api('/api/home?persona=' + persona()).catch(() => {});
  timer = setInterval(() => api('/api/home?persona=' + persona()).catch(() => {}), 40);
}
function composer(parentId = '') {
  return '<input ' + tid('sm-compose-input') + '><input type="file" ' + tid('sm-compose-file') + '>' +
    '<button ' + tid('sm-compose-attach') + '>Attach</button><section id="attachment"></section>' +
    '<button ' + tid('sm-compose-submit') + ' data-parent="' + esc(parentId) + '">Post</button>';
}
function feedCard(post) {
  const media = post.mediaKind ? '<section ' + tid('sm-feed-media') + ' aria-valuetext="' + post.mediaKind + '">' +
    (post.mediaKind === 'image' ? '<img src="/pixel.svg">' : '<video muted src="/blank.mp4"></video>') + '</section>' : '';
  const attribution = post.repostedBy ? '<span ' + tid('sm-feed-repost-attribution') + ' aria-valuetext="' + post.repostedBy + '">reposted</span>' : '';
  return '<article ' + tid('sm-feed-item') + ' data-post-id="' + post.id + '">' + attribution +
    '<span ' + tid('sm-feed-author-avatar') + ' aria-valuetext="' + post.author + '"></span>' +
    '<strong>' + esc(post.authorName) + '</strong><p>' + esc(post.text) + '</p>' + media +
    '<button ' + tid('sm-post-like') + ' aria-valuetext="' + post.likeCount + '">Like ' + post.likeCount + '</button>' +
    '<button ' + tid('sm-post-repost') + '>Repost</button>' +
    '<button ' + tid('sm-post-reply') + ' aria-valuetext="' + post.replyCount + '">Reply ' + post.replyCount + '</button></article>';
}
async function feed(kind, parentId = '') {
  stop();
  root.innerHTML = '<button ' + tid('sm-feed-tab-following') + '>Following</button><button ' +
    tid('sm-feed-tab-global') + '>Global</button>' + composer(parentId) + '<section id="feed"></section>';
  root.querySelector('[data-testid=sm-feed-tab-following]').onclick = () => go('/following');
  root.querySelector('[data-testid=sm-feed-tab-global]').onclick = () => go('/global');
  const file = root.querySelector('[data-testid=sm-compose-file]');
  file.onchange = () => {
    const selected = file.files[0];
    if (!selected) return;
    const mediaKind = selected.type.startsWith('video/') ? 'video' : 'image';
    draftMedia = { kind: mediaKind };
    root.querySelector('#attachment').innerHTML = '<section ' + tid('sm-compose-attachment') +
      ' aria-valuetext="' + mediaKind + '"><span ' + tid('sm-compose-attachment-media') + '><img src="/pixel.svg"></span></section>';
  };
  root.querySelector('[data-testid=sm-compose-submit]').onclick = async () => {
    const input = root.querySelector('[data-testid=sm-compose-input]');
    await api('/api/posts', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({
      actor: persona(), text: input.value, mediaKind: draftMedia?.kind ?? null, parentId: parentId || null,
    })});
    input.value = ''; draftMedia = null; await update();
  };
  const update = async () => {
    const values = await api('/api/posts?viewer=' + persona() + '&feed=' + kind + '&parent=' + encodeURIComponent(parentId));
    const target = root.querySelector('#feed'); if (!target) return;
    target.innerHTML = values.map(feedCard).join('');
    for (const card of target.querySelectorAll('[data-testid=sm-feed-item]')) {
      const id = card.dataset.postId;
      card.querySelector('[data-testid=sm-post-like]').onclick = async () => { await api('/api/like', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({actor:persona(), postId:id}) }); await update(); };
      card.querySelector('[data-testid=sm-post-repost]').onclick = async () => { await api('/api/repost', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({actor:persona(), postId:id}) }); await update(); };
      card.querySelector('[data-testid=sm-post-reply]').onclick = () => go('/thread/' + id);
    }
  };
  await update(); timer = setInterval(update, 35);
}
async function profile(handle) {
  stop();
  root.innerHTML = '<button ' + tid('sm-feed-tab-following') + '>Following</button><button ' +
    tid('sm-feed-tab-global') + '>Global</button><section ' + tid('sm-profile') + '><h1 ' + tid('sm-profile-heading') + '>' +
    (handle === 'alice' ? 'Alice Adams' : handle) + '</h1><button ' + tid('sm-profile-follow') +
    '>Follow</button><button ' + tid('sm-profile-nav-feed') + '>Feed</button></section>';
  root.querySelector('[data-testid=sm-feed-tab-following]').onclick = () => go('/following');
  root.querySelector('[data-testid=sm-feed-tab-global]').onclick = () => go('/global');
  root.querySelector('[data-testid=sm-profile-follow]').onclick = async () => { await api('/api/follow', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({actor:persona(), target:handle}) }); };
  root.querySelector('[data-testid=sm-profile-nav-feed]').onclick = () => go('/');
}
function bubble(message) {
  const quoted = message.quoteText ? '<button ' + tid('sm-convo-quote-preview') + '>' + esc(message.quoteText) + '</button>' : '';
  return '<article ' + tid('sm-convo-bubble') + ' data-message-id="' + message.id + '">' +
    '<span ' + tid('sm-convo-sender-avatar') + ' aria-valuetext="' + message.sender + '"></span>' +
    '<span>' + esc(message.sender) + ': ' + esc(message.text) + '</span>' + quoted +
    '<span ' + tid('sm-convo-receipt') + ' aria-valuetext="' + message.state + '">' + message.state + '</span>' +
    '<button ' + tid('sm-convo-quote') + '>Reply</button></article>';
}
async function conversation(kind, other = '') {
  stop(); quoteId = null;
  root.innerHTML = '<section id="typing"></section><section id="messages"></section>' +
    (kind === 'group' ? '<section id="poll"></section><span ' + tid('sm-poll-total') + ' aria-valuetext="0">0</span>' : '') +
    '<input ' + tid('sm-convo-input') + '><button ' + tid('sm-convo-send') + '>Send</button>';
  const input = root.querySelector('[data-testid=sm-convo-input]');
  if (kind === 'dm') input.onkeydown = () => api('/api/typing', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({actor:persona()}) }).catch(() => {});
  root.querySelector('[data-testid=sm-convo-send]').onclick = async () => {
    if (!input.value) return;
    await api('/api/messages', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({kind, sender:persona(), recipient:other || null, text:input.value, quoteId}) });
    input.value = ''; quoteId = null; await update();
  };
  const updatePoll = async () => {
    if (kind !== 'group') return;
    const value = await api('/api/poll?actor=' + persona());
    const target = root.querySelector('#poll'); if (!target) return;
    target.innerHTML = value.options.map((option) => '<button ' + tid('sm-poll-option') +
      ' aria-valuetext="' + option.id + '" aria-selected="' + option.selected + '" aria-busy="false" data-pending="false">' +
      option.id + ' <span ' + tid('sm-poll-tally') + ' aria-valuetext="' + option.tally + '">' + option.tally + '</span></button>').join('');
    root.querySelector('[data-testid=sm-poll-total]').setAttribute('aria-valuetext', String(value.total));
    for (const option of target.querySelectorAll('[data-testid=sm-poll-option]')) option.onclick = async () => {
      const id = option.getAttribute('aria-valuetext');
      try { await api('/api/poll', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({actor:persona(), optionId:id}) }); }
      catch { localStorage.setItem('pending-vote-' + persona(), id); option.setAttribute('aria-busy','true'); option.setAttribute('data-pending','true'); }
    };
    const pending = localStorage.getItem('pending-vote-' + persona());
    if (pending) {
      try { await api('/api/poll', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({actor:persona(), optionId:pending}) }); localStorage.removeItem('pending-vote-' + persona()); }
      catch {}
    }
  };
  const update = async () => {
    const values = await api('/api/messages?kind=' + kind + '&viewer=' + persona() + '&other=' + other);
    const target = root.querySelector('#messages'); if (!target) return;
    target.innerHTML = values.map(bubble).join('');
    for (const node of target.querySelectorAll('[data-testid=sm-convo-bubble]')) {
      node.querySelector('[data-testid=sm-convo-quote]').onclick = () => { quoteId = node.dataset.messageId; };
      const preview = node.querySelector('[data-testid=sm-convo-quote-preview]');
      if (preview) preview.onclick = () => node.scrollIntoView();
    }
    if (kind === 'dm') {
      const typing = await api('/api/typing?viewer=' + persona());
      root.querySelector('#typing').innerHTML = typing.visible ? '<span ' + tid('sm-convo-typing') + '>typing</span>' : '';
    }
    await updatePoll();
  };
  await update(); timer = setInterval(update, 35);
}
async function groupSettings() {
  stop(); let adding = false;
  root.innerHTML = '<section id="members"></section><button ' + tid('sm-chatsettings-member-add') + '>Add</button>' +
    '<section id="candidate"></section><button ' + tid('sm-chatsettings-leave') + '>Leave</button>';
  root.querySelector('[data-testid=sm-chatsettings-member-add]').onclick = () => { adding = true; update(); };
  root.querySelector('[data-testid=sm-chatsettings-leave]').onclick = async () => { await memberAction('leave', persona()); await update(); };
  async function memberAction(action, handle) { return api('/api/group/member', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({action, handle}) }); }
  const update = async () => {
    const value = await api('/api/group/members');
    const members = root.querySelector('#members'); if (!members) return;
    members.innerHTML = value.members.map((member) => '<section ' + tid('sm-chatsettings-member') + ' aria-valuetext="' + member.handle + ':' + member.role + '" data-handle="' + member.handle + '">' +
      member.handle + '<button ' + tid('sm-chatsettings-member-promote') + '>Promote</button><button ' + tid('sm-chatsettings-member-remove') + '>Remove</button></section>').join('');
    for (const row of members.querySelectorAll('[data-testid=sm-chatsettings-member]')) {
      row.querySelector('[data-testid=sm-chatsettings-member-promote]').onclick = async () => { await memberAction('promote', row.dataset.handle); await update(); };
      row.querySelector('[data-testid=sm-chatsettings-member-remove]').onclick = async () => { await memberAction('remove', row.dataset.handle); await update(); };
    }
    const candidate = root.querySelector('#candidate');
    candidate.innerHTML = adding && !value.members.some((member) => member.handle === 'dave')
      ? '<button ' + tid('sm-chatsettings-member-candidate') + ' aria-valuetext="dave">Dave</button>' : '';
    const button = candidate.querySelector('button'); if (button) button.onclick = async () => { await memberAction('add','dave'); adding = false; await update(); };
  };
  await update(); timer = setInterval(update, 35);
}
function render() {
  if (!persona()) return auth();
  const path = decodeURIComponent(location.pathname);
  if (path === '/global') return feed('global');
  if (path === '/following') return feed('following');
  if (path.startsWith('/thread/')) return feed('thread', path.slice('/thread/'.length));
  if (path.startsWith('/profile/')) return profile(path.slice('/profile/'.length));
  if (path.endsWith('/settings') && path.startsWith('/conversation/group/')) return groupSettings();
  if (path.startsWith('/conversation/group/')) return conversation('group');
  if (path.startsWith('/conversation/')) return conversation('dm', path.slice('/conversation/'.length));
  return shell();
}
addEventListener('popstate', render); render();
</script></body></html>`;

function createFixtureServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/pixel.svg") {
      response.writeHead(200, { "content-type": "image/svg+xml" });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#5784ff"/></svg>');
      return;
    }
    if (url.pathname === "/blank.mp4") {
      response.writeHead(204, { "content-type": "video/mp4" });
      response.end();
      return;
    }
    if (url.pathname === "/api/home") {
      markDelivered(url.searchParams.get("persona"));
      return json(response, 200, { ok: true });
    }
    if (url.pathname === "/api/posts" && request.method === "POST") {
      const value = await requestBody(request);
      fixture.posts.push({
        id: `post-${fixture.posts.length + 1}`,
        author: value.actor,
        authorName: value.actor === "alice" ? "Alice Adams" : "Bob Brown",
        text: value.text,
        mediaKind: value.mediaKind,
        mediaUrl: value.mediaKind ? "/pixel.svg" : null,
        parentId: value.parentId,
      });
      return json(response, 200, { accepted: true });
    }
    if (url.pathname === "/api/posts") {
      const viewer = url.searchParams.get("viewer");
      const feed = url.searchParams.get("feed");
      const parent = url.searchParams.get("parent");
      let values;
      if (feed === "thread") {
        const rootPost = fixture.posts.find((post) => post.id === parent);
        values = [rootPost, ...fixture.posts.filter((post) => post.parentId === parent)].filter(Boolean);
      } else {
        const roots = fixture.posts.filter((post) => post.parentId === null);
        const projected = feed === "following"
          ? roots.filter((post) => post.author === viewer || fixture.follows.has(`${viewer}->${post.author}`))
          : roots;
        const reposted = roots
          .filter((post) => fixture.reposts.has(`${viewer}:${post.id}`))
          .map((post) => ({ ...post, id: `${post.id}:repost:${viewer}`, sourceId: post.id, repostedBy: viewer }));
        values = [...projected, ...reposted];
        if (feed === "global") {
          for (const key of fixture.reposts) {
            const [actor, postId] = key.split(":");
            if (actor === viewer) continue;
            const post = roots.find((candidate) => candidate.id === postId);
            if (post) values.push({ ...post, id: `${post.id}:repost:${actor}`, sourceId: post.id, repostedBy: actor });
          }
        }
      }
      return json(response, 200, values.map((post) => {
        const sourceId = post.sourceId ?? post.id;
        return {
          ...post,
          likeCount: fixture.likes.get(sourceId)?.size ?? 0,
          replyCount: fixture.posts.filter((candidate) => candidate.parentId === sourceId).length,
        };
      }));
    }
    if (url.pathname === "/api/like" && request.method === "POST") {
      const value = await requestBody(request);
      const postId = value.postId.split(":repost:")[0];
      const actors = fixture.likes.get(postId) ?? new Set();
      if (actors.has(value.actor)) actors.delete(value.actor); else actors.add(value.actor);
      fixture.likes.set(postId, actors);
      return json(response, 200, { accepted: true });
    }
    if (url.pathname === "/api/repost" && request.method === "POST") {
      const value = await requestBody(request);
      const postId = value.postId.split(":repost:")[0];
      const key = `${value.actor}:${postId}`;
      if (fixture.reposts.has(key)) fixture.reposts.delete(key); else fixture.reposts.add(key);
      return json(response, 200, { accepted: true });
    }
    if (url.pathname === "/api/follow" && request.method === "POST") {
      const value = await requestBody(request);
      const key = `${value.actor}->${value.target}`;
      if (fixture.follows.has(key)) fixture.follows.delete(key); else fixture.follows.add(key);
      return json(response, 200, { accepted: true });
    }
    if (url.pathname === "/api/messages" && request.method === "POST") {
      const value = await requestBody(request);
      const source = fixture.messages.find((message) => message.id === value.quoteId);
      fixture.messages.push({
        id: `message-${++fixture.messageOrder}`,
        order: fixture.messageOrder,
        kind: value.kind,
        sender: value.sender,
        recipient: value.recipient,
        text: value.text,
        quoteId: value.quoteId ?? null,
        quoteText: source?.text ?? null,
        delivered: value.kind === "group" || !value.text.includes("-m3-receipt"),
        readBy: new Set(),
      });
      return json(response, 200, { accepted: true });
    }
    if (url.pathname === "/api/messages") {
      const kind = url.searchParams.get("kind");
      const viewer = url.searchParams.get("viewer");
      const other = url.searchParams.get("other");
      markDelivered(viewer);
      for (const message of fixture.messages) {
        if (message.sender !== viewer && (
          (kind === "group" && message.kind === "group")
          || (kind === "dm" && message.kind === "dm" && message.recipient === viewer)
        )) message.readBy.add(viewer);
      }
      return json(response, 200, visibleMessages(kind, viewer, other));
    }
    if (url.pathname === "/api/typing" && request.method === "POST") {
      const value = await requestBody(request);
      const now = Date.now();
      if (now - fixture.typingLastAt > 1_000) fixture.typingSequence += 1;
      fixture.typingLastAt = now;
      const delayed = fixture.knobs.timingRetry && fixture.typingSequence === 1;
      fixture.typing = {
        actor: value.actor,
        showAt: delayed ? now + 2_300 : now,
        expiresAt: delayed ? now + 2_900 : now + 600,
      };
      return json(response, 200, { accepted: true });
    }
    if (url.pathname === "/api/typing") {
      const now = Date.now();
      const viewer = url.searchParams.get("viewer");
      return json(response, 200, {
        visible: fixture.typing.actor !== viewer
          && now >= fixture.typing.showAt
          && now < fixture.typing.expiresAt,
      });
    }
    if (url.pathname === "/api/group/members") {
      return json(response, 200, { members: [...fixture.groupMembers].map(([handle, role]) => ({ handle, role })) });
    }
    if (url.pathname === "/api/group/member" && request.method === "POST") {
      const value = await requestBody(request);
      if (value.action === "add") { fixture.groupMembers.set(value.handle, "member"); fixture.groupHistoryCutoff.delete(value.handle); }
      if (value.action === "promote") fixture.groupMembers.set(value.handle, "admin");
      if (value.action === "remove" || value.action === "leave") {
        fixture.groupMembers.delete(value.handle);
        fixture.groupHistoryCutoff.set(value.handle, fixture.messageOrder);
      }
      return json(response, 200, { accepted: true });
    }
    if (url.pathname === "/api/poll" && request.method === "POST") {
      const value = await requestBody(request);
      if (!fixture.knobs.failPoll) fixture.pollVotes.set(value.actor, value.optionId);
      return json(response, 200, { accepted: true });
    }
    if (url.pathname === "/api/poll") {
      const actor = url.searchParams.get("actor");
      const options = ["m7-option-a", "m7-option-b"].map((id) => ({
        id,
        tally: [...fixture.pollVotes.values()].filter((value) => value === id).length,
        selected: fixture.pollVotes.get(actor) === id,
      }));
      return json(response, 200, { options, total: fixture.pollVotes.size });
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(appHtml);
  });
}

async function writeSetupIdentity(path, browser) {
  await writeFile(path, `${JSON.stringify({
    schemaVersion: "social-messenger.setup-identity.v1",
    instrumentPin: "social-messenger@0.3.7-m8",
    backend: { kind: "external", version: "control-fixture.v1" },
    runtime: {
      qualifiedBinary: { claimed: false, reason: "in-process HTTP control fixture" },
      wrapper: { claimed: false, reason: "control runner launches the fixture directly" },
    },
    packageClosure: {
      mode: "workspace",
      prepack: "not-applicable",
      artifacts: [{ name: "social-messenger-control-fixture", version: "0.3.7-m8", sha256: null }],
    },
    toolchain: {
      node: { path: process.execPath, version: process.version },
      bun: "not-used",
      npm: "not-used",
      playwright: PLAYWRIGHT_VERSION,
      browser,
    },
    host: { id: "control-lane", platform: process.platform, arch: process.arch },
  }, null, 2)}\n`);
}

async function writeSuiteStatus(directory, segments, { pass, outcomeClass }) {
  const status = {};
  for (const segment of segments) {
    const receiptName = `${segment}-suite.json`;
    if (pass) {
      await writeFile(resolve(directory, receiptName), `${JSON.stringify({
        kind: "control-lane-suite",
        segment,
        pass: true,
      })}\n`);
      status[segment] = { pass: true, receipt: receiptName };
    } else {
      status[segment] = { pass: false, receipt: null, outcomeClass };
    }
  }
  const path = resolve(directory, "suite-status.json");
  await writeFile(path, `${JSON.stringify(status, null, 2)}\n`);
  return path;
}

async function readReceipts(path) {
  const records = (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  for (const record of records) {
    assert.equal(VALIDATE_RECEIPT(record), true, JSON.stringify(VALIDATE_RECEIPT.errors));
    assert.equal(Number.isNaN(Date.parse(record.recordedAt)), false, "receipt recordedAt must parse");
  }
  return records;
}

async function runChoreography({ baseUrl, browser, directory, segments, timeoutMs, suite, laneId }) {
  await mkdir(directory, { recursive: true });
  const setupIdentity = resolve(directory, "setup-identity.json");
  const receipts = resolve(directory, "receipts.jsonl");
  await writeSetupIdentity(setupIdentity, browser);
  const suiteStatus = await writeSuiteStatus(directory, segments.split(","), suite);
  const result = await run(process.execPath, [
    CHOREOGRAPHY,
    segments,
    "--browser", browser,
    "--suite-status", suiteStatus,
    "--setup-identity", setupIdentity,
    "--receipts", receipts,
    "--timeout", String(timeoutMs),
  ], {
    cwd: new URL(".", import.meta.url).pathname,
    env: {
      ...process.env,
      CHOREO_BASE_URL: baseUrl,
      CHOREO_PASSWORD: "control-password",
      CHOREO_LANE_RUN_ID: laneId,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!existsSync(receipts)) {
    throw new Error(
      `choreography stopped before receipt startup (${result.status ?? result.signal})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return { result, receipts, records: await readReceipts(receipts) };
}

function segmentSummary(records, segment) {
  const summaries = records.filter((record) => record.type === "segment-summary" && record.segment === segment);
  assert.equal(summaries.length, 1, `expected exactly one ${segment} summary`);
  return summaries[0];
}

function assertedBoundary(records, summary) {
  const assertions = records.filter((record) => record.type === "assertion");
  assert.ok(assertions.length > 0, "run must emit assertion receipts");
  const firstStartedAt = assertions.flatMap((record) => record.timings)
    .map((timing) => timing.startedAt)
    .filter(Boolean)
    .sort()[0];
  assert.ok(firstStartedAt, "run must stamp its first attempt boundary");
  assert.ok(Date.parse(summary.recordedAt) >= Date.parse(firstStartedAt), "summary must follow attempt boundary");
  return { firstAttemptAt: firstStartedAt, terminalReceiptAt: summary.recordedAt };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(`${usage()}\n`); return; }
  const out = resolve(options.out);
  await mkdir(out, { recursive: true });
  const server = createFixtureServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("control server has no TCP port");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const startedAt = new Date().toISOString();
  const receipt = {
    schemaVersion: CONTROL_SCHEMA,
    browser: options.browser,
    instrumentPin: "social-messenger@0.3.7-m8",
    startedAt,
    journeys: {},
    forcedOutcomes: [],
    evidenceScope: "instrument-fixture-only",
  };
  try {
    resetFixture({ timingRetry: true });
    const continuous = await runChoreography({
      baseUrl,
      browser: options.browser,
      directory: resolve(out, "green-m2-m3"),
      segments: "m2,m3",
      timeoutMs: options.timeoutMs,
      suite: { pass: true, outcomeClass: null },
      laneId: `control-${options.browser}-m2-m3`,
    });
    assert.equal(continuous.result.status, 0, `${continuous.result.stdout}\n${continuous.result.stderr}`);
    const m2 = segmentSummary(continuous.records, "m2");
    const m3 = segmentSummary(continuous.records, "m3");
    assert.equal(m2.green, true);
    assert.equal(m3.green, true);
    assert.equal(m2.outcomeClass, null);
    assert.equal(m3.outcomeClass, null);
    assert.equal(m3.typingObservationBoundaryVersion, "v2");
    const typing = continuous.records.find((record) => record.type === "assertion" && record.assertion === "typing-indicator-within-2s-expires-within-5s");
    assert.equal(typing?.typingObservationBoundaryVersion, "v2");
    assert.equal(typing?.timings[0]?.pass, false, "first timing attempt must fail deterministically");
    assert.ok(typing.timings.slice(1).some((timing) => timing.pass), "a retry must pass");
    receipt.journeys.m2m3 = {
      status: "green",
      receipts: "green-m2-m3/receipts.jsonl",
      receiptsSha256: sha256(await readFile(continuous.receipts)),
      m2Boundary: assertedBoundary(continuous.records.filter((record) => record.segment === "m2"), m2),
      m3Boundary: assertedBoundary(continuous.records.filter((record) => record.segment === "m3"), m3),
      typingObservationBoundaryVersion: "v2",
      timingRetry: { firstAttempt: "failed", recoveredAttempt: typing.timings.find((timing) => timing.pass).attempt },
    };

    resetFixture();
    const freshM7 = await runChoreography({
      baseUrl,
      browser: options.browser,
      directory: resolve(out, "green-m7"),
      segments: "m7",
      timeoutMs: options.timeoutMs,
      suite: { pass: true, outcomeClass: null },
      laneId: `control-${options.browser}-m7`,
    });
    assert.equal(freshM7.result.status, 0, `${freshM7.result.stdout}\n${freshM7.result.stderr}`);
    const m7 = segmentSummary(freshM7.records, "m7");
    assert.equal(m7.green, true);
    assert.equal(m7.outcomeClass, null);
    assert.deepEqual([...fixture.pollVotes].sort(), [["alice", "m7-option-b"], ["bob", "m7-option-b"]]);
    receipt.journeys.m7 = {
      status: "green",
      receipts: "green-m7/receipts.jsonl",
      receiptsSha256: sha256(await readFile(freshM7.receipts)),
      boundary: assertedBoundary(freshM7.records, m7),
      idempotentFinalVotes: Object.fromEntries(fixture.pollVotes),
      awaitedSwitch: true,
    };

    for (const outcome of OUTCOME_CASES) {
      if (outcome.id === "green") {
        receipt.forcedOutcomes.push({
          id: outcome.id,
          milestoneStatus: outcome.milestoneStatus,
          outcomeClass: m7.outcomeClass,
          source: "green-m7/receipts.jsonl",
          sourceSha256: sha256(await readFile(freshM7.receipts)),
          boundary: assertedBoundary(freshM7.records, m7),
        });
        continue;
      }
      resetFixture({ failPoll: outcome.failPoll === true, timingRetry: false });
      const directory = resolve(out, `forced-${outcome.id}`);
      const forced = await runChoreography({
        baseUrl,
        browser: options.browser,
        directory,
        segments: "m7",
        timeoutMs: options.timeoutMs,
        suite: { pass: outcome.suitePass, outcomeClass: outcome.suitePass ? null : outcome.outcomeClass },
        laneId: `control-${options.browser}-${outcome.id}`,
      });
      assert.equal(forced.result.status, 1, `${outcome.id}: ${forced.result.stdout}\n${forced.result.stderr}`);
      const summary = segmentSummary(forced.records, "m7");
      assert.equal(summary.green, false);
      assert.equal(summary.outcomeClass, outcome.outcomeClass);
      if (outcome.id === "failure") {
        assert.equal(summary.nonGreenCause, "choreography-failed");
        assert.ok(forced.records.some((record) => record.type === "assertion" && record.status === "failed" && record.outcomeClass === "application"));
      } else if (outcome.id === "capability-failure") {
        assert.equal(summary.nonGreenCause, "suite-failed");
        assert.equal(summary.suite.outcomeClass, outcome.outcomeClass);
      } else {
        assert.equal(summary.nonGreenCause, "choreography-failed");
        assert.equal(summary.suite.outcomeClass, outcome.outcomeClass);
        assert.ok(
          forced.records.some((record) => (
            record.type === "assertion"
            && record.status === "failed"
            && record.outcomeClass === outcome.competingAssertionOutcomeClass
          )),
          "aborted cell must include an application assertion failure so the classifier default differs",
        );
      }
      receipt.forcedOutcomes.push({
        id: outcome.id,
        milestoneStatus: outcome.milestoneStatus,
        outcomeClass: summary.outcomeClass,
        nonGreenCause: summary.nonGreenCause,
        source: `forced-${outcome.id}/receipts.jsonl`,
        sourceSha256: sha256(await readFile(forced.receipts)),
        boundary: assertedBoundary(forced.records, summary),
      });
    }
    assert.deepEqual(receipt.forcedOutcomes.map((entry) => entry.milestoneStatus), [
      "green", "failure", "capability-failure", "aborted",
    ]);
    receipt.completedAt = new Date().toISOString();
    receipt.pass = true;
    await writeFile(resolve(out, "control-lane-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    process.stdout.write(`CONTROL LANE PASS ${JSON.stringify({
      browser: options.browser,
      receipt: resolve(out, "control-lane-receipt.json"),
      outcomes: receipt.forcedOutcomes.map(({ milestoneStatus, outcomeClass }) => ({ milestoneStatus, outcomeClass })),
    })}\n`);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`CONTROL LANE FAIL ${error.stack ?? error.message}\n\n${usage()}\n`);
    process.exitCode = 1;
  });
}
