import test from 'node:test';
import assert from 'node:assert/strict';
import { after } from './helpers/teardown.mjs';

test('one teardown hook reaps writers before removal and continues after failure', async () => {
  const hooks = [], events = [];
  const context = { after: hook => hooks.push(hook) };
  after(context, () => { events.push('remove'); throw Error('injected ENOTEMPTY'); });
  after(context, async () => { events.push('kill'); await Promise.resolve(); events.push('reap'); });
  after(context, () => { events.push('client'); throw Error('injected close failure'); });
  assert.equal(hooks.length, 1);
  await assert.rejects(hooks[0](), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors.map(e => e.message), ['injected close failure', 'injected ENOTEMPTY']);
    return true;
  });
  assert.deepEqual(events, ['client', 'kill', 'reap', 'remove']);
});
