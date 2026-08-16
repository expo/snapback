import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { startBackend } from './backend.mjs';
import { createDirector } from './director.mjs';
import { EvidenceWriter, scanEvidenceForLeaks } from './evidence.mjs';
import {
  gitWorktreeIdentity,
  harnessFileDigests,
  matchingPriorBuildReceipt,
  resolvedInstalledVersions,
  runtimeBinaryIdentity,
  sha256File,
} from './integrity.mjs';
import { delay, run } from './process.mjs';

const SINGLE_RUNTIME_REFUSAL = 'SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED';
const CORRUPTION_REFUSALS = new Set(['SNAPBACK_AUTH_CUSTODY_CORRUPT']);
const IOS_REINSTALL_REFUSALS = new Set([
  'SNAPBACK_AUTH_CUSTODY_CORRUPT',
  'SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED',
  'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE',
]);

function publicFailure(error) {
  const code = error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_NATIVE_PROBE_HARNESS_FAILED';
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    ...(Array.isArray(error?.attempts) ? { attempts: error.attempts } : {}),
  };
}

function assertProbe(condition, probe, message, observed = null) {
  if (condition) return;
  throw Object.assign(new Error(`${probe}: ${message}`), {
    code: 'SNAPBACK_NATIVE_PROBE_ASSERTION_FAILED',
    observed,
  });
}

function sameCustody(left, right) {
  return left?.revision === right?.revision
    && left?.epoch === right?.epoch
    && left?.bearerSha256 === right?.bearerSha256
    && left?.phase === right?.phase
    && left?.principalId === right?.principalId;
}

function storageCounterDelta(before, after) {
  return Object.fromEntries(['platformGradeCalls', 'ownershipCalls', 'readCalls', 'replaceCalls', 'total']
    .map((key) => [key, (after?.[key] ?? 0) - (before?.[key] ?? 0)]));
}

function p2Tuple({ facts, principal, credentialEntryCalls, protectedRead }) {
  return Object.freeze({
    revision: facts?.revision ?? null,
    bearerSha256: facts?.bearerSha256 ?? null,
    epoch: facts?.epoch ?? null,
    phase: facts?.phase ?? null,
    custodyPrincipalId: facts?.principalId ?? null,
    principalStatus: principal?.status ?? null,
    userId: principal?.userId ?? null,
    credentialEntryCalls,
    protectedReadStatus: protectedRead?.status ?? null,
    protectedReadRowCount: protectedRead?.rowCount ?? null,
  });
}

export async function runNativeCustodyHarness({
  platform,
  options,
  createDevice,
  harnessFile,
}) {
  const repoRoot = resolve(harnessFile, '..', '..', '..');
  const demoRoot = join(repoRoot, 'demos', 'native-custody-probes');
  const appRoot = join(demoRoot, 'app');
  const evidenceRoot = join(demoRoot, 'evidence');
  const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
  const gitIdentity = gitWorktreeIdentity(repoRoot);
  const writer = new EvidenceWriter({
    root: evidenceRoot,
    platform,
    metadata: {
      harness: `${platform}:${options.iterations} interruption iterations`,
      appPackage: `${packageJson.name}@${packageJson.version}`,
      worktree: gitIdentity,
      harnessFileDigests: harnessFileDigests(repoRoot),
      screenshotVerification: 'structural app-rendered text; OCR out of scope',
      custodyModule: 'pending first bootstrap',
    },
  });
  const portOwnerRoot = join(
    demoRoot, '.snapback', `native-custody-${platform}`, 'ports',
  );
  const director = createDirector({
    port: options.directorPort,
    ownerFile: join(portOwnerRoot, `director-${options.directorPort}.json`),
  });
  const cleanup = [];
  let device = null;
  let backend = null;
  let failureProbe = null;
  let overallVerdict = 'FAIL';
  let terminalError = null;
  let p4IosIncomplete = false;
  let p2MissingClasses = [];
  let successfulProbeFlow = false;
  const email = options.email ?? `custody-${Date.now()}@example.test`;
  const password = options.password ?? `Ncp-${randomUUID()}-Aa1!`;

  const step = async (probe, name, expected, operation, validate = () => true, verdict = 'PASS') => {
    const started = Date.now();
    try {
      const observed = await operation();
      assertProbe(validate(observed), probe, `${name} did not meet its expectation`, observed);
      writer.record(probe, name, {
        expected,
        observed,
        verdict,
        durationMs: Date.now() - started,
      });
      return observed;
    } catch (error) {
      failureProbe = `${probe}/${name}`;
      writer.record(probe, name, {
        expected,
        observed: publicFailure(error),
        verdict: 'FAIL',
        durationMs: Date.now() - started,
      });
      throw error;
    }
  };

  const command = async (name, args = {}, timeoutMs = 60_000) => {
    const envelope = await director.sendCommand(name, args, timeoutMs);
    if (envelope.ok !== true) {
      throw Object.assign(new Error(envelope.error?.message ?? `${name} failed in the app`), {
        code: envelope.error?.code ?? 'SNAPBACK_NATIVE_PROBE_APP_COMMAND_FAILED',
      });
    }
    return envelope.result;
  };
  const launch = async () => {
    const startIndex = director.events.length;
    await device.launch(options.directorPort);
    return director.waitEvent(
      (event) => event.event === 'witness-ready',
      startIndex,
      60_000,
    );
  };
  const relaunchAndBootstrap = async () => {
    const ready = await launch();
    const boot = await command('bootstrap', { mode: 'native' }, 90_000);
    return { ready, boot };
  };
  const captureMilestone = async ({ probe, name, facts, principalId, ready, file }) => step(
    probe,
    name,
    {
      milestone: name,
      launchId: ready.launchId,
      custodyRevision: facts?.revision ?? null,
      bearerSha256Prefix: typeof facts?.bearerSha256 === 'string'
        ? facts.bearerSha256.slice(0, 8)
        : 'none',
      principalId,
      format: 'png',
    },
    async () => {
      const rendered = await command('renderMilestone', { name });
      const path = writer.pathFor(file);
      await device.screenshot(path);
      return Object.freeze({ rendered, file });
    },
    (value) => value.rendered?.name === name
      && value.rendered?.launchId === ready.launchId
      && value.rendered?.custodyRevision === (facts?.revision ?? null)
      && value.rendered?.bearerSha256Prefix === (
        typeof facts?.bearerSha256 === 'string' ? facts.bearerSha256.slice(0, 8) : 'none'
      )
      && value.rendered?.principalId === principalId,
  );

  try {
    const runtimeIdentity = runtimeBinaryIdentity(process.env.SNAPBACK_RUNTIME_BINARY);
    writer.setMetadata({ runtimeBinary: runtimeIdentity });

    await director.listen();
    cleanup.push(() => director.close());
    backend = await startBackend({
      repoRoot,
      demoRoot,
      platform,
      serverPort: options.serverPort,
      logPath: writer.pathFor('backend.log'),
    });
    cleanup.push(() => backend.close());
    assertProbe(
      backend.descriptor.authBootstrap?.format === 'snapback.application-auth-bootstrap.v1',
      'P0',
      'generated descriptor did not carry the application auth bootstrap policy',
      backend.descriptor.authBootstrap,
    );

    await run('probe app dependency install', 'bun', ['install'], {
      cwd: appRoot,
      timeoutMs: 10 * 60_000,
    });
    const installedVersions = resolvedInstalledVersions(
      appRoot,
      Object.keys(packageJson.dependencies),
    );
    writer.setMetadata({
      resolvedInstalledPackageVersions: installedVersions,
      custodyModulePackageVersion: installedVersions['@expo/snapback-expo-custody']?.version ?? null,
    });

    device = await createDevice({ appRoot, evidence: writer, options });
    cleanup.push(() => device.cleanup());
    const artifact = device.artifact();
    if (!existsSync(artifact.binaryPath)) {
      throw new Error(`P0/artifact-integrity: built artifact binary is missing at ${artifact.binaryPath}`);
    }
    const artifactSha256 = artifact.sha256 ?? `sha256:${sha256File(artifact.binaryPath)}`;
    const artifactBundleId = artifact.bundleId ?? options.bundleId;
    let reusedFrom = null;
    if (options.skipBuild) {
      reusedFrom = matchingPriorBuildReceipt({
        evidenceRoot,
        currentRunDirectory: writer.directory,
        platform,
        bundleId: artifactBundleId,
        artifactSha256,
      });
      if (reusedFrom === null) {
        throw new Error(
          `P0/skip-build: no prior build receipt matches on-disk artifact ${artifactSha256}`,
        );
      }
    }
    const buildReceipt = Object.freeze({
      schemaVersion: 'snapback.native-custody-build.v1',
      runId: writer.runId,
      platform,
      bundleId: artifactBundleId,
      buildMode: options.skipBuild ? 'verified-reuse' : 'built-this-run',
      artifact: Object.freeze({ ...artifact, sha256: artifactSha256 }),
      reusedFrom,
      createdAt: new Date().toISOString(),
    });
    writer.writeArtifact('build-receipt.json', `${JSON.stringify(buildReceipt, null, 2)}\n`);
    writer.setMetadata({ artifact: buildReceipt.artifact, skipBuildEvidence: reusedFrom });

    writer.setMetadata(await device.metadata());
    writer.setMetadata({
      backendOrigin: backend.ready.serverUrl,
      descriptorIdentity: backend.descriptor.identity.descriptor,
      bootstrapCapabilityOptIn: 'provider-layer (codegen has no source declaration in this revision)',
      bundleId: artifactBundleId,
      claims: platform === 'android'
        ? ['P2 classified SIGKILL old-or-new restoration (coverage gated)', 'uninstall-clears-data']
        : ['P2 classified SIGKILL old-or-new restoration (coverage gated)', 'keychain uninstall residue handling'],
      notClaimed: platform === 'android'
        ? [
            'force-stop-mid-write (LLP 0263 A-3)',
            'backup/restore via bmgr (LLP 0263 A-9)',
            'device-to-device transfer',
          ]
        : ['physical-device lock state', 'backup/restore', 'device-to-device transfer'],
    });
    director.setConfig(Object.freeze({
      binding: backend.binding({
        origin: device.origin(options.serverPort),
        routing: device.routing,
      }),
    }));

    await step('P1', 'fresh install', { appData: 'absent', custody: 'fresh precondition' }, async () => {
      await device.installFresh();
      return { installed: true };
    });
    const firstReady = await step(
      'P1',
      'launch witness',
      { event: 'witness-ready' },
      launch,
      (value) => value.event === 'witness-ready',
    );
    const initialBoot = await step(
      'P1',
      'fresh bootstrap',
      { status: 'ready', principal: 'anonymous', credentialEntryCalls: 0, phase: 'settled' },
      () => command('bootstrap', { mode: 'native' }, 90_000),
      (value) => value.status === 'ready'
        && value.principal?.status === 'anonymous'
        && value.credentialEntryCalls === 0
        && value.custodyFacts?.phase === 'settled',
    );
    writer.setMetadata({ custodyModule: initialBoot.custodyFacts?.platformGrade ?? 'not projected' });
    await step(
      'P1', 'password signup',
      { principal: 'authenticated', recoveryCodeProjection: 'count only' },
      () => command('signup', { email, password }, 90_000),
      (value) => value.principal?.status === 'authenticated'
        && Number.isSafeInteger(value.recoveryCodeCount)
        && value.recoveryCodeCount > 0,
    );
    await step(
      'P1', 'settle anonymous before explicit signin',
      { principal: 'anonymous' },
      () => command('signout'),
      (value) => value.principal?.status === 'anonymous',
    );
    const signIn = await step(
      'P1', 'password signin',
      { principal: 'authenticated' },
      () => command('signin', { email, password }, 90_000),
      (value) => value.principal?.status === 'authenticated',
    );
    await step(
      'P1', 'protected read before kill',
      { status: 'ready', rowCountAtLeast: 1 },
      () => command('protectedRead', {}, 90_000),
      (value) => value.status === 'ready' && value.rowCount >= 1,
    );
    const beforeKill = await step(
      'P1', 'custody facts before kill',
      {
        revision: 'integer',
        epoch: 'integer',
        phase: 'settled',
        bearerSha256: 'sha256',
        principalId: signIn.principal.userId,
      },
      () => command('custodyFacts'),
      (value) => Number.isSafeInteger(value.revision)
        && Number.isSafeInteger(value.epoch)
        && value.phase === 'settled'
        && value.principalId === signIn.principal.userId
        && /^[a-f0-9]{64}$/u.test(value.bearerSha256),
    );
    await captureMilestone({
      probe: 'P1',
      name: 'authenticated-before-kill',
      facts: beforeKill,
      principalId: signIn.principal.userId,
      ready: firstReady,
      file: 'p1-authenticated.png',
    });
    await step(
      'P1',
      'hard process kill',
      { mechanism: platform === 'ios' ? 'verified SIGKILL' : 'am force-stop' },
      () => device.kill(),
      (value) => value.verifiedGone === true,
    );
    const restored = await step(
      'P1', 'cold relaunch bootstrap',
      {
        principal: signIn.principal.userId,
        sameFullCustodyIdentity: true,
        credentialEntryCalls: 0,
        phase: 'settled',
      },
      relaunchAndBootstrap,
      (value) => value.boot.status === 'ready'
        && value.boot.principal?.status === 'authenticated'
        && value.boot.principal.userId === signIn.principal.userId
        && value.boot.credentialEntryCalls === 0
        && sameCustody(beforeKill, value.boot.custodyFacts),
    );
    await step(
      'P1', 'protected read after restoration',
      { status: 'ready', rowCountAtLeast: 1 },
      () => command('protectedRead', {}, 90_000),
      (value) => value.status === 'ready' && value.rowCount >= 1,
    );
    await captureMilestone({
      probe: 'P1',
      name: 'restored-after-cold-kill',
      facts: restored.boot.custodyFacts,
      principalId: restored.boot.principal.userId,
      ready: restored.ready,
      file: 'p1-restored.png',
    });

    let latestFacts = restored.boot.custodyFacts;
    let activeReady = restored.ready;
    const p2Classifications = new Set();
    // @ref LLP 0263#5-probe-checklists — an entered pulse precedes native
    // replace; a completion pulse follows it. The host arms first, skips
    // already-completed sequences, and kills on the first unmatched entered
    // predecessor/successor pair.
    for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
      let nextReady = null;
      let nextFacts = null;
      const iterationEvidence = await step(
        'P2', `kill-mid-write iteration ${iteration}`,
        {
          signal: 'first unmatched write-entered after host arm; completed sequences skipped',
          restoration: [
            'interrupted-before-commit (restored predecessor)',
            'committed-before-restore (restored successor)',
          ],
          identity: {
            bearerSha256: latestFacts.bearerSha256,
            epoch: latestFacts.epoch,
            principalId: signIn.principal.userId,
            phase: 'settled',
            credentialEntryCalls: 0,
            protectedRead: 'ready',
          },
        },
        async () => {
          const eventStart = director.events.length;
          const armedAt = new Date().toISOString();
          const activeLaunchId = activeReady.launchId;
          const loop = await command('tightWriteLoop');
          const selectionDeadline = Date.now() + 30_000;
          const skippedCompleted = new Set();
          const waitForFirstUnmatched = async () => {
            for (;;) {
              const scoped = director.events.slice(eventStart).filter(
                (event) => event.launchId === activeLaunchId
                  && event.details?.loopId === loop.loopId,
              );
              const failures = scoped.filter((event) => event.event === 'tight-write-failed');
              assertProbe(
                failures.length === 0,
                'P2',
                'tight-write-failed arrived instead of a write heartbeat',
                failures,
              );
              const completed = new Set(scoped.filter(
                (event) => event.event === 'write-completed',
              ).map((event) => event.details.sequence));
              const entered = scoped.filter((event) => event.event === 'write-entered');
              for (const event of entered) {
                if (completed.has(event.details.sequence)) {
                  skippedCompleted.add(event.details.sequence);
                } else {
                  return event;
                }
              }
              const waitStart = director.events.length;
              const remaining = selectionDeadline - Date.now();
              assertProbe(remaining > 0, 'P2', 'write heartbeat silence after arming');
              await director.waitEvent(
                (event) => event.launchId === activeLaunchId
                  && event.details?.loopId === loop.loopId
                  && ['write-entered', 'write-completed', 'tight-write-failed'].includes(event.event),
                waitStart,
                remaining,
              );
            }
          };
          let pulse = await waitForFirstUnmatched();
          let completedBeforeKill = director.events.slice(eventStart).filter(
            (event) => event.event === 'write-completed'
              && event.launchId === activeLaunchId
              && event.details?.loopId === loop.loopId,
          ).map((event) => event.details.sequence);
          while (completedBeforeKill.includes(pulse.details.sequence)) {
            skippedCompleted.add(pulse.details.sequence);
            pulse = await waitForFirstUnmatched();
            completedBeforeKill = director.events.slice(eventStart).filter(
              (event) => event.event === 'write-completed'
                && event.launchId === activeLaunchId
                && event.details?.loopId === loop.loopId,
            ).map((event) => event.details.sequence);
          }
          const targetSequence = pulse.details.sequence;
          const killDispatchedAt = new Date().toISOString();
          const kill = await device.kill({ midWrite: true });
          await delay(200);
          const writeEvents = director.events.slice(eventStart).filter(
            (event) => event.launchId === activeLaunchId
              && event.details?.loopId === loop.loopId,
          );
          const failures = writeEvents.filter((event) => event.event === 'tight-write-failed');
          assertProbe(failures.length === 0, 'P2', 'tight-write loop reported failure', failures);
          const entered = writeEvents.filter((event) => event.event === 'write-entered');
          const completed = writeEvents.filter((event) => event.event === 'write-completed');
          const target = pulse.details;
          assertProbe(
            Number.isSafeInteger(target.sequence)
              && Number.isSafeInteger(target.predecessorRevision)
              && Number.isSafeInteger(target.successorRevision)
              && target.successorRevision === target.predecessorRevision + 1,
            'P2',
            'selected entered write did not carry an exact revision pair',
            target,
          );
          assertProbe(
            target.phase === 'settled'
              && target.bearerSha256 === latestFacts.bearerSha256
              && target.epoch === latestFacts.epoch
              && target.principalId === signIn.principal.userId,
            'P2',
            'selected entered write changed the pre-kill custody identity',
            { prior: latestFacts, selected: target },
          );

          const next = await relaunchAndBootstrap();
          const facts = await command('custodyFacts');
          const protectedRead = await command('protectedRead', {}, 90_000);
          nextReady = next.ready;
          nextFacts = facts;
          const expectedTuple = Object.freeze({
            revision: [target.predecessorRevision, target.successorRevision],
            bearerSha256: target.bearerSha256,
            epoch: target.epoch,
            phase: 'settled',
            custodyPrincipalId: target.principalId,
            principalStatus: 'authenticated',
            userId: signIn.principal.userId,
            credentialEntryCalls: 0,
            protectedReadStatus: 'ready',
            protectedReadRowCountAtLeast: 1,
          });
          const observedTuple = p2Tuple({
            facts,
            principal: next.boot.principal,
            credentialEntryCalls: next.boot.credentialEntryCalls,
            protectedRead,
          });
          const classification = observedTuple.revision === target.predecessorRevision
            ? 'interrupted-before-commit'
            : observedTuple.revision === target.successorRevision
              ? 'committed-before-restore'
              : null;
          return Object.freeze({
            arm: { eventIndex: eventStart, armedAt, launchId: activeLaunchId, loopId: loop.loopId },
            kill: { dispatchedAt: killDispatchedAt, ...kill },
            writeWindow: {
              killTargetEnteredSequence: targetSequence,
              skippedCompletedSequences: [...skippedCompleted],
              completedBeforeKill,
              enteredSequencesAroundKill: entered.map((event) => event.details.sequence),
              completedSequencesAroundKill: completed.map((event) => event.details.sequence),
              selectedEntered: target,
            },
            classification,
            expectedTuple,
            observedTuple,
            bootstrapStatus: next.boot.status,
          });
        },
        (value) => {
          const expected = value.expectedTuple;
          const observed = value.observedTuple;
          return value.bootstrapStatus === 'ready'
            && value.classification !== null
            && expected.revision.includes(observed.revision)
            && observed.bearerSha256 === expected.bearerSha256
            && observed.epoch === expected.epoch
            && observed.phase === 'settled'
            && observed.custodyPrincipalId === expected.custodyPrincipalId
            && observed.principalStatus === 'authenticated'
            && observed.userId === expected.userId
            && observed.credentialEntryCalls === 0
            && observed.protectedReadStatus === 'ready'
            && observed.protectedReadRowCount >= 1;
        },
      );
      p2Classifications.add(iterationEvidence.classification);
      latestFacts = nextFacts;
      activeReady = nextReady;
    }
    const requiredP2Classes = [
      'interrupted-before-commit',
      'committed-before-restore',
    ];
    p2MissingClasses = requiredP2Classes.filter((entry) => !p2Classifications.has(entry));
    writer.record('P2', 'classified outcome family coverage', {
      expected: { required: requiredP2Classes },
      observed: {
        observed: [...p2Classifications],
        missing: p2MissingClasses,
        iterations: options.iterations,
      },
      verdict: p2MissingClasses.length === 0 ? 'PASS' : 'INCOMPLETE',
    });
    writer.setMetadata({
      p2ReceiptClaim: p2MissingClasses.length === 0
        ? 'SIGKILL old-or-new restoration observed both interrupted-before-commit and committed-before-restore'
        : `INCOMPLETE: P2 did not observe ${p2MissingClasses.join(', ')}`,
    });

    await step(
      'P3', 'interleaved native CAS',
      { oneWinnerPerIteration: true, conflict: 'SNAPBACK_AUTH_CUSTODY_CAS_STALE' },
      () => command('casProbe', { iterations: 8 }, 120_000),
      (value) => value.monotonic === true
        && value.outcomes?.every((entry) => entry.winners === 1
          && entry.conflicts?.length === 1
          && entry.conflicts[0] === 'SNAPBACK_AUTH_CUSTODY_CAS_STALE'),
    );
    await step(
      'P3', 'stale revision refusal',
      { diagnostic: 'SNAPBACK_AUTH_CUSTODY_CAS_STALE' },
      () => command('staleCasProbe'),
      (value) => value.staleDiagnostic === 'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
    );

    const preP4 = await step(
      'P4',
      'capture admitted custody before refusal',
      { principal: signIn.principal.userId, phase: 'settled', credentialEntryCalls: 0 },
      () => command('probeState'),
      (value) => value.principal?.status === 'authenticated'
        && value.principal.userId === signIn.principal.userId
        && value.custodyFacts?.phase === 'settled'
        && value.custodyFacts?.principalId === signIn.principal.userId
        && value.credentialEntryCalls === 0,
    );
    const ordinary = await step(
      'P4',
      'ordinary capability boundary',
      {
        status: 'unsupported',
        credentialEntryCallsDelta: 0,
        custodyStorageOperationDelta: 0,
      },
      async () => {
        const before = await command('probeCounters');
        const boot = await command('bootstrap', { mode: 'ordinary' }, 90_000);
        const after = await command('probeCounters');
        return Object.freeze({
          boot,
          before,
          after,
          storageDelta: storageCounterDelta(before.storageCounters, after.storageCounters),
          credentialEntryCallsDelta: after.credentialEntryCalls - before.credentialEntryCalls,
        });
      },
      (value) => ['unsupported', 'blocked', 'error'].includes(value.boot.status)
        && [
          'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE',
          'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED',
        ].includes(value.boot.diagnostic?.code)
        && value.credentialEntryCallsDelta === 0
        && Object.values(value.storageDelta).every((count) => count === 0),
    );
    await step(
      'P4',
      'restore admitted native platform after refusal',
      {
        sameCustody: preP4.custodyFacts,
        sameUserId: signIn.principal.userId,
        credentialEntryCalls: 0,
      },
      () => command('bootstrap', { mode: 'native' }, 90_000),
      (value) => value.status === 'ready'
        && value.principal?.status === 'authenticated'
        && value.principal.userId === signIn.principal.userId
        && value.credentialEntryCalls === 0
        && sameCustody(preP4.custodyFacts, value.custodyFacts),
    );
    assertProbe(
      ordinary.after.credentialEntryCalls === 0,
      'P4',
      'ordinary refusal changed the process credential-entry count',
      ordinary,
    );

    if (platform === 'android') {
      await step(
        'P4', 'secondary-process refusal',
        {
          attempted: true,
          ioOccurred: false,
          processName: `${artifactBundleId}:probe`,
          diagnostic: { code: SINGLE_RUNTIME_REFUSAL, reason: 'secondary-process' },
          distinctHostObservedPids: true,
        },
        async () => {
          const appResult = await command('refusalProbe', {}, 60_000);
          const processes = await device.observeSecondaryProcess(appResult.servicePid);
          return Object.freeze({ ...appResult, hostProcesses: processes });
        },
        (value) => value.attempted === true
          && value.ioOccurred === false
          && value.processName === `${artifactBundleId}:probe`
          && Number.isSafeInteger(value.servicePid)
          && value.diagnostic?.code === SINGLE_RUNTIME_REFUSAL
          && value.diagnostic?.reason === 'secondary-process'
          && value.hostProcesses?.service?.pid === value.servicePid
          && value.hostProcesses?.service?.pid !== value.hostProcesses?.main?.pid,
      );
    } else if (options.iosExtensionEvidence !== null) {
      const extensionResult = await step(
        'P4', 'extension refusal with supervisor evidence',
        { diagnostic: SINGLE_RUNTIME_REFUSAL, externalEvidenceSha256: 'sha256' },
        async () => {
          const supplied = readFileSync(options.iosExtensionEvidence);
          assertProbe(
            supplied.includes(Buffer.from(SINGLE_RUNTIME_REFUSAL)),
            'P4',
            'supervisor-supplied iOS extension evidence lacks the exact refusal code',
          );
          const copied = writer.writeArtifact('ios-extension-evidence.txt', supplied);
          const external = Object.freeze({
            suppliedPath: options.iosExtensionEvidence,
            copiedFile: 'ios-extension-evidence.txt',
            sha256: `sha256:${sha256File(copied)}`,
          });
          return { appFallback: await command('refusalProbe'), external };
        },
        (value) => value.appFallback?.diagnostic?.code
            === 'SNAPBACK_AUTH_CUSTODY_EXTENSION_NATIVE_UNIT_FALLBACK_REQUIRED'
          && /^sha256:[a-f0-9]{64}$/u.test(value.external.sha256),
      );
      writer.setMetadata({ iosExtensionEvidence: extensionResult.external });
    } else {
      p4IosIncomplete = true;
      await step(
        'P4', 'extension refusal not exercised',
        { nativeExtensionEvidence: 'required for PASS' },
        () => command('refusalProbe'),
        (value) => value.attempted === false
          && value.diagnostic?.code
            === 'SNAPBACK_AUTH_CUSTODY_EXTENSION_NATIVE_UNIT_FALLBACK_REQUIRED',
        'INCOMPLETE',
      );
    }

    if (platform === 'android') {
      // @ref LLP 0263#5-probe-checklists — the corruption and uninstall arms
      // are separate. This arm accepts only the custody package's exact
      // corruption code and claims uninstall-clears-data, not bmgr restore.
      await step(
        'P5', 'ciphertext corruption and AEAD refusal',
        {
          mechanism: 'persisted-aead-byte-flip-datastore-reopen',
          decryptPath: 'AEADBadTagException-to-corrupt',
          readAccepted: false,
          diagnosticAllowlist: [...CORRUPTION_REFUSALS],
        },
        () => command('corruptionProbe'),
        (value) => value.supported === true
          && value.mechanism === 'persisted-aead-byte-flip-datastore-reopen'
          && value.readAccepted === false
          && CORRUPTION_REFUSALS.has(value.diagnostic?.code),
      );
      await step('P5', 'uninstall and install APK', { claim: 'uninstall-clears-data' }, async () => {
        await device.reinstallPreservingOsCustody();
        return { installed: true, backupRestoreClaimed: false };
      });
      const reinstalled = await step(
        'P5', 'uninstall and reinstall',
        { principal: 'anonymous', custody: 'fresh and sane', backupRestore: 'not-claimed' },
        relaunchAndBootstrap,
        (value) => value.boot.status === 'ready'
          && value.boot.principal?.status === 'anonymous'
          && value.boot.custodyFacts?.phase === 'settled'
          && value.boot.credentialEntryCalls === 0,
      );
      latestFacts = reinstalled.boot.custodyFacts;
      activeReady = reinstalled.ready;
      await captureMilestone({
        probe: 'P5',
        name: 'android-uninstall-clears-data',
        facts: latestFacts,
        principalId: 'anonymous',
        ready: activeReady,
        file: 'p5-reinstall.png',
      });
    } else {
      const priorPrincipal = signIn.principal.userId;
      const factsBeforeReinstall = await step(
        'P5', 'custody facts before keychain reinstall probe',
        { revision: 'integer', bearerSha256: 'sha256', phase: 'settled' },
        () => command('custodyFacts'),
        (value) => Number.isSafeInteger(value.revision)
          && value.phase === 'settled'
          && /^[a-f0-9]{64}$/u.test(value.bearerSha256),
      );
      await step('P5', 'uninstall and install app bundle', { keychain: 'preserved' }, async () => {
        await device.reinstallPreservingOsCustody();
        return { installed: true };
      });
      const reinstalled = await step(
        'P5', 'uninstall and reinstall with keychain residue',
        { outcome: 'valid exact adoption or exact typed custody refusal' },
        relaunchAndBootstrap,
        (value) => (
          value.boot.status === 'ready'
          && value.boot.principal?.status === 'authenticated'
          && value.boot.principal.userId === priorPrincipal
          && value.boot.credentialEntryCalls === 0
          && sameCustody(factsBeforeReinstall, value.boot.custodyFacts)
        ) || (
          value.boot.status !== 'ready'
          && IOS_REINSTALL_REFUSALS.has(value.boot.diagnostic?.code)
        ),
      );
      latestFacts = reinstalled.boot.custodyFacts ?? null;
      activeReady = reinstalled.ready;
      await captureMilestone({
        probe: 'P5',
        name: 'ios-keychain-reinstall-result',
        facts: latestFacts,
        principalId: reinstalled.boot.principal?.status === 'authenticated'
          ? reinstalled.boot.principal.userId
          : reinstalled.boot.principal?.status ?? 'unavailable',
        ready: activeReady,
        file: 'p5-reinstall.png',
      });
    }
    writer.setMetadata({ finalCustodyPublicFacts: latestFacts });
    successfulProbeFlow = true;
  } catch (error) {
    terminalError = error;
    if (failureProbe === null) {
      failureProbe = 'P0/setup';
      writer.record('P0', 'setup', {
        expected: { ready: true },
        observed: publicFailure(error),
        verdict: 'FAIL',
      });
    }
  } finally {
    if (device !== null) {
      try {
        await device.captureDeviceLogs(writer.pathFor(`${platform}-device.log`));
      } catch (error) {
        if (terminalError === null) terminalError = error;
        if (failureProbe === null) failureProbe = 'P6/device-log-capture';
        writer.record('P6', 'device log capture', {
          expected: { captured: true },
          observed: publicFailure(error),
          verdict: 'FAIL',
        });
      }
    }
    for (const dispose of cleanup.reverse()) {
      try {
        await dispose();
      } catch (error) {
        if (terminalError === null) terminalError = error;
        if (failureProbe === null) failureProbe = 'P6/cleanup';
      }
    }
    if (!existsSync(writer.pathFor('backend.log'))) {
      writer.writeArtifact('backend.log', 'Backend did not spawn; no backend output was captured.\n');
    }
    if (!existsSync(writer.pathFor('metro.log'))) {
      writer.writeArtifact('metro.log', 'Metro did not spawn; no Metro output was captured.\n');
    }
    writer.writeArtifact('director.log', director.capturedLog());

    const secretSummary = director.secretSummary();
    const secretInventoryOk = !successfulProbeFlow
      || ((secretSummary.bearer ?? 0) >= 1 && (secretSummary['recovery-code'] ?? 0) >= 1);
    writer.record('P6', 'in-memory secret inventory', {
      expected: successfulProbeFlow
        ? { password: 1, bearerAtLeast: 1, recoveryCodeAtLeast: 1 }
        : { password: 1, appSecrets: 'flow did not reach all secret producers' },
      observed: {
        password: 1,
        bearerReports: secretSummary.bearer ?? 0,
        recoveryCodeReports: secretSummary['recovery-code'] ?? 0,
        persistedByDirector: false,
      },
      verdict: secretInventoryOk ? 'PASS' : 'FAIL',
    });
    if (!secretInventoryOk && terminalError === null) {
      terminalError = new Error('P6/secret-inventory: app did not one-shot report every secret class');
      failureProbe = 'P6/in-memory-secret-inventory';
    }

    const forbiddenLiterals = [password, ...director.secretLiterals()];
    const leakage = scanEvidenceForLeaks(writer.directory, { forbiddenLiterals });
    writer.record('P6', 'complete run artifact leakage scan', {
      expected: {
        findings: 0,
        scope: 'jsonl, PNGs, build receipt, backend/director/Metro/device logs, external evidence',
      },
      observed: {
        findings: leakage.findings,
        secretLiteralCount: forbiddenLiterals.length,
        runDirectory: writer.base,
      },
      verdict: leakage.ok ? 'PASS' : 'FAIL',
    });
    if (!leakage.ok && terminalError === null) {
      terminalError = new Error(`P6/leakage-scan: ${JSON.stringify(leakage.findings)}`);
      failureProbe = 'P6/complete-run-artifact-leakage-scan';
    }

    overallVerdict = terminalError !== null
      ? 'FAIL'
      : p2MissingClasses.length > 0
        ? `INCOMPLETE (P2 missing ${p2MissingClasses.join(', ')})`
        : p4IosIncomplete
          ? 'PASS (P4-iOS INCOMPLETE: extension refusal not exercised)'
          : 'PASS';
    let rendered = writer.renderFinal({ overallVerdict, failure: failureProbe });
    const receiptScan = scanEvidenceForLeaks(writer.directory, {
      forbiddenLiterals,
      virtualFiles: [{ name: `${writer.base}.md`, bytes: rendered }],
    });
    if (!receiptScan.ok) {
      overallVerdict = 'FAIL';
      failureProbe ??= 'P6/final-receipt-candidate-leakage-scan';
      terminalError ??= new Error(`P6/final-receipt-leakage: ${JSON.stringify(receiptScan.findings)}`);
      writer.record('P6', 'final receipt candidate leakage scan', {
        expected: { findings: 0 },
        observed: { findings: receiptScan.findings },
        verdict: 'FAIL',
      });
      rendered = writer.renderFinal({ overallVerdict, failure: failureProbe });
    }
    writer.finalize({ overallVerdict, failure: failureProbe, rendered });
  }

  if (terminalError !== null) throw terminalError;
  return { verdict: overallVerdict, evidence: writer.markdownPath };
}
