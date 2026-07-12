// ENG-24380: the required-surface gate must not trust stale/linked installs or
// let a package manager park CI forever.

import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

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
    {
      cwd: scratch,
      timeoutMs: 100,
      killGraceMs: 50,
      inheritOutput: false,
      readyWhen: (output) => /install started/.test(output),
      readinessTimeoutMs: 2_000,
    },
  );
  assert.equal(hung.ok, false);
  assert.equal(hung.timedOut, true);
  assert.match(hung.reason, /process tree terminated/);
  assert.match(hung.output, /install started/);
  assert(Date.now() - started < 2_000, 'hung install is bounded');

  if (process.platform !== 'win32') {
    const nonzeroTree = await runBoundedProcess(process.execPath, ['-e', [
      'const { spawn } = require("node:child_process");',
      'const child = spawn(process.execPath, ["-e", "process.on(\\"SIGTERM\\", () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      'console.log(`nonzero-grandchild:${child.pid}`);',
      'setTimeout(() => process.exit(7), 50);',
    ].join(' ')], {
      cwd: scratch,
      timeoutMs: 2_000,
      inheritOutput: false,
      readyWhen: (output) => /nonzero-grandchild:\d+/.test(output),
      readinessTimeoutMs: 2_000,
    });
    assert.equal(nonzeroTree.ok, false);
    assert.match(nonzeroTree.reason, /exited 7; process tree terminated/);
    assert.equal(nonzeroTree.cleanup?.ok, true, JSON.stringify(nonzeroTree.cleanup));
    const nonzeroGrandchildPid = Number(/nonzero-grandchild:(\d+)/.exec(nonzeroTree.output)?.[1]);
    assert(Number.isInteger(nonzeroGrandchildPid), `missing nonzero grandchild pid in ${nonzeroTree.output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    let nonzeroGrandchildAlive = true;
    try { process.kill(nonzeroGrandchildPid, 0); } catch (error) {
      if (error.code === 'ESRCH') nonzeroGrandchildAlive = false;
      else throw error;
    }
    assert.equal(nonzeroGrandchildAlive, false, 'nonzero leader exit kills its surviving descendant');

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

  const fakeWindowsRun = async (taskkillCode) => {
    const leader = new EventEmitter();
    leader.pid = 4242;
    leader.exitCode = 9;
    leader.stdout = new PassThrough();
    leader.stderr = new PassThrough();
    leader.kill = () => true;
    let taskkillCompleted = false;
    const taskkillCalls = [];
    const spawnImpl = (command, args) => {
      if (command !== 'taskkill') {
        queueMicrotask(() => leader.emit('close', 9, null));
        return leader;
      }
      taskkillCalls.push(args);
      const killer = new EventEmitter();
      killer.kill = () => true;
      setTimeout(() => {
        taskkillCompleted = true;
        killer.emit('close', taskkillCode, null);
      }, 25);
      return killer;
    };
    const result = await runBoundedProcess('fake-command', [], {
      cwd: scratch,
      timeoutMs: 1_000,
      inheritOutput: false,
      platform: 'win32',
      spawnImpl,
      taskkillTimeoutMs: 500,
    });
    return { result, taskkillCalls, taskkillCompleted };
  };

  const windowsCleanup = await fakeWindowsRun(0);
  assert.equal(windowsCleanup.taskkillCompleted, true, 'failure settlement awaits taskkill close');
  assert.deepEqual(windowsCleanup.taskkillCalls, [['/pid', '4242', '/t', '/f']]);
  assert.equal(windowsCleanup.result.cleanup?.ok, true);
  assert.match(windowsCleanup.result.reason, /process tree terminated/);

  const windowsCleanupFailure = await fakeWindowsRun(5);
  assert.equal(windowsCleanupFailure.taskkillCompleted, true, 'failed taskkill is still awaited');
  assert.equal(windowsCleanupFailure.result.cleanup?.ok, false);
  assert.equal(windowsCleanupFailure.result.cleanup?.code, 5);
  assert.match(windowsCleanupFailure.result.reason, /cleanup not attested.*taskkill exited 5/);

  const timeoutLeader = new EventEmitter();
  timeoutLeader.pid = 4343;
  timeoutLeader.exitCode = null;
  timeoutLeader.stdout = new PassThrough();
  timeoutLeader.stderr = new PassThrough();
  timeoutLeader.kill = () => true;
  let timeoutTaskkillCompleted = false;
  const timeoutTaskkillCalls = [];
  const timeoutSpawn = (command, args) => {
    if (command !== 'taskkill') return timeoutLeader;
    timeoutTaskkillCalls.push(args);
    const killer = new EventEmitter();
    killer.kill = () => true;
    setTimeout(() => {
      timeoutTaskkillCompleted = true;
      killer.emit('close', 0, null);
      timeoutLeader.exitCode = 1;
      timeoutLeader.emit('close', null, 'SIGTERM');
    }, 25);
    return killer;
  };
  const fakeProcessHandle = setInterval(() => {}, 1_000);
  const windowsTimeout = await runBoundedProcess('fake-hung-command', [], {
    cwd: scratch,
    timeoutMs: 10,
    killGraceMs: 100,
    inheritOutput: false,
    platform: 'win32',
    spawnImpl: timeoutSpawn,
    taskkillTimeoutMs: 500,
  }).finally(() => clearInterval(fakeProcessHandle));
  assert.equal(timeoutTaskkillCompleted, true, 'timeout settlement awaits taskkill close');
  assert.deepEqual(timeoutTaskkillCalls, [['/pid', '4343', '/t']]);
  assert.equal(windowsTimeout.timedOut, true);
  assert.equal(windowsTimeout.cleanup?.ok, true);

  const failedTimeoutLeader = new EventEmitter();
  failedTimeoutLeader.pid = 4444;
  failedTimeoutLeader.exitCode = null;
  failedTimeoutLeader.stdout = new PassThrough();
  failedTimeoutLeader.stderr = new PassThrough();
  failedTimeoutLeader.kill = () => false;
  const failedTimeoutCalls = [];
  const failedTimeoutSpawn = (command, args) => {
    if (command !== 'taskkill') return failedTimeoutLeader;
    failedTimeoutCalls.push(args);
    const killer = new EventEmitter();
    killer.kill = () => true;
    setTimeout(() => killer.emit('close', 5, null), 5);
    return killer;
  };
  const failedTimeoutHandle = setInterval(() => {}, 1_000);
  const failedWindowsTimeout = await runBoundedProcess('fake-unkillable-command', [], {
    cwd: scratch,
    timeoutMs: 5,
    killGraceMs: 10,
    inheritOutput: false,
    platform: 'win32',
    spawnImpl: failedTimeoutSpawn,
    taskkillTimeoutMs: 100,
  }).finally(() => clearInterval(failedTimeoutHandle));
  assert.deepEqual(failedTimeoutCalls, [
    ['/pid', '4444', '/t'],
    ['/pid', '4444', '/t', '/f'],
  ]);
  assert.equal(failedWindowsTimeout.timedOut, true);
  assert.equal(failedWindowsTimeout.cleanup?.ok, false);
  assert.match(failedWindowsTimeout.reason, /cleanup not attested.*taskkill exited 5/);

  console.log('required_surface_builds_v0: PASS');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
