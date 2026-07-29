import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  AUTHORITY_TRANSITION_KEYS,
  canonicalJcs,
  leaseSha256,
  normalizeAuthorityOrigin,
  publicationAuthorityHeadSha256,
  publicationAuthoritySigningKeyId,
  requireExactKeys,
  sha256Hex,
  validatePublicationAuthorityReceipt,
  validatePublicationLease,
  validatePublicationLeaseIssueRequest,
  vectorFromLease,
} from './protocol.mjs';

const STATE_SCHEMA = 'snapback.publication-authority-state.v2';
const STATE_KEYS = [
  'authorityInstallationId',
  'authorityOrigin',
  'generation',
  'publicationEpoch',
  'records',
  'schemaVersion',
  'signingKeyId',
];
const RECORD_KEYS = [
  'acquisition',
  'closure',
  'issueRequest',
  'issueRequestSha256',
  'lease',
  'status',
];
const RETAINED_TRANSITION_KEYS = ['receipt', 'requestSha256'];

function bindingContext({
  authorityInstallationId,
  authorityOrigin,
  publicKey,
}) {
  if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(authorityInstallationId ?? '')) {
    throw new TypeError('publication authority store installation id is invalid');
  }
  return {
    authorityInstallationId,
    authorityOrigin: normalizeAuthorityOrigin(authorityOrigin, {
      allowLoopbackHttp: true,
    }),
    publicKey,
    signingKeyId: publicationAuthoritySigningKeyId(publicKey),
  };
}

export function initialPublicationAuthorityState(context) {
  const binding = bindingContext(context);
  return {
    schemaVersion: STATE_SCHEMA,
    authorityInstallationId: binding.authorityInstallationId,
    authorityOrigin: binding.authorityOrigin,
    signingKeyId: binding.signingKeyId,
    generation: 0,
    publicationEpoch: 0,
    records: [],
  };
}

function receiptTransition(receipt) {
  const transition = Object.fromEntries(
    AUTHORITY_TRANSITION_KEYS.map((key) => [key, receipt[key]]),
  );
  transition.schemaVersion = 'snapback.publication-authority-transition.v2';
  return transition;
}

function validateRetainedTransition({
  retained,
  context,
  expectedGeneration,
  lease,
  outcome,
  vectorSide,
}) {
  requireExactKeys(retained, RETAINED_TRANSITION_KEYS, 'retained authority transition');
  if (!/^[0-9a-f]{64}$/u.test(retained.requestSha256 ?? '')) {
    throw new Error('retained authority transition request digest is invalid');
  }
  const receipt = validatePublicationAuthorityReceipt({
    receipt: retained.receipt,
    publicKey: context.publicKey,
    authorityInstallationId: context.authorityInstallationId,
    authorityOrigin: context.authorityOrigin,
  });
  if (
    receipt.authorityGeneration !== expectedGeneration
    || receipt.operationId !== lease.operationId
    || receipt.publisherInstanceId !== lease.publisherInstanceId
    || receipt.publicationEpoch !== lease.publicationEpoch
    || receipt.leaseSha256 !== leaseSha256(lease)
    || receipt.outcome !== outcome
    || receipt.vectorSha256 !== sha256Hex(canonicalJcs(vectorFromLease(lease, vectorSide)))
  ) {
    throw new Error('retained authority transition does not match its lease or generation');
  }
  const transition = receiptTransition(receipt);
  if (retained.requestSha256 !== sha256Hex(canonicalJcs(transition))) {
    throw new Error('retained authority transition request digest mismatch');
  }
  return receipt;
}

function retainedHeadSha256(record, generation, context) {
  return publicationAuthorityHeadSha256({
    schemaVersion: 'snapback.publication-authority-head.v3',
    authorityInstallationId: context.authorityInstallationId,
    authorityOrigin: context.authorityOrigin,
    challenge: '0'.repeat(64),
    signingKeyId: context.signingKeyId,
    authorityGeneration: generation,
    publicationEpoch: record.lease.publicationEpoch,
    status: record.status,
    operationId: record.lease.operationId,
    publisherInstanceId: record.lease.publisherInstanceId,
    leaseSha256: leaseSha256(record.lease),
    expiresAt: record.lease.expiresAt,
    outcome: record.closure?.receipt.outcome ?? null,
    headSha256: null,
  });
}

export function validatePublicationAuthorityState(state, rawContext) {
  const context = bindingContext(rawContext);
  requireExactKeys(state, STATE_KEYS, 'publication authority state');
  if (
    state.schemaVersion !== STATE_SCHEMA
    || state.authorityInstallationId !== context.authorityInstallationId
    || state.authorityOrigin !== context.authorityOrigin
    || state.signingKeyId !== context.signingKeyId
    || !Number.isSafeInteger(state.generation)
    || state.generation < 0
    || !Number.isSafeInteger(state.publicationEpoch)
    || state.publicationEpoch < 0
    || !Array.isArray(state.records)
    || state.records.length !== state.publicationEpoch
  ) {
    throw new Error('publication authority state is invalid');
  }

  let expectedGeneration = 0;
  let expectedHeadSha256 = null;
  const operationIds = new Set();
  for (const [index, record] of state.records.entries()) {
    requireExactKeys(record, RECORD_KEYS, `publication authority record ${index}`);
    if (!/^[0-9a-f]{64}$/u.test(record.issueRequestSha256 ?? '')) {
      throw new Error(`publication authority record ${index} issue digest is invalid`);
    }
    const issueRequest = validatePublicationLeaseIssueRequest(record.issueRequest, {
      authorityInstallationId: context.authorityInstallationId,
      authorityOrigin: context.authorityOrigin,
    });
    if (
      issueRequest.signingKeyId !== context.signingKeyId
      || record.issueRequestSha256 !== sha256Hex(canonicalJcs(issueRequest))
      || issueRequest.expectedPublicationEpoch !== index
      || issueRequest.expectedHeadSha256 !== expectedHeadSha256
    ) {
      throw new Error(`publication authority record ${index} issue request is inconsistent`);
    }
    const lease = validatePublicationLease({
      lease: record.lease,
      publicKey: context.publicKey,
      authorityInstallationId: context.authorityInstallationId,
      authorityOrigin: context.authorityOrigin,
      candidateLedgerSha256: record.lease?.candidateLedgerSha256,
      candidateTag: record.lease?.candidateTag,
      publisherInstanceId: record.lease?.publisherInstanceId,
      now: null,
    });
    if (
      lease.publicationEpoch !== index + 1
      || operationIds.has(lease.operationId)
    ) {
      throw new Error(`publication authority record ${index} epoch/order is invalid`);
    }
    if (
      issueRequest.operationId !== lease.operationId
      || issueRequest.publisherInstanceId !== lease.publisherInstanceId
      || issueRequest.candidateLedgerSha256 !== lease.candidateLedgerSha256
      || issueRequest.candidateTag !== lease.candidateTag
      || issueRequest.defaultTag !== lease.defaultTag
      || (issueRequest.priorDefaultClosureReceiptSha256 ?? null)
        !== (lease.priorDefaultClosureReceiptSha256 ?? null)
      || issueRequest.lifetimeSeconds * 1_000
        !== Date.parse(lease.expiresAt) - Date.parse(lease.issuedAt)
      || canonicalJcs(issueRequest.packages) !== canonicalJcs(lease.packages)
    ) {
      throw new Error(`publication authority record ${index} issue/lease binding is invalid`);
    }
    operationIds.add(lease.operationId);
    expectedGeneration += 1;

    if (record.acquisition !== null) {
      expectedGeneration += 1;
      validateRetainedTransition({
        retained: record.acquisition,
        context,
        expectedGeneration,
        lease,
        outcome: 'acquired',
        vectorSide: 'prior',
      });
    }
    if (record.closure !== null) {
      if (record.acquisition === null) {
        throw new Error(`publication authority record ${index} closes without acquisition`);
      }
      expectedGeneration += 1;
      const outcome = record.closure.receipt?.outcome;
      if (!['promoted', 'rolled-back'].includes(outcome)) {
        throw new Error(`publication authority record ${index} closure outcome is invalid`);
      }
      validateRetainedTransition({
        retained: record.closure,
        context,
        expectedGeneration,
        lease,
        outcome,
        vectorSide: outcome === 'promoted' ? 'new' : 'prior',
      });
    }

    const expectedStatus = record.closure !== null
      ? 'closed'
      : record.acquisition !== null
        ? 'acquired'
        : 'issued';
    if (record.status !== expectedStatus) {
      throw new Error(`publication authority record ${index} status is inconsistent`);
    }
    expectedHeadSha256 = retainedHeadSha256(record, expectedGeneration, context);
  }
  if (state.generation !== expectedGeneration) {
    throw new Error('publication authority state generation/history mismatch');
  }
  return state;
}

function clone(value) {
  return structuredClone(value);
}

function secureDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('publication authority database directory must be a real directory');
  }
  chmodSync(path, 0o700);
}

function secureDatabasePath(path) {
  if (existsSync(path)) {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('publication authority database path must be a real file');
    }
  } else {
    closeSync(openSync(path, 'wx', 0o600));
  }
  chmodSync(path, 0o600);
}

function secureExistingDatabaseFile(path) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('publication authority SQLite sidecar must be a real file');
  }
  chmodSync(path, 0o600);
}

// @ref LLP 0041#unreviewed-post-round-correction-publication-lease-and-rollback
// — BEGIN IMMEDIATE plus a generation predicate makes the volume file the
// monotone expected-value authority, including across processes and restarts.
export class SqliteVolumePublicationAuthorityStore {
  constructor(path, context) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new TypeError('publication authority database path is required');
    }
    this.path = path;
    this.context = bindingContext(context);
    secureDirectory(dirname(path));
    secureDatabasePath(path);
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS publication_authority_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        generation INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        state_sha256 TEXT NOT NULL
      ) STRICT;
      PRAGMA trusted_schema = OFF;
    `);
    this.#secureDatabaseFiles();
    try {
      this.read();
    } catch (error) {
      this.database.close();
      this.#secureDatabaseFiles();
      throw error;
    }
  }

  #secureDatabaseFiles() {
    for (const path of [this.path, `${this.path}-wal`, `${this.path}-shm`]) {
      if (existsSync(path)) secureExistingDatabaseFile(path);
    }
  }

  #readWithinTransaction() {
    const row = this.database.prepare(`
      SELECT generation, state_json, state_sha256
      FROM publication_authority_state
      WHERE singleton = 1
    `).get();
    if (!row) return initialPublicationAuthorityState(this.context);
    if (sha256Hex(row.state_json) !== row.state_sha256) {
      throw new Error('publication authority durable state digest mismatch');
    }
    const state = validatePublicationAuthorityState(
      JSON.parse(row.state_json),
      this.context,
    );
    if (state.generation !== row.generation) {
      throw new Error('publication authority durable generation mismatch');
    }
    return state;
  }

  read() {
    const value = clone(this.#readWithinTransaction());
    this.#secureDatabaseFiles();
    return value;
  }

  transact(mutator) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.#readWithinTransaction();
      const transaction = mutator(clone(current));
      if (
        transaction === null
        || typeof transaction !== 'object'
        || !Object.hasOwn(transaction, 'result')
        || typeof transaction.changed !== 'boolean'
      ) {
        throw new Error('publication authority transaction returned an invalid result');
      }
      if (transaction.changed) {
        const next = validatePublicationAuthorityState(transaction.state, this.context);
        if (
          next.generation !== current.generation + 1
          || next.publicationEpoch < current.publicationEpoch
        ) {
          throw new Error('publication authority transaction violated monotonic state');
        }
        const stateJson = canonicalJcs(next);
        const changed = this.database.prepare(`
          INSERT INTO publication_authority_state(
            singleton, generation, state_json, state_sha256
          ) VALUES(1, ?, ?, ?)
          ON CONFLICT(singleton) DO UPDATE SET
            generation = excluded.generation,
            state_json = excluded.state_json,
            state_sha256 = excluded.state_sha256
          WHERE publication_authority_state.generation = ?
        `).run(
          next.generation,
          stateJson,
          sha256Hex(stateJson),
          current.generation,
        );
        if (changed.changes !== 1) {
          throw new Error('publication authority generation compare-and-swap lost');
        }
      }
      this.database.exec('COMMIT');
      this.#secureDatabaseFiles();
      return clone(transaction.result);
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original transaction failure.
      }
      this.#secureDatabaseFiles();
      throw error;
    }
  }

  close() {
    this.database.close();
    this.#secureDatabaseFiles();
  }
}

export class InMemoryPublicationAuthorityStore {
  constructor(context, state = null) {
    this.context = bindingContext(context);
    this.state = clone(validatePublicationAuthorityState(
      state ?? initialPublicationAuthorityState(this.context),
      this.context,
    ));
  }

  read() {
    return clone(validatePublicationAuthorityState(this.state, this.context));
  }

  transact(mutator) {
    const current = clone(validatePublicationAuthorityState(this.state, this.context));
    const transaction = mutator(current);
    if (transaction.changed) {
      const next = validatePublicationAuthorityState(transaction.state, this.context);
      if (
        next.generation !== this.state.generation + 1
        || next.publicationEpoch < this.state.publicationEpoch
      ) {
        throw new Error('publication authority transaction violated monotonic state');
      }
      this.state = clone(next);
    }
    return clone(transaction.result);
  }
}
