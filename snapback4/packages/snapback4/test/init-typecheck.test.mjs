// @ref LLP 3000.001.000#hs-cross-repository-correction-2026-10-13 — every starter includes its configuration in the typecheck.
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { installCustomWriteScenario } from '../../../scripts/publication-starters.mjs';
const root = resolve(import.meta.dirname, '..');
const binary = process.env.SNAPBACK4_BIN ?? resolve(root, '../../target/debug/snapback4');
for (const flags of [[], ['--online'], ['--web'], ['--expo'], ['--web', '--template', 'chat'], ['--expo', '--template', 'chat'], ['--template', 'social']]) {
  test(`init ${flags.join(' ')} typechecks`, t => {
    const dir = mkdtempSync(join(root, '.init-types-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    for (const args of [['init', ...flags], ['check']]) {
      const result = spawnSync(binary, args, { cwd: dir, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    const configFile = join(dir, 'tsconfig.json');
    const parsed = existsSync(configFile)
      ? ts.parseJsonConfigFileContent(ts.readConfigFile(configFile, ts.sys.readFile).config, ts.sys, dir)
      : { errors: [], fileNames: ts.sys.readDirectory(dir, ['.ts'], undefined, ['**/*.ts']), options: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
        types: [], strict: true, noEmit: true, allowImportingTsExtensions: true } };
    if (flags.includes('--web')) {
      assert.ok(parsed.fileNames.includes(join(dir, 'vite.config.mts')), 'Vite config participates');
      const packageJson = JSON.parse(readFileSync(join(dir, 'package.json')));
      assert.ok(packageJson.devDependencies['@types/node'], 'starter installs Node types');
    }
    const host = ts.createCompilerHost(parsed.options); host.getCurrentDirectory = () => dir;
    const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options, host))];
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: file => file, getCurrentDirectory: () => dir, getNewLine: () => '\n',
    }));
  });
}

// The packed custom proof fixture must put its writer on Home, not Account.
for (const kind of ['web', 'expo']) {
  test(`custom ${kind} qualification component typechecks and refuses reapplication`, t => {
    const dir = mkdtempSync(join(root, '.init-types-custom-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'snapback'));
    writeFileSync(join(dir, 'snapback/schema.q'), `use identity guests
table notes:
  owner: principal
  title: text <=80
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
query mine():
  return notes where .owner = viewer first 20 by .id
mutation add(title: text <=80):
  return insert notes { owner: viewer, title }
`);
    for (const args of [['init', `--${kind}`], ['check']]) {
      const r = spawnSync(binary, args, { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
    }
    installCustomWriteScenario(dir, kind);
    const file = join(dir, kind === 'web' ? 'src/App.tsx' : 'App.tsx');
    const source = readFileSync(file, 'utf8');
    assert.match(source, /<FirstRead \/><ProofWrite \/>/);
    const config = join(dir, 'tsconfig.json');
    const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(config, ts.sys.readFile).config, ts.sys, dir);
    const host = ts.createCompilerHost(parsed.options); host.getCurrentDirectory = () => dir;
    const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options, host))];
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: file => file, getCurrentDirectory: () => dir, getNewLine: () => '\n',
    }));
    const proofFile = join(dir, 'scripts/frontend-proof.mjs');
    const proof = readFileSync(proofFile, 'utf8');
    assert.match(proof, /within: page.locator\("#proof-rows"\)/);
    assert.throws(() => installCustomWriteScenario(dir, kind), /fresh Home/);
    assert.equal(readFileSync(file, 'utf8'), source);
    assert.equal(readFileSync(proofFile, 'utf8'), proof);
  });
}
