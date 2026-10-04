import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, withCleanup } from './helpers/cleanup.mjs';
import { hangBudget } from './helpers/wait.mjs';

const helper = new URL('./helpers/cleanup.mjs', import.meta.url).href;

function nativeOutput(t, source) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-cleanup-reporting-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'failures.mjs');
  writeFileSync(file, source);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // This is a separate native runner, not its test child.
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], {
    encoding: 'utf8', timeout: hangBudget(), env,
  });
  const output = result.stdout + result.stderr;
  assert.equal(result.error, undefined, output);
  assert.equal(result.status, 1, output);
  return output;
}

test('cleanup preserves body results and single failure identity', async t => {
  t.mock.method(console, 'error', () => {});
  let cleaned = 0;
  const after = () => { cleaned++; };
  assert.equal(await withCleanup(() => 42, after), 42);
  const body = new Error('body only'), teardown = new Error('cleanup only');
  await assert.rejects(withCleanup(() => { throw body; }, after), error => error === body);
  await assert.rejects(withCleanup(() => 42, () => { throw teardown; }), error => error === teardown);
  await assert.rejects(withCleanup(() => { throw undefined; }, after), error => error === undefined);
  assert.equal(cleaned, 3);
});

test('nested cleanup failures preserve the primary assertion and append cleanup errors', async t => {
  const reported = [];
  t.mock.method(console, 'error', (...args) => reported.push(args));
  const actual = { actual: 1 }, expected = { expected: 2 };
  const body = new assert.AssertionError({ actual, expected, operator: 'deepStrictEqual', message: 'original assertion' });
  const cause = body.cause = new Error('original cause');
  const stack = body.stack, message = body.message;
  const teardown = new Error('exit join refused'), outer = new Error('outer cleanup failure');
  await assert.rejects(withCleanup(() => withCleanup(() => { throw body; }, () => {
    assert.ok(reported.some(args => args.includes(body)), 'report the body before cleanup starts');
    return cleanup(() => { throw teardown; }, 'failed exit', () => 'owned fixture state');
  }), () => { throw outer; }), error => {
    assert.equal(error, body);
    assert.ok(error instanceof assert.AssertionError);
    assert.equal(error.code, 'ERR_ASSERTION');
    assert.equal(error.actual, actual);
    assert.equal(error.expected, expected);
    assert.equal(error.operator, 'deepStrictEqual');
    assert.equal(error.stack, stack);
    assert.equal(error.message, message);
    assert.equal(error.cause, cause);
    assert.equal(error.cleanupErrors.length, 2);
    assert.equal(error.cleanupErrors[0].cause, teardown);
    assert.match(error.cleanupErrors[0].message, /owned fixture state/);
    assert.equal(error.cleanupErrors[1], outer);
    return true;
  });
});

test('cleanup cannot replace an immutable or primitive body failure', async t => {
  const reported = [];
  t.mock.method(console, 'error', (...args) => reported.push(args));
  const teardown = new Error('cleanup after immutable failure');
  for (const body of [Object.freeze(new Error('frozen body')), undefined, null, 'primitive body']) {
    await assert.rejects(withCleanup(async () => { throw body; }, async () => { throw teardown; }), error => error === body);
    assert.ok(reported.some(args => args.includes(body)));
    assert.ok(reported.some(args => args.includes(teardown)));
    reported.length = 0;
  }
});

test('native test output shows body failures alongside finally and after-hook cleanup hangs', t => {
  const output = nativeOutput(t, `import test from 'node:test';
// Accelerate only this child fixture's hang guard before it captures timers.
const schedule = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => schedule(fn, ms === 122000 ? 20 : ms, ...args);
const { cleanup, withCleanup } = await import(${JSON.stringify(helper)});
test('finally failure', () => withCleanup(
  () => { throw new Error('BODY_FINALLY_SENTINEL'); },
  () => cleanup(() => new Promise(() => {}), 'FINALLY_SENTINEL', () => 'FINALLY_DIAGNOSTIC')));
test('after-hook failure', t => {
  t.after(() => cleanup(() => new Promise(() => {}), 'AFTER_SENTINEL', () => 'AFTER_DIAGNOSTIC'));
  throw new Error('BODY_AFTER_SENTINEL');
});
test('body timeout during cleanup', { timeout: 5 }, () => withCleanup(
  () => { throw new Error('BODY_TIMED_SENTINEL'); },
  () => cleanup(() => new Promise(() => {}), 'TIMED_SENTINEL', () => 'TIMED_DIAGNOSTIC')));
`);
  assert.match(output, /test timed out after 5ms/);
  for (const kind of ['FINALLY', 'AFTER', 'TIMED']) {
    assert.ok(output.includes(`BODY_${kind}_SENTINEL`), output);
    assert.ok(output.includes(`TEST_CLEANUP: ${kind}_SENTINEL: TEST_HANG:`), output);
    assert.ok(output.includes(`${kind}_DIAGNOSTIC`), output);
  }
});

test('native timeout during successful cleanup still reports the earlier body failure', t => {
  const output = nativeOutput(t, `import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
const { cleanup, withCleanup } = await import(${JSON.stringify(helper)});
test('body assertion then successful cleanup beyond native timeout', { timeout: 25 }, () => withCleanup(
  () => assert.equal(1, 2, 'BODY_SUCCESSFUL_CLEANUP_SENTINEL'),
  () => cleanup(async () => {
    await delay(150);
    console.log('CLEANUP_COMPLETED_SUCCESSFULLY');
  }, 'successful teardown')));
`);
  assert.match(output, /test timed out after 25ms/);
  const body = output.indexOf('BODY_SUCCESSFUL_CLEANUP_SENTINEL');
  const completed = output.indexOf('CLEANUP_COMPLETED_SUCCESSFULLY');
  assert.ok(body >= 0 && completed > body, output);
  assert.doesNotMatch(output, /TEST_CLEANUP|TEST_HANG/);
});

test('native output retains assertion class, code and comparison fields through nested cleanup', t => {
  const output = nativeOutput(t, `import test from 'node:test';
import assert from 'node:assert/strict';
const { withCleanup } = await import(${JSON.stringify(helper)});
const body = () => assert.equal(17, 18, 'BODY_ASSERTION_SENTINEL');
test('single cleanup failure', () => withCleanup(body, () => { throw new Error('INNER_CLEANUP_SENTINEL'); }));
test('nested cleanup failure', () => withCleanup(
  () => withCleanup(body, () => { throw new Error('INNER_CLEANUP_SENTINEL'); }),
  () => { throw new Error('OUTER_CLEANUP_SENTINEL'); }));
`);
  for (const label of ['single cleanup failure', 'nested cleanup failure']) {
    const block = output.match(new RegExp(`not ok \\d+ - ${label}\\n([\\s\\S]*?)\\n  \\.\\.\\.`))?.[1];
    assert.ok(block, output);
    for (const field of ["code: 'ERR_ASSERTION'", "name: 'AssertionError'", 'actual: 17', 'expected: 18', "operator: 'strictEqual'"]) {
      assert.ok(block.includes(field), block);
    }
  }
  assert.match(output, /INNER_CLEANUP_SENTINEL/);
  assert.match(output, /OUTER_CLEANUP_SENTINEL/);
});
