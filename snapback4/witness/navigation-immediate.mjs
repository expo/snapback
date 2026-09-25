// Run outside the sandbox: node witness/navigation-immediate.mjs
// Full same-origin document navigation, including the builder's remove click.
// Each case reports a JSON line even on failure, then the witness exits nonzero.
import assert from "node:assert/strict";
import { launch } from "./lib.mjs";

const cases = [
  { name: "awaited-pending-0ms", awaitWrite: true, offline: true, delay: 0, count: 1 },
  { name: "awaited-sent-5ms", awaitWrite: true, delay: 5, count: 1 },
  { name: "unawaited-0ms", delay: 0, count: 1 },
  { name: "unawaited-5ms", delay: 5, count: 1 },
  { name: "two-unawaited-0ms", delay: 0, count: 2 },
  { name: "two-unawaited-5ms", delay: 5, count: 2 },
  { name: "ordinary-inflight-0ms", inflight: true, delay: 0, count: 1 },
  { name: "awaited-inflight-pending-0ms", inflight: true, awaitWrite: true, delay: 0, count: 1 },
  { name: "reopen-before-slow-sync", inflight: true, slowSync: true, delay: 0, count: 1 },
  { name: "no-client-for-10s", inflight: true, delay: 0, count: 1, openDelay: 10000 },
];
const seed = cases.flatMap((c, n) => [
  { table: "conversations", row: { id: `c${n}`, title: c.name, creatorId: "dev:alice" } },
  { table: "removals", row: { id: `r${n}`, conversationId: `c${n}`, total: 0 } },
  { table: "memberships", row: { id: `a${n}`, conversationId: `c${n}`, principal: "dev:alice", role: "admin", joinedAt: 1 } },
  ...Array.from({ length: c.count }, (_, i) => ({ table: "memberships", row: { id: `m${n}-${i}`, conversationId: `c${n}`, principal: `dev:member${i}`, role: "member", joinedAt: 1 } })),
]);
// The audit counter is deliberately non-idempotent: a second application
// increments it again even with identical row IDs, so deletion alone cannot pass.
const extraSource = `
table removals:
  conversationId: conversations
  total: int
  unique byConversation: conversationId
  public 'navigation witness audit'
  update <- allow
  online only

mutation removeMember(conversationId: conversations, principal: principal):
  require exists memberships[conversationId = conversationId, principal = viewer, role = 'admin'] else NOT_ADMIN
  delete memberships[conversationId, principal]
  audit = removals[conversationId = conversationId] ! else AUDIT_MISSING
  update removals[audit] { total: audit.total + 1 }

query removed(conversationId: conversations):
  return removals[conversationId = conversationId] { total }

query roster(conversationId: conversations):
  return memberships[conversationId] first 50 by byConversationPrincipal
`;
const witness = await launch({ seed, extraSource });
const { page, api } = witness;
const origin = new URL(page.url()).origin;
const query = async (name, n) => (await fetch(`${api}/q/media.${name}`, { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify({ args: { conversationId: `c${n}` } }) }).then(r => r.json())).data;
const applied = async n => (await query("removed", n)).total;
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
try {
  // The destination opens its own client without a Playwright round trip.
  await page.addInitScript(({ api }) => {
    const params = new URL(location.href).searchParams;
    if (!params.has("destination")) return;
    window.navigationOpenedAt = performance.now();
    const start = async () => {
      while (!window.createLocalClient) await new Promise(r => setTimeout(r, 5));
      const delay = Number(params.get("openDelay") || 0);
      if (delay) await new Promise(r => setTimeout(r, delay));
      window.clientOpenStartedAt = performance.now();
      let firstSync = true;
      window.navigationClient = await window.createLocalClient({ url: api, persona: "alice", waitSeconds: 1, fetch: async (url, init) => {
        if (params.get("slowSync") === "true" && firstSync && String(url).endsWith("/sync")) {
          firstSync = false; await new Promise(r => setTimeout(r, 3000));
        }
        return fetch(url, init);
      } });
      window.clientReadyAt = performance.now();
    };
    void start().catch(error => { window.navigationError = String(error); });
  }, { api });
  for (const [n, scenario] of cases.entries()) {
    const result = { witness: "web-navigation-immediate", case: scenario.name, chromium: witness.chromium, writes: scenario.count, delayMs: scenario.delay, openDelayMs: scenario.openDelay ?? 0 };
    try {
      await page.goto(`${origin}/?source=${n}`);
      await page.waitForFunction(() => typeof window.createLocalClient === "function");
      await page.evaluate(async ({ api, n, scenario }) => {
        let offline = false, entered;
        const sending = new Promise(resolve => { entered = resolve; });
        const client = await window.createLocalClient({ url: api, persona: "alice", waitSeconds: 1, fetch: (url, init) => {
          if (offline && !init?.keepalive) return Promise.reject(new TypeError("ordinary offline"));
          if (scenario.inflight && !init?.keepalive && String(url).includes("/m/")) {
            // Delay ordinary delivery and abort it on real pagehide. The SDK's
            // exit send still uses the browser's real keepalive transport.
            entered();
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => resolve(fetch(url, init)), 10000);
              window.addEventListener("pagehide", () => { clearTimeout(timer); reject(new DOMException("pagehide", "AbortError")); }, { once: true });
            });
          }
          return fetch(url, init);
        } });
        if (scenario.offline) { offline = true; await client.sync(); }
        const button = document.createElement("button"); button.textContent = "Remove member"; document.body.append(button);
        button.onclick = async () => {
          const writes = Array.from({ length: scenario.count }, (_, i) => client.mutate({ kind: "mutation", name: "media.removeMember" }, { conversationId: `c${n}`, principal: `dev:member${i}` }));
          if (scenario.awaitWrite) await Promise.all(writes);
          if (scenario.inflight) await sending;
          const navigate = () => location.assign(`/?destination=${n}&openDelay=${scenario.openDelay ?? 0}&slowSync=${!!scenario.slowSync}`);
          if (scenario.delay) setTimeout(navigate, scenario.delay); else navigate();
        };
      }, { api, n, scenario });
      await page.getByRole("button", { name: "Remove member" }).click({ noWaitAfter: true });
      await page.waitForURL(url => url.searchParams.has("destination"));
      if (scenario.openDelay) {
        const deadline = Date.now() + 2000;
        while ((await applied(n)) !== 1 && Date.now() < deadline) await wait(20);
        result.appliedBeforeClient = (await applied(n));
      }
      await page.waitForFunction(() => window.clientOpenStartedAt !== undefined || window.navigationError, undefined, { timeout: 15000 });
      const deadline = Date.now() + 2000;
      while ((await applied(n)) !== scenario.count && Date.now() < deadline) await wait(20);
      result.applicationMs = await page.evaluate(() => Math.round(performance.now() - window.clientOpenStartedAt));
      result.clientOpenDelayMs = await page.evaluate(() => Math.round(window.clientOpenStartedAt - window.navigationOpenedAt));
      const roster = await query("roster", n);
      result.applied = await applied(n);
      result.remainingMembers = roster.filter(r => r.role === "member").length;
      await page.waitForFunction(() => window.navigationClient || window.navigationError);
      await page.evaluate(async () => { if (window.navigationError) throw Error(window.navigationError); await window.navigationClient.sync(); await window.navigationClient.close(); });
      await wait(100);
      result.afterReplay = (await applied(n));
      assert.equal(result.applied, scenario.count);
      assert.equal(result.remainingMembers, 0);
      assert.equal(result.afterReplay, scenario.count, "mutation IDs must dedupe the exit/reopen race");
      assert.ok(result.applicationMs <= 2000, "write must apply within 2 s of starting the next client");
      if (scenario.openDelay) assert.equal(result.appliedBeforeClient, 1);
      result.status = "pass";
    } catch (error) { result.status = "fail"; result.error = String(error); }
    results.push(result); console.log(JSON.stringify(result));
  }
} finally { await witness.close(); }
const failed = results.filter(r => r.status === "fail").length;
console.log(`web-navigation-immediate: ${results.length - failed} passed; ${failed} failed`);
if (failed) process.exitCode = 1;
