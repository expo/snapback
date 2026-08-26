// Repository-local producer for the target-owned LLP 0234 activation carrier.
//
// @ref LLP 0234#d3--widening-requires-a-remotely-prior-artifact-closed-approval-receipt
//   — even local development gets a real Ed25519 signature and exact staged
//   deployment identity; this producer does not turn `required: false` into a
//   validation bypass.
// @ref LLP 0234#d4--production-authority-expires-fixtures-cannot-become-production
//   — the only admitted target class is repository-local, fixture profiles
//   deep-match a committed registration, and production authority is refused.

import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign as signBytes,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  GOVERNANCE_COMPARATOR_VERSION,
  GOVERNANCE_SCHEMA_VERSIONS,
  VisibilityGovernanceError,
  canonicalGovernanceJson,
  deploymentIdentityFromGenerated,
  governanceDigest,
} from './visibility-governance.mjs';

export const VISIBILITY_GOVERNANCE_TARGET_CONFIG_ENV =
  'SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG';
export const VISIBILITY_GOVERNANCE_DEV_TARGET_CLASS = 'repository-local';
export const VISIBILITY_GOVERNANCE_DEV_PROVIDER_PROFILE =
  'repository-local-dev-mint-v1';
export const VISIBILITY_GOVERNANCE_DEV_REGISTRATION_FILE =
  'visibility-governance-dev.json';
export const VISIBILITY_GOVERNANCE_DEV_REGISTRATION_SCHEMA =
  'snapback.visibility-governance-dev-registration.v1';
export const VISIBILITY_GOVERNANCE_DEV_REGISTRY_SCHEMA =
  'snapback.visibility-governance-dev-app-registry.v1';

const REPOSITORY_REGISTRY = 'scripts/visibility-governance-dev-apps.v1.json';
const LOCAL_TARGET_PROFILE = 'local-dev-sqlite-ibex';
const REFUSAL = 'SNAPBACK_VISIBILITY_GOVERNANCE_DEV_CONFIG_REFUSED';
const WRITE_FAILED = 'SNAPBACK_VISIBILITY_GOVERNANCE_DEV_CONFIG_WRITE_FAILED';
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const FIXTURE_PROFILE_KEYS = [
  'dataClassification',
  'digest',
  'id',
  'principalClass',
  'targetClassCeiling',
];

function refuse(message, details = {}) {
  throw new VisibilityGovernanceError(REFUSAL, message, details);
}

function readJson(path, label) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    refuse(`${label} is unavailable or malformed: ${error.message}`, { path });
  }
  return value;
}

function portableRelative(root, path) {
  return relative(root, path).split(sep).join('/');
}

function findRepositoryRoot(start) {
  let cursor = resolve(start);
  while (true) {
    if (existsSync(join(cursor, REPOSITORY_REGISTRY))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function fixtureProfileTuple(value, label) {
  if (!value
      || canonicalGovernanceJson(Object.keys(value).sort())
        !== canonicalGovernanceJson(FIXTURE_PROFILE_KEYS)
      || typeof value.id !== 'string' || value.id.length === 0
      || !SHA256.test(value.digest ?? '')
      || value.targetClassCeiling !== VISIBILITY_GOVERNANCE_DEV_TARGET_CLASS
      || value.principalClass !== 'synthetic'
      || value.dataClassification !== 'fixture-owned') {
    refuse(`${label} is not an exact repository-local fixture-profile tuple`);
  }
  return Object.freeze({ ...value });
}

function fixtureProfileSet(values, label) {
  if (!Array.isArray(values)) refuse(`${label} must be an array`);
  const tuples = values.map((value, index) => fixtureProfileTuple(value, `${label}[${index}]`));
  const sorted = [...tuples].sort((left, right) => (
    canonicalGovernanceJson(left).localeCompare(canonicalGovernanceJson(right))
  ));
  if (new Set(tuples.map(canonicalGovernanceJson)).size !== tuples.length
      || canonicalGovernanceJson(tuples) !== canonicalGovernanceJson(sorted)) {
    refuse(`${label} must be unique and canonically sorted`);
  }
  return Object.freeze(tuples);
}

function generatedFixtureProfileSet(values, label) {
  if (!Array.isArray(values)) refuse(`${label} must be an array`);
  const tuples = values.map((profile) => ({
    id: profile?.id,
    digest: profile?.digest,
    targetClassCeiling: profile?.targetClassCeiling,
    principalClass: profile?.principalClass,
    dataClassification: profile?.dataClassification,
  }));
  return fixtureProfileSet(
    [...new Map(tuples.map((tuple) => [canonicalGovernanceJson(tuple), tuple])).values()]
      .sort((left, right) => canonicalGovernanceJson(left).localeCompare(canonicalGovernanceJson(right))),
    label,
  );
}

function validateRegistration(value, label) {
  const keys = Object.keys(value ?? {}).sort();
  const expected = [
    'appId',
    'dataClassification',
    'fixtureProfiles',
    'principalClass',
    'schemaVersion',
    'targetClass',
  ].sort();
  if (canonicalGovernanceJson(keys) !== canonicalGovernanceJson(expected)
      || value.schemaVersion !== VISIBILITY_GOVERNANCE_DEV_REGISTRATION_SCHEMA
      || typeof value.appId !== 'string' || value.appId.length === 0
      || value.targetClass !== VISIBILITY_GOVERNANCE_DEV_TARGET_CLASS
      || value.principalClass !== 'synthetic'
      || value.dataClassification !== 'fixture-owned') {
    refuse(`${label} is not an exact repository-local synthetic registration`);
  }
  return Object.freeze({
    ...value,
    fixtureProfiles: fixtureProfileSet(value.fixtureProfiles, `${label}.fixtureProfiles`),
  });
}

export function loadVisibilityGovernanceDevRegistry(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const path = join(root, REPOSITORY_REGISTRY);
  const value = readJson(path, 'visibility governance dev-app registry');
  if (value?.schemaVersion !== VISIBILITY_GOVERNANCE_DEV_REGISTRY_SCHEMA
      || value.targetClass !== VISIBILITY_GOVERNANCE_DEV_TARGET_CLASS
      || value.principalClass !== 'synthetic'
      || value.dataClassification !== 'fixture-owned'
      || !Array.isArray(value.apps)) {
    refuse('visibility governance dev-app registry has an unsupported shape', { path });
  }
  const apps = value.apps.map((entry, index) => {
    if (!entry || Object.keys(entry).sort().join(',') !== 'appId,backend,fixtureProfiles'
        || typeof entry.backend !== 'string' || entry.backend.length === 0
        || entry.backend.startsWith('/') || entry.backend.split('/').includes('..')
        || typeof entry.appId !== 'string' || entry.appId.length === 0) {
      refuse(`visibility governance dev-app registry entry ${index} is invalid`, { path });
    }
    return Object.freeze({
      ...entry,
      fixtureProfiles: fixtureProfileSet(
        entry.fixtureProfiles,
        `visibility governance dev-app registry entry ${index}.fixtureProfiles`,
      ),
    });
  });
  const sorted = [...apps].sort((left, right) => left.backend.localeCompare(right.backend));
  if (new Set(apps.map(({ backend }) => backend)).size !== apps.length
      || canonicalGovernanceJson(apps) !== canonicalGovernanceJson(sorted)) {
    refuse('visibility governance dev-app registry must be unique and backend-sorted', { path });
  }
  return Object.freeze({ root, path, apps: Object.freeze(apps) });
}

export function resolveRegisteredVisibilityGovernanceDevBackendRoot({
  repositoryRoot,
  appId,
  schemaHash,
  functionBundleHash,
  generationInputsHash,
} = {}) {
  if (![appId, schemaHash, functionBundleHash, generationInputsHash]
    .every((value) => typeof value === 'string' && value.length > 0)) {
    refuse('a launched backend identity must include appId and all generated identity hashes');
  }
  const registry = loadVisibilityGovernanceDevRegistry(repositoryRoot);
  const matches = [];
  for (const entry of registry.apps.filter(({ appId: candidate }) => candidate === appId)) {
    const backend = join(registry.root, entry.backend);
    const schemaPath = join(backend, 'generated', 'schema.manifest.json');
    const functionsPath = join(backend, 'generated', 'functions.manifest.json');
    if (!existsSync(schemaPath) || !existsSync(functionsPath)) continue;
    const schema = readJson(schemaPath, `registered schema for ${entry.backend}`);
    const functions = readJson(functionsPath, `registered functions for ${entry.backend}`);
    if (schema.schemaHash === schemaHash
        && functions.bundleHash === functionBundleHash
        && schema.visibilityGovernance?.generationInputsHash === generationInputsHash) {
      matches.push(backend);
    }
  }
  if (matches.length !== 1) {
    refuse('the launched generated identity must resolve to exactly one registered backend', {
      appId,
      matchCount: matches.length,
    });
  }
  return matches[0];
}

function registrationForBackend(backendRoot, repositoryRoot = null) {
  const backend = resolve(backendRoot);
  const localPath = join(backend, VISIBILITY_GOVERNANCE_DEV_REGISTRATION_FILE);
  if (existsSync(localPath)) {
    const registration = validateRegistration(
      readJson(localPath, 'backend-local visibility governance dev registration'),
      'backend-local visibility governance dev registration',
    );
    return {
      registration,
      backendIdentity: `backend-local/${registration.appId}`,
      repositoryRoot: repositoryRoot === null ? null : resolve(repositoryRoot),
      source: localPath,
    };
  }
  const root = repositoryRoot === null
    ? findRepositoryRoot(backend)
    : resolve(repositoryRoot);
  if (root === null || !existsSync(join(root, REPOSITORY_REGISTRY))) return null;
  const registry = loadVisibilityGovernanceDevRegistry(root);
  const backendIdentity = portableRelative(root, backend);
  const entry = registry.apps.find(({ backend: candidate }) => candidate === backendIdentity);
  if (!entry) return null;
  return {
    registration: Object.freeze({
      schemaVersion: VISIBILITY_GOVERNANCE_DEV_REGISTRATION_SCHEMA,
      appId: entry.appId,
      targetClass: VISIBILITY_GOVERNANCE_DEV_TARGET_CLASS,
      principalClass: 'synthetic',
      dataClassification: 'fixture-owned',
      fixtureProfiles: entry.fixtureProfiles,
    }),
    backendIdentity,
    repositoryRoot: root,
    source: registry.path,
  };
}

function loadBackendIdentity(backendRoot, { repositoryRoot = null, skipMissing = false } = {}) {
  const backend = resolve(backendRoot);
  const schemaPath = join(backend, 'generated', 'schema.manifest.json');
  const functionsPath = join(backend, 'generated', 'functions.manifest.json');
  if (!existsSync(schemaPath) || !existsSync(functionsPath)) {
    if (skipMissing) return null;
    refuse('backend must be generated before minting its visibility governance dev config', {
      backend,
      schemaPath,
      functionsPath,
    });
  }
  const schemaManifest = readJson(schemaPath, 'generated schema manifest');
  const functionManifest = readJson(functionsPath, 'generated function manifest');
  const governance = schemaManifest?.visibilityGovernance;
  if (governance === undefined || governance === null) return null;
  if (schemaManifest.targetProfile !== LOCAL_TARGET_PROFILE) {
    refuse('visibility governance dev config refuses a non-local generated target profile', {
      backend,
      targetProfile: schemaManifest.targetProfile ?? null,
    });
  }
  if (typeof schemaManifest.appId !== 'string' || schemaManifest.appId.length === 0
      || functionManifest.appId !== schemaManifest.appId
      || typeof schemaManifest.schemaHash !== 'string'
      || typeof functionManifest.bundleHash !== 'string'
      || governance.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.activation
      || !Array.isArray(governance.fixtureProfiles)
      || !Array.isArray(governance.productionWindows)
      || !SHA256.test(governance.quarantineHeadDigest ?? '')) {
    refuse('generated visibility governance identity is incomplete or malformed', { backend });
  }
  const reviewPath = join(backend, 'generated', 'authorization-review.json');
  const review = existsSync(reviewPath)
    ? readJson(reviewPath, 'generated authorization review')
    : null;
  const productionReviewEntries = (review?.visibilityOverrides ?? [])
    .filter(({ lifecycleClass }) => lifecycleClass === 'production')
    .map(({ id }) => id ?? '(unknown)');
  if (governance.productionWindows.length > 0 || productionReviewEntries.length > 0) {
    refuse('visibility governance dev config cannot mint for a backend carrying production override authority', {
      backend,
      productionWindows: governance.productionWindows.map(({ overrideId }) => overrideId),
      productionReviewEntries,
    });
  }
  const registrationRecord = registrationForBackend(backend, repositoryRoot);
  if (registrationRecord !== null
      && registrationRecord.registration.appId !== schemaManifest.appId) {
    refuse('generated appId does not match its committed visibility governance dev registration', {
      backend,
      registeredAppId: registrationRecord.registration.appId,
      generatedAppId: schemaManifest.appId,
    });
  }
  const generatedFixtureProfiles = generatedFixtureProfileSet(
    governance.fixtureProfiles,
    `generated fixture profiles for ${backend}`,
  );
  if (registrationRecord !== null
      && canonicalGovernanceJson(generatedFixtureProfiles)
        !== canonicalGovernanceJson(registrationRecord.registration.fixtureProfiles)) {
    refuse('generated fixture-profile set does not exactly match its committed app registration', {
      backend,
      registeredFixtureProfiles: registrationRecord.registration.fixtureProfiles,
      generatedFixtureProfiles,
    });
  }
  const authorityBearing = governance.required === true || governance.fixtureProfiles.length > 0;
  if (authorityBearing && registrationRecord === null) {
    refuse('authority-bearing local governance activation requires a committed dev-app registration', {
      backend,
      appId: schemaManifest.appId,
    });
  }
  const backendIdentity = registrationRecord?.backendIdentity
    ?? `unregistered-empty-closure/${schemaManifest.appId}`;
  return {
    backend,
    backendIdentity,
    registration: registrationRecord?.registration ?? null,
    schemaManifest,
    functionManifest,
    governance,
    generatedFixtureProfiles,
    identity: {
      backend: backendIdentity,
      appId: schemaManifest.appId,
      ...deploymentIdentityFromGenerated({
        schemaManifest,
        functionManifest,
        governance,
      }),
      quarantineHeadDigest: governance.quarantineHeadDigest,
    },
  };
}

function selectedFixtureProfile(backends, targetClass) {
  const profiles = backends.flatMap(({ governance }) => governance.fixtureProfiles);
  const unique = new Map(profiles.map((profile) => {
    const tuple = {
      id: profile?.id,
      digest: profile?.digest,
      targetClassCeiling: profile?.targetClassCeiling,
      principalClass: profile?.principalClass,
      dataClassification: profile?.dataClassification,
    };
    return [canonicalGovernanceJson(tuple), tuple];
  }));
  if (unique.size === 0) return null;
  if (unique.size !== 1) {
    refuse('one dev target config cannot attest multiple distinct fixture profiles', {
      profileCount: unique.size,
    });
  }
  const profile = [...unique.values()][0];
  if (profile.targetClassCeiling !== targetClass
      || profile.principalClass !== 'synthetic'
      || profile.dataClassification !== 'fixture-owned'
      || !SHA256.test(profile.digest ?? '')) {
    refuse('generated fixture profile is outside the repository-local fixture fence', { profile });
  }
  for (const backend of backends.filter(({ governance }) => governance.fixtureProfiles.length > 0)) {
    const registration = backend.registration;
    if (registration === null
        || registration.targetClass !== targetClass
        || registration.principalClass !== profile.principalClass
        || registration.dataClassification !== profile.dataClassification
        || canonicalGovernanceJson(backend.generatedFixtureProfiles)
          !== canonicalGovernanceJson([{
            id: profile.id,
            digest: profile.digest,
            targetClassCeiling: profile.targetClassCeiling,
            principalClass: profile.principalClass,
            dataClassification: profile.dataClassification,
          }])) {
      refuse('generated fixture profile does not deep-match its committed app registration', {
        backend: backend.backend,
      });
    }
  }
  return {
    id: profile.id,
    digest: profile.digest,
    targetClass,
    principalClass: profile.principalClass,
    dataClassification: profile.dataClassification,
  };
}

function rawEd25519PublicKey(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  if (der.length !== prefix.length + 32 || !der.subarray(0, prefix.length).equals(prefix)) {
    refuse('generated observer public key is not canonical Ed25519 SPKI');
  }
  return der.subarray(prefix.length);
}

function devSourceOid(payload) {
  return createHash('sha1')
    .update('snapback:visibility-governance-dev-source:v1\n')
    .update(canonicalGovernanceJson(payload))
    .digest('hex');
}

function defaultOutputPath(backendRoots, repositoryRoot) {
  if (repositoryRoot !== null) {
    return join(resolve(repositoryRoot), '.snapback', 'visibility-governance-dev-target-config.json');
  }
  return join(dirname(resolve(backendRoots[0])), '.snapback', 'visibility-governance-dev-target-config.json');
}

export function mintVisibilityGovernanceDevConfig({
  backendRoot,
  backendRoots = backendRoot === undefined ? [] : [backendRoot],
  outputPath = null,
  repositoryRoot = null,
  targetClass = VISIBILITY_GOVERNANCE_DEV_TARGET_CLASS,
  observedAt = new Date(),
  skipMissing = false,
} = {}) {
  if (targetClass !== VISIBILITY_GOVERNANCE_DEV_TARGET_CLASS) {
    refuse('visibility governance dev config refuses production, hosted, and unknown target classes', {
      targetClass,
      allowed: [VISIBILITY_GOVERNANCE_DEV_TARGET_CLASS],
    });
  }
  if (!Array.isArray(backendRoots) || backendRoots.length === 0) {
    refuse('at least one backend root is required');
  }
  const uniqueRoots = [...new Set(backendRoots.map((path) => resolve(path)))].sort();
  const loaded = uniqueRoots
    .map((path) => loadBackendIdentity(path, { repositoryRoot, skipMissing }))
    .filter((value) => value !== null);
  if (loaded.length === 0) return null;

  const identities = [];
  const seenIdentities = new Set();
  for (const backend of loaded) {
    const readerIdentity = {
      appId: backend.identity.appId,
      schemaHash: backend.identity.schemaHash,
      functionBundleHash: backend.identity.functionBundleHash,
      generationInputsHash: backend.identity.generationInputsHash,
      visibilityAuthorizationProgramDigest:
        backend.identity.visibilityAuthorizationProgramDigest,
      visibilityGovernanceActivationDigest:
        backend.identity.visibilityGovernanceActivationDigest,
      quarantineHeadDigest: backend.identity.quarantineHeadDigest,
    };
    const key = canonicalGovernanceJson(readerIdentity);
    if (seenIdentities.has(key)) continue;
    seenIdentities.add(key);
    identities.push(backend.identity);
  }
  identities.sort((left, right) => (
    `${left.appId}\u0000${left.backend}`.localeCompare(`${right.appId}\u0000${right.backend}`)
  ));
  const quarantineHeads = [...new Set(loaded.map(({ governance }) => (
    governance.quarantineHeadDigest
  )))];
  if (quarantineHeads.length !== 1) {
    refuse('one dev target config cannot attest multiple quarantine checkpoints', {
      quarantineHeads,
    });
  }
  const fixtureProfile = selectedFixtureProfile(loaded, targetClass);
  const sourceState = {
    providerProfile: VISIBILITY_GOVERNANCE_DEV_PROVIDER_PROFILE,
    targetClass,
    registrations: loaded.map(({ backendIdentity, registration }) => ({
      backend: backendIdentity,
      registration,
    })),
    deploymentIdentities: identities,
    quarantineCheckpoint: quarantineHeads[0],
    fixtureProfile,
  };
  const sourceOid = devSourceOid(sourceState);
  const eventInputDigest = governanceDigest(
    'snapback:visibility-governance-dev-event-input:v1',
    sourceState,
  );
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const observerKeyDigest = governanceDigest(
    'snapback:visibility-observer-key:v1',
    publicKeyPem,
  );
  const observerKeyEpoch = `repository-local-dev-${randomUUID()}`;
  const unsignedVerdict = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.governedUpdateVerdict,
    verdictKind: 'governedUpdateVerdict',
    disposition: 'green',
    providerProfile: VISIBILITY_GOVERNANCE_DEV_PROVIDER_PROFILE,
    eventId: `dev-mint:${eventInputDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    eventInputDigest,
    governedRef: 'refs/snapback/repository-local-dev',
    beforeOid: sourceOid,
    afterOid: sourceOid,
    observedAt: observedAt.toISOString(),
    comparatorVersion: GOVERNANCE_COMPARATOR_VERSION,
    deploymentIdentities: identities,
    quarantineHeadDigest: quarantineHeads[0],
    violation: null,
    observerKeyEpoch,
    observerKeyDigest,
  };
  const verdict = {
    ...unsignedVerdict,
    signature: signBytes(
      null,
      Buffer.from(canonicalGovernanceJson(unsignedVerdict), 'utf8'),
      privateKey,
    ).toString('base64'),
  };
  const config = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.targetConfig,
    sourceOid,
    observerKeyEpoch,
    observerKeyDigest,
    observerPublicKeyBase64: rawEd25519PublicKey(publicKey).toString('base64'),
    revokedObserverKeyEpochs: [],
    quarantineCheckpoint: quarantineHeads[0],
    targetClass,
    ...(fixtureProfile === null ? {} : { fixtureProfile }),
    verdict,
  };
  const path = resolve(outputPath ?? defaultOutputPath(uniqueRoots, repositoryRoot));
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporary, `${canonicalGovernanceJson(config)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new VisibilityGovernanceError(
      WRITE_FAILED,
      `visibility governance dev config could not be published: ${error.message}`,
      { path },
    );
  }
  return Object.freeze({
    path,
    config: Object.freeze(config),
    backends: Object.freeze(loaded.map(({ backend }) => backend)),
  });
}

export function mintRegisteredVisibilityGovernanceDevConfig({
  repositoryRoot,
  outputPath = null,
  targetClass = VISIBILITY_GOVERNANCE_DEV_TARGET_CLASS,
  observedAt = new Date(),
} = {}) {
  const registry = loadVisibilityGovernanceDevRegistry(repositoryRoot);
  return mintVisibilityGovernanceDevConfig({
    backendRoots: registry.apps.map(({ backend }) => join(registry.root, backend)),
    outputPath,
    repositoryRoot: registry.root,
    targetClass,
    observedAt,
    skipMissing: true,
  });
}

export function resolveVisibilityGovernanceServerProfile(environment, { loopback = true } = {}) {
  const rawProfile = typeof environment?.SNAPBACK_PROFILE === 'string'
    ? environment.SNAPBACK_PROFILE
    : null;
  const rawExposure = typeof environment?.SNAPBACK_EXPOSURE === 'string'
    ? environment.SNAPBACK_EXPOSURE
    : null;
  const fronted = rawExposure !== null
    && rawExposure.length > 0
    && rawExposure !== 'direct';
  if (rawProfile === 'dev' || rawProfile === 'demo' || rawProfile === 'test') return rawProfile;
  if (rawProfile === 'prod' || (rawProfile !== null && rawProfile.length > 0)) return 'prod';
  return loopback && !fronted ? 'dev' : 'prod';
}

function isRepositoryLocalDevConfig(path, outputPath) {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (outputPath !== null && resolve(path) === resolve(outputPath)) return true;
  try {
    return readJson(path, 'caller-supplied visibility governance target config')
      ?.verdict?.providerProfile === VISIBILITY_GOVERNANCE_DEV_PROVIDER_PROFILE;
  } catch {
    return false;
  }
}

export function visibilityGovernanceDevEnvironment({
  environment = process.env,
  callerEnvironment = {},
  backendRoot = null,
  repositoryRoot = null,
  outputPath = null,
  loopback = true,
} = {}) {
  const base = { ...environment };
  const serverProfile = resolveVisibilityGovernanceServerProfile(base, { loopback });
  const callerPath = callerEnvironment?.[VISIBILITY_GOVERNANCE_TARGET_CONFIG_ENV];
  if (serverProfile === 'prod') {
    if (typeof callerPath === 'string'
        && callerPath.length > 0
        && !isRepositoryLocalDevConfig(callerPath, outputPath)) {
      base[VISIBILITY_GOVERNANCE_TARGET_CONFIG_ENV] = callerPath;
      return Object.freeze({
        environment: base,
        path: callerPath,
        minted: false,
        serverProfile,
      });
    }
    delete base[VISIBILITY_GOVERNANCE_TARGET_CONFIG_ENV];
    return Object.freeze({ environment: base, path: null, minted: false, serverProfile });
  }
  if (typeof callerPath === 'string' && callerPath.length > 0) {
    base[VISIBILITY_GOVERNANCE_TARGET_CONFIG_ENV] = callerPath;
    return Object.freeze({
      environment: base,
      path: callerPath,
      minted: false,
      serverProfile,
    });
  }
  // A path inherited through process.env is ambient process state, not caller
  // custody. Replace it with a fresh mint for this exact generated identity.
  delete base[VISIBILITY_GOVERNANCE_TARGET_CONFIG_ENV];
  const minted = backendRoot === null
    ? null
    : mintVisibilityGovernanceDevConfig({ backendRoot, repositoryRoot, outputPath });
  if (minted === null) {
    return Object.freeze({ environment: base, path: null, minted: false, serverProfile });
  }
  return Object.freeze({
    environment: {
      ...base,
      [VISIBILITY_GOVERNANCE_TARGET_CONFIG_ENV]: minted.path,
    },
    path: minted.path,
    minted: true,
    serverProfile,
  });
}
