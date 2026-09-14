import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { command, freePort, launch, sleep } from "./ceremony-process.mjs";

export const ANCHOR = 1789322400000, DAY = 86400000, PERIOD = 120000;

export function unwrap(value) {
  if (Array.isArray(value)) return value.map(unwrap);
  if (value && typeof value === "object") {
    if ("complete" in value) assert.equal(value.complete, true, "a nested answer must be complete");
    if (Array.isArray(value.rows)) return value.rows.map(unwrap);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrap(child)]));
  }
  return value;
}

export const aliceInsights = (likes = 21) => ({ posts: 6, likesReceived: likes, repostsReceived: 2, repliesReceived: 2, followers: 3, following: 2,
  days: [0, 0, 0, 0, 1, 0, 4].map((posts, i) => ({ day: ANCHOR - ANCHOR % DAY - (6 - i) * DAY, posts, likesReceived: [0, 0, 0, 0, 7, 0, likes - 9][i] })) });

const select = (row, fields) => Object.fromEntries(fields.map((field) => [field, row[field]]));
function insightsShape(value) {
  return { ...select(value, ["posts", "likesReceived", "repostsReceived", "repliesReceived", "followers", "following"]),
    days: value.days.map((day) => select(day, ["day", "posts", "likesReceived"])) };
}
const trendShape = (value) => value.map((row) => select(row, ["key", "likes", "at"]));
const searchShape = (value) => value.filter((group) => group.messages.length).map((group) => ({ chatKey: group.chatKey, keys: group.messages.map((row) => row.key) }));

// Independent expectations are deliberately here, never imported from the
// builder's acceptance. Only the builder's seed command is reused.
export async function probeLane(directory) {
  const port = await freePort(), url = `http://127.0.0.1:${port}`;
  const checks = [], evidence = {};
  let server, serverNumber = 0;
  async function request(path, { persona = "alice", body, token } = {}) {
    const response = await fetch(`${url}${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : { "x-snapback-persona": persona }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    const value = await response.json();
    assert.equal(response.ok, true, `${path}: HTTP ${response.status} ${JSON.stringify(value)}`);
    return value;
  }
  async function start() {
    server = launch("npx", ["snapback4", "dev", "--no-watch", "--port", String(port)], { cwd: directory, log: join(directory, `probe-server-${++serverNumber}.log`) });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (server.child.exitCode !== null) throw new Error(`backend exited: ${server.output}`);
      if (!server.output.includes(url)) { await sleep(150); continue; }
      try { await request("/probe"); return; } catch { await sleep(150); }
    }
    throw new Error(`backend did not become ready: ${server.output}`);
  }
  async function stop() { if (server) { await server.stop(); server = null; } }
  async function query(name, args = {}, persona = "alice") {
    const answer = await request(`/q/${name}`, { persona, body: { args } });
    assert.equal(answer.denied, undefined, `${name}: ${JSON.stringify(answer)}`);
    assert.equal(answer.complete, true, `${name} must give a complete small-seed answer`);
    return unwrap(answer.data);
  }
  async function mutate(name, args, persona, denied = false) {
    const answer = await request(`/m/${name}`, { persona, body: { id: randomUUID().replaceAll("-", ""), args } });
    assert.equal(answer.state, denied ? "failed" : "sent", `${name}: ${JSON.stringify(answer)}`);
    return answer;
  }
  async function check(name, body) {
    const started = Date.now();
    try { await body(); checks.push({ name, ok: true, seconds: (Date.now() - started) / 1000 }); }
    catch (error) { checks.push({ name, ok: false, error: error.stack, seconds: (Date.now() - started) / 1000 }); }
  }
  try {
    await start();
    const seed = await command("npm", ["run", "seed"], { cwd: directory, env: { SNAPBACK_URL: url }, log: join(directory, "probe-seed.log") });
    assert.equal(seed.status, 0, `seed failed: ${seed.out}`);
    await check("insights", async () => {
      assert.deepEqual(insightsShape(await query("insights", { at: ANCHOR })), aliceInsights());
      const shifted = insightsShape(await query("insights", { at: ANCHOR + DAY }));
      assert.deepEqual(shifted.days, [...aliceInsights().days.slice(1), { day: ANCHOR - ANCHOR % DAY + DAY, posts: 0, likesReceived: 0 }]);
      const nobody = insightsShape(await query("insights", { at: ANCHOR }, "heidi"));
      assert.deepEqual(select(nobody, ["posts", "likesReceived", "repostsReceived", "repliesReceived", "followers", "following"]),
        { posts: 0, likesReceived: 0, repostsReceived: 0, repliesReceived: 0, followers: 0, following: 0 });
      assert.equal(nobody.days.length, 7); assert.ok(nobody.days.every((day) => day.posts === 0 && day.likesReceived === 0));
      await mutate("like", { postKey: "p01", at: ANCHOR }, "grace");
      assert.deepEqual(insightsShape(await query("insights", { at: ANCHOR })), aliceInsights(22));
      await mutate("like", { postKey: "p01", at: ANCHOR }, "grace", true);
      await mutate("like", { postKey: "p01", at: ANCHOR }, "alice", true);
      evidence.insights = { initial: aliceInsights(), afterLike: aliceInsights(22) };
    });
    await check("trending", async () => {
      // The prior independent like raises p01 from five to six.
      const p01 = checks.find((c) => c.name === "insights").ok ? 6 : (await query("trending", { at: ANCHOR }))[0].likes;
      const expected = [p01, 5, 4, 4, 4, 3, 3, 3, 2, 2].map((likes, i) => ({ key: `p${String(i + 1).padStart(2, "0")}`, likes, at: ANCHOR - (i + 1) * 3600000 }));
      assert.deepEqual(trendShape(await query("trending", { at: ANCHOR })), expected);
      for (const persona of ["alice", "bob", "carol", "erin", "frank", "grace", "heidi"]) await mutate("like", { postKey: "p16", at: ANCHOR }, persona);
      const after = [{ key: "p16", likes: 7, at: ANCHOR - 16 * 3600000 }, ...expected.slice(0, 9)];
      assert.deepEqual(trendShape(await query("trending", { at: ANCHOR })), after);
      assert.ok(!(await query("trending", { at: ANCHOR })).some((post) => post.key === "p17"));
      evidence.trending = { initial: expected, afterLikes: after };
    });
    await check("search", async () => {
      const expected = [{ chatKey: "alpha", keys: ["a20", "a15", "a10", "a05"] }, { chatKey: "beta", keys: ["b20", "b15", "b10", "b05"] }];
      assert.deepEqual(searchShape(await query("search", { q: "lau" })), expected);
      assert.deepEqual(searchShape(await query("search", { q: "lau lan" })), expected.slice(0, 1));
      assert.deepEqual(searchShape(await query("search", { q: "aunch" })), []);
      assert.deepEqual(searchShape(await query("search", { q: "" })), []);
      assert.deepEqual(searchShape(await query("search", { q: "LAU" }, "bob")), [expected[0], { chatKey: "gamma", keys: ["c20", "c15", "c10", "c05"] }]);
      await mutate("send", { chatKey: "beta", key: "b21", body: "launch lantern fresh", at: ANCHOR }, "frank");
      assert.deepEqual(searchShape(await query("search", { q: "lau lan" })), [expected[0], { chatKey: "beta", keys: ["b21"] }]);
      await mutate("send", { chatKey: "gamma", key: "forbidden", body: "launch", at: ANCHOR }, "alice", true);
      evidence.search = { initial: expected, insertedMessage: "b21" };
    });
    await check("digest", async () => {
      const tokenResult = await command("npx", ["snapback4", "token", "--service", "ceremony"], { cwd: directory });
      assert.equal(tokenResult.status, 0, "mint worker service token");
      const token = tokenResult.stdout.trim();
      assert.ok(token && !token.includes("\n"), "service token command prints one token");
      const periodStart = Math.floor(Date.now() / PERIOD) * PERIOD - 10 * PERIOD;
      const args = { periodStart, periodEnd: periodStart + PERIOD };
      async function runJob(jobArgs, name) {
        await stop();
        const result = await command("npx", ["snapback4", "run", "digest", JSON.stringify(jobArgs)], { cwd: directory, log: join(directory, `probe-digest-${name}.log`) });
        assert.equal(result.status, 0, `digest job: ${result.out}`);
        await start();
      }
      const observed = [];
      async function worker() {
        for (let page = 0; page < 50; page++) {
          const result = await request("/effects/claim", { token, body: { effect: "digest", limit: 100, lease: 30, wait: 0 } });
          assert.ok(Array.isArray(result.effects), "claim returns effects");
          if (!result.effects.length) break;
          for (const effect of result.effects) {
            observed.push({ id: effect.id, payload: effect.payload });
            await request(`/effects/${encodeURIComponent(effect.id)}/done`, { token, body: { result: { observed: true } } });
          }
        }
      }
      function expectPeriod(start, alice, bob) {
        const rows = observed.filter((effect) => effect.payload.periodStart === start).map((effect) => effect.payload).sort((a, b) => a.targetUserId.localeCompare(b.targetUserId));
        assert.deepEqual(rows.map((row) => select(row, ["targetUserId", "periodStart", "periodEnd", "unreadMessages", "unreadChats"])),
          [["alice", alice, 1], ["bob", bob, bob > 20 ? 2 : 1], ["carol", 20, 1]].map(([name, unreadMessages, unreadChats]) =>
            ({ targetUserId: `dev:${name}`, periodStart: start, periodEnd: start + PERIOD, unreadMessages, unreadChats })));
      }
      const aliceCount = evidence.search ? 21 : 20;
      await runJob(args, "first"); await worker(); expectPeriod(periodStart, aliceCount, 40);
      await runJob(args, "replay-after-restart"); await worker(); expectPeriod(periodStart, aliceCount, 40);
      await mutate("leave", { chatKey: "gamma" }, "bob");
      assert.deepEqual(searchShape(await query("search", { q: "lau" }, "bob")), [{ chatKey: "alpha", keys: ["a20", "a15", "a10", "a05"] }]);
      const next = { periodStart: periodStart + PERIOD, periodEnd: periodStart + 2 * PERIOD };
      await runJob(next, "next"); await worker(); expectPeriod(next.periodStart, aliceCount, 20);
      // Observe the real clock's next boundary, then restart within that period.
      const boundary = (Math.floor(Date.now() / PERIOD) + 1) * PERIOD;
      const deadline = boundary + 45_000;
      while (Date.now() < deadline) {
        await worker();
        if (observed.filter((effect) => effect.payload.periodEnd === boundary).length >= 3) break;
        await sleep(500);
      }
      expectPeriod(boundary - PERIOD, aliceCount, 20);
      await stop(); await start(); await sleep(1500); await worker();
      expectPeriod(boundary - PERIOD, aliceCount, 20);
      assert.equal(new Set(observed.map((effect) => effect.id)).size, observed.length, "worker observed unique emitted effects");
      evidence.digest = { explicitPeriod: args, followingPeriod: next, scheduledBoundary: boundary, observed };
    });
    await check("receipt", async () => {
      assert.equal((await query("receipt", { messageKey: "a01" })).state, "sent");
      for (const persona of ["bob", "carol", "dave"]) await mutate("ack", { messageKey: "a01", state: "delivered" }, persona);
      assert.equal((await query("receipt", { messageKey: "a01" })).state, "sent");
      await mutate("ack", { messageKey: "a01", state: "delivered" }, "erin");
      assert.equal((await query("receipt", { messageKey: "a01" })).state, "delivered");
      for (const persona of ["bob", "carol", "dave"]) await mutate("ack", { messageKey: "a01", state: "read" }, persona);
      assert.equal((await query("receipt", { messageKey: "a01" })).state, "delivered");
      await mutate("leave", { chatKey: "alpha" }, "erin");
      assert.equal((await query("receipt", { messageKey: "a01" })).state, "read");
      const lowerAck = await request("/m/ack", { persona: "bob", body: { id: randomUUID().replaceAll("-", ""), args: { messageKey: "a01", state: "delivered" } } });
      assert.ok(["sent", "failed"].includes(lowerAck.state), "a lower ack may be ignored or refused");
      assert.equal((await query("receipt", { messageKey: "a01" })).state, "read", "a lower ack cannot regress a read");
      await mutate("ack", { messageKey: "a01", state: "read" }, "erin", true);
      const hidden = await request("/q/receipt", { persona: "heidi", body: { args: { messageKey: "a01" } } });
      assert.ok(hidden.denied || hidden.data === null, "nonmember receipt cannot disclose state");
      evidence.receipt = ["sent", "sent", "delivered", "delivered", "read", "read"];
    });
  } catch (error) { checks.push({ name: "setup", ok: false, error: error.stack }); }
  finally { await stop(); }
  return { directory, ok: checks.length === 5 && checks.every((check) => check.ok), checks, evidence };
}
