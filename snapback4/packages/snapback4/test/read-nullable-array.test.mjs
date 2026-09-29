// @ref LLP 3000.031#4 — Astra's generated nullable-array counterexample.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { server } from './helpers/app-server.mjs';
import { createClient } from '../dist/client.js';
import { presence } from '../dist/contract.js';

const source = `use personas alice
table rows:
  label: text <=40
  read <- allow
  online only
query maybe(flag: bool):
  if flag:
    return rows first 10 by byId
  return null
`;
test('generated nullable array: absent admits both [] and null, present keeps the array', async t => {
  const { url, dir } = await server(t, undefined, source);
  const generated = readFileSync(join(dir, 'snapback/generated/api.ts'), 'utf8');
  assert.match(generated, /maybe: Query<\{ flag: boolean \}, Rows\["rows"\]\[\] \| null>/);
  const client = createClient({ url, persona: 'alice' }); t.after(() => client.close());
  const query = { kind: 'query', name: 'maybe', runs: 'server' };
  for (const flag of [true, false]) {
    const read = await client.query(query, { flag });
    assert.equal(presence(read), 'absent');
    assert.deepEqual(read.data, flag ? [] : null);
    assert.equal(read.complete, true); assert.equal(read.cut, null);
  }
  const seeded = await fetch(url + '/seed', { method: 'POST', body: JSON.stringify([{ table: 'rows', row: { id: 'one', label: 'row' } }]) });
  assert.equal((await seeded.json()).seeded, 1);
  const read = await client.query(query, { flag: true });
  assert.equal(presence(read), 'present'); assert.equal(read.data[0].id, 'one');
});
