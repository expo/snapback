// Controls from Astra round 0 and Grok round 1: enter the real wait,
// ignore its result, then publish a previously valid (possibly unchanged) answer.
// Only import-time bytes change. Disabled mode leaves every module untouched.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const stage = process.env.BT_LATE_STAGE ?? 'post';
const query = process.env.BT_LATE_QUERY ?? 'ownedEvent';
const ticks = Number(process.env.BT_LATE_TICKS ?? 2);
const mode = process.env.BT_LATE_MODE ?? 'microtasks';
assert.ok(['microtasks', 'timeout', 'two-immediates'].includes(mode));
const delay = mode === 'timeout' ? 'await new Promise(resolve => setTimeout(resolve, 0));'
  : mode === 'two-immediates' ? 'await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));'
  : `for (let btI = 0; btI < ${ticks}; btI++) await Promise.resolve();`;
assert.ok(['post', 'apply', 'disabled'].includes(stage));
assert.ok(Number.isSafeInteger(ticks) && ticks >= 0);
const once = (source, needle, replacement) => {
  assert.equal(source.split(needle).length, 2, `mutation must hit exactly once: ${needle}`);
  return source.replace(needle, replacement);
};
registerHooks({ load(url, context, next) {
  const out = next(url, context);
  if (stage === 'disabled') return out;
  let source = String(out.source);
  if (url.endsWith('/dist/query-settlement.js')) {
    source = once(source, '    const query = (op, args) => {',
      '    const btPrevious = new Map();\n    const query = (op, args) => {');
    source = once(source, '                    while (queryWaiting(read)) {', `                    while (queryWaiting(read)) {
                      if (op.name === ${JSON.stringify(query)} && btPrevious.has(op.name) && ${stage === 'apply' ? 'globalThis.btApplyHeld' : 'true'}) {
                        void read.wait(signal).catch(() => {});
                        ${delay}
                        console.log('BT_EARLY_PUBLICATION', JSON.stringify({name: op.name, stage: ${JSON.stringify(stage)}, mode: ${JSON.stringify(mode)}, ticks: ${ticks}}));
                        return btPrevious.get(op.name);
                      }`);
    source = once(source, '                    if (read && !("loading" in read))\n                        return read;',
      `                    if (read && !("loading" in read)) {
                        if ('data' in read) btPrevious.set(op.name, read);
                        return read;
                      }`);
  } else if (url.endsWith('/test/helpers/custody-read.mjs')) {
    source = once(source, 'export function custodyReads(t) {',
      'export function custodyReads(t) {\n  globalThis.btApplyHeld = false;');
    source = once(source, '  release();', `  console.log('BT_RELEASE_HOLD');
  if (release.toString().includes('holdSync = true')) globalThis.btApplyHeld = true;
  release();`);
    source = once(source, 'read => { settled = true; return read; }',
      `read => { settled = true; if (op.name === ${JSON.stringify(query)}) console.log('BT_PROMISE_SETTLED', op.name); return read; }`);
  }
  return { ...out, source };
} });
