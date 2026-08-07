import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { coldInstallStagedPackageClosure } from './snapback-package-cold-install-lib.mjs';

test('qualification cold-installs and digests the staged tarball closure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-packaged-store-closure-'));
  try {
    const source = join(root, 'source');
    const stage = join(root, 'stage');
    const app = join(root, 'app');
    const npmCache = join(root, 'npm-cache');
    mkdirSync(source);
    mkdirSync(stage);
    mkdirSync(app);
    writeFileSync(join(source, 'package.json'), `${JSON.stringify({
      name: '@snapback-test/qualification-fixture',
      version: '1.2.3',
      type: 'module',
      files: ['index.mjs'],
    })}\n`);
    writeFileSync(join(source, 'index.mjs'), 'export const staged = true;\n');
    writeFileSync(join(app, 'package.json'), '{"name":"qualification-app","private":true}\n');
    const packed = spawnSync('npm', ['pack', '--pack-destination', stage], {
      cwd: source,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: npmCache },
    });
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);

    const installed = await coldInstallStagedPackageClosure({
      stagedDir: stage,
      appDir: app,
      environment: { ...process.env, npm_config_cache: npmCache },
    });
    assert.equal(installed.packageClosure.length, 1);
    assert.deepEqual(
      installed.packageClosure[0],
      {
        name: '@snapback-test/qualification-fixture',
        version: '1.2.3',
        sha256: installed.packageClosure[0].sha256,
      },
    );
    assert.match(installed.packageClosure[0].sha256, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(
      readFileSync(join(
        app,
        'node_modules',
        '@snapback-test',
        'qualification-fixture',
        'index.mjs',
      ), 'utf8'),
      'export const staged = true;\n',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
