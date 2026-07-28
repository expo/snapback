#!/usr/bin/env node

// @ref LLP 0105#tls-admission-evidence-and-packaging — one closed,
// content-addressed record binds the staged native/runtime/app closure to the
// exact digest-pinned bases and intended Fly registry identity.

import { createHash } from 'node:crypto';

export const RUNTIME_BASE = Object.freeze({
  reference: 'node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d',
  indexSha256: '6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d',
  platforms: Object.freeze({
    'linux/amd64': 'd45d78e7929b46875bbd4e29bea672d5bc48186c6c3588306521c815e78352d6',
    'linux/arm64': 'af01d58b748ec92b1d6e8e11429aad424fd1e68c848185399dca0596a1ab8f5c',
  }),
});

export const CADDY_BASE = Object.freeze({
  reference: 'caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d',
  indexSha256: '4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d',
  platforms: Object.freeze({
    'linux/amd64': 'd8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83',
    'linux/arm64': '8dbca3525dd8dce671e495665a0eb297a83ec87ee30f373947d0ea93115949db',
  }),
});

export const OS_BASE = Object.freeze({
  reference: 'ubuntu:24.04@sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90',
  indexSha256: '4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90',
  platforms: Object.freeze({
    'linux/amd64': '52df9b1ee71626e0088f7d400d5c6b5f7bb916f8f0c82b474289a4ece6cf3faf',
    'linux/arm64': '7f622ca8766bccb22f04242ecb6f19f770b2f08827dc4b8c707de5e78a6da7ab',
  }),
});

const SHA256 = /^[0-9a-f]{64}$/u;
const SOURCE_REVISION = /^[0-9a-f]{40,64}$/u;
const PORTABLE_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PLATFORMS = new Set(['linux/amd64', 'linux/arm64']);
const EXACT_TOP_LEVEL = [
  'schemaVersion',
  'releaseId',
  'source',
  'package',
  'platform',
  'baseImages',
  'hermes',
  'snapback',
  'application',
  'publicAssets',
  'supplyChain',
  'configuration',
  'admissionChannel',
  'image',
];

function refusal(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function exactObject(value, keys, label) {
  if (
    value === null
    || Array.isArray(value)
    || typeof value !== 'object'
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(value, key))
  ) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', `${label} is not closed`);
  }
}

function sha(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', `${label} is not lowercase SHA-256`);
  }
  return value;
}

function positiveInteger(value, label, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', `${label} is not a bounded integer`);
  }
  return value;
}

function publicSourceRepository(value) {
  let repository;
  try {
    repository = new URL(value);
  } catch {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'source repository is not a public HTTPS URL');
  }
  if (
    repository.protocol !== 'https:'
    || repository.username !== ''
    || repository.password !== ''
    || repository.search !== ''
    || repository.hash !== ''
    || repository.hostname === ''
  ) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'source repository is not a public HTTPS URL');
  }
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'manifest numbers must be safe integers');
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'manifest contains an unsupported value');
}

function contentId(manifestWithoutId) {
  return createHash('sha256')
    .update('snapback:hosted-release-manifest:v1\0')
    .update(canonicalJson(manifestWithoutId))
    .digest('hex');
}

function validateFileFact(value, label) {
  exactObject(value, ['sha256', 'bytes'], label);
  sha(value.sha256, `${label}.sha256`);
  positiveInteger(value.bytes, `${label}.bytes`);
}

function validateArchiveFact(value, label) {
  exactObject(value, ['sha256', 'bytes', 'fileCount', 'treeSha256'], label);
  validateFileFact({ sha256: value.sha256, bytes: value.bytes }, label);
  positiveInteger(value.fileCount, `${label}.fileCount`);
  sha(value.treeSha256, `${label}.treeSha256`);
}

function validateManifest(manifest, { verifyReleaseId }) {
  exactObject(manifest, EXACT_TOP_LEVEL, 'hosted release manifest');
  if (manifest.schemaVersion !== 'snapback.hosted-release-manifest.v1') {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'unknown schemaVersion');
  }

  exactObject(
    manifest.source,
    ['repository', 'revision', 'dirty', 'dirtyPathsSha256', 'tarball'],
    'source',
  );
  if (
    !SOURCE_REVISION.test(manifest.source.revision)
    || typeof manifest.source.dirty !== 'boolean'
    || (
      manifest.source.dirty
        ? typeof manifest.source.dirtyPathsSha256 !== 'string'
          || !SHA256.test(manifest.source.dirtyPathsSha256)
        : manifest.source.dirtyPathsSha256 !== null
    )
  ) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'source identity is invalid');
  }
  publicSourceRepository(manifest.source.repository);
  // The normalized tree digest authenticates the dirty overlay's bytes, not
  // merely its path set or the compression metadata of its source archive.
  validateArchiveFact(manifest.source.tarball, 'source.tarball');

  exactObject(manifest.package, ['tarball'], 'package');
  validateArchiveFact(manifest.package.tarball, 'package.tarball');

  exactObject(
    manifest.platform,
    ['selected', 'os', 'architecture', 'linuxAmd64', 'linuxArm64'],
    'platform',
  );
  if (
    !PLATFORMS.has(manifest.platform.selected)
    || manifest.platform.os !== 'linux'
    || !['amd64', 'arm64'].includes(manifest.platform.architecture)
    || typeof manifest.platform.linuxAmd64 !== 'boolean'
    || typeof manifest.platform.linuxArm64 !== 'boolean'
    || manifest.platform.linuxAmd64 !== (manifest.platform.selected === 'linux/amd64')
    || manifest.platform.linuxArm64 !== (manifest.platform.selected === 'linux/arm64')
  ) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'platform facts disagree');
  }

  if (!Array.isArray(manifest.baseImages) || manifest.baseImages.length !== 3) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'exactly three base images are required');
  }
  for (const [index, expected] of [OS_BASE, RUNTIME_BASE, CADDY_BASE].entries()) {
    const observed = manifest.baseImages[index];
    exactObject(
      observed,
      ['purpose', 'reference', 'indexSha256', 'selectedManifestSha256'],
      `baseImages[${index}]`,
    );
    if (
      observed.purpose !== ['operatingSystem', 'admissionRuntime', 'tlsTerminator'][index]
      || observed.reference !== expected.reference
      || observed.indexSha256 !== expected.indexSha256
      || observed.selectedManifestSha256 !== expected.platforms[manifest.platform.selected]
    ) {
      refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'base image pin does not match the recipe');
    }
    sha(observed.indexSha256, 'base image index');
    sha(observed.selectedManifestSha256, 'base image selected manifest');
  }

  exactObject(
    manifest.hermes,
    ['tarball', 'library', 'compiler', 'patchedExportProbe', 'hermescProbe'],
    'hermes',
  );
  validateArchiveFact(manifest.hermes.tarball, 'hermes.tarball');
  validateFileFact(manifest.hermes.library, 'hermes.library');
  validateFileFact(manifest.hermes.compiler, 'hermes.compiler');
  exactObject(
    manifest.hermes.patchedExportProbe,
    ['passed', 'symbol', 'tool', 'outputSha256'],
    'hermes.patchedExportProbe',
  );
  if (
    manifest.hermes.patchedExportProbe.passed !== true
    || manifest.hermes.patchedExportProbe.symbol !== 'ex_hermes_vm_current_package_id'
    || manifest.hermes.patchedExportProbe.tool !== 'nm -D'
  ) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'patched Hermes export was not proved');
  }
  sha(manifest.hermes.patchedExportProbe.outputSha256, 'patched export output');
  exactObject(
    manifest.hermes.hermescProbe,
    ['passed', 'argument', 'hbcBytecodeVersion', 'outputSha256'],
    'hermes.hermescProbe',
  );
  if (
    manifest.hermes.hermescProbe.passed !== true
    || manifest.hermes.hermescProbe.argument !== '--version'
    || !Number.isSafeInteger(manifest.hermes.hermescProbe.hbcBytecodeVersion)
    || manifest.hermes.hermescProbe.hbcBytecodeVersion < 1
  ) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'hermesc execution was not proved');
  }
  sha(manifest.hermes.hermescProbe.outputSha256, 'hermesc output');

  exactObject(
    manifest.snapback,
    [
      'binary',
      'elfMachine',
      'runtimeLibraries',
      'dynamicLinkProbe',
      'sourceRevision',
      'sourceDirty',
      'buildIdentitySha256',
    ],
    'snapback',
  );
  validateFileFact(manifest.snapback.binary, 'snapback.binary');
  validateArchiveFact(manifest.snapback.runtimeLibraries, 'snapback.runtimeLibraries');
  exactObject(
    manifest.snapback.dynamicLinkProbe,
    ['passed', 'tool', 'outputSha256', 'hostProvidedSonames'],
    'snapback.dynamicLinkProbe',
  );
  if (
    manifest.snapback.dynamicLinkProbe.passed !== true
    || manifest.snapback.dynamicLinkProbe.tool !== 'ldd'
    || canonicalJson(manifest.snapback.dynamicLinkProbe.hostProvidedSonames)
      !== canonicalJson(['libc.so.6', 'libm.so.6', 'libresolv.so.2'])
  ) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'dynamic runtime closure was not proved');
  }
  sha(manifest.snapback.dynamicLinkProbe.outputSha256, 'dynamic link output');
  if (
    manifest.snapback.sourceRevision !== manifest.source.revision
    || manifest.snapback.sourceDirty !== manifest.source.dirty
  ) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'binary source identity disagrees');
  }
  const expectedMachine = manifest.platform.architecture === 'amd64' ? 62 : 183;
  if (manifest.snapback.elfMachine !== expectedMachine) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'Snapback ELF architecture is wrong');
  }
  sha(manifest.snapback.buildIdentitySha256, 'Snapback build identity');

  exactObject(manifest.application, ['tarball', 'requiredPaths'], 'application');
  validateArchiveFact(manifest.application.tarball, 'application.tarball');
  const requiredPaths = [
    'etc/hosted-edge.json',
    'etc/startup-artifacts.json',
    'generated/functions.manifest.json',
    'generated/schema.manifest.json',
    'generated/seed.json',
  ];
  if (
    !Array.isArray(manifest.application.requiredPaths)
    || canonicalJson(manifest.application.requiredPaths) !== canonicalJson(requiredPaths)
  ) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'application closure is incomplete');
  }

  exactObject(manifest.publicAssets, ['tarball', 'servedRoot'], 'publicAssets');
  validateArchiveFact(manifest.publicAssets.tarball, 'publicAssets.tarball');
  if (manifest.publicAssets.servedRoot !== '/app/public') {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'public asset root is wrong');
  }

  exactObject(manifest.supplyChain, ['sbom', 'licenses'], 'supplyChain');
  for (const name of ['sbom', 'licenses']) validateFileFact(manifest.supplyChain[name], name);

  exactObject(
    manifest.configuration,
    ['dockerfile', 'entrypoint', 'caddyfile', 'admissionRenewer'],
    'configuration',
  );
  for (const name of Object.keys(manifest.configuration)) {
    validateFileFact(manifest.configuration[name], `configuration.${name}`);
  }

  exactObject(
    manifest.admissionChannel,
    [
      'protocol',
      'endpoint',
      'requestSchema',
      'targetId',
      'deploymentId',
      'renewalMode',
      'refreshIntervalMaximumMs',
      'authorityLifetimeMaximumMs',
      'projectionPath',
      'requiredSecretPaths',
    ],
    'admissionChannel',
  );
  if (
    manifest.admissionChannel.protocol !== 'mutual-tls-1.3'
    || manifest.admissionChannel.endpoint
      !== 'https://snapback-hosted-supervisor-sjc.internal:8444/v1/target/admission'
    || manifest.admissionChannel.requestSchema
      !== 'snapback.hosted-target-admission-request.v1'
    || typeof manifest.admissionChannel.targetId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u.test(manifest.admissionChannel.targetId)
    || typeof manifest.admissionChannel.deploymentId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u.test(manifest.admissionChannel.deploymentId)
    || manifest.admissionChannel.renewalMode !== 'online'
    || manifest.admissionChannel.refreshIntervalMaximumMs !== 30_000
    || manifest.admissionChannel.authorityLifetimeMaximumMs !== 60_000
    || manifest.admissionChannel.projectionPath !== '/data/control/admission.json'
    || canonicalJson(manifest.admissionChannel.requiredSecretPaths) !== canonicalJson([
      '/run/secrets/supervisor-target-client-key.pem',
      '/run/secrets/supervisor-target-client-cert.pem',
      '/run/secrets/supervisor-server-ca.pem',
    ])
  ) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'admission channel does not match LLP 0105');
  }

  exactObject(manifest.image, ['repository', 'tag', 'intendedReference'], 'image');
  if (
    manifest.image.repository !== 'registry.fly.io/snapback-drill'
    || typeof manifest.image.tag !== 'string'
    || !PORTABLE_TAG.test(manifest.image.tag)
    || manifest.image.intendedReference
      !== `registry.fly.io/snapback-drill:${manifest.image.tag}`
  ) {
    refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'image identity is invalid');
  }

  if (verifyReleaseId) {
    sha(manifest.releaseId, 'releaseId');
    const { releaseId: ignored, ...withoutId } = manifest;
    if (contentId(withoutId) !== manifest.releaseId) {
      refusal('SNAPBACK_HOSTED_RELEASE_MANIFEST_INVALID', 'releaseId does not match manifest bytes');
    }
  }
  return manifest;
}

export function createHostedReleaseManifest(input) {
  const manifestWithoutId = {
    schemaVersion: 'snapback.hosted-release-manifest.v1',
    source: input.source,
    package: input.package,
    platform: input.platform,
    baseImages: input.baseImages,
    hermes: input.hermes,
    snapback: input.snapback,
    application: input.application,
    publicAssets: input.publicAssets,
    supplyChain: input.supplyChain,
    configuration: input.configuration,
    admissionChannel: input.admissionChannel,
    image: input.image,
  };
  const manifest = {
    schemaVersion: manifestWithoutId.schemaVersion,
    releaseId: contentId(manifestWithoutId),
    ...Object.fromEntries(Object.entries(manifestWithoutId).slice(1)),
  };
  return validateManifest(manifest, { verifyReleaseId: true });
}

export function verifyHostedReleaseManifest(manifest) {
  return validateManifest(structuredClone(manifest), { verifyReleaseId: true });
}
