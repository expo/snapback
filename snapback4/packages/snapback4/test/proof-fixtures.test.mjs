import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { loadFixtures } from '../dist/proof-fixtures.js';

test('loadFixtures resolves only typed leaves at one dev clock and returns reset-ready rows', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'surf3-proof-fixtures-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fields = { at: 'Time', optional: { Optional: 'Time' }, times: { List: { of: 'Time', max: 4 } }, text: { Text: { max: 40 } }, json: { Json: { max: 1000 } } };
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url); response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url === '/dev/catalog' ? { tables: [{ name: 'events', fields }] } : { now: 100_000_000 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(dir, 'events.jsonl'), JSON.stringify({ id: 'e', at: 'now+2h', optional: 'now-1h', times: ['now', 'now+1ms'], text: 'now+2h', json: { at: 'now' } }) + '\n');
  writeFileSync(join(dir, 'test.cases.jsonl'), 'not a row file\n');
  assert.deepEqual(await loadFixtures(dir, { url }), [{ table: 'events', row: { id: 'e', at: 107_200_000, optional: 96_400_000, times: [100_000_000, 100_000_001], text: 'now+2h', json: { at: 'now' } } }]);
  assert.deepEqual(requests.sort(), ['/dev/catalog', '/dev/status']);
  requests.length = 0;
  assert.equal((await loadFixtures(dir, { url, now: 200_000_000 }))[0].row.at, 207_200_000);
  assert.deepEqual(requests, ['/dev/catalog']);
  for (const bad of ['now+0h', 'now+wat', 'now+9007199254740991w', 'now-999999999w']) {
    writeFileSync(join(dir, 'events.jsonl'), JSON.stringify({ at: bad }));
    await assert.rejects(loadFixtures(dir, { url }), /E_FIXTURE_TIME: events.jsonl:1.at/);
  }
  writeFileSync(join(dir, 'events.jsonl'), '[]\n');
  await assert.rejects(loadFixtures(dir, { url }), /E_INPUT.*expected a row object/);
  writeFileSync(join(dir, 'unknown.jsonl'), '{}\n');
  writeFileSync(join(dir, 'events.jsonl'), '{}\n');
  await assert.rejects(loadFixtures(dir, { url }), /unknown table unknown/);
});

test('loadFixtures refuses bad clocks, durations and bounded catalog failure', async () => {
  await assert.rejects(loadFixtures('.', { url: 'http://127.0.0.1:1', timeoutMs: 0 }), /E_PROOF_USAGE/);
  await assert.rejects(loadFixtures('.', { url: 'http://127.0.0.1:1', timeoutMs: 1000 }), /fetch failed/);
});

for (const credentials of [{ persona: 'alice' }, { headers: { authorization: 'Bearer test' } }]) {
  test(`loadFixtures sends ${Object.keys(credentials)[0]} on catalog and clock reads`, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'reg-fixtures-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const requests = [];
    const server = createServer((req, res) => {
      requests.push([req.url, req.headers]);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url === '/' ? { tables: [] } : { now: 1 }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    await loadFixtures(dir, { url: `http://127.0.0.1:${server.address().port}`, ...credentials });
    assert.deepEqual(requests.map(([path]) => path).sort(), ['/', '/dev/status']);
    for (const [, headers] of requests) {
      if (credentials.persona) assert.equal(headers['x-snapback-persona'], 'alice');
      else assert.equal(headers.authorization, 'Bearer test');
    }
  });
}
test('loadFixtures preserves auth refusals', async t => {
  const server = createServer((req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"denied":{"code":"E_AUTH"}}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(loadFixtures('.', { url: `http://127.0.0.1:${server.address().port}` }), /^Error: E_AUTH: loadFixtures could not read the catalog; pass \{ persona \} or \{ headers \}$/);
});
