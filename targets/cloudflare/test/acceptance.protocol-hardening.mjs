// ENG-24342 / ENG-24365 / ENG-24368: portable schema enforcement, exact
// function-kind routing, and bounded/fatal JSON decoding on every body route.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { request as httpRequest } from 'node:http';
import { startProof, ADMIN_TOKEN } from './harness.mjs';
import { validateWriteValues } from '../src/host-ops.js';

function code(body) {
  return body?.code || body?.diagnostic?.code;
}

// @ref LLP 0007#validation-requirements — local SQLite and the hosted
// target consume this one structural-write corpus; neither target gets to
// prove portability with a hand-picked target-specific subset.
const structuralCorpus = JSON.parse(fs.readFileSync(
  new URL('../../../tests/conformance/structural-validation.corpus.json', import.meta.url),
  'utf8',
));
assert.equal(structuralCorpus.version, 1);
const structuralCases = structuralCorpus.cases.filter((entry) => entry.operation !== 'seed');
const seedCases = structuralCorpus.cases.filter((entry) => entry.operation === 'seed');
for (const operation of ['insert', 'patch']) {
  for (const field of ['_id', '_version', '_createdAt', '_updatedAt']) {
    assert.ok(
      structuralCases.some((entry) => entry.operation === operation && Object.hasOwn(entry.values || {}, field)),
      `shared structural corpus is missing ${operation} coverage for ${field}`,
    );
  }
}
assert.ok(seedCases.length > 0, 'shared structural corpus must include compiled-seed rejection');
assert.ok(structuralCases.some((entry) => entry.operation === 'derivedInsert'));
assert.ok(structuralCases.some((entry) => entry.operation === 'derivedPatch'));

// LLP 0051 keeps `__proto__` as an ordinary legal declared key. Prove the
// Cloud normalizer neither invokes Object.prototype's setter nor drops it,
// and pin required-null parity for JSON fields (the generic JSON serializer
// otherwise considers null serializable).
const edgeTable = {
  name: 'edgeRecords',
  fields: [
    { name: 'payload', type: 'json', optional: false },
    { name: '__proto__', type: 'json', optional: true },
  ],
};
const edgeSchema = new Map([[edgeTable.name, edgeTable]]);
for (const insert of [true, false]) {
  const values = JSON.parse(insert
    ? '{"payload":{"valid":true},"__proto__":{"polluted":true}}'
    : '{"__proto__":{"polluted":true}}');
  const accepted = validateWriteValues(edgeSchema, edgeTable.name, values, { insert });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(Object.getPrototypeOf(accepted.values), null, 'normalized writes use a null prototype');
  assert.equal(Object.hasOwn(accepted.values, '__proto__'), true, '__proto__ remains an own data field');
  assert.deepEqual(accepted.values.__proto__, { polluted: true });
  assert.equal({}.polluted, undefined, 'declared __proto__ data must not mutate Object.prototype');

  const requiredNull = validateWriteValues(
    edgeSchema,
    edgeTable.name,
    { payload: null },
    { insert },
  );
  assert.equal(requiredNull.code, 'SNAPBACK_FIELD_TYPE_MISMATCH');
}
for (const typeCase of structuralCorpus.typeCases) {
  const typeTable = {
    name: 'typeRecords',
    fields: [{ name: 'value', type: typeCase.fieldType, optional: false }],
  };
  const result = validateWriteValues(
    new Map([[typeTable.name, typeTable]]),
    typeTable.name,
    { value: typeCase.value },
    { insert: true },
  );
  if (typeCase.expectOk) {
    assert.equal(result.ok, true, `${typeCase.name}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.values.value, typeCase.value, `${typeCase.name} changed the value`);
  } else {
    assert.equal(result.code, typeCase.expectedCode, `${typeCase.name}: ${JSON.stringify(result)}`);
  }
}

const proof = await startProof({ app: 'notes', port: 0 });
try {
  const base = await proof.url();
  const rawRequestInit = ({ body = '{}', contentType = 'application/json', headers = {} } = {}) => ({
    method: 'POST',
    headers: {
      'x-snapback-admin-token': ADMIN_TOKEN,
      ...(contentType === null ? {} : { 'content-type': contentType }),
      ...headers,
    },
    body,
  });
  const readRawResponse = async (response) => ({ status: response.status, body: await response.json() });
  const raw = async (path, options = {}) => readRawResponse(await fetch(
    `${base}${path}`,
    rawRequestInit(options),
  ));
  // @ref LLP 0040#proof-runtime-preflight-2026-07-14-eng-24454 — workerd
  // must reject the declared 4.1 MB length before requesting the body; this
  // header-only exchange proves that fast path without starting an uploader.
  const rawOversized = async (path, options = {}) => {
    const init = rawRequestInit(options);
    const body = Buffer.from(init.body);
    return new Promise((resolve, reject) => {
      let settled = false;
      const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const request = httpRequest(`${base}${path}`, {
        method: init.method,
        headers: {
          ...init.headers,
          'content-length': String(body.byteLength),
          expect: '100-continue',
        },
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.once('error', rejectOnce);
        response.once('end', () => {
          if (settled) return;
          try {
            const responseBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            settled = true;
            resolve({ status: response.statusCode, body: responseBody });
          } catch (error) {
            rejectOnce(error);
          }
        });
      });
      request.once('continue', () => request.destroy(new Error(
        'oversized request reached body upload instead of the Content-Length rejection',
      )));
      request.once('error', rejectOnce);
      request.setTimeout(5_000, () => request.destroy(new Error(
        'timed out waiting for the oversized Content-Length rejection',
      )));
      request.flushHeaders();
    });
  };

  // Required/type/unknown/protected-field failures, including values derived
  // inside the handler, must match the local runner case-for-case and leave
  // the durable version untouched.
  const inserted = await proof.mutation('insertRawNote', { values: { boardId: 'validation-board', text: 'valid' } });
  for (const testCase of structuralCases) {
    const isPatch = testCase.operation === 'patch' || testCase.operation === 'derivedPatch';
    const targetIds = isPatch ? [inserted.result.id, 'structural-validation-missing'] : [null];
    for (const targetId of targetIds) {
      const before = await proof.health();
      let result;
      if (testCase.operation === 'insert') {
        result = await proof.mutation('insertRawNote', { values: testCase.values });
      } else if (testCase.operation === 'patch') {
        result = await proof.mutation('touchNote', { id: targetId, values: testCase.values });
      } else if (testCase.operation === 'derivedInsert' || testCase.operation === 'derivedPatch') {
        result = await proof.mutation('writeDerivedRawNote', {
          operation: testCase.operation === 'derivedPatch' ? 'patch' : 'insert',
          id: targetId,
          field: testCase.field,
          left: testCase.left,
          right: testCase.right,
        });
      } else {
        throw new Error(`unknown structural corpus operation ${testCase.operation}`);
      }
      const target = targetId === null ? 'insert' : targetId;
      assert.equal(code(result), testCase.expectedCode, `${testCase.name} (${target}): ${JSON.stringify(result)}`);
      assert.equal((await proof.health()).version, before.version, `${testCase.name} (${target}) changed durable state`);
    }
  }
  const unknownField = await proof.query('queryRawNotes', { field: 'notDeclared', value: 'x' });
  const unknownIndex = await proof.query('queryRawNotes', { index: 'not_declared', field: 'boardId', value: 'b' });
  if (unknownField.code !== 'SNAPBACK_UNKNOWN_FIELD' || unknownIndex.code !== 'SNAPBACK_QUERY_UNKNOWN_INDEX') {
    throw new Error(`query schema validation drifted: ${JSON.stringify({ unknownField, unknownIndex })}`);
  }

  // Cross-kind attempts are rejected before handler invocation with 4xx.
  const mutationAsQuery = await raw('/query/addNote', { body: JSON.stringify({ args: { boardId: 'b', text: 'x' } }) });
  const queryAsMutation = await raw('/mutation/listNotes', { body: JSON.stringify({ args: { boardId: 'b' } }) });
  const actionAsMutation = await raw('/action/addNote', { body: JSON.stringify({ args: { boardId: 'b', text: 'x' } }) });
  const opened = await raw('/connection/open', { body: JSON.stringify({ connectionId: 'kind-cross-product' }) });
  const queryAsLive = await raw('/live/addNote/subscribe', {
    headers: { 'x-snapback-connection-token': opened.body.connectionToken },
    body: JSON.stringify({ connection_id: opened.body.connectionId, input: { args: {} } }),
  });
  for (const attempt of [mutationAsQuery, queryAsMutation, actionAsMutation, queryAsLive]) {
    if (attempt.status !== 400 || code(attempt.body) !== 'SNAPBACK_FUNCTION_KIND_MISMATCH') {
      throw new Error(`kind mismatch was not a stable 400: ${JSON.stringify(attempt)}`);
    }
  }

  const testState = async (path) => {
    const response = await fetch(`${base}${path}`, { method: 'POST' });
    assert.equal(response.status, 200, `${path} state probe failed`);
    return response.json();
  };
  const sideEffectFingerprint = async () => {
    const health = await proof.health();
    const notes = await proof.query('listNotes', { boardId: 'b' });
    const connections = await testState('/_snapback/test/connection-state');
    const cron = await testState('/_snapback/test/cron-claims');
    return {
      version: health.version,
      notes: { version: notes.version, rows: notes.rows },
      connections: connections.connections,
      subscriptions: connections.subscriptions,
      cronClaims: cron.claims,
      cronMutationResults: cron.mutationResults,
    };
  };

  // Proof/system lanes keep the pinned {ok, code, message, diagnostic}
  // refusal; kit routes serve the versioned ErrorResponse with the fully-filled
  // committed Diagnostic (LLP 0094 §0C.6 item 7 convergence).
  const diagnostic = (status, diagnosticCode, message, details = null) => ({
    status,
    body: {
      ok: false,
      code: diagnosticCode,
      message,
      diagnostic: {
        code: diagnosticCode,
        message,
        ...(details ? { details } : {}),
      },
    },
  });
  const kitDiagnostic = (status, diagnosticCode, message, details = null) => ({
    status,
    body: {
      formatVersion: 'snapback.error-response.v1',
      diagnostic: {
        code: diagnosticCode,
        severity: 'error',
        subsystem: 'server',
        message,
        details: details ?? {},
      },
    },
  });
  const bodyFailures = [
    {
      name: 'missing content type',
      request: { body: new Uint8Array([0x7b, 0x7d]), contentType: null },
      refusal: [415, 'SNAPBACK_CONTENT_TYPE_UNSUPPORTED', 'JSON endpoints require Content-Type: application/json'],
    },
    {
      name: 'wrong content type',
      request: { body: '{}', contentType: 'text/plain' },
      refusal: [415, 'SNAPBACK_CONTENT_TYPE_UNSUPPORTED', 'JSON endpoints require Content-Type: application/json'],
    },
    {
      name: 'empty required body',
      request: { body: '' },
      refusal: [400, 'SNAPBACK_JSON_BODY_REQUIRED', 'a JSON object request body is required'],
    },
    {
      name: 'malformed JSON',
      request: { body: '{"value": nope}' },
      refusal: [400, 'SNAPBACK_JSON_INVALID', 'request body is not valid JSON'],
    },
    {
      name: 'truncated JSON',
      request: { body: '{"truncated":' },
      refusal: [400, 'SNAPBACK_JSON_INVALID', 'request body is not valid JSON'],
    },
    {
      name: 'wrong JSON shape',
      request: { body: '[]' },
      refusal: [400, 'SNAPBACK_JSON_OBJECT_REQUIRED', 'request body must be a JSON object'],
    },
    {
      name: 'invalid UTF-8',
      request: { body: new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]) },
      refusal: [400, 'SNAPBACK_UTF8_INVALID', 'request body is not valid UTF-8'],
    },
    {
      name: 'oversized body',
      transport: 'expect-continue',
      request: { body: JSON.stringify({ padding: 'x'.repeat(4_100_000) }) },
      refusal: [
        413,
        'SNAPBACK_REQUEST_TOO_LARGE',
        'JSON request body exceeds the 4000000-byte limit',
        { limitBytes: 4_000_000 },
      ],
    },
  ];
  const bodyRoutes = [
    { name: 'proof query', path: '/query', dialect: 'proof' },
    { name: 'proof mutation', path: '/mutation', dialect: 'proof' },
    { name: 'kit query', path: '/query/listNotes', dialect: 'kit' },
    { name: 'kit mutation', path: '/mutation/addNote', dialect: 'kit' },
    { name: 'kit action', path: '/action/probeSlowFetch', dialect: 'kit' },
    { name: 'connection grant', path: '/connection/open', dialect: 'kit' },
    { name: 'app ensure', path: '/app/ensure', dialect: 'kit' },
    { name: 'kit live subscribe', path: '/live/listNotes/subscribe', dialect: 'kit' },
    { name: 'kit live unsubscribe', path: '/live/listNotes/unsubscribe', dialect: 'kit' },
    { name: 'handler host call', path: '/_snapback/host-call', dialect: 'proof', headers: { 'x-snapback-host-token': 'invalid' } },
    { name: 'testing action', path: '/_snapback/test/action', dialect: 'proof' },
    { name: 'operator cron run', path: '/_snapback/api/cron/run', dialect: 'proof', headers: { 'x-snapback-admin-token': ADMIN_TOKEN } },
  ];
  for (const route of bodyRoutes) {
    const before = await sideEffectFingerprint();
    for (const failure of bodyFailures) {
      const submit = failure.transport === 'expect-continue' ? rawOversized : raw;
      const actual = await submit(route.path, {
        ...failure.request,
        headers: { ...(route.headers || {}), ...(failure.request.headers || {}) },
      });
      const expected = route.dialect === 'kit'
        ? kitDiagnostic(...failure.refusal)
        : diagnostic(...failure.refusal);
      assert.deepEqual(
        actual,
        expected,
        `${route.name} (${route.path}) did not preserve the exact ${failure.name} diagnostic`,
      );
    }
    assert.deepEqual(
      await sideEffectFingerprint(),
      before,
      `${route.name} body rejections invoked a handler or changed durable/connection/cron state`,
    );
  }

  // ENG-24368 focused regression: cron/run used to opt into allowEmpty and
  // returned a semantic unknown-job error instead of the shared body error.
  const emptyBodyFailure = bodyFailures.find((failure) => failure.name === 'empty required body');
  const beforeEmptyCron = await sideEffectFingerprint();
  assert.deepEqual(
    await raw('/_snapback/api/cron/run', {
      ...emptyBodyFailure.request,
      headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
    }),
    diagnostic(...emptyBodyFailure.refusal),
    '/_snapback/api/cron/run must require the same JSON object body as every operator write',
  );
  assert.deepEqual(await sideEffectFingerprint(), beforeEmptyCron, 'empty /_snapback/api/cron/run must not touch the scheduler ledger');

  console.log(`cloudflare protocol-hardening acceptance: schema, kind, and ${bodyRoutes.length * bodyFailures.length} exact body-rejection cases passed`);
} finally {
  await proof.dispose();
}

// A compiled seed is host-owned, but it still crosses the identical manifest
// validator. Compile each invalid shared-corpus row into the test Worker and
// drive the real reset preparation path; caller-provided seed bytes remain
// forbidden by the production /app/ensure contract.
for (const testCase of seedCases) {
  const seedProof = await startProof({
    app: 'notes',
    seedOverride: { tables: { [structuralCorpus.schema.table]: [testCase.values] } },
  });
  try {
    const before = await seedProof.health();
    const rejected = await seedProof.reset();
    assert.equal(code(rejected), testCase.expectedCode, `${testCase.name}: ${JSON.stringify(rejected)}`);
    assert.equal((await seedProof.health()).version, before.version, `${testCase.name} changed durable state`);
  } finally {
    await seedProof.dispose();
  }
}

// ENG-24365's compatibility rule spans more than the representative notes
// cases above. All Aboard declares Query, LiveQuery, Mutation, and Action, so
// use one named function of each kind to exhaust every public/proof protocol
// boundary plus the cron and action.runMutation internal boundaries.
const kindProof = await startProof({ app: 'all-aboard', port: 0 });
try {
  const post = async (path, body, headers = {}) => {
    const response = await kindProof.raw(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-snapback-admin-token': ADMIN_TOKEN,
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const get = async (path, headers = {}) => {
    const response = await kindProof.raw(path, { headers });
    return { status: response.status, body: await response.json() };
  };
  const functionsByKind = [
    { kind: 'Query', name: 'stationsQuery', args: {} },
    { kind: 'LiveQuery', name: 'feedState', args: {} },
    { kind: 'Mutation', name: 'resetFeed', args: {} },
    { kind: 'Action', name: 'routeEstimate', args: {} },
  ];
  // Put LiveQuery last so its valid subscription cannot interleave a pushed
  // update with the three mismatch frames that precede it.
  const subscriptionOrder = [
    ...functionsByKind.filter((entry) => entry.kind !== 'LiveQuery'),
    functionsByKind.find((entry) => entry.kind === 'LiveQuery'),
  ];
  const httpBoundaries = [
    {
      name: 'proof query',
      accepts: new Set(['Query', 'LiveQuery']),
      invoke: (entry) => post('/query', { name: entry.name, args: entry.args }),
    },
    {
      name: 'proof mutation',
      accepts: new Set(['Mutation']),
      invoke: (entry) => post('/mutation', { name: entry.name, args: entry.args }),
    },
    {
      name: 'kit query',
      accepts: new Set(['Query', 'LiveQuery']),
      invoke: (entry) => post(`/query/${entry.name}`, { args: entry.args }),
    },
    {
      name: 'kit mutation',
      accepts: new Set(['Mutation']),
      invoke: (entry) => post(`/mutation/${entry.name}`, { args: entry.args }),
    },
    {
      name: 'kit action',
      accepts: new Set(['Action']),
      invoke: (entry) => post(`/action/${entry.name}`, { args: entry.args }),
    },
  ];

  for (const boundary of httpBoundaries) {
    for (const entry of functionsByKind) {
      const versionBefore = (await kindProof.health()).version;
      const attempt = await boundary.invoke(entry);
      if (boundary.accepts.has(entry.kind)) {
        assert.equal(attempt.status, 200, `${boundary.name} rejected compatible ${entry.kind}: ${JSON.stringify(attempt.body)}`);
        assert.notEqual(code(attempt.body), 'SNAPBACK_FUNCTION_KIND_MISMATCH');
      } else {
        assert.equal(attempt.status, 400, `${boundary.name} did not classify ${entry.kind} mismatch as 400`);
        assert.equal(code(attempt.body), 'SNAPBACK_FUNCTION_KIND_MISMATCH', `${boundary.name} accepted ${entry.kind}`);
        assert.equal((await kindProof.health()).version, versionBefore, `${boundary.name} invoked mismatched ${entry.kind}`);
      }
    }
  }

  // The testing action route exercises the proof protocol's direct action
  // boundary. It intentionally answers a test envelope at HTTP 200, but its
  // compatibility verdict must be the same stable diagnostic.
  for (const entry of functionsByKind) {
    const versionBefore = (await kindProof.health()).version;
    const attempt = await post('/_snapback/test/action', { name: entry.name, args: entry.args });
    assert.equal(attempt.status, 200);
    if (entry.kind === 'Action') {
      assert.equal(attempt.body.ok, true, `proof action rejected Action: ${JSON.stringify(attempt.body)}`);
    } else {
      assert.equal(attempt.body.ok, false);
      assert.equal(code(attempt.body), 'SNAPBACK_FUNCTION_KIND_MISMATCH', `proof action accepted ${entry.kind}`);
      assert.equal((await kindProof.health()).version, versionBefore, `proof action invoked mismatched ${entry.kind}`);
    }
  }

  const proofSocket = await kindProof.openLiveSocket();
  try {
    for (const entry of subscriptionOrder.filter((candidate) => candidate.kind !== 'LiveQuery')) {
      proofSocket.send({ type: 'subscribe', name: entry.name, args: entry.args });
      const frame = await proofSocket.waitFor('error');
      assert.equal(frame.code, 'SNAPBACK_FUNCTION_KIND_MISMATCH', `proof live accepted ${entry.kind}`);
    }
    proofSocket.send({ type: 'subscribe', name: 'missingKindMatrixFunction', args: {} });
    assert.equal(
      (await proofSocket.waitFor('error')).code,
      'SNAPBACK_LIVE_NOT_A_LIVE_QUERY',
      'proof live must keep unknown-function diagnosis distinct from known wrong-kind functions',
    );
    const stateBeforeValidProofLive = await post('/_snapback/test/connection-state', {});
    assert.equal(stateBeforeValidProofLive.body.subscriptions.length, 0, 'proof live mismatches persisted subscriptions');
    const liveQuery = functionsByKind.find((entry) => entry.kind === 'LiveQuery');
    proofSocket.send({ type: 'subscribe', name: liveQuery.name, args: liveQuery.args });
    assert.equal((await proofSocket.waitFor('snapshot')).function, liveQuery.name);
  } finally {
    proofSocket.close();
  }

  const opened = await post('/connection/open', { connectionId: 'kind-cross-product-all-aboard' });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  const kitUpgrade = await kindProof.raw(`/live/${opened.body.connectionId}/stream`, {
    headers: {
      upgrade: 'websocket',
      'sec-websocket-protocol': 'snapback.v1',
      'x-snapback-connection-token': opened.body.connectionToken,
    },
  });
  assert.ok(kitUpgrade.webSocket, 'kit live cross-product could not establish its authenticated socket');
  const kitSocket = kitUpgrade.webSocket;
  kitSocket.accept();
  try {
    for (const entry of subscriptionOrder.filter((candidate) => candidate.kind !== 'LiveQuery')) {
      const attempt = await post(
        `/live/${entry.name}/subscribe`,
        {
          connection_id: opened.body.connectionId,
          input: { args: entry.args },
        },
        { 'x-snapback-connection-token': opened.body.connectionToken },
      );
      assert.equal(attempt.status, 400, `kit live did not classify ${entry.kind} mismatch as 400`);
      assert.equal(code(attempt.body), 'SNAPBACK_FUNCTION_KIND_MISMATCH', `kit live accepted ${entry.kind}`);
    }
    const missing = await post(
      '/live/missingKindMatrixFunction/subscribe',
      { connection_id: opened.body.connectionId, input: { args: {} } },
      { 'x-snapback-connection-token': opened.body.connectionToken },
    );
    assert.equal(code(missing.body), 'SNAPBACK_LIVE_NOT_A_LIVE_QUERY');
    const liveQuery = functionsByKind.find((entry) => entry.kind === 'LiveQuery');
    const compatible = await post(
      `/live/${liveQuery.name}/subscribe`,
      { connection_id: opened.body.connectionId, input: { args: liveQuery.args } },
      { 'x-snapback-connection-token': opened.body.connectionToken },
    );
    assert.equal(compatible.status, 200, `kit live rejected LiveQuery: ${JSON.stringify(compatible.body)}`);
    assert.ok(compatible.body.snapshot);
  } finally {
    kitSocket.close();
  }

  // The override is a test-route seam, not a request field on the real
  // operator endpoint. Supplying the same spelling to /_snapback/api/cron/run must still
  // execute the manifest-declared refreshFeed Action rather than the caller's
  // Query target.
  const publicCronOverride = await post(
    '/_snapback/api/cron/run',
    { job: 'warmPoll', actionOverride: 'stationsQuery' },
    { 'x-snapback-admin-token': ADMIN_TOKEN },
  );
  assert.equal(publicCronOverride.status, 200, JSON.stringify(publicCronOverride.body));
  assert.equal(publicCronOverride.body.outcome, 'ok', 'ordinary cron entry point consumed testing-only actionOverride');

  // Cron targets are manifest-owned rather than caller-selected. The
  // testing-gated actionOverride retains the real manual cron runner while
  // substituting each function kind; failed kind checks must invoke no app
  // function and must remain visible in the cron ledger.
  for (const entry of functionsByKind) {
    const versionBefore = (await kindProof.health()).version;
    const attempt = await post('/_snapback/test/run-cron', {
      job: 'warmPoll',
      trigger: 'manual',
      actionOverride: entry.name,
    });
    assert.equal(attempt.status, 200, JSON.stringify(attempt.body));
    const status = await get('/_snapback/api/cron/status', { 'x-snapback-admin-token': ADMIN_TOKEN });
    const job = status.body.jobs.find((candidate) => candidate.name === 'warmPoll');
    assert.equal(job.lastRun.runId, attempt.body.runId);
    assert.equal((await kindProof.health()).version, versionBefore, 'kind-probe cron target changed app data');
    if (entry.kind === 'Action') {
      assert.equal(attempt.body.outcome, 'ok', JSON.stringify(attempt.body));
      assert.equal(job.lastRun.error, '');
    } else {
      assert.equal(attempt.body.outcome, 'failed', `cron accepted ${entry.kind}`);
      assert.match(job.lastRun.error, /^SNAPBACK_FUNCTION_KIND_MISMATCH:/, `cron hid ${entry.kind} mismatch`);
    }
  }

  // An Action may commit only through a Mutation. The test-only wrapper
  // calls the real ctx.runMutation host operation with every target kind.
  for (const entry of functionsByKind) {
    const versionBefore = (await kindProof.health()).version;
    const attempt = await post('/_snapback/test/action', {
      name: 'probeWrongNestedKind',
      args: { target: entry.name, targetArgs: entry.args },
    });
    assert.equal(attempt.status, 200);
    if (entry.kind === 'Mutation') {
      assert.equal(attempt.body.ok, true, `nested action rejected Mutation: ${JSON.stringify(attempt.body)}`);
    } else {
      assert.equal(attempt.body.ok, false, `nested action accepted ${entry.kind}`);
      assert.equal(code(attempt.body), 'SNAPBACK_FUNCTION_KIND_MISMATCH', `nested action hid ${entry.kind} mismatch`);
      assert.equal((await kindProof.health()).version, versionBefore, `nested action invoked mismatched ${entry.kind}`);
    }
  }

  console.log('cloudflare function-kind acceptance: 40 proof/kit/live/cron/nested cross-product cases passed');
} finally {
  await kindProof.dispose();
}
