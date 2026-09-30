// Control only: retire sockets opened outside the watch's async context before
// opening the watch. This makes its own connection create genuine undici timers.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (!url.endsWith('/test/expired-server-watch.test.mjs')) return loaded;
  const watch = 'const watch = context.run(timerContext, () => client.observe';
  const mock = "t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {";
  let source = String(loaded.source);
  assert.equal(source.split(watch).length, 2);
  assert.equal(source.split(mock).length, 2);
  source = source.replace(watch, 'await delay(1100);\n      ' + watch);
  source = source.replace(mock, mock + `
        if (context.getStore() === timerContext && ms === 1000) {
          const stack = new Error().stack;
          if (stack.includes('/undici/')) console.log('TRANSPORT TIMER', stack);
        }
  `);
  return { ...loaded, source };
} });
