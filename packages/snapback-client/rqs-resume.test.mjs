// Channel B relaunch/resume acceptance — web/IndexedDB arm (LLP 0090 rollout
// step 5, ENG-25456): the step-5 acceptance list from rqs-resume-suite.mjs
// driven against the real IndexedDB store under a Web-Lock double, plus the
// store-independent witness unit. The native/DK-9 file arm runs the same
// suite in rqs-resume-native.test.mjs.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import {
  base64UrlNoPad,
  digestOfRows,
  membershipWitnessOfRows,
  rowHash,
} from './rqs.mjs';
import { createIndexedDbRqsResumeStore } from './rqs-store.mjs';
import { defineChannelBResumeSuite, tick } from './rqs-resume-suite.mjs';

// --- Web Locks double (queued exclusive, AbortSignal-aware) -----------------

function createLockManagerDouble() {
  const states = new Map();
  const stateFor = (name) => {
    let state = states.get(name);
    if (!state) {
      state = { held: false, queue: [] };
      states.set(name, state);
    }
    return state;
  };
  const pump = (name) => {
    const state = stateFor(name);
    if (state.held) return;
    while (state.queue.length > 0) {
      const next = state.queue.shift();
      if (next.aborted) continue;
      state.held = true;
      Promise.resolve()
        .then(() => next.callback({ name, mode: 'exclusive' }))
        .then(next.resolve, next.reject)
        .finally(() => {
          state.held = false;
          pump(name);
        });
      return;
    }
  };
  return {
    request(name, options, callback) {
      const state = stateFor(name);
      return new Promise((resolve, reject) => {
        const entry = { callback, resolve, reject, aborted: false };
        const signal = options?.signal;
        if (signal) {
          if (signal.aborted) {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            return;
          }
          signal.addEventListener('abort', () => {
            entry.aborted = true;
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }
        state.queue.push(entry);
        pump(name);
      });
    },
  };
}

// One context = one same-origin browser profile: stores share one IndexedDB
// and one Web-Lock domain; a fresh store over them models a tab relaunch.
defineChannelBResumeSuite({
  arm: 'web/indexeddb',
  createContext: async () => {
    const indexedDB = new IDBFactory();
    const lockManager = createLockManagerDouble();
    return {
      async makeStore({ relaunchOutboxEmpty = null } = {}) {
        const store = createIndexedDbRqsResumeStore({ indexedDB, lockManager, relaunchOutboxEmpty });
        await tick();
        return store;
      },
      async settleOwnership() {
        // The closed holder's Web Lock grants to the queued reader.
        await tick();
      },
    };
  },
});

// --- store-independent unit -------------------------------------------------

test('membershipWitnessOfRows is exact, sorted, capped, and fail-closed (unit)', () => {
  const rows = [{ _id: 'b', v: 2 }, { _id: 'a', v: 1 }];
  const digest = digestOfRows('mset1', rows);
  const witness = membershipWitnessOfRows(rows, digest);
  assert.equal(witness.count, 2);
  assert.deepEqual(witness.entries.map((entry) => entry.id), ['a', 'b'], 'ascending UTF-16 id order');
  assert.deepEqual(
    witness.entries.map((entry) => entry.oldRowHash),
    [base64UrlNoPad(rowHash(rows[1])), base64UrlNoPad(rowHash(rows[0]))],
    'exact (rowId, oldRowHash) pairs',
  );
  // seq1 results are never witnessable.
  assert.equal(membershipWitnessOfRows(rows, digestOfRows('seq1', rows)), null);
  // Over the entry cap: not sent (the server would refuse it to rung 3).
  assert.equal(membershipWitnessOfRows(rows, digest, { maxEntries: 1 }), null);
  // Held rows that no longer reproduce the digest are never witnessed.
  assert.equal(membershipWitnessOfRows([rows[0]], digest), null);
  // Mint-refusable rows (missing id) fail closed to null.
  assert.equal(membershipWitnessOfRows([{ v: 1 }], digestOfRows('mset1', [])), null);
});
