// ENG-24342 / ENG-24365 / ENG-24368: portable schema enforcement, exact
// function-kind routing, and bounded/fatal JSON decoding on every body route.
import { startProof, ADMIN_TOKEN } from './harness.mjs';

function code(body) {
  return body?.code || body?.diagnostic?.code;
}

const proof = await startProof({ app: 'notes', port: 0 });
try {
  const base = await proof.url();
  const raw = async (path, { body = '{}', contentType = 'application/json', headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { ...(contentType === null ? {} : { 'content-type': contentType }), ...headers },
      body,
    });
    return { status: response.status, body: await response.json() };
  };

  // Schema validation on insert and patch: required, type, unknown, null,
  // and every host-owned system field have stable portable codes.
  const cases = [
    [{ boardId: 'b' }, 'SNAPBACK_FIELD_MISSING'],
    [{ boardId: 'b', text: 42 }, 'SNAPBACK_FIELD_TYPE_MISMATCH'],
    [{ boardId: 'b', text: null }, 'SNAPBACK_FIELD_TYPE_MISMATCH'],
    [{ boardId: 'b', text: 'ok', surprise: true }, 'SNAPBACK_UNKNOWN_FIELD'],
  ];
  for (const [values, expected] of cases) {
    const result = await proof.mutation('insertRawNote', { values });
    if (result.code !== expected) throw new Error(`schema case ${JSON.stringify(values)}: ${JSON.stringify(result)}`);
  }
  for (const field of ['_id', '_version', '_createdAt', '_updatedAt']) {
    const result = await proof.mutation('insertRawNote', { values: { boardId: 'b', text: 'ok', [field]: 1 } });
    if (result.code !== 'SNAPBACK_SYSTEM_FIELD_WRITE') {
      throw new Error(`protected field ${field} was accepted: ${JSON.stringify(result)}`);
    }
  }
  const inserted = await proof.mutation('insertRawNote', { values: { boardId: 'b', text: 'valid' } });
  const patch = await proof.mutation('touchNote', { id: inserted.result.id, values: { _createdAt: 1 } });
  if (patch.code !== 'SNAPBACK_SYSTEM_FIELD_WRITE') throw new Error(`protected patch was accepted: ${JSON.stringify(patch)}`);
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

  const beforeMalformed = await proof.health();
  const bodyRoutes = [
    ['/query', {}],
    ['/mutation/addNote', {}],
    ['/action/probeSlowFetch', {}],
    ['/connection/open', {}],
    ['/app/ensure', {}],
    ['/live/listNotes/subscribe', {}],
    ['/__test/action', {}],
    ['/cron/run', { headers: { 'x-snapback-admin-token': ADMIN_TOKEN } }],
  ];
  for (const [path, options] of bodyRoutes) {
    const malformed = await raw(path, { ...options, body: '{"truncated":' });
    if (malformed.status !== 400 || code(malformed.body) !== 'SNAPBACK_JSON_INVALID') {
      throw new Error(`${path} malformed JSON did not return stable 400: ${JSON.stringify(malformed)}`);
    }
  }
  const wrongType = await raw('/query', { body: '{}', contentType: 'text/plain' });
  const empty = await raw('/query', { body: '' });
  const wrongShape = await raw('/query', { body: '[]' });
  if (wrongType.status !== 415 || code(wrongType.body) !== 'SNAPBACK_CONTENT_TYPE_UNSUPPORTED') throw new Error(JSON.stringify(wrongType));
  if (empty.status !== 400 || code(empty.body) !== 'SNAPBACK_JSON_BODY_REQUIRED') throw new Error(JSON.stringify(empty));
  if (wrongShape.status !== 400 || code(wrongShape.body) !== 'SNAPBACK_JSON_OBJECT_REQUIRED') throw new Error(JSON.stringify(wrongShape));

  const invalidUtf8 = await raw('/query', {
    body: new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
  });
  if (invalidUtf8.status !== 400 || code(invalidUtf8.body) !== 'SNAPBACK_UTF8_INVALID') {
    throw new Error(`invalid UTF-8 was not rejected fatally: ${JSON.stringify(invalidUtf8)}`);
  }

  const oversized = await raw('/query', { body: JSON.stringify({ padding: 'x'.repeat(4_100_000) }) });
  if (oversized.status !== 413 || code(oversized.body) !== 'SNAPBACK_REQUEST_TOO_LARGE') {
    throw new Error(`oversized streaming body was not bounded: ${JSON.stringify(oversized)}`);
  }
  const afterMalformed = await proof.health();
  if (afterMalformed.version !== beforeMalformed.version) throw new Error('rejected request changed durable state');

  console.log('cloudflare protocol-hardening acceptance: schema, kind, JSON, UTF-8, and streaming-size gates passed');
} finally {
  await proof.dispose();
}
