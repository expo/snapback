import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { startBackend } from './backend.mjs';
import { createDirector } from './director.mjs';
import { EvidenceWriter, scanEvidenceForLeaks } from './evidence.mjs';
import { delay, run } from './process.mjs';

function publicFailure(error) {
  const code = error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_NATIVE_PROBE_HARNESS_FAILED';
  return { code, message: error instanceof Error ? error.message : String(error) };
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
    && left?.bearerSha256 === right?.bearerSha256;
}

function typedSecondaryContextRefusal(code) {
  return /^SNAPBACK_AUTH_CUSTODY_/u.test(code ?? '')
    && /(?:CONTEXT|PROCESS|SECONDARY|SINGLE_RUNTIME)/u.test(code)
    && !/(?:UNTYPED|PROBE_FAILED|RESULT_MISSING|TEST_HOOK_UNAVAILABLE)/u.test(code);
}

function typedCiphertextRefusal(code) {
  return /^SNAPBACK_AUTH_CUSTODY_/u.test(code ?? '')
    && /(?:AEAD|CORRUPT|DECRYPT|KEY)/u.test(code);
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
  const writer = new EvidenceWriter({
    root: evidenceRoot,
    platform,
    metadata: {
      harness: `${platform}:${options.iterations} interruption iterations`,
      appPackage: `${packageJson.name}@${packageJson.version}`,
      expo: packageJson.dependencies.expo,
      reactNative: packageJson.dependencies['react-native'],
      workspacePackageVersions: Object.fromEntries(
        Object.entries(packageJson.dependencies)
          .filter(([name]) => name.startsWith('@expo/snapback-')),
      ),
      custodyModule: 'Lane A platformGrade pending first bootstrap',
    },
  });
  const director = createDirector({ port: options.directorPort });
  const cleanup = [];
  let device = null;
  let backend = null;
  let failureProbe = null;
  let overallVerdict = 'FAIL';
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

  try {
    await director.listen();
    cleanup.push(() => director.close());
    backend = await startBackend({ repoRoot, demoRoot, platform, serverPort: options.serverPort });
    cleanup.push(() => backend.close());
    assertProbe(
      backend.descriptor.authBootstrap?.format === 'snapback.application-auth-bootstrap.v1',
      'P0',
      'generated descriptor did not carry the application auth bootstrap policy',
      backend.descriptor.authBootstrap,
    );

    await run('probe app dependency install', 'bun', ['install'], { cwd: appRoot, timeoutMs: 10 * 60_000 });
    const custodyPackageJson = join(
      appRoot, 'node_modules', '@expo', 'snapback-expo-custody', 'package.json',
    );
    writer.setMetadata({
      custodyModulePackageVersion: existsSync(custodyPackageJson)
        ? JSON.parse(readFileSync(custodyPackageJson, 'utf8')).version
        : 'absent (Lane A integration required)',
    });
    device = await createDevice({ appRoot, evidence: writer, options });
    cleanup.push(() => device.cleanup());
    writer.setMetadata(await device.metadata());
    writer.setMetadata({
      backendOrigin: backend.ready.serverUrl,
      backendRuntime: process.env.SNAPBACK_RUNTIME_BINARY ?? 'CLI-selected runtime',
      descriptorIdentity: backend.descriptor.identity.descriptor,
      bootstrapCapabilityOptIn: 'provider-layer (codegen has no source declaration in this revision)',
      bundleId: options.bundleId,
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
    await step('P1', 'launch witness', { event: 'witness-ready' }, launch, (value) => value.event === 'witness-ready');
    const initialBoot = await step(
      'P1',
      'fresh bootstrap',
      { status: 'ready', principal: 'anonymous', credentialEntryCalls: 0 },
      () => command('bootstrap', { mode: 'native' }, 90_000),
      (value) => value.status === 'ready'
        && value.principal?.status === 'anonymous'
        && value.credentialEntryCalls === 0,
    );
    writer.setMetadata({ custodyModule: initialBoot.custodyFacts?.platformGrade ?? 'not projected' });
    await step(
      'P1', 'password signup',
      { principal: 'authenticated', recoveryCodeProjection: 'count only' },
      () => command('signup', { email, password }, 90_000),
      (value) => value.principal?.status === 'authenticated'
        && Number.isSafeInteger(value.recoveryCodeCount),
    );
    // Signup authenticates by contract; a settled sign-out is required before
    // the charter's explicit signin witness can exercise credential entry.
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
      { revision: 'integer', epoch: 'integer', bearerSha256: 'sha256' },
      () => command('custodyFacts'),
      (value) => Number.isSafeInteger(value.revision)
        && Number.isSafeInteger(value.epoch)
        && /^[a-f0-9]{64}$/u.test(value.bearerSha256),
    );
    await step('P1', 'authenticated screenshot', { format: 'png' }, async () => {
      const path = join(writer.directory, `${writer.base}-p1-authenticated.png`);
      await device.screenshot(path);
      return { file: path.split('/').at(-1) };
    });
    await step('P1', 'hard process kill', { mechanism: platform === 'ios' ? 'SIGKILL' : 'am force-stop' }, async () => {
      await device.kill();
      return { killed: true };
    });
    const restored = await step(
      'P1', 'cold relaunch bootstrap',
      {
        principal: signIn.principal.userId,
        sameRevisionEpochAndBearerSha256: true,
        credentialEntryCalls: 0,
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
    await step('P1', 'restored screenshot', { format: 'png' }, async () => {
      const path = join(writer.directory, `${writer.base}-p1-restored.png`);
      await device.screenshot(path);
      return { file: path.split('/').at(-1) };
    });

    let latestFacts = restored.boot.custodyFacts;
    // @ref LLP 0263#5-probe-checklists — the host interrupts the real carrier
    // after an acknowledged write and admits only predecessor-or-successor
    // revision recovery; a wider delta is a torn/ambiguous outcome.
    for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
      let nextReady = null;
      let nextFacts = null;
      await step(
        'P2', `kill-mid-write iteration ${iteration}`,
        { parses: true, revision: 'last acknowledged heartbeat or successor' },
        async () => {
          const eventStart = director.events.length;
          const activeLaunchId = restored.ready.launchId;
          await command('tightWriteLoop');
          await director.waitEvent(
            (event) => event.event === 'tight-write-heartbeat' && event.launchId === activeLaunchId,
            eventStart,
            30_000,
          );
          const killDelayMs = randomInt(10, 251);
          await delay(killDelayMs);
          await device.kill({ midWrite: true });
          await delay(100);
          const heartbeats = director.events.slice(eventStart).filter(
            (event) => event.event === 'tight-write-heartbeat' && event.launchId === activeLaunchId,
          );
          const lastHeartbeat = heartbeats.at(-1)?.details?.revision;
          assertProbe(Number.isSafeInteger(lastHeartbeat), 'P2', 'no integral write heartbeat preceded kill');
          const next = await relaunchAndBootstrap();
          const facts = await command('custodyFacts');
          nextReady = next.ready;
          nextFacts = facts;
          return {
            killDelayMs,
            lastHeartbeat,
            restoredRevision: facts.revision,
            phase: facts.phase,
            bootstrapStatus: next.boot.status,
          };
        },
        (value) => value.bootstrapStatus === 'ready'
          && (value.restoredRevision === value.lastHeartbeat
            || value.restoredRevision === value.lastHeartbeat + 1)
          && ['settled', 'clearing', 'exhausted'].includes(value.phase),
      );
      latestFacts = nextFacts;
      restored.ready = nextReady;
    }

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

    const contextRefusalVerdict = platform === 'ios' ? 'FALLBACK' : 'PASS';
    await step(
      'P4', platform === 'ios' ? 'extension refusal fallback' : 'secondary-process refusal',
      platform === 'ios'
        ? { nativeUnitFallbackRequired: true }
        : { attempted: true, diagnostic: 'typed secondary/single-runtime context refusal' },
      () => command('refusalProbe', {}, 60_000),
      (value) => platform === 'ios'
        ? value.attempted === false
          && value.diagnostic?.code === 'SNAPBACK_AUTH_CUSTODY_EXTENSION_NATIVE_UNIT_FALLBACK_REQUIRED'
        : value.attempted === true
          && typedSecondaryContextRefusal(value.diagnostic?.code),
      contextRefusalVerdict,
    );
    await step(
      'P4', 'ordinary capability boundary',
      { status: 'unsupported', diagnostic: 'durable unavailable or platform unsupported' },
      () => command('bootstrap', { mode: 'ordinary' }, 90_000),
      (value) => ['unsupported', 'blocked', 'error'].includes(value.status)
        && [
          'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE',
          'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED',
        ].includes(value.diagnostic?.code),
    );
    await step(
      'P4', 'restore admitted native platform',
      { status: 'ready' },
      () => command('bootstrap', { mode: 'native' }, 90_000),
      (value) => value.status === 'ready',
    );

    if (platform === 'android') {
      // @ref LLP 0263#5-probe-checklists — Android's AEAD and reinstall
      // probes are distinct: corrupted ciphertext must refuse before an
      // uninstall proves backup/key lifecycle behavior is sane.
      await step(
        'P5', 'ciphertext corruption and AEAD refusal',
        { hook: 'present', readAccepted: false, diagnostic: 'typed AEAD/corrupt/decrypt/key refusal' },
        () => command('corruptionProbe'),
        (value) => value.supported === true
          && value.readAccepted === false
          && typedCiphertextRefusal(value.diagnostic?.code),
      );
      await step('P5', 'uninstall and install APK', { appData: 'removed' }, async () => {
        await device.reinstallPreservingOsCustody();
        return { installed: true };
      });
      const reinstalled = await step(
        'P5', 'uninstall and reinstall',
        { principal: 'anonymous', custody: 'fresh and sane' },
        relaunchAndBootstrap,
        (value) => value.boot.status === 'ready'
          && value.boot.principal?.status === 'anonymous',
      );
      latestFacts = reinstalled.boot.custodyFacts;
    } else {
      const priorPrincipal = restored.boot.principal.userId;
      const factsBeforeReinstall = await step(
        'P5', 'custody facts before keychain reinstall probe',
        { revision: 'integer', bearerSha256: 'sha256' },
        () => command('custodyFacts'),
        (value) => Number.isSafeInteger(value.revision)
          && /^[a-f0-9]{64}$/u.test(value.bearerSha256),
      );
      await step('P5', 'uninstall and install app bundle', { keychain: 'preserved' }, async () => {
        await device.reinstallPreservingOsCustody();
        return { installed: true };
      });
      const reinstalled = await step(
        'P5', 'uninstall and reinstall with keychain residue',
        { outcome: 'valid adoption or typed custody refusal' },
        relaunchAndBootstrap,
        (value) => (
          value.boot.status === 'ready'
          && value.boot.principal?.status === 'authenticated'
          && value.boot.principal.userId === priorPrincipal
          && sameCustody(factsBeforeReinstall, value.boot.custodyFacts)
        ) || (
          value.boot.status !== 'ready'
          && /^SNAPBACK_AUTH_CUSTODY_/u.test(value.boot.diagnostic?.code)
        ),
      );
      latestFacts = reinstalled.boot.custodyFacts ?? factsBeforeReinstall;
    }
    await step('P5', 'reinstall screenshot', { format: 'png' }, async () => {
      const path = join(writer.directory, `${writer.base}-p5-reinstall.png`);
      await device.screenshot(path);
      return { file: path.split('/').at(-1) };
    });
    writer.setMetadata({ finalCustodyPublicFacts: latestFacts });

    const leakage = scanEvidenceForLeaks(evidenceRoot, { forbiddenLiterals: [password] });
    await step(
      'P6', 'evidence leakage scan',
      { findings: 0 },
      async () => leakage,
      (value) => value.ok === true,
    );
    overallVerdict = platform === 'ios' ? 'PASS WITH DOCUMENTED EXTENSION FALLBACK' : 'PASS';
  } catch (error) {
    if (failureProbe === null) {
      failureProbe = 'P0/setup';
      writer.record('P0', 'setup', {
        expected: { ready: true },
        observed: publicFailure(error),
        verdict: 'FAIL',
      });
    }
    throw error;
  } finally {
    for (const dispose of cleanup.reverse()) {
      try { await dispose(); } catch { /* retain the first probe verdict */ }
    }
    writer.finalize({ overallVerdict, failure: failureProbe });
    if (options.leakageScan) {
      const leakage = scanEvidenceForLeaks(evidenceRoot, { forbiddenLiterals: [password] });
      if (!leakage.ok && failureProbe === null) {
        throw new Error(`P6/leakage-scan: ${JSON.stringify(leakage.findings)}`);
      }
    }
  }
  return { verdict: overallVerdict, evidence: writer.markdownPath };
}
