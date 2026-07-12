// ENG-24363: config material never enters argv, names/pool shapes are checked
// before write, and generation alone cannot falsely attest a partial write.
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  attestApplied,
  buildBulkPayload,
  parseArgs,
  validateRequestedEntries,
} from '../config-set.mjs';

const status = {
  generation: 4,
  declarations: [
    { name: 'caltrainFeed', state: 'set', poolMembers: 2 },
    { name: 'directions', state: 'missing', poolMembers: 0 },
  ],
};
const encoded = validateRequestedEntries(status, { caltrainFeed: ['one', 'two'] });
assert.deepEqual(encoded, { caltrainFeed: '["one","two"]' });
assert.throws(() => validateRequestedEntries(status, { typo: ['secret'] }), /not declared/);
assert.throws(() => validateRequestedEntries(status, { directions: [] }), /nonempty array/);
assert.throws(() => validateRequestedEntries(status, { directions: ['ok', 4] }), /nonempty strings/);
assert.throws(() => parseArgs(['--entry', 'directions=["must-not-echo"]']), (error) => {
  assert.ok(!error.message.includes('must-not-echo'));
  return /refused/.test(error.message);
});
assert.equal(parseArgs(['--entries-stdin', '--url', 'https://example.invalid']).entriesStdin, true);
assert.deepEqual(buildBulkPayload('all-aboard', encoded, 5), {
  SNAPBACK_SECRET_ALL_ABOARD_CALTRAIN_FEED: '["one","two"]',
  SNAPBACK_CONFIG_GENERATION: '5',
});

let correctMembers = false;
let sawAdminToken = false;
const server = http.createServer((request, response) => {
  sawAdminToken ||= request.headers['x-snapback-admin-token'] === 'operator-token';
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    generation: 5,
    declarations: [{
      name: 'caltrainFeed',
      state: correctMembers ? 'set' : 'missing',
      poolMembers: correctMembers ? 2 : 0,
    }],
  }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const pending = await attestApplied(base, 5, {
    adminToken: 'operator-token',
    expectedEntries: { caltrainFeed: ['one', 'two'] },
    timeoutMs: 80,
    intervalMs: 10,
  });
  assert.equal(pending, 'pending', 'generation without member state must not attest applied');
  correctMembers = true;
  const applied = await attestApplied(base, 5, {
    adminToken: 'operator-token',
    expectedEntries: { caltrainFeed: ['one', 'two'] },
    timeoutMs: 200,
    intervalMs: 10,
  });
  assert.equal(applied, 'applied');
  assert.equal(sawAdminToken, true);
} finally {
  server.close();
}

console.log('cloudflare config-set tests: stdin-only input, declaration validation, and member attestation passed');
