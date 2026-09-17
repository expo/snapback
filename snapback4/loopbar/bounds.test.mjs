import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSeed, seedCounts, HUB, TINY } from './bounds-seed.mjs';
import { literals, vocabulary, measureBounds } from './bounds-metrics.mjs';

test('hub seed is deterministic and matches the frozen counts', () => {
  assert.deepEqual(generateSeed(TINY), generateSeed(TINY));
  assert.deepEqual(seedCounts(generateSeed(HUB)), { chats: 1300, members: 1349, messages: 99390, authors: 1000, follows: 1411, posts: 50000, likes: 98 });
  const full = generateSeed(HUB);
  assert.equal(full.messages.filter((m) => m.roomId.startsWith('h') && m.body === 'coffee').length,99090);
  assert.equal(full.follows.filter((f) => f.followedId === 'dev:a000000').length,900);
  assert.equal(full.follows.filter((f) => f.followedId === 'dev:a000001').length,5);
});
test('literal tokens exclude strings, comments, identifiers, decimals and only product constants', () => {
  assert.deepEqual(literals([{ path: 'a.q', source: "query q2():\n  x = -7 + 50 + 20 + 10 + 86400000 + 24 + 1000\n  s = '123' -- 999\n  y = 1.5 + 8\n" }]).map(({line, token}) => [line, token]), [[2,'-7'],[2,'50'],[2,'1000'],[4,'8']]);
});
test('bound vocabulary is whole-word and case-insensitive', () => {
  assert.equal(vocabulary('Bound BOUND bounds unbound cap CAPACITY N_WIDE_MERGE n_wide_merge').bound, 2);
  assert.equal(vocabulary('Bound BOUND bounds unbound cap CAPACITY N_WIDE_MERGE n_wide_merge').cap, 1);
  assert.equal(vocabulary('N_WIDE_MERGE n_wide_merge').N_WIDE_MERGE, 2);
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from './ceremony-process.mjs';
import { prepareVerificationLane } from './run.mjs';
import { probeBounds, walkSearch } from './bounds-probes.mjs';
import { seedReference, ONE, TWO } from './fixtures/bounds/seed.mjs';
const here = dirname(fileURLToPath(import.meta.url));

test('hand-written run: missing green stays measured and not green', () => {
  const dir = mkdtempSync(join(tmpdir(),'bounds-metrics-'));
  try {
    mkdirSync(join(dir,'snapback')); mkdirSync(join(dir,'evidence/checks'),{recursive:true});
    writeFileSync(join(dir,'snapback/schema.q'), `table counters:\n  owner: principal\n  score: int\n  read <- allow\n  update <- allow\njob refresh():\n  return 7\nquery following():\n  return 50\n`);
    const ranges = Object.fromEntries(['search','following','rosterUnread','trending'].map((task) => [task,[{file:'snapback/schema.q',start:6,end:9}]]));
    writeFileSync(join(dir,'run-log.md'), `start=100\nmilestone=check at=110\nloop=1 attribution=docs missing form\nknowledge-lookup card=search lines=320\nknowledge-lookup card=search lines=12\nsearch-protocol=${JSON.stringify(TWO)}\nfollowing-shape={"kind":"merge-on-read"}\ntask-lines=${JSON.stringify(ranges)}\nderived-columns=[{"table":"counters","column":"score"}]\nschema-shape={"workTables":[],"perPrincipalCounterTables":["counters"],"auxiliaryOperations":["refresh"]}\n`);
    writeFileSync(join(dir,'final-report.md'),'The CAP is complete.');
    writeFileSync(join(dir,'evidence/checks/001.log'),'N_WIDE_MERGE N_WIDE_MERGE E_BOUND');
    const m = measureBounds(dir);
    assert.equal(m.reportedGreen,false); assert.equal(m.agentSeconds,null);
    assert.deepEqual(m.measurementErrors,[]); assert.equal(m.tables,1); assert.equal(m.jobs,1);
    assert.equal(m.publicDerivedRules.count,2); assert.equal(m.quarryLines.search,4);
    assert.deepEqual(m.cardsRead.search,{lookups:2,lines:332});
    assert.deepEqual(m.notes,{N_WIDE_MERGE:2,E_BOUND:1});
    assert.equal(m.searchProtocol,'two-cursor'); assert.equal(m.numericLiterals.length,2);
    assert.deepEqual(m.milestones,[{name:'check',at:110,seconds:10}]);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('walker drains result cursor before moving the membership batch and rejects cycles', async () => {
  const calls = [];
  const fake = async (kind, op, args) => {
    calls.push([op,args.batch,args.c]);
    const directory = op === 'chats';
    return {data:directory ? [] : [{roomId:args.batch ?? 'first',messages:[{key:args.c ?? 'head'}]}], complete:true,
      next:directory ? (args.batch === null ? 'batch2' : null) : (args.c === null ? 'tail' : null), meter:{examined:2,indexEntries:3}};
  };
  const result = await walkSearch(fake,TWO,'hub');
  assert.equal(result.complete,true); assert.equal(result.requests,6); assert.equal(result.examined,12);
  assert.deepEqual(calls,[['chats',null,undefined],['batches',null,null],['batches',null,'tail'],['chats','batch2',undefined],['batches','batch2',null],['batches','batch2','tail']]);
  await assert.rejects(walkSearch(async () => ({data:[],complete:false,next:'stuck',meter:{examined:1,indexEntries:1}}),ONE,'hub'),/cycle/);
});

const binary = resolve(process.env.BOUNDS_BINARY ?? join(here,'../target/w13d-bin/package/snapback4'));
test('published 0.2.27 reference: four tasks with one and two search cursors', {timeout:360000, skip:!existsSync(binary) && 'set BOUNDS_BINARY to the published 0.2.27 binary'}, async () => {
  const version = await command(binary,['--version']); assert.equal(version.stdout.trim(),'snapback4 0.2.27');
  for (const protocol of [ONE,TWO]) {
    const dir = prepareVerificationLane(join(here,'fixtures/bounds'));
    try {
      const check = await command(binary,['check'],{cwd:dir}); assert.equal(check.status,0,check.out);
      const result = await probeBounds(dir,{binary,size:TINY,samples:3,protocol,seed:(call) => seedReference(call,TINY)});
      assert.equal(result.ok,true,JSON.stringify(result,null,2));
      assert.equal(result.evidence['search-hub'].messages,73);
      assert.equal(result.runtimeBounds['search-hub'].complete,true);
      assert.ok(result.runtimeBounds['search-hub'].requests >= 2);
      assert.ok(result.runtimeBounds['search-hub'].examined > 0);
      assert.equal(result.evidence.rosterUnread.members,5);
      console.log(`reference ${protocol.kind}: ${JSON.stringify({seedSeconds:result.seedSeconds, bounds:Object.fromEntries(Object.entries(result.runtimeBounds).map(([k,{pages,...v}]) => [k,v])),checks:result.checks.map(({name,ok}) => ({name,ok}))})}`);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  }
});

import { verdict, recordRun } from './bounds.mjs';
test('JSONL records a run without green rather than skipping it', () => {
  const dir = mkdtempSync(join(tmpdir(),'bounds-no-green-'));
  try {
    const result = {reportedGreen:false,pinUnchanged:true,verify:{ok:true},exitCode:0,timedOut:false};
    result.green = verdict(result,result);
    const metrics = join(dir,'metrics/boundsbar.jsonl'); recordRun(metrics,dir,result);
    const lines = readFileSync(metrics,'utf8').trim().split('\n');
    assert.equal(lines.length,1); assert.equal(JSON.parse(lines[0]).green,false);
    assert.equal(JSON.parse(readFileSync(join(dir,'runner-result.json'),'utf8')).green,false);
    assert.equal(verdict({...result,reportedGreen:true},result),true);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('walk preserves raw cuts and cannot relabel a final incomplete answer', async () => {
  const plain = await walkSearch(async () => ({data:[],complete:false,cut:'meter',meter:{examined:8193,indexEntries:7}}),ONE,'hub');
  assert.equal(plain.complete,false); assert.equal(plain.examined,8193); assert.equal(plain.requests,1);
  let n=0;
  const continued = await walkSearch(async () => ++n === 1 ?
    {data:[],complete:false,cut:'meter',next:'resume',meter:{examined:8193,indexEntries:7}} :
    {data:[],complete:true,meter:{examined:2,indexEntries:1}},ONE,'hub');
  assert.equal(continued.complete,true); assert.equal(continued.requests,2); assert.equal(continued.examined,8195);
  assert.equal(continued.pages[0].complete,false); assert.equal(continued.pages[0].cut,'meter');
});
