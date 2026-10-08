// @ref LLP 3000.023#11 — review reproduction: complete server commit intervals.
import test from 'node:test';
import assert from 'node:assert/strict';
const { setup, program, q, m } = await import('./helpers/one-shot.mjs');
const source = program.replace('  name: text\n  read <- allow', '  name: text\n  update <- allow\n  read <- allow') + `
mutation rename(name: text): server
  update profiles['bob'] { name }
`;
for (const tier of ['wasm', 'process']) for (const marker of [undefined, false, 'true', {}]) test(`${tier}: uncertified settlement (${JSON.stringify(marker)}) remains unknown`, async t => {
  const f = await setup(t, tier, { program: source, device: core => ({ ...core, async call(request, commit) {
    const mask = result => {
      if (request.op !== 'settle') return result;
      const { settlement_unchanged: _proof, ...rest } = result;
      return marker === undefined ? rest : { ...rest, settlement_unchanged: marker };
    };
    return mask(await core.call(request, result => commit?.(mask(result))));
  } }) });
  let rounds = 0;
  f.controls.boundary = async () => {
    if (++rounds === 1) assert.equal((await f.client.mutate(m('rename'), { name: 'independent' })).state, 'sent');
  };
  assert.equal((await f.client.query(q('item'), {})).data?.body, 'image-1');
  assert.ok(rounds > 1, 'the static operation footprint alone cannot certify restore/replay');
});

for (const tier of ['online', 'wasm', 'process', 'app-online', 'app-wasm', 'app-process']) test(`${tier}: unrelated commits do not exhaust a server aggregate`, async t => {
  const f = await setup(t, tier, { program: source });
  let rounds = 0;
  f.controls.boundary = async () => {
    rounds++;
    assert.equal((await f.client.mutate(m('rename'), { name: `revision-${rounds}` })).state, 'sent');
    if (f.client.sync) await f.client.sync();
  };
  const read = await f.client.query(q('insights'), {});
  console.log(JSON.stringify({ tier, rounds, read }));
  assert.ok(rounds > 0, 'the publication scheduling hook ran');
  assert.equal(read.data, 1, JSON.stringify(read));
  assert.equal(rounds, 1);
});

for (const tier of ['wasm','process','app-wasm','app-process']) for (const evidence of ['fields','unknown','gap']) test(`${tier}: field-disjoint server commits use ${evidence} evidence`, async t => {
  const source = program.replace('table members:', 'table members:\n  unused: int?\n  update <- allow') + `
query bodyOnly():
  return messages['item'].body
mutation otherField(n: int): server
  update members['bob'] { unused: n }
`;
  const f = await setup(t, tier, { program: source, fetch: async (path, init, send) => {
    const response = await send();
    if (path !== '/sync' || evidence === 'fields') return response;
    const json = await response.json();
    if (evidence === 'unknown') delete json.changes;
    else if (json.changes) json.changes.after = json.changes.through + 1;
    return Response.json(json);
  } });
  let rounds = 0;
  f.controls.boundary = async () => {
    rounds++;
    assert.equal((await f.post('/m/otherField', { id: `external-${rounds}`, args: { n: rounds } })).state, 'sent');
    await f.client.sync();
  };
  const read = await f.client.query(q('bodyOnly'), {});
  if (evidence === 'fields') { assert.equal(read.data, 'image-1', JSON.stringify(read)); assert.equal(rounds, 1); }
  else { assert.equal(read.denied?.code, 'E_QUERY_RETRY', JSON.stringify(read)); assert.equal(rounds, 4); }
});

for (const tier of ['wasm', 'process', 'app-wasm', 'app-process']) test(`${tier}: sync covering a relevant online-only commit fences the old answer`, async t => {
  const f = await setup(t, tier, { program: source });
  let rounds = 0;
  f.controls.boundary = async () => {
    if (++rounds !== 1) return;
    assert.equal((await f.post('/m/rename', { id: 'external-rename', args: { name: 'After' } })).state, 'sent');
    await f.client.sync();
  };
  const read = await f.client.query(q('profile'), {});
  console.log(JSON.stringify({ tier, read, rounds }));
  assert.equal(read.data?.name, 'After');
});


test('compiler summaries include inlined helpers and both branches', async t => {
  const { fixture } = await import('./helpers/answers-stay.mjs');
  const f = await fixture(t, source + `
fn readHelper():
  return exists profiles['bob']
fn writeHelper(name: text):
  update profiles['bob'] { name }
  return null
query helperBranch(flag: bool):
  if flag:
    return readHelper()
  return exists messages['item']
mutation writeBranch(flag: bool, name: text): server
  if flag:
    ignored = writeHelper(name)
  else:
    update messages['item'] { body: 'other branch' }
`);
  const backend = await fetch(f.url + '/schema', { headers: { 'x-snapback-persona': 'bob' } }).then(r => r.json());
  const reads = backend.programs.find(p => p.name === 'helperBranch').settlement.reads;
  const writes = backend.programs.find(p => p.name === 'writeBranch').settlement.writes;
  for (const table of ['profiles', 'messages']) {
    assert.equal(Object.hasOwn(reads, table), true);
    assert.equal(Object.hasOwn(writes, table), true);
  }
  assert.equal(Object.hasOwn(reads, 'members'), true, 'authorization closure');
});
