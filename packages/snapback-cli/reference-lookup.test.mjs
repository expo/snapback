import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCli } from './index.mjs';
import { lookupGuideReference } from './reference-lookup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const member = lookupGuideReference(['SnapbackClient.query'], { projectRoot: root });
assert.equal(member.match, 'member');
assert.equal(member.symbol.module, '@expo/snapback-client');
assert.match(member.member.signature, /readonly args\?: FunctionArgs<Ref>/u);
assert.equal(member.truncation, null);
assert.match(member.identity.guideContentHash, /^[0-9a-f]{64}$/u);
assert.match(member.identity.registrySourceDigest, /^sha256:[0-9a-f]{64}$/u);

const large = lookupGuideReference(['SnapbackClient'], { projectRoot: root });
assert.equal(large.match, 'symbol-slice');
assert.equal(large.truncation.truncated, true);
assert.match(large.truncation.elided.join('\n'), /complete signature/u);
assert.equal(large.truncation.nextCommand, 'snapback guide SnapbackClient --slice 2');
assert.ok(Buffer.byteLength(JSON.stringify(large)) <= 16_384);

const moduleSlice = lookupGuideReference(['@expo/snapback-client'], { projectRoot: root });
assert.equal(moduleSlice.match, 'module-slice');
assert.equal(moduleSlice.truncation.truncated, true);
assert.match(moduleSlice.truncation.elided.join('\n'), /symbols 13-/u);
assert.equal(moduleSlice.truncation.nextCommand, 'snapback guide @expo/snapback-client --slice 2');
assert.ok(Buffer.byteLength(JSON.stringify(moduleSlice)) <= 16_384);

assert.equal(lookupGuideReference(['not-an-exact-symbol'], { projectRoot: root }), null);
const output = [];
const originalLog = console.log;
try {
  console.log = (...values) => output.push(values.join(' '));
  assert.equal(await runCli(['guide', 'SnapbackClient.query', '--json'], { projectRoot: root }), 0);
} finally {
  console.log = originalLog;
}
const cliResult = JSON.parse(output.join('\n'));
assert.equal(cliResult.match, 'member');
assert.equal(cliResult.query, 'SnapbackClient.query');
console.log('reference-lookup.test.mjs: exact member, bounded symbol, bounded module, identity, and fallback pass');
