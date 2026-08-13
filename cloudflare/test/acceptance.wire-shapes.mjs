// Hosted response-shape audit (LLP 0094 §0C.6).
//
// The committed schemas under schemas/ are the wire contract on both arms;
// this suite is the ledger ticket's executable audit
// (issues/20260725-0094-hosted-response-shape-divergences.md). It has two
// halves:
//
//   1. Behavioral: drive every kit-route response lane the §0C.6 ledger
//      enumerates — success envelopes (mutation, live subscribe/unsubscribe)
//      and every error-emitter lane (gateway, parse, connection-token,
//      handler, platform, stale-deployment, coded-refusal) — and validate the
//      served bytes against the committed schemas with a real JSON Schema
//      validator. The versioned ErrorResponse requires its must-understand
//      formatVersion while admitting additive unknown top-level members, so
//      an emitter that drifts back to {ok, code, ...} or {error: ...} fails.
//
//   2. Static: scan the served sources (coordinator.js, gateway.js,
//      platform-errors.js) for literal-status 4xx/5xx `json(...)` emitters
//      that do NOT compose the committed Diagnostic via wireDiagnostic, and
//      pin the surviving set (proof/system/test lanes, documented below).
//      A NEW non-conformant error emitter changes the set and fails the
//      suite — the "fails when a new non-conformant emitter appears on a kit
//      route" gate the ticket owns.
//
// The in-band kit-socket reply dialect (§0C.6 item 6 convergence) is also
// pinned here: kind-tagged snapshot/error/pong replies on kit sockets, the
// LLP 0040 type-tagged replies untouched on proof sockets.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { startProof, ADMIN_TOKEN } from './harness.mjs';
import { decodeRemediationSet } from '../../packages/snapback-client/remediation.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const EXPECTED_CHECKS = 33;

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: !!condition, detail: condition ? undefined : detail });
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${name}${condition ? '' : ` — ${detail ?? ''}`}`);
}

// --- committed-schema validators -------------------------------------------

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
function compileSchema(file) {
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'schemas', file), 'utf8'));
  return ajv.compile(schema);
}
const validators = {
  error: compileSchema('error.response.schema.json'),
  mutation: compileSchema('mutation.output.schema.json'),
  subscribe: compileSchema('live.subscribe.output.schema.json'),
  unsubscribe: compileSchema('live.unsubscribe.output.schema.json'),
  diagnostic: compileSchema('diagnostic.schema.json'),
};
function valid(kind, value) {
  const validate = validators[kind];
  if (validate(value)) return { ok: true };
  return { ok: false, detail: JSON.stringify({ value, errors: validate.errors }).slice(0, 600) };
}
function checkSchema(name, kind, value, extraCondition = true, extraDetail = undefined) {
  const verdict = valid(kind, value);
  check(name, verdict.ok && extraCondition, verdict.ok ? extraDetail ?? JSON.stringify(value).slice(0, 400) : verdict.detail);
}

// A conformant kit-route failure: HTTP status matches, the body is the
// versioned ErrorResponse, and the inner Diagnostic carries the expected code.
function checkErrorLane(name, response, status, code) {
  const verdict = valid('error', response.body);
  check(
    name,
    response.status === status
      && verdict.ok
      && response.body.formatVersion === 'snapback.error-response.v1'
      && response.body.diagnostic?.code === code,
    JSON.stringify({ status: response.status, body: response.body, errors: verdict.ok ? undefined : verdict.detail }).slice(0, 600),
  );
}

async function main() {
  const proof = await startProof({ app: 'notes' });
  try {
    const raw = async (pathName, init = {}) => {
      const response = await proof.raw(pathName, init);
      return { status: response.status, body: await response.json() };
    };
    const post = (pathName, body, headers = {}) =>
      raw(pathName, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-snapback-admin-token': ADMIN_TOKEN,
          ...headers,
        },
        body: JSON.stringify(body),
      });

    // --- ledger item 1: MutationResponse with the required receipt --------
    const mutated = await post('/mutation/addNote', {
      args: { boardId: 'wire', text: 'first' },
      correlation: { opaque: 'join-key-1' },
    });
    checkSchema(
      'kit mutation success validates against mutation.output.schema.json',
      'mutation',
      mutated.body,
      mutated.status === 200
        && mutated.body.authorityDescriptor?.descriptorVersion === 1
        && /^aut_[0-9a-hjkmnp-tv-z]{26}$/u.test(
          String(mutated.body.authorityDescriptor?.authorityInstanceId),
        )
        && mutated.body.authorityDescriptor?.sessionGeneration === 0,
    );
    const receipt = mutated.body.receipt ?? {};
    check(
      'the hosted mutation receipt carries honest terminal facts',
      receipt.kind === 'mutation'
        && /^mut_[0-9a-f]{32}$/.test(String(receipt.mutationId))
        && receipt.mutation === 'addNote'
        && receipt.outcome === 'confirmed'
        && receipt.rollbackReason === null
        && Array.isArray(receipt.affectedTables) && receipt.affectedTables.join() === 'notes'
        && receipt.snapshotVersion === mutated.body.version
        && receipt.transport === 'http'
        && receipt.correlation?.opaque === 'join-key-1'
        && Number.isSafeInteger(receipt.receivedAtMs),
      JSON.stringify(receipt),
    );

    // --- connection + socket for the live lanes ---------------------------
    const opened = await post('/connection/open', { connectionId: 'wire-shapes' });
    check('connection open grants the kit socket credential', opened.status === 200 && !!opened.body.connectionToken, JSON.stringify(opened.body).slice(0, 200));
    const token = opened.body.connectionToken;
    const connectionId = opened.body.connectionId;
    const tokenHeader = { 'x-snapback-connection-token': token };

    // Socketless subscribe refusal BEFORE the socket exists (409 lane).
    const socketless = await post(
      '/live/listNotes/subscribe',
      { connection_id: connectionId, input: { args: { boardId: 'wire' } } },
      tokenHeader,
    );
    checkErrorLane('socketless kit subscribe is a versioned 409 ErrorResponse', socketless, 409, 'SNAPBACK_CONNECTION_SOCKET_REQUIRED');

    const upgrade = await proof.raw(`/live/${connectionId}/stream`, {
      // LLP 0094 §0B.4/B3: kit stream upgrades must offer a known
      // wire-version token.
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'snapback.v1', ...tokenHeader },
    });
    const kitWs = upgrade.webSocket;
    kitWs.accept();
    const kitFrames = [];
    const kitWaiters = [];
    kitWs.addEventListener('message', (event) => {
      const frame = JSON.parse(event.data);
      const waiter = kitWaiters.shift();
      if (waiter) waiter(frame);
      else kitFrames.push(frame);
    });
    const nextKitFrame = (timeoutMs = 2000) => {
      if (kitFrames.length) return Promise.resolve(kitFrames.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('kit socket frame timeout')), timeoutMs);
        kitWaiters.push((frame) => { clearTimeout(timer); resolve(frame); });
      });
    };

    // --- ledger item 2 (+ subscribe output): live lifecycle over HTTP ------
    const subscribed = await post(
      '/live/listNotes/subscribe',
      { connection_id: connectionId, input: { args: { boardId: 'wire' } } },
      tokenHeader,
    );
    checkSchema(
      'kit HTTP subscribe validates against live.subscribe.output.schema.json',
      'subscribe',
      subscribed.body,
      subscribed.status === 200 && typeof subscribed.body.subscription_id === 'string',
    );
    const unsubscribed = await post(
      '/live/listNotes/unsubscribe',
      { connection_id: connectionId, subscription_id: subscribed.body.subscription_id },
      tokenHeader,
    );
    checkSchema(
      'kit unsubscribe answers the committed {subscription_id, disposed} output',
      'unsubscribe',
      unsubscribed.body,
      unsubscribed.status === 200
        && unsubscribed.body.subscription_id === subscribed.body.subscription_id
        && unsubscribed.body.disposed === true
        && unsubscribed.body.removed === undefined,
    );
    const reUnsubscribed = await post(
      '/live/listNotes/unsubscribe',
      { connection_id: connectionId, subscription_id: subscribed.body.subscription_id },
      tokenHeader,
    );
    checkSchema(
      'unsubscribing an already-disposed id answers disposed:false honestly',
      'unsubscribe',
      reUnsubscribed.body,
      reUnsubscribed.status === 200 && reUnsubscribed.body.disposed === false,
    );

    // --- ledger item 6: in-band kit-socket replies are kit dialect ---------
    kitWs.send(JSON.stringify({ type: 'subscribe', name: 'listNotes', args: { boardId: 'wire' } }));
    const snapshot = await nextKitFrame();
    check(
      'in-band kit subscribe answers a kind-tagged snapshot (no proof dialect)',
      snapshot.kind === 'snapshot'
        && snapshot.type === undefined
        && typeof snapshot.subscription_id === 'string'
        && snapshot.subscriptionId === undefined
        && snapshot.function === 'listNotes'
        && Number.isSafeInteger(snapshot.version)
        && Array.isArray(snapshot.rows)
        && snapshot.connectionKey === undefined,
      JSON.stringify(snapshot).slice(0, 300),
    );
    kitWs.send(JSON.stringify({ type: 'subscribe', name: 'missingWireFunction', args: {} }));
    const inbandError = await nextKitFrame();
    check(
      'in-band kit errors are kind-tagged and carry the full committed Diagnostic',
      inbandError.kind === 'error'
        && inbandError.type === undefined
        && valid('diagnostic', inbandError.diagnostic).ok
        && inbandError.diagnostic?.code === 'SNAPBACK_LIVE_NOT_A_LIVE_QUERY',
      JSON.stringify(inbandError).slice(0, 300),
    );
    kitWs.send(JSON.stringify({ type: 'subscribe', name: 'addNote', args: {} }));
    const inbandKindMismatch = await nextKitFrame();
    check(
      'the in-band kind-mismatch error rides the same kit error frame',
      inbandKindMismatch.kind === 'error'
        && valid('diagnostic', inbandKindMismatch.diagnostic).ok
        && inbandKindMismatch.diagnostic?.code === 'SNAPBACK_FUNCTION_KIND_MISMATCH'
        && inbandKindMismatch.diagnostic?.details?.declaredKind === 'Mutation',
      JSON.stringify(inbandKindMismatch).slice(0, 300),
    );
    kitWs.send(JSON.stringify({ type: 'ping', requestId: 'wire-ping' }));
    const pong = await nextKitFrame();
    check(
      'the kit heartbeat reply stays kind-tagged with the requestId echo',
      pong.kind === 'pong' && pong.requestId === 'wire-ping',
      JSON.stringify(pong),
    );
    try { kitWs.close(); } catch (_) {}

    // Proof-socket regression pin: the LLP 0040 frozen dialect is untouched.
    const proofSocket = await proof.openLiveSocket();
    proofSocket.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'wire' } });
    const proofSnapshot = await proofSocket.waitFor('snapshot');
    check(
      'proof sockets keep the pinned type-tagged snapshot byte shape',
      proofSnapshot.type === 'snapshot'
        && proofSnapshot.kind === undefined
        && typeof proofSnapshot.subscriptionId === 'string'
        && proofSnapshot.connectionKey !== undefined,
      JSON.stringify(proofSnapshot).slice(0, 300),
    );
    proofSocket.close();

    // --- ledger items 3/7: parse + refusal lanes on kit routes -------------
    const wrongType = await raw('/mutation/addNote', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    checkErrorLane('a kit-route content-type refusal is a versioned 415 ErrorResponse', wrongType, 415, 'SNAPBACK_CONTENT_TYPE_UNSUPPORTED');
    const badJson = await raw('/mutation/addNote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    });
    checkErrorLane('a kit-route JSON-parse refusal is a versioned 400 ErrorResponse', badJson, 400, 'SNAPBACK_JSON_INVALID');
    const arrayBody = await raw('/mutation/addNote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    });
    checkErrorLane('a kit-route non-object body refusal is versioned', arrayBody, 400, 'SNAPBACK_JSON_OBJECT_REQUIRED');
    check(
      'the proof parse lane keeps its pinned top-level ok/code shape',
      await raw('/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' })
        .then((r) => r.status === 400 && r.body.ok === false && r.body.code === 'SNAPBACK_JSON_OBJECT_REQUIRED'
          && r.body.diagnostic?.code === 'SNAPBACK_JSON_OBJECT_REQUIRED' && r.body.diagnostic.severity === undefined),
    );

    // Connection-token lanes (verifyConnection).
    const noConnection = await post('/live/listNotes/unsubscribe', { subscription_id: 'sub_x' });
    checkErrorLane('a missing connection id refusal is versioned', noConnection, 400, 'SNAPBACK_CONNECTION_ID_REQUIRED');
    const badToken = await post(
      '/live/listNotes/unsubscribe',
      { connection_id: connectionId, subscription_id: 'sub_x' },
      { 'x-snapback-connection-token': 'wrong' },
    );
    checkErrorLane('an invalid connection token refusal is versioned', badToken, 401, 'SNAPBACK_CONNECTION_TOKEN_INVALID');

    // Handler lane (kitFailure): kind mismatch and unknown function.
    const kindMismatch = await post('/query/addNote', { args: {} });
    checkErrorLane('a kit query kind mismatch is a versioned 400 ErrorResponse', kindMismatch, 400, 'SNAPBACK_FUNCTION_KIND_MISMATCH');
    const unknownFunction = await post('/mutation/definitelyMissing', { args: {} });
    checkErrorLane('an unknown kit function failure is a versioned ErrorResponse', unknownFunction, 500, 'SNAPBACK_HANDLER_EXPORT_MISSING');
    const hostedRemediation = decodeRemediationSet(unknownFunction.body.diagnostic.details);
    check(
      'hosted unknown-function remediation is hash-bound and does not disclose the rejected spelling',
      hostedRemediation?.artifactHash === unknownFunction.body.diagnostic.details.artifactHash
        && hostedRemediation.items.length > 0
        && !JSON.stringify(unknownFunction.body.diagnostic).includes('definitelyMissing'),
    );
    const actionMismatch = await post('/action/listNotes', { args: {} });
    checkErrorLane('a kit action kind mismatch is a versioned 400 ErrorResponse', actionMismatch, 400, 'SNAPBACK_FUNCTION_KIND_MISMATCH');

    // --- ledger item 8: gateway lanes --------------------------------------
    const methodRefusal = await raw('/mutation/addNote');
    checkErrorLane('a gateway kit-route method refusal is a versioned 405 ErrorResponse', methodRefusal, 405, 'SNAPBACK_METHOD_NOT_ALLOWED');
    const forwardedMethodRefusal = await raw('/connection/open');
    checkErrorLane('a gateway forwarded-route method refusal is versioned', forwardedMethodRefusal, 405, 'SNAPBACK_METHOD_NOT_ALLOWED');
    const nonUpgrade = await raw(`/live/${connectionId}/stream`);
    checkErrorLane('the gateway non-upgrade refusal is a coded 426 diagnostic', nonUpgrade, 426, 'SNAPBACK_UPGRADE_REQUIRED');
    const systemMiss = await raw('/_snapback/definitely-not-a-route');
    checkErrorLane('a /_snapback/* miss is a coded 404 diagnostic envelope', systemMiss, 404, 'SNAPBACK_ROUTE_UNKNOWN');
    const fallthroughMiss = await raw('/definitely-not-a-route');
    checkErrorLane('the gateway fallthrough 404 is a coded diagnostic envelope', fallthroughMiss, 404, 'SNAPBACK_ROUTE_UNKNOWN');

    // --- ledger item 9: platform lane on a kit route -----------------------
    const oversized = await post('/mutation/addNote', {
      args: { boardId: 'wire', text: 'too large', authorId: 'x'.repeat(2_500_000) },
    });
    checkErrorLane('the platform value-limit failure is a versioned 413 ErrorResponse', oversized, 413, 'SNAPBACK_VALUE_TOO_LARGE');
    check(
      'the platform diagnostic keeps its structured details',
      oversized.body.diagnostic?.details?.limitBytes > 0 && oversized.body.diagnostic?.details?.retryable === false,
      JSON.stringify(oversized.body.diagnostic?.details),
    );

    // --- stale-deployment refusal on a kit route (governance rule) ---------
    await proof.corruptMeta({});
    const staleKit = await post('/query/listNotes', { args: { boardId: 'wire' } });
    checkErrorLane('the stale-deployment refusal on a kit route is a versioned 409 ErrorResponse', staleKit, 409, 'SNAPBACK_STALE_CLOUDFLARE_SCHEMA_HASH');
    const staleProof = await post('/query', { name: 'listNotes', args: { boardId: 'wire' } });
    check(
      'the stale-deployment refusal on the proof route keeps its pinned shape',
      staleProof.status === 409 && staleProof.body.ok === false && staleProof.body.code === 'SNAPBACK_STALE_CLOUDFLARE_SCHEMA_HASH',
      JSON.stringify(staleProof.body).slice(0, 300),
    );
    const recovered = await proof.reset();
    check('reset recovers the suite instance after the stale-state probe', recovered.reset === true, JSON.stringify(recovered));
  } finally {
    await proof.dispose();
  }

  // --- static emitter audit ------------------------------------------------
  // Every literal-status 4xx/5xx `json(...)` emitter in the served sources
  // must either compose the committed Diagnostic (wireDiagnostic) or be one
  // of the pinned proof/system/test-lane emitters below. Adding a bare error
  // emitter changes the fingerprint set and fails this check: route it
  // through kitError/wireDiagnostic (kit routes) or extend this pin with a
  // deliberate proof/system-lane entry.
  const sources = ['cloudflare/src/coordinator.js', 'cloudflare/src/gateway.js', 'cloudflare/src/platform-errors.js'];
  const observed = [];
  for (const source of sources) {
    const text = fs.readFileSync(path.join(repoRoot, source), 'utf8');
    const pattern = /json\(\s*(4\d\d|5\d\d)\s*,/g;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const end = text.indexOf(';', match.index);
      const statement = text.slice(match.index, end === -1 ? Math.min(text.length, match.index + 400) : end + 1);
      if (statement.includes('wireDiagnostic(')) continue; // conformant emitter
      const code = statement.match(/SNAPBACK_[A-Z_]+/);
      const fingerprint = code
        ? `${path.basename(source)}:${match[1]}:${code[0]}`
        : `${path.basename(source)}:${match[1]}:${statement.slice(0, 60).replace(/\s+/g, ' ')}`;
      observed.push(fingerprint);
    }
  }
  // The pinned non-conformant emitters, all outside the §0A.1 kit-route
  // governance rule: LLP 0040 proof lanes, /_snapback/* system/admin/test
  // lanes, and the /__exact asset-lane JSON 404s (Exact protocol surface).
  const pinned = [
    'coordinator.js:400:SNAPBACK_TEST_CRON_NOMINAL_INVALID',
    'coordinator.js:400:SNAPBACK_TEST_CRON_NOMINAL_INVALID',
    'coordinator.js:400:SNAPBACK_TEST_INDEX_UNAVAILABLE',
    'coordinator.js:400:SNAPBACK_TEST_INDEX_UNAVAILABLE',
    'coordinator.js:400:SNAPBACK_TEST_SOCKET_LIMIT_INVALID',
    "coordinator.js:400:json(400, { error: 'args are not canonicalizable' });",
    "coordinator.js:400:json(400, { error: 'rows are not digestable' });",
    "coordinator.js:400:json(400, { error: result.code || 'query failed' });",
    'coordinator.js:403:SNAPBACK_ADMIN_DISABLED',
    'coordinator.js:403:SNAPBACK_ADMIN_DISABLED',
    'coordinator.js:403:SNAPBACK_ADMIN_TOKEN_INVALID',
    'coordinator.js:403:SNAPBACK_ADMIN_TOKEN_INVALID',
    'coordinator.js:404:SNAPBACK_CRON_JOB_UNKNOWN',
    'coordinator.js:404:SNAPBACK_CRON_JOB_UNKNOWN',
    'coordinator.js:404:SNAPBACK_TEST_CRON_JOB_MISSING',
    'coordinator.js:404:SNAPBACK_TEST_CRON_JOB_MISSING',
    "coordinator.js:404:json(404, { error: 'not found' });",
    "coordinator.js:404:json(404, { error: 'not found' });",
    'coordinator.js:404:json(404, { error: `no function ${payload.function}` });',
    'coordinator.js:404:json(404, { error: `no function ${payload.name}` });',
    'coordinator.js:405:SNAPBACK_ADMIN_METHOD_NOT_ALLOWED',
    'coordinator.js:405:SNAPBACK_ADMIN_METHOD_NOT_ALLOWED',
    'coordinator.js:405:SNAPBACK_CRON_STATUS_METHOD_NOT_ALLOWED',
    'coordinator.js:405:SNAPBACK_TEST_METHOD_NOT_ALLOWED',
    'coordinator.js:409:json(409, startupRefusal);',
    'coordinator.js:409:json(409, { ...startupRefusal, version: ',
    "coordinator.js:409:json(409, { ok: false, stage: 'admission', stagedAdmission }",
    'coordinator.js:500:SNAPBACK_RESET_FAILED',
    "gateway.js:404:json(404, { error: 'agent-unavailable', ",
    "gateway.js:404:json(404, { error: 'not found', path });",
  ];
  const normalize = (values) => [...values].sort();
  const observedSorted = normalize(observed);
  const pinnedSorted = normalize(pinned);
  check(
    'no new non-conformant error emitter appeared on the served sources',
    JSON.stringify(observedSorted) === JSON.stringify(pinnedSorted),
    JSON.stringify({
      unexpected: observedSorted.filter((entry) => !pinnedSorted.includes(entry)),
      missing: pinnedSorted.filter((entry) => !observedSorted.includes(entry)),
    }),
  );

  const passed = results.filter((result) => result.ok).length;
  const ok = passed === results.length && results.length === EXPECTED_CHECKS;
  console.log(`cloudflare wire-shape acceptance: ${passed}/${results.length} checks passed`);
  if (results.length !== EXPECTED_CHECKS) {
    console.log(`expected ${EXPECTED_CHECKS} checks, ran ${results.length} — update EXPECTED_CHECKS deliberately`);
  }
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
