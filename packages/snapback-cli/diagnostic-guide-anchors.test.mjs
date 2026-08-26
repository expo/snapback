import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCli } from './index.mjs';
import { lookupGuideReference } from './reference-lookup.mjs';
import { markdownAnchors } from '../../scripts/guide-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const historicalRevision = process.env.SNAPBACK_DIAGNOSTICS_REGISTRY_GIT_REV;
let projectRoot = root;
let temporaryRoot = null;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const staleAuthGuideAnchors = [
  '/_snapback/guide/auth/sessions-and-principals.md#recover-from-stale-authorization-results',
];
const renderedFlatAnchors = markdownAnchors(readFileSync(
  join(root, 'guide/guide-flat.generated.md'),
  'utf8',
));
const currentDiagnostics = JSON.parse(readFileSync(
  join(root, 'guide/reference/diagnostics-registry.json'),
  'utf8',
));

for (const code of [
  'SNAPBACK_AUTH_STALE_RESULT',
  'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE',
]) {
  const guideAnchors = currentDiagnostics.diagnostics[code]?.guideAnchors ?? [];
  assert.ok(guideAnchors.length > 0, `${code} must publish at least one Guide anchor`);
  for (const guideAnchor of guideAnchors) {
    const fragment = guideAnchor.match(/#(.+)$/u)?.[1] ?? null;
    assert.ok(fragment, `${code} Guide anchor must carry a fragment: ${guideAnchor}`);
    assert.ok(
      renderedFlatAnchors.has(decodeURIComponent(fragment)),
      `${code} publishes ${guideAnchor}, but that anchor is absent from the rendered Guide flat`,
    );
  }
}

async function captureCli(args) {
  const output = [];
  const originalLog = console.log;
  try {
    console.log = (...values) => output.push(values.join(' '));
    assert.equal(await runCli(args, { projectRoot }), 0);
  } finally {
    console.log = originalLog;
  }
  return output.join('\n');
}

if (historicalRevision) {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'snapback-diagnostic-anchors-'));
  const guideRoot = join(temporaryRoot, 'guide');
  const referenceRoot = join(guideRoot, 'reference');
  mkdirSync(referenceRoot, { recursive: true });

  const registryBytes = readFileSync(join(root, 'guide/reference/registry.json'));
  const diagnosticsBytes = execFileSync(
    'git',
    ['show', `${historicalRevision}:guide/reference/diagnostics-registry.json`],
    { cwd: root, maxBuffer: 8 * 1024 * 1024 },
  );
  const diagnostics = JSON.parse(diagnosticsBytes);
  const manifest = JSON.parse(readFileSync(
    join(root, 'guide/guide-manifest.generated.json'),
    'utf8',
  ));
  manifest.resources['reference.diagnostics-registry'] = {
    ...manifest.resources['reference.diagnostics-registry'],
    bytes: diagnosticsBytes.byteLength,
    sha256: sha256(diagnosticsBytes),
    sourceDigest: diagnostics.buildIdentity.sourceDigest,
  };

  writeFileSync(join(referenceRoot, 'registry.json'), registryBytes);
  writeFileSync(join(referenceRoot, 'diagnostics-registry.json'), diagnosticsBytes);
  writeFileSync(
    join(guideRoot, 'guide-manifest.generated.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  projectRoot = temporaryRoot;
}

try {
  await test('SNAPBACK_AUTH_STALE_RESULT lookup retains the intended Guide anchor', async () => {
    const staleAuth = lookupGuideReference(
      ['SNAPBACK_AUTH_STALE_RESULT'],
      { projectRoot },
    );
    assert.equal(staleAuth.match, 'diagnostic');
    assert.equal(staleAuth.truncation, null);
    assert.equal(staleAuth.diagnostic.sites, undefined);
    assert.deepEqual(
      staleAuth.diagnostic.guideAnchors,
      staleAuthGuideAnchors,
    );

    const staleAuthJson = JSON.parse(await captureCli([
      'guide',
      'SNAPBACK_AUTH_STALE_RESULT',
      '--json',
    ]));
    assert.deepEqual(staleAuthJson.result.diagnostic.guideAnchors, staleAuthGuideAnchors);

    const staleAuthText = await captureCli(['guide', 'SNAPBACK_AUTH_STALE_RESULT']);
    const staleAuthTextAnchors = staleAuthText.split('\n').flatMap((line) => {
      if (line.startsWith('Guide: ')) return [line.slice('Guide: '.length)];
      if (line.startsWith('- /_snapback/guide/')) return [line.slice(2)];
      return [];
    });
    assert.deepEqual(staleAuthTextAnchors, staleAuthGuideAnchors);
  });

  await test('SNAPBACK_CAPABILITY_UNSUPPORTED retains fragment-bearing Guide anchors', () => {
    const capability = lookupGuideReference(
      ['SNAPBACK_CAPABILITY_UNSUPPORTED'],
      { projectRoot },
    );
    assert.equal(capability.match, 'diagnostic');
    const guideAnchors = capability.diagnostic.guideAnchors ?? [];
    assert.ok(guideAnchors.length > 0);
    for (const guideAnchor of guideAnchors) {
      assert.match(guideAnchor, /^\/_snapback\/guide\/.+#.+/u);
    }
  });
} finally {
  if (temporaryRoot !== null) rmSync(temporaryRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log('diagnostic-guide-anchors.test.mjs: COMPLETE stale-result guideAnchors regression and capability canary pass');
}
