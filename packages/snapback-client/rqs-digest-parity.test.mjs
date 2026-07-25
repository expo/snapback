// Cross-language parity obligations for the RQS token/digest contract
// (LLP 0091 §Conformance; rollout cluster 0A of LLP 0090) — JS side.
//
// Asserts byte-identical outputs against the SAME committed corpus the Rust
// arm pins (tests/rqs_digest_parity_v0.rs): tests/fixtures/rqs-parity-v1.json.
// The corpus is regenerated from the Rust arm; this side failing means the
// two implementations of LLP 0091 §0A have drifted.
//
// @ref LLP 0091#conformance--parity-obligations — the five named obligations.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  RqsMintRefusal,
  argsHash,
  digestOfRows,
  hex,
  jcs,
  leaf,
  mintTokenWire,
  mset1Add,
  mset1Empty,
  mset1Remove,
  mset1Root,
  rowHash,
  rowsMatchDigest,
  seq1Digest,
} from './rqs.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = JSON.parse(
  readFileSync(path.join(root, 'tests', 'fixtures', 'rqs-parity-v1.json'), 'utf8'),
);

function keyBytes(keyHex) {
  const out = new Uint8Array(keyHex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(keyHex.slice(2 * i, 2 * i + 2), 16);
  }
  return out;
}

test('obligation 1 — canonical encoding parity: identical RFC 8785 (JCS) bytes and identical mint-time refusals; -0 serializes as 0', () => {
  for (const { input, canonical } of fixture.jcs) {
    assert.equal(jcs(input), canonical);
  }
  assert.equal(jcs(-0), '0');
  assert.throws(() => jcs(9007199254740992), RqsMintRefusal);
  assert.throws(() => jcs(-9007199254740992), RqsMintRefusal);
  // The shared integral-double band (see rqs.mjs jcsNumber): refused below
  // 1e21, allowed at and above it (canonical exponent form).
  assert.throws(() => jcs(1e20), RqsMintRefusal);
  assert.equal(jcs(1e21), '1e+21');
  assert.throws(() => jcs(Number.NaN), RqsMintRefusal);
  assert.throws(() => jcs(Number.POSITIVE_INFINITY), RqsMintRefusal);
  // Lone surrogates cannot round-trip: the JS arm owns this refusal (a Rust
  // String cannot hold one).
  assert.throws(() => jcs('broken \uD800 surrogate'), RqsMintRefusal);
  assert.throws(() => digestOfRows('mset1', [{ v: 1 }]), RqsMintRefusal);
  assert.throws(
    () => digestOfRows('mset1', [{ _id: 'a' }, { _id: 'a' }]),
    RqsMintRefusal,
  );
});

test('obligation 2 — leaf parity: identical domain-separated length-framed leaves, including prefix-of-one-another row ids', () => {
  for (const entry of fixture.leaves) {
    const hash = rowHash(entry.row);
    assert.equal(hex(hash), entry.rowHash);
    assert.equal(hex(leaf(entry.id, hash)), entry.leaf);
  }
  const hash = new Uint8Array(32).fill(7);
  assert.notEqual(hex(leaf('a', hash)), hex(leaf('ab', hash)));
});

test('obligation 3 — multiset digest parity: identical LtHash-16 mset1: roots; commutativity; incremental equals recompute; strict-subset change preserves untouched leaves', () => {
  assert.equal(mset1Root(mset1Empty()), fixture.mset1.emptyRoot);
  assert.equal(digestOfRows('mset1', fixture.mset1.rows), fixture.mset1.root);
  assert.equal(
    digestOfRows('mset1', [...fixture.mset1.rows].reverse()),
    fixture.mset1.root,
    'commutativity',
  );

  // Incremental subset update (the LLP 0090 D1.3 accumulator-update rule):
  // remove only the touched row's old leaf, add its new leaf; untouched
  // leaves stay. Must equal both the from-scratch recompute and the pinned
  // Rust-side incremental root.
  const { id, row, root: expectedRoot } = fixture.mset1.subsetUpdate;
  const state = mset1Empty();
  for (const held of fixture.mset1.rows) {
    mset1Add(state, leaf(held._id, rowHash(held)));
  }
  const touched = fixture.mset1.rows.find((held) => held._id === id);
  mset1Remove(state, leaf(id, rowHash(touched)));
  mset1Add(state, leaf(id, rowHash(row)));
  assert.equal(mset1Root(state), expectedRoot);
  const recomputed = fixture.mset1.rows.map((held) => (held._id === id ? row : held));
  assert.equal(digestOfRows('mset1', recomputed), expectedRoot);

  // rowsMatchDigest is the transition-table verifier over the same algebra.
  assert.ok(rowsMatchDigest(recomputed, expectedRoot));
  assert.ok(!rowsMatchDigest(fixture.mset1.rows, expectedRoot));
});

test('obligation 4 — sequence digest parity: identical seq1: digests; permuted order changes the digest', () => {
  assert.equal(seq1Digest(fixture.seq1.rows), fixture.seq1.digest);
  assert.equal(
    seq1Digest([...fixture.seq1.rows].reverse()),
    fixture.seq1.reversedDigest,
  );
  assert.notEqual(fixture.seq1.digest, fixture.seq1.reversedDigest);
});

test('obligation 5 — token MAC transcript parity: identical tokenWire (length-framed transcript + HMAC-SHA256 tag) for the fixture key', () => {
  const wire = mintTokenWire(
    keyBytes(fixture.token.keyHex),
    fixture.token.keyId,
    fixture.token.body,
  );
  assert.equal(wire, fixture.token.wire);
});

test('argsHash carries its domain tag (spot check against the digest algebra)', () => {
  assert.match(argsHash({}), /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(argsHash({}), argsHash({ a: 1 }));
});
