import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real —
// every remaining published package carries the same checkout-independent
// documentation funnel in its actual npm tarball.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageNames = [
  'snapback-codegen',
  'snapback-contract',
  'snapback-app-cli',
  'snapback-vite',
  'snapback-expo',
  'snapback-hosted-supervisor',
];
const scratch = mkdtempSync(join(tmpdir(), 'snapback-package-readmes-'));

try {
  for (const packageName of packageNames) {
    const packageDir = join(root, 'packages', packageName);
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    const readme = readFileSync(join(packageDir, 'README.md'), 'utf8');

    assert.match(readme, new RegExp(`^# \`${manifest.name.replace('/', '\\/')}\`$`, 'm'));
    assert.match(readme, /http:\/\/127\.0\.0\.1:4287\/_snapback\/guide/u);
    assert.match(readme, /`snapback guide(?: <query>)?`/u);
    assert.match(readme, /`snapback mcp`/u);
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
