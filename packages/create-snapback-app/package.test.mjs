// create-snapback-app acceptance (LLP 0186 W2): the ecosystem entry point is
// a thin wrapper over the @expo/snapback-cli scaffold mechanism — identical
// output to `snapback new`, the CLI's own template registry and error codes,
// no second scaffolder.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listTemplates } from '@expo/snapback-cli';

const packageDir = dirname(fileURLToPath(import.meta.url));
const createBin = join(packageDir, 'cli.mjs');
const snapbackBin = join(packageDir, '..', 'snapback-cli', 'cli.mjs');

const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
assert.equal(manifest.name, 'create-snapback-app', 'unscoped name so `npm create snapback-app` resolves');
assert.deepEqual(manifest.bin, { 'create-snapback-app': './cli.mjs' });
assert.deepEqual(Object.keys(manifest.dependencies), ['@expo/snapback-cli'], 'the wrapper depends only on the CLI');

function run(bin, args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', ...options });
}

function fileList(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(relative(root, path));
    }
  };
  walk(root);
  return files;
}

const root = mkdtempSync(join(tmpdir(), 'create-snapback-app-'));
try {
  const version = run(createBin, ['--version'], { cwd: root });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), `create-snapback-app ${manifest.version}`);

  // Default template is expo-chat, and the wrapper's output is identical to
  // `snapback new --template expo-chat` (same files, same substituted manifest
  // contents modulo the project name).
  const wrapped = run(createBin, ['my-chat'], { cwd: root });
  assert.equal(wrapped.status, 0, wrapped.stderr);
  assert.match(wrapped.stdout, /expo-chat/u, 'success output names the default template');
  assert.match(wrapped.stdout, /cd my-chat/u);
  assert.match(wrapped.stdout, /bun install/u);
  assert.match(wrapped.stdout, /bun run dev/u);
  assert.match(wrapped.stdout, /bun run prove.*ordinary completion/u);
  assert.match(wrapped.stdout, /bun run test:static.*no-server coherence/u);
  assert.match(wrapped.stdout, /npm test.*raw acceptance/u);
  assert.match(wrapped.stdout, /browser\/simulator observation commands/u);
  const viaSnapbackNew = run(snapbackBin, ['new', join(root, 'reference-chat'), '--template', 'expo-chat'], { cwd: root });
  assert.equal(viaSnapbackNew.status, 0, viaSnapbackNew.stderr);
  assert.deepEqual(
    fileList(join(root, 'my-chat')),
    fileList(join(root, 'reference-chat')),
    'the wrapper scaffolds exactly the files `snapback new --template expo-chat` scaffolds',
  );
  const wrappedManifest = JSON.parse(readFileSync(join(root, 'my-chat', 'package.json'), 'utf8'));
  assert.equal(wrappedManifest.name, 'my-chat');
  assert.doesNotMatch(
    readFileSync(join(root, 'my-chat', 'package.json'), 'utf8'),
    /__SNAPBACK_VERSION__/u,
    'dependency versions are substituted, same as snapback new',
  );

  // --template passthrough with --json parity output.
  const reactRun = run(createBin, [join(root, 'my-web'), '--template', 'react', '--json'], { cwd: root });
  assert.equal(reactRun.status, 0, reactRun.stderr);
  const reactResult = JSON.parse(reactRun.stdout);
  assert.equal(reactResult.schemaVersion, 'snapback.scaffold.v1');
  assert.equal(reactResult.template, 'react');
  const reactReference = run(snapbackBin, ['new', join(root, 'reference-web'), '--template', 'react'], { cwd: root });
  assert.equal(reactReference.status, 0, reactReference.stderr);
  assert.deepEqual(fileList(join(root, 'my-web')), fileList(join(root, 'reference-web')));

  // Unknown template fails with the CLI's own diagnostic, and scaffolds nothing.
  const unknown = run(createBin, ['nope-app', '--template', 'not-a-template'], { cwd: root });
  assert.equal(unknown.status, 1);
  const unknownDiagnostics = JSON.parse(unknown.stderr);
  assert.equal(unknownDiagnostics.ok, false);
  assert.equal(unknownDiagnostics.diagnostics[0].code, 'SNAPBACK_NEW_TEMPLATE_UNKNOWN');
  assert.equal(existsSync(join(root, 'nope-app')), false);

  // Missing target fails closed with the CLI's usage code.
  const missingTarget = run(createBin, [], { cwd: root });
  assert.equal(missingTarget.status, 1);
  assert.equal(JSON.parse(missingTarget.stderr).diagnostics[0].code, 'SNAPBACK_NEW_NAME_REQUIRED');

  // --help lists every template from the CLI's registry, not a hardcoded copy.
  const templates = listTemplates();
  assert.ok(
    templates.includes('expo-chat')
      && templates.includes('todo-contract')
      && templates.includes('react')
      && templates.includes('crud-dashboard')
      && templates.includes('media-feed'),
  );
  const help = run(createBin, ['--help'], { cwd: root });
  assert.equal(help.status, 0, help.stderr);
  for (const template of templates) {
    assert.ok(help.stdout.includes(template), `--help must list template ${template}`);
  }
  assert.match(help.stdout, /expo-chat \(default\)/u);
  assert.match(help.stdout, /bun run prove.*ordinary completion/u);
  assert.match(help.stdout, /bun run test:static.*no-server check/u);
  assert.match(help.stdout, /npm test.*raw acceptance debugging/su);
  assert.match(help.stdout, /browser.*simulator observation commands/su);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('package.test.mjs: create-snapback-app delegation, default template, --template/--json passthrough, unknown-template refusal, and registry-derived help pass');
