// Test-only negative control: accidentally start a second background round.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/packages/snapback4/dist/local.js')) return result;
  const source = String(result.source), needle = 'ok = await syncOnce();';
  assert.equal(source.split(needle).length, 2);
  return { ...result, source: source.replace(needle, `${needle} if (ok) await syncOnce();`) };
} });
