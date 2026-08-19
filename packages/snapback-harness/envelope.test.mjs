import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { classifyHandlerPlatformFailure } from '../../targets/cloudflare/src/platform-errors.js';
import { admitDeclaredRefusal, handlerEnvelopeCode, parseHandlerEnvelope } from './envelope.mjs';

const bootstrap = await readFile(new URL('./ctx-bootstrap.js', import.meta.url), 'utf8');

async function settleHostile(getter) {
  const context = vm.createContext({});
  vm.runInContext('globalThis.__hostCall = function() { return "null"; };', context);
  vm.runInContext(bootstrap, context, { filename: 'ctx-bootstrap.js' });
  vm.runInContext(`
    globalThis.__snapbackHandlers = {
      probe: async function(_ctx, args) {
        var failure = new Error('safe failure');
        Object.defineProperty(failure, 'stack', {
          configurable: true,
          value: 'Error: safe failure\\n    at probe (handler.js:2:3)'
        });
        if (args.getter === 'name') {
          Object.defineProperty(failure, 'name', {
            configurable: true,
            get: function() { throw new Error('name trap'); }
          });
        } else if (args.getter === 'constructor') {
          Object.defineProperty(failure, 'constructor', {
            configurable: true,
            get: function() { throw new Error('constructor trap'); }
          });
        } else if (args.getter === 'stack') {
          Object.defineProperty(failure, 'stack', {
            configurable: true,
            get: function() { throw new Error('stack trap'); }
          });
        } else if (args.getter === 'message') {
          Object.defineProperty(failure, 'message', {
            configurable: true,
            get: function() { throw new Error('message trap'); }
          });
        } else if (args.getter === 'invalid') {
          Object.defineProperty(failure, 'name', { value: 'bad-class' });
        } else if (args.getter === 'reserved') {
          Object.defineProperty(failure, 'name', { value: 'unclassified' });
        }
        throw failure;
      }
    };
  `, context);
  return context.__snapbackSettle(
    'probe',
    JSON.stringify({ getter }),
    '{}',
    'mutation',
    null,
    null,
    '1',
    () => 'null',
  );
}

async function settleExpression(expression) {
  const context = vm.createContext({});
  vm.runInContext('globalThis.__hostCall = function() { return "null"; };', context);
  vm.runInContext(bootstrap, context, { filename: 'ctx-bootstrap.js' });
  vm.runInContext(`
    globalThis.__snapbackHandlers = {
      probe: async function() { throw (${expression}); }
    };
  `, context);
  return parseHandlerEnvelope(await context.__snapbackSettle(
    'probe',
    '{}',
    '{}',
    'mutation',
    null,
    null,
    '1',
    () => 'null',
  ));
}

test('sealed auth projection carries the asset-callback actor kind', async () => {
  const context = vm.createContext({});
  vm.runInContext('globalThis.__hostCall = function() { return "null"; };', context);
  vm.runInContext(bootstrap, context, { filename: 'ctx-bootstrap.js' });
  vm.runInContext(`
    globalThis.__snapbackHandlers = {
      probe: async function(ctx) {
        return {
          actorKind: ctx.auth.actorKind,
          sessionId: ctx.auth.sessionId,
          frozen: Object.isFrozen(ctx.auth),
          intruder: ctx.auth.intruder,
        };
      }
    };
  `, context);
  const decoded = parseHandlerEnvelope(await context.__snapbackSettle(
    'probe',
    '{}',
    JSON.stringify({
      userId: 'usr_asset_callbacks',
      sessionId: null,
      isAuthenticated: true,
      kind: 'agent',
      actorKind: 'asset-callbacks',
      intruder: 'discard-me',
    }),
    'mutation',
    null,
    null,
    '1',
    () => 'null',
  ));
  assert.deepEqual(decoded, {
    ok: true,
    value: {
      actorKind: 'asset-callbacks',
      sessionId: null,
      frozen: true,
    },
  });
});

// @ref LLP 0214#62-projection-rules — application code sees
// only the allowlisted, null-prototype, deeply frozen catalog projection.
test('verified auth claims are exact and deeply read-only', async () => {
  const context = vm.createContext({});
  vm.runInContext('globalThis.__hostCall = function() { return "null"; };', context);
  vm.runInContext(bootstrap, context, { filename: 'ctx-bootstrap.js' });
  vm.runInContext(`
    globalThis.__snapbackHandlers = {
      probe: async function(ctx) {
        var identity = ctx.auth.claims.identities[0];
        var assurance = ctx.auth.claims.assurances[0];
        try { identity.subject = 'forged'; } catch (_) {}
        try { ctx.auth.claims.identities.push({}); } catch (_) {}
        return {
          authFrozen: Object.isFrozen(ctx.auth),
          claimsFrozen: Object.isFrozen(ctx.auth.claims),
          identitiesFrozen: Object.isFrozen(ctx.auth.claims.identities),
          identityFrozen: Object.isFrozen(identity),
          assuranceFrozen: Object.isFrozen(assurance),
          claimsPrototypeIsNull: Object.getPrototypeOf(ctx.auth.claims) === null,
          identitiesPrototypeIsNull: Object.getPrototypeOf(ctx.auth.claims.identities) === null,
          assurancesPrototypeIsNull: Object.getPrototypeOf(ctx.auth.claims.assurances) === null,
          identityPrototypeIsNull: Object.getPrototypeOf(identity) === null,
          subject: identity.subject,
          identityKeys: Object.keys(identity).sort(),
          assuranceKeys: Object.keys(assurance).sort(),
        };
      }
    };
  `, context);
  const decoded = parseHandlerEnvelope(await context.__snapbackSettle(
    'probe',
    '{}',
    JSON.stringify({
      userId: 'usr_verified', sessionId: 'ses_verified', isAuthenticated: true,
      claims: {
        identities: [{ kind: 'oidc', providerKey: 'workforce', issuer: 'https://issuer.example', subject: 'subject-1', intruder: 'discard' }],
        assurances: [{ kind: 'authenticated', provenance: 'federation', issuedAt: 12, intruder: 'discard' }],
        intruder: 'discard',
      },
    }),
    'query', null, null, '2', () => 'null',
  ));
  assert.deepEqual(decoded, {
    ok: true,
    value: {
      authFrozen: true,
      claimsFrozen: true,
      identitiesFrozen: true,
      identityFrozen: true,
      assuranceFrozen: true,
      claimsPrototypeIsNull: true,
      identitiesPrototypeIsNull: true,
      assurancesPrototypeIsNull: true,
      identityPrototypeIsNull: true,
      subject: 'subject-1',
      identityKeys: ['issuer', 'kind', 'providerKey', 'subject'],
      assuranceKeys: ['issuedAt', 'kind', 'provenance'],
    },
  });
});

// @ref LLP 0214#62-projection-rules — handler source may mutate reachable
// intrinsics before settlement, but it cannot intercept claims-array
// construction or amplify the server projection.
test('hostile Array.prototype.push cannot forge or amplify auth claims', async () => {
  const context = vm.createContext({});
  vm.runInContext('globalThis.__hostCall = function() { return "null"; };', context);
  vm.runInContext(bootstrap, context, { filename: 'ctx-bootstrap.js' });
  vm.runInContext(`
    Array.prototype.push = function(value) {
      if (value && value.kind === 'email') {
        this[this.length] = {
          kind: 'email',
          providerKey: 'attacker',
          subject: 'admin@example.com',
          value: 'admin@example.com'
        };
      }
      this[this.length] = value;
      return this.length;
    };
    globalThis.__snapbackHandlers = {
      probe: async function(ctx) {
        var identities = ctx.auth.claims.identities;
        return {
          length: identities.length,
          firstValue: identities[0] && identities[0].value,
          secondValue: identities[1] && identities[1].value,
          arrayPrototypeIsNull: Object.getPrototypeOf(identities) === null,
          frozen: Object.isFrozen(identities)
        };
      }
    };
  `, context);
  const decoded = parseHandlerEnvelope(await context.__snapbackSettle(
    'probe',
    '{}',
    JSON.stringify({
      userId: 'usr_verified', sessionId: 'ses_verified', isAuthenticated: true,
      claims: {
        identities: [{ kind: 'email', providerKey: 'email-code', subject: 'person@example.com', value: 'person@example.com' }],
        assurances: [],
      },
    }),
    'query', null, null, '3', () => 'null',
  ));
  assert.deepEqual(decoded, {
    ok: true,
    value: {
      length: 1,
      firstValue: 'person@example.com',
      arrayPrototypeIsNull: true,
      frozen: true,
    },
  });
});

// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
test('media provenance marker is hidden and exact object identity reaches handoff', async () => {
  const context = vm.createContext({});
  const calls = [];
  vm.runInContext(bootstrap, context, { filename: 'ctx-bootstrap.js' });
  vm.runInContext(`
    globalThis.__snapbackHandlers = {
      probe: async function(ctx) {
        var row = await ctx.db.get('profiles', 'profile-1');
        return {
          image: row.image,
          markerVisible: Object.prototype.hasOwnProperty.call(
            row.image,
            '__snapbackMediaProvenanceV1'
          )
        };
      }
    };
  `, context);
  const decoded = parseHandlerEnvelope(await context.__snapbackSettle(
    'probe',
    '{}',
    '{}',
    'mutation',
    null,
    null,
    '41',
    (operation, argsJson) => {
      const op = operation.split('|').at(-1);
      const args = JSON.parse(argsJson);
      calls.push({ op, args });
      if (op === 'db.get') {
        return {
          _id: 'profile-1',
          image: {
            assetId: 'asset-1',
            kind: 'image',
            __snapbackMediaProvenanceV1: 'smp1.invocation-local-secret',
          },
        };
      }
      return null;
    },
  ));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.markerVisible, false);
  assert.deepEqual(decoded.value.image, { assetId: 'asset-1', kind: 'image' });
  assert.deepEqual(calls.at(-1), {
    op: 'media.handoff',
    args: {
      occurrences: [{
        path: ['image'],
        token: 'smp1.invocation-local-secret',
      }],
    },
  });
});

// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
test('structural media copies lose provenance custody', async () => {
  const context = vm.createContext({});
  const calls = [];
  vm.runInContext(bootstrap, context, { filename: 'ctx-bootstrap.js' });
  vm.runInContext(`
    globalThis.__snapbackHandlers = {
      probe: async function(ctx) {
        var row = await ctx.db.get('profiles', 'profile-1');
        return { image: { assetId: row.image.assetId, kind: row.image.kind } };
      }
    };
  `, context);
  await context.__snapbackSettle(
    'probe',
    '{}',
    '{}',
    'mutation',
    null,
    null,
    '42',
    (operation, argsJson) => {
      const op = operation.split('|').at(-1);
      const args = JSON.parse(argsJson);
      calls.push({ op, args });
      if (op === 'db.get') {
        return {
          _id: 'profile-1',
          image: {
            assetId: 'asset-1',
            kind: 'image',
            __snapbackMediaProvenanceV1: 'smp1.invocation-local-secret',
          },
        };
      }
      return null;
    },
  );
  assert.deepEqual(calls.at(-1), {
    op: 'media.handoff',
    args: { occurrences: [] },
  });
});

test('bounded batch reads bypass empty host calls and use one transition per nonempty batch', async () => {
  const context = vm.createContext({});
  vm.runInContext('globalThis.__hostCall = function() { throw new Error("ambient transport must not run"); };', context);
  vm.runInContext(bootstrap, context, { filename: 'ctx-bootstrap.js' });
  vm.runInContext(`
    globalThis.__snapbackHandlers = {
      probe: async function(ctx) {
        return {
          emptyIds: await ctx.db.getMany('items', []),
          emptyKeys: await ctx.db.uniqueMany('items', 'bySlug', []),
          ids: await ctx.db.getMany('items', ['b', 'a', 'b']),
          keys: await ctx.db.uniqueMany('items', 'bySlug', [{ slug: 'two' }]),
        };
      }
    };
  `, context);
  const calls = [];
  const decoded = parseHandlerEnvelope(await context.__snapbackSettle(
    'probe',
    '{}',
    '{}',
    'query',
    null,
    null,
    '17',
    (rawOp, argsJson) => {
      calls.push({ rawOp, args: JSON.parse(argsJson) });
      if (rawOp.endsWith('|db.getMany')) {
        return [{ _id: 'b' }, { _id: 'a' }, { _id: 'b' }];
      }
      return Promise.resolve([{ _id: 'two' }]);
    },
  ));
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.value.emptyIds, []);
  assert.deepEqual(decoded.value.emptyKeys, []);
  assert.deepEqual(decoded.value.ids.map((row) => row._id), ['b', 'a', 'b']);
  assert.deepEqual(decoded.value.keys.map((row) => row._id), ['two']);
  const batchCalls = calls.filter(({ rawOp }) => rawOp.includes('|db.'));
  assert.equal(batchCalls.length, 2, JSON.stringify(calls));
  assert.equal(batchCalls[0].rawOp, '17|db.getMany');
  assert.deepEqual(batchCalls[0].args.ids, ['b', 'a', 'b']);
  assert.equal(batchCalls[1].rawOp, '17|db.uniqueMany');
  assert.deepEqual(batchCalls[1].args.keys, [{ slug: 'two' }]);
  assert.deepEqual(calls.slice(2), [{
    rawOp: '17|media.handoff',
    args: { occurrences: [] },
  }]);
});

test('elevated handler reads use an explicit host-op family and stay unavailable to actions', async () => {
  const context = vm.createContext({});
  vm.runInContext('globalThis.__hostCall = function() { throw new Error("ambient transport must not run"); };', context);
  vm.runInContext(bootstrap, context, { filename: 'ctx-bootstrap.js' });
  vm.runInContext(`
    globalThis.__snapbackHandlers = {
      probe: async function(ctx) {
        return {
          point: await ctx.db.elevated.get('items', 'hidden'),
          rows: await ctx.db.elevated.query('items').take(2).collect(),
          batch: await ctx.db.elevated.getMany('items', ['hidden']),
          unique: await ctx.db.elevated.uniqueMany('items', 'bySlug', [{ slug: 'hidden' }]),
        };
      }
    };
  `, context);
  const calls = [];
  const decoded = parseHandlerEnvelope(await context.__snapbackSettle(
    'probe', '{}', '{}', 'query', null, null, '20', (rawOp, argsJson) => {
      calls.push({ rawOp, args: JSON.parse(argsJson) });
      if (rawOp.endsWith('|db.elevated.query')) return { rows: [{ _id: 'hidden' }] };
      if (rawOp.endsWith('|db.elevated.getMany')) return [{ _id: 'hidden' }];
      if (rawOp.endsWith('|db.elevated.uniqueMany')) return [{ _id: 'hidden' }];
      if (rawOp.endsWith('|db.elevated.get')) return { _id: 'hidden' };
      return null;
    },
  ));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.value.point._id, 'hidden');
  assert.equal(decoded.value.rows[0]._id, 'hidden');
  assert.equal(decoded.value.batch[0]._id, 'hidden');
  assert.equal(decoded.value.unique[0]._id, 'hidden');
  assert.deepEqual(
    calls.slice(0, 4).map(({ rawOp }) => rawOp),
    [
      '20|db.elevated.get',
      '20|db.elevated.query',
      '20|db.elevated.getMany',
      '20|db.elevated.uniqueMany',
    ],
  );

  const action = parseHandlerEnvelope(await context.__snapbackSettle(
    'probe', '{}', '{}', 'action', null, null, '21', () => null,
  ));
  assert.equal(action.ok, false);
  assert.equal(action.code, 'SNAPBACK_HANDLER_WRITE_IN_QUERY');
});

test('bounded batch reads reject non-arrays before a host transition', async () => {
  const context = vm.createContext({});
  vm.runInContext('globalThis.__hostCall = function() { throw new Error("ambient transport must not run"); };', context);
  vm.runInContext(bootstrap, context, { filename: 'ctx-bootstrap.js' });
  vm.runInContext(`
    globalThis.__snapbackHandlers = {
      probe: async function(ctx) { return await ctx.db.getMany('items', 'not-an-array'); }
    };
  `, context);
  let calls = 0;
  const decoded = parseHandlerEnvelope(await context.__snapbackSettle(
    'probe', '{}', '{}', 'query', null, null, '18', () => { calls += 1; return []; },
  ));
  assert.equal(decoded.ok, false);
  assert.equal(decoded.code, 'SNAPBACK_BATCH_READ_INPUT_INVALID');
  assert.equal(calls, 0);
});

test('bounded batch reads are denied in actions before a host transition', async () => {
  const context = vm.createContext({});
  vm.runInContext('globalThis.__hostCall = function() { throw new Error("ambient transport must not run"); };', context);
  vm.runInContext(bootstrap, context, { filename: 'ctx-bootstrap.js' });
  vm.runInContext(`
    globalThis.__snapbackHandlers = {
      probe: async function(ctx) { return await ctx.db.uniqueMany('items', 'bySlug', [{ slug: 'x' }]); }
    };
  `, context);
  const calls = [];
  const decoded = parseHandlerEnvelope(await context.__snapbackSettle(
    'probe', '{}', '{}', 'action', null, null, '19', (rawOp) => { calls.push(rawOp); return []; },
  ));
  assert.equal(decoded.ok, false);
  assert.equal(decoded.code, 'SNAPBACK_HANDLER_WRITE_IN_QUERY');
  assert.equal(calls.some((rawOp) => rawOp.endsWith('|db.uniqueMany')), false);
});

test('mutation settlement availability refusals survive the JS-host decoder', () => {
  assert.equal(
    handlerEnvelopeCode('SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE'),
    'SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE',
  );
});

test('settle extraction isolates hostile name/constructor/stack/message getters', async () => {
  for (const getter of ['name', 'constructor', 'stack', 'message']) {
    const decoded = parseHandlerEnvelope(await settleHostile(getter));
    assert.equal(decoded.code, 'SNAPBACK_HANDLER_FAILED', getter);
    assert.equal(decoded.failureCarrier.errorClass, 'Error', getter);
    if (getter === 'message') {
      assert.equal(decoded.failureCarrier.message, 'handler failure could not be safely inspected');
      assert.match(decoded.failureCarrier.stack, /at probe/u);
    } else {
      assert.equal(decoded.failureCarrier.message, 'safe failure');
    }
    if (getter === 'stack') {
      assert.equal(decoded.failureCarrier.stack, null);
    }
  }
});

test('invalid and reserved class names fold to unclassified on both decoder legs', async () => {
  for (const getter of ['invalid', 'reserved']) {
    const decoded = parseHandlerEnvelope(await settleHostile(getter));
    assert.equal(decoded.failureCarrier.errorClass, 'unclassified', getter);
  }
  for (const errorClass of ['bad-class', 'unclassified', 'x'.repeat(65)]) {
    const decoded = parseHandlerEnvelope(JSON.stringify({
      r: {
        __snapbackOk: false,
        code: null,
        message: 'failure',
        errorClass,
        stack: null,
        messageExtractionTruncated: false,
        stackExtractionTruncated: false,
      },
    }));
    assert.equal(decoded.failureCarrier.errorClass, 'unclassified', errorClass);
  }
});

test('proxy exotica and thrown primitives have deterministic carrier output', async () => {
  const proxied = await settleExpression(`new Proxy(new Error('hidden'), {
    get: function() { throw new Error('proxy getter trap'); }
  })`);
  assert.deepEqual(proxied.failureCarrier, {
    errorClass: 'unclassified',
    message: 'handler failure could not be safely inspected',
    stack: null,
    messageExtractionTruncated: false,
    stackExtractionTruncated: false,
  });

  for (const [expression, errorClass, message] of [
    [`'primitive text'`, 'String', 'primitive text'],
    ['17', 'Number', '17'],
    ['false', 'Boolean', 'false'],
    ['123n', 'BigInt', '123'],
    [`Symbol('token')`, 'Symbol', 'Symbol(token)'],
    ['null', 'unclassified', 'null'],
    ['undefined', 'unclassified', 'undefined'],
  ]) {
    const decoded = await settleExpression(expression);
    assert.deepEqual(decoded.failureCarrier, {
      errorClass,
      message,
      stack: null,
      messageExtractionTruncated: false,
      stackExtractionTruncated: false,
    }, expression);
  }
});

test('admission transformations preserve the private JS carrier', () => {
  const decoded = parseHandlerEnvelope(JSON.stringify({
    r: {
      __snapbackOk: false,
      code: 'SNAPBACK_APP_REFUSAL',
      message: 'stale',
      errorClass: 'RefusalError',
      stack: 'at refuse',
      messageExtractionTruncated: false,
      stackExtractionTruncated: true,
      appCode: 'STALE_MOVE',
      appDetails: null,
    },
  }));
  assert.deepEqual(
    admitDeclaredRefusal(['STALE_MOVE'], decoded).failureCarrier,
    decoded.failureCarrier,
  );
  assert.deepEqual(
    admitDeclaredRefusal([], decoded).failureCarrier,
    decoded.failureCarrier,
  );

  for (const classified of [
    classifyHandlerPlatformFailure({
      ...decoded,
      message: 'Subrequest depth limit exceeded.',
    }),
    classifyHandlerPlatformFailure({ ...decoded, code: 'SNAPBACK_OVERLOADED' }),
    classifyHandlerPlatformFailure(
      { ...decoded, code: 'SNAPBACK_VALUE_TOO_LARGE' },
      { maxRowBytes: 1024 },
    ),
  ]) {
    assert.equal(classified.failureCarrier, decoded.failureCarrier);
  }
});
