import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCli } from './index.mjs';
import { formatGuideReferenceLookup, lookupGuideReference } from './reference-lookup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sharedCases = JSON.parse(readFileSync(
  resolve(root, 'tests/fixtures/guide-symbol-lookup-v1.json'),
  'utf8',
)).cases;

// @ref LLP 0194#design — the package and embedded-native lookup seams run the
// same exact/member/slice cases so neither projection invents its own dialect.
for (const fixture of sharedCases) {
  const result = lookupGuideReference(
    [fixture.query, ...(fixture.slice === 1 ? [] : ['--slice', String(fixture.slice)])],
    { projectRoot: root },
  );
  if (fixture.match === null) {
    assert.equal(result, null);
    continue;
  }
  assert.equal(result.schemaVersion, 'snapback.guide-symbol-lookup.v1');
  assert.equal(result.match, fixture.match);
  assert.equal(result.truncation?.truncated ?? false, fixture.truncated);
  if (fixture.nextCommand) assert.equal(result.truncation.nextCommand, fixture.nextCommand);
  if (fixture.signatureContains) assert.match(result.member.signature, new RegExp(fixture.signatureContains.replace(/[?]/gu, '\\?'), 'u'));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 16_384);
}

const member = lookupGuideReference(['SnapbackClient.query'], { projectRoot: root });
assert.equal(member.match, 'member');
assert.equal(member.symbol.module, '@expo/snapback-client');
assert.match(member.member.signature, /readonly args\?: FunctionArgs<Ref>/u);
assert.equal(member.truncation, null);
assert.match(member.identity.guideContentHash, /^[0-9a-f]{64}$/u);
assert.match(member.identity.registrySourceDigest, /^sha256:[0-9a-f]{64}$/u);

const diagnostic = lookupGuideReference(['SNAPBACK_AUTH_SESSION_EXPIRED'], { projectRoot: root });
assert.equal(diagnostic.match, 'diagnostic');
assert.equal(diagnostic.diagnostic.code, 'SNAPBACK_AUTH_SESSION_EXPIRED');
assert.equal(diagnostic.diagnostic.subsystem, 'auth');
assert.equal(diagnostic.diagnostic.httpStatus, 401);
assert.equal(diagnostic.diagnostic.sites, undefined);
assert.match(diagnostic.identity.diagnosticsSourceDigest, /^sha256:[0-9a-f]{64}$/u);
assert.ok(Buffer.byteLength(JSON.stringify(diagnostic)) <= 16_384);
const staleAuthDiagnostic = lookupGuideReference(
  ['SNAPBACK_AUTH_STALE_RESULT'],
  { projectRoot: root },
);
assert.equal(staleAuthDiagnostic.match, 'diagnostic');
assert.equal(staleAuthDiagnostic.diagnostic.sites, undefined);
assert.deepEqual(
  staleAuthDiagnostic.diagnostic.guideAnchors,
  ['/_snapback/guide/auth/sessions-and-principals.md#recover-from-snapbackauthstaleresult'],
);
assert.match(
  formatGuideReferenceLookup(staleAuthDiagnostic),
  /Guide: \/_snapback\/guide\/auth\/sessions-and-principals\.md#recover-from-snapbackauthstaleresult/u,
);
const internalDiagnostic = lookupGuideReference(
  ['SNAPBACK_AUTH_SESSION_EXPIRED'],
  { projectRoot: root, includeDiagnosticSites: true },
);
assert.ok(internalDiagnostic.diagnostic.sites.length > 0);

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
assert.equal(cliResult.schemaVersion, 'snapback.guide-search.v1');
assert.equal(cliResult.mode, 'exact-symbol');
assert.equal(cliResult.query, 'SnapbackClient.query');
assert.equal(cliResult.result.match, 'member');
console.log('reference-lookup.test.mjs: exact diagnostic/member, bounded symbol/module, identity, and fallback pass');
