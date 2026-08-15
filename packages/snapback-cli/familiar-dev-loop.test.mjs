import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateApp, runDev } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
assert.ok(
  existsSync(runtimeBinary),
  `native snapback binary missing at ${runtimeBinary}; run scripts/bootstrap-ibex-runtime or set SNAPBACK_RUNTIME_BINARY`,
);

const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-familiar-dev-loop-')));
const backendRoot = join(projectRoot, 'snapback');
const stateRoot = join(projectRoot, '.snapback');
const readyFile = join(stateRoot, 'dev.ready.json');
const database = join(stateRoot, 'dev.sqlite3');
let dev = null;
try {
  cpSync(join(repoRoot, 'tests', 'fixtures', 'familiar-todo'), backendRoot, { recursive: true });
  rmSync(join(backendRoot, 'generated'), { recursive: true, force: true });

  const generated = await generateApp(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  assert.equal(generated.outDir, join(backendRoot, 'generated'));
  assert.equal(existsSync(join(backendRoot, '_generated')), false);

  dev = await runDev({
    backendDirectory: backendRoot,
    projectRoot,
    readyFile,
    database,
    runtimeBinary,
    watch: false,
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  assert.equal(dev.ok, true, JSON.stringify(dev.diagnostics));
  assert.equal(dev.state, 'generated-and-loaded');
  assert.equal((await fetch(`${dev.serverUrl}/health`)).ok, true);
  assert.equal(
    JSON.parse(readFileSync(join(backendRoot, 'generated', 'app.descriptor.json'), 'utf8'))
      .authoringProfile,
    'snapback-familiar-ts-v1',
  );

  await dev.close();
  dev = null;

  symlinkSync('generated', join(backendRoot, '_generated'), 'dir');
  const refusedAlias = await generateApp(backendRoot);
  assert.equal(refusedAlias.ok, false);
  assert.equal(
    refusedAlias.diagnostics.some(({ code }) => (
      code === 'SNAPBACK_CODEGEN_LEGACY_GENERATED_DIRECTORY'
    )),
    true,
    JSON.stringify(refusedAlias.diagnostics),
  );
} finally {
  await dev?.close?.();
  rmSync(projectRoot, { recursive: true, force: true });
}

console.log('familiar codegen -> canonical generated -> snapback dev: ok');
