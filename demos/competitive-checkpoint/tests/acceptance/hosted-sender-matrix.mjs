// The LLP 0077 sender-constrained matrix, executed over the wire against a
// SERVED hosted-edge origin rather than in process.
//
// @ref LLP 0077#acceptance — the capability gate requires this matrix to run
// against the served public origin: issuance, the nonce protocol, replay
// refusal, the grant × carrier matrix, the WebSocket `sender_nonce` release,
// and the refusal axes, each failing before application body ingestion.
// @ref LLP 0098#8-acceptance--the-negative-test-ledger — "the complete LLP 0077
// matrix ... run over HTTPS against that origin, not in process" is the served
// leg of the gate; §8.1 recorded it as Not run.
// @ref LLP 0098#6-effective-source-under-this-topology — the proof `htu` is
// built from the adapter's configured `publicOrigin`, never from the connect
// URL: the trusted edge supplies the externally observed URI and public
// forwarding headers never define it.
//
// The same instrument runs locally (http://127.0.0.1:4631 in front of a
// loopback-terminated adapter config whose publicOrigin is a test name) and
// remotely (https://snapback-drill.fly.dev). Only the environment changes.
//
// Required environment:
//   SNAPBACK_MATRIX_ORIGIN         connect origin, e.g. http://127.0.0.1:4631
//   SNAPBACK_MATRIX_ADMIN_TOKEN    the deployment's admin token (used only for
//                                  /inspect; no check depends on admin authority)
//   SNAPBACK_MATRIX_PUBLIC_ORIGIN  the adapter's configured publicOrigin, the
//                                  sole source of every proof `htu`
// Login-code acquisition (see the "capture mailbox" note below) — pick one:
//   SNAPBACK_MATRIX_CODE_SOURCE=mailbox          GET /_snapback/api/auth/mailbox
//                                                (only works on a NON-hosted
//                                                deployment; hosted 404s it)
//   SNAPBACK_MATRIX_CODE_SOURCE=operator-digest  recover the code from the
//                                                durable challenge digest using
//                                                the operator's keyring file
//     SNAPBACK_MATRIX_DB           path to the SQLite database
//     SNAPBACK_MATRIX_KEYRING      default `${SNAPBACK_MATRIX_DB}.auth-keyring.json`
//   SNAPBACK_MATRIX_CODE_SOURCE=command          run a shell command; `{challengeId}`
//                                                and `{address}` are substituted
//                                                and stdout is the six-digit code
//                                                (this is how a remote machine is
//                                                reached, e.g. via `fly ssh console -C`)
// Optional:
//   SNAPBACK_MATRIX_COMPOSITION    `instrument-terminator` (default: the
//                                  instrument connects to the origin directly
//                                  and plays the trusted terminator) or
//                                  `served-terminator` (the instrument is an
//                                  ordinary public client behind the REAL
//                                  deployed terminator; the effective-source
//                                  rows assert composed spoof-immunity and the
//                                  origin-confusion probe binds to the
//                                  internal upstream). See the block by the
//                                  `composition` constant below.
//   SNAPBACK_MATRIX_INTERNAL_ORIGIN  served-terminator only: the loopback
//                                  upstream the terminator proxies to
//                                  (default http://127.0.0.1:4287)
//   SNAPBACK_MATRIX_SQL_COMMAND    shell template with `{sql}` substituted,
//                                  stdout the scalar result — lets a served
//                                  run observe the operator DB (bucket
//                                  invariance) over e.g. `fly ssh console -C`
//   SNAPBACK_MATRIX_EMAIL_PREFIX   default `sender-matrix`; each challenge uses a
//                                  distinct address so the per-address
//                                  request-code budget (5 / 10 min) is not spent
//   SNAPBACK_MATRIX_RECEIPT        receipt path (default the results directory)
//   SNAPBACK_MATRIX_CLIENT_IP      the stable client IP this instrument writes
//                                  into X-Forwarded-For on every request
//                                  (default 198.51.100.7). The instrument stands
//                                  in for the in-namespace TLS terminator, which
//                                  is exactly the party LLP 0098 §6 says supplies
//                                  that header; the origin requires it and fails
//                                  closed (SNAPBACK_AUTH_SOURCE_UNTRUSTED)
//                                  when it is absent or malformed.
//
// Why the login code is fetched out of band: on a hosted deployment every
// `/_snapback/*` route is a fixed 404 (LLP 0060 C2, enforced by LLP 0098 §8.1's
// S4 fix), and the capture mailbox is process-local memory with no durable
// plaintext representation (LLP 0057 §Capture mailbox, `src/auth/mailbox.rs`).
// So no protocol surface can hand a test the code on a hosted origin. The
// `operator-digest` source recovers it from state the machine operator already
// holds — the 0600 SQLite file and the 0600 auth keyring beside it, the same
// trust boundary as the admin-token file — by recomputing
// HMAC-SHA256(key, LP(domain) ‖ LP(challengeId) ‖ LP(address) ‖ LP(code)) over
// the 10^6 six-digit codes (`CodeDigest::compute`, `src/auth/crypto.rs`). That
// is an operator-side out-of-band read, not a protocol weakening: the code is
// still single-use, still expiring, still attempt-counted, and still must be
// exchanged with a valid sender proof.

import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// @ref LLP 0096#21-authrr--authenticated-requestresponse — every request on a hosted
// deployment must offer the auth/rr client-protocol floor or the deployment
// answers SNAPBACK_AUTH_POLICY_UNAVAILABLE before anything else.
const CLIENT_PROTOCOL_HEADER = 'x-snapback-auth-client-protocol';
const PROOF_HEADER = 'dpop';
const NONCE_HEADER = 'dpop-nonce';
const CONNECTION_TOKEN_HEADER = 'x-snapback-connection-token';
const LIVE_STREAM_SUBPROTOCOL = 'snapback.v1';
const CONNECTION_TOKEN_SUBPROTOCOL_PREFIX = 'snapback.connection-token.';
const SENDER_PROOF_SUBPROTOCOL_PREFIX = 'snapback.sender-proof.';
const ISSUANCE_PROTOCOL = 'snapback.sender-issuance.v2';
const CODE_DIGEST_DOMAIN = 'snapback.auth.email-code.v1';
// @ref LLP 0098#6-effective-source-under-this-topology — the ONE consulted
// header family. The instrument plays the trusted terminator and supplies it
// on every request; the effective-source checks below deliberately omit or
// deform it.
const FORWARDED_FOR_HEADER = 'x-forwarded-for';

// The ten `connection_route` registrations plus the WebSocket carrier of
// `/live/{connection_id}/stream`. LLP 0077 §WebSocket and connection binding:
// "There is no carrier or route on which a sender-bound grant acts as a bare
// bearer" — so every one of them is probed with and without a proof.
const GRANT_HEADER_ROUTES = [
  ['POST', '/live/authorization-invalidation/acknowledge', {}],
  ['POST', '/live/authorization-invalidation/manual-retry', {}],
  ['POST', '/live/{name}/subscribe', {}],
  ['POST', '/live/{name}/resume', {}],
  ['POST', '/live/{name}/unsubscribe', {}],
  ['GET', '/live/{connection_id}/stream', null],
  ['GET', '/outbox/{connection_id}', null],
  ['POST', '/ephemeral/publish', {}],
  ['POST', '/ephemeral/subscribe', {}],
  ['POST', '/ephemeral/delete', {}],
];

const EXPECTED_CHECKS = 43;

const origin = required('SNAPBACK_MATRIX_ORIGIN').replace(/\/+$/, '');
const adminToken = required('SNAPBACK_MATRIX_ADMIN_TOKEN');
const publicOrigin = required('SNAPBACK_MATRIX_PUBLIC_ORIGIN').replace(/\/+$/, '');
const emailPrefix = process.env.SNAPBACK_MATRIX_EMAIL_PREFIX ?? 'sender-matrix';
const clientIp = process.env.SNAPBACK_MATRIX_CLIENT_IP ?? '198.51.100.7';
const receiptFile = process.env.SNAPBACK_MATRIX_RECEIPT
  ?? join(here, '..', '..', 'acceptance', 'results', 'hosted-sender-matrix.v0.json');

// Which party terminates for the origin (SNAPBACK_MATRIX_COMPOSITION):
//
//   instrument-terminator (default)  the instrument connects to the origin
//     directly and plays the trusted in-namespace terminator itself: it
//     supplies X-Forwarded-For, and the effective-source rows assert the
//     origin's own fail-closed derivation (E1–E3 refuse, E5 selects the
//     rightmost entry).
//   served-terminator  the instrument is an ordinary public client behind the
//     REAL terminator (Caddy on the deployed machine), which REPLACES
//     X-Forwarded-For with the socket peer address. The origin-side derivation
//     is unchanged and stays proven by the instrument-terminator composition;
//     what is observable — and asserted — from outside is the composed
//     property LLP 0098 §6 exists to provide: no client-supplied forwarding
//     header can deny admission or steer the derived source (each deformed
//     probe is admitted and charges the terminator-derived bucket, never a
//     client-chosen one). Origin-binding also changes shape: connect origin
//     and publicOrigin coincide, so the origin-confusion probe binds its
//     proof to SNAPBACK_MATRIX_INTERNAL_ORIGIN (the loopback upstream the
//     terminator proxies to), which must refuse identically.
const composition = process.env.SNAPBACK_MATRIX_COMPOSITION ?? 'instrument-terminator';
if (!['instrument-terminator', 'served-terminator'].includes(composition)) {
  throw new Error(`unknown SNAPBACK_MATRIX_COMPOSITION ${composition}`);
}
const servedComposition = composition === 'served-terminator';
const internalOrigin = (process.env.SNAPBACK_MATRIX_INTERNAL_ORIGIN ?? 'http://127.0.0.1:4287')
  .replace(/\/+$/, '');
// Bucket-count observability: a local database path, or (for a served run
// inside the operator trust boundary) SNAPBACK_MATRIX_SQL_COMMAND — a shell
// template with `{sql}` substituted whose stdout is the scalar result, e.g.
//   fly ssh console -a snapback-drill -C "sqlite3 /data/hosted.sqlite3 '{sql}'"
const throttleDb = process.env.SNAPBACK_MATRIX_DB ?? null;
const sqlCommand = process.env.SNAPBACK_MATRIX_SQL_COMMAND ?? null;
const bucketObservable = throttleDb !== null || sqlCommand !== null;

const suite = createSuite(
  'competitive checkpoint / LLP 0077 sender matrix on a served hosted origin',
  { expectedChecks: EXPECTED_CHECKS },
);

function required(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required to run the hosted sender matrix`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// codec + crypto
// ---------------------------------------------------------------------------

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const utf8 = (value) => new TextEncoder().encode(value);

async function generateCustody() {
  // @ref LLP 0077#browser-custody — the private half is non-extractable; the
  // public half is always exportable and is what the server binds.
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    privateKey: pair.privateKey,
    // RFC 7638 canonical member order; the server derives the thumbprint over
    // exactly {crv, kty, x, y}.
    publicJwk: { crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y },
    extractable: pair.privateKey.extractable,
  };
}

function protectedHeader(custody, { alg = 'ES256', typ = 'dpop+jwt', jwk } = {}) {
  return b64u(utf8(JSON.stringify({ alg, jwk: jwk ?? custody.publicJwk, typ })));
}

async function signCompact(custody, header, payload) {
  const encodedPayload = b64u(utf8(JSON.stringify(payload)));
  const signingInput = `${header}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    custody.privateKey,
    utf8(signingInput),
  );
  return `${signingInput}.${b64u(new Uint8Array(signature))}`;
}

let proofIdCounter = 0;
function freshJti() {
  proofIdCounter += 1;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = proofIdCounter & 0xff;
  return b64u(bytes);
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

// @ref LLP 0098#6-effective-source-under-this-topology — scheme + host +
// non-default port + absolute path of the CONFIGURED publicOrigin. Query and
// fragment are removed; the connect origin never appears.
function canonicalUri(path) {
  const withoutFragment = path.split('#')[0];
  const withoutQuery = withoutFragment.split('?')[0];
  return `${publicOrigin}${withoutQuery}`;
}

async function issuanceProof(custody, challengeId, overrides = {}) {
  const payload = {
    challengeId,
    htm: 'POST',
    htu: canonicalUri('/auth/exchange'),
    iat: nowSeconds(),
    jti: freshJti(),
    protocol: ISSUANCE_PROTOCOL,
    version: 2,
    ...overrides.payload,
  };
  return signCompact(custody, protectedHeader(custody, overrides.header), payload);
}

async function resourceProof(custody, method, path, token, nonce, overrides = {}) {
  const ath = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(token))));
  const payload = {
    ath,
    htm: method.toUpperCase(),
    htu: canonicalUri(path),
    iat: nowSeconds(),
    jti: freshJti(),
    nonce,
    version: 2,
    ...overrides.payload,
  };
  return signCompact(custody, protectedHeader(custody, overrides.header), payload);
}

// ---------------------------------------------------------------------------
// wire
// ---------------------------------------------------------------------------

// `xff` controls the X-Forwarded-For value the instrument-as-terminator
// supplies: undefined (default) sends the stable client IP, a string sends
// that exact raw value, and null omits the header entirely — the
// effective-source checks are the only callers of the last two forms.
async function request(method, path, { body, headers = {}, expectJson = true, xff } = {}) {
  const forwardedFor = xff === undefined ? clientIp : xff;
  const init = {
    method,
    headers: {
      [CLIENT_PROTOCOL_HEADER]: '1',
      ...(forwardedFor === null ? {} : { [FORWARDED_FOR_HEADER]: forwardedFor }),
      ...headers,
    },
    redirect: 'manual',
  };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const response = await fetch(`${origin}${path}`, init);
  const text = await response.text();
  let json = null;
  if (expectJson && text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return {
    status: response.status,
    headers: response.headers,
    nonce: response.headers.get(NONCE_HEADER),
    negotiatedProtocol: response.headers.get('sec-websocket-protocol'),
    text,
    json,
    code: json?.diagnostic?.code ?? json?.code ?? null,
  };
}

// The single mutable nonce cell. Every accepted protected response installs a
// successor here; a challenge returns the still-current value unchanged.
const custodyNonce = { value: null, installs: 0 };
function observeNonce(response) {
  if (typeof response.nonce === 'string' && response.nonce.length > 0) {
    if (response.nonce !== custodyNonce.value) custodyNonce.installs += 1;
    custodyNonce.value = response.nonce;
  }
  return response;
}

// ---------------------------------------------------------------------------
// login-code acquisition (out of band; see the header note)
// ---------------------------------------------------------------------------

function lengthPrefixed(value) {
  const bytes = Buffer.from(value);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(bytes.length);
  return Buffer.concat([prefix, bytes]);
}

function recoverCodeFromDigest(challengeId, address) {
  const database = required('SNAPBACK_MATRIX_DB');
  const keyringPath = process.env.SNAPBACK_MATRIX_KEYRING ?? `${database}.auth-keyring.json`;
  const row = execFileSync('sqlite3', [
    database,
    `select hex(code_digest) || '|' || key_id from _auth_verification_codes `
      + `where challenge_id = '${challengeId.replace(/'/g, "''")}';`,
  ], { encoding: 'utf8' }).trim();
  if (row.length === 0) throw new Error(`no durable challenge row for ${challengeId}`);
  const [digestHex, keyId] = row.split('|');
  const keyring = JSON.parse(readFileSync(keyringPath, 'utf8'));
  const entry = keyring.keys.find((candidate) => candidate.id === keyId);
  if (!entry) throw new Error(`auth keyring has no key ${keyId}`);
  const key = Buffer.from(entry.material, 'base64url');
  const expected = Buffer.from(digestHex, 'hex');
  // @ref LLP 0057#capture-mailbox — the durable table stores only the digest;
  // this recomputes it, it does not read a stored plaintext code.
  const prefix = Buffer.concat([
    lengthPrefixed(CODE_DIGEST_DOMAIN),
    lengthPrefixed(challengeId),
    lengthPrefixed(address),
  ]);
  for (let candidate = 0; candidate < 1_000_000; candidate += 1) {
    const code = String(candidate).padStart(6, '0');
    const mac = createHmac('sha256', key);
    mac.update(prefix);
    mac.update(lengthPrefixed(code));
    if (mac.digest().equals(expected)) return code;
  }
  throw new Error(`could not recover the verification code for ${challengeId}`);
}

async function fetchCode(challengeId, address) {
  const source = process.env.SNAPBACK_MATRIX_CODE_SOURCE ?? 'operator-digest';
  if (source === 'mailbox') {
    const response = await request(
      'GET',
      `/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(challengeId)}`,
      { headers: { 'x-snapback-admin-token': adminToken } },
    );
    if (response.status !== 200 || typeof response.json?.code !== 'string') {
      throw new Error(
        `mailbox code source unavailable (${response.status} ${response.code ?? 'no-diagnostic'}) — `
          + 'a hosted deployment serves a fixed 404 for every /_snapback/* route',
      );
    }
    return response.json.code;
  }
  if (source === 'command') {
    const template = required('SNAPBACK_MATRIX_CODE_COMMAND');
    const command = template
      .replaceAll('{challengeId}', challengeId)
      .replaceAll('{address}', address);
    return execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' }).trim();
  }
  if (source === 'operator-digest') return recoverCodeFromDigest(challengeId, address);
  throw new Error(`unknown SNAPBACK_MATRIX_CODE_SOURCE ${source}`);
}

let challengeCounter = 0;
async function newChallenge() {
  challengeCounter += 1;
  const address = `${emailPrefix}-${Date.now()}-${challengeCounter}@example.com`;
  const response = await request('POST', '/auth/request-code', { body: { email: address } });
  if (response.status !== 200 || typeof response.json?.challengeId !== 'string') {
    throw new Error(
      `request-code failed: ${response.status} ${response.code ?? response.text.slice(0, 200)}`,
    );
  }
  const challengeId = response.json.challengeId;
  return { address, challengeId, code: await fetchCode(challengeId, address) };
}

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function expectDiagnostic(response, expected, context) {
  expect(
    response.code === expected,
    `${context}: expected ${expected}, observed ${response.status} ${response.code ?? 'no diagnostic'}`
      + ` ${response.text.slice(0, 200)}`,
  );
  return response.code;
}

// A refusal that is a sender-admission refusal, whatever its exact kind. The
// refusal axes must all land in this family — never in an application error.
const SENDER_REFUSALS = new Set([
  'SNAPBACK_AUTH_SENDER_PROOF_REQUIRED',
  'SNAPBACK_AUTH_SENDER_PROOF_INVALID',
  'SNAPBACK_AUTH_SENDER_PROOF_REPLAYED',
]);

function expectSenderRefusal(response, context) {
  expect(
    SENDER_REFUSALS.has(response.code),
    `${context}: expected a sender-admission refusal, observed ${response.status} `
      + `${response.code ?? 'no diagnostic'} ${response.text.slice(0, 200)}`,
  );
  return response.code;
}

// ---------------------------------------------------------------------------
// the matrix
// ---------------------------------------------------------------------------

const facts = { hostedAuth: null, custodyExtractable: null, grantRoutes: [] };

await runAcceptance(suite, async () => {
  const inspect = await request('GET', '/inspect', {
    headers: { 'x-snapback-admin-token': adminToken },
  });
  facts.hostedAuth = inspect.json?.capabilityManifest?.hostedAuth ?? null;
  expect(
    facts.hostedAuth?.clientCredentialPosture === 'senderConstrainedV2',
    'the served deployment must publish senderConstrainedV2; this matrix has no meaning otherwise',
  );

  const custody = await generateCustody();
  facts.custodyExtractable = custody.extractable;

  // --- H. the operator-surface fact this instrument had to route around -----

  await suite.check('hosted/operator-surface-mailbox-is-404', async () => {
    const response = await request('GET', '/_snapback/api/auth/mailbox?challengeId=probe', {
      headers: { 'x-snapback-admin-token': adminToken },
      expectJson: false,
    });
    expect(
      response.status === 404 && response.text.length === 0,
      `expected the fixed body-free 404 (LLP 0060 C2), observed ${response.status} `
        + `with ${response.text.length} body bytes`,
    );
    return { status: 404, bodyBytes: 0, note: 'capture mailbox unreachable on a hosted origin' };
  });

  // --- E. the LLP 0098 §6 effective-source ledger, served -------------------
  //
  // @ref LLP 0098#6-effective-source-under-this-topology — the derivation is
  // load-bearing: without it, loopback termination collapses every per-source
  // throttle bucket onto the terminator's address. Rows E1–E5 of §8's ledger
  // are probed here over the wire, each against a GATED route (/auth/request-code
  // or /query/listNotes) — never /health or /inspect, whose success proves
  // nothing about the request path that matters.
  //
  // E5/E4 observability: from outside, a request that succeeds looks the same
  // whichever entry the origin selected. But this instrument already stands
  // inside the operator trust boundary (the 0600 SQLite file, the same boundary
  // as the operator-digest code source), and every admitted authentication
  // attempt durably charges a per-source bucket row in _snapback_auth_throttle
  // (bucket_kind = 2, key = HMAC over the derived source). Bucket-key EQUALITY
  // is therefore observable as the row count: requests whose derived source is
  // the same reuse one row; a new derived source mints one. When
  // SNAPBACK_MATRIX_DB is not provided (a remote run), that half of E4/E5 is
  // recorded as a documented limitation, not asserted as a pass.

  const BUCKET_COUNT_SQL = 'select count(*) from _snapback_auth_throttle where bucket_kind = 2;';
  const sourceBucketCount = () => {
    if (throttleDb !== null) {
      return Number(execFileSync('sqlite3', [throttleDb, BUCKET_COUNT_SQL], {
        encoding: 'utf8',
      }).trim());
    }
    const output = execFileSync('/bin/sh', ['-c', sqlCommand.replaceAll('{sql}', BUCKET_COUNT_SQL)], {
      encoding: 'utf8',
    });
    const scalar = output.trim().split('\n').filter(Boolean).pop() ?? '';
    if (!/^\d+$/.test(scalar)) {
      throw new Error(`SNAPBACK_MATRIX_SQL_COMMAND yielded no scalar: ${output.slice(0, 200)}`);
    }
    return Number(scalar);
  };
  const freshEmail = (tag) => `${emailPrefix}-${tag}-${Date.now()}@example.com`;
  const expectUntrusted = (response, context) => {
    expect(
      response.code === 'SNAPBACK_AUTH_SOURCE_UNTRUSTED',
      `${context}: expected SNAPBACK_AUTH_SOURCE_UNTRUSTED, observed `
        + `${response.status} ${response.code ?? 'success'} ${response.text.slice(0, 200)}`,
    );
  };
  // Served-composition twin of expectUntrusted: the deformed client header
  // must neither deny admission nor steer the source. Bucket invariance is the
  // spoof half — the charge lands in the terminator-derived bucket that the
  // priming request already minted, never a fresh client-chosen one.
  const probeUnspoofable = async (tag, xff, extraHeaders = {}) => {
    const before = bucketObservable ? sourceBucketCount() : null;
    const response = await request('POST', '/auth/request-code', {
      body: { email: freshEmail(tag) },
      xff,
      headers: extraHeaders,
    });
    expect(
      response.status === 200 && typeof response.json?.challengeId === 'string',
      `${tag}: a client-supplied forwarding deformation must not deny admission through the `
        + `real terminator; observed ${response.status} ${response.code}`,
    );
    if (!bucketObservable) return { status: 200, sourceSelection: 'unobserved' };
    const after = sourceBucketCount();
    expect(
      after === before,
      `${tag}: the charge must land in the existing terminator-derived bucket, never a `
        + `client-chosen one: source buckets went ${before} -> ${after}`,
    );
    return { status: 200, sourceBuckets: { before, after } };
  };
  const servedLimitation = bucketObservable
    ? null
    : 'LIMITATION: without SNAPBACK_MATRIX_DB or SNAPBACK_MATRIX_SQL_COMMAND only the '
      + 'admitted-not-denied half is asserted; bucket invariance needs operator DB access';
  if (servedComposition) {
    // Guarantee the terminator-derived source already owns its bucket so the
    // invariance probes below can only fail by minting a client-chosen one.
    const prime = await request('POST', '/auth/request-code', {
      body: { email: freshEmail('served-prime') },
    });
    if (prime.status !== 200) {
      throw new Error(`served-composition priming request failed: ${prime.status} ${prime.code}`);
    }
  }

  await suite.check(
    servedComposition
      ? 'effective-source/e1-client-absent-header-is-replaced-by-the-terminator'
      : 'effective-source/e1-absent-header-fails-closed-on-gated-routes',
    async () => {
      if (servedComposition) {
        // Row E1's composed form: the real terminator writes the header from
        // the socket peer, so a client sending none is indistinguishable from
        // the default probe — admitted, same bucket. The origin-side
        // fail-closed derivation stays proven by the instrument-terminator
        // composition of this same row.
        const details = await probeUnspoofable('e1-client-absent', null);
        return { ...details, ...(servedLimitation ? { sourceSelection: servedLimitation } : {}) };
      }
      // Row E1: absent ⇒ SOURCE_UNTRUSTED, no fallback to the peer address.
      const auth = await request('POST', '/auth/request-code', {
        body: { email: freshEmail('e1-probe') },
        xff: null,
      });
      expectUntrusted(auth, 'POST /auth/request-code without X-Forwarded-For');
      const appData = await request('POST', '/query/listNotes', { body: { args: {} }, xff: null });
      expectUntrusted(appData, 'POST /query/listNotes without X-Forwarded-For');
      return { code: 'SNAPBACK_AUTH_SOURCE_UNTRUSTED', routes: ['/auth/request-code', '/query/listNotes'] };
    },
  );

  await suite.check(
    servedComposition
      ? 'effective-source/e2-nine-entry-client-chain-cannot-spoof-or-deny'
      : 'effective-source/e2-nine-entries-fail-closed',
    async () => {
      const chain = Array.from({ length: 9 }, (_, index) => `203.0.113.${index + 1}`).join(', ');
      if (servedComposition) {
        // Row E2's composed form: the terminator REPLACES the header, so the
        // over-bound chain never reaches the origin's parser at all.
        const details = await probeUnspoofable('e2-client-chain', chain);
        return { ...details, entries: 9, ...(servedLimitation ? { sourceSelection: servedLimitation } : {}) };
      }
      // Row E2: the hop bound is eight; a nine-entry chain fails the whole header.
      const response = await request('POST', '/auth/request-code', {
        body: { email: freshEmail('e2-probe') },
        xff: chain,
      });
      expectUntrusted(response, `nine-entry chain ${JSON.stringify(chain)}`);
      return { code: response.code, entries: 9 };
    },
  );

  await suite.check(
    servedComposition
      ? 'effective-source/e3-malformed-client-entries-cannot-spoof-or-deny'
      : 'effective-source/e3-malformed-entries-fail-closed',
    async () => {
      const variants = [
        ['hostname', 'evil.example.test'],
        ['ipv4-with-port', '203.0.113.7:443'],
        ['bracketed-ipv6-with-port', '[2001:db8::1]:443'],
        ['empty-header-value', ''],
        ['trailing-empty-entry', '203.0.113.7, '],
      ];
      const observed = [];
      for (const [label, value] of variants) {
        if (servedComposition) {
          await probeUnspoofable(`e3-${label}`, value);
        } else {
          // Row E3: strict syntax — hostname, port, bracketed authority, and
          // empty entries each fail the WHOLE header, never get skipped in
          // favour of a different entry than the terminator meant.
          const response = await request('POST', '/auth/request-code', {
            body: { email: freshEmail(`e3-${label}`) },
            xff: value,
          });
          expectUntrusted(response, `malformed X-Forwarded-For (${label}) ${JSON.stringify(value)}`);
        }
        observed.push(label);
      }
      return servedComposition
        ? { status: 200, variants: observed, ...(servedLimitation ? { sourceSelection: servedLimitation } : {}) }
        : { code: 'SNAPBACK_AUTH_SOURCE_UNTRUSTED', variants: observed };
    },
  );

  await suite.check('effective-source/e4-other-forwarding-headers-are-ignored', async () => {
    // Row E4: exactly one header family is consulted. A disagreeing
    // `Forwarded` and `X-Real-IP` must neither fail the request nor steer the
    // derived source away from the X-Forwarded-For value.
    const disagreeing = '203.0.113.66';
    // Prime: guarantee the stable client IP already owns a source bucket, so
    // the measured request below can only mint a NEW row by honouring the
    // disagreeing headers.
    const prime = await request('POST', '/auth/request-code', {
      body: { email: freshEmail('e4-prime') },
    });
    expect(prime.status === 200, `priming request-code failed: ${prime.status} ${prime.code}`);
    const before = bucketObservable ? sourceBucketCount() : null;
    const response = await request('POST', '/auth/request-code', {
      body: { email: freshEmail('e4-probe') },
      headers: {
        forwarded: `for=${disagreeing};proto=https`,
        'x-real-ip': disagreeing,
      },
    });
    expect(
      response.status === 200 && typeof response.json?.challengeId === 'string',
      'a disagreeing Forwarded/X-Real-IP must be ignored and the request must succeed '
        + `on the X-Forwarded-For value; observed ${response.status} ${response.code}`,
    );
    if (!bucketObservable) {
      return {
        status: 200,
        sourceSelection: 'LIMITATION: without SNAPBACK_MATRIX_DB or SNAPBACK_MATRIX_SQL_COMMAND '
          + 'the charged bucket is not externally observable; only the '
          + 'ignored-not-conflicting half of E4 is asserted',
      };
    }
    const after = sourceBucketCount();
    expect(
      after === before,
      `the charge must land in the existing X-Forwarded-For bucket, not mint one for the `
        + `disagreeing ${disagreeing}: source buckets went ${before} -> ${after}`,
    );
    return { status: 200, sourceBuckets: { before, after }, xffWins: true };
  });

  await suite.check(
    servedComposition
      ? 'effective-source/e5-client-chain-variation-never-selects-the-source'
      : 'effective-source/e5-rightmost-entry-is-selected',
    async () => {
    if (servedComposition) {
      // Row E5's composed form: rightmost-entry selection is the ORIGIN's rule
      // and stays proven by the instrument-terminator composition; through the
      // real terminator every client-controlled entry is discarded, so varying
      // any of them must charge the same terminator-derived bucket. This is
      // the end-to-end fact the derivation exists to provide.
      await probeUnspoofable('e5-vary-leftmost', '198.51.100.9, 203.0.113.7');
      await probeUnspoofable('e5-vary-rightmost', '198.51.100.9, 203.0.113.8');
      return bucketObservable
        ? { clientEntriesDiscarded: true }
        : { status: 200, sourceSelection: servedLimitation };
    }
    return effectiveSourceE5Local();
  });

  async function effectiveSourceE5Local() {
    // Row E5: the chain is walked from the trusted edge toward the client —
    // the rightmost entry is the one the terminator appended, and the fully
    // client-controlled leftmost entry must never win. Observable via the
    // durable per-source charge: same derived source ⇒ same bucket row.
    const leftA = '198.51.100.9';
    const leftB = '198.51.100.10';
    const rightA = '203.0.113.7';
    const rightB = '203.0.113.8';
    const probe = async (tag, value) => {
      const response = await request('POST', '/auth/request-code', {
        body: { email: freshEmail(tag) },
        xff: value,
      });
      expect(
        response.status === 200,
        `${tag} (${value}) must be admitted: ${response.status} ${response.code}`,
      );
    };
    if (throttleDb === null) {
      // A success alone cannot show WHICH entry was selected; do not fake it.
      await probe('e5-unobserved', `${leftA}, ${rightA}`);
      return {
        status: 200,
        sourceSelection: 'LIMITATION: rightmost-entry selection is not observable from outside '
          + 'the origin without SNAPBACK_MATRIX_DB; asserted only where the operator DB is present',
      };
    }
    const count0 = sourceBucketCount();
    await probe('e5-baseline', `${leftA}, ${rightA}`);
    const count1 = sourceBucketCount();
    expect(count1 === count0 + 1,
      `the first fresh chain must mint exactly one source bucket: ${count0} -> ${count1}`);
    await probe('e5-vary-leftmost', `${leftB}, ${rightA}`);
    const count2 = sourceBucketCount();
    expect(
      count2 === count1,
      'varying only the client-controlled LEFTMOST entry minted a new source bucket '
        + `(${count1} -> ${count2}) — the origin is selecting the leftmost entry`,
    );
    await probe('e5-vary-rightmost', `${leftA}, ${rightB}`);
    const count3 = sourceBucketCount();
    expect(
      count3 === count2 + 1,
      'varying only the terminator-appended RIGHTMOST entry did not mint a new source bucket '
        + `(${count2} -> ${count3}) — the origin is not keying on the rightmost entry`,
    );
    return {
      rightmostSelected: true,
      sourceBuckets: { start: count0, afterBaseline: count1, afterLeftmostVaried: count2, afterRightmostVaried: count3 },
    };
  }

  // --- A. issuance ---------------------------------------------------------

  await suite.check('issuance/exchange-refuses-without-sender-constraint', async () => {
    const challenge = await newChallenge();
    const response = await request('POST', '/auth/exchange', {
      body: { challengeId: challenge.challengeId, code: challenge.code },
    });
    expect(
      response.status !== 200,
      `a hosted exchange must refuse a bearer-only body, observed ${response.status}`,
    );
    return { status: response.status, code: response.code };
  });

  await suite.check(
    servedComposition
      ? 'issuance/refuses-a-proof-bound-to-the-internal-upstream-origin'
      : 'issuance/refuses-a-proof-bound-to-the-connect-origin',
    async () => {
    const challenge = await newChallenge();
    // The exact confusion LLP 0077's HTTP binding forbids: an htu built from
    // anything but the adapter's configured publicOrigin. In the
    // instrument-terminator composition the natural wrong origin is the
    // connect URL; in the served composition connect origin and publicOrigin
    // coincide (that probe would be a valid proof), so the wrong origin is the
    // loopback upstream address the terminator proxies to — the internal name
    // that must never authorize anything.
    const wrongOrigin = servedComposition ? internalOrigin : origin;
    const proof = await issuanceProof(custody, challenge.challengeId, {
      payload: { htu: `${wrongOrigin}/auth/exchange` },
    });
    const response = await request('POST', '/auth/exchange', {
      body: {
        challengeId: challenge.challengeId,
        code: challenge.code,
        senderConstraint: { protocol: ISSUANCE_PROTOCOL, publicJwk: custody.publicJwk, proof },
      },
    });
    expect(response.status !== 200, `expected refusal, observed ${response.status}`);
    return { status: response.status, code: response.code, wrongOrigin };
  });

  const challenge = await newChallenge();
  let bearer = null;

  await suite.check('issuance/exchange-succeeds-with-a-sender-constraint', async () => {
    const proof = await issuanceProof(custody, challenge.challengeId);
    const response = observeNonce(await request('POST', '/auth/exchange', {
      body: {
        challengeId: challenge.challengeId,
        code: challenge.code,
        senderConstraint: { protocol: ISSUANCE_PROTOCOL, publicJwk: custody.publicJwk, proof },
      },
    }));
    expect(
      response.status === 200,
      `exchange failed: ${response.status} ${response.code ?? response.text.slice(0, 300)}`,
    );
    bearer = response.json?.token ?? response.json?.sessionToken
      ?? response.json?.credential?.token ?? null;
    expect(typeof bearer === 'string' && bearer.length > 0,
      `exchange returned no session token: ${JSON.stringify(response.json).slice(0, 300)}`);
    // LLP 0077 decision 4, first layer: sender-bound issuance mints the
    // structurally distinct, legacy-rejecting versioned spelling.
    expect(bearer.startsWith('sbs2_'),
      `sender-bound exchange must mint the sbs2_ spelling, observed ${bearer.slice(0, 6)}…`);
    return { status: 200, nonExtractableCustody: custody.extractable === false };
  });

  await suite.check('issuance/response-installs-a-successor-nonce', async () => {
    expect(
      typeof custodyNonce.value === 'string' && custodyNonce.value.length === 43,
      `expected a 43-character base64url nonce in ${NONCE_HEADER}, observed `
        + `${JSON.stringify(custodyNonce.value)}`,
    );
    return { nonceLength: custodyNonce.value.length };
  });

  await suite.check('issuance/a-second-exchange-with-a-bound-key-refuses-coded', async () => {
    // One live family per thumbprint. A fresh challenge + correct code + valid
    // proof over the ALREADY-BOUND custody key must refuse with the folded
    // coded diagnostic — never a 5xx state-invariant failure (the D-2 defect
    // the first served-origin run surfaced: the nonce-table primary-key
    // conflict answered 500 INTERNAL_AUTH_STATE on client-controllable input).
    const retry = await newChallenge();
    const proof = await issuanceProof(custody, retry.challengeId);
    const response = await request('POST', '/auth/exchange', {
      body: {
        challengeId: retry.challengeId,
        code: retry.code,
        senderConstraint: { protocol: ISSUANCE_PROTOCOL, publicJwk: custody.publicJwk, proof },
      },
    });
    expect(
      response.status === 401 && response.code === 'SNAPBACK_AUTH_SENDER_PROOF_INVALID',
      'a second exchange under a live-bound key must refuse 401 '
        + `SNAPBACK_AUTH_SENDER_PROOF_INVALID, observed ${response.status} ${response.code}`,
    );
    return { status: response.status, code: response.code };
  });

  // --- B. protected request ------------------------------------------------

  const protectedPath = '/auth/session';
  const protectedGet = async (overrides = {}, nonce = custodyNonce.value) => {
    const proof = await resourceProof(custody, 'GET', protectedPath, bearer, nonce, overrides);
    return request('GET', protectedPath, {
      headers: { authorization: `Bearer ${bearer}`, [PROOF_HEADER]: proof },
    });
  };

  await suite.check('protected/valid-proof-is-admitted', async () => {
    const response = observeNonce(await protectedGet());
    expect(
      response.status === 200,
      `protected request failed: ${response.status} ${response.code ?? response.text.slice(0, 300)}`,
    );
    return { status: 200 };
  });

  await suite.check('protected/successor-nonce-arrives-in-the-response-header', async () => {
    const before = custodyNonce.value;
    const response = observeNonce(await protectedGet());
    expect(response.status === 200, `expected 200, observed ${response.status} ${response.code}`);
    expect(
      typeof response.nonce === 'string' && response.nonce.length === 43,
      `accepted response carried no ${NONCE_HEADER}`,
    );
    expect(response.nonce !== before, 'the successor must differ from the consumed generation');
    return { rotated: true };
  });

  // --- C. nonce protocol ---------------------------------------------------

  await suite.check('nonce/missing-proof-yields-a-challenge', async () => {
    const response = await request('GET', protectedPath, {
      headers: { authorization: `Bearer ${bearer}` },
    });
    const code = expectDiagnostic(
      response, 'SNAPBACK_AUTH_SENDER_PROOF_REQUIRED', 'missing proof',
    );
    expect(
      typeof response.nonce === 'string' && response.nonce.length === 43,
      `the challenge must carry the family's current nonce in ${NONCE_HEADER}`,
    );
    expect(
      response.nonce === custodyNonce.value,
      'the challenge must return the still-current generation, not a fresh one',
    );
    return { code, currentNonceReturned: true };
  });

  await suite.check('nonce/wrong-nonce-yields-a-challenge', async () => {
    const bogus = b64u(crypto.getRandomValues(new Uint8Array(32)));
    const response = await protectedGet({}, bogus);
    const code = expectDiagnostic(response, 'SNAPBACK_AUTH_SENDER_PROOF_REQUIRED', 'wrong nonce');
    expect(response.nonce === custodyNonce.value, 'a wrong-nonce challenge must not rotate');
    return { code };
  });

  await suite.check('nonce/an-unauthenticated-challenge-never-rotates-a-live-nonce', async () => {
    // @ref LLP 0077#nonce-protocol — defect 1's negative test: repeated
    // unauthenticated attempts leave the generation unchanged, denying a
    // copied-bearer holder any availability lever over legitimate custody.
    const live = custodyNonce.value;
    const observed = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const bogus = b64u(crypto.getRandomValues(new Uint8Array(32)));
      const response = await protectedGet({}, bogus);
      expectDiagnostic(response, 'SNAPBACK_AUTH_SENDER_PROOF_REQUIRED', `attempt ${attempt}`);
      observed.push(response.nonce);
    }
    expect(
      observed.every((value) => value === live),
      `the live generation churned under unauthenticated pressure: ${JSON.stringify(observed)}`,
    );
    return { attempts: observed.length, generationUnchanged: true };
  });

  await suite.check('nonce/the-challenged-generation-still-authorizes-a-fresh-proof', async () => {
    const response = observeNonce(await protectedGet());
    expect(
      response.status === 200,
      `the unrotated generation must still work: ${response.status} ${response.code}`,
    );
    return { status: 200 };
  });

  // --- D. replay -----------------------------------------------------------

  await suite.check('replay/a-byte-identical-proof-is-refused', async () => {
    // Replaying the whole proof also replays its nonce, and LLP 0077's
    // admission order puts the nonce check (step 6) ahead of replay
    // consumption (step 8) — so the observed code is the nonce challenge.
    // The isolated proof-id replay is the next check.
    const consumedNonce = custodyNonce.value;
    const proof = await resourceProof(custody, 'GET', protectedPath, bearer, consumedNonce);
    const first = observeNonce(await request('GET', protectedPath, {
      headers: { authorization: `Bearer ${bearer}`, [PROOF_HEADER]: proof },
    }));
    expect(first.status === 200, `the first use must succeed: ${first.status} ${first.code}`);
    const replay = await request('GET', protectedPath, {
      headers: { authorization: `Bearer ${bearer}`, [PROOF_HEADER]: proof },
    });
    const code = expectSenderRefusal(replay, 'replayed proof');
    return { code, precedence: 'nonce check precedes replay consumption' };
  });

  await suite.check('replay/a-reused-proof-id-under-a-live-nonce-is-refused-as-replayed', async () => {
    // Isolate the replay store: reuse only the `jti`, with the successor nonce
    // the first use installed, so the nonce check passes and step 8 is the
    // only thing left that can refuse.
    // @ref LLP 0077#http-binding — the uniqueness namespace is
    // `(sender_replay_epoch, proof_id)`; retention outlives the acceptance
    // window, so a same-second reuse still refuses.
    const reusedJti = freshJti();
    const first = observeNonce(await protectedGet({ payload: { jti: reusedJti } }));
    expect(first.status === 200, `the first use must succeed: ${first.status} ${first.code}`);
    const replay = await protectedGet({ payload: { jti: reusedJti } });
    const code = expectDiagnostic(
      replay, 'SNAPBACK_AUTH_SENDER_PROOF_REPLAYED', 'a reused proof id under a live nonce',
    );
    // A replay refusal is not a nonce challenge, so it echoes no nonce; what
    // matters is that it leaves the live generation intact and usable.
    expect(replay.nonce === null, 'a replay refusal must not carry a nonce challenge');
    const after = observeNonce(await protectedGet());
    expect(
      after.status === 200,
      `the live generation must survive a replay refusal: ${after.status} ${after.code}`,
    );
    return { code, nonceChallenge: null, liveGenerationSurvived: true };
  });

  // --- G. refusal axes -----------------------------------------------------
  //
  // Each axis is probed on POST /query/listNotes carrying a body that is
  // deliberately NOT valid JSON. If the refusal were to happen after body
  // ingestion the deployment would answer a parse/application diagnostic; a
  // sender-admission diagnostic proves admission completed first.
  // @ref LLP 0077#http-binding — "Sender admission runs entirely before the
  // request body is polled".

  const bodyPath = '/query/listNotes';
  const poisonBody = '{"this is not json';
  const probeRefusal = async (overrides, nonce = custodyNonce.value) => {
    const proof = await resourceProof(custody, 'POST', bodyPath, bearer, nonce, overrides);
    return request('POST', bodyPath, {
      headers: { authorization: `Bearer ${bearer}`, [PROOF_HEADER]: proof },
      body: poisonBody,
    });
  };

  const axis = (name, build) => suite.check(`refusal/${name}`, async () => {
    const live = custodyNonce.value;
    const response = await build();
    const code = expectSenderRefusal(response, name);
    // A refused axis must not consume or churn the live generation, or a
    // refusal axis would itself be an availability lever.
    expect(
      custodyNonce.value === live,
      `${name} disturbed the live nonce generation`,
    );
    return { code, status: response.status };
  });

  await axis('bad-signature', async () => {
    const proof = await resourceProof(custody, 'POST', bodyPath, bearer, custodyNonce.value);
    const parts = proof.split('.');
    const signature = Buffer.from(parts[2], 'base64url');
    signature[0] ^= 0xff;
    return request('POST', bodyPath, {
      headers: {
        authorization: `Bearer ${bearer}`,
        [PROOF_HEADER]: `${parts[0]}.${parts[1]}.${signature.toString('base64url')}`,
      },
      body: poisonBody,
    });
  });

  await axis('wrong-htm', () => probeRefusal({ payload: { htm: 'GET' } }));
  await axis('wrong-htu', () => probeRefusal({
    payload: { htu: canonicalUri('/query/someOtherQuery') },
  }));
  // A proof htu built from an origin the trusted terminator did NOT attest must
  // refuse at admission. In instrument-terminator composition that wrong origin
  // is the connect URL; in served composition the connect URL IS the attested
  // publicOrigin (a valid htu that would pass admission and rotate the live
  // nonce), so the genuinely-wrong origin is the loopback upstream — same
  // substitution as the issuance origin-confusion probe.
  await axis(
    servedComposition ? 'htu-from-the-internal-upstream-origin' : 'htu-from-the-connect-origin',
    () => probeRefusal({
      payload: { htu: `${servedComposition ? internalOrigin : origin}${bodyPath}` },
    }),
  );
  await axis('iat-older-than-the-window', () => probeRefusal({
    payload: { iat: nowSeconds() - 31 },
  }));
  await axis('iat-further-ahead-than-the-window', () => probeRefusal({
    payload: { iat: nowSeconds() + 6 },
  }));
  await axis('malformed-base64url', async () => {
    const proof = await resourceProof(custody, 'POST', bodyPath, bearer, custodyNonce.value);
    const parts = proof.split('.');
    return request('POST', bodyPath, {
      headers: {
        authorization: `Bearer ${bearer}`,
        // Padded, non-canonical base64 in the payload segment.
        [PROOF_HEADER]: `${parts[0]}.${parts[1]}==.${parts[2]}`,
      },
      body: poisonBody,
    });
  });
  await axis('wrong-alg', () => probeRefusal({ header: { alg: 'ES384' } }));
  await axis('wrong-typ', () => probeRefusal({ header: { typ: 'JWT' } }));
  await axis('unknown-jwk', async () => {
    const stranger = await generateCustody();
    const proof = await resourceProof(stranger, 'POST', bodyPath, bearer, custodyNonce.value);
    return request('POST', bodyPath, {
      headers: { authorization: `Bearer ${bearer}`, [PROOF_HEADER]: proof },
      body: poisonBody,
    });
  });
  await axis('unknown-token-is-folded-into-the-anti-oracle-challenge', async () => {
    const proof = await resourceProof(custody, 'POST', bodyPath, 'sbs_not_a_real_token',
      custodyNonce.value);
    return request('POST', bodyPath, {
      headers: { authorization: 'Bearer sbs_not_a_real_token', [PROOF_HEADER]: proof },
      body: poisonBody,
    });
  });

  await suite.check('refusal/absent-authorization-yields-AUTH_REQUIRED-not-a-challenge', async () => {
    // @ref LLP 0077#nonce-protocol — a genuinely absent Authorization header
    // yields SNAPBACK_AUTH_REQUIRED and never reaches the anti-oracle nonce
    // challenge, so it is not a family-existence oracle.
    const response = await request('POST', bodyPath, { body: { args: {} } });
    expect(
      response.code === 'SNAPBACK_AUTH_REQUIRED',
      `expected SNAPBACK_AUTH_REQUIRED, observed ${response.status} ${response.code}`,
    );
    expect(
      response.nonce === null,
      'an absent carrier must not receive a nonce challenge',
    );
    return { code: response.code };
  });

  await suite.check('refusal/absent-authorization-refuses-before-body-ingestion', async () => {
    // @ref LLP 0077#http-binding — "Sender admission runs entirely before the
    // request body is polled ... an unproven sender must never cause body
    // ingestion", and §Nonce protocol places the absent-carrier refusal "at the
    // route middleware before sender admission is reached".
    //
    // A body-invalid diagnostic here proves the opposite: the JSON parser ran
    // for a caller that presented no credential and no proof at all.
    const response = await request('POST', bodyPath, { body: poisonBody });
    expect(
      response.code === 'SNAPBACK_AUTH_REQUIRED',
      'an entirely unauthenticated caller reached the request-body JSON parser on a '
        + `sender-constrained hosted route: expected SNAPBACK_AUTH_REQUIRED, observed `
        + `${response.status} ${response.code}`,
    );
    return { code: response.code };
  });

  await suite.check('refusal/every-axis-refused-before-application-body-ingestion', async () => {
    // The control: the same poisoned body with a VALID proof must produce a
    // body/application diagnostic rather than a sender refusal. That is what
    // makes the axes above evidence of ordering rather than of a broken route.
    const proof = await resourceProof(custody, 'POST', bodyPath, bearer, custodyNonce.value);
    const response = observeNonce(await request('POST', bodyPath, {
      headers: { authorization: `Bearer ${bearer}`, [PROOF_HEADER]: proof },
      body: poisonBody,
    }));
    expect(
      !SENDER_REFUSALS.has(response.code),
      `the control must pass sender admission, observed ${response.code}`,
    );
    return { controlCode: response.code, controlStatus: response.status };
  });

  // --- E. grant matrix -----------------------------------------------------

  await suite.check('grant/connection-open-refuses-a-bare-bearer', async () => {
    const response = await request('POST', '/connection/open', {
      headers: { authorization: `Bearer ${bearer}` },
      body: {},
    });
    const code = expectSenderRefusal(response, 'connection/open without a proof');
    return { code };
  });

  let connectionId = null;
  let connectionToken = null;

  await suite.check('grant/connection-open-with-a-proof-mints-a-sender-bound-grant', async () => {
    const proof = await resourceProof(custody, 'POST', '/connection/open', bearer,
      custodyNonce.value);
    const response = observeNonce(await request('POST', '/connection/open', {
      headers: { authorization: `Bearer ${bearer}`, [PROOF_HEADER]: proof },
      body: {},
    }));
    expect(
      response.status === 200,
      `connection open failed: ${response.status} ${response.code ?? response.text.slice(0, 300)}`,
    );
    connectionId = response.json?.connectionId;
    connectionToken = response.json?.connectionToken;
    expect(typeof connectionId === 'string' && typeof connectionToken === 'string',
      'connection/open returned no grant');
    // LLP 0077 decision 4, first layer: sender-bound connection-open mints
    // the sct2_ grant spelling the v1 verifier cannot accept.
    expect(connectionToken.startsWith('sct2_'),
      `sender-bound grant must mint the sct2_ spelling, observed ${connectionToken.slice(0, 6)}…`);
    return { status: 200, successorNonce: typeof response.nonce === 'string' };
  });

  const grantRoutes = GRANT_HEADER_ROUTES.map(([method, template, body]) => [
    method,
    template.replace('{connection_id}', connectionId).replace('{name}', 'listNotes'),
    body,
  ]);

  await suite.check('grant/no-grant-route-accepts-the-grant-as-a-bare-bearer', async () => {
    // @ref LLP 0077#websocket-and-connection-binding — defect 2's witness: the
    // served route × carrier matrix. Every grant-presenting route, both
    // carriers, refuses without a grant-bound proof.
    const observed = [];
    for (const [method, path, body] of grantRoutes) {
      const response = await request(method, path, {
        headers: { [CONNECTION_TOKEN_HEADER]: connectionToken },
        ...(body === null ? {} : { body }),
      });
      expectSenderRefusal(response, `${method} ${path} header carrier without a proof`);
      expect(
        response.nonce === custodyNonce.value,
        `${method} ${path}: an unproven grant use rotated the live nonce`,
      );
      observed.push({ method, path, carrier: 'header', code: response.code });
    }
    facts.grantRoutes = observed;
    expect(observed.length === 10, `expected 10 grant header routes, probed ${observed.length}`);
    return { routes: observed.length, codes: [...new Set(observed.map((r) => r.code))] };
  });

  await suite.check('grant/the-websocket-carrier-also-refuses-without-a-proof', async () => {
    const streamPath = `/live/${connectionId}/stream`;
    const outcome = await openSocket(streamPath, [
      LIVE_STREAM_SUBPROTOCOL,
      `${CONNECTION_TOKEN_SUBPROTOCOL_PREFIX}${connectionToken}`,
      'snapback.auth-client.1',
    ]);
    expect(outcome.opened === false, 'an unproven WebSocket upgrade must not switch protocols');
    return { opened: false, detail: outcome.detail };
  });

  await suite.check('grant/a-proof-bound-grant-use-is-admitted-on-the-header-carrier', async () => {
    const path = `/outbox/${connectionId}`;
    const proof = await resourceProof(custody, 'GET', path, connectionToken, custodyNonce.value);
    const response = observeNonce(await request('GET', path, {
      headers: { [CONNECTION_TOKEN_HEADER]: connectionToken, [PROOF_HEADER]: proof },
    }));
    expect(
      response.status === 200,
      `proof-bound grant use failed: ${response.status} ${response.code ?? response.text.slice(0, 300)}`,
    );
    expect(typeof response.nonce === 'string', 'an accepted grant use must install a successor');
    return { status: 200, ath: 'bound to the grant token, not the session bearer' };
  });

  await suite.check('grant/every-use-needs-a-fresh-proof-the-consumed-one-is-refused', async () => {
    const path = `/outbox/${connectionId}`;
    const proof = await resourceProof(custody, 'GET', path, connectionToken, custodyNonce.value);
    const first = observeNonce(await request('GET', path, {
      headers: { [CONNECTION_TOKEN_HEADER]: connectionToken, [PROOF_HEADER]: proof },
    }));
    expect(first.status === 200, `first use: ${first.status} ${first.code}`);
    const second = await request('GET', path, {
      headers: { [CONNECTION_TOKEN_HEADER]: connectionToken, [PROOF_HEADER]: proof },
    });
    const code = expectSenderRefusal(second, 'a second use of one grant proof');
    return { code };
  });

  // --- F. WebSocket --------------------------------------------------------

  let socketOutcome = null;

  await suite.check('websocket/upgrade-with-the-proof-subprotocol-succeeds', async () => {
    const streamPath = `/live/${connectionId}/stream`;
    const proof = await resourceProof(custody, 'GET', streamPath, connectionToken,
      custodyNonce.value);
    socketOutcome = await openSocket(streamPath, [
      LIVE_STREAM_SUBPROTOCOL,
      `${CONNECTION_TOKEN_SUBPROTOCOL_PREFIX}${connectionToken}`,
      'snapback.auth-client.1',
      `${SENDER_PROOF_SUBPROTOCOL_PREFIX}${proof}`,
    ], { collectFirstFrame: true });
    expect(socketOutcome.opened === true,
      `sender-gated upgrade failed: ${socketOutcome.detail}`);
    return { opened: true };
  });

  await suite.check('websocket/the-first-server-frame-is-the-sender_nonce-release', async () => {
    // @ref LLP 0077#author-decisions--2026-07-23 — decision 5: browser
    // JavaScript cannot read the 101 DPoP-Nonce, so the successor is delivered
    // in band as the first frame, before any application-visible frame.
    expect(socketOutcome?.firstFrame != null, 'the socket yielded no first frame');
    const frame = JSON.parse(socketOutcome.firstFrame);
    expect(frame.kind === 'sender_nonce',
      `the first frame must be sender_nonce, observed ${JSON.stringify(frame).slice(0, 200)}`);
    expect(typeof frame.nonce === 'string' && frame.nonce.length === 43,
      `the in-band successor must be a 43-character nonce, observed ${frame.nonce}`);
    custodyNonce.value = frame.nonce;
    return { kind: frame.kind, nonceLength: frame.nonce.length };
  });

  await suite.check('websocket/the-proof-subprotocol-is-never-echoed-as-negotiated', async () => {
    expect(
      socketOutcome.negotiated === LIVE_STREAM_SUBPROTOCOL,
      `the server must select only ${LIVE_STREAM_SUBPROTOCOL}, observed `
        + `${JSON.stringify(socketOutcome.negotiated)}`,
    );
    expect(
      !String(socketOutcome.negotiated).startsWith(SENDER_PROOF_SUBPROTOCOL_PREFIX),
      'the compact proof must never become the application-visible subprotocol',
    );
    return { negotiated: socketOutcome.negotiated };
  });

  await suite.check('websocket/the-in-band-successor-authorizes-the-next-http-proof', async () => {
    const response = observeNonce(await protectedGet());
    expect(
      response.status === 200,
      `the in-band successor must be the live generation: ${response.status} ${response.code}`,
    );
    return { status: 200 };
  });
}, {
  reportFile: receiptFile,
  reportExtra: {
    instrument: 'demos/competitive-checkpoint/tests/acceptance/hosted-sender-matrix.mjs',
    governedBy: ['LLP 0077#acceptance', 'LLP 0098#8-acceptance--the-negative-test-ledger'],
    origin,
    publicOrigin,
    composition,
    ...(servedComposition ? { internalOrigin } : {}),
    clientIp,
    codeSource: process.env.SNAPBACK_MATRIX_CODE_SOURCE ?? 'operator-digest',
    sourceBucketObservation: bucketObservable ? 'operator-db' : 'unobserved',
    runAt: new Date().toISOString(),
    facts,
  },
});

// ---------------------------------------------------------------------------
// WebSocket helper
// ---------------------------------------------------------------------------

// The standard WebSocket constructor cannot set request headers, which is
// exactly the browser constraint LLP 0077 designs for: the connection token
// and the sender proof both travel as subprotocol values, and this instrument
// keeps them there. X-Forwarded-For is different — it is TERMINATOR
// infrastructure, not client auth material (LLP 0098 §6: the trusted edge
// supplies it, a browser never can) — so the instrument-as-terminator injects
// it through undici's non-standard `headers` init, which Node's global
// WebSocket accepts.
async function openSocket(path, protocols, { collectFirstFrame = false, timeoutMs = 10_000 } = {}) {
  const url = `${origin.replace(/^http/, 'ws')}${path}`;
  return new Promise((resolve) => {
    let socket;
    try {
      socket = new WebSocket(url, { protocols, headers: { [FORWARDED_FOR_HEADER]: clientIp } });
    } catch (error) {
      resolve({ opened: false, detail: `constructor refused: ${error.message}` });
      return;
    }
    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* already closed */ }
      resolve({ opened: false, detail: 'timed out waiting for the upgrade or the first frame' });
    }, timeoutMs);
    const settle = (value) => {
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      resolve(value);
    };
    socket.addEventListener('open', () => {
      if (!collectFirstFrame) settle({ opened: true, negotiated: socket.protocol, firstFrame: null });
    });
    socket.addEventListener('message', (event) => {
      settle({ opened: true, negotiated: socket.protocol, firstFrame: String(event.data) });
    });
    socket.addEventListener('error', () => {
      settle({ opened: false, detail: 'upgrade refused' });
    });
    socket.addEventListener('close', (event) => {
      settle({ opened: false, detail: `closed ${event.code} ${event.reason}` });
    });
  });
}
