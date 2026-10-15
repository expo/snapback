import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { server } from './helpers/app-server.mjs';
import { hangBudget } from './helpers/wait.mjs';

const wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
const now = 4_000_000_000_000;
const future = now + 10_000;
const viewer = 'dev:alice';
const source = `use personas alice, bob
table groups:
  total: count aggregateKids by .group
  public
  sync public
table parents:
  until: time
  expire at .until
  public
  update <- allow
  sync public
table cascadeKids:
  parent: parents on delete cascade
  cap 4 by parent
  public
  insert <- allow
  sync public
table nullableKids:
  parent: parents ? on delete set null
  cap 4 by parent
  public
  sync public
table blockers:
  parent: parents on delete restrict
  cap 4 by parent
  public
  sync public
table aggregateKids:
  parent: parents on delete cascade
  group: groups
  cap 4 by parent
  public
  insert <- allow
  sync public
table privateParents:
  until: time
  expire at .until
  public
  update <- allow
  sync public
table privateKids:
  parent: privateParents on delete cascade
  owner: principal
  cap 4 by parent
  read <- .owner = viewer
  sync to .owner
mutation setExpiry(parent: parents, until: time):
  update parents[parent] { until }
mutation expireWithChild(parent: parents):
  insert cascadeKids { id: 'same-mutation-child', parent }
  update parents[parent] { until: 0 }
mutation expireAggregate(parent: parents, group: groups):
  insert aggregateKids { id: 'aggregate-born', parent, group }
  update parents[parent] { until: 0 }
mutation expirePrivate(parent: privateParents):
  update privateParents[parent] { until: 0 }
query parent(id: id):
  return parents[id]
query cascadeKid(id: id):
  return cascadeKids[id]
query nullableKid(id: id):
  return nullableKids[id]
query blocker(id: id):
  return blockers[id]
query aggregateKid(id: id):
  return aggregateKids[id]
query privateParent(id: id):
  return privateParents[id]
query group(id: id):
  return groups[id] { total }
`;

const ok = result => {
  assert.equal(result.denied, undefined, JSON.stringify(result));
  return result.ok;
};
const denied = result => result.denied ?? result.ok?.denied;
const authored = value => {
  if (Array.isArray(value)) return value.map(authored);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'pending').map(([key, item]) => [key, authored(item)]));
};

test('wasm predicts commit-end expiry actions exactly like the server', { timeout: hangBudget(20) }, async t => {
  const host = await server(t, undefined, source);
  const headers = { 'x-snapback-persona': 'alice', 'content-type': 'application/json' };
  const post = async (path, body) => {
    const response = await fetch(host.url + path, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(hangBudget()) });
    const answer = await response.json();
    assert.equal(response.status, 200, JSON.stringify(answer));
    return answer;
  };
  const parent = id => ({ table: 'parents', row: { id, until: future } });
  const rows = [
    { table: 'groups', row: { id: 'g' } },
    ...['cascade', 'nullable', 'restrict', 'same', 'empty', 'aggregate', 'future'].map(parent),
    { table: 'cascadeKids', row: { id: 'cascade-child', parent: 'cascade' } },
    { table: 'nullableKids', row: { id: 'nullable-child', parent: 'nullable' } },
    { table: 'blockers', row: { id: 'blocker', parent: 'restrict' } },
    { table: 'aggregateKids', row: { id: 'aggregate-old', parent: 'aggregate', group: 'g' } },
    { table: 'privateParents', row: { id: 'private', until: future } },
    { table: 'privateKids', row: { id: 'hidden', parent: 'private', owner: 'dev:bob' } },
  ];
  assert.equal((await post('/seed', rows)).seeded, rows.length);

  const backendResponse = await fetch(host.url + '/schema', { headers });
  assert.equal(backendResponse.status, 200);
  const backend = await backendResponse.json();
  const opener = webDevice({ wasm, persist: memoryPersistence() });
  const core = await opener.open('expiry-reference-actions', backend);
  t.after(() => core.close());
  const engine = await opener.engineInfo();
  const snapshot = await fetch(host.url + '/sync', {
    method: 'POST',
    headers: { ...headers, 'x-snapback-device': JSON.stringify(engine) },
    body: JSON.stringify({ generation: backend.generation, from: 0, limit: 1000, after: null, stream: false, pending: [] }),
    signal: AbortSignal.timeout(hangBudget()),
  }).then(response => response.json());
  assert.equal(snapshot.snapshot, true, JSON.stringify(snapshot));
  assert.equal(snapshot.more, false, JSON.stringify(snapshot));
  ok(await core.call({ op: 'apply', first: true, page: snapshot }));

  const local = async (name, args) => authored(ok(await core.call({ op: 'query', name, viewer, args, now })).data);
  const online = async (name, args) => authored((await post(`/q/${name}`, { args })).data);
  const predict = async (name, args) => core.call({ op: 'predict', name, viewer, args, now, newIds: [], entropy: 7 });
  const mutate = (name, args, id) => post(`/m/${name}`, { id, args });
  const parity = async (name, args) => assert.deepEqual(await local(name, args), await online(name, args), `${name} parity`);

  assert.deepEqual(await local('group', { id: 'g' }), { total: 1 }, 'the snapshot carries the confirmed aggregate');
  assert.deepEqual(
    await local('aggregateKid', { id: 'aggregate-old' }),
    { id: 'aggregate-old', parent: 'aggregate', group: 'g' },
    'the complete snapshot carries the old child that commit-end retirement must cascade',
  );

  assert.equal((await predict('setExpiry', { parent: 'cascade', until: 0 })).denied, undefined);
  assert.equal((await mutate('setExpiry', { parent: 'cascade', until: 0 }, 'server-cascade')).state, 'sent');
  await parity('parent', { id: 'cascade' });
  await parity('cascadeKid', { id: 'cascade-child' });
  assert.equal(await local('parent', { id: 'cascade' }), null);
  assert.equal(await local('cascadeKid', { id: 'cascade-child' }), null);

  assert.equal((await predict('setExpiry', { parent: 'nullable', until: 0 })).denied, undefined);
  assert.equal((await mutate('setExpiry', { parent: 'nullable', until: 0 }, 'server-nullable')).state, 'sent');
  await parity('parent', { id: 'nullable' });
  await parity('nullableKid', { id: 'nullable-child' });
  assert.equal((await local('nullableKid', { id: 'nullable-child' })).parent, null);

  const restricted = await predict('setExpiry', { parent: 'restrict', until: 0 });
  assert.equal(denied(restricted)?.code, 'E_REFERENCED', JSON.stringify(restricted));
  const serverRestricted = await mutate('setExpiry', { parent: 'restrict', until: 0 }, 'server-restrict');
  assert.equal(serverRestricted.state, 'failed', JSON.stringify(serverRestricted));
  assert.equal(serverRestricted.why.code, 'E_REFERENCED');
  await parity('parent', { id: 'restrict' });
  await parity('blocker', { id: 'blocker' });

  assert.equal((await predict('expireWithChild', { parent: 'same' })).denied, undefined);
  assert.equal((await mutate('expireWithChild', { parent: 'same' }, 'server-same')).state, 'sent');
  await parity('parent', { id: 'same' });
  await parity('cascadeKid', { id: 'same-mutation-child' });
  assert.equal(await local('cascadeKid', { id: 'same-mutation-child' }), null);

  assert.equal((await predict('setExpiry', { parent: 'empty', until: 0 })).denied, undefined);
  assert.equal((await mutate('setExpiry', { parent: 'empty', until: 0 }, 'server-empty')).state, 'sent');
  await parity('parent', { id: 'empty' });
  assert.equal(await local('parent', { id: 'empty' }), null);

  assert.deepEqual(await local('group', { id: 'g' }), { total: 1 });
  assert.equal((await predict('expireAggregate', { parent: 'aggregate', group: 'g' })).denied, undefined);
  assert.equal((await mutate('expireAggregate', { parent: 'aggregate', group: 'g' }, 'server-aggregate')).state, 'sent');
  await parity('parent', { id: 'aggregate' });
  await parity('aggregateKid', { id: 'aggregate-old' });
  await parity('aggregateKid', { id: 'aggregate-born' });
  await parity('group', { id: 'g' });
  assert.deepEqual(await local('group', { id: 'g' }), { total: 0 }, 'logless wasm nets +1 then -2 to the committed aggregate delta -1');

  assert.equal((await predict('setExpiry', { parent: 'future', until: future })).denied, undefined);
  assert.equal((await mutate('setExpiry', { parent: 'future', until: future }, 'server-future')).state, 'sent');
  await parity('parent', { id: 'future' });
  assert.equal((await local('parent', { id: 'future' })).until, future);

  const queued = ok(await core.call({ op: 'admit', entry: {
    id: 'private-expiry', seq: 1, op: 'expirePrivate', args: { parent: 'private' }, viewer, now,
    new_ids: [], predicted: [], predictable: true,
  } }));
  assert.equal(queued.predictable, false, JSON.stringify(queued));
  assert.deepEqual(queued.predicted, []);
  assert.notEqual(await local('privateParent', { id: 'private' }), null, 'queued incomplete coverage publishes no parent change');
  assert.equal((await mutate('expirePrivate', { parent: 'private' }, 'server-private')).state, 'sent', 'the server sees and cascades the hidden child');
});
