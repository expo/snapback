// @ref LLP 3000.001.001#62-the-walk-its-cursor-and-completion — completion waits for every publishable unit; failure never invents readiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, query } from './helpers/progressive-acquisition.mjs';
import { LocalAcquisition } from '../dist/local-acquisition.js';
import { localStatus } from '../dist/local-status.js';
import { hangBudget, waitFor } from './helpers/wait.mjs';
const overflow = {code:'E_BOUND',family:'bound',message:'the HTTP JSON response exceeds 16 MiB; request a smaller page or return fewer values'};

// @ref LLP 3000.001.001#8-progress-and-ui — saved usable data opens independently of admission to further acquisition work.
for (const complete of [false, true]) test(`saved web ${complete ? 'complete' : 'partial'} walk opens connected during schema overload and later resumes`, {timeout:hangBudget(40)}, async t => {
  const f = await fixture(t, 'wasm', {limit:1});
  const first = await f.open();
  if (complete) { f.allow(true); await first.sync(); }
  else await f.through(first, state => state.acquired_tables.length === 2);
  const saved = await f.state();
  assert.equal(saved.acquired, complete);
  await first.close();
  let attempts = 0, fault = true;
  const denied = {code:'E_RATE_LIMIT',family:'limit',message:'busy',retryable:true};
  f.interceptSchema(() => { if (fault) { attempts++; return Response.json({denied}, {status:503}); } });
  f.intercept(() => { if (fault) return Response.json({denied}, {status:503}); });
  f.allow(true);
  const reopened = await f.open();
  assert.equal(attempts, 4, 'opening does not repeat the exhausted schema retry sequence');
  assert.equal(reopened.link(), 'online');
  assert.equal(reopened.acquired, complete);
  assert.deepEqual((await f.state()).acquired_tables, saved.acquired_tables);
  const inbox = await reopened.query(query('inbox'), {});
  assert.equal(inbox.complete, true);
  assert.equal(inbox.data.length, f.groups.length);
  if (!complete) {
    await waitFor(() => attempts >= 8, 'background capability discovery did not retry');
    await reopened.sync();
    assert.equal(reopened.link(), 'online', 'a typed discovery overload is still connected');
    assert.equal(reopened.acquired, false);
  }
  fault = false;
  await reopened.sync();
  assert.equal(reopened.acquired, true);
  assert.equal(reopened.link(), 'online');
});

for (const failAt of ['first', 'later']) test(`explicit acquisition propagates a rejected ${failAt} network turn`, async () => {
  const walk = new LocalAcquisition(), fault = new Error('transport/host failed');
  walk.pending = true;
  let rounds = 0;
  await assert.rejects(walk.sync(async () => { if (failAt === 'first') throw fault; return true; },
    async () => { rounds++; throw fault; }, () => true), error => error === fault);
  assert.equal(rounds, failAt === 'first' ? 0 : 1);
  assert.equal(walk.pending, true, 'a failed owner did not claim full acquisition');
  await walk.sync(async () => false, async () => { assert.fail('false round must stop'); }, () => true);
  await walk.sync(async () => { assert.fail('retired owner must stop'); }, async () => true, () => false);
});

for (const tier of ['process','wasm']) {
  test(`${tier}: progressive owner-key proof survives sign-out and offline reopening`, {timeout:hangBudget(30)}, async t => {
    const source = `use personas alice, bob
table likes:
  post: id
  owner: principal
  at: time
  unique post, owner
  immutable post, owner
  public 'likes'
  insert <- .owner = viewer
  delete <- .owner = viewer
  sync public last 2 by .at with own keys .owner
query own(post: id):
  return exists likes[post, viewer]
`;
    const rows = ['old', 'new1', 'new2'].map((post, at) => ({table:'likes', row:{id:post,post,at,owner:at ? 'dev:bob' : 'dev:alice'}}));
    const f = await fixture(t, tier, {source, rows, limit:1});
    const first = await f.open();
    f.allow(true); await first.sync();
    assert.equal(first.acquired, true);
    assert.ok(f.pages.some(page => page.acquire && page.joined?.['$ownKeys:likes']?.[0]?.[0] === 'dev:alice'));
    f.online(false); await first.signOut();
    const reopened = await f.open();
    for (const [post, expected] of [['missing', false], ['old', true]]) {
      const answer = await reopened.query(query('own'), {post});
      assert.equal(answer.data, expected, JSON.stringify(answer));
      assert.equal(answer.complete, true);
      assert.equal(answer.fresh, false);
      assert.equal((await f.raw('own', {post})).unknown, false);
    }
    const other = await f.core().call({op:'query', name:'own', args:{post:'missing'}, viewer:'dev:bob', now:Date.now()});
    assert.equal(other.ok.unknown, true, 'the same store cannot lend the proof to a different caller');
  });
  test(`${tier}: HTTP serialization overflow shrinks one acquire cursor and finishes its catch-up`, {timeout:hangBudget(30)}, async t => {
    const f = await fixture(t, tier, {limit:1}), client = await f.open();
    let observation = client.observe(query('history'), {c:'c',page:null});
    t.after(() => observation.close());
    const refused = [];
    f.intercept(body => {
      if (body.acquire && refused.length < 3) {
        refused.push(structuredClone(body));
        if (refused.length === 1) {
          observation.close();
          observation = client.observe(query('history'), {c:'d',page:null});
        }
        return Response.json({denied:overflow,store_id:f.backend.store_id,generation:f.backend.generation,watermark:body.from});
      }
    });
    f.allow(true); await client.sync();
    assert.equal(client.acquired,true);
    assert.deepEqual(refused.map(body=>body.limit),[10000,5000,2500]);
    assert.deepEqual(refused[0].acquire.hint, {table:'messages',group:['c']});
    for (const body of refused) { assert.equal(body.from,0); assert.equal(body.acquire.cursor,null); assert.deepEqual(body.acquire,refused[0].acquire); }
    assert.ok(f.requests.some(body=>body.acquire?.cursor), 'resume the walk after the accepted prefix');
    assert.ok(f.requests.some(body=>body.stream), 'ordinary catch-up still runs');
    f.online(false);
    const result = await client.query(query('history'), {c:'c',page:null});
    assert.equal(result.complete,true); assert.deepEqual(result.data.map(row=>row.id),['c4','c3']);
  });
  test(`${tier}: failure of even one-row replacement surfaces once after acquire overflow`, {timeout:hangBudget(30)}, async t => {
    const f = await fixture(t, tier, {limit:1}), client = await f.open();
    f.intercept(body => Response.json({denied:body.acquire ? {code:'E_BOUND',family:'bound',message:'atomic unit exceeds its heap allowance'} : overflow,
      store_id:f.backend.store_id,generation:f.backend.generation,watermark:body.from}));
    f.allow(true); await client.sync();
    assert.equal(client.acquired,false);
    assert.ok(f.requests.some(body=>!body.acquire && body.from===0 && body.limit===1),'try a one-row replacement before refusing');
    assert.equal(localStatus(client).getSnapshot().why?.code,'E_BOUND');
    const attempts=f.requests.length; await client.sync();
    assert.equal(f.requests.length,attempts,'permanent failure has no automatic retry spin');
  });
}
