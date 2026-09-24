import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadAuthority } from '../dist/read-authority.js';
import { ReadObservation } from '../dist/read-observation.js';
const backend = { schema: { tables: {
  secrets: { indexes: {}, rules: { read: { Exists: { table: 'members', index: 'groupPrincipal', key: [{ Field: 'group' }, 'Viewer'] } } } },
  members: { indexes: { groupPrincipal: { components: [{ Column: 'group' }, { Column: 'principal' }] } }, rules: { read: 'Allow' } },
  controls: { indexes: {}, rules: { read: 'Allow' } },
} }, programs: [
  { name: 'reassign', body: [{ Update: { table: 'members', patch: { Object: { principal: 'new' } } } }] },
  { name: 'markRead', body: [{ Update: { table: 'members', patch: { Object: { readAt: 123 } } } }] },
] };
const apply = (authority, events, published = true, extra = {}) => authority.committed({ op: 'apply', page: { events, ...extra } }, { published, touched: [] }, backend);

test('authority withdrawal survives private staging and another owner finishing the transfer', () => {
  const authority = new ReadAuthority();
  assert.equal(apply(authority, []), true, 'first publication may inherit an old withdrawal');
  assert.equal(apply(authority, [{ kind: 'put', table: 'controls' }]), false, 'unrelated ordinary updates preserve retention');
  assert.equal(apply(authority, [{ kind: 'scope', table: 'secrets' }], false), false, 'unpublished staging does not change authority');
  assert.equal(apply(authority, []), true, 'terminal empty page applies the earlier withdrawal');
  assert.equal(apply(authority, [], true, { requested_watermark: 20, captured_watermark: 10 }), true, 'another owner staged the withdrawal');
  assert.equal(apply(authority, [{ kind: 'put', table: 'members' }]), true, 'membership replacement can revoke');
  assert.equal(apply(authority, [{ kind: 'del', table: 'controls' }]), true, 'any removed row invalidates');
});

test('predicted authority changes and settlement reset answers while read markers do not', () => {
  const authority = new ReadAuthority();
  for (const [op, changed] of [['reassign', true], ['markRead', false], ['unknown', true]]) {
    assert.equal(authority.committed({ op: 'admit', entry: { id: op, op } }, { predicted: ['members/1'] }, backend), changed);
    assert.equal(authority.committed({ op: 'settle', id: op }, {}, backend), changed);
  }
  assert.equal(authority.committed({ op: 'settle', id: 'other-owner' }, {}, backend), true);
  assert.equal(authority.committed({ op: 'clear_rows' }, {}, backend), true);
  const watch = Object.assign(new ReadObservation(), { expiryTimer: null });
  watch.publish({ data: ['private'], complete: true, cut: null, fresh: true });
  watch.publish({ loading: true });
  const remembered = new Map([['query', watch.snapshot]]);
  authority.clear([watch], remembered);
  assert.deepEqual(watch.snapshot, { loading: true });
  assert.equal(remembered.size, 0);
  assert.equal(authority.revision, 1, 'old in-flight queries have a different authority revision');
});


test('adoption forgets old pending-write authority classifications', () => {
  const authority = new ReadAuthority();
  assert.equal(authority.committed({ op: 'admit', entry: { id: 'pending', op: 'markRead' } }, { predicted: ['members/1'] }, backend), false);
  const adopted = structuredClone(backend);
  adopted.schema.tables.members.rules.read = { Eq: [{ Field: 'readAt' }, { Literal: 123 }] };
  assert.equal(authority.committed({ op: 'settle', id: 'pending' }, {}, adopted), true, 'settlement cannot trust the old rule dependency classification');
});
