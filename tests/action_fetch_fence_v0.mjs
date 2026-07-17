import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const bootstrap = await readFile(
  resolve('packages/snapback-harness/ctx-bootstrap.js'),
  'utf8',
);

async function runFetch({ nativeThrows = false, terminalAtBegin = false } = {}) {
  const events = [];
  const sandbox = {
    Request,
    __hostCall(taggedOp) {
      const op = String(taggedOp).split('|', 2)[1];
      if (op === 'action.externalEffectBegin') {
        events.push('begin');
        if (terminalAtBegin) {
          throw new Error('SNAPBACK_AUTH_SCOPED_TOKEN_INVALID: terminal premark');
        }
      } else if (op === 'action.externalEffectInitiated') {
        events.push('initiated');
      }
      return null;
    },
  };
  Object.defineProperty(sandbox, 'fetch', {
    configurable: true,
    enumerable: true,
    writable: true,
    value(request) {
      assert.ok(request instanceof Request, 'native enqueue receives a normalized Request');
      events.push('native');
      if (nativeThrows) {
        throw new Error('native enqueue refused synchronously');
      }
      return Promise.resolve({ ok: true });
    },
  });
  const context = vm.createContext(sandbox);
  vm.runInContext(bootstrap, context, { filename: 'ctx-bootstrap.js' });
  vm.runInContext(
    `globalThis.__snapbackHandlers = {
      async run() {
        try {
          await fetch('https://snapback.invalid/fence-probe');
          return 'resolved';
        } catch (error) {
          return String(error && error.message || error);
        }
      }
    };`,
    context,
  );
  const result = await context.__snapbackInvoke(
    'run',
    '{}',
    '{}',
    'action',
    '{}',
    'null',
    '1',
  );
  return { events, result };
}

test('action fetch closes begin-to-native-enqueue exactly once on resolve', async () => {
  const observed = await runFetch();
  assert.equal(observed.result, 'resolved');
  assert.deepEqual(observed.events, ['begin', 'native', 'initiated']);
});

test('action fetch closes begin-to-native-enqueue exactly once on synchronous throw', async () => {
  const observed = await runFetch({ nativeThrows: true });
  assert.match(observed.result, /native enqueue refused synchronously/);
  assert.deepEqual(observed.events, ['begin', 'native', 'initiated']);
});

test('terminal premark at begin prevents native fetch initiation', async () => {
  const observed = await runFetch({ terminalAtBegin: true });
  assert.match(observed.result, /SNAPBACK_AUTH_SCOPED_TOKEN_INVALID/);
  assert.deepEqual(observed.events, ['begin']);
});
