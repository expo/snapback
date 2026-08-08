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
