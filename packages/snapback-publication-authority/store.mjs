import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { canonicalJcs, sha256Hex } from './protocol.mjs';

const STATE_SCHEMA = 'snapback.publication-authority-state.v1';

export function initialPublicationAuthorityState() {
  return {
    schemaVersion: STATE_SCHEMA,
    generation: 0,
    publicationEpoch: 0,
    records: [],
  };
}

function validateState(state) {
  if (
    state?.schemaVersion !== STATE_SCHEMA
    || !Number.isSafeInteger(state.generation)
    || state.generation < 0
    || !Number.isSafeInteger(state.publicationEpoch)
    || state.publicationEpoch < 0
    || !Array.isArray(state.records)
    || state.records.length !== state.publicationEpoch
  ) {
    throw new Error('publication authority state is invalid');
  }
  return state;
}

function clone(value) {
  return structuredClone(value);
}

// @ref LLP 0041#unreviewed-post-round-correction-publication-lease-and-rollback
// — BEGIN IMMEDIATE plus a generation predicate makes the volume file the
// monotone expected-value authority, including across processes and restarts.
export class SqliteVolumePublicationAuthorityStore {
  constructor(path) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new TypeError('publication authority database path is required');
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
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
    `);
  }

  #readWithinTransaction() {
    const row = this.database.prepare(`
      SELECT generation, state_json, state_sha256
      FROM publication_authority_state
      WHERE singleton = 1
    `).get();
    if (!row) return initialPublicationAuthorityState();
    if (sha256Hex(row.state_json) !== row.state_sha256) {
      throw new Error('publication authority durable state digest mismatch');
    }
    const state = validateState(JSON.parse(row.state_json));
    if (state.generation !== row.generation) {
      throw new Error('publication authority durable generation mismatch');
    }
    return state;
  }

  read() {
    return clone(this.#readWithinTransaction());
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
        const next = validateState(transaction.state);
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
      return clone(transaction.result);
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original transaction failure.
      }
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}
export class InMemoryPublicationAuthorityStore {
  constructor(state = initialPublicationAuthorityState()) {
    this.state = clone(validateState(state));
  }

  read() {
    return clone(this.state);
  }

  transact(mutator) {
    const current = clone(this.state);
    const transaction = mutator(current);
    if (transaction.changed) {
      const next = validateState(transaction.state);
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
