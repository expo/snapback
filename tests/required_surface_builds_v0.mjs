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
  classifyRequiredWebSurface,
  collectGatedGeneratedBackends,
  collectRequiredWebSurfaces,
  ensureRegistryInstall,
  ensureWorkspaceInstall,
  loadRequiredSurfaceBuildPathPolicy,
  materializeGeneratedBackend,
  requiredSurfaceStructuralErrors,
  runBoundedProcess,
  selectRequiredSurfaceBuildPaths,
  signalProcessTree,
  validateRequiredSurfaceBuildPathPolicy,
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
  const requiredWebSurfaces = collectRequiredWebSurfaces();
  assert.deepEqual(
    requiredWebSurfaces.map(({ demoId, surfaceName }) => `${demoId}/${surfaceName}`),
    ['all-aboard/contract', 'cursors-web/contract', 'pointing-room/contract'],
    'the manifest-derived required web inventory is explicit and non-vacuous',
  );

  // LLP 0316 Phase 6 / restoration precondition 3: this checked authority is
  // the eventual GitHub `paths` list. It covers the generator, build harness,
  // lock/toolchain inputs, and exact required product roots while leaving
  // unrelated pushes out of a known-red heavyweight lane.
  const pathPolicy = loadRequiredSurfaceBuildPathPolicy();
  const pathPatterns = validateRequiredSurfaceBuildPathPolicy(pathPolicy, {
    surfaces: requiredWebSurfaces,
  });
  assert.deepEqual(pathPolicy.requiredSurfacePaths, [
    'demos/all-aboard/snapback/**',
    'demos/all-aboard/surfaces/contract/**',
    'demos/cursors-web/snapback/**',
    'demos/cursors-web/surfaces/contract/**',
    'demos/pointing-room/snapback/**',
    'demos/pointing-room/surfaces/contract/**',
  ], 'every current required web surface has an exact backend and product-surface selector');
  assert.equal(pathPatterns.length > 30, true, 'the selector authority is non-vacuous');

  const selection = (paths) => selectRequiredSurfaceBuildPaths(paths, {
    policy: pathPolicy,
    surfaces: requiredWebSurfaces,
  });
  for (const path of [
    '.github/workflows/required-surface-builds.yml',
    '.node-version',
    'bun.lock',
    'package.json',
    'demos/access-desk/demo.snapback.json',
    'demos/_kit/client.mjs',
    'demos/_kit/define.mjs',
    'demos/_kit/target-origin.mjs',
    'demos/all-aboard/snapback/schema.mjs',
    'demos/cursors-web/snapback/generated/artifacts.json',
    'demos/pointing-room/surfaces/contract/pointing.contract',
    'packages/snapback-react/package.json',
    'packages/snapback-acceptance/index.mjs',
    'packages/snapback-cli/index.mjs',
    'packages/snapback-client/index.mjs',
    'packages/snapback-client/internal/declared-dev-mint.mjs',
    'packages/snapback-codegen/index.mjs',
    'packages/snapback-codegen/review-manifest.schema.json',
    'packages/snapback-codegen/runtime-artifacts/ctx.mjs',
    'packages/snapback-contract/index.mjs',
    'packages/snapback-vite/first-party-auth-relay-routes.generated.json',
    'packages/snapback-vite/index.mjs',
    'scripts/check-artifact-path-hygiene.mjs',
    'scripts/check-checkout-credentials',
    'scripts/check-required-surface-builds.mjs',
    'scripts/lib/process-tree.mjs',
    'scripts/require-bun-package-manager.mjs',
    'scripts/required-surface-build-paths.v1.json',
    'targets/cloudflare/client-options.mjs',
  ]) {
    assert.equal(selection([path])[0].selected, true, `${path} must select required-surface-builds`);
  }
  for (const path of [
    'README.md',
    'crates/snapback-server/src/server.rs',
    'demos/all-aboard/tests/acceptance/headless.mjs',
    'demos/all-aboard/surfaces/react/App.tsx',
    'demos/todo/snapback/schema.mjs',
    'guide/index.md',
    'issues/shelved/20260824-restore-automatic-actions-after-low-noise-interval.md',
    'llp/0316-development-velocity-program.plan.md',
    'packages/snapback-acceptance/package.test.mjs',
    'packages/snapback-acceptance/replay-child.fixture.mjs',
    'packages/snapback-cli/package.test.mjs',
    'packages/snapback-client/outbox-authorization-fence.fixture.mjs',
    'packages/snapback-client/online.test.mjs',
    'packages/snapback-codegen/review-surface.test.mjs',
    'packages/snapback-contract/client-store-authority.test.mjs',
    'packages/snapback-react/index.mjs',
    'packages/snapback-vite/package.test.mjs',
    'targets/cloudflare/src/index.mjs',
    'tests/ci_workflows_v0.mjs',
  ]) {
    assert.equal(selection([path])[0].selected, false, `${path} must not repeat the inherited red`);
  }
  assert.deepEqual(
    selection(['packages/snapback-acceptance/replay-child.fixture.mjs'])[0].matchingPatterns,
    ['packages/snapback-acceptance/*.mjs', '!packages/snapback-acceptance/*.fixture.mjs'],
    'ordered exclusions must override their enclosing production package pattern',
  );

  const futureSurfaces = [
    ...requiredWebSurfaces,
    { demoId: 'future-demo', surfaceName: 'web', surfaceDir: '', pkgPath: '' },
  ];
  assert.throws(
    () => validateRequiredSurfaceBuildPathPolicy(pathPolicy, { surfaces: futureSurfaces }),
    /manifest-derived paths drifted/,
    'a newly required surface cannot silently outrun the checked selector authority',
  );
  const futurePolicy = structuredClone(pathPolicy);
  futurePolicy.requiredSurfacePaths.push(
    'demos/future-demo/snapback/**',
    'demos/future-demo/surfaces/web/**',
  );
  assert.doesNotThrow(
    () => validateRequiredSurfaceBuildPathPolicy(futurePolicy, { surfaces: futureSurfaces }),
    'adding the exact future backend and surface roots closes selector coverage',
  );
  assert.equal(
    selection(['demos/future-demo/demo.snapback.json'])[0].selected,
    true,
    'every demo manifest selects the introduction or reclassification of a required surface',
  );

  const missingDemoDir = join(scratch, 'missing-package-demos', 'fixture');
  mkdirSync(missingDemoDir, { recursive: true });
  writeFileSync(join(missingDemoDir, 'demo.snapback.json'), JSON.stringify({
    surfaces: {
      contract: { requirement: 'required', buildTargets: ['web'], devServer: 'bun run dev' },
    },
  }));
  const [missingPackage] = collectRequiredWebSurfaces({
    demosDir: join(scratch, 'missing-package-demos'),
  }).map(classifyRequiredWebSurface);
  assert.equal(missingPackage?.demoId, 'fixture');
  assert.equal(missingPackage?.surfaceName, 'contract');
  assert.equal(missingPackage?.hasPackage, false, 'a missing package stays in the required inventory');
  assert.match(
    requiredSurfaceStructuralErrors(missingPackage)[0],
    /^fixture\/contract:/,
    'structural failures identify the required surface',
  );

  const missingLockDir = join(scratch, 'missing-lock-demos', 'fixture', 'surfaces', 'contract');
  mkdirSync(missingLockDir, { recursive: true });
  writeFileSync(join(scratch, 'missing-lock-demos', 'fixture', 'demo.snapback.json'), JSON.stringify({
    surfaces: {
      contract: { requirement: 'required', buildTargets: ['web'], devServer: 'bun run dev' },
    },
  }));
  writeFileSync(join(missingLockDir, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }));
  const [missingLock] = collectRequiredWebSurfaces({
    demosDir: join(scratch, 'missing-lock-demos'),
  }).map(classifyRequiredWebSurface);
  assert.deepEqual(
    requiredSurfaceStructuralErrors(missingLock),
    ['fixture/contract: no committed bun.lock; registry Exact consumption is not reproducibly pinned'],
    'list-mode structural validation includes lockfile failures by surface id',
  );

  const unclassifiedDemoDir = join(scratch, 'unclassified-demos', 'fixture');
  mkdirSync(unclassifiedDemoDir, { recursive: true });
  writeFileSync(join(unclassifiedDemoDir, 'demo.snapback.json'), JSON.stringify({
    surfaces: { headless: { requirement: 'required', runner: 'node test.mjs' } },
  }));
  assert.throws(
    () => collectRequiredWebSurfaces({ demosDir: join(scratch, 'unclassified-demos') }),
    /every required surface must declare `buildTargets`/,
    'required surface classification is mandatory even for non-web runners',
  );

  // The gate materializes gitignored codegen graphs for exactly the demos it
  // builds: derived from the gated surface inventory, deduplicated per demo,
  // and only where a committed review manifest exists. All Aboard's outbound
  // actions are part of its graph identity, so its flag must be set.
  const gatedBackends = collectGatedGeneratedBackends(collectRequiredWebSurfaces());
  assert.deepEqual(
    gatedBackends.map(({ demoId, outboundActions }) => `${demoId}:${outboundActions}`),
    ['all-aboard:true', 'cursors-web:false', 'pointing-room:false'],
    'gated demos with committed review manifests are materialized before their builds',
  );
  const generatedDemoDir = join(scratch, 'generated-demos', 'fixture');
  mkdirSync(join(generatedDemoDir, 'snapback', 'generated'), { recursive: true });
  writeFileSync(join(generatedDemoDir, 'demo.snapback.json'), JSON.stringify({
    surfaces: {
      contract: { requirement: 'required', buildTargets: ['web'] },
      react: { requirement: 'required', buildTargets: ['web'] },
    },
  }));
  writeFileSync(
    join(generatedDemoDir, 'snapback', 'generated', 'artifacts.json'),
    JSON.stringify({ artifactKind: 'artifactIndex' }),
  );
  const fixtureBackends = collectGatedGeneratedBackends(
    collectRequiredWebSurfaces({ demosDir: join(scratch, 'generated-demos') }),
    { demosDir: join(scratch, 'generated-demos') },
  );
  assert.equal(fixtureBackends.length, 1, 'two gated surfaces of one demo share one backend materialization');
  assert.equal(fixtureBackends[0].demoId, 'fixture');
  assert.equal(fixtureBackends[0].outboundActions, false);

  let codegenRuns = 0;
  let driftRuns = 0;
  const materialized = await materializeGeneratedBackend(fixtureBackends[0], {
    runCodegen: async () => {
      codegenRuns += 1;
      return { ok: true };
    },
    runDriftCheck: async () => {
      driftRuns += 1;
      return { ok: true };
    },
  });
  assert.equal(materialized.ok, true);
  assert.equal(codegenRuns, 1);
  assert.equal(driftRuns, 1, 'a fresh graph is still checked against the committed review manifest');

  const staleManifest = await materializeGeneratedBackend(fixtureBackends[0], {
    runCodegen: async () => ({ ok: true }),
    runDriftCheck: async () => ({ ok: false, reason: 'exited 1; process tree terminated' }),
  });
  assert.equal(staleManifest.ok, false);
  assert.match(staleManifest.reason, /committed review manifest is stale/);
  assert.match(staleManifest.reason, /commit .*artifacts\.json/);

  let driftAfterFailure = 0;
  const failedCodegen = await materializeGeneratedBackend(fixtureBackends[0], {
    runCodegen: async () => ({ ok: false, reason: 'exited 1; process tree terminated' }),
    runDriftCheck: async () => {
      driftAfterFailure += 1;
      return { ok: true };
    },
  });
  assert.equal(failedCodegen.ok, false);
  assert.match(failedCodegen.reason, /codegen materialization failed/);
  assert.equal(driftAfterFailure, 0, 'a failed codegen never consults the drift check');

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

  let workspaceFrozenRuns = 0;
  const workspaceInstalled = await ensureWorkspaceInstall({
    runInstall: async () => {
      workspaceFrozenRuns += 1;
      return { ok: true, output: 'workspace cache verified' };
    },
  });
  assert.equal(workspaceInstalled.ok, true);
  assert.equal(workspaceFrozenRuns, 1, 'clean surface builds prepare the root workspace once');

  const workspaceFailure = await ensureWorkspaceInstall({
    runInstall: async () => ({
      ok: false,
      reason: 'exited 9; process tree terminated',
      output: 'frozen lock mismatch',
    }),
  });
  assert.equal(workspaceFailure.ok, false);
  assert.match(workspaceFailure.reason, /root workspace frozen install failed/);
  assert.match(workspaceFailure.reason, /frozen lock mismatch/);

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

  // A cleanup seam is injectable for platform simulations and tests. If that
  // promise rejects, the gate must normalize the rejection into a bounded
  // cleanup failure; it must not throw from its catch handler and strand the
  // caller's runBoundedProcess promise (ENG-24378 follow-up).
  const rejectingLeader = new EventEmitter();
  rejectingLeader.pid = 4139;
  rejectingLeader.exitCode = null;
  rejectingLeader.signalCode = null;
  rejectingLeader.stdout = new PassThrough();
  rejectingLeader.stderr = new PassThrough();
  rejectingLeader.kill = () => false;
  const rejectingSignals = [];
  let rejectionDeadline;
  const rejectingCleanup = await Promise.race([
    runBoundedProcess('fake-rejecting-cleanup', [], {
      cwd: scratch,
      timeoutMs: 5,
      killGraceMs: 5,
      inheritOutput: false,
      spawnImpl: () => rejectingLeader,
      signalTree: async (_child, signal) => {
        rejectingSignals.push(signal);
        throw new Error('injected cleanup rejection');
      },
    }),
    new Promise((_, reject) => {
      rejectionDeadline = setTimeout(
        () => reject(new Error('rejecting cleanup did not settle within 500ms')),
        500,
      );
    }),
  ]).finally(() => clearTimeout(rejectionDeadline));
  assert.equal(rejectingCleanup.ok, false);
  assert.equal(rejectingCleanup.timedOut, true);
  assert.deepEqual(rejectingSignals, ['SIGTERM', 'SIGKILL']);
  assert.equal(rejectingCleanup.cleanup?.mechanism, 'cleanup-seam');
  assert.equal(rejectingCleanup.cleanup?.error, 'injected cleanup rejection');
  assert.match(rejectingCleanup.reason, /cleanup not attested \(injected cleanup rejection\)/);

  if (process.platform !== 'win32') {
    let exitProbes = 0;
    const attestedCleanup = await signalProcessTree({ pid: 4141 }, 'SIGKILL', {
      processGroupTimeoutMs: 100,
      processGroupPollMs: 1,
      processKill: (_pid, signal) => {
        if (signal === 'SIGKILL') return;
        exitProbes += 1;
        if (exitProbes < 3) return;
        throw Object.assign(new Error('group gone'), { code: 'ESRCH' });
      },
    });
    assert.equal(attestedCleanup.ok, true);
    assert.equal(attestedCleanup.exitAttested, true);
    assert.equal(exitProbes, 3, 'SIGKILL cleanup waits for an ESRCH group probe');

    const unattestedCleanup = await signalProcessTree({ pid: 4241 }, 'SIGKILL', {
      processGroupTimeoutMs: 5,
      processGroupPollMs: 1,
      processKill: () => {},
    });
    assert.equal(unattestedCleanup.ok, false);
    assert.equal(unattestedCleanup.timedOut, true);
    assert.match(unattestedCleanup.error, /process group still existed/);

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
    assert.equal(nonzeroTree.cleanup?.leaderClosed, true);
    const nonzeroGrandchildPid = Number(/nonzero-grandchild:(\d+)/.exec(nonzeroTree.output)?.[1]);
    assert(Number.isInteger(nonzeroGrandchildPid), `missing nonzero grandchild pid in ${nonzeroTree.output}`);
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
  assert.equal(windowsCleanup.result.cleanup?.leaderClosed, true);
  assert.match(windowsCleanup.result.reason, /process tree terminated/);

  const windowsCleanupFailure = await fakeWindowsRun(5);
  assert.equal(windowsCleanupFailure.taskkillCompleted, true, 'failed taskkill is still awaited');
  assert.equal(windowsCleanupFailure.result.cleanup?.ok, false);
  assert.equal(windowsCleanupFailure.result.cleanup?.code, 5);
  assert.match(windowsCleanupFailure.result.reason, /cleanup not attested.*taskkill exited 5/);

  const unclosedWindowsLeader = new EventEmitter();
  unclosedWindowsLeader.pid = 4292;
  unclosedWindowsLeader.exitCode = null;
  unclosedWindowsLeader.stdout = new PassThrough();
  unclosedWindowsLeader.stderr = new PassThrough();
  unclosedWindowsLeader.kill = () => true;
  const unclosedWindowsSpawn = (command) => {
    if (command !== 'taskkill') {
      queueMicrotask(() => unclosedWindowsLeader.emit('error', new Error('leader spawn failure')));
      return unclosedWindowsLeader;
    }
    const killer = new EventEmitter();
    killer.kill = () => true;
    setTimeout(() => killer.emit('close', 0, null), 1);
    return killer;
  };
  const unclosedWindowsResult = await runBoundedProcess('fake-unclosed-command', [], {
    cwd: scratch,
    timeoutMs: 1_000,
    inheritOutput: false,
    platform: 'win32',
    spawnImpl: unclosedWindowsSpawn,
    taskkillTimeoutMs: 100,
    leaderCloseTimeoutMs: 5,
  });
  assert.equal(unclosedWindowsResult.cleanup?.ok, false);
  assert.equal(unclosedWindowsResult.cleanup?.leaderClosed, false);
  assert.match(unclosedWindowsResult.reason, /cleanup not attested.*leader close was not observed/);

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
