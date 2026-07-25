//! Cross-language parity obligations for the RQS token/digest contract
//! (LLP 0091 §Conformance; rollout cluster 0A of LLP 0090).
//!
//! These are **scaffolded stubs**: each `#[ignore]`d test names one parity
//! obligation the 0A implementation must discharge against the JS
//! counterpart (`packages/snapback-client/rqs-digest-parity.test.mjs`) over
//! a shared property corpus — numeric edge cases, duplicate rows,
//! Unicode-normalization-sensitive strings, adversarial key ordering. They
//! compile but are not CI gates; un-ignore them as cluster 0A lands.
//!
//! @ref LLP 0091#conformance--parity-obligations — the named obligations
//!   these stubs reserve, pinned so both language arms implement one spec.

/// Obligation 1 — canonical encoding parity: identical RFC 8785 (JCS) bytes
/// for the shared corpus, and identical mint-time refusals (non-finite
/// numbers, integers beyond 2^53 - 1, lone surrogates, duplicate row ids);
/// negative zero serializes as `0` on both sides.
#[test]
#[ignore = "LLP 0091 0A parity stub: canonical JCS encoding not implemented yet"]
fn canonical_encoding_parity_v1() {
    unimplemented!("pin JCS bytes + mint-time refusal parity against the JS arm");
}

/// Obligation 2 — leaf parity: identical 32-byte domain-separated,
/// length-framed leaves for `(rowId, row)` pairs, including row ids that are
/// prefixes of one another (the length-framing injectivity check).
#[test]
#[ignore = "LLP 0091 0A parity stub: leaf construction not implemented yet"]
fn leaf_construction_parity_v1() {
    unimplemented!("pin snapback-rqs-leaf-v1 leaf bytes against the JS arm");
}

/// Obligation 3 — multiset digest parity: identical LtHash-16 state bytes
/// and published `mset1:` roots; insert/remove commutativity; incremental
/// update equals from-scratch recomputation; a strict-subset change
/// preserves untouched leaves (LLP 0090 D1.3's accumulator-update fixture).
#[test]
#[ignore = "LLP 0091 0A parity stub: mset1 accumulator not implemented yet"]
fn multiset_digest_parity_v1() {
    unimplemented!("pin mset1 state/root parity + accumulator-update property");
}

/// Obligation 4 — sequence digest parity: identical `seq1:` digests over the
/// JCS rows array; permuting delivered row order changes the digest.
#[test]
#[ignore = "LLP 0091 0A parity stub: seq1 digest not implemented yet"]
fn sequence_digest_parity_v1() {
    unimplemented!("pin seq1 digest parity + order sensitivity");
}

/// Obligation 5 — token MAC transcript parity: identical length-framed
/// transcript bytes and HMAC-SHA256 tags for fixture keys, plus the refusal
/// vectors (bad MAC, unknown/retired key, expired issuedAt, oversize token,
/// and each mint-expressible SNAPBACK_RESUME_* admission mismatch).
#[test]
#[ignore = "LLP 0091 0A parity stub: resume-token MAC transcript not implemented yet"]
fn token_mac_transcript_parity_v1() {
    unimplemented!("pin snapback.resume-token.v1 transcript/MAC parity + refusal vectors");
}
