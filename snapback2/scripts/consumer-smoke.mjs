// @ref LLP 1007#5-the-work — installed tarballs replace measure's duplicate core-test rung.
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

// @ref LLP 1002#11-measured — a packed shim names only the platform artifacts in its publication.
const platformPackageNames = ['snapback2-darwin-arm64', 'snapback2-linux-x64'];

function isPlatformPackage(name) { return platformPackageNames.includes(name); }

export function platformPackageReadme(name) {
  return `# ${name}

This package contains Snapback 2 native binaries for ${name.replace('snapback2-', '')}.

Do not execute \`bin/snapback2\` directly for \`check\` or \`dev\`. Run
\`npx snapback2 check\` or \`npx snapback2 dev\`; the public wrapper supplies
the bundled compiler worker and the rest of the package runtime.
`;
}

export function hostConsumerArtifacts(artifacts, platform = process.platform, arch = process.arch) {
  const hostName = `snapback2-${platform}-${arch}`;
  const shim = artifacts.filter(artifact => artifact.name === 'snapback2');
  const host = artifacts.filter(artifact => artifact.name === hostName);
  if (shim.length !== 1) throw new Error('staged publication needs exactly one snapback2 shim artifact');
  if (host.length !== 1) throw new Error(`staged publication needs exactly one ${hostName} artifact for host qualification`);
  return [host[0], shim[0]];
}

function selectedPlatformDependencies(manifest, artifacts) {
  if (!artifacts.length) throw new Error('a staged shim needs at least one platform artifact');
  const dependencies = Object.fromEntries(Object.entries(manifest.optionalDependencies ?? {})
    .filter(([name]) => !isPlatformPackage(name)));
  for (const artifact of [...artifacts].sort((left, right) =>
    platformPackageNames.indexOf(left.name) - platformPackageNames.indexOf(right.name))) {
    if (!isPlatformPackage(artifact.name)
      || artifact.version !== manifest.version || Object.hasOwn(dependencies, artifact.name)) {
      throw new Error(`invalid staged platform ${artifact.name}@${artifact.version} for snapback2@${manifest.version}`);
    }
    dependencies[artifact.name] = artifact.version;
  }
  return dependencies;
}

export function stagePlatformDependencies(directory, artifacts) {
  const path = resolve(directory, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.optionalDependencies = selectedPlatformDependencies(manifest, artifacts);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function verifyPlatformDependencies(artifacts) {
  const shim = artifacts.find(artifact => artifact.name === 'snapback2');
  if (!shim) throw new Error('staged publication has no snapback2 shim artifact');
  const manifests = new Map(artifacts.map(artifact => {
    const unpacked = spawnSync('tar', ['-xOzf', artifact.tarball, 'package/package.json'], {
      encoding: 'utf8', timeout: 30_000,
    });
    if (unpacked.status !== 0) throw new Error(`cannot read staged package ${artifact.tarball}: ${unpacked.stderr}`);
    const manifest = JSON.parse(unpacked.stdout);
    if (manifest.name !== artifact.name || manifest.version !== artifact.version) {
      throw new Error(`staged package ${artifact.tarball} does not match ${artifact.name}@${artifact.version}`);
    }
    return [artifact.name, manifest];
  }));
  const manifest = manifests.get(shim.name);
  const expected = selectedPlatformDependencies(manifest, artifacts.filter(artifact => artifact !== shim));
  const actual = manifest.optionalDependencies ?? {};
  if (Object.keys(actual).length !== Object.keys(expected).length
    || Object.entries(expected).some(([name, version]) => actual[name] !== version)) {
    throw new Error('staged shim optionalDependencies do not match its platform artifacts; stage a new publication');
  }
}

export function receiptVerdict(result, allowNoEngine = false) {
  let receipt;
  try { receipt = JSON.parse(result.stdout); } catch { return { accepted: false, verdict: 'invalid receipt' }; }
  const checks = Array.isArray(receipt.checks) ? receipt.checks : [];
  if (!checks.length) return { accepted: false, verdict: 'zero checks' };
  // Effects may retain notWitnessed rows beside a successful witness. The
  // coverage verdict decides acceptance; negative evidence alone cannot pass.
  if (result.status === 0 && receipt.verdict === 'pass' && checks.every(c => c.verdict === 'pass')) {
    return { accepted: true, verdict: 'pass' };
  }
  const blocked = checks.filter(c => c.verdict === 'blocked');
  // Exactly the engine-absence blocks (LLP 1021 §4): the effects check with no
  // engine, and the journeys the supervisor recorded blocked for that reason.
  const engineAbsence = c => c.verdict === 'blocked' && (
    (c.name === 'effects' && c.detail?.reason === 'no engine in this build')
    || (c.kind === 'journey' && c.detail?.reason === 'effects:no-engine'));
  if (allowNoEngine && result.status === 1 && receipt.verdict === 'blocked' && blocked.length
    && checks.every(c => c.verdict === 'pass' || engineAbsence(c))) {
    return { accepted: true, verdict: 'blocked', blocked: blocked.map(c => c.name).join(', ') };
  }
  return { accepted: false, verdict: receipt.verdict ?? 'missing' };
}

function cleanEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith('SNAPBACK2_') && !['NODE_PATH', 'NODE_OPTIONS', 'DYLD_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH', 'SNAPBACK_URL', 'VITE_SNAPBACK_URL'].includes(key)));
}

// Only installed entry points run inside the temporary consumer. No workspace
// module links or compiler/template overrides can make a broken tarball pass.
export function consumerSmoke(artifacts, { allowNoEngine = false, npm = 'npm' } = {}) {
  const started = performance.now();
  const directory = mkdtempSync(resolve(tmpdir(), 'snapback2-consumer-'));
  const env = cleanEnvironment();
  const steps = [];
  const failures = [];
  let retainForRecovery = false;
  const execute = (label, command, args, cwd, accept = r => r.status === 0) => {
    const before = performance.now();
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', detached: process.platform !== 'win32', timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024 });
    // The shim waits on the Rust CLI, which can own a foreground test server.
    // On timeout, terminate the process group recorded by this launch, not just
    // the shim; detached dev owners have their own group and stop below.
    if (result.error && result.pid && process.platform !== 'win32') {
      try { process.kill(-result.pid, 'SIGKILL'); } catch (error) {
        if (error.code !== 'ESRCH') failures.push(`cleanup process group ${result.pid}: ${error.message}`);
      }
    }
    const ok = !result.error && accept(result);
    steps.push({ name: label, seconds: (performance.now() - before) / 1000, ok });
    if (!ok) failures.push(`${label}: ${result.error?.message ?? `exit ${result.status}`}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    return result;
  };
  const installArgs = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps', '--prefer-offline', '--fetch-retries=0', '--fetch-timeout=15000'];
  try {
    writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ name: 'snapback2-consumer', private: true, type: 'module' }));
    const installed = execute('install tarballs', npm, [...installArgs, ...artifacts.map(a => a.tarball), 'react@19.1.1', 'react-dom@19.1.1', 'vite@7.1.4', '@types/react@19.1.12', '@types/react-dom@19.1.9', 'react-test-renderer@19.1.1'], directory);
    if (installed.status === 0) {
      const cli = resolve(directory, 'node_modules/snapback2/bin/snapback2.mjs');
      const platformName = `snapback2-${process.platform}-${process.arch}`;
      const rawCli = resolve(directory, 'node_modules', platformName, 'bin/snapback2');
      const readme = readFileSync(resolve(directory, 'node_modules', platformName, 'README.md'), 'utf8');
      const readmeOk = readme.includes('Do not execute `bin/snapback2` directly')
        && readme.includes('npx snapback2 check') && readme.includes('npx snapback2 dev');
      steps.push({ name: 'platform README guidance', seconds: 0, ok: readmeOk });
      if (!readmeOk) failures.push(`${platformName} README does not route check/dev through the public wrapper`);
      const invoke = (name, args, cwd, accept) => execute(name, process.execPath, [cli, ...args], cwd, accept);
      const rawGuidance = (result, command) => {
        const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
        return result.status === 1 && output.includes('E_OWNER_NO_COMPILER')
          && output.includes(`run npx snapback2 ${command}`);
      };
      invoke('doctor', ['doctor', '--json'], directory);
      invoke('guide auth', ['guide', 'auth'], directory);
      execute('public client and React exports', process.execPath, ['--input-type=module', '-e',
        'import { createClient } from "snapback2/client"; import { SnapbackProvider, useQuery } from "snapback2/react"; if (![createClient, SnapbackProvider, useQuery].every(x => typeof x === "function")) throw Error("missing exports");'], directory);
      for (const template of ['todos', 'chat']) {
        const project = resolve(directory, template);
        mkdirSync(project);
        invoke(`${template} init`, ['init', '.', '--template', template, '--client', 'react', '--json'], project);
        if (template === 'todos') {
          const compiler = resolve(directory, 'node_modules/snapback2/dist/compiler.mjs');
          execute('raw binary check missing-compiler guidance', rawCli, ['check'], project,
            result => rawGuidance(result, 'check'));
          execute('raw binary check missing-node guidance', rawCli, ['check'], project,
            result => rawGuidance(result, 'check'),
            { ...env, SNAPBACK2_COMPILER: compiler });
          execute('raw binary dev missing-compiler guidance', rawCli, ['dev', '--foreground'], project,
            result => rawGuidance(result, 'dev --foreground'));
          execute('raw binary dev missing-node guidance', rawCli, ['dev', '--foreground'], project,
            result => rawGuidance(result, 'dev --foreground'),
            { ...env, SNAPBACK2_COMPILER: compiler });
        }
        invoke(`${template} check`, ['check', '--json'], project);
        execute(`${template} React bundle`, process.execPath, [resolve(directory, 'node_modules/vite/bin/vite.js'), 'build'], project);
        let attemptedDev = false;
        try {
          attemptedDev = true;
          const dev = invoke(`${template} dev`, ['dev'], project, r => r.status === 0 && r.stdout.includes('SNAPBACK_URL='));
          const url = /SNAPBACK_URL=(\S+)/.exec(dev.stdout ?? '')?.[1];
          if (template === 'todos' && dev.status === 0 && url) {
            execute('React live query round trip', process.execPath, ['--input-type=module', '-e', reactRoundTrip, url], directory);
          }
          invoke(`${template} test`, ['test', '--json'], project, r => {
            const verdict = receiptVerdict(r, allowNoEngine);
            steps.push({ name: `${template} receipt`, ...verdict });
            return verdict.accepted;
          });
        } finally {
          if (attemptedDev) {
            const stopped = invoke(`${template} stop`, ['dev', '--stop', '--json'], project);
            // A detached owner has a separate process group. Preserve its own
            // recovery metadata if stop fails; never delete a live owner's store.
            if (stopped.status !== 0 && existsSync(resolve(project, '.snapback/owner.json'))) retainForRecovery = true;
          }
        }
      }
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.stack : String(error));
  } finally {
    if (retainForRecovery) failures.push(`owner stop failed; retained consumer for recovery: ${directory}`);
    try { if (!retainForRecovery) rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); }
    catch (error) { failures.push(`consumer cleanup ${directory}: ${error.message}`); }
  }
  return { status: failures.length ? 1 : 0, seconds: (performance.now() - started) / 1000,
    stdout: JSON.stringify({ steps }), stderr: failures.join('\n'), steps };
}

export function packDevelopmentConsumer(root, binary) {
  const started = performance.now();
  const directory = mkdtempSync(resolve(tmpdir(), 'snapback2-consumer-pack-'));
  const name = `snapback2-${process.platform}-${process.arch}`;
  const source = resolve(root, 'packages/snapback2');
  const pkg = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8'));
  try {
    const shim = resolve(directory, 'shim');
    mkdirSync(shim);
    for (const file of ['package.json', 'README.md', ...pkg.files]) {
      mkdirSync(dirname(resolve(shim, file)), { recursive: true });
      cpSync(resolve(source, file), resolve(shim, file), { recursive: true });
    }
    const platform = resolve(directory, name);
    mkdirSync(resolve(platform, 'bin'), { recursive: true });
    copyFileSync(binary, resolve(platform, 'bin/snapback2'));
    const media = resolve(dirname(binary), 'snapback2-media');
    if (existsSync(media)) copyFileSync(media, resolve(platform, 'bin/snapback2-media'));
    writeFileSync(resolve(platform, 'README.md'), platformPackageReadme(name));
    writeFileSync(resolve(platform, 'package.json'), JSON.stringify({ name, version: pkg.version, files: ['bin', 'README.md'], os: [process.platform], cpu: [process.arch] }));
    stagePlatformDependencies(shim, [{ name, version: pkg.version }]);
    const artifacts = [platform, shim].map(path => {
      const result = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory, path], { encoding: 'utf8', env: cleanEnvironment(), timeout: 30_000 });
      if (result.status !== 0) throw new Error(`npm pack failed: ${result.stderr}`);
      const record = JSON.parse(result.stdout)[0];
      return { name: record.name, tarball: resolve(directory, record.filename), integrity: record.integrity };
    });
    const result = consumerSmoke(artifacts, { allowNoEngine: true });
    return { ...result, seconds: (performance.now() - started) / 1000 };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

// Exercise the installed React context, hook, SSE transport and headless writer
// together. The test renderer is a consumer dependency, never a workspace link.
const reactRoundTrip = `
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { api, createClient } from 'snapback2/client';
import { SnapbackProvider, useQuery } from 'snapback2/react';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let state, renderer;
function Probe() { state = useQuery(api.todos.list, {}); return React.createElement('div', null, state.status); }
async function until(predicate) {
  const end = Date.now() + 5000;
  while (!predicate() && Date.now() < end) await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  assert.ok(predicate(), 'installed React query did not receive the expected live state');
}
const url = process.argv[1];
const client = createClient({ url, persona: 'alice' });
try {
  await client.ready;
  await act(async () => { renderer = create(React.createElement(SnapbackProvider, { url, persona: 'alice' }, React.createElement(Probe))); });
  await until(() => state?.status === 'ready' && state.receipt?.state === 'complete' && state.freshness.live);
  await act(async () => {
    const result = await client.mutation(api.todos.add, { title: 'installed React proof' });
    assert.equal(result.state, 'committed');
  });
  await until(() => state?.data?.some(row => row.title === 'installed React proof'));
} finally {
  if (renderer) await act(async () => renderer.unmount());
  await client.close();
}
`;
