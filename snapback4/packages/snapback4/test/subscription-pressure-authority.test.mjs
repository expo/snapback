import test from 'node:test';
import assert from 'node:assert/strict';
import { sdk } from './helpers/answers-stay.mjs';
const { LocalReads, localWatch } = await import(new URL('local-reads.js', sdk));
const makeWatch = () => localWatch(undefined, { kind: 'query', name: 'profile' }, {}, 'profile', 0, () => false);
const answer = { read: { data: 'saved', complete: true, fresh: true }, at: 0, tables: new Set(['profiles']), nextExpiry: null };
for (const [name, evidence] of Object.entries({
  notification: reads => reads.notified(['profiles'], 2),
  'apply publication': reads => reads.applied([], 2),
  'local commit': reads => reads.committed([], 'admit', ['messages']),
  'scope cut': reads => reads.withdrawScopes([], { watermark: 2, events: [{ kind: 'scope', table: 'messages', data: ['room'] }] }, false),
  'partition refusal': reads => reads.refuse([], { code: 'E_TEST', family: 'rule', message: 'denied' }),
  reset: reads => reads.clear([]),
})) test(`${name}: one authority revision retires detached and pending answers`, () => {
  const reads = new LocalReads(), watch = makeWatch(); watch.publish(answer.read);
  reads.detach(watch); const pendingAuthority = reads.revision;
  evidence(reads);
  assert.notEqual(reads.revision, pendingAuthority, 'pending publication must never regain its old authority');
  reads.restore(watch, true, null);
  assert.deepEqual(watch.snapshot, { loading: true }, 'detached reuse observes the same boundary');
});
test('a known quiet poll preserves detached and pending authority without another counter', () => {
  const reads = new LocalReads(), watch = makeWatch(); watch.publish(answer.read);
  const saved = watch.snapshot;
  reads.detach(watch); const authority = reads.revision;
  reads.notified([], 1, false);
  reads.restore(watch, true, null);
  assert.equal(reads.revision, authority, 'no change evidence must not exhaust bounded query retries');
  assert.equal(watch.snapshot, saved);
});
test('every terminal refusal advances authority, even when the same refusal repeats without owners', () => {
  const reads = new LocalReads(), denied = { code: 'E_TEST', family: 'rule', message: 'denied' };
  for (let i = 0; i < 3; i++) {
    const authority = reads.revision;
    reads.refuse([], denied);
    assert.ok(reads.revision > authority);
  }
});
test('empty advancing evidence is unknown; quiet empty and known disjoint footprints preserve memory', () => {
  const reads = new LocalReads();
  reads.serverAnswers.set('profile', answer, { ticket: reads.serverAnswers.begin(), seq: 1 });
  reads.notified([], 1, false); assert.equal(reads.serverAnswers.get('profile'), answer);
  reads.notified(['messages'], 2); assert.equal(reads.serverAnswers.get('profile'), answer);
  reads.notified([], 3); assert.equal(reads.serverAnswers.get('profile'), undefined);
  const watch = makeWatch(); watch.tables = new Set(['profiles']);
  reads.detach(watch); reads.resume(watch);
  assert.equal(watch.changeCut, 3, 'empty advance also supplies the conservative inherited cut');
});
