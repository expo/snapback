import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { command, freePort, launch, sleep } from './ceremony-process.mjs';
import { searchProtocol } from './bounds-metrics.mjs';
import { ANCHOR, DAY, HUB, generateSeed, seedCounts, key } from './bounds-seed.mjs';

export function wire(url) {
  return async (kind, name, args, persona = 'hub') => {
    const response = await fetch(`${url}/${kind}/${name}`, { method: 'POST', headers: { 'content-type': 'application/json',
      'x-snapback-persona': persona, 'x-snapback-meter': '1' }, body: JSON.stringify({ args,
      ...(kind === 'm' ? { id: randomUUID().replaceAll('-', '') } : {meter: true}) }), signal: AbortSignal.timeout(60000) });
    const value = await response.json();
    assert.ok(response.ok && !value.denied && (kind !== 'm' || value.state === 'sent'), `${kind}/${name}: ${JSON.stringify(value)}`);
    return value;
  };
}
export async function startServer(directory, binary) {
  const port = await freePort(), url = `http://127.0.0.1:${port}`;
  const process = binary ? launch(binary, ['dev', '--memory', '--no-watch', '--port', String(port)], {cwd: directory, log: join(directory, 'bounds-dev.log')}) :
    launch('npx', ['--no-install', 'snapback4', 'dev', '--memory', '--no-watch', '--port', String(port)], {cwd: directory, log: join(directory, 'bounds-dev.log')});
  try {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (process.child.exitCode !== null) throw new Error(process.output);
      if (process.output.includes(url)) {
        try { const r = await fetch(`${url}/probe`, {headers:{'x-snapback-persona':'hub'},signal: AbortSignal.timeout(1000)}); if (r.ok) return {url, stop: () => process.stop()}; } catch {}
      }
      await sleep(100);
    }
    throw new Error(`dev startup timeout: ${process.output}`);
  } catch (error) { await process.stop(); throw error; }
}
export const rows = (data) => {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.rows)) return data.rows;
  throw new Error(`expected array/page, got ${JSON.stringify(data).slice(0, 300)}`);
};
export function bounds(pages) {
  return { requests: pages.length, examined: pages.reduce((n, p) => n + (p.examined ?? 0), 0),
    indexEntries: pages.reduce((n, p) => n + (p.indexEntries ?? 0), 0),
    complete: pages.length > 0 && pages.every((p) => p.complete === true || (p.cut === 'meter' && p.next)),
    cut: [...new Set(pages.map((p) => p.cut))], next: pages.some((p) => p.next), pages };
}
export function observe(answer, operation, pages) {
  const meter = answer.meter;
  assert.ok(meter && Number.isFinite(meter.examined) && Number.isFinite(meter.indexEntries ?? meter.index_entries), 'dev must return meter counters');
  pages.push({operation, examined: meter.examined, indexEntries: meter.indexEntries ?? meter.index_entries,
    complete: answer.complete, cut: answer.cut ?? null, next: answer.next !== undefined && answer.next !== null});
}
export async function walk(call, operation, args, cursorArg, persona, pages = []) {
  const result = [], seen = new Set(); let cursor = null;
  for (let i = 0; i < 20000; i++) {
    const answer = await call('q', operation, {...args, [cursorArg]: cursor}, persona);
    observe(answer, operation, pages); result.push(...rows(answer.data));
    if (answer.next === undefined || answer.next === null) return result;
    const token = JSON.stringify(answer.next);
    assert.ok(!seen.has(token), 'continuation cycle'); seen.add(token); cursor = answer.next;
  }
  throw new Error('walk exceeded 20000 requests');
}
export async function walkSearch(call, protocol, persona) {
  const pages = [], groups = [];
  if (protocol.kind === 'one-cursor') groups.push(...await walk(call, protocol.operations[0], {q: 'coffee'}, protocol.cursorArgs[0], persona, pages));
  else if (protocol.kind === 'two-cursor') {
    let batch = null; const seen = new Set();
    for (let i = 0; ; i++) {
      assert.ok(i < 20000, 'membership walk exceeded 20000 requests');
      const directory = await call('q', protocol.operations[0], {[protocol.cursorArgs[0]]: batch}, persona);
      observe(directory, protocol.operations[0], pages);
      groups.push(...await walk(call, protocol.operations[1], {q: 'coffee', [protocol.cursorArgs[0]]: batch}, protocol.cursorArgs[1], persona, pages));
      if (directory.next === undefined || directory.next === null) break;
      const token = JSON.stringify(directory.next); assert.ok(!seen.has(token), 'membership continuation cycle'); seen.add(token); batch = directory.next;
    }
  } else throw new Error(`server search unsupported: ${protocol.kind}`);
  // Concatenate already server-grouped fragments. Never sort/filter/rank fetched application rows.
  const merged = new Map();
  for (const group of groups) {
    assert.equal(typeof group.roomId, 'string');
    if (group.messages?.complete === false) throw new Error(`nested messages incomplete: ${group.roomId}`);
    const list = rows(group.messages);
    if (!list.length) continue;
    const values = merged.get(group.roomId) ?? []; values.push(...list); merged.set(group.roomId, values);
  }
  return {groups: merged, ...bounds(pages)};
}
const summary = (times) => {
  const sorted = [...times].sort((a,b) => a-b);
  return {samples: times.length, p50: sorted[Math.ceil(sorted.length * .5)-1], p95: sorted[Math.ceil(sorted.length * .95)-1]};
};
const ratio = (a, b) => ({p50: a.p50 / b.p50, p95: a.p95 / b.p95});
export async function probeTasks(call, protocol, {size = HUB, samples = 60} = {}) {
  const seed = generateSeed(size), checks = [], runtimeBounds = {}, evidence = {};
  async function check(name, fn) {
    const start = performance.now();
    try { await fn(); checks.push({name, ok: true, seconds: (performance.now()-start)/1000}); }
    catch (error) { checks.push({name, ok: false, error: error.stack, seconds: (performance.now()-start)/1000}); }
  }
  for (const persona of ['hub', 'sparse']) await check(`search-${persona}`, async () => {
    const result = await walkSearch(call, protocol, persona);
    const {groups, ...meters} = result; runtimeBounds[`search-${persona}`] = meters;
    const rooms = new Set(seed.members.filter((m) => m.principal === `dev:${persona}`).map((m) => m.roomId));
    const expected = new Map();
    for (const msg of seed.messages) if (rooms.has(msg.roomId) && msg.body === 'coffee') {
      const list = expected.get(msg.roomId) ?? []; list.unshift(msg.key); expected.set(msg.roomId, list);
    }
    assert.deepEqual([...groups.keys()].sort(), [...expected.keys()].sort(), 'every matching chat, no hidden chat');
    for (const [room, messages] of groups) assert.deepEqual(messages.map((m) => m.key), expected.get(room), `${room}: every match newest first, no duplicates`);
    evidence[`search-${persona}`] = {groups: groups.size, messages: [...groups.values()].reduce((n, a) => n + a.length, 0), answerExact: true};
    assert.equal(meters.complete, true, 'walk leaves no undischarged incomplete page');
  });
  evidence.following = {};
  for (const persona of ['small', 'wide', 'celebrity']) await check(`following-${persona}`, async () => {
      const authors = new Set(seed.follows.filter((f) => f.followerId === `dev:${persona}`).map((f) => f.followedId));
      const expected = seed.posts.filter((p) => authors.has(p.authorId)).sort((a,b) => b.at-a.at).map((p) => p.key);
      const pages = [], found = await walk(call, 'following', {}, 'c', persona, pages);
      runtimeBounds[`following-${persona}`] = bounds(pages);
      assert.deepEqual(found.map((p) => p.key), expected); assert.equal(bounds(pages).complete, true);
      const times = [], timingPages = [];
      for (let i = 0; i < samples + 3; i++) {
        const start = performance.now(), a = await call('q', 'following', {c: null}, persona);
        const elapsed = performance.now()-start;
        assert.deepEqual(rows(a.data).map((p) => p.key), expected.slice(0,20));
        assert.equal(a.complete, true);
        if (i >= 3) { times.push(elapsed); observe(a, 'following', timingPages); }
      }
      evidence.following[persona] = {...summary(times), rows: found.length, firstPages: bounds(timingPages)};
  });
  if (['small','wide','celebrity'].every((p) => evidence.following[p])) {
    evidence.following.ratios = {wideOverSmall: ratio(evidence.following.wide, evidence.following.small),
      celebrityOverSmall: ratio(evidence.following.celebrity, evidence.following.small)};
  }
  await check('roster-unread', async () => {
    const pages = [], roster = await walk(call, 'roster', {roomId: key('h',0)}, 'c', 'hub', pages);
    const unread = await call('q', 'unread', {}, 'hub'); observe(unread, 'unread', pages);
    runtimeBounds.rosterUnread = bounds(pages);
    assert.deepEqual(roster.map((m) => m.principal).sort(), seed.members.filter((m) => m.roomId === key('h',0)).map((m) => m.principal).sort());
    const counts = new Map(); for (const m of seed.messages) counts.set(m.roomId, (counts.get(m.roomId) ?? 0) + 1);
    const total = seed.members.filter((m) => m.principal === 'dev:hub').reduce((n,m) => n + counts.get(m.roomId) - m.readOrdinal, 0);
    assert.equal(unread.data.total, total); assert.equal(bounds(pages).complete, true);
    evidence.rosterUnread = {members: roster.length, total};
  });
  await check('trending', async () => {
    const likes = new Map(); for (const l of seed.likes) likes.set(l.postKey, (likes.get(l.postKey) ?? 0) + 1);
    const pages = [];
    async function assertTrend() {
      const a = await call('q', 'trending', {at: ANCHOR, c: null}, 'hub'); observe(a, 'trending', pages);
      runtimeBounds.trending = bounds(pages);
      const expected = seed.posts.filter((p) => p.at > ANCHOR-DAY && p.at <= ANCHOR).map((p) => ({key:p.key, likes: likes.get(p.key) ?? 0, at:p.at}))
        .sort((a,b) => b.likes-a.likes || b.at-a.at || a.key.localeCompare(b.key)).slice(0,10);
      assert.deepEqual(rows(a.data).map(({key, likes, at}) => ({key, likes, at})), expected);
      assert.equal(a.complete, true); return expected;
    }
    const before = await assertTrend(), target = key('p',11);
    for (let i=0; i<20; i++) await call('m', 'like', {postKey:target, liked:true}, `change${i}`);
    likes.set(target, (likes.get(target) ?? 0)+20);
    const after = await assertTrend(); assert.notDeepEqual(before, after);
    await call('m', 'like', {postKey:target, liked:false}, 'change0'); likes.set(target, likes.get(target)-1);
    const afterUnlike = await assertTrend(); evidence.trending = {before, after, afterUnlike};
  });
  await check('post-acknowledgement', async () => {
    const times = {celebrity:[], small:[]};
    // Alternate authors to reduce host-load order bias; acknowledged posts lie after the trend probe clock.
    for (let i=0; i<samples+3; i++) for (const name of i%2 ? ['small','celebrity'] : ['celebrity','small']) {
      const start = performance.now();
      await call('m', 'post', {key:`ack-${name}-${i}`, body:'ack probe', at:ANCHOR+1+i}, key('a',name === 'celebrity' ? 0 : 1));
      if (i>=3) times[name].push(performance.now()-start);
    }
    evidence.postAcknowledgement = {celebrity:summary(times.celebrity), small:summary(times.small)};
    evidence.postAcknowledgement.ratio = ratio(evidence.postAcknowledgement.celebrity,evidence.postAcknowledgement.small);
    for (const persona of ['small','celebrity']) {
      const a = await call('q','following',{c:null},persona);
      assert.equal(a.complete,true);
      const newest = rows(a.data).filter((p) => p.key.startsWith('ack-')).map((p) => p.key);
      const expected = Array.from({length:Math.min(20,samples+3)},(_,i) => `ack-${persona}-${samples+2-i}`);
      assert.deepEqual(newest,expected,'acknowledged posts must be visible to followers');
    }
  });
  return {ok: checks.every((c) => c.ok), checks, runtimeBounds, evidence, seedCounts: seedCounts(seed)};
}
export async function probeBounds(directory, {binary, size = HUB, samples = 60, protocol, seed} = {}) {
  let server;
  try {
    protocol ??= searchProtocol(readFileSync(join(directory, 'run-log.md'), 'utf8'));
    server = await startServer(directory, binary);
    const started = performance.now();
    if (seed) await seed(wire(server.url));
    else {
      const result = await command('npm', ['run', 'seed:hub'], {cwd:directory, env:{SNAPBACK_URL:server.url}, log:join(directory,'bounds-seed.log'), limitMs:900000});
      assert.equal(result.status, 0, result.out); assert.equal(result.timedOut, false);
    }
    const seedSeconds = (performance.now()-started)/1000;
    return {...await probeTasks(wire(server.url), protocol, {size,samples}), seedSeconds};
  } catch (error) { return {ok:false, checks:[{name:'setup',ok:false,error:error.stack}], runtimeBounds:{}}; }
  finally { await server?.stop(); }
}
