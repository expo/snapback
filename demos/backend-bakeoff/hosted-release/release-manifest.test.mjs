import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CADDY_BASE,
  OS_BASE,
  RUNTIME_BASE,
  canonicalJson,
  createHostedReleaseManifest,
  verifyHostedReleaseManifest,
} from './release-manifest.mjs';
import { expectedHostedSupportSha256 } from '../../../scripts/pack-hosted-release.mjs';
import {
  mintOnlineHostedAdmission,
  publicKeyForSeed,
} from '../../../packages/snapback-hosted-supervisor/hosted-edge-admission.mjs';

const digest = (character) => character.repeat(64);
const file = (character, bytes = 1) => ({ sha256: digest(character), bytes });
const archive = (character) => ({
  ...file(character, 100),
  fileCount: 2,
  treeSha256: digest(character === 'a' ? 'b' : 'a'),
});

{
  const browserArtifactSha256 = digest('7');
  const bucket = (burst) => ({
    intervalMs: 1_000,
    burst,
    maximumDenialDebtAttempts: 64,
  });
  const expected = createHash('sha256')
    .update('snapback-hosted-auth-support-v1\0')
    .update(canonicalJson({
      hostedAuth: {
        externalTls: 'enforced',
        effectiveSource: 'trusted',
        authenticationThrottle: 'sharedEnforced',
        sessionInvalidation: 'globallyFenced',
        clientCredentialPosture: 'senderConstrainedV2',
      },
      authenticationThrottleConfig: {
        retentionMs: 600_000,
        maximumKeyCount: 100_000,
        global: bucket(2_000),
        source: bucket(600),
        subject: bucket(300),
        sourceSubject: bucket(200),
        family: bucket(300),
      },
      operatorSurface: 'disabled',
      browserDirectBearerSeam: 'excluded',
      browserArtifactSha256,
    }))
    .digest('hex');
  assert.equal(expectedHostedSupportSha256(browserArtifactSha256), expected);
  assert.throws(
    () => expectedHostedSupportSha256('not-a-digest'),
    (error) => error.code === 'SNAPBACK_HOSTED_RELEASE_APPLICATION_INVALID',
  );
}

function input(platform = 'linux/amd64') {
  const architecture = platform.split('/')[1];
  return {
    source: {
      repository: 'https://github.com/ccheever/snapback',
      revision: '1'.repeat(40),
      dirty: true,
      dirtyPathsSha256: digest('2'),
      tarball: archive('3'),
    },
    package: { tarball: archive('4') },
    platform: {
      selected: platform,
      os: 'linux',
      architecture,
      linuxAmd64: architecture === 'amd64',
      linuxArm64: architecture === 'arm64',
    },
    baseImages: [
      {
        purpose: 'operatingSystem',
        reference: OS_BASE.reference,
        indexSha256: OS_BASE.indexSha256,
        selectedManifestSha256: OS_BASE.platforms[platform],
      },
      {
        purpose: 'admissionRuntime',
        reference: RUNTIME_BASE.reference,
        indexSha256: RUNTIME_BASE.indexSha256,
        selectedManifestSha256: RUNTIME_BASE.platforms[platform],
      },
      {
        purpose: 'tlsTerminator',
        reference: CADDY_BASE.reference,
        indexSha256: CADDY_BASE.indexSha256,
        selectedManifestSha256: CADDY_BASE.platforms[platform],
      },
    ],
    hermes: {
      tarball: archive('5'),
      library: file('6', 200),
      compiler: file('7', 300),
      patchedExportProbe: {
        passed: true,
        symbol: 'ex_hermes_vm_current_package_id',
        tool: 'nm -D',
        outputSha256: digest('8'),
      },
      hermescProbe: {
        passed: true,
        argument: '--version',
        hbcBytecodeVersion: 96,
        outputSha256: digest('9'),
      },
    },
    snapback: {
      binary: file('a', 400),
      elfMachine: architecture === 'amd64' ? 62 : 183,
      runtimeLibraries: archive('f'),
      dynamicLinkProbe: {
        passed: true,
        tool: 'ldd',
        outputSha256: digest('0'),
        hostProvidedSonames: ['libc.so.6', 'libm.so.6', 'libresolv.so.2'],
      },
      sourceRevision: '1'.repeat(40),
      sourceDirty: true,
      buildIdentitySha256: digest('b'),
    },
    application: {
      tarball: archive('c'),
      requiredPaths: [
        'etc/hosted-edge.json',
        'etc/startup-artifacts.json',
        'generated/functions.manifest.json',
        'generated/schema.manifest.json',
        'generated/seed.json',
      ],
    },
    publicAssets: {
      tarball: archive('d'),
      servedRoot: '/app/public',
    },
    supplyChain: {
      sbom: file('e', 500),
      licenses: file('f', 600),
    },
    configuration: {
      dockerfile: file('1', 700),
      entrypoint: file('2', 800),
      caddyfile: file('3', 900),
      admissionRenewer: file('4', 1_000),
    },
    admissionChannel: {
      protocol: 'mutual-tls-1.3',
      endpoint: 'https://snapback-hosted-supervisor-sjc.internal:8444/v1/target/admission',
      requestSchema: 'snapback.hosted-target-admission-request.v1',
      targetId: 'snapback-drill-hosted-v2-20260728',
      deploymentId: 'snapback-drill-hosted-v2-1',
      renewalMode: 'online',
      refreshIntervalMaximumMs: 30_000,
      authorityLifetimeMaximumMs: 60_000,
      projectionPath: '/data/control/admission.json',
      requiredSecretPaths: [
        '/run/secrets/supervisor-target-client-key.pem',
        '/run/secrets/supervisor-target-client-cert.pem',
        '/run/secrets/supervisor-server-ca.pem',
      ],
    },
    image: {
      repository: 'registry.fly.io/snapback-drill',
      tag: 'hosted-test',
      intendedReference: 'registry.fly.io/snapback-drill:hosted-test',
    },
  };
}

for (const platform of ['linux/amd64', 'linux/arm64']) {
  const manifest = createHostedReleaseManifest(input(platform));
  assert.equal(manifest.schemaVersion, 'snapback.hosted-release-manifest.v1');
  assert.match(manifest.releaseId, /^[0-9a-f]{64}$/u);
  assert.equal(verifyHostedReleaseManifest(manifest).releaseId, manifest.releaseId);
  assert.equal(
    JSON.parse(canonicalJson(manifest)).releaseId,
    manifest.releaseId,
    'canonical manifest is valid JSON',
  );
}

{
  const clean = input();
  clean.source.dirty = false;
  clean.source.dirtyPathsSha256 = null;
  clean.snapback.sourceDirty = false;
  assert.equal(createHostedReleaseManifest(clean).source.dirty, false);
}

for (const mutate of [
  (value) => { value.source.repository = 'https://release-token@example.invalid/snapback.git'; },
  (value) => { value.hermes.patchedExportProbe.passed = false; },
  (value) => { value.hermes.hermescProbe.hbcBytecodeVersion = 0; },
  (value) => { value.snapback.elfMachine = 183; },
  (value) => { value.snapback.sourceRevision = '2'.repeat(40); },
  (value) => { value.snapback.dynamicLinkProbe.hostProvidedSonames.push('libssl.so.3'); },
  (value) => { value.application.requiredPaths.pop(); },
  (value) => { value.baseImages[0].reference = 'node:latest'; },
  (value) => { value.admissionChannel.requiredSecretPaths.pop(); },
  (value) => { value.image.intendedReference = 'registry.fly.io/other:latest'; },
  (value) => { value.source.dirtyPathsSha256 = null; },
  (value) => { value.source.tarball.treeSha256 = 'not-a-digest'; },
]) {
  const candidate = input();
  mutate(candidate);
  assert.throws(
    () => createHostedReleaseManifest(candidate),
    (error) => error.code === 'SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID',
  );
}

{
  const manifest = createHostedReleaseManifest(input());
  manifest.hermes.library.sha256 = digest('0');
  assert.throws(
    () => verifyHostedReleaseManifest(manifest),
    (error) => error.code === 'SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID'
      && /releaseId/u.test(error.message),
  );
}

{
  const manifest = createHostedReleaseManifest(input());
  manifest.unknown = true;
  assert.throws(
    () => verifyHostedReleaseManifest(manifest),
    (error) => error.code === 'SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID'
      && /not closed/u.test(error.message),
  );
}

const dockerfile = readFileSync(new URL('./Dockerfile', import.meta.url), 'utf8');
assert.ok(dockerfile.includes(`FROM ${CADDY_BASE.reference} AS caddy`));
assert.ok(dockerfile.includes(`FROM ${RUNTIME_BASE.reference} AS node`));
assert.ok(dockerfile.includes(`FROM ${OS_BASE.reference}`));
assert.match(dockerfile, /COPY --from=caddy \/etc\/ssl\/certs\/ca-certificates\.crt/u);
assert.doesNotMatch(dockerfile, /COPY --from=node \/etc\/ssl\/certs\/ca-certificates\.crt/u);
assert.doesNotMatch(dockerfile, /\b(?:curl|wget|apt-get|apk)\b/u);
assert.match(dockerfile, /COPY closure\/share\/ \/app\/share\//u);
assert.match(dockerfile, /USER 10001:10001/u);
assert.doesNotMatch(dockerfile, /\bUSER node\b|chown[^;\n]*node:node/u);
assert.match(dockerfile, /chown -R 0:0 \/app/u);
assert.doesNotMatch(dockerfile, /chown[^;\n]*10001:10001[^;\n]*\/app/u);
assert.match(dockerfile, /find \/app -type f -exec chmod 0444/u);
assert.match(dockerfile, /ldd \/usr\/local\/bin\/node/u);
assert.match(dockerfile, /snapback build-identity/u);

const renewer = readFileSync(new URL('./admission-renewer.sh', import.meta.url), 'utf8');
assert.match(renewer, /minVersion: 'TLSv1\.3'/u);
assert.match(renewer, /maxVersion: 'TLSv1\.3'/u);
assert.match(renewer, /const processBootId = uuidV7\(\)/u);
assert.doesNotMatch(renewer, /process\.env\.(?:SNAPBACK_)?PROCESS_BOOT/u);
assert.match(renewer, /constants\.O_NOFOLLOW/u);
assert.match(renewer, /MAX_AUTHORITY_AGE_MS = 60_000/u);
assert.match(renewer, /REFRESH_INTERVAL_MS = 25_000/u);
assert.match(renewer, /function armAuthorityWatchdog\(\)/u);
assert.match(renewer, /setTimeout\(\(\) => \{[\s\S]*process\.exit\(75\)/u);
assert.match(renewer, /'hostedTargetAdmission'/u);
assert.match(renewer, /schemaVersion !== 'snapback\.hosted-admission\.v2'/u);
assert.match(renewer, /target\.routedMachineId !== machineId/u);
assert.match(renewer, /target\.hostedAuthExpiresAtMs !== admission\.expiresAtMs/u);
assert.match(renewer, /target\.replayFloor !== admission\.senderReplayEpochFloor/u);
assert.match(renewer, /verifySignature\(null, targetInput, publicKey, targetSignature\)/u);
assert.match(renewer, /verifySignature\(null, envelopeInput, publicKey, envelopeSignature\)/u);

const entrypoint = readFileSync(new URL('./entrypoint.sh', import.meta.url), 'utf8');
assert.match(entrypoint, /SNAPBACK_HOSTED_PREFLIGHT_ONLY/u);
assert.match(entrypoint, /kill "\$child_pid"/u);
assert.match(entrypoint, /--hosted-admission "\$admission_path"/u);
assert.match(entrypoint, /trap cleanup EXIT/u);
assert.match(entrypoint, /trap 'exit 143' TERM/u);

{
  const testRoot = mkdtempSync(join(tmpdir(), 'snapback-hosted-renewer-test-'));
  try {
    const now = Date.now();
    const seed = Buffer.alloc(32, 7).toString('base64url');
    const targetId = 'snapback-drill-hosted-v2-20260728';
    const deploymentId = 'snapback-drill-hosted-v2-1';
    const machineId = 'machine-renewer-test';
    const enrollment = {
      schemaVersion: 'snapback.hosted-target-enrollment.v1',
      targetId,
      deploymentId,
      publicOrigin: 'https://snapback-drill.fly.dev',
      firstContactTransport: 'hstsPreloadedSuffix',
      admissionPublicKey: publicKeyForSeed(seed),
      supportSha256: digest('1'),
      signingSeedCredentialRef: '/run/secrets/test-signing-seed',
      clientCertificateSha256: `sha256:${digest('2')}`,
    };
    const fixture = mintOnlineHostedAdmission({
      enrollment,
      signingSeed: seed,
      targetAuthority: {
        bindingGeneration: 3,
        targetBindingSha256: `sha256:${digest('3')}`,
        controlHeadSha256: `sha256:${digest('4')}`,
        supervisorIncarnation: 'supervisor-incarnation-3',
        exactRosterSha256: `sha256:${digest('5')}`,
        routedMachineId: machineId,
        routedMachineExpiresAtMs: now + 120_000,
      },
      admissionEpoch: 11,
      senderReplayEpochFloor: 7,
      issuedAtMs: now,
      expiresAtMs: now + 50_000,
    });
    const configPath = join(testRoot, 'hosted-edge.json');
    const fixturePath = join(testRoot, 'admission.json');
    writeFileSync(configPath, JSON.stringify(enrollment));
    writeFileSync(fixturePath, JSON.stringify(fixture));
    const invoke = () => spawnSync('sh', [
      new URL('./admission-renewer.sh', import.meta.url).pathname,
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SNAPBACK_HOSTED_TARGET_ID: targetId,
        SNAPBACK_HOSTED_DEPLOYMENT_ID: deploymentId,
        FLY_MACHINE_ID: machineId,
        SNAPBACK_HOSTED_CONFIG_PATH: configPath,
        SNAPBACK_HOSTED_ADMISSION_VALIDATE_FIXTURE: fixturePath,
      },
    });
    assert.equal(invoke().status, 0, 'renewer accepts the exact dual-signed V2 envelope');

    fixture.hostedTargetAdmission.replayFloor += 1;
    writeFileSync(fixturePath, JSON.stringify(fixture));
    assert.notEqual(invoke().status, 0, 'renewer rejects a V2/v1 replay-floor mismatch');
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
}

console.log('release-manifest.test.mjs: hosted release closure and fail-closed tamper matrix pass');
