#!/usr/bin/env node

// LLP 0166 / LLP 0157 Move-2 standards-real carrier exit. This runner owns
// native process death and real browser lifecycle; unit suites remain the
// owners of the exhaustive S1-S8 state-space oracles.
//
// @ref LLP 0155#stage-0--authority-reconciliation-and-baseline-freeze — use
// the shared Chrome/CDP owner, caller-retained profile, and SIGKILL-first leg.
// @ref LLP 0166#executable-acceptance — add standards-real carrier evidence
// without upgrading a capability when a public end-to-end surface is absent.
// @ref LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle — retain
// module-own minified attribution for the first shipping store slice.

import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

import { build, version as esbuildVersion } from 'esbuild';
import { generate } from '../../packages/snapback-codegen/index.mjs';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../packages/snapback-contract/auth-coordinator.mjs';

import { launchChromeCdp } from '../../demos/_kit/chrome-process.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';
import { resolveInstalledBrowserExecutable } from '../../scripts/snapback-package-cold-install-lib.mjs';
import { SnapbackClient } from '../../packages/snapback-client/index.mjs';
import {
  createMaterializationStore,
  decodeMaterializationRecordV1,
  encodeMaterializationRecordV1,
  materializationAddressKey,
  pageIdentityDigestV1,
  resultDigestV1,
} from '../../packages/snapback-client/materialization-store.mjs';
import {
  RQS_FILE_STORE_FORMAT,
  createFileRqsResumeStore,
  createNodeFilesAdapter,
} from '../../packages/snapback-client/rqs-store-file.mjs';
import {
  rqsEntryKey,
  verifyPersistedResumeEntry,
} from '../../packages/snapback-client/rqs-store.mjs';
import {
  createStorePolicyController,
  materializationPayloadProjection,
  STORE_POLICY_CONSTANTS,
} from '../../packages/snapback-client/store-policy.mjs';
import {
  base64UrlNoPad,
  argsHash,
  digestOfRows,
  hex,
  jcsBytes,
  sha256,
} from '../../packages/snapback-client/rqs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const RUN_DATE = '2026-08-06';
const FIXTURE_DIR = join(ROOT, 'tests/acceptance/fixtures/local-persistent-store');
const latestDatedFixture = (directory, stem, pairedStem = null) => {
  const names = readdirSync(directory);
  const pairedDates = pairedStem === null
    ? null
    : new Set(names
        .map((name) => name.match(new RegExp(
          `^${pairedStem}\\.(\\d{4}-\\d{2}-\\d{2})\\.v1\\.json$`,
          'u',
        ))?.[1])
        .filter(Boolean));
  const candidates = names
    .map((name) => ({
      name,
      match: name.match(new RegExp(`^${stem}\\.(\\d{4}-\\d{2}-\\d{2})\\.v1\\.json$`, 'u')),
    }))
    .filter(({ match }) => match !== null && (
      pairedDates === null || pairedDates.has(match[1])
    ))
    .sort((left, right) => left.match[1].localeCompare(right.match[1]));
  assert.ok(candidates.length > 0, `${stem}: no dated retained fixture in ${directory}`);
  const selected = candidates.at(-1);
  return { date: selected.match[1], path: join(directory, selected.name) };
};
const retainedCarrier = process.argv.includes('--check')
  ? latestDatedFixture(FIXTURE_DIR, 'carrier-exit')
  : { date: RUN_DATE, path: join(FIXTURE_DIR, `carrier-exit.${RUN_DATE}.v1.json`) };
const DATE = retainedCarrier.date;
const RECEIPT_PATH = retainedCarrier.path;
const EVIDENCE_PATH = join(ROOT, 'tests/acceptance/local-store-carrier-exit-v1-evidence.md');
const BUNDLE_PATH = join(FIXTURE_DIR, `bundle-attribution.${DATE}.v1.json`);
const TRIAGE_FIXTURE_DIR = join(ROOT, 'tests/acceptance/fixtures/triage-graph');
const retainedTriage = latestDatedFixture(
  TRIAGE_FIXTURE_DIR,
  'move1-exit',
  'budget-freeze',
);
const TRIAGE_RECEIPT_PATH = retainedTriage.path;
const TRIAGE_BUDGET_PATH = join(
  TRIAGE_FIXTURE_DIR,
  `budget-freeze.${retainedTriage.date}.v1.json`,
);
const FLEET_FIXTURE_DIR = join(ROOT, 'tests/acceptance/fixtures/fleet-observatory');
const retainedFleet = latestDatedFixture(
  FLEET_FIXTURE_DIR,
  'move1-exit',
  'budget-freeze',
);
const FLEET_RECEIPT_PATH = retainedFleet.path;
const FLEET_BUDGET_PATH = join(
  FLEET_FIXTURE_DIR,
  `budget-freeze.${retainedFleet.date}.v1.json`,
);
const SERVER_BINARY = join(ROOT, 'target/debug/snapback');
const CHILD_MODE = process.argv[2] === '--file-child';
const encoder = new TextEncoder();
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const utf8Bytes = (value) => encoder.encode(value).byteLength;
const digest = (character) => `sha256:${character.repeat(64)}`;
const partition = (character) => digest(character);
const qmk = (label) => `qmk1.${base64UrlNoPad(sha256(encoder.encode(label)))}`;
const concat = (...parts) => {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};
const hashRecord = (domain, value) => (
  `sha256:${hex(sha256(concat(encoder.encode(domain), jcsBytes(value))))}`
);

function stableError(error) {
  return String(error?.stack ?? error);
}

function resumeEntry(version, value) {
  const args = { fixture: 'llp-0166-carrier-exit' };
  const rows = [{ _id: 'carrier-exit-row', value }];
  return {
    rows,
    meta: {
      app: 'llp-0166-carrier-exit',
      generation: 'gen1:carrier-exit',
      versionStream: 'stream:carrier-exit',
      queryArtifact: 'sha256:carrier-exit',
      argsHash: argsHash(args),
      contentDigest: digestOfRows('seq1', rows),
      version,
    },
    token: `sbrt1.carrier-exit.${version}`,
  };
}

function authorityState() {
  return {
    query_instance_id: null,
    query_lifecycle: 'active',
    authority_generation: 1,
    query_generation: 1,
    authority_instance_id: 'authority-carrier-exit',
    expected_boot_issuer: { issuer_id: 'issuer-carrier-exit', boot_sequence: 1 },
    expected_authorization: {
      incarnation: 'inc-carrier-exit',
      epoch: 1,
      version_stream: 'stream-carrier-exit',
    },
    effective_disposition: 'retain',
    accepted: null,
    retired_issuer_frontier: { incarnation: 'inc-carrier-exit', boot_sequence: 0 },
    retired_scope_frontier: null,
    pending_by_scope: {},
    scope_state: {},
  };
}

function materializationIdentity() {
  return {
    planHash: digest('1'),
    activationHash: digest('2'),
    argsDigest: digest('3'),
    authorityPartitionDigest: partition('a'),
    storageProfile: 'durable-fragments-v1',
    authorityState: authorityState(),
  };
}

function fence(record) {
  return {
    queryInstanceId: record.queryInstanceId,
    authorityGeneration: record.authorityState.authority_generation,
    queryGeneration: record.authorityState.query_generation,
  };
}

function ownerTransition(record, disposition, generation = 1) {
  return {
    authorityState: {
      ...structuredClone(record.authorityState),
      query_generation: record.authorityState.query_generation + generation,
      effective_disposition: disposition,
    },
    tombstone: { revision: record.authorityState.query_generation + generation },
  };
}

function makeSignedMaterializationFixture(label, queryInstanceId = 1) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicJwk = publicKey.export({ format: 'jwk' });
  const proofKeys = {
    format: 'snapback.completeness-proof-keys.v1',
    keys: [{
      proofKeyId: 'proof-key-1',
      algorithm: 'Ed25519',
      publicKeyBase64url: publicJwk.x,
    }],
  };
  const activation = {
    format: 'snapback.composition-activation.v1',
    databaseId: 'db-carrier-exit',
    deploymentId: 'deployment-carrier-exit',
    targetProfileId: 'native.v1',
    authMode: 'sessions',
    expectedGeneration: {
      schemaVersion: 'snapback.v1',
      appId: 'carrier-exit',
      schemaHash: 'schema-carrier-exit',
      bundleHash: 'bundle-carrier-exit',
      inputsHash: 'inputs-carrier-exit',
    },
    proofKeyManifestDigest: hashRecord('snapback:completeness-proof-keys:v1:', proofKeys),
  };
  const trustedActivation = {
    format: 'snapback.trusted-composition-activation.v1',
    activation,
    activationHash: hashRecord('snapback:composition-activation:v1:', activation),
    proofKeys,
  };
  const materializationKey = qmk(label);
  const nodes = [{
    position: 0,
    classId: 'relational_query_v1',
    classVersion: 1,
    nodePlanHash: digest('1'),
  }];
  const identities = {
    planHash: digest('2'),
    activationHash: trustedActivation.activationHash,
    argsDigest: digest('3'),
    authorityPartitionDigest: partition('a'),
    storageProfile: 'durable-fragments-v1',
    authorityState: authorityState(),
  };
  const witness = {
    format: 'snapback.authorization-witness.v1',
    queryInstanceId,
    compositeWitness: {
      authorization: { incarnation: 'inc-carrier-exit', epoch: 1 },
      data: { versionStream: 'stream-carrier-exit', minCommitVersion: 7 },
    },
  };
  const page = {
    kind: 'visible',
    input: { kind: 'first' },
    boundaryVectorDigest: digest('6'),
    output: { kind: 'terminal' },
  };
  const bytes = encoder.encode(JSON.stringify([{ _id: label, value: 'retained-browser-bytes' }]));
  const proof = {
    format: 'snapback.completeness-proof.v1',
    materializationKey,
    queryInstanceId,
    activationHash: trustedActivation.activationHash,
    planHash: identities.planHash,
    version: { stream: 'stream-carrier-exit', commit: 7 },
    authorizationWitnessDigest: hashRecord('snapback:authorization-witness:v1:', witness),
    page,
    nodes,
    batchIdentity: `sbbi1.${base64UrlNoPad(new Uint8Array(16).fill(7))}`,
    resultDigest: resultDigestV1(bytes),
    proofKeyId: 'proof-key-1',
    signature: '',
  };
  const { signature: _signature, ...unsigned } = proof;
  proof.signature = base64UrlNoPad(sign(
    null,
    Buffer.from(concat(encoder.encode('snapback:completeness-proof:v1:'), jcsBytes(unsigned))),
    privateKey,
  ));
  return {
    label,
    address: ['snapback:client-materialization-address:v1', 'carrier-exit-browser-store', materializationKey],
    identities,
    trustedActivation,
    nodes,
    resultContractHash: digest('5'),
    resultContract: { kind: 'unknown' },
    witness,
    proof,
    fragment: {
      pageIdentityDigest: pageIdentityDigestV1(page),
      resultContractHash: digest('5'),
      bytes: [...bytes],
      authorizedLeaseHash: 'lease-hash-carrier-exit',
      memberships: [{
        localRowHandle: `row-${label}`,
        materializationKey,
        pageIdentityDigest: pageIdentityDigestV1(page),
      }],
      freshness: 'retained',
    },
  };
}

async function runFileChild() {
  const [directory, operation, boundary] = process.argv.slice(3);
  if (!directory || !operation || !boundary) throw new Error('invalid file-child arguments');
  const base = createNodeFilesAdapter();
  let boundaryReported = false;
  const reportAndHang = async (name) => {
    if (boundaryReported || name !== boundary) return;
    boundaryReported = true;
    process.send?.({ type: 'boundary', boundary: name, pid: process.pid });
    await new Promise(() => {});
  };
  const files = {
    ...base,
    async rename(from, to) {
      await reportAndHang('before-rename');
      return base.rename(from, to);
    },
    async syncDirectory(path) {
      await reportAndHang('after-rename-before-directory-sync');
      return base.syncDirectory(path);
    },
  };
  const store = createFileRqsResumeStore({
    directory,
    files,
    clientStoreId: 'carrier-exit-file-store',
  });
  await store.whenLockSettled();
  if (operation === 'resume-successor') {
    await store.commit(
      rqsEntryKey('carrierExit', { fixture: 'llp-0166-carrier-exit' }),
      resumeEntry(2, 'successor-before-rename'),
    );
  } else if (operation === 'outbox-successor') {
    await store.outboxEnqueue({ id: 'intent-successor', function: 'writeSuccessor' });
  } else {
    throw new Error(`unknown file-child operation: ${operation}`);
  }
  process.send?.({ type: 'unexpected-complete' });
  await store.close();
}

if (CHILD_MODE) {
  await runFileChild();
  process.exit(0);
}

function browserHarnessSource() {
  return String.raw`
import {
  createIndexedDbRqsResumeStore,
  rqsEntryKey,
  verifyPersistedResumeEntry,
} from './packages/snapback-client/rqs-store.mjs';
import { argsHash, digestOfRows } from './packages/snapback-client/rqs.mjs';
import {
  createMaterializationStore,
  decodeMaterializationRecordV1,
  materializationAddressKey,
} from './packages/snapback-client/materialization-store.mjs';
import { createRegistrationLedger } from './packages/snapback-client/registration-ledger.mjs';
import { createDemandBroker } from './packages/snapback-client/demand-broker.mjs';
import { createStorePolicyController } from './packages/snapback-client/store-policy.mjs';
import { deriveLegacyLeaseAnswerV1 } from './packages/snapback-client/answer-classes.mjs';
import { createLocalStorageSnapbackClientStore } from './packages/snapback-contract/client-store.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const states = new Map();
const digest = (c) => 'sha256:' + c.repeat(64);
const part = digest('a');
const args = {fixture: 'llp-0166-carrier-exit'};
const entryKey = rqsEntryKey('carrierExit', args);
const entry = (version, value) => {
  const rows = [{_id: 'carrier-exit-row', value}];
  return {
    rows,
    meta: {
      app: 'llp-0166-carrier-exit', generation: 'gen1:carrier-exit',
      versionStream: 'stream:carrier-exit', queryArtifact: 'sha256:carrier-exit',
      argsHash: argsHash(args), contentDigest: digestOfRows('seq1', rows), version,
    },
    token: 'sbrt1.carrier-exit.' + version,
  };
};
const waitWriter = async (store, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (!store.isWriter()) {
    if (Date.now() >= deadline) return false;
    await delay(25);
  }
  return true;
};
const open = async (databaseName, clientStoreId = 'carrier-exit-browser-store') => {
  const store = createIndexedDbRqsResumeStore({databaseName, clientStoreId});
  await store.readStoreMeta();
  return store;
};
const fromFixture = (input, overrides = {}) => {
  const fixture = structuredClone(input);
  fixture.fragment.bytes = new Uint8Array(fixture.fragment.bytes);
  const context = {
    trustedActivation: overrides.trustedActivation ?? fixture.trustedActivation,
    planHash: fixture.identities.planHash,
    nodes: fixture.nodes,
    resultContractHash: fixture.resultContractHash,
    resultContract: fixture.resultContract,
    authorizationWitness: fixture.witness,
    authorizationWitnessOwnerProduced: true,
    retentionEligible: true,
    leaseStatus: overrides.leaseStatus ?? 'valid',
    authorizedLeaseHash: fixture.fragment.authorizedLeaseHash,
    ownerTransitionForRetainedFailure(reason, record) {
      return {
        authorityState: {
          ...structuredClone(record.authorityState),
          query_generation: record.authorityState.query_generation + 1,
          effective_disposition: reason === 'witness-newer-epoch' ? 'quarantine' : 'delete',
        },
        tombstone: {revision: record.authorityState.query_generation + 1},
      };
    },
  };
  return {...fixture, context};
};
const openMaterializations = (store, fixtureInput, options = {}) => {
  const fixture = fromFixture(fixtureInput, options);
  return createMaterializationStore(store, {
    resolveValidationContext: () => fixture.context,
    policyLimits: options.policyLimits,
  }).then((materializations) => ({fixture, materializations}));
};
const materializationRegistration = (contextId, fixture) => ({
  format: 'snapback.query-registration.v1',
  registrationId: 'reader-materialization-demand',
  source: 'active',
  ownerContext: {kind: 'subscription', contextId},
  functionReference: {materializationKey: fixture.address[2], authorityPartitionDigest: part},
  canonicalArgs: {},
  requestedScope: {kind: 'page', input: {kind: 'first'}},
  retentionRequest: 'durable',
  idleTtlClass: 'default',
});
const legacyRegistration = (contextId) => ({
  format: 'snapback.query-registration.v1',
  registrationId: 'reader-legacy-demand',
  source: 'active',
  ownerContext: {kind: 'subscription', contextId},
  functionReference: {name: 'legacyDemand', authorityPartitionDigest: part},
  canonicalArgs: {},
  requestedScope: {kind: 'page', input: {kind: 'first'}},
  retentionRequest: 'durable',
  idleTtlClass: 'default',
});
const legacyAliasKey = (value) => rqsEntryKey(value.functionReference.name, value.canonicalArgs ?? {});
const resolveRegistration = (value) => ({
  addressKey: value.functionReference.materializationKey ?? legacyAliasKey(value),
  authorityPartitionDigest: value.functionReference.authorityPartitionDigest,
});
const resolveAddress = (value, clientStoreId) => value.functionReference.materializationKey
  ? {
      family: 'qmk1',
      address: ['snapback:client-materialization-address:v1', clientStoreId, value.functionReference.materializationKey],
      addressKey: value.functionReference.materializationKey,
    }
  : {family: 'legacy-resume', address: null, addressKey: legacyAliasKey(value)};
const fenceFor = (record) => ({
  queryInstanceId: record.queryInstanceId,
  authorityGeneration: record.authorityState.authority_generation,
  queryGeneration: record.authorityState.query_generation,
});

async function seedRetainedMaterialization(databaseName, fixtureInput) {
  const store = await open(databaseName);
  if (!await waitWriter(store)) throw new Error('retained fixture writer lock not acquired');
  const {fixture, materializations} = await openMaterializations(store, fixtureInput);
  let record = await materializations.initialize(fixture.address, fixture.identities, null);
  if (record.queryInstanceId !== fixture.proof.queryInstanceId) {
    throw new Error('retained fixture query instance did not match allocation');
  }
  record = await materializations.commitPage(
    fixture.address,
    fixture.fragment,
    fixture.proof,
    null,
    fenceFor(record),
  );
  await store.close();
  return {fixture, record};
}

const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const AUTHORITY_INSTANCE = '018f0d90-7b12-7a22-8c33-445566778899';
const USER = '018f0d90-7b13-7a22-8c33-445566778899';
const AUTHORITY_KEY = digest('b');
const QUERY_KEY = 'myHand:{"gameId":"g1"}';
const VERSION_STREAM = 'stream_1';
const ACTIVATION_HASH = 'snapback.authorized-lease.activation.v1:sha256:' + 'a'.repeat(64);
const AUTHORIZATION = {incarnation: INCARNATION, epoch: 0};
const ISSUER = {authorizationIncarnation: INCARNATION, bootSequence: 1, bootNonce: 'AAAAAAAAAAAAAAAAAAAAAA'};
const EXPECTED = {authorityEpoch: 0, authorityKey: AUTHORITY_KEY};
const record = (version) => ({rows: [{card: 'ace'}], version, versionStreamId: VERSION_STREAM, cursor: {stream: VERSION_STREAM, version}});
const lease = ({storeId, queryInstanceId, requestId, version}) => ({
  protocolVersion: 1, leaseId: 'lease_' + version, leaseRequestId: requestId,
  issuerId: ISSUER, clientStoreId: storeId, queryKey: QUERY_KEY, queryInstanceId,
  principalId: USER, sessionIdAtIssue: 'session_1', providerKey: 'email-code',
  authorization: AUTHORIZATION, data: {versionStream: VERSION_STREAM, snapshotCommitVersion: version},
  activationHash: ACTIVATION_HASH, issuedAtServerMs: 10000, authorizedUntilServerMs: 11000,
  sessionNotAfterMs: 11000, providerNotAfterMs: null, authorityInstanceId: AUTHORITY_INSTANCE,
  keyId: 'lease-key-1', mac: 'A'.repeat(43),
});
async function seedContract(key) {
  localStorage.removeItem(key);
  const store = createLocalStorageSnapbackClientStore({key});
  await store.bindAuthority(EXPECTED);
  await store.scopeToArtifacts({appId: 'card-game', targetProfileId: 'local-dev-sqlite-ibex', versionStreamId: VERSION_STREAM}, EXPECTED);
  await store.scopeAuthorization({
    principalScope: {authMode: 'sessions', authorizationStreamIncarnation: INCARNATION, userId: USER},
    authorityDescriptor: {descriptorVersion: 1, authorityInstanceId: AUTHORITY_INSTANCE, sessionGeneration: 1},
  }, EXPECTED);
  const initialized = await store.initializeAuthorizedRetainedQuery(QUERY_KEY, {
    authorization: AUTHORIZATION, issuerId: ISSUER, versionStream: VERSION_STREAM,
    principalId: USER, activationHash: ACTIVATION_HASH, appId: 'card-game',
    targetProfileId: 'local-dev-sqlite-ibex',
  }, EXPECTED);
  const request = await store.beginAuthorizedLeaseRequest(QUERY_KEY, {
    fence: initialized.fence, leaseRequestId: 'request_100', clientNowMs: 1000,
  }, EXPECTED);
  const committed = await store.commitAuthorizedRetainedSnapshot(QUERY_KEY, {
    fence: request.fence,
    lease: lease({storeId: initialized.namespace.clientStoreId, queryInstanceId: initialized.namespace.queryInstanceId, requestId: request.request.leaseRequestId, version: 100}),
    record: record(100), clientNowMs: 1001,
  }, EXPECTED);
  return {store, initialized, committed};
}

const api = {
  async seedRestart(databaseName, fixtureInput) {
    const store = await open(databaseName);
    if (!await waitWriter(store)) throw new Error('writer lock not acquired');
    const {fixture, materializations} = await openMaterializations(store, fixtureInput);
    let materialization = await materializations.initialize(fixture.address, fixture.identities, null);
    if (materialization.queryInstanceId !== fixture.proof.queryInstanceId) {
      throw new Error('signed fixture query instance did not match allocation');
    }
    materialization = await materializations.commitPage(
      fixture.address,
      fixture.fragment,
      fixture.proof,
      null,
      {
        queryInstanceId: materialization.queryInstanceId,
        authorityGeneration: materialization.authorityState.authority_generation,
        queryGeneration: materialization.authorityState.query_generation,
      },
    );
    const committed = await store.commit(entryKey, entry(1, 'before-process-kill'));
    const allocated = await store.allocateQueryInstanceId();
    const ledger = await createRegistrationLedger({
      storeHandle: store,
      clientStoreId: 'carrier-exit-browser-store',
      resolveAddress,
    });
    const durable = structuredClone(materializationRegistration('unused', fixture));
    durable.registrationId = 'durable-materialization';
    durable.source = 'programmatic';
    durable.ownerContext = {kind: 'api', label: 'carrier-exit'};
    const durableRegistration = await ledger.registerDurable(durable);
    const loaded = await store.load(entryKey);
    const rendered = await materializations.readRenderable(fixture.address, {
      queryInstanceId: materialization.queryInstanceId,
      authorityGeneration: materialization.authorityState.authority_generation,
      queryGeneration: materialization.authorityState.query_generation,
    });
    const estimate = typeof navigator.storage.estimate === 'function' ? await navigator.storage.estimate() : null;
    states.set('restart', {store, fixture, materializations, materialization});
    return {
      committed,
      allocated,
      verification: verifyPersistedResumeEntry(loaded, {args}),
      materialization: {
        queryInstanceId: materialization.queryInstanceId,
        rendered: [...rendered],
        proofVerifiedByBrowserWebCrypto: true,
      },
      durableRegistration,
      estimate,
      durability: store.durability(),
    };
  },
  async reopenRestart(databaseName, fixtureInput) {
    const store = await open(databaseName);
    if (!await waitWriter(store)) throw new Error('relaunch writer lock not acquired');
    const {fixture, materializations} = await openMaterializations(store, fixtureInput);
    const loaded = await store.load(entryKey);
    const raw = await store.materializationTransaction('readonly', (view) => ({
      record: view.materializations.get(materializationAddressKey(fixture.address)),
      registration: Object.values(view.storeMeta.durableRegistrations ?? {})
        .flatMap((byId) => Object.values(byId))
        .find((entry) => entry.registrationId === 'durable-materialization') ?? null,
    }));
    const materialization = decodeMaterializationRecordV1(raw.record);
    const rendered = await materializations.readRenderable(fixture.address, {
      queryInstanceId: materialization.queryInstanceId,
      authorityGeneration: materialization.authorityState.authority_generation,
      queryGeneration: materialization.authorityState.query_generation,
    });
    const allocated = await store.allocateQueryInstanceId();
    states.set('restart', {store, fixture, materializations, materialization});
    return {
      loaded,
      verification: verifyPersistedResumeEntry(loaded, {args}),
      materialization: {
        rendered: [...rendered],
        fragments: materialization.fragments.length,
        freshness: materialization.productState.freshness,
        proofRevalidatedAtRetainedBoot: true,
      },
      durableRegistration: raw.registration,
      allocated,
      durability: store.durability(),
    };
  },
  async setupWriterBroker(databaseName, channelName) {
    const state = states.get('restart');
    const store = state && state.store ? state.store : await open(databaseName);
    if (!await waitWriter(store)) throw new Error('writer broker lacks lock');
    const meta = await store.readStoreMeta();
    const ledger = await createRegistrationLedger({storeHandle: store, clientStoreId: meta.clientStoreId, resolveAddress});
    const channel = new BroadcastChannel(channelName);
    const broker = await createDemandBroker({storeHandle: store, registrationLedger: ledger, resolveRegistration, channel, lockManager: navigator.locks, contextId: 'writer-tab'});
    const materializations = state.materializations;
    const policy = createStorePolicyController({
      storeHandle: store,
      materializationStore: materializations,
      resolveRegistration,
      limits: {materializationByteCeiling: 0},
    });
    states.set('writer', {...state, store, ledger, broker, channel, policy});
    return {writer: store.isWriter(), qualification: broker.qualification()};
  },
  async setupReaderBroker(databaseName, channelName, fixtureInput) {
    const store = await open(databaseName);
    const meta = await store.readStoreMeta();
    const ledger = await createRegistrationLedger({storeHandle: store, clientStoreId: meta.clientStoreId, resolveAddress});
    const channel = new BroadcastChannel(channelName);
    const broker = await createDemandBroker({storeHandle: store, registrationLedger: ledger, resolveRegistration, channel, lockManager: navigator.locks, contextId: 'reader-tab'});
    const fixture = fromFixture(fixtureInput);
    const announced = await broker.announce({
      authorityPartitionDigest: part,
      revision: 1,
      demands: [legacyRegistration('reader-tab'), materializationRegistration('reader-tab', fixture)],
    });
    states.set('reader', {store, ledger, broker, channel, channelName, fixture});
    return {writer: store.isWriter(), announced, qualification: broker.qualification()};
  },
  async writerDemandFacts() {
    const state = states.get('writer');
    const deadline = Date.now() + 30000;
    while (
      (state.ledger.demandState(rqsEntryKey('legacyDemand', {})) !== 'demanded-active'
        || state.ledger.demandState(state.fixture.address[2]) !== 'demanded-active')
      && Date.now() < deadline
    ) await delay(25);
    const maintenance = await state.policy.maintenance();
    const raw = await state.store.materializationTransaction('readonly', (view) => (
      decodeMaterializationRecordV1(view.materializations.get(materializationAddressKey(state.fixture.address)))
    ));
    return {
      legacyDemandState: state.ledger.demandState(rqsEntryKey('legacyDemand', {})),
      materializationDemandState: state.ledger.demandState(state.fixture.address[2]),
      pressure: maintenance,
      retainedFragmentsUnderPressure: raw.fragments.length,
    };
  },
  async readerAdoption() {
    const state = states.get('reader');
    const loaded = await state.store.load(entryKey);
    return {verification: verifyPersistedResumeEntry(loaded, {args}), version: loaded && loaded.meta && loaded.meta.version, writer: state.store.isWriter()};
  },
  async closeWriter() {
    const state = states.get('writer');
    await state.broker.close();
    await state.store.close();
    states.delete('writer');
    return {closed: true};
  },
  async readerWaitForWriter() {
    const state = states.get('reader');
    return {writer: await waitWriter(state.store)};
  },
  async readerHandoff() {
    const state = states.get('reader');
    const meta = await state.store.readStoreMeta();
    const ledger = await createRegistrationLedger({storeHandle: state.store, clientStoreId: meta.clientStoreId, resolveAddress});
    const real = new BroadcastChannel(state.channelName);
    let heldHello = null;
    const wrapper = {
      postMessage(message) {
        if (message && message.format === 'snapback.writer-hello.v1') heldHello = structuredClone(message);
        else real.postMessage(message);
      },
      addEventListener(type, listener) { real.addEventListener(type, listener); },
      removeEventListener(type, listener) { real.removeEventListener(type, listener); },
      close() { real.close(); },
    };
    const successor = await createDemandBroker({storeHandle: state.store, registrationLedger: ledger, resolveRegistration, channel: wrapper, lockManager: navigator.locks, contextId: 'reader-successor-writer'});
    const suppressionBeforeHello = await successor.suppressionActive();
    if (!heldHello) throw new Error('successor writer did not emit WriterHello');
    real.postMessage(heldHello);
    const deadline = Date.now() + 30000;
    while (
      (await successor.suppressionActive()
        || ledger.demandState(rqsEntryKey('legacyDemand', {})) !== 'demanded-active'
        || ledger.demandState(state.fixture.address[2]) !== 'demanded-active')
      && Date.now() < deadline
    ) await delay(25);
    const suppressionAfter = await successor.suppressionActive();
    const legacyDemandState = ledger.demandState(rqsEntryKey('legacyDemand', {}));
    const materializationDemandState = ledger.demandState(state.fixture.address[2]);
    const materializations = await createMaterializationStore(state.store, {
      resolveValidationContext: () => state.fixture.context,
    });
    const raw = await state.store.materializationTransaction('readonly', (view) => (
      decodeMaterializationRecordV1(view.materializations.get(materializationAddressKey(state.fixture.address)))
    ));
    const rendered = await materializations.readRenderable(state.fixture.address, {
      queryInstanceId: raw.queryInstanceId,
      authorityGeneration: raw.authorityState.authority_generation,
      queryGeneration: raw.authorityState.query_generation,
    });
    const policy = createStorePolicyController({
      storeHandle: state.store,
      materializationStore: materializations,
      resolveRegistration,
      limits: {materializationByteCeiling: 0},
    });
    const pressure = await policy.maintenance();
    await state.broker.close();
    states.set('reader', {...state, ledger, broker: successor, channel: wrapper, materializations, policy});
    return {
      suppressionBeforeHello,
      suppressionAfter,
      legacyDemandState,
      materializationDemandState,
      retainedMaterializationBytes: [...rendered],
      retainedFragmentsUnderPressure: raw.fragments.length,
      pressure,
      writerGeneration: successor.writerGeneration(),
    };
  },
  async materializationAuthorityMatrix(databasePrefix, fixtures) {
    const leaseDatabase = databasePrefix + '-lease-expiry';
    const leaseSeed = await seedRetainedMaterialization(leaseDatabase, fixtures.lease);
    const leaseStore = await open(leaseDatabase);
    if (!await waitWriter(leaseStore)) throw new Error('lease-expiry writer lock not acquired');
    const leaseBoot = await openMaterializations(leaseStore, fixtures.lease, {leaseStatus: 'expired'});
    const leaseRaw = await leaseStore.materializationTransaction('readonly', (view) => (
      decodeMaterializationRecordV1(view.materializations.get(materializationAddressKey(leaseSeed.fixture.address)))
    ));
    const leaseRendered = await leaseBoot.materializations.readRenderable(
      leaseSeed.fixture.address,
      fenceFor(leaseRaw),
    );
    await leaseStore.close();

    const artifactDatabase = databasePrefix + '-artifact-change';
    const artifactSeed = await seedRetainedMaterialization(artifactDatabase, fixtures.artifact);
    const artifactStore = await open(artifactDatabase);
    if (!await waitWriter(artifactStore)) throw new Error('artifact-change writer lock not acquired');
    const artifactBoot = await openMaterializations(artifactStore, fixtures.artifact, {
      trustedActivation: fixtures.mismatchedTrustedActivation,
    });
    const artifactRaw = await artifactStore.materializationTransaction('readonly', (view) => (
      decodeMaterializationRecordV1(view.materializations.get(materializationAddressKey(artifactSeed.fixture.address)))
    ));
    const artifactRendered = await artifactBoot.materializations.readRenderable(
      artifactSeed.fixture.address,
      fenceFor(artifactRaw),
    );
    await artifactStore.close();

    const revocationDatabase = databasePrefix + '-revocation';
    const revocationSeed = await seedRetainedMaterialization(revocationDatabase, fixtures.revocation);
    const revocationStore = await open(revocationDatabase);
    if (!await waitWriter(revocationStore)) throw new Error('revocation writer lock not acquired');
    const revocationBoot = await openMaterializations(revocationStore, fixtures.revocation);
    const revocationRawBefore = await revocationStore.materializationTransaction('readonly', (view) => (
      decodeMaterializationRecordV1(view.materializations.get(materializationAddressKey(revocationSeed.fixture.address)))
    ));
    const revoked = await revocationBoot.materializations.applyAuthorizationTransition(
      revocationSeed.fixture.address,
      {
        authorityState: {
          ...structuredClone(revocationRawBefore.authorityState),
          query_generation: revocationRawBefore.authorityState.query_generation + 1,
          effective_disposition: 'delete',
        },
        tombstone: {revision: revocationRawBefore.authorityState.query_generation + 1},
      },
    );
    const revocationRendered = await revocationBoot.materializations.readRenderable(
      revocationSeed.fixture.address,
      fenceFor(revoked),
    );
    await revocationStore.close();

    return {
      leaseExpiry: {
        suppliedLeaseStatus: 'expired',
        deleteAppliedAtRetainedBoot: leaseRaw.productState.effectiveDisposition === 'delete',
        fragments: leaseRaw.fragments.length,
        renderedBytes: leaseRendered === null ? 0 : leaseRendered.length,
      },
      artifactChange: {
        mismatchedTrustedActivation: true,
        deleteAppliedAtRetainedBoot: artifactRaw.productState.effectiveDisposition === 'delete',
        fragments: artifactRaw.fragments.length,
        renderedBytes: artifactRendered === null ? 0 : artifactRendered.length,
      },
      revocation: {
        disposition: revoked.productState.effectiveDisposition,
        fragments: revoked.fragments.length,
        renderedBytes: revocationRendered === null ? 0 : revocationRendered.length,
      },
    };
  },
  async boundedCustody(databaseName, fixtureInputs) {
    const store = await open(databaseName);
    if (!await waitWriter(store)) throw new Error('bounded-custody writer lock not acquired');
    const fixtures = fixtureInputs.map((fixture) => fromFixture(fixture));
    const byKey = new Map(fixtures.map((fixture) => [fixture.address[2], fixture]));
    const materializations = await createMaterializationStore(store, {
      resolveValidationContext: ({address}) => byKey.get(address[2]).context,
      policyLimits: {byteCeiling: 1024 * 1024, recordCeiling: 32, fragmentCeiling: 2},
    });
    const ledger = await createRegistrationLedger({
      storeHandle: store,
      clientStoreId: 'carrier-exit-browser-store',
      resolveAddress,
    });
    const commits = [];
    for (const fixture of fixtures) {
      let record = await materializations.initialize(fixture.address, fixture.identities, null);
      if (record.queryInstanceId !== fixture.proof.queryInstanceId) {
        throw new Error('churn fixture query instance did not match allocation');
      }
      record = await materializations.commitPage(
        fixture.address,
        fixture.fragment,
        fixture.proof,
        null,
        fenceFor(record),
      );
      const durable = structuredClone(materializationRegistration('unused', fixture));
      durable.registrationId = 'durable-' + fixture.label;
      durable.source = 'programmatic';
      durable.ownerContext = {kind: 'api', label: 'churn'};
      const registration = await ledger.registerDurable(durable);
      commits.push({queryInstanceId: record.queryInstanceId, registration});
    }
    const snapshot = await store.materializationTransaction('readonly', (view) => ({
      records: [...view.materializations.values()].map(decodeMaterializationRecordV1),
      meta: structuredClone(view.storeMeta),
    }));
    const payloadRecords = snapshot.records.filter((record) => record.fragments.length > 0);
    const evidence = {
      injectedLimits: {byteCeiling: 1024 * 1024, recordCeiling: 32, fragmentCeiling: 2},
      committedRecords: snapshot.records.length,
      retainedPayloadRecords: payloadRecords.length,
      retainedFragments: payloadRecords.reduce((sum, record) => sum + record.fragments.length, 0),
      compactedStubs: snapshot.records.filter((record) => record.fragments.length === 0).length,
      durableRegistrations: Object.keys(snapshot.meta.durableRegistrations).length,
      compactionCount: snapshot.meta.policyBudgetFacts.compactionCount,
      allocatorHighWater: snapshot.meta.queryInstanceIdHighWater,
      commits,
    };
    await store.close();
    return evidence;
  },
  async corruptRecovery(databaseName) {
    await new Promise((resolveDelete, rejectDelete) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolveDelete();
      request.onerror = () => rejectDelete(request.error);
    });
    const malformed = await new Promise((resolveOpen, rejectOpen) => {
      const request = indexedDB.open(databaseName, 3);
      request.onupgradeneeded = () => {
        for (const name of ['entries', 'outbox', 'materializations', 'pageSets', 'memberships', 'storeMeta']) request.result.createObjectStore(name);
        request.transaction.objectStore('storeMeta').put({malformed: true}, 'state');
      };
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    malformed.close();
    let hookSawMalformed = false;
    let random = 0;
    const store = createIndexedDbRqsResumeStore({
      databaseName, clientStoreId: 'browser-corrupt-predecessor',
      randomBytes: (length) => new Uint8Array(length).fill(++random),
      onBeforeStoreIdentityRotation: async () => {
        const db = await new Promise((resolveOpen, rejectOpen) => {
          const request = indexedDB.open(databaseName);
          request.onsuccess = () => resolveOpen(request.result);
          request.onerror = () => rejectOpen(request.error);
        });
        const tx = db.transaction(['storeMeta'], 'readonly');
        const raw = await new Promise((resolveRead, rejectRead) => {
          const request = tx.objectStore('storeMeta').get('state');
          request.onsuccess = () => resolveRead(request.result);
          request.onerror = () => rejectRead(request.error);
        });
        hookSawMalformed = raw && raw.malformed === true;
        db.close();
      },
    });
    if (!await waitWriter(store)) throw new Error('corrupt reset writer lock not acquired');
    let refusal = null;
    try { await store.readStoreMeta(); } catch (error) { refusal = error.code || String(error); }
    const reset = await store.resetCorruptStoreIdentity();
    const meta = await store.readStoreMeta();
    await store.close();
    return {refusal, hookSawMalformed, reset, formatVersion: meta.formatVersion};
  },
  async contractAuthorityMatrix() {
    const expiry = await seedContract('snapback.carrier-exit.contract.expiry');
    let expiryCode = null;
    try {
      await expiry.store.getAuthorizedRetainedQuery(QUERY_KEY, {fence: expiry.committed.fence, clientNowMs: 2000}, EXPECTED);
    } catch (error) { expiryCode = error.code || String(error); }
    const expiryState = await expiry.store.snapshot();
    const artifact = await seedContract('snapback.carrier-exit.contract.artifact');
    const beforeArtifactBytes = new TextEncoder().encode(localStorage.getItem('snapback.carrier-exit.contract.artifact')).length;
    await artifact.store.scopeToArtifacts({appId: 'card-game', targetProfileId: 'local-dev-sqlite-ibex', versionStreamId: VERSION_STREAM, schemaHash: digest('c')}, EXPECTED);
    const artifactState = await artifact.store.snapshot();
    const afterArtifactBytes = new TextEncoder().encode(localStorage.getItem('snapback.carrier-exit.contract.artifact')).length;
    const retained = await seedContract('snapback.carrier-exit.contract.retained');
    const retainedRead = await retained.store.getAuthorizedRetainedQuery(QUERY_KEY, {fence: retained.committed.fence, clientNowMs: 1500}, EXPECTED);
    const answer = deriveLegacyLeaseAnswerV1({connected: false, ownerFacts: {
      protectedRetainable: true, identityWitnessMatch: true, completeLeaseCustody: true,
      beforeDeadline: true, clockMonotone: true, cursorTargetValid: true, blockingFence: false,
    }});
    return {
      leaseExpiry: {code: expiryCode, retainedRows: Object.keys(expiryState.retained).length, disposition: expiryState.queryAuthorization[QUERY_KEY].effectiveDisposition},
      artifactChange: {retainedRows: Object.keys(artifactState.retained).length, beforeBytes: beforeArtifactBytes, afterBytes: afterArtifactBytes},
      retainedOfflineStoreLevel: {rows: retainedRead.rows.length, answer},
    };
  },
  async closeAll() {
    for (const state of states.values()) {
      try { await state.broker?.close(); } catch {}
      try { await state.store?.close(); } catch {}
      try { state.channel?.close(); } catch {}
    }
    states.clear();
    return true;
  },
};
Object.defineProperty(globalThis, 'snapbackCarrierExit', {value: Object.freeze(api)});
document.querySelector('#status').textContent = 'ready';
`;
}

async function buildBrowserHarness() {
  const result = await build({
    stdin: {
      contents: browserHarnessSource(),
      resolveDir: ROOT,
      sourcefile: 'tests/acceptance/local-store-carrier-exit-v1.browser.fixture.mjs',
      loader: 'js',
    },
    absWorkingDir: ROOT,
    bundle: true,
    conditions: ['browser', 'import', 'default'],
    define: { 'process.env.NODE_ENV': '"production"' },
    format: 'esm',
    legalComments: 'none',
    logLevel: 'silent',
    platform: 'browser',
    target: 'es2022',
    write: false,
  });
  return result.outputFiles[0].contents;
}

async function startHarnessServer(bundle) {
  const html = Buffer.from('<!doctype html><html><body><p id="status">loading</p><script type="module" src="/bundle.mjs"></script></body></html>');
  const server = createServer((request, response) => {
    if (request.url === '/' || request.url === '/index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(html);
      return;
    }
    if (request.url === '/bundle.mjs') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(bundle);
      return;
    }
    response.writeHead(404).end('not found');
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('harness server did not bind');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose())),
  };
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const settle = (id) => {
    const entry = pending.get(id);
    if (entry) clearTimeout(entry.timer);
    pending.delete(id);
    return entry;
  };
  const rejectAll = (reason) => {
    for (const id of [...pending.keys()]) settle(id)?.reject(new Error(reason));
  };
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
    if (!message.id || !pending.has(message.id)) return;
    const entry = settle(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result ?? {});
  });
  socket.addEventListener('close', () => rejectAll('CDP socket closed'));
  socket.addEventListener('error', () => rejectAll('CDP socket errored'));
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP connect failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId++;
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => {
        settle(id);
        rejectResult(new Error(`CDP command timed out: ${method}`));
      }, 60_000);
      pending.set(id, { resolve: resolveResult, reject: rejectResult, timer });
    });
  };
  return {
    close: () => socket.close(),
    async newPage(url) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      await send('Page.navigate', { url }, sessionId);
      const evaluate = async (expression) => {
        const result = await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        }, sessionId);
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        }
        return result.result?.value;
      };
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (await evaluate("typeof globalThis.snapbackCarrierExit === 'object'")) break;
        await sleep(100);
      }
      if (!await evaluate("typeof globalThis.snapbackCarrierExit === 'object'")) {
        throw new Error('browser harness did not become ready');
      }
      return {
        eval: evaluate,
        call(method, args = []) {
          return evaluate(`globalThis.snapbackCarrierExit[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
        },
        close: () => send('Target.closeTarget', { targetId }),
      };
    },
  };
}

function resolveChrome() {
  for (const candidate of [
    process.env.CHROME_PATH,
    process.env.SNAPBACK_BROWSER_EXECUTABLE,
  ]) {
    if (candidate && existsSync(candidate)) return resolve(candidate);
  }
  const browserRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browserRoot && existsSync(browserRoot)) {
    const installed = resolveInstalledBrowserExecutable(browserRoot);
    if (installed) return installed;
  }
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      ]
    : process.platform === 'linux'
      ? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
      : [];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function materializationBrowserClosureQualification() {
  const result = await build({
    entryPoints: [join(ROOT, 'packages/snapback-client/materialization-store.mjs')],
    absWorkingDir: ROOT,
    bundle: true,
    conditions: ['browser', 'import', 'default'],
    format: 'esm',
    legalComments: 'none',
    logLevel: 'silent',
    metafile: true,
    minify: true,
    platform: 'browser',
    target: 'es2022',
    write: false,
  });
  const imports = Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports ?? [])
    .map((entry) => entry.path);
  assert.equal(imports.includes('node:crypto'), false, 'browser closure retained node:crypto');
  return {
    resolved: true,
    outputBytes: result.outputFiles[0].contents.byteLength,
    externalImports: imports,
  };
}

async function launchBrowser({ chromeBin, profilePath, stopSignal }) {
  await rm(join(profilePath, 'DevToolsActivePort'), { force: true });
  const lifecycle = await launchChromeCdp({
    chromeBin,
    userDataDir: profilePath,
    stopSignal,
    startupTimeoutMs: 45_000,
    pollMs: 75,
    extraArgs: [
      '--remote-allow-origins=*',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-breakpad',
      '--disable-crash-reporter',
      '--noerrdialogs',
      '--no-sandbox',
    ],
    stopOptions: {
      graceMs: 5_000,
      processGroupTimeoutMs: 15_000,
      leaderCloseTimeoutMs: 15_000,
    },
  });
  const cdp = await connectCdp(lifecycle.ws);
  return { lifecycle, cdp };
}

async function stopBrowser(launch, signal) {
  launch.cdp.close();
  await launch.lifecycle.stop();
  return {
    pid: launch.lifecycle.pid,
    requestedSignal: signal,
    processTreeExitAttested: true,
  };
}

async function runBrowserEvidence(fixtures) {
  const chromeBin = resolveChrome();
  if (!chromeBin) {
    const error = new Error('SNAPBACK_CARRIER_EXIT_CHROME_NOT_FOUND: set CHROME_PATH to a Chrome/Chromium executable');
    error.code = 'SNAPBACK_CARRIER_EXIT_CHROME_NOT_FOUND';
    throw error;
  }
  const closure = await materializationBrowserClosureQualification();
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'snapback-carrier-exit-browser-'));
  const profilePath = join(runtimeRoot, 'retained-profile');
  await mkdir(profilePath);
  const databaseName = `snapback-carrier-exit-${sha256Hex(Buffer.from(profilePath)).slice(0, 16)}`;
  const channelName = `${databaseName}-broker`;
  let server = null;
  let first = null;
  let second = null;
  let writerPage = null;
  let readerPage = null;
  const evidence = {
    browser: {
      executable: chromeBin,
      version: execFileSync(chromeBin, ['--version'], { encoding: 'utf8' }).trim(),
      executableSha256: sha256Hex(readFileSync(chromeBin)),
    },
    profile: { callerRetained: true, reused: false, removedAfterAttestedExits: false },
    closure,
    cleanup: {},
  };
  try {
    server = await startHarnessServer(await buildBrowserHarness());
    first = await launchBrowser({ chromeBin, profilePath, stopSignal: 'SIGKILL' });
    const firstPage = await first.cdp.newPage(server.origin);
    evidence.seed = await firstPage.call('seedRestart', [databaseName, fixtures.restart]);
    assert.equal(evidence.seed.committed.persisted, true);
    assert.equal(evidence.seed.verification.ok, true);
    assert.equal(evidence.seed.materialization.proofVerifiedByBrowserWebCrypto, true);
    assert.deepEqual(evidence.seed.materialization.rendered, fixtures.restart.fragment.bytes);
    assert.deepEqual(evidence.seed.durableRegistration, { committed: true });
    assert.equal(evidence.seed.allocated, 2);
    evidence.cleanup.firstBrowser = await stopBrowser(first, 'SIGKILL');
    first = null;

    const relaunchStarted = performance.now();
    second = await launchBrowser({ chromeBin, profilePath, stopSignal: 'SIGTERM' });
    writerPage = await second.cdp.newPage(server.origin);
    evidence.relaunch = await writerPage.call('reopenRestart', [databaseName, fixtures.restart]);
    evidence.relaunch.relaunchToReadableMs = Number((performance.now() - relaunchStarted).toFixed(3));
    assert.equal(evidence.relaunch.verification.ok, true);
    assert.equal(evidence.relaunch.loaded.meta.version, 1);
    assert.deepEqual(evidence.relaunch.materialization.rendered, fixtures.restart.fragment.bytes);
    assert.equal(evidence.relaunch.materialization.fragments, 1);
    assert.equal(evidence.relaunch.materialization.freshness, 'retained');
    assert.equal(evidence.relaunch.materialization.proofRevalidatedAtRetainedBoot, true);
    assert.equal(evidence.relaunch.durableRegistration.registrationId, 'durable-materialization');
    assert.equal(evidence.relaunch.allocated, 3);
    evidence.profile.reused = true;

    evidence.twoTabs = {};
    evidence.twoTabs.writer = await writerPage.call('setupWriterBroker', [databaseName, channelName]);
    assert.equal(evidence.twoTabs.writer.writer, true);
    assert.equal(evidence.twoTabs.writer.qualification.qualified, true);
    readerPage = await second.cdp.newPage(server.origin);
    evidence.twoTabs.reader = await readerPage.call('setupReaderBroker', [databaseName, channelName, fixtures.restart]);
    assert.equal(evidence.twoTabs.reader.writer, false);
    assert.equal(evidence.twoTabs.reader.qualification.qualified, true);
    evidence.twoTabs.writerDemand = await writerPage.call('writerDemandFacts');
    assert.equal(evidence.twoTabs.writerDemand.legacyDemandState, 'demanded-active');
    assert.equal(evidence.twoTabs.writerDemand.materializationDemandState, 'demanded-active');
    assert.equal(evidence.twoTabs.writerDemand.pressure.refused, true);
    assert.deepEqual(evidence.twoTabs.writerDemand.pressure.compacted, []);
    assert.equal(evidence.twoTabs.writerDemand.retainedFragmentsUnderPressure, 1);
    evidence.twoTabs.adoption = await readerPage.call('readerAdoption');
    assert.equal(evidence.twoTabs.adoption.verification.ok, true);
    assert.equal(evidence.twoTabs.adoption.version, 1);
    assert.equal(evidence.twoTabs.adoption.writer, false);
    await writerPage.call('closeWriter');
    await writerPage.close();
    writerPage = null;
    evidence.twoTabs.takeover = await readerPage.call('readerWaitForWriter');
    assert.equal(evidence.twoTabs.takeover.writer, true);
    evidence.twoTabs.handoff = await readerPage.call('readerHandoff');
    assert.equal(evidence.twoTabs.handoff.suppressionBeforeHello, true);
    assert.equal(evidence.twoTabs.handoff.suppressionAfter, false);
    assert.equal(evidence.twoTabs.handoff.legacyDemandState, 'demanded-active');
    assert.equal(evidence.twoTabs.handoff.materializationDemandState, 'demanded-active');
    assert.deepEqual(evidence.twoTabs.handoff.retainedMaterializationBytes, fixtures.restart.fragment.bytes);
    assert.equal(evidence.twoTabs.handoff.retainedFragmentsUnderPressure, 1);
    assert.equal(evidence.twoTabs.handoff.pressure.refused, true);
    assert.deepEqual(evidence.twoTabs.handoff.pressure.compacted, []);

    const corruptDatabase = `${databaseName}-corrupt`;
    evidence.corruptRecovery = await readerPage.call('corruptRecovery', [corruptDatabase]);
    assert.equal(evidence.corruptRecovery.refusal, 'SNAPBACK_RQS_STORE_CORRUPT');
    assert.equal(evidence.corruptRecovery.hookSawMalformed, true);
    assert.equal(evidence.corruptRecovery.reset.reset, true);
    assert.notEqual(
      evidence.corruptRecovery.reset.previousClientStoreId,
      evidence.corruptRecovery.reset.clientStoreId,
    );
    assert.equal(evidence.corruptRecovery.formatVersion, 3);

    evidence.materializationAuthority = await readerPage.call('materializationAuthorityMatrix', [databaseName, fixtures.authority]);
    assert.equal(evidence.materializationAuthority.leaseExpiry.deleteAppliedAtRetainedBoot, true);
    assert.equal(evidence.materializationAuthority.leaseExpiry.fragments, 0);
    assert.equal(evidence.materializationAuthority.leaseExpiry.renderedBytes, 0);
    assert.equal(evidence.materializationAuthority.artifactChange.deleteAppliedAtRetainedBoot, true);
    assert.equal(evidence.materializationAuthority.artifactChange.fragments, 0);
    assert.equal(evidence.materializationAuthority.artifactChange.renderedBytes, 0);
    assert.equal(evidence.materializationAuthority.revocation.disposition, 'delete');
    assert.equal(evidence.materializationAuthority.revocation.fragments, 0);
    assert.equal(evidence.materializationAuthority.revocation.renderedBytes, 0);
    evidence.boundedCustody = await readerPage.call('boundedCustody', [`${databaseName}-bounded`, fixtures.churn]);
    assert.equal(evidence.boundedCustody.committedRecords, fixtures.churn.length);
    assert.equal(evidence.boundedCustody.retainedFragments, 2);
    assert.equal(evidence.boundedCustody.compactedStubs, fixtures.churn.length - 2);
    assert.equal(evidence.boundedCustody.durableRegistrations, fixtures.churn.length);
    assert.equal(evidence.boundedCustody.compactionCount, fixtures.churn.length - 2);
    assert.equal(evidence.boundedCustody.allocatorHighWater, fixtures.churn.length);
    evidence.contractAuthority = await readerPage.call('contractAuthorityMatrix');
    assert.equal(
      evidence.contractAuthority.retainedOfflineStoreLevel.answer.answerClass,
      'lease-authorized-retained',
    );
    await readerPage.call('closeAll');
    await readerPage.close();
    readerPage = null;
    evidence.cleanup.finalBrowser = await stopBrowser(second, 'SIGTERM');
    second = null;
  } finally {
    if (writerPage) {
      try { await writerPage.call('closeAll'); } catch {}
      try { await writerPage.close(); } catch {}
    }
    if (readerPage) {
      try { await readerPage.call('closeAll'); } catch {}
      try { await readerPage.close(); } catch {}
    }
    if (first) {
      try { evidence.cleanup.firstBrowser = await stopBrowser(first, 'SIGKILL'); } catch (error) { evidence.cleanup.firstBrowserError = stableError(error); }
    }
    if (second) {
      try { evidence.cleanup.finalBrowser = await stopBrowser(second, 'SIGTERM'); } catch (error) { evidence.cleanup.finalBrowserError = stableError(error); }
    }
    if (server) {
      try { await server.close(); evidence.cleanup.harnessServerClosed = true; } catch (error) { evidence.cleanup.harnessServerError = stableError(error); }
    }
    const exitsAttested = evidence.cleanup.firstBrowser?.processTreeExitAttested === true
      && evidence.cleanup.finalBrowser?.processTreeExitAttested === true;
    if (exitsAttested) {
      await rm(profilePath, { recursive: true, force: true });
      evidence.profile.removedAfterAttestedExits = !existsSync(profilePath);
    }
    await rm(runtimeRoot, { recursive: true, force: true });
  }
  assert.equal(evidence.cleanup.firstBrowser?.processTreeExitAttested, true);
  assert.equal(evidence.cleanup.finalBrowser?.processTreeExitAttested, true);
  assert.equal(evidence.profile.removedAfterAttestedExits, true);
  return evidence;
}

async function spawnCrashChild(directory, operation, boundary) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--file-child', directory, operation, boundary], {
    cwd: ROOT,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_000); });
  const observation = await new Promise((resolveObservation, rejectObservation) => {
    const timer = setTimeout(() => rejectObservation(new Error(`file child did not reach ${boundary}: ${stderr}`)), 60_000);
    child.on('message', (message) => {
      if (message?.type !== 'boundary') return;
      clearTimeout(timer);
      resolveObservation(message);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      rejectObservation(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      rejectObservation(new Error(`file child exited before boundary (${code ?? signal}): ${stderr}`));
    });
  });
  if (process.platform === 'win32') child.kill('SIGKILL');
  else process.kill(-child.pid, 'SIGKILL');
  const exit = await new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })));
  assert.equal(exit.signal, 'SIGKILL');
  return { ...observation, exit, leaderExitObserved: true, detachedChildHadNoDescendants: true };
}

async function reopenFileCarrier(directory) {
  const store = createFileRqsResumeStore({ directory, clientStoreId: 'carrier-exit-file-store' });
  await store.whenLockSettled();
  assert.equal(store.isWriter(), true);
  return store;
}

async function runFileCrashEvidence() {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-carrier-exit-file-crash-'));
  const key = rqsEntryKey('carrierExit', { fixture: 'llp-0166-carrier-exit' });
  try {
    let store = await reopenFileCarrier(directory);
    const firstAllocation = await store.allocateQueryInstanceId();
    assert.equal(firstAllocation, 1);
    assert.equal((await store.commit(key, resumeEntry(1, 'prior-state'))).persisted, true);
    await store.outboxEnqueue({ id: 'intent-prior', function: 'writePrior' });
    await store.close();

    const beforeRename = await spawnCrashChild(directory, 'resume-successor', 'before-rename');
    store = await reopenFileCarrier(directory);
    const afterPriorCut = await store.load(key);
    const pendingAfterPriorCut = await store.outboxPending();
    const allocationAfterPriorCut = await store.allocateQueryInstanceId();
    assert.equal(verifyPersistedResumeEntry(afterPriorCut, { args: { fixture: 'llp-0166-carrier-exit' } }).ok, true);
    assert.equal(afterPriorCut.meta.version, 1);
    assert.deepEqual(pendingAfterPriorCut.map((entry) => entry.id), ['intent-prior']);
    assert.equal(allocationAfterPriorCut, 2);
    await store.close();

    const afterRename = await spawnCrashChild(directory, 'outbox-successor', 'after-rename-before-directory-sync');
    store = await reopenFileCarrier(directory);
    const afterSuccessorCut = await store.load(key);
    const pendingAfterSuccessorCut = await store.outboxPending();
    const allocationAfterSuccessorCut = await store.allocateQueryInstanceId();
    assert.equal(verifyPersistedResumeEntry(afterSuccessorCut, { args: { fixture: 'llp-0166-carrier-exit' } }).ok, true);
    assert.equal(afterSuccessorCut.meta.version, 1);
    assert.deepEqual(pendingAfterSuccessorCut.map((entry) => entry.id), ['intent-prior', 'intent-successor']);
    assert.equal(allocationAfterSuccessorCut, 3);
    const blob = (await readdir(directory)).find((name) => name.endsWith('.v1.json'));
    const physicalBytes = (await stat(join(directory, blob))).size;
    await store.close();
    return {
      directoryCarrier: 'file-v3-atomic-replace',
      boundaries: [beforeRename, afterRename],
      priorCut: {
        observedVersion: afterPriorCut.meta.version,
        pendingIntentIds: pendingAfterPriorCut.map((entry) => entry.id),
        nextAllocatedQueryInstanceId: allocationAfterPriorCut,
      },
      successorCut: {
        observedVersion: afterSuccessorCut.meta.version,
        pendingIntentIds: pendingAfterSuccessorCut.map((entry) => entry.id),
        nextAllocatedQueryInstanceId: allocationAfterSuccessorCut,
      },
      physicalBlobBytes: physicalBytes,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const LOGOUT_BRIDGE_INCARNATION = '018f0d90-7b21-7a22-8c33-445566778899';
const LOGOUT_BRIDGE_SESSION = '018f0d90-7b22-7a22-8c33-445566778899';
const LOGOUT_BRIDGE_USER = '018f0d90-7b23-7a22-8c33-445566778899';
const LOGOUT_BRIDGE_AUTHORITY = '018f0d90-7b24-7a22-8c33-445566778899';
const LOGOUT_BRIDGE_BEARER = 'sbs_carrier_exit_logout_v3';
const LOGOUT_BRIDGE_APP = 'snapback.test/carrier-exit-logout-v3';

function logoutBridgeHandshake(authenticated) {
  return {
    protocolVersion: 1,
    serverStartupNonce: 'carrier-exit-logout-v3',
    authorizationStreamIncarnation: LOGOUT_BRIDGE_INCARNATION,
    transitionGeneration: 0,
    activeMode: 'sessions',
    desiredMode: 'sessions',
    modeState: 'settled',
    appDataAvailability: 'available',
    quarantineCode: null,
    clientProtocols: {
      authClient: 1,
      authInvalidation: null,
      authorityDescriptor: 1,
      authorizedLease: null,
    },
    availability: {
      onlineRequestResponse: { available: true, reason: null },
      authScopedLive: {
        available: false,
        minimumAuthInvalidationProtocol: 1,
        reason: 'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_REQUIRED',
      },
      retainedReads: {
        available: false,
        minimumAuthInvalidationProtocol: 1,
        minimumAuthorizedLeaseProtocol: 1,
        reason: 'SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE',
      },
      queuedReplay: {
        available: true,
        minimumAuthorityDescriptorProtocol: 1,
        reason: null,
      },
    },
    provider: { key: 'email-code', available: true },
    transports: ['bearer'],
    authority: authenticated
      ? {
          kind: 'humanSession',
          userId: LOGOUT_BRIDGE_USER,
          sessionId: LOGOUT_BRIDGE_SESSION,
          isAuthenticated: true,
        }
      : { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false },
    authorityDescriptor: {
      descriptorVersion: 1,
      authorityInstanceId: authenticated
        ? LOGOUT_BRIDGE_AUTHORITY
        : LOGOUT_BRIDGE_INCARNATION,
      sessionGeneration: authenticated ? 1 : 0,
    },
    deploymentIdentity: {
      schemaVersion: 'snapback.v1',
      authMode: 'sessions',
      appId: LOGOUT_BRIDGE_APP,
      schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
      bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
      inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
    },
    authorizedLease: null,
  };
}

function logoutBridgeCredential() {
  const now = Date.now();
  return {
    tokenType: 'Bearer',
    token: LOGOUT_BRIDGE_BEARER,
    refreshAfter: now + 60_000,
    session: {
      id: LOGOUT_BRIDGE_SESSION,
      userId: LOGOUT_BRIDGE_USER,
      provider: 'email-code',
      createdAt: now,
      expiresAt: now + 120_000,
      absoluteExpiresAt: now + 240_000,
    },
    authorityDescriptor: {
      descriptorVersion: 1,
      authorityInstanceId: LOGOUT_BRIDGE_AUTHORITY,
      sessionGeneration: 1,
    },
  };
}

async function logoutBridgeResidentSnapshot(store, key) {
  return {
    retainedEntryPresent: await store.load(key) !== null,
    pendingOutboxIds: (await store.outboxPending()).map((record) => record.id),
    sections: await store.materializationTransaction('readonly', (view) => ({
      materializations: view.materializations.size,
      pageSets: view.pageSets.size,
      memberships: view.memberships.size,
    })),
  };
}

async function runPublicLogoutBridgeEvidence() {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-carrier-exit-logout-v3-'));
  const key = rqsEntryKey('logoutBridge', { fixture: 'llp-0166-carrier-exit' });
  const store = createFileRqsResumeStore({
    directory,
    identity: 'logout-owner',
    clientStoreId: 'carrier-exit-logout-v3-store',
  });
  let client = null;
  const originalFetch = globalThis.fetch;
  try {
    await store.whenLockSettled();
    assert.equal(store.isWriter(), true);
    let wipeCalls = 0;
    let logoutPosted = false;
    let clearedBeforeAnonymousResume = false;
    const injectedStore = Object.create(store);
    injectedStore.wipeForAuthorityTransition = async () => {
      wipeCalls += 1;
      return store.wipeForAuthorityTransition();
    };
    injectedStore.wipeForAuthorityTransitionWithinDispatch = async (...args) => {
      wipeCalls += 1;
      return store.wipeForAuthorityTransitionWithinDispatch(...args);
    };
    const coordinator = new AuthCoordinator({
      appId: LOGOUT_BRIDGE_APP,
      storage: createMemoryAuthCustodyStorage(),
      broadcastChannelFactory: null,
      hintStorage: null,
    });
    client = new SnapbackClient('https://carrier-exit-logout.test', {
      authCoordinator: coordinator,
      authClientProtocol: 1,
      authorityDescriptorProtocol: 1,
      rqsStore: injectedStore,
      offlineQueue: false,
    });
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      const headers = new Headers(init.headers);
      if (path === '/auth/session') {
        const authenticated = headers.get('authorization')
          === `Bearer ${LOGOUT_BRIDGE_BEARER}`;
        if (logoutPosted) {
          const snapshot = await logoutBridgeResidentSnapshot(store, key);
          assert.equal(authenticated, false);
          // LLP 0043 sessions-custody queue (2026-08-06): the authority
          // transition clears resident state atomically, while queue bytes
          // are reconciled by the per-record custody matrix between this
          // successor handshake and publication — the unattributable pending
          // record is still present here and privacy-deleted before
          // authLogout returns.
          assert.deepEqual(snapshot, {
            retainedEntryPresent: false,
            pendingOutboxIds: ['logout-v3-pending'],
            sections: { materializations: 0, pageSets: 0, memberships: 0 },
          });
          clearedBeforeAnonymousResume = true;
        }
        return Response.json(logoutBridgeHandshake(authenticated));
      }
      if (path === '/auth/exchange') return Response.json(logoutBridgeCredential());
      if (path === '/auth/logout') {
        assert.equal(headers.get('authorization'), `Bearer ${LOGOUT_BRIDGE_BEARER}`);
        logoutPosted = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected logout bridge request: ${init.method ?? 'GET'} ${path}`);
    };

    await client.authExchange({ challengeId: 'carrier-exit-logout', code: '123456' });
    assert.equal(await store.allocateQueryInstanceId(), 1);
    assert.equal(await store.allocateQueryInstanceId(), 2);
    const initialMeta = await store.readStoreMeta();
    await store.writeStoreMeta({
      ...initialMeta,
      generationCounters: {
        writerGeneration: 9,
        authorityGenerationHighWater: 7,
        queryGenerationHighWater: 8,
      },
      durableRegistrations: { logout: { source: 'programmatic' } },
      policyBudgetFacts: { logicalBytes: 123 },
      brokerRoster: { context: { revision: 4 } },
      fenceHighWaters: { qmk: 11 },
      tombstoneHighWaters: { qmk: 12 },
      barrierHighWaters: { authority: 13 },
    });
    assert.equal((await store.commit(key, resumeEntry(1, 'logout-predecessor'))).persisted, true);
    await store.outboxEnqueue({ id: 'logout-v3-pending', function: 'writePredecessor' });
    await store.materializationTransaction('readwrite', (view) => {
      view.materializations.set('logout-v3-materialization', { occupied: true });
      view.pageSets.set('logout-v3-page-set', { occupied: true });
      view.memberships.set('logout-v3-membership', { occupied: true });
    });
    const before = await store.readStoreMeta();
    assert.deepEqual(await logoutBridgeResidentSnapshot(store, key), {
      retainedEntryPresent: true,
      pendingOutboxIds: ['logout-v3-pending'],
      sections: { materializations: 1, pageSets: 1, memberships: 1 },
    });

    const sibling = createFileRqsResumeStore({
      directory,
      identity: 'logout-sibling',
      clientStoreId: 'carrier-exit-logout-v3-sibling',
    });
    await sibling.whenLockSettled();
    const siblingStoreId = (await sibling.readStoreMeta()).clientStoreId;
    assert.equal((await sibling.commit('sibling-entry', resumeEntry(1, 'sibling'))).persisted, true);
    await sibling.outboxEnqueue({ id: 'sibling-pending', function: 'writeSibling' });
    await sibling.close();
    const blobsBefore = (await readdir(directory)).filter((name) => name.endsWith('.v1.json'));
    assert.equal(blobsBefore.length, 2);

    const wipeCallsBeforeLogout = wipeCalls;
    assert.equal(await client.authLogout(), null);
    assert.equal(wipeCalls, wipeCallsBeforeLogout + 1);
    assert.equal(clearedBeforeAnonymousResume, true);
    // The custody reconciliation ran inside the transition barrier: the
    // unattributable queue record is privacy-deleted before publication.
    assert.deepEqual(await store.outboxPending(), []);
    const after = await store.readStoreMeta();
    assert.equal(after.clientStoreId, before.clientStoreId);
    assert.equal(after.queryInstanceIdHighWater, before.queryInstanceIdHighWater);
    assert.deepEqual(after.generationCounters, before.generationCounters);
    assert.deepEqual(after.fenceHighWaters, before.fenceHighWaters);
    assert.deepEqual(after.tombstoneHighWaters, before.tombstoneHighWaters);
    assert.deepEqual(after.barrierHighWaters, before.barrierHighWaters);
    assert.deepEqual(after.durableRegistrations, {});
    assert.deepEqual(after.policyBudgetFacts, {});
    assert.deepEqual(after.brokerRoster, {});
    assert.notEqual(after.handleKey, before.handleKey);
    const nextAllocation = await store.allocateQueryInstanceId();
    assert.equal(nextAllocation, 3);
    const blobsAfter = (await readdir(directory)).filter((name) => name.endsWith('.v1.json'));
    assert.equal(blobsAfter.length, 1);

    const reopenedSibling = createFileRqsResumeStore({
      directory,
      identity: 'logout-sibling',
    });
    await reopenedSibling.whenLockSettled();
    const reopenedSiblingStoreId = (await reopenedSibling.readStoreMeta()).clientStoreId;
    assert.notEqual(reopenedSiblingStoreId, siblingStoreId);
    assert.equal(await reopenedSibling.load('sibling-entry'), null);
    assert.deepEqual(await reopenedSibling.outboxPending(), []);
    await reopenedSibling.close();

    return {
      publicMethod: 'SnapbackClient.authLogout',
      transitionParticipant: 'AuthCoordinator.commitDurable',
      nodeLevelBridge: true,
      pageLevelBridge: false,
      wipeCallsDuringLogout: wipeCalls - wipeCallsBeforeLogout,
      retainedAndOutboxClearedBeforeAnonymousResume: clearedBeforeAnonymousResume,
      clientStoreIdPreserved: after.clientStoreId === before.clientStoreId,
      allocatorHighWaterPreserved: after.queryInstanceIdHighWater
        === before.queryInstanceIdHighWater,
      generationHighWatersPreserved: JSON.stringify(after.generationCounters)
        === JSON.stringify(before.generationCounters),
      fenceTombstoneBarrierHighWatersPreserved: [
        'fenceHighWaters',
        'tombstoneHighWaters',
        'barrierHighWaters',
      ].every((slot) => JSON.stringify(after[slot]) === JSON.stringify(before[slot])),
      storeMetaPolicyProjectionCleared: [
        'durableRegistrations',
        'policyBudgetFacts',
        'brokerRoster',
      ].every((slot) => Object.keys(after[slot]).length === 0),
      handleKeyRotated: after.handleKey !== before.handleKey,
      nextAllocatedQueryInstanceId: nextAllocation,
      siblingIdentityBlobs: { before: blobsBefore.length, after: blobsAfter.length },
      destroyedSiblingReopenedWithFreshIdentity: reopenedSiblingStoreId !== siblingStoreId,
    };
  } finally {
    globalThis.fetch = originalFetch;
    try { await client?.closeAuth(); } catch {}
    try { await store.close(); } catch {}
    await rm(directory, { recursive: true, force: true });
  }
}

async function runFileAuthorityEvidence() {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-carrier-exit-authority-'));
  try {
    const anon = createFileRqsResumeStore({
      directory,
      clientStoreId: 'authority-anon-store',
    });
    await anon.whenLockSettled();
    const key = rqsEntryKey('authorityFixture', {});
    await anon.commit(key, resumeEntry(1, 'anonymous-predecessor'));
    const anonId = (await anon.readStoreMeta()).clientStoreId;
    await anon.close();

    const user = createFileRqsResumeStore({
      directory,
      identity: 'user-42',
      clientStoreId: 'authority-user-store',
    });
    await user.whenLockSettled();
    await user.commit(key, resumeEntry(2, 'user-predecessor'));
    const beforeWipe = await user.readStoreMeta();
    const blobsBefore = (await readdir(directory)).filter((name) => name.endsWith('.v1.json')).sort();
    assert.equal(blobsBefore.length, 2);
    assert.equal(await user.wipe(), true);
    const afterWipe = await user.readStoreMeta();
    const blobsAfter = (await readdir(directory)).filter((name) => name.endsWith('.v1.json')).sort();
    assert.equal(blobsAfter.length, 1);
    assert.equal(afterWipe.clientStoreId, beforeWipe.clientStoreId);
    assert.notEqual(afterWipe.handleKey, beforeWipe.handleKey);
    assert.equal(await user.load(key), null);
    await user.close();

    const reopenedAnon = createFileRqsResumeStore({ directory });
    await reopenedAnon.whenLockSettled();
    assert.equal(await reopenedAnon.load(key), null);
    const reopenedAnonId = (await reopenedAnon.readStoreMeta()).clientStoreId;
    assert.notEqual(reopenedAnonId, anonId);
    await reopenedAnon.close();

    const revocation = createFileRqsResumeStore({
      directory,
      identity: 'revocation',
      clientStoreId: 'revocation-store',
    });
    await revocation.whenLockSettled();
    const materializations = await createMaterializationStore(revocation);
    const address = ['snapback:client-materialization-address:v1', 'revocation-store', qmk('revocation')];
    let record = await materializations.initialize(address, materializationIdentity(), null);
    record = await materializations.applyAuthorizationTransition(
      address,
      ownerTransition(record, 'quarantine'),
    );
    assert.equal(record.productState.effectiveDisposition, 'quarantine');
    const revocationStored = decodeMaterializationRecordV1(await revocation.materializationTransaction(
      'readonly',
      (view) => view.materializations.get(materializationAddressKey(address)),
    ));
    assert.equal(revocationStored.productState.effectiveDisposition, 'quarantine');
    await revocation.close();

    const corruptDirectory = await mkdtemp(join(tmpdir(), 'snapback-carrier-exit-file-corrupt-'));
    try {
      const corruptPath = join(corruptDirectory, 'rqs-anonymous.v1.json');
      const corruptBytes = '{ carrier-exit unparseable predecessor';
      await writeFile(corruptPath, corruptBytes);
      let hookSawOriginal = false;
      let random = 0;
      const corrupt = createFileRqsResumeStore({
        directory: corruptDirectory,
        clientStoreId: 'file-corrupt-predecessor',
        randomBytes: (length) => new Uint8Array(length).fill(++random),
        onBeforeStoreIdentityRotation: async () => {
          hookSawOriginal = (await readFile(corruptPath, 'utf8')) === corruptBytes;
        },
      });
      await corrupt.whenLockSettled();
      let refusal = null;
      try { await corrupt.readStoreMeta(); } catch (error) { refusal = error.code ?? String(error); }
      assert.equal(refusal, 'SNAPBACK_RQS_STORE_CORRUPT');
      assert.equal(await corrupt.wipe(), false);
      assert.equal(await readFile(corruptPath, 'utf8'), corruptBytes);
      const reset = await corrupt.resetCorruptStoreIdentity();
      assert.equal(reset.reset, true);
      assert.equal(hookSawOriginal, true);
      assert.notEqual(reset.previousClientStoreId, reset.clientStoreId);
      const replacement = JSON.parse(await readFile(corruptPath, 'utf8'));
      assert.equal(replacement.format, RQS_FILE_STORE_FORMAT);
      await corrupt.close();
      return {
        userSwitch: {
          blobsBefore: blobsBefore.length,
          blobsAfter: blobsAfter.length,
          wipingIdentityPreserved: afterWipe.clientStoreId === beforeWipe.clientStoreId,
          handleKeyRotated: afterWipe.handleKey !== beforeWipe.handleKey,
          destroyedSiblingReopenedWithFreshIdentity: reopenedAnonId !== anonId,
        },
        revocation: {
          effectiveDisposition: revocationStored.productState.effectiveDisposition,
          queryGeneration: revocationStored.authorityState.query_generation,
        },
        corruptRecovery: {
          refusal,
          ordinaryWipeRefused: true,
          originalBytesSeenByBarrierHook: hookSawOriginal,
          storeIdentityRotated: reset.previousClientStoreId !== reset.clientStoreId,
          replacementFormat: replacement.format,
        },
      };
    } finally {
      await rm(corruptDirectory, { recursive: true, force: true });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function registration({ id, source, ttl = 'default' }) {
  return {
    format: 'snapback.query-registration.v1',
    registrationId: id,
    source,
    ownerContext: source === 'active'
      ? { kind: 'subscription', contextId: `context-${id}` }
      : { kind: 'api', label: id },
    functionReference: { plan: 'carrier-exit' },
    canonicalArgs: { id },
    requestedScope: { kind: 'page', input: { kind: 'first' } },
    retentionRequest: 'durable',
    idleTtlClass: ttl,
  };
}

async function runFileCustodyEvidence() {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-carrier-exit-custody-'));
  try {
    const handle = createFileRqsResumeStore({
      directory,
      clientStoreId: 'custody-store',
    });
    await handle.whenLockSettled();
    const materializations = await createMaterializationStore(handle);
    const records = new Map();
    const labels = ['undemanded-a', 'undemanded-b', 'undemanded-c', 'undemanded-d', 'idle', 'pinned', 'active'];
    for (let index = 0; index < STORE_POLICY_CONSTANTS.materializationRecordCeiling; index += 1) {
      const label = labels[index] ?? `stub-${String(index).padStart(3, '0')}`;
      const address = ['snapback:client-materialization-address:v1', 'custody-store', qmk(label)];
      const record = await materializations.initialize(address, materializationIdentity(), null);
      records.set(label, { address, addressKey: address[2], record });
    }
    let capCode = null;
    try {
      await materializations.initialize(
        ['snapback:client-materialization-address:v1', 'custody-store', qmk('over-record-cap')],
        materializationIdentity(),
        null,
      );
    } catch (error) { capCode = error.code ?? String(error); }
    assert.equal(capCode, 'SNAPBACK_MATERIALIZATION_BUDGET_EXCEEDED');

    const legacyKey = rqsEntryKey('legacyEnvelope', { unchanged: true });
    const legacy = resumeEntry(7, 'legacy-envelope-untouched');
    assert.equal((await handle.commit(legacyKey, legacy)).persisted, true);

    let clock = 10_000;
    const policy = createStorePolicyController({
      storeHandle: handle,
      materializationStore: materializations,
      now: () => clock,
    });
    const update = (label, registrations, lastEstablishmentAt = 0) => policy.updateRegistrationSet({
      addressKey: records.get(label).addressKey,
      authorityPartitionDigest: partition('a'),
      registrations,
      lastEstablishmentAt,
    });
    for (const label of ['undemanded-a', 'undemanded-b', 'undemanded-c', 'undemanded-d']) {
      await update(label, [registration({ id: label, source: 'programmatic' })]);
      await update(label, []);
    }
    await update('idle', [registration({ id: 'idle', source: 'programmatic' })], 1);
    await update('pinned', [registration({ id: 'pinned', source: 'programmatic', ttl: 'pinned' })], 0);
    await update('active', [registration({ id: 'active', source: 'active', ttl: 'none' })], 0);

    const mebibyte = 1024 * 1024;
    await handle.materializationTransaction('readwrite', (view) => {
      for (const label of labels) {
        const item = records.get(label);
        const key = materializationAddressKey(item.address);
        const record = decodeMaterializationRecordV1(view.materializations.get(key));
        const payloadBytes = label === 'active' ? 31 * mebibyte : mebibyte;
        const proof = {
          format: 'snapback.completeness-proof.v1',
          materializationKey: item.address[2],
          queryInstanceId: record.queryInstanceId,
          activationHash: record.activationHash,
          planHash: record.planHash,
          version: { stream: 'stream-carrier-exit', commit: 1 },
          authorizationWitnessDigest: digest('4'),
          page: {
            kind: 'visible', input: { kind: 'first' },
            boundaryVectorDigest: digest('5'), output: { kind: 'terminal' },
          },
          nodes: [{ position: 0, classId: 'relational_query_v1', classVersion: 1, nodePlanHash: digest('6') }],
          batchIdentity: `sbbi1.${base64UrlNoPad(new Uint8Array(16))}`,
          resultDigest: digest('7'),
          proofKeyId: 'carrier-exit-key',
          signature: base64UrlNoPad(new Uint8Array(64)),
        };
        record.fragments.push({
          pageIdentityDigest: digest('8'),
          resultContractHash: digest('9'),
          bytes: new Uint8Array(payloadBytes).fill(label.charCodeAt(0)),
          proof,
          authorizedLeaseHash: null,
        });
        view.materializations.set(key, encodeMaterializationRecordV1(record));
      }
    });
    const blobName = (await readdir(directory)).find((name) => name.endsWith('.v1.json'));
    const blobPath = join(directory, blobName);
    const physicalBytesBefore = (await stat(blobPath)).size;
    const inspectionBefore = await policy.inspection({ authorityPartitionDigest: partition('a') });
    const materializationBudgetBefore = inspectionBefore.budgets.find((entry) => entry.section === 'materializations');
    assert.ok(materializationBudgetBefore.logicalBytes > STORE_POLICY_CONSTANTS.materializationByteCeiling);
    clock += 1;
    const maintenanceStarted = performance.now();
    const maintenance = await policy.maintenance();
    const maintenanceMs = Number((performance.now() - maintenanceStarted).toFixed(3));
    const inspectionAfter = await policy.inspection({ authorityPartitionDigest: partition('a') });
    const materializationBudgetAfter = inspectionAfter.budgets.find((entry) => entry.section === 'materializations');
    const physicalBytesAfter = (await stat(blobPath)).size;
    const expectedUndemanded = ['undemanded-a', 'undemanded-b', 'undemanded-c', 'undemanded-d']
      .map((label) => records.get(label).addressKey)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    assert.deepEqual(maintenance.compacted.slice(0, expectedUndemanded.length), expectedUndemanded);
    assert.equal(maintenance.compacted.at(-2), records.get('idle').addressKey);
    assert.equal(maintenance.compacted.at(-1), records.get('pinned').addressKey);
    assert.equal(maintenance.refused, false);
    assert.ok(materializationBudgetAfter.logicalBytes <= STORE_POLICY_CONSTANTS.materializationByteCeiling);
    assert.equal(materializationBudgetAfter.recordCount, STORE_POLICY_CONSTANTS.materializationRecordCeiling);
    const activeInspection = inspectionAfter.addresses.find((entry) => entry.addressKey === records.get('active').addressKey);
    assert.equal(activeInspection.compacted, false);
    const legacyAfter = await handle.load(legacyKey);
    assert.deepEqual(legacyAfter.rows, legacy.rows);
    assert.deepEqual(legacyAfter.meta, legacy.meta);
    assert.equal(legacyAfter.token, legacy.token);
    assert.equal(verifyPersistedResumeEntry(
      legacyAfter,
      { args: { fixture: 'llp-0166-carrier-exit' } },
    ).ok, true);
    const raw = await handle.materializationTransaction('readonly', (view) => ({
      records: view.materializations.size,
      memberships: view.memberships.size,
      activePayload: materializationPayloadProjection(
        view.materializations.get(materializationAddressKey(records.get('active').address)),
      ).logicalBytes,
    }));
    await handle.close();
    return {
      limits: STORE_POLICY_CONSTANTS,
      attemptedMaterializations: STORE_POLICY_CONSTANTS.materializationRecordCeiling + 1,
      retainedMaterializationRecords: raw.records,
      recordCapRefusal: capCode,
      logicalBytesBefore: materializationBudgetBefore.logicalBytes,
      logicalBytesAfter: materializationBudgetAfter.logicalBytes,
      physicalBytesBefore,
      physicalBytesAfter,
      compactedAddressKeys: maintenance.compacted,
      compactionOrder: {
        undemandedAddressByteOrder: expectedUndemanded,
        thenIdle: records.get('idle').addressKey,
        thenPinned: records.get('pinned').addressKey,
        activePreserved: records.get('active').addressKey,
      },
      activePayloadBytes: raw.activePayload,
      membershipRecordsAfter: raw.memberships,
      legacyEnvelope: {
        verified: true,
        version: legacyAfter.meta.version,
        token: legacyAfter.token,
      },
      maintenanceMs,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// P2's former GAP leg: create one retainable relational application, prepare
// the P1 activation from this worktree's server-owned keyring, seed through a
// live public client, stop that exact backend, and open a new public client on
// the same file-v3 carrier. No receipt or materialization is hand-authored.
async function runRetainedRenderBackendEvidence() {
  if (!existsSync(SERVER_BINARY)) {
    throw new Error(`SNAPBACK_CARRIER_EXIT_SERVER_BINARY_MISSING: ${SERVER_BINARY}`);
  }
  const scratch = await mkdtemp(join(tmpdir(), 'snapback-carrier-exit-retained-render-'));
  const backendRoot = join(scratch, 'snapback');
  const generatedRoot = join(backendRoot, 'generated');
  const databasePath = join(scratch, 'retained-render.sqlite3');
  const storeDirectory = join(scratch, 'client-store');
  const startupArtifacts = join(scratch, 'startup-artifacts.json');
  let server = null;
  let firstStore = null;
  let secondStore = null;
  let firstClient = null;
  let secondClient = null;
  try {
    await mkdir(backendRoot, { recursive: true });
    await mkdir(storeDirectory, { recursive: true });
    await writeFile(join(backendRoot, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';
export const books = defineTable({
  title: v.string(),
  authorSlug: v.string(),
  ownerId: v.principal(),
}).index('by_owner_title', ['ownerId', 'title']).sync();
export const authors = defineTable({
  slug: v.string(),
  name: v.string(),
  ownerId: v.principal(),
}).index('by_slug', ['slug'], { unique: true }).sync();
export default defineSchema({books, authors}, {auth: {mode: 'sessions'}});
`);
    await writeFile(join(backendRoot, 'functions.mjs'), `
import schema from './schema.mjs';
import {
  arg,
  authUserId,
  defineMutation,
  defineRelationalQuery,
  insert,
  v,
} from '@expo/snapback-codegen/define';
export const addAuthor = defineMutation({
  auth: 'authenticated',
  args: {slug: v.string(), name: v.string()},
  plan: insert('authors', {slug: arg('slug'), name: arg('name'), ownerId: authUserId()}),
});
export const addBook = defineMutation({
  auth: 'authenticated',
  args: {title: v.string(), authorSlug: v.string()},
  plan: insert('books', {
    title: arg('title'), authorSlug: arg('authorSlug'), ownerId: authUserId(),
  }),
});
export const booksWithAuthors = defineRelationalQuery({
  root: schema.tables.books,
  joined: schema.tables.authors,
  join: [{root: 'authorSlug', joined: 'slug'}],
  kind: 'inner',
  visibility: {
    root: {kind: 'owner', field: 'ownerId'},
    joined: {kind: 'owner', field: 'ownerId'},
    output: 'owner',
  },
  projection: {title: {root: 'title'}, authorName: {joined: 'name'}},
  take: 16,
  rootIndex: 'by_owner_title',
  joinedIndex: 'by_slug',
  retention: 'opaque-authorized-snapshot-v1',
});
`);
    let generation = await generate(backendRoot);
    assert.equal(generation.ok, true, JSON.stringify(generation.diagnostics));
    const rawActivationPreparation = JSON.parse(execFileSync(
      SERVER_BINARY,
      [
        'composition-activation-prepare',
        '--db', databasePath,
        '--generated', generatedRoot,
        '--deployment-id', 'carrier-exit-retained-render',
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          DYLD_FRAMEWORK_PATH: join(ROOT, 'vendor/ibex/ios/Frameworks'),
        },
      },
    ));
    const activationPreparation = {
      format: rawActivationPreparation.format,
      activationHash: rawActivationPreparation.activationHash,
      sourceClass: 'temporary-backend-source',
      next: rawActivationPreparation.next,
    };
    generation = await generate(backendRoot);
    assert.equal(generation.ok, true, JSON.stringify(generation.diagnostics));
    const schema = JSON.parse(await readFile(join(generatedRoot, 'schema.manifest.json'), 'utf8'));
    const functions = JSON.parse(await readFile(join(generatedRoot, 'functions.manifest.json'), 'utf8'));
    await writeFile(
      startupArtifacts,
      `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`,
      { mode: 0o600 },
    );
    const generatedApi = await import(
      `${pathToFileURL(join(generatedRoot, 'api.mjs')).href}?carrier-exit-retained`,
    );
    assert.equal(
      generatedApi.api.booksWithAuthors.artifacts,
      generatedApi.artifacts,
      'trusted activation reaches the generated public reference graph',
    );

    server = await startServer({
      port: 0,
      db: databasePath,
      cwd: ROOT,
      serverBinary: SERVER_BINARY,
      binaryProvenance: true,
      startupArtifacts,
      trustedCompositionActivation: join(
        generatedRoot,
        'trusted-composition-activation.json',
      ),
      captureImpersonationCapability: true,
      startupTimeoutMs: 120_000,
    });
    const coordinator = new AuthCoordinator({
      appId: schema.appId,
      storage: createMemoryAuthCustodyStorage({ state: {} }),
      broadcastChannelFactory: null,
      hintStorage: null,
    });
    firstStore = createFileRqsResumeStore({
      directory: storeDirectory,
      identity: 'retained-render-owner',
      clientStoreId: 'carrier-exit-retained-render-store',
    });
    await firstStore.whenLockSettled();
    firstClient = new SnapbackClient(server.baseUrl, {
      authCoordinator: coordinator,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      authorizedLeaseProtocol: 1,
      rqsStore: firstStore,
      offlineQueue: false,
    });
    const requested = await firstClient.authRequestCode('retained-render@carrier-exit.test');
    const mailboxResponse = await fetch(
      `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
      {
        headers: {
          'x-snapback-admin-token': server.adminToken,
          'x-snapback-impersonation-capability': server.impersonationCapability,
        },
      },
    );
    const mailbox = await mailboxResponse.json();
    assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
    await firstClient.authExchange({
      challengeId: requested.challengeId,
      code: mailbox.code,
    });
    await firstClient.mutate(generatedApi.api.addAuthor, {
      args: { slug: 'ada', name: 'Ada' },
      queue: false,
    });
    await firstClient.mutate(generatedApi.api.addBook, {
      args: { title: 'proof-backed', authorSlug: 'ada' },
      queue: false,
    });
    const live = await firstClient.liveQuery(generatedApi.api.booksWithAuthors, {
      connectionId: 'carrier-exit-retained-render-live',
      persistResume: true,
    });
    assert.deepEqual(live.rows, [{ title: 'proof-backed', authorName: 'Ada' }]);
    assert.equal(live.answerClass, 'authoritative');
    assert.equal(live.freshness, 'current');
    assert.equal(live.retention.retainable, true);
    const liveEvidence = {
      answerClass: live.answerClass,
      freshness: live.freshness,
      rows: structuredClone(live.rows),
      retention: structuredClone(live.retention),
    };
    await live.dispose();

    const liveBaseUrl = server.baseUrl;
    const launchRung = server.launch?.rung ?? null;
    await server.stop();
    server = null;
    await firstStore.close();
    firstStore = null;

    secondStore = createFileRqsResumeStore({
      directory: storeDirectory,
      identity: 'retained-render-owner',
    });
    await secondStore.whenLockSettled();
    secondClient = new SnapbackClient(liveBaseUrl, {
      authCoordinator: coordinator,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      authorizedLeaseProtocol: 1,
      rqsStore: secondStore,
      offlineQueue: false,
    });
    const updates = [];
    const relaunched = await secondClient.liveQuery(generatedApi.api.booksWithAuthors, {
      connectionId: 'carrier-exit-retained-render-relaunch',
      persistResume: true,
      onUpdate(_rows, detail) { updates.push(detail); },
    });
    assert.deepEqual(relaunched.rows, [{ title: 'proof-backed', authorName: 'Ada' }]);
    assert.equal(relaunched.answerClass, 'authoritative');
    assert.equal(relaunched.freshness, 'retained');
    await relaunched.dispose();
    const materialization = await secondStore.materializationTransaction('readonly', (view) => {
      const records = [...view.materializations.values()]
        .map(decodeMaterializationRecordV1)
        .filter(Boolean);
      return {
        records: records.length,
        qmk1: records[0]?.address[2] ?? null,
        freshness: records[0]?.productState.freshness ?? null,
        fragments: records[0]?.fragments.length ?? 0,
        leaseCustody: Object.keys(view.storeMeta.materializationLeaseCustody).length,
      };
    });
    return {
      serverBinary: relative(ROOT, SERVER_BINARY),
      serverBinarySha256: sha256Hex(readFileSync(SERVER_BINARY)),
      launchRung,
      backendStoppedBeforeRelaunch: true,
      activationPreparation,
      generatedArtifactGraph: {
        trustedActivationPresent: generatedApi.artifacts.trustedCompositionActivation !== null,
        directReferenceIdentity: true,
      },
      live: liveEvidence,
      relaunch: {
        answerClass: relaunched.answerClass,
        freshness: relaunched.freshness,
        rows: relaunched.rows,
        firstUpdate: updates[0] ?? null,
      },
      materialization,
      endToEndRenderedByPublicClient: true,
    };
  } finally {
    try { await server?.stop(); } catch {}
    try { await firstStore?.close(); } catch {}
    try { await secondStore?.close(); } catch {}
    try { await firstClient?.closeAuth(); } catch {}
    try { await secondClient?.closeAuth(); } catch {}
    await rm(scratch, { recursive: true, force: true });
  }
}

const ATTRIBUTION_MODULES = Object.freeze([
  'materialization-store.mjs',
  'materialization-bridge.mjs',
  'registration-ledger.mjs',
  'demand-broker.mjs',
  'store-policy.mjs',
  'answer-classes.mjs',
  'evaluation-floor.mjs',
  'lease-convergence.mjs',
  'rqs-store-meta.mjs',
]);
const SOURCE_PROVENANCE_MODULES = Object.freeze([
  ...ATTRIBUTION_MODULES,
  'materialization-store-runtime.mjs',
  'rqs-preload-core.mjs',
  'store-runtime.mjs',
]);

function normalizeMetafilePath(path) {
  const absolute = resolve(path);
  return absolute.startsWith(`${ROOT}${sep}`)
    ? relative(ROOT, absolute).split(sep).join('/')
    : path.split(sep).join('/');
}

async function measureBundleAttribution(source, closure) {
  const imports = ATTRIBUTION_MODULES.map((name, index) => (
    `import * as store${index} from './packages/snapback-client/${name}';`
  ));
  const entry = [
    "import * as fullClient from './packages/snapback-client/index.mjs';",
    ...imports,
    `export const carrierExitFullClientClosure = [fullClient, ${ATTRIBUTION_MODULES.map((_, index) => `store${index}`).join(', ')}];`,
    'export function __carrierExitBundleBehavior() { return carrierExitFullClientClosure.map((value) => Object.keys(value).length); }',
  ].join('\n');
  const result = await build({
    stdin: {
      contents: entry,
      resolveDir: ROOT,
      sourcefile: 'tests/acceptance/local-store-carrier-exit-v1.bundle.fixture.mjs',
      loader: 'js',
    },
    absWorkingDir: ROOT,
    bundle: true,
    conditions: ['browser', 'import', 'default'],
    define: { 'process.env.NODE_ENV': '"production"' },
    format: 'esm',
    legalComments: 'none',
    logLevel: 'silent',
    metafile: true,
    minify: true,
    platform: 'browser',
    target: 'es2022',
    treeShaking: true,
    write: false,
  });
  const output = result.outputFiles[0].contents;
  const outputMeta = Object.values(result.metafile.outputs)[0];
  const inputs = new Map(Object.entries(outputMeta.inputs).map(([path, value]) => [
    normalizeMetafilePath(path),
    value.bytesInOutput,
  ]));
  const modules = ATTRIBUTION_MODULES.map((name) => {
    const path = `packages/snapback-client/${name}`;
    const minifiedModuleOwnBytes = inputs.get(path);
    assert.ok(Number.isInteger(minifiedModuleOwnBytes), `bundle metafile omitted ${path}`);
    return {
      module: name.slice(0, -'.mjs'.length),
      path,
      sourceBytes: statSync(join(ROOT, path)).size,
      minifiedModuleOwnBytes,
      sourceSha256: sha256Hex(readFileSync(join(ROOT, path))),
    };
  });
  return {
    schemaVersion: 'snapback.local-persistent-store.bundle-attribution.v1',
    date: DATE,
    source,
    authority: 'LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle',
    method: {
      bundler: `esbuild@${esbuildVersion}`,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      minify: true,
      treeShaking: true,
      legalComments: 'none',
      conditions: ['browser', 'import', 'default'],
      attribution: 'esbuild metafile output.inputs bytesInOutput (module-own minified bytes)',
      closure: 'full @expo/snapback-client root plus all nine LLP 0166 store modules retained by namespace observation',
      external: [],
    },
    output: {
      minifiedBytes: output.byteLength,
      gzipBytes: gzipSync(output, { level: 9 }).byteLength,
      brotliBytes: brotliCompressSync(output, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
      }).byteLength,
      sha256: sha256Hex(output),
    },
    modules,
    totalMeasuredModuleOwnBytes: modules.reduce((sum, module) => sum + module.minifiedModuleOwnBytes, 0),
    browserClosureQualification: {
      status: 'PASS',
      materializationStoreResolved: true,
      ...closure,
    },
  };
}

function sourceProvenance() {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const dirtyLines = execFileSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/u).map((line) => line.trimEnd()).filter(Boolean);
  const files = [
    'tests/acceptance/local-store-carrier-exit-v1.mjs',
    ...SOURCE_PROVENANCE_MODULES.map((name) => `packages/snapback-client/${name}`),
    'packages/snapback-client/index.mjs',
    'packages/snapback-client/rqs-store.mjs',
    'packages/snapback-client/rqs-store-file.mjs',
    'packages/snapback-contract/auth-coordinator.mjs',
    'packages/snapback-contract/client-store.mjs',
    'demos/_kit/chrome-process.mjs',
    'demos/triage-graph/demo.snapback.json',
    'demos/triage-graph/snapback/functions.mjs',
    'demos/triage-graph/snapback/schema.mjs',
    relative(ROOT, TRIAGE_BUDGET_PATH),
    relative(ROOT, TRIAGE_RECEIPT_PATH),
    relative(ROOT, FLEET_BUDGET_PATH),
    relative(ROOT, FLEET_RECEIPT_PATH),
  ].map((path) => ({ path, sha256: sha256Hex(readFileSync(join(ROOT, path))) }));
  return {
    revision,
    dirty: dirtyLines.length > 0,
    dirtyPaths: dirtyLines.map((line) => line.slice(3)),
    files,
  };
}

function pass(leg, carrier, evidence) {
  return { leg, carrier, status: 'PASS', evidence };
}

function gap(leg, carrier, evidence, reason) {
  assert.match(reason, /^SNAPBACK_[A-Z0-9_]+:/u);
  return { leg, carrier, status: 'GAP', evidence, reason };
}

function skipped(leg, carrier) {
  return {
    leg,
    carrier,
    status: 'SKIPPED',
    evidence: { browserExecutionSkippedByFlag: true, fullRunRequired: true },
  };
}

function triageFootprintHydrationEvidence() {
  const budgetBytes = readFileSync(TRIAGE_BUDGET_PATH);
  const receiptBytes = readFileSync(TRIAGE_RECEIPT_PATH);
  const budget = JSON.parse(budgetBytes);
  const receipt = JSON.parse(receiptBytes);
  assert.equal(budget.schemaVersion, 'snapback.triage-graph.budget-freeze.v1');
  assert.equal(receipt.schemaVersion, 'snapback.triage-graph.move1-exit.v1');
  assert.equal(receipt.controlledRun.status, 'PASS');
  assert.equal(receipt.summary.blocked, 0);
  assert.equal(receipt.summary.pass, receipt.summary.total);
  assert.deepEqual(receipt.budgetFreeze, budget);
  assert.equal(existsSync(join(ROOT, 'demos/triage-graph/demo.snapback.json')), true);
  assert.equal(receipt.date, retainedTriage.date);
  assert.equal(budget.date, retainedTriage.date);
  for (const file of receipt.source.files) {
    assert.equal(
      sha256Hex(readFileSync(join(ROOT, file.path))),
      file.sha256,
      `${file.path}: Triage receipt source drifted from the working tree`,
    );
  }

  const { custody, hydration } = budget.measured;
  const ceilings = budget.frozenCeilings;
  for (const [name, ceiling] of Object.entries(ceilings.custody)) {
    assert.ok(custody[name] <= ceiling, `Triage custody ${name} exceeded ceiling ${ceiling}`);
  }
  for (const [name, ceiling] of Object.entries(ceilings.hydration)) {
    assert.ok(hydration[name] <= ceiling, `Triage hydration ${name} exceeded ceiling ${ceiling}`);
  }

  return {
    applicationExists: true,
    application: 'demos/triage-graph',
    qualificationStatus: receipt.controlledRun.status,
    measurements: {
      materializations: custody.materializationRecords,
      storedResultRows: custody.storedResultRows,
      logicalBytes: custody.logicalBytes,
      hydrationAttempts: hydration.attempts,
      hydrationRows: hydration.rowsInstalled,
      hydrationPayloadBytes: hydration.payloadBytes,
      hydrationElapsedMs: hydration.elapsedMs,
      hydrationCeilingMs: ceilings.hydration.elapsedMs,
    },
    receipts: {
      budgetFreeze: relative(ROOT, TRIAGE_BUDGET_PATH),
      budgetFreezeSha256: sha256Hex(budgetBytes),
      move1Exit: relative(ROOT, TRIAGE_RECEIPT_PATH),
      move1ExitSha256: sha256Hex(receiptBytes),
    },
  };
}

function fleetFootprintHydrationEvidence() {
  const budgetBytes = readFileSync(FLEET_BUDGET_PATH);
  const receiptBytes = readFileSync(FLEET_RECEIPT_PATH);
  const budget = JSON.parse(budgetBytes);
  const receipt = JSON.parse(receiptBytes);
  assert.equal(budget.schemaVersion, 'snapback.fleet-observatory.budget-freeze.v1');
  assert.equal(receipt.schemaVersion, 'snapback.fleet-observatory.move1-exit.v1');
  assert.equal(receipt.controlledRun.status, 'PASS');
  assert.equal(receipt.summary.blocked, 0);
  assert.equal(receipt.summary.pass, receipt.summary.total);
  assert.deepEqual(receipt.budgetFreeze, budget);
  assert.equal(existsSync(join(ROOT, 'demos/fleet-observatory-move1/demo.snapback.json')), true);
  assert.equal(receipt.date, retainedFleet.date);
  assert.equal(budget.date, retainedFleet.date);
  for (const file of receipt.source.files) {
    assert.equal(
      sha256Hex(readFileSync(join(ROOT, file.path))),
      file.sha256,
      `${file.path}: Fleet receipt source drifted from the working tree`,
    );
  }

  const { activeCustody, releasedCustody, hydration } = budget.measured;
  const ceilings = budget.frozenCeilings;
  for (const [name, ceiling] of Object.entries(ceilings.activeCustody)) {
    assert.ok(activeCustody[name] <= ceiling, `Fleet active custody ${name} exceeded ceiling ${ceiling}`);
  }
  for (const [name, ceiling] of Object.entries(ceilings.releasedCustody)) {
    assert.ok(releasedCustody[name] <= ceiling, `Fleet released custody ${name} exceeded ceiling ${ceiling}`);
  }
  for (const [name, ceiling] of Object.entries(ceilings.hydration)) {
    const measuredName = name === 'elapsedMs' ? 'authoritativeCompleteMs' : name;
    assert.ok(hydration[measuredName] <= ceiling, `Fleet hydration ${measuredName} exceeded ceiling ${ceiling}`);
  }

  return {
    applicationExists: true,
    application: 'demos/fleet-observatory-move1',
    qualificationStatus: receipt.controlledRun.status,
    measurements: {
      activeMaterializations: activeCustody.materializationRecords,
      activeProjectedRows: activeCustody.projectedResultRows,
      activeLogicalBytes: activeCustody.logicalBytes,
      releasedProjectedRows: releasedCustody.retainedProjectedRows,
      hydrationAttempts: hydration.attempts,
      hydrationRows: hydration.rowsInstalled,
      hydrationPayloadBytes: hydration.payloadBytes,
      hydrationElapsedMs: hydration.authoritativeCompleteMs,
      hydrationCeilingMs: ceilings.hydration.elapsedMs,
    },
    receipts: {
      budgetFreeze: relative(ROOT, FLEET_BUDGET_PATH),
      budgetFreezeSha256: sha256Hex(budgetBytes),
      move1Exit: relative(ROOT, FLEET_RECEIPT_PATH),
      move1ExitSha256: sha256Hex(receiptBytes),
    },
  };
}

function evidenceMarkdown(receipt, bundle) {
  const rows = receipt.legs.map((row) => (
    `| ${row.leg} | ${row.carrier} | ${row.status} | ${row.status === 'GAP' ? row.reason.replaceAll('|', '\\|') : summarizeEvidence(row.evidence).replaceAll('|', '\\|')} |`
  )).join('\n');
  const moduleRows = bundle.modules.map((module) => (
    `| \`${module.module}\` | ${module.minifiedModuleOwnBytes.toLocaleString('en-US')} | ${module.sourceBytes.toLocaleString('en-US')} |`
  )).join('\n');
  return `# LLP 0166 local-store carrier-exit v1 evidence

**Run date:** ${DATE}
**Source revision:** \`${receipt.source.revision}\` (${receipt.source.dirty ? 'dirty evidence worktree' : 'clean'})
**Machine:** ${receipt.runtime.platform}/${receipt.runtime.arch}, Node ${receipt.runtime.node}

This is the standards-real Move-2 carrier exit consumed by LLP 0157 and LLP
0166. Exhaustive S1-S8 semantics stay with the lane suites. A GAP below is an
explicit capability boundary, not a skipped success and not a capability
publication.

## Carrier legs

| Leg | Carrier | Status | Measured result or stable GAP reason |
| --- | --- | --- | --- |
${rows}

## Bundle attribution

The attribution build uses the existing LLP 0145 esbuild/metafile method.
These are module-own minified bytes, not marginal deletion savings. The exact
browser closure resolves the shipped materialization store with no
\`node:crypto\` external.

| Store module | Minified module-own bytes | Source bytes |
| --- | ---: | ---: |
${moduleRows}

Full measured closure: ${bundle.output.minifiedBytes.toLocaleString('en-US')}
minified bytes, ${bundle.output.gzipBytes.toLocaleString('en-US')} gzip bytes,
${bundle.output.brotliBytes.toLocaleString('en-US')} Brotli bytes. The nine
store modules account for ${bundle.totalMeasuredModuleOwnBytes.toLocaleString('en-US')}
module-own minified bytes.

## Receipt interpretation

- When the browser leg runs, process exit is attested by the shared
  Chrome lifecycle owner. The caller-owned profile is deleted only after both
  the SIGKILL-first and final browser process trees have exited. A partial run
  records browser rows as SKIPPED; it never converts them into GAPs.
- File crash cuts pause inside the real adapter at before-rename and
  after-rename/before-directory-sync boundaries, then kill the detached child
  process group with SIGKILL.
- The authority-logout row is a Node-level public bridge: it calls
  \`SnapbackClient.authLogout\`, observes the LLP 0059 participant's file-v3
  transition before anonymous resume, and checks the §D1 projection including
  pending-outbox destruction and sibling-identity sweeping. It is not a
  page-level browser leg.
- The retained-unreachable row is one end-to-end public-client sequence: the
  generated qmk1 reference establishes against this worktree's live backend,
  stores the P1 proof and complete lease custody, the owned backend process
  exits, and a newly constructed client projects authoritative-retained bytes
  from the same file-v3 identity while the endpoint is unreachable.
- Triage and Fleet consume their qualified successor applications' frozen
  custody and hydration measurements. The retained Fleet receipt closes the
  final LLP 0157 Move-1 workload-exit row without changing capability maturity
  or adding a hosted/remote claim.

Machine receipt: \`tests/acceptance/fixtures/local-persistent-store/carrier-exit.${DATE}.v1.json\`
Bundle receipt: \`tests/acceptance/fixtures/local-persistent-store/bundle-attribution.${DATE}.v1.json\`
`;
}

function summarizeEvidence(evidence) {
  if (evidence?.relaunchToReadableMs !== undefined) return `relaunch-to-readable ${evidence.relaunchToReadableMs} ms`;
  if (evidence?.maintenanceMs !== undefined) return `${evidence.logicalBytesBefore} → ${evidence.logicalBytesAfter} logical bytes in ${evidence.maintenanceMs} ms`;
  if (evidence?.boundaries) return `${evidence.boundaries.length} SIGKILL write-boundary cuts; allocator next ${evidence.successorCut.nextAllocatedQueryInstanceId}`;
  if (evidence?.suppressionBeforeHello !== undefined) return `suppression ${evidence.suppressionBeforeHello} → ${evidence.suppressionAfter}; ${evidence.demandState}`;
  if (evidence?.reset !== undefined) return JSON.stringify(evidence);
  return JSON.stringify(evidence);
}

async function verifyRetainedArtifacts() {
  const receipt = JSON.parse(await readFile(RECEIPT_PATH, 'utf8'));
  const bundle = JSON.parse(await readFile(BUNDLE_PATH, 'utf8'));
  assert.equal(receipt.schemaVersion, 'snapback.local-persistent-store.carrier-exit.v1');
  assert.equal(receipt.date, DATE);
  assert.ok(Array.isArray(receipt.legs) && receipt.legs.length >= 15);
  for (const row of receipt.legs) {
    assert.ok(['PASS', 'GAP', 'SKIPPED'].includes(row.status), `${row.leg}: status`);
    assert.equal(typeof row.evidence, 'object', `${row.leg}: evidence`);
    if (row.status === 'GAP') assert.match(row.reason, /^SNAPBACK_[A-Z0-9_]+:/u, `${row.leg}: stable GAP reason`);
    else assert.equal(Object.hasOwn(row, 'reason'), false, `${row.leg}: non-GAP reason omitted`);
  }
  const summary = {
    pass: receipt.legs.filter((row) => row.status === 'PASS').length,
    gap: receipt.legs.filter((row) => row.status === 'GAP').length,
    skipped: receipt.legs.filter((row) => row.status === 'SKIPPED').length,
    capabilityClaimsChanged: false,
  };
  assert.deepEqual(receipt.summary, summary);
  if (process.argv.includes('--require-qualified')) {
    assert.deepEqual(summary, {
      pass: 17,
      gap: 0,
      skipped: 0,
      capabilityClaimsChanged: false,
    });
    assert.equal(
      receipt.legs.find((row) => row.leg === 'footprint-hydration-triage')?.status,
      'PASS',
      'publication requires the measured Triage successor leg',
    );
    assert.equal(
      receipt.legs.find((row) => row.leg === 'footprint-hydration-fleet')?.status,
      'PASS',
      'publication requires the measured Fleet successor leg',
    );
  }
  assert.equal(bundle.schemaVersion, 'snapback.local-persistent-store.bundle-attribution.v1');
  assert.deepEqual(bundle.modules.map((entry) => `${entry.module}.mjs`), ATTRIBUTION_MODULES);
  assert.ok(bundle.modules.every((entry) => Number.isInteger(entry.minifiedModuleOwnBytes) && entry.minifiedModuleOwnBytes > 0));
  for (const file of receipt.source.files) {
    assert.equal(
      sha256Hex(await readFile(join(ROOT, file.path))),
      file.sha256,
      `${file.path}: retained source digest`,
    );
  }
  assert.equal(existsSync(EVIDENCE_PATH), true);
  console.log(`PASS LLP 0166 retained carrier-exit receipt: ${summary.pass} PASS / ${summary.gap} GAP / ${summary.skipped} SKIPPED`);
}

function makeBrowserFixtures() {
  const mismatched = makeSignedMaterializationFixture('artifact-mismatch', 1);
  return {
    restart: makeSignedMaterializationFixture('browser-restart', 1),
    authority: {
      lease: makeSignedMaterializationFixture('browser-lease-expiry', 1),
      artifact: makeSignedMaterializationFixture('browser-artifact-change', 1),
      mismatchedTrustedActivation: mismatched.trustedActivation,
      revocation: makeSignedMaterializationFixture('browser-revocation', 1),
    },
    churn: Array.from({ length: 6 }, (_, index) => (
      makeSignedMaterializationFixture(`browser-churn-${index + 1}`, index + 1)
    )),
  };
}

async function main() {
  if (process.argv.includes('--check')) {
    await verifyRetainedArtifacts();
    return;
  }
  if (process.argv.includes('--logout-only')) {
    console.log(JSON.stringify(await runPublicLogoutBridgeEvidence(), null, 2));
    return;
  }
  if (process.argv.includes('--retained-render-only')) {
    console.log(JSON.stringify(await runRetainedRenderBackendEvidence(), null, 2));
    return;
  }
  const skipBrowser = process.argv.includes('--skip-browser');
  const startedAt = new Date().toISOString();
  const source = sourceProvenance();
  const closure = await materializationBrowserClosureQualification();
  const bundle = await measureBundleAttribution(source, closure);
  if (skipBrowser) await buildBrowserHarness();
  const fileCrash = await runFileCrashEvidence();
  const publicLogout = await runPublicLogoutBridgeEvidence();
  const fileAuthority = await runFileAuthorityEvidence();
  const fileCustody = await runFileCustodyEvidence();
  const retainedRender = await runRetainedRenderBackendEvidence();
  const browser = skipBrowser ? null : await runBrowserEvidence(makeBrowserFixtures());
  const legs = [
    browser
      ? pass('browser-terminate-relaunch', 'browser-indexeddb-v3', {
        resumeEntryVerifiedBeforeKill: browser.seed.verification.ok,
        resumeEntryVerifiedAfterRelaunch: browser.relaunch.verification.ok,
        materializationProofVerifiedInBrowser: browser.seed.materialization.proofVerifiedByBrowserWebCrypto,
        retainedBootProofRevalidated: browser.relaunch.materialization.proofRevalidatedAtRetainedBoot,
        committedBytes: browser.seed.materialization.rendered,
        retainedBytes: browser.relaunch.materialization.rendered,
        durableRegistrationRetained: true,
        allocator: [browser.seed.allocated, browser.relaunch.allocated],
        relaunchToReadableMs: browser.relaunch.relaunchToReadableMs,
        browser: browser.browser,
        profile: browser.profile,
        cleanup: browser.cleanup,
      })
      : skipped('browser-terminate-relaunch', 'browser-indexeddb-v3'),
    browser
      ? pass('two-tabs-one-profile', 'browser-indexeddb-web-locks-broadcastchannel', browser.twoTabs.handoff)
      : skipped('two-tabs-one-profile', 'browser-indexeddb-web-locks-broadcastchannel'),
    pass('file-process-terminate-relaunch', 'node-file-v3-outbox', fileCrash),
    pass(
      'retained-render-server-unreachable',
      'live-backend-plus-node-file-v3',
      retainedRender,
    ),
    pass('authority-logout', 'node-public-client-to-file-v3', publicLogout),
    pass('authority-user-switch', 'node-file-v3-multi-identity', fileAuthority.userSwitch),
    pass('authority-revocation', 'node-file-v3-materialization', fileAuthority.revocation),
    browser
      ? pass('authority-lease-expiry', 'browser-indexeddb-v3-materialization', browser.materializationAuthority.leaseExpiry)
      : skipped('authority-lease-expiry', 'browser-indexeddb-v3-materialization'),
    browser
      ? pass('authority-artifact-change', 'browser-indexeddb-v3-materialization', browser.materializationAuthority.artifactChange)
      : skipped('authority-artifact-change', 'browser-indexeddb-v3-materialization'),
    pass('authority-corrupt-store-recovery', 'node-file-v3', fileAuthority.corruptRecovery),
    browser
      ? pass('authority-corrupt-store-recovery', 'browser-indexeddb-v3', browser.corruptRecovery)
      : skipped('authority-corrupt-store-recovery', 'browser-indexeddb-v3'),
    browser
      ? pass('authority-revocation', 'browser-indexeddb-v3-materialization', browser.materializationAuthority.revocation)
      : skipped('authority-revocation', 'browser-indexeddb-v3-materialization'),
    pass('bounded-custody-query-churn', 'node-file-v3', fileCustody),
    browser
      ? pass('bounded-custody-query-churn', 'browser-indexeddb-v3', browser.boundedCustody)
      : skipped('bounded-custody-query-churn', 'browser-indexeddb-v3'),
    pass(
      'footprint-hydration-triage',
      'triage-graph-budget-freeze-v1',
      triageFootprintHydrationEvidence(),
    ),
    pass(
      'footprint-hydration-fleet',
      'fleet-observatory-budget-freeze-v1',
      fleetFootprintHydrationEvidence(),
    ),
    pass('bundle-attribution', 'full-client-store-closure', {
      artifact: relative(ROOT, BUNDLE_PATH),
      minifiedBytes: bundle.output.minifiedBytes,
      measuredModuleOwnBytes: bundle.totalMeasuredModuleOwnBytes,
      modules: bundle.modules.length,
      browserClosureQualification: bundle.browserClosureQualification,
    }),
  ];
  const receipt = {
    schemaVersion: 'snapback.local-persistent-store.carrier-exit.v1',
    date: DATE,
    authority: [
      'LLP 0157#move-2-carrier-exit-llp-0155-normative-transcription',
      'LLP 0166#executable-acceptance',
      'LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle',
    ],
    startedAt,
    completedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      hostnameClass: 'local-evidence-machine',
    },
    source,
    partial: skipBrowser,
    summary: {
      pass: legs.filter((row) => row.status === 'PASS').length,
      gap: legs.filter((row) => row.status === 'GAP').length,
      skipped: legs.filter((row) => row.status === 'SKIPPED').length,
      capabilityClaimsChanged: false,
    },
    legs,
  };
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(BUNDLE_PATH, `${JSON.stringify(bundle, null, 2)}\n`);
  await writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(EVIDENCE_PATH, evidenceMarkdown(receipt, bundle));
  console.log(JSON.stringify({
    ok: true,
    pass: receipt.summary.pass,
    gap: receipt.summary.gap,
    skipped: receipt.summary.skipped,
    partial: receipt.partial,
    receipt: relative(ROOT, RECEIPT_PATH),
    evidence: relative(ROOT, EVIDENCE_PATH),
    bundle: relative(ROOT, BUNDLE_PATH),
  }));
}

await main();
