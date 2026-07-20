import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const manifestPath = resolve(repoRoot, 'demos/partiful-matrix/acceptance/claims.v1.json');
const digestPath = resolve(repoRoot, 'demos/partiful-matrix/acceptance/claims.v1.sha256');
const bytes = readFileSync(manifestPath);
const manifest = JSON.parse(bytes);
const digest = createHash('sha256').update(bytes).digest('hex');
const locked = readFileSync(digestPath, 'utf8').trim();
assert.equal(locked, digest, 'claims.v1.sha256 does not match the authoritative manifest');

const relativeOutput = manifest.authority.distribution.bundlePathTemplate.replace('{sha256}', digest);
assert.notEqual(relativeOutput, manifest.authority.distribution.bundlePathTemplate, 'bundle path template lacks {sha256}');
const output = resolve(repoRoot, relativeOutput);
const distributed = [
  { output, bytes },
  {
    output: resolve(repoRoot, manifest.authority.distribution.schemaBundlePathTemplate.replace('{sha256}', digest)),
    bytes: readFileSync(resolve(repoRoot, manifest.authority.distribution.schemaPath)),
  },
  {
    output: resolve(repoRoot, manifest.authority.distribution.protocolBundlePathTemplate.replace('{sha256}', digest)),
    bytes: readFileSync(resolve(repoRoot, manifest.authority.distribution.protocolPath)),
  },
];
assert.equal(createHash('sha256').update(distributed[1].bytes).digest('hex'), manifest.authority.distribution.schemaSha256);
assert.equal(createHash('sha256').update(distributed[2].bytes).digest('hex'), manifest.authority.distribution.protocolSha256);
for (const entry of distributed) {
  const temporary = `${entry.output}.tmp-${process.pid}`;
  mkdirSync(dirname(entry.output), { recursive: true });
  writeFileSync(temporary, entry.bytes);
  renameSync(temporary, entry.output);
}

console.log(JSON.stringify({
  schemaVersion: 'partitime.claim-manifest-bundle.v1',
  ok: true,
  authority: manifest.authority.path,
  digest,
  output: relativeOutput,
  schemaOutput: manifest.authority.distribution.schemaBundlePathTemplate.replace('{sha256}', digest),
  protocolOutput: manifest.authority.distribution.protocolBundlePathTemplate.replace('{sha256}', digest),
}));
