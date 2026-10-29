import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scripts = fileURLToPath(new URL('../../../scripts/', import.meta.url));
const bytes = dir => !existsSync(dir) ? 0 : readdirSync(dir).reduce((n, name) => {
  const path = join(dir, name), stat = statSync(path);
  return n + (stat.isDirectory() ? bytes(path) : stat.size);
}, 0);

test('packed consumer commands leave ~/.npm bounded and reclaim their private cache on success and failure', { timeout: 60000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'sb4-npm-guard-'));
  try {
    for (const status of [0, 7]) {
      const cwd = join(root, String(status)), home = join(cwd, 'home');
      mkdirSync(join(home, '.npm'), { recursive: true });
      writeFileSync(join(home, '.npm/keep'), 'preexisting cache');
      mkdirSync(join(cwd, 'source'));
      writeFileSync(join(cwd, 'source/package.json'), JSON.stringify({ name: 'sb4-cache-guard', version: '1.0.0' }));
      writeFileSync(join(cwd, 'package.json'), '{"private":true}');
      const before = bytes(join(home, '.npm'));
      const env = { ...process.env, HOME: home, USERPROFILE: home,
        NPM_CONFIG_CACHE: join(home, '.npm'), npm_config_cache: join(home, '.npm') };
      delete env.SNAPBACK4_PRIVATE_NPM_CACHE;
      // Use the real publication command owner, real npm, and two distinct
      // tarballs. No network, fake npm or deterministic-pack assumption.
      const source = `
        import { runToolchainCommand } from ${JSON.stringify(pathToFileURL(join(scripts, 'publication-starters.mjs')).href)};
        import { writeFileSync } from 'node:fs';
        writeFileSync('cache-path', process.env.NPM_CONFIG_CACHE);
        const run = args => runToolchainCommand('npm', args, { cwd: process.cwd(), env: process.env, timeout: 15000 });
        for (let i = 0; i < 2; i++) {
          writeFileSync('source/payload', 'unique pack ' + i);
          await run(['pack', './source', '--ignore-scripts', '--json']);
          await run(['install', './sb4-cache-guard-1.0.0.tgz', '--ignore-scripts', '--no-audit', '--no-fund']);
        }
        process.exitCode = ${status};
      `;
      let exit = 0;
      try { execFileSync(process.execPath, ['--input-type=module', '-e', source], { cwd, env, timeout: 45000, stdio: 'pipe' }); }
      catch (error) { exit = error.status; }
      assert.equal(exit, status);
      assert.equal(bytes(join(home, '.npm')), before, 'default ~/.npm grew during packed consumer proof');
      assert.equal(readFileSync(join(home, '.npm/keep'), 'utf8'), 'preexisting cache');
      const cache = readFileSync(join(cwd, 'cache-path'), 'utf8');
      assert.notEqual(cache, join(home, '.npm'));
      assert.equal(existsSync(cache), false, 'private cache survived command completion');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
