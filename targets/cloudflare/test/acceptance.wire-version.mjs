// LLP 0094 §0B wire-version negotiation, hosted arm (B1+B3): the open-time
// offer matrix (known binds + echoes, unknown refuses, absent = legacy), the
// re-open binding immutability, the §0C.5 authInvalidationProtocol
// alignment, and the §0B.4 kit-socket classification matrix with the
// `/live/stream` proof-socket exemption.
//
// @ref LLP 0094#0b3-the-wireversion-open-time-offer — hosted B1 must READ the
//   offer (the open decoder is otherwise open, §0C.3) and echo the bound
//   version, the hosted arm's only runtime version witness.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { startProof } from './harness.mjs';

let checks = 0;
const check = (label, condition, detail) => {
  assert.ok(condition, `${label}: ${detail ?? 'failed'}`);
  checks += 1;
};

// A raw HTTP websocket-handshake request over the real loopback listener.
// Miniflare's dispatchFetch tunnels upgrades through the `ws` client, which
// client-side rejects duplicate subprotocol tokens and hides refusal bodies —
// the §0B.4 matrix needs the server's own pre-upgrade HTTP responses.
const rawUpgrade = (base, path, headers) => new Promise((resolve, reject) => {
  const request = http.request(`${base}${path}`, {
    headers: {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-key': randomBytes(16).toString('base64'),
      'sec-websocket-version': '13',
      ...headers,
    },
  });
  request.on('upgrade', (response, socket) => {
    socket.destroy();
    resolve({ status: 101, headers: response.headers });
  });
  request.on('response', (response) => {
    const body = [];
    response.on('data', (chunk) => body.push(chunk));
    response.on('end', () => {
      let parsed = null;
      try {
        parsed = JSON.parse(Buffer.concat(body).toString('utf8'));
      } catch {
        parsed = null;
      }
      resolve({ status: response.statusCode, body: parsed });
    });
  });
  request.on('error', reject);
  request.end();
});

const proof = await startProof({ port: 0 });
try {
  const open = async (body) => {
    const response = await proof.raw('/connection/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const code = (body) => body?.diagnostic?.code ?? body?.code;

  // --- open-time offer matrix (§0B.3) ------------------------------------

  const legacy = await open({ connectionId: 'wire-legacy' });
  check('legacy open is admitted', legacy.status === 200, JSON.stringify(legacy));
  check(
    'legacy open has no echo member',
    !('wireVersion' in legacy.body),
    JSON.stringify(legacy.body),
  );

  const bound = await open({ connectionId: 'wire-bound', wireVersion: 'snapback.v1' });
  check('known offer binds', bound.status === 200, JSON.stringify(bound));
  check(
    'known offer is echoed as the bound-version witness',
    bound.body.wireVersion === 'snapback.v1',
    JSON.stringify(bound.body),
  );

  const aliased = await open({ connectionId: 'wire-alias', wire_version: 'snapback.v1' });
  check(
    'the snake_case alias is admitted and echoed',
    aliased.status === 200 && aliased.body.wireVersion === 'snapback.v1',
    JSON.stringify(aliased),
  );

  for (const [label, offer] of [
    ['a v2 token', 'snapback.v2'],
    ['a malformed suffix', 'snapback.v1.0'],
    ['a non-string offer', 1],
  ]) {
    const unknown = await open({ wireVersion: offer });
    check(
      `unknown offer (${label}) refuses`,
      unknown.status === 400 && code(unknown.body) === 'SNAPBACK_WIRE_VERSION_UNSUPPORTED',
      JSON.stringify(unknown),
    );
  }
  const nullableAbsent = await open({ connectionId: 'wire-null', wireVersion: null });
  check(
    'null follows the Rust Option/schema semantics and opens a legacy lineage',
    nullableAbsent.status === 200 && !('wireVersion' in nullableAbsent.body),
    JSON.stringify(nullableAbsent),
  );
  const conflicting = await open({ wireVersion: 'snapback.v1', wire_version: 'snapback.v2' });
  check(
    'conflicting camelCase/snake_case duplicates refuse',
    conflicting.status === 400 && code(conflicting.body) === 'SNAPBACK_WIRE_VERSION_UNSUPPORTED',
    JSON.stringify(conflicting),
  );

  // --- re-open matrix (§0B.3 immutability) --------------------------------

  const reopenAbsent = await open({
    connectionId: 'wire-bound',
    previousToken: bound.body.connectionToken,
  });
  check(
    'offerless re-open of an explicit lineage keeps the echo',
    reopenAbsent.status === 200 && reopenAbsent.body.wireVersion === 'snapback.v1',
    JSON.stringify(reopenAbsent),
  );

  const reopenConfirm = await open({
    connectionId: 'wire-bound',
    previousToken: bound.body.connectionToken,
    wireVersion: 'snapback.v1',
  });
  check(
    'equal-offer re-open is admitted',
    reopenConfirm.status === 200 && reopenConfirm.body.wireVersion === 'snapback.v1',
    JSON.stringify(reopenConfirm),
  );

  const reopenUnknown = await open({
    connectionId: 'wire-bound',
    previousToken: bound.body.connectionToken,
    wireVersion: 'snapback.v2',
  });
  check(
    'an unknown candidate on re-open refuses UNSUPPORTED (classification precedes equality)',
    reopenUnknown.status === 400 && code(reopenUnknown.body) === 'SNAPBACK_WIRE_VERSION_UNSUPPORTED',
    JSON.stringify(reopenUnknown),
  );
  const reopenSurvived = await open({
    connectionId: 'wire-bound',
    previousToken: bound.body.connectionToken,
  });
  check(
    'a refused re-open leaves the grant undisturbed',
    reopenSurvived.status === 200
      && reopenSurvived.body.connectionToken === bound.body.connectionToken,
    JSON.stringify(reopenSurvived),
  );

  const legacyConfirm = await open({
    connectionId: 'wire-legacy',
    previousToken: legacy.body.connectionToken,
    wireVersion: 'snapback.v1',
  });
  check(
    'a confirming v1 offer on a legacy lineage stays admitted and never echoes (confirmation is not upgrade)',
    legacyConfirm.status === 200 && !('wireVersion' in legacyConfirm.body),
    JSON.stringify(legacyConfirm),
  );

  // --- §0C.5 authInvalidationProtocol alignment ---------------------------

  const invalidationUnknown = await open({ authInvalidationProtocol: 2 });
  check(
    'an unknown authInvalidationProtocol refuses instead of silently degrading',
    invalidationUnknown.status === 400
      && code(invalidationUnknown.body) === 'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED',
    JSON.stringify(invalidationUnknown),
  );
  const invalidationKnown = await open({ connectionId: 'wire-inval', authInvalidationProtocol: 1 });
  check(
    'the known authInvalidationProtocol offer stays admitted',
    invalidationKnown.status === 200,
    JSON.stringify(invalidationKnown),
  );
  const invalidationConflict = await open({
    authInvalidationProtocol: 1,
    auth_invalidation_protocol: 2,
  });
  check(
    'conflicting authInvalidationProtocol aliases refuse instead of preferring one',
    invalidationConflict.status === 400
      && code(invalidationConflict.body) === 'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED',
    JSON.stringify(invalidationConflict),
  );

  // --- kit-socket classification matrix (§0B.4, B1 present-offer + B3 absent)

  const base = await proof.url();
  const upgrade = (protocols) => rawUpgrade(base, `/live/${bound.body.connectionId}/stream`, {
    'x-snapback-connection-token': bound.body.connectionToken,
    ...(protocols === null ? {} : { 'sec-websocket-protocol': protocols }),
  });

  const admitted = await upgrade(
    'snapback.v2, snapback.v1, snapback.v1, snapback.auth-client.1, '
      + `snapback.connection-token.${bound.body.connectionToken}`,
  );
  check(
    'the bound version present wins over duplicates and extra candidates',
    admitted.status === 101,
    JSON.stringify(admitted),
  );
  check(
    'the accepted socket echoes the bound version',
    admitted.headers['sec-websocket-protocol'] === 'snapback.v1',
    JSON.stringify(admitted.headers),
  );

  const socketUnknown = await upgrade('snapback.v2, snapback.v1.0');
  check(
    'unknown socket candidates refuse UNSUPPORTED (never MISMATCH)',
    socketUnknown.status === 400
      && code(socketUnknown.body) === 'SNAPBACK_WIRE_VERSION_UNSUPPORTED',
    JSON.stringify(socketUnknown),
  );

  const socketBearerOnly = await upgrade(
    `snapback.connection-token.${bound.body.connectionToken}`,
  );
  check(
    'a bearer carrier alone is not a version offer (absent class, B3)',
    socketBearerOnly.status === 400
      && code(socketBearerOnly.body) === 'SNAPBACK_WIRE_VERSION_REQUIRED',
    JSON.stringify(socketBearerOnly),
  );

  const socketAbsent = await upgrade(null);
  check(
    'an offerless kit upgrade refuses REQUIRED from B3',
    socketAbsent.status === 400 && code(socketAbsent.body) === 'SNAPBACK_WIRE_VERSION_REQUIRED',
    JSON.stringify(socketAbsent),
  );

  // --- proof-socket exemption (§0B.4) -------------------------------------

  const proofSocket = await rawUpgrade(base, '/live/stream', {});
  check(
    'the /live/stream proof socket stays offerless-admitted (§0B.4 exemption)',
    proofSocket.status === 101,
    JSON.stringify(proofSocket),
  );

  assert.equal(checks, 24, 'wire-version acceptance check inventory drifted');
  console.log(`cloudflare wire-version acceptance: ${checks}/24 checks passed`);
} finally {
  await proof.dispose();
}
