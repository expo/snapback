import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stagePlatformDependencies } from '../snapshot/snapback2/scripts/consumer-smoke.mjs';

const directory = resolve('preserve-optional');
mkdirSync(directory, { recursive: true });
const source = JSON.parse(readFileSync(new URL('../snapshot/snapback2/packages/snapback2/package.json', import.meta.url), 'utf8'));
const manifest = {
  ...source,
  optionalDependencies: { ...source.optionalDependencies, 'snapback2-plugin': '1.2.3', unrelated: '4.5.6' },
};
writeFileSync(resolve(directory, 'before.json'), JSON.stringify(manifest, null, 2));
writeFileSync(resolve(directory, 'package.json'), JSON.stringify(manifest, null, 2));
stagePlatformDependencies(directory, [{ name: 'snapback2-darwin-arm64', version: source.version }]);
const after = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
console.log(JSON.stringify({ before: manifest.optionalDependencies, after: after.optionalDependencies,
  normalDependenciesPreserved: JSON.stringify(after.dependencies) === JSON.stringify(manifest.dependencies),
  peerDependenciesPreserved: JSON.stringify(after.peerDependencies) === JSON.stringify(manifest.peerDependencies),
  peerDependenciesMetaPreserved: JSON.stringify(after.peerDependenciesMeta) === JSON.stringify(manifest.peerDependenciesMeta),
}, null, 2));
assert.equal(after.optionalDependencies['snapback2-plugin'], '1.2.3', 'staging must preserve an unrelated optional dependency that is not an OS/architecture package');
