import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {server, root} from './helpers/read-through-server.mjs';
import {hangBudget, waitFor} from './helpers/wait.mjs';
const source = readFileSync(join(root,'crates/snapback4-lang/tests/fixtures/rx/reactions.q'),'utf8');
const binary = process.env.SNAPBACK4_BIN ?? join(root,'target/debug/snapback4');

for (const tier of ['wasm','process']) test(`${tier}: table membership and live chains govern actual client mutations`, {timeout:hangBudget(20)}, async t => {
  assert.ok(!source.includes('require '));
  const host = await server(t,tier,source);
  const rows = ['own','hidden'].flatMap(scope => [
    {table:'conversations',row:{id:scope,owner:scope==='own'?'dev:bob':'dev:alice'}},
    {table:'members',row:{id:`member-${scope}`,conversation:scope,principal:scope==='own'?'dev:bob':'dev:alice'}},
    {table:'messages',row:{id:`message-${scope}`,conversation:scope,deleted:false,until:null}},
  ]);
  assert.equal((await host.post('/seed',rows)).seeded,6);
  const client = await host.open();
  const mutate = async (name,args) => {
    const pending = await client.mutate({kind:'mutation',name},args);
    if (pending.state !== 'pending') return pending;
    let settled;
    await waitFor(async () => {
      settled = await client.write(pending.id);
      return settled && settled.state !== 'pending';
    }, `${tier}: ${name} settles`);
    return settled;
  };
  const denied = await mutate('setReaction',{message:'message-hidden',emoji:'like'});
  assert.equal(denied.state,'failed',JSON.stringify(denied));
  const absent = await mutate('setReaction',{message:'message-absent',emoji:'like'});
  assert.equal(absent.state,'failed',JSON.stringify(absent));
  assert.deepEqual(denied.why,absent.why,'hidden message existence must not disclose');
  const admitted = await mutate('setReaction',{message:'message-own',emoji:'like'});
  assert.equal(admitted.state,'sent',JSON.stringify(admitted));
  await client.sync();
  const reaction = await client.query({kind:'query',name:'reaction'},{message:'message-own'});
  assert.equal(reaction.data.emoji,'like');
  assert.equal((await mutate('endorse',{id:'endorsement',reaction:reaction.data.id})).state,'sent');
  assert.equal((await mutate('obligation',{id:'obligation',message:'message-own'})).state,'sent');
  assert.equal((await mutate('leave',{conversation:'own',principal:'dev:bob'})).state,'sent');
  const removed = await mutate('setReaction',{message:'message-own',emoji:'other'});
  assert.equal(removed.state,'failed',JSON.stringify(removed));
});

test('check --cost and why list each prepaid hop, including final obligations', {timeout:hangBudget(3)}, t => {
  const dir = mkdtempSync(join(tmpdir(),'sb4-rx-cost-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  mkdirSync(join(dir,'snapback'));
  writeFileSync(join(dir,'snapback/schema.q'),source);
  const run = args => {
    const result = spawnSync(binary,args,{cwd:dir,encoding:'utf8',timeout:hangBudget()});
    assert.equal(result.status,0,result.stderr);
    return result.stdout;
  };
  const cost = run(['check','--cost']);
  const why = run(['why','endorse']);
  for (const table of ['reactions','messages','conversations']) {
    assert.match(why,new RegExp(`write rule hop [123]: ${table}.*1 prepaid rule probe`));
  }
  assert.equal((why.match(/write rule hop/g)??[]).length,5);
  assert.match(cost,/after insert hop 1: messages.*1 prepaid rule probe/);
  assert.match(run(['why','obligation']),/after insert hop 1: messages.*1 prepaid rule probe/);
});
