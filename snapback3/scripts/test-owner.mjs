#!/usr/bin/env node
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'rolldown';

// Exercise Node's HTTP, child-process and test runner implementations. Bun's
// node:test compatibility can leak timed-out test context into the next file.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compiler = join(root, 'packages/snapback3/dist/compiler-core.mjs');
await access(compiler);
const state = join(root, '.snapback3');
await mkdir(state, { recursive: true });
const output = await mkdtemp(join(state, 'owner-tests-'));
const names = ['node-http', 'node-worker', 'node-background', 'node-operator', 'node-project', 'node-cli', 'node-autonomy-real', 'node-owner-recovery-real'];
try {
  await build({
    input: Object.fromEntries(names.map(name => [name, join(root, `packages/snapback3/tests/${name}.test.ts`)])),
    platform: 'node', external: ['typescript'],
    plugins: [{ name: 'built-compiler', resolveId(id, importer) {
      if (importer && id.startsWith('.') && resolve(dirname(importer), id).replace(/\.[cm]?[jt]s$/, '') === join(root, 'packages/compiler/src/project')) {
        return { id: pathToFileURL(compiler).href, external: true };
      }
    } }],
    output: { dir: output, format: 'esm', entryFileNames: '[name].mjs' },
  });
  execFileSync(process.execPath, ['--test', '--test-timeout=30000', '--test-concurrency=1', ...names.map(name => join(output, `${name}.mjs`))], {
    cwd: root, stdio: 'inherit', timeout: 120_000,
  });
} finally { await rm(output, { recursive: true, force: true }); }
