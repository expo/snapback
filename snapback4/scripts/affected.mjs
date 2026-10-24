#!/usr/bin/env node
// @ref LLP 0189#snapback-4-affected-selection-2026-10-24 — conservative landing selection;
// the scheduled battery and publication qualification retain their own custody.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(import.meta.dirname, '../..');
export const CARGO_ENV = { CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', CARGO_PROFILE_TEST_DEBUG: '0' };
const PREFIX = 'snapback4/';
const TIMEOUT = 10800;
const sorted = values => [...new Set(values)].sort();
const slash = path => path.split('\\').join('/');
const hash = text => createHash('sha256').update(text).digest('hex');
function command(root, executable, args, options = {}) {
  return execFileSync('timeout', ['120s', executable, ...args], {
    cwd: root, env: { ...process.env, ...CARGO_ENV }, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...options,
  });
}
function git(root, ...args) { return command(root, 'git', args); }
function paths(output) { return output.split('\0').filter(Boolean); }
function walk(root, path = '') {
  if (!existsSync(join(root, path))) return [];
  return readdirSync(join(root, path), { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'target', '.git', 'dist'].includes(entry.name)) return [];
    const child = slash(join(path, entry.name));
    return entry.isDirectory() ? walk(root, child) : (entry.isFile() || entry.isSymbolicLink()) ? [child] : [];
  });
}

// Cargo, including optional and dev dependencies, owns the workspace graph.
export function loadModel(root = ROOT) {
  const sb = join(root, 'snapback4');
  const metadata = JSON.parse(command(sb, 'cargo', ['metadata', '--offline', '--no-deps', '--format-version=1']));
  const members = metadata.packages.filter(pkg => metadata.workspace_members.includes(pkg.id));
  const nameByPath = new Map(members.map(pkg => [dirname(pkg.manifest_path), pkg.name]));
  const crates = members.map(pkg => ({
    name: pkg.name,
    dir: slash(relative(root, dirname(pkg.manifest_path))),
    dependencies: sorted(pkg.dependencies.map(dep => nameByPath.get(dep.path)).filter(Boolean)),
    procMacro: pkg.targets.some(target => target.kind.includes('proc-macro')),
    targets: pkg.targets.map(target => ({ name: target.name, kind: target.kind, path: slash(relative(root, target.src_path)), requiredFeatures: target['required-features'] ?? [] })),
  }));
  const files = walk(sb).map(path => PREFIX + path);
  const text = path => existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : '';
  const packages = readdirSync(join(sb, 'packages'), { withFileTypes: true }).filter(entry => entry.isDirectory())
    .filter(entry => existsSync(join(sb, 'packages', entry.name, 'package.json'))).map(entry => {
      const dir = `${PREFIX}packages/${entry.name}`;
      const manifest = JSON.parse(text(`${dir}/package.json`));
      return { name: manifest.name, dir, exports: manifest.exports, main: manifest.main, scripts: manifest.scripts ?? {}, dependencies: sorted(Object.keys({
        ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies,
      })), tests: files.filter(path => path.startsWith(dir + '/') && /(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(path)) };
    });
  const fileSet = new Set(files);
  const evidenceCache = new Map();
  function evidence(path, seen = new Set()) {
    if (seen.has(path)) return [];
    seen.add(path);
    const source = text(path);
    const hits = [];
    if (/\.md\b/.test(source)) hits.push(`${path}: docs consumer`);
    if (/\/dist\//.test(source)) hits.push(`${path}: client build consumer`);
    if (/child_process|snapback4(?:\.exe)?['"`]|SNAPBACK4_BIN|processDevice|bin-path/.test(source)) hits.push(`${path}: CLI/process consumer`);
    if (/wasm|webDevice/.test(source)) hits.push(`${path}: wasm consumer`);
    // Follow literal imports/re-exports, require(), dynamic import(), and URL resources.
    // Unresolved local imports are conservative consumers of both products.
    const imports = [...source.matchAll(/(?:from\s*|import\s*\(|require\s*\(|new URL\s*\(|import\s*)['"]([^'"\n]+)['"]/g)];
    for (const [, specifier] of imports) {
      let raw;
      if (specifier.startsWith('.')) raw = slash(relative(root, resolve(root, dirname(path), specifier)));
      else {
        const workspace = packages.find(pkg => specifier === pkg.name || specifier.startsWith(pkg.name + '/'));
        if (!workspace) continue;
        const key = specifier === workspace.name ? '.' : '.' + specifier.slice(workspace.name.length);
        let entry = workspace.exports?.[key] ?? (key === '.' ? workspace.main : undefined);
        while (entry && typeof entry === 'object') entry = entry.import ?? entry.default ?? entry.node;
        if (typeof entry !== 'string') { hits.push(`${path}: unresolved workspace import ${specifier} (CLI + wasm)`); hits.push(`${path}: client build consumer via unresolved ${specifier}`); continue; }
        raw = slash(join(workspace.dir, entry));
        if (entry.includes('/dist/')) hits.push(`${path}: client build consumer via ${specifier}`);
      }
      const candidates = [raw, raw.replace('/dist/', '/src/').replace(/\.js$/, '.ts'), raw + '.mjs', raw + '.js', raw + '.ts', raw + '/index.ts'];
      const found = candidates.find(candidate => fileSet.has(candidate));
      if (!found) hits.push(`${path}: unresolved local import ${specifier} (CLI + wasm)`);
      else if (/\.[cm]?[jt]sx?$/.test(found)) hits.push(...evidence(found, seen));
    }
    if (/\b(?:import|require)\s*\(\s*[^'"\s]|\b(?:import|export)\s*\/[/*]/.test(source)) hits.push(`${path}: computed import (CLI + wasm)`);
    return sorted(hits);
  }
  for (const pkg of packages) for (const test of pkg.tests) evidenceCache.set(test, evidence(test));
  const fixtureFiles = files.filter(path => path.startsWith('snapback4/fixtures/') && path.endsWith('.test.mjs'));
  const fixtureEvidence = Object.fromEntries(fixtureFiles.map(path => [path, evidence(path)]));
  return { crates, packages, files, text, fixtureFiles, fixtureEvidence, clientEvidence: Object.fromEntries(evidenceCache) };
}

export function reverseClosure(seeds, nodes) {
  const result = new Set(seeds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (!result.has(node.name) && node.dependencies.some(dep => result.has(dep))) {
      result.add(node.name); changed = true;
    }
  }
  return sorted(result);
}

export function selectAffected(changedFiles, model) {
  const files = sorted(changedFiles);
  for (const path of files) if (path.startsWith('/') || path.split('/').includes('..') || path.includes('\0')) throw new Error(`invalid path ${JSON.stringify(path)}`);
  const reasons = [];
  const fullCrates = new Set();
  const sourceCrates = new Set();
  const narrowRust = new Map();
  const fullPackages = new Set();
  const clientFiles = new Set();
  const fixtureFiles = new Set();
  const checks = new Set(files.length ? ['ref-check'] : []);
  let broad = false;
  let semantics = false;
  const why = (path, reason) => reasons.push({ path, reason });
  function widen(path, reason) { broad = true; why(path, `fail broad: ${reason}`); }
  function docs(path) {
    checks.add('guide'); checks.add('docs-budget'); checks.add('packaged-docs'); why(path, 'guide/docs contract');
    if (/^snapback4\/(?:packages\/|crates\/snapback4-lang\/src\/guide|guide\/|docs\/|README\.md$)/.test(path)) {
      if (model.crates.find(crate => crate.name === 'snapback4-lang')?.targets.some(target => target.name === 'guide')) {
        if (!narrowRust.has('snapback4-lang')) narrowRust.set('snapback4-lang', new Set());
        narrowRust.get('snapback4-lang').add('guide');
      }
      for (const [file, evidence] of Object.entries(model.clientEvidence ?? {})) if (evidence.some(hit => hit.includes('docs consumer'))) {
        clientFiles.add(file); why(file, `documentation consumer of ${path} (conservative doc pool)`);
      }
    }
  }
  for (const path of files) {
    if (path.startsWith('llp/') || /(?:^|\/)AGENTS\.md$|^CLAUDE\.md$/.test(path)) {
      checks.add('ref-check'); why(path, 'LLP/agent instructions'); continue;
    }
    if (!path.startsWith(PREFIX)) {
      if (['scripts/select-local-proof.mjs', 'scripts/local-proof-selection-policy.v1.json', 'scripts/verify-local-proof', 'tests/local_proof_selection_v0.mjs', 'tests/local_proof_inventory_v0.mjs', '.github/workflows/local-proof.yml'].includes(path)) { checks.add('selector-tests'); checks.add('inventories'); why(path, 'root selector integration'); }
      else if (path.startsWith('guide/')) docs(path);
      else widen(path, 'unowned path outside Snapback 4');
      continue;
    }
    const p = path.slice(PREFIX.length);
    if (/(?:generated|codegen|emit_types)/.test(p)) checks.add('generated');
    if (/\/(?:test[_-]support|tests\/(?:common|support))(?:\/|\.)/.test(p)) { widen(path, 'shared test support'); continue; }
    if (/(?:^|\/)(?:Cargo\.toml|Cargo\.lock|lean-toolchain|lake-manifest\.json|build\.rs|package\.json|bun\.lock|rust-toolchain(?:\.toml)?)$/.test(p) || p.startsWith('.cargo/')) {
      widen(path, 'manifest, lock, toolchain or build script'); continue;
    }
    // Changes to this selector and its direct tests have their own affected suite.
    if (/^scripts\/affected(?:-replay)?(?:\.test)?\.mjs$/.test(p)) {
      checks.add('selector-tests'); why(path, 'selector implementation/fixtures'); continue;
    }
    if (/^crates\/snapback4-lang\/src\/guide(?:\/|\.rs$)/.test(p) || /^(?:guide|docs)\//.test(p) || /\.md$/.test(p)) {
      docs(path); checks.add('ref-check');
      if (/^crates\/snapback4-lang\/src\/guide/.test(p)) {
        if (!narrowRust.has('snapback4-lang')) narrowRust.set('snapback4-lang', new Set());
        narrowRust.get('snapback4-lang').add('guide');
        if (path.endsWith('.rs')) { checks.add('diagnostics'); checks.add('inventories'); }
      }
      continue;
    }
    const crate = model.crates.find(crate => path.startsWith(crate.dir + '/'));
    if (crate) {
      if (crate.procMacro) { widen(path, 'proc-macro'); continue; }
      const test = crate.targets.find(target => target.kind.includes('test') && target.path === path);
      if (test && path.endsWith('.rs')) {
        if (!narrowRust.has(crate.name)) narrowRust.set(crate.name, new Set());
        narrowRust.get(crate.name).add(test.name);
        why(path, `integration test target ${crate.name}::${test.name}`);
      } else if (path.startsWith(crate.dir + '/src/') && /\.(?:rs|q|json)$/.test(path)) {
        sourceCrates.add(crate.name); why(path, `${crate.name} sources and reverse dependents`);
        if (['snapback4-lang', 'snapback4-core', 'snapback4-difftest'].includes(crate.name)) semantics = true;
        // Site coordinates drift even when no new diagnostic code is introduced.
        checks.add('diagnostics'); checks.add('inventories');
        if (crate.name === 'snapback4-lang') checks.add('generated');
      } else widen(path, 'shared Rust test support, fixture or unowned crate input');
      continue;
    }
    const pkg = model.packages.find(pkg => path.startsWith(pkg.dir + '/'));
    if (pkg) {
      if (pkg.tests.includes(path)) { clientFiles.add(path); why(path, 'client test file only'); }
      else if (path.startsWith(pkg.dir + '/test/') || path.startsWith(pkg.dir + '/tests/')) widen(path, 'shared client test support');
      else { fullPackages.add(pkg.name); checks.add('diagnostics'); checks.add('inventories'); why(path, 'client package source and reverse dependents');
        if (!pkg.tests.length && !pkg.scripts.test) widen(path, 'package has no owned test runner; include cross-package consumers');
      }
      continue;
    }
    if (p.startsWith('scripts/') || p.startsWith('fixtures/') || p.startsWith('vendor/') || p.startsWith('native-fixtures/')) widen(path, 'shared runner, fixture or vendored build input');
    else if (p.startsWith('lean/')) { semantics = true; why(path, 'Lean model'); }
    else widen(path, 'unknown Snapback 4 path');
    if (/generated|codegen/.test(path)) checks.add('generated');
  }
  for (const path of files) if (model.text?.(path).includes('@ref')) checks.add('ref-check');
  for (const name of reverseClosure([...sourceCrates], model.crates)) fullCrates.add(name);
  if (broad) {
    for (const crate of model.crates) fullCrates.add(crate.name);
    for (const pkg of model.packages) fullPackages.add(pkg.name);
    for (const file of model.fixtureFiles ?? []) fixtureFiles.add(file);
    for (const check of ['guide', 'docs-budget', 'packaged-docs', 'diagnostics', 'inventories', 'generated', 'ref-check', 'selector-tests', 'fixture-tests', 'chat-check', 'chat-typecheck', 'expo-typecheck', 'release-guard']) checks.add(check);
    semantics = true;
  }
  for (const name of reverseClosure([...fullPackages], model.packages)) fullPackages.add(name);
  for (const pkg of model.packages) if (fullPackages.has(pkg.name)) for (const test of pkg.tests) clientFiles.add(test);
  const products = reverseClosure([...sourceCrates], model.crates);
  const cliChanged = broad || products.includes('snapback4');
  const wasmChanged = broad || products.includes('snapback4-device');
  for (const [test, evidence] of Object.entries(model.clientEvidence ?? {})) {
    const matched = evidence.filter(hit => (cliChanged && /CLI|process consumer/.test(hit)) || (wasmChanged && /wasm/.test(hit)));
    if (matched.length) {
      clientFiles.add(test);
      const cli = matched.find(hit => /CLI|process consumer/.test(hit));
      const wasm = matched.find(hit => /wasm/.test(hit));
      for (const hit of sorted([cli, wasm].filter(Boolean))) why(test, hit);
    }
  }
  for (const [file, evidence] of Object.entries(model.fixtureEvidence ?? {})) {
    const hit = evidence.find(hit => (cliChanged && /CLI|process consumer/.test(hit)) || (wasmChanged && /wasm/.test(hit)));
    if (hit) { fixtureFiles.add(file); checks.add('fixture-tests'); why(file, hit); }
  }
  if (wasmChanged) checks.add('wasm-measurement');
  const steps = [];
  const step = (id, cwd, argv, reason) => steps.push({ id, cwd, argv, reason, timeoutSeconds: /^(?:ref-check|selector-tests|packaged-docs)$/.test(id) ? 300 : /^(?:guide|inventories|diagnostics|install-client)$/.test(id) ? 900 : TIMEOUT });
  const cargo = (id, args, reason) => {
    if (args[0] === 'test') {
      const name = args[args.indexOf('-p') + 1];
      const threads = name === 'snapback4' ? '1' : name === 'snapback4-device' ? '2' : '4';
      args = [...args, '--', `--test-threads=${threads}`];
    }
    step(id, 'snapback4', ['cargo', ...args], reason);
  };
  // Build every product used by selected tests, even for a test-only diff; never
  // trust ignored binaries/dist/wasm left over from another revision.
  const evidence = [...clientFiles].flatMap(test => model.clientEvidence?.[test] ?? []).concat([...fixtureFiles].flatMap(test => model.fixtureEvidence?.[test] ?? []));
  const needCli = broad || evidence.some(hit => /CLI|process consumer/.test(hit));
  const needClient = broad || evidence.some(hit => /client build consumer/.test(hit));
  const needWasm = needClient || evidence.some(hit => /wasm/.test(hit));
  if (needWasm || needClient || fullPackages.size) step('install-client', 'snapback4', ['bun', 'install', '--frozen-lockfile'], 'locked client/build dependencies');
  if (needCli) cargo('build-cli', ['build', '-p', 'snapback4'], 'selected clients spawn/import CLI');
  if (needWasm) step('build-wasm', 'snapback4', ['bash', 'scripts/build-wasm.sh'], 'selected clients import wasm');
  if (needClient) step('build-client', 'snapback4', ['bun', 'run', '--cwd', 'packages/snapback4', 'build'], 'selected tests import dist');
  for (const pkg of model.packages) if (fullPackages.has(pkg.name)) {
    if (pkg.scripts.typecheck) step(`typecheck:${pkg.name}`, 'snapback4', ['bun', 'run', '--cwd', pkg.dir.slice(PREFIX.length), 'typecheck'], 'package source change');
    if (pkg.scripts.test) step(`package-test:${pkg.name}`, 'snapback4', ['bun', 'run', '--cwd', pkg.dir.slice(PREFIX.length), 'test'], 'package test script');
  }
  // One Cargo call per package/target permits independent failures to be reported;
  // --no-fail-fast additionally preserves Cargo's other targets within a package.
  for (const name of sorted(fullCrates)) {
    const features = sorted(model.crates.find(crate => crate.name === name).targets.flatMap(target => target.requiredFeatures ?? []));
    cargo(`rust:${name}`, ['test', '--no-fail-fast', '-p', name, ...(features.length ? ['--features', features.join(',')] : [])], 'source/reverse dependency closure or fail broad');
  }
  for (const [name, targets] of [...narrowRust].sort()) if (!fullCrates.has(name)) for (const target of sorted(targets)) {
    const features = model.crates.find(crate => crate.name === name).targets.find(item => item.name === target)?.requiredFeatures ?? [];
    cargo(`rust:${name}:${target}`, ['test', '--no-fail-fast', '-p', name, '--test', target, ...(features.length ? ['--features', features.join(',')] : [])], 'only this integration test changed');
  }
  const modelFiles = [...clientFiles].filter(path => /\/(?:app-session-model|online-client-model)\.test\.mjs$/.test(path));
  const ordinaryFiles = sorted([...clientFiles].filter(path => !modelFiles.includes(path)));
  const concurrency = String(process.env.SNAPBACK4_TEST_SERIAL_CLIENT_FILES === '1' ? 1 : Math.min(24, Math.max(1, Math.floor(availableParallelism() / 3))));
  function testPool(id, files, concurrency, mode, evidenceByFile) {
    step(id, 'snapback4', ['node', 'scripts/run-client-tests.mjs', concurrency, mode, ...files.map(path => path.slice(PREFIX.length))], 'selected files retain existing process custody');
    steps.at(-1).fileArgOffset = 4;
    steps.at(-1).fileRequires = Object.fromEntries(files.map(file => {
      const evidence = evidenceByFile?.[file] ?? [];
      const required = [];
      if (evidence.some(hit => /CLI|process consumer/.test(hit))) required.push('build-cli');
      if (evidence.some(hit => /wasm/.test(hit))) required.push('build-wasm');
      if (evidence.some(hit => /client build consumer/.test(hit))) required.push('build-client');
      // A directory fallback is only used for synthetic models lacking the
      // discovered file inventory; real models always enumerate fixture files.
      if (file.endsWith('/')) required.push('build-cli', 'build-wasm', 'build-client');
      return [file.slice(PREFIX.length), sorted(required)];
    }));
  }
  if (checks.has('fixture-tests')) testPool('fixture-tests', fixtureFiles.size ? sorted(fixtureFiles) : ['snapback4/fixtures/'], '1', 'files', model.fixtureEvidence);
  if (ordinaryFiles.length) testPool('client-tests', ordinaryFiles, concurrency, 'files', model.clientEvidence);
  if (modelFiles.length) testPool('client-models', sorted(modelFiles), '1', 'models', model.clientEvidence);
  const checkCommands = {
    'fixture-tests': ['snapback4', ['node', 'scripts/run-client-tests.mjs', '1', 'files', 'fixtures/']],
    'chat-check': ['snapback4/apps/chat', ['../../target/debug/snapback4', 'check']],
    'chat-typecheck': ['snapback4', ['bun', 'run', '--cwd', 'apps/chat', 'typecheck']],
    'expo-typecheck': ['snapback4', ['bun', 'run', '--cwd', 'apps/chat-expo', 'typecheck']],
    'release-guard': ['snapback4', ['bash', 'scripts/check-release-guard.sh']],
    guide: ['.', ['node', 'scripts/check-guide.mjs']],
    'docs-budget': ['snapback4', ['node', 'scripts/docs-budget.mjs']],
    'packaged-docs': ['snapback4', ['node', '--input-type=module', '-e', "import { lintPackagedDocs } from './scripts/packaged-docs.mjs'; lintPackagedDocs(process.cwd());"]],
    diagnostics: ['.', ['node', 'scripts/generate-diagnostics-registry.mjs', '--check']],
    inventories: ['.', ['node', 'scripts/check-inventories.mjs']],
    generated: ['.', ['bash', 'scripts/check-generated-artifacts']],
    'ref-check': ['.', ['./ref-check']],
    'selector-tests': ['.', ['node', '--test', 'snapback4/scripts/affected.test.mjs', 'tests/local_proof_selection_v0.mjs', 'tests/local_proof_inventory_v0.mjs', 'tests/ci_workflows_v0.mjs']],
    'wasm-measurement': ['snapback4', ['bash', 'scripts/measure-wasm.sh']],
  };
  for (const check of sorted(checks)) if (check !== 'fixture-tests') step(check, ...checkCommands[check], 'affected input contract');
  if (semantics) {
    step('lean-build', 'snapback4/lean', ['lake', 'build'], 'semantic oracle prerequisite');
    for (const mode of ['run-lean', 'run']) cargo(`difftest:${mode}`, ['run', '--release', '-p', 'snapback4-difftest', '--', mode, '--seed', '0', '--cases', '2000', '--workers', '2', '--out', `target/affected/difftest-${mode}`], 'language, planner/store semantics or fail broad');
  }
  const stepIds = new Set(steps.map(step => step.id));
  for (const step of steps) {
    let required = [];
    if (step.id === 'build-wasm' || step.id.startsWith('typecheck:') || step.id === 'expo-typecheck') required.push('install-client');
    if (step.id === 'build-client') required.push('install-client', 'build-wasm');
    if (step.fileRequires) for (const [file, dependencies] of Object.entries(step.fileRequires)) step.fileRequires[file] = dependencies.filter(id => stepIds.has(id));
    if (step.id === 'chat-check') required.push('build-cli');
    if (step.id === 'chat-typecheck') required.push('install-client', 'chat-check');
    if (step.id === 'wasm-measurement') required.push('build-wasm');
    if (step.id === 'difftest:run-lean') required.push('lean-build');
    step.requires = required.filter(id => stepIds.has(id));
  }
  return { schemaVersion: 'snapback4.affected.v1', files, broad, reasons, rustPackages: sorted(fullCrates),
    fixtureFiles: sorted(fixtureFiles),
    rustTargets: Object.fromEntries([...narrowRust].filter(([name]) => !fullCrates.has(name)).map(([name, targets]) => [name, sorted(targets)])),
    clientFiles: sorted(clientFiles), checks: sorted(checks), steps };
}

export function changedPaths(root, base, head, worktree = false) {
  const committed = paths(git(root, 'diff', '--name-only', '-z', '--no-renames', `${base}...${head}`));
  return sorted([...committed, ...(worktree ? [
    ...paths(git(root, 'diff', '--name-only', '-z', '--no-renames', 'HEAD')),
    ...paths(git(root, 'ls-files', '--others', '--exclude-standard', '-z')),
  ] : [])]);
}
function snapshotDigest(root, files) {
  return hash(JSON.stringify(files.map(path => {
    const absolute = join(root, path);
    let stat; try { stat = lstatSync(absolute); } catch (error) { if (error.code === 'ENOENT') return [path, null]; throw error; }
    if (stat.isSymbolicLink()) return [path, 'symlink', readlinkSync(absolute)];
    if (stat.isDirectory()) return [path, 'submodule', git(absolute, 'rev-parse', 'HEAD'), hash(git(absolute, 'diff', 'HEAD')), git(absolute, 'status', '--porcelain', '--untracked-files=all')];
    return [path, 'file', stat.mode, hash(readFileSync(absolute))];
  })));
}

// Historical planning reads the selected revision's Cargo graph and test sources.
// The scratch snapshot is confined to this worktree's target and never runs tests.
export function modelAtRevision(root, revision, fn) {
  const parent = join(root, 'target/affected'); mkdirSync(parent, { recursive: true });
  const snapshot = mkdtempSync(join(parent, 'snapshot-'));
  try {
    const tree = git(root, 'ls-tree', '-r', '--name-only', revision, '--', 'snapback4').trim().split('\n');
    const wanted = ['snapback4/Cargo.toml', 'snapback4/Cargo.lock', 'snapback4/package.json', 'snapback4/crates', 'snapback4/packages', 'snapback4/scripts', 'snapback4/fixtures'];
    const present = wanted.filter(path => tree.some(file => file === path || file.startsWith(path + '/')));
    const archive = command(root, 'git', ['archive', revision, '--', ...present], { encoding: null });
    command(snapshot, 'tar', ['-xf', '-'], { input: archive });
    return fn(loadModel(snapshot));
  } finally { rmSync(snapshot, { recursive: true, force: true }); }
}
export function planAffected({ root = ROOT, base = 'origin/main', head = 'HEAD', worktree = false, files } = {}) {
  const headRevision = git(root, 'rev-parse', '--verify', `${head}^{commit}`).trim();
  const baseRevision = git(root, 'rev-parse', '--verify', `${base}^{commit}`).trim();
  const observedFiles = changedPaths(root, baseRevision, headRevision, worktree);
  const changed = files ?? observedFiles;
  const current = git(root, 'rev-parse', 'HEAD').trim();
  if (worktree && headRevision !== current) throw new Error('--worktree requires current HEAD');
  const select = model => selectAffected(changed, model);
  const plan = worktree ? select(loadModel(root)) : modelAtRevision(root, headRevision, select);
  return { ...plan, base: baseRevision, mergeBase: git(root, 'merge-base', baseRevision, headRevision).trim(), head: headRevision,
    worktree, observedFiles, inputDigest: snapshotDigest(root, observedFiles) };
}
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
export function formatStep(step) {
  return `(cd ${quote(step.cwd)} && timeout ${step.timeoutSeconds}s env RUST_MIN_STACK=33554432 ${Object.entries(CARGO_ENV).map(([key, value]) => `${key}=${value}`).join(' ')} ${step.argv.map(quote).join(' ')})`;
}
export async function runPlan(plan, { root = ROOT } = {}) {
  if (git(root, 'rev-parse', 'HEAD').trim() !== plan.head) throw new Error('--run requires the selected HEAD checked out');
  if (!plan.worktree && changedPaths(root, plan.head, plan.head, true).length) throw new Error('dirty worktree: use --worktree to bind uncommitted changes');
  const earlier = new Set();
  for (const step of plan.steps) {
    if ([...(step.requires ?? []), ...Object.values(step.fileRequires ?? {}).flat()].some(id => !earlier.has(id))) throw new Error(`missing or later prerequisite for ${step.id}`);
    if (earlier.has(step.id)) throw new Error(`duplicate step ID ${step.id}`);
    earlier.add(step.id);
  }
  const started = new Date().toISOString();
  const receiptDir = join(root, 'target/affected'); mkdirSync(receiptDir, { recursive: true });
  const receiptPath = join(receiptDir, `${plan.head.slice(0, 12)}-${Date.now()}.json`);
  const receipt = { ...plan, started, results: [], complete: false };
  const persist = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  persist();
  for (const step of plan.steps) {
    let executionStep = step;
    const blockedFiles = [];
    const failedPrerequisites = dependencies => dependencies.filter(id => !receipt.results.some(result => result.id === id && result.status === 0));
    if (step.fileRequires) {
      const runnable = [];
      for (const file of step.argv.slice(step.fileArgOffset)) {
        const blockedBy = failedPrerequisites(step.fileRequires[file] ?? []);
        if (blockedBy.length) blockedFiles.push({ file, blockedBy }); else runnable.push(file);
      }
      for (const entry of blockedFiles) console.error(`BLOCKED: ${entry.file} by ${entry.blockedBy.join(', ')}`);
      if (!runnable.length) { receipt.results.push({ id: step.id, status: null, blockedFiles, elapsedMs: 0 }); persist(); continue; }
      executionStep = { ...step, argv: [...step.argv.slice(0, step.fileArgOffset), ...runnable] };
    }
    console.error(`== ${step.id}\n${formatStep(executionStep)}`);
    const blockedBy = (step.requires ?? []).filter(id => !receipt.results.some(result => result.id === id && result.status === 0));
    if (blockedBy.length) { receipt.results.push({ id: step.id, status: null, blockedBy, elapsedMs: 0 }); persist(); console.error(`BLOCKED: ${step.id} by ${blockedBy.join(', ')}`); continue; }
    const before = Date.now();
    const result = await new Promise(resolveResult => {
      const child = spawn('timeout', ['--kill-after=10s', `${step.timeoutSeconds}s`, ...executionStep.argv], {
        cwd: resolve(root, step.cwd), env: { ...process.env, ...CARGO_ENV, RUST_MIN_STACK: '33554432' }, stdio: 'inherit',
      });
      child.on('error', error => resolveResult({ status: null, error: error.message }));
      child.on('close', (status, signal) => resolveResult({ status, signal }));
    });
    receipt.results.push({ id: step.id, ...result, ...(blockedFiles.length ? { executedStatus: result.status, status: result.status === 0 ? null : result.status, blockedFiles } : {}), elapsedMs: Date.now() - before }); persist();
  }
  receipt.complete = true;
  receipt.finished = new Date().toISOString();
  receipt.unchanged = git(root, 'rev-parse', 'HEAD').trim() === plan.head && snapshotDigest(root, plan.observedFiles) === plan.inputDigest
    && JSON.stringify(changedPaths(root, plan.base, plan.head, true)) === JSON.stringify(plan.observedFiles);
  receipt.ok = receipt.unchanged && receipt.results.every(result => result.status === 0);
  persist(); console.error(`Receipt: ${receiptPath}; ${receipt.ok ? 'PASS' : 'FAIL'}`);
  return { receiptPath, receipt };
}
export function proofReceiptOptions(receipt) {
  return {
    base: receipt.requestedBaseRevision ?? receipt.headRevision, head: receipt.headRevision, worktree: receipt.worktreeIncluded,
    files: receipt.cadence === 'complete' || receipt.selectionClass === 'FAIL_CLOSED_FULL'
      ? ['snapback4/Cargo.toml'] : receipt.changedFiles.filter(path => path.startsWith(PREFIX)),
  };
}
async function main() {
  const args = process.argv.slice(2);
  const options = {}; let json = false; let run = false; let proofReceipt;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') json = true;
    else if (arg === '--run') run = true;
    else if (arg === '--complete') options.files = ['snapback4/Cargo.toml'];
    else if (arg === '--worktree') options.worktree = true;
    else if (['--base', '--head', '--proof-receipt'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--proof-receipt') proofReceipt = args[++i]; else options[arg.slice(2)] = args[++i];
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.worktree && options.head) throw new Error('--head and --worktree are mutually exclusive');
  if (proofReceipt) {
    const receipt = JSON.parse(readFileSync(proofReceipt, 'utf8'));
    Object.assign(options, proofReceiptOptions(receipt));
  }
  const plan = planAffected(options);
  if (json) console.log(JSON.stringify(plan, null, 2));
  else {
    for (const { path, reason } of plan.reasons) console.log(`# ${path}: ${reason}`);
    for (const step of plan.steps) console.log(formatStep(step));
    console.log(`# ${plan.steps.length} commands, ${plan.rustPackages.length} whole Rust packages, ${plan.clientFiles.length} client files; broad=${plan.broad}`);
  }
  if (run) { const { receipt } = await runPlan(plan); if (!receipt.ok) process.exitCode = 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
