// Cross-language parity obligations for the RQS token/digest contract
// (LLP 0091 §Conformance; rollout cluster 0A of LLP 0090).
//
// Scaffolded stubs: each skipped test names one parity obligation the 0A
// implementation must discharge against the Rust counterpart
// (tests/rqs_digest_parity_v0.rs) over a shared property corpus. They are
// deliberately NOT wired into this package's `test` script until cluster 0A
// lands — named obligations, not CI gates.
//
// @ref LLP 0091#conformance--parity-obligations — the named obligations
//   these stubs reserve, pinned so both language arms implement one spec.

import { test } from 'node:test';

const SKIP = 'LLP 0091 0A parity stub: construction not implemented yet';

test(
  'obligation 1 — canonical encoding parity: identical RFC 8785 (JCS) bytes and identical mint-time refusals (non-finite, >2^53-1, lone surrogates, duplicate row ids); -0 serializes as 0',
  { skip: SKIP },
  () => {},
);

test(
  'obligation 2 — leaf parity: identical domain-separated length-framed leaves, including prefix-of-one-another row ids',
  { skip: SKIP },
  () => {},
);

test(
  'obligation 3 — multiset digest parity: identical LtHash-16 state and mset1: roots; commutativity; incremental equals recompute; strict-subset change preserves untouched leaves',
  { skip: SKIP },
  () => {},
);

test(
  'obligation 4 — sequence digest parity: identical seq1: digests; permuted order changes the digest',
  { skip: SKIP },
  () => {},
);

test(
  'obligation 5 — token MAC transcript parity: identical transcript bytes and HMAC-SHA256 tags; refusal vectors for bad MAC, unknown/retired key, expired issuedAt, oversize token',
  { skip: SKIP },
  () => {},
);
