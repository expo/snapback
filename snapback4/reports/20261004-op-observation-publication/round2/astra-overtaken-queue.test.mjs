// Astra round-1 reproducer; optional OP proof hooks permits the pre-OP control.
// @ref LLP 3000.023#10 — a whole server cut covers repeated evidence, never local authority.
import test from 'node:test';
import assert from 'node:assert/strict';
const { evaluateLocal } = await import(process.env.REVIEW_SDK + '/local-query.js');
const { LocalReads, localWatch, publishedApplyCut } = await import(process.env.REVIEW_SDK + '/local-reads.js');

const op = { kind: 'query', name: 'page' };
function fixture() {
  const reads = new LocalReads(), watch = localWatch(undefined, op, {}, 'page', 0, () => false);
  watch.tables = new Set(['rows']); reads.queued([]);
  const version = watch.changeVersion, authority = reads.revision;
  const f = { reads, watch, requests: 0, after: false, seq: 40, during: () => {}, late: () => {},
    outcome: { data: [], unknown: true, speculative: true, tables: ['rows'] } };
  f.env = {
    backend: { programs: [{ name: 'page', body: [{ table: 'rows' }] }],
      schema: { tables: { rows: { sync: {}, leave: 'until-revoked' } } } },
    incarnation: 0, get authority() { return reads.revision; },
    current: () => watch.changeVersion === version, serverCurrent: reads.serverCurrent?.(watch),
    retainedCurrent: reads.retainedCurrent?.(),
    credentialRevision: 0, partitionCurrent: true, nativeReady: true,
    principal: 'bob', link: 'online', caughtUp: true, identityChecked: true,
    signal: new AbortController().signal, unavailable: () => null,
    deviceNow: () => 1, serverNow: () => 1,
    queued: async () => { if (f.after) f.late(); reads.queued([]); return []; },
    pending: tables => reads.pending(tables),
    call: async () => ({ ok: f.outcome }),
    post: async () => { f.requests++; f.during(); f.after = true;
      return { ok: true, obsoleteAuth: false, json: { data: ['new'], complete: true, seq: f.seq } }; },
    serverAnswers: reads.serverAnswers.view(),
  };
  f.evidence = (cut = 40) => {
    reads.notified(['rows'], cut); reads.changed(watch, cut);
    reads.queued([]); reads.committed([watch], 'apply', ['rows'], [], cut);
    reads.applied([watch], cut);
  };
  f.run = () => evaluateLocal(f.env, op, {}, 0, authority);
  return f;
}


for (const boundary of ['none','disjoint-notification','published-empty-commit','applied']) for(const predicted of [['rows/own'],undefined]) {
 test(`new ${predicted?'known':'opaque'} prediction with ${boundary}`,async()=>{
  const f=fixture();f.env.inputsCurrent=f.reads.inputsCurrent?.(f.watch);
  f.outcome={data:['before-prediction'],complete:true,unknown:false,tables:['rows'],watermark:1};
  const entered=Promise.withResolvers(),release=Promise.withResolvers();
  f.env.followingPending=async()=>{
   const queued=f.reads.readQueued(async()=>{entered.resolve();await release.promise;return [{id:'new',predictable:true,predicted}];},[f.watch]);
   await entered.promise;
   if(boundary==='disjoint-notification')f.reads.notified(['other'],40);
   if(boundary==='published-empty-commit')f.reads.committed([], 'apply', [], [], 40);
   if(boundary==='applied')f.reads.applied([],40);
   release.resolve();const discovered=await queued;assert.equal(discovered.length,1);
   return false;
  };
  const result=await f.run();console.log('REVIEW_DISCOVERY',JSON.stringify({boundary,predicted,read:result.read,proof:result.publicationCurrent?.(),predictions:f.reads.predictions}));
  assert.ok(!('data' in result.read),'newly discovered prediction must fence the earlier non-empty local candidate');
 });
}
