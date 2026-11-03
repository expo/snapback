// @ref LLP 3000.001.001#61-the-acquisition-page — a cold pin inspects only the partition's synced tables; ephemeral and unsynced tables are never device rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sdk, opener } from './helpers/answers-stay.mjs';
import { server } from './helpers/app-server.mjs';
import { source as ephemeralSource } from './helpers/ephemeral-server.mjs';
const { createLocalClient } = await import(new URL('local.js', sdk));
for (const host of ['process', 'wasm']) test(`${host}: a schema with ephemeral tables acquires progressively on a cold device`, async t => {
  const f = await server(t, undefined, ephemeralSource);
  const client = await createLocalClient({ url: f.url, persona: 'bob', device: opener(host, join(f.dir, host)) });
  t.after(() => client.close());
  await client.sync();
  assert.equal(client.acquired, true, `${host}: explicit sync() on a cold device must acquire the partition`);
});
