// Diagnostic scheduling-only loader: identify timers admitted by the fixture's
// existing AsyncLocalStorage filter, without changing callbacks or delays.
import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';
registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (!url.endsWith('/test/expired-server-watch.test.mjs')) return loaded;
  const text = String(loaded.source), marker = 'timers.push({ ms, fire()';
  assert.equal(text.split(marker).length, 2);
  return { ...loaded, source: text.replace(marker, 'if (ms === 1000) console.log("TIMER OWNER", new Error().stack); timers.push({ ms, fire()') };
} });
