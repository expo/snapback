// ENG-24380: the required-surface gate must not trust stale/linked installs or
// let a package manager park CI forever.

import { strict as assert } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ensureRegistryInstall,
  runBoundedProcess,
  verifyInstalledExactContract,
} from '../scripts/check-required-surface-builds.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'required-surface-builds-'));

function surface(name, installedVersion = '1.2.3') {
  const surfaceDir = join(scratch, name);
  const packageRoot = join(surfaceDir, 'node_modules', '@exact', 'contract');
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(join(surfaceDir, 'package.json'), JSON.stringify({
    dependencies: { '@exact/contract': 'npm:@ccheever/exact-contract@1.2.3' },
  }));
  writeFileSync(join(surfaceDir, 'bun.lock'), [
    '{',
    '  "workspaces": { "": { "dependencies": {',
    '    "@exact/contract": "npm:@ccheever/exact-contract@1.2.3"',
    '  } } },',
    '  "packages": {',
    '    "@exact/contract": ["@ccheever/exact-contract@1.2.3", "", {}, "sha512-test"]',
    '  }',
    '}',
  ].join('\n'));
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@ccheever/exact-contract',
    version: installedVersion,
  }));
  return { surfaceDir };
}

try {
  const valid = surface('valid');
  assert.equal(verifyInstalledExactContract(valid.surfaceDir).ok, true, 'valid lock-installed package passes');

  const stale = surface('stale', '9.9.9');
  const staleVerdict = verifyInstalledExactContract(stale.surfaceDir);
  assert.equal(staleVerdict.ok, false);
  assert.match(staleVerdict.reason, /stale .*expected .*1\.2\.3.*found .*9\.9\.9/s);

  let frozenRuns = 0;
  const installed = await ensureRegistryInstall(valid, {
    runInstall: async () => {
      frozenRuns += 1;
      return { ok: true, output: 'cache verified' };
    },
  });
  assert.equal(installed.ok, true);
  assert.equal(frozenRuns, 1, 'a valid cache is still checked by frozen install');

  const linked = surface('linked');
  const linkedRoot = join(linked.surfaceDir, 'node_modules', '@exact', 'contract');
  const external = join(scratch, 'external-contract');
  mkdirSync(external, { recursive: true });
  writeFileSync(join(external, 'package.json'), JSON.stringify({
    name: '@ccheever/exact-contract',
    version: '1.2.3',
  }));
  rmSync(linkedRoot, { recursive: true, force: true });
  symlinkSync(external, linkedRoot, 'dir');
  const linkedVerdict = verifyInstalledExactContract(linked.surfaceDir);
  assert.equal(linkedVerdict.ok, false);
  assert.match(linkedVerdict.reason, /unexpected linked source/);
  assert.equal(
    verifyInstalledExactContract(linked.surfaceDir, { allowLinked: true }).ok,
    true,
    'linked Exact requires the explicit development override',
  );

  const ancestorLinked = surface('ancestor-linked');
  const externalModules = join(scratch, 'external-node-modules');
  mkdirSync(join(externalModules, '@exact', 'contract'), { recursive: true });
  writeFileSync(join(externalModules, '@exact', 'contract', 'package.json'), JSON.stringify({
    name: '@ccheever/exact-contract',
    version: '1.2.3',
  }));
  rmSync(join(ancestorLinked.surfaceDir, 'node_modules'), { recursive: true, force: true });
  symlinkSync(externalModules, join(ancestorLinked.surfaceDir, 'node_modules'), 'dir');
  const ancestorLinkedVerdict = verifyInstalledExactContract(ancestorLinked.surfaceDir);
  assert.equal(ancestorLinkedVerdict.ok, false);
  assert.match(ancestorLinkedVerdict.reason, /unexpected linked source.*node_modules/s);
  assert.equal(
    verifyInstalledExactContract(ancestorLinked.surfaceDir, { allowLinked: true }).ok,
    true,
    'a symlinked node_modules ancestor also requires the explicit development override',
  );
  let linkedInstallRuns = 0;
  const linkedInstall = await ensureRegistryInstall(ancestorLinked, {
    runInstall: async () => {
      linkedInstallRuns += 1;
      return { ok: true, output: '' };
    },
  });
  assert.equal(linkedInstall.ok, false);
  assert.equal(linkedInstallRuns, 0, 'a frozen install never mutates an unexpected linked tree');

  const drained = await runBoundedProcess(
    process.execPath,
    ['-e', 'process.stdout.write("begin:" + "x".repeat(65536) + ":end")'],
    { cwd: scratch, timeoutMs: 2_000, inheritOutput: false },
  );
  assert.equal(drained.ok, true);
  assert.match(drained.output, /^begin:x+:end$/, 'successful process diagnostics drain before settlement');

  const earlySuccess = await runBoundedProcess(
    process.execPath,
    ['-e', 'process.exit(0)'],
    {
      cwd: scratch,
      timeoutMs: 100,
      readinessTimeoutMs: 2_000,
      readyWhen: () => false,
      inheritOutput: false,
    },
  );
  assert.equal(earlySuccess.ok, false);
  assert.match(earlySuccess.reason, /exited 0 before required readiness/);

  const throwingReadiness = await runBoundedProcess(
    process.execPath,
    ['-e', 'console.log("probe readiness"); setInterval(() => {}, 1000)'],
    {
      cwd: scratch,
      timeoutMs: 100,
      killGraceMs: 50,
      readinessTimeoutMs: 2_000,
      readyWhen: () => { throw new Error('predicate exploded'); },
      inheritOutput: false,
    },
  );
  assert.equal(throwingReadiness.ok, false);
  assert.match(throwingReadiness.reason, /readiness predicate failed: predicate exploded/);

  const started = Date.now();
  const hung = await runBoundedProcess(
    process.execPath,
    ['-e', 'process.stdout.write("install started\\n"); setInterval(() => {}, 1000)'],
    { cwd: scratch, timeoutMs: 100, killGraceMs: 50, inheritOutput: false },
  );
  assert.equal(hung.ok, false);
  assert.equal(hung.timedOut, true);
  assert.match(hung.reason, /process tree terminated/);
  assert.match(hung.output, /install started/);
  assert(Date.now() - started < 2_000, 'hung install is bounded');

  if (process.platform !== 'win32') {
    const tree = await runBoundedProcess(process.execPath, ['-e', [
      'const { spawn } = require("node:child_process");',
      'const child = spawn(process.execPath, ["-e", "process.on(\\"SIGTERM\\", () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      'console.log(`grandchild:${child.pid}`);',
      'setInterval(() => {}, 1000);',
    ].join(' ')], {
      cwd: scratch,
      timeoutMs: 100,
      killGraceMs: 50,
      inheritOutput: false,
      // Do not race a 100ms execution watchdog against process startup. Arm it
      // only after the fixture has published the descendant PID that the
      // assertion below uses to prove process-tree cleanup.
      readyWhen: (output) => /grandchild:\d+/.test(output),
      readinessTimeoutMs: 2_000,
    });
    assert.equal(tree.timedOut, true);
    const grandchildPid = Number(/grandchild:(\d+)/.exec(tree.output)?.[1]);
    assert(Number.isInteger(grandchildPid), `missing grandchild pid in ${tree.output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    let alive = true;
    try { process.kill(grandchildPid, 0); } catch (error) {
      if (error.code === 'ESRCH') alive = false;
      else throw error;
    }
    assert.equal(alive, false, 'watchdog kills a TERM-resistant descendant');
  }

  console.log('required_surface_builds_v0: PASS');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
