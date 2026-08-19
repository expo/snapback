// Hosted-arm wire-schema gate (LLP 0094 §0F items 1–3 / LLP 0051 §D4).
//
// The committed schemas under schemas/ are generated from the Rust serde
// authorities and drift-gated on the Rust side (crates/snapback/tests/artifact_schemas_v0.rs).
// This suite is the HOSTED executable half: it validates what the Cloudflare
// arm actually serves against those same committed schemas —
//
//   1. the JS-composed kit-route responses (`kitOpenConnection`,
//      `kitSubscribe`, `kitQuery`, `kitEnsureApp`, the kit outbox arm) that
//      previously had no hosted drift check beyond the acceptance suites;
//   2. the LLP 0060 D6 private marker envelopes — REAL bytes captured on the
//      coordinator↔handler service bindings (startProof handlerWireCapture)
//      validated against the handler.* schemas;
//   3. the kit-socket in-band REQUEST grammar: the served
//      `validateLiveSocketFrame` verdicts must match schema validation of
//      live.kit-socket-request.schema.json over a shared corpus (the Rust
//      fixture twin is `kit_socket_request_schema_matches_the_served_validator_grammar`);
//   4. the kit-socket in-band REPLY grammar: real served pong, snapshot,
//      current_as_of, and error frames validate against
//      live.kit-socket-reply.schema.json.
//
// The LLP 0094 §0C.6 emitters converged 2026-07-27, so every exercised kit
// route validates HARD against its committed schema (the transient
// KNOWN_DIVERGENT allowlist this gate launched with is gone).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { startProof, ADMIN_TOKEN } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: !!condition, detail: condition ? undefined : detail });
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${condition ? '' : ` — ${detail ?? ''}`}`);
}

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
const validators = new Map();
function validatorFor(file) {
  if (!validators.has(file)) {
    const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'schemas', file), 'utf8'));
    validators.set(file, ajv.compile(schema));
  }
  return validators.get(file);
}

function validate(file, value) {
  const validator = validatorFor(file);
  const ok = validator(value);
  return { ok, errors: ok ? null : JSON.stringify(validator.errors) };
}

// Served-bytes check for one conformant route: parse the response text and
// validate it against the committed schema.
function checkServed(name, file, bodyText, extraDetail = '') {
  let value;
  try {
    value = JSON.parse(bodyText);
  } catch (error) {
    check(name, false, `response was not JSON: ${error}`);
    return null;
  }
  const verdict = validate(file, value);
  check(name, verdict.ok, `${verdict.errors}${extraDetail} body=${bodyText.slice(0, 400)}`);
  return value;
}

// A minimal awaitable wrapper over a Miniflare-dispatched kit socket.
class KitSocket {
  constructor(ws) {
    this.ws = ws;
    this.frames = [];
    this.frameWaiters = [];
    this.closed = null;
    this.closeWaiters = [];
    ws.addEventListener('message', (event) => {
      const frame = JSON.parse(event.data);
      const waiter = this.frameWaiters.shift();
      if (waiter) waiter(frame);
      else this.frames.push(frame);
    });
    ws.addEventListener('close', (event) => {
      this.closed = { code: event.code, reason: event.reason };
      for (const waiter of this.closeWaiters.splice(0)) waiter(this.closed);
    });
  }

  send(value) {
    this.ws.send(JSON.stringify(value));
  }

  nextFrame(timeoutMs = 4000) {
    if (this.frames.length) return Promise.resolve(this.frames.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a frame')), timeoutMs);
      this.frameWaiters.push((frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  }

  nextClose(timeoutMs = 4000) {
    if (this.closed) return Promise.resolve(this.closed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs);
      this.closeWaiters.push((closed) => {
        clearTimeout(timer);
        resolve(closed);
      });
    });
  }
}

async function main() {
  const wireRecords = [];
  const client = await startProof({ app: 'notes', handlerWireCapture: wireRecords });
  try {
    await client.reset();

    const openConnection = async (label) => {
      const response = await client.raw('/connection/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connectionId: label }),
      });
      const bodyText = await response.text();
      const grant = JSON.parse(bodyText);
      return { bodyText, grant };
    };
    const openSocket = async (grant) => {
      const response = await client.raw(`/live/${grant.connectionId}/stream`, {
        headers: {
          upgrade: 'websocket',
          // LLP 0094 §0B.4/B3: kit stream upgrades must offer a known
          // wire-version token.
          'sec-websocket-protocol': 'snapback.v1',
          'x-snapback-connection-token': grant.connectionToken,
        },
      });
      const ws = response.webSocket;
      if (!ws) throw new Error(`kit socket upgrade refused: ${response.status}`);
      ws.accept();
      return new KitSocket(ws);
    };

    // -- 1. conformant kit-route responses vs the committed schemas ---------
    const { bodyText: grantText, grant } = await openConnection('wiregate');
    checkServed('POST /connection/open serves a schema-valid connection grant',
      'connection.grant.schema.json', grantText);

    const socket = await openSocket(grant);

    const subscribeResponse = await client.raw('/live/listNotes/subscribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-snapback-connection-token': grant.connectionToken,
      },
      body: JSON.stringify({ connection_id: grant.connectionId, input: { args: { boardId: 'lobby' } } }),
    });
    checkServed('POST /live/{name}/subscribe serves a schema-valid subscribe output',
      'live.subscribe.output.schema.json', await subscribeResponse.text());

    const queryResponse = await client.raw('/query/listNotes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: { boardId: 'lobby' } }),
    });
    checkServed('POST /query/{name} serves a schema-valid QueryOutput',
      'query.output.schema.json', await queryResponse.text());

    // The mutation drives handler + host-call traffic for the capture checks
    // below; its response bytes converged (§0C.6 item 1) and validate hard.
    const mutationResponse = await client.raw('/mutation/addNote', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-snapback-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify({ args: { boardId: 'lobby', text: 'wire gate' } }),
    });
    checkServed('POST /mutation/{name} serves a schema-valid mutation output',
      'mutation.output.schema.json', await mutationResponse.text());

    const outboxResponse = await client.raw(`/outbox/${grant.connectionId}`, {
      headers: { 'x-snapback-connection-token': grant.connectionToken },
    });
    const outboxValue = checkServed('GET /outbox/{connection_id} serves a schema-valid drain batch',
      'live.outbox-drain.output.schema.json', await outboxResponse.text());
    check('hosted drain batch is the declared-empty bare array',
      Array.isArray(outboxValue) && outboxValue.length === 0, JSON.stringify(outboxValue));

    const ensureResponse = await client.raw('/app/ensure', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    checkServed('POST /app/ensure serves a schema-valid ensure outcome',
      'app.ensure.output.schema.json', await ensureResponse.text());

    const unsubscribeResponse = await client.raw('/live/listNotes/unsubscribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-snapback-connection-token': grant.connectionToken,
      },
      body: JSON.stringify({ connection_id: grant.connectionId, subscription_id: 'sub_unknown' }),
    });
    checkServed('POST /live/{name}/unsubscribe serves a schema-valid unsubscribe output',
      'live.unsubscribe.output.schema.json', await unsubscribeResponse.text());

    const failureResponse = await client.raw('/query/noSuchFunction', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-snapback-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify({ args: {} }),
    });
    checkServed('kit-route error envelope serves the versioned ErrorResponse',
      'error.response.schema.json', await failureResponse.text());

    socket.ws.close(1000, 'gate section 1 done');

    // -- 2. marker envelopes: real captured service-binding bytes -----------
    const invokeRecords = wireRecords.filter((record) => record.lane === 'invoke');
    const hostCallRecords = wireRecords.filter((record) => record.lane === 'host-call');
    check('the exercised routes produced captured handler invocations',
      invokeRecords.length >= 2, `captured ${invokeRecords.length}`);
    check('the exercised handlers produced captured host calls',
      hostCallRecords.length >= 1, `captured ${hostCallRecords.length}`);
    let invokeRequestsValid = true;
    let invokeResponsesValid = true;
    let detail = '';
    for (const record of invokeRecords) {
      const requestVerdict = validate('handler.invoke.input.schema.json', JSON.parse(record.requestBody));
      if (!requestVerdict.ok) {
        invokeRequestsValid = false;
        detail += ` request(${record.requestBody.slice(0, 200)}): ${requestVerdict.errors}`;
      }
      const responseVerdict = validate('handler.invoke.output.schema.json', JSON.parse(record.responseBody));
      if (!responseVerdict.ok) {
        invokeResponsesValid = false;
        detail += ` response(${record.responseBody.slice(0, 200)}): ${responseVerdict.errors}`;
      }
    }
    check('every captured coordinator→handler invocation request validates against handler.invoke.input',
      invokeRequestsValid, detail);
    check('every captured handler→coordinator response envelope validates against handler.invoke.output',
      invokeResponsesValid, detail);
    let hostCallsValid = true;
    let hostCallDetail = '';
    for (const record of hostCallRecords) {
      const verdict = validate('handler.host-call.input.schema.json', JSON.parse(record.requestBody));
      if (!verdict.ok) {
        hostCallsValid = false;
        hostCallDetail += ` body(${record.requestBody.slice(0, 200)}): ${verdict.errors}`;
      }
    }
    check('every captured handler→host call body validates against handler.host-call.input',
      hostCallsValid, hostCallDetail);

    // -- 3. kit-socket in-band reply grammar: real served bytes -------------
    const { grant: replyGrant } = await openConnection('wiregate_replies');
    const replySocket = await openSocket(replyGrant);

    replySocket.send({ type: 'ping', requestId: 'reply-gate' });
    const pongReply = await replySocket.nextFrame();
    const pongVerdict = validate('live.socket-server.schema.json', pongReply);
    check('kit socket serves a pong conforming to the committed LiveSocketServerFrame schema',
      pongReply.kind === 'pong' && pongVerdict.ok,
      `${pongVerdict.errors} frame=${JSON.stringify(pongReply).slice(0, 400)}`);

    replySocket.send({ type: 'subscribe', name: 'boardNotes', args: { boardId: 'wiregate' } });
    const snapshotReply = await replySocket.nextFrame();
    const snapshotVerdict = validate('live.kit-socket-reply.schema.json', snapshotReply);
    check('kit socket serves a schema-valid snapshot reply',
      snapshotReply.kind === 'snapshot' && snapshotVerdict.ok,
      `${snapshotVerdict.errors} frame=${JSON.stringify(snapshotReply).slice(0, 400)}`);
    check('the snapshot reply exposes a fresh resume token for current_as_of proof',
      typeof snapshotReply.resume?.token === 'string',
      JSON.stringify(snapshotReply).slice(0, 400));

    if (snapshotReply.resume?.token) {
      replySocket.send({
        type: 'subscribe',
        name: 'boardNotes',
        args: { boardId: 'wiregate' },
        resumeFromToken: { resume: snapshotReply.resume },
      });
      const currentAsOfReply = await replySocket.nextFrame();
      const currentAsOfVerdict = validate('live.kit-socket-reply.schema.json', currentAsOfReply);
      check('kit socket serves a schema-valid current_as_of reply',
        currentAsOfReply.kind === 'current_as_of' && currentAsOfVerdict.ok,
        `${currentAsOfVerdict.errors} frame=${JSON.stringify(currentAsOfReply).slice(0, 400)}`);
    } else {
      check('kit socket serves a schema-valid current_as_of reply', false,
        'snapshot reply did not carry the resume token needed to exercise rung 1');
    }

    replySocket.send({ type: 'subscribe', name: 'noSuchLiveQuery', args: {} });
    const errorReply = await replySocket.nextFrame();
    const errorVerdict = validate('live.kit-socket-reply.schema.json', errorReply);
    check('kit socket serves a schema-valid error reply',
      errorReply.kind === 'error' && errorVerdict.ok,
      `${errorVerdict.errors} frame=${JSON.stringify(errorReply).slice(0, 400)}`);
    replySocket.ws.close(1000, 'gate section 3 done');

    // -- 4. kit-socket in-band request grammar: served verdict === schema ---
    // One socket per case: the served validator answers an invalid frame by
    // CLOSING the socket (1008 + SNAPBACK_LIVE_FRAME_INVALID), so cases must
    // not share transport state. Accepted-frame observations: subscribe →
    // any reply frame (snapshot / current_as_of / error — admission ran, the
    // grammar accepted); ping → pong; unsubscribe → silent, proven live by a
    // follow-up ping.
    const corpus = [
      { name: 'subscribe minimal', accept: true, kind: 'subscribe',
        frame: { type: 'subscribe', name: 'listNotes', args: {} } },
      { name: 'subscribe with args + supersedes', accept: true, kind: 'subscribe',
        frame: { type: 'subscribe', name: 'listNotes', args: { boardId: 'lobby' }, supersedes: 'sub_prior' } },
      { name: 'subscribe with resumeFromToken', accept: true, kind: 'subscribe',
        frame: { type: 'subscribe', name: 'listNotes', args: {},
          resumeFromToken: { resume: { token: 'sbrt1.opaque', meta: { app: 'notes' } } } } },
      { name: 'subscribe with arbitrary-shape membershipWitness', accept: true, kind: 'subscribe',
        frame: { type: 'subscribe', name: 'listNotes', args: {},
          resumeFromToken: { resume: { token: 'sbrt1.opaque' }, membershipWitness: { unvalidated: true } } } },
      { name: 'unsubscribe', accept: true, kind: 'unsubscribe',
        frame: { type: 'unsubscribe', subscriptionId: 'sub_unknown' } },
      { name: 'ping bare', accept: true, kind: 'ping', frame: { type: 'ping' } },
      { name: 'ping with requestId', accept: true, kind: 'ping', frame: { type: 'ping', requestId: 'rq1' } },
      { name: 'unknown type', accept: false, frame: { type: 'snapshot' } },
      { name: 'subscribe without args', accept: false, frame: { type: 'subscribe', name: 'listNotes' } },
      { name: 'subscribe with empty name', accept: false, frame: { type: 'subscribe', name: '', args: {} } },
      { name: 'subscribe with array args', accept: false, frame: { type: 'subscribe', name: 'listNotes', args: [] } },
      { name: 'subscribe with empty supersedes', accept: false,
        frame: { type: 'subscribe', name: 'listNotes', args: {}, supersedes: '' } },
      { name: 'subscribe with null supersedes', accept: false,
        frame: { type: 'subscribe', name: 'listNotes', args: {}, supersedes: null } },
      { name: 'subscribe with unknown member', accept: false,
        frame: { type: 'subscribe', name: 'listNotes', args: {}, extra: 1 } },
      { name: 'subscribe with empty resume token', accept: false,
        frame: { type: 'subscribe', name: 'listNotes', args: {}, resumeFromToken: { resume: { token: '' } } } },
      { name: 'subscribe with oversized resume token', accept: false,
        frame: { type: 'subscribe', name: 'listNotes', args: {}, resumeFromToken: { resume: { token: 'x'.repeat(1025) } } } },
      { name: 'subscribe with tokenless resume', accept: false,
        frame: { type: 'subscribe', name: 'listNotes', args: {}, resumeFromToken: { resume: {} } } },
      { name: 'subscribe with unknown resumeFromToken member', accept: false,
        frame: { type: 'subscribe', name: 'listNotes', args: {}, resumeFromToken: { resume: { token: 't' }, extra: 1 } } },
      { name: 'unsubscribe with empty subscriptionId', accept: false,
        frame: { type: 'unsubscribe', subscriptionId: '' } },
      { name: 'unsubscribe without subscriptionId', accept: false, frame: { type: 'unsubscribe' } },
      { name: 'unsubscribe with unknown member', accept: false,
        frame: { type: 'unsubscribe', subscriptionId: 'sub_1', extra: 1 } },
      { name: 'ping with non-string requestId', accept: false, frame: { type: 'ping', requestId: 7 } },
      { name: 'ping with null requestId', accept: false, frame: { type: 'ping', requestId: null } },
      { name: 'ping with unknown member', accept: false, frame: { type: 'ping', extra: true } },
    ];
    let grammarParity = true;
    let grammarDetail = '';
    for (let index = 0; index < corpus.length; index += 1) {
      const testCase = corpus[index];
      const schemaVerdict = validate('live.kit-socket-request.schema.json', testCase.frame).ok;
      const { grant: caseGrant } = await openConnection(`wiregate_grammar_${index}`);
      const caseSocket = await openSocket(caseGrant);
      let servedAccepts;
      caseSocket.send(testCase.frame);
      if (!testCase.accept) {
        try {
          const closed = await caseSocket.nextClose();
          servedAccepts = !(closed.code === 1008 && closed.reason === 'SNAPBACK_LIVE_FRAME_INVALID');
        } catch (_) {
          servedAccepts = true; // no close arrived: the validator accepted it
        }
      } else if (testCase.kind === 'subscribe') {
        await caseSocket.nextFrame();
        servedAccepts = caseSocket.closed === null;
      } else if (testCase.kind === 'ping') {
        const reply = await caseSocket.nextFrame();
        servedAccepts = reply.kind === 'pong' && caseSocket.closed === null;
      } else {
        // unsubscribe answers nothing; a surviving socket answers the probe.
        caseSocket.send({ type: 'ping', requestId: 'liveness' });
        const reply = await caseSocket.nextFrame();
        servedAccepts = reply.kind === 'pong' && caseSocket.closed === null;
      }
      if (servedAccepts !== testCase.accept || schemaVerdict !== testCase.accept) {
        grammarParity = false;
        grammarDetail += ` [${testCase.name}: expected=${testCase.accept} served=${servedAccepts} schema=${schemaVerdict}]`;
      }
      try { caseSocket.ws.close(1000, 'case done'); } catch (_) {}
    }
    check('served validateLiveSocketFrame verdicts match live.kit-socket-request schema over the corpus',
      grammarParity, grammarDetail);
  } finally {
    await client.dispose();
  }

  const failed = results.filter((result) => !result.ok);
  const summary = `${results.length - failed.length}/${results.length}`;
  if (failed.length > 0) {
    console.error(`cloudflare wire-schema gate: FAILED (${summary} checks passed)`);
    process.exit(1);
  }
  console.log(`cloudflare wire-schema gate: ${summary} checks passed`);
}

main().catch((error) => {
  console.error('cloudflare wire-schema gate: crashed', error);
  process.exit(1);
});
