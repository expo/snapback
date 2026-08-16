import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PACKAGE_INVENTORY } from './snapback-publish-core.mjs';

// @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real —
// every remaining published package carries the same checkout-independent
// documentation funnel in its actual npm tarball.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDirectory = join(root, 'packages');
const packageRecords = readdirSync(packagesDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const manifestPath = join(packagesDirectory, entry.name, 'package.json');
    try {
      return {
        directory: entry.name,
        manifest: JSON.parse(readFileSync(manifestPath, 'utf8')),
      };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  })
  .filter((record) => record !== null);
const packageNames = packageRecords
  .filter(({ manifest }) => manifest.private !== true)
  .map(({ directory }) => directory)
  .sort();
const publicManifestNames = new Set(packageRecords
  .filter(({ manifest }) => manifest.private !== true)
  .map(({ manifest }) => manifest.name));
const publishedPackageNames = new Set(PACKAGE_INVENTORY.map(([sourceName]) => sourceName));

for (const [sourceName] of PACKAGE_INVENTORY) {
  assert(
    publicManifestNames.has(sourceName),
    `${sourceName} is in PACKAGE_INVENTORY but does not have a non-private manifest`,
  );
}
const scratch = mkdtempSync(join(tmpdir(), 'snapback-package-readmes-'));

try {
  for (const packageName of packageNames) {
    const packageDir = join(root, 'packages', packageName);
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    const readme = readFileSync(join(packageDir, 'README.md'), 'utf8');

    assert.equal(manifest.license, 'MIT', `${manifest.name} must declare the ratified MIT license`);
    if (publishedPackageNames.has(manifest.name)) {
      assert(
        manifest.files.includes('README.md'),
        `${manifest.name} must include README.md in the explicit files allowlist copied by snapback-publish`,
      );
    }
    assert.match(readme, new RegExp(`^# \`${manifest.name.replace('/', '\\/')}\`$`, 'm'));
    assert.match(readme, /^## Documentation outside a checkout$/mu);
    assert.match(readme, /http:\/\/127\.0\.0\.1:4287\/_snapback\/guide/u);
    // @ref LLP 0259#1-first-read-contract — the published funnel leads with
    // the start-packet tier; the capability index is a lookup pointer only.
    assert.match(
      readme,
      /_snapback\/guide\/start\/index\.md/u,
      `${manifest.name} must point at the start-packet tier first`,
    );
    assert.doesNotMatch(
      readme,
      /(?:Start (?:with|at)|Check) the \[capability index\]/u,
      `${manifest.name} must not lead a cold agent into a linear capability-index read`,
    );
    assert.match(readme, /`snapback guide(?: <query>)?`/u);
    assert.match(readme, /`snapback mcp`/u);
    assert.match(
      readme,
      /use the origin printed by\s+`snapback dev` or `snapback start` if yours differs\./u,
      `${manifest.name} must explain that the served Guide port can differ`,
    );
    assert.doesNotMatch(
      readme,
      /\]\((?:\.\.\/|\.\/)?guide\//u,
      `${manifest.name} has a checkout-relative Guide link`,
    );

    const packed = spawnSync(
      'npm',
      ['pack', '--dry-run', '--json', '--ignore-scripts'],
      {
        cwd: packageDir,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: join(scratch, 'npm-cache') },
      },
    );
    assert.equal(packed.status, 0, packed.stderr);
    const [{ files }] = JSON.parse(packed.stdout);
    assert(
      files.some(({ path }) => path === 'README.md'),
      `${manifest.name} README.md is missing from the npm pack closure`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('package README funnel test passed');
