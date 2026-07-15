// ENG-24991: kit half of the auth.session schema/validator parity proof.
//
// `tests/conformance/auth-session-parity.corpus.json` is one shared corpus of
// handshake responses with pinned accept/reject verdicts. The Rust side
// (`tests/artifact_schemas_v0.rs`) proves the committed JSON Schema returns
// exactly those verdicts; this suite proves the executable kit validator
// (`projectAuthSessionResponse`, exercised through `SnapbackClient.authSession`)
// returns the same ones. Together they pin schema == shipped client, so
// codegen/conformance can never approve a handshake no actual client accepts.
//
// @ref LLP 0058#exact-response-dto — one closed Rust/schemars authority; the
// generated schema and the kit validator must reject the same shapes.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../client.mjs';
import { AuthCoordinator, createMemoryAuthCustodyStorage } from '../../../packages/snapback-contract/auth-coordinator.mjs';
import { assert, assertEqual, createSuite } from '../harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORPUS_PATH = join(ROOT, 'tests', 'conformance', 'auth-session-parity.corpus.json');

const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'));
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const caseValue = ({ base, remove = [], set = [] }) => {
  const value = structuredClone(corpus.bases[base]);
  if (!value || typeof value !== 'object') {
    throw new Error(`corpus base ${base} must be an object`);
  }
  for (const path of remove) {
    let target = value;
    for (const token of path.slice(0, -1)) {
      target = target[token];
      if (!target || typeof target !== 'object') {
        throw new Error(`remove path parent ${token} exists`);
      }
    }
    const last = path[path.length - 1];
    if (!Object.hasOwn(target, last)) throw new Error(`remove path member ${last} exists`);
    delete target[last];
  }
  for (const { path, value: assigned } of set) {
    let target = value;
    for (const token of path.slice(0, -1)) {
      target = target[token];
      if (!target || typeof target !== 'object') {
        throw new Error(`set path parent ${token} exists`);
      }
    }
    target[path[path.length - 1]] = structuredClone(assigned);
  }
  return value;
};

const response = (body) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
});

const kitVerdict = async (body) => {
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/auth/session') return response(body);
    throw new Error(`unexpected path ${new URL(url).pathname}`);
  };
  const coordinator = new AuthCoordinator({
    appId: 'schema-parity-app',
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const authMode = body.activeMode === 'sessions' ? 'sessions' : 'dev';
  const incarnation = UUID_V7.test(body.authorizationStreamIncarnation ?? '')
    ? body.authorizationStreamIncarnation
    : '01890f3c-9d5b-7000-8000-000000000001';
  let capture = await coordinator.establishAnonymous({
    kind: 'anonymous',
    authMode,
    authorizationStreamIncarnation: incarnation,
  });
  if (
    authMode === 'sessions'
    && body.authority?.isAuthenticated
    && UUID_V7.test(body.authority.sessionId ?? '')
    && UUID_V7.test(body.authority.userId ?? '')
  ) {
    capture = await coordinator.transition(capture, {
      authority: {
        kind: 'session',
        authMode: 'sessions',
        authorizationStreamIncarnation: incarnation,
        sessionId: body.authority.sessionId,
        userId: body.authority.userId,
      },
      bearer: 'schema-parity-bearer',
      refreshAfterMs: 1,
    });
  }
  const db = new SnapbackClient('http://stub', {
    authCoordinator: coordinator,
    authInvalidationProtocol: body.clientProtocols?.authInvalidation ?? null,
    authorityDescriptorProtocol: body.clientProtocols?.authorityDescriptor ?? null,
    authorizedLeaseProtocol: body.clientProtocols?.authorizedLease ?? null,
  });
  try {
    const projected = await db.authSession();
    return projected !== null ? 'accept' : 'reject';
  } catch (error) {
    if (error?.diagnostic?.code === 'SNAPBACK_AUTH_HANDSHAKE_INVALID') return 'reject';
    throw error;
  }
};

const suite = createSuite('_kit auth.session schema/validator parity', { expectedChecks: 3 });
const originalFetch = globalThis.fetch;

try {
  await suite.check('the shared corpus names the committed schema and keeps coverage', () => {
    assertEqual(corpus.schema, 'auth.session.output.schema.json');
    assert(Array.isArray(corpus.cases), 'corpus has cases');
    assert(corpus.cases.length >= 50, `parity corpus lost coverage: ${corpus.cases.length} cases`);
    const accepts = corpus.cases.filter(({ expect }) => expect === 'accept').length;
    assert(accepts >= 3, `parity corpus must keep positive coverage, found ${accepts}`);
    return { cases: corpus.cases.length, accepts };
  });

  await suite.check('the kit validator returns the pinned verdict for every corpus case', async () => {
    const mismatches = [];
    for (const item of corpus.cases) {
      const verdict = await kitVerdict(caseValue(item));
      if (verdict !== item.expect) {
        mismatches.push(`${item.name}: kit ${verdict}, corpus pins ${item.expect}`);
      }
    }
    assert(
      mismatches.length === 0,
      `kit validator disagrees with the shared corpus (schema parity broken):\n${mismatches.join('\n')}`,
    );
    return { cases: corpus.cases.length };
  });

  await suite.check('every exact root member is load-bearing for the kit validator', async () => {
    const base = corpus.bases.settledDevAnonymous;
    const members = Object.keys(base);
    assertEqual(members.length, 17, 'root member census changed');
    assertEqual(await kitVerdict(structuredClone(base)), 'accept');
    for (const member of members) {
      const omitted = structuredClone(base);
      delete omitted[member];
      assertEqual(await kitVerdict(omitted), 'reject', `omitting ${member} must reject`);
    }
    return { members: members.length };
  });
} finally {
  globalThis.fetch = originalFetch;
}

const report = suite.finish();
process.exit(report.ok ? 0 : 1);
