import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, withCleanup } from './helpers/cleanup.mjs';
import { hangBudget } from './helpers/wait.mjs';

test('cleanup preserves body results and single failure identity', async () => {
  let cleaned = 0;
  const after = () => { cleaned++; };
  assert.equal(await withCleanup(() => 42, after), 42);
  const body = new Error('body only'), teardown = new Error('cleanup only');
  await assert.rejects(withCleanup(() => { throw body; }, after), error => error === body);
  await assert.rejects(withCleanup(() => 42, () => { throw teardown; }), error => error === teardown);
  await assert.rejects(withCleanup(() => { throw undefined; }, after), error => error === undefined);
  assert.equal(cleaned, 3);
});

test('body and cleanup failure retain both errors and the cleanup cause', async () => {
  const body = new Error('original assertion'), teardown = new Error('exit join refused');
  await assert.rejects(withCleanup(() => { throw body; }, () =>
    cleanup(() => { throw teardown; }, 'failed exit', () => 'owned fixture state')), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors[0], body);
    assert.equal(error.cause, body);
    assert.equal(error.errors[1].cause, teardown);
    assert.match(error.message, /original assertion/);
    assert.match(error.message, /exit join refused/);
    assert.match(error.message, /owned fixture state/);
    return true;
  });
});

test('native test output shows body failures alongside finally and after-hook cleanup hangs', t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-cleanup-reporting-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'failures.mjs');
  const helper = new URL('./helpers/cleanup.mjs', import.meta.url).href;
  writeFileSync(file, `import test from 'node:test';
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
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // This is a separate native runner, not its test child.
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], {
    encoding: 'utf8', timeout: hangBudget(), env,
  });
  const output = result.stdout + result.stderr;
  assert.equal(result.error, undefined, output);
  assert.equal(result.status, 1, output);
  assert.match(output, /test timed out after 5ms/);
  for (const kind of ['FINALLY', 'AFTER', 'TIMED']) {
    assert.ok(output.includes(`BODY_${kind}_SENTINEL`), output);
    assert.ok(output.includes(`TEST_CLEANUP: ${kind}_SENTINEL: TEST_HANG:`), output);
    assert.ok(output.includes(`${kind}_DIAGNOSTIC`), output);
  }
});
