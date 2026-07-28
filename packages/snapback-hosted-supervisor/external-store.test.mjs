import assert from 'node:assert/strict';
import {
  coreStateFromExternal,
  publishExternalAuthority,
  readExternalAuthority,
} from './external-store.mjs';
import { canonicalJson, SupervisorRefusal, sha256 } from './index.mjs';

class MemoryBody {
  constructor(bytes) {
    this.bytes = bytes;
  }

  async transformToByteArray() {
    return this.bytes;
  }
}

class MemoryS3 {
  constructor(objects = new Map()) {
    this.objects = objects;
    this.revision = 0;
  }

  async send(command) {
    const name = command.constructor.name;
    const { Key: key } = command.input;
    if (name === 'GetObjectCommand') {
      const retained = this.objects.get(key);
      if (!retained) {
        const error = new Error('not found');
        error.name = 'NoSuchKey';
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }
      return { Body: new MemoryBody(retained.bytes), ETag: retained.etag };
    }
    if (name !== 'PutObjectCommand') throw new Error(`unsupported ${name}`);
    const current = this.objects.get(key);
    if (
      (command.input.IfNoneMatch === '*' && current)
      || (command.input.IfMatch && current?.etag !== command.input.IfMatch)
    ) {
      const error = new Error('precondition');
      error.name = 'PreconditionFailed';
      error.$metadata = { httpStatusCode: 412 };
      throw error;
    }
    const bytes = Buffer.from(command.input.Body);
    this.revision += 1;
    const etag = `"memory-${this.revision}"`;
    this.objects.set(key, { bytes, etag });
    return { ETag: etag };
  }
}

const database0 = {
  generation: 0,
  journal: [],
  effects: {},
  reconciliations: [],
  promotions: {},
  spendLedgers: {},
  cleanupPlans: {},
  heads: {},
  floors: { spend: 0, cleanup: 0, replay: 0 },
};
const installationReceipt = {
  installationId: 'shared:personal:sjc:test',
  incarnation: 'incarnation-test',
  ownershipSentinel: 'snapback:hosted-supervisor:v1:test',
  externalAnchor: 's3://test-bucket/snapback-supervisor/anchor/incarnation.json',
};
const mirror0 = {
  schemaVersion: 'snapback.hosted-supervisor-mirror.v1',
  installationId: installationReceipt.installationId,
  incarnation: installationReceipt.incarnation,
  generation: 0,
  journalDigest: sha256(Buffer.from(canonicalJson([]))),
  controlHeadDigest: sha256(Buffer.from(canonicalJson({}))),
  database: database0,
};
const mirror0Bytes = Buffer.from(canonicalJson(mirror0));
const mirror0Sha256 = sha256(mirror0Bytes);
const mirror0Key = `snapback-supervisor/journal/generation-000000000000-${mirror0Sha256.slice(7)}.json`;
const anchor0 = {
  schemaVersion: 'snapback.hosted-supervisor-incarnation-anchor.v1',
  installationId: installationReceipt.installationId,
  ownershipSentinel: installationReceipt.ownershipSentinel,
  incarnation: installationReceipt.incarnation,
  generation: 0,
  mirrorKey: mirror0Key,
  mirrorSha256: mirror0Sha256,
  journalDigest: mirror0.journalDigest,
  spendFloor: 0,
  cleanupFloor: 0,
  replayFloor: 0,
  controlHeadDigest: mirror0.controlHeadDigest,
};
const anchor0Bytes = Buffer.from(canonicalJson(anchor0));
installationReceipt.externalAnchorSha256 = sha256(anchor0Bytes);
installationReceipt.journalMirrorSha256 = mirror0Sha256;

const anchorClient = new MemoryS3(new Map([
  ['snapback-supervisor/anchor/incarnation.json', { bytes: anchor0Bytes, etag: '"root-etag"' }],
]));
const journalClient = new MemoryS3(new Map([
  [mirror0Key, { bytes: mirror0Bytes, etag: '"mirror-root-etag"' }],
]));

const external0 = await readExternalAuthority({
  installationReceipt,
  anchorClient,
  journalClient,
});
assert.equal(external0.anchor.generation, 0);
assert.deepEqual(coreStateFromExternal(installationReceipt, external0).database, database0);

const database1 = structuredClone(database0);
database1.generation = 1;
database1.floors.replay = 1;
database1.journal.push({ kind: 'test', sequence: 1 });
database1.operatorAuthority = {
  schemaVersion: 'snapback.supervisor-operator-authority-state.v1',
  requestJournal: {
    'request-1': {
      response: {
        kind: 'inline',
        sha256: sha256(Buffer.from('retained-response')),
        bytes: Buffer.from('retained-response').toString('base64url'),
      },
    },
  },
};
const external1 = await publishExternalAuthority({
  installationReceipt,
  anchorClient,
  journalClient,
  previous: external0,
  database: database1,
});
assert.equal(external1.anchor.generation, 1);
assert.equal(external1.anchor.previousAnchorSha256, installationReceipt.externalAnchorSha256);
assert.deepEqual(external1.mirror.database, database1);

const recovered = await readExternalAuthority({
  installationReceipt,
  anchorClient,
  journalClient,
});
assert.deepEqual(coreStateFromExternal(installationReceipt, recovered).database, database1);
assert.equal(
  coreStateFromExternal(installationReceipt, recovered)
    .database.operatorAuthority.requestJournal['request-1'].response.bytes,
  Buffer.from('retained-response').toString('base64url'),
);

await assert.rejects(
  publishExternalAuthority({
    installationReceipt,
    anchorClient,
    journalClient,
    previous: external0,
    database: database1,
  }),
  (error) => error instanceof SupervisorRefusal
    && error.code === 'SNAPBACK_SUPERVISOR_ANCHOR_CAS_FAILED',
);

console.log('snapback-hosted-supervisor: external anchor/mirror corpus passed');
