import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { classifyHandlerPlatformFailure } from '../../cloudflare/src/platform-errors.js';
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
  assert.equal(calls.length, 2);
  assert.equal(calls[0].rawOp, '17|db.getMany');
  assert.deepEqual(calls[0].args.ids, ['b', 'a', 'b']);
  assert.equal(calls[1].rawOp, '17|db.uniqueMany');
  assert.deepEqual(calls[1].args.keys, [{ slug: 'two' }]);
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
